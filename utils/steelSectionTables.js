// Designation -> standardized nominal weight (kg/m) for the 6 "Category 2"
// Fabrication Master shapes (Channels - GOST/UPN, Beams - IPN/IPE/HEA/HEB).
// These hot-rolled profiles have complex cross-sections (sloped flanges,
// root/toe radii) that aren't practical to compute from raw dimensions, so —
// same as any commercial steel weight calculator — their weight comes from
// the internationally standardized nominal weight table for that exact
// designation, not a formula.
//
// Values below are the standard published nominal weights (EN 10365 / DIN
// 1025-1 for IPN, DIN 1026 for UPN, GOST 8240-97 for GOST channels). They are
// NOT sourced from a client-provided table — spot-check against an
// authoritative supplier/mill table before relying on them for real
// costing/purchasing decisions.

export const SECTION_TABLES = {
  'gost-channels': [
    ['5', 4.84], ['6.5', 5.90], ['8', 7.05], ['10', 8.59], ['12', 10.4],
    ['14', 12.3], ['16', 14.2], ['16a', 15.3], ['18', 16.3], ['18a', 17.4],
    ['20', 18.4], ['22', 21.0], ['24', 24.0], ['27', 27.7], ['30', 31.8],
    ['33', 36.5], ['36', 41.9], ['40', 48.3],
  ],
  'upn-channels': [
    ['UPN 50', 5.59], ['UPN 65', 7.09], ['UPN 80', 8.64], ['UPN 100', 10.6],
    ['UPN 120', 13.4], ['UPN 140', 16.0], ['UPN 160', 18.8], ['UPN 180', 22.0],
    ['UPN 200', 25.3], ['UPN 220', 29.4], ['UPN 240', 33.2], ['UPN 260', 37.9],
    ['UPN 280', 41.8], ['UPN 300', 46.2], ['UPN 320', 59.5], ['UPN 350', 60.6],
    ['UPN 380', 63.1], ['UPN 400', 71.8],
  ],
  'ipn-beams': [
    ['IPN 80', 5.94], ['IPN 100', 8.34], ['IPN 120', 11.1], ['IPN 140', 14.3],
    ['IPN 160', 17.9], ['IPN 180', 21.9], ['IPN 200', 26.2], ['IPN 220', 31.1],
    ['IPN 240', 36.2], ['IPN 260', 41.9], ['IPN 280', 47.9], ['IPN 300', 54.2],
    ['IPN 320', 61.1], ['IPN 340', 68.0], ['IPN 360', 76.1], ['IPN 380', 84.0],
    ['IPN 400', 92.4], ['IPN 450', 115.0], ['IPN 500', 141.0], ['IPN 550', 166.0],
  ],
  'ipe-beams': [
    ['IPE 80', 6.0], ['IPE 100', 8.1], ['IPE 120', 10.4], ['IPE 140', 12.9],
    ['IPE 160', 15.8], ['IPE 180', 18.8], ['IPE 200', 22.4], ['IPE 220', 26.2],
    ['IPE 240', 30.7], ['IPE 270', 36.1], ['IPE 300', 42.2], ['IPE 330', 49.1],
    ['IPE 360', 57.1], ['IPE 400', 66.3], ['IPE 450', 77.6], ['IPE 500', 90.7],
    ['IPE 550', 106.0], ['IPE 600', 122.0],
  ],
  'hea-beams': [
    ['HEA 100', 16.7], ['HEA 120', 19.9], ['HEA 140', 24.7], ['HEA 160', 30.4],
    ['HEA 180', 35.5], ['HEA 200', 42.3], ['HEA 220', 50.5], ['HEA 240', 60.3],
    ['HEA 260', 68.2], ['HEA 280', 76.4], ['HEA 300', 88.3], ['HEA 320', 97.6],
    ['HEA 340', 105.0], ['HEA 360', 112.0], ['HEA 400', 125.0], ['HEA 450', 140.0],
    ['HEA 500', 155.0], ['HEA 550', 166.0], ['HEA 600', 178.0], ['HEA 650', 190.0],
    ['HEA 700', 204.0], ['HEA 800', 224.0], ['HEA 900', 252.0], ['HEA 1000', 272.0],
  ],
  'heb-beams': [
    ['HEB 100', 20.4], ['HEB 120', 26.7], ['HEB 140', 33.7], ['HEB 160', 42.6],
    ['HEB 180', 51.2], ['HEB 200', 61.3], ['HEB 220', 71.5], ['HEB 240', 83.2],
    ['HEB 260', 93.0], ['HEB 280', 103.0], ['HEB 300', 117.0], ['HEB 320', 127.0],
    ['HEB 340', 134.0], ['HEB 360', 142.0], ['HEB 400', 155.0], ['HEB 450', 171.0],
    ['HEB 500', 187.0], ['HEB 550', 199.0], ['HEB 600', 212.0], ['HEB 650', 225.0],
    ['HEB 700', 241.0], ['HEB 800', 262.0], ['HEB 900', 291.0], ['HEB 1000', 314.0],
  ],
};

export const getSectionTable = (family) =>
  (SECTION_TABLES[family] || []).map(([designation, weightPerMeterKg]) => ({ designation, weightPerMeterKg }));

export const getSectionWeightPerMeter = (family, designation) => {
  const row = (SECTION_TABLES[family] || []).find(([d]) => d === designation);
  return row ? row[1] : null;
};
