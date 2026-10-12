import { logLineReceived } from '../services/purchaseAuditService.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import StagedPurchase from '../models/StagedPurchase.js';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js';
import QCJob from '../models/QCJob.js';
import RFQ from '../models/RFQ.js';
import VendorBid from '../models/VendorBid.js';
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';

import fs from 'fs';
import path from 'path';
import notificationService from '../services/notificationService.js';
import { Item } from '../models/Inventory.js';
import { dimensionSignature, resolveFabricationWeight } from '../services/fabricationDemandService.js';
import { MASS_UNIT_TO_KG_MULTIPLIER } from '../services/itemPricingService.js';
import { resolveMasterItemId } from './purchaseQuoteController.js';

// Validates + weight-resolves a set of fabrication dimension lines against an
// Item's actual catalog dimensionVariants (never a leftover cut — Purchase
// only ever reorders original catalog sizes, same rule Store's own picker
// enforces), and predicts the total order quantity in the item's own
// Purchase Unit when that's a Mass Unit — the vendor is ultimately paid for
// weight, not piece count, regardless of how many distinct cut sizes make up
// the order (e.g. 20kg of one size + 10kg of another = 30kg ordered).
// Shared by createPurchaseRequest, previewFabricationTotal, editFabricationLines,
// and receiveFabricationPurchase so they can never compute this differently.
//
// requireCatalogMatch defaults true (ordering/editing a request — Purchase
// only ever orders an existing catalog size). receiveFabricationPurchase
// passes false: Store may receive a dimension the vendor shipped that isn't
// in the catalog at all — still weight-computable (only needs the item's
// category+density, not catalog membership), the caller is responsible for
// flagging it isLeftover when crediting stock (see qcController.js).
export async function resolveFabricationLines(masterItem, rawLines, { requireCatalogMatch = true } = {}) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error('At least one dimension line is required.');
  }
  const catalogVariants = (masterItem.dimensionVariants || []).filter(v => !v.isLeftover);

  const lines = [];
  let totalWeightKg = 0;
  for (const raw of rawLines) {
    const qty = Number(raw.quantity);
    if (!(qty > 0)) throw new Error('Every dimension line needs a quantity greater than 0.');

    const match = catalogVariants.find(v => dimensionSignature(v.values) === dimensionSignature(raw.values));
    if (!match && requireCatalogMatch) {
      throw new Error(`Dimension ${JSON.stringify(raw.values)} is not a known catalog size for this item.`);
    }
    const valuesToUse = match ? match.values : raw.values;

    const fabWeight = await resolveFabricationWeight(masterItem, valuesToUse);
    const weightPerPieceKg = fabWeight?.weightPerPieceKg ?? null;
    const lineWeightKg = weightPerPieceKg != null ? Math.round(weightPerPieceKg * qty * 1000) / 1000 : null;
    if (lineWeightKg != null) totalWeightKg += lineWeightKg;

    lines.push({ values: valuesToUse, quantity: qty, weightPerPieceKg, lineWeightKg });
  }

  totalWeightKg = Math.round(totalWeightKg * 1000) / 1000;

  const isMassUnit = masterItem.purchaseUnitType === 'Mass Unit' && !!MASS_UNIT_TO_KG_MULTIPLIER[masterItem.purchaseUnit];
  let resolvedQuantity = null;
  let resolvedUnit = null;
  if (isMassUnit && totalWeightKg > 0) {
    resolvedQuantity = Math.round(totalWeightKg * MASS_UNIT_TO_KG_MULTIPLIER[masterItem.purchaseUnit] * 1000) / 1000;
    resolvedUnit = masterItem.purchaseUnit;
  }

  return { lines, totalWeightKg, resolvedQuantity, resolvedUnit, isMassUnit };
}

// One size per purchase request (procurement-v2, 2026-10-09). On RFQ/PO each
// fabrication size is its own card / PO line, ordered in PIECES with the kg
// calculated — so a request can only ever carry ONE size (a request links to
// one PO, and receiving / QC / rating all work per request). Store may still
// tick several sizes in one dialog: the request is split here, one per size.
// Lines of the same size are merged first. Returns [{ lines: [one line],
// quantity, unit }] — quantity / unit worked out per size exactly as a
// single-size request always was.
export async function splitFabricationLinesPerSize(masterItem, rawLines, { requireCatalogMatch = true, fallbackUnit = null } = {}) {
  const bySize = new Map();
  for (const l of rawLines || []) {
    const sig = dimensionSignature(l?.values);
    if (bySize.has(sig)) bySize.get(sig).quantity += Number(l.quantity) || 0;
    else bySize.set(sig, { values: l?.values, quantity: Number(l?.quantity) || 0 });
  }
  const out = [];
  for (const line of bySize.values()) {
    const resolved = await resolveFabricationLines(masterItem, [line], { requireCatalogMatch });
    out.push({
      lines: resolved.lines,
      quantity: resolved.isMassUnit ? resolved.resolvedQuantity : resolved.lines[0].quantity,
      unit: resolved.isMassUnit ? resolved.resolvedUnit : (masterItem.purchaseUnit || masterItem.unit || fallbackUnit || null),
    });
  }
  return out;
}

// Creates the QC Job for a just-Received purchase request, unless one
// already exists for it (exchange-replacement requests reuse the original
// PO, so matching on sourceRefId alone would collide with the original
// request's already-closed QC job and wrongly skip creating a new one —
// matching on purchaseRequestId instead avoids that). `quantityOverride`
// lets receiveFabricationPurchase pass the total pieces across its
// dimension breakdown instead of the generic convertedQuantity/quantity
// fallback (which doesn't apply — a fabrication request's own `quantity` is
// the aggregate purchase-unit weight, not a piece count).
// Shared by updatePurchaseRequestStatus and receiveFabricationPurchase.
async function createPurchaseQCJob(request, req, quantityOverride = null) {
  try {
    const sourceRefId = request.purchaseOrder?.purchaseOrderNumber || request.requestId;

    const existingQC = await QCJob.findOne({
      source: 'Purchase',
      purchaseRequestId: request._id,
      company: request.companyId
    });
    if (existingQC) return;

    const qcJobId = await generateQCJobId();

    let qcCategory = 'Raw Material';
    let qcBaseUnit = request.unit || 'pcs';
    try {
      const inventoryItem = await Item.findOne({
        name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') },
        companyId: request.companyId
      });
      if (inventoryItem && inventoryItem.category) {
        qcCategory = inventoryItem.category;
      }
      if (inventoryItem?.fabricationRef) {
        // Fabrication items: whatever ends up as this job's `quantity` (a
        // fresh receive's totalPieces, or the fallback request.quantity) is
        // always a PIECE count — dimensionVariants[].subStock is piece-based,
        // same unit Store actually received/counted in (Receive Unit).
        // inventoryItem.unit is the Used Unit (a Length/Area unit, for BOM
        // consumption) — using it here would mislabel a piece count as e.g.
        // "18 Centimeter" on the QC Job detail page.
        qcBaseUnit = inventoryItem.receiveUnit || 'Pieces';
      } else if (inventoryItem && (inventoryItem.receiveUnit || inventoryItem.unit)) {
        // Non-fabrication items: Receive Unit is enforced equal to Used Unit
        // (sanitizeItemData in inventoryController.js), so this is the same
        // value either way — reading receiveUnit first is the architecturally
        // correct source (it's the stock-counting unit), with unit as a
        // fallback for any item saved before that enforcement existed.
        qcBaseUnit = inventoryItem.receiveUnit || inventoryItem.unit;
      }
    } catch (invLookupErr) {
      console.error('Error looking up inventory item for QC job category:', invLookupErr);
    }

    // Multi-item: resolve the sales orderCode for grouping in QC screens
    let qcOrderCode = '';
    try {
      if (request.storeOrderId) {
        const OrderModel = (await import('../models/Order.js')).default;
        const linkedOrder = await OrderModel.findById(request.storeOrderId).select('orderCode').lean();
        qcOrderCode = linkedOrder?.orderCode || '';
      }
    } catch (_) { /* optional */ }

    await QCJob.create({
      qcJobId,
      source: 'Purchase',
      sourceRefId: sourceRefId,
      purchaseRequestId: request._id,   // ← direct PR ref for reliable Sale lookup
      saleItemId: request.saleItemId || null, // ← exact order item this purchase fulfils
      orderCode: qcOrderCode,
      sourceDepartment: 'Store',
      sentBy: req.user.fullName || req.user.username || 'Store Dept',
      itemName: request.productName,
      itemCode: request.itemId || request.requestId,
      category: qcCategory,
      // Converted base-unit qty when the order was placed in a purchase unit
      // (e.g. 20 kg received ÷ 1 kg/pc = 20 pcs) — QC approval adds this qty to inventory
      quantity: quantityOverride ?? (request.convertedQuantity || request.quantity || 1),
      unit: qcBaseUnit,
      receivedDate: today(),
      status: 'Pending',
      company: request.companyId,
      createdBy: req.user._id,
      notes: `Automatically created from Store Purchase Requisition: ${request.requestId}`
    });
    console.log(`✅ QC Job ${qcJobId} automatically created for Purchase Request ${request.requestId} with category ${qcCategory}`);

    try {
      await notificationService.triggerQCNotification({
        action: 'qc_job_created',
        data: { qcJobId, itemName: request.productName, requestId: request.requestId, quantity: request.quantity },
        targetCompanyId: request.companyId,
      });
    } catch (e) { console.error('QC job notification error:', e); }
  } catch (qcError) {
    console.error('❌ Error creating QC job from Purchase Request:', qcError);
  }
}

// Normalize-to-array helper, mirrors purchaseController.js's own prIdsOf
// exactly (not imported from there — a controller importing a sibling
// controller risks a circular import here, same reasoning
// vendorRatingService.js already documents for its own local copy). A PO
// line can carry either the original singular purchaseRequest or the new
// plural purchaseRequests (item-wise PR consolidation, 2026-10).
function prIdsOf(line) {
  if (Array.isArray(line?.purchaseRequests) && line.purchaseRequests.length) return line.purchaseRequests;
  if (line?.purchaseRequest) return [line.purchaseRequest];
  return [];
}

// Shared by updatePurchaseRequestStatus (single PR) and the line-level
// receiveLineItems (looped once per PR bundled on a PO line) — the actual
// "this PR is now Received" side effects: inventory item serial/warranty,
// lead-time sample, QC job, auto-invoice. Both callers have already written
// the receive-specific fields (serialNumber/warrantyPeriod/receivedAt/etc)
// onto `request` and saved it before calling this. skipPricingRecalc lets a
// line-level batch of PRs run this once per PR for everything except
// pricing, then recalc pricing exactly once after the whole loop —
// recalculateItemPricing is an Item-keyed computation (full PurchaseInvoice
// aggregation + a document save) that gives the identical answer no matter
// which PR in the loop triggers it, so running it N times for one physical
// receipt is pure redundant work.
async function applyReceiveSideEffects(request, req, { skipPricingRecalc = false } = {}) {
  // ── Update matching Inventory item with serial + warranty info ───────────
  try {
    const { Item } = await import('../models/Inventory.js');

    // Item model uses `store` (string of companyId), NOT `companyId` field
    const storeStr = request.companyId.toString();
    let inventoryItem = null;

    // Attempt 1: match by itemId (ObjectId reference — most reliable)
    if (request.itemId && /^[0-9a-fA-F]{24}$/.test(request.itemId)) {
      inventoryItem = await Item.findById(request.itemId);
    }

    // Attempt 2: match by name + store field
    if (!inventoryItem) {
      inventoryItem = await Item.findOne({
        name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') },
        store: storeStr
      });
    }

    if (inventoryItem) {
      inventoryItem.serialNumber = request.serialNumber;
      inventoryItem.warranty.period = request.warrantyPeriod;
      if (request.warrantyCardUrl) {
        // Replace the old warranty card with the newly uploaded one —
        // delete the previous file so it doesn't linger orphaned on disk.
        const oldCardUrl = inventoryItem.warranty.cardUrl;
        if (oldCardUrl && oldCardUrl !== request.warrantyCardUrl) {
          try {
            const oldCardPath = path.join(process.cwd(), oldCardUrl.replace(/^\//, ''));
            if (fs.existsSync(oldCardPath)) fs.unlinkSync(oldCardPath);
          } catch (unlinkErr) {
            console.error('Failed to delete old warranty card:', oldCardUrl, unlinkErr.message);
          }
        }
        inventoryItem.warranty.cardUrl = request.warrantyCardUrl;
        inventoryItem.warranty.cardUploadedAt = new Date();
      }
      inventoryItem.receivedFromPurchaseRequest = request._id;
      await inventoryItem.save();
      console.log(`✅ Inventory item "${inventoryItem.name}" updated with serial & warranty info`);
    } else {
      console.warn(`⚠️  No matching inventory item found for "${request.productName}" – skipping inventory update`);
    }

    // 📊 Feed the delivery-date estimator: this request's full
    // request→receive cycle becomes one sample in this item's vendor
    // lead-time average. This IS the real Store "mark as Received" flow
    // (unlike controllers/purchaseController.js's receivePurchase,
    // which has no frontend caller at all) — this is the only place
    // that should ever record a Purchase-path sample. Best-effort,
    // never blocks receiving.
    try {
      const resolvedCode = request.materialCode || inventoryItem?.code || null;
      if (resolvedCode) {
        const { recordLeadTimeSample } = await import('../utils/leadTimeStats.js');
        const durationDays = (request.receivedAt.getTime() - new Date(request.requestDate).getTime()) / (1000 * 60 * 60 * 24);
        await recordLeadTimeSample(request.companyId, resolvedCode, request.productName, 'Purchase', durationDays);
      }
    } catch (statsErr) {
      console.error('❌ Error recording purchase lead-time sample:', statsErr.message);
    }
  } catch (invErr) {
    console.error('❌ Error updating inventory item on receive:', invErr);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // 1. Generate QC Job
  await createPurchaseQCJob(request, req);

  // 2. Generate Purchase Invoice ONLY if one doesn't already exist for this PO
  //    (Invoice is now created at PO generation time via RFQ flow — avoid duplicate)
  try {
    const { createAutoPurchaseInvoice } = await import('./purchaseInvoiceController.js');
    const PurchaseInvoice = (await import('../models/PurchaseInvoice.js')).default;

    // Check if invoice already exists linked to this PO (one invoice per
    // PO now, not per PR — a PO can batch several PRs, see Purchase.js's
    // purchaseRequests[]).
    let invoiceAlreadyExists = false;
    if (request.purchaseOrder) {
      const poNumber = request.purchaseOrder?.purchaseOrderNumber || '';
      const vendorId = request.purchaseOrder?.supplier?._id || request.purchaseOrder?.supplier;
      if (vendorId && poNumber) {
        const existingInvoice = await PurchaseInvoice.findOne({
          vendor: vendorId,
          notes: { $regex: poNumber, $options: 'i' }
        });
        if (existingInvoice) {
          invoiceAlreadyExists = true;
          console.log(`ℹ️ [Purchase Receipt] Invoice already exists for PO ${poNumber} — skipping duplicate creation`);
        }
      }
    }

    if (!invoiceAlreadyExists && request.purchaseOrder) {
      await createAutoPurchaseInvoice(request.purchaseOrder, req.user);
      console.log(`✅ [Purchase Receipt] Purchase Invoice created for request: ${request.requestId}`);
    }
  } catch (invoiceError) {
    console.error('❌ Error creating purchase invoice on request receipt:', invoiceError);
  }

  // 3. Re-resolve the item's purchase price NOW that the receive-time unit
  //    conversion factor is known. The auto-invoice (and the recalc it fires)
  //    is created at PO-generation time — BEFORE Store enters the conversion —
  //    so that early recalc stores the raw purchase-unit price. This is the
  //    authoritative "store received it" recalc with the factor available.
  if (!skipPricingRecalc) {
    try {
      const { recalculateItemPricing } = await import('../services/itemPricingService.js');
      const { Item } = await import('../models/Inventory.js');
      const storeStr = request.companyId.toString();

      let pricingItem = null;
      if (request.itemId && /^[0-9a-fA-F]{24}$/.test(request.itemId)) {
        pricingItem = await Item.findById(request.itemId);
      }
      if (!pricingItem) {
        pricingItem = await Item.findOne({
          name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') },
          store: storeStr
        });
      }

      if (pricingItem && pricingItem.purchase && !pricingItem.internalManufacturing) {
        // This exact receive's own conversionFactor, passed explicitly —
        // skips itemPricingService.js's fragile invoice-notes reverse-
        // lookup (which this receive's own inventoryItem.save() above
        // happened to make work by coincidence, but shouldn't be relied
        // on) in favor of the value this request already knows for sure.
        await recalculateItemPricing(pricingItem, { knownConversionFactor: request.conversionFactor });
        console.log(`💰 [Purchase Receipt] Pricing re-resolved with unit conversion for "${pricingItem.code}"`);
      }
    } catch (pricingErr) {
      console.error('❌ Error recalculating item pricing on receipt:', pricingErr);
    }
  }
}

// Same role as applyReceiveSideEffects above, for the fabrication receive
// path (receiveFabricationPurchase / the fabrication half of
// receiveLineItems's sibling, receiveLineFabrication). quantityOverride is
// this specific PR's own attributed piece count — see receiveLineFabrication
// for why a combined line-level receive still gives each PR its own QCJob
// with its own share rather than the full combined total. Also closes a
// pre-existing gap: the single-PR fabrication path never called
// recordLeadTimeSample at all (only updatePurchaseRequestStatus did), so
// fabrication PRs contributed zero samples to the vendor lead-time
// estimator — fixed here since this helper is now shared by both.
async function applyFabricationReceiveSideEffects(request, masterItem, req, { quantityOverride = null, skipPricingRecalc = false } = {}) {
  // Needed by findPurchaseToBaseFactor's fallback lookup (same field the
  // generic receive flow sets) — serial/warranty are skipped entirely,
  // they don't apply to raw fabrication stock.
  try {
    masterItem.receivedFromPurchaseRequest = request._id;
    await masterItem.save();
  } catch (invErr) {
    console.error('❌ Error updating inventory item on fabrication receive:', invErr);
  }

  try {
    const resolvedCode = request.materialCode || masterItem?.code || null;
    if (resolvedCode) {
      const { recordLeadTimeSample } = await import('../utils/leadTimeStats.js');
      const durationDays = (request.receivedAt.getTime() - new Date(request.requestDate).getTime()) / (1000 * 60 * 60 * 24);
      await recordLeadTimeSample(request.companyId, resolvedCode, request.productName, 'Purchase', durationDays);
    }
  } catch (statsErr) {
    console.error('❌ Error recording fabrication purchase lead-time sample:', statsErr.message);
  }

  await createPurchaseQCJob(request, req, quantityOverride);

  try {
    const { createAutoPurchaseInvoice } = await import('./purchaseInvoiceController.js');
    const PurchaseInvoice = (await import('../models/PurchaseInvoice.js')).default;

    let invoiceAlreadyExists = false;
    if (request.purchaseOrder) {
      const poNumber = request.purchaseOrder?.purchaseOrderNumber || '';
      const vendorId = request.purchaseOrder?.supplier?._id || request.purchaseOrder?.supplier;
      if (vendorId && poNumber) {
        const existingInvoice = await PurchaseInvoice.findOne({
          vendor: vendorId,
          notes: { $regex: poNumber, $options: 'i' }
        });
        if (existingInvoice) invoiceAlreadyExists = true;
      }
    }
    if (!invoiceAlreadyExists && request.purchaseOrder) {
      await createAutoPurchaseInvoice(request.purchaseOrder, req.user);
    }
  } catch (invoiceError) {
    console.error('❌ Error creating purchase invoice on fabrication receipt:', invoiceError);
  }

  if (!skipPricingRecalc) {
    try {
      const { recalculateItemPricing } = await import('../services/itemPricingService.js');
      // Same reasoning as the plain-item receive path above — this
      // receive's own conversionFactor (the weighted-average kg/piece set
      // just above) is already known for certain, no need to make
      // resolvePurchaseItemCost go rediscover it from invoice notes text.
      await recalculateItemPricing(masterItem, { knownConversionFactor: request.conversionFactor });
    } catch (pricingErr) {
      console.error('❌ Error recalculating fabrication item pricing on receipt:', pricingErr);
    }
  }
}

// Generate a unique requestId safely (avoids E11000 duplicate key errors)
async function generateUniqueRequestId() {
  let attempts = 0;
  while (attempts < 20) {
    const count = await PurchaseRequest.countDocuments({});
    const candidate = `PR${String(count + 1 + attempts).padStart(3, '0')}`;
    const exists = await PurchaseRequest.findOne({ requestId: candidate }).lean();
    if (!exists) return candidate;
    attempts++;
  }
  // Fallback: timestamp-based ID
  return `PR-${Date.now().toString().slice(-6)}`;
}

// What actually raised this PR — NOT requestFromDepartment, which is
// useless for this: every real creation path (the low-stock cron, the BOM
// shortfall cascade, Order Form's direct-purchase routing, and Store's own
// Material Transfer bulk submit) hardcodes it to 'Store' (confirmed by
// grepping every PurchaseRequest.create() call in the codebase — the only
// exception is the QC vendor-exchange replacement flow, which sets 'QC').
// Purchase asked for a real way to tell these apart, so this classifies by
// the fields each path ACTUALLY sets distinctly:
//   - lowStockReorderCron.js sets autoGenerated + reorderItemId (the Item
//     being reordered).
//   - materialAvailabilityService.js (the cascade — Machine/Child Part/Sub
//     Child Part BOM shortfall) sets autoGenerated + storeOrderId, never
//     reorderItemId.
//   - storeFlowService.js's Order Form direct-purchase routing (CASE 3) and
//     createBulkPurchaseRequests (Store's Material Transfer page) both set
//     saleItemId only on the former — Material Transfer sets neither
//     autoGenerated nor saleItemId, so it falls through to 'manual'.
//   - purchaseExchangeController.js's vendor-exchange replacement PR copies
//     storeOrderId/saleItemId from the original PR it's replacing, so its
//     own explicit source:'QC' is checked FIRST to avoid being
//     misclassified as whatever the original PR was.
function classifyRaisedBy(pr) {
  if (pr.source === 'QC') return 'qcExchange';
  if (pr.autoGenerated && pr.reorderItemId) return 'autoReorder';
  if (pr.autoGenerated && pr.storeOrderId) return 'cascade';
  if (pr.saleItemId) return 'salesOrder';
  return 'manual';
}

// Get all purchase requests for a company
export const getPurchaseRequests = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';

    // --- Auto-sync existing matching Sales to Purchase Requests ---
    // Multi-item aware: sales with per-item flow create one PR per item that
    // is routed 'Goes to Purchase' (keyed by saleItemId); legacy sales keep
    // the old whole-sale behavior.
    try {
      const matchingSales = await Sale.find({
        companyId,
        $or: [
          { isAvailableInInventory: 'Not Available', productType: 'Purchased (Trading Product)' },
          { 'items.storeQCStatus': 'Goes to Purchase' }
        ]
      }).populate('order');

      for (const sale of matchingSales) {
        const sourceRefIdBase = sale.invoiceNumber || sale._id.toString();
        const perItemFlow = (sale.items || []).some(it =>
          it.storeQCStatus || it.isAvailableInInventory || it.productType);

        if (perItemFlow) {
          for (const it of sale.items || []) {
            if (it.storeQCStatus !== 'Goes to Purchase') continue;

            // Atomic upsert, not find-then-create: two near-simultaneous
            // PRs-tab loads can otherwise both pass a separate "does a PR
            // already exist" check before either create() lands, producing
            // duplicate PRs for the same sale item (confirmed live,
            // 2026-10). The partial unique index on {companyId,saleItemId}
            // (PurchaseRequest.js) makes this upsert race-safe at the DB
            // level; $setOnInsert means a second concurrent call just hits
            // the duplicate-key path below and is swallowed as a no-op.
            const requestId = await generateUniqueRequestId();
            try {
              await PurchaseRequest.findOneAndUpdate(
                { companyId, saleItemId: it._id },
                {
                  $setOnInsert: {
                    requestId,
                    productName: it.productName,
                    quantity: it.quantity || 1,
                    requestFromDepartment: 'Store',
                    source: 'Store',
                    storeApproved: true,
                    priority: sale.order?.priority || 'Medium',
                    companyId,
                    storeOrderId: sale.order?._id || sale._id,
                    itemId: `${sourceRefIdBase}#${it._id.toString()}`,
                    saleItemId: it._id
                  }
                },
                { upsert: true, new: false }
              );
              console.log(`Auto-synced sale item "${it.productName}" to Purchase Request: ${requestId}`);
            } catch (dupErr) {
              if (dupErr?.code !== 11000) throw dupErr;
            }
          }
          continue;
        }

        // Legacy whole-sale sync
        if (sale.isAvailableInInventory !== 'Not Available' || sale.productType !== 'Purchased (Trading Product)') continue;
        const existingReq = await PurchaseRequest.findOne({ companyId, itemId: sourceRefIdBase });

        if (!existingReq) {
          const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
          const productName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;

          const requestId = await generateUniqueRequestId();

          await PurchaseRequest.create({
            requestId,
            productName,
            quantity: sale.items?.reduce((acc, item) => acc + (item.quantity || 0), 0) || 1,
            requestFromDepartment: 'Store',
            source: 'Store',
            storeApproved: true, // Store-originated requests go directly to Purchase
            priority: sale.order?.priority || 'Medium',
            companyId,
            storeOrderId: sale.order?._id || sale._id,
            itemId: sourceRefIdBase
          });
          console.log(`Auto-synced existing sale to Purchase Request: ${requestId}`);
        }
      }
    } catch (syncError) {
      console.error('Error during auto-sync of Purchase Requests:', syncError);
    }
    // -------------------------------------------------------------

    let query = { companyId };
    if (!isStoreUser) {
      // Purchase dept: see Store-sourced or Production/QC that Store has approved
      query.$or = [
        { source: 'Store' },
        { source: null },
        { source: { $exists: false } },
        { source: { $in: ['Production', 'QC'] }, storeApproved: true }
      ];
    }
    // RFQ Management only ever needs the still-actionable (Pending/Approved)
    // subset, not the full historical archive Purchase Request browses —
    // scope at the DB query level via ?status=Pending,Approved instead of
    // fetching everything and filtering client-side.
    if (req.query.status) {
      const statuses = req.query.status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length) query.status = { $in: statuses };
    }
    // Purchase & Outsource -> PRs tab filters (2026-10) — priority narrowed
    // at the query level, same pattern as status above, so pagination/
    // totals stay correct instead of only filtering whatever happens to be
    // on the current page. (A `department` filter on requestFromDepartment
    // was tried here first, then dropped — see classifyRaisedBy below for
    // why.)
    if (req.query.priority) {
      const priorities = req.query.priority.split(',').map(p => p.trim()).filter(Boolean);
      if (priorities.length) query.priority = { $in: priorities };
    }

    const requests = await PurchaseRequest.find(query)
      .populate({ path: 'purchaseOrder', populate: { path: 'supplier' } })
      .sort({ createdAt: -1 });

    // --- Self-healing sync ---
    let updatedAny = false;
    for (const reqObj of requests) {
      if (reqObj.purchaseOrder && (reqObj.status === 'Pending' || reqObj.status === 'Approved')) {
        reqObj.status = 'Ordered';
        await reqObj.save();
        updatedAny = true;
      }
    }

    let finalRequests = requests;
    if (updatedAny) {
      finalRequests = await PurchaseRequest.find(query)
        .populate({ path: 'purchaseOrder', populate: { path: 'supplier' } })
        .sort({ createdAt: -1 });
    }

    // Auto-sync + self-healing above still need to see (and fix) every
    // purchase request, so that part isn't paginated — but search/pagination
    // ARE applied here, before the per-row Master Item lookup below, so that
    // expensive N+1 enrichment only ever runs for the current page's rows,
    // not every purchase request the company has ever filed.
    const { page = 1, limit = 20, search } = req.query;
    let filteredRequests = finalRequests;
    if (req.query.raisedBy) {
      const wanted = req.query.raisedBy.split(',').map(s => s.trim()).filter(Boolean);
      if (wanted.length) filteredRequests = filteredRequests.filter(r => wanted.includes(classifyRaisedBy(r)));
    }
    if (search) {
      const q = search.toLowerCase();
      // Matches product name, PR id, and item code — materialCode is the
      // real item-code field on a PR (set by the auto-reorder sweep, the
      // cascade pipeline, and bulk procurement); itemId is also checked
      // since several creation paths (notably the low-stock sweep) store
      // the Item's own code there too, confirmed by this same controller's
      // own master-item lookup a few lines below, which already matches
      // `{ code: pr.itemId }`.
      filteredRequests = filteredRequests.filter(r =>
        (r.productName || '').toLowerCase().includes(q) ||
        (r.requestId || '').toLowerCase().includes(q) ||
        (r.materialCode || '').toLowerCase().includes(q) ||
        (r.itemId || '').toLowerCase().includes(q)
      );
    }
    const total = filteredRequests.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pageRequests = filteredRequests.slice(skip, skip + parseInt(limit));

    // ─────────────────────────────────────────────────────────────
    // NEW: Attach Master Inventory Item (R&D Specs) to each PR
    // ─────────────────────────────────────────────────────────────
    const enrichedRequests = await Promise.all(pageRequests.map(async (reqObj) => {
      const pr = reqObj.toObject();
      pr.raisedBy = classifyRaisedBy(pr);

      // Attempt to find the Master Item to attach R&D Specs
      const masterItem = await Item.findOne({
        companyId,
        $or: [
          { code: pr.itemId },
          { name: { $regex: new RegExp(`^${pr.productName}$`, 'i') } }
        ]
      }).select('name code specifications warranty unit unitType purchaseUnit purchaseUnitType receiveUnit fabricationRef dimensionVariants');

      if (masterItem) {
        pr.item = masterItem; // Attaches to PR so the frontend UI can read it
      }

      return pr;
    }));

    res.status(200).json({
      success: true,
      data: enrichedRequests,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching purchase requests:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/purchase-requests/staged
export const getStagedPurchaseRequests = async (req, res) => {
  try {
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    // Fetch all staged items for this company, sorted by newest first
    const stagedItems = await StagedPurchase.find({ companyId }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: stagedItems
    });
  } catch (error) {
    console.error('Error fetching staged purchase requests:', error);
    res.status(500).json({ success: false, message: 'Server Error fetching staged items.' });
  }
};

// POST /api/purchase-requests/bulk-purchase
export const createBulkPurchaseRequests = async (req, res) => {
  try {
    const { items, stagedIds } = req.body;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No procurement items provided.' });
    }

    // ─────────────────────────────────────────────────────────────
    // 1. GLOBAL BULK R&D COMPLIANCE CHECK (On Consolidated List)
    // ─────────────────────────────────────────────────────────────
    const validationErrors = [];
    for (const item of items) {
      const searchCriteria = [{ name: { $regex: new RegExp(`^${item.productName.trim()}$`, 'i') } }];
      if (item.materialCode) searchCriteria.push({ code: item.materialCode });
      if (item.itemId && item.itemId.toString().match(/^[0-9a-fA-F]{24}$/)) {
        searchCriteria.push({ _id: item.itemId });
      }

      const masterItem = await Item.findOne({ companyId, $or: searchCriteria });
      if (!masterItem) {
        validationErrors.push(`Product "${item.productName}" does not exist in Master Inventory.`);
        continue;
      }
      if (masterItem.purchase === false) {
        validationErrors.push(`"${masterItem.name}" is flagged for Internal Manufacturing only.`);
        continue;
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, message: 'R&D Restriction Failure', errors: validationErrors });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. GENERATE COMBINED COMPLIANT REQUEST RECORDS
    // ─────────────────────────────────────────────────────────────
    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    const createdRequests = [];

    for (const item of items) {
      const resolvedSource = item.source || (isStoreUser ? 'Store' : 'Production');
      const resolvedStoreApproved = resolvedSource === 'Store';

      // A staged fabrication item with several sizes → one request per size
      // (2026-10-09, see splitFabricationLinesPerSize).
      const fabLines = Array.isArray(item.fabricationDimensionLines) ? item.fabricationDimensionLines : [];
      if (new Set(fabLines.map(l => dimensionSignature(l?.values))).size > 1) {
        const searchCriteria = [{ name: { $regex: new RegExp(`^${item.productName.trim()}$`, 'i') } }];
        if (item.materialCode) searchCriteria.push({ code: item.materialCode });
        if (item.itemId && item.itemId.toString().match(/^[0-9a-fA-F]{24}$/)) searchCriteria.push({ _id: item.itemId });
        const masterItem = await Item.findOne({ companyId, $or: searchCriteria });
        const perSize = await splitFabricationLinesPerSize(masterItem, fabLines, { requireCatalogMatch: false, fallbackUnit: item.unit });
        for (const size of perSize) {
          const sizeRequest = await PurchaseRequest.create({
            requestId: await generateUniqueRequestId(),
            productName: item.productName,
            quantity: size.quantity,
            requestFromDepartment: isStoreUser ? 'Store' : 'Production',
            priority: item.priority || 'Medium',
            companyId,
            storeOrderId: null,
            itemId: item.itemId || null,
            source: resolvedSource,
            storeApproved: resolvedStoreApproved,
            unit: size.unit,
            materialCode: item.materialCode || null,
            fabricationDimensionLines: size.lines,
          });
          createdRequests.push(sizeRequest);
        }
        continue;
      }

      const requestId = await generateUniqueRequestId();

      const newRequest = await PurchaseRequest.create({
        requestId,
        productName: item.productName,
        quantity: Number(item.quantity),
        requestFromDepartment: isStoreUser ? 'Store' : 'Production',
        priority: item.priority || 'Medium',
        companyId,
        storeOrderId: null, // Left null because this represents a consolidated cross-order buy
        itemId: item.itemId || null,
        source: resolvedSource,
        storeApproved: resolvedStoreApproved,
        unit: item.unit || null,
        materialCode: item.materialCode || null,
        fabricationDimensionLines: Array.isArray(item.fabricationDimensionLines) ? item.fabricationDimensionLines : []
      });

      createdRequests.push(newRequest);

      try {
        await notificationService.triggerStoreNotification({
          action: 'purchase_request_created',
          data: { requestId: newRequest.requestId, productName: newRequest.productName, priority: newRequest.priority },
          targetCompanyId: companyId,
        });
      } catch (e) {
        console.error(`Bulk notification dispatch error:`, e.message);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. PURGE SPENT STAGING REQS FROM OTHER COLLECTION BY REQ IDS
    // ─────────────────────────────────────────────────────────────
    if (stagedIds && Array.isArray(stagedIds) && stagedIds.length > 0) {
      await StagedPurchase.deleteMany({
        companyId,
        _id: { $in: stagedIds }
      });
    }

    res.status(201).json({
      success: true,
      message: `Successfully generated ${createdRequests.length} clean combined purchase requests. Staging table cleared.`,
      data: createdRequests
    });

  } catch (error) {
    console.error('Error handling bulk purchase creation:', error);
    res.status(500).json({ success: false, message: 'Server Error handling bulk purchase creation.' });
  }
};

// Create a new purchase request
export const createPurchaseRequest = async (req, res) => {
  try {
    const { productName, quantity, requestFromDepartment, priority, storeOrderId, itemId, source, unit, materialCode, fabricationDimensionLines } = req.body;
    const companyId = req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'User company is not configured' });
    }

    // ─────────────────────────────────────────────────────────────
    // STRICT R&D COMPLIANCE CHECK (The Gatekeeper)
    // ─────────────────────────────────────────────────────────────
    let masterItem;
    try {
      const searchCriteria = [{ name: { $regex: new RegExp(`^${productName.trim()}$`, 'i') } }];
      if (itemId) searchCriteria.push({ code: itemId });
      if (materialCode) searchCriteria.push({ code: materialCode });

      // If itemId is a valid MongoDB ObjectId, check by _id too
      if (itemId && itemId.match(/^[0-9a-fA-F]{24}$/)) {
        searchCriteria.push({ _id: itemId });
      }

      masterItem = await Item.findOne({
        companyId,
        $or: searchCriteria
      });

      // LOCK 1: Block completely unknown items (Forces users to use Master Inventory)
      if (!masterItem) {
        return res.status(400).json({
          success: false,
          message: `R&D Restriction: Product "${productName}" does not exist in the Master Inventory. R&D must define and approve an item before it can be purchased.`
        });
      }

      // LOCK 2: Block items meant only for internal manufacturing
      if (masterItem.purchase === false) {
        return res.status(403).json({
          success: false,
          message: `R&D Restriction: "${masterItem.name}" is marked for Internal Manufacturing only and is NOT authorized for vendor purchasing.`
        });
      }
    } catch (validationError) {
      console.warn('Error during R&D purchase validation:', validationError.message);
      return res.status(500).json({
        success: false,
        message: 'Internal error validating product against Master Inventory.'
      });
    }
    // ─────────────────────────────────────────────────────────────

    // Fabrication Master items only — Store may request several catalog
    // dimensions of the same item in one consolidated request. Resolve/
    // validate the lines and predict the aggregate order quantity (in kg or
    // whichever Mass Unit the item is purchased in) the same way Purchase's
    // own "Send RFQ" form will later recompute it.
    let resolvedFabricationLines = [];
    let resolvedQuantity = quantity;
    let resolvedUnit = unit || null;
    if (Array.isArray(fabricationDimensionLines) && fabricationDimensionLines.length > 0) {
      try {
        const resolved = await resolveFabricationLines(masterItem, fabricationDimensionLines);
        resolvedFabricationLines = resolved.lines;
        if (resolved.isMassUnit) {
          resolvedQuantity = resolved.resolvedQuantity;
          resolvedUnit = resolved.resolvedUnit;
        } else {
          // Non-Mass-Unit purchase unit (e.g. Pieces, Meter) — there's no
          // sound way to auto-total mixed dimensions, so fall back to the
          // sum of requested pieces as a provisional placeholder. Purchase
          // must review/replace this in the "Send RFQ" form before sending.
          resolvedQuantity = resolvedFabricationLines.reduce((sum, l) => sum + l.quantity, 0);
          resolvedUnit = masterItem.purchaseUnit || masterItem.unit || unit || null;
        }
      } catch (dimErr) {
        return res.status(400).json({ success: false, message: dimErr.message });
      }
    }

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';

    // Determine source: explicit source field, or infer from role
    const resolvedSource = source || (isStoreUser ? 'Store' : 'Production');

    // Store-originated requests go directly to Purchase (storeApproved=true)
    // Production/QC-originated requests need Store approval first (storeApproved=false)
    const resolvedStoreApproved = resolvedSource === 'Store';

    // Several sizes ticked → one request per size (2026-10-09, see
    // splitFabricationLinesPerSize). Each size is ordered on its own on RFQ/PO.
    if (resolvedFabricationLines.length > 1 || new Set(resolvedFabricationLines.map(l => dimensionSignature(l.values))).size > 1) {
      let perSize;
      try {
        perSize = await splitFabricationLinesPerSize(masterItem, resolvedFabricationLines, { fallbackUnit: unit });
      } catch (dimErr) {
        return res.status(400).json({ success: false, message: dimErr.message });
      }
      const created = [];
      for (const size of perSize) {
        created.push(await PurchaseRequest.create({
          requestId: await generateUniqueRequestId(),
          productName,
          quantity: size.quantity,
          requestFromDepartment: isStoreUser ? 'Store' : (requestFromDepartment || 'Production'),
          priority: priority || 'Medium',
          companyId,
          storeOrderId,
          itemId,
          source: resolvedSource,
          storeApproved: resolvedStoreApproved,
          unit: size.unit,
          materialCode: materialCode || null,
          fabricationDimensionLines: size.lines,
        }));
      }
      res.status(201).json({
        success: true,
        data: created[0],
        requests: created,
        message: `Raised ${created.length} purchase requests — one per size (${created.map(r => r.requestId).join(', ')}).`,
      });
      for (const r of created) {
        try {
          await notificationService.triggerStoreNotification({
            action: 'purchase_request_created',
            data: { requestId: r.requestId, productName: r.productName, priority: r.priority },
            targetCompanyId: companyId,
          });
        } catch (e) {
          console.error('Purchase request notification error:', e);
        }
      }
      return;
    }

    // Generate Request ID globally to prevent unique index duplicates across companies
    const requestId = await generateUniqueRequestId();

    const newRequest = await PurchaseRequest.create({
      requestId,
      productName,
      quantity: resolvedQuantity,
      requestFromDepartment: isStoreUser ? 'Store' : (requestFromDepartment || 'Production'),
      priority: priority || 'Medium',
      companyId,
      storeOrderId,
      itemId,
      source: resolvedSource,
      storeApproved: resolvedStoreApproved,
      unit: resolvedUnit,
      materialCode: materialCode || null,
      fabricationDimensionLines: resolvedFabricationLines
    });

    res.status(201).json({ success: true, data: newRequest });

    // 🔔 Notify Accounts about new purchase request
    try {
      await notificationService.triggerStoreNotification({
        action: 'purchase_request_created',
        data: { requestId: newRequest.requestId, productName: newRequest.productName, priority: newRequest.priority },
        targetCompanyId: companyId,
      });
    } catch (e) {
      console.error('Purchase request notification error:', e);
    }

  } catch (error) {
    console.error('Error creating purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/purchase-requests/preview-fabrication-total
// Shared, no-persist preview of resolveFabricationLines — used by Store's
// multi-dimension request dialog and Purchase's "Send RFQ" edit form so both
// always show the exact weight/quantity total that will actually be saved.
export const previewFabricationTotal = async (req, res) => {
  try {
    const { itemId, materialCode, productName, lines, allowNonCatalogDimensions } = req.body;
    const companyId = req.user.companyId;

    // materialCode isn't always a real catalog code any more — an order-form-
    // raised fabrication request stores a "{code}#{dimensionVariantId}"
    // composite there instead (see materialAvailabilityService.js's
    // raiseFabricationPurchaseRequest), needed so its partial unique index
    // can dedupe per dimension rather than per item. itemId already carries
    // the real code for those, but falling back to productName too (same
    // fallback editFabricationLines/createPurchaseRequest already use) keeps
    // this endpoint resolving correctly regardless of which id field a
    // future caller happens to send.
    const searchCriteria = [];
    if (materialCode) searchCriteria.push({ code: materialCode });
    if (itemId) {
      searchCriteria.push({ code: itemId });
      if (/^[0-9a-fA-F]{24}$/.test(itemId)) searchCriteria.push({ _id: itemId });
    }
    if (productName) searchCriteria.push({ name: { $regex: new RegExp(`^${productName.trim()}$`, 'i') } });
    if (searchCriteria.length === 0) {
      return res.status(400).json({ success: false, message: 'itemId, materialCode, or productName is required' });
    }

    const masterItem = await Item.findOne({ companyId, $or: searchCriteria });
    if (!masterItem) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const resolved = await resolveFabricationLines(masterItem, lines, { requireCatalogMatch: !allowNonCatalogDimensions });
    res.json({
      success: true,
      data: {
        lines: resolved.lines,
        totalWeightKg: resolved.totalWeightKg,
        isMassUnit: resolved.isMassUnit,
        resolvedQuantity: resolved.resolvedQuantity,
        resolvedUnit: resolved.resolvedUnit,
        purchaseUnit: masterItem.purchaseUnit || null,
        purchaseUnitType: masterItem.purchaseUnitType || null,
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Failed to compute preview' });
  }
};

// PATCH /api/purchase-requests/:id/fabrication-lines
// Purchase-dept-only: lets Purchase re-target which catalog dimensions/
// quantities make up a still-Pending fabrication request, and finalize the
// aggregate order quantity, before it's sent as an RFQ. This is the "same
// editable form" the Send RFQ dialog PATCHes right before calling
// rfqController.js's createRFQ, which independently checks for an existing
// RFQ the same way this endpoint's lock-check does (so a race between two
// Purchase users can't double-send).
export const editFabricationLines = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const { lines, quantity, unit } = req.body;

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Purchase/Accounts users can edit a request here.' });
    }

    const request = await PurchaseRequest.findOne({ _id: id, companyId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' });
    }
    if (!request.fabricationDimensionLines || request.fabricationDimensionLines.length === 0) {
      return res.status(400).json({ success: false, message: 'This request has no fabrication dimensions to edit.' });
    }
    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Only a Pending request can still be edited.' });
    }
    // One size per request (2026-10-09) — see splitFabricationLinesPerSize.
    if (new Set((Array.isArray(lines) ? lines : []).map(l => dimensionSignature(l?.values))).size > 1) {
      return res.status(400).json({ success: false, message: 'A request covers one size — raise another request for another size.' });
    }
    // Locks once this PR has been quoted, by either path — the legacy RFQ
    // flow (still live) or the original direct-quote flow (VendorBid.
    // purchaseRequest set with no RFQ parent).
    const existingRFQ = await RFQ.findOne({ purchaseRequest: id, companyId });
    if (existingRFQ) {
      return res.status(400).json({ success: false, message: `An RFQ (${existingRFQ.rfqNo}) already exists for this request — it can no longer be edited here.` });
    }
    const existingQuote = await VendorBid.findOne({ purchaseRequest: id, companyId });
    if (existingQuote) {
      return res.status(400).json({ success: false, message: 'A vendor quote already exists for this request — it can no longer be edited here.' });
    }
    // Item-wise PR consolidation (2026-10) — also locks the moment this PR
    // is merely SELECTED into an ItemQuoteGroup, even before any vendor
    // bid exists. The group's own `quantity` is a sum computed from this
    // PR's current dimension lines/quantity at selection time; silently
    // changing them here (through this older, PR-scoped endpoint) would
    // invalidate that sum with no refresh-prompt and no warning — exactly
    // the kind of change the group's own selection-change flow (By Item
    // tab) exists to gate. Covers Open (still being quoted) and Batched
    // (already ordered — must never be edited at all) alike.
    const existingGroup = await ItemQuoteGroup.findOne({ purchaseRequests: id, companyId, status: { $in: ['Open', 'Batched'] } });
    if (existingGroup) {
      return res.status(400).json({ success: false, message: 'This request is part of an active item-quote group — remove it from the group\'s selection (By Item tab) before editing its dimensions here.' });
    }

    const searchCriteria = [{ name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') } }];
    if (request.materialCode) searchCriteria.push({ code: request.materialCode });
    if (request.itemId) {
      searchCriteria.push({ code: request.itemId });
      if (/^[0-9a-fA-F]{24}$/.test(request.itemId)) searchCriteria.push({ _id: request.itemId });
    }
    const masterItem = await Item.findOne({ companyId, $or: searchCriteria });
    if (!masterItem) {
      return res.status(404).json({ success: false, message: 'Source inventory item could not be resolved.' });
    }

    let resolved;
    try {
      resolved = await resolveFabricationLines(masterItem, lines);
    } catch (dimErr) {
      return res.status(400).json({ success: false, message: dimErr.message });
    }

    request.fabricationDimensionLines = resolved.lines;

    if (Number(quantity) > 0) {
      // Purchase explicitly set/overrode the final order quantity.
      request.quantity = Number(quantity);
      request.unit = unit || resolved.resolvedUnit || masterItem.purchaseUnit || masterItem.unit || request.unit;
    } else if (resolved.isMassUnit) {
      request.quantity = resolved.resolvedQuantity;
      request.unit = resolved.resolvedUnit;
    } else {
      return res.status(400).json({
        success: false,
        message: `Enter the Order Quantity${masterItem.purchaseUnit ? ` (${masterItem.purchaseUnit})` : ''} — it can't be auto-predicted for this item's purchase unit.`
      });
    }

    await request.save();
    res.json({ success: true, data: request });
  } catch (error) {
    console.error('Error editing fabrication dimension lines:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Store approves a Production-raised demand → makes it visible to Purchase dept
export const storeApproveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    // Only Store users can approve
    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (!isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Store users can approve material demands' });
    }

    const request = await PurchaseRequest.findOne({ _id: id, companyId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.storeApproved) {
      return res.status(400).json({ success: false, message: 'Request is already approved' });
    }

    request.storeApproved = true;
    request.storeApprovedAt = new Date();
    await request.save();

    console.log(`✅ Store approved Production request ${request.requestId} → forwarded to Purchase dept`);
    res.status(200).json({ success: true, data: request, message: 'Request approved and forwarded to Purchase department' });
  } catch (error) {
    console.error('Error approving purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Store rejects a Production-raised demand
export const storeRejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const companyId = req.user.companyId;

    // Only Store users can reject
    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (!isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Store users can reject material demands' });
    }

    const request = await PurchaseRequest.findOne({ _id: id, companyId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.storeApproved) {
      return res.status(400).json({ success: false, message: 'Cannot reject an already approved request' });
    }

    if (request.status === 'Rejected') {
      return res.status(400).json({ success: false, message: 'Request is already rejected' });
    }

    request.status = 'Rejected';
    request.rejectedAt = new Date();
    request.rejectionReason = reason || 'Rejected by Store';
    await request.save();

    console.log(`❌ Store rejected Production request ${request.requestId}`);
    res.status(200).json({ success: true, data: request, message: 'Request rejected successfully' });
  } catch (error) {
    console.error('Error rejecting purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Check Inventory availability for a Purchase Request item
export const checkInventoryForPR = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const request = await PurchaseRequest.findOne({ _id: id, companyId }).lean();
    if (!request) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' });
    }

    const { productName, materialCode, quantity: requestedQty } = request;

    // Build search conditions: match by code (exact) OR name (case-insensitive partial)
    const orConditions = [];
    if (materialCode && materialCode.trim()) {
      orConditions.push({ code: { $regex: new RegExp(`^${materialCode.trim()}$`, 'i') } });
    }
    if (productName && productName.trim()) {
      orConditions.push({ name: { $regex: new RegExp(productName.trim(), 'i') } });
    }

    if (orConditions.length === 0) {
      return res.status(400).json({ success: false, message: 'No product name or material code available to search inventory' });
    }

    // Search in inventory (company-scoped)
    const matches = await Item.find({
      $and: [
        { $or: orConditions },
        { $or: [{ companyId }, { store: companyId.toString() }] }
      ]
    }).select('name code qty unit category minStock importance').lean();

    if (matches.length === 0) {
      return res.json({
        success: true,
        found: false,
        message: `No item found in inventory matching "${productName}"${materialCode ? ` or code "${materialCode}"` : ''}.`,
        items: []
      });
    }

    // Enrich each match with availability info
    const enriched = matches.map(item => {
      const available = item.qty || 0;
      const needed = requestedQty || 1;
      const isSufficient = available >= needed;
      const isLow = available > 0 && available < needed;
      const isOut = available === 0;

      return {
        _id: item._id,
        name: item.name,
        code: item.code,
        currentQty: available,
        requestedQty: needed,
        unit: item.unit || 'pcs',
        category: item.category,
        minStock: item.minStock || 0,
        importance: item.importance,
        status: isSufficient ? 'sufficient' : isLow ? 'low' : 'out_of_stock',
        statusLabel: isSufficient ? 'Sufficient Stock' : isLow ? 'Insufficient Stock' : 'Out of Stock',
        canFulfill: isSufficient
      };
    });

    const anySufficient = enriched.some(i => i.canFulfill);

    return res.json({
      success: true,
      found: true,
      canFulfill: anySufficient,
      message: anySufficient
        ? `Item found in inventory with sufficient stock.`
        : `Item found in inventory but stock is insufficient for requested quantity (${requestedQty}).`,
      items: enriched
    });
  } catch (error) {
    console.error('Error checking inventory for PR:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

const today = () => new Date().toISOString().split('T')[0];

async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({
    qcJobId: new RegExp(`^QC-${year}-`)
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// Update purchase request status
export const updatePurchaseRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Enforce that Store Head / Store Employee can only change status to "Received"
    if (req.user.role === 'Store Head' || req.user.role === 'Store Employee') {
      if (status !== 'Received') {
        return res.status(403).json({ success: false, message: 'Store users can only change status to Received' });
      }
    }

    const request = await PurchaseRequest.findById(id).populate('purchaseOrder');
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // ── Validate mandatory receive fields ──────────────────────────────────────
    if (status === 'Received' && request.status !== 'Received') {
      const serialNumber = req.body.serialNumber?.trim();
      const warrantyPeriod = req.body.warrantyPeriod;
      const warrantyCard = req.file; // uploaded via multer
      // Warranty is only asked for when the vendor actually quoted one
      // (Purchase.items[].warrantyMonths, synced onto the PR at batch time
      // — see createPurchase) — some material genuinely has none, and the
      // old behavior demanded a warranty entry on every single receive
      // regardless. 0/unset here means no warranty was ever quoted.
      const quotedWarranty = Number(request.warrantyMonths) || 0;

      const missing = [];
      if (!serialNumber) missing.push('Serial Number');
      if (quotedWarranty > 0) {
        // 0 is a valid warranty (no warranty) — only missing/negative is invalid
        if (warrantyPeriod === undefined || warrantyPeriod === '' || Number(warrantyPeriod) < 0) missing.push('Warranty Period (months)');
        // Warranty Card is required only when there IS a warranty (> 0 months)
        if (Number(warrantyPeriod) > 0 && !warrantyCard) missing.push('Warranty Card (image or PDF)');
      }

      if (missing.length > 0) {
        // If multer already saved a file but other fields are missing, clean it up
        if (warrantyCard) {
          try { fs.unlinkSync(warrantyCard.path); } catch (_) { }
        }
        return res.status(400).json({
          success: false,
          message: `Cannot mark as Received. The following are required: ${missing.join(', ')}`
        });
      }

      // ── Unit conversion: order was placed in a purchase unit, Store must
      // convert the received qty back to the item's Receive Unit — Item.qty's
      // stock-counting unit. For non-fabrication items Receive Unit is
      // enforced equal to Used Unit (sanitizeItemData), so this conversion
      // target is the same value either way; it's only a distinct unit from
      // Used Unit for fabrication items, which don't go through this generic
      // path (see receiveFabricationPurchase instead). ─────────────────────
      // Skip entirely when the Purchase Unit already IS the item's real
      // stock unit — no conversion needed, don't force Store to type a
      // factor of "1". Previously this block fired on purchaseUnit/
      // purchaseQuantity being merely truthy, never checking equality.
      // Resolves the master Item the same way resolveMasterItemId already
      // does elsewhere (purchaseQuoteController.js) rather than trusting
      // request.unit, whose own meaning varies across PR-creation paths —
      // see getPurchaseRequests' own master-item lookup for the same reason.
      let sameUnitAsStock = false;
      if (request.purchaseUnit) {
        const masterItemId = await resolveMasterItemId(request, request.companyId);
        const masterItem = masterItemId ? await Item.findById(masterItemId).select('unit').lean() : null;
        if (masterItem?.unit && masterItem.unit.trim().toLowerCase() === request.purchaseUnit.trim().toLowerCase()) {
          sameUnitAsStock = true;
        }
      }

      if (request.purchaseUnit && request.purchaseQuantity && !sameUnitAsStock) {
        const receivedQuantity = Number(req.body.receivedQuantity);
        const conversionFactor = Number(req.body.conversionFactor); // purchaseUnit per 1 base unit

        if (!(receivedQuantity > 0) || !(conversionFactor > 0)) {
          if (warrantyCard) {
            try { fs.unlinkSync(warrantyCard.path); } catch (_) { }
          }
          return res.status(400).json({
            success: false,
            message: `Cannot mark as Received. Unit conversion is required: enter the Received Quantity (in ${request.purchaseUnit}) and how many ${request.purchaseUnit} equal 1 storage unit.`
          });
        }

        request.receivedQuantity = receivedQuantity;
        request.conversionFactor = conversionFactor;
        request.convertedQuantity = Math.round((receivedQuantity / conversionFactor) * 1000) / 1000;
      } else if (request.purchaseUnit && request.purchaseQuantity && sameUnitAsStock) {
        // Units already match — 1:1, nothing to convert.
        request.receivedQuantity = request.purchaseQuantity;
        request.conversionFactor = 1;
        request.convertedQuantity = request.purchaseQuantity;
      }

      // Save receive-specific data on the purchase request
      request.serialNumber = serialNumber;
      // No warranty was ever quoted (quotedWarranty === 0) → nothing was
      // required/sent above, store 0 rather than NaN from an empty field.
      request.warrantyPeriod = quotedWarranty > 0 ? Number(warrantyPeriod) : 0;
      if (warrantyCard) request.warrantyCardUrl = `/uploads/warranty-cards/${warrantyCard.filename}`;
      request.receivedAt = new Date();
    }
    // ──────────────────────────────────────────────────────────────────────────

    const oldStatus = request.status;
    request.status = status;
    await request.save();

    // 🔔 Notify Store team about status change
    if (oldStatus !== status) {
      try {
        await notificationService.triggerStoreNotification({
          action: 'purchase_request_status_changed',
          data: {
            requestId: request.requestId,
            productName: request.productName,
            newStatus: status,
            oldStatus,
            remarks: `Status updated from ${oldStatus} to ${status}`,
          },
          targetCompanyId: request.companyId,
        });
      } catch (e) { console.error('PR status change store notification error:', e); }
    }

    // Trigger QC Job & Purchase Invoice creation on 'Received' status transition
    if (status === 'Received' && oldStatus !== 'Received') {
      await applyReceiveSideEffects(request, req);
      await logRequestReceived(request, req, `${request.receivedQuantity ?? request.quantity} ${request.purchaseUnit || request.unit || ''}`.trim());
    }

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('Error updating purchase request:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Audit log (gap 17) for the older one-request-at-a-time receive screens:
// finds the request's PO line and logs it like a line receive.
async function logRequestReceived(request, req, text) {
  try {
    const poId = request.purchaseOrder?._id || request.purchaseOrder;
    if (!poId) return;
    const Purchase = (await import('../models/Purchase.js')).default;
    const po = await Purchase.findById(poId);
    if (!po) return;
    const line = (po.items || []).find(l => (l.purchaseRequests?.length ? l.purchaseRequests : [l.purchaseRequest]).some(id => String(id) === String(request._id)));
    if (!line) return;
    await logLineReceived({ po, line, user: req.user, req, text: `${text} (request ${request.requestId})` });
  } catch (err) {
    console.error('Purchase audit log (request receive) failed:', err.message);
  }
}

// PATCH /api/purchase-requests/:id/receive-fabrication
// Store-only: records the actual per-dimension breakdown of a fabrication
// purchase as it's received — separate from updatePurchaseRequestStatus
// since a fabrication receive needs none of that endpoint's Serial
// Number/Warranty/single-conversion-factor fields (raw material sheets/pipes
// don't have serial numbers), and needs its own dimension-line validation.
//
// Stock (dimensionVariants[].subStock) is NOT credited here — same QC gate
// every other material already goes through (qcController.js's
// submitDecision, on a Pass). Pricing (weightUnitPrice/purchaseCost) DOES
// update here, same timing as every other item — see the conversionFactor
// comment below.
export const receiveFabricationPurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const { lines } = req.body;

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (!isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Store users can receive a purchase.' });
    }

    const request = await PurchaseRequest.findOne({ _id: id, companyId }).populate('purchaseOrder');
    if (!request) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' });
    }
    if (!request.fabricationDimensionLines?.length) {
      return res.status(400).json({ success: false, message: 'This request has no fabrication dimensions — use the standard Mark Received flow.' });
    }
    if (request.status !== 'Ordered') {
      return res.status(400).json({ success: false, message: 'Only an Ordered request can be received.' });
    }

    const searchCriteria = [{ name: { $regex: new RegExp(`^${request.productName.trim()}$`, 'i') } }];
    if (request.materialCode) searchCriteria.push({ code: request.materialCode });
    if (request.itemId) {
      searchCriteria.push({ code: request.itemId });
      if (/^[0-9a-fA-F]{24}$/.test(request.itemId)) searchCriteria.push({ _id: request.itemId });
    }
    const masterItem = await Item.findOne({ companyId, $or: searchCriteria });
    if (!masterItem) {
      return res.status(404).json({ success: false, message: 'Source inventory item could not be resolved.' });
    }

    // Store may have received a size the vendor shipped that isn't in the
    // catalog at all — still weight-computable, not rejected here (see
    // qcController.js's Pass handling, which flags such a line isLeftover
    // when crediting stock rather than blocking the receive outright).
    let resolved;
    try {
      resolved = await resolveFabricationLines(masterItem, lines, { requireCatalogMatch: false });
    } catch (dimErr) {
      return res.status(400).json({ success: false, message: dimErr.message });
    }

    const totalPieces = resolved.lines.reduce((sum, l) => sum + l.quantity, 0);
    const totalWeightKg = resolved.totalWeightKg;

    request.receivedFabricationLines = resolved.lines;
    request.status = 'Received';
    request.receivedAt = new Date();
    // Feeds the existing purchase-to-base conversion pipeline
    // (itemPricingService.js's findPurchaseToBaseFactor/resolvePurchaseItemCost)
    // exactly the way a normal Purchase-Unit item's Store-entered
    // conversionFactor already does — here it's the weighted-average kg per
    // piece across everything actually received, since a fabrication item's
    // pieces don't all weigh the same. cost = rawPurchaseUnitPrice(₹/kg) ×
    // conversionFactor(kg/pc) = ₹/pc, computed below via recalculateItemPricing.
    request.receivedQuantity = totalWeightKg;
    request.conversionFactor = totalPieces > 0 ? Math.round((totalWeightKg / totalPieces) * 1000000) / 1000000 : null;
    await request.save();

    await applyFabricationReceiveSideEffects(request, masterItem, req, { quantityOverride: totalPieces });
    await logRequestReceived(request, req, `${totalPieces} pcs`);

    res.status(200).json({ success: true, data: request });
  } catch (error) {
    console.error('Error receiving fabrication purchase:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/purchase-requests/:id/batch-siblings (2026-10) — read-only
// context panel for the receive modal: if this PR is one of several items
// batched into the same PO, lists the PO's other items (status, expected
// date, received date) so Store can see the whole batch before receiving
// just this one. Each item is still received individually through the
// normal per-PR flow (updatePurchaseRequestStatus/receiveFabricationPurchase,
// both untouched) — this is pure visibility, not a bulk-receive endpoint,
// so nothing about QC's own purely-per-PR scoping is affected.
export const getBatchSiblings = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const request = await PurchaseRequest.findOne({ _id: id, companyId }).populate({
      path: 'purchaseOrder',
      select: 'purchaseOrderNumber items',
      populate: [
        { path: 'items.purchaseRequest', select: 'requestId productName status receivedAt' },
        { path: 'items.purchaseRequests', select: 'requestId productName status receivedAt' },
      ],
    });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' });
    }
    if (!request.purchaseOrder) {
      return res.json({ success: true, data: { poNumber: null, items: [] } });
    }

    // Item-wise PR consolidation (2026-10) — flattened to one entry per PR,
    // not per line: a line can now carry several PRs at once, and this
    // panel's whole point is showing every OTHER request in the same
    // batch, including ones sharing the current PR's own line (not only
    // PRs on other lines, which is all the earlier version showed).
    // `quantity` is the LINE's combined total, not this one PR's own share
    // of it — flagged `combinedQuantity` whenever more than one PR shares
    // it, so the frontend doesn't attribute the whole number to one PR.
    const items = [];
    for (const it of request.purchaseOrder.items || []) {
      const prRefs = it.purchaseRequests?.length ? it.purchaseRequests : (it.purchaseRequest ? [it.purchaseRequest] : []);
      for (const prRef of prRefs) {
        if (!prRef) continue;
        items.push({
          requestId: prRef.requestId,
          productName: prRef.productName,
          quantity: it.quantity,
          combinedQuantity: prRefs.length > 1,
          status: prRef.status,
          receivedAt: prRef.receivedAt,
          expectedDeliveryDate: it.expectedDeliveryDate,
          isCurrent: String(prRef._id) === String(id),
        });
      }
    }

    res.json({ success: true, data: { poNumber: request.purchaseOrder.purchaseOrderNumber, items } });
  } catch (error) {
    console.error('getBatchSiblings error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/purchase-requests/orders — Store's own way to list POs (2026-10).
// GET /api/accounts/purchases/orders is gated to Accounts-only roles and
// Store can't reach it; rather than widen that Accounts-specific router's
// role list, this is a thin pass-through to the same already-exported
// getPurchases, mounted under Store's own existing permission domain
// (purchasesView below). No logic duplicated — same controller, same
// response shape ByVendorTab.jsx's PurchaseOrderList already consumes.
export const getPurchaseOrdersForStore = async (req, res) => {
  const { getPurchases } = await import('./purchaseController.js');
  // Store only ever sees real orders — never a PO still waiting for (or
  // refused) Company Admin approval (procurement-v2), whatever status
  // filter is asked for.
  const STORE_STATUSES = ['Draft', 'Sent', 'Acknowledged', 'Partially Received', 'Received', 'Cancelled'];
  const asked = req.query.status ? String(req.query.status).split(',').map(s => s.trim()) : STORE_STATUSES;
  const allowed = asked.filter(s => STORE_STATUSES.includes(s));
  req.query.status = (allowed.length ? allowed : STORE_STATUSES).join(',');
  return getPurchases(req, res);
};

// PATCH /api/purchase-requests/orders/:purchaseId/lines/:lineId/receive
// Store's real unit of receiving (2026-10): one PO *line* at a time, not one
// PurchaseRequest at a time. A vendor shipment arrives as one physical
// chunk — several PRs can share one line since the item-wise PR
// consolidation redesign (Eighteenth pass), and there's no way to say which
// part of a combined shipment belongs to which PR. Submitting this collects
// Serial Number/Warranty ONCE for the whole line and loops every PR still
// open on it through applyReceiveSideEffects — the exact same per-PR side
// effects updatePurchaseRequestStatus already uses — just fed a
// proportionally attributed share of the combined received quantity
// (by that PR's own ordered quantity as a fraction of the line's total)
// instead of a number Store typed in directly for it. QCJob stays 1:1 per
// PR, untouched: each PR's own job only ever claims its own attributed
// share, so QC Pass can't double-credit stock for one physical receipt.
// Pricing recalculation is hoisted outside the loop (see
// applyReceiveSideEffects's own comment on why).
export const receiveLineItems = async (req, res) => {
  try {
    const { purchaseId, lineId } = req.params;
    const companyId = req.user.companyId;

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (!isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Store users can receive a purchase.' });
    }

    const Purchase = (await import('../models/Purchase.js')).default;
    const purchase = await Purchase.findOne({ _id: purchaseId, companyId });
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    const line = purchase.items.id(lineId);
    if (!line) {
      return res.status(404).json({ success: false, message: 'Line not found on this purchase order' });
    }
    // Cancelled (gap 13, 2026-10-09): nothing more can be received on it.
    if (purchase.status === 'Cancelled' || line.cancelled?.at) {
      return res.status(409).json({ success: false, message: purchase.status === 'Cancelled' ? 'This PO is cancelled — nothing can be received on it.' : 'This line was cancelled (short close) — it can\'t be received.' });
    }

    const prIds = prIdsOf(line);
    if (!prIds.length) {
      return res.status(400).json({ success: false, message: 'This line has no linked purchase requests to receive.' });
    }

    const allPrs = await PurchaseRequest.find({ _id: { $in: prIds } }).populate('purchaseOrder');
    const prs = allPrs.filter(pr => pr.status !== 'Received');
    if (!prs.length) {
      return res.status(400).json({ success: false, message: 'Every purchase request on this line is already Received.' });
    }
    if (prs.some(pr => pr.fabricationDimensionLines?.length > 0)) {
      return res.status(400).json({ success: false, message: 'This line has fabrication items — use the fabrication receive flow.' });
    }

    // ── Validate mandatory receive fields, once for the whole line ────────────
    const serialNumber = req.body.serialNumber?.trim();
    const warrantyPeriod = req.body.warrantyPeriod;
    const warrantyCard = req.file; // uploaded via multer
    // Every PR on a line was synced the same warrantyMonths at batch time
    // (createPurchase/updatePurchase's PR-sync loop) — any one of them is
    // representative of the whole line's quote.
    const quotedWarranty = Number(prs[0].warrantyMonths) || 0;

    const missing = [];
    if (!serialNumber) missing.push('Serial Number');
    if (quotedWarranty > 0) {
      if (warrantyPeriod === undefined || warrantyPeriod === '' || Number(warrantyPeriod) < 0) missing.push('Warranty Period (months)');
      if (Number(warrantyPeriod) > 0 && !warrantyCard) missing.push('Warranty Card (image or PDF)');
    }
    if (missing.length > 0) {
      if (warrantyCard) { try { fs.unlinkSync(warrantyCard.path); } catch (_) { } }
      return res.status(400).json({
        success: false,
        message: `Cannot mark as Received. The following are required: ${missing.join(', ')}`
      });
    }

    const samplePr = prs[0];
    let sameUnitAsStock = false;
    if (samplePr.purchaseUnit) {
      const masterItemId = await resolveMasterItemId(samplePr, companyId);
      const masterItemForUnit = masterItemId ? await Item.findById(masterItemId).select('unit').lean() : null;
      if (masterItemForUnit?.unit && masterItemForUnit.unit.trim().toLowerCase() === samplePr.purchaseUnit.trim().toLowerCase()) {
        sameUnitAsStock = true;
      }
    }

    const totalOrdered = prs.reduce((sum, pr) => sum + (Number(pr.purchaseQuantity) || Number(pr.quantity) || 0), 0);

    let combinedReceivedQuantity = null;
    let conversionFactor = null;
    if (samplePr.purchaseUnit && samplePr.purchaseQuantity && !sameUnitAsStock) {
      combinedReceivedQuantity = Number(req.body.receivedQuantity);
      conversionFactor = Number(req.body.conversionFactor);
      if (!(combinedReceivedQuantity > 0) || !(conversionFactor > 0)) {
        if (warrantyCard) { try { fs.unlinkSync(warrantyCard.path); } catch (_) { } }
        return res.status(400).json({
          success: false,
          message: `Cannot mark as Received. Unit conversion is required: enter the Received Quantity (in ${samplePr.purchaseUnit}) and how many ${samplePr.purchaseUnit} equal 1 storage unit.`
        });
      }
    } else if (samplePr.purchaseUnit && samplePr.purchaseQuantity && sameUnitAsStock) {
      // Units already match — 1:1, nothing to convert.
      combinedReceivedQuantity = totalOrdered;
      conversionFactor = 1;
    }

    const warrantyCardUrl = warrantyCard ? `/uploads/warranty-cards/${warrantyCard.filename}` : null;
    const resolvedWarrantyPeriod = quotedWarranty > 0 ? Number(warrantyPeriod) : 0;

    for (const pr of prs) {
      const ownOrdered = Number(pr.purchaseQuantity) || Number(pr.quantity) || 0;
      const share = totalOrdered > 0 ? ownOrdered / totalOrdered : 1 / prs.length;

      pr.serialNumber = serialNumber;
      pr.warrantyPeriod = resolvedWarrantyPeriod;
      if (warrantyCardUrl) pr.warrantyCardUrl = warrantyCardUrl;
      if (combinedReceivedQuantity != null && conversionFactor != null) {
        pr.receivedQuantity = Math.round(combinedReceivedQuantity * share * 1000) / 1000;
        pr.conversionFactor = conversionFactor;
        pr.convertedQuantity = Math.round((pr.receivedQuantity / conversionFactor) * 1000) / 1000;
      }
      pr.receivedAt = new Date();
      pr.status = 'Received';
      await pr.save();

      await applyReceiveSideEffects(pr, req, { skipPricingRecalc: true });
    }

    // Pricing recalculated once for the whole line, not once per PR — see
    // applyReceiveSideEffects's own comment on why this is hoisted out.
    try {
      const { recalculateItemPricing } = await import('../services/itemPricingService.js');
      const storeStr = companyId.toString();
      let pricingItem = null;
      if (samplePr.itemId && /^[0-9a-fA-F]{24}$/.test(samplePr.itemId)) {
        pricingItem = await Item.findById(samplePr.itemId);
      }
      if (!pricingItem) {
        pricingItem = await Item.findOne({
          name: { $regex: new RegExp(`^${samplePr.productName.trim()}$`, 'i') },
          store: storeStr
        });
      }
      if (pricingItem && pricingItem.purchase && !pricingItem.internalManufacturing) {
        await recalculateItemPricing(pricingItem, { knownConversionFactor: conversionFactor });
        console.log(`💰 [Purchase Receipt] Pricing re-resolved once for line receive, "${pricingItem.code}"`);
      }
    } catch (pricingErr) {
      console.error('❌ Error recalculating item pricing on line receipt:', pricingErr);
    }

    // Audit log (gap 17).
    await logLineReceived({ po: purchase, line, user: req.user, req, text: combinedReceivedQuantity != null ? `${combinedReceivedQuantity} ${samplePr.purchaseUnit || ''}`.trim() : `${totalOrdered} ${samplePr.unit || ''}`.trim() });
    res.status(200).json({ success: true, data: { received: prs.map(pr => pr._id) } });
  } catch (error) {
    console.error('Error receiving purchase line:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// PATCH /api/purchase-requests/orders/:purchaseId/lines/:lineId/receive-fabrication
// Fabrication sibling of receiveLineItems above — same one-receive-per-line
// principle, adapted for dimension lines instead of a flat quantity. The
// frontend pre-fills `lines` as the union of every bundled PR's own
// fabricationDimensionLines (summed where two PRs request the identical
// dimensions); Store can still add anything unanticipated via the existing
// "+ Received a different size" flow. Each PR gets its own proportionally
// attributed share of the combined piece count (by its own originally
// requested piece count as a fraction of the line's total) for its own
// QCJob — same reasoning as receiveLineItems: QCJob stays 1:1 per PR so QC
// Pass can't double-credit stock for one physical receipt.
export const receiveLineFabrication = async (req, res) => {
  try {
    const { purchaseId, lineId } = req.params;
    const companyId = req.user.companyId;
    const { lines } = req.body;

    const isStoreUser = req.user.role === 'Store Head' || req.user.role === 'Store Employee';
    if (!isStoreUser) {
      return res.status(403).json({ success: false, message: 'Only Store users can receive a purchase.' });
    }

    const Purchase = (await import('../models/Purchase.js')).default;
    const purchase = await Purchase.findOne({ _id: purchaseId, companyId });
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase order not found' });
    }
    const line = purchase.items.id(lineId);
    if (!line) {
      return res.status(404).json({ success: false, message: 'Line not found on this purchase order' });
    }
    // Cancelled (gap 13, 2026-10-09): nothing more can be received on it.
    if (purchase.status === 'Cancelled' || line.cancelled?.at) {
      return res.status(409).json({ success: false, message: purchase.status === 'Cancelled' ? 'This PO is cancelled — nothing can be received on it.' : 'This line was cancelled (short close) — it can\'t be received.' });
    }

    const prIds = prIdsOf(line);
    if (!prIds.length) {
      return res.status(400).json({ success: false, message: 'This line has no linked purchase requests to receive.' });
    }

    const allPrs = await PurchaseRequest.find({ _id: { $in: prIds } }).populate('purchaseOrder');
    const prs = allPrs.filter(pr => pr.status !== 'Received');
    if (!prs.length) {
      return res.status(400).json({ success: false, message: 'Every purchase request on this line is already Received.' });
    }
    if (prs.some(pr => !pr.fabricationDimensionLines?.length)) {
      return res.status(400).json({ success: false, message: 'This line has non-fabrication items — use the standard receive flow.' });
    }

    const samplePr = prs[0];
    const searchCriteria = [{ name: { $regex: new RegExp(`^${samplePr.productName.trim()}$`, 'i') } }];
    if (samplePr.materialCode) searchCriteria.push({ code: samplePr.materialCode });
    if (samplePr.itemId) {
      searchCriteria.push({ code: samplePr.itemId });
      if (/^[0-9a-fA-F]{24}$/.test(samplePr.itemId)) searchCriteria.push({ _id: samplePr.itemId });
    }
    const masterItem = await Item.findOne({ companyId, $or: searchCriteria });
    if (!masterItem) {
      return res.status(404).json({ success: false, message: 'Source inventory item could not be resolved.' });
    }

    let resolved;
    try {
      resolved = await resolveFabricationLines(masterItem, lines, { requireCatalogMatch: false });
    } catch (dimErr) {
      return res.status(400).json({ success: false, message: dimErr.message });
    }

    const totalPieces = resolved.lines.reduce((sum, l) => sum + l.quantity, 0);
    const totalWeightKg = resolved.totalWeightKg;
    const conversionFactor = totalPieces > 0 ? Math.round((totalWeightKg / totalPieces) * 1000000) / 1000000 : null;

    const originalTotalPieces = prs.reduce((sum, pr) =>
      sum + (pr.fabricationDimensionLines || []).reduce((s, l) => s + (l.quantity || 0), 0), 0);

    for (const pr of prs) {
      const ownOriginal = (pr.fabricationDimensionLines || []).reduce((s, l) => s + (l.quantity || 0), 0);
      const share = originalTotalPieces > 0 ? ownOriginal / originalTotalPieces : 1 / prs.length;
      const ownPieces = Math.round(totalPieces * share);

      // Combined resolved lines, same for every PR on this line — a
      // reference snapshot of what the whole shipment looked like, not
      // load-bearing for stock (ownPieces, passed to the QC job below, is
      // what actually drives crediting).
      pr.receivedFabricationLines = resolved.lines;
      pr.receivedQuantity = Math.round(totalWeightKg * share * 1000) / 1000;
      pr.conversionFactor = conversionFactor;
      pr.status = 'Received';
      pr.receivedAt = new Date();
      await pr.save();

      await applyFabricationReceiveSideEffects(pr, masterItem, req, { quantityOverride: ownPieces, skipPricingRecalc: true });
    }

    try {
      const { recalculateItemPricing } = await import('../services/itemPricingService.js');
      await recalculateItemPricing(masterItem, { knownConversionFactor: conversionFactor });
    } catch (pricingErr) {
      console.error('❌ Error recalculating fabrication item pricing on line receipt:', pricingErr);
    }

    // Audit log (gap 17).
    await logLineReceived({ po: purchase, line, user: req.user, req, text: `${totalPieces} pcs` });
    res.status(200).json({ success: true, data: { received: prs.map(pr => pr._id) } });
  } catch (error) {
    console.error('Error receiving fabrication purchase line:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
