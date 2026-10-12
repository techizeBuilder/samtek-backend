import PurchaseRequest from '../models/PurchaseRequest.js';
import QCJob from '../models/QCJob.js';
import PurchaseRejection from '../models/PurchaseRejection.js';
import { loadPriceSamples, summarizePrices } from './quoteChecksService.js';

// New "Vendor Ratings" tab (Purchase redesign, 2026-10) — rating is
// computed, not typed. Deliberately simple: a plain average of every signed
// event (on-time delivery / QC Pass = 5, late delivery / QC Fail = 1), no
// weighting — confirmed with the user, data volumes don't call for anything
// fancier yet. Kept entirely separate from the old manual `Supplier.rating`
// field (still read as-is everywhere it already was — RFQ vendor matching,
// VendorBids.jsx, the legacy Suppliers page); this is a parallel, new
// system, not a replacement of that field's existing callers.

// A PurchaseRequest doesn't carry a reliable Item ObjectId of its own — same
// name/code match used throughout this redesign (getPurchaseRequests' R&D
// specs enrichment, purchaseQuoteController.js's resolveMasterItemId).
function matchesItem(pr, itemCode, itemName) {
  if (pr.itemId && itemCode && pr.itemId === itemCode) return true;
  if (pr.productName && itemName && pr.productName.trim().toLowerCase() === itemName.trim().toLowerCase()) return true;
  return false;
}

// Normalize-to-array helper (2026-10, item-wise PR consolidation) — mirrors
// purchaseController.js's own prIdsOf exactly (not imported from there: a
// service importing a controller is the wrong dependency direction in
// this codebase). A Purchase.items[] line can now carry either the
// original singular purchaseRequest (still written by the legacy RFQ-to-
// PO path) or the new plural purchaseRequests (a line built from an
// ItemQuoteGroup, covering several PRs at once).
function prIdsOf(line) {
  if (Array.isArray(line?.purchaseRequests) && line.purchaseRequests.length) return line.purchaseRequests;
  if (line?.purchaseRequest) return [line.purchaseRequest];
  return [];
}

/**
 * Rating for one vendor — item-scoped when itemCode/itemName are given,
 * otherwise pooled across every item that vendor has ever supplied (the
 * "overall" rating). Three signals, all real and reliably populated
 * (confirmed against the actual receive/QC flow, not assumed):
 *  - On-time delivery: PurchaseRequest.receivedAt vs *that line's own*
 *    expectedDeliveryDate (Purchase.items[].expectedDeliveryDate, added
 *    2026-10 — each item in a batch can have been quoted with a different
 *    delivery promise, so this is no longer the PO's one shared date, which
 *    is just the latest across a batch's items and would wrongly call an
 *    earlier-due item "on time"). Falls back to the PO-level
 *    expectedDeliveryDate only for older POs that predate per-item dates.
 *    (Purchase.actualDeliveryDate itself is dead — never set by the real
 *    receive flow, so this reads the fields that actually are.)
 *  - QC outcome: QCJob.decision ('Pass'/'Fail'), matched back to its vendor
 *    via the direct purchaseRequestId link only (not the fuzzy string-match
 *    fallbacks the legacy QC-rejection resolver uses for old records — this
 *    is a new system, going forward).
 *  - QC partial rejections: each entry in QCJob.partialRejections[] counts
 *    as its own negative signal, independent of whatever the job's
 *    eventual terminal decision ends up being for the remaining quantity —
 *    otherwise a vendor whose shipment needed a partial reject gets full
 *    credit the moment what's left over eventually passes, which hides a
 *    real quality problem from the rating.
 */
export async function computeVendorRating({ companyId, vendorId, itemCode = null, itemName = null }) {
  const prs = await PurchaseRequest.find({ companyId, purchaseOrder: { $ne: null } })
    .select('itemId productName receivedAt purchaseOrder')
    .populate({
      path: 'purchaseOrder',
      select: 'supplier expectedDeliveryDate items',
      populate: { path: 'supplier', select: '_id' },
    })
    .lean();

  const relevantPrs = prs.filter(pr =>
    pr.purchaseOrder?.supplier && String(pr.purchaseOrder.supplier._id) === String(vendorId) &&
    ((!itemCode && !itemName) || matchesItem(pr, itemCode, itemName))
  );

  const scores = [];
  // The parts behind the rating (2026-10-10, RFQ/PO vendor card): on-time
  // deliveries out of those with a due date, and QC passes out of QC results.
  const onTime = { on: 0, total: 0 };
  const qc = { pass: 0, total: 0 };
  for (const pr of relevantPrs) {
    // Item-wise PR consolidation (2026-10) — a PR's "own line" may now be
    // one it shares with several other PRs (purchaseRequests, plural), not
    // just a line that points at it alone. Match predicate widened
    // accordingly; a PR still only ever sits on exactly one line, so this
    // still returns at most one match.
    const ownLine = pr.purchaseOrder?.items?.find(
      it => prIdsOf(it).some(id => String(id) === String(pr._id))
    );
    // On-time is judged against the date the vendor ORIGINALLY committed to
    // (workflow doc ST5, 2026-10-10): a revised date (deliveryDateHistory)
    // moves Store's due dates and the overdue alerts, never the score.
    const expectedDate = ownLine?.deliveryDateHistory?.[0]?.from || ownLine?.expectedDeliveryDate || pr.purchaseOrder?.expectedDeliveryDate;
    if (pr.receivedAt && expectedDate) {
      const wasOnTime = new Date(pr.receivedAt) <= new Date(expectedDate);
      scores.push(wasOnTime ? 5 : 1);
      onTime.total += 1;
      if (wasOnTime) onTime.on += 1;
    }
  }

  const prIds = relevantPrs.map(pr => pr._id);
  if (prIds.length) {
    const qcJobs = await QCJob.find({
      company: companyId,
      source: 'Purchase',
      purchaseRequestId: { $in: prIds },
      $or: [{ decision: { $in: ['Pass', 'Fail'] } }, { 'partialRejections.0': { $exists: true } }],
    }).select('decision partialRejections').lean();
    for (const job of qcJobs) {
      if (job.decision === 'Pass') { scores.push(5); qc.pass += 1; qc.total += 1; }
      else if (job.decision === 'Fail') { scores.push(1); qc.total += 1; }
      for (const _rejection of job.partialRejections || []) { scores.push(1); qc.total += 1; }
    }
  }

  // Disputes (2026-10-12, client case 1): the vendor refused to replace or
  // refund material QC rejected — each one counts as a bad event on top of
  // the failed QC itself. (Whole-vendor only, not per item.)
  const disputes = { count: 0, lastAt: null };
  if (!itemCode && !itemName) {
    const refused = await PurchaseRejection.find({ companyId, vendor: vendorId, outcome: 'refused' }).select('recordedAt').lean();
    for (const r of refused) {
      scores.push(1);
      disputes.count += 1;
      if (r.recordedAt && (!disputes.lastAt || r.recordedAt > disputes.lastAt)) disputes.lastAt = r.recordedAt;
    }
  }

  if (!scores.length) return { rating: null, eventCount: 0, onTime, qc, disputes };
  const rating = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { rating: Math.round(rating * 10) / 10, eventCount: scores.length, onTime, qc, disputes };
}

/**
 * Avg / last / lowest price this vendor has actually DELIVERED one item at —
 * the plain goods price per purchase unit, no charges, never read from
 * invoices (confirmed design). Only a delivered (Received) request counts;
 * each one is a separate delivery at its PO line's rate.
 *
 * Since 2026-10-09 this is the same "Bought before" data the RFQ/PO page,
 * the PO review and the Company Admin's approvals show
 * (quoteChecksService.loadPriceSamples), so the numbers match everywhere:
 * prices are before GST (an "incl. GST" rate is taken back to its pre-GST
 * value when the rate is known), and only deliveries in the unit of the
 * vendor's most recent one are pooled (₹/kg is never averaged with ₹/piece).
 */
export async function computeVendorItemPricing({ companyId, vendorId, itemObjectId }) {
  const samples = (await loadPriceSamples({ companyId, itemIds: [itemObjectId] })).get(String(itemObjectId)) || [];
  const theirs = samples.filter(s => s.vendorId === String(vendorId));
  if (!theirs.length) return { avgPrice: null, lastPrice: null, lowestPrice: null, priceUnit: null, deliveries: 0 };
  const unit = theirs[0].unit;
  const summary = summarizePrices(theirs, { unit });
  return {
    avgPrice: summary.avg,
    lastPrice: summary.last.price,
    lowestPrice: summary.lowest.price,
    priceUnit: unit || null,
    deliveries: summary.count,
  };
}
