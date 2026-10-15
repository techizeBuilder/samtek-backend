// Purchase Dashboard (procurement-v2, 2026-10-13 — blueprint §21). Three
// views for the three people who buy (user decision):
//   mine   — the purchase employee (Account Employee): my work to do
//   head   — the purchase head (Accounts Head): the team's work + money + vendors
//   admin  — the Company Admin: approvals waiting + management numbers
// Full logic: docs/procurement-v2/purchase-dashboard-design-2026-10.md.
// Everything is worked out live from records we already keep; nothing is stored.
import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import QCJob from '../models/QCJob.js';
import PurchaseRejection from '../models/PurchaseRejection.js';
import VendorBid from '../models/VendorBid.js';
import QuotationRequest from '../models/QuotationRequest.js';
import ManualQuotation from '../models/ManualQuotation.js';
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import VendorMoneyBack from '../models/VendorMoneyBack.js';
import VendorWarrantyClaim from '../models/VendorWarrantyClaim.js';
import VendorApprovalRequest from '../models/VendorApprovalRequest.js';
import Supplier from '../models/Supplier.js';
import '../models/PurchaseRequest.js';
import { OPEN_PO_STATUSES, lineDueBucket, lineIsReceived } from './deliveryFollowUpService.js';
import { NO_REPLY_DAYS, EXPIRY_WARN_DAYS } from './quoteReminderService.js';
import { owedNow } from './purchaseBillService.js';
import { loadPriceSamples, exGstPrice, quoteValidUntil, priceChangePercent } from './quoteChecksService.js';
import { getVendorStanding } from './vendorApprovalService.js';
import { computePurchaserScores, P_PART_LABELS } from './purchaserScoreService.js';

const DAY = 24 * 60 * 60 * 1000;
export const REJECTION_LONG_DAYS = 3;
export const CLAIM_LONG_DAYS = 7;
export const RECENT_DAYS = 30;
export const TOP_VENDORS = 3;
const NOT_REAL = ['Pending Approval', 'Rejected', 'Cancelled'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const idOf = (x) => String(x?._id || x || '');
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// ── Pure ─────────────────────────────────────────────────────────────────────

// 'month' (this month) · '3m' (this + the 2 before) · '12m' (this + the 11 before).
export function periodRange(period, now = new Date()) {
  const back = period === '12m' ? 11 : period === '3m' ? 2 : 0;
  const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return { key: ['month', '3m', '12m'].includes(period) ? period : 'month', start, end: now };
}

const inRange = (d, r) => { const t = new Date(d).getTime(); return t >= r.start.getTime() && t <= r.end.getTime(); };
const poDate = (po) => po.orderDate || po.createdAt;

// Vendor selection checks with 2+ full quotes: saved (the cheapest chosen:
// next-cheapest − chosen) and paid above the cheapest (otherwise).
export function savingsOf(pos) {
  const out = { saved: 0, savedPOs: 0, paidAbove: 0, paidAbovePOs: 0, compared: 0 };
  for (const po of pos) {
    const c = po.selectionCheck;
    const basket = (c?.basket || []).filter(b => Number(b.landed) > 0).sort((a, b) => a.landed - b.landed);
    const mine = c?.thisVendor || basket.find(b => b.isThisVendor);
    if (!mine || basket.length < 2) continue;
    out.compared += 1;
    const cheapest = basket[0].landed;
    if (mine.landed <= cheapest + 0.005) {
      const next = basket.find(b => !b.isThisVendor && b.landed >= mine.landed);
      if (next) { out.saved += next.landed - mine.landed; out.savedPOs += 1; }
    } else {
      out.paidAbove += mine.landed - cheapest;
      out.paidAbovePOs += 1;
    }
  }
  out.saved = round2(out.saved);
  out.paidAbove = round2(out.paidAbove);
  return out;
}

// Share of PO items where enough vendors were asked.
export function complianceOf(pos) {
  let passed = 0; let total = 0;
  for (const po of pos) for (const l of po.selectionCheck?.competition || []) {
    total += 1;
    if (Number(l.asked) >= Number(l.required)) passed += 1;
  }
  return { passed, total, pct: total ? Math.round((100 * passed) / total) : null };
}

// The top vendors' share of purchase value.
export function concentration(pos, top = TOP_VENDORS) {
  const byVendor = new Map();
  let total = 0;
  for (const po of pos) {
    const v = Number(po.grandTotal) || 0;
    total += v;
    const k = idOf(po.supplier);
    const cur = byVendor.get(k) || { vendorId: k, name: po.supplier?.supplierName || 'Vendor', value: 0 };
    cur.value += v;
    byVendor.set(k, cur);
  }
  const vendors = [...byVendor.values()].sort((a, b) => b.value - a.value).slice(0, top)
    .map(v => ({ ...v, value: round2(v.value), share: total ? Math.round((1000 * v.value) / total) / 10 : 0 }));
  return { total: round2(total), vendors, topShare: total ? Math.round((1000 * vendors.reduce((s, v) => s + v.value, 0)) / total) / 10 : null };
}

// POs that needed a vendor selection exception, per reason.
export function exceptionsByReason(pos) {
  const counts = {};
  let withException = 0;
  for (const po of pos) {
    const reasons = po.selectionCheck?.exceptionReasons || [];
    if (!reasons.length) continue;
    withException += 1;
    for (const r of reasons) counts[r] = (counts[r] || 0) + 1;
  }
  return { withException, byReason: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })) };
}

// ── Loaders ──────────────────────────────────────────────────────────────────

async function loadPOs(cid) {
  return Purchase.find({ companyId: cid })
    .select('purchaseOrderNumber supplier createdBy status orderDate createdAt updatedAt grandTotal selectionCheck items deliveryClock expectedDeliveryDate cancellations approval')
    .populate('supplier', 'supplierName')
    .populate('items.purchaseRequests', 'status')
    .populate('items.purchaseRequest', 'status')
    .lean();
}

// The "work to do" tiles — for one person (`userId`) or the whole team (null).
async function workTiles({ cid, pos, userId, now, settings }) {
  const mine = (uid) => !userId || String(uid) === String(userId);
  const myPos = pos.filter(p => mine(p.createdBy));
  const poById = new Map(pos.map(p => [String(p._id), p]));

  // Items to buy (team-wide — requests aren't assigned to a person).
  const itemsToBuy = await ItemQuoteGroup.countDocuments({ companyId: cid, status: 'Open', 'purchaseRequests.0': { $exists: true } });

  // Quotation requests.
  const qrs = await QuotationRequest.find({ companyId: cid, ...(userId ? { createdBy: userId } : {}) })
    .select('status emailStatus sentAt tokenExpiry submittedAt createdBy').lean();
  const waiting = qrs.filter(q => q.status === 'Sent' && q.emailStatus !== 'Failed' && !q.submittedAt && new Date(q.tokenExpiry) > now);
  const noReply = waiting.filter(q => new Date(q.sentAt).getTime() <= now.getTime() - NO_REPLY_DAYS * DAY);
  const ranOut = qrs.filter(q => !q.submittedAt && q.emailStatus !== 'Failed' && ['Sent', 'Expired'].includes(q.status)
    && new Date(q.tokenExpiry) <= now && new Date(q.tokenExpiry).getTime() > now.getTime() - RECENT_DAYS * DAY);

  // Quotes expiring soon: priced, on an open card, mine by who asked / entered it.
  const openGroups = await ItemQuoteGroup.find({ companyId: cid, status: 'Open' }).select('_id').lean();
  let expiring = 0;
  if (openGroups.length) {
    const bids = await VendorBid.find({ group: { $in: openGroups.map(g => g._id) }, status: 'Submitted' })
      .select('submittedAt createdAt quotationRequest manualQuotation').lean();
    let owner = null;
    if (userId) {
      const [qOwn, mOwn] = await Promise.all([
        QuotationRequest.find({ _id: { $in: bids.map(b => b.quotationRequest).filter(Boolean) } }).select('createdBy').lean(),
        ManualQuotation.find({ _id: { $in: bids.map(b => b.manualQuotation).filter(Boolean) } }).select('createdBy').lean(),
      ]);
      owner = new Map([...qOwn, ...mOwn].map(x => [String(x._id), String(x.createdBy || '')]));
    }
    const days = Number(settings?.quoteValidityDays) || 30;
    for (const b of bids) {
      if (owner) {
        const by = owner.get(String(b.quotationRequest || b.manualQuotation || ''));
        if (by !== String(userId)) continue;
      }
      const until = quoteValidUntil(b, days);
      if (!until || until < now) continue;
      const left = Math.round((startOfDay(until) - startOfDay(now)) / DAY);
      if (left <= EXPIRY_WARN_DAYS) expiring += 1;
    }
  }

  // POs.
  const pendingApproval = myPos.filter(p => p.status === 'Pending Approval').length;
  const rejectedRecent = myPos.filter(p => p.status === 'Rejected' && new Date(p.updatedAt).getTime() >= now.getTime() - RECENT_DAYS * DAY).length;
  const notEmailed = myPos.filter(p => p.status === 'Draft').length;

  // Deliveries on open POs (lines waiting for the advance have no date).
  const deliveries = { overdue: 0, today: 0, soon: 0 };
  for (const po of myPos.filter(p => OPEN_PO_STATUSES.includes(p.status))) {
    for (const line of po.items || []) {
      const b = lineDueBucket(line, po, lineIsReceived, now);
      if (b && b.bucket in deliveries) deliveries[b.bucket] += 1;
    }
  }

  // QC rejections on these POs.
  const rejections = await PurchaseRejection.find({ companyId: cid, status: { $in: ['Awaiting vendor answer', 'Replacement expected'] } })
    .select('purchaseOrder status createdAt').lean();
  const ours = rejections.filter(r => { const po = poById.get(String(r.purchaseOrder)); return po && mine(po.createdBy); });
  const awaiting = ours.filter(r => r.status === 'Awaiting vendor answer');

  return {
    itemsToBuy,
    quoteRequests: { waiting: waiting.length, noReply: noReply.length, ranOut: ranOut.length },
    quotesExpiring: expiring,
    pos: { pendingApproval, rejectedRecent, notEmailed },
    deliveries,
    rejections: {
      awaiting: awaiting.length,
      awaitingLong: awaiting.filter(r => new Date(r.createdAt).getTime() <= now.getTime() - REJECTION_LONG_DAYS * DAY).length,
      replacements: ours.filter(r => r.status === 'Replacement expected').length,
    },
  };
}

function weakestPart(parts) {
  const list = Object.entries(parts || {}).filter(([, p]) => p?.pct != null).sort((a, b) => a[1].pct - b[1].pct);
  return list.length ? { part: list[0][0], label: P_PART_LABELS[list[0][0]], pct: list[0][1].pct } : null;
}

async function scoreRows(cid, settings, userIds = null, now) {
  const scores = await computePurchaserScores({ companyId: cid, userIds, settings, now });
  const users = await mongoose.model('User').find({ _id: { $in: [...scores.keys()] } }).select('fullName username role').lean();
  const names = new Map(users.map(u => [String(u._id), { name: u.fullName || u.username || 'User', role: u.role || '' }]));
  return [...scores.entries()].map(([userId, s]) => ({
    userId, ...(names.get(userId) || { name: 'User', role: '' }),
    month: s.month.score, rolling: s.rolling.score, limitedHistory: s.month.limitedHistory, weakest: weakestPart(s.rolling.parts),
  })).sort((a, b) => (b.month ?? -1) - (a.month ?? -1));
}

async function moneyTiles(cid, now) {
  const [bills, refunds] = await Promise.all([
    PurchaseInvoice.find({ companyId: cid, status: { $ne: 'Cancelled' } })
      .select('purchaseOrder status totalAmount paidAmount advanceAmount advancePaid advancePercent acceptedValue fullyAcceptedAt dueDate').lean(),
    VendorMoneyBack.find({ companyId: cid, status: 'Refund due' }).select('amount').lean(),
  ]);
  const out = { advanceDue: 0, payableNow: 0, owedNow: 0, overdue: 0, overdueBills: 0, refundsDue: round2(refunds.reduce((s, r) => s + (Number(r.amount) || 0), 0)), refundsCount: refunds.length };
  for (const b of bills) {
    const o = owedNow(b, now);
    out.advanceDue += o.advance;
    out.payableNow += o.material;
    out.owedNow += o.owed;
    if (o.overdue > 0) { out.overdue += o.overdue; out.overdueBills += 1; }
  }
  for (const k of ['advanceDue', 'payableNow', 'owedNow', 'overdue']) out[k] = round2(out[k]);
  return out;
}

async function vendorTiles(cid) {
  const vendors = await Supplier.find({ companyId: cid }).select('supplierName approvalStatus riskClass').lean();
  const approved = vendors.filter(v => v.approvalStatus === 'Approved');
  const standing = await getVendorStanding(cid, approved);
  const rows = approved.map(v => ({ vendorId: String(v._id), name: v.supplierName, ...(standing.get(String(v._id)) || {}) }));
  return {
    watchlist: rows.filter(r => r.stage === 'Watchlist').map(r => ({ vendorId: r.vendorId, name: r.name, reason: r.watchReason, score: r.score ?? null })),
    probationary: rows.filter(r => r.stage === 'Probationary').length,
    highRisk: approved.filter(v => v.riskClass === 'High').length,
    suspended: vendors.filter(v => ['Suspended', 'Blacklisted'].includes(v.approvalStatus)).length,
    lowest: rows.filter(r => r.score != null).sort((a, b) => a.score - b.score).slice(0, 3).map(r => ({ vendorId: r.vendorId, name: r.name, score: r.score, limitedHistory: !!r.limitedHistory })),
  };
}

// Price rises: PO lines priced above that vendor's last delivered price (before this PO) by ≥ warn %.
async function priceRises(cid, pos, warnPercent) {
  const itemIds = [...new Set(pos.flatMap(p => (p.items || []).map(l => (l.item ? String(l.item) : null)).filter(Boolean)))];
  if (!itemIds.length) return { lines: 0, extra: 0, examples: [] };
  const samples = await loadPriceSamples({ companyId: cid, itemIds });
  const out = { lines: 0, extra: 0, examples: [] };
  for (const po of pos) {
    for (const l of po.items || []) {
      if (!l.item || l.cancelled?.at || !(Number(l.unitPrice) > 0)) continue;
      const price = exGstPrice(l.unitPrice, l.gstInclusive, l.gstRate);
      const unit = String(l.purchaseUnit || '').trim().toLowerCase();
      const before = (samples.get(String(l.item)) || []).filter(s => s.vendorId === idOf(po.supplier) && s.purchaseId !== String(po._id)
        && new Date(s.date) < new Date(poDate(po)) && String(s.unit || '').trim().toLowerCase() === unit);
      if (!before.length) continue;
      const last = before[0].price;   // newest first
      const change = priceChangePercent(price, last);
      if (change == null || change < (Number(warnPercent) || 10)) continue;
      const extra = (price - last) * (Number(l.quantity) || 0);
      out.lines += 1;
      out.extra += extra;
      if (out.examples.length < 5) out.examples.push({ poNumber: po.purchaseOrderNumber, item: l.itemName, vendor: po.supplier?.supplierName || '', price: round2(price), last: round2(last), change });
    }
  }
  out.extra = round2(out.extra);
  return out;
}

// ── The three views ──────────────────────────────────────────────────────────

export async function buildDashboard({ companyId, view, userId, period = 'month', now = new Date(), settings }) {
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const pos = await loadPOs(cid);

  if (view === 'mine') {
    const work = await workTiles({ cid, pos, userId, now, settings });
    const me = (await scoreRows(cid, settings, [String(userId)], now))[0] || null;
    return { view, work, myScore: me };
  }

  if (view === 'head') {
    const month = periodRange('month', now);
    const realThisMonth = pos.filter(p => !NOT_REAL.includes(p.status) && inRange(poDate(p), month));
    const [work, money, vendors, team, qcWaiting, claims] = await Promise.all([
      workTiles({ cid, pos, userId: null, now, settings }),
      moneyTiles(cid, now),
      vendorTiles(cid),
      scoreRows(cid, settings, null, now),
      // One per received line still in QC (QC by PO line, 2026-10-15).
      QCJob.countDocuments({ company: cid, source: 'Purchase', groupMember: { $ne: true }, $or: [{ lineStatus: { $in: ['Pending', 'In Progress'] } }, { lineStatus: null, status: { $in: ['Pending', 'In Progress'] } }] }),
      VendorWarrantyClaim.find({ companyId: cid, status: { $ne: 'Closed' } }).select('reportedToVendorAt').lean(),
    ]);
    return {
      view, work, money, vendors, team,
      approvals: {
        poPending: pos.filter(p => p.status === 'Pending Approval').length,
        cancelRequests: pos.filter(p => (p.cancellations || []).some(c => c.status === 'Requested')).length,
      },
      compliance: complianceOf(realThisMonth),
      store: { dueToday: work.deliveries.today, overdue: work.deliveries.overdue, awaitingQc: qcWaiting },
      claims: { open: claims.length, waitingLong: claims.filter(c => new Date(c.reportedToVendorAt).getTime() <= now.getTime() - CLAIM_LONG_DAYS * DAY).length },
    };
  }

  // admin
  const range = periodRange(period, now);
  const real = pos.filter(p => !NOT_REAL.includes(p.status));
  const realIn = real.filter(p => inRange(poDate(p), range));
  const pending = pos.filter(p => p.status === 'Pending Approval');
  const [vendorRequests, money, vendors, scores, rises] = await Promise.all([
    VendorApprovalRequest.find({ companyId: cid, status: 'Pending' }).select('type').lean(),
    moneyTiles(cid, now),
    vendorTiles(cid),
    scoreRows(cid, settings, null, now),
    priceRises(cid, realIn, settings?.priceJumpWarnPercent),
  ]);
  const byType = {};
  for (const r of vendorRequests) byType[r.type] = (byType[r.type] || 0) + 1;
  const trend = [5, 4, 3, 2, 1, 0].map(i => {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const value = real.filter(p => { const t = new Date(poDate(p)).getTime(); return t >= start.getTime() && t < end.getTime(); })
      .reduce((s, p) => s + (Number(p.grandTotal) || 0), 0);
    return { month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, value: round2(value) };
  });
  const conc = concentration(realIn);
  return {
    view, period: range.key,
    approvals: {
      poPending: pending.length,
      overLimit: pending.filter(p => (p.approval?.reasons || []).includes('threshold') || !(p.approval?.reasons || []).length).length,
      selection: pending.filter(p => (p.approval?.reasons || []).includes('selection')).length,
      charges: pending.filter(p => (p.approval?.reasons || []).includes('charges')).length,
      cancelRequests: pos.filter(p => (p.cancellations || []).some(c => c.status === 'Requested')).length,
      vendorRequests: byType,
      vendorRequestsTotal: vendorRequests.length,
    },
    purchaseValue: { total: conc.total, pos: realIn.length, trend },
    savings: savingsOf(realIn),
    priceRises: rises,
    concentration: conc,
    compliance: complianceOf(realIn),
    exceptions: exceptionsByReason(realIn),
    vendors,
    money,
    scores,
  };
}
