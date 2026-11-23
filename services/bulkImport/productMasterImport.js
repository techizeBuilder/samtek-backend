// Feature 21 (client, 22 Nov 2026): R&D → Product Master bulk import.
// docs/client-features-2026-11/21-product-master-import-logic.md (decisions 1–4).
//
// A product is made in two places: Manage Classifications (the tree Category → Sub
// Category → Product Name → Variant, Source Type under the Sub Category; and the custom
// field templates) and Add. One file does both: each product row gives its full path,
// and what the tree or the combination's template doesn't have yet is added — shown in
// the check first, like the Inventory import's new list values. Check first; then all
// or nothing (classifications first, products after, everything taken back on failure).
import mongoose from 'mongoose';
import { Item, UnitType } from '../../models/Inventory.js';
import RDMasterOption from '../../models/RDMasterOption.js';
import RDCustomFieldTemplate from '../../models/RDCustomFieldTemplate.js';
import { exactRe } from '../itemCodeService.js';
import { MAX_ROWS, ImportError, text, matchIn, num, openWorkbook, readSheet, workbook, listColumns } from './common.js';
import { makeTree, insertPlanned, plannedValues } from './tree.js'; // shared with the Plant Master import (feature 22)

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const lower = (v) => text(v).toLowerCase();
const DETAIL_ROWS = 10000;
const hpToKwh = (hp) => Math.round(hp * 0.746 * 100) / 100; // the form's rule

// The tree's fields (RDMasterOption.field) and their parents.
const TREE = { pType: 'P-Type', category: 'Category', name: 'ProductName', variant: 'ProductVariant', source: 'P-SourceType' };
const TREE_LABEL = { 'P-Type': 'Category', Category: 'Sub Category', ProductName: 'Product Name', ProductVariant: 'Variant', 'P-SourceType': 'Product Source Type' };
const DEPTH = { 'P-Type': 0, Category: 1, ProductName: 2, 'P-SourceType': 2, ProductVariant: 3 };
const LISTS = { metrology: 'Metrology', materialGrade: 'MaterialGrade', power: 'PowerSource' };
const LIST_LABEL = { Metrology: 'Metrology', MaterialGrade: 'Material Grade', PowerSource: 'Power Source' };

const POWER = [1, 2, 3];
export const COLUMNS = [
  { key: 'pType', title: 'Category *', required: true, help: 'The top of the tree. A new one is added (shown in the check first).' },
  { key: 'category', title: 'Sub Category *', required: true, help: 'Under that Category. A new one is added there.' },
  { key: 'name', title: 'Product Name *', required: true, help: 'Under that Sub Category; it is the product\'s name. A new one is added there.' },
  { key: 'variant', title: 'Variant', help: 'Under that Product Name (optional). A new one is added there.' },
  { key: 'source', title: 'Product Source Type *', required: true, help: 'Under that Sub Category. A new one is added there.' },
  { key: 'code', title: 'Product Code *', required: true, help: 'Unused anywhere (any letter case), not repeated in the file.' },
  { key: 'productionRate', title: 'Production', help: 'Free text, e.g. 200 Kg/hr.' },
  { key: 'size', title: 'Product Size', help: 'Free text, e.g. 500x300x200mm.' },
  { key: 'metrology', title: 'Metrology', help: 'From the list, or a new value (added, shown first).' },
  { key: 'materialGrade', title: 'Material Grade', help: 'From the list, or a new value (added, shown first).' },
  { key: 'sourcing', title: 'Sourcing *', required: true, help: 'Purchasable (Vendor) or Internal Manufacturing (Purchase / Make read the same).' },
  // 23 Nov (the user's ask): the form shows the weight only once Sourcing is Purchasable, so
  // the headers say so. Older headers still read (aliases); problems use the short label.
  { key: 'weight', title: 'Product Weight (Purchasable only)', label: 'Product Weight', aliases: ['Product Weight'],
    help: 'The form asks for it only when Sourcing is Purchasable (Vendor). A number, with its unit. Leave blank for Internal Manufacturing.' },
  { key: 'weightUnit', title: 'Product Weight Unit (Purchasable only)', label: 'Product Weight Unit', aliases: ['Product Weight Unit'],
    help: 'With the weight: a Mass Unit unit, i.e. Gram, Kilogram or Tonne (the type is always Mass Unit). Leave blank for Internal Manufacturing.' },
  { key: 'modelNumber', title: 'Model Number', help: 'Free text.' },
  { key: 'brand', title: 'Brand', help: 'Free text.' },
  { key: 'hsn', title: 'HSN Code', help: 'Free text.' },
  ...POWER.flatMap((i) => [
    { key: `p${i}source`, title: `Power ${i} Source`, help: 'From the Power Source list, or a new value. Up to 3 power requirements; more on the form.' },
    { key: `p${i}hp`, title: `Power ${i} HP`, help: 'A number.' },
    { key: `p${i}kwh`, title: `Power ${i} KWH`, help: 'A number. Blank: worked out from HP (× 0.746), as the form does.' },
    { key: `p${i}rpm`, title: `Power ${i} RPM`, help: 'A number.' },
  ]),
  { key: 'applications', title: 'Applications', help: 'Several, separated by commas.' },
  { key: 'accessories', title: 'Accessories', help: 'Several, separated by commas.' },
  { key: 'description', title: 'Description', help: 'Free text.' },
  { key: 'status', title: 'Product Status', help: 'Continue (default) or Discontinue.' },
  { key: 'forward', title: 'Forward to Design & Prototype', help: 'Yes or No (default No): the form\'s tick box.' },
];
export const SPEC_COLUMNS = [
  { key: 'code', title: 'Product Code', required: true, help: 'A code from the Products sheet.' },
  { key: 'key', title: 'Key', required: true, help: 'e.g. Power.' },
  { key: 'value', title: 'Value', required: true, help: 'e.g. 5 kW.' },
];
export const CF_COLUMNS = [
  { key: 'code', title: 'Product Code', required: true, help: 'A code from the Products sheet.' },
  { key: 'group', title: 'Group', required: true, help: 'A group of the template for that product\'s Category / Sub Category / Source Type; a new one is added to it.' },
  { key: 'field', title: 'Field', required: true, help: 'A field in that group; a new one is added to it.' },
  { key: 'value', title: 'Value', required: true, help: 'The value for this product.' },
];
const titleOf = (cols) => Object.fromEntries(cols.map((c) => [c.key, c.label || c.title.replace(/\s*\*$/, '')]));
const TITLE = titleOf(COLUMNS), SPEC_TITLE = titleOf(SPEC_COLUMNS), CF_TITLE = titleOf(CF_COLUMNS);

/** The company's classification options, templates and Mass Unit units, read once. */
async function load(companyId) {
  const cid = oid(companyId);
  const [options, templates, mass] = await Promise.all([
    RDMasterOption.find({ company: cid, field: { $in: [...Object.values(TREE), ...Object.values(LISTS)] } }).select('field value parentId parentValue').lean(),
    RDCustomFieldTemplate.find({ company: cid }).lean(),
    UnitType.findOne({ companyId: cid, name: 'Mass Unit' }).select('units').lean(),
  ]);
  return { options, templates, massUnits: mass?.units || [] };
}

const comboKey = (pType, category, source) => `${lower(pType)}|${lower(category)}|${lower(source)}`;

/** The template: Products, Specifications, Custom Fields, How to fill, Tree, Templates, Lists. */
export async function buildTemplate(companyId) {
  const { options, templates, massUnits } = await load(companyId);
  const { byField, childrenOf, resolve, planned } = makeTree(options);
  const ref = (o) => ({ id: o._id, value: o.value });
  const paths = [['Category', 'Sub Category', 'Product Name', 'Variant']];
  const sources = [['Category', 'Sub Category', 'Product Source Type']];
  for (const p of childrenOf(TREE.pType, null)) {
    const cats = childrenOf(TREE.category, ref(p));
    if (!cats.length) paths.push([p.value, '', '', '']);
    for (const c of cats) {
      for (const s of childrenOf(TREE.source, ref(c))) sources.push([p.value, c.value, s.value]);
      const names = childrenOf(TREE.name, ref(c));
      if (!names.length) paths.push([p.value, c.value, '', '']);
      for (const n of names) {
        const vars = childrenOf(TREE.variant, ref(n));
        if (!vars.length) paths.push([p.value, c.value, n.value, '']);
        for (const v of vars) paths.push([p.value, c.value, n.value, v.value]);
      }
    }
  }
  const tplRows = [['Category', 'Sub Category', 'Product Source Type', 'Group', 'Field']];
  for (const t of templates) for (const g of t.groups || []) for (const f of g.fields || []) tplRows.push([t.pType, t.category, t.pSourceType, g.label, f.name]);
  const listOf = (field) => [...new Set((byField.get(field) || []).filter((o) => !o.parentId).map((o) => o.value))].sort((a, b) => a.localeCompare(b));
  const lists = {
    Metrology: listOf('Metrology'), 'Material Grade': listOf('MaterialGrade'), 'Power Source': listOf('PowerSource'),
    'Product Weight Unit (Mass Unit)': massUnits, Sourcing: ['Purchasable (Vendor)', 'Internal Manufacturing'],
    'Product Status': ['Continue', 'Discontinue'], 'Forward to Design & Prototype': ['Yes', 'No'],
  };
  const how = [
    ['How to fill the Product Master import'],
    ['"Products": one row per product. Its Category, Sub Category, Product Name, Variant and Product Source Type are its place in the tree (Manage Classifications). A value the tree doesn\'t have yet is added under that row\'s own path; the check shows every one first, so a typo can be fixed in the file.'],
    ['"Specifications": one row per key and value, with the product\'s code. "Custom Fields": one row per field value, with the product\'s code; a group or field the template for that product\'s Category / Sub Category / Source Type doesn\'t have yet is added to the template (shown first).'],
    ['Upload: every row of every sheet is checked first. If anything has a problem, nothing is imported and every problem is listed by sheet, row and column. New products only; they start Draft / Not Released, as with the form.'],
    ['Metrology, Material Grade and Power Source: from the lists, or a new value (added, shown first). Product Weight and its unit: only for a Purchasable (Vendor) product, as on the form (leave both blank for Internal Manufacturing); the unit must be a Mass Unit unit. The sheets "Tree" and "Templates" show what you have today.'],
    [`Up to ${MAX_ROWS} products per file.`],
    [],
    ['Sheet', 'Column', 'Rule'],
    ...COLUMNS.map((c) => ['Products', c.title, c.help]),
    ...SPEC_COLUMNS.map((c) => ['Specifications', c.title, c.help]),
    ...CF_COLUMNS.map((c) => ['Custom Fields', c.title, c.help]),
  ];
  return workbook([
    { name: 'Products', rows: [COLUMNS.map((c) => c.title)], widths: COLUMNS.map((c) => Math.max(12, c.title.length + 2)) },
    { name: 'Specifications', rows: [SPEC_COLUMNS.map((c) => c.title)], widths: [16, 28, 28] },
    { name: 'Custom Fields', rows: [CF_COLUMNS.map((c) => c.title)], widths: [16, 26, 26, 28] },
    { name: 'How to fill', rows: how, widths: [16, 30, 100] },
    { name: 'Tree', rows: [...paths, [], ...sources], widths: [24, 24, 28, 20] },
    { name: 'Templates', rows: tplRows, widths: [22, 22, 24, 26, 24] },
    { name: 'Lists', rows: listColumns(lists), widths: Object.keys(lists).map((k) => Math.max(16, k.length + 2)) },
  ]);
}

/**
 * Checks every sheet; saves nothing. Returns { problems, docs, preview, newValues, plan, counts, total }.
 * plan: what importFile adds before the products (tree values, list values, template fields).
 */
export async function check(companyId, buffer) {
  const wb = openWorkbook(buffer);
  if (!wb) return { problems: [{ sheet: '', row: null, column: '', message: 'This file could not be read as an Excel file (.xlsx).' }], docs: [], preview: [], newValues: [], counts: {}, total: 0 };
  const prod = readSheet(wb, 'Products', COLUMNS);
  const specs = readSheet(wb, 'Specifications', SPEC_COLUMNS, { optional: true, maxRows: DETAIL_ROWS });
  const cfs = readSheet(wb, 'Custom Fields', CF_COLUMNS, { optional: true, maxRows: DETAIL_ROWS });
  const fileProblems = [...prod.fileProblems, ...specs.fileProblems, ...cfs.fileProblems];
  if (fileProblems.length) return { problems: fileProblems.map((m) => ({ sheet: '', row: null, column: '', message: m })), docs: [], preview: [], newValues: [], counts: {}, total: prod.rows.length };

  const cid = oid(companyId);
  const { options, templates, massUnits } = await load(companyId);
  const { byField, childrenOf, resolve, planned } = makeTree(options);
  const problems = [];
  const bad = (sheet, row, column, message) => problems.push({ sheet, row, column, message });
  const badP = (row, key, message) => bad('Products', row, TITLE[key] || key, message);

  // ── Planned additions ──
  // Tree values: makeTree's resolve (existing option, or planned under its own path).
  const listPlan = new Map(); // `${field}|${lower}` → { field, value, rows }
  const listValue = (field, raw, row) => {
    const hit = matchIn(raw, [...new Set((byField.get(field) || []).filter((o) => !o.parentId).map((o) => o.value))]);
    if (hit != null) return hit;
    const k = `${field}|${lower(raw)}`;
    if (!listPlan.has(k)) listPlan.set(k, { field, value: raw, rows: [] });
    const p = listPlan.get(k);
    if (!p.rows.includes(row)) p.rows.push(row);
    return p.value;
  };

  // ── Batched reads: codes (global), the same product already active (company) ──
  const allCodes = await Item.find({}, { code: 1, _id: 0 }).hint({ code: 1 }).lean();
  const codeByLower = new Map(allCodes.map((x) => [String(x.code).toLowerCase(), x.code]));
  const fileNames = [...new Set(prod.rows.map((r) => text(r.values.name)).filter(Boolean))];
  const actives = fileNames.length ? await Item.find({
    companyId: cid, productKind: 'Machine', isDiscontinued: false, name: { $in: fileNames.map(exactRe) },
  }).select('name code category subCategory machineDetails.variant').lean() : [];
  const identityKey = (pType, category, name, variant) => [pType, category, name, variant || ''].map(lower).join('|');
  const activeOf = new Map(actives.map((m) => [identityKey(m.category, m.subCategory, m.name, m.machineDetails?.variant), m.code]));
  const clash = [...new Set(prod.rows.map((r) => text(r.values.code)).filter((c) => codeByLower.has(c.toLowerCase())).map((c) => codeByLower.get(c.toLowerCase())))];
  const holders = new Map(clash.length ? (await Item.find({ code: { $in: clash } }).select('code name companyId isDiscontinued').lean()).map((h) => [h.code.toLowerCase(), h]) : []);

  // ── Products ──
  const products = new Map(); // lower(code) → { row, doc, combo, ok }
  const seenIdentity = new Map();
  for (const r of prod.rows) {
    const v = r.values, row = r.row;
    const before = problems.length;
    // The tree, top down, each level under the one above.
    const req = (key) => { const t = text(v[key]); if (!t) badP(row, key, 'Required.'); return t; };
    const pTypeRaw = req('pType'), categoryRaw = req('category'), nameRaw = req('name'), sourceRaw = req('source');
    const variantRaw = text(v.variant);
    let pType = null, category = null, name = null, variant = null, source = null;
    if (pTypeRaw) pType = resolve(TREE.pType, null, pTypeRaw, row);
    if (pType && categoryRaw) category = resolve(TREE.category, pType, categoryRaw, row);
    if (category && nameRaw) name = resolve(TREE.name, category, nameRaw, row);
    if (name && variantRaw) variant = resolve(TREE.variant, name, variantRaw, row);
    if (category && sourceRaw) source = resolve(TREE.source, category, sourceRaw, row);

    // Code.
    const code = text(v.code);
    if (!code) badP(row, 'code', 'Required.');
    else if (products.has(lower(code))) badP(row, 'code', `"${code}" is also on row ${products.get(lower(code)).row}: codes must be unique.`);
    else if (codeByLower.has(lower(code))) {
      const h = holders.get((codeByLower.get(lower(code)) || '').toLowerCase());
      badP(row, 'code', !h || String(h.companyId) !== String(companyId)
        ? `"${code}" is already used. Codes must be unique: choose another.`
        : h.isDiscontinued ? `"${code}" belongs to the discontinued product "${h.name}". Reactivate it, or choose another code.`
          : `"${code}" is already used by "${h.name}". Codes must be unique.`);
    }

    // The same product (Category + Sub Category + Name + Variant), already active or twice in the file.
    if (pType && category && name) {
      const ik = identityKey(pType.value, category.value, name.value, variant?.value);
      if (activeOf.has(ik)) badP(row, 'name', `This product already exists (code ${activeOf.get(ik)}): same Category, Sub Category, Name and Variant. Edit that one instead.`);
      else if (seenIdentity.has(ik)) badP(row, 'name', `Row ${seenIdentity.get(ik)} is the same product (Category, Sub Category, Name and Variant).`);
      else seenIdentity.set(ik, row);
    }

    // Sourcing: exactly one, the form's words or Purchase / Make.
    const s = lower(v.sourcing);
    const purchase = ['purchasable (vendor)', 'purchasable', 'purchase'].includes(s);
    const internal = ['internal manufacturing', 'make'].includes(s);
    if (!purchase && !internal) badP(row, 'sourcing', text(v.sourcing) ? `"${text(v.sourcing)}": write Purchasable (Vendor) or Internal Manufacturing.` : 'Required: Purchasable (Vendor) or Internal Manufacturing.');

    // Weight: Purchasable only, a Mass Unit unit.
    const weight = num(v.weight);
    const unitRaw = text(v.weightUnit);
    let weightUnit = '';
    if (Number.isNaN(weight) || (weight != null && weight < 0)) badP(row, 'weight', 'A number, 0 or more.');
    if ((weight != null || unitRaw) && internal) badP(row, 'weight', 'Only for a Purchasable product, as on the form. Leave blank.');
    if (unitRaw) {
      weightUnit = matchIn(unitRaw, massUnits) ?? '';
      if (!weightUnit) badP(row, 'weightUnit', `"${unitRaw}" isn't a Mass Unit unit (use: ${massUnits.join(', ') || 'none set up yet'}).`);
    } else if (weight != null && !Number.isNaN(weight) && !internal) badP(row, 'weightUnit', 'Give the unit of the weight (e.g. Kilogram).');

    // Lists.
    const metrology = text(v.metrology) ? listValue(LISTS.metrology, text(v.metrology), row) : '';
    const materialGrade = text(v.materialGrade) ? listValue(LISTS.materialGrade, text(v.materialGrade), row) : '';

    // Power requirements: up to 3.
    const powerRequirements = [];
    for (const i of POWER) {
      const src = text(v[`p${i}source`]);
      const hp = num(v[`p${i}hp`]), kwh = num(v[`p${i}kwh`]), rpm = num(v[`p${i}rpm`]);
      if (!src && hp == null && kwh == null && rpm == null) continue;
      for (const [k, n] of [[`p${i}hp`, hp], [`p${i}kwh`, kwh], [`p${i}rpm`, rpm]]) {
        if (Number.isNaN(n) || (n != null && n < 0)) badP(row, k, 'A number, 0 or more.');
      }
      powerRequirements.push({
        powerSource: src ? listValue(LISTS.power, src, row) : '',
        hp: Number.isNaN(hp) ? null : hp,
        kwh: Number.isNaN(kwh) ? null : (kwh ?? (hp != null && !Number.isNaN(hp) ? hpToKwh(hp) : null)),
        rpm: Number.isNaN(rpm) ? null : rpm,
      });
    }

    const st = lower(v.status);
    if (st && !['continue', 'discontinue', 'active', 'discontinued'].includes(st)) badP(row, 'status', `"${text(v.status)}": Continue or Discontinue.`);
    const fw = lower(v.forward);
    if (fw && !['yes', 'no', 'y', 'n'].includes(fw)) badP(row, 'forward', `"${text(v.forward)}": Yes or No.`);
    // Comma-separated; the same tag twice (any letter case) kept once, first spelling.
    const tags = (raw) => text(raw).split(',').map((x) => x.trim()).filter(Boolean)
      .filter((x, i, all) => all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);

    const ok = problems.length === before;
    if (code && !products.has(lower(code))) {
      products.set(lower(code), {
        row, ok, combo: pType && category && source ? { pType: pType.value, category: category.value, pSourceType: source.value } : null,
        specs: [], cf: [],
        doc: {
          code, name: name?.value || nameRaw, description: text(v.description), type: 'Product', productKind: 'Machine',
          category: pType?.value || pTypeRaw, subCategory: category?.value || categoryRaw, productSourceType: source?.value || sourceRaw,
          brand: text(v.brand), metrology, size: text(v.size), materialGrade,
          unitWeightValue: weight != null && !Number.isNaN(weight) ? weight : null,
          unitWeightUnitType: weightUnit ? 'Mass Unit' : '', unitWeightUnit: weightUnit,
          purchaseUnitType: 'Count Unit', purchaseUnit: 'Pieces', unitType: 'Count Unit', unit: 'Pieces', receiveUnitType: 'Count Unit', receiveUnit: 'Pieces',
          applications: tags(v.applications), purchase, internalManufacturing: internal,
          isDiscontinued: st === 'discontinue' || st === 'discontinued',
          stdCost: 0, purchaseCost: 0, salePrice: 0, mrp: 0, gst: 0, hsn: text(v.hsn), qty: 0, minStock: 0,
          machineDetails: {
            forwardToNextPhase: fw === 'yes' || fw === 'y', variant: variant?.value || '', productionRate: text(v.productionRate),
            powerRequirements, accessories: tags(v.accessories), modelNumber: text(v.modelNumber),
          },
          companyId: cid, store: String(companyId),
        },
      });
    }
  }

  // ── Specifications ──
  for (const r of specs.rows) {
    const v = r.values;
    const p = products.get(lower(v.code));
    if (!text(v.code)) { bad('Specifications', r.row, SPEC_TITLE.code, 'Required.'); continue; }
    if (!p) { bad('Specifications', r.row, SPEC_TITLE.code, `"${text(v.code)}" isn't a product code in the Products sheet.`); continue; }
    if (!text(v.key)) bad('Specifications', r.row, SPEC_TITLE.key, 'Required.');
    if (!text(v.value)) bad('Specifications', r.row, SPEC_TITLE.value, 'Required.');
    if (text(v.key) && text(v.value)) p.specs.push({ key: text(v.key), value: text(v.value) });
  }

  // ── Custom fields: the combination's template, with what it doesn't have yet planned ──
  const tplByCombo = new Map(templates.map((t) => [comboKey(t.pType, t.category, t.pSourceType), t]));
  const tplPlan = new Map(); // comboKey → { combo, existing, groups: [{ label, fields: [name], isNew }], added: [] }
  const planFor = (combo) => {
    const k = comboKey(combo.pType, combo.category, combo.pSourceType);
    if (!tplPlan.has(k)) {
      const existing = tplByCombo.get(k) || null;
      tplPlan.set(k, { combo, existing, groups: (existing?.groups || []).map((g) => ({ label: g.label, fields: (g.fields || []).map((f) => f.name) })), added: new Map() });
    }
    return tplPlan.get(k);
  };
  for (const r of cfs.rows) {
    const v = r.values;
    const p = products.get(lower(v.code));
    if (!text(v.code)) { bad('Custom Fields', r.row, CF_TITLE.code, 'Required.'); continue; }
    if (!p) { bad('Custom Fields', r.row, CF_TITLE.code, `"${text(v.code)}" isn't a product code in the Products sheet.`); continue; }
    for (const k of ['group', 'field', 'value']) if (!text(v[k])) bad('Custom Fields', r.row, CF_TITLE[k], 'Required.');
    if (!text(v.group) || !text(v.field) || !text(v.value) || !p.combo) continue;
    const plan = planFor(p.combo);
    let g = plan.groups.find((x) => lower(x.label) === lower(v.group));
    if (!g) { g = { label: text(v.group), fields: [], isNew: true }; plan.groups.push(g); }
    let f = g.fields.find((x) => lower(x) === lower(v.field));
    if (!f) {
      f = text(v.field);
      g.fields.push(f);
      const ak = `${lower(g.label)}|${lower(f)}`;
      plan.added.set(ak, { group: g.label, field: f, rows: [] });
    }
    const added = plan.added.get(`${lower(g.label)}|${lower(f)}`);
    if (added && !added.rows.includes(r.row)) added.rows.push(r.row);
    if (p.cf.some((c) => lower(c.groupLabel) === lower(g.label) && lower(c.fieldName) === lower(f))) {
      bad('Custom Fields', r.row, CF_TITLE.field, `"${g.label} › ${f}" is already given for ${p.doc.code}.`);
      continue;
    }
    p.cf.push({ groupLabel: g.label, fieldName: f, value: text(v.value) });
  }

  // ── The products, with every field of their combination's template (as the form seeds them) ──
  const docs = [], preview = [];
  for (const p of products.values()) {
    if (!p.ok) continue;
    const plan = p.combo ? (tplPlan.get(comboKey(p.combo.pType, p.combo.category, p.combo.pSourceType)) || null) : null;
    const tpl = plan ? plan.groups : (p.combo ? (tplByCombo.get(comboKey(p.combo.pType, p.combo.category, p.combo.pSourceType))?.groups || []).map((g) => ({ label: g.label, fields: (g.fields || []).map((f) => f.name) })) : []);
    const customFields = tpl.flatMap((g) => g.fields.map((f) => ({
      groupLabel: g.label, fieldName: f,
      value: p.cf.find((c) => lower(c.groupLabel) === lower(g.label) && lower(c.fieldName) === lower(f))?.value || '',
    })));
    const doc = { ...p.doc, specifications: p.specs, customFields };
    docs.push(doc);
    if (preview.length < 50) {
      preview.push({
        row: p.row, code: doc.code, path: [doc.category, doc.subCategory, doc.name].join(' › '), variant: doc.machineDetails.variant,
        source: doc.productSourceType, purchase: doc.purchase, specs: p.specs.length, customFields: p.cf.length,
      });
    }
  }

  const newValues = [
    ...plannedValues(planned(), TREE_LABEL),
    ...[...tplPlan.values()].flatMap((t) => [...t.added.values()].map((a) => ({ list: 'Custom field', value: `${a.group} › ${a.field}`, under: `${t.combo.pType} / ${t.combo.category} / ${t.combo.pSourceType}${t.existing ? '' : ' (new template)'}`, rows: a.rows }))),
    ...[...listPlan.values()].map((l) => ({ list: LIST_LABEL[l.field], value: l.value, under: '', rows: l.rows })),
  ];
  const SHEET_ORDER = { '': 0, Products: 1, Specifications: 2, 'Custom Fields': 3 };
  problems.sort((a, b) => (SHEET_ORDER[a.sheet] ?? 9) - (SHEET_ORDER[b.sheet] ?? 9) || (a.row || 0) - (b.row || 0) || String(a.column).localeCompare(String(b.column)));
  return {
    problems, docs, preview, newValues,
    plan: { tree: planned(), lists: [...listPlan.values()], templates: [...tplPlan.values()].filter((t) => t.added.size) },
    counts: { products: docs.length, tree: planned().length, templateFields: newValues.filter((n) => n.list === 'Custom field').length, lists: listPlan.size },
    total: prod.rows.length,
  };
}

/**
 * Checks again; adds the classifications, then the products — all or nothing.
 * Returns { imported, added: { tree, templateFields, lists } }.
 */
export async function importFile(companyId, user, buffer) {
  const c = await check(companyId, buffer);
  if (c.problems.length) {
    const e = new ImportError(400, 'The file has problems: nothing was imported.');
    e.problems = c.problems;
    throw e;
  }
  const cid = oid(companyId);
  const created = { options: [], templates: [], restored: [], items: [] };
  try {
    // 1. Tree values, parents first, each linked to its parent option.
    await insertPlanned(c.plan.tree, DEPTH, companyId, c.plan.lists.map((l) => ({ field: l.field, value: l.value })), created.options);
    // 2. Templates: a new combination's created; an existing one's groups / fields appended.
    for (const t of c.plan.templates) {
      if (!t.existing) {
        const _id = new mongoose.Types.ObjectId();
        created.templates.push(_id);
        await RDCustomFieldTemplate.create({ _id, ...t.combo, groups: t.groups.map((g) => ({ label: g.label, fields: g.fields.map((name) => ({ name })) })), company: cid, createdBy: user._id });
      } else {
        const groups = (t.existing.groups || []).map((g) => ({ ...g, fields: [...(g.fields || [])] }));
        for (const a of t.added.values()) {
          let g = groups.find((x) => lower(x.label) === lower(a.group));
          if (!g) { g = { label: a.group, fields: [] }; groups.push(g); }
          g.fields.push({ name: a.field });
        }
        created.restored.push({ _id: t.existing._id, groups: t.existing.groups });
        await RDCustomFieldTemplate.updateOne({ _id: t.existing._id }, { $set: { groups } });
      }
    }
    // 3. The products.
    created.items = c.docs.map((d) => { d._id = new mongoose.Types.ObjectId(); return d._id; });
    await Item.insertMany(c.docs, { ordered: true });
  } catch (err) {
    // All or nothing: take back everything this import added.
    await Item.deleteMany({ _id: { $in: created.items } }).catch(() => {});
    await RDMasterOption.deleteMany({ _id: { $in: created.options } }).catch(() => {});
    await RDCustomFieldTemplate.deleteMany({ _id: { $in: created.templates } }).catch(() => {});
    for (const r of created.restored) await RDCustomFieldTemplate.updateOne({ _id: r._id }, { $set: { groups: r.groups } }).catch(() => {});
    const dup = err?.code === 11000 || err?.writeErrors?.some?.((w) => w.code === 11000);
    throw new ImportError(409, dup
      ? 'A code or value in the file was added by someone else while importing: nothing was imported. Check the file again.'
      : `Saving failed: nothing was imported (${err.message}).`);
  }
  return { imported: c.docs.length, added: { tree: c.counts.tree, templateFields: c.counts.templateFields, lists: c.counts.lists } };
}
