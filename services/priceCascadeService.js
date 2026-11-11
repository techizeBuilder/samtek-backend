// The price push (outsource v2 slice 4, 2026-10-24 —
// docs/outsource-v2/slice-4-cost-logic-2026-10.md §6; the September design is
// docs/automated-pricing-cascade-design-2026-09.md). Any cost change climbs
// EVERY route up to the Machine's price at once, so Sales (which reads the
// stored Item.stdCost / mrp / salePrice) never quotes a stale number:
//
//   raw material ─┬─> Sub Child Parts made from it ─> Child Parts using them ─> Machines
//                 ├─> Child Parts using it directly ───────────────────────> Machines
//                 └─> Machines using it directly
//
// Rules: a `visiting` set per run (each part once); write only when a number
// changed; a part with no cost yet is skipped, never zeroed; companyId on
// every query. Never throws to its caller — a price hiccup must not undo a
// stock / QC / purchase action. Opening a BOM page still refreshes too (the
// safety net).
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import { refreshBomMaterialLines } from '../utils/bomMaterialPrice.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const key = (kind, id) => `${kind}:${String(id)}`;

async function controllers() {
  const cp = await import('../controllers/childPartBOMController.js');
  const mb = await import('../controllers/machineBOMController.js');
  const scp = await import('../controllers/subChildPartMasterController.js');
  return { cp, mb, scp };
}

// A Machine: its Child Part lines + its own material lines re-read, then the
// price on the Item (applyPricingToItem, via syncMachineBOMPricing — profit %
// / discount % from Pricing Value). bom: a MachineBOM document.
async function recomputeMachine(bom, companyId, visiting) {
  const k = key('m', bom.machine);
  if (visiting.has(k)) return;
  visiting.add(k);
  const { mb } = await controllers();
  await mb.refreshMachineBOMChildParts(bom, companyId);      // saves if changed
  if (await refreshBomMaterialLines(bom, companyId)) await bom.save();
  const item = await Item.findOne({ _id: bom.machine, companyId });
  if (item) await mb.syncMachineBOMPricing(item, bom);
}

// A Child Part: its Sub Child Part lines + material lines re-read; its own
// cost stored on the Item (cost only — a Child Part isn't sold, so no MRP);
// then every Machine using it.
async function recomputeChildPart(childPartId, companyId, visiting) {
  const k = key('cp', childPartId);
  if (visiting.has(k)) return;
  visiting.add(k);
  const { cp } = await controllers();
  await cp.refreshAndComputeChildPart(childPartId, companyId); // Sub Child Part lines, saves if changed
  const bom = await ChildPartBOM.findOne({ childPart: childPartId, company: companyId });
  if (!bom) return;
  if (await refreshBomMaterialLines(bom, companyId)) await bom.save();
  const cost = cp.computeChildPartCost(bom.toObject());
  if (cost.totalCost > 0) {
    const total = round2(cost.totalCost);
    await Item.updateOne({ _id: childPartId, companyId, stdCost: { $ne: total } },
      { $set: { stdCost: total, costSource: 'BOM', costResolvedAt: new Date() } });
  }
  const machines = await MachineBOM.find({ company: companyId, 'childParts.childPart': childPartId });
  for (const m of machines) await recomputeMachine(m, companyId, visiting);
}

async function childPartsUsingSubChildPart(scpId, companyId, visiting) {
  const boms = await ChildPartBOM.find({ company: companyId, 'subChildParts.subChildPart': scpId }).select('childPart').lean();
  for (const b of boms) await recomputeChildPart(b.childPart, companyId, visiting);
}

const safe = (name, fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { console.error(`[PriceCascade] ${name} failed:`, e.message); return null; }
};

// A Sub Child Part's cost changed (its build finished, R&D edited it, a Sheet
// Plan was saved) → every Child Part using it → their Machines.
export const onSubChildPartChanged = safe('onSubChildPartChanged', async (scpId, companyId, visiting = new Set()) => {
  const k = key('scp', scpId);
  if (visiting.has(k)) return;
  visiting.add(k);
  await childPartsUsingSubChildPart(scpId, companyId, visiting);
});

// A Child Part's cost changed (its build finished, R&D edited its BOM).
export const onChildPartChanged = safe('onChildPartChanged', async (childPartId, companyId, visiting = new Set()) => {
  await recomputeChildPart(childPartId, companyId, visiting);
});

// A Machine's own cost changed (its build finished).
export const onMachineChanged = safe('onMachineChanged', async (machineItemId, companyId, visiting = new Set()) => {
  const bom = await MachineBOM.findOne({ machine: machineItemId, company: companyId });
  if (bom) await recomputeMachine(bom, companyId, visiting);
});

// A raw material's price changed (Store's PO receive / the bill, Accounts'
// manual price, ₹/kg) — or a fabrication item's weight (a Fabrication Master
// density / material change, 2026-10-28) → all three routes.
export const onRawMaterialChanged = safe('onRawMaterialChanged', async (rawItem, visiting = new Set()) => {
  if (!rawItem || rawItem.productKind) return; // only plain inventory items
  const companyId = rawItem.companyId;
  if (!companyId) return;
  const { scp } = await controllers();
  // Route 1 — Sub Child Parts made from it: material cost re-read, and the
  // Sheet Plan's scrap cost (priced at the same ₹/kg, 2026-10-26).
  const scps = await Item.find({ companyId, productKind: 'SubChildPart', 'subChildPartDetails.sourceItem': rawItem._id });
  const { costBreakdownFor } = await import('../controllers/subChildPartSheetPlanController.js');
  const SubChildPartSheetPlan = (await import('../models/SubChildPartSheetPlan.js')).default;
  for (const s of scps) {
    const d = s.subChildPartDetails;
    let changed = false;
    const { materialsCost, unitWeightKg } = await scp.computeSourceMetrics(rawItem, d.sourceQty, d.sourceUnit, d.sourceDimensionVariantId);
    if (materialsCost > 0 && Math.abs((d.materialsCost || 0) - materialsCost) >= 0.005) { d.materialsCost = materialsCost; changed = true; }
    // Weight rides along with cost (design doc §7) — even before the item
    // has a ₹/kg.
    if (unitWeightKg > 0 && Math.abs((d.unitWeightKg || 0) - unitWeightKg) > 1e-9) { d.unitWeightKg = unitWeightKg; changed = true; }
    const plan = await SubChildPartSheetPlan.findOne({ subChildPart: s._id, company: companyId }).lean();
    if (plan) {
      const scrap = costBreakdownFor(plan, rawItem, d.sourceDimensionVariantId).scrapCostPerPiece;
      if (scrap > 0 && Math.abs((d.scrapCost || 0) - scrap) >= 0.005) { d.scrapCost = scrap; changed = true; }
    }
    if (!changed) continue;
    await s.save();
    await onSubChildPartChanged(s._id, companyId, visiting);
  }
  // Route 2 — Child Parts using it directly.
  const cps = await ChildPartBOM.find({ company: companyId, 'materials.code': rawItem.code }).select('childPart').lean();
  for (const b of cps) await recomputeChildPart(b.childPart, companyId, visiting);
  // Route 3 — Machines using it directly.
  const ms = await MachineBOM.find({ company: companyId, 'materials.code': rawItem.code });
  for (const m of ms) await recomputeMachine(m, companyId, visiting);
});
