import FabricationMaster from '../models/FabricationMaster.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';

// Resolves a consuming line's (a BOM material line, or a Production
// out-of-BOM material demand) fabrication weight — null when the source
// Item isn't a Fabrication Master pick (fabricationRef unset), in which
// case the caller falls back to plain purchaseCost x quantity pricing
// unchanged. Category + density are read from the Item's own
// dimensionVariants[0] (every variant of one Item shares the same
// category/density — see Inventory.js) with a FabricationMaster lookup as a
// fallback for the rare case dimensionVariants is empty. bomDimensions are
// THIS line's own entered values (mm), not the Item's stock dimensions —
// see RDBOM.js's bomDimensions field comment.
//
// Shared between rdController.js (BOM materials) and
// productionMfgController.js (out-of-BOM material demands) — same math,
// same source-of-truth, so the two can never drift apart.
export async function resolveFabricationWeight(sourceItem, bomDimensions) {
  if (!sourceItem.fabricationRef) return null;

  let category = sourceItem.dimensionVariants?.[0]?.category;
  let densityValue = sourceItem.dimensionVariants?.[0]?.densityValue;
  let densityUnit = sourceItem.dimensionVariants?.[0]?.densityUnit;

  if (!category || densityValue == null) {
    const fabItem = await FabricationMaster.findById(sourceItem.fabricationRef).select('category density').lean();
    if (!fabItem) return null;
    category = category || fabItem.category;
    densityValue = densityValue ?? fabItem.density?.value;
    densityUnit = densityUnit || fabItem.density?.unit;
  }
  if (!category || densityValue == null) return null;

  const { weightPerPieceKg } = calculateFabricationWeight(category, bomDimensions, densityValue, densityUnit);
  return { fabricationCategory: category, weightPerPieceKg };
}

// Deterministic "key:value,key:value" summary of a dimension set (sorted so
// key insertion order never changes the result) — used as the distinguishing
// part of a fabrication material's demand-tracking key, so two different
// cuts of the same raw Item never collapse into one demand/merge entry. See
// rdController.js's processRDRequest and productionMfgController.js's
// addMaterialDemand, both of which build a materialCode as
// `${itemCode}#${dimensionSignature(dims)}` for fabrication lines.
export function dimensionSignature(dims) {
  return Object.entries(dims || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

// Human-readable "key: valuemm, key: valuemm" summary of a dimension set —
// mirrors the frontend's identical helper (client/src/lib/fabricationDims.js)
// for server-rendered surfaces (RFQ/vendor-confirmation emails).
export function formatDims(dims) {
  const parts = Object.entries(dims || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}mm`);
  return parts.length ? parts.join(', ') : '—';
}
