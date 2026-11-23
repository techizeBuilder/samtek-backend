// Feature 22 (client, 22 Nov 2026): R&D → Plant Master bulk import.
// docs/client-features-2026-11/22-motor-plant-import-logic.md §3–§5 (decisions 1–3).
//
// A plant is a place in Plant Master's own tree (Category → Sub Category → Plant Name →
// Production) plus the Product Master machines and Motor Master motors it's made of.
// Sheet "Plants" (one row per plant, a Plant Ref to link it) and sheet "Machines &
// Motors" (Plant Ref, Item Code, Quantity). Tree values the file adds are planned under
// their path and shown first; parts must already exist. Check first; then all or nothing.
import mongoose from 'mongoose';
import { Item } from '../../models/Inventory.js';
import RDMasterOption from '../../models/RDMasterOption.js';
import RDPlant from '../../models/RDPlant.js';
import { exactRe } from '../itemCodeService.js';
import { MAX_ROWS, ImportError, text, num, openWorkbook, readSheet, workbook } from './common.js';
import { makeTree, insertPlanned, plannedValues } from './tree.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const lower = (v) => text(v).toLowerCase();
const TREE = { category: 'PlantCategory', subCategory: 'PlantSubCategory', name: 'PlantName', production: 'PlantProduction' };
const TREE_LABEL = { PlantCategory: 'Category', PlantSubCategory: 'Sub Category', PlantName: 'Plant Name', PlantProduction: 'Production' };
const DEPTH = { PlantCategory: 0, PlantSubCategory: 1, PlantName: 2, PlantProduction: 3 };
const PART_ROWS = 10000;

export const COLUMNS = [
  { key: 'ref', title: 'Plant Ref *', required: true, help: 'Your own label for this plant in the file (P1, P2 …), unique in the file. It links its rows on "Machines & Motors"; it isn\'t saved.' },
  { key: 'category', title: 'Category *', required: true, help: 'The top of the plant tree. A new one is added (shown in the check first).' },
  { key: 'subCategory', title: 'Sub Category *', required: true, help: 'Under that Category. A new one is added there.' },
  { key: 'name', title: 'Plant Name *', required: true, help: 'Under that Sub Category. A new one is added there.' },
  { key: 'production', title: 'Production', help: 'Under that Plant Name (optional), e.g. 500 kg/hr. A new one is added there.' },
  { key: 'status', title: 'Plant Status', help: 'Continue (default) or Discontinue.' },
];
export const PART_COLUMNS = [
  { key: 'ref', title: 'Plant Ref', required: true, help: 'A ref from the Plants sheet.' },
  { key: 'code', title: 'Item Code', required: true, help: 'A Product Master machine or a Motor Master motor of your company, not discontinued (sheet "Items").' },
  { key: 'quantity', title: 'Quantity', help: 'A whole number, 1 or more (blank: 1).' },
];
const TITLE = Object.fromEntries(COLUMNS.map((c) => [c.key, c.title.replace(/\s*\*$/, '')]));
const PART_TITLE = Object.fromEntries(PART_COLUMNS.map((c) => [c.key, c.title]));

const loadTree = async (companyId) => RDMasterOption.find({ company: oid(companyId), field: { $in: Object.values(TREE) } }).select('field value parentId parentValue').lean();

/** The template: Plants, Machines & Motors, How to fill, Tree, Items. */
export async function buildTemplate(companyId) {
  const cid = oid(companyId);
  const [options, items] = await Promise.all([
    loadTree(companyId),
    Item.find({ companyId: cid, productKind: { $in: ['Machine', 'Motor'] }, isDiscontinued: { $ne: true } }).select('code name productKind').sort({ productKind: 1, code: 1 }).lean(),
  ]);
  const { childrenOf } = makeTree(options);
  const ref = (o) => ({ id: o._id, value: o.value });
  const paths = [['Category', 'Sub Category', 'Plant Name', 'Production']];
  for (const c of childrenOf(TREE.category, null)) {
    const subs = childrenOf(TREE.subCategory, ref(c));
    if (!subs.length) paths.push([c.value, '', '', '']);
    for (const s of subs) {
      const names = childrenOf(TREE.name, ref(s));
      if (!names.length) paths.push([c.value, s.value, '', '']);
      for (const n of names) {
        const prods = childrenOf(TREE.production, ref(n));
        if (!prods.length) paths.push([c.value, s.value, n.value, '']);
        for (const p of prods) paths.push([c.value, s.value, n.value, p.value]);
      }
    }
  }
  const how = [
    ['How to fill the Plant Master import'],
    ['"Plants": one row per plant, with your own Plant Ref (P1, P2 …). Its Category, Sub Category, Plant Name and Production are its place in Plant Master\'s tree; a value the tree doesn\'t have yet is added under that row\'s own path (the check shows every one first).'],
    ['"Machines & Motors": one row per part of a plant: its Plant Ref, the machine\'s or motor\'s code (sheet "Items"), and the quantity. Machines and motors must already exist: import Product Master and Motor Master first.'],
    ['Upload: every row of both sheets is checked first. If anything has a problem, nothing is imported and every problem is listed by sheet, row and column. The same plant (Category / Sub Category / Plant Name / Production) twice is refused, and so is the same item twice in one plant.'],
    [`Up to ${MAX_ROWS} plants per file.`],
    [],
    ['Sheet', 'Column', 'Rule'],
    ...COLUMNS.map((c) => ['Plants', c.title, c.help]),
    ...PART_COLUMNS.map((c) => ['Machines & Motors', c.title, c.help]),
  ];
  return workbook([
    { name: 'Plants', rows: [COLUMNS.map((c) => c.title)], widths: [12, 22, 22, 24, 16, 14] },
    { name: 'Machines & Motors', rows: [PART_COLUMNS.map((c) => c.title)], widths: [12, 18, 10] },
    { name: 'How to fill', rows: how, widths: [18, 22, 100] },
    { name: 'Tree', rows: paths, widths: [24, 24, 26, 18] },
    { name: 'Items', rows: [['Code', 'Name', 'Kind'], ...items.map((i) => [i.code, i.name, i.productKind])], widths: [18, 36, 10] },
  ]);
}

/** Checks both sheets; saves nothing. Returns { problems, docs, preview, newValues, plan, counts, total }. */
export async function check(companyId, buffer) {
  const wb = openWorkbook(buffer);
  if (!wb) return { problems: [{ sheet: '', row: null, column: '', message: 'This file could not be read as an Excel file (.xlsx).' }], docs: [], preview: [], newValues: [], counts: {}, total: 0 };
  const plantsSheet = readSheet(wb, 'Plants', COLUMNS);
  const partsSheet = readSheet(wb, 'Machines & Motors', PART_COLUMNS, { optional: true, maxRows: PART_ROWS });
  const fileProblems = [...plantsSheet.fileProblems, ...partsSheet.fileProblems];
  if (fileProblems.length) return { problems: fileProblems.map((m) => ({ sheet: '', row: null, column: '', message: m })), docs: [], preview: [], newValues: [], counts: {}, total: plantsSheet.rows.length };

  const cid = oid(companyId);
  const { resolve, planned } = makeTree(await loadTree(companyId));
  const problems = [];
  const bad = (sheet, row, column, message) => problems.push({ sheet, row, column, message });

  // The same plant already active (the file's plant names, one read).
  const names = [...new Set(plantsSheet.rows.map((r) => text(r.values.name)).filter(Boolean))];
  const actives = names.length ? await RDPlant.find({ company: cid, isDiscontinued: false, name: { $in: names.map(exactRe) } }).select('category subCategory name productionRate').lean() : [];
  const identityKey = (c, s, n, p) => [c, s, n, p || ''].map(lower).join('|');
  const activeOf = new Set(actives.map((p) => identityKey(p.category, p.subCategory, p.name, p.productionRate)));

  // ── Plants ──
  const plants = new Map(); // lower(ref) → { row, ok, doc, items: Set }
  const seenIdentity = new Map();
  for (const r of plantsSheet.rows) {
    const v = r.values, row = r.row;
    const before = problems.length;
    const req = (key) => { const t = text(v[key]); if (!t) bad('Plants', row, TITLE[key], 'Required.'); return t; };
    const refRaw = req('ref');
    const catRaw = req('category'), subRaw = req('subCategory'), nameRaw = req('name');
    const prodRaw = text(v.production);
    if (refRaw && plants.has(lower(refRaw))) bad('Plants', row, TITLE.ref, `"${refRaw}" is also on row ${plants.get(lower(refRaw)).row}: refs must be unique in the file.`);
    // The tree, top down, each level under the one above.
    let cat = null, sub = null, name = null, prod = null;
    if (catRaw) cat = resolve(TREE.category, null, catRaw, row);
    if (cat && subRaw) sub = resolve(TREE.subCategory, cat, subRaw, row);
    if (sub && nameRaw) name = resolve(TREE.name, sub, nameRaw, row);
    if (name && prodRaw) prod = resolve(TREE.production, name, prodRaw, row);
    // The same plant twice (decision 1).
    if (cat && sub && name) {
      const ik = identityKey(cat.value, sub.value, name.value, prod?.value);
      if (activeOf.has(ik)) bad('Plants', row, TITLE.name, 'This plant already exists (same Category, Sub Category, Plant Name and Production). Edit that one instead.');
      else if (seenIdentity.has(ik)) bad('Plants', row, TITLE.name, `Row ${seenIdentity.get(ik)} is the same plant (Category, Sub Category, Plant Name and Production).`);
      else seenIdentity.set(ik, row);
    }
    const st = lower(v.status);
    if (st && !['continue', 'discontinue', 'active', 'discontinued'].includes(st)) bad('Plants', row, TITLE.status, `"${text(v.status)}": Continue or Discontinue.`);
    if (refRaw && !plants.has(lower(refRaw))) {
      plants.set(lower(refRaw), {
        row, ok: problems.length === before, ref: refRaw, items: new Set(),
        doc: {
          category: cat?.value || catRaw, subCategory: sub?.value || subRaw, name: name?.value || nameRaw, productionRate: prod?.value || '',
          machines: [], motors: [], isDiscontinued: st === 'discontinue' || st === 'discontinued', company: cid,
        },
      });
    }
  }

  // ── Machines & Motors: existing, active, by code (decision 2) ──
  const allCodes = await Item.find({}, { code: 1, _id: 0 }).hint({ code: 1 }).lean();
  const codeByLower = new Map(allCodes.map((x) => [String(x.code).toLowerCase(), x.code]));
  const wanted = [...new Set(partsSheet.rows.map((r) => codeByLower.get(lower(r.values.code))).filter(Boolean))];
  const parts = new Map(wanted.length ? (await Item.find({ code: { $in: wanted }, companyId: cid }).select('code name productKind isDiscontinued').lean()).map((i) => [i.code.toLowerCase(), i]) : []);
  for (const r of partsSheet.rows) {
    const v = r.values, row = r.row;
    const refRaw = text(v.ref), code = text(v.code);
    if (!refRaw) { bad('Machines & Motors', row, PART_TITLE.ref, 'Required.'); continue; }
    const plant = plants.get(lower(refRaw));
    if (!plant) { bad('Machines & Motors', row, PART_TITLE.ref, `"${refRaw}" isn't a Plant Ref in the Plants sheet.`); continue; }
    if (!code) { bad('Machines & Motors', row, PART_TITLE.code, 'Required.'); plant.ok = false; continue; }
    const item = parts.get(lower(code));
    let message = null;
    if (!item) message = `"${code}" isn't a machine or motor of your company (import it in Product Master or Motor Master first).`;
    else if (!['Machine', 'Motor'].includes(item.productKind)) message = `"${item.code}" (${item.name}) isn't a Product Master machine or a Motor Master motor.`;
    else if (item.isDiscontinued) message = `"${item.code}" (${item.name}) is discontinued.`;
    else if (plant.items.has(String(item._id))) message = `"${item.code}" is already in plant ${plant.ref}: one row per item (put the total in Quantity).`;
    const q = num(v.quantity);
    const qty = q == null ? 1 : q;
    if (Number.isNaN(qty) || !Number.isInteger(qty) || qty < 1) { bad('Machines & Motors', row, PART_TITLE.quantity, 'A whole number, 1 or more.'); plant.ok = false; }
    if (message) { bad('Machines & Motors', row, PART_TITLE.code, message); plant.ok = false; continue; }
    plant.items.add(String(item._id));
    (item.productKind === 'Machine' ? plant.doc.machines : plant.doc.motors).push({ item: item._id, quantity: Number.isNaN(qty) ? 1 : qty });
  }

  const docs = [], preview = [];
  for (const p of plants.values()) {
    if (!p.ok) continue;
    docs.push(p.doc);
    if (preview.length < 50) preview.push({ row: p.row, ref: p.ref, path: [p.doc.category, p.doc.subCategory, p.doc.name].join(' › '), production: p.doc.productionRate, machines: p.doc.machines.length, motors: p.doc.motors.length });
  }
  const SHEET_ORDER = { '': 0, Plants: 1, 'Machines & Motors': 2 };
  problems.sort((a, b) => (SHEET_ORDER[a.sheet] ?? 9) - (SHEET_ORDER[b.sheet] ?? 9) || (a.row || 0) - (b.row || 0) || String(a.column).localeCompare(String(b.column)));
  return {
    problems, docs, preview, newValues: plannedValues(planned(), TREE_LABEL), plan: { tree: planned() },
    counts: { plants: docs.length, tree: planned().length }, total: plantsSheet.rows.length,
  };
}

/** Checks again; adds the new tree values, then the plants — all or nothing. */
export async function importFile(companyId, user, buffer) {
  const c = await check(companyId, buffer);
  if (c.problems.length) {
    const e = new ImportError(400, 'The file has problems: nothing was imported.');
    e.problems = c.problems;
    throw e;
  }
  const created = { options: [], plants: [] };
  try {
    await insertPlanned(c.plan.tree, DEPTH, companyId, [], created.options);
    created.plants = c.docs.map((d) => { d._id = new mongoose.Types.ObjectId(); d.createdBy = user._id; return d._id; });
    await RDPlant.insertMany(c.docs, { ordered: true });
  } catch (err) {
    await RDPlant.deleteMany({ _id: { $in: created.plants } }).catch(() => {});
    await RDMasterOption.deleteMany({ _id: { $in: created.options } }).catch(() => {});
    const dup = err?.code === 11000 || err?.writeErrors?.some?.((w) => w.code === 11000);
    throw new ImportError(409, dup
      ? 'A value in the file was added by someone else while importing: nothing was imported. Check the file again.'
      : `Saving failed: nothing was imported (${err.message}).`);
  }
  return { imported: c.docs.length, added: { tree: c.counts.tree } };
}
