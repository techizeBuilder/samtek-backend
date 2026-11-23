// Feature 22 (client, 22 Nov 2026): R&D → Motor Master bulk import.
// docs/client-features-2026-11/22-motor-plant-import-logic.md §2 (decision 4: blank sourcing = Purchasable).
//
// One sheet, one row per motor, saved exactly as Motor Master's form saves it
// (MotorMaster.jsx buildPayload → POST /api/items → createItem's checks). Check first;
// then the new Motor Type values and the motors, all or nothing.
import mongoose from 'mongoose';
import { Item } from '../../models/Inventory.js';
import RDMasterOption from '../../models/RDMasterOption.js';
import { exactRe } from '../itemCodeService.js';
import { validateItemData, sanitizeItemData } from '../../controllers/inventoryController.js';
import { MAX_ROWS, ImportError, text, matchIn, num, readSheet, workbook, listColumns, sortProblems } from './common.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const lower = (v) => text(v).toLowerCase();
const hpToKwh = (hp) => Math.round(hp * 0.746 * 100) / 100; // the form's rule

export const COLUMNS = [
  { key: 'code', title: 'Motor Code *', required: true, help: 'Unused anywhere (any letter case), not repeated in the file.' },
  { key: 'name', title: 'Motor Name *', required: true, help: 'At least 2 characters. The same name as an active motor, or another row, is refused.' },
  { key: 'modelNumber', title: 'Model Number', help: 'Free text.' },
  { key: 'serialNumber', title: 'Serial Number', help: 'Free text.' },
  { key: 'brand', title: 'Brand Name', help: 'Free text.' },
  { key: 'motorType', title: 'Motor Type', help: 'From the list, or a new value (added, shown in the check first).' },
  { key: 'hsn', title: 'HSN Code', help: 'Free text.' },
  { key: 'version', title: 'Version', help: 'Free text.' },
  { key: 'hp', title: 'HP', help: 'A number.' },
  { key: 'kwh', title: 'KWH', help: 'A number. Blank: worked out from HP (× 0.746), as the form does.' },
  { key: 'rpm', title: 'RPM', help: 'A number.' },
  { key: 'pole', title: 'Pole', help: 'Free text, e.g. 4 Pole.' },
  { key: 'phase', title: 'Phase', help: 'Free text, e.g. 3-Phase.' },
  { key: 'description', title: 'Description', help: 'Free text.' },
  { key: 'status', title: 'Motor Status', help: 'Continue (default) or Discontinue.' },
  { key: 'sourcing', title: 'Sourcing', help: 'Purchasable (Vendor) or Internal Manufacturing. Blank: Purchasable, the form\'s pre-selected choice.' },
];
const TITLE = Object.fromEntries(COLUMNS.map((c) => [c.key, c.title.replace(/\s*\*$/, '')]));

const motorTypesOf = async (companyId) => [...new Set((await RDMasterOption.find({ company: oid(companyId), field: 'MotorType' }).select('value').lean()).map((o) => o.value))]
  .sort((a, b) => a.localeCompare(b));

/** The template: Motors, How to fill, Lists. */
export async function buildTemplate(companyId) {
  const lists = { 'Motor Type': await motorTypesOf(companyId), Sourcing: ['Purchasable (Vendor)', 'Internal Manufacturing'], 'Motor Status': ['Continue', 'Discontinue'] };
  const how = [
    ['How to fill the Motor Master import'],
    ['One row per motor on the "Motors" sheet. Keep the header row.'],
    ['Upload: every row is checked first. If any row has a problem, nothing is imported and every problem is listed by row and column. New motors only.'],
    ['Motor Type: from the "Lists" sheet, or a new value (added to the list when you import; the check shows it first). The image is uploaded on the motor afterwards.'],
    [`Up to ${MAX_ROWS} rows per file.`],
    [],
    ['Column', 'Rule'],
    ...COLUMNS.map((c) => [c.title, c.help]),
  ];
  return workbook([
    { name: 'Motors', rows: [COLUMNS.map((c) => c.title)], widths: COLUMNS.map((c) => Math.max(12, c.title.length + 2)) },
    { name: 'How to fill', rows: how, widths: [22, 100] },
    { name: 'Lists', rows: listColumns(lists), widths: [24, 24, 16] },
  ]);
}

/** Checks every row; saves nothing. Returns { problems, docs, preview, newValues, counts, total }. */
export async function check(companyId, buffer) {
  const { rows, fileProblems } = readSheet(buffer, 'Motors', COLUMNS);
  if (fileProblems.length) return { problems: fileProblems.map((m) => ({ row: null, column: '', message: m })), docs: [], preview: [], newValues: [], counts: { motors: 0 }, total: rows.length };
  const cid = oid(companyId);
  const problems = [];
  const bad = (row, key, message) => problems.push({ row, column: TITLE[key] || key, message });
  const types = await motorTypesOf(companyId);
  const typePlan = new Map(); // lower → { value, rows }

  // Codes are global (an index-only read); the same motor = createItem's twin rule for a
  // motor: same name, Item Type blank, record type Product, among active items.
  const allCodes = await Item.find({}, { code: 1, _id: 0 }).hint({ code: 1 }).lean();
  const codeByLower = new Map(allCodes.map((x) => [String(x.code).toLowerCase(), x.code]));
  const clash = [...new Set(rows.map((r) => text(r.values.code)).filter((c) => codeByLower.has(c.toLowerCase())).map((c) => codeByLower.get(c.toLowerCase())))];
  const holders = new Map(clash.length ? (await Item.find({ code: { $in: clash } }).select('code name companyId isDiscontinued').lean()).map((h) => [h.code.toLowerCase(), h]) : []);
  const names = [...new Set(rows.map((r) => text(r.values.name)).filter(Boolean))];
  const twins = names.length ? await Item.find({
    $or: [{ companyId: cid }, { store: String(companyId) }], isDiscontinued: { $ne: true },
    productKind: { $nin: ['Machine', 'SubChildPart', 'ChildPart'] }, type: exactRe('Product'), itemType: { $in: ['', null] }, name: { $in: names.map(exactRe) },
  }).select('name code').lean() : [];
  const twinOf = new Map(twins.map((t) => [lower(t.name), t.code]));

  const seenCode = new Map(), seenName = new Map();
  const docs = [], preview = [];
  for (const r of rows) {
    const v = r.values, row = r.row;
    const before = problems.length;
    const code = text(v.code), name = text(v.name);
    if (!code) bad(row, 'code', 'Required.');
    else if (seenCode.has(lower(code))) bad(row, 'code', `"${code}" is also on row ${seenCode.get(lower(code))}: codes must be unique.`);
    else {
      seenCode.set(lower(code), row);
      if (codeByLower.has(lower(code))) {
        const h = holders.get((codeByLower.get(lower(code)) || '').toLowerCase());
        bad(row, 'code', !h || String(h.companyId) !== String(companyId)
          ? `"${code}" is already used. Codes must be unique: choose another.`
          : h.isDiscontinued ? `"${code}" belongs to the discontinued item "${h.name}". Reactivate it, or choose another code.`
            : `"${code}" is already used by "${h.name}". Codes must be unique.`);
      }
    }
    if (name.length < 2) bad(row, 'name', name ? 'At least 2 characters.' : 'Required.');
    else if (twinOf.has(lower(name))) bad(row, 'name', `"${name}" already exists (Code: ${twinOf.get(lower(name))}). Edit that one instead.`);
    else if (seenName.has(lower(name))) bad(row, 'name', `Row ${seenName.get(lower(name))} has the same motor name.`);
    else seenName.set(lower(name), row);

    // Motor Type: an existing one (letter case ignored), or a new one, shown first.
    let motorType = '';
    if (text(v.motorType)) {
      motorType = matchIn(v.motorType, types);
      if (motorType == null) {
        const k = lower(v.motorType);
        if (!typePlan.has(k)) typePlan.set(k, { value: text(v.motorType), rows: [] });
        const p = typePlan.get(k);
        if (!p.rows.includes(row)) p.rows.push(row);
        motorType = p.value;
      }
    }

    const hp = num(v.hp), rpm = num(v.rpm);
    let kwh = num(v.kwh);
    for (const [k, n] of [['hp', hp], ['kwh', kwh], ['rpm', rpm]]) if (Number.isNaN(n) || (n != null && n < 0)) bad(row, k, 'A number, 0 or more.');
    if (kwh == null && hp != null && !Number.isNaN(hp)) kwh = hpToKwh(hp);

    // Sourcing: blank = Purchasable (decision 4, the form's pre-selected choice).
    const s = lower(v.sourcing);
    const internal = ['internal manufacturing', 'make'].includes(s);
    const purchase = !s || ['purchasable (vendor)', 'purchasable', 'purchase'].includes(s);
    if (!purchase && !internal) bad(row, 'sourcing', `"${text(v.sourcing)}": write Purchasable (Vendor) or Internal Manufacturing (or leave blank for Purchasable).`);
    const st = lower(v.status);
    if (st && !['continue', 'discontinue', 'active', 'discontinued'].includes(st)) bad(row, 'status', `"${text(v.status)}": Continue or Discontinue.`);
    if (problems.length > before) continue;

    // As MotorMaster.jsx buildPayload builds it.
    const clean = (n) => (n == null || Number.isNaN(n) ? null : n);
    const motorDetails = {
      modelNumber: text(v.modelNumber), version: text(v.version), hp: clean(hp), kwh: clean(kwh), rpm: clean(rpm),
      pole: text(v.pole), phase: text(v.phase), motorType,
    };
    const specifications = [['Version', motorDetails.version], ['HP', motorDetails.hp], ['KWH', motorDetails.kwh], ['RPM', motorDetails.rpm], ['Pole', motorDetails.pole], ['Phase', motorDetails.phase]]
      .filter(([, val]) => val !== '' && val !== null && val !== undefined).map(([key, val]) => ({ key, value: String(val) }));
    const data = {
      code, name, description: text(v.description), brand: text(v.brand), serialNumber: text(v.serialNumber), image: '',
      type: 'Product', productKind: 'Motor', category: 'Motor', subCategory: 'Motor', importance: 'Normal',
      motorDetails, specifications, purchase, internalManufacturing: internal, isDiscontinued: st === 'discontinue' || st === 'discontinued',
      unitType: 'Count Unit', unit: 'Pieces', purchaseUnitType: purchase ? 'Count Unit' : '', purchaseUnit: purchase ? 'Pieces' : '',
      stdCost: 0, purchaseCost: 0, salePrice: 0, mrp: 0, gst: 0, hsn: text(v.hsn), qty: 0, minStock: 0,
    };
    const validation = validateItemData(data);
    if (!validation.isValid) { for (const [field, message] of Object.entries(validation.errors)) bad(row, field, message); continue; }
    const doc = sanitizeItemData(data);
    doc.companyId = cid;
    doc.store = String(companyId);
    doc.variants = [];
    docs.push(doc);
    if (preview.length < 50) preview.push({ row, code, name, motorType, hp: motorDetails.hp, kwh: motorDetails.kwh, rpm: motorDetails.rpm, purchase, discontinued: doc.isDiscontinued });
  }
  const newValues = [...typePlan.values()].map((t) => ({ list: 'Motor Type', value: t.value, under: '', rows: t.rows }));
  return { problems: sortProblems(problems), docs, preview, newValues, types: [...typePlan.values()], counts: { motors: docs.length, types: typePlan.size }, total: rows.length };
}

/** Checks again; adds the new Motor Types, then the motors — all or nothing. */
export async function importFile(companyId, user, buffer) {
  const c = await check(companyId, buffer);
  if (c.problems.length) {
    const e = new ImportError(400, 'The file has problems: nothing was imported.');
    e.problems = c.problems;
    throw e;
  }
  const cid = oid(companyId);
  const created = { options: [], items: [] };
  try {
    const typeDocs = c.types.map((t) => ({ _id: new mongoose.Types.ObjectId(), field: 'MotorType', value: t.value, parentValue: null, parentId: null, company: cid }));
    if (typeDocs.length) {
      created.options = typeDocs.map((d) => d._id);
      await RDMasterOption.insertMany(typeDocs, { ordered: true });
    }
    created.items = c.docs.map((d) => { d._id = new mongoose.Types.ObjectId(); return d._id; });
    await Item.insertMany(c.docs, { ordered: true });
  } catch (err) {
    await Item.deleteMany({ _id: { $in: created.items } }).catch(() => {});
    await RDMasterOption.deleteMany({ _id: { $in: created.options } }).catch(() => {});
    const dup = err?.code === 11000 || err?.writeErrors?.some?.((w) => w.code === 11000);
    throw new ImportError(409, dup
      ? 'A code or Motor Type in the file was added by someone else while importing: nothing was imported. Check the file again.'
      : `Saving failed: nothing was imported (${err.message}).`);
  }
  return { imported: c.docs.length, added: { types: c.counts.types }, by: user?._id || null };
}
