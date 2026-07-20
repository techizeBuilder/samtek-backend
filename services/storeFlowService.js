import mongoose from 'mongoose';
import Sale, { ITEM_READY_STATUSES } from '../models/Sale.js';
import Order from '../models/Order.js';
import QCJob from '../models/QCJob.js';
import ProductionOrder from '../models/ProductionOrder.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import { Item } from '../models/Inventory.js';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-item Store flow service
//
// One sales Order carries N items (from the Order Form). Each Sale.items[i]
// is routed independently by Store:
//   Available                          → QC Job (per item, item qty)
//   Not Available + In-house           → Production Order (orderQuantity = qty)
//   Not Available + Purchased          → Purchase Request (qty)
// Every downstream artifact carries { saleId, saleItemId } so its outcome
// updates only that item's storeQCStatus. The sale-level fields stay as
// computed aggregates (see Sale.recomputeAggregateStoreStatus).
// ─────────────────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().split('T')[0];

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only 'Purchase Machine' items are bought from vendors; 'Manufacturing
// Machine' (and everything else) is produced in-house — same rule as the
// legacy checkInventoryForItem endpoint.
const PURCHASED_CATEGORIES = ['purchase machine'];

export async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({ qcJobId: new RegExp(`^QC-${year}-`) })
    .sort({ qcJobId: -1 }).lean();
  let nextNumber = 1;
  if (lastJob?.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    const lastNumber = parseInt(parts[2]);
    if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
  }
  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

export async function generatePurchaseRequestId() {
  let attempts = 0;
  while (attempts < 20) {
    const count = await PurchaseRequest.countDocuments({});
    const candidate = `PR${String(count + 1 + attempts).padStart(3, '0')}`;
    const exists = await PurchaseRequest.findOne({ requestId: candidate }).lean();
    if (!exists) return candidate;
    attempts++;
  }
  return `PR-${Date.now().toString().slice(-6)}`;
}

// Resolve an inventory Item for a sale item row — by ObjectId ref, code, or
// exact (case-insensitive) name, scoped to the company (legacy rows scope via
// `store` which holds the companyId as a string).
export async function resolveInventoryItem(companyId, { itemRef, code, name }) {
  const companyScope = { $or: [{ companyId }, { store: companyId.toString() }] };

  if (itemRef && mongoose.Types.ObjectId.isValid(itemRef)) {
    const byRef = await Item.findById(itemRef);
    if (byRef) return byRef;
  }
  if (code) {
    const byCode = await Item.findOne({ ...companyScope, code: String(code).trim() });
    if (byCode) return byCode;
  }
  if (name) {
    const byName = await Item.findOne({
      ...companyScope,
      name: { $regex: new RegExp(`^${escapeRegex(String(name).trim())}$`, 'i') }
    });
    if (byName) return byName;
  }
  return null;
}

// Map an inventory item's category to the Store "Product Type" label.
export function productTypeForItem(invItem) {
  if (!invItem) return 'In-house Manufactured';
  return PURCHASED_CATEGORIES.includes((invItem.category || '').toLowerCase().trim())
    ? 'Purchased (Trading Product)'
    : 'In-house Manufactured';
}

// Ensure a Sale exists for the order (Store's internal placeholder if Accounts
// hasn't invoiced yet), with sale.items built from Order.products and each
// item's itemRef backfilled. Returns the (saved) Sale document.
export async function ensureSaleForOrder(order, user) {
  let sale = await Sale.findOne({ order: order._id });
  let isNewSale = false;

  const buildItems = () => (order.products || []).map(p => ({
    productName: p.product?.name || 'Unknown Product',
    quantity: p.quantity,
    unitPrice: p.price,
    totalPrice: p.total,
    tax: 0,
    itemRef: p.product?._id || p.product || null
  }));

  if (!sale) {
    sale = new Sale({
      invoiceNumber: `TEMP-${order.orderCode}-${Date.now()}`,
      isPlaceholder: true, // internal linkage only — not a real invoice, must never surface as one
      order: order._id,
      customer: order.customer?._id || order.customer,
      items: buildItems(),
      subtotal: order.totalAmount,
      taxAmount: 0,
      totalAmount: order.totalAmount,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      unit: order.unit,
      companyId: order.companyId || user.companyId,
      createdBy: user._id,
      notes: `Auto-created from Order ${order.orderCode} for store management`,
      invoiceType: 'Kachha',
      paymentStatus: 'Pending'
    });
    await sale.save();
    isNewSale = true;
  } else {
    // Heal legacy sales: fix "Unknown Product" rows and backfill itemRef so
    // per-item routing can find the inventory item.
    let dirty = false;
    const hasUnknown = (sale.items || []).some(it => it.productName === 'Unknown Product');
    if (hasUnknown && order.products?.length) {
      sale.items = buildItems();
      dirty = true;
    } else {
      for (const it of sale.items || []) {
        if (!it.itemRef) {
          const match = (order.products || []).find(p =>
            (p.product?.name || '').toLowerCase() === (it.productName || '').toLowerCase());
          if (match) { it.itemRef = match.product?._id || match.product; dirty = true; }
        }
      }
    }
    if (dirty) await sale.save();
  }

  return { sale, isNewSale };
}

// ── Per-item automation (the old whole-order 3-case block, scoped to one item) ──
//
// decision: { productType?, isAvailableInInventory?, autoCheck? }
// With autoCheck: true the availability and product type are computed from the
// inventory item (qty on hand vs required qty; category → type).
// Mutates saleItem in place; caller saves the sale after the loop.
export async function applyStoreDecisionToItem({ sale, order, saleItem, decision, user }) {
  const orderCode = order?.orderCode || 'N/A';
  const companyId = sale.companyId;
  // Legacy-compatible per-item reference (also embedded in notes for tracing)
  const sourceRefId = `${sale.invoiceNumber || sale._id.toString()}#${saleItem._id.toString()}`;

  const invItem = await resolveInventoryItem(companyId, {
    itemRef: saleItem.itemRef,
    name: saleItem.productName
  });
  if (invItem && !saleItem.itemRef) saleItem.itemRef = invItem._id;

  // Resolve the decision
  let { productType, isAvailableInInventory } = decision || {};
  let splitSibling = null;
  if (decision?.autoCheck) {
    const neededQty = saleItem.quantity || 1;
    const availableQty = invItem?.qty || 0;
    const stockPart = Math.floor(availableQty); // machines count in whole units
    productType = productTypeForItem(invItem);

    if (availableQty >= neededQty) {
      isAvailableInInventory = 'Available';
    } else if (stockPart <= 0) {
      isAvailableInInventory = 'Not Available';
    } else {
      // ── AUTO-SPLIT ────────────────────────────────────────────────────
      // Partial stock: required qty > stock qty. Split the item into two
      // scoreboard lines — the in-stock part goes to QC now, the shortfall
      // goes to Purchase (trading) or Production (in-house). Every stage
      // downstream (QC, packaging gate, dispatch) already works per line,
      // so both halves flow independently and the order still dispatches
      // only when BOTH are ready.
      const shortfall = neededQty - stockPart;
      const unitPrice = saleItem.unitPrice || (neededQty > 0 ? (saleItem.totalPrice || 0) / neededQty : 0);
      const unitTax = neededQty > 0 ? (saleItem.tax || 0) / neededQty : 0;
      const money = (v) => Math.round(v * 100) / 100;

      // Shrink this line to the in-stock portion
      saleItem.quantity = stockPart;
      saleItem.totalPrice = money(unitPrice * stockPart);
      saleItem.tax = money(unitTax * stockPart);

      // Sibling line for the shortfall
      sale.items.push({
        productName: saleItem.productName,
        quantity: shortfall,
        unitPrice,
        totalPrice: money(unitPrice * shortfall),
        tax: money(unitTax * shortfall),
        itemRef: saleItem.itemRef || invItem?._id || null,
        productType: null,
        isAvailableInInventory: null,
        storeQCStatus: null
      });
      splitSibling = sale.items[sale.items.length - 1];

      console.log(`✂️➗ [Store/${orderCode}] Split "${saleItem.productName}" (need ${neededQty}, stock ${stockPart}): ${stockPart} from stock → QC, ${shortfall} → ${productType === 'Purchased (Trading Product)' ? 'Purchase' : 'Production'}`);

      // Route the shortfall line first (explicit decision — no recursion)
      await applyStoreDecisionToItem({
        sale,
        order,
        saleItem: splitSibling,
        decision: { productType, isAvailableInInventory: 'Not Available' },
        user
      });

      // This (shrunk) line continues down the Available path below
      isAvailableInInventory = 'Available';
    }
  }

  if (productType !== undefined) {
    saleItem.productType = productType === '' ? null : productType;
  }
  if (isAvailableInInventory !== undefined) {
    saleItem.isAvailableInInventory = isAvailableInInventory === '' ? null : isAvailableInInventory;
  }

  const itemScope = { saleId: sale._id, saleItemId: saleItem._id };
  let routed = null;

  // CASE 1: Available → deduct this item's qty, send this item to QC
  if (saleItem.isAvailableInInventory === 'Available') {
    // Cleanup this item's pending artifacts from a previous (changed) decision
    await ProductionOrder.deleteMany({ company: companyId, ...itemScope, status: 'Pending' });
    await PurchaseRequest.deleteMany({ companyId, saleItemId: saleItem._id, status: 'Pending' });

    const existingQC = await QCJob.findOne({
      source: 'Store',
      company: companyId,
      ...itemScope,
      status: { $in: ['Pending', 'In Progress'] }
    });

    // Deduct ONLY when a new QC job is actually created — re-calls on an item
    // already in QC must never deduct the stock twice.
    if (!existingQC) {
      const deductQty = saleItem.quantity || 1;
      if (invItem && invItem.qty >= deductQty) {
        invItem.qty -= deductQty;
        await invItem.save();
        console.log(`✂️ [Store/${orderCode}] Deducted ${deductQty} × ${invItem.name}. New qty: ${invItem.qty}`);
      }

      const qcJobId = await generateQCJobId();
      await QCJob.create({
        qcJobId,
        source: 'Store',
        sourceRefId,
        ...itemScope,
        orderCode,
        sourceDepartment: 'Store',
        sentBy: user.fullName || user.username || 'Store Dept',
        itemName: saleItem.productName,
        // itemCode as the inventory item's ObjectId string → QC reject can
        // restore the exact item's qty (existing lookup handles this format)
        itemCode: invItem?._id?.toString() || orderCode,
        category: invItem?.category || 'Finished Good',
        quantity: saleItem.quantity || 1,
        unit: invItem?.unit || 'pcs',
        receivedDate: today(),
        status: 'Pending',
        company: companyId,
        createdBy: user._id,
        notes: `Automatically created from Store Order ${orderCode} (item: ${saleItem.productName}). Ref: ${sourceRefId}`
      });
      console.log(`✅ [Store/${orderCode}] QC Job ${qcJobId} created for item "${saleItem.productName}"`);
    }

    saleItem.storeQCStatus = 'Goes to QC';
    routed = 'qc';
  }

  // CASE 2: Not Available + In-house → Production Order for this item
  if (saleItem.isAvailableInInventory === 'Not Available' && saleItem.productType === 'In-house Manufactured') {
    await QCJob.deleteMany({ company: companyId, ...itemScope, status: 'Pending' });
    await PurchaseRequest.deleteMany({ companyId, saleItemId: saleItem._id, status: 'Pending' });

    const existingProduction = await ProductionOrder.findOne({
      company: companyId,
      ...itemScope,
      source: 'Store',
      status: { $ne: 'Completed' }
    });

    if (!existingProduction) {
      const prodOrderId = `PROD-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      await ProductionOrder.create({
        orderId: prodOrderId,
        orderCode,
        machineCode: invItem?.code || orderCode,
        machineName: saleItem.productName,
        priority: order?.priority === 'High' ? 'Urgent' : 'Normal',
        receivedDate: today(),
        deliveryDate: today(),
        status: 'Pending',
        source: 'Store',
        ...itemScope,
        orderQuantity: saleItem.quantity || 1,
        company: companyId,
        createdBy: user._id,
        notes: `Automatically triggered from Store - Product Not Available in Inventory. Item: ${saleItem.productName} × ${saleItem.quantity || 1}. Ref: ${sourceRefId}`
      });
      console.log(`✅ [Store/${orderCode}] Production Order ${prodOrderId} created for item "${saleItem.productName}" × ${saleItem.quantity || 1}`);
    }

    saleItem.storeQCStatus = 'Goes to Production';
    routed = 'production';
  }

  // CASE 3: Not Available + Purchased → Purchase Request for this item
  if (saleItem.isAvailableInInventory === 'Not Available' && saleItem.productType === 'Purchased (Trading Product)') {
    await QCJob.deleteMany({ company: companyId, ...itemScope, status: 'Pending' });
    await ProductionOrder.deleteMany({ company: companyId, ...itemScope, status: 'Pending' });

    const existingPR = await PurchaseRequest.findOne({
      companyId,
      saleItemId: saleItem._id,
      status: { $ne: 'Rejected' }
    });

    if (!existingPR) {
      const requestId = await generatePurchaseRequestId();
      await PurchaseRequest.create({
        requestId,
        productName: saleItem.productName,
        quantity: saleItem.quantity || 1,
        requestFromDepartment: 'Store',
        priority: order?.priority || 'Medium',
        companyId,
        storeOrderId: order?._id || sale._id,
        itemId: sourceRefId,
        saleItemId: saleItem._id,
        materialCode: invItem?.code || null
      });
      console.log(`✅ [Store/${orderCode}] Purchase Request ${requestId} created for item "${saleItem.productName}" × ${saleItem.quantity || 1}`);
    }

    saleItem.storeQCStatus = 'Goes to Purchase';
    routed = 'purchase';
  }

  return { routed, invItem, splitSibling };
}

// Update ONE sale item's storeQCStatus by saleItemId and recompute the
// aggregate. Falls back to sale-level update when saleItemId is missing or
// doesn't match (legacy artifacts). Saves the sale.
export async function setSaleItemStatus(sale, saleItemId, status, extra = {}) {
  let target = null;
  if (saleItemId) target = (sale.items || []).id(saleItemId);

  if (target) {
    target.storeQCStatus = status;
    if (extra.isAvailableInInventory !== undefined) target.isAvailableInInventory = extra.isAvailableInInventory;
    sale.recomputeAggregateStoreStatus();
  } else {
    // Legacy: whole-sale update (single-item orders created before this change)
    sale.storeQCStatus = status;
    if (extra.isAvailableInInventory !== undefined) sale.isAvailableInInventory = extra.isAvailableInInventory;
  }
  await sale.save();
  return !!target;
}

// ── Order Form → Order.products + Sale.items sync ───────────────────────────
//
// The Order Form's item table is the source of truth for what the order
// actually contains. On (re)submission, rebuild Order.products from rows that
// resolve to inventory items, and rebuild the Sale scoreboard — preserving
// each surviving item's per-item flow state AND its subdocument _id so that
// already-created QC Jobs / Production Orders / Purchase Requests keep
// pointing at the right item.
export async function syncOrderItemsFromForm(order, formItems) {
  const visible = (formItems || []).filter(it =>
    !it.hiddenCharge && (Number(it.qty) || 0) > 0 && (it.itemName || '').trim()
  );
  if (!visible.length) return { synced: false };

  const resolved = [];
  for (const fi of visible) {
    const invItem = await resolveInventoryItem(order.companyId, { code: fi.mcCode, name: fi.itemName });
    const qty = Number(fi.qty) || 1;
    const lineTotal = Number(fi.quotationAmount)
      || ((Number(fi.billAmount) || 0) + (Number(fi.cashAmount) || 0))
      || Number(fi.billAmount) || 0;
    resolved.push({ fi, invItem, qty, lineTotal, unitPrice: qty > 0 ? lineTotal / qty : lineTotal });
  }

  // Order.products (product ref is required — only rows with an inventory match)
  const newProducts = resolved.filter(r => r.invItem).map(r => ({
    product: r.invItem._id,
    quantity: r.qty,
    price: r.unitPrice,
    total: r.lineTotal
  }));
  if (newProducts.length) {
    order.products = newProducts;
    await order.save();
  }

  // Sale scoreboard (only if a Sale already exists — otherwise Store creates
  // it with these items on first touch via ensureSaleForOrder)
  const sale = await Sale.findOne({ order: order._id });
  if (sale) {
    const oldItems = sale.items || [];
    const usedOldIds = new Set();
    const newItems = [];

    for (const r of resolved) {
      const matches = oldItems.filter(o => {
        if (usedOldIds.has(o._id.toString())) return false;
        if (r.invItem && o.itemRef && o.itemRef.toString() === r.invItem._id.toString()) return true;
        return (o.productName || '').trim().toLowerCase() === (r.fi.itemName || '').trim().toLowerCase();
      });

      // AUTO-SPLIT survival: one form row may map to MULTIPLE scoreboard
      // lines (stock part + procure part). If their total qty still equals
      // the form row's qty, keep the split lines untouched so their linked
      // QC Jobs / Purchase Requests / Production Orders stay valid.
      if (matches.length > 1) {
        const totalQty = matches.reduce((s, m) => s + (m.quantity || 0), 0);
        if (totalQty === r.qty) {
          for (const m of matches) {
            usedOldIds.add(m._id.toString());
            newItems.push({
              _id: m._id,
              productName: m.productName,
              quantity: m.quantity,
              unitPrice: m.unitPrice,
              totalPrice: m.totalPrice,
              tax: m.tax,
              itemRef: m.itemRef || r.invItem?._id || null,
              productType: m.productType ?? null,
              isAvailableInInventory: m.isAvailableInInventory ?? null,
              storeQCStatus: m.storeQCStatus ?? null
            });
          }
          continue;
        }
        // Qty changed on the form → collapse back to one fresh line (Store
        // will re-check it; stale pending artifacts get cleaned up on route)
      }

      const old = matches[0];
      if (old) usedOldIds.add(old._id.toString());

      const next = {
        productName: r.fi.itemName.trim(),
        quantity: r.qty,
        unitPrice: r.unitPrice,
        totalPrice: r.lineTotal,
        tax: Number(r.fi.gstAmount) || 0,
        itemRef: r.invItem?._id || old?.itemRef || null,
        productType: old?.productType ?? null,
        isAvailableInInventory: old?.isAvailableInInventory ?? null,
        storeQCStatus: old?.storeQCStatus ?? null
      };
      // Keep saleItemId links alive across resubmits — but only when qty is
      // unchanged; a qty change means the linked artifacts no longer describe
      // the row, so reset its flow state for a fresh Store check.
      if (old && (old.quantity || 0) !== r.qty) {
        next.productType = null;
        next.isAvailableInInventory = null;
        next.storeQCStatus = null;
      }
      if (old) next._id = old._id;
      newItems.push(next);
    }

    sale.items = newItems;
    sale.recomputeAggregateStoreStatus();
    await sale.save();
    console.log(`🔄 [OrderForm Sync] Sale ${sale._id} items rebuilt for Order ${order.orderCode} (${sale.items.length} items)`);
  }

  return { synced: true, itemCount: resolved.length, matched: newProducts.length };
}

// ── Order readiness (packaging & dispatch gate) ─────────────────────────────
//
// An order is "fully ready" when every item (qty > 0) of its Sale scoreboard
// has storeQCStatus in ITEM_READY_STATUSES. Legacy sales (no per-item state)
// fall back to the sale-level status so old single-item orders keep flowing.
export async function getOrderItemsReadiness(orderCode, companyId) {
  const result = {
    found: false,
    orderCode,
    allReady: false,
    readyCount: 0,
    totalCount: 0,
    items: [],
    sale: null,
    order: null
  };
  if (!orderCode) return result;

  const order = await Order.findOne({ orderCode, companyId }).select('_id orderCode').lean();
  if (!order) return result;
  result.order = order;

  // The scoreboard lives on the Sale the Store flow uses. Prefer a sale with
  // per-item state, then the placeholder, then any.
  const sales = await Sale.find({ order: order._id, companyId }).sort({ createdAt: 1 });
  if (!sales.length) return result;
  const sale =
    sales.find(s => (s.items || []).some(it => it.storeQCStatus)) ||
    sales.find(s => s.isPlaceholder) ||
    sales[0];
  result.sale = sale;
  result.found = true;

  const perItem = sale.hasPerItemFlow();
  if (perItem) {
    const items = (sale.items || []).filter(it => (it.quantity || 0) > 0);
    result.items = items.map(it => ({
      saleItemId: it._id,
      name: it.productName,
      qty: it.quantity,
      status: it.storeQCStatus || 'Not Processed',
      ready: ITEM_READY_STATUSES.includes(it.storeQCStatus)
    }));
  } else {
    // Legacy single-status sale — treat the whole order as one line
    const ready = ITEM_READY_STATUSES.includes(sale.storeQCStatus);
    result.items = (sale.items || []).map(it => ({
      saleItemId: it._id,
      name: it.productName,
      qty: it.quantity,
      status: sale.storeQCStatus || 'Not Processed',
      ready
    }));
    if (!result.items.length) {
      result.items = [{ saleItemId: null, name: 'Order', qty: 1, status: sale.storeQCStatus || 'Not Processed', ready }];
    }
  }

  result.totalCount = result.items.length;
  result.readyCount = result.items.filter(i => i.ready).length;
  result.allReady = result.totalCount > 0 && result.readyCount === result.totalCount;
  return result;
}
