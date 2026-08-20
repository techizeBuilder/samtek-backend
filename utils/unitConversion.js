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
