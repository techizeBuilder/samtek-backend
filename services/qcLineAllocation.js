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
