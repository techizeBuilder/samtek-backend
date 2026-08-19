// Single source of truth for Fabrication Master's shape categories — what
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
//
// `group` maps each precise key onto one of the 11 shape tiles the "Select
// Category" picker shows (Round Bar / Pipe / Square Bar / Hexagonal Bar /
// Square Tubing / Beam / T-Bar / Channel / Angle / Flat Bar / Sheet). Several
// keys share a group (e.g. pipe_circular + hss_circular both render as the
// "Pipe" tile) — see FABRICATION_CATEGORY_GROUPS below. Existing saved items
// keep using these same keys; `group` is purely a presentation grouping, so
// adding it is backward compatible.

export const FABRICATION_CATEGORIES = [
  {
    key: 'sheet_plate',
    label: 'Steel sheets and plates',
    group: 'sheet',
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
    group: 'pipe',
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
    group: 'pipe',
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
    group: 'square_tubing',
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
    group: 'square_tubing',
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
    group: 'round_bar',
    calcType: 'perMeter',
    formula: 'roundBar',
    fields: [
      { key: 'diameter', label: 'Diameter (D)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'square_bar',
    label: 'Square steel bars',
    group: 'square_bar',
    calcType: 'perMeter',
    formula: 'squareBar',
    fields: [
      { key: 'side', label: 'Side (A)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'hex_bar',
    label: 'Hexagonal steel bars',
    group: 'hex_bar',
    calcType: 'perMeter',
    formula: 'hexBar',
    fields: [
      { key: 'af', label: 'Across Flats (AF)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 't_bar',
    label: 'T-bars',
    group: 't_bar',
    calcType: 'perMeter',
    formula: 'tBar',
    fields: [
      { key: 'width', label: 'Flange Width (W)', unit: 'mm' },
      { key: 'height', label: 'Height (H)', unit: 'mm' },
      { key: 'thickness', label: 'Thickness (t)', unit: 'mm' },
      { key: 'length', label: 'Length (L)', unit: 'mm' },
    ],
  },
  {
    key: 'flat_bar',
    label: 'Flat bars',
    group: 'flat_bar',
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
    group: 'angle',
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
    group: 'angle',
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
    group: 'channel',
    calcType: 'lookup',
    lookupFamily: 'gost-channels',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'channel_upn',
    label: 'Channels - UPN',
    group: 'channel',
    calcType: 'lookup',
    lookupFamily: 'upn-channels',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_ipn',
    label: 'Beams - IPN',
    group: 'beam',
    calcType: 'lookup',
    lookupFamily: 'ipn-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_ipe',
    label: 'Beams - IPE',
    group: 'beam',
    calcType: 'lookup',
    lookupFamily: 'ipe-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_hea',
    label: 'Beams - HEA (IPBL)',
    group: 'beam',
    calcType: 'lookup',
    lookupFamily: 'hea-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
  {
    key: 'beam_heb',
    label: 'Beams - HEB (IPB)',
    group: 'beam',
    calcType: 'lookup',
    lookupFamily: 'heb-beams',
    fields: [{ key: 'length', label: 'Length (L)', unit: 'mm' }],
  },
];

export const getCategoryByKey = (key) => FABRICATION_CATEGORIES.find((c) => c.key === key) || null;

// The 11 shape tiles the "Select Category" picker renders, in screenshot
// order. No tile shows a "type" sub-picker — each resolves straight to
// fields:
//   - Pipe, Square Tubing, Angle each used to offer 2 backend keys with a
//     type dropdown between them (e.g. Square/Rectangular). Removed in favor
//     of always using the more GENERAL key, since it's a strict superset:
//     hss_rectangular(width,height,wallThickness) reduces to the
//     hss_square formula exactly when width === height; unequal_angle
//     (legA,legB,thickness) likewise reduces to equal_angle's formula when
//     legA === legB. So one field set now covers both cases with no picker.
//     (pipe_circular and hss_circular were already identical in fields AND
//     formula — just kept the one key.) The now-unreachable-from-the-picker
//     keys (hss_square, hss_rectangular's sibling hss_square, equal_angle,
//     hss_circular) are still defined below and still fully work for
//     editing/viewing pre-existing items saved under them.
//   - Beam and Channel are lookup categories (designation -> standardized
//     table weight, not computable from raw fields) so they can't be merged
//     the same way — instead the Dimension Calculator merges all of a
//     group's designation tables into ONE flat "Designation" dropdown
//     (see DimensionCalculatorModal.jsx), so there's still no separate type
//     picker even though `keys` here still lists all 4 (or 2) families.
export const FABRICATION_CATEGORY_GROUPS = [
  { key: 'round_bar', label: 'Round Bar', keys: ['round_bar'] },
  { key: 'pipe', label: 'Pipe', keys: ['pipe_circular'] },
  { key: 'square_bar', label: 'Square Bar', keys: ['square_bar'] },
  { key: 'hex_bar', label: 'Hexagonal Bar', keys: ['hex_bar'] },
  { key: 'square_tubing', label: 'Square Tubing', keys: ['hss_rectangular'] },
  { key: 'beam', label: 'Beam', keys: ['beam_ipn', 'beam_ipe', 'beam_hea', 'beam_heb'] },
  { key: 't_bar', label: 'T-Bar', keys: ['t_bar'] },
  { key: 'channel', label: 'Channel', keys: ['channel_gost', 'channel_upn'] },
  { key: 'angle', label: 'Angle', keys: ['unequal_angle'] },
  { key: 'flat_bar', label: 'Flat Bar', keys: ['flat_bar'] },
  { key: 'sheet', label: 'Sheet', keys: ['sheet_plate'] },
];

export const getGroupByKey = (key) => FABRICATION_CATEGORY_GROUPS.find((g) => g.key === key) || null;

export const DEFAULT_DENSITY_KG_M3 = 7850;

// Metal Density Table (kg/m³) — drives the Material dropdown in the
// Dimension Calculator. g/cm³ is just value/1000.
export const MATERIAL_DENSITY_TABLE = [
  { key: 'MS', label: 'MS (Mild Steel)', densityKgM3: 7850 },
  { key: 'GI', label: 'GI (Galvanized Iron)', densityKgM3: 7850 },
  { key: 'SS202', label: 'SS 202', densityKgM3: 7930 },
  { key: 'SS304', label: 'SS 304', densityKgM3: 8000 },
  { key: 'SS316', label: 'SS 316', densityKgM3: 8000 },
];
