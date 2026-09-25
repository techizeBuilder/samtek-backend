// Canonical-unit conversion for BOM material consumption amounts (length for
// every fabrication shape except sheets, area for sheets) — mirrors the
// MASS_UNIT_TO_KG_MULTIPLIER precedent in itemPricingService.js. Unit name
// strings match the "Length Unit"/"Area Unit" UnitType seed data exactly
// (inventoryController.js's default UnitType seeding), so no new UnitType
// entries are needed — this just adds the numeric conversion those existing
// dropdown values didn't have yet.
export const LENGTH_UNIT_TO_MM = {
  Millimeter: 1,
  Centimeter: 10,
  Meter: 1000,
  Kilometer: 1e6,
  Inch: 25.4,
  Foot: 304.8,
};

export const AREA_UNIT_TO_MM2 = {
  'Millimeter Square': 1,
  'Centimeter Square': 100,
  'Meter Square': 1e6,
  'Inch Square': 645.16,
  'Foot Square': 92903.04,
};

// Volume — same precedent, canonical base is milliliters (= cm³). Unit name
// strings match the "Volume Unit" UnitType seed data exactly.
export const VOLUME_UNIT_TO_ML = {
  'Centimeter Cube': 1,
  'Meter Cube': 1e6,
  'Liter': 1000,
  'Inch Cube': 16.387064,
  'Foot Cube': 28316.846592,
};

export function toMm(value, unit) {
  const multiplier = LENGTH_UNIT_TO_MM[unit];
  if (!multiplier || !(Number(value) > 0)) return null;
  return Number(value) * multiplier;
}

export function toMm2(value, unit) {
  const multiplier = AREA_UNIT_TO_MM2[unit];
  if (!multiplier || !(Number(value) > 0)) return null;
  return Number(value) * multiplier;
}

export function toMl(value, unit) {
  const multiplier = VOLUME_UNIT_TO_ML[unit];
  if (!multiplier || !(Number(value) > 0)) return null;
  return Number(value) * multiplier;
}

// Converts `value` from `fromUnit` to `toUnit` when both belong to the same
// Length/Area/Volume category (found by checking which of the three tables
// above contains both unit names) — e.g. a BOM line's amount in Millimeter
// against an Inventory item's weight rate defined per Meter. Returns null
// (never a guessed number) when either unit is unknown or they're not in the
// same category — callers must treat that as "can't convert."
const UNIT_CATEGORY_TABLES = [LENGTH_UNIT_TO_MM, AREA_UNIT_TO_MM2, VOLUME_UNIT_TO_ML];
export function convertBetweenUnits(value, fromUnit, toUnit) {
  if (!(Number(value) >= 0) || !fromUnit || !toUnit) return null;
  if (fromUnit === toUnit) return Number(value);
  for (const table of UNIT_CATEGORY_TABLES) {
    if (table[fromUnit] && table[toUnit]) {
      return (Number(value) * table[fromUnit]) / table[toUnit];
    }
  }
  return null;
}
