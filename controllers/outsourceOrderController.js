// Outsource Orders (outsource-v2 slice 2, 2026-10-20 — server/docs/outsource-v2/
// slice-2-outsource-order-plan.md). Purchase picks outsource requests (job-work
// orders and hand-offs — services/outsourceRequestService.js), then a vendor,
// and orders the next step(s) at a price per piece; GST and charges are typed
// here (no quotation). Making the order claims each request's trip (an
// 'Ordered' round); above the Company Admin's outsourceApprovalThreshold it
// waits for approval. The trip is then sent (Mark sent, per line) and
// received (per request) through the order — until Dispatch and Store take
// those over.
import OutsourceOrder from '../models/OutsourceOrder.js';
import Supplier from '../models/Supplier.js';
import { Company } from '../models/Company.js';
import notificationService from '../services/notificationService.js';
import { ELIGIBLE_VENDOR_FILTER, eligibleVendorError, getVendorStanding } from '../services/vendorApprovalService.js';
import { gstSplitFor } from '../services/gstStateService.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import { cleanPoCharges, cleanPaymentTerms } from './purchaseController.js';
import { HttpError } from '../services/subChildPartMaterialSendService.js';
import { Item } from '../models/Inventory.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import { payableNow } from '../services/purchaseBillService.js';
import { createOutsourceBill, cancelOutsourceBill, recordTripQc, refreshAcceptance, billSummary, billRowsForLine } from '../services/outsourceBillService.js';
import { buildOrderPlans, previewRequestStoreRows } from '../services/outsourceMaterialPlanService.js';
import { materialShortfall, shortText } from '../services/outsourceMaterialReadyService.js';
import { PRICE_TYPES, priceTypeOf, isTimeType, computeLine, computeOrderTotals, priceBasis, timeText } from '../services/outsourcePricingService.js';
import {
  listRequests, listDoneRequests, RecordSet, parseRequestKey, requestKey, normStep, stepsKey,
  claimRound, releaseRound, sendRound, receiveRound,
} from '../services/outsourceRequestService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n) => `₹${round2(n).toLocaleString('en-IN')}`;
const userName = (u) => u?.fullName || u?.username || '';
// Statuses where the order is a real, approved order.
const LIVE = ['Open', 'With vendor', 'Partly received', 'Received'];
// Orders that count for price history / cost pre-fill.
const PRICED = ['Pending Approval', ...LIVE];

function sendError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message, ...(err.confirmWarnings ? { data: { confirmWarnings: err.confirmWarnings } } : {}) });
  console.error('[OutsourceOrder]', err);
  return res.status(500).json({ success: false, message: err.message });
}

function logActivity(order, user, action, summary) {
  order.activity.push({ at: new Date(), by: user?._id || null, byName: userName(user), action, summary });
}

// Open → With vendor → Partly received → Received, from the requests.
// Pending Approval / Rejected / Cancelled are set explicitly, never derived.
export function deriveStatus(order) {
  if (['Pending Approval', 'Rejected', 'Cancelled'].includes(order.status)) return order.status;
  const reqs = order.lines.flatMap(l => l.requests).filter(r => r.status !== 'Released');
  if (!reqs.length) return order.status;
  if (reqs.every(r => r.status === 'Received')) return 'Received';
  if (reqs.some(r => r.status === 'Received')) return 'Partly received';
  if (reqs.some(r => r.status === 'Sent')) return 'With vendor';
  return 'Open';
}

async function nextOrderNo(companyId) {
  const rows = await OutsourceOrder.find({ company: companyId }).select('orderNo').lean();
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.orderNo).replace(/^OSO-/, '')) || 0), 0);
  return `OSO-${String(max + 1).padStart(4, '0')}`;
}

const vendorServiceSet = (vendor) => new Set((vendor?.services || []).map(normStep));
const missingSteps = (vendor, steps) => {
  const have = vendorServiceSet(vendor);
  return [...new Set(steps)].filter(s => !have.has(normStep(s)));
};

// ── Requests, vendors, price help ─────────────────────────────────────────

// GET /api/outsource-work/requests?search=&orderKind=&vendor=&includeDone=
// Every outsource request with Purchase. With a vendor: only the requests
// that are ready AND whose next step that vendor's Services cover.
export const getRequests = async (req, res) => {
  try {
    const { search = '', orderKind = '', vendor, includeDone } = req.query;
    let views = await listRequests(req.user.companyId, { search: String(search).trim(), orderKind, includeDone: includeDone === 'true' });
    if (vendor) {
      const v = await Supplier.findOne({ _id: vendor, companyId: req.user.companyId }).select('services').lean();
      const have = vendorServiceSet(v);
      views = views.filter(x => x.ready && x.stepsLeft.length && have.has(normStep(x.stepsLeft[0])));
    }
    // Sorted: ready first, then the newest.
    views.sort((a, b) => (Number(b.ready) - Number(a.ready)) || (new Date(b.createdAt) - new Date(a.createdAt)));
    // Which Outsource Order holds each open trip.
    const orderIds = [...new Set(views.map(v => v.openTrip?.outsourceOrder).filter(Boolean).map(String))];
    const orders = orderIds.length ? await OutsourceOrder.find({ _id: { $in: orderIds } }).select('orderNo vendorName status').lean() : [];
    const byId = new Map(orders.map(o => [String(o._id), o]));
    for (const v of views) {
      const o = v.openTrip?.outsourceOrder ? byId.get(String(v.openTrip.outsourceOrder)) : null;
      if (o) v.openTrip.order = { _id: o._id, orderNo: o.orderNo, vendorName: o.vendorName, status: o.status };
    }
    // Ready requests: is what Store must hand over for them in stock yet?
    // (2026-10-23 — e.g. a Child Part whose Sub Child Parts are still being made.)
    const records = new RecordSet(req.user.companyId);
    for (const v of views.filter(x => x.ready)) {
      try {
        const ref = parseRequestKey(v.key);
        const short = await materialShortfall(req.user.companyId, [{ productionOrder: ref.productionOrder, materialPlan: await previewRequestStoreRows(req.user.companyId, records, ref, v) }]);
        if (short.length) { v.materialShort = short; v.materialWarning = shortText(short); }
      } catch (e) { /* no warning rather than no list */ }
    }
    res.json({ success: true, data: views });
  } catch (err) { sendError(res, err); }
};

// GET /api/outsource-work/requests/done?search=&orderKind=&page=&limit= —
// finished requests, paged on the server (In progress → "Show done", 2026-10-23).
export const getDoneRequests = async (req, res) => {
  try {
    const { search = '', orderKind = '', page, limit } = req.query;
    const { data, pagination } = await listDoneRequests(req.user.companyId, { search: String(search).trim(), orderKind, page, limit });
    res.json({ success: true, data, pagination });
  } catch (err) { sendError(res, err); }
};

// GET /api/outsource-work/vendors?steps=welding|grinding&all=true
// Approved + active vendors, each with which of these steps its Services
// don't cover, its standing, and the GST type an order with it would get.
// Without all=true only the vendors covering every step.
export const getVendorsForSteps = async (req, res) => {
  try {
    const steps = String(req.query.steps || '').split('|').map(s => s.trim()).filter(Boolean);
    const vendors = await Supplier.find({ companyId: req.user.companyId, ...ELIGIBLE_VENDOR_FILTER })
      .select('supplierName supplierCode services gstNumber address approvalStatus status').sort({ supplierName: 1 });
    const company = await Company.findById(req.user.companyId).select('gst state').lean();
    let standing = new Map();
    try { standing = await getVendorStanding(req.user.companyId, vendors); } catch (e) { console.error('vendor standing:', e); }
    let rows = vendors.map(v => {
      const missing = missingSteps(v, steps);
      const split = gstSplitFor({ ourGstin: company?.gst, ourState: company?.state, theirGstin: v.gstNumber, theirState: v.address?.state });
      return {
        _id: v._id, supplierName: v.supplierName, supplierCode: v.supplierCode,
        covers: missing.length === 0, missing,
        stage: standing.get(String(v._id))?.stage || 'Active',
        gstType: split.type, gstMissing: split.missing || null,
      };
    });
    if (req.query.all !== 'true') rows = rows.filter(r => r.covers);
    rows.sort((a, b) => (Number(b.covers) - Number(a.covers)) || a.supplierName.localeCompare(b.supplierName));
    res.json({ success: true, data: rows });
  } catch (err) { sendError(res, err); }
};

// The price per piece paid before for this part + these steps (non-cancelled,
// non-rejected orders) — last, average, and this vendor's last.
// Earlier prices for this part: for the whole set of steps, and (2026-10-21)
// for each step on its own — from lines' per-step prices, or a single-step
// line's price.
const summarise = (samples, vendorId) => {
  if (!samples.length) return { count: 0, last: null, average: null, vendorLast: null };
  const vendorSample = vendorId ? samples.find(s => String(s.vendor) === String(vendorId)) : null;
  return {
    count: samples.length,
    last: samples[0],
    average: round2(samples.reduce((s, x) => s + x.rate, 0) / samples.length),
    vendorLast: vendorSample || null,
  };
};

// `before` (2026-10-23): only orders made before this date, never `excludeOrderId`
// — the approvals card's "Paid before" used to count the order being reviewed.
async function priceHistory(companyId, itemId, steps, vendorId, { before = null, excludeOrderId = null } = {}) {
  const key = stepsKey(steps);
  const q = { company: companyId, status: { $in: PRICED }, 'lines.item': itemId };
  if (before) q.createdAt = { $lt: new Date(before) };
  if (excludeOrderId) q._id = { $ne: excludeOrderId };
  const orders = await OutsourceOrder.find(q)
    .select('orderNo vendor vendorName createdAt lines.item lines.stepNames lines.ratePerPiece lines.stepRates').sort({ createdAt: -1 }).lean();
  // Per step AND price type (2026-10-22, R8): a per-hour rate is never
  // averaged with a per-piece one. byStep[s] stays the per-piece history.
  const byStepType = Object.fromEntries(steps.map(s => [s, Object.fromEntries(PRICE_TYPES.map(t => [t, []]))]));
  for (const o of orders) {
    for (const l of o.lines) {
      if (String(l.item) !== String(itemId)) continue;
      const rates = l.stepRates?.length ? l.stepRates : (l.stepNames.length === 1 ? [{ step: l.stepNames[0], rate: l.ratePerPiece }] : []);
      for (const s of steps) {
        const hit = rates.find(x => normStep(x.step) === normStep(s));
        if (hit) byStepType[s][priceTypeOf(hit)].push({ orderNo: o.orderNo, vendor: o.vendor, vendorName: o.vendorName, at: o.createdAt, rate: hit.rate, type: priceTypeOf(hit), operationName: hit.operationName || '' });
      }
    }
  }
  const byStep = Object.fromEntries(steps.map(s => [s, byStepType[s].piece]));
  const samples = [];
  for (const o of orders) {
    for (const l of o.lines) {
      if (String(l.item) === String(itemId) && stepsKey(l.stepNames) === key) {
        samples.push({ orderNo: o.orderNo, vendor: o.vendor, vendorName: o.vendorName, at: o.createdAt, rate: l.ratePerPiece });
      }
    }
  }
  return {
    ...summarise(samples, vendorId),
    byStep: Object.fromEntries(Object.entries(byStep).map(([s, list]) => [s, summarise(list, vendorId)])),
    byStepType: Object.fromEntries(Object.entries(byStepType).map(([s, types]) => [s, Object.fromEntries(Object.entries(types).map(([t, list]) => [t, summarise(list, vendorId)]))])),
  };
}

// GET /api/outsource-work/price-history?item=&steps=a|b&vendor=
export const getPriceHistory = async (req, res) => {
  try {
    const steps = String(req.query.steps || '').split('|').map(s => s.trim()).filter(Boolean);
    if (!req.query.item || !steps.length) return res.status(400).json({ success: false, message: 'item and steps are required.' });
    res.json({ success: true, data: await priceHistory(req.user.companyId, req.query.item, steps, req.query.vendor) });
  } catch (err) { sendError(res, err); }
};

// ── Building an order (create, and edit after a rejection) ────────────────

// Reads and checks the body against the LIVE requests. Returns the lines
// (with their request refs) and the vendor. Throws HttpError.
async function readOrderBody(body, records, companyId) {
  const vendor = await Supplier.findOne({ _id: body.vendor, companyId });
  const notEligible = eligibleVendorError(vendor);
  if (notEligible) throw new HttpError(400, notEligible);

  const linesIn = Array.isArray(body.lines) ? body.lines : [];
  if (!linesIn.length) throw new HttpError(400, 'Add at least one line.');
  const seenKeys = new Set();
  const lines = [];
  for (const [n, li] of linesIn.entries()) {
    const label = `Line ${n + 1}`;
    const keys = Array.isArray(li.requests) ? li.requests : [];
    if (!keys.length) throw new HttpError(400, `${label}: pick at least one request.`);
    const stepCount = Math.round(Number(li.stepCount));
    let item = null; let steps = null; let qty = 0; let qtyUnit = null; let orderKind = null; let itemCode = ''; let itemName = '';
    const refs = [];
    for (const key of keys) {
      const ref = parseRequestKey(key);
      if (!ref) throw new HttpError(400, `${label}: unknown request ${key}.`);
      const k = requestKey(ref);
      if (seenKeys.has(k)) throw new HttpError(400, `${label}: a request is on this order twice.`);
      seenKeys.add(k);
      const view = await records.view(ref);
      if (!view.ready) throw new HttpError(400, `${view.orderCode} (${view.itemName}) isn't ready to order — ${view.waiting || 'nothing left to send'}.`);
      if (!(stepCount >= 1 && stepCount <= view.stepsLeft.length)) {
        throw new HttpError(400, `${label}: ${view.orderCode} has ${view.stepsLeft.length} step(s) left — pick between 1 and ${view.stepsLeft.length}.`);
      }
      const next = view.stepsLeft.slice(0, stepCount);
      if (!item) {
        item = view.item; steps = next; qtyUnit = view.qtyUnit; orderKind = view.orderKind;
        itemCode = view.itemCode; itemName = view.itemName;
      } else if (String(view.item) !== String(item) || stepsKey(next) !== stepsKey(steps)) {
        throw new HttpError(400, `${label}: ${view.orderCode} is a different part or has different next steps — put it on its own line.`);
      }
      if (!item) throw new HttpError(400, `${label}: ${view.orderCode} has no item to order.`);
      qty += Number(view.qty) || 0;
      refs.push({
        ref,
        doc: {
          kind: ref.kind,
          jobWorkOrder: ref.kind === 'jobWork' ? ref.jobWorkOrder : null,
          productionOrder: ref.kind === 'handoff' ? ref.productionOrder : null,
          handoffId: ref.kind === 'handoff' ? ref.handoffId : null,
          orderCode: view.orderCode,
          stepIndices: ref.kind === 'handoff'
            ? next.map(s => view.stepIndices[view.steps.indexOf(s)])
            : [],
          qty: Number(view.qty) || 0,
          status: 'Ordered',
        },
      });
    }
    // A price per step (stepRates, in step order), each priced its own way
    // (pricing types, 2026-10-22 — services/outsourcePricingService.js):
    // { type, rate } per step; a bare number = per piece (older pages); a
    // single combined ratePerPiece is still accepted (one per-piece step
    // price for the whole line).
    let stepRates = null;
    if (Array.isArray(li.stepRates)) {
      if (li.stepRates.length !== steps.length) throw new HttpError(400, `${label}: enter a price for each step (${steps.join(', ')}).`);
      stepRates = [];
      for (const [k, s] of steps.entries()) {
        const v = li.stepRates[k];
        const obj = v && typeof v === 'object';
        const type = obj && v.type != null ? v.type : 'piece';
        if (!PRICE_TYPES.includes(type)) throw new HttpError(400, `${label}: unknown price type for ${s}.`);
        const raw = obj ? v.rate : v;
        const n = Number(raw);
        if (raw === '' || raw == null || !(n >= 0)) throw new HttpError(400, `${label}: enter the price for ${s} (0 is allowed).`);
        const sr = { step: s, type, rate: round2(n) };
        if (type === 'operation') {
          // Per job work — only for a step whose BOM says how many operations a piece needs (R3).
          const op = await records.stepOperation(refs[0].ref, s);
          if (!op) throw new HttpError(400, `${label}: ${s} can't be priced per operation — its BOM step has no "operations per piece". Pick another price type, or add the count in the BOM.`);
          sr.operationsPerPiece = op.perPiece;
          sr.operationName = op.name;
        }
        stepRates.push(sr);
      }
    } else {
      const rate = Number(li.ratePerPiece);
      if (!(rate >= 0) || li.ratePerPiece === '' || li.ratePerPiece == null) throw new HttpError(400, `${label}: enter the price per piece (0 is allowed).`);
      // One per-piece price for the whole line (the older shape): one
      // combined step price, so the bill keeps one row for the line.
      stepRates = [{ step: steps.join(' › '), type: 'piece', rate: round2(rate) }];
    }
    const gst = Number(li.gstPercent ?? 0);
    if (!(gst >= 0 && gst <= 100)) throw new HttpError(400, `${label}: GST % must be between 0 and 100.`);
    // Expected back can't be in the past (2026-10-23). Compared by calendar
    // day (server time), so today itself is fine.
    if (li.expectedBy) {
      const d = new Date(li.expectedBy);
      if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label}: the expected-back date isn't a valid date.`);
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const day = new Date(d); day.setHours(23, 59, 59, 999);
      if (day < startOfToday) throw new HttpError(400, `${label}: the expected-back date can't be in the past.`);
    }
    const line = computeLine({
      item, itemCode, itemName, orderKind, stepNames: steps, qty, qtyUnit, gstPercent: gst, stepRates,
      expectedBy: li.expectedBy ? new Date(li.expectedBy) : null,
    });
    lines.push({ ...line, _refs: refs });
  }

  // The vendor's Services must cover every step (D1), unless "show all".
  if (body.showAllVendors !== true) {
    const missing = missingSteps(vendor, lines.flatMap(l => l.stepNames));
    if (missing.length) throw new HttpError(400, `${vendor.supplierName}'s Services don't include ${missing.join(', ')}. Pick another vendor, or tick "show all vendors".`);
  }
  return { vendor, lines };
}

// Transport is always ours on outsource work — Dispatch arranges every trip
// and a hired vehicle's freight is recorded on the trip (2026-10-21, user).
// So a vendor can't charge it on an Outsource Order: a charge name ticked
// "Transport" in Purchase Settings, or one that plainly is (transport /
// freight / cartage…), is refused.
const TRANSPORT_WORDS = /\b(transport|transportation|freight|cartage|carriage|shipping|delivery)\b/i;
async function assertNoTransportCharge(companyId, charges) {
  const list = Array.isArray(charges) ? charges.filter(c => String(c?.label || '').trim()) : [];
  if (!list.length) return;
  const settings = await getOrCreateSettings(companyId);
  const flagged = new Set((settings.chargeLabels || []).filter(c => c.isTransport).map(c => c.name.trim().toLowerCase()));
  const bad = list.map(c => String(c.label).trim()).filter(n => flagged.has(n.toLowerCase()) || TRANSPORT_WORDS.test(n));
  if (bad.length) throw new HttpError(400, `${[...new Set(bad)].join(', ')} can't be charged by the vendor — outsource transport is ours: Dispatch arranges the trip and records any freight on it.`);
}

function applyTotals(order, lines, body) {
  const charges = cleanPoCharges(body.charges);
  order.lines = lines.map(({ _refs, ...l }) => l);
  order.charges = charges.map(c => ({ label: c.label, amount: c.amount, gstPercent: c.gstPercent, gstAmount: c.gstAmount }));
  computeOrderTotals(order); // the known amounts — a time-based step adds nothing yet
  order.paymentTerms = cleanOutsourceTerms(body.paymentTerms, order);
  order.notes = String(body.notes || '').trim();
}

// Payment terms (2026-10-22): the advance is a % of the known total, or a
// flat amount — only flat when nothing is known yet (every step is time-
// based). The PO's own cleaner is left as it is.
function cleanOutsourceTerms(raw, order) {
  const t = cleanPaymentTerms(raw);
  const known = Number(order.grandTotal) || 0;
  const advanceType = raw?.advanceType === 'flat' ? 'flat' : 'percent';
  if (advanceType === 'flat') {
    const flat = raw?.advanceFlat === '' || raw?.advanceFlat == null ? null : Number(raw.advanceFlat);
    if (flat != null && !(flat >= 0)) throw new HttpError(400, 'The flat advance must be an amount of 0 or more.');
    if (flat != null && known > 0 && flat > known + 0.005) throw new HttpError(400, `The flat advance can't be more than the order's known total (₹${known}).`);
    return { ...t, advanceType, advanceFlat: flat != null ? round2(flat) : null, advancePercent: null };
  }
  if (known <= 0 && Number(t.advancePercent) > 0) {
    throw new HttpError(400, 'Every step is priced per minute / per hour, so nothing is known yet — give the advance as a flat amount instead of a %.');
  }
  return { ...t, advanceType, advanceFlat: null };
}

// Claims every request's trip; on any failure, frees what was claimed.
async function claimAll(order, lines, records) {
  for (const [i, l] of lines.entries()) {
    const line = order.lines[i];
    line.requests = [];
    for (const { ref, doc } of l._refs) {
      const round = await claimRound(records, ref, l.stepNames, { outsourceOrderId: order._id, lineId: line._id });
      line.requests.push({ ...doc, roundId: round._id });
    }
  }
}

// Slice 5 — each request's material plan (Production first, the rest from
// Store; sheet / length combined per line). Production's open requests beyond
// the new limit are trimmed, and said so in the order's history.
async function planMaterial(order, records, user) {
  const { trimmed } = await buildOrderPlans(order, records, user.companyId);
  if (trimmed.length) logActivity(order, user, 'material', `Production's open material requests trimmed — that part goes to the vendor straight from Store: ${trimmed.join('; ')}.`);
}

// Approval, once, when the order is made (R5, 2026-10-22): the KNOWN total
// above the limit, or — with the admin's "approve time-based" setting on —
// any order with a per minute / per hour step (its rate is checked). Entering
// the time later only notifies the admin.
// Material Store has to hand over that isn't in stock yet (2026-10-23): the
// order may still be made — Purchase books the vendor early — but only with
// body.acknowledgeMaterialNotReady (the "order anyway" tick), and the history
// says so. Dispatch then can't send the line until it's all in stock.
async function materialReadyCheck(order, body, user) {
  const notes = [];
  for (const l of order.lines) {
    const short = await materialShortfall(order.company, l.requests, { orderId: order._id });
    if (short.length) notes.push(`${l.itemName}: ${short.map(s => s.text).join(', ')}`);
  }
  if (!notes.length) return;
  if (body.acknowledgeMaterialNotReady !== true) {
    throw new HttpError(400, `Material not ready — ${notes.join('; ')}. The vendor can't get this work until it's ready (Dispatch sends it then). Tick "order anyway" to go ahead.`);
  }
  logActivity(order, user, 'material', `Ordered while material isn't ready — ${notes.join('; ')}. Dispatch sends it once it's ready.`);
}

async function approvalFor(order, user) {
  const settings = await getOrCreateSettings(order.company);
  const threshold = settings.outsourceApprovalThreshold;
  const reasons = [];
  if (threshold != null && order.grandTotal > Number(threshold)) reasons.push('limit');
  if (order.hasTimeBased && settings.approveTimeBasedOutsource) reasons.push('time');
  const needs = reasons.length > 0;
  order.approval = needs
    ? { required: true, threshold: threshold != null ? Number(threshold) : null, decision: 'Pending', requestedBy: user._id, requestedAt: new Date(), reasons }
    : { required: false, threshold: threshold != null ? Number(threshold) : null, decision: null, reasons: [] };
  order.status = needs ? 'Pending Approval' : 'Open';
  return { needs, threshold, reasons };
}

// Why the order waits for the Company Admin, in words — the limit, a time
// rate to check, or both (2026-10-23: the history always said "above the limit").
function approvalWhy(order, threshold) {
  const reasons = order.approval?.reasons || [];
  return [reasons.includes('limit') && `above the ${inr(threshold)} limit`, reasons.includes('time') && 'a per minute / per hour rate to check'].filter(Boolean).join('; ');
}

async function notifyAdmin(order, needs, threshold) {
  const why = approvalWhy(order, threshold);
  try {
    await notificationService.createNotification({
      title: needs ? 'Outsource order waiting for your approval' : 'Outsource order created',
      message: `${order.orderNo} — ${order.vendorName} — ${inr(order.grandTotal)}${order.hasTimeBased ? ' + time-based steps (entered later)' : ''}${needs ? ` (${why})` : threshold != null ? ` (within the ${inr(threshold)} limit)` : ''}`,
      type: 'purchase',
      targetRole: 'Company Admin',
      targetCompanyId: order.company,
      data: { outsourceOrderId: String(order._id), orderNo: order.orderNo, outsourceApproval: needs },
    });
  } catch (e) { console.error('[OutsourceOrder] notify admin:', e); }
}

// POST /api/outsource-work/outsource-orders
// body: { vendor, showAllVendors, gstType, lines: [{ requests: [requestKey],
//   stepCount, ratePerPiece, gstPercent, expectedBy }], charges, paymentTerms, notes }
export const createOutsourceOrder = async (req, res) => {
  const records = new RecordSet(req.user.companyId);
  try {
    const { vendor, lines } = await readOrderBody(req.body, records, req.user.companyId);
    await assertNoTransportCharge(req.user.companyId, req.body.charges);
    const company = await Company.findById(req.user.companyId).select('gst state').lean();
    const split = gstSplitFor({ ourGstin: company?.gst, ourState: company?.state, theirGstin: vendor.gstNumber, theirState: vendor.address?.state });

    const order = new OutsourceOrder({
      orderNo: await nextOrderNo(req.user.companyId),
      company: req.user.companyId,
      unit: req.user.unit || '',
      vendor: vendor._id,
      vendorName: vendor.supplierName,
      gstType: ['CGST_SGST', 'IGST'].includes(req.body.gstType) ? req.body.gstType : (split.type || 'CGST_SGST'),
      createdBy: req.user._id,
    });
    applyTotals(order, lines, req.body);
    const { needs, threshold } = await approvalFor(order, req.user);
    await claimAll(order, lines, records);
    await planMaterial(order, records, req.user);
    await materialReadyCheck(order, req.body, req.user); // refused → nothing saved yet
    logActivity(order, req.user, 'created', needs
      ? `Created — ${inr(order.grandTotal)}, ${approvalWhy(order, threshold)}: sent to the Company Admin.`
      : `Created — ${inr(order.grandTotal)}${threshold != null ? `, within the ${inr(threshold)} limit` : ', no approval limit set'}.`);

    await records.saveAll();
    try {
      await order.save();
    } catch (e) {
      // Free the claims again, so the requests aren't stuck.
      const undo = new RecordSet(req.user.companyId);
      for (const l of order.lines) for (const r of l.requests) await releaseRound(undo, r, r.roundId).catch(() => {});
      await undo.saveAll();
      throw e;
    }
    // The bill — the order is a real order now (slice 3).
    if (order.status === 'Open') await createOutsourceBill(order, req.user);
    await notifyAdmin(order, needs, threshold);
    res.status(201).json({
      success: true,
      message: needs ? `${order.orderNo} sent to the Company Admin for approval.` : `${order.orderNo} created.`,
      data: order,
    });
  } catch (err) { sendError(res, err); }
};

// PUT /api/outsource-work/outsource-orders/:id — edit a REJECTED order and
// send it again (decision Q4). Same body as create; the order keeps its number.
export const updateOutsourceOrder = async (req, res) => {
  const records = new RecordSet(req.user.companyId);
  try {
    const order = await OutsourceOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Outsource order not found' });
    if (order.status !== 'Rejected') return res.status(400).json({ success: false, message: 'Only a rejected order can be edited — cancel it instead.' });
    const { vendor, lines } = await readOrderBody(req.body, records, req.user.companyId);
    await assertNoTransportCharge(req.user.companyId, req.body.charges);
    const company = await Company.findById(req.user.companyId).select('gst state').lean();
    const split = gstSplitFor({ ourGstin: company?.gst, ourState: company?.state, theirGstin: vendor.gstNumber, theirState: vendor.address?.state });
    order.vendor = vendor._id;
    order.vendorName = vendor.supplierName;
    order.gstType = ['CGST_SGST', 'IGST'].includes(req.body.gstType) ? req.body.gstType : (split.type || 'CGST_SGST');
    applyTotals(order, lines, req.body);
    const { needs, threshold } = await approvalFor(order, req.user);
    await claimAll(order, lines, records);
    await planMaterial(order, records, req.user);
    await materialReadyCheck(order, req.body, req.user);
    logActivity(order, req.user, 'resubmitted', `Edited and sent again — ${inr(order.grandTotal)}${needs ? `, ${approvalWhy(order, threshold)}: waiting for the Company Admin.` : '.'}`);
    await records.saveAll();
    await order.save();
    if (order.status === 'Open') await createOutsourceBill(order, req.user);
    await notifyAdmin(order, needs, threshold);
    res.json({ success: true, message: needs ? `${order.orderNo} sent to the Company Admin again.` : `${order.orderNo} is open.`, data: order });
  } catch (err) { sendError(res, err); }
};

// Frees every claimed (still Ordered) trip on the order.
async function releaseAll(order, companyId) {
  const records = new RecordSet(companyId);
  for (const l of order.lines) {
    for (const r of l.requests) {
      if (r.status !== 'Ordered') continue;
      await releaseRound(records, r, r.roundId);
      r.status = 'Released';
    }
  }
  await records.saveAll();
}

// POST /api/outsource-work/outsource-orders/:id/cancel  body: { reason }
// Only while nothing on the order has gone out (decision Q4).
export const cancelOutsourceOrder = async (req, res) => {
  try {
    const order = await OutsourceOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Outsource order not found' });
    if (order.status === 'Cancelled') return res.status(400).json({ success: false, message: 'Already cancelled.' });
    if (order.lines.some(l => l.requests.some(r => r.status === 'Sent' || r.status === 'Received'))) {
      return res.status(400).json({ success: false, message: 'Something on this order has already gone to the vendor — it can\'t be cancelled.' });
    }
    const onTrip = order.lines.find(l => l.dispatch?.trip);
    if (onTrip) {
      return res.status(400).json({ success: false, message: `${onTrip.itemName} is on Dispatch trip ${onTrip.dispatch.tripNo} — cancel the trip first.` });
    }
    // Its bill is cancelled too; anything paid goes to Accounts: refund or credit.
    await cancelOutsourceBill(order, String(req.body.reason || '').trim());
    await releaseAll(order, req.user.companyId);
    order.status = 'Cancelled';
    order.cancelledAt = new Date();
    order.cancelledBy = req.user._id;
    order.cancelReason = String(req.body.reason || '').trim();
    logActivity(order, req.user, 'cancelled', `Cancelled${order.cancelReason ? ` — "${order.cancelReason}"` : ''}. Its requests are free to order again.`);
    await order.save();
    res.json({ success: true, message: `${order.orderNo} cancelled — its requests are free again.`, data: order });
  } catch (err) { sendError(res, err); }
};

// ── Reading orders ────────────────────────────────────────────────────────

// GET /api/outsource-work/outsource-orders?status=&search=&page=&limit=
export const listOutsourceOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const q = { company: req.user.companyId };
    if (status && status !== 'all') q.status = { $in: String(status).split(',') };
    if (search) {
      const rx = { $regex: String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      q.$or = [{ orderNo: rx }, { vendorName: rx }, { 'lines.itemCode': rx }, { 'lines.itemName': rx }, { 'lines.requests.orderCode': rx }];
    }
    const [total, data, counts] = await Promise.all([
      OutsourceOrder.countDocuments(q),
      OutsourceOrder.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('createdBy', 'fullName username').lean(),
      OutsourceOrder.aggregate([{ $match: { company: req.user.companyId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    // Each order's bill stage (slice 3) — Advance due / Awaiting material /
    // Payable / Paid.
    const bills = data.length ? await PurchaseInvoice.find({ outsourceOrder: { $in: data.map(o => o._id) } }).select('outsourceOrder stage totalAmount paidAmount dueDate').lean() : [];
    const billByOrder = new Map(bills.map(b => [String(b.outsourceOrder), b]));
    for (const o of data) {
      const b = billByOrder.get(String(o._id));
      o.billStage = b?.stage || null;
      o.billBalance = b ? round2(b.totalAmount - (b.paidAmount || 0)) : null;
    }
    res.json({
      success: true, data,
      counts: Object.fromEntries(counts.map(c => [c._id, c.n])),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { sendError(res, err); }
};

// The job-work order's total cost so far, from every live Outsource Order
// line on it (price × its qty, no GST) — pre-fills its final receive (Q3).
export async function jobWorkCostPrefill(companyId, jobWorkOrderId) {
  const orders = await OutsourceOrder.find({ company: companyId, status: { $in: LIVE }, 'lines.requests.jobWorkOrder': jobWorkOrderId })
    .select('lines.ratePerPiece lines.requests').lean();
  // ratePerPiece is the line's average per piece (pricing types, 2026-10-22):
  // whole line ÷ qty, per job work, time once entered — all included.
  let total = 0;
  for (const o of orders) {
    for (const l of o.lines) {
      for (const r of l.requests) {
        if (String(r.jobWorkOrder) === String(jobWorkOrderId) && r.status !== 'Released') total += l.ratePerPiece * r.qty;
      }
    }
  }
  return round2(total);
}

// The Outsource Order lines on a job-work order still waiting for a time
// (pricing types, 2026-10-22): its cost isn't known until then, so its last
// receive (the one that captures the cost) waits. ['OSO-0004 · Test Bush · drilling'].
export async function jobWorkTimePending(companyId, jobWorkOrderId) {
  const orders = await OutsourceOrder.find({ company: companyId, status: { $in: LIVE }, 'lines.requests.jobWorkOrder': jobWorkOrderId })
    .select('orderNo lines.itemName lines.stepNames lines.timePending lines.requests').lean();
  const out = [];
  for (const o of orders) {
    for (const l of o.lines) {
      if (l.timePending && l.requests.some(r => String(r.jobWorkOrder) === String(jobWorkOrderId) && r.status !== 'Released')) out.push(`${o.orderNo} · ${l.itemName} · ${l.stepNames.join(' › ')}`);
    }
  }
  return out;
}

// POST /outsource-orders/:id/lines/:lineId/time  body: { step, minutes }
// (pricing types, 2026-10-22 — R4): Purchase enters how long a per minute /
// per hour step took, any time after the order is approved (also while the
// work is still at the vendor). The step's amount, the line, the order and
// the bill row follow; the advance stays as it was (R7). The Company Admin is
// notified (R5 — no second approval). Editable until the line's work has
// been accepted (that amount is then in the books).
export const postStepTime = async (req, res) => {
  try {
    const order = await OutsourceOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Outsource order not found.' });
    if (order.status === 'Pending Approval') throw new HttpError(400, 'This order is waiting for the Company Admin\'s approval — enter the time once it\'s approved.');
    if (['Rejected', 'Cancelled'].includes(order.status)) throw new HttpError(400, `This order is ${order.status}.`);
    const line = order.lines.id(req.params.lineId);
    if (!line) throw new HttpError(404, 'That line isn\'t on this order.');
    const sr = (line.stepRates || []).find(x => normStep(x.step) === normStep(req.body?.step));
    if (!sr) throw new HttpError(400, `${line.itemName} has no step "${req.body?.step}".`);
    if (!isTimeType(priceTypeOf(sr))) throw new HttpError(400, `${sr.step} isn't priced per minute / per hour.`);
    const minutes = Number(req.body?.minutes);
    if (!(minutes > 0) || !Number.isFinite(minutes)) throw new HttpError(400, 'Enter how long it took (more than 0 minutes).');
    if (line.requests.some(r => (r.acceptance?.appliedKeys || []).length)) {
      throw new HttpError(400, `${line.itemName}: its work is already accepted on the bill — the time can't be changed now.`);
    }

    const before = { amount: line.amount, gst: line.gstAmount, total: line.lineTotal };
    const was = sr.time?.minutes;
    sr.time = { minutes: round2(minutes), enteredAt: new Date(), by: req.user._id, byName: req.user.fullName || req.user.username || '' };
    computeLine(line);
    computeOrderTotals(order);
    const basis = priceBasis(sr, line.qty, line.qtyUnit);
    logActivity(order, req.user, 'time', `${line.itemName} · ${sr.step}: ${was != null ? `time changed from ${timeText(was)} to ` : 'time entered — '}${basis}.`);

    // The bill: this line's rows rebuilt, its totals moved by the change.
    const bill = await PurchaseInvoice.findOne({ outsourceOrder: order._id, companyId: order.company });
    if (bill && bill.status !== 'Cancelled') {
      const rows = billRowsForLine(line);
      const others = bill.items.filter(i => String(i.outsourceLineId) !== String(line._id));
      if (bill.items.some(i => String(i.outsourceLineId) === String(line._id))) bill.items = [...others, ...rows];
      bill.subtotal = round2((Number(bill.subtotal) || 0) + (line.amount - before.amount));
      bill.gstAmount = round2((Number(bill.gstAmount) || 0) + (line.gstAmount - before.gst));
      bill.totalAmount = round2((Number(bill.totalAmount) || 0) + (line.lineTotal - before.total));
      await bill.save();
    }
    // QC may already have decided this line's work — it's valued now.
    await refreshAcceptance(order, req.user);
    await order.save();

    try {
      await notificationService.createNotification({
        title: 'Outsource time entered',
        message: `${order.orderNo} — ${order.vendorName}: ${line.itemName} · ${sr.step} — ${basis} + GST ${line.gstPercent}%. Order total now ${inr(order.grandTotal)}.`,
        type: 'purchase', targetRole: 'Company Admin', targetCompanyId: order.company,
        data: { outsourceOrderId: String(order._id), orderNo: order.orderNo, timeEntered: true },
      });
    } catch (e) { console.error('[OutsourceOrder] notify time:', e.message); }
    res.json({ success: true, message: `${sr.step}: ${basis}`, data: order });
  } catch (err) { sendError(res, err); }
};

// What each request needs on its receive (Store's receive, slice 7): the
// job-work cost (from the order) and a leftover only an older whole-sheet
// send still asks for.
export async function requestNeeds(records, line, r, companyId) {
  const out = { recordStatus: null, costRequired: false, costPrefill: null, leftoverRequired: false };
  const { doc, handoff } = await records.handoffOf(r);
  if (r.kind === 'jobWork') {
    const round = doc.rounds.id(r.roundId);
    out.recordStatus = doc.status;
    if (r.status === 'Sent' && round) {
      const covered = new Set(doc.rounds.filter(x => x.status === 'Received').flatMap(x => x.jobWorkTypes));
      round.jobWorkTypes.forEach(t => covered.add(t));
      if (doc.jobWorkTypes.every(t => covered.has(t))) {
        out.costRequired = true;
        out.costPrefill = await jobWorkCostPrefill(companyId, doc._id);
        out.leftoverRequired = doc.rawMaterial?.sentCase === 'whole' && !doc.rawMaterial?.leftoverCaptured;
      }
    }
  } else {
    out.recordStatus = handoff.status;
    if (r.status === 'Sent' && doc.orderKind === 'SubChildPart') {
      out.leftoverRequired = handoff.rawMaterial?.sentCase === 'whole' && !handoff.rawMaterial?.leftoverCaptured && !handoff.rawMaterial?.dummy;
    }
  }
  // A leftover to measure: sheet metal needs a width too (the size sent).
  if (out.leftoverRequired) {
    const rm = r.kind === 'jobWork' ? doc.rawMaterial : handoff.rawMaterial;
    const src = rm?.sourceItem ? await Item.findById(rm.sourceItem).select('dimensionVariants').lean() : null;
    const variant = (src?.dimensionVariants || []).find(v => String(v._id) === String(rm.sentDimensionVariantId));
    out.leftoverIsSheet = getCategoryByKey(variant?.category)?.calcType === 'sheet';
  }
  return out;
}

// GET /api/outsource-work/outsource-orders/:id — the order, with what each
// request needs next and price help per line.
export const getOutsourceOrder = async (req, res) => {
  try {
    const order = await OutsourceOrder.findOne({ _id: req.params.id, company: req.user.companyId })
      .populate('vendor', 'supplierName supplierCode gstNumber phone email')
      .populate('createdBy', 'fullName username')
      .populate('approval.requestedBy', 'fullName username')
      .populate('approval.reviewedBy', 'fullName username')
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Outsource order not found' });
    const records = new RecordSet(req.user.companyId);
    for (const l of order.lines) {
      for (const r of l.requests) {
        try { Object.assign(r, await requestNeeds(records, l, r, req.user.companyId)); } catch (e) { r.problem = e.message; }
      }
    }
    // Its bill (slice 3): advance, accepted, payable now, paid.
    const bill = await PurchaseInvoice.findOne({ outsourceOrder: order._id, companyId: req.user.companyId });
    order.bill = billSummary(bill);
    if (order.bill) order.bill.payableNow = payableNow(bill);
    res.json({ success: true, data: order });
  } catch (err) { sendError(res, err); }
};

// ── The trip ──────────────────────────────────────────────────────────────

const assertLive = (order) => {
  if (order.status === 'Pending Approval') throw new HttpError(400, 'This order is waiting for the Company Admin\'s approval.');
  if (!LIVE.includes(order.status)) throw new HttpError(400, `This order is ${order.status}.`);
};

// Sends every still-Ordered request on a line — each saved on its own, so a
// failure leaves the ones before it sent. Called by Dispatch's "Delivered to
// the vendor" (slice 6): Store / Production already handed the material over.
// Since slice 8 this is the only way out (Purchase's temporary Mark sent is
// gone). Updates the line, the history and the order status; the caller saves.
export async function sendLineRequests(order, line, user) {
  const toSend = line.requests.filter(r => r.status === 'Ordered');
  let failed = null;
  for (const r of toSend) {
    const records = new RecordSet(order.company);
    try {
      await sendRound(records, r, r.roundId, { materialPlan: r.materialPlan, user });
      await records.saveAll();
      r.status = 'Sent';
    } catch (e) {
      failed = { request: r.orderCode, message: e.message, status: e.status || 500 };
      break;
    }
  }
  const sentNow = toSend.filter(r => r.status === 'Sent');
  if (sentNow.length && line.requests.every(r => r.status !== 'Ordered')) {
    line.sentAt = new Date();
    line.sentBy = user._id;
  }
  if (sentNow.length) {
    logActivity(order, user, 'sent', `${line.itemName} · ${line.stepNames.join(' › ')} — delivered by Dispatch (${line.dispatch?.tripNo || 'trip'}): ${sentNow.map(r => r.orderCode).join(', ')}.`);
  }
  order.status = deriveStatus(order);
  return { sentNow, failed };
}

// Receives one Sent request — its own production / job-work order, the QC
// snapshot and the bill acceptance (slice 3). Called by Store's receive
// (slice 7; Purchase's temporary Receive went in slice 8).
// `onRecords(records)` runs before the records are saved (Store notes where
// the work now waits). The caller saves the order.
export async function receiveRequestCore(order, line, r, user, body = {}, { viaStore = false, onRecords = null } = {}) {
  const records = new RecordSet(order.company);
  await receiveRound(records, r, r.roundId, { body, materialPlan: r.materialPlan, user });
  if (onRecords) await onRecords(records);
  await records.saveAll();
  r.status = 'Received';
  logActivity(order, user, 'received', `${line.itemName} · ${line.stepNames.join(' › ')} — received${viaStore ? ' by Store' : ''}: ${r.orderCode}.`);
  // The bill (slice 3): what this trip sent to QC; a trip with no QC step
  // is accepted (payable) straight away.
  await recordTripQc(r);
  await refreshAcceptance(order, user);
  order.status = deriveStatus(order);
}

// Slice 7 (T9) — the vendor called to say a request is done. Purchase or
// Dispatch marks it; Vendor Pickups lists it first. The caller saves.
export function markVendorReady(order, line, r, user) {
  if (r.status !== 'Sent') throw new HttpError(400, `${r.orderCode} isn't with the vendor.`);
  r.vendorReady = { at: new Date(), by: user._id, byName: user.fullName || user.username || '' };
  logActivity(order, user, 'vendor-ready', `${line.itemName} · ${line.stepNames.join(' › ')} — the vendor says ${r.orderCode} is ready to collect.`);
}

// POST /api/outsource-work/outsource-orders/:id/requests/:requestId/vendor-ready
export const postVendorReady = async (req, res) => {
  try {
    const order = await OutsourceOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Outsource order not found' });
    let line = null; let r = null;
    for (const l of order.lines) { const x = l.requests.id(req.params.requestId); if (x) { line = l; r = x; break; } }
    if (!r) return res.status(404).json({ success: false, message: 'Request not found on this order' });
    markVendorReady(order, line, r, req.user);
    await order.save();
    res.json({ success: true, message: `${r.orderCode} marked ready to collect.`, data: order });
  } catch (err) { sendError(res, err); }
};

// POST /api/outsource-work/outsource-orders/:id/requests/:requestId/not-coming
// body: { qty, reason } — pieces that won't come back from the vendor (partial
// returns, 2026-10-26; Store can do it too, on Outsource Receive).
export const postNotComing = async (req, res) => {
  try {
    const { markNotComing } = await import('../services/dispatchTripService.js');
    const out = await markNotComing(req.user.companyId, { outsourceOrder: req.params.id, requestId: req.params.requestId, qty: req.body?.qty, reason: req.body?.reason, lostUnitIds: req.body?.lostUnitIds, acknowledgeWarnings: req.body?.acknowledgeWarnings }, req.user, 'Purchase');
    res.json({ success: true, message: notComingMessage(out), data: out.order });
  } catch (err) { sendError(res, err); }
};

export function notComingMessage({ request, complete, replacement, wholeLoss, closedOrderNo }) {
  const parts = [`Written off — ${request.lostQty} not coming.`];
  if (closedOrderNo) parts.push(`All lost: ${closedOrderNo} closed, 0 made.`);
  else if (wholeLoss) parts.push('Nothing came back from this trip; the rest of the batch goes on.');
  else if (complete) parts.push('Everything else is back, so it goes on now (QC / next step).');
  if (replacement) parts.push(`Replacement order ${replacement.orderId} raised.`);
  return parts.join(' ');
}

// ── Company Admin approval (D4) ───────────────────────────────────────────

const APPROVAL_STATUS_QUERY = {
  Pending: { status: 'Pending Approval' },
  // Every real order: approved, or within the limit / no limit set.
  Approved: { status: { $in: LIVE } },
  Rejected: { status: 'Rejected' },
};

// GET /api/outsource-approvals?status=Pending|Approved|Rejected&page=&limit=
export const listOutsourceApprovals = async (req, res) => {
  try {
    if (!req.user.companyId) return res.status(400).json({ message: 'Your account is not linked to a company.' });
    const status = APPROVAL_STATUS_QUERY[req.query.status] ? req.query.status : 'Pending';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const q = { company: req.user.companyId, ...APPROVAL_STATUS_QUERY[status] };
    // Search (2026-10-23): order no., vendor, or a part on it.
    const s = String(req.query.search || '').trim();
    if (s) {
      const rx = { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      q.$and = [{ $or: [{ orderNo: rx }, { vendorName: rx }, { 'lines.itemName': rx }, { 'lines.itemCode': rx }] }];
    }
    const [total, orders, pendingCount] = await Promise.all([
      OutsourceOrder.countDocuments(q),
      OutsourceOrder.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('vendor', 'supplierName supplierCode phone email')
        .populate('createdBy', 'fullName username')
        .populate('approval.requestedBy', 'fullName username')
        .populate('approval.reviewedBy', 'fullName username')
        .lean(),
      OutsourceOrder.countDocuments({ company: req.user.companyId, status: 'Pending Approval' }),
    ]);
    // Price help on each line, for the reviewer.
    // Only earlier orders (never this one), and for a one-step line the same
    // price type with its unit (2026-10-23 — a ₹90 whole line isn't "₹15/pc").
    const UNIT = { piece: '/pc', line: ' line', operation: '/op', minute: '/min', hour: '/h' };
    for (const o of orders) {
      for (const l of o.lines) {
        const ph = await priceHistory(o.company, l.item, l.stepNames, o.vendor?._id || o.vendor, { before: o.createdAt, excludeOrderId: o._id });
        const one = (l.stepRates || []).length === 1 && l.stepNames.length === 1 ? l.stepRates[0] : null;
        l.priceHistory = one
          ? { ...ph.byStepType[l.stepNames[0]][priceTypeOf(one)], unit: UNIT[priceTypeOf(one)] }
          : { ...ph, unit: '/pc avg' };
      }
    }
    res.json({ success: true, data: orders, pendingCount, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) { sendError(res, err); }
};

// PUT /api/outsource-approvals/:id/review  body: { decision: 'approve'|'reject', remarks }
export const reviewOutsourceApproval = async (req, res) => {
  try {
    const { decision } = req.body;
    const remarks = String(req.body.remarks || '').trim();
    if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ message: 'decision must be approve or reject' });
    const order = await OutsourceOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ message: 'Outsource order not found' });
    if (order.status !== 'Pending Approval') return res.status(409).json({ message: `This order is already ${order.status}.` });
    // Separation of duties — nobody approves an order they raised themselves.
    if (String(order.approval?.requestedBy || order.createdBy) === String(req.user._id)) {
      return res.status(403).json({ message: 'You can\'t review an outsource order you created yourself.' });
    }
    if (decision === 'reject') {
      if (!remarks) return res.status(400).json({ message: 'Give a reason for rejecting.' });
      await releaseAll(order, req.user.companyId);
      order.status = 'Rejected';
    } else {
      const vendor = await Supplier.findOne({ _id: order.vendor, companyId: order.company });
      const problem = eligibleVendorError(vendor);
      if (problem) return res.status(409).json({ message: `Can't approve: ${problem} Reject it so Purchase can redo the order.` });
      order.status = 'Open';
      order.status = deriveStatus(order);
    }
    order.set('approval.decision', decision === 'approve' ? 'Approved' : 'Rejected');
    order.set('approval.reviewedBy', req.user._id);
    order.set('approval.reviewedAt', new Date());
    order.set('approval.remarks', remarks);
    logActivity(order, req.user, decision === 'approve' ? 'approved' : 'rejected', decision === 'approve'
      ? `Approved by the Company Admin${remarks ? ` — "${remarks}"` : ''}.`
      : `Rejected by the Company Admin — "${remarks}". Its requests are free to order again.`);
    await order.save();
    // Approved → a real order: its bill (slice 3).
    if (decision === 'approve') await createOutsourceBill(order, order.createdBy ? { _id: order.createdBy, unit: order.unit } : req.user);
    try {
      await notificationService.createNotification({
        title: `Outsource order ${order.orderNo} ${decision === 'approve' ? 'approved' : 'rejected'}`,
        message: decision === 'approve' ? 'Approved by the Company Admin — it can now go to the vendor.' : `Rejected by the Company Admin: ${remarks}`,
        type: 'purchase',
        targetUserId: order.approval.requestedBy || order.createdBy,
        targetCompanyId: order.company,
        data: { outsourceOrderId: String(order._id), orderNo: order.orderNo },
      });
    } catch (e) { console.error('[OutsourceOrder] notify requester:', e); }
    res.json({ message: decision === 'approve' ? 'Approved — it can now go to the vendor.' : 'Rejected — Purchase has been notified.', data: order });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
    console.error('[OutsourceApproval]', err);
    res.status(500).json({ message: err.message });
  }
};
