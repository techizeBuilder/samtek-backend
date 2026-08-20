// Pure weight-calculation math for Fabrication Master. Kept as the ONLY
// place this arithmetic happens (both the live-preview endpoint and the
// authoritative save-time recompute in fabricationMasterController.js call
// through here) so the two can never drift apart.
//
// All shape dimensions are entered in millimetres; `length` (mm) is the
// piece length for every category except sheet/plate (whose "length" is one
// of the three volume dimensions, not a separate multiplier).
import { getCategoryByKey } from './fabricationCategories.js';
import { getSectionWeightPerMeter } from './steelSectionTables.js';

export const densityToKgM3 = (value, unit) => (unit === 'g/cm3' ? Number(value) * 1000 : Number(value));

// BOM material lines (post amount+quantity redesign) supply `area` (mm²)
// directly instead of separate width/length — weight = thickness * area *
// density is exactly the same product as thickness * width * length, so
// this is a pure alternate input, not a different formula. Falls back to
// width*length for Fabrication Master catalog rows and old BOM data that
// still carry those keys instead.
const calcSheetWeightKg = ({ thickness, width, length, area }, densityKgM3) => {
  const areaMm2 = area !== undefined && area !== null && area !== ''
    ? Number(area) || 0
    : (Number(width) || 0) * (Number(length) || 0);
  return ((Number(thickness) || 0) * areaMm2) / 1e9 * densityKgM3;
};

const calcWeightPerMeterKg = (formula, values, densityKgM3) => {
  const k = densityKgM3 / 1e6; // matches the user's given 0.00785-style constants
  const v = (key) => Number(values[key]) || 0;
  switch (formula) {
    case 'pipeRing':
      return (v('od') - v('wallThickness')) * v('wallThickness') * Math.PI * k;
    case 'hssSquare':
      return 4 * (v('side') - v('wallThickness')) * v('wallThickness') * k;
    case 'hssRect':
      return 2 * (v('width') + v('height') - 2 * v('wallThickness')) * v('wallThickness') * k;
    case 'roundBar':
      return v('diameter') ** 2 * (Math.PI / 4) * k;
    case 'squareBar':
      return v('side') ** 2 * k;
    case 'flatBar':
      return v('width') * v('thickness') * k;
    case 'equalAngle':
      return (2 * v('legLength') - v('thickness')) * v('thickness') * k;
    case 'unequalAngle':
      return (v('legA') + v('legB') - v('thickness')) * v('thickness') * k;
    case 'hexBar':
      // Regular hexagon, across-flats width `af`: area = (sqrt(3)/2) * af^2
      return v('af') ** 2 * (Math.sqrt(3) / 2) * k;
    case 'tBar':
      // Flange (width x thickness) + web ((height - thickness) x thickness),
      // same "two overlapping rectangles" shape as unequalAngle above.
      return (v('width') + v('height') - v('thickness')) * v('thickness') * k;
    case 'iBeamChannel':
      // Two flanges (Side B x Thickness S each) + a web connecting them
      // ((Side A - 2 x Thickness S) x Thickness T) — an I/H-beam and a
      // C/U-channel share this exact cross-section shape for area purposes.
      return (2 * v('sideB') * v('thicknessS') + (v('sideA') - 2 * v('thicknessS')) * v('thicknessT')) * k;
    default:
      throw new Error(`Unknown formula: ${formula}`);
  }
};

/**
 * @param {string} categoryKey one of FABRICATION_CATEGORIES[].key
 * @param {object} values raw field values entered for this dimension row (mm)
 * @param {number} densityValue
 * @param {'kg/m3'|'g/cm3'} densityUnit
 * @param {string} [designation] required for calcType 'lookup'
 * @returns {{ weightPerMeterKg: number|null, weightPerPieceKg: number }}
 */
export function calculateFabricationWeight(categoryKey, values, densityValue, densityUnit, designation) {
  const category = getCategoryByKey(categoryKey);
  if (!category) throw new Error(`Unknown fabrication category: ${categoryKey}`);
  const densityKgM3 = densityToKgM3(densityValue, densityUnit);
  const safeValues = values && typeof values === 'object' ? values : {};

  if (category.calcType === 'sheet') {
    const weightPerPieceKg = calcSheetWeightKg(safeValues, densityKgM3);
    return { weightPerMeterKg: null, weightPerPieceKg };
  }

  if (category.calcType === 'perMeter') {
    const weightPerMeterKg = calcWeightPerMeterKg(category.formula, safeValues, densityKgM3);
    const lengthMm = Number(safeValues.length) || 0;
    const weightPerPieceKg = weightPerMeterKg * (lengthMm / 1000);
    return { weightPerMeterKg, weightPerPieceKg };
  }

  if (category.calcType === 'lookup') {
    if (!designation) throw new Error('Designation is required for this category');
    const weightPerMeterKg = getSectionWeightPerMeter(category.lookupFamily, designation);
    if (weightPerMeterKg === null) throw new Error(`Unknown designation "${designation}" for ${category.lookupFamily}`);
    const lengthMm = Number(safeValues.length) || 0;
    const weightPerPieceKg = weightPerMeterKg * (lengthMm / 1000);
    return { weightPerMeterKg, weightPerPieceKg };
  }

  throw new Error(`Unknown calcType for category ${categoryKey}`);
}
