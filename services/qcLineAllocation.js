// QC by PO line (2026-10-15, user decisions 2026-10-14). QC decides a
// received PO LINE once; underneath, every request on the line keeps its own
// QC job. When QC rejects part of the line, this decides WHICH requests the
// rejected quantity is counted against — so stock, money, the REJ record and
// any sales order / production link land on the right request.
//
// The rule (user):
//   1. Fabrication: per SIZE first — rejected pieces of a size only go to the
//      requests that received that size.
//   2. Then FILL: if one request has at least the rejected quantity left, it
//      all goes on that one; otherwise fill one request completely, then the
//      next, until it's used up.
//   3. Which request first: stock requests (auto reorder / Store's manual /
//      a replacement) → production (BOM shortfall) → sales order; within a
//      kind the NEWEST first — so a customer's order and the oldest need stay
//      whole as long as possible.
//   (Serial items don't come here: the ticked serials already belong to
//   their own request.)
// Pure — no database.
import { dimensionSignature } from './fabricationDemandService.js';

export const KIND_RANK = { stock: 0, production: 1, sales: 2 };
export const KIND_LABEL = { stock: 'stock', production: 'production', sales: 'sales order' };

// purchaseRequestController.classifyRaisedBy → the three kinds above.
export function kindOfRaisedBy(raisedBy) {
  if (raisedBy === 'cascade') return 'production';
  if (raisedBy === 'salesOrder') return 'sales';
  return 'stock';
}

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const EPS = 1e-9;

// Candidates in the order they take a rejection.
export function pickOrder(cands) {
  return [...cands].sort((a, b) =>
    (KIND_RANK[a.kind] ?? 0) - (KIND_RANK[b.kind] ?? 0)
    || new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    || String(a.id).localeCompare(String(b.id)));
}

// One pool: cands = [{ id, qty, kind, createdAt }]. Returns Map id → qty.
export function fillRejection(cands, rejectQty) {
  const ordered = pickOrder(cands.filter(c => Number(c.qty) > EPS));
  const out = new Map();
  const whole = ordered.find(c => Number(c.qty) + EPS >= rejectQty);
  if (whole) { out.set(String(whole.id), round3(rejectQty)); return out; }
  let left = rejectQty;
  for (const c of ordered) {
    if (left <= EPS) break;
    const take = Math.min(Number(c.qty), left);
    out.set(String(c.id), round3(take));
    left = round3(left - take);
  }
  return out;
}

// jobs = [{ id, qty, kind, createdAt, sizes?: [{ values, quantity }] }]
//   qty = what's still undecided on that job; sizes (fabrication) = its own
//   undecided pieces per size.
// rejectQty = total to reject (non-fabrication, or fabrication with one size)
// bySize = [{ values, qty }] (fabrication with several sizes)
// whole = quantities must be whole pieces
// Returns { error } or { perJob: Map id → { qty, sizes: [{ values, qty }] }, total }.
export function allocateRejection({ jobs, rejectQty = null, bySize = null, whole = false, isFabrication = false }) {
  const list = (jobs || []).filter(j => Number(j.qty) > EPS);
  const available = round3(list.reduce((s, j) => s + Number(j.qty), 0));
  const isWhole = (n) => Math.abs(n - Math.round(n)) < 1e-6;
  const perJob = new Map();
  const add = (id, qty, values = null) => {
    const k = String(id);
    const cur = perJob.get(k) || { qty: 0, sizes: [] };
    cur.qty = round3(cur.qty + qty);
    if (values) cur.sizes.push({ values, qty });
    perJob.set(k, cur);
  };

  if (!isFabrication) {
    const n = Number(rejectQty);
    if (!(n > 0)) return { error: 'Enter how many were rejected.' };
    if (whole && !isWhole(n)) return { error: 'Rejected pieces must be a whole number.' };
    if (n > available + EPS) return { error: `Only ${available} are waiting for QC on this line.` };
    for (const [id, qty] of fillRejection(list, n)) add(id, qty);
    return { perJob, total: round3(n) };
  }

  // Fabrication — per size first.
  const sizesOf = (j) => (j.sizes || []).filter(s => Number(s.quantity) > EPS);
  const allSizes = new Map();
  for (const j of list) for (const s of sizesOf(j)) {
    const sig = dimensionSignature(s.values);
    if (!allSizes.has(sig)) allSizes.set(sig, s.values);
  }
  let asked = Array.isArray(bySize) ? bySize.filter(s => Number(s?.qty) > 0) : null;
  if (!asked || !asked.length) {
    // One number for the whole line — fine only when the line is one size.
    const n = Number(rejectQty);
    if (!(n > 0)) return { error: 'Enter how many pieces were rejected.' };
    if (allSizes.size > 1) return { error: 'This delivery has several sizes — enter the rejected pieces per size.' };
    const [values] = allSizes.values();
    asked = [{ values, qty: n }];
  }
  let total = 0;
  for (const a of asked) {
    const n = Number(a.qty);
    if (!isWhole(n)) return { error: 'Rejected pieces must be a whole number.' };
    const sig = dimensionSignature(a.values);
    if (!allSizes.has(sig)) return { error: 'One of the sizes isn\'t in this delivery — refresh the page.' };
    const pool = list.map(j => ({
      id: j.id, kind: j.kind, createdAt: j.createdAt,
      qty: sizesOf(j).filter(s => dimensionSignature(s.values) === sig).reduce((t, s) => t + Number(s.quantity), 0),
    }));
    const have = pool.reduce((t, p) => t + p.qty, 0);
    if (n > have + EPS) return { error: `Only ${have} pieces of that size are waiting for QC.` };
    for (const [id, qty] of fillRejection(pool, n)) add(id, qty, allSizes.get(sig));
    total += n;
  }
  return { perJob, total: round3(total) };
}

// ── Reject breakdown (2026-10-30, docs/qc-reject-breakdown-2026-10.md) ────
// QC rejects a batch as LINES — qty (or serials) × what failed × remark — each
// with its own severity, photos and (fabrication) size. One REJ per line.

export const SEVERITIES = ['Minor', 'Major', 'Critical'];
export const LINE_PHOTO_MAX = 5;

// raw = [{ qty, serials, parameter, other, otherText, remark, severity, size, photoIndexes }]
// ctx = { inQc, whole, isFabrication, sizes: [{ values, quantity }] in QC,
//   serialIds: null | ids of the pieces in QC, checklistParams: [names], photos: [{ url, name }] }
// Returns { error } or { lines: [{ qty, serials, sizeValues, parameter, other, remark,
//   severity, photos }], total, bySize: [{ values, qty }], serials: [ids] }.
export function readRejectLines(raw, ctx) {
  const list = Array.isArray(raw) ? raw.filter(Boolean) : [];
  if (!list.length) return { error: 'Add the reject lines — how many, what failed, and what was wrong.' };
  const isWhole = (n) => Math.abs(n - Math.round(n)) < 1e-6;
  const params = new Set((ctx.checklistParams || []).map(p => String(p).trim()));
  const sizes = (ctx.sizes || []).filter(s => Number(s.quantity) > EPS);
  const serialMode = Array.isArray(ctx.serialIds);
  const inQcSerials = serialMode ? new Set(ctx.serialIds.map(String)) : null;
  const usedSerials = new Set();
  const photos = ctx.photos || [];
  const lines = [];
  for (const l of list) {
    const remark = String(l.remark || '').trim();
    if (!remark) return { error: 'Say what was wrong on each line.' };
    const other = !!l.other;
    const parameter = String(other ? (l.otherText || l.parameter || '') : (l.parameter || '')).trim();
    if (!parameter) return { error: other ? 'Type what failed on the "Other" line.' : 'Pick what failed on each line — a check, or Other.' };
    if (!other && params.size && !params.has(parameter)) return { error: `"${parameter}" isn't on this job's checklist — pick a check, or Other.` };
    const severity = SEVERITIES.includes(l.severity) ? l.severity : 'Major';
    let qty;
    let serials = null;
    if (serialMode) {
      serials = [...new Set((Array.isArray(l.serials) ? l.serials : []).map(String))];
      if (!serials.length) return { error: 'Tick the serial numbers on each line.' };
      if (serials.some(s => !inQcSerials.has(s))) return { error: 'One of the ticked serial numbers isn\'t waiting for QC — refresh the page.' };
      if (serials.some(s => usedSerials.has(s))) return { error: 'A serial number is on two lines — each piece fails for one reason.' };
      serials.forEach(s => usedSerials.add(s));
      qty = serials.length;
    } else {
      qty = Number(l.qty);
      if (!(qty > 0)) return { error: 'Each line needs how many were rejected.' };
      if (ctx.whole && !isWhole(qty)) return { error: 'Rejected pieces must be a whole number.' };
    }
    let sizeValues = null;
    if (ctx.isFabrication) {
      if (sizes.length > 1) {
        const hit = l.size && sizes.find(s => dimensionSignature(s.values) === dimensionSignature(l.size));
        if (!hit) return { error: 'Pick the size on each line — this delivery has several.' };
        sizeValues = hit.values;
      } else if (sizes.length === 1) {
        sizeValues = sizes[0].values;
      }
    }
    const idx = Array.isArray(l.photoIndexes) ? [...new Set(l.photoIndexes.map(Number))].filter(i => Number.isInteger(i) && photos[i]) : [];
    if (idx.length > LINE_PHOTO_MAX) return { error: `Up to ${LINE_PHOTO_MAX} photos on each line.` };
    lines.push({ qty: round3(qty), serials, sizeValues, parameter, other, remark, severity, photos: idx.map(i => photos[i]) });
  }
  const total = round3(lines.reduce((s, l) => s + l.qty, 0));
  if (total > Number(ctx.inQc) + EPS) return { error: `Only ${round3(ctx.inQc)} are in QC — the lines add up to ${total}.` };
  const bySizeMap = new Map();
  for (const l of lines) {
    if (!l.sizeValues) continue;
    const sig = dimensionSignature(l.sizeValues);
    const cur = bySizeMap.get(sig) || { values: l.sizeValues, qty: 0 };
    cur.qty = round3(cur.qty + l.qty);
    bySizeMap.set(sig, cur);
  }
  for (const b of bySizeMap.values()) {
    const have = sizes.filter(s => dimensionSignature(s.values) === dimensionSignature(b.values)).reduce((t, s) => t + Number(s.quantity), 0);
    if (b.qty > have + EPS) return { error: `Only ${have} pieces of that size are in QC.` };
  }
  return { lines, total, bySize: [...bySizeMap.values()], serials: serialMode ? [...usedSerials] : [] };
}

// A PO line decided as one: each request takes its share of the rejection
// (allocateRejection's plan, in pickOrder). Walk the lines in the same order
// and split a line where a request's share ends — so each request's REJs get
// their own lines and nothing is counted twice. Serial lines go to the request
// that owns each serial (serialOwner: Map serialId → jobId).
// plan = Map jobId → { qty, sizes: [{ values, qty }] }; jobs = [{ id, kind, createdAt }].
// Returns Map jobId → lines.
export function shareLines(lines, { plan = null, jobs = [], serialOwner = null } = {}) {
  const out = new Map();
  const put = (id, line) => { const k = String(id); if (!out.has(k)) out.set(k, []); out.get(k).push(line); };
  if (serialOwner) {
    for (const l of lines) {
      const byJob = new Map();
      for (const s of l.serials || []) {
        const owner = serialOwner.get(String(s));
        if (!owner) continue;
        if (!byJob.has(owner)) byJob.set(owner, []);
        byJob.get(owner).push(s);
      }
      for (const [id, serials] of byJob) put(id, { ...l, serials, qty: serials.length });
    }
    return out;
  }
  const order = pickOrder(jobs.map(j => ({ ...j, qty: 1 }))).map(j => String(j.id));
  // Each request's room, per size (fabrication) or one pool.
  const sized = [...(plan || new Map()).values()].some(p => p.sizes?.length);
  const room = new Map();
  const key = (id, values) => `${id}|${values ? dimensionSignature(values) : '*'}`;
  for (const [id, p] of plan || []) {
    if (sized) for (const s of p.sizes || []) room.set(key(id, s.values), round3((room.get(key(id, s.values)) || 0) + Number(s.qty)));
    else room.set(key(id, null), round3(Number(p.qty)));
  }
  for (const l of lines) {
    let left = l.qty;
    for (const id of order) {
      if (left <= EPS) break;
      const k = key(id, sized ? l.sizeValues : null);
      const free = room.get(k) || 0;
      if (free <= EPS) continue;
      const take = round3(Math.min(free, left));
      room.set(k, round3(free - take));
      left = round3(left - take);
      put(id, { ...l, qty: take });
    }
  }
  return out;
}
