// Vendor score (procurement-v2, 2026-10-13) — the client blueprint's weighted
// score (§11, §12, Appendix A), worked out from what actually happened:
//
//   Price 25    each delivered price vs the lowest any vendor charged or
//               quoted for that item (same unit, before GST)
//   Quality 30  each QC'd delivery: share accepted, rejections weighed by
//               severity (Minor 1 / Major 1.5 / Critical 2), a rejection the
//               vendor refused to settle counts double
//   Delivery 20 each delivery vs the date first promised (−10 a day late);
//               a replacement vs the date given for it
//   Credit 10   each PO's terms: credit days (full at 30) + advance (0% full)
//   Warranty 10 months quoted vs the best quoted for the item, and warranty
//               claims (response days, resolved or not, our ★ satisfaction)
//   Response 5  quotation requests answered, and how fast
//
// Technical compliance (the blueprint's other 10) was dropped by the user —
// its points went to Quality and Delivery. Weights + the Watchlist threshold
// are the Company Admin's (PurchaseSettings.vendorScore).
//
// Last 12 months, recent counting more (today 1.0 → a year ago 0.5); a
// lifetime score (everything, unweighted) alongside. A part with nothing to
// go on is left out and the rest are rescaled. Replaces the old 1–5 star
// rating (vendorRatingService), which predated the blueprint.
import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import QCJob from '../models/QCJob.js';
import PurchaseRejection from '../models/PurchaseRejection.js';
import VendorBid from '../models/VendorBid.js';
import QuotationRequest from '../models/QuotationRequest.js';
import VendorWarrantyClaim from '../models/VendorWarrantyClaim.js';
import '../models/ItemQuoteGroup.js';
import { loadPriceSamples, summarizePrices, exGstPrice } from './quoteChecksService.js';
import { prIdsOfLine, acceptedMoney } from './purchaseAcceptanceService.js';

export const PARTS = ['price', 'quality', 'delivery', 'credit', 'warranty', 'response'];
export const PART_LABELS = { price: 'Price', quality: 'Quality', delivery: 'Delivery', credit: 'Credit terms', warranty: 'Warranty', response: 'Response' };
export const DEFAULT_WEIGHTS = { price: 25, quality: 30, delivery: 20, credit: 10, warranty: 10, response: 5 };
export const DEFAULT_WATCHLIST_BELOW = 60;
export const SEVERITIES = ['Minor', 'Major', 'Critical'];
export const SEVERITY_FACTOR = { Minor: 1, Major: 1.5, Critical: 2 };
export const MIN_HISTORY_EVENTS = 5;            // delivery + quality events before the score is trusted
export const WINDOW_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;
const RESOLVED_OUTCOMES = ['Repaired', 'Replaced', 'Credit note'];
const EVIDENCE_CAP = 40;

const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;
const normUnit = (u) => String(u || '').trim().toLowerCase();

// ── Pure ─────────────────────────────────────────────────────────────────────

// How much an event counts: today 1.0, falling to 0.5 at a year old; older
// than the window → 0 (left out of the 12-month score).
export function recencyWeight(date, now = new Date()) {
  const age = (now.getTime() - new Date(date).getTime()) / DAY;
  if (!Number.isFinite(age)) return 0;
  if (age > WINDOW_DAYS) return 0;
  return 1 - 0.5 * Math.max(0, age) / WINDOW_DAYS;
}

// One QC'd delivery: accepted share, rejections weighed by severity; a
// rejection the vendor refused to replace / refund counts twice.
//   rejections: [{ qty, severity, refused }]
export function qualityEvent({ acceptedQty = 0, rejections = [] }) {
  const rejQty = rejections.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const total = (Number(acceptedQty) || 0) + rejQty;
  if (!(total > 0)) return null;
  const penalty = rejections.reduce((s, r) => s + (Number(r.qty) || 0) * (SEVERITY_FACTOR[r.severity] || SEVERITY_FACTOR.Major) * (r.refused ? 2 : 1), 0);
  return round1(clamp(100 * (1 - penalty / total)));
}

// Calendar days late (0 when on time or early).
export function daysLate(promised, received) {
  const a = new Date(promised); const b = new Date(received);
  const p = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const r = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((r - p) / DAY));
}
export const deliveryEvent = (late) => clamp(100 - 10 * late);

// A delivered price vs the lowest comparable one (100 = the lowest).
export const priceEvent = (price, lowest) => (price > 0 && lowest > 0 ? clamp(100 * lowest / price) : null);

// A PO's terms: half for credit days (full at 30+), half for the advance (0% = full).
export function creditEvent({ creditDays, advancePercent }) {
  const cd = Math.max(0, Number(creditDays) || 0);
  const adv = clamp(Number(advancePercent) || 0);
  return clamp(50 * Math.min(cd, 30) / 30 + 50 * (1 - adv / 100));
}

export const warrantyDurationEvent = (months, best) => (best > 0 ? clamp(100 * Math.max(0, Number(months) || 0) / best) : null);

// One warranty claim (Complaints → Vendor Warranty Claims). null = too early to judge.
export function claimEvent(c, now = new Date()) {
  const reported = new Date(c.reportedToVendorAt).getTime();
  const speed = (days) => clamp(100 - (Math.max(0, days - 3) / 12) * 100);   // ≤3 d full, 0 at 15 d
  if (!c.outcome) {
    if (!c.vendorRespondedAt && (now.getTime() - reported) / DAY >= 15) return 0;  // ignored for 15+ days
    return null;
  }
  if ((c.outcome === 'Refused' || c.outcome === 'Not covered') && c.underWarranty === 'Yes') return 0;
  const respDays = c.vendorRespondedAt ? (new Date(c.vendorRespondedAt).getTime() - reported) / DAY : (new Date(c.resolvedAt || now).getTime() - reported) / DAY;
  const stars = Number(c.satisfaction?.rating) || 0;
  return clamp(50 * stars / 5 + 25 * (RESOLVED_OUTCOMES.includes(c.outcome) ? 1 : 0) + 25 * speed(respDays) / 100);
}

// One quotation request: answered 70 + speed 30 (≤1 d full, 0 at 7 d); no
// reply before the link ran out → 0; still open → null.
export function responseEvent({ sentAt, submittedAt, tokenExpiry, status }, now = new Date()) {
  if (submittedAt) {
    const days = (new Date(submittedAt).getTime() - new Date(sentAt).getTime()) / DAY;
    return clamp(70 + 30 * clamp(1 - (Math.max(0, days - 1) / 6), 0, 1));
  }
  if (status === 'Expired' || (tokenExpiry && new Date(tokenExpiry).getTime() < now.getTime())) return 0;
  return null;
}

// Weighted mean of events [{ score, weight }] → % (null when none).
export function weightedMean(events) {
  let sw = 0; let s = 0;
  for (const e of events) {
    if (e.score == null || !(e.weight > 0)) continue;
    sw += e.weight; s += e.score * e.weight;
  }
  return sw > 0 ? s / sw : null;
}

// Parts { price: pct|null, ... } + weights → the score out of 100, over the
// parts that have data (null when none do).
export function combineParts(parts, weights = DEFAULT_WEIGHTS) {
  let sw = 0; let s = 0;
  for (const k of PARTS) {
    const pct = parts[k];
    const w = Number(weights?.[k]) || 0;
    if (pct == null || !(w > 0)) continue;
    sw += w; s += pct * w;
  }
  return sw > 0 ? Math.round(s / sw) : null;
}

// Settings from the Company Admin → { weights, watchlistBelow } or { error }.
export function readScoreSettings(body = {}) {
  const weights = {};
  for (const k of PARTS) {
    const n = Number(body?.weights?.[k]);
    if (!Number.isInteger(n) || n < 0 || n > 100) return { error: `${PART_LABELS[k]} weight must be a whole number from 0 to 100.` };
    weights[k] = n;
  }
  const total = PARTS.reduce((s, k) => s + weights[k], 0);
  if (total !== 100) return { error: `The weights must add up to 100 (now ${total}).` };
  const below = Number(body?.watchlistBelow);
  if (!Number.isFinite(below) || below < 0 || below > 100) return { error: 'The Watchlist score must be from 0 to 100.' };
  return { weights, watchlistBelow: Math.round(below) };
}

export function scoreSettingsOf(settings) {
  const w = settings?.vendorScore?.weights;
  const weights = {};
  for (const k of PARTS) weights[k] = Number.isFinite(Number(w?.[k])) && w?.[k] != null ? Number(w[k]) : DEFAULT_WEIGHTS[k];
  const below = settings?.vendorScore?.watchlistBelow;
  return { weights, watchlistBelow: Number.isFinite(Number(below)) && below != null ? Number(below) : DEFAULT_WATCHLIST_BELOW };
}

// Builds one part from its raw events [{ score, value, date, ...evidence }]:
// the 12-month % (recency × value weighted), the lifetime %, the count.
export function summarizePart(events, now = new Date()) {
  const usable = events.filter(e => e.score != null);
  const recent = weightedMean(usable.map(e => ({ score: e.score, weight: recencyWeight(e.date, now) * (e.value > 0 ? e.value : 1) })));
  const lifetime = weightedMean(usable.map(e => ({ score: e.score, weight: e.value > 0 ? e.value : 1 })));
  const inWindow = usable.filter(e => recencyWeight(e.date, now) > 0).length;
  return { pct: recent == null ? null : round1(recent), lifetimePct: lifetime == null ? null : round1(lifetime), events: inWindow, lifetimeEvents: usable.length };
}

// ── DB ───────────────────────────────────────────────────────────────────────

const idOf = (x) => String(x?._id || x || '');

// Scores for these vendors, worked out together (one load for all of them).
// Returns Map vendorId → { score, lifetime, parts, counts, limitedHistory,
// disputes, evidence? }.
export async function computeVendorScores({ companyId, vendorIds, now = new Date(), settings = null, withEvidence = false }) {
  const out = new Map();
  const ids = [...new Set((vendorIds || []).map(String))];
  if (!ids.length) return out;
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const vids = ids.map(id => new mongoose.Types.ObjectId(id));
  const { weights } = scoreSettingsOf(settings || await loadSettings(companyId));

  const ev = new Map(ids.map(id => [id, { price: [], quality: [], delivery: [], credit: [], warrantyDuration: [], claims: [], response: [], disputes: { count: 0, lastAt: null } }]));

  // ── POs, their requests, QC jobs, rejections ──
  const pos = await Purchase.find({ companyId: cid, supplier: { $in: vids }, status: { $nin: ['Pending Approval', 'Rejected'] } })
    .select('purchaseOrderNumber supplier status orderDate createdAt grandTotal paymentTerms expectedDeliveryDate deliveryClock items')
    .lean();
  const lineOfPr = new Map();      // prId → { po, line }
  for (const po of pos) for (const line of po.items || []) for (const prId of prIdsOfLine(line)) lineOfPr.set(prId, { po, line });
  const prs = lineOfPr.size
    ? await PurchaseRequest.find({ _id: { $in: [...lineOfPr.keys()] } }).select('status receivedAt replacementFor purchaseQuantity quantity fabricationDimensionLines productName').lean()
    : [];
  const prById = new Map(prs.map(p => [String(p._id), p]));
  const received = prs.filter(p => p.status === 'Received' && p.receivedAt);
  const [jobs, rejections] = await Promise.all([
    received.length
      ? QCJob.find({ company: cid, source: 'Purchase', purchaseRequestId: { $in: received.map(p => p._id) }, status: { $in: ['Approved', 'Rejected'] } })
        .select('purchaseRequestId status quantity acceptedQty partialRejections failSeverity updatedAt qcJobId itemName').lean()
      : [],
    PurchaseRejection.find({ companyId: cid, vendor: { $in: vids } }).select('vendor qcJob rejectedQty severity outcome value recordedAt replacement number').lean(),
  ]);
  const rejByJob = new Map();
  const rejById = new Map();
  for (const r of rejections) {
    rejById.set(String(r._id), r);
    const k = String(r.qcJob);
    if (!rejByJob.has(k)) rejByJob.set(k, []);
    rejByJob.get(k).push(r);
    if (r.outcome === 'refused') {
      const d = ev.get(String(r.vendor))?.disputes;
      if (d) { d.count += 1; if (r.recordedAt && (!d.lastAt || r.recordedAt > d.lastAt)) d.lastAt = r.recordedAt; }
    }
  }

  // Delivery: one event per line receive (requests received together on a
  // line are one delivery); a replacement is its own delivery.
  const deliveries = new Map();
  for (const pr of received) {
    const ctx = lineOfPr.get(String(pr._id));
    if (!ctx) continue;
    const vendorId = idOf(ctx.po.supplier);
    let promised = null; let kind = 'Delivery';
    if (pr.replacementFor) {
      promised = rejById.get(String(pr.replacementFor))?.replacement?.expectedDate || null;
      kind = 'Replacement';
    } else {
      promised = ctx.line.deliveryDateHistory?.[0]?.from || ctx.line.expectedDeliveryDate || ctx.po.expectedDeliveryDate || null;
    }
    // Received before the advance was paid (the PO's dates count from the
    // advance, so none was promised yet): the vendor delivered before they
    // had to — an EARLY delivery, 100 (user, 2026-10-14). Any other undated
    // line (old records) is still left out.
    const beforeAdvance = !promised && !pr.replacementFor && ctx.po.deliveryClock?.startsOn === 'advance';
    if (!promised && !beforeAdvance) continue;
    if (beforeAdvance) kind = 'Before advance';
    const key = `${ctx.po._id}|${ctx.line._id}|${pr.replacementFor ? `r${pr.replacementFor}` : new Date(pr.receivedAt).toISOString().slice(0, 10)}`;
    if (deliveries.has(key)) continue;
    const late = beforeAdvance ? 0 : daysLate(promised, pr.receivedAt);
    deliveries.set(key, { vendorId, event: { score: deliveryEvent(late), date: pr.receivedAt, value: 1, poNumber: ctx.po.purchaseOrderNumber, item: ctx.line.itemName, promised, received: pr.receivedAt, daysLate: late, kind } });
  }
  for (const { vendorId, event } of deliveries.values()) ev.get(vendorId)?.delivery.push(event);

  // Quality: each decided QC job.
  for (const job of jobs) {
    const ctx = lineOfPr.get(String(job.purchaseRequestId));
    if (!ctx) continue;
    const vendorId = idOf(ctx.po.supplier);
    // Each QC rejection on a PO is a PurchaseRejection (§24) — it carries the
    // quantity, the severity and the vendor's answer. A job without them (an
    // older one) falls back to the job's own record.
    const recs = rejByJob.get(String(job._id)) || [];
    const rejs = recs.length
      ? recs.map(r => ({ qty: Number(r.rejectedQty) || 0, severity: r.severity || 'Major', refused: r.outcome === 'refused' }))
      : [
        ...(job.partialRejections || []).map(p => ({ qty: Number(p.qty) || 0, severity: p.severity || 'Major' })),
        ...(job.status === 'Rejected' ? [{ qty: Number(job.quantity) || 0, severity: job.failSeverity || 'Major' }] : []),
      ];
    const acceptedQty = job.status === 'Approved' ? (Number(job.acceptedQty ?? job.quantity) || 0) : 0;
    const score = qualityEvent({ acceptedQty, rejections: rejs });
    if (score == null) continue;
    const pr = prById.get(String(job.purchaseRequestId));
    const linePrs = prIdsOfLine(ctx.line).map(id => prById.get(id)).filter(p => p && !p.replacementFor);
    const total = acceptedQty + rejs.reduce((s, r) => s + r.qty, 0);
    const value = pr?.replacementFor
      ? (Number(rejById.get(String(pr.replacementFor))?.value) || 0)
      : acceptedMoney({ line: ctx.line, prs: linePrs, pr, acceptedQty: total, jobTotalQty: total }).value;
    ev.get(vendorId)?.quality.push({
      score, value, date: job.updatedAt, poNumber: ctx.po.purchaseOrderNumber, item: ctx.line.itemName, qcJob: job.qcJobId,
      accepted: acceptedQty, rejected: rejs.map(r => ({ qty: r.qty, severity: r.severity, refused: !!r.refused })),
    });
  }

  // Credit: each real PO's terms.
  for (const po of pos) {
    if (po.status === 'Cancelled') continue;
    const vendorId = idOf(po.supplier);
    const terms = { creditDays: po.paymentTerms?.creditDays, advancePercent: po.paymentTerms?.advancePercent };
    ev.get(vendorId)?.credit.push({ score: creditEvent(terms), value: Number(po.grandTotal) || 0, date: po.orderDate || po.createdAt, poNumber: po.purchaseOrderNumber, creditDays: Number(terms.creditDays) || 0, advancePercent: Number(terms.advancePercent) || 0 });
  }

  // Price: each delivery vs the lowest anyone charged or quoted for the item.
  const itemIds = [...new Set(pos.flatMap(po => (po.items || []).map(l => (l.item ? String(l.item) : null)).filter(Boolean)))];
  if (itemIds.length) {
    const samples = await loadPriceSamples({ companyId: cid, itemIds });
    const groups = await mongoose.model('ItemQuoteGroup').find({ item: { $in: itemIds } }).select('item').lean();
    const itemOfGroup = new Map(groups.map(g => [String(g._id), String(g.item)]));
    const bids = groups.length
      ? await VendorBid.find({ companyId: cid, group: { $in: groups.map(g => g._id) }, status: { $in: ['Submitted', 'Selected', 'Rejected', 'Superseded'] }, unitPrice: { $gt: 0 } })
        .select('group vendor unitPrice gstInclusive gstPercent purchaseUnit submittedAt createdAt warrantyMonths productName').lean()
      : [];
    const offers = new Map();   // itemId|unit → [{ price, vendorId, date }]
    const addOffer = (itemId, unit, o) => {
      const k = `${itemId}|${normUnit(unit)}`;
      if (!offers.has(k)) offers.set(k, []);
      offers.get(k).push(o);
    };
    for (const [itemId, list] of samples) for (const s of list) addOffer(itemId, s.unit, { price: s.price, vendorId: s.vendorId, date: s.date, kind: 'delivered' });
    for (const b of bids) {
      const itemId = itemOfGroup.get(String(b.group));
      const p = exGstPrice(b.unitPrice, b.gstInclusive, b.gstPercent);
      if (itemId && p > 0) addOffer(itemId, b.purchaseUnit, { price: Math.round(p * 100) / 100, vendorId: String(b.vendor), date: b.submittedAt || b.createdAt, kind: 'quoted' });
    }
    const itemName = new Map(pos.flatMap(po => (po.items || []).map(l => [String(l.item), l.itemName])));
    for (const [itemId, list] of samples) {
      for (const s of list) {
        if (!ev.has(s.vendorId)) continue;
        const pool = offers.get(`${itemId}|${normUnit(s.unit)}`) || [];
        // Only items another vendor also priced, within a year of this delivery.
        const near = pool.filter(o => Math.abs(new Date(o.date) - new Date(s.date)) <= WINDOW_DAYS * DAY);
        if (!near.some(o => o.vendorId !== s.vendorId)) continue;
        const lowest = Math.min(...near.map(o => o.price));
        const lowestBy = near.find(o => o.price === lowest);
        ev.get(s.vendorId).price.push({ score: priceEvent(s.price, lowest), value: s.price * (Number(s.quantity) || 1), date: s.date, poNumber: s.poNumber, item: itemName.get(itemId) || '', unit: s.unit, price: s.price, lowest, lowestKind: lowestBy?.kind, lowestOwn: lowestBy?.vendorId === s.vendorId });
      }
    }
    // Warranty duration: each of their quotes vs the best quoted for that item (only where someone gave one).
    const bestWarranty = new Map();
    for (const b of bids) {
      const itemId = itemOfGroup.get(String(b.group));
      if (!itemId) continue;
      bestWarranty.set(itemId, Math.max(bestWarranty.get(itemId) || 0, Number(b.warrantyMonths) || 0));
    }
    for (const b of bids) {
      const vendorId = String(b.vendor);
      if (!ev.has(vendorId)) continue;
      const itemId = itemOfGroup.get(String(b.group));
      const best = bestWarranty.get(itemId) || 0;
      const score = warrantyDurationEvent(b.warrantyMonths, best);
      if (score == null) continue;
      ev.get(vendorId).warrantyDuration.push({ score, value: 1, date: b.submittedAt || b.createdAt, item: b.productName || itemName.get(itemId) || '', months: Number(b.warrantyMonths) || 0, best });
    }
  }

  // Warranty claims.
  const claims = await VendorWarrantyClaim.find({ companyId: cid, vendor: { $in: vids } })
    .select('vendor number itemName serialNumber reportedToVendorAt vendorRespondedAt resolvedAt outcome underWarranty satisfaction status').lean();
  for (const c of claims) {
    const score = claimEvent(c, now);
    if (score == null) continue;
    ev.get(String(c.vendor))?.claims.push({ score, value: 1, date: c.reportedToVendorAt, number: c.number, item: c.itemName, outcome: c.outcome || c.status, stars: c.satisfaction?.rating || null });
  }

  // Response to quotation requests.
  const requests = await QuotationRequest.find({ companyId: cid, vendor: { $in: vids }, emailStatus: 'Sent' })
    .select('vendor number sentAt submittedAt tokenExpiry status items').lean();
  for (const q of requests) {
    const score = responseEvent(q, now);
    if (score == null) continue;
    ev.get(String(q.vendor))?.response.push({ score, value: 1, date: q.sentAt, number: q.number, items: (q.items || []).length, sentAt: q.sentAt, submittedAt: q.submittedAt || null });
  }

  // ── Put each vendor together ──
  for (const id of ids) {
    const e = ev.get(id);
    const parts = {
      price: summarizePart(e.price, now),
      quality: summarizePart(e.quality, now),
      delivery: summarizePart(e.delivery, now),
      credit: summarizePart(e.credit, now),
      warranty: combineWarranty(summarizePart(e.warrantyDuration, now), summarizePart(e.claims, now)),
      response: summarizePart(e.response, now),
    };
    const pcts = Object.fromEntries(PARTS.map(k => [k, parts[k].pct]));
    const lifePcts = Object.fromEntries(PARTS.map(k => [k, parts[k].lifetimePct]));
    const onTimeRecent = e.delivery.filter(d => recencyWeight(d.date, now) > 0);
    const qcRecent = e.quality.filter(q => recencyWeight(q.date, now) > 0);
    const acc = qcRecent.reduce((s, q) => s + q.accepted, 0);
    const rej = qcRecent.reduce((s, q) => s + q.rejected.reduce((a, r) => a + r.qty, 0), 0);
    const historyEvents = onTimeRecent.length + qcRecent.length;
    const result = {
      score: combineParts(pcts, weights),
      lifetime: combineParts(lifePcts, weights),
      parts,
      weights,
      limitedHistory: historyEvents < MIN_HISTORY_EVENTS,
      historyEvents,
      counts: {
        onTime: { on: onTimeRecent.filter(d => d.daysLate === 0).length, total: onTimeRecent.length },
        qc: { acceptedPct: acc + rej > 0 ? round1(100 * acc / (acc + rej)) : null, jobs: qcRecent.length },
      },
      disputes: e.disputes,
    };
    if (withEvidence) {
      const newest = (list) => [...list].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, EVIDENCE_CAP);
      result.evidence = {
        price: newest(e.price), quality: newest(e.quality), delivery: newest(e.delivery), credit: newest(e.credit),
        warrantyDuration: newest(e.warrantyDuration), claims: newest(e.claims), response: newest(e.response),
      };
    }
    out.set(id, result);
  }
  return out;
}

// Warranty = the average of its two halves that have data.
export function combineWarranty(duration, claims) {
  const halves = [duration, claims].filter(h => h.pct != null);
  const lifeHalves = [duration, claims].filter(h => h.lifetimePct != null);
  return {
    pct: halves.length ? round1(halves.reduce((s, h) => s + h.pct, 0) / halves.length) : null,
    lifetimePct: lifeHalves.length ? round1(lifeHalves.reduce((s, h) => s + h.lifetimePct, 0) / lifeHalves.length) : null,
    events: duration.events + claims.events,
    lifetimeEvents: duration.lifetimeEvents + claims.lifetimeEvents,
    duration: duration.pct,
    claims: claims.pct,
  };
}

async function loadSettings(companyId) {
  const { getOrCreateSettings } = await import('../controllers/purchaseSettingsController.js');
  return getOrCreateSettings(companyId);
}

// ── Prices on the Vendor Ratings tab (unchanged numbers) ─────────────────────
/**
 * Avg / last / lowest price this vendor has actually DELIVERED one item at —
 * the same "Bought before" data the RFQ/PO page uses (loadPriceSamples):
 * before GST, only deliveries in the unit of the vendor's latest one.
 */
export async function computeVendorItemPricing({ companyId, vendorId, itemObjectId }) {
  const samples = (await loadPriceSamples({ companyId, itemIds: [itemObjectId] })).get(String(itemObjectId)) || [];
  const theirs = samples.filter(s => s.vendorId === String(vendorId));
  if (!theirs.length) return { avgPrice: null, lastPrice: null, lowestPrice: null, priceUnit: null, deliveries: 0 };
  const unit = theirs[0].unit;
  const summary = summarizePrices(theirs, { unit });
  return { avgPrice: summary.avg, lastPrice: summary.last.price, lowestPrice: summary.lowest.price, priceUnit: unit || null, deliveries: summary.count };
}

// ── Monthly snapshot + Watchlist alert (blueprint vendor_scores, §23) ────────
export async function runVendorScoreSweep(now = new Date(), { companyId = null } = {}) {
  const Supplier = mongoose.model('Supplier');
  const VendorScore = (await import('../models/VendorScore.js')).default;
  const notificationService = (await import('./notificationService.js')).default;
  const filter = { approvalStatus: 'Approved' };
  if (companyId) filter.companyId = companyId;
  const vendors = await Supplier.find(filter).select('supplierName companyId').lean();
  const byCompany = new Map();
  for (const v of vendors) {
    const k = String(v.companyId);
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(v);
  }
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let alerts = 0;
  for (const [cid, list] of byCompany) {
    try {
      const settings = await loadSettings(cid);
      const { watchlistBelow } = scoreSettingsOf(settings);
      const scores = await computeVendorScores({ companyId: cid, vendorIds: list.map(v => v._id), now, settings });
      for (const v of list) {
        const s = scores.get(String(v._id));
        if (!s) continue;
        const below = s.score != null && !s.limitedHistory && s.score < watchlistBelow;
        const prev = await VendorScore.findOne({ companyId: cid, vendor: v._id }).sort({ computedAt: -1 }).select('belowThreshold').lean();
        await VendorScore.updateOne(
          { companyId: cid, vendor: v._id, period },
          { $set: { score: s.score, lifetime: s.lifetime, parts: Object.fromEntries(PARTS.map(k => [k, s.parts[k].pct])), weights: s.weights, limitedHistory: s.limitedHistory, belowThreshold: below, computedAt: now } },
          { upsert: true },
        );
        if (below && !prev?.belowThreshold) {
          alerts += 1;
          await notificationService.notifyRoles(['Company Admin', 'Accounts Head'], {
            title: 'Vendor score below the Watchlist line',
            message: `${v.supplierName}'s vendor score is ${s.score} / 100 (below ${watchlistBelow}) — they're on the Watchlist. See Purchase → Vendor Ratings for why.`,
            type: 'purchase',
            targetCompanyId: cid,
            data: { vendorId: String(v._id), score: s.score },
          });
        }
      }
    } catch (err) {
      console.error(`Vendor score sweep failed for company ${cid}:`, err.message);
    }
  }
  return { vendors: vendors.length, alerts };
}
