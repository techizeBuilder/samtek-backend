import RDBOM from '../models/RDBOM.js';
import SheetMetalPlan from '../models/SheetMetalPlan.js';
import { Item } from '../models/Inventory.js';
import { toMm } from '../utils/unitConversion.js';
import { computeSheetMetalPlanCostBreakdown } from '../services/itemPricingService.js';

// One "group" = every 'raw' material line on this BOM sharing the same
// {code, dimensionVariantId} where isSheetMetal is true — the unit a Sheet
// Metal plan is authored against (see SheetMetalPlan.js's own comment: R&D
// plans sheet usage once per group across the whole BOM, not per child part).
function sheetMetalGroupsFromBOM(bom) {
  const groups = new Map();
  for (const mat of bom.materials || []) {
    if (mat.isDiscontinued || mat.materialKind === 'tool' || !mat.isSheetMetal || !mat.dimensionVariantId) continue;
    const key = `${mat.code}#${mat.dimensionVariantId}`;
    // Per-line area x that line's own quantity (how many pieces of THIS
    // exact cut this Child Part needs — fabrication quantity is a real piece
    // count, see RDBOM.MaterialSchema's amountValue/quantity comment) —
    // omitting the multiplier here would understate requiredAreaMm2 (and
    // therefore overstate scrap) for any line needing more than 1 piece.
    const areaMm2 = (Number(mat.bomDimensions?.area) || 0) * (Number(mat.quantity) || 0);
    if (!groups.has(key)) {
      groups.set(key, {
        itemCode: mat.code,
        dimensionVariantId: mat.dimensionVariantId,
        itemName: mat.item,
        materialGrade: mat.materialGrade || '',
        requiredAreaMm2: 0,
        childParts: [],
      });
    }
    const g = groups.get(key);
    g.requiredAreaMm2 += areaMm2;
    if (mat.childPart && !g.childParts.some(cp => cp.childPart === mat.childPart && cp.subChildPart === (mat.subChildPart || ''))) {
      g.childParts.push({ childPart: mat.childPart, subChildPart: mat.subChildPart || '' });
    }
  }
  return Array.from(groups.values());
}

function sheetAreaFromItem(matItem, dimensionVariantId) {
  const variant = (matItem?.dimensionVariants || []).find(v => String(v._id) === String(dimensionVariantId));
  if (!variant) return null;
  const width = Number(variant.values?.width) || 0;
  const length = Number(variant.values?.length) || 0;
  if (!width || !length) return null;
  return width * length;
}

async function sheetAreaForVariant(itemCode, dimensionVariantId, companyId) {
  const sourceItem = await Item.findOne({ code: itemCode, companyId, productKind: null }).lean();
  return sheetAreaFromItem(sourceItem, dimensionVariantId);
}

// GET /api/rd/boms/:bomId/sheet-metal-groups — every distinct sheet-metal
// (item, dimension) group used in this BOM's raw materials, each carrying
// requiredAreaMm2 (server-authoritative, never trusted from any earlier
// client computation), sheetAreaMm2 (one catalog sheet's own area), and —
// whenever a plan already exists — the real cost breakdown (sheetCost,
// scrapAreaMm2/scrapCost, leftoverAreaMm2/leftoverValue) so BOM Management
// can show catalog area / laser-cutting area / child-part area / scrap area
// / leftover area and their costs without a second round-trip. Powers both
// the "Add Sheet Metal" group picker and the Sheet Metal tab's summary list.
export const getSheetMetalGroups = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.bomId, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });

    const groups = sheetMetalGroupsFromBOM(bom);
    const plans = await SheetMetalPlan.find({ bom: bom._id, company: req.user.companyId }).lean();
    const planByKey = new Map(plans.map(p => [`${p.itemCode}#${p.dimensionVariantId}`, p]));

    const data = await Promise.all(groups.map(async (g) => {
      const matItem = await Item.findOne({ code: g.itemCode, companyId: req.user.companyId, productKind: null }).lean();
      const sheetAreaMm2 = sheetAreaFromItem(matItem, g.dimensionVariantId);
      const existingPlan = planByKey.get(`${g.itemCode}#${g.dimensionVariantId}`) || null;
      const breakdown = (existingPlan && matItem) ? computeSheetMetalPlanCostBreakdown(existingPlan, matItem) : null;
      return {
        ...g,
        sheetAreaMm2,
        existingPlan,
        scrapAreaMm2: breakdown?.scrapAreaMm2 ?? null,
        scrapCost: breakdown?.scrapCost ?? null,
        sheetCost: breakdown?.sheetCost ?? null,
        // The clean, uncut remainder from rounding up to whole sheets — see
        // computeSheetMetalPlanCostBreakdown's own comment. Distinct from
        // scrap: Production returns this whole via the Return flow instead
        // of it being lost material.
        leftoverAreaMm2: breakdown?.leftoverAreaMm2 ?? null,
        leftoverValue: breakdown?.leftoverValue ?? null,
      };
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rd/boms/:bomId/sheet-metal-plans — saved plans for this BOM.
export const getSheetMetalPlans = async (req, res) => {
  try {
    const plans = await SheetMetalPlan.find({ bom: req.params.bomId, company: req.user.companyId }).sort({ createdAt: -1 });
    res.json({ success: true, data: plans });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rd/boms/:bomId/sheet-metal-plans — create or update (one plan per
// {bom, itemCode, dimensionVariantId} — the unique index enforces this) R&D's
// real-world nesting decision for one group. requiredAreaMm2 is ALWAYS
// recomputed here from the BOM's current materials, never trusted from the
// client, same "server is authoritative" principle every other BOM
// calculation in this codebase already follows. warningBelowRequired is
// advisory only (per the client's explicit resolution) — never blocks save.
export const saveSheetMetalPlan = async (req, res) => {
  try {
    const { itemCode, dimensionVariantId, plannedLengthValue, plannedLengthUnit, plannedWidthValue, plannedWidthUnit, laserFileUrl, laserFileName } = req.body;
    if (!itemCode || !dimensionVariantId) {
      return res.status(400).json({ success: false, message: 'itemCode and dimensionVariantId are required' });
    }

    // Length and Width are entered separately (each its own unit, e.g. cm/
    // inch) — area is NEVER accepted directly from the client, only ever
    // derived here from these two real dimensions, mm as the base unit, same
    // convention as every other fabrication dimension in this codebase (see
    // unitConversion.js / fabricationCategories.js's sheet_plate category).
    const lengthMm = toMm(plannedLengthValue, plannedLengthUnit);
    const widthMm = toMm(plannedWidthValue, plannedWidthUnit);
    if (lengthMm == null || widthMm == null) {
      return res.status(400).json({ success: false, message: 'A valid planned Length and Width (each with a unit) are required.' });
    }

    const bom = await RDBOM.findOne({ _id: req.params.bomId, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    if (bom.isLocked) return res.status(400).json({ success: false, message: 'BOM is locked' });

    const group = sheetMetalGroupsFromBOM(bom).find(g => g.itemCode === itemCode && g.dimensionVariantId === dimensionVariantId);
    if (!group) {
      return res.status(400).json({ success: false, message: 'No sheet-metal raw material line on this BOM matches that item + dimension.' });
    }

    const sheetAreaMm2 = await sheetAreaForVariant(itemCode, dimensionVariantId, req.user.companyId);
    if (!sheetAreaMm2) {
      return res.status(400).json({ success: false, message: 'Could not resolve this catalog sheet size (missing width/length).' });
    }

    // The laser-cutting area (this plan's own real layout) checked against
    // ONE catalog sheet's own area — how many whole sheets Store needs to
    // transfer per unit of the machine.
    const plannedAreaMm2 = lengthMm * widthMm;
    const sheetsNeededPerUnit = Math.ceil(plannedAreaMm2 / sheetAreaMm2);

    const plan = await SheetMetalPlan.findOneAndUpdate(
      { bom: bom._id, itemCode, dimensionVariantId, company: req.user.companyId },
      {
        $set: {
          itemName: group.itemName,
          materialGrade: group.materialGrade,
          requiredAreaMm2: group.requiredAreaMm2,
          plannedLengthValue: Number(plannedLengthValue),
          plannedLengthUnit,
          plannedWidthValue: Number(plannedWidthValue),
          plannedWidthUnit,
          plannedAreaMm2,
          sheetAreaMm2,
          sheetsNeededPerUnit,
          warningBelowRequired: plannedAreaMm2 < group.requiredAreaMm2,
          laserFileUrl: laserFileUrl || '',
          laserFileName: laserFileName || '',
        },
        $setOnInsert: { bom: bom._id, itemCode, dimensionVariantId, company: req.user.companyId, createdBy: req.user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/rd/boms/:bomId/sheet-metal-plans/:planId
export const deleteSheetMetalPlan = async (req, res) => {
  try {
    const bom = await RDBOM.findOne({ _id: req.params.bomId, company: req.user.companyId });
    if (!bom) return res.status(404).json({ success: false, message: 'BOM not found' });
    if (bom.isLocked) return res.status(400).json({ success: false, message: 'BOM is locked' });

    const deleted = await SheetMetalPlan.findOneAndDelete({ _id: req.params.planId, bom: bom._id, company: req.user.companyId });
    if (!deleted) return res.status(404).json({ success: false, message: 'Plan not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export { sheetMetalGroupsFromBOM };
