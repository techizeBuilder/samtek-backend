// Purchase owns "usual days to buy" and job-work time (19 Nov 2026, the delivery
// estimate's deep test — docs/delivery-estimate/01-logic.md §13).
//
// The item form lost its "Lead Time (Days)" box at the client's request (8 Aug),
// so Purchase → Inventory now keeps each item's usual days to buy (the item's own
// `leadTime`), and a Job Work Time tab keeps each Out Source process's usual days
// away (ProcessCategoryOption.usualDays — R&D's box moved here). Both pages also
// say what Sales' delivery estimate will use, with the same rules it uses
// (history from 3 records first; services/estimate/history.js).
import mongoose from 'mongoose';
import ProcessCategoryOption from '../models/ProcessCategoryOption.js';
import MachineBOM from '../models/MachineBOM.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import { Item } from '../models/Inventory.js';
import { purchaseDaysFor, quotedDaysFor, jobworkHistory } from './estimate/history.js';

export class PurchaseDaysError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const norm = (s) => String(s || '').trim().toLowerCase();
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * What the delivery estimate uses for each item's days to buy, for one page of
 * items [{ _id, code, leadTime }]: Map itemId → { typed, history, receipts, quote, uses }.
 * The estimate's order (open PO aside, which belongs to an order): history (3+
 * receipts) → a vendor quote + the usual buying time → Purchase's usual days.
 */
export async function buyDaysInfo(companyId, items = []) {
  const codes = [...new Set(items.map((i) => i.code).filter(Boolean))];
  const out = new Map();
  if (!codes.length) return out;
  const [hist, quoted] = await Promise.all([purchaseDaysFor(companyId, codes), quotedDaysFor(companyId, codes)]);
  for (const it of items) {
    const typed = Number(it.leadTime) > 0 ? Number(it.leadTime) : null;
    const h = hist.byCode.get(it.code) || null;
    const q = quoted.get(it.code);
    const quote = q != null && hist.buyingDays != null ? { days: q, buyingDays: hist.buyingDays } : null;
    out.set(String(it._id), {
      typed,
      history: h ? { days: h.days, receipts: h.samples } : null,
      receipts: hist.receiptsByCode.get(it.code) || 0,
      quote,
      uses: h ? 'history' : quote ? 'quote' : typed ? 'typed' : null,
    });
  }
  return out;
}

/**
 * The Job Work Time tab: one row per process sent out for job work — used as an
 * Out Source step in any BOM (machine, Child Part, Sub Child Part), or already
 * given usual days. Bounded by the company's products, not by history.
 */
export async function jobWorkTimeRows(companyId) {
  const cid = oid(companyId);
  const pdSelect = 'processDefinition.label processDefinition.internalProcesses.name processDefinition.internalProcesses.type';
  const [options, machineBoms, childBoms, subParts] = await Promise.all([
    ProcessCategoryOption.find({ companyId: cid }).select('bomLevel label internalProcesses usualDays').lean(),
    MachineBOM.find({ company: cid }).select(`machine ${pdSelect}`).lean(),
    ChildPartBOM.find({ company: cid }).select(`childPart ${pdSelect}`).lean(),
    Item.find({ companyId: cid, productKind: 'SubChildPart', isDiscontinued: { $ne: true } })
      .select('name code subChildPartDetails.processDefinition.label subChildPartDetails.processDefinition.internalProcesses.name subChildPartDetails.processDefinition.internalProcesses.type').lean(),
  ]);
  const ownerIds = [...machineBoms.map((b) => b.machine), ...childBoms.map((b) => b.childPart)].filter(Boolean);
  const owners = new Map((await Item.find({ _id: { $in: ownerIds } }).select('name code isDiscontinued').lean()).map((i) => [String(i._id), i]));

  const rows = new Map(); // process (lower case) → row
  const rowOf = (name) => {
    const k = norm(name);
    if (!rows.has(k)) rows.set(k, { process: String(name).trim(), categories: new Set(), days: null, mixed: false, usedBy: [] });
    return rows.get(k);
  };
  const addUse = (pd, part, level) => {
    if (!part || part.isDiscontinued) return;
    for (const cat of pd || []) {
      for (const p of cat.internalProcesses || []) {
        if (p.type !== 'OutSource' || !p.name) continue;
        const r = rowOf(p.name);
        r.categories.add(cat.label);
        if (!r.usedBy.some((u) => u.code === part.code && u.level === level)) r.usedBy.push({ name: part.name, code: part.code, level });
      }
    }
  };
  for (const b of machineBoms) addUse(b.processDefinition, owners.get(String(b.machine)), 'Machine');
  for (const b of childBoms) addUse(b.processDefinition, owners.get(String(b.childPart)), 'Child Part');
  for (const s of subParts) addUse(s.subChildPartDetails?.processDefinition, s, 'Sub Child Part');
  for (const o of options) {
    for (const u of o.usualDays || []) {
      const r = rowOf(u.process);
      r.categories.add(o.label);
      if (r.days == null) r.days = u.days;
      else if (r.days !== u.days) r.mixed = true;
    }
  }

  const history = await jobworkHistory(companyId, [...rows.keys()]);
  return [...rows.entries()]
    .map(([k, r]) => {
      const h = history.get(k) || { days: null, samples: 0 };
      return {
        process: r.process,
        categories: [...r.categories].sort(),
        days: r.days,
        mixed: r.mixed,
        history: { days: h.days, trips: h.samples },
        usedBy: r.usedBy.sort((a, b) => a.name.localeCompare(b.name)),
        uses: h.days != null ? 'history' : r.days != null ? 'typed' : null,
      };
    })
    .sort((a, b) => a.process.localeCompare(b.process));
}

/**
 * Purchase sets a process's usual days away (0–365, one decimal; empty clears). It's
 * written to every process category that lists the process, so two categories
 * with the same process (e.g. two "painting" ones) can't disagree.
 */
export async function setJobWorkDays(companyId, process, days) {
  const name = String(process || '').trim();
  if (!name) throw new PurchaseDaysError(400, 'Which process?');
  let value = null;
  if (!(days === null || days === undefined || String(days).trim() === '')) {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0 || n > 365) throw new PurchaseDaysError(400, 'Usual days must be a number from 0 to 365, or empty.');
    value = Math.round(n * 10) / 10;
  }
  const options = await ProcessCategoryOption.find({ companyId: oid(companyId) });
  const hits = options.filter((o) => (o.internalProcesses || []).some((p) => norm(p) === norm(name)));
  if (!hits.length) throw new PurchaseDaysError(404, `"${name}" isn't in any process template. R&D adds it to a process template first.`);
  for (const o of hits) {
    const stored = o.internalProcesses.find((p) => norm(p) === norm(name));
    const rest = (o.usualDays || []).filter((u) => norm(u.process) !== norm(name));
    o.usualDays = value == null ? rest : [...rest, { process: stored, days: value }];
    await o.save();
  }
  return { process: name, days: value, categories: hits.length };
}

/** Purchase sets an item's usual days to buy (whole days 0–365; empty = not set). Only `leadTime` changes. */
export async function setUsualDaysToBuy(scopeFilter, itemId, days) {
  if (!mongoose.isValidObjectId(itemId)) throw new PurchaseDaysError(404, 'Item not found');
  let n = 0;
  if (!(days === null || days === undefined || String(days).trim() === '')) {
    n = Number(days);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw new PurchaseDaysError(400, 'Usual days to buy must be a whole number from 0 to 365, or empty.');
  }
  const item = await Item.findOne({ _id: itemId, purchase: true, ...scopeFilter }).select('_id code').lean();
  if (!item) throw new PurchaseDaysError(404, 'Item not found');
  await Item.updateOne({ _id: item._id }, { $set: { leadTime: n } });
  return { _id: item._id, code: item.code, leadTime: n };
}
