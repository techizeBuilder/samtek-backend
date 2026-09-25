// Sheet Metal Plan for a Sub Child Part — same real-world cutting-plan
// concept server/controllers/sheetMetalPlanController.js already has for a
// whole Machine BOM, re-homed to a single Sub Child Part (see
// server/docs/bom-hierarchy-redesign-2026-09.md §7). Reuses that file's
// exported `sheetAreaFromItem` and itemPricingService.js's exported
// `computeSheetMetalPlanCostBreakdown` as-is — no formula duplicated here,
// only the one new concept (orderQty) and the different ownership (a Sub
// Child Part directly, not a BOM+item+dimensionVariant triple).
import { Item } from '../models/Inventory.js';
import SubChildPartSheetPlan from '../models/SubChildPartSheetPlan.js';
import { sheetAreaFromItem } from './sheetMetalPlanController.js';
import { toMm, toMm2 } from '../utils/unitConversion.js';
import { computeSheetMetalPlanCostBreakdown } from '../services/itemPricingService.js';

// Resolves the Sub Child Part + its populated source item, and confirms the
// source is actually a Fabrication Master sheet-metal pick — same gate the
// frontend uses to decide whether to show this section at all.
async function resolveSheetMetalSubChildPart(id, companyId) {
  const item = await Item.findOne({ _id: id, companyId, productKind: 'SubChildPart' })
    .populate('subChildPartDetails.sourceItem');
  if (!item) return { error: { code: 404, message: 'Sub Child Part not found.' } };
  const d = item.subChildPartDetails;
  const sourceItem = d?.sourceItem;
  if (!sourceItem?.fabricationRef) {
    return { error: { code: 400, message: "This Sub Child Part's source material is not a Fabrication Master (sheet metal) item." } };
  }
  const catalogSheet = sheetAreaFromItem(sourceItem, d.sourceDimensionVariantId);
  if (!catalogSheet) {
    return { error: { code: 400, message: 'Could not resolve this catalog sheet size (missing width/length).' } };
  }
  return { item, sourceItem, catalogSheet };
}

// Cost breakdown for a saved plan, via computeSheetMetalPlanCostBreakdown
// (itemPricingService.js) — an adapter object maps this plan's own field
// names onto what that function reads (it only needs {dimensionVariantId,
// sheetAreaMm2, sheetsNeededPerUnit, plannedAreaMm2, requiredAreaMm2}, no
// BOM-specific assumptions). Its scrapCost is for the WHOLE plan (orderQty
// units) — dividing by orderQty gives the average for one piece, the figure
// that actually belongs alongside Materials Cost / Job Work Cost (already
// per-piece).
function costBreakdownFor(plan, sourceItem, dimensionVariantId) {
  const breakdown = computeSheetMetalPlanCostBreakdown({
    dimensionVariantId,
    sheetAreaMm2: plan.sheetAreaMm2,
    sheetsNeededPerUnit: plan.sheetsUsed,
    plannedAreaMm2: plan.plannedAreaMm2,
    requiredAreaMm2: plan.requiredAreaMm2,
  }, sourceItem);
  return { ...breakdown, scrapCostPerPiece: plan.orderQty > 0 ? breakdown.scrapCost / plan.orderQty : 0 };
}

// GET /api/rd/sub-child-parts/:id/sheet-metal-plan
export const getSubChildPartSheetPlan = async (req, res) => {
  try {
    const resolved = await resolveSheetMetalSubChildPart(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, sourceItem } = resolved;
    const plan = await SubChildPartSheetPlan.findOne({ subChildPart: item._id, company: req.user.companyId }).lean();
    if (!plan) return res.json({ success: true, data: { plan: null } });
    const cost = costBreakdownFor(plan, sourceItem, item.subChildPartDetails.sourceDimensionVariantId);
    res.json({ success: true, data: { plan, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/sub-child-parts/:id/sheet-metal-plan
export const saveSubChildPartSheetPlan = async (req, res) => {
  try {
    const { orderQty, sheets, laserFileUrl, laserFileName } = req.body;
    if (!(Number(orderQty) > 0)) {
      return res.status(400).json({ success: false, message: 'orderQty must be a positive number — how many Sub Child Part units this cutting run produces.' });
    }
    if (!Array.isArray(sheets) || sheets.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one sheet is required.' });
    }
    if (!laserFileUrl) {
      return res.status(400).json({ success: false, message: 'A laser cutting file is required to save this plan.' });
    }

    const resolved = await resolveSheetMetalSubChildPart(req.params.id, req.user.companyId);
    if (resolved.error) return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    const { item, sourceItem, catalogSheet } = resolved;
    const { lengthMm: catalogLengthMm, widthMm: catalogWidthMm, areaMm2: sheetAreaMm2 } = catalogSheet;

    // Each entry is one physical catalog sheet actually purchased — same
    // either-orientation fit-check saveSheetMetalPlan (the Machine BOM
    // version) already does; area is never accepted directly from the
    // client, only ever derived here.
    const resolvedSheets = [];
    let plannedAreaMm2 = 0;
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i] || {};
      const lengthMm = toMm(s.lengthValue, s.lengthUnit);
      const widthMm = toMm(s.widthValue, s.widthUnit);
      if (lengthMm == null || widthMm == null) {
        return res.status(400).json({ success: false, message: `Sheet ${i + 1}: a valid Length and Width (each with a unit) are required.` });
      }
      const fits = (lengthMm <= catalogLengthMm && widthMm <= catalogWidthMm)
        || (lengthMm <= catalogWidthMm && widthMm <= catalogLengthMm);
      if (!fits) {
        return res.status(400).json({
          success: false,
          message: `Sheet ${i + 1}: ${Math.round(lengthMm)}mm × ${Math.round(widthMm)}mm doesn't fit within this item's catalog sheet size (${Math.round(catalogLengthMm)}mm × ${Math.round(catalogWidthMm)}mm).`,
        });
      }
      resolvedSheets.push({
        lengthValue: Number(s.lengthValue), lengthUnit: s.lengthUnit,
        widthValue: Number(s.widthValue), widthUnit: s.widthUnit,
      });
      plannedAreaMm2 += lengthMm * widthMm;
    }
    const sheetsUsed = resolvedSheets.length;

    const orderQtyNum = Number(orderQty);
    // The real theoretical minimum for this run — the Sub Child Part's own
    // live per-piece area x how many units this plan covers. Recomputed
    // fresh here every save, never trusted from the client (same rule the
    // Machine BOM version follows for its own requiredAreaMm2).
    const perPieceAreaMm2 = toMm2(item.subChildPartDetails.sourceQty, item.subChildPartDetails.sourceUnit);
    if (perPieceAreaMm2 == null) {
      return res.status(400).json({ success: false, message: "Could not resolve this Sub Child Part's own per-unit area — check its source material amount/unit." });
    }
    const requiredAreaMm2 = perPieceAreaMm2 * orderQtyNum;

    const plan = await SubChildPartSheetPlan.findOneAndUpdate(
      { subChildPart: item._id, company: req.user.companyId },
      {
        $set: {
          orderQty: orderQtyNum,
          requiredAreaMm2,
          sheets: resolvedSheets,
          plannedAreaMm2,
          sheetAreaMm2,
          sheetsUsed,
          warningBelowRequired: plannedAreaMm2 < requiredAreaMm2,
          laserFileUrl: laserFileUrl || '',
          laserFileName: laserFileName || '',
        },
        $setOnInsert: { subChildPart: item._id, company: req.user.companyId, createdBy: req.user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    // Stored on the Item itself (same pattern materialsCost already uses) so
    // the Sub Child Part Master accordion/View/list can show it without a
    // second round-trip.
    const cost = costBreakdownFor(plan, sourceItem, item.subChildPartDetails.sourceDimensionVariantId);
    item.subChildPartDetails.scrapCost = cost.scrapCostPerPiece;
    await item.save();

    res.json({ success: true, data: { plan, cost } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
