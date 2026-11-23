// Feature 20 (client, 21 Nov 2026, decision 2): R&D → Fabrication Master bulk import.
// docs/client-features-2026-11/20-bulk-import-logic.md §5–§7.
//
// One row per size; the rows of one entry share its Item Code (or its Item Name when
// the code is blank). Weights are worked out here with the page's own calculator —
// never taken from the file. New entries only; check first, then all or nothing.
import mongoose from 'mongoose';
import FabricationMaster from '../../models/FabricationMaster.js';
import FabricationMaterial from '../../models/FabricationMaterial.js';
import { Item, UnitType } from '../../models/Inventory.js';
import { FABRICATION_CATEGORIES, MATERIAL_DENSITY_TABLE, DEFAULT_DENSITY_KG_M3, getCategoryByKey } from '../../utils/fabricationCategories.js';
import { getSectionTable } from '../../utils/steelSectionTables.js';
import { calculateFabricationWeight } from '../../utils/fabricationWeightCalc.js';
import { dimensionSignature } from '../fabricationDemandService.js';
import { MAX_ROWS, ImportError, text, matchIn, num, readSheet, workbook, listColumns, sortProblems } from './common.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

// The 16 size fields any category uses (FABRICATION_CATEGORIES), with plain titles.
const SIZE_TITLES = {
  thickness: 'Thickness (mm)', width: 'Width (mm)', length: 'Length (mm)', od: 'Outside Diameter (mm)', wallThickness: 'Wall Thickness (mm)',
  side: 'Side (mm)', height: 'Height (mm)', diameter: 'Diameter (mm)', af: 'Across Flats (mm)', legLength: 'Leg Length (mm)',
  legA: 'Leg A (mm)', legB: 'Leg B (mm)', sideA: 'Side A (mm)', sideB: 'Side B (mm)', thicknessT: 'Thickness T (mm)', thicknessS: 'Thickness S (mm)',
};
const SIZE_KEYS = [...new Set(FABRICATION_CATEGORIES.flatMap((c) => c.fields.map((f) => f.key)))];

export const COLUMNS = [
  { key: 'itemName', title: 'Item Name *', required: true, help: 'The same on every size row of one entry.' },
  { key: 'itemCode', title: 'Item Code', help: 'Blank: the next code from the name (e.g. ANG-013). Typed: unused as a Fabrication Master code and as any Inventory code.' },
  { key: 'category', title: 'Category *', required: true, help: 'One of the 20 shapes (sheet "Categories": its key or its name).' },
  { key: 'material', title: 'Material', help: 'From the list (sets the density). Material or Density is required.' },
  { key: 'density', title: 'Density', help: 'Optional: overrides the material\'s density, as the page allows.' },
  { key: 'densityUnit', title: 'Density unit', help: 'kg/m3 (default) or g/cm3.' },
  { key: 'isSheetMetal', title: 'Sheet Metal', help: 'Yes or No (default No).' },
  { key: 'purchaseUnitType', title: 'Purchase Unit Type *', help: 'Required, with its unit.' },
  { key: 'purchaseUnit', title: 'Purchase Unit *', help: 'A unit of the Purchase Unit Type.' },
  { key: 'usedUnitType', title: 'Used Unit Type *', help: 'Required, with its unit.' },
  { key: 'usedUnit', title: 'Used Unit *', help: 'A unit of the Used Unit Type.' },
  { key: 'receiveUnitType', title: 'Receive Unit Type *', help: 'Required, with its unit (usually Pieces).' },
  { key: 'receiveUnit', title: 'Receive Unit *', help: 'A unit of the Receive Unit Type.' },
  { key: 'designation', title: 'Designation', help: 'Only for the 6 standard-table shapes (beams, channels): a size from sheet "Designations", e.g. IPE 200.' },
  ...SIZE_KEYS.map((k) => ({ key: k, title: SIZE_TITLES[k] || `${k} (mm)`, help: 'Only the fields this category uses (sheet "Categories"); a number above 0. Others blank.' })),
];
const TITLE = Object.fromEntries(COLUMNS.map((c) => [c.key, c.title.replace(/\s*\*$/, '')]));
const ENTRY_KEYS = ['itemName', 'category', 'material', 'density', 'densityUnit', 'isSheetMetal', 'purchaseUnitType', 'purchaseUnit', 'usedUnitType', 'usedUnit', 'receiveUnitType', 'receiveUnit'];

/** "Angle" → "ANG", the page's prefix rule (fabricationMasterController.derivePrefix). */
const derivePrefix = (name) => (String(name || '').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase()) || 'ITM';

async function lists(companyId) {
  const cid = oid(companyId);
  const [custom, units] = await Promise.all([
    FabricationMaterial.find({ company: cid }).select('name densityKgM3').sort({ name: 1 }).lean(),
    UnitType.find({ companyId: cid }).select('name units').sort({ name: 1 }).lean(),
  ]);
  return {
    materials: [
      ...MATERIAL_DENSITY_TABLE.map((m) => ({ names: [m.label, m.key], label: m.label, density: m.densityKgM3 })),
      ...custom.map((m) => ({ names: [m.name], label: m.name, density: m.densityKgM3 })),
    ],
    unitTypes: units.map((u) => ({ name: u.name, units: u.units || [] })),
  };
}

/** The template: Sizes (headers), How to fill, Categories, Designations, Lists. */
export async function buildTemplate(companyId) {
  const L = await lists(companyId);
  const lookups = FABRICATION_CATEGORIES.filter((c) => c.calcType === 'lookup');
  const designations = {};
  for (const c of lookups) designations[`${c.label} (${c.key})`] = getSectionTable(c.lookupFamily).map((d) => d.designation);
  const listSheet = { Material: L.materials.map((m) => `${m.label}`), 'Density (kg/m3)': L.materials.map((m) => m.density), 'Density unit': ['kg/m3', 'g/cm3'], 'Sheet Metal': ['Yes', 'No'] };
  for (const u of L.unitTypes) listSheet[`Units: ${u.name}`] = u.units;
  const how = [
    ['How to fill the Fabrication Master import'],
    ['One row per SIZE on the "Sizes" sheet. The rows of one entry share its Item Code (or, when the code is blank, its Item Name); its name, category, material, units and Sheet Metal must be the same on each of its rows.'],
    ['For each row, fill only the size fields its category uses (sheet "Categories"); leave the others blank. The weight per piece is worked out on upload, with the same calculator as the page.'],
    ['Upload: every row is checked first. If any row has a problem, nothing is imported and every problem is listed by row and column.'],
    ['New entries only: an existing code is a problem (add sizes to it on the page). Import these first, then the Inventory file that links to them.'],
    [`Up to ${MAX_ROWS} rows per file.`],
    [],
    ['Column', 'Rule'],
    ...COLUMNS.map((c) => [c.title, c.help]),
    [],
    ['Example (a sheet in two sizes)'],
    ['Item Name: MS Sheet 2mm · Category: sheet_plate · Material: MS (Mild Steel) · Thickness 2, Width 1250, Length 2500 → 49.06 kg a piece; next row the same with Width 1000 → 39.25 kg.'],
  ];
  const catRows = [['Category key', 'Name', 'Size fields to fill', 'Designation?'],
    ...FABRICATION_CATEGORIES.map((c) => [c.key, c.label, c.fields.map((f) => `${SIZE_TITLES[f.key] || f.key}`).join(', '), c.calcType === 'lookup' ? 'Yes (sheet Designations)' : ''])];
  return workbook([
    { name: 'Sizes', rows: [COLUMNS.map((c) => c.title)], widths: COLUMNS.map((c) => Math.max(12, c.title.length + 2)) },
    { name: 'How to fill', rows: how, widths: [26, 120] },
    { name: 'Categories', rows: catRows, widths: [20, 42, 70, 24] },
    { name: 'Designations', rows: listColumns(designations), widths: Object.keys(designations).map(() => 26) },
    { name: 'Lists', rows: listColumns(listSheet), widths: Object.keys(listSheet).map((k) => Math.max(16, k.length + 2)) },
  ]);
}

/** Checks every row; saves nothing. Returns { problems, docs, preview, counts, total }. */
export async function check(companyId, buffer) {
  const { rows, fileProblems } = readSheet(buffer, 'Sizes', COLUMNS);
  if (fileProblems.length) return { problems: fileProblems.map((m) => ({ row: null, column: '', message: m })), docs: [], preview: [], counts: { entries: 0, sizes: 0 }, total: rows.length };
  const cid = oid(companyId);
  const L = await lists(companyId);
  const problems = [];
  const bad = (row, key, message) => problems.push({ row, column: TITLE[key] || key || '', message });
  const unitTypeOf = (name) => L.unitTypes.find((u) => u.name.toLowerCase() === text(name).toLowerCase()) || null;
  const categoryOf = (v) => getCategoryByKey(text(v)) || FABRICATION_CATEGORIES.find((c) => c.key.toLowerCase() === text(v).toLowerCase() || c.label.toLowerCase() === text(v).toLowerCase()) || null;

  // Codes are global in both collections: index-only reads, compared in memory.
  const [fmCodes, itemCodes] = await Promise.all([
    FabricationMaster.find({}, { itemCode: 1, _id: 0 }).hint({ itemCode: 1 }).lean(),
    Item.find({}, { code: 1, _id: 0 }).hint({ code: 1 }).lean(),
  ]);
  const fmLower = new Set(fmCodes.map((x) => String(x.itemCode).toLowerCase()));
  const itemLower = new Set(itemCodes.map((x) => String(x.code).toLowerCase()));
  const typedCodes = [...new Set(rows.map((r) => text(r.values.itemCode)).filter(Boolean))];
  const mine = typedCodes.length ? new Set((await FabricationMaster.find({ company: cid, itemCode: { $in: typedCodes.map((c) => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) } }).select('itemCode').lean()).map((m) => m.itemCode.toLowerCase())) : new Set();
  // New entries only: an entry with a blank code whose name the company already has would be
  // a second copy under a new code (e.g. the same file uploaded twice).
  const blankNames = [...new Set(rows.filter((r) => !text(r.values.itemCode) && text(r.values.itemName)).map((r) => text(r.values.itemName)))];
  const nameTaken = new Map(blankNames.length
    ? (await FabricationMaster.find({ company: cid, itemName: { $in: blankNames.map((nm) => new RegExp(`^${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) } }).select('itemName itemCode').lean())
      .map((m) => [m.itemName.toLowerCase(), m.itemCode])
    : []);

  // ── Rows → entries ──
  const entries = new Map(); // key → { first, rows: [], code, values (entry-level), sizes: [] }
  for (const r of rows) {
    const v = r.values;
    const code = text(v.itemCode), name = text(v.itemName);
    if (!name) { bad(r.row, 'itemName', 'Required.'); continue; }
    const k = code ? `c:${code.toLowerCase()}` : `n:${name.toLowerCase()}`;
    if (!entries.has(k)) entries.set(k, { first: r.row, rows: [], code, values: v, sizes: [], ok: true });
    const e = entries.get(k);
    e.rows.push(r);
    if (e.rows.length > 1) {
      for (const f of ENTRY_KEYS) {
        if (text(v[f]).toLowerCase() !== text(e.values[f]).toLowerCase()) bad(r.row, f, `Differs from row ${e.first} of the same entry ("${text(e.values[f]) || 'blank'}"): one entry has one ${TITLE[f]}.`);
      }
    }
  }

  // ── Per entry: the entry-level values, then each size ──
  const nextByPrefix = new Map();
  const nextCode = (name) => {
    const prefix = derivePrefix(name);
    if (!nextByPrefix.has(prefix)) {
      const re = new RegExp(`^${prefix}-(\\d+)$`);
      let max = 0;
      for (const c of [...fmCodes.map((x) => x.itemCode), ...itemCodes.map((x) => x.code), ...typedCodes]) {
        const m = String(c).match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      nextByPrefix.set(prefix, max);
    }
    const n = nextByPrefix.get(prefix) + 1;
    nextByPrefix.set(prefix, n);
    return `${prefix}-${String(n).padStart(3, '0')}`;
  };
  const docs = [], preview = [];
  let sizeCount = 0;
  for (const e of entries.values()) {
    const v = e.values, row = e.first;
    const before = problems.length;
    const category = categoryOf(v.category);
    if (!category) bad(row, 'category', text(v.category) ? `"${text(v.category)}" isn't a category (sheet "Categories").` : 'Required.');
    // Density: the material's, unless typed.
    let density = null, material = '';
    const mat = text(v.material);
    if (mat) {
      const m = L.materials.find((x) => x.names.some((n) => n.toLowerCase() === mat.toLowerCase()));
      if (!m) bad(row, 'material', `"${mat}" isn't in the material list (sheet "Lists"; add new ones on the page).`);
      else { material = m.label; density = { value: m.density, unit: 'kg/m3' }; }
    }
    const dv = num(v.density);
    const du = text(v.densityUnit) ? matchIn(v.densityUnit, ['kg/m3', 'g/cm3']) : 'kg/m3';
    if (text(v.densityUnit) && !du) bad(row, 'densityUnit', `"${text(v.densityUnit)}": kg/m3 or g/cm3.`);
    if (Number.isNaN(dv) || (dv != null && !(dv > 0))) bad(row, 'density', 'A number above 0.');
    else if (dv != null) density = { value: dv, unit: du || 'kg/m3' };
    if (!mat && dv == null) bad(row, 'material', 'Give a Material (it sets the density) or a Density.');
    const yn = text(v.isSheetMetal).toLowerCase();
    if (yn && !['yes', 'no', 'y', 'n'].includes(yn)) bad(row, 'isSheetMetal', `"${text(v.isSheetMetal)}": Yes or No.`);
    const units = {};
    for (const [t, u] of [['purchaseUnitType', 'purchaseUnit'], ['usedUnitType', 'usedUnit'], ['receiveUnitType', 'receiveUnit']]) {
      const ut = unitTypeOf(v[t]);
      if (!ut) { bad(row, t, text(v[t]) ? `"${text(v[t])}" isn't a unit type (sheet "Lists").` : 'Required (the inventory item linked to it needs it).'); continue; }
      const hit = matchIn(v[u], ut.units);
      if (hit == null) { bad(row, u, text(v[u]) ? `"${text(v[u])}" isn't a unit of ${ut.name}.` : 'Required.'); continue; }
      units[t] = ut.name; units[u] = hit;
    }
    // The code.
    let code = e.code;
    if (code) {
      const lower = code.toLowerCase();
      if (fmLower.has(lower)) bad(row, 'itemCode', mine.has(lower) ? `"${code}" already exists in Fabrication Master: add sizes to it on the page.` : `"${code}" is already used. Codes must be unique: choose another.`);
      else if (itemLower.has(lower)) bad(row, 'itemCode', `"${code}" is already used by an Inventory item. Codes must be unique: choose another.`);
    } else if (nameTaken.has(text(v.itemName).toLowerCase())) {
      bad(row, 'itemName', `Fabrication Master already has "${text(v.itemName)}" (${nameTaken.get(text(v.itemName).toLowerCase())}): add sizes to it on the page, or give this entry another name.`);
    }

    // Each size.
    const dims = [];
    const seen = new Map();
    for (const r of e.rows) {
      const rv = r.values;
      if (!category) break;
      const uses = new Set(category.fields.map((f) => f.key));
      const values = {};
      for (const k of SIZE_KEYS) {
        const n = num(rv[k]);
        if (!uses.has(k)) { if (text(rv[k])) bad(r.row, k, `Not used by ${category.label}: leave blank.`); continue; }
        if (n == null) bad(r.row, k, `Required for ${category.label}.`);
        else if (Number.isNaN(n) || !(n > 0)) bad(r.row, k, 'A number above 0.');
        else values[k] = n;
      }
      let designation = '';
      if (category.calcType === 'lookup') {
        const table = getSectionTable(category.lookupFamily).map((d) => d.designation);
        const hit = matchIn(rv.designation, table);
        if (!text(rv.designation)) bad(r.row, 'designation', `Required for ${category.label} (sheet "Designations").`);
        else if (hit == null) bad(r.row, 'designation', `"${text(rv.designation)}" isn't in the ${category.label} table (sheet "Designations").`);
        else designation = hit;
      } else if (text(rv.designation)) bad(r.row, 'designation', `Only for the standard-table shapes: leave blank for ${category.label}.`);
      if (Object.keys(values).length !== uses.size || (category.calcType === 'lookup' && !designation)) continue;
      const sig = `${designation}|${dimensionSignature(values)}`;
      if (seen.has(sig)) { bad(r.row, 'length', `The same size as row ${seen.get(sig)}.`); continue; }
      seen.set(sig, r.row);
      if (!density) continue;
      try {
        const w = calculateFabricationWeight(category.key, values, density.value, density.unit, designation);
        if (!(w.weightPerPieceKg > 0)) { bad(r.row, 'length', 'This size works out to no weight: check the numbers.'); continue; }
        dims.push({ values, designation, weightPerMeterKg: w.weightPerMeterKg, weightPerPieceKg: w.weightPerPieceKg, pieces: 1, pricePerKg: null, isDiscontinued: false, row: r.row });
      } catch (err) { bad(r.row, 'length', err.message); }
    }
    if (problems.length > before) continue;
    if (!code) code = nextCode(text(v.itemName));
    const doc = {
      itemName: text(v.itemName), itemCode: code, category: category.key,
      density: density || { value: DEFAULT_DENSITY_KG_M3, unit: 'kg/m3' }, material, isSheetMetal: yn === 'yes' || yn === 'y',
      dimensions: dims.map(({ row: _r, ...d }) => d),
      purchaseUnitType: units.purchaseUnitType, purchaseUnit: units.purchaseUnit, usedUnitType: units.usedUnitType, usedUnit: units.usedUnit,
      receiveUnitType: units.receiveUnitType, receiveUnit: units.receiveUnit,
      isDiscontinued: false, company: cid,
    };
    docs.push(doc);
    sizeCount += dims.length;
    if (preview.length < 50) {
      preview.push({ row, code, generated: !e.code, name: doc.itemName, category: category.label, material, sizes: dims.map((d) => ({ row: d.row, designation: d.designation, values: d.values, kg: r4(d.weightPerPieceKg) })) });
    }
  }
  return { problems: sortProblems(problems), docs, preview, counts: { entries: docs.length, sizes: sizeCount }, total: rows.length };
}

/** Checks again, then saves every entry or none. */
export async function importFile(companyId, user, buffer) {
  const c = await check(companyId, buffer);
  if (c.problems.length) {
    const e = new ImportError(400, 'The file has problems: nothing was imported.');
    e.problems = c.problems;
    throw e;
  }
  const ids = c.docs.map((d) => { d._id = new mongoose.Types.ObjectId(); d.createdBy = user._id; return d._id; });
  try {
    await FabricationMaster.insertMany(c.docs, { ordered: true });
  } catch (err) {
    await FabricationMaster.deleteMany({ _id: { $in: ids } });
    const dup = err?.code === 11000 || err?.writeErrors?.some?.((w) => w.code === 11000);
    throw new ImportError(409, dup
      ? 'A code in the file was taken while importing: nothing was imported. Check the file again.'
      : `Saving failed: nothing was imported (${err.message}).`);
  }
  return { imported: c.docs.length, sizes: c.counts.sizes, codes: c.docs.map((d) => d.itemCode) };
}
