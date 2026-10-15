// Charges and payment terms carry over from a vendor's last quotation
// (procurement-v2, user decision 2026-10-14). They belong to the whole order,
// not to an item, but live on each quotation (QuotationRequest /
// ManualQuotation). A re-quote for some items used to start empty, and PO
// review pre-fills from the NEWEST quotation behind its lines — so a quick
// re-price silently dropped the vendor's freight and terms. Now every new
// quotation (the vendor's email page, and the manual quotation dialog) starts
// from the vendor's last one, with a note: change or remove what's different,
// otherwise it carries on. Removing something on purpose is respected — the
// newest quotation always wins, even when it's empty.
//
// "Last quotation" = the vendor's newest quotation (by when it was submitted /
// entered) that still has at least one price within the quote validity. When
// all their prices have expired, nothing carries over: an old freight figure
// is likely stale too.
import VendorBid from '../models/VendorBid.js';
import { quoteValidUntil } from './quoteChecksService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// A price that went onto a PO ('Selected') still shows the vendor's terms.
const LIVE_STATUSES = ['Submitted', 'Selected'];

// When a quotation counts as made — the same dates PO review sorts by.
export const quotationMadeAt = (q, manual) => (manual ? (q?.createdAt || q?.quoteDate) : q?.submittedAt) || null;

// Pure. `bids`: the vendor's quotes with quotationRequest / manualQuotation
// populated (number, charges, paymentTerms + their dates).
export function pickCarryOver(bids, validityDays, now = new Date()) {
  let best = null;
  for (const b of bids || []) {
    if (!LIVE_STATUSES.includes(b?.status)) continue;
    const until = quoteValidUntil(b, validityDays);
    if (!until || now > until) continue;
    const manual = !!b.manualQuotation?._id;
    const q = manual ? b.manualQuotation : b.quotationRequest;
    if (!q?._id) continue;
    const at = quotationMadeAt(q, manual);
    if (!best || new Date(at || 0) > new Date(best.at || 0)) best = { q, manual, at };
  }
  if (!best) return null;

  const charges = (best.q.charges || [])
    .filter(c => String(c?.label || '').trim() && Number(c.amount) > 0)
    .map(c => ({ label: String(c.label).trim(), amount: Number(c.amount), gstPercent: Number(c.gstPercent) || 0 }));
  const t = best.q.paymentTerms || {};
  const others = (t.others || [])
    .filter(o => String(o?.label || '').trim() && String(o?.value || '').trim())
    .map(o => ({ label: String(o.label).trim(), value: String(o.value).trim() }));
  const paymentTerms = {
    advancePercent: t.advancePercent ?? null,
    creditDays: t.creditDays ?? null,
    others,
  };
  // Their newest quotation had nothing → nothing to carry (never fall back
  // to an older one: they may have dropped those charges on purpose).
  if (!charges.length && paymentTerms.advancePercent == null && paymentTerms.creditDays == null && !others.length) return null;
  return { number: best.q.number, at: best.at, manual: best.manual, charges, paymentTerms };
}

export async function vendorCarryOver({ companyId, vendorId, validityDays, now = new Date() }) {
  if (!companyId || !vendorId) return null;
  // Only quotes that could still be valid (a day of slack for end-of-day).
  const since = new Date(now.getTime() - ((Number(validityDays) || 0) + 1) * DAY_MS);
  const bids = await VendorBid.find({ companyId, vendor: vendorId, status: { $in: LIVE_STATUSES }, submittedAt: { $gte: since } })
    .select('status submittedAt createdAt quotationRequest manualQuotation')
    .populate('quotationRequest', 'number charges paymentTerms submittedAt')
    .populate('manualQuotation', 'number charges paymentTerms createdAt quoteDate')
    .lean();
  return pickCarryOver(bids, validityDays, now);
}
