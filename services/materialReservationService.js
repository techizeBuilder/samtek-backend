// Shared reservation ledger — see MaterialReservation.js's own header
// comment for the bug this fixes and why it's shaped as one-doc-per-
// (item, size, order, line) rather than a single aggregate counter on Item.
//
// Reservation pipeline fix (2026-10-09, procurement-v2 gap 9). A row now
// means "still to be ISSUED for this order":
//   remaining = quantity (full need) − issuedQuantity
//   free(item, size) = stock − Σ remaining of every row for (item, size)
// - Reserving never changes stock; Store's transfer does, and at the same
//   moment raises the order's issuedQuantity (recordIssue) — so issued
//   material is no longer subtracted twice (once from stock, once as
//   "reserved") until the order completes.
// - A defective return lowers issuedQuantity again (recordReturn): the order
//   still needs a good replacement, so it's re-reserved. An excess return
//   doesn't touch the ledger.
// - Fabrication rows carry their SIZE (dimensionVariantId): free stock is per
//   size, since fabrication stock lives per size (dimensionVariants[].subStock).
// - lineKey keeps an order's own BOM lines apart (two sheet cut-groups of one
//   sheet size used to overwrite each other).
import mongoose from 'mongoose';
import MaterialReservation from '../models/MaterialReservation.js';

const { ObjectId } = mongoose.Types;
const oid = (v) => (v == null ? null : (v instanceof ObjectId ? v : new ObjectId(String(v))));

// ── Pure helpers (exported for tests) ──────────────────────────────────────
export const remainingOf = (row) => Math.max(0, (Number(row?.quantity) || 0) - (Number(row?.issuedQuantity) || 0));

// Spread an issued quantity over an order's rows for one item + size, oldest
// first, each capped at its own full need. Anything beyond every row's
// remaining (over-issue) simply comes out of free stock — it isn't recorded.
// Returns [{ _id, issuedQuantity }] for the rows that change, plus `overflow`.
export function allocateIssue(rows, qty) {
  let left = Math.max(0, Number(qty) || 0);
  const updates = [];
  for (const r of [...rows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    if (left <= 0) break;
    const take = Math.min(remainingOf(r), left);
    if (take <= 0) continue;
    updates.push({ _id: r._id, issuedQuantity: round3((Number(r.issuedQuantity) || 0) + take) });
    left = round3(left - take);
  }
  return { updates, overflow: left };
}

// The reverse (defective return → re-reserve): take issued quantity back,
// newest row first, never below 0.
export function allocateReturn(rows, qty) {
  let left = Math.max(0, Number(qty) || 0);
  const updates = [];
  for (const r of [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    if (left <= 0) break;
    const give = Math.min(Number(r.issuedQuantity) || 0, left);
    if (give <= 0) continue;
    updates.push({ _id: r._id, issuedQuantity: round3((Number(r.issuedQuantity) || 0) - give) });
    left = round3(left - give);
  }
  return { updates, unmatched: left };
}

function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

// ── Free stock ────────────────────────────────────────────────────────────
// Σ remaining over the rows matching `match` (rows from before 2026-10-09
// have no issuedQuantity / dimensionVariantId — treated as 0 / null).
async function sumRemaining(match) {
  const [agg] = await MaterialReservation.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $max: [0, { $subtract: ['$quantity', { $ifNull: ['$issuedQuantity', 0] }] }] } } } },
  ]);
  return agg?.total || 0;
}

const sizeMatch = (itemId, companyId, variantId) => ({
  item: oid(itemId), company: oid(companyId), dimensionVariantId: variantId ? oid(variantId) : null,
});

// Free stock of one item (or one fabrication SIZE when variantId is given).
// excludeOrderId (+ excludeLineKey): leave that order's own row(s) out — an
// order checking its OWN need must not count its own earlier claim as a
// competitor's (bug I, 2026-10-09).
export async function getFreeQty(itemId, currentQty, companyId, { variantId = null, excludeOrderId = null, excludeLineKey = null } = {}) {
  const match = sizeMatch(itemId, companyId, variantId);
  if (excludeOrderId && excludeLineKey != null) {
    match.$nor = [{ reservedByOrderId: oid(excludeOrderId), lineKey: excludeLineKey }];
  } else if (excludeOrderId) {
    match.reservedByOrderId = { $ne: oid(excludeOrderId) };
  }
  return currentQty - (await sumRemaining(match));
}

// Same idea as getFreeQty, but for a LIVE re-check of one SPECIFIC order's
// own availability (`excludeOrderId`) — excluding only that order's own
// reservation from the sum is NOT enough on its own: a later-created
// competing order's reservation would otherwise count against an EARLIER
// order's own re-check too, retroactively penalizing a claim that was
// already legitimately secured first (confirmed by a real repro during this
// fix's own verification — an earlier order's live shortfall flipped from 0
// to 1 purely because a later order also reserved against the same stock).
// `checkAndReserve` always reserves each order's FULL need, unconditionally,
// in creation order — so priority is exactly reservation recency (`createdAt`,
// stable across re-checks since Mongoose only sets it on the initial
// upsert-insert, never on a later update). Only reservations that existed
// STRICTLY BEFORE this order's own (or, if this order has none yet, every
// existing reservation — nothing has lower priority than a claim that
// doesn't exist) count against its free qty. A reservation's own release
// (order completion/deletion) still improves everyone's position naturally,
// same as before — this only changes how two still-CO-EXISTING reservations
// are ordered relative to each other. Read-only, same as getFreeQty — never
// writes/updates a reservation. Per size + remaining-based since 2026-10-09.
export async function getFreeQtyExcludingOrder(itemId, currentQty, companyId, excludeOrderId, { variantId = null } = {}) {
  const base = sizeMatch(itemId, companyId, variantId);
  const mine = await MaterialReservation.findOne({ ...base, reservedByOrderId: oid(excludeOrderId) }).sort({ createdAt: 1 }).select('createdAt').lean();
  const match = { ...base, reservedByOrderId: { $ne: oid(excludeOrderId) } };
  if (mine) match.createdAt = { $lt: mine.createdAt };
  return currentQty - (await sumRemaining(match));
}

// Computes free stock for `item` against `neededQty`, and reserves the
// consumer's FULL neededQty regardless of shortfall (not just whatever
// portion is currently free) — mirrors the existing "cascade orders are
// sized to the real need, not the shortfall delta" convention
// (createSubChildPartOrderForItem/createChildPartOrderForItem's own
// buildQtyOverride), applied to the reservation too: a third concurrent
// consumer must not be able to double-claim the portion this one is still
// waiting on a cascade/purchase to physically deliver.
//
// Upserted by (item, size, order, lineKey) — re-running the SAME order's own
// availability check updates its one row to the current neededQty instead of
// creating a duplicate, and never resets what was already issued.
//
// shortfallQty is capped at the still-to-issue need — once many stacked
// reservations push freeQty deeply negative, a consumer's own shortfall must
// never be reported (or ordered/purchased against) as larger than what it
// actually still needs.
// `availableQty` — the real, physical "how much do we actually have"
// number — defaults to `item.qty`, correct for a plain/whole-piece item.
// WRONG for a fabrication item (isSheetMetal/length-fabrication, real
// stock lives per-dimension in `dimensionVariants[].subStock` — `qty`
// stays 0/unused for these, see Inventory.js's own comment): every one of
// this function's fabrication-aware callers must resolve the right
// `dimensionVariants[]` entry themselves and pass its `subStock` in here
// explicitly (confirmed bug, 2026-09-18) — and, since 2026-10-09, that same
// entry's _id as `variantId`.
export async function checkAndReserve({ item, neededQty, order, orderModel, companyId, availableQty, variantId = null, lineKey = '' }) {
  const currentQty = availableQty != null ? availableQty : (item.qty || 0);
  const key = { item: item._id, dimensionVariantId: variantId ? oid(variantId) : null, reservedByOrderId: order._id, lineKey: lineKey || '', company: oid(companyId) };
  const own = await MaterialReservation.findOne(key).select('issuedQuantity createdAt').lean();
  const alreadyIssued = Number(own?.issuedQuantity) || 0;
  // Free for THIS line: other claims on the same item / size — this order's
  // other lines included (they genuinely compete) — but never this line's own
  // row (bug I). On a RE-check (the row already exists) only claims made
  // before it count, the same priority rule as getFreeQtyExcludingOrder: a
  // later order's claim must not make an earlier one look short.
  const match = { ...sizeMatch(item._id, companyId, variantId), $nor: [{ reservedByOrderId: order._id, lineKey: lineKey || '' }] };
  if (own?.createdAt) match.createdAt = { $lt: own.createdAt };
  const freeQty = currentQty - (await sumRemaining(match));
  const stillNeeded = Math.max(0, neededQty - alreadyIssued);
  const shortfallQty = Math.min(stillNeeded, Math.max(0, stillNeeded - freeQty));
  if (neededQty > 0) {
    await MaterialReservation.findOneAndUpdate(
      key,
      { $set: { quantity: neededQty, reservedByOrderModel: orderModel } },
      { upsert: true }
    );
  }
  return { freeQty, shortfallQty, available: shortfallQty === 0 };
}

// ── Issuing / returning (2026-10-09) ────────────────────────────────────────
// Store transferred `qty` (in the reservation's own unit) of this item / size
// to this order. Never throws for "nothing reserved" — an unreserved issue
// just comes out of free stock.
export async function recordIssue({ orderId, itemId, variantId = null, qty }) {
  if (!(Number(qty) > 0) || !orderId || !itemId) return { applied: 0, overflow: Number(qty) || 0 };
  const rows = await MaterialReservation.find({ reservedByOrderId: oid(orderId), item: oid(itemId), dimensionVariantId: variantId ? oid(variantId) : null })
    .select('quantity issuedQuantity createdAt').lean();
  const { updates, overflow } = allocateIssue(rows, qty);
  if (updates.length) {
    await MaterialReservation.bulkWrite(updates.map(u => ({ updateOne: { filter: { _id: u._id }, update: { $set: { issuedQuantity: u.issuedQuantity } } } })));
  }
  return { applied: round3((Number(qty) || 0) - overflow), overflow };
}

// A DEFECTIVE return (user decision): the order still needs a good
// replacement, so the returned quantity is reserved for it again.
export async function recordReturn({ orderId, itemId, variantId = null, qty }) {
  if (!(Number(qty) > 0) || !orderId || !itemId) return { applied: 0 };
  const rows = await MaterialReservation.find({ reservedByOrderId: oid(orderId), item: oid(itemId), dimensionVariantId: variantId ? oid(variantId) : null })
    .select('quantity issuedQuantity createdAt').lean();
  const { updates, unmatched } = allocateReturn(rows, qty);
  if (updates.length) {
    await MaterialReservation.bulkWrite(updates.map(u => ({ updateOne: { filter: { _id: u._id }, update: { $set: { issuedQuantity: u.issuedQuantity } } } })));
  }
  return { applied: round3((Number(qty) || 0) - unmatched) };
}

// A job-work order's first send ships its whole raw-material need at once —
// every row of that order is now fully issued.
export async function markOrderFullyIssued(orderId) {
  if (!orderId) return;
  // Driver-level update: an aggregation-pipeline update (copy quantity →
  // issuedQuantity) that Mongoose 9's Model.updateMany refuses by default.
  await MaterialReservation.collection.updateMany({ reservedByOrderId: oid(orderId) }, [{ $set: { issuedQuantity: '$quantity' } }]);
}

// For Store's "warn, don't block" (user decision): how much of this item /
// size is still reserved for orders that claimed it BEFORE this one, and how
// much is therefore free for this order. Read-only.
export async function heldForEarlierOrders({ itemId, variantId = null, companyId, orderId, currentQty }) {
  const base = sizeMatch(itemId, companyId, variantId);
  const mine = orderId ? await MaterialReservation.findOne({ ...base, reservedByOrderId: oid(orderId) }).sort({ createdAt: 1 }).select('createdAt').lean() : null;
  const match = { ...base };
  if (orderId) match.reservedByOrderId = { $ne: oid(orderId) };
  if (mine) match.createdAt = { $lt: mine.createdAt };
  const rows = await MaterialReservation.find(match).select('reservedByOrderId reservedByOrderModel quantity issuedQuantity createdAt').lean();
  const byOrder = new Map();
  for (const r of rows) {
    const rem = remainingOf(r);
    if (rem <= 0) continue;
    const k = String(r.reservedByOrderId);
    if (!byOrder.has(k)) byOrder.set(k, { orderId: r.reservedByOrderId, orderModel: r.reservedByOrderModel, remaining: 0 });
    byOrder.get(k).remaining = round3(byOrder.get(k).remaining + rem);
  }
  const earlier = [...byOrder.values()];
  // Human order numbers (looked up by model name at call time — the order
  // models themselves import this service).
  for (const model of ['ProductionOrder', 'SubChildPartJobWorkOrder']) {
    const ids = earlier.filter(e => e.orderModel === model).map(e => e.orderId);
    if (!ids.length || !mongoose.models[model]) continue;
    const docs = await mongoose.models[model].find({ _id: { $in: ids } }).select('orderId').lean();
    const codeById = new Map(docs.map(d => [String(d._id), d.orderId]));
    for (const e of earlier) if (e.orderModel === model) e.orderCode = codeById.get(String(e.orderId)) || null;
  }
  const heldTotal = round3(earlier.reduce((s, e) => s + e.remaining, 0));
  return { freeForThisOrder: round3((Number(currentQty) || 0) - heldTotal), heldTotal, earlier };
}

// Called from ProductionOrder.js/SubChildPartJobWorkOrder.js's own
// post('save') hook (order reaches 'Completed') and from
// storeFlowService.js's explicit release-before-delete path. Idempotent —
// safe to call on an order with no reservations at all.
export async function releaseReservationsForOrder(orderId) {
  await MaterialReservation.deleteMany({ reservedByOrderId: orderId });
}

// Self-healing (2026-10-09): a row whose order no longer exists (deleted
// outside the normal flow) or already Completed is removed. Runs daily and
// from the migration script.
export async function sweepStaleReservations({ apply = true } = {}) {
  const rows = await MaterialReservation.find({}).select('reservedByOrderId reservedByOrderModel').lean();
  const stale = [];
  for (const model of ['ProductionOrder', 'SubChildPartJobWorkOrder']) {
    const ids = [...new Set(rows.filter(r => r.reservedByOrderModel === model).map(r => String(r.reservedByOrderId)))];
    if (!ids.length || !mongoose.models[model]) continue;
    const live = await mongoose.models[model].find({ _id: { $in: ids }, status: { $ne: 'Completed' } }).select('_id').lean();
    const liveSet = new Set(live.map(d => String(d._id)));
    for (const r of rows) if (r.reservedByOrderModel === model && !liveSet.has(String(r.reservedByOrderId))) stale.push(r._id);
  }
  if (apply && stale.length) await MaterialReservation.deleteMany({ _id: { $in: stale } });
  return { checked: rows.length, stale: stale.length };
}
