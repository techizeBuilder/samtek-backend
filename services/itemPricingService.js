import { Item } from '../models/Inventory.js';
import RDBOM from '../models/RDBOM.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import SheetMetalPlan from '../models/SheetMetalPlan.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';

// Defensive cap in addition to cycle detection, in case of a very deep
// (but non-circular) BOM tree.
const MAX_BOM_DEPTH = 15;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
function computeSheetMetalPlanCost(plan, matItem) {
  return computeSheetMetalPlanCostBreakdown(plan, matItem).sheetCost;
}

/**
 * Resolves a manufacturing Item's cost by recursively walking its RDBOM.
 * Returns { cost: number|null, issue: string|null }. Recalculated on every
 * BOM change (material add/edit/remove, production cost/expense edit, lock)
 * — does NOT wait for a completed production build; whatever the BOM totals
 * right now (materials + productionCost + productionExpense) is the item's
 * live stdCost/mrp/salePrice. A completed build still re-triggers this same
 * resolution (productionMfgController.js), it just isn't the only trigger.
 */
export async function resolveManufacturingItemCost(item, visiting = new Set(), depth = 0) {
  if (depth > MAX_BOM_DEPTH) {
    return { cost: null, issue: `BOM depth exceeded ${MAX_BOM_DEPTH} levels (possible cycle) at item ${item.code}` };
  }
  if (visiting.has(item._id.toString())) {
    return { cost: null, issue: `Circular BOM reference detected at item ${item.code}` };
  }

  // Product Master machines and Motor Master motors now ARE Item documents
  // (productKind:'Machine'/'Motor') — no separate RDMachine collection to
  // cross-reference by code anymore.
  if (item.productKind !== 'Machine' && item.productKind !== 'Motor') {
    return { cost: null, issue: `Item "${item.code}" is not a Product Master machine or Motor Master motor — no BOM to build cost from.` };
  }

  const bom = await RDBOM.findOne({ machine: item._id, company: item.companyId });
  if (!bom || !bom.materials || bom.materials.length === 0) {
    return { cost: null, issue: `No BOM found for "${item.code}"` };
  }

  visiting.add(item._id.toString());
  try {
    let materialsTotal = 0;
    // Sheet Metal groups (mat.isSheetMetal) are priced once per {code,
    // dimensionVariantId} group below (real, scrap-inclusive sheet cost),
    // not per individual BOM line like every other material — the
    // theoretical per-line area cost these lines would otherwise contribute
    // is deliberately excluded from materialsTotal.
    const sheetMetalGroupKeys = new Set();
    for (const mat of bom.materials) {
      if (mat.isDiscontinued) continue;

      if (mat.isSheetMetal && mat.dimensionVariantId) {
        sheetMetalGroupKeys.add(`${mat.code}#${mat.dimensionVariantId}`);
        continue;
      }

      const matItem = await Item.findOne({
        code: { $regex: new RegExp(`^${escapeRegex(mat.code)}$`, 'i') },
        companyId: item.companyId
      });

      if (!matItem) {
        return { cost: null, issue: `BOM material code "${mat.code}" has no matching Item — cost not recalculated` };
      }

      let lineUnitCost;
      if (mat.computedWeightPerPieceKg != null) {
        // Fabrication material (RDBOM.MaterialSchema) — priced by this BOM
        // line's own committed weight (from its entered dimensions, not the
        // Item's current stock dimensions) × the Item's ₹/kg rate, not by
        // purchaseCost/stdCost — see Inventory.js's weightUnitPrice comment.
        lineUnitCost = mat.computedWeightPerPieceKg * (matItem.weightUnitPrice || 0);
      } else if (matItem.internalManufacturing) {
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

      materialsTotal += lineUnitCost * (mat.quantity || 0);
    }

    // Sheet Metal groups — real, scrap-inclusive cost per group (see
    // computeSheetMetalPlanCost above), added once per {code,
    // dimensionVariantId} regardless of how many BOM lines share it. A group
    // with no saved plan yet contributes 0 (matches lockBOM's own gate —
    // this situation can't reach a locked, production-costed BOM in normal
    // use, but shouldn't throw here either).
    for (const key of sheetMetalGroupKeys) {
      const [code, dimensionVariantId] = key.split('#');
      const plan = await SheetMetalPlan.findOne({ bom: bom._id, itemCode: code, dimensionVariantId, company: item.companyId }).lean();
      if (!plan) continue;
      const matItem = await Item.findOne({
        code: { $regex: new RegExp(`^${escapeRegex(code)}$`, 'i') },
        companyId: item.companyId
      }).lean();
      if (!matItem) continue;
      materialsTotal += computeSheetMetalPlanCost(plan, matItem);
    }

    if (!(materialsTotal > 0)) {
      return { cost: null, issue: `Computed BOM material cost is zero for "${item.code}" — check linked material costs` };
    }

    // Total build cost = material roll-up + this build's labor/job-work
    // (productionCost) + any other one-off production expense — see
    // RDBOM.productionCost/productionExpense.
    const total = materialsTotal + (bom.productionCost || 0) + (bom.productionExpense || 0);
    return { cost: total, issue: null };
  } finally {
    visiting.delete(item._id.toString());
  }
}

/**
 * Computes a finished item's PER-UNIT BOM cost using each material's MRP
 * (not purchaseCost/stdCost), plus the BOM's own productionCost/productionExpense
 * — used by the Sales Order Form to enforce a minimum Billing Amount. Flat
 * sum, no recursive sub-BOM walk: Σ(material.mrp × qty) + productionCost +
 * productionExpense. Returns { found: false } when there's no BOM for this
 * code at all — callers should skip validation entirely in that case (per
 * product requirement: no BOM = no check). This is a PER-UNIT figure — the
 * caller (Sales Order Form) is responsible for multiplying by however many
 * units of this machine are actually being ordered.
 */
export async function computeBOMMaterialsMrpCost(code, companyId) {
  const machine = await Item.findOne({ code, companyId, productKind: 'Machine' }).lean();
  if (!machine) return { found: false, totalCost: 0, materials: [] };

  // Company Admin > Pricing Value's per-item "Bill Amount %" — the Sales
  // Order Form's Bill Amt for this machine must exceed BOM cost by more
  // than this percent. null/unset (item never touched in Pricing Value)
  // falls back to the old hardcoded 10%.
  const billAmountPercent = machine.billAmountPercent ?? 10;

  const bom = await RDBOM.findOne({ machine: machine._id, company: companyId }).lean();
  const activeMaterials = (bom?.materials || []).filter(m => !m.isDiscontinued);
  if (activeMaterials.length === 0) return { found: false, totalCost: 0, materials: [], billAmountPercent };

  const items = await Item.find({
    companyId,
    code: { $in: activeMaterials.map(m => new RegExp(`^${escapeRegex(m.code)}$`, 'i')) }
  }).select('code mrp').lean();
  const mrpByCode = new Map(items.map(it => [it.code.toLowerCase(), it.mrp || 0]));

  let materialsCost = 0;
  const materials = activeMaterials.map(m => {
    const mrp = mrpByCode.get((m.code || '').toLowerCase()) || 0;
    const lineTotal = round2(mrp * (m.quantity || 0));
    materialsCost += lineTotal;
    return { code: m.code, item: m.item, quantity: m.quantity, unit: m.unit, mrp, lineTotal };
  });

  const productionCost = bom.productionCost || 0;
  const productionExpense = bom.productionExpense || 0;
  const totalCost = round2(materialsCost + productionCost + productionExpense);

  return { found: true, totalCost, materialsCost: round2(materialsCost), productionCost, productionExpense, materials, billAmountPercent };
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

// When an Item's own cost just changed (BOM recompute above, or a fresh
// purchase price), any OTHER Item that consumes it as a BOM material must
// have ITS cost recomputed too — a raw material's price moving must ripple
// up through every sub-assembly/machine that uses it, across every company,
// not sit unnoticed until someone happens to reopen that specific BOM.
// Mirrors resolveManufacturingItemCost's downward walk, just upward; shares
// its caller's `visiting` set so a cycle can't loop forever and a
// diamond-shaped BOM graph never recomputes the same item twice. Exported
// separately (not just used internally by recalculateItemPricing above) for
// the one write site that sets purchaseCost directly via applyPricingToItem
// instead of going through recalculateItemPricing — see purchaseController.js's
// updatePurchaseItemCost (Accounts' manual purchase-cost override).
export async function cascadeRecalculateToConsumers(item, visiting = new Set(), depth = 0) {
  if (depth > MAX_BOM_DEPTH) return;
  const dependentBOMs = await RDBOM.find({
    company: item.companyId,
    materials: {
      $elemMatch: {
        code: { $regex: new RegExp(`^${escapeRegex(item.code)}$`, 'i') },
        isDiscontinued: { $ne: true }
      }
    }
  }).select('machine').lean();

  for (const bomRef of dependentBOMs) {
    if (!bomRef.machine) continue;
    const consumer = await Item.findById(bomRef.machine);
    if (!consumer || !consumer.internalManufacturing) continue;
    await recalculateItemPricing(consumer, visiting, depth);
  }
}

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
