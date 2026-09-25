// Shared reservation ledger — see MaterialReservation.js's own header
// comment for the bug this fixes and why it's shaped as one-doc-per-
// (item, order) rather than a single aggregate counter on Item.
import MaterialReservation from '../models/MaterialReservation.js';

async function sumReservedQty(match) {
  const [agg] = await MaterialReservation.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]);
  return agg?.total || 0;
}

export async function getFreeQty(itemId, currentQty, companyId) {
  return currentQty - (await sumReservedQty({ item: itemId, company: companyId }));
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
// writes/updates a reservation.
export async function getFreeQtyExcludingOrder(itemId, currentQty, companyId, excludeOrderId) {
  const mine = await MaterialReservation.findOne({ item: itemId, company: companyId, reservedByOrderId: excludeOrderId }).select('createdAt').lean();
  const match = { item: itemId, company: companyId, reservedByOrderId: { $ne: excludeOrderId } };
  if (mine) match.createdAt = { $lt: mine.createdAt };
  return currentQty - (await sumReservedQty(match));
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
// Upserted by (item, reservedByOrderId, company) — re-running the SAME
// order's own availability check (a confirmed, real scenario — e.g. Store's
// "Check All Items" clicked again) updates its one reservation row to the
// current neededQty instead of creating a duplicate that would inflate
// total reserved quantity every re-check.
//
// shortfallQty is capped at neededQty — once many stacked reservations push
// freeQty deeply negative, a consumer's own shortfall must never be
// reported (or ordered/purchased against) as larger than what it actually
// asked for.
// `availableQty` — the real, physical "how much do we actually have"
// number — defaults to `item.qty`, correct for a plain/whole-piece item.
// WRONG for a fabrication item (isSheetMetal/length-fabrication, real
// stock lives per-dimension in `dimensionVariants[].subStock` — `qty`
// stays 0/unused for these, see Inventory.js's own comment): every one of
// this function's fabrication-aware callers must resolve the right
// `dimensionVariants[]` entry themselves and pass its `subStock` in here
// explicitly (confirmed bug, 2026-09-18 — every fabrication call site was
// already resolving that exact variant for other reasons and simply never
// threading its subStock through, so `checkAndReserve` silently fell back
// to `item.qty` = 0 and reported every fabrication material as fully
// unavailable regardless of real stock).
export async function checkAndReserve({ item, neededQty, order, orderModel, companyId, availableQty }) {
  const currentQty = availableQty != null ? availableQty : (item.qty || 0);
  const freeQty = await getFreeQty(item._id, currentQty, companyId);
  const shortfallQty = Math.min(neededQty, Math.max(0, neededQty - freeQty));
  if (neededQty > 0) {
    await MaterialReservation.findOneAndUpdate(
      { item: item._id, reservedByOrderId: order._id, company: companyId },
      { $set: { quantity: neededQty, reservedByOrderModel: orderModel } },
      { upsert: true }
    );
  }
  return { freeQty, shortfallQty, available: shortfallQty === 0 };
}

// Called from ProductionOrder.js/SubChildPartJobWorkOrder.js's own
// post('save') hook (order reaches 'Completed') and from
// storeFlowService.js's explicit release-before-delete path. Idempotent —
// safe to call on an order with no reservations at all.
export async function releaseReservationsForOrder(orderId) {
  await MaterialReservation.deleteMany({ reservedByOrderId: orderId });
}
