import { Item } from '../models/Inventory.js';
import RDMachine from '../models/RDMachine.js';
import RDBOM from '../models/RDBOM.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
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
 * Resolves a purchase Item's cost from the most recent PurchaseInvoice line
 * that references it. Returns { cost: number|null }.
 */
export async function resolvePurchaseItemCost(item) {
  const rows = await PurchaseInvoice.aggregate([
    { $match: { companyId: item.companyId } },
    { $unwind: '$items' },
    { $match: { 'items.item': item._id } },
    { $sort: { invoiceDate: -1, createdAt: -1 } },
    { $limit: 1 },
    { $project: { unitPrice: '$items.unitPrice' } }
  ]);

  const cost = rows[0]?.unitPrice;
  if (!(cost > 0)) return { cost: null };
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
