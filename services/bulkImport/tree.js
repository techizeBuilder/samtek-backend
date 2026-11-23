// Bulk import (features 21–22): a classification tree (RDMasterOption by parentId) read
// the way the pages read it, with the values a file adds planned under their own path.
// Product Master: P-Type → Category → ProductName → ProductVariant, P-SourceType under
// Category. Plant Master: PlantCategory → PlantSubCategory → PlantName → PlantProduction.
import mongoose from 'mongoose';
import RDMasterOption from '../../models/RDMasterOption.js';
import { text } from './common.js';

const lower = (v) => text(v).toLowerCase();

/**
 * options: the company's RDMasterOption rows (field value parentId parentValue).
 * A child belongs to its parent OPTION by parentId; an old value not linked yet, by its
 * parent's text (client/src/lib/classificationTree.js isChildOf).
 * resolve(field, parent, raw, row) → the existing option ({ id, value, path }) or a planned
 * one ({ planned, planKey, value, path }); letter case ignored, the first spelling wins.
 */
export function makeTree(options = []) {
  const byField = new Map();
  for (const o of options) {
    if (!byField.has(o.field)) byField.set(o.field, []);
    byField.get(o.field).push(o);
  }
  const childrenOf = (field, parent) => (byField.get(field) || []).filter((o) => {
    if (!parent) return !o.parentId; // the top level
    if (parent.planned) return false; // a value this file adds has no children yet
    if (o.parentId) return String(o.parentId) === String(parent.id);
    return o.parentValue === parent.value; // not linked yet (legacy)
  });
  const plan = new Map(); // key → { key, field, value, parent, path, rows }
  const resolve = (field, parent, raw, row) => {
    const hit = childrenOf(field, parent).filter((o) => lower(o.value) === lower(raw));
    const existing = hit[0];
    if (existing) return { id: existing._id, value: existing.value, path: [...(parent?.path || []), existing.value] };
    const key = `${field}|${parent ? (parent.id ? String(parent.id) : parent.planKey) : 'root'}|${lower(raw)}`;
    if (!plan.has(key)) plan.set(key, { key, field, value: raw, parent, path: [...(parent?.path || []), raw], rows: [] });
    const p = plan.get(key);
    if (!p.rows.includes(row)) p.rows.push(row);
    return { planned: true, planKey: key, value: p.value, path: [...(parent?.path || []), p.value] };
  };
  return { byField, childrenOf, resolve, planned: () => [...plan.values()] };
}

/**
 * Inserts planned tree values, parents first (depth: field → level), each linked to its
 * parent option, plus any `extra` option docs (flat list values). Returns the new ids,
 * set on `created` as they're made, so a failure can take them back.
 */
export async function insertPlanned(nodes, depth, companyId, extra = [], created = []) {
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const ids = new Map();
  const docs = [];
  for (const n of [...nodes].sort((a, b) => depth[a.field] - depth[b.field])) {
    const _id = new mongoose.Types.ObjectId();
    ids.set(n.key, _id);
    const parentId = n.parent ? (n.parent.id ? new mongoose.Types.ObjectId(String(n.parent.id)) : ids.get(n.parent.planKey)) : null;
    docs.push({ _id, field: n.field, value: n.value, parentValue: n.parent ? n.parent.value : null, parentId, company: cid });
  }
  for (const e of extra) docs.push({ _id: new mongoose.Types.ObjectId(), parentValue: null, parentId: null, company: cid, ...e });
  if (!docs.length) return created;
  created.push(...docs.map((d) => d._id));
  await RDMasterOption.insertMany(docs, { ordered: true });
  return created;
}

/** The new values a file adds, for the check's "New list values to add" box. */
export const plannedValues = (nodes, label) => nodes.map((t) => ({ list: label[t.field], value: t.value, under: (t.parent?.path || []).join(' › '), rows: t.rows }));
