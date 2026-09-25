import { Item } from '../models/Inventory.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';

// Defensive cap in addition to cycle detection, in case of a very deep
// (but non-circular) BOM tree.
const MAX_BOM_DEPTH = 15;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// A Sheet Metal plan's REAL cost breakdown — every whole catalog sheet
// actually bought (sheetsNeededPerUnit, rounded up) splits into 3 parts by
// area: required (what the child parts actually need) + true scrap (waste
// WITHIN the planned cutting layout — kerf/margins/nesting gaps around the
// nested parts) + leftover (the CLEAN, UNCUT remainder from rounding up to
// whole sheets, never touched by the laser at all — a genuinely reusable
// piece Production returns to Store whole via the Return flow, NOT lost
// material). These are two different things and must not be collapsed into
// one "scrap" figure — a plan whose planned area is much smaller than one
// catalog sheet (so 1 whole sheet still has to be bought) would otherwise
// have almost the entire sheet wrongly counted as scrap, when in reality
// only the untouched-by-laser remainder is recoverable leftover, not waste.
// sheetCost is unaffected by this split — it's still the same total (every
// whole sheet actually bought), which resolveManufacturingItemCost below
// uses in place of the group's per-line theoretical sum (that IS the
// scrap-costing feature); scrapCost/leftoverValue are broken out purely for
// DISPLAY (BOM Management's Sheet Metal tab). matItem's own
// dimensionVariants[] supplies thickness/density, since SheetMetalPlan
// itself doesn't duplicate them.
export function computeSheetMetalPlanCostBreakdown(plan, matItem) {
  const variant = (matItem.dimensionVariants || []).find(v => String(v._id) === String(plan.dimensionVariantId));
  const thickness = Number(variant?.values?.thickness) || 0;
  const densityValue = variant?.densityValue ?? matItem.dimensionVariants?.[0]?.densityValue;
  const densityUnit = variant?.densityUnit || matItem.dimensionVariants?.[0]?.densityUnit || 'kg/m3';
  if (!thickness || densityValue == null || !(plan.sheetAreaMm2 > 0)) {
    return { sheetCost: 0, scrapAreaMm2: 0, scrapCost: 0, leftoverAreaMm2: 0, leftoverValue: 0 };
  }
  const totalBoughtAreaMm2 = (plan.sheetsNeededPerUnit || 0) * plan.sheetAreaMm2;
  const scrapAreaMm2 = Math.max(0, (plan.plannedAreaMm2 || 0) - (plan.requiredAreaMm2 || 0));
  const leftoverAreaMm2 = Math.max(0, totalBoughtAreaMm2 - (plan.plannedAreaMm2 || 0));
  const { weightPerPieceKg: sheetWeightKg } = calculateFabricationWeight('sheet_plate', { thickness, area: plan.sheetAreaMm2 }, densityValue, densityUnit);
  const { weightPerPieceKg: scrapWeightKg } = calculateFabricationWeight('sheet_plate', { thickness, area: scrapAreaMm2 }, densityValue, densityUnit);
  const { weightPerPieceKg: leftoverWeightKg } = calculateFabricationWeight('sheet_plate', { thickness, area: leftoverAreaMm2 }, densityValue, densityUnit);
  const sheetCost = (sheetWeightKg || 0) * (plan.sheetsNeededPerUnit || 0) * (matItem.weightUnitPrice || 0);
  const scrapCost = (scrapWeightKg || 0) * (matItem.weightUnitPrice || 0);
  const leftoverValue = (leftoverWeightKg || 0) * (matItem.weightUnitPrice || 0);
  return { sheetCost, scrapAreaMm2, scrapCost, leftoverAreaMm2, leftoverValue };
}

/**
 * Used to resolve a manufacturing Item's cost by recursively walking its
 * old RDBOM. That model (and the whole per-machine Legacy BOM Management
 * flow that wrote it) is gone — no live UI creates or edits an RDBOM for
 * either a Machine or a Motor Master motor anymore, so there's nothing left
 * to walk here. A Machine's own cost now flows through MachineBOM's
 * `syncMachineBOMPricing` instead (machineBOMController.js), not this path.
 * Kept as a stub (rather than deleted outright) so `recalculateItemPricing`
 * below — called from many unrelated sites for every internally-manufactured
 * Item, Motor included — doesn't need its own callers touched; it already
 * treats `cost: null` as "nothing to update yet," the same as it always has
 * for an item with no BOM.
 */
export async function resolveManufacturingItemCost(item) {
  return { cost: null, issue: `Item "${item.code}" has no BOM-derived cost source — the old per-machine BOM flow was removed.` };
}

/**
 * The item's own already-computed per-unit BOM cost (Item.stdCost, kept in
 * sync by recalculateItemPricing/resolveManufacturingItemCost — the exact
 * same single source of truth BOM Management's card and everywhere else in
 * the app already uses) plus its Bill Amount %, for the Sales Order Form's
 * minimum-Billing-Amount check. Previously this re-derived its own separate
 * "material MRP × qty" total here instead of just reading the real cost —
 * MRP runs well above actual cost (it has the company's own markup baked
 * in), so it could diverge sharply from the real BOM cost shown everywhere
 * else, which is exactly what happened (client correction, 2026-09-02: "we
 * already have our calculated price in bom [why] would we calculate those
 * complex things here" — fetch it, don't recompute it). Returns
 * { found: false } when this code isn't a manufactured item with a real
 * BOM-derived cost yet (costSource !== 'BOM') — callers should skip
 * validation entirely in that case, same "no BOM = no check" rule as before.
 * This is a PER-UNIT figure — the caller (Sales Order Form) is responsible
 * for multiplying by however many units of this machine are being ordered.
 */
export async function getMachineBillingBOMCost(code, companyId) {
  const machine = await Item.findOne({ code, companyId, productKind: 'Machine' })
    .select('costSource stdCost billAmountPercent').lean();
  if (!machine || machine.costSource !== 'BOM' || !(machine.stdCost > 0)) {
    return { found: false, totalCost: 0 };
  }
  // Company Admin > Pricing Value's per-item "Bill Amount %" — null/unset
  // (item never touched in Pricing Value) falls back to the old hardcoded 10%.
  return { found: true, totalCost: machine.stdCost, billAmountPercent: machine.billAmountPercent ?? 10 };
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

// Converts a "price per {unit}" figure into "price per kg" — mirrors the
// frontend's static Mass Unit list (client/src/utils/unitTypes.js:
// 'Mass Unit': ['Gram', 'Kilogram', 'Tonne']). Returns null for anything
// else (Pieces, Meter, ...) since it isn't a weight rate at all.
export const MASS_UNIT_TO_KG_MULTIPLIER = { Gram: 1000, Kilogram: 1, Tonne: 1 / 1000 };
function priceToPerKg(pricePerUnit, unit) {
  const multiplier = MASS_UNIT_TO_KG_MULTIPLIER[unit];
  return multiplier ? pricePerUnit * multiplier : null;
}

/**
 * Resolves a purchase Item's cost from the most recent PurchaseInvoice line
 * that references it. Returns { cost: number|null, rawPurchaseUnitPrice }.
 *
 * The invoice unitPrice is per PURCHASE unit (the vendor's bid unit, e.g. per
 * Meter / per Kg), but stdCost/purchaseCost and BOM quantities are in the
 * item's base/storage unit (e.g. Centimeter / Pieces) — so the price must go
 * through the same conversion the received quantity did. `rawPurchaseUnitPrice`
 * is that pre-conversion figure, kept around for fabrication items' ₹/kg
 * weightUnitPrice — see applyPricingToItem.
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

  const rawPurchaseUnitPrice = rows[0]?.unitPrice;
  if (!(rawPurchaseUnitPrice > 0)) return { cost: null, rawPurchaseUnitPrice: null };

  const factor = await findPurchaseToBaseFactor(item, rows[0].notes);
  const cost = factor > 0 ? rawPurchaseUnitPrice * factor : rawPurchaseUnitPrice;
  return { cost, rawPurchaseUnitPrice };
}

/**
 * Applies the Item's own profit%/discount% (Company Admin > Pricing Value)
 * to a resolved cost and persists it onto the Item. Never overwrites a
 * manual value when cost is unusable. Unset profit%/discount% (null) counts
 * as 0 — no markup/discount, MRP and Sale Price just show cost.
 * MRP = cost + cost×profit%. Sale Price = MRP − MRP×discount% (discount is
 * taken off MRP, not off the raw cost).
 *
 * `rawPurchaseUnitPrice` (Purchase source only): the pre-conversion ₹-per-
 * purchase-unit figure — for fabrication items (Item.fabricationRef set)
 * bought in a Mass Unit, this doubles as their ₹/kg weightUnitPrice, which
 * purchaseCost (always ₹-per-base-unit/piece) can't represent — see
 * Inventory.js's weightUnitPrice field comment.
 */
export async function applyPricingToItem(item, cost, source, rawPurchaseUnitPrice = null) {
  if (!(cost > 0)) return false;

  if (source === 'BOM') item.stdCost = round2(cost);
  if (source === 'Purchase') {
    item.purchaseCost = round2(cost);
    if (item.fabricationRef && rawPurchaseUnitPrice > 0) {
      const perKg = priceToPerKg(rawPurchaseUnitPrice, item.purchaseUnit);
      if (perKg > 0) item.weightUnitPrice = round2(perKg);
    }
  }

  const profitPercent = item.profitPercent || 0;
  const discountPercent = item.discountPercent || 0;

  const mrp = round2(cost + (cost * profitPercent) / 100);
  item.mrp = mrp;
  item.salePrice = round2(mrp - (mrp * discountPercent) / 100);
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
 *
 * `visiting`/`depth` are internal — always omit them when calling this from
 * a controller. They exist so a successful update here can cascade "upward"
 * (see cascadeRecalculateToConsumers below) without ever revisiting the same
 * item twice or looping forever on a cyclical/very deep BOM graph.
 */
export async function recalculateItemPricing(item, visiting = new Set(), depth = 0) {
  if (!item.internalManufacturing && !item.purchase) return { updated: false };
  if (depth > MAX_BOM_DEPTH) return { updated: false };
  const key = item._id.toString();
  if (visiting.has(key)) return { updated: false };
  visiting.add(key);

  let updated = false;
  let issue = null;

  if (item.internalManufacturing) {
    const resolved = await resolveManufacturingItemCost(item);
    issue = resolved.issue;
    if (resolved.cost == null) {
      if (issue && item.costResolutionIssue !== issue) {
        item.costResolutionIssue = issue;
        await item.save();
      }
      return { updated: false, issue };
    }
    updated = await applyPricingToItem(item, resolved.cost, 'BOM');
  } else {
    const { cost, rawPurchaseUnitPrice } = await resolvePurchaseItemCost(item);
    if (cost == null) return { updated: false };
    updated = await applyPricingToItem(item, cost, 'Purchase', rawPurchaseUnitPrice);
  }

  if (updated) {
    await cascadeRecalculateToConsumers(item, visiting, depth + 1);
  }
  return { updated, issue };
}

// Used to ripple a changed Item's price up through every RDBOM that consumed
// it as a material. That model (and the Legacy BOM Management flow that
// wrote it) is gone, along with resolveManufacturingItemCost above — there's
// no RDBOM left to search for dependents. Kept as a no-op stub, not deleted,
// so its one external caller (purchaseController.js's updatePurchaseItemCost)
// and recalculateItemPricing's own call below don't need touching. Cost
// cascading to consumers more broadly (MachineBOM/ChildPartBOM legs) was
// already a known, separate gap — see
// server/docs/automated-pricing-cascade-design-2026-09.md — unaffected by
// this removal either way.
export async function cascadeRecalculateToConsumers() {}

/**
 * Cheap reapply for when a single Item's own profitPercent/discountPercent
 * changes (Pricing Value module) — reuses the Item's already-stored cost,
 * no BOM walk / purchase re-query. No-op when the item's cost isn't known
 * yet (costSource still 'Manual') — R&D's manual mrp/salePrice stand until
 * a real cost resolves.
 */
export async function reapplyItemPricingFormula(itemId) {
  const item = await Item.findById(itemId).select('costSource stdCost purchaseCost profitPercent discountPercent');
  if (!item || !['BOM', 'Purchase'].includes(item.costSource)) return { updated: false };

  const cost = item.costSource === 'BOM' ? item.stdCost : item.purchaseCost;
  if (!(cost > 0)) return { updated: false };

  const profitPercent = item.profitPercent || 0;
  const discountPercent = item.discountPercent || 0;

  const mrp = round2(cost + (cost * profitPercent) / 100);
  await Item.updateOne({ _id: itemId }, {
    mrp,
    salePrice: round2(mrp - (mrp * discountPercent) / 100)
  });
  return { updated: true };
}
