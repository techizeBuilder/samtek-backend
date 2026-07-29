import { Item } from '../models/Inventory.js';
import RDMachine from '../models/RDMachine.js';
import RDBOM from '../models/RDBOM.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import { Company } from '../models/Company.js';

// Defensive cap in addition to cycle detection, in case of a very deep
// (but non-circular) BOM tree.
const MAX_BOM_DEPTH = 15;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolves a manufacturing Item's cost by recursively walking its RDBOM.
 * Returns { cost: number|null, issue: string|null }.
 * cost === null && issue === null means "not built yet" — a normal state,
 * not an error; the caller must leave the Item's manual value untouched.
 */
export async function resolveManufacturingItemCost(item, visiting = new Set(), depth = 0) {
  if (depth > MAX_BOM_DEPTH) {
    return { cost: null, issue: `BOM depth exceeded ${MAX_BOM_DEPTH} levels (possible cycle) at item ${item.code}` };
  }
  if (visiting.has(item._id.toString())) {
    return { cost: null, issue: `Circular BOM reference detected at item ${item.code}` };
  }

  const machine = await RDMachine.findOne({ code: item.code, company: item.companyId });
  if (!machine) {
    return { cost: null, issue: `No linked RDMachine found for Item code "${item.code}"` };
  }
  if (!machine.firstBuiltAt) {
    // Machine has never completed production — R&D's manual value stands.
    return { cost: null, issue: null };
  }

  const bom = await RDBOM.findOne({ machine: machine._id, company: item.companyId });
  if (!bom || !bom.materials || bom.materials.length === 0) {
    return { cost: null, issue: `No BOM found for machine "${machine.code}"` };
  }

  visiting.add(item._id.toString());
  try {
    let total = 0;
    for (const mat of bom.materials) {
      if (mat.isDiscontinued) continue;

      const matItem = await Item.findOne({
        code: { $regex: new RegExp(`^${escapeRegex(mat.code)}$`, 'i') },
        companyId: item.companyId
      });

      if (!matItem) {
        return { cost: null, issue: `BOM material code "${mat.code}" has no matching Item — cost not recalculated` };
      }

      let lineUnitCost;
      if (matItem.internalManufacturing) {
        const sub = await resolveManufacturingItemCost(matItem, visiting, depth + 1);
        if (sub.cost == null) {
          // Fall back to the sub-part's own last-known value only if it has
          // one; otherwise the whole roll-up is incomplete.
          const fallback = matItem.stdCost || matItem.purchaseCost || 0;
          if (!(fallback > 0)) {
            return { cost: null, issue: `Sub-part "${matItem.code}": ${sub.issue || 'cost not yet available'}` };
          }
          lineUnitCost = fallback;
        } else {
          lineUnitCost = sub.cost;
        }
      } else {
        lineUnitCost = matItem.purchaseCost || matItem.stdCost || 0;
      }

      total += lineUnitCost * (mat.quantity || 0);
    }

    if (!(total > 0)) {
      return { cost: null, issue: `Computed BOM cost is zero for "${item.code}" — check linked material costs` };
    }
    return { cost: total, issue: null };
  } finally {
    visiting.delete(item._id.toString());
  }
}

/**
 * Computes a finished item's BOM material cost using each material's MRP
 * (not purchaseCost/stdCost) — used by the Sales Order Form to enforce a
 * minimum Billing Amount. Flat sum, no recursive sub-BOM walk:
 * Σ(material.mrp × qty). Returns { found: false } when there's no
 * RDMachine/BOM for this code at all — callers should skip validation
 * entirely in that case (per product requirement: no BOM = no check).
 */
export async function computeBOMMaterialsMrpCost(code, companyId) {
  const machine = await RDMachine.findOne({ code, company: companyId }).lean();
  if (!machine) return { found: false, totalCost: 0, materials: [] };

  const bom = await RDBOM.findOne({ machine: machine._id, company: companyId }).lean();
  const activeMaterials = (bom?.materials || []).filter(m => !m.isDiscontinued);
  if (activeMaterials.length === 0) return { found: false, totalCost: 0, materials: [] };

  const items = await Item.find({
    companyId,
    code: { $in: activeMaterials.map(m => new RegExp(`^${escapeRegex(m.code)}$`, 'i')) }
  }).select('code mrp').lean();
  const mrpByCode = new Map(items.map(it => [it.code.toLowerCase(), it.mrp || 0]));

  let totalCost = 0;
  const materials = activeMaterials.map(m => {
    const mrp = mrpByCode.get((m.code || '').toLowerCase()) || 0;
    const lineTotal = round2(mrp * (m.quantity || 0));
    totalCost += lineTotal;
    return { code: m.code, item: m.item, quantity: m.quantity, unit: m.unit, mrp, lineTotal };
  });

  return { found: true, totalCost: round2(totalCost), materials };
}

/**
 * Finds the purchase-unit → storage-unit conversion factor for an item's most
 * recent purchase (conversionFactor = how many purchaseUnits equal 1 base unit,
 * captured by Store at receive time). Prefers the PurchaseRequest the invoice
 * itself was auto-generated from (referenced in its notes), falling back to the
 * item's last receive. Returns null when no conversion applies.
 */
async function findPurchaseToBaseFactor(item, invoiceNotes) {
  try {
    let pr = null;
    const m = typeof invoiceNotes === 'string'
      ? invoiceNotes.match(/Purchase Request:\s*([A-Za-z0-9_-]+)/i)
      : null;
    if (m) {
      pr = await PurchaseRequest.findOne({ requestId: m[1], companyId: item.companyId })
        .select('conversionFactor').lean();
    }
    // Fall through when the invoice's PR exists but has no factor yet — that
    // happens when the recalc fires at PO-creation time, before Store enters
    // the conversion at receive. The item's last completed receive is the next
    // best source (same item, same unit pair).
    if (!(pr && pr.conversionFactor > 0) && item.receivedFromPurchaseRequest) {
      pr = await PurchaseRequest.findById(item.receivedFromPurchaseRequest)
        .select('conversionFactor').lean();
    }
    if (pr && pr.conversionFactor > 0) return pr.conversionFactor;
  } catch (e) {
    console.error('findPurchaseToBaseFactor error for item', item.code, e.message);
  }
  return null;
}

/**
 * Resolves a purchase Item's cost from the most recent PurchaseInvoice line
 * that references it. Returns { cost: number|null }.
 *
 * The invoice unitPrice is per PURCHASE unit (the vendor's bid unit, e.g. per
 * Meter / per Kg), but stdCost/purchaseCost and BOM quantities are in the
 * item's base/storage unit (e.g. Centimeter / Pieces) — so the price must go
 * through the same conversion the received quantity did.
 */
export async function resolvePurchaseItemCost(item) {
  const rows = await PurchaseInvoice.aggregate([
    { $match: { companyId: item.companyId } },
    { $unwind: '$items' },
    { $match: { 'items.item': item._id } },
    { $sort: { invoiceDate: -1, createdAt: -1 } },
    { $limit: 1 },
    { $project: { unitPrice: '$items.unitPrice', notes: 1 } }
  ]);

  const cost = rows[0]?.unitPrice;
  if (!(cost > 0)) return { cost: null };

  const factor = await findPurchaseToBaseFactor(item, rows[0].notes);
  if (factor > 0) return { cost: cost * factor };
  return { cost };
}

/**
 * Applies the Company's profit%/discount% to a resolved cost and persists
 * it onto the Item. Never overwrites a manual value when cost is unusable.
 */
export async function applyPricingToItem(item, company, cost, source) {
  if (!(cost > 0)) return false;

  if (source === 'BOM') item.stdCost = round2(cost);
  if (source === 'Purchase') item.purchaseCost = round2(cost);

  const profitPercent = company.profitPercent || 0;
  const discountPercent = company.discountPercent || 0;

  item.mrp = round2(cost + (cost * profitPercent) / 100);
  item.salePrice = round2(cost - (cost * discountPercent) / 100);
  item.costSource = source;
  item.costResolvedAt = new Date();
  item.costResolutionIssue = null;
  await item.save();
  return true;
}

/**
 * Main entry point — call this whenever a real cost data point becomes
 * available for an Item (production completed, purchase invoice recorded).
 * internalManufacturing wins over purchase when both are set.
 */
export async function recalculateItemPricing(item) {
  if (!item.internalManufacturing && !item.purchase) return { updated: false };

  const company = await Company.findById(item.companyId);
  if (!company) return { updated: false };

  if (item.internalManufacturing) {
    const { cost, issue } = await resolveManufacturingItemCost(item);
    if (cost == null) {
      if (issue && item.costResolutionIssue !== issue) {
        item.costResolutionIssue = issue;
        await item.save();
      }
      return { updated: false, issue };
    }
    const updated = await applyPricingToItem(item, company, cost, 'BOM');
    return { updated };
  }

  const { cost } = await resolvePurchaseItemCost(item);
  if (cost == null) return { updated: false };
  const updated = await applyPricingToItem(item, company, cost, 'Purchase');
  return { updated };
}

/**
 * Cheap reapply for when Company profitPercent/discountPercent changes —
 * reuses each Item's already-stored cost, no BOM walk / purchase re-query.
 */
export async function reapplyCompanyPricingFormula(companyId) {
  const company = await Company.findById(companyId);
  if (!company) return { updated: 0 };

  const profitPercent = company.profitPercent || 0;
  const discountPercent = company.discountPercent || 0;

  const items = await Item.find({
    companyId,
    costSource: { $in: ['BOM', 'Purchase'] }
  }).select('_id stdCost purchaseCost costSource');

  const ops = items
    .map((it) => {
      const cost = it.costSource === 'BOM' ? it.stdCost : it.purchaseCost;
      if (!(cost > 0)) return null;
      return {
        updateOne: {
          filter: { _id: it._id },
          update: {
            mrp: round2(cost + (cost * profitPercent) / 100),
            salePrice: round2(cost - (cost * discountPercent) / 100)
          }
        }
      };
    })
    .filter(Boolean);

  if (ops.length) await Item.bulkWrite(ops);
  return { updated: ops.length };
}
