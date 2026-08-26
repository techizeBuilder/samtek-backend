import { getCategoryByKey } from '../utils/fabricationCategories.js';

// Shared BOM-material grouping, per unit of the machine (buildQty applied by
// the caller) — used by both materialAvailabilityService.js (Store Orders'
// pre-check + auto-purchase) and productionMfgController.js's Material List
// (getMaterialList/issueMaterialToStore), so the two stay in sync instead of
// a third copy of this math drifting from the other two. Sheet Metal's own
// grouping (sheetMetalGroupsFromBOM) stays in sheetMetalPlanController.js —
// it's the source of truth for the Sheet Metal Plan feature itself — but
// follows the exact same {itemCode, dimensionVariantId, itemName, childParts}
// shape as these two, so all three group types can be handled uniformly by
// their shared callers.
const dedupeChildPart = (list, mat) => {
  if (!mat.childPart) return;
  const subChildPart = mat.subChildPart || '';
  if (!list.some(cp => cp.childPart === mat.childPart && cp.subChildPart === subChildPart)) {
    list.push({ childPart: mat.childPart, subChildPart });
  }
};

// Groups a BOM's non-fabrication raw material + tool lines by code, summing
// each group's per-unit quantity across every Child Part line referencing
// the same code — mirrors processRDRequest WORKFLOW 2's own non-fabrication
// merge key (mat.code alone), just also collecting childParts for display.
export function plainMaterialGroupsFromBOM(bom) {
  const groups = new Map();
  for (const mat of bom.materials || []) {
    if (mat.isDiscontinued || mat.fabricationCategory) continue;
    if (!groups.has(mat.code)) {
      groups.set(mat.code, { itemCode: mat.code, itemName: mat.item, unit: mat.unit, perUnitQty: 0, childParts: [] });
    }
    const g = groups.get(mat.code);
    g.perUnitQty += Number(mat.quantity) || 0;
    dedupeChildPart(g.childParts, mat);
  }
  return Array.from(groups.values());
}

// Groups a BOM's non-sheet-metal fabrication lines by {code, dimensionVariantId}
// for length-based (calcType !== 'sheet') categories, summing each group's
// total needed length (mm, already the base unit — bomDimensions.length is
// server-synthesized in mm by buildFabricationBomDimensions, no conversion
// needed here) across every Child Part line drawing from the same catalog
// dimension. Mirrors sheetMetalGroupsFromBOM's grouping shape exactly, just
// for length instead of area.
export function lengthFabricationGroupsFromBOM(bom) {
  const groups = new Map();
  for (const mat of bom.materials || []) {
    if (mat.isDiscontinued || mat.isSheetMetal || !mat.fabricationCategory || !mat.dimensionVariantId) continue;
    const category = getCategoryByKey(mat.fabricationCategory);
    if (!category || category.calcType === 'sheet') continue;
    const key = `${mat.code}#${mat.dimensionVariantId}`;
    const lengthMm = (Number(mat.bomDimensions?.length) || 0) * (Number(mat.quantity) || 0);
    if (!groups.has(key)) {
      groups.set(key, {
        itemCode: mat.code, dimensionVariantId: mat.dimensionVariantId, itemName: mat.item,
        fabricationCategory: mat.fabricationCategory, totalLengthMmPerUnit: 0, childParts: [],
      });
    }
    const g = groups.get(key);
    g.totalLengthMmPerUnit += lengthMm;
    dedupeChildPart(g.childParts, mat);
  }
  return Array.from(groups.values());
}
