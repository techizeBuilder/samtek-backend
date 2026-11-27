// Feature 20 (client, 21 Nov 2026): R&D → Inventory bulk import (the Inventory tab's
// plain items: raw materials, bought parts, tools, fabrication items).
// docs/client-features-2026-11/20-bulk-import-logic.md §1–§4, §6–§7.
//
// Template → check (every rule the Add Item form and createItem apply, nothing saved)
// → import: all rows together or none (decision 3). A fabrication row links an
// existing Fabrication Master entry and copies it like the form's picker (decision 1).
// Purchasable items with a Material Flow wait for Store's first stock count before
// the low-stock sweep reorders them (decision K, Item.awaitingFirstCount).
import mongoose from 'mongoose';
import { Item, UnitType } from '../../models/Inventory.js';
import InventoryMasterOption from '../../models/InventoryMasterOption.js';
import RDMasterOption from '../../models/RDMasterOption.js';
import FabricationMaster from '../../models/FabricationMaster.js';
import notificationService from '../notificationService.js';
import { exactRe } from '../itemCodeService.js';
import { needsProductionUse } from '../serialTrailService.js';
import { validateItemData, sanitizeItemData, productionUseProblem } from '../../controllers/inventoryController.js';
import { MAX_ROWS, ImportError, text, matchIn, num, readSheet, workbook, listColumns, sortProblems } from './common.js';
import { codeKeeper, nextNumbered, derivePrefix } from './codes.js'; // feature 35

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const FABRICATION = 'Fabrication Item'; // the form's fixed Item Process Type (not a master option)
const AMOUNT_UNIT_TYPES = ['Length Unit', 'Area Unit', 'Volume Unit'];
const FLOWS = ['High Flow', 'Medium Flow', 'Low Flow'];
const FLOW_MIN = { 'High Flow': 20, 'Medium Flow': 10, 'Low Flow': 5 };
const USES = { 'built into the product': 'BuiltIn', builtin: 'BuiltIn', 'used to make the product': 'UsedToMake', usedtomake: 'UsedToMake' };
const DIM_UNITS = ['Inch', 'MM', 'Feet', 'Meter'];
const DIMS = [['length', 'Length'], ['height', 'Height'], ['width', 'Width'], ['diaOD', 'Dia (OD)'], ['diaID', 'Dia (ID)'], ['thickness', 'Thickness']];

// 22 Nov 2026 (the user's call): the columns a fabrication row takes from its Fabrication
// Master say so in their header. A value typed there anyway isn't used; the check lists the
// ones that differ from the master (fromMaster). Older headers still read (aliases); problems
// are shown under the short label.
const NOT_FAB = ' (not for fabrication)';
const notFab = (c) => ({
  ...c, title: c.title + NOT_FAB, label: c.label || c.title.replace(/\s*\*$/, ''), aliases: [c.title, ...(c.aliases || [])],
  help: `${c.help} Fabrication row: comes from the Fabrication Master, so leave it blank; a value here isn't used (the check lists any that differ from the master).`,
});

/** The Items sheet, in the Add Item form's order. */
export const COLUMNS = [
  { key: 'itemType', title: 'Item Type', help: 'From the list (optional). A value not in the list yet is added to it on import (the check shows it first).' },
  // 22 Nov: the two columns the form shows only sometimes say so in their header; the
  // older headers still read (aliases). `label` is the short name problems are shown under.
  { key: 'jobWorkType', title: 'Job Work Type (only for Job Work)', label: 'Job Work Type', aliases: ['Job Work Type'],
    help: 'Only when Item Type is "Job Work" (the form shows it only then): which outside service, e.g. Powder Coating. From the list, or a new value. Leave blank on other rows.' },
  { key: 'itemProcessType', title: 'Item Process Type', help: '"Fabrication Item" makes the row a fabrication item (see below). Others: from the list, or a new value.' },
  { key: 'fabricationCode', title: 'Fabrication Master Code (fabrication only)', label: 'Fabrication Master Code', aliases: ['Fabrication Master Code'], help: 'Fabrication rows only (required there): the Fabrication Master entry\'s code.' },
  { key: 'name', title: 'Item Name * (fabrication: blank = from master)', label: 'Item Name', aliases: ['Item Name *'], required: true, help: 'At least 2 characters. Fabrication row: blank takes the master\'s name.' },
  // Feature 35 (27 Nov 2026): a blank code is made on import (normal items), as Fabrication Master does.
  { key: 'code', title: 'Item Code (blank = made)', label: 'Item Code', aliases: ['Item Code * (fabrication: blank = from master)', 'Item Code *'], required: true,
    help: 'Typed: unused anywhere (any letter case), not repeated in the file. Blank on a normal item: made on import from the name\'s first 3 letters and the next number (Bearing 6205 → BEA-001), never one that is already used. Fabrication row: blank takes the master\'s code.' },
  { key: 'modelNumber', title: 'Model Number', help: 'Free text.' },
  { key: 'brand', title: 'Brand Name', help: 'Free text.' },
  { key: 'itemCategories', title: 'Item Category', help: 'One or more, separated by commas. A value not in the list yet is added to it on import (the check shows it first).' },
  { key: 'sourceType', title: 'Source Type', help: 'From the list. A value not in the list yet is added to it on import (the check shows it first).' },
  { key: 'itemSourceType', title: 'Item Source Type', help: 'From the list. A value not in the list yet is added to it on import (the check shows it first).' },
  { key: 'metrology', title: 'Metrology', help: 'From the list. A value not in the list yet is added to it on import (the check shows it first).' },
  notFab({ key: 'materialGrade', title: 'Material Grade', help: 'From the list, or a new value.' }),
  notFab({ key: 'unitWeightValue', title: 'Unit Weight (kg)', help: 'A number, 0 or more.' }),
  notFab({ key: 'unitWeightUnit', title: 'Unit Weight per', help: 'Only for a Length / Area / Volume Used Unit: the unit the kg is per (e.g. Meter). Blank = the Used Unit.' }),
  { key: 'purchaseOrMake', title: 'Purchase or Make *', required: true, help: 'Purchase (the form\'s "Purchasable (Vendor)") or Make (the form\'s "Internal Manufacturing").' },
  notFab({ key: 'purchaseUnitType', title: 'Purchase Unit Type', help: 'Required for Purchase.' }),
  notFab({ key: 'purchaseUnit', title: 'Purchase Unit', help: 'A unit of the Purchase Unit Type.' }),
  notFab({ key: 'unitType', title: 'Used Unit Type *', help: 'Required.' }),
  notFab({ key: 'unit', title: 'Used Unit *', help: 'A unit of the Used Unit Type.' }),
  { key: 'productionUse', title: 'How is it used in production? (piece items)', label: 'How is it used in production?', aliases: ['Used in production', 'How is it used in production?'],
    help: 'The form asks this only when the Used Unit counts pieces, and then it is required. "Built into the product": it goes inside what the customer receives (e.g. a motor, bearing, switch). "Used to make the product": used while building but not delivered (e.g. a grinding wheel, cutter, jig). Leave blank for other units.' },
  ...DIMS.flatMap(([k, label]) => [
    notFab({ key: k, title: label, help: 'A number (optional).' }),
    notFab({ key: `${k}Unit`, title: `${label} unit`, help: 'Inch, MM, Feet or Meter.' }),
  ]),
  { key: 'materialFlow', title: 'Material Flow', help: 'Required for Purchase: High Flow, Medium Flow or Low Flow.' },
  { key: 'minStock', title: 'Min Stock', help: 'Blank = the flow\'s usual figure (20 / 10 / 5). Fabrication row: whole pieces, for every size.' },
  { key: 'reorderQty', title: 'Order Quantity', help: '0 or more. Fabrication row: whole pieces.' },
  { key: 'status', title: 'Item Status', help: 'Continue (default) or Discontinue, as on the form.' },
  { key: 'description', title: 'Description', help: 'Free text.' },
];
// A fabrication row's columns that come from its Fabrication Master.
const FROM_MASTER = ['materialGrade', 'unitWeightValue', 'unitWeightUnit', 'purchaseUnitType', 'purchaseUnit', 'unitType', 'unit', ...DIMS.flatMap(([d]) => [d, `${d}Unit`])];
const TITLE = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label || c.title.replace(/\s*\*$/, '')]));
// The dropdown list behind each list column: [field, which collection].
const LIST_FIELD = {
  itemType: ['ItemType', 'inventory'], jobWorkType: ['JobWorkType', 'inventory'], itemProcessType: ['ItemProcessType', 'inventory'],
  itemCategories: ['ItemCategory', 'inventory'], sourceType: ['SourceType', 'inventory'], itemSourceType: ['ItemSourceType', 'inventory'],
  metrology: ['Metrology', 'rd'], materialGrade: ['MaterialGrade', 'rd'],
};
// validateItemData's field names → the column a problem is shown under.
const FIELD_COLUMN = { name: 'name', unit: 'unit', qty: 'minStock', minStock: 'minStock', reorderQty: 'reorderQty', productionUse: 'productionUse', type: 'itemType', importance: 'itemType' };

/** The company's dropdown lists, read once per check. */
async function companyLists(companyId) {
  const cid = oid(companyId);
  const [inv, rd, units] = await Promise.all([
    InventoryMasterOption.find({ companyId: cid }).select('field value').lean(),
    RDMasterOption.find({ company: cid, field: { $in: ['Metrology', 'MaterialGrade'] } }).select('field value').lean(),
    UnitType.find({ companyId: cid }).select('name units').sort({ name: 1 }).lean(),
  ]);
  const of = (rows, field) => [...new Set(rows.filter((o) => o.field === field).map((o) => o.value))].sort((a, b) => a.localeCompare(b));
  return {
    itemType: of(inv, 'ItemType'),
    itemProcessType: [FABRICATION, ...of(inv, 'ItemProcessType').filter((v) => v.toLowerCase() !== FABRICATION.toLowerCase())],
    itemCategory: of(inv, 'ItemCategory'),
    sourceType: of(inv, 'SourceType'),
    itemSourceType: of(inv, 'ItemSourceType'),
    jobWorkType: of(inv, 'JobWorkType'),
    metrology: of(rd, 'Metrology'),
    materialGrade: of(rd, 'MaterialGrade'),
    unitTypes: units.map((u) => ({ name: u.name, units: u.units || [] })),
  };
}

/** The template: Items (headers only), How to fill, Lists (live from the company). */
export async function buildTemplate(companyId) {
  const L = await companyLists(companyId);
  const lists = {
    'Item Type': L.itemType, 'Job Work Type': L.jobWorkType, 'Item Process Type': L.itemProcessType, 'Item Category': L.itemCategory,
    'Source Type': L.sourceType, 'Item Source Type': L.itemSourceType, Metrology: L.metrology, 'Material Grade': L.materialGrade,
    'Purchase or Make': ['Purchase', 'Make'], 'How is it used in production?': ['Built into the product', 'Used to make the product'],
    'Material Flow': FLOWS, 'Size unit': DIM_UNITS, 'Item Status': ['Continue', 'Discontinue'],
  };
  for (const u of L.unitTypes) lists[`Units: ${u.name}`] = u.units;
  const example = {
    itemType: L.itemType[0] || '', name: 'Hex Bolt M10 x 40', code: 'HB-M10-40', brand: '', purchaseOrMake: 'Purchase',
    purchaseUnitType: L.unitTypes.find((u) => /count|number|quantity|piece/i.test(u.name))?.name || L.unitTypes[0]?.name || '',
    unitType: L.unitTypes.find((u) => /count|number|quantity|piece/i.test(u.name))?.name || L.unitTypes[0]?.name || '',
    productionUse: 'Built into the product', materialFlow: 'Medium Flow', minStock: '', reorderQty: 50, status: 'Continue',
  };
  const pieceUnit = (t) => L.unitTypes.find((u) => u.name === t)?.units.find((x) => /piece|pcs|nos/i.test(x)) || '';
  example.purchaseUnit = pieceUnit(example.purchaseUnitType);
  example.unit = pieceUnit(example.unitType);
  const how = [
    ['How to fill the R&D Inventory import'],
    ['One row per item on the "Items" sheet. Keep the header row. Values for the list columns are on the "Lists" sheet (your company\'s own lists, as of the download). A value that isn\'t in its list yet is added to the list when you import; the check shows every new value first, so a typo can be fixed in the file. Unit types and units must already exist.'],
    ['Upload the file: every row is checked first. If any row has a problem, nothing is imported and every problem is listed by row and column. Fix the file and upload it again.'],
    ['New items only: a code that already exists is a problem (edit existing items on the form). Stock starts at 0, as with the form.'],
    ['Item Code left blank on a normal item: the system makes one on import, from the name\'s first 3 letters and the next free number (e.g. BEA-001), never a code that is already used or typed elsewhere in the file. The check shows each made code first, and the import lists them all with a Copy button.'],
    ['Fabrication items: first add (or import) the entry in Fabrication Master. Then a row with Item Process Type "Fabrication Item" and its Fabrication Master Code: name, code, units, sizes and weights come from the master. The columns marked "(not for fabrication)" come from the master too: leave them blank. If they are filled anyway, they are not used, and the check lists every value that differs from the master. Item Name and Item Code may be left blank to take the master\'s.'],
    ['Purchasable items with a Material Flow are not reordered until Store records their stock once (stock audit). Store sees them under "Waiting for first stock count".'],
    [`Up to ${MAX_ROWS} rows per file.`],
    [],
    ['Column', 'Rule', 'Example'],
    ...COLUMNS.map((c) => [c.title, c.help, example[c.key] ?? '']),
  ];
  return workbook([
    { name: 'Items', rows: [COLUMNS.map((c) => c.title)], widths: COLUMNS.map((c) => Math.max(12, c.title.length + 2)) },
    { name: 'How to fill', rows: how, widths: [44, 110, 24] },
    { name: 'Lists', rows: listColumns(lists), widths: Object.keys(lists).map((k) => Math.max(16, k.length + 2)) },
  ]);
}

/**
 * Checks every row; saves nothing. Returns { problems, docs, preview, counts, total }.
 * docs are ready for Item.insertMany (sanitized like createItem).
 */
export async function check(companyId, buffer) {
  const { rows, fileProblems } = readSheet(buffer, 'Items', COLUMNS);
  if (fileProblems.length) return { problems: fileProblems.map((m) => ({ row: null, column: '', message: m })), docs: [], preview: [], counts: { items: 0, fabrication: 0, held: 0 }, total: rows.length };
  const cid = oid(companyId);
  const L = await companyLists(companyId);
  const problems = [];
  const bad = (row, key, message) => problems.push({ row, column: TITLE[key] || key || '', message });
  const unitTypeOf = (name) => L.unitTypes.find((u) => u.name.toLowerCase() === text(name).toLowerCase()) || null;

  // ── Batched reads: codes (global), twins (company), Fabrication Master entries ──
  const fabCodes = [...new Set(rows.map((r) => text(r.values.fabricationCode)).filter(Boolean))];
  // Codes are unique across the whole database in any letter case, so the check has to
  // see them all: one index-only read of the code index, compared in memory.
  const allCodes = await Item.find({}, { code: 1, _id: 0 }).hint({ code: 1 }).lean();
  const codeByLower = new Map(allCodes.map((x) => [String(x.code).toLowerCase(), x.code]));
  const masters = fabCodes.length ? await FabricationMaster.find({ company: cid, itemCode: { $in: fabCodes.map(exactRe) } }).lean() : [];
  const masterByLower = new Map(masters.map((m) => [m.itemCode.toLowerCase(), m]));
  const linked = masters.length ? await Item.find({ fabricationRef: { $in: masters.map((m) => m._id) } }).select('code fabricationRef').lean() : [];
  const linkedTo = new Map(linked.map((i) => [String(i.fabricationRef), i.code]));
  // A master's own code is the item's code when the row leaves it blank.
  const codeOfRow = (r) => text(r.values.code) || (text(r.values.fabricationCode) && masterByLower.get(text(r.values.fabricationCode).toLowerCase())?.itemCode) || '';
  const nameOfRow = (r) => text(r.values.name) || (text(r.values.fabricationCode) && masterByLower.get(text(r.values.fabricationCode).toLowerCase())?.itemName) || '';
  const names = [...new Set(rows.map(nameOfRow).filter(Boolean))];
  const twins = names.length ? await Item.find({
    $or: [{ companyId: cid }, { store: String(companyId) }], isDiscontinued: { $ne: true },
    productKind: { $nin: ['Machine', 'SubChildPart', 'ChildPart'] }, name: { $in: names.map(exactRe) },
  }).select('name code itemType type').lean() : [];
  const twinKey = (name, itemType, type) => `${text(name).toLowerCase()}|${text(itemType).toLowerCase()}|${text(type || 'Material').toLowerCase()}`;
  const twinOf = new Map(twins.map((t) => [twinKey(t.name, t.itemType, t.type), t.code]));
  const takenHolders = new Map();
  {
    const clash = [...new Set(rows.map(codeOfRow).filter((c) => codeByLower.has(c.toLowerCase())).map((c) => codeByLower.get(c.toLowerCase())))];
    if (clash.length) {
      for (const h of await Item.find({ code: { $in: clash } }).select('code name companyId isDiscontinued').lean()) takenHolders.set(h.code.toLowerCase(), h);
    }
  }
  // Feature 35 (27 Nov 2026): codes made for blank normal rows never take one that is used: every Item
  // code, every Fabrication Master code of the company (a fabrication item takes its master's code),
  // and every code the file types or brings from a master. services/bulkImport/codes.js
  const fmCodes = await FabricationMaster.find({ company: cid }).select('itemCode').lean();
  const keeper = codeKeeper([...allCodes.map((x) => x.code), ...fmCodes.map((m) => m.itemCode), ...rows.map(codeOfRow)]);

  // A value that isn't in its dropdown list yet is added to the list when the file is
  // imported (22 Nov 2026: default G changed by the user), and the check shows it first so
  // a typo can be fixed in the file. Letter case is ignored ("raw material" uses the existing
  // "Raw Material"); the first spelling in the file is the one added. Units stay strict.
  const added = new Map(); // `${field}|${lower}` → { key, field, scope, value, rows }
  const valueFor = (key, raw, list, row) => {
    const hit = matchIn(raw, list);
    if (hit != null) return hit;
    if (raw.length > 80) { bad(row, key, `"${raw.slice(0, 30)}…" is too long for a list value (80 characters at most).`); return ''; }
    const [field, scope] = LIST_FIELD[key];
    const k = `${field}|${raw.toLowerCase()}`;
    if (!added.has(k)) added.set(k, { key, field, scope, value: raw, rows: [] });
    const a = added.get(k);
    if (!a.rows.includes(row)) a.rows.push(row);
    return a.value;
  };

  const seenCode = new Map(), seenTwin = new Map(), seenMaster = new Map();
  const docs = [], preview = [], fromMaster = [], codes = [];
  let fabricationCount = 0, held = 0;
  for (const r of rows) {
    const v = r.values;
    const row = r.row;
    const before = problems.length;
    const pick = (key, list) => {
      const raw = text(v[key]);
      return raw ? valueFor(key, raw, list, row) : '';
    };

    // Kind of row.
    const processType = pick('itemProcessType', L.itemProcessType);
    const isFab = processType === FABRICATION;
    const fabCode = text(v.fabricationCode);
    let master = null;
    // found: the entry named in the row (for its name and code, even when it can't be used);
    // master: the entry this row links to.
    const found = isFab && fabCode ? masterByLower.get(fabCode.toLowerCase()) || null : null;
    if (isFab) {
      if (!fabCode) bad(row, 'fabricationCode', 'Required for a fabrication item: the Fabrication Master entry\'s code.');
      else {
        master = found;
        if (!master) bad(row, 'fabricationCode', `Fabrication Master "${fabCode}" not found: add it in Fabrication Master first (or import it there).`);
        else if (master.isDiscontinued) { bad(row, 'fabricationCode', `Fabrication Master "${master.itemCode}" is discontinued.`); master = null; }
        else if (linkedTo.has(String(master._id))) { bad(row, 'fabricationCode', `Fabrication Master "${master.itemCode}" is already used by item ${linkedTo.get(String(master._id))} (one item per entry).`); master = null; }
        else if (seenMaster.has(String(master._id))) { bad(row, 'fabricationCode', `Row ${seenMaster.get(String(master._id))} already uses Fabrication Master "${master.itemCode}" (one item per entry).`); master = null; }
        else seenMaster.set(String(master._id), row);
      }
      // 22 Nov (the user's call): these come from the master. A value typed anyway isn't used
      // (no problem), and one that differs from the master is listed so nobody is surprised.
      if (master) {
        const masterSays = { materialGrade: master.material, purchaseUnitType: master.purchaseUnitType, purchaseUnit: master.purchaseUnit, unitType: master.usedUnitType, unit: master.usedUnit };
        const differs = [];
        for (const k of FROM_MASTER) {
          const typed = text(v[k]);
          if (!typed) continue;
          if (k in masterSays) {
            const says = text(masterSays[k]);
            if (typed.toLowerCase() !== says.toLowerCase()) differs.push({ column: TITLE[k], typed, master: says || '(blank)' });
          } else differs.push({ column: TITLE[k], typed, master: null }); // weights and sizes: from the master's sizes
        }
        if (differs.length) fromMaster.push({ row, code: master.itemCode, columns: differs });
      }
    } else if (fabCode) {
      bad(row, 'fabricationCode', 'Only for a fabrication item (Item Process Type "Fabrication Item"). Leave blank.');
    }

    // Name and code.
    const name = text(v.name) || found?.itemName || '';
    let code = text(v.code) || found?.itemCode || '';
    // Feature 35: a blank code on a NORMAL item is made (a fabrication item takes its master's code).
    let made = false;
    if (!code && !isFab && name.length >= 2) { code = nextNumbered(keeper, derivePrefix(name)); made = true; }
    // A fabrication row whose entry isn't found: that problem already says it all.
    const quiet = isFab && !found;
    if (name.length < 2 && !(quiet && !name)) bad(row, 'name', name ? 'At least 2 characters.' : 'Required.');
    if (!code) { if (!quiet && !isFab) bad(row, 'code', 'Give the item a name, so its code can be made (or type a code).'); }
    else if (!made) {
      const lower = code.toLowerCase();
      if (seenCode.has(lower)) bad(row, 'code', `"${code}" is also on row ${seenCode.get(lower)}: codes must be unique.`);
      else {
        seenCode.set(lower, row);
        const h = takenHolders.get((codeByLower.get(lower) || '').toLowerCase());
        if (codeByLower.has(lower)) {
          bad(row, 'code', !h || String(h.companyId) !== String(companyId)
            ? `"${code}" is already used. Codes must be unique: choose another.`
            : h.isDiscontinued ? `"${code}" belongs to the discontinued item "${h.name}". Reactivate it, or choose another code.`
              : `"${code}" is already used by "${h.name}". Edit that item on the form instead.`);
        }
      }
    }

    // Lists.
    const itemType = pick('itemType', L.itemType);
    const isJobWork = itemType.toLowerCase() === 'job work';
    const jobWorkType = isJobWork ? pick('jobWorkType', L.jobWorkType) : '';
    if (!isJobWork && text(v.jobWorkType)) bad(row, 'jobWorkType', 'Only when Item Type is "Job Work". Leave blank.');
    const cats = text(v.itemCategories).split(',').map((x) => x.trim()).filter(Boolean);
    const itemCategories = [];
    for (const c of cats) {
      const hit = valueFor('itemCategories', c, L.itemCategory, row);
      if (hit && !itemCategories.includes(hit)) itemCategories.push(hit);
    }
    const sourceType = pick('sourceType', L.sourceType);
    const itemSourceType = pick('itemSourceType', L.itemSourceType);
    const metrology = pick('metrology', L.metrology);
    const materialGrade = isFab ? (master?.material || '') : pick('materialGrade', L.materialGrade);

    // Purchase or make.
    const pm = text(v.purchaseOrMake).toLowerCase();
    // The form's own words are accepted too: "Purchasable (Vendor)", "Internal Manufacturing".
    const purchase = ['purchase', 'purchasable', 'purchasable (vendor)'].includes(pm);
    const make = ['make', 'internal manufacturing'].includes(pm);
    if (!purchase && !make) bad(row, 'purchaseOrMake', text(v.purchaseOrMake) ? `"${text(v.purchaseOrMake)}": write Purchase or Make.` : 'Required: Purchase or Make.');

    // Units.
    const unitPair = (typeKey, unitKey, required) => {
      const t = text(v[typeKey]), u = text(v[unitKey]);
      if (!t && !u) { if (required) bad(row, typeKey, 'Required.'); return { type: '', unit: '' }; }
      const ut = unitTypeOf(t);
      if (!ut) { bad(row, typeKey, t ? `"${t}" isn't a unit type (see Lists).` : 'Required with its unit.'); return { type: '', unit: '' }; }
      const hit = matchIn(u, ut.units);
      if (hit == null) { bad(row, unitKey, u ? `"${u}" isn't a unit of ${ut.name} (use: ${ut.units.slice(0, 8).join(', ')}).` : 'Required.'); return { type: ut.name, unit: '' }; }
      return { type: ut.name, unit: hit };
    };
    let used = { type: '', unit: '' }, bought = { type: '', unit: '' }, receive = { type: '', unit: '' };
    if (isFab) {
      if (master) {
        used = { type: master.usedUnitType || '', unit: master.usedUnit || '' };
        bought = { type: master.purchaseUnitType || '', unit: master.purchaseUnit || '' };
        receive = { type: master.receiveUnitType || '', unit: master.receiveUnit || '' };
        if (!used.unit) bad(row, 'fabricationCode', `Fabrication Master "${master.itemCode}" has no Used Unit: set it on the Fabrication Master page first.`);
        if (purchase && !bought.unit) bad(row, 'fabricationCode', `Fabrication Master "${master.itemCode}" has no Purchase Unit: set it on the Fabrication Master page first.`);
      }
    } else {
      used = unitPair('unitType', 'unit', true);
      bought = purchase ? unitPair('purchaseUnitType', 'purchaseUnit', true) : { type: '', unit: '' };
      // A row with Purchase or Make missing already has that problem: no follow-on ones (23 Nov).
      if (make && (text(v.purchaseUnitType) || text(v.purchaseUnit))) bad(row, 'purchaseUnitType', 'Only for a Purchase item. Leave blank.');
    }

    // Production use (the form's rule: a piece-counted plain item).
    const useRaw = text(v.productionUse);
    let productionUse = null;
    if (useRaw) {
      productionUse = USES[useRaw.toLowerCase()] || USES[useRaw.toLowerCase().replace(/[^a-z]/g, '')] || null;
      if (!productionUse) bad(row, 'productionUse', `"${useRaw}": write Built into the product or Used to make the product.`);
    }
    const countable = needsProductionUse({ unit: used.unit, productKind: null });
    if (countable && !productionUse && !useRaw) bad(row, 'productionUse', 'Required for an item counted in pieces: Built into the product, or Used to make the product.');
    if (!countable) productionUse = null; // the form only keeps it for piece items

    // Unit weight.
    let unitWeightValue = null, unitWeightUnitType = 'Mass Unit', unitWeightUnit = 'Kilogram';
    const amount = AMOUNT_UNIT_TYPES.includes(used.type);
    if (amount) { unitWeightUnitType = used.type; unitWeightUnit = used.unit; }
    if (!isFab) {
      const w = num(v.unitWeightValue);
      if (Number.isNaN(w) || (w != null && w < 0)) bad(row, 'unitWeightValue', 'A number, 0 or more.');
      else unitWeightValue = w;
      const per = text(v.unitWeightUnit);
      if (per) {
        if (!amount) bad(row, 'unitWeightUnit', 'Only for a Length / Area / Volume Used Unit. Leave blank.');
        else {
          const hit = matchIn(per, unitTypeOf(used.type)?.units || []);
          if (hit == null) bad(row, 'unitWeightUnit', `"${per}" isn't a unit of ${used.type}.`);
          else unitWeightUnit = hit;
        }
      }
    }

    // Sizes (plain items).
    const dimensions = {};
    for (const [d] of DIMS) {
      const val = isFab ? null : num(v[d]);
      const u = isFab ? '' : text(v[`${d}Unit`]);
      if (Number.isNaN(val) || (val != null && val < 0)) bad(row, d, 'A number, 0 or more.');
      let unitHit = '';
      if (u) { unitHit = matchIn(u, DIM_UNITS) ?? ''; if (!unitHit) bad(row, `${d}Unit`, `"${u}": use Inch, MM, Feet or Meter.`); }
      dimensions[d] = { value: Number.isNaN(val) ? null : val, unit: unitHit };
    }

    // Reorder (Purchase only, as the form).
    let materialFlow = '';
    if (purchase) {
      const f = text(v.materialFlow);
      materialFlow = f ? (matchIn(f, FLOWS) ?? '') : '';
      if (!f) bad(row, 'materialFlow', 'Required for a Purchase item: High Flow, Medium Flow or Low Flow.');
      else if (!materialFlow) bad(row, 'materialFlow', `"${f}": use High Flow, Medium Flow or Low Flow.`);
    } else if (make && text(v.materialFlow)) bad(row, 'materialFlow', 'Only for a Purchase item. Leave blank.');
    let minStock = num(v.minStock);
    let reorderQty = num(v.reorderQty);
    if (Number.isNaN(minStock) || (minStock != null && minStock < 0)) { bad(row, 'minStock', 'A number, 0 or more.'); minStock = 0; }
    if (Number.isNaN(reorderQty) || (reorderQty != null && reorderQty < 0)) { bad(row, 'reorderQty', 'A number, 0 or more.'); reorderQty = 0; }
    if (minStock == null) minStock = materialFlow ? FLOW_MIN[materialFlow] : 0;
    if (!purchase) reorderQty = 0;
    reorderQty = reorderQty ?? 0;
    if (isFab && !Number.isInteger(minStock)) bad(row, 'minStock', 'Whole pieces for a fabrication item.');
    if (isFab && !Number.isInteger(reorderQty)) bad(row, 'reorderQty', 'Whole pieces for a fabrication item.');

    const st = text(v.status).toLowerCase();
    // The form's words (Continue / Discontinue); Active / Discontinued read the same.
    if (st && !['continue', 'active', 'discontinue', 'discontinued'].includes(st)) bad(row, 'status', `"${text(v.status)}": Continue or Discontinue.`);
    const isDiscontinued = st === 'discontinue' || st === 'discontinued';

    // Same item twice (name + Item Type + record type), in the company and in the file.
    if (name) {
      const tk = twinKey(name, itemType, 'Material');
      if (twinOf.has(tk)) bad(row, 'name', `"${name}" already exists${itemType ? ` as Item Type "${itemType}"` : ''} (Code: ${twinOf.get(tk)}). Edit that one instead.`);
      else if (seenTwin.has(tk)) bad(row, 'name', `Row ${seenTwin.get(tk)} has the same name${itemType ? ` and Item Type "${itemType}"` : ''}.`);
      else seenTwin.set(tk, row);
    }

    if (problems.length > before) continue;

    // ── The item, built like the form's processedData, then createItem's checks ──
    const data = {
      name, code, description: text(v.description), modelNumber: text(v.modelNumber), brand: text(v.brand),
      itemType, jobWorkType, type: 'Material', importance: 'Normal', itemProcessType: processType,
      fabricationRef: master ? master._id : null, isSheetMetal: !!master?.isSheetMetal,
      itemCategories, sourceType, itemSourceType, metrology, materialGrade,
      purchase, internalManufacturing: !purchase,
      purchaseUnitType: purchase ? bought.type : '', purchaseUnit: purchase ? bought.unit : '',
      unitType: used.type, unit: used.unit,
      ...(isFab ? { receiveUnitType: receive.type, receiveUnit: receive.unit } : {}),
      productionUse, qty: 0, minStock, materialFlow, reorderQty,
      unitWeightValue, unitWeightUnitType, unitWeightUnit,
      dimensions, isDiscontinued,
      dimensionVariants: master ? (master.dimensions || []).map((d) => ({
        category: master.category, values: d.values || {}, designation: d.designation || '',
        densityValue: master.density?.value ?? null, densityUnit: master.density?.unit || 'kg/m3',
        weightPerMeterKg: d.weightPerMeterKg ?? null, weightPerPieceKg: d.weightPerPieceKg ?? null,
        subStock: 0, isLeftover: false, isDiscontinued: !!d.isDiscontinued,
        materialFlow, minStock, reorderQty,
      })) : [],
      stdCost: 0, purchaseCost: 0, salePrice: 0, mrp: 0, gst: 0, costSource: 'Manual',
      specifications: [], applications: [], warranty: { period: 12, type: 'Comprehensive', terms: '' },
    };
    const validation = validateItemData(data);
    if (!validation.isValid) {
      for (const [field, message] of Object.entries(validation.errors)) bad(row, FIELD_COLUMN[field] || field, message);
      continue;
    }
    const useProblem = productionUseProblem(data);
    if (useProblem) { bad(row, 'productionUse', useProblem); continue; }
    const doc = sanitizeItemData(data);
    doc.companyId = cid;
    doc.store = String(companyId);
    doc.specifications = []; doc.applications = []; doc.variants = [];
    doc.warranty = data.warranty;
    doc.productionUse = productionUse;
    // Decision K: a purchasable item with a reorder rule waits for Store's first count.
    doc.awaitingFirstCount = purchase && !!materialFlow && !isDiscontinued;
    doc.awaitingFirstCountSince = doc.awaitingFirstCount ? new Date() : null;
    docs.push(doc);
    codes.push({ row, name, code, made }); // feature 35: the list shown after the import
    if (isFab) fabricationCount++;
    if (doc.awaitingFirstCount) held++;
    if (preview.length < 50) {
      preview.push({ row, code, made, name, fabrication: isFab, sizes: doc.dimensionVariants.length, purchase, unit: used.unit, materialFlow, minStock, held: doc.awaitingFirstCount });
    }
  }
  const newValues = [...added.values()].map((a) => ({ list: TITLE[a.key], field: a.field, scope: a.scope, value: a.value, rows: a.rows }));
  return { problems: sortProblems(problems), docs, codes, preview, newValues, fromMaster, counts: { items: docs.length, fabrication: fabricationCount, held }, total: rows.length };
}

/**
 * Checks again, then saves every item or none. Returns { imported, held, fabrication }.
 * Throws ImportError(400, …) with `problems` when the file isn't clean.
 */
export async function importFile(companyId, user, buffer) {
  const c = await check(companyId, buffer);
  if (c.problems.length) {
    const e = new ImportError(400, 'The file has problems: nothing was imported.');
    e.problems = c.problems;
    throw e;
  }
  const ids = c.docs.map((d) => { d._id = new mongoose.Types.ObjectId(); return d._id; });
  try {
    await Item.insertMany(c.docs, { ordered: true });
  } catch (err) {
    // All or nothing (decision 3): take back whatever went in before the failure.
    await Item.deleteMany({ _id: { $in: ids } });
    const dup = err?.code === 11000 || err?.writeErrors?.some?.((w) => w.code === 11000);
    throw new ImportError(409, dup
      ? 'An item code in the file was taken while importing: nothing was imported. Check the file again.'
      : `Saving failed: nothing was imported (${err.message}).`);
  }
  // The new dropdown values the check showed, added only once the items are in (so a failed
  // import leaves no stray values). One added meanwhile by someone else is simply kept.
  const listsAdded = await addListValues(companyId, c.newValues);
  // One bell for Store instead of one per item (decision J).
  Promise.resolve().then(() => notificationService.notifyRoles(['Store Head', 'Store Employee'], {
    title: `R&D imported ${c.docs.length} item${c.docs.length === 1 ? '' : 's'}`,
    message: c.counts.held
      ? `${c.counts.held} wait for a first stock count before they reorder: Inventory → "Waiting for first stock count".`
      : 'They start at 0 stock.',
    type: 'inventory', icon: 'package', priority: 'medium', targetCompanyId: companyId, data: { link: '/store/inventory' },
  })).catch((e) => console.error('[bulk-import] notify failed:', e.message));
  return { imported: c.docs.length, held: c.counts.held, fabrication: c.counts.fabrication, listsAdded, codes: c.codes, by: user?._id || null };
}

/** Adds new dropdown values (Inventory's own lists and R&D's): how many were added. */
async function addListValues(companyId, newValues = []) {
  const cid = oid(companyId);
  const inv = newValues.filter((n) => n.scope === 'inventory').map((n) => ({ field: n.field, value: n.value, companyId: cid }));
  const rd = newValues.filter((n) => n.scope === 'rd').map((n) => ({ field: n.field, value: n.value, company: cid }));
  let count = 0;
  for (const [Model, docs] of [[InventoryMasterOption, inv], [RDMasterOption, rd]]) {
    if (!docs.length) continue;
    try {
      count += (await Model.insertMany(docs, { ordered: false })).length;
    } catch (err) {
      // Values someone added meanwhile (duplicate key) are fine; anything else is logged.
      count += err?.insertedDocs?.length ?? err?.result?.insertedCount ?? 0;
      const onlyDup = (err?.writeErrors || []).every((w) => (w.code ?? w.err?.code) === 11000);
      if (!(err?.code === 11000 || onlyDup)) console.error('[bulk-import] adding list values failed:', err.message);
    }
  }
  return count;
}
