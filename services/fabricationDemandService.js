import FabricationMaster from '../models/FabricationMaster.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';
import { toMm, toMm2 } from '../utils/unitConversion.js';

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
// `designation` is optional — required only for calcType 'lookup' categories
// (beam/channel, whose weight comes from a standardized section table, not a
// formula over raw dimensions). Callers that resolve a specific
// dimensionVariant (e.g. the BOM amount+quantity flow) should pass that
// variant's own `.designation`; every other caller can omit it, matching the
// pre-existing behavior (perMeter/sheet categories never used it).
export async function resolveFabricationWeight(sourceItem, bomDimensions, designation) {
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

  const { weightPerPieceKg } = calculateFabricationWeight(category, bomDimensions, densityValue, densityUnit, designation);
  return { fabricationCategory: category, weightPerPieceKg };
}

// Builds the full bomDimensions object a BOM material line stores, from the
// user's actual input under the amount+quantity redesign: which catalog
// Item.dimensionVariants[] entry this line draws from, plus a single
// consumed amount (a length for every shape, an area for sheet_plate).
// bomDimensions itself keeps the exact same shape resolveFabricationWeight
// (above) already expects — { ...variant's own fixed values, length: mm }
// for perMeter/lookup categories, { thickness, area: mm2 } for sheets, with
// `designation` folded in for lookup categories (beam/channel) since that's
// how their weight is actually resolved (a section table, not a formula) —
// so every existing caller of resolveFabricationWeight(sourceItem,
// mat.bomDimensions, mat.bomDimensions.designation) keeps working unchanged.
// Returns null if the variant/category/amount can't be resolved (caller
// should 400) rather than silently producing a zero-weight line.
export function buildFabricationBomDimensions(sourceItem, dimensionVariantId, amountValue, amountUnit) {
  const variant = sourceItem.dimensionVariants?.id
    ? sourceItem.dimensionVariants.id(dimensionVariantId)
    : (sourceItem.dimensionVariants || []).find(v => String(v._id) === String(dimensionVariantId));
  if (!variant) return null;

  const category = getCategoryByKey(variant.category);
  if (!category) return null;

  if (category.calcType === 'sheet') {
    const areaMm2 = toMm2(amountValue, amountUnit);
    if (areaMm2 == null) return null;
    return { thickness: variant.values?.thickness, area: areaMm2 };
  }

  const lengthMm = toMm(amountValue, amountUnit);
  if (lengthMm == null) return null;
  const dims = { ...(variant.values || {}), length: lengthMm };
  if (category.calcType === 'lookup' && variant.designation) {
    dims.designation = variant.designation;
  }
  return dims;
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
