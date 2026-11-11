// Sub Child Part raw material — the leftover measured when outsourced work
// comes back, and the shared helpers around it.
//
// Until outsource-v2 slice 8 (2026-10-21) this file also held the first-trip
// Store pull (whole sheet / cut piece / catalog / leftover / length) that
// Purchase's temporary "Mark sent" ran. Every send now goes through Dispatch:
// Store hands the material over (dispatchTripService.storeHandover), so that
// pull and its material picker are gone. What's left:
//   - HttpError — a tiny typed error used across the outsource code
//   - pushOrMergeLeftover — find-or-create a leftover size (Store's offcuts)
//   - captureFinalLeftover — an older whole-sheet send's leftover, measured
//     at the receive (a `holder` = { company, rawMaterial }: a job-work order
//     or a ProductionOrder hand-off)
import { dimensionSignature } from './fabricationDemandService.js';
import { calculateFabricationWeight } from '../utils/fabricationWeightCalc.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';
import { toMm } from '../utils/unitConversion.js';

// A tiny typed error so route handlers can just `throw` and their try/catch
// picks the right HTTP status instead of always 500.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Find-or-create an isLeftover:true variant for an offcut — same
// merge-by-exact-match logic transferFabricationMaterialToProduction uses.
// Used by captureFinalLeftover and Store's handover / receive
// (dispatchTripService).
export function pushOrMergeLeftover(sourceItem, sourceVariant, leftoverValues, pieceCount) {
  const existingLeftover = sourceItem.dimensionVariants.find(
    dv => dv.isLeftover && dimensionSignature(dv.values) === dimensionSignature(leftoverValues)
  );
  if (existingLeftover) {
    existingLeftover.subStock = (existingLeftover.subStock || 0) + Number(pieceCount);
    return leftoverValues;
  }
  const { weightPerMeterKg, weightPerPieceKg } = calculateFabricationWeight(
    sourceVariant.category, leftoverValues, sourceVariant.densityValue, sourceVariant.densityUnit
  );
  sourceItem.dimensionVariants.push({
    category: sourceVariant.category, values: leftoverValues, designation: sourceVariant.designation || '',
    densityValue: sourceVariant.densityValue, densityUnit: sourceVariant.densityUnit,
    weightPerMeterKg, weightPerPieceKg, subStock: Number(pieceCount), isLeftover: true,
  });
  return leftoverValues;
}

// Case 2 leftover capture, when the trip that carried the whole sheet comes
// back. Credits a new (or matching existing) isLeftover:true variant, same
// find-or-merge logic as pushOrMergeLeftover, mirroring confirmReturn's own
// crediting logic (inventoryController.js).
export async function captureFinalLeftover(holder, sourceItem, leftoverBody) {
  const sentVariant = sourceItem.dimensionVariants.id(holder.rawMaterial.sentDimensionVariantId);
  if (!sentVariant) throw new HttpError(400, 'Could not resolve the original catalog size this order was sent from.');
  const isSheet = getCategoryByKey(sentVariant.category)?.calcType === 'sheet';

  const { leftoverLengthValue, leftoverLengthUnit, leftoverWidthValue, leftoverWidthUnit } = leftoverBody || {};
  // 0 = nothing usable left over (2026-10-19 fix: the message always said
  // "enter 0 if there is none", but toMm(0) is null, so 0 was refused).
  if (leftoverLengthValue !== '' && leftoverLengthValue != null && Number(leftoverLengthValue) === 0) {
    holder.rawMaterial.leftoverCaptured = true;
    holder.rawMaterial.leftoverValues = null;
    return;
  }
  const lengthMm = toMm(leftoverLengthValue, leftoverLengthUnit);
  if (!lengthMm) {
    throw new HttpError(400, 'A measured leftover length is required to complete this order (enter 0 if there is none).');
  }
  let leftoverValues;
  if (isSheet) {
    const widthMm = toMm(leftoverWidthValue, leftoverWidthUnit);
    if (!widthMm) throw new HttpError(400, 'A measured leftover width is required for sheet metal.');
    leftoverValues = { thickness: sentVariant.values?.thickness, width: widthMm, length: lengthMm };
  } else {
    leftoverValues = { ...(sentVariant.values || {}), length: lengthMm };
  }
  pushOrMergeLeftover(sourceItem, sentVariant, leftoverValues, 1);
  holder.rawMaterial.leftoverCaptured = true;
  holder.rawMaterial.leftoverValues = leftoverValues;
  await sourceItem.save();
}
