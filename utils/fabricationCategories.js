// Single source of truth for Fabrication Master's 16 shape categories — what
// dimension fields each one needs, and how its weight is calculated.
// Consumed by fabricationMasterController.js (calc + validation) and served
// to the frontend via GET /api/fabrication-master/categories so the Add
// Fabrication Item form can render the right fields per category without
// duplicating this list client-side.
//
// calcType:
//   'sheet'    — total per-piece weight computed directly from the entered
//                fields (thickness x width x length), no separate length
//                multiplier.
//   'perMeter' — `formula` (see fabricationWeightCalc.js) returns kg/m from
//                the entered cross-section fields; total weight = kg/m x
//                (length in mm / 1000).
//   'lookup'   — weight/m comes from a standardized section table
//                (steelSectionTables.js, keyed by `lookupFamily`) picked via
//                a `designation` (e.g. "IPE 200"), not computed from fields.

export const FABRICATION_CATEGORIES = [
  {
    key: 'sheet_plate',
    label: 'Steel sheets and plates',
    calcType: 'sheet',
    fields: [
      { key: 'thickness', label: 'Thickness (t)', unit: 'mm' },
      { key: 'width', label: 'Width (W)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'pipe_circular',
    label: 'Seamless steel pipes - circular',
    calcType: 'perMeter',
    formula: 'pipeRing',
    fields: [
      { key: 'od', label: 'Outside Diameter (D)', unit: 'mm' },
      { key: 'wallThickness', label: 'Wall Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'hss_circular',
    label: 'Hollow structural sections - circular',
    calcType: 'perMeter',
    formula: 'pipeRing',
    fields: [
      { key: 'od', label: 'Outside Diameter (D)', unit: 'mm' },
      { key: 'wallThickness', label: 'Wall Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'hss_square',
    label: 'Hollow structural sections - square',
    calcType: 'perMeter',
    formula: 'hssSquare',
    fields: [
      { key: 'side', label: 'Outside Side (A)', unit: 'mm' },
      { key: 'wallThickness', label: 'Wall Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'hss_rectangular',
    label: 'Hollow structural sections - rectangular',
    calcType: 'perMeter',
    formula: 'hssRect',
    fields: [
      { key: 'width', label: 'Width (A)', unit: 'mm' },
      { key: 'height', label: 'Height (B)', unit: 'mm' },
      { key: 'wallThickness', label: 'Wall Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'round_bar',
    label: 'Round steel bars',
    calcType: 'perMeter',
    formula: 'roundBar',
    fields: [
      { key: 'diameter', label: 'Diameter (d)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'square_bar',
    label: 'Square steel bars',
    calcType: 'perMeter',
    formula: 'squareBar',
    fields: [
      { key: 'side', label: 'Side (A)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'flat_bar',
    label: 'Flat bars',
    calcType: 'perMeter',
    formula: 'flatBar',
    fields: [
      { key: 'width', label: 'Width (W)', unit: 'mm' },
      { key: 'thickness', label: 'Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'equal_angle',
    label: 'Equal angles',
    calcType: 'perMeter',
    formula: 'equalAngle',
    fields: [
      { key: 'legLength', label: 'Leg Length (A)', unit: 'mm' },
      { key: 'thickness', label: 'Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'unequal_angle',
    label: 'Unequal angles',
    calcType: 'perMeter',
    formula: 'unequalAngle',
    fields: [
      { key: 'legA', label: 'Long Leg (A)', unit: 'mm' },
      { key: 'legB', label: 'Short Leg (B)', unit: 'mm' },
      { key: 'thickness', label: 'Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'channel_gost',
    label: 'Channels - GOST',
    calcType: 'lookup',
    lookupFamily: 'gost-channels',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'channel_upn',
    label: 'Channels - UPN',
    calcType: 'lookup',
    lookupFamily: 'upn-channels',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_ipn',
    label: 'Beams - IPN',
    calcType: 'lookup',
    lookupFamily: 'ipn-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_ipe',
    label: 'Beams - IPE',
    calcType: 'lookup',
    lookupFamily: 'ipe-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_hea',
    label: 'Beams - HEA (IPBL)',
    calcType: 'lookup',
    lookupFamily: 'hea-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_heb',
    label: 'Beams - HEB (IPB)',
    calcType: 'lookup',
    lookupFamily: 'heb-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
];

export const getCategoryByKey = (key) => FABRICATION_CATEGORIES.find((c) => c.key === key) || null;

export const DEFAULT_DENSITY_KG_M3 = 7850;
