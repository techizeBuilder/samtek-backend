// Order tracker for the Complaint team (feature 12, 2026-11-14) — where a
// customer's order is, in a sentence to read out, with details for the team.
// docs/client-features-2026-11/12-order-tracker-logic.md
//
// Read-only: it joins records every department already keeps (Order, Order
// Form, the Sale's item list, Production Orders and the part orders made for
// them, QC Jobs, Purchase Requests / Orders, Packaging Jobs, Dispatch Orders).
// Nothing here writes, except the enquiry notes (addNote).
import Order from '../../models/Order.js';
import OrderForm from '../../models/OrderForm.js';
import Sale from '../../models/Sale.js';
import Customer from '../../models/Customer.js';
import ProductionOrder from '../../models/ProductionOrder.js';
import QCJob from '../../models/QCJob.js';
import PurchaseRequest from '../../models/PurchaseRequest.js';
import Purchase from '../../models/Purchase.js';
import PackagingJob from '../../models/PackagingJob.js';
import DispatchOrder from '../../models/DispatchOrder.js';
import OrderEnquiry from '../../models/OrderEnquiry.js';
import User from '../../models/User.js';
import mongoose from 'mongoose';
import { holdOf } from '../planning/boardService.js';

// The stage bar, in order. An order is as far as its least-advanced item.
export const BAR = ['Placed', 'Verified', 'Order form', 'In work', 'Final QC', 'Packing', 'Dispatched', 'Delivered'];
const B = Object.fromEntries(BAR.map((label, i) => [label, i]));

const IST = 5.5 * 3600 * 1000;
export const indiaDay = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const validDate = (d) => d && !Number.isNaN(new Date(d).getTime());
// "12 Nov" (India date). Dispatch dates are stored as "YYYY-MM-DD" strings.
export const dayText = (d) => {
  if (!validDate(d)) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d) : indiaDay(d);
  const [y, m, dd] = day.split('-').map(Number);
  return `${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}${y !== Number(indiaDay(new Date()).slice(0, 4)) ? ` ${y}` : ''}`;
};

const DELIVERED = ['Delivered', 'Closed'];
const OUT = ['Dispatched', 'In Transit', ...DELIVERED];
const qtyOf = (rows) => rows.reduce((a, r) => a + (Number(r.quantity) || 1), 0);
const isDelivered = (d) => DELIVERED.includes(d.status) || d.confirmation === 'Reached Safely';
const isOut = (d) => OUT.includes(d.status) || d.confirmation === 'Reached Safely';

// "1 of 2 is ready; the other is in production…" — some units ahead of the rest.
function partial(ahead, word, total, pred) {
  const rest = total - ahead;
  return `${ahead} of ${total} ${ahead === 1 ? 'is' : 'are'} ${word}; the other${rest > 1 ? 's are' : ' is'} ${pred}.`;
}
const sentenceFor = (pred, { ahead = 0, word = '', total = 1 } = {}) =>
  (ahead > 0 && ahead < total ? partial(ahead, word, total, pred) : `It's ${pred}.`);

/**
 * Where one order item is (pure — the loaders below fill its input).
 * input: {
 *   item: { name, qty, storeStatus, approvedQty },
 *   productions: [{ orderNo, status, units: [{ unit, steps: [{ name, type, status }], hold, block }],
 *                   parts: [{ name, orderNo, done, stepsDone, stepsTotal }] }],
 *   qcJobs: [{ jobId, status, decision }] (newest first),
 *   purchase: { requestId, status, poNumber, poStatus, expected } | null,
 *   packing: [{ status, quantity }],
 *   dispatch: [{ dispatchId, status, quantity, confirmation, transport, vehicle, tracking,
 *               dispatchedOn, expected, deliveredOn, installation: { status, scheduledDate } }],
 * }
 * → { stage, bar, sentence, detail: [team lines], qty, ready }
 * The sentence never holds costs, people's names, vendor names or reject details.
 */
export function itemStage({ item, productions = [], qcJobs = [], purchase = null, packing = [], dispatch = [] }) {
  const qty = Math.max(1, Number(item.qty) || 1);
  const st = item.storeStatus || null;
  const approved = Math.min(qty, Number(item.approvedQty) || 0);
  const detail = [];
  const out = (stage, bar, sentence, ready = 0) => ({ stage, bar, sentence, detail, qty, ready });
  const qcLine = () => {
    const j = qcJobs[0];
    if (j) detail.push(`QC job ${j.jobId}: ${j.status}${j.decision ? ` (${j.decision})` : ''}`);
  };

  // ── After QC: packing and dispatch, counted unit by unit ──
  const deliveredQty = qtyOf(dispatch.filter(isDelivered));
  const outQty = qtyOf(dispatch.filter(isOut));
  const packedQty = qtyOf(packing.filter((p) => ['Packed', 'Dispatched'].includes(p.status)));
  const dispatchLine = (d) => [
    d.dispatchId || 'Dispatch', d.status,
    d.transport ? `by ${d.transport}` : '', d.vehicle ? `vehicle ${d.vehicle}` : '', d.tracking ? `tracking ${d.tracking}` : '',
    d.dispatchedOn ? `dispatched ${dayText(d.dispatchedOn)}` : '', d.expected ? `expected ${dayText(d.expected)}` : '',
    d.deliveredOn ? `delivered ${dayText(d.deliveredOn)}` : '', d.confirmation && d.confirmation !== 'Pending' ? `customer: ${d.confirmation}` : '',
    d.installation?.status ? `installation: ${d.installation.status}${d.installation.scheduledDate ? ` ${dayText(d.installation.scheduledDate)}` : ''}` : '',
  ].filter(Boolean).join(' · ');

  if (deliveredQty >= qty) {
    dispatch.forEach((d) => detail.push(dispatchLine(d)));
    const last = dispatch.filter(isDelivered).map((d) => d.deliveredOn).filter(validDate).sort().pop();
    const inst = dispatch.map((d) => d.installation).filter(Boolean);
    const instText = !inst.length ? ''
      : inst.every((i) => i.status === 'Completed') ? ' Installation is done.'
        : inst.some((i) => i.status === 'Scheduled' && i.scheduledDate) ? ` Installation is scheduled for ${dayText(inst.find((i) => i.status === 'Scheduled' && i.scheduledDate).scheduledDate)}.`
          : ' Installation is not scheduled yet.';
    return out('delivered', B.Delivered, `It was delivered${last ? ` on ${dayText(last)}` : ''}.${instText}`, qty);
  }
  if (outQty >= qty) {
    dispatch.forEach((d) => detail.push(dispatchLine(d)));
    const d = dispatch.filter(isOut).find((x) => !isDelivered(x)) || dispatch[0];
    const bits = [d.dispatchedOn ? `dispatched on ${dayText(d.dispatchedOn)}` : 'dispatched', d.transport ? `by ${d.transport}` : '',
      d.vehicle ? `vehicle ${d.vehicle}` : '', d.tracking ? `tracking ${d.tracking}` : ''].filter(Boolean).join(', ');
    const pred = `on its way: ${bits}${d.expected ? `. Expected by ${dayText(d.expected)}` : ''}`;
    return out('dispatched', B.Dispatched, sentenceFor(pred, { ahead: deliveredQty, word: 'delivered', total: qty }), deliveredQty);
  }
  if (st === 'Approved from QC' || packing.length || dispatch.length) {
    if (packing.length) detail.push(`Packing: ${packedQty} of ${qty} packed`);
    dispatch.forEach((d) => detail.push(dispatchLine(d)));
    if (packedQty >= qty) return out('packed', B.Packing, sentenceFor('packed and ready for dispatch', { ahead: outQty, word: 'dispatched', total: qty }), qty);
    if (packing.length) return out('packing', B.Packing, sentenceFor('being packed', { ahead: outQty, word: 'dispatched', total: qty }), qty);
    return out('passed', B.Packing, 'It passed our quality check and is being packed.', qty);
  }

  // ── Before QC passes ──
  if (!st) return out('processing', B['Order form'], "Your order is confirmed and being processed.");

  if (st === 'Goes to Purchase') {
    if (purchase) {
      detail.push(`Purchase request ${purchase.requestId}: ${purchase.status}${purchase.poNumber ? ` · PO ${purchase.poNumber} (${purchase.poStatus})` : ''}${purchase.expected ? `, expected ${dayText(purchase.expected)}` : ''}`);
    } else detail.push('No purchase request found for it. Ask Store / Purchase.');
    const pred = purchase?.expected ? `being procured. Expected in stock by ${dayText(purchase.expected)}` : 'being procured';
    return out('buying', B['In work'], `It's ${pred}.`);
  }
  if (st === 'Rejected from QC') {
    qcLine();
    return out('qcFailed', B['Final QC'], "Our final check found something to correct. It's being fixed before dispatch.");
  }
  if (st === 'Goes to QC' || st === 'Purchase Completed' || st === 'Production Completed') {
    qcLine();
    const pred = st === 'Production Completed' ? 'built and going through our final quality check' : 'ready in stock and going through our final quality check';
    return out('finalQc', B['Final QC'], `It's ${pred}.`, approved);
  }

  // 'Goes to Production' (or any other routing): being made.
  return making({ productions, qcJobs, qty, approved, detail, out, qcLine });
}

function making({ productions, qty, approved, detail, out, qcLine }) {
  const word = 'ready';
  if (!productions.length) {
    detail.push('Store sent it to Production, but no production order was found for it. Ask Production.');
    return out('noOrder', B['In work'], sentenceFor('being prepared for production', { ahead: approved, word, total: qty }), approved);
  }
  // Every unit of every production order made for this item; the least advanced one tells.
  const units = [];
  for (const p of productions) {
    const multi = p.units.length > 1;
    for (const u of p.units) {
      const done = u.steps.filter((s) => s.status === 'Completed').length;
      const nextIdx = u.steps.findIndex((s) => s.status !== 'Completed');
      units.push({ p, u, done, total: u.steps.length, nextIdx, multi });
    }
    const unitText = p.units.map((u) => `${u.steps.filter((s) => s.status === 'Completed').length}/${u.steps.length}`).join(', ');
    detail.push(`${p.orderNo}: ${p.status}${p.units.length ? ` · steps done ${p.units.length > 1 ? `per unit ${unitText}` : unitText}` : ''}`);
    for (const part of p.parts || []) {
      detail.push(`Part ${part.name}: ${part.orderNo} · ${part.done ? 'delivered' : `${part.stepsDone} of ${part.stepsTotal} steps`}`);
    }
  }
  const open = units.filter((x) => x.nextIdx !== -1).sort((a, b) => a.done - b.done);
  if (!open.length) {
    // Built: the final QC on each unit decides (machines count one by one).
    qcLine();
    return out('finalQc', B['Final QC'], sentenceFor('built and going through our final quality check', { ahead: approved, word, total: qty }), approved);
  }
  const x = open[0];
  const next = x.u.steps[x.nextIdx];
  const where = `${x.multi ? `unit ${x.u.unit}: ` : ''}${next.name}`;
  const block = x.u.block; const hold = x.u.hold;
  const why = block?.message || hold?.detail;
  if (why) detail.push(`${x.p.orderNo} ${where} — ${why}`);
  const partsWaiting = (x.p.parts || []).filter((part) => !part.done);
  let stage = 'inProgress'; let pred;
  if (x.p.status === 'BOM Pending' || block?.key === 'bom') { stage = 'bom'; pred = 'being prepared for production'; }
  else if (block?.key === 'material' && partsWaiting.length) { stage = 'partWait'; pred = `being prepared for production; one of its parts (${partsWaiting.map((part) => part.name).join(', ')}) is being made first`; }
  else if (block?.key === 'material') { stage = 'material'; pred = 'being prepared for production; materials are being arranged'; }
  else if (hold?.key === 'vendor') { stage = 'vendor'; pred = 'in production; one step is being done at a partner workshop'; }
  else if (hold?.key === 'qc') {
    stage = x.nextIdx === x.total - 1 ? 'finalQc' : 'stepQc';
    pred = stage === 'finalQc' ? 'built and going through our final quality check' : 'in production, at a quality check between steps';
  } else if (hold?.key === 'outsource' || block) { stage = 'inProgress'; pred = x.done ? `in production: ${x.done} of ${x.total} steps done` : 'in production'; }
  else if (next.status === 'In Progress') pred = `in production: ${x.done} of ${x.total} steps done (now: ${next.name})`;
  else if (x.done === 0) { stage = 'queued'; pred = `in the production queue (first step: ${next.name})`; }
  else pred = `in production: ${x.done} of ${x.total} steps done (next: ${next.name})`;
  const bar = stage === 'finalQc' ? B['Final QC'] : B['In work'];
  return out(stage, bar, sentenceFor(pred, { ahead: approved, word, total: qty }), approved);
}

/** The order's bar position: before the Order Form, its approvals; after, its least-advanced item. */
export function orderBar(order, items) {
  if (order.serviceVerification?.status !== 'verified') return B.Placed;
  if (!order.orderFormCompleted) return B.Verified;
  if (!items.length) return B['Order form'];
  return Math.min(...items.map((it) => it.bar));
}

/** Promised date (the Order Form's delivery date) against today: { promised, lateDays, text }. */
export function promise(form, bar, today = indiaDay(new Date())) {
  const d = form?.deliveryDate;
  if (!validDate(d)) return { promised: null, lateDays: 0, text: 'No date was promised' };
  const day = indiaDay(d);
  if (bar >= B.Delivered) return { promised: day, lateDays: 0, text: `Promised ${dayText(d)}` };
  const late = Math.round((new Date(today) - new Date(day)) / 86400000);
  return late > 0
    ? { promised: day, lateDays: late, text: `Promised ${dayText(d)} · ${late} day${late === 1 ? '' : 's'} late` }
    : { promised: day, lateDays: 0, text: `Promised ${dayText(d)} · on track` };
}

const earliest = (dates) => dates.filter(validDate).map((d) => new Date(d)).sort((a, b) => a - b)[0] || null;
const unitCount = (o) => (o.orderKind === 'SubChildPart' ? 1 : Math.max(1, Number(o.orderQuantity) || 1));
const stepsOf = (procs) => (procs || []).map((s) => ({ name: s.step, type: s.type, status: s.status }));

// The Sale whose item list carries the Store flow (same pick as getOrderItemsReadiness).
function pickSale(sales) {
  return sales.find((s) => (s.items || []).some((it) => it.storeQCStatus)) || sales.find((s) => s.isPlaceholder) || sales[0] || null;
}

/**
 * Everything for a set of orders, fetched in bulk (a page of the list, or one order).
 * full: also Start's checks per unit (the exact "waiting for"), the timeline and the notes.
 */
async function loadJourneys(companyId, orders, { full = false } = {}) {
  if (!orders.length) return new Map();
  const ctrl = await import('../../controllers/productionMfgController.js');
  const orderIds = orders.map((o) => o._id);
  const codes = orders.map((o) => o.orderCode).filter(Boolean);
  const [forms, sales] = await Promise.all([
    OrderForm.find({ orderId: { $in: orderIds } }).select('orderId deliveryDate customerName mobile companyName createdAt').lean(),
    Sale.find({ order: { $in: orderIds }, companyId }).select('order isPlaceholder items storeQCStatus createdAt').sort({ createdAt: 1 }).lean(),
  ]);
  const formOf = new Map(forms.map((f) => [String(f.orderId), f]));
  const salesOf = new Map();
  for (const s of sales) { const k = String(s.order); if (!salesOf.has(k)) salesOf.set(k, []); salesOf.get(k).push(s); }

  // Items per order.
  const itemsOf = new Map();
  const allItemIds = [];
  for (const o of orders) {
    const sale = pickSale(salesOf.get(String(o._id)) || []);
    const perItem = (sale?.items || []).some((it) => it.storeQCStatus);
    const items = (sale?.items || []).filter((it) => (Number(it.quantity) || 0) > 0).map((it) => ({
      _id: it._id, name: it.productName, qty: it.quantity,
      storeStatus: perItem ? (it.storeQCStatus || null) : (sale.storeQCStatus || null), approvedQty: it.approvedQty || 0,
    }));
    items.forEach((it) => allItemIds.push(it._id));
    itemsOf.set(String(o._id), items);
  }

  const [prodDocs, qcDocs, prDocs, packDocs, dispDocs] = await Promise.all([
    ProductionOrder.find({ company: companyId, status: { $ne: 'Cancelled' }, $or: [{ saleItemId: { $in: allItemIds } }, { orderCode: { $in: codes }, demandRefId: null }] }).lean(),
    QCJob.find({ company: companyId, $or: [{ saleItemId: { $in: allItemIds } }, { orderCode: { $in: codes } }] })
      .select('qcJobId status decision saleItemId orderCode itemName decidedAt createdAt').sort({ createdAt: -1 }).lean(),
    PurchaseRequest.find({ companyId, saleItemId: { $in: allItemIds } }).select('requestId status saleItemId purchaseOrder createdAt').sort({ createdAt: -1 }).lean(),
    PackagingJob.find({ company: companyId, orderId: { $in: codes } }).select('orderId saleItemId status quantity machineName serialNumber packingCompleteTime').lean(),
    DispatchOrder.find({ company: companyId, orderId: { $in: codes } })
      .select('dispatchId orderId saleItemId status quantity machineName transportType transportCompanyName vehicleNumber trackingId actualDispatchDate expectedDeliveryDate actualDeliveryDate customerConfirmation installation').lean(),
  ]);
  const mainIds = prodDocs.map((p) => p._id);
  const [partDocs, poDocs] = await Promise.all([
    mainIds.length ? ProductionOrder.find({ company: companyId, demandRefId: { $in: mainIds }, status: { $ne: 'Cancelled' } }).lean() : [],
    Purchase.find({ _id: { $in: prDocs.map((r) => r.purchaseOrder).filter(Boolean) } }).select('purchaseOrderNumber status expectedDeliveryDate').lean(),
  ]);
  const poOf = new Map(poDocs.map((p) => [String(p._id), p]));
  const partsOf = new Map();
  for (const part of partDocs) { const k = String(part.demandRefId); if (!partsOf.has(k)) partsOf.set(k, []); partsOf.get(k).push(part); }

  // A record belongs to an item by saleItemId; an older record without one, by
  // its order and (when the order has several items) the item's name.
  const owner = (items, rec, nameField, orderMatch) => {
    if (rec.saleItemId) return items.find((it) => String(it._id) === String(rec.saleItemId)) || null;
    if (!orderMatch) return null;
    return items.length === 1 ? items[0] : items.find((it) => it.name && it.name === rec[nameField]) || null;
  };

  const result = new Map();
  for (const o of orders) {
    const items = itemsOf.get(String(o._id));
    const form = formOf.get(String(o._id)) || null;
    const byItem = new Map(items.map((it) => [String(it._id), { productions: [], qcJobs: [], purchase: null, packing: [], dispatch: [] }]));
    const slot = (it) => (it ? byItem.get(String(it._id)) : null);

    for (const p of prodDocs) {
      const s = slot(owner(items, p, 'machineName', p.orderCode && p.orderCode === o.orderCode));
      if (!s) continue;
      if (full && p.orderKind === 'Machine' && !p.bomVerified) p.bomVerified = await ctrl.autoVerifyMachineOrder(p._id, companyId, { dryRun: true });
      const units = [];
      for (let u = 0; u < unitCount(p); u++) {
        const procs = ctrl.unitProcessesView(p, u);
        const steps = stepsOf(procs);
        const nextIdx = (procs || []).findIndex((x) => x.status !== 'Completed');
        let hold = null; let block = null;
        if (nextIdx !== -1) {
          hold = holdOf(procs[nextIdx]);
          if (!hold && procs[nextIdx].type === 'In-House' && procs[nextIdx].status === 'Pending') {
            block = full ? await ctrl.startBlockers(p, u, nextIdx, companyId)
              // The quick list view: the order-wide flag only holds old fixed-step orders (19 Nov, machineGate).
              : (p.orderKind === 'Machine' && !p.materialIssued && !ctrl.isProcessDefinitionOrder(p) ? { key: 'material', message: 'Material not issued yet.' } : null);
          }
        }
        units.push({ unit: u + 1, steps, hold, block, startedAt: earliest((procs || []).map((x) => x.startedAt)) });
      }
      const cover = new Map((p.cascadeCovers || []).map((c) => [c.partCode, c]));
      const parts = (partsOf.get(String(p._id)) || []).map((part) => {
        const c = cover.get(part.machineCode);
        const all = [part.processes || [], ...(part.extraUnits || []).map((x) => x.processes || [])].flat();
        return {
          name: part.machineName, orderNo: part.orderId,
          done: part.status === 'Completed' || (c ? (c.delivered || 0) >= (c.qty || 0) && c.qty > 0 : false),
          stepsDone: all.filter((x) => x.status === 'Completed').length, stepsTotal: all.length,
        };
      });
      s.productions.push({ orderNo: p.orderId, status: p.status, units, parts, startedAt: earliest(units.map((u) => u.startedAt)), completedAt: p.status === 'Completed' ? p.completedAt : null, _id: p._id });
    }
    for (const j of qcDocs) {
      const s = slot(owner(items, j, 'itemName', j.orderCode === o.orderCode));
      if (s) s.qcJobs.push({ jobId: j.qcJobId, status: j.status, decision: j.decision, decidedAt: j.decidedAt });
    }
    for (const r of prDocs) {
      const s = slot(owner(items, r, null, false));
      if (s && !s.purchase) {
        const po = r.purchaseOrder ? poOf.get(String(r.purchaseOrder)) : null;
        s.purchase = { requestId: r.requestId, status: r.status, poNumber: po?.purchaseOrderNumber || null, poStatus: po?.status || null, expected: po?.expectedDeliveryDate || null };
      }
    }
    for (const pk of packDocs) {
      if (pk.orderId !== o.orderCode) continue;
      const s = slot(owner(items, pk, 'machineName', true));
      if (s) s.packing.push({ status: pk.status, quantity: pk.quantity, serial: pk.serialNumber, at: pk.packingCompleteTime });
    }
    for (const d of dispDocs) {
      if (d.orderId !== o.orderCode) continue;
      const s = slot(owner(items, d, 'machineName', true));
      if (s) {
        s.dispatch.push({
          dispatchId: d.dispatchId, status: d.status, quantity: d.quantity, confirmation: d.customerConfirmation?.status || null,
          transport: d.transportCompanyName || '', vehicle: d.vehicleNumber || '', tracking: d.trackingId || '',
          dispatchedOn: d.actualDispatchDate || null, expected: d.expectedDeliveryDate || null, deliveredOn: d.actualDeliveryDate || null,
          installation: d.installation ? { status: d.installation.status, scheduledDate: d.installation.scheduledDate || null } : null,
        });
      }
    }

    const itemViews = items.map((it) => {
      const linked = byItem.get(String(it._id));
      return { saleItemId: it._id, name: it.name, ...itemStage({ item: it, ...linked }), linked };
    });
    const bar = orderBar(o, itemViews);
    result.set(String(o._id), { order: o, form, items: itemViews, bar });
  }
  return result;
}

// Customer name / mobile / company for a row or header: the Customer record, else the Order Form.
function who(order, form) {
  const c = order.customer && typeof order.customer === 'object' ? order.customer : null;
  return {
    name: c?.name || form?.customerName || form?.companyName || 'Unknown customer',
    mobile: c?.mobile || form?.mobile || '',
    company: form?.companyName || '',
  };
}

function orderFlags(order, bar) {
  if (order.status === 'cancelled') return 'Order cancelled';
  if (order.status === 'rejected_by_service' || order.serviceVerification?.status === 'rejected') return 'Rejected at deal verification';
  if (order.status === 'rejected') return 'Order rejected';
  // Marked completed by hand, though its records stop earlier (older orders).
  if (order.status === 'completed' && bar < B.Delivered) return 'Marked completed';
  return null;
}

// Order statuses that are closed anyway (never on the Open list).
const CLOSED_STATUSES = ['completed', 'cancelled', 'rejected', 'rejected_by_service'];

/**
 * Marks the orders that have become fully delivered since the last look:
 * every dispatch line delivered, and the lines cover all the units ordered (the
 * Sale's item quantities). Only orders not marked yet and still open are checked,
 * so this is bounded by open work, never all dispatch history (17 Nov 2026). The
 * first look after that date checks the older orders once and marks them.
 */
async function markDelivered(companyId) {
  const candidates = await Order.find({ companyId, trackingDeliveredAt: null, status: { $nin: CLOSED_STATUSES } }).select('_id orderCode').lean();
  const codes = candidates.map((o) => o.orderCode).filter(Boolean);
  if (!codes.length) return 0;
  const lines = await DispatchOrder.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(String(companyId)), orderId: { $in: codes } } },
    {
      $group: {
        _id: '$orderId',
        qty: { $sum: { $ifNull: ['$quantity', 1] } },
        notDelivered: { $sum: { $cond: [{ $or: [{ $in: ['$status', DELIVERED] }, { $eq: ['$customerConfirmation.status', 'Reached Safely'] }] }, 0, 1] } },
      },
    },
    { $match: { notDelivered: 0 } },
  ]);
  if (!lines.length) return 0;
  const qtyByCode = new Map(lines.map((l) => [l._id, l.qty]));
  const orders = candidates.filter((o) => qtyByCode.has(o.orderCode));
  const sales = await Sale.find({ order: { $in: orders.map((o) => o._id) }, companyId }).select('order isPlaceholder items.quantity items.storeQCStatus').sort({ createdAt: 1 }).lean();
  const salesOf = new Map();
  for (const s of sales) { const k = String(s.order); if (!salesOf.has(k)) salesOf.set(k, []); salesOf.get(k).push(s); }
  const done = orders.filter((o) => {
    const sale = pickSale(salesOf.get(String(o._id)) || []);
    const ordered = (sale?.items || []).reduce((a, it) => a + (Number(it.quantity) > 0 ? Number(it.quantity) : 0), 0);
    return qtyByCode.get(o.orderCode) >= Math.max(1, ordered);
  }).map((o) => o._id);
  if (!done.length) return 0;
  const res = await Order.updateMany({ _id: { $in: done }, trackingDeliveredAt: null }, { $set: { trackingDeliveredAt: new Date() } });
  return res.modifiedCount || 0;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The list: { orders: [row], pagination }. show = open (default) | delivered | all.
 * search matches the order number, the customer (name / mobile / contact person),
 * the Order Form (name / mobile / company) and a production order number.
 */
export async function searchOrders(companyId, { search = '', show = 'open', page = 1, limit = 20 } = {}) {
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const query = { companyId };
  const term = String(search || '').trim();
  if (term) {
    const re = new RegExp(escapeRegex(term), 'i');
    const [customerIds, formOrderIds, prodCodes] = await Promise.all([
      Customer.find({ companyId, $or: [{ name: re }, { mobile: re }, { contactPerson: re }] }).distinct('_id'),
      OrderForm.find({ companyId, $or: [{ customerName: re }, { mobile: re }, { companyName: re }] }).distinct('orderId'),
      ProductionOrder.find({ company: companyId, orderId: re, orderCode: { $nin: [null, ''] } }).distinct('orderCode'),
    ]);
    query.$or = [{ orderCode: re }, { customer: { $in: customerIds } }, { _id: { $in: formOrderIds } }, { orderCode: { $in: prodCodes } }];
  }
  // Delivered = every unit's dispatch line delivered (marked on the order when the
  // tracker first finds it), or the order marked completed.
  if (show !== 'all' || term) await markDelivered(companyId);
  const OPEN = { trackingDeliveredAt: null, status: { $nin: CLOSED_STATUSES } };
  const DELIVERED = { $and: [{ $or: [{ trackingDeliveredAt: { $ne: null } }, { status: 'completed' }] }] };
  const base = { ...query };
  if (show === 'delivered') Object.assign(query, DELIVERED);
  else if (show !== 'all') Object.assign(query, OPEN);
  // While searching (2026-11-14, as on Production → Orders): matches per tab, so the
  // page can show the counts and open the tab that has the order.
  const searchCounts = term ? await (async () => {
    const [open, del, all] = await Promise.all([
      Order.countDocuments({ ...base, ...OPEN }), Order.countDocuments({ ...base, ...DELIVERED }), Order.countDocuments(base),
    ]);
    return { search: term, open, delivered: del, all };
  })() : null;
  const [total, orders] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query).select('orderCode orderDate status customer serviceVerification accountApproval orderFormCompleted createdAt')
      .populate('customer', 'name mobile').sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim).lean(),
  ]);
  const journeys = await loadJourneys(companyId, orders);
  const rows = orders.map((o) => {
    const j = journeys.get(String(o._id));
    const p = promise(j.form, j.bar);
    return {
      orderCode: o.orderCode, ...who(o, j.form), orderDate: o.orderDate || o.createdAt,
      promised: p.promised, lateDays: p.lateDays, promiseText: p.text,
      bar: j.bar, stage: BAR[j.bar], items: j.items.length, flag: orderFlags(o, j.bar),
    };
  });
  return { orders: rows, pagination: { page: pg, limit: lim, total, pages: Math.max(1, Math.ceil(total / lim)) }, searchCounts };
}

/** One order, in full; null if it isn't this company's. */
export async function orderView(companyId, orderCode) {
  const order = await Order.findOne({ companyId, orderCode })
    .select('orderCode orderDate status customer serviceVerification accountApproval orderFormCompleted statusHistory createdAt')
    .populate('customer', 'name mobile contactPerson').lean();
  if (!order) return null;
  const j = (await loadJourneys(companyId, [order], { full: true })).get(String(order._id));
  const p = promise(j.form, j.bar);

  // Timeline: dated events from every record.
  const ev = [];
  // A date-only record (dispatch dates are "YYYY-MM-DD") has no time of day: dayOnly.
  // It sorts at the end of its India day, after that day's timed events (a dispatch
  // on 5 Nov comes after production started at 10:35 on 5 Nov).
  const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  const add = (at, text) => {
    if (!validDate(at)) return;
    const dayOnly = DAY_ONLY.test(String(at));
    ev.push({ at: new Date(at), text, dayOnly, key: dayOnly ? new Date(`${at}T23:59:59+05:30`) : new Date(at) });
  };
  add(order.orderDate || order.createdAt, 'Order placed');
  const sv = order.serviceVerification || {};
  if (sv.status === 'verified') add(sv.verifiedAt, 'Deal verified by the Complaint team');
  if (sv.status === 'rejected') add(sv.verifiedAt, 'Deal rejected at verification');
  if (j.form) add(j.form.createdAt, 'Order form submitted');
  if (order.accountApproval?.status === 'approved') add(order.accountApproval.approvedAt, 'Payment checked by Accounts');
  for (const it of j.items) {
    for (const prod of it.linked.productions) {
      add(prod.startedAt, `${it.name}: production started (${prod.orderNo})`);
      add(prod.completedAt, `${it.name}: production finished (${prod.orderNo})`);
    }
    for (const q of it.linked.qcJobs) if (q.decision) add(q.decidedAt, `${it.name}: final QC ${q.decision === 'Pass' ? 'passed' : 'found something to correct'} (${q.jobId})`);
    for (const pk of it.linked.packing) if (['Packed', 'Dispatched'].includes(pk.status)) add(pk.at, `${it.name}: packed${pk.serial ? ` (${pk.serial})` : ''}`);
    for (const d of it.linked.dispatch) {
      add(d.dispatchedOn, `${it.name}: dispatched (${d.dispatchId})`);
      add(d.deliveredOn, `${it.name}: delivered`);
      if (d.installation?.status === 'Scheduled') add(d.installation.scheduledDate, `${it.name}: installation scheduled`);
    }
  }
  ev.sort((a, b) => a.key - b.key);

  const notes = await OrderEnquiry.find({ company: companyId, orderCode }).sort({ at: -1 }).limit(50).lean();
  return {
    orderCode: order.orderCode,
    header: {
      ...who(order, j.form), orderDate: order.orderDate || order.createdAt,
      promised: p.promised, lateDays: p.lateDays, promiseText: p.text,
      dealVerification: sv.status || 'pending', paymentCheck: order.accountApproval?.status || 'pending',
      flag: orderFlags(order, j.bar),
    },
    bar: j.bar, barLabels: BAR,
    items: j.items.map((it) => ({ saleItemId: it.saleItemId, name: it.name, qty: it.qty, ready: it.ready, stage: it.stage, bar: it.bar, sentence: it.sentence, detail: it.detail, productionOrders: it.linked.productions.map((x) => ({ orderNo: x.orderNo, id: x._id })) })),
    timeline: ev.map((e) => ({ at: e.at, text: e.text, dayOnly: e.dayOnly })),
    notes: notes.map((n) => ({ _id: n._id, note: n.note, toldStage: n.toldStage, byName: n.byName, at: n.at })),
  };
}

/** Adds an enquiry note; the order's current stage is stamped on it. */
export async function addNote(companyId, orderCode, user, text) {
  const note = String(text || '').trim();
  if (!note) return { error: 'Type what the customer was told.', status: 400 };
  if (note.length > 500) return { error: 'A note can be at most 500 characters.', status: 400 };
  const order = await Order.findOne({ companyId, orderCode }).select('_id orderCode serviceVerification orderFormCompleted').lean();
  if (!order) return { error: 'Order not found.', status: 404 };
  const j = (await loadJourneys(companyId, [order])).get(String(order._id));
  const me = await User.findById(user._id).select('fullName username').lean();
  const doc = await OrderEnquiry.create({
    company: companyId, order: order._id, orderCode, note, toldStage: BAR[j.bar],
    by: user._id, byName: me?.fullName || me?.username || user.username || '',
  });
  return { note: { _id: doc._id, note: doc.note, toldStage: doc.toldStage, byName: doc.byName, at: doc.at } };
}
