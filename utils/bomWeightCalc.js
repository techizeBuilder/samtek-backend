import { convertBetweenUnits } from './unitConversion.js';

// Generalizes the exact 3-branch weight formula that already existed
// hand-duplicated in two places — client/src/utils/bomFieldFormat.js's
// bomMaterialTotalWeightKg (client) and rdController.js's private
// bomMaterialTotalWeight (server, PDF-only, never persisted) — into one
// shared, importable function usable both for a real BOM material-line
// object AND for a Sub Child Part's own pseudo-line (sourceItem/sourceQty/
// sourceUnit), by passing the same fields through this generic shape rather
// than a full material subdocument.
//
// 1. Fabrication line (fabricationWeightPerPieceKg set) — per-piece weight
//    (from calculateFabricationWeight, via resolveFabricationWeight) x qty.
// 2. Non-fabrication line whose Used Unit is Length/Area/Volume
//    (amountValue set) — requires unitWeightValue/unitWeightUnit/amountUnit
//    all present, else null; converts `quantity` (already the resolved
//    TOTAL amount in amountUnit) into unitWeightUnit's scale, then
//    unitWeightValue x convertedQty.
// 3. Flat Mass/Count Used Unit (no amountValue) — unitWeightValue x quantity,
//    or null if unitWeightValue was never set.
export function resolveLineWeightKg({ fabricationWeightPerPieceKg, quantity, unitWeightValue, unitWeightUnit, amountValue, amountUnit }) {
  if (fabricationWeightPerPieceKg != null) return fabricationWeightPerPieceKg * (quantity || 0);
  if (amountValue != null) {
    if (unitWeightValue == null || unitWeightValue === '' || !unitWeightUnit || !amountUnit) return null;
    const convertedQty = convertBetweenUnits(quantity || 0, amountUnit, unitWeightUnit);
    return convertedQty == null ? null : unitWeightValue * convertedQty;
  }
  return (unitWeightValue != null && unitWeightValue !== '') ? unitWeightValue * (quantity || 0) : null;
}
