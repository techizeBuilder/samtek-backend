// Item codes and "the same item twice" (2026-11-16, docs/product-master-code-bug-2026-11.md
// and docs/rd-item-codes-audit-2026-11.md).
//
// Product Master, Inventory, Motor Master, Child Part and Sub Child Part all save
// into the one Item collection, and Item.code is `unique: true` across the WHOLE
// database (every company, discontinued items too). Each form used to check only
// its own company's codes, in exact letter case, so a taken code could pass the
// check and then fail in the database. And a generator that always finds a free
// code no longer stops the same item being saved twice, so each form also has a
// "same item" rule (see the callers).
import { Item } from '../models/Inventory.js';

export const escapeRe = (s) => String(s ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole value, ignoring upper / lower case and surrounding spaces.
export const exactRe = (s) => new RegExp(`^${escapeRe(s)}$`, 'i');

/** Who holds this code anywhere: { name, mine, discontinued, kind } or null. excludeId = the item being edited. */
export async function findCodeHolder(companyId, code, excludeId = null) {
  const hit = await Item.findOne({ code: exactRe(code), ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select('name code companyId isDiscontinued productKind').lean();
  return hit ? { name: hit.name, mine: String(hit.companyId) === String(companyId), discontinued: !!hit.isDiscontinued, kind: hit.productKind || null } : null;
}

/** The sentence for a taken code. Never names another company's item. */
export function codeTakenMessage(code, hit, label = 'Product Code') {
  const c = String(code).trim();
  if (!hit.mine) return `${label} "${c}" is already used. Codes must be unique: choose another.`;
  if (hit.discontinued) return `${label} "${c}" belongs to the discontinued item "${hit.name}". Reactivate it, or choose another code.`;
  return `${label} "${c}" is already used by "${hit.name}". Codes must be unique.`;
}

/** base if nobody holds it, else base-2, base-3 … → { code, taken } (null after 200 tries). */
export async function freeCode(base) {
  const b = String(base || '').trim().toUpperCase();
  if (!b) return null;
  for (let n = 1; n <= 200; n++) {
    const candidate = n === 1 ? b : `${b}-${n}`;
    if (!(await Item.exists({ code: exactRe(candidate) }))) return { code: candidate, taken: n > 1 };
  }
  return null;
}

/**
 * The next PREFIX-NNN code: one more than the highest number any item (any
 * company) already has under that prefix, so a deleted item, a code typed by hand
 * or another company can't make it clash. Replaces "count + 1", which did.
 */
export async function nextSequentialCode(prefix, pad = 3) {
  const p = escapeRe(prefix);
  const rows = await Item.find({ code: new RegExp(`^${p}-\\d+$`, 'i') }).select('code').lean();
  let max = 0;
  for (const r of rows) {
    const m = String(r.code).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  // Belt and braces: skip anything taken in between (e.g. "CP-007 " with a space).
  for (let n = max + 1; n < max + 200; n++) {
    const candidate = `${prefix}-${String(n).padStart(pad, '0')}`;
    if (!(await Item.exists({ code: exactRe(candidate) }))) return candidate;
  }
  return `${prefix}-${String(max + 1).padStart(pad, '0')}`;
}

/** A readable reply for a duplicate-key error from the database (two saves at once). */
export const duplicateKeyMessage = (err, label = 'Code') =>
  (err?.code === 11000 ? `${label} already exists: it was just saved by someone else. Choose another.` : null);

/**
 * Reactivating an item (2026-11-16): an ACTIVE item that is the same thing, by the
 * rule each form uses for Add / Edit, or null. A discontinued item doesn't block a
 * new one with its name, so without this, reactivating the old one made two.
 *   Machine (Product Master): Category + Sub Category + Name + Variant
 *   Sub Child Part: name;  Child Part: name, among Child Part Master parts only
 *   anything else (Inventory, Motor): name + Item Type + record type (inventoryTwinQuery)
 * `item` = the stored item, with any name / category / type being saved merged in.
 */
export async function findActiveTwin(item) {
  const base = { _id: { $ne: item._id }, isDiscontinued: { $ne: true } };
  const name = exactRe(item.name || '');
  if (item.productKind === 'Machine') {
    const v = String(item.machineDetails?.variant || '').trim();
    return Item.findOne({
      ...base, companyId: item.companyId, productKind: 'Machine',
      category: exactRe(item.category || ''), subCategory: exactRe(item.subCategory || ''), name,
      'machineDetails.variant': v ? exactRe(v) : { $in: ['', null] },
    }).select('name code').lean();
  }
  if (item.productKind === 'SubChildPart') {
    return Item.findOne({ ...base, companyId: item.companyId, productKind: 'SubChildPart', name }).select('name code').lean();
  }
  if (item.productKind === 'ChildPart') {
    const { default: ChildPartBOM } = await import('../models/ChildPartBOM.js');
    // An old per-machine Child Part (no Child Part Master) has no twin rule.
    if (!(await ChildPartBOM.exists({ childPart: item._id }))) return null;
    const hits = await Item.find({ ...base, companyId: item.companyId, productKind: 'ChildPart', name }).select('name code').lean();
    if (!hits.length) return null;
    const bom = await ChildPartBOM.findOne({ childPart: { $in: hits.map((h) => h._id) } }).select('childPart').lean();
    return bom ? hits.find((h) => String(h._id) === String(bom.childPart)) : null;
  }
  return Item.findOne({
    ...inventoryTwinQuery({ companyId: item.companyId, name: item.name, itemType: item.itemType, type: item.type }, item._id),
    isDiscontinued: { $ne: true },
  }).select('name code').lean();
}

export const reactivateTwinMessage = (hit) =>
  `Can't reactivate: "${hit.name}" is already active as ${hit.code}, the same item. Discontinue that one first, or edit one of them.`;

// An empty value matches an empty or missing one (the Inventory form never sends
// some fields, while stored items hold ""). Found 16 Nov: the old Add check compared
// category with `undefined`, matched nothing, and let "Sheet 8x16" be saved twice.
export const sameText = (v) => (String(v ?? '').trim() ? exactRe(v) : { $in: ['', null] });

/**
 * The same Inventory / Motor item (2026-11-16): same name + the same Item Type (the
 * form's "Item Type", stored as itemType) + the same record type (type: Material /
 * Product / Spares / Assemblies), in the company. The old rule compared a legacy
 * `category` the form no longer fills, so it never matched.
 */
export function inventoryTwinQuery({ companyId, name, itemType, type }, excludeId = null) {
  return {
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    name: exactRe(name || ''), itemType: sameText(itemType), type: sameText(type),
    productKind: { $nin: ['Machine', 'SubChildPart', 'ChildPart'] },
    $or: [{ companyId }, { store: String(companyId) }],
  };
}
