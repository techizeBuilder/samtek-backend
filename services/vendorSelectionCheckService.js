// Vendor selection check at PO time (procurement-v2 gap 12, 2026-10-09).
// Client blueprint §10 (ask several vendors) + §11 (picking a vendor that
// isn't the best needs "a documented exception reason and approval", and
// "the system must preserve the calculated score").
//
// Two checks on the items of ONE PO (one vendor):
//  1. Competition — each line: did Purchase ASK at least
//     min(company "minimum vendors per item", approved vendors that supply it)?
//     "Asked" = an email request or a manual quote, even if the vendor didn't
//     reply or declined (the effort is on record in All quotes).
//  2. Cheapest — compared PER PO (user decision), on LANDED cost: price + GST
//     + the vendor's quoted charges (and their GST) from their NEWEST quotation
//     behind the PO's lines (email request or manual quotation) — charges are
//     whole-order and carry over to each new quotation (2026-10-14), so older
//     ones are never added on top. Only vendors with a valid quote on
//     EVERY item of the PO take part; this PO's own vendor is priced the same
//     way, from its quotes, at this PO's quantities. A cheaper full-basket
//     vendor fails the check.
//     An item another vendor quoted cheaper is only a HINT — buying everything
//     from one vendor can be cheaper overall than splitting and paying charges
//     twice (user decision).
//  3. Quotations RECEIVED (2026-10-29, docs/procurement-v2/minimum-quotations-
//     2026-10.md) — each line needs the company's "minimum quotations per
//     item" valid quotes from different vendors. Short of it: if enough can
//     still come (waiting replies, vendors not asked yet, expired quotes to
//     re-ask) the PO is BLOCKED — no exception; if they can't, it's an
//     exception like the two checks above.
// A failed check needs a reason and Company Admin approval, whatever the PO
// value (purchaseController.createPurchase). A blocked one can't be made.
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import VendorBid from '../models/VendorBid.js';
import Supplier from '../models/Supplier.js';
import { ELIGIBLE_VENDOR_FILTER } from './vendorApprovalService.js';
import { isQuoteExpired, DEFAULT_QUOTE_VALIDITY_DAYS } from './quoteChecksService.js';
import { quotationMadeAt } from './quotationCarryOverService.js';
import { formatDims } from './fabricationDemandService.js';

export const SELECTION_EXCEPTION_REASONS = [
  'Only vendor that can supply',
  'Better quality or rating',
  'Faster delivery',
  'Urgent need',
  'Better payment terms',
  'Rate contract',
  "Others didn't reply in time",
  'Not enough vendors can quote',
  'Other',
];

// The reasons the PO review offers for THIS check: "Not enough vendors can
// quote" only when a line really can't reach the minimum quotations (§60) —
// otherwise it would be a reason for something that isn't happening
// (2026-10-31, your browser test 6.2).
export function exceptionReasonsFor(check) {
  const short = (check?.quotations || []).some(q => q.status === 'short');
  return SELECTION_EXCEPTION_REASONS.filter(r => short || r !== 'Not enough vendors can quote');
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n) => `₹${round2(n).toLocaleString('en-IN')}`;

// Landed cost of one quote line at a quantity: goods + GST (none on top when
// the price already includes GST; unknown GST counts as 0 and is flagged).
export function lineLanded(quote, quantity) {
  const goods = (Number(quote.unitPrice) || 0) * (Number(quantity) || 0);
  if (quote.gstInclusive) return { amount: round2(goods), gstUnknown: false };
  const pct = quote.gstPercent == null ? null : Number(quote.gstPercent);
  return { amount: round2(goods + goods * (pct || 0) / 100), gstUnknown: pct == null };
}

/**
 * Pure core.
 * input = {
 *   vendorId, minVendorsPerItem, minQuotationsPerItem,
 *   lines: [{ groupId, itemName, quantity, availableVendorIds[], askedVendorIds[],
 *             waitingVendorIds[] (asked, request still open), reaskVendorIds[] (their quote expired),
 *             quotes: [{ vendorId, vendorName, unitPrice, gstInclusive, gstPercent, quotationKey }] }],  // VALID quotes, one per vendor
 *   chargesByQuotation: { [quotationKey]: { amount: total incl. GST, at: quotation date } },
 * }
 */
export function evaluateSelection({ vendorId, minVendorsPerItem = 3, minQuotationsPerItem = 1, lines = [], chargesByQuotation = {} }) {
  const me = String(vendorId);
  const failures = [];
  const blockedReasons = [];

  // 3. Quotations received, per line (§ header; minimum-quotations doc §4).
  const required = Math.max(1, Number(minQuotationsPerItem) || 1);
  const quotations = lines.map(l => {
    const received = new Set((l.quotes || []).map(q => String(q.vendorId)));
    const asked = new Set((l.askedVendorIds || []).map(String));
    const possible = new Set([
      ...received,
      ...(l.waitingVendorIds || []).map(String),
      ...(l.reaskVendorIds || []).map(String),
      ...(l.availableVendorIds || []).map(String).filter(v => !asked.has(v)),
    ]);
    const status = received.size >= required ? 'ok' : possible.size >= required ? 'blocked' : 'short';
    const more = required - received.size;
    if (status === 'blocked') blockedReasons.push(`${l.itemName}: ${received.size} of ${required} quotations — ${more} more needed; wait for the replies or ask another vendor`);
    if (status === 'short') failures.push(`${l.itemName}: ${received.size} of ${required} quotations, and only ${possible.size} vendor${possible.size === 1 ? '' : 's'} can still quote`);
    return { groupId: l.groupId, itemName: l.itemName, required, received: received.size, possible: possible.size, status };
  });

  // 1. Competition, per line.
  const competition = lines.map(l => {
    const available = new Set((l.availableVendorIds || []).map(String));
    const asked = new Set((l.askedVendorIds || []).map(String));
    const required = Math.min(Number(minVendorsPerItem) || 1, Math.max(available.size, 1));
    const passed = asked.size >= required;
    if (!passed) failures.push(`${l.itemName}: ${asked.size} of ${required} vendor${required === 1 ? '' : 's'} asked (${available.size} approved vendor${available.size === 1 ? '' : 's'} supply it)`);
    return { groupId: l.groupId, itemName: l.itemName, available: available.size, required, asked: asked.size, passed };
  });

  // 2. Landed total per vendor that quoted EVERY line.
  const vendorIds = new Set(lines.flatMap(l => (l.quotes || []).map(q => String(q.vendorId))));
  const basket = [];
  for (const vid of vendorIds) {
    let total = 0;
    let gstUnknown = false;
    let name = '';
    const keys = new Set();
    let complete = true;
    for (const l of lines) {
      const q = (l.quotes || []).find(x => String(x.vendorId) === vid);
      if (!q) { complete = false; break; }
      name = q.vendorName || name;
      const landed = lineLanded(q, l.quantity);
      total += landed.amount;
      gstUnknown = gstUnknown || landed.gstUnknown;
      if (q.quotationKey) keys.add(String(q.quotationKey));
    }
    if (!complete) continue;
    // Charges belong to the whole order: only the NEWEST quotation behind
    // these lines counts — the same one PO review pre-fills from — never the
    // sum of every quotation, which counted freight twice (2026-10-14).
    // A value is { amount, at } (or a plain amount).
    const quotationCharges = [...keys]
      .map(k => chargesByQuotation[k])
      .filter(v => v != null)
      .map(v => (typeof v === 'object' ? v : { amount: v, at: null }))
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    const charges = Number(quotationCharges[0]?.amount) || 0;
    basket.push({ vendorId: vid, vendorName: name, goodsAndGst: round2(total), charges: round2(charges), landed: round2(total + charges), gstUnknown, isThisVendor: vid === me });
  }
  basket.sort((a, b) => a.landed - b.landed);
  const mine = basket.find(b => b.isThisVendor) || null;
  const cheaperVendors = mine ? basket.filter(b => !b.isThisVendor && b.landed < mine.landed - 0.005) : [];
  for (const c of cheaperVendors) {
    failures.push(`${c.vendorName} quoted every item on this PO at ${inr(c.landed)} landed — ${inr(mine.landed - c.landed)} less than ${mine.vendorName || 'this vendor'} (${inr(mine.landed)}).`);
  }

  // 3. Item hints (information only): cheaper per-unit landed price elsewhere.
  const itemHints = [];
  for (const l of lines) {
    const ours = (l.quotes || []).find(q => String(q.vendorId) === me);
    if (!ours) continue;
    const perUnit = (q) => lineLanded(q, 1).amount;
    const best = (l.quotes || []).filter(q => String(q.vendorId) !== me).sort((a, b) => perUnit(a) - perUnit(b))[0];
    if (best && perUnit(best) < perUnit(ours) - 0.005) {
      itemHints.push({ itemName: l.itemName, vendorName: best.vendorName, theirs: perUnit(best), ours: perUnit(ours) });
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    // A blocked item can't go on a PO at all — no exception (2026-10-29).
    blocked: blockedReasons.length > 0,
    blockedReasons,
    quotations,
    minQuotationsPerItem: required,
    competition,
    basket,
    thisVendor: mine,
    cheaperVendors: cheaperVendors.map(c => c.vendorId),
    itemHints,
    minVendorsPerItem: Number(minVendorsPerItem) || 1,
  };
}

// DB loader: everything evaluateSelection needs, for one vendor and a set of
// item groups (the PO's lines).
export async function checkVendorSelection({ companyId, vendorId, groupIds, settings }) {
  const ids = [...new Set((groupIds || []).filter(Boolean).map(String))];
  if (!ids.length) return null;
  const groups = await ItemQuoteGroup.find({ _id: { $in: ids }, companyId }).populate('item', 'name').lean();
  const itemIds = groups.map(g => g.item?._id).filter(Boolean);
  const validityDays = settings?.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;

  const vendors = await Supplier.find({ companyId, ...ELIGIBLE_VENDOR_FILTER, suppliedItems: { $in: itemIds } }).select('suppliedItems').lean();
  const bids = await VendorBid.find({ group: { $in: ids }, companyId })
    .select('group vendor vendorName status unitPrice gstInclusive gstPercent submittedAt createdAt quotationRequest manualQuotation')
    .populate('quotationRequest', 'charges submittedAt status')
    .populate('manualQuotation', 'charges createdAt quoteDate')
    .sort({ createdAt: -1 })
    .lean();

  const chargesByQuotation = {};
  const lines = groups.map(g => {
    const gBids = bids.filter(b => String(b.group) === String(g._id));
    const latestValid = new Map();
    for (const b of gBids) {
      if (b.status !== 'Submitted' || isQuoteExpired(b, validityDays)) continue;
      if (latestValid.has(String(b.vendor))) continue; // sorted newest first
      const quotation = b.quotationRequest || b.manualQuotation || null;
      if (quotation?._id) {
        chargesByQuotation[String(quotation._id)] = {
          amount: round2((quotation.charges || []).reduce((s, c) => s + (Number(c.amount) || 0) + (Number(c.gstAmount) || 0), 0)),
          at: quotationMadeAt(quotation, !!b.manualQuotation?._id),
        };
      }
      latestValid.set(String(b.vendor), {
        vendorId: b.vendor, vendorName: b.vendorName, unitPrice: b.unitPrice,
        gstInclusive: !!b.gstInclusive, gstPercent: b.gstPercent, quotationKey: quotation?._id ? String(quotation._id) : null,
      });
    }
    // Each asked vendor's newest answer (2026-10-29): still waiting (its
    // request open), a quote that expired (can be asked again), or won't come
    // ("can't supply", a request expired unanswered).
    const newestByVendor = new Map();
    for (const b of gBids) if (!newestByVendor.has(String(b.vendor))) newestByVendor.set(String(b.vendor), b);
    const waitingVendorIds = [];
    const reaskVendorIds = [];
    for (const [vid, b] of newestByVendor) {
      if (latestValid.has(vid)) continue;
      if (b.status === 'Invited') { if (b.quotationRequest?.status !== 'Expired') waitingVendorIds.push(vid); }
      else if (b.status !== 'Declined') reaskVendorIds.push(vid);
    }
    return {
      groupId: String(g._id),
      // A fabrication card is one size — named, so lines of one item can be
      // told apart in the check (2026-10-29).
      itemName: g.sizeValues ? `${g.item?.name || 'Item'} (${formatDims(g.sizeValues)})` : (g.item?.name || 'Item'),
      quantity: g.quantity,
      waitingVendorIds,
      reaskVendorIds,
      availableVendorIds: vendors.filter(v => (v.suppliedItems || []).some(id => String(id) === String(g.item?._id))).map(v => String(v._id)),
      askedVendorIds: [...new Set(gBids.map(b => String(b.vendor)))],
      quotes: [...latestValid.values()],
    };
  });

  return evaluateSelection({ vendorId, minVendorsPerItem: settings?.minVendorsPerItem || 3, minQuotationsPerItem: settings?.minQuotationsPerItem || 1, lines, chargesByQuotation });
}

// Checks the reason Purchase gave for a failed check. Returns an error
// message, or the cleaned { reasons, note }.
export function readSelectionException(body) {
  const reasons = [...new Set((Array.isArray(body?.reasons) ? body.reasons : []).map(String).filter(r => SELECTION_EXCEPTION_REASONS.includes(r)))];
  const note = String(body?.note || '').trim();
  if (!reasons.length) return { error: 'This vendor choice needs a reason — pick at least one.' };
  if (reasons.includes('Other') && !note) return { error: 'Add a note explaining "Other".' };
  return { reasons, note };
}

