// Purchaser score (procurement-v2, 2026-10-13) — the client blueprint's
// purchaser performance score (§13): process quality, not just buying cheap.
// Full logic: docs/procurement-v2/purchaser-score-logic-2026-10.md.
//
//   RFQ coverage 15         enough vendors asked, per PO item (selection check)
//   Quotation completeness 10  manual quotations complete (evidence, GST,
//                           delivery days, terms); answered email requests
//   Savings 15              cheapest full landed quote ÷ the chosen one
//   Delivery follow-up 15   days from a missed due date to a new date / the goods
//   Quality outcome 15      QC accepted share, by severity (no vendor-refusal doubling)
//   Documentation 10        PO emailed + lines backed by a quote with evidence
//   PO accuracy 10          rejected by the Company Admin / cancelled as our mistake = 0
//   Relationship 5          days to record the vendor's answer on a QC rejection
//   Policy 5                a vendor selection exception = 50
//
// All automatic (user decision). A purchaser = whoever created the PO /
// quotation request / manual quotation; QC results and rejections belong to
// the PO's creator. Month view (unweighted) + last 12 months (recent counting
// more) + a 6-month trend. Worked out live — nothing stored.
import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import QCJob from '../models/QCJob.js';
import PurchaseRejection from '../models/PurchaseRejection.js';
import VendorBid from '../models/VendorBid.js';
import QuotationRequest from '../models/QuotationRequest.js';
import ManualQuotation from '../models/ManualQuotation.js';
import PurchaseAuditLog from '../models/PurchaseAuditLog.js';
import { qualityEvent, recencyWeight, weightedMean, daysLate } from './vendorScoreService.js';
import { prIdsOfLine, acceptedMoney } from './purchaseAcceptanceService.js';

export const P_PARTS = ['coverage', 'completeness', 'savings', 'followUp', 'quality', 'documentation', 'poAccuracy', 'relationship', 'policy'];
export const P_PART_LABELS = {
  coverage: 'RFQ coverage', completeness: 'Quotation completeness', savings: 'Savings / landed cost',
  followUp: 'Delivery follow-up', quality: 'Quality outcome', documentation: 'Documentation',
  poAccuracy: 'PO accuracy', relationship: 'Relationship process', policy: 'Policy compliance',
};
export const DEFAULT_PURCHASER_WEIGHTS = { coverage: 15, completeness: 10, savings: 15, followUp: 15, quality: 15, documentation: 10, poAccuracy: 10, relationship: 5, policy: 5 };
export const MIN_POS_FOR_HISTORY = 3;
export const MISTAKE_REASONS = ['Ordered by mistake', 'Need no longer exists'];
const DAY = 24 * 60 * 60 * 1000;
const EVIDENCE_CAP = 60;
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;
const idOf = (x) => String(x?._id || x || '');

// ── Pure ─────────────────────────────────────────────────────────────────────

// Enough vendors asked, per item of a PO: mean of min(1, asked ÷ required).
export function coverageEvent(competition = []) {
  const lines = (competition || []).filter(l => Number(l.required) > 0);
  if (!lines.length) return null;
  return round1(100 * lines.reduce((s, l) => s + Math.min(1, (Number(l.asked) || 0) / Number(l.required)), 0) / lines.length);
}

// A manual quotation: evidence, GST on every item, delivery days on every item, payment terms.
export function completenessEvent({ files = 0, items = [], paymentTerms = {} }) {
  const gst = items.length > 0 && items.every(i => i.gstInclusive || (i.gstPercent != null && i.gstPercent !== ''));
  const days = items.length > 0 && items.every(i => Number(i.deliveryDays) > 0);
  const terms = paymentTerms?.advancePercent != null || paymentTerms?.creditDays != null;
  const checks = { evidence: files > 0, gst, deliveryDays: days, terms };
  return { score: 25 * Object.values(checks).filter(Boolean).length, checks };
}

// The cheapest full landed quote ÷ the chosen one (null when nothing to compare).
export function savingsEvent(check) {
  const basket = check?.basket || [];
  const mine = check?.thisVendor || basket.find(b => b.isThisVendor);
  if (!mine || !(mine.landed > 0) || basket.length < 2) return null;
  const cheapest = Math.min(...basket.map(b => Number(b.landed) || Infinity));
  return round1(clamp(100 * cheapest / mine.landed));
}

// ≤2 days → 100, then −20 a day, 0 at 7+.
export const followUpScore = (late) => clamp(100 - 20 * Math.max(0, late - 2));

// Each missed due date on a line: the first promise, then each date they
// recorded. A date changed before it was due isn't an event. `received` =
// when the line's goods came (null = not yet). Revisions recorded after the
// goods came belong to replacements and are ignored here.
export function followUpEvents({ firstDue, revisions = [], received = null, now = new Date() }) {
  const events = [];
  let due = firstDue ? new Date(firstDue) : null;
  const revs = [...revisions].filter(r => r?.at && r?.to).sort((a, b) => new Date(a.at) - new Date(b.at))
    .filter(r => !received || new Date(r.at) < new Date(received));
  for (const r of revs) {
    if (due && daysLate(due, r.at) > 0) {
      const late = daysLate(due, r.at);
      events.push({ due, actionAt: new Date(r.at), action: 'New date recorded', late, score: followUpScore(late) });
    }
    due = new Date(r.to);
  }
  if (due) {
    const end = received ? new Date(received) : now;
    const late = daysLate(due, end);
    if (late > 0) events.push({ due, actionAt: received ? new Date(received) : null, action: received ? 'Goods arrived' : 'Still overdue', late, score: followUpScore(late) });
  }
  return events;
}

// A real PO: emailed (50) + share of lines backed by a quote with evidence (50).
export function docEvent({ emailed, lines }) {
  const live = (lines || []).filter(l => !l.cancelled);
  const backed = live.filter(l => l.evidence).length;
  return { score: round1((emailed ? 50 : 0) + (live.length ? 50 * backed / live.length : 0)), backed, total: live.length };
}

// A decided PO: rejected by the Company Admin, or cancelled as our own mistake → 0.
export function poAccuracyEvent({ status, cancellations = [] }) {
  if (status === 'Rejected') return { score: 0, why: 'Rejected by the Company Admin' };
  const ours = (cancellations || []).find(c => c.status === 'Approved' && c.side === 'Ours' && (c.reasons || []).some(r => MISTAKE_REASONS.includes(r)));
  if (ours) return { score: 0, why: `Cancelled: ${(ours.reasons || []).filter(r => MISTAKE_REASONS.includes(r)).join(', ')}` };
  return { score: 100, why: '' };
}

// A QC rejection: days to record the vendor's answer — ≤3 → 100, 0 at 15; open 15+ days → 0; open less → not yet.
export function relationshipEvent({ createdAt, recordedAt }, now = new Date()) {
  const days = ((recordedAt ? new Date(recordedAt) : now).getTime() - new Date(createdAt).getTime()) / DAY;
  if (!recordedAt && days < 15) return null;
  return round1(clamp(100 - (Math.max(0, days - 3) / 12) * 100));
}

export const policyEvent = (check) => (check ? ((check.exceptionReasons || []).length ? 50 : 100) : null);

// 'YYYY-MM' → [start, end) dates (local). Bad / missing → the current month.
export function monthRange(month, now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? Number(m[2]) - 1 : now.getMonth();
  const start = new Date(y, mo, 1);
  const end = new Date(y, mo + 1, 1);
  return { start, end, key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}` };
}

export function readPurchaserWeights(body = {}) {
  const weights = {};
  for (const k of P_PARTS) {
    const n = Number(body?.weights?.[k]);
    if (!Number.isInteger(n) || n < 0 || n > 100) return { error: `${P_PART_LABELS[k]} weight must be a whole number from 0 to 100.` };
    weights[k] = n;
  }
  const total = P_PARTS.reduce((s, k) => s + weights[k], 0);
  if (total !== 100) return { error: `The weights must add up to 100 (now ${total}).` };
  return { weights };
}

// The nine parts → the score over the parts that have data (null when none do).
export function combinePurchaserParts(pcts, weights = DEFAULT_PURCHASER_WEIGHTS) {
  let sw = 0; let s = 0;
  for (const k of P_PARTS) {
    const pct = pcts[k];
    const w = Number(weights?.[k]) || 0;
    if (pct == null || !(w > 0)) continue;
    sw += w; s += pct * w;
  }
  return sw > 0 ? Math.round(s / sw) : null;
}

export function purchaserWeightsOf(settings) {
  const w = settings?.purchaserScore?.weights;
  return Object.fromEntries(P_PARTS.map(k => [k, w?.[k] != null && Number.isFinite(Number(w[k])) ? Number(w[k]) : DEFAULT_PURCHASER_WEIGHTS[k]]));
}

// One part for a period: month (events in range, unweighted beyond value) or rolling (recency).
function partFor(events, { range = null, now }) {
  const inScope = events.filter(e => e.score != null && (range ? (e.date >= range.start && e.date < range.end) : recencyWeight(e.date, now) > 0));
  const pct = weightedMean(inScope.map(e => ({ score: e.score, weight: (range ? 1 : recencyWeight(e.date, now)) * (e.value > 0 ? e.value : 1) })));
  return { pct: pct == null ? null : round1(pct), events: inScope.length };
}

function scoreFor(ev, weights, opts) {
  const parts = Object.fromEntries(P_PARTS.map(k => [k, partFor(ev[k], opts)]));
  const pcts = Object.fromEntries(P_PARTS.map(k => [k, parts[k].pct]));
  return { score: combinePurchaserParts(pcts, weights), parts };
}

// ── DB ───────────────────────────────────────────────────────────────────────

// Scores for the company's purchasers (or just `userIds`). month = 'YYYY-MM'.
// Returns Map userId → { month, rolling, trend, counts, limitedHistory, evidence? }.
export async function computePurchaserScores({ companyId, userIds = null, month = null, now = new Date(), settings = null, withEvidence = false }) {
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const only = userIds ? new Set(userIds.map(String)) : null;
  const mine = (uid) => uid && (!only || only.has(String(uid)));
  const weights = purchaserWeightsOf(settings || await loadSettings(companyId));
  const range = monthRange(month, now);
  const out = new Map();
  const ev = new Map();
  const bucket = (uid) => {
    const k = String(uid);
    if (!ev.has(k)) ev.set(k, Object.fromEntries(P_PARTS.map(p => [p, []])));
    return ev.get(k);
  };

  // ── POs and what hangs off them ──
  const pos = await Purchase.find({ companyId: cid, status: { $ne: 'Pending Approval' }, ...(only ? { createdBy: { $in: [...only].map(id => new mongoose.Types.ObjectId(id)) } } : {}) })
    .select('purchaseOrderNumber supplier createdBy status orderDate createdAt selectionCheck items cancellations expectedDeliveryDate')
    .populate('supplier', 'supplierName').lean();
  const lineOfPr = new Map();
  for (const po of pos) for (const line of po.items || []) for (const prId of prIdsOfLine(line)) lineOfPr.set(prId, { po, line });
  const [prs, emailedIds, bids] = await Promise.all([
    lineOfPr.size ? PurchaseRequest.find({ _id: { $in: [...lineOfPr.keys()] } }).select('status receivedAt replacementFor purchaseQuantity quantity fabricationDimensionLines').lean() : [],
    pos.length ? PurchaseAuditLog.distinct('entityId', { companyId: cid, entityId: { $in: pos.map(p => p._id) }, action: 'emailed' }) : [],
    VendorBid.find({ _id: { $in: pos.flatMap(po => (po.items || []).map(l => l.vendorBid).filter(Boolean)) } }).select('source quotationRequest manualQuotation').lean(),
  ]);
  const prById = new Map(prs.map(p => [String(p._id), p]));
  const emailed = new Set(emailedIds.map(String));
  const bidById = new Map(bids.map(b => [String(b._id), b]));
  const received = prs.filter(p => p.status === 'Received');
  const [jobs, rejections] = await Promise.all([
    received.length ? QCJob.find({ company: cid, source: 'Purchase', purchaseRequestId: { $in: received.map(p => p._id) }, status: { $in: ['Approved', 'Rejected'] } })
      .select('purchaseRequestId status quantity acceptedQty partialRejections failSeverity updatedAt qcJobId').lean() : [],
    pos.length ? PurchaseRejection.find({ companyId: cid, purchaseOrder: { $in: pos.map(p => p._id) } }).select('purchaseOrder qcJob number itemName rejectedQty severity createdAt recordedAt outcome replacement').lean() : [],
  ]);
  const rejByJob = new Map();
  const rejById = new Map();
  for (const r of rejections) {
    rejById.set(String(r._id), r);
    const k = String(r.qcJob);
    if (!rejByJob.has(k)) rejByJob.set(k, []);
    rejByJob.get(k).push(r);
  }
  const poById = new Map(pos.map(p => [String(p._id), p]));

  for (const po of pos) {
    const uid = po.createdBy;
    if (!mine(uid)) continue;
    const e = bucket(uid);
    const date = new Date(po.orderDate || po.createdAt);
    const base = { date, poNumber: po.purchaseOrderNumber, vendor: po.supplier?.supplierName || '' };
    // PO accuracy (every decided PO, Rejected included).
    const acc = poAccuracyEvent(po);
    e.poAccuracy.push({ ...base, score: acc.score, why: acc.why || (po.status === 'Cancelled' ? 'Cancelled — vendor side' : 'OK') });
    if (po.status === 'Rejected') continue;   // never became an order
    const check = po.selectionCheck || null;
    const cov = coverageEvent(check?.competition);
    if (cov != null) e.coverage.push({ ...base, score: cov, value: (check.competition || []).length, items: (check.competition || []).map(c => `${c.itemName}: ${c.asked}/${c.required}`).join('; ') });
    const sav = savingsEvent(check);
    if (sav != null) e.savings.push({ ...base, score: sav, chosen: check.thisVendor?.landed, cheapest: Math.min(...check.basket.map(b => b.landed)) });
    const pol = policyEvent(check);
    if (pol != null) e.policy.push({ ...base, score: pol, why: (check.exceptionReasons || []).join(', ') || 'No exception' });
    // Documentation.
    const lines = (po.items || []).map(l => {
      const bid = l.vendorBid ? bidById.get(String(l.vendorBid)) : null;
      const evidence = !!bid && (bid.source === 'Email' || !!bid.manualQuotation);
      return { cancelled: !!l.cancelled?.at, evidence };
    });
    const doc = docEvent({ emailed: emailed.has(String(po._id)), lines });
    e.documentation.push({ ...base, score: doc.score, emailed: emailed.has(String(po._id)), backed: `${doc.backed}/${doc.total}` });
    // Follow-up, per live line.
    for (const line of po.items || []) {
      if (line.cancelled?.at) continue;
      const linePrs = prIdsOfLine(line).map(id => prById.get(id)).filter(Boolean);
      const basePrs = linePrs.filter(p => !p.replacementFor);
      const allIn = basePrs.length && basePrs.every(p => p.status === 'Received' && p.receivedAt);
      const receivedAt = allIn ? new Date(Math.max(...basePrs.map(p => new Date(p.receivedAt).getTime()))) : null;
      const hist = line.deliveryDateHistory || [];
      const firstDue = hist[0]?.from || line.expectedDeliveryDate || (hist.length ? null : po.expectedDeliveryDate) || null;
      for (const f of followUpEvents({ firstDue, revisions: hist.filter(h => !/^Replacement for/.test(h.reason || '')), received: receivedAt, now })) {
        e.followUp.push({ ...base, date: f.due, score: f.score, item: line.itemName, due: f.due, late: f.late, action: f.action, actionAt: f.actionAt });
      }
      // A replacement: due the date the vendor gave for it.
      for (const rp of linePrs.filter(p => p.replacementFor)) {
        const due = rejById.get(String(rp.replacementFor))?.replacement?.expectedDate;
        if (!due) continue;
        const end = rp.status === 'Received' && rp.receivedAt ? new Date(rp.receivedAt) : now;
        const late = daysLate(due, end);
        if (late > 0) e.followUp.push({ ...base, date: new Date(due), score: followUpScore(late), item: `${line.itemName} (replacement)`, due, late, action: rp.status === 'Received' ? 'Goods arrived' : 'Still overdue', actionAt: rp.status === 'Received' ? rp.receivedAt : null });
      }
    }
  }

  // Quality outcome: decided QC jobs on their POs (severity; no vendor-refusal doubling).
  for (const job of jobs) {
    const ctx = lineOfPr.get(String(job.purchaseRequestId));
    if (!ctx || !mine(ctx.po.createdBy)) continue;
    const recs = rejByJob.get(String(job._id)) || [];
    const rejs = recs.length
      ? recs.map(r => ({ qty: Number(r.rejectedQty) || 0, severity: r.severity || 'Major' }))
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
    const value = pr?.replacementFor ? (Number(rejById.get(String(pr.replacementFor))?.value) || 0) : acceptedMoney({ line: ctx.line, prs: linePrs, pr, acceptedQty: total, jobTotalQty: total }).value;
    bucket(ctx.po.createdBy).quality.push({ date: new Date(job.updatedAt), score, value, poNumber: ctx.po.purchaseOrderNumber, vendor: ctx.po.supplier?.supplierName || '', item: ctx.line.itemName, accepted: acceptedQty, rejected: rejs.map(r => `${r.qty} ${r.severity}`).join(', ') || '—' });
  }

  // Relationship: vendor's answer on each QC rejection.
  for (const r of rejections) {
    const po = poById.get(String(r.purchaseOrder));
    if (!po || !mine(po.createdBy)) continue;
    const score = relationshipEvent(r, now);
    if (score == null) continue;
    bucket(po.createdBy).relationship.push({ date: new Date(r.createdAt), score, poNumber: po.purchaseOrderNumber, number: r.number, item: r.itemName, answeredAt: r.recordedAt || null, outcome: r.outcome || 'No answer yet' });
  }

  // Quotation completeness: answered email requests + manual quotations.
  const userFilter = only ? { createdBy: { $in: [...only].map(id => new mongoose.Types.ObjectId(id)) } } : { createdBy: { $ne: null } };
  const [qrs, mqs] = await Promise.all([
    QuotationRequest.find({ companyId: cid, emailStatus: 'Sent', submittedAt: { $ne: null }, ...userFilter }).select('number vendorName createdBy createdAt submittedAt items').lean(),
    ManualQuotation.find({ companyId: cid, ...userFilter }).select('number vendorName createdBy createdAt files items paymentTerms').lean(),
  ]);
  for (const q of qrs) {
    bucket(q.createdBy).completeness.push({ date: new Date(q.createdAt), score: 100, number: q.number, vendor: q.vendorName, kind: 'Email request answered', items: (q.items || []).length, missing: '' });
  }
  const mqBids = mqs.length ? await VendorBid.find({ _id: { $in: mqs.flatMap(m => (m.items || []).map(i => i.vendorBid).filter(Boolean)) } }).select('gstInclusive gstPercent deliveryDays').lean() : [];
  const mqBidById = new Map(mqBids.map(b => [String(b._id), b]));
  for (const m of mqs) {
    const items = (m.items || []).map(i => mqBidById.get(String(i.vendorBid))).filter(Boolean);
    const c = completenessEvent({ files: (m.files || []).length, items, paymentTerms: m.paymentTerms });
    const missing = Object.entries({ evidence: 'evidence', gst: 'GST', deliveryDays: 'delivery days', terms: 'payment terms' }).filter(([k]) => !c.checks[k]).map(([, l]) => l).join(', ');
    bucket(m.createdBy).completeness.push({ date: new Date(m.createdAt), score: c.score, number: m.number, vendor: m.vendorName, kind: 'Manual quotation', items: items.length, missing });
  }

  // ── Put each purchaser together ──
  // The 6 months ending with the chosen one.
  const ym = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const trendMonths = [5, 4, 3, 2, 1, 0].map(i => monthRange(ym(range.start.getFullYear(), range.start.getMonth() - i), now));
  for (const [uid, e] of ev) {
    for (const k of P_PARTS) for (const x of e[k]) x.date = new Date(x.date);
    const posIn = (r) => e.poAccuracy.filter(x => (r ? x.date >= r.start && x.date < r.end : recencyWeight(x.date, now) > 0)).length;
    const result = {
      month: { key: range.key, ...scoreFor(e, weights, { range, now }), pos: posIn(range) },
      rolling: { ...scoreFor(e, weights, { now }), pos: posIn(null) },
      trend: trendMonths.map(r => ({ month: r.key, score: scoreFor(e, weights, { range: r, now }).score })),
      weights,
    };
    result.month.limitedHistory = result.month.pos < MIN_POS_FOR_HISTORY;
    result.rolling.limitedHistory = result.rolling.pos < MIN_POS_FOR_HISTORY;
    if (withEvidence) {
      const from = Math.min(range.start.getTime(), now.getTime() - 365 * DAY);
      result.evidence = Object.fromEntries(P_PARTS.map(k => [k, e[k].filter(x => x.date.getTime() >= from).sort((a, b) => b.date - a.date).slice(0, EVIDENCE_CAP)]));
    }
    out.set(uid, result);
  }
  return out;
}

async function loadSettings(companyId) {
  const { getOrCreateSettings } = await import('../controllers/purchaseSettingsController.js');
  return getOrCreateSettings(companyId);
}
