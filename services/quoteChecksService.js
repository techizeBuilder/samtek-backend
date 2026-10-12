import Purchase from '../models/Purchase.js';

// Quote checks (procurement-v2, 2026-10-09) — two rules from the client's
// blueprint, both driven by Purchase Settings (Purchase & Outsource →
// Settings → Quote rules):
//
//  1. Quote validity (§10, QT4). A quote can become a PO for
//     `quoteValidityDays` days after the vendor gave it (submittedAt, or
//     createdAt for old quotes). After that it's expired: it can't be ticked
//     into a PO and createPurchase refuses it — get a fresh quote. Computed
//     from the CURRENT setting every time, so changing the number applies to
//     every quote at once. Checked when the PO is created, not again when the
//     Company Admin approves it.
//
//  2. "Bought before" — the last-price check (§26). What we actually paid
//     on earlier DELIVERED purchases of an item (user decision 2026-10-09:
//     only once delivered — the same rule the Vendor Ratings tab uses, and
//     its avg / last / lowest now come from here too, so the numbers match
//     everywhere). One sample per delivery: each Received purchase request
//     on a PO line, at that line's rate, dated when it was received. Prices
//     are compared before GST (an "incl. GST" rate is taken back to its
//     pre-GST value when the rate is known) and only in the same purchase
//     unit, so ₹/kg is never compared with ₹/piece.
//     A quote is compared with THAT VENDOR's last bought price for the item
//     (the tag on the vendor row); clicking it shows every vendor's prices.
//     Warning only (`priceJumpWarnPercent`), never blocks.
//     Not to be confused with "All quotes" (buildQuoteHistory): those are
//     the OFFERS behind one PO; this is what was PAID on earlier ones.

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
export const DEFAULT_PRICE_JUMP_WARN_PERCENT = 10;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Validity ────────────────────────────────────────────────────────────
// The last day a quote can be used: the quote date + N days, to the end of
// that day.
export function quoteValidUntil(bid, days) {
  const from = bid?.submittedAt || bid?.createdAt;
  const n = Number(days);
  if (!from || !(n > 0)) return null;
  const end = new Date(new Date(from).getTime() + n * DAY_MS);
  end.setHours(23, 59, 59, 999);
  return end;
}

// Only a priced quote (Submitted) can expire — a request still waiting has
// its own link expiry.
export function isQuoteExpired(bid, days, now = new Date()) {
  if (bid?.status !== 'Submitted') return false;
  const until = quoteValidUntil(bid, days);
  return !!until && now > until;
}

// ── Last-price check ────────────────────────────────────────────────────
export function exGstPrice(price, inclusive, gstPercent) {
  const p = Number(price) || 0;
  const r = Number(gstPercent);
  return inclusive && r > 0 ? p / (1 + r / 100) : p;
}

const normUnit = (u) => String(u || '').trim().toLowerCase();

// % change of a price against a reference (e.g. +12.5 / -3). null when either is missing.
export function priceChangePercent(price, reference) {
  const p = Number(price);
  const ref = Number(reference);
  if (!(p > 0) || !(ref > 0)) return null;
  return Math.round(((p - ref) / ref) * 1000) / 10;
}

// itemId -> deliveries [{ price (pre-GST), unit, vendorId, vendorName, date (received), purchaseId, poNumber }], newest first.
export async function loadPriceSamples({ companyId, itemIds }) {
  const ids = [...new Set((itemIds || []).filter(Boolean).map(String))];
  const byItem = new Map();
  if (!ids.length) return byItem;
  const purchases = await Purchase.find({
    companyId,
    status: { $nin: ['Pending Approval', 'Rejected', 'Cancelled'] },
    'items.item': { $in: ids },
  })
    .select('purchaseOrderNumber supplier orderDate createdAt items.item items.unitPrice items.purchaseUnit items.gstInclusive items.gstRate items.purchaseRequest items.purchaseRequests')
    .populate('supplier', 'supplierName')
    .populate('items.purchaseRequest', 'status receivedAt purchaseUnit')
    .populate('items.purchaseRequests', 'status receivedAt purchaseUnit')
    .lean();
  for (const po of purchases) {
    for (const line of po.items || []) {
      const itemId = line.item ? String(line.item) : null;
      if (!itemId || !ids.includes(itemId) || !(Number(line.unitPrice) > 0)) continue;
      const prs = (line.purchaseRequests?.length ? line.purchaseRequests : (line.purchaseRequest ? [line.purchaseRequest] : [])).filter(Boolean);
      // Older lines have no unit of their own — read it off a linked request,
      // the same way the Purchase Orders list does.
      const unit = line.purchaseUnit || prs.find(pr => pr?.purchaseUnit)?.purchaseUnit || '';
      const price = round2(exGstPrice(line.unitPrice, line.gstInclusive, line.gstRate));
      // Only delivered: each Received request on the line is one delivery.
      for (const pr of prs) {
        if (pr?.status !== 'Received') continue;
        if (!byItem.has(itemId)) byItem.set(itemId, []);
        byItem.get(itemId).push({
          price,
          unit,
          vendorId: po.supplier?._id ? String(po.supplier._id) : String(po.supplier || ''),
          vendorName: po.supplier?.supplierName || 'Vendor',
          date: pr.receivedAt || po.orderDate || po.createdAt,
          purchaseId: String(po._id),
          poNumber: po.purchaseOrderNumber,
        });
      }
    }
  }
  for (const list of byItem.values()) list.sort((a, b) => new Date(b.date) - new Date(a.date));
  return byItem;
}

function stats(samples) {
  if (!samples.length) return null;
  const last = samples[0];
  const lowest = samples.reduce((a, b) => (b.price < a.price ? b : a));
  return {
    last: { price: last.price, vendorId: last.vendorId, vendorName: last.vendorName, date: last.date, poNumber: last.poNumber },
    lowest: { price: lowest.price, vendorId: lowest.vendorId, vendorName: lowest.vendorName, date: lowest.date, poNumber: lowest.poNumber },
    avg: round2(samples.reduce((s, x) => s + x.price, 0) / samples.length),
    count: samples.length,
  };
}

// Summary for one item in one unit: the item's last / lowest / average
// bought price across all vendors, the same per vendor, and the most recent
// deliveries (for the "Bought before" pop-up). `excludePurchaseId` / `before`
// leave out a PO itself and anything after it (for checking a PO against
// what came before it). null when there's no history.
const RECENT_LIMIT = 20;
export function summarizePrices(samples, { unit = '', excludePurchaseId = null, before = null } = {}) {
  const want = normUnit(unit);
  const usable = (samples || []).filter(s =>
    normUnit(s.unit) === want
    && (!excludePurchaseId || s.purchaseId !== String(excludePurchaseId))
    && (!before || new Date(s.date) < new Date(before)));
  const overall = stats(usable);
  if (!overall) return null;
  const byVendor = {};
  for (const s of usable) {
    if (!byVendor[s.vendorId]) byVendor[s.vendorId] = [];
    byVendor[s.vendorId].push(s);
  }
  return {
    ...overall,
    unit: unit || '',
    byVendor: Object.fromEntries(Object.entries(byVendor).map(([vid, list]) => [vid, stats(list)])),
    recent: usable.slice(0, RECENT_LIMIT).map(s => ({ price: s.price, vendorId: s.vendorId, vendorName: s.vendorName, date: s.date, poNumber: s.poNumber })),
  };
}

// The "bought before" check for one quote / PO line from one vendor: that
// vendor's own last bought price, and the % change against it. When the
// vendor has never delivered this item, `theirs` is null (the pop-up still
// shows every other vendor's prices).
export function vendorPriceCheck(summary, vendorId, comparablePrice) {
  if (!summary) return null;
  const theirs = summary.byVendor?.[String(vendorId)] || null;
  return {
    theirs,
    changePercent: theirs && comparablePrice != null ? priceChangePercent(comparablePrice, theirs.last.price) : null,
  };
}
