// Dispatch trips to vendors (outsource-v2 slice 6, 2026-10-20 —
// docs/outsource-v2/dispatch-design-2026-10.md, slice-6-dispatch-sends.md).
//
// "Dispatch sends, Store receives." A trip = one vehicle, one date, one vendor
// (T2), with any number of that vendor's jobs:
//   - a "We pick up" PO (handover 5: picked up — Store's PO receive unchanged)
//   - a whole Outsource Order line (T6), moved by its material plan (slice 5):
//       handover 1 — Store gives its part (the REAL stock movement: combined
//                    sheets / lengths, items, cut pieces; each order booked its
//                    own share), Production gives its units / material
//       handover 2 — Dispatch delivers it: the line's trips go Sent
//                    (sendLineRequests — the send itself moves no stock)
// Returns (collect, Store receive) are slice 7.
import mongoose from 'mongoose';
import DispatchTrip from '../models/DispatchTrip.js';
import Vehicle, { normaliseVehicleNumber } from '../models/Vehicle.js';
import OutsourceOrder from '../models/OutsourceOrder.js';
import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import PackagingDispatchExpense from '../models/PackagingDispatchExpense.js';
import StoreTransferLog from '../models/StoreTransferLog.js';
import { Item } from '../models/Inventory.js';
import { HttpError, pushOrMergeLeftover } from './subChildPartMaterialSendService.js';
import { recordIssue, markOrderFullyIssued, heldBeyondOrders } from './materialReservationService.js';
import { stockTracked, unlabelledInStock, untrackedCount, unlabelledProblem, pickRule, pickProblem, checkPicked, checkPiecePick, move, IN_STOCK, noSerialCheck, acknowledged, logSkippedSerials } from './serialTrailService.js';
import { dimensionSignature } from './fabricationDemandService.js';
import { toMm } from '../utils/unitConversion.js';
import { sendLineRequests, receiveRequestCore, markVendorReady, requestNeeds, deriveStatus } from '../controllers/outsourceOrderController.js';
import { roundStepIndices, autoRequestOutsourceRuns, notifyAutoRequests, splitHandoffByUnits } from '../controllers/outsourceWorkController.js';
import { RecordSet, withVendorQty, takenBackQty, allBack } from './outsourceRequestService.js';
import { materialShortfall, shortText } from './outsourceMaterialReadyService.js';
import notificationService from './notificationService.js';
import { lineIsReceived } from './deliveryFollowUpService.js';
import { lostTotal } from '../utils/lostAtVendor.js';

// "2 not coming (lost at the vendor)" — a request's write-offs, for Dispatch (2026-10-26).
const lostNoteOf = (r) => (Number(r.lostQty) > 0
  ? `${r.lostQty} not coming (${(r.lost || []).map(l => `${l.qty}: ${l.reason}`).join('; ')})` : '');

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const LIVE_TRIP = ['Planned', 'Out'];
const LIVE_ORDER = ['Open', 'With vendor', 'Partly received'];
const PICKUP_PO_STATUSES = ['Sent', 'Acknowledged', 'Partially Received'];
const who = (user) => user?.fullName || user?.username || '';
const unitProcs = (order, unitIndex) => (unitIndex ? order.extraUnits?.[unitIndex - 1]?.processes || order.processes : order.processes);
const stamp = (user) => ({ at: new Date(), by: user?._id || null, byName: who(user) });

function logTrip(trip, user, action, summary) {
  trip.activity.push({ at: new Date(), by: user?._id || null, byName: who(user), action, summary });
}

// ── What a line needs, from its material plan ─────────────────────────────

const fmt = (n) => r3(n).toLocaleString('en-IN');
const holderOf = (r) => (r.kind === 'jobWork' ? r.jobWorkOrder : r.productionOrder);

// A line's pick list: what Store gives and what each production order gives.
//   store.groups — combined sheets / lengths (line.combinedMaterial)
//   store.items  — plain / parts, added up per item
//   store.cuts   — cut pieces, per item + size + cut length
//   store.wip    — a job-work order's pieces waiting at Store between trips
//   production   — per production order: units and material from its floor
export function linePickList(line) {
  const store = { groups: [], items: [], cuts: [], wip: [] };
  for (const c of line.combinedMaterial || []) {
    store.groups.push({
      key: `${c.kind}|${c.itemId}|${c.variantId}`, kind: c.kind, itemId: c.itemId, itemCode: c.itemCode, itemName: c.itemName,
      variantId: c.variantId, total: c.total, unit: c.unit, pieceSize: c.pieceSize, pieces: c.pieces, method: c.method,
    });
  }
  const items = new Map(); const cuts = new Map(); const production = new Map();
  for (const r of line.requests || []) {
    if (r.status === 'Released') continue;
    const prod = () => {
      const k = String(r.productionOrder);
      if (!production.has(k)) production.set(k, { productionOrder: r.productionOrder, orderCode: r.orderCode, units: 0, unitLabel: '', material: [] });
      return production.get(k);
    };
    for (const row of r.materialPlan || []) {
      if (row.kind === 'wip') {
        if (row.fromStore > 0) store.wip.push({ orderCode: r.orderCode, qty: row.fromStore, unit: row.unit, itemName: row.itemName });
        if (row.fromProduction > 0 && r.productionOrder) { const p = prod(); p.units += row.fromProduction; p.unitLabel = row.unit; p.unitName = row.itemName; }
        continue;
      }
      if (row.fromStore > 0 && row.kind === 'cutPieces') {
        const k = `${row.itemId}|${row.variantId}|${row.pieceSize}`;
        const e = cuts.get(k) || { key: k, itemId: row.itemId, itemCode: row.itemCode, itemName: row.itemName, variantId: row.variantId, cutLengthMm: row.pieceSize, cuts: 0 };
        e.cuts = r3(e.cuts + row.fromStore);
        cuts.set(k, e);
      } else if (row.fromStore > 0 && (row.kind === 'plain' || row.kind === 'parts')) {
        const k = String(row.itemId);
        const e = items.get(k) || { key: k, itemId: row.itemId, itemCode: row.itemCode, itemName: row.itemName, unit: row.unit, qty: 0 };
        e.qty = r3(e.qty + row.fromStore);
        items.set(k, e);
      }
      if (row.fromProduction > 0 && r.productionOrder) {
        const qty = row.kind === 'sheetArea' ? `${fmt(row.fromProduction / 1e6)} m²` : `${fmt(row.fromProduction)} ${row.unit}`;
        prod().material.push(`${qty} ${row.itemName}`);
      }
    }
  }
  store.items = [...items.values()];
  store.cuts = [...cuts.values()];
  return { store, production: [...production.values()] };
}

export function storeSummary(store) {
  const parts = [
    ...store.groups.map(g => `${g.pieces} ${g.kind === 'length' ? 'length' : 'sheet'}${g.pieces === 1 ? '' : 's'} ${g.itemName}`),
    ...store.items.map(i => `${fmt(i.qty)} ${i.unit} ${i.itemName}`),
    ...store.cuts.map(c => `${fmt(c.cuts)} cut piece(s) ${c.itemName}`),
    ...store.wip.map(w => `${fmt(w.qty)} ${w.unit} ${w.itemName} (${w.orderCode}, kept at Store)`),
  ];
  return parts.join(' · ');
}

// A line's Store part, as plan rows (every live request on it).
// "2 pcs Chamber frame + 4 Litre paint" — the part named (2026-10-23: "2 pcs" alone).
const prodSummary = (p) => [p.units ? `${fmt(p.units)} ${p.unitLabel || 'units'}${p.unitName ? ` ${p.unitName}` : ''}` : '', ...p.material].filter(Boolean).join(' + ');

// ── Waiting lists ─────────────────────────────────────────────────────────

async function liveTripRefs(companyId) {
  const trips = await DispatchTrip.find({ company: companyId, status: { $in: LIVE_TRIP } }).select('stops.jobs').lean();
  // (PO pickups are claimed by line — poPickupClaims.)
  const lines = new Set();
  for (const t of trips) for (const s of t.stops) for (const j of s.jobs) {
    if (j.kind === 'outsourceSend' && !j.delivered?.at) lines.add(String(j.lineId));
  }
  return { lines };
}

// Slice 7 — requests with the vendor, not on a live return trip, per line;
// "vendor says ready" ones first (T9).
function returnsOfLine(o, line) {
  // Partial returns (2026-10-26): only what's still with the vendor.
  const back = (line.requests || []).filter(r => r.status === 'Sent' && !r.returnDispatch?.trip && withVendorQty(r) > 0);
  if (!back.length) return null;
  return {
    outsourceOrder: o._id, orderNo: o.orderNo, lineId: line._id, itemName: line.itemName, itemCode: line.itemCode,
    stepNames: line.stepNames, qtyUnit: line.qtyUnit, expectedBy: line.expectedBy, sentAt: line.sentAt,
    requests: back.map(r => ({
      requestId: r._id, orderCode: r.orderCode, qty: withVendorQty(r), sentQty: r.qty, backQty: takenBackQty(r),
      // Written off as not coming (2026-10-26): Dispatch sees why fewer are left.
      lostQty: r.lostQty || 0, lost: (r.lost || []).map(l => ({ qty: l.qty, reason: l.reason, from: l.from })),
      vendorReady: r.vendorReady?.at ? r.vendorReady : null,
      short: r.short?.at ? r.short : null,
    })),
    ready: back.some(r => r.vendorReady?.at),
  };
}

// PO pickups by line (2026-10-26): which PO lines a trip has claimed — planned,
// or picked up but not yet received at Store. A line left "for later" is free
// again; a received one is done. An older job with no poLines claims the
// whole PO (wholePo) under the rule it was made with: until picked up, and
// after that unless the PO is Partially Received.
async function poPickupClaims(companyId, poIds = null) {
  const q = { company: companyId, status: { $ne: 'Cancelled' }, 'stops.jobs.kind': 'poPickup' };
  if (poIds) q['stops.jobs.purchase'] = { $in: poIds };
  const trips = await DispatchTrip.find(q).select('tripNo stops').lean();
  const lines = new Map();
  const wholePo = new Map();
  for (const t of trips) for (const s of t.stops) for (const j of s.jobs) {
    if (j.kind !== 'poPickup') continue;
    if (!(j.poLines || []).length) {
      const prev = wholePo.get(String(j.purchase));
      if (!prev || prev.pickedUp) wholePo.set(String(j.purchase), { tripNo: t.tripNo, pickedUp: !!j.pickedUp?.at });
      continue;
    }
    for (const e of j.poLines) {
      if (e.later?.at || e.received?.at) continue;
      lines.set(String(e.lineId), { tripNo: t.tripNo, state: e.pickedUp?.at ? 'picked' : 'planned' });
    }
  }
  return { lines, wholePo };
}

const wholePoBlocks = (whole, po) => !!whole && (!whole.pickedUp || po.status !== 'Partially Received');

// A PO line Dispatch can still put on a trip.
const poLineOpen = (line, claims) => !line.cancelled?.at && !lineIsReceived(line) && !claims.lines.has(String(line._id));

// "2 pcs thickness 1.5 × width 1250 × length 2550" — a fabrication line's sizes.
const poLineSizes = (line) => (line.fabricationDimensionLines || [])
  .map(d => `${d.quantity} pcs ${Object.entries(d.values || {}).map(([k, v]) => `${k} ${v}`).join(' × ')}`).join(' · ');

const populatePoLinePrs = (q) => q.populate('items.purchaseRequest', 'status').populate('items.purchaseRequests', 'status');

const lineWaiting = (line) => {
  const live = (line.requests || []).filter(r => r.status !== 'Released');
  return live.length > 0 && live.every(r => r.status === 'Ordered') && !line.dispatch?.trip;
};

// Everything waiting for a trip, by vendor: [{ vendor, vendorName, address,
// phone, purchase: [...], outsource: [...] }].
export async function waitingForDispatch(companyId, { unit = null } = {}) {
  const { lines } = await liveTripRefs(companyId);
  const vendors = new Map();
  const vendorEntry = (id, name) => {
    const k = String(id);
    if (!vendors.has(k)) vendors.set(k, { vendor: id, vendorName: name || '', purchase: [], outsource: [], returns: [] });
    return vendors.get(k);
  };

  const poQuery = { companyId, transportBy: 'Company', status: { $in: PICKUP_PO_STATUSES } };
  if (unit) poQuery.unit = unit;
  const purchases = await populatePoLinePrs(Purchase.find(poQuery)
    .select('purchaseOrderNumber supplier items orderDate expectedDeliveryDate deliveryClock status')).lean();
  const claims = await poPickupClaims(companyId, purchases.map(p => p._id));
  for (const po of purchases) {
    if (wholePoBlocks(claims.wholePo.get(String(po._id)), po)) continue; // an older whole-PO pickup
    // By line (2026-10-26): only the lines not received and not on a trip.
    const open = (po.items || []).filter(l => poLineOpen(l, claims));
    if (!open.length) continue;
    vendorEntry(po.supplier).purchase.push({
      // No money here (2026-10-26): Dispatch picks goods up, it doesn't need the price.
      purchase: po._id, poNumber: po.purchaseOrderNumber, status: po.status,
      expectedDeliveryDate: po.expectedDeliveryDate, deliveryClock: po.deliveryClock,
      items: open.map(i => ({ lineId: i._id, itemName: i.itemName, quantity: i.quantity, purchaseUnit: i.purchaseUnit || '', sizes: poLineSizes(i), expectedDeliveryDate: i.expectedDeliveryDate })),
    });
  }

  const orders = await OutsourceOrder.find({ company: companyId, status: { $in: LIVE_ORDER } })
    .select('orderNo vendor vendorName lines status').lean();
  for (const o of orders) {
    for (const line of o.lines || []) {
      const back = returnsOfLine(o, line);
      if (back) vendorEntry(o.vendor, o.vendorName).returns.push(back);
      if (!lineWaiting(line) || lines.has(String(line._id))) continue;
      const pick = linePickList(line);
      // Store's material not all in stock, or a part still being built for this
      // order → can't go on a trip.
      const short = await materialShortfall(companyId, line.requests, { orderId: o._id });
      vendorEntry(o.vendor, o.vendorName).outsource.push({
        outsourceOrder: o._id, orderNo: o.orderNo, lineId: line._id, itemName: line.itemName, itemCode: line.itemCode,
        stepNames: line.stepNames, qty: line.qty, qtyUnit: line.qtyUnit, expectedBy: line.expectedBy,
        orderCodes: line.requests.filter(r => r.status !== 'Released').map(r => r.orderCode),
        storeSummary: storeSummary(pick.store),
        production: pick.production.map(p => ({ orderCode: p.orderCode, summary: prodSummary(p) })),
        materialShort: short, materialWarning: shortText(short), sendable: short.length === 0,
      });
    }
  }

  const ids = [...vendors.keys()];
  const sups = ids.length ? await Supplier.find({ _id: { $in: ids } }).select('supplierName address phone contactPerson').lean() : [];
  const supById = new Map(sups.map(s => [String(s._id), s]));
  return [...vendors.values()].map(v => {
    const s = supById.get(String(v.vendor));
    v.returns.sort((a, b) => Number(b.ready) - Number(a.ready));
    return {
      ...v, vendorName: s?.supplierName || v.vendorName, phone: s?.phone || '', contactPerson: s?.contactPerson || '',
      address: s?.address ? [s.address.street, s.address.city, s.address.state].filter(Boolean).join(', ') : '',
    };
  }).sort((a, b) => a.vendorName.localeCompare(b.vendorName));
}

// ── Trips ─────────────────────────────────────────────────────────────────

async function nextTripNo(companyId) {
  const last = await DispatchTrip.find({ company: companyId }).select('tripNo').lean();
  const max = last.reduce((m, t) => Math.max(m, Number(String(t.tripNo).replace(/\D/g, '')) || 0), 0);
  return `TRP-${String(max + 1).padStart(4, '0')}`;
}

function jobDone(j) {
  if (j.kind === 'poPickup') {
    // By line: each picked up (by Dispatch, or at Store's receive) or left for later.
    return (j.poLines || []).length ? j.poLines.every(e => e.pickedUp?.at || e.later?.at) : !!j.pickedUp?.at;
  }
  if (j.kind === 'outsourceReturn') return (j.returns || []).every(x => x.collected?.at || x.short?.at);
  return !!j.delivered?.at;
}

export function deriveTripStatus(trip) {
  if (trip.status === 'Cancelled') return 'Cancelled';
  const jobs = trip.stops.flatMap(s => s.jobs);
  if (jobs.length && jobs.every(jobDone)) return 'Done';
  // A pickup with some of its lines picked up has started too (2026-10-26).
  const started = (j) => jobDone(j) || (j.poLines || []).some(e => e.pickedUp?.at);
  return jobs.some(started) ? 'Out' : 'Planned';
}

const anyHandover = (trip) => trip.stops.some(s => s.jobs.some(j => j.pickedUp?.at || j.delivered?.at
  || (j.poLines || []).some(e => e.pickedUp?.at || e.received?.at)
  || j.store?.handedOver?.at || (j.production || []).some(p => p.handedOver?.at)
  || (j.returns || []).some(x => x.collected?.at || x.short?.at)));

// body: { vendor, date, vehicleId | oneTimeVehicle{ number, type, ownership,
//   transporterName, transporterPhone }, saveAsRegular, driverName,
//   driverPhone, freight{ amount, paidBy }, challanNo, ewayBillNo, notes,
//   jobs: [{ kind: 'poPickup', purchase } | { kind: 'outsourceSend', outsourceOrder, lineId }] }
// A trip's vehicle, driver and freight from a request body — shared by
// creating a trip and changing it (2026-10-24). Throws on anything missing.
async function readTripVehicle(body, companyId) {
  // Vehicle (T7): a regular one, or one typed for this trip only.
  let vehicle = null; let vehicleNumber = ''; let ownership = 'Own'; let oneTime = null;
  if (body.vehicleId) {
    vehicle = await Vehicle.findOne({ _id: body.vehicleId, company: companyId });
    if (!vehicle) throw new HttpError(404, 'Vehicle not found.');
    if (!vehicle.active) throw new HttpError(400, `${vehicle.number} is inactive.`);
    vehicleNumber = vehicle.number; ownership = vehicle.ownership;
  } else {
    const v = body.oneTimeVehicle || {};
    vehicleNumber = normaliseVehicleNumber(v.number);
    if (!vehicleNumber) throw new HttpError(400, 'Pick a vehicle, or type the vehicle number.');
    ownership = v.ownership === 'Own' ? 'Own' : 'Hired';
    oneTime = { number: vehicleNumber, type: v.type || 'Other', transporterName: String(v.transporterName || '').trim(), transporterPhone: String(v.transporterPhone || '').trim() };
  }
  const driverName = String(body.driverName ?? vehicle?.driverName ?? '').trim() || vehicle?.driverName || '';
  const driverPhone = String(body.driverPhone ?? vehicle?.driverPhone ?? '').trim() || vehicle?.driverPhone || '';

  // Freight — only for a hired vehicle (T3).
  let freight = { amount: 0, paidBy: null, expenseId: null };
  if (ownership === 'Hired') {
    const amount = Number(body.freight?.amount);
    if (!(amount > 0)) throw new HttpError(400, 'Enter the freight for the hired vehicle.');
    const paidBy = ['Cash', 'Bank', 'Transporter bills'].includes(body.freight?.paidBy) ? body.freight.paidBy : null;
    if (!paidBy) throw new HttpError(400, 'Say how the freight is paid (cash, bank, or the transporter bills later).');
    freight = { amount: r3(amount), paidBy, expenseId: null };
  }
  return { vehicle, vehicleNumber, ownership, oneTime, driverName, driverPhone, freight };
}

// "Save as regular" — a one-time vehicle joins the list (or is matched).
async function saveAsRegular(v, companyId, user) {
  let vehicle = await Vehicle.findOne({ company: companyId, number: v.vehicleNumber });
  if (!vehicle) {
    vehicle = await Vehicle.create({
      company: companyId, number: v.vehicleNumber, type: ['Tempo', 'Pickup', 'Truck', 'Other'].includes(v.oneTime.type) ? v.oneTime.type : 'Other',
      ownership: v.ownership, transporterName: v.oneTime.transporterName, transporterPhone: v.oneTime.transporterPhone,
      driverName: v.driverName, driverPhone: v.driverPhone, createdBy: user._id,
    });
  }
  return vehicle;
}

export async function createTrip(body, user) {
  const companyId = user.companyId;
  const jobsIn = Array.isArray(body.jobs) ? body.jobs : [];
  if (!jobsIn.length) throw new HttpError(400, 'Pick at least one job for the trip.');
  if (!body.date) throw new HttpError(400, 'Pick the trip date.');
  const veh = await readTripVehicle(body, companyId);
  let { vehicle, oneTime } = veh;
  const { vehicleNumber, ownership, driverName, driverPhone, freight } = veh;

  // Jobs — all for one vendor (T2), each still waiting.
  const { lines } = await liveTripRefs(companyId);
  const takenHere = new Set(); // PO lines already put on this trip
  let vendorId = body.vendor ? String(body.vendor) : null;
  const sameVendor = (id, label) => {
    if (!vendorId) vendorId = String(id);
    else if (vendorId !== String(id)) throw new HttpError(400, `${label} is for a different vendor — one trip goes to one vendor.`);
  };
  const jobs = []; const ordersToStamp = new Map();
  for (const j of jobsIn) {
    if (j.kind === 'poPickup') {
      const po = await populatePoLinePrs(Purchase.findOne({ _id: j.purchase, companyId }).select('purchaseOrderNumber supplier transportBy status items')).lean();
      if (!po) throw new HttpError(404, 'Purchase order not found.');
      if (po.transportBy !== 'Company') throw new HttpError(400, `${po.purchaseOrderNumber}: the vendor delivers this one.`);
      if (!PICKUP_PO_STATUSES.includes(po.status)) throw new HttpError(400, `${po.purchaseOrderNumber} is ${po.status} — nothing to pick up.`);
      const claims = await poPickupClaims(companyId, [po._id]);
      const whole = claims.wholePo.get(String(po._id));
      if (wholePoBlocks(whole, po)) throw new HttpError(400, `${po.purchaseOrderNumber} is already on trip ${whole.tripNo}.`);
      // By line (2026-10-26): the lines Dispatch ticked — none sent = every open line.
      const wanted = Array.isArray(j.lineIds) && j.lineIds.length
        ? j.lineIds.map(String)
        : (po.items || []).filter(l => poLineOpen(l, claims)).map(l => String(l._id));
      if (!wanted.length) throw new HttpError(400, `${po.purchaseOrderNumber}: nothing left to pick up.`);
      const chosen = wanted.map(id => {
        const l = (po.items || []).find(x => String(x._id) === id);
        if (!l) throw new HttpError(404, `${po.purchaseOrderNumber}: a line is not on this PO.`);
        if (l.cancelled?.at) throw new HttpError(400, `${po.purchaseOrderNumber} · ${l.itemName} was cancelled.`);
        if (lineIsReceived(l)) throw new HttpError(400, `${po.purchaseOrderNumber} · ${l.itemName} is already received.`);
        const c = claims.lines.get(id);
        if (c) throw new HttpError(400, `${po.purchaseOrderNumber} · ${l.itemName} is already on trip ${c.tripNo}.`);
        if (takenHere.has(id)) throw new HttpError(400, `${po.purchaseOrderNumber} · ${l.itemName} is picked twice.`);
        takenHere.add(id);
        return l;
      });
      sameVendor(po.supplier, po.purchaseOrderNumber);
      jobs.push({
        kind: 'poPickup', purchase: po._id, poNumber: po.purchaseOrderNumber,
        poLines: chosen.map(l => ({ lineId: l._id, itemName: l.itemName, quantity: l.quantity, unit: l.purchaseUnit || '' })),
      });
    } else if (j.kind === 'outsourceSend') {
      const key = String(j.outsourceOrder);
      const order = ordersToStamp.get(key) || await OutsourceOrder.findOne({ _id: j.outsourceOrder, company: companyId });
      if (!order) throw new HttpError(404, 'Outsource order not found.');
      if (!LIVE_ORDER.includes(order.status)) throw new HttpError(400, `${order.orderNo} is ${order.status}.`);
      const line = order.lines.id(j.lineId);
      if (!line) throw new HttpError(404, `${order.orderNo}: line not found.`);
      if (lines.has(String(line._id)) || line.dispatch?.trip) throw new HttpError(400, `${order.orderNo} · ${line.itemName} is already on a trip.`);
      if (!lineWaiting(line)) throw new HttpError(400, `${order.orderNo} · ${line.itemName} has already gone out (a line goes out whole).`);
      // No trip (vehicle, freight) for material that isn't ready yet (2026-10-23).
      const short = await materialShortfall(companyId, line.requests, { orderId: order._id });
      if (short.length) throw new HttpError(400, `${order.orderNo} · ${line.itemName} can't go yet — ${shortText(short)}. Plan its trip once it's ready.`);
      sameVendor(order.vendor, order.orderNo);
      const pick = linePickList(line);
      const sum = storeSummary(pick.store);
      jobs.push({
        kind: 'outsourceSend', outsourceOrder: order._id, orderNo: order.orderNo, lineId: line._id,
        itemName: line.itemName, stepNames: line.stepNames, bringBack: !!j.bringBack,
        store: { needed: !!sum, summary: sum, picks: [] },
        production: pick.production.map(p => ({ productionOrder: p.productionOrder, orderCode: p.orderCode, summary: prodSummary(p) })),
      });
      ordersToStamp.set(key, order);
    } else if (j.kind === 'outsourceReturn') {
      // Slice 7 — bring requests back from the vendor (by request, T6).
      const key = String(j.outsourceOrder);
      const order = ordersToStamp.get(key) || await OutsourceOrder.findOne({ _id: j.outsourceOrder, company: companyId });
      if (!order) throw new HttpError(404, 'Outsource order not found.');
      if (!LIVE_ORDER.includes(order.status)) throw new HttpError(400, `${order.orderNo} is ${order.status}.`);
      const line = order.lines.id(j.lineId);
      if (!line) throw new HttpError(404, `${order.orderNo}: line not found.`);
      const ids = Array.isArray(j.requestIds) ? j.requestIds : [];
      if (!ids.length) throw new HttpError(400, `${order.orderNo} · ${line.itemName}: pick the requests to collect.`);
      const reqs = ids.map(id => line.requests.id(id));
      for (const r of reqs) {
        if (!r) throw new HttpError(404, `${order.orderNo}: a request is not on this line.`);
        if (r.status !== 'Sent') throw new HttpError(400, `${r.orderCode} isn't with the vendor.`);
        if (r.returnDispatch?.trip) throw new HttpError(400, `${r.orderCode} is already on trip ${r.returnDispatch.tripNo}.`);
        if (!(withVendorQty(r) > 0)) throw new HttpError(400, `${r.orderCode}: nothing of it is still with the vendor.`);
      }
      sameVendor(order.vendor, order.orderNo);
      jobs.push({
        kind: 'outsourceReturn', outsourceOrder: order._id, orderNo: order.orderNo, lineId: line._id,
        itemName: line.itemName, stepNames: line.stepNames,
        returns: reqs.map(r => ({ requestId: r._id, orderCode: r.orderCode, qty: withVendorQty(r), unit: line.qtyUnit, lostNote: lostNoteOf(r) })),
      });
      ordersToStamp.set(key, order);
    } else {
      throw new HttpError(400, 'Unknown job.');
    }
  }
  const vendor = await Supplier.findOne({ _id: vendorId, companyId }).select('supplierName').lean();
  if (!vendor) throw new HttpError(404, 'Vendor not found.');

  // "Save as regular" — the one-time vehicle joins the list (or is matched).
  if (oneTime && body.saveAsRegular) {
    vehicle = await saveAsRegular(veh, companyId, user);
    oneTime = null;
  }

  const trip = new DispatchTrip({
    tripNo: await nextTripNo(companyId), company: companyId, unit: user.unit || '', date: new Date(body.date),
    vehicle: vehicle?._id || null, oneTimeVehicle: oneTime || undefined, vehicleNumber, ownership, driverName, driverPhone,
    freight, notes: String(body.notes || '').trim(), createdBy: user._id,
    stops: [{ vendor: vendor._id, vendorName: vendor.supplierName, challanNo: String(body.challanNo || '').trim(), ewayBillNo: String(body.ewayBillNo || '').trim(), jobs }],
  });
  const jobText = (j) => (j.kind === 'poPickup' ? `pick up ${j.poNumber}${j.poLines?.length ? ` (${j.poLines.map(e => e.itemName).join(', ')})` : ''}`
    : j.kind === 'outsourceReturn' ? `collect ${j.orderNo} · ${j.itemName} (${j.returns.map(x => x.orderCode).join(', ')})`
    : `send ${j.orderNo} · ${j.itemName}${j.bringBack ? ' (the vehicle waits and brings it back)' : ''}`);
  logTrip(trip, user, 'created', `Planned for ${new Date(body.date).toLocaleDateString('en-IN')} — ${vehicleNumber}${driverName ? `, ${driverName}` : ''} → ${vendor.supplierName}: ${jobs.map(jobText).join('; ')}.`);
  await trip.save();

  for (const order of ordersToStamp.values()) {
    for (const j of jobs.filter(x => x.kind === 'outsourceSend' && String(x.outsourceOrder) === String(order._id))) {
      order.lines.id(j.lineId).dispatch = { trip: trip._id, tripNo: trip.tripNo, bringBack: !!j.bringBack };
    }
    for (const j of jobs.filter(x => x.kind === 'outsourceReturn' && String(x.outsourceOrder) === String(order._id))) {
      const line = order.lines.id(j.lineId);
      for (const e of j.returns) line.requests.id(e.requestId).returnDispatch = { trip: trip._id, tripNo: trip.tripNo };
    }
    order.activity.push({ at: new Date(), by: user._id, byName: who(user), action: 'dispatch', summary: `On Dispatch trip ${trip.tripNo} (${new Date(body.date).toLocaleDateString('en-IN')}, ${vehicleNumber}).` });
    await order.save();
  }

  if (freight.amount > 0) {
    const exp = await PackagingDispatchExpense.create({
      companyId, category: 'Transporting Cost', amount: freight.amount, date: new Date(body.date),
      notes: `Freight — ${trip.tripNo} · ${vehicleNumber} → ${vendor.supplierName} · paid by ${freight.paidBy}`,
      addedBy: user._id, dispatchTrip: trip._id,
    });
    trip.freight.expenseId = exp._id;
    await trip.save();
  }
  return trip;
}

export async function cancelTrip(trip, user) {
  if (trip.status === 'Cancelled') throw new HttpError(400, 'Already cancelled.');
  if (anyHandover(trip)) throw new HttpError(400, 'Something on this trip has already been handed over — it can\'t be cancelled.');
  for (const j of trip.stops.flatMap(s => s.jobs).filter(x => x.kind === 'outsourceReturn')) {
    const order = await OutsourceOrder.findOne({ _id: j.outsourceOrder, company: trip.company });
    const line = order?.lines.id(j.lineId);
    if (!line) continue;
    for (const e of j.returns) {
      const r = line.requests.id(e.requestId);
      if (r && String(r.returnDispatch?.trip) === String(trip._id)) r.returnDispatch = { trip: null, tripNo: '' };
    }
    await order.save();
  }
  for (const j of trip.stops.flatMap(s => s.jobs).filter(x => x.kind === 'outsourceSend')) {
    const order = await OutsourceOrder.findOne({ _id: j.outsourceOrder, company: trip.company });
    const line = order?.lines.id(j.lineId);
    if (line && String(line.dispatch?.trip) === String(trip._id)) {
      line.dispatch = { trip: null, tripNo: '', bringBack: false };
      order.activity.push({ at: new Date(), by: user._id, byName: who(user), action: 'dispatch', summary: `Dispatch trip ${trip.tripNo} cancelled — ${line.itemName} is waiting for a trip again.` });
      await order.save();
    }
  }
  if (trip.freight?.expenseId) await PackagingDispatchExpense.deleteOne({ _id: trip.freight.expenseId });
  trip.freight.expenseId = null;
  trip.status = 'Cancelled';
  trip.cancelledAt = new Date();
  logTrip(trip, user, 'cancelled', 'Cancelled — its jobs are waiting for a trip again.');
  await trip.save();
  return trip;
}

// Change a trip's vehicle / driver / date (2026-10-24 — the user: once Store
// had handed over there was no way to change the vehicle, and cancel is
// refused then). Allowed while the trip is Planned — nothing delivered,
// picked up or collected yet — even after Store / Production's handovers:
// the material stays with Dispatch; stock and reservations don't move.
// Freight follows the same rule as at creation (hired only): own → hired adds
// the "Transporting Cost" expense, hired → hired updates it, hired → own
// removes it. A reason is required; the trip and every Outsource Order on it
// record the change.
export async function updateTripDetails(trip, body, user) {
  if (trip.status !== 'Planned') {
    throw new HttpError(400, trip.status === 'Cancelled' ? 'This trip is cancelled.' : `${trip.tripNo} has already started (something was delivered, picked up or collected) — its vehicle and date can't change now.`);
  }
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Say why the trip is changing (e.g. breakdown, the vendor asked for another day).');
  if (!body.date || Number.isNaN(new Date(body.date).getTime())) throw new HttpError(400, 'Pick the trip date.');
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const newDate = new Date(body.date);
  if (newDate < start) throw new HttpError(400, "The trip date can't be in the past.");
  const companyId = trip.company;
  const veh = await readTripVehicle(body, companyId);
  let { vehicle, oneTime } = veh;
  if (oneTime && body.saveAsRegular) { vehicle = await saveAsRegular(veh, companyId, user); oneTime = null; }

  const before = { vehicleNumber: trip.vehicleNumber, driverName: trip.driverName, date: trip.date, ownership: trip.ownership, freight: trip.freight?.amount || 0 };
  const vendorName = trip.stops[0]?.vendorName || '';
  trip.vehicle = vehicle?._id || null;
  trip.oneTimeVehicle = oneTime || undefined;
  trip.vehicleNumber = veh.vehicleNumber;
  trip.ownership = veh.ownership;
  trip.driverName = veh.driverName;
  trip.driverPhone = veh.driverPhone;
  trip.date = newDate;

  // Freight — the expense follows the vehicle.
  const oldExpenseId = trip.freight?.expenseId || null;
  if (veh.ownership === 'Hired') {
    const notes = `Freight — ${trip.tripNo} · ${veh.vehicleNumber} → ${vendorName} · paid by ${veh.freight.paidBy}`;
    let expenseId = oldExpenseId;
    if (oldExpenseId && await PackagingDispatchExpense.exists({ _id: oldExpenseId })) {
      await PackagingDispatchExpense.updateOne({ _id: oldExpenseId }, { $set: { amount: veh.freight.amount, date: newDate, notes } });
    } else {
      expenseId = (await PackagingDispatchExpense.create({ companyId, category: 'Transporting Cost', amount: veh.freight.amount, date: newDate, notes, addedBy: user._id, dispatchTrip: trip._id }))._id;
    }
    trip.freight = { amount: veh.freight.amount, paidBy: veh.freight.paidBy, expenseId };
  } else {
    if (oldExpenseId) await PackagingDispatchExpense.deleteOne({ _id: oldExpenseId });
    trip.freight = { amount: 0, paidBy: null, expenseId: null };
  }

  const day = (d) => new Date(d).toLocaleDateString('en-IN');
  const parts = [];
  if (before.vehicleNumber !== trip.vehicleNumber) parts.push(`vehicle ${before.vehicleNumber} → ${trip.vehicleNumber}`);
  if ((before.driverName || '') !== (trip.driverName || '')) parts.push(`driver ${before.driverName || '—'} → ${trip.driverName || '—'}`);
  if (day(before.date) !== day(trip.date)) parts.push(`date ${day(before.date)} → ${day(trip.date)}`);
  if (before.freight !== (trip.freight.amount || 0)) parts.push(`freight ₹${before.freight} → ₹${trip.freight.amount || 0}`);
  // "The vehicle waits & brings it back", per send not delivered yet
  // (2026-10-24 — a hired vehicle may refuse to wait). body.bringBack: { jobId: true | false }.
  const bb = body.bringBack && typeof body.bringBack === 'object' ? body.bringBack : {};
  const bbChanged = [];
  for (const j of trip.stops.flatMap(s => s.jobs)) {
    if (j.kind !== 'outsourceSend' || j.delivered?.at || !Object.prototype.hasOwnProperty.call(bb, String(j._id))) continue;
    const v = !!bb[String(j._id)];
    if (v === !!j.bringBack) continue;
    j.bringBack = v;
    bbChanged.push({ j, v });
    parts.push(`${j.orderNo} · ${j.itemName}: ${v ? 'the vehicle now waits & brings it back' : 'the vehicle no longer waits (collect later)'}`);
  }
  const what = parts.length ? parts.join(', ') : 'details saved, nothing different';
  logTrip(trip, user, 'changed', `Changed: ${what} — ${reason}.`);
  await trip.save();
  for (const { j, v } of bbChanged) {
    await OutsourceOrder.updateOne({ _id: j.outsourceOrder, company: companyId }, { $set: { 'lines.$[l].dispatch.bringBack': v } }, { arrayFilters: [{ 'l._id': j.lineId }] });
  }

  const orderIds = [...new Set(trip.stops.flatMap(s => s.jobs).filter(j => j.outsourceOrder).map(j => String(j.outsourceOrder)))];
  for (const id of orderIds) {
    await OutsourceOrder.updateOne({ _id: id, company: companyId }, { $push: { activity: {
      at: new Date(), by: user._id, byName: who(user), action: 'dispatch',
      summary: `Dispatch trip ${trip.tripNo} changed: ${what} (${reason}). Now ${trip.vehicleNumber}, ${day(trip.date)}.`,
    } } });
  }
  return { trip, what };
}

export function findJob(trip, jobId) {
  for (const s of trip.stops) {
    const j = s.jobs.id(jobId);
    if (j) return { stop: s, job: j };
  }
  throw new HttpError(404, 'Job not found on this trip.');
}

const assertLiveTrip = (trip) => {
  if (!LIVE_TRIP.includes(trip.status)) throw new HttpError(400, `This trip is ${trip.status}.`);
};

// ── Handover 1 — Store ───────────────────────────────────────────────────

// Same cross-section as the catalog size: a sheet's thickness; a length's
// every value except its length.
function sameSection(kind, a, b) {
  if (kind === 'sheetArea') return Number(a?.thickness) === Number(b?.thickness);
  const strip = (v) => { const { length, ...rest } = v || {}; return dimensionSignature(rest); };
  return strip(a) === strip(b);
}
const capacityOf = (kind, v) => (kind === 'sheetArea'
  ? (Number(v?.values?.width) || 0) * (Number(v?.values?.length) || 0)
  : (Number(v?.values?.length) || 0));

// What Store sees for one job: each group / item / cut with what's in stock.
export async function storeView(trip, job) {
  const order = await OutsourceOrder.findOne({ _id: job.outsourceOrder, company: trip.company }).lean();
  const line = order?.lines.find(l => String(l._id) === String(job.lineId));
  if (!line) throw new HttpError(404, 'The Outsource Order line no longer exists.');
  const { store } = linePickList(line);
  for (const g of store.groups) {
    const item = await Item.findOne({ _id: g.itemId, companyId: trip.company }).select('dimensionVariants').lean();
    const catalog = (item?.dimensionVariants || []).find(v => String(v._id) === String(g.variantId));
    g.catalog = catalog ? { _id: catalog._id, values: catalog.values, subStock: catalog.subStock || 0, capacity: capacityOf(g.kind, catalog) } : null;
    g.leftovers = (item?.dimensionVariants || []).filter(v => v.isLeftover && (v.subStock || 0) > 0 && catalog && sameSection(g.kind, v.values, catalog.values))
      .map(v => ({ _id: v._id, values: v.values, subStock: v.subStock, capacity: capacityOf(g.kind, v) }));
  }
  for (const i of store.items) {
    const item = await Item.findOne({ _id: i.itemId, companyId: trip.company }).select('qty unit').lean();
    i.inStock = item?.qty || 0;
  }
  for (const c of store.cuts) {
    const item = await Item.findOne({ _id: c.itemId, companyId: trip.company }).select('dimensionVariants').lean();
    const catalog = (item?.dimensionVariants || []).find(v => String(v._id) === String(c.variantId));
    c.options = (item?.dimensionVariants || []).filter(v => (v.subStock || 0) > 0 && catalog && sameSection('length', v.values, catalog.values))
      .map(v => ({ _id: v._id, values: v.values, subStock: v.subStock, isLeftover: !!v.isLeftover, capacity: capacityOf('length', v) }));
  }
  return { store, line: { _id: line._id, itemName: line.itemName, stepNames: line.stepNames }, orderNo: order.orderNo };
}

// The leftover Store keeps after cutting, converted to mm (null = none / bad).
function leftoverValuesFrom(kind, base, lo) {
  if (!lo || !(Number(lo.pieceCount) > 0)) return null;
  const length = toMm(lo.lengthValue, lo.lengthUnit);
  if (length == null) throw new HttpError(400, 'Enter the kept offcut\'s length with a unit (mm, cm, m…).');
  const values = { ...(base || {}), length };
  if (kind === 'sheetArea') {
    const width = toMm(lo.widthValue, lo.widthUnit);
    if (width == null) throw new HttpError(400, 'A sheet offcut needs its width too.');
    values.width = width;
  }
  return values;
}

// What this handover takes from stock held for other orders, one sentence per
// material. Reservations are on the catalog size, so a picked offcut takes none.
async function heldStockWarnings(companyId, line, picks) {
  const orderIds = (line.requests || []).filter(r => r.status !== 'Released').map(holderOf).filter(Boolean);
  if (!orderIds.length) return [];
  const asks = [];
  for (const p of picks) {
    if (p.type === 'item') asks.push({ itemId: p.i.itemId, name: p.i.itemName, qty: p.i.qty, stock: p.stock, unit: p.i.unit });
    if (p.type === 'group') {
      const fromCatalog = p.sources.find(s => String(s.variant._id) === String(p.catalog._id));
      if (fromCatalog) asks.push({ itemId: p.g.itemId, variantId: p.catalog._id, name: p.g.itemName, qty: fromCatalog.pieces, stock: p.catalog.subStock || 0, unit: p.g.kind === 'length' ? 'length(s)' : 'sheet(s)' });
    }
    if (p.type === 'cut' && String(p.src._id) === String(p.c.variantId)) asks.push({ itemId: p.c.itemId, variantId: p.src._id, name: p.c.itemName, qty: p.consumed, stock: p.src.subStock || 0, unit: 'length(s)' });
  }
  const warnings = [];
  for (const a of asks) {
    const held = await heldBeyondOrders({ itemId: a.itemId, variantId: a.variantId || null, companyId, orderIds, currentQty: a.stock, qty: a.qty });
    if (held) warnings.push(`${fmt(held.taken)} ${a.unit} of ${a.name} is reserved for earlier order(s): ${held.earlier.map(e => `${e.orderCode || 'another order'} (${fmt(e.remaining)})`).join(', ')}. Make sure they can still be supplied.`);
  }
  return warnings;
}

// Warnings someone has to read first: the screen shows them and sends
// acknowledgeWarnings. Nothing has moved.
const needConfirm = (list) => Object.assign(new HttpError(409, list.join(' ')), { confirmWarnings: list });

// body: { groups: { [key]: { sources: [{ variantId, pieces }], keptLeftover } },
//         cuts: { [key]: { sourceVariantId, stockPiecesConsumed, leftover } },
//         acknowledgeWarnings: Store has read the warnings }
// Everything is checked first; then stock moves and each order is booked.
export async function storeHandover(trip, job, body, user) {
  assertLiveTrip(trip);
  if (job.kind !== 'outsourceSend') throw new HttpError(400, 'Store hands over outsource material only.');
  if (job.store?.handedOver?.at) throw new HttpError(400, 'Store has already handed this over.');
  if (!job.store?.needed) throw new HttpError(400, 'Nothing on this job comes from Store.');
  const order = await OutsourceOrder.findOne({ _id: job.outsourceOrder, company: trip.company });
  const line = order?.lines.id(job.lineId);
  if (!line) throw new HttpError(404, 'The Outsource Order line no longer exists.');
  if (!lineWaiting({ ...line.toObject(), dispatch: null })) throw new HttpError(400, 'This line has already gone out.');
  const { store } = linePickList(line);

  // 1 — check everything, prepare the changes.
  const itemDocs = new Map();
  const itemDoc = async (id) => {
    const k = String(id);
    if (!itemDocs.has(k)) {
      const d = await Item.findOne({ _id: id, companyId: trip.company });
      if (!d) throw new HttpError(404, 'A material Item no longer exists.');
      itemDocs.set(k, d);
    }
    return itemDocs.get(k);
  };
  const picks = [];
  const consumedByCut = new Map(); // cut key → catalog pieces consumed
  const groupsIn = body?.groups || {};
  for (const g of store.groups) {
    const item = await itemDoc(g.itemId);
    const catalog = item.dimensionVariants.id(g.variantId);
    if (!catalog) throw new HttpError(400, `${g.itemName}: its size no longer exists.`);
    const input = groupsIn[g.key] || { sources: [{ variantId: String(catalog._id), pieces: g.pieces }] };
    const sources = (input.sources || []).map(s => ({ variant: item.dimensionVariants.id(s.variantId), pieces: Math.round(Number(s.pieces)) })).filter(s => s.pieces > 0);
    if (!sources.length) throw new HttpError(400, `${g.itemName}: pick what Store gives.`);
    let capacity = 0;
    for (const s of sources) {
      if (!s.variant) throw new HttpError(400, `${g.itemName}: a picked size no longer exists.`);
      if (!sameSection(g.kind, s.variant.values, catalog.values)) throw new HttpError(400, `${g.itemName}: a picked size isn't the same ${g.kind === 'sheetArea' ? 'thickness' : 'section'}.`);
      if ((s.variant.subStock || 0) < s.pieces) throw new HttpError(400, `${g.itemName}: only ${s.variant.subStock || 0} of a picked size in stock — need ${s.pieces}.`);
      capacity += capacityOf(g.kind, s.variant) * s.pieces;
    }
    if (capacity + 1e-6 < g.total) {
      const u = g.kind === 'sheetArea' ? ['m²', 1e6] : ['m', 1000];
      throw new HttpError(400, `${g.itemName}: what's picked covers ${fmt(capacity / u[1])} ${u[0]}, but this line needs ${fmt(g.total / u[1])} ${u[0]}.`);
    }
    const kept = leftoverValuesFrom(g.kind, catalog.values, input.keptLeftover);
    picks.push({ type: 'group', g, item, catalog, sources, kept, keptCount: kept ? Number(input.keptLeftover.pieceCount) : 0 });
  }
  const cutsIn = body?.cuts || {};
  for (const c of store.cuts) {
    const input = cutsIn[c.key];
    if (!input) throw new HttpError(400, `${c.itemName}: pick the stock size and how many pieces Store cuts from.`);
    const item = await itemDoc(c.itemId);
    const src = item.dimensionVariants.id(input.sourceVariantId);
    const consumed = Math.round(Number(input.stockPiecesConsumed));
    if (!src) throw new HttpError(400, `${c.itemName}: the picked size no longer exists.`);
    if (!(consumed > 0)) throw new HttpError(400, `${c.itemName}: enter how many stock pieces are cut.`);
    if ((src.subStock || 0) < consumed) throw new HttpError(400, `${c.itemName}: only ${src.subStock || 0} in stock — need ${consumed}.`);
    if (c.cutLengthMm > 0 && capacityOf('length', src) * consumed + 1e-6 < c.cuts * c.cutLengthMm) {
      throw new HttpError(400, `${c.itemName}: ${consumed} piece(s) cover ${fmt(capacityOf('length', src) * consumed)} mm, but ${fmt(c.cuts)} cuts × ${fmt(c.cutLengthMm)} mm need ${fmt(c.cuts * c.cutLengthMm)} mm.`);
    }
    const kept = leftoverValuesFrom('length', src.values, input.leftover);
    picks.push({ type: 'cut', c, item, src, consumed, kept, keptCount: kept ? Number(input.leftover.pieceCount) : 0 });
    consumedByCut.set(c.key, consumed);
  }
  // Serial number work step 2 (2026-10-31, §5.2): Store picks the serial
  // numbers / stickers of an item with tracked stock (body.serials[itemId] =
  // { unitIds, labelIds }); they're shared out to each request's order below.
  const serialPicks = new Map();
  const serialSkips = [];
  for (const i of store.items) {
    const item = await Item.findOne({ _id: i.itemId, companyId: trip.company }).select('qty name productionUse').lean();
    if (!item) throw new HttpError(404, `${i.itemName} no longer exists.`);
    if ((item.qty || 0) + 1e-9 < i.qty) throw new HttpError(400, `${i.itemName}: only ${fmt(item.qty || 0)} in stock — need ${fmt(i.qty)}.`);
    const waitingSticker = await unlabelledInStock(trip.company, i.itemId);
    const stickerBlock = unlabelledProblem({ qty: i.qty, stock: item.qty, unlabelled: waitingSticker, name: i.itemName });
    if (stickerBlock) throw new HttpError(400, stickerBlock);
    const tracked = await stockTracked(trip.company, i.itemId);
    const given = body?.serials?.[String(i.itemId)] || {};
    if (tracked.count > 0 || given.unitIds?.length || given.labelIds?.length) {
      const checked = checkPicked(given, tracked);
      if (checked.error) throw new HttpError(400, `${i.itemName}: ${checked.error}`);
      const rule = pickRule({ qty: i.qty, tracked: tracked.count, untracked: untrackedCount(item.qty, tracked.count, waitingSticker) });
      const problem = pickProblem(checked.unitIds.length + checked.labelIds.length, rule);
      if (problem) throw new HttpError(400, `${i.itemName}: ${problem}`);
      const skip = noSerialCheck({ itemId: i.itemId, name: i.itemName, picked: checked.unitIds.length + checked.labelIds.length, rule, tracked: tracked.count });
      if (skip) serialSkips.push(skip);
      serialPicks.set(String(i.itemId), { queue: [...checked.unitIds.map(id => ({ unit: id })), ...checked.labelIds.map(id => ({ label: id }))], use: item.productionUse });
    }
    picks.push({ type: 'item', i, stock: item.qty || 0 });
  }
  // Stock held for another order, or fewer serials than pieces: Store is warned,
  // never blocked, and has to say it read the warning. One box for both.
  const warnings = [...await heldStockWarnings(trip.company, line, picks), ...serialSkips.map(s => s.text)];
  if (warnings.length && !acknowledged(body?.acknowledgeWarnings)) throw needConfirm(warnings);

  // 2 — move the stock.
  const pickLog = [];
  for (const p of picks.filter(x => x.type === 'item')) {
    const updated = await Item.findOneAndUpdate(
      { _id: p.i.itemId, companyId: trip.company, qty: { $gte: p.i.qty } },
      { $inc: { qty: -p.i.qty } }, { new: true });
    if (!updated) throw new HttpError(400, `${p.i.itemName}: someone just used the stock — try again.`);
    pickLog.push({ type: 'item', itemName: p.i.itemName, qty: p.i.qty, unit: p.i.unit });
  }
  for (const p of picks.filter(x => x.type !== 'item')) {
    if (p.type === 'group') {
      for (const s of p.sources) s.variant.subStock = (s.variant.subStock || 0) - s.pieces;
      if (p.kept) pushOrMergeLeftover(p.item, p.catalog, p.kept, p.keptCount);
      pickLog.push({ type: 'group', itemName: p.g.itemName, sources: p.sources.map(s => ({ values: s.variant.values, pieces: s.pieces, isLeftover: !!s.variant.isLeftover })), keptLeftover: p.kept ? { values: p.kept, pieces: p.keptCount } : null });
    } else {
      p.src.subStock = (p.src.subStock || 0) - p.consumed;
      if (p.kept) pushOrMergeLeftover(p.item, p.src, p.kept, p.keptCount);
      pickLog.push({ type: 'cut', itemName: p.c.itemName, cuts: p.c.cuts, from: { values: p.src.values, pieces: p.consumed }, keptLeftover: p.kept ? { values: p.kept, pieces: p.keptCount } : null });
    }
  }
  for (const d of itemDocs.values()) if (d.isModified()) await d.save();

  // 3 — book each order its own share (reservation issued; a Sub Child Part's
  // raw material leaves Store whole, so its claim is fully issued).
  const cutTotals = new Map(store.cuts.map(c => [c.key, c.cuts]));
  const withStore = [];
  for (const r of line.requests.filter(x => x.status !== 'Released')) {
    const holder = holderOf(r);
    let any = false;
    for (const row of r.materialPlan || []) {
      if (!(row.fromStore > 0) || row.kind === 'wip') continue;
      any = true;
      let qty = row.fromStore;
      if (row.kind === 'sheetArea' || row.kind === 'length') qty = Number(row.storeShare) || 0;
      if (row.kind === 'cutPieces') {
        const k = `${row.itemId}|${row.variantId}|${row.pieceSize}`;
        qty = r3((consumedByCut.get(k) || 0) * row.fromStore / (cutTotals.get(k) || row.fromStore));
      }
      try {
        await recordIssue({ orderId: holder, itemId: row.itemId, variantId: row.kind === 'plain' || row.kind === 'parts' ? null : row.variantId, qty });
      } catch (e) { console.error('[DispatchTrip] recordIssue:', e.message); }
      // The picked serials of this item go to this request's order, its share first.
      const sp = (row.kind === 'plain' || row.kind === 'parts') ? serialPicks.get(String(row.itemId)) : null;
      if (sp?.queue.length) {
        const take = sp.queue.splice(0, Math.max(0, Math.round(qty)));
        const unitIds = take.filter(x => x.unit).map(x => x.unit);
        const labelIds = take.filter(x => x.label).map(x => x.label);
        const used = sp.use === 'UsedToMake';
        const place = { kind: 'Issued', order: holder, orderNo: r.orderCode || '' };
        if (unitIds.length) await move({ unitIds, place: { ...place, kind: used ? 'Used' : 'Issued' }, what: used ? 'Used in production (sent to the vendor)' : 'Issued to production (sent to the vendor)', by: who(user), note: trip.tripNo, from: IN_STOCK });
        if (labelIds.length) await move({ labelIds, place, what: 'Issued to production (sent to the vendor)', by: who(user), note: trip.tripNo, from: IN_STOCK });
      }
    }
    if (any) withStore.push(r);
  }
  for (const r of withStore) {
    if (r.kind === 'jobWork') {
      const jw = await SubChildPartJobWorkOrder.findOne({ _id: r.jobWorkOrder, company: trip.company });
      if (jw) {
        await markOrderFullyIssued(jw._id).catch(e => console.error('[DispatchTrip] markOrderFullyIssued:', e.message));
        const raw = r.materialPlan.find(x => x.kind !== 'wip');
        if (raw && !jw.rawMaterial?.sentAt) {
          Object.assign(jw.rawMaterial, { sourceItem: raw.itemId, sentAt: new Date(), sentBy: user._id });
          await jw.save();
        }
      }
    } else {
      const po = await ProductionOrder.findOne({ _id: r.productionOrder, company: trip.company });
      if (po?.orderKind === 'SubChildPart') {
        await markOrderFullyIssued(po._id).catch(e => console.error('[DispatchTrip] markOrderFullyIssued:', e.message));
        const h = po.outsourceHandoffs.id(r.handoffId);
        const raw = r.materialPlan.find(x => x.kind !== 'wip');
        if (h && raw) {
          h.rawMaterial = h.rawMaterial || {};
          Object.assign(h.rawMaterial, { sourceItem: raw.itemId, dummy: false, sentAt: new Date(), sentBy: user._id });
          await po.save();
        }
      }
      if (po && po.orderKind !== 'SubChildPart') {
        // Store's log, per production order (job-work orders have none).
        for (const row of (r.materialPlan || []).filter(x => x.fromStore > 0 && x.kind !== 'wip')) {
          await StoreTransferLog.create({
            productionOrderId: po._id, orderId: po.orderId, machineCode: po.machineCode || '-', materialCode: row.demandKey || row.itemCode,
            sourceItemCode: row.itemCode, materialName: `${row.itemName} → vendor (${trip.tripNo})`,
            quantityTransferred: row.kind === 'sheetArea' || row.kind === 'length' ? Number(row.storeShare) || 0 : row.fromStore,
            unit: row.kind === 'sheetArea' ? 'sheet(s)' : row.kind === 'length' ? 'length(s)' : (row.unit || 'Pieces'),
            transferredBy: user._id, company: trip.company,
          }).catch(e => console.error('[DispatchTrip] StoreTransferLog:', e.message));
        }
      }
    }
  }

  // Work that was waiting at Store (R2) goes with this trip — released.
  for (const r of line.requests.filter(x => x.status !== 'Released' && x.kind === 'handoff')) {
    if (!(r.materialPlan || []).some(row => row.kind === 'wip' && row.fromStore > 0)) continue;
    const po = await ProductionOrder.findOne({ _id: r.productionOrder, company: trip.company });
    const h = po?.outsourceHandoffs.id(r.handoffId);
    if (!h) continue;
    const units = new Set(h.unitIndices?.length ? h.unitIndices : [0]);
    const leaving = (po.workAtStore || []).filter(w => units.has(w.unitIndex));
    if (!leaving.length) continue;
    for (const w of leaving) {
      po.workHandovers.push({ unitIndex: w.unitIndex, to: 'Dispatch', by: user._id, byName: who(user), note: `${trip.tripNo} → ${job.orderNo}` });
      po.workAtStore.pull(w._id);
    }
    pickLog.push({ type: 'wip', itemName: po.machineName, units: leaving.map(w => w.unitIndex + 1), orderCode: po.orderId });
    await po.save();
  }

  job.store.handedOver = stamp(user);
  job.store.picks = pickLog;
  logTrip(trip, user, 'store', `Store handed over ${job.orderNo} · ${job.itemName}: ${job.store.summary}.`);
  if (warnings.length) logTrip(trip, user, 'store', `Store went ahead after the warning: ${warnings.join(' ')}`);
  await trip.save();
  await logSkippedSerials(trip.company, serialSkips, { screen: 'Handover to Dispatch', reference: `${job.orderNo} · ${trip.tripNo}`, by: who(user) });
  return trip;
}

// ── Handover 1 — Production ─────────────────────────────────────────────

export async function productionHandover(trip, job, productionOrderId, user) {
  assertLiveTrip(trip);
  const p = (job.production || []).find(x => String(x.productionOrder) === String(productionOrderId));
  if (!p) throw new HttpError(404, 'Nothing on this job comes from that production order.');
  if (p.handedOver?.at) throw new HttpError(400, 'Already handed over.');
  p.handedOver = stamp(user);
  logTrip(trip, user, 'production', `Production handed over ${p.orderCode} for ${job.orderNo}: ${p.summary}.`);
  await trip.save();
  return trip;
}

// Production's pending handovers for one of its orders.
export async function pendingForProductionOrder(companyId, productionOrderId) {
  const trips = await DispatchTrip.find({ company: companyId, status: { $in: LIVE_TRIP }, 'stops.jobs.production.productionOrder': productionOrderId }).lean();
  const out = [];
  for (const t of trips) for (const s of t.stops) for (const j of s.jobs) {
    for (const p of j.production || []) {
      if (String(p.productionOrder) !== String(productionOrderId) || p.handedOver?.at || j.delivered?.at) continue;
      out.push({ tripId: t._id, tripNo: t.tripNo, date: t.date, vehicleNumber: t.vehicleNumber, driverName: t.driverName, vendorName: s.vendorName,
        jobId: j._id, orderNo: j.orderNo, itemName: j.itemName, stepNames: j.stepNames, summary: p.summary });
    }
  }
  return out;
}

// Store's pending handovers, every live trip.
export async function pendingForStore(companyId) {
  const trips = await DispatchTrip.find({ company: companyId, status: { $in: LIVE_TRIP } }).sort({ date: 1 });
  const out = [];
  for (const t of trips) for (const s of t.stops) for (const j of s.jobs) {
    if (j.kind !== 'outsourceSend' || !j.store?.needed || j.store.handedOver?.at) continue;
    try {
      const view = await storeView(t, j);
      out.push({ tripId: t._id, tripNo: t.tripNo, date: t.date, vehicleNumber: t.vehicleNumber, driverName: t.driverName, vendorName: s.vendorName, jobId: j._id, orderNo: j.orderNo, itemName: j.itemName, stepNames: j.stepNames, summary: j.store.summary, ...view });
    } catch (e) {
      out.push({ tripId: t._id, tripNo: t.tripNo, jobId: j._id, orderNo: j.orderNo, itemName: j.itemName, problem: e.message });
    }
  }
  return out;
}

// ── Handover 2 — delivered to the vendor ─────────────────────────────────

export async function markDelivered(trip, stop, job, body, user) {
  assertLiveTrip(trip);
  if (job.kind !== 'outsourceSend') throw new HttpError(400, 'Only an outsource send is delivered.');
  if (job.delivered?.at) throw new HttpError(400, 'Already delivered.');
  if (job.store?.needed && !job.store.handedOver?.at) throw new HttpError(400, 'Store hasn\'t handed its part over yet.');
  const waiting = (job.production || []).filter(p => !p.handedOver?.at);
  if (waiting.length) throw new HttpError(400, `Production hasn't handed over yet: ${waiting.map(p => p.orderCode).join(', ')}.`);

  if (body?.challanNo != null) stop.challanNo = String(body.challanNo).trim();
  if (body?.ewayBillNo != null) stop.ewayBillNo = String(body.ewayBillNo).trim();

  const order = await OutsourceOrder.findOne({ _id: job.outsourceOrder, company: trip.company });
  const line = order?.lines.id(job.lineId);
  if (!line) throw new HttpError(404, 'The Outsource Order line no longer exists.');
  const { sentNow, failed } = await sendLineRequests(order, line, user);
  await order.save();
  if (failed) {
    await trip.save();
    throw new HttpError(400, `${sentNow.length ? `Sent ${sentNow.map(r => r.orderCode).join(', ')}. ` : ''}${failed.request} couldn't be sent: ${failed.message}`);
  }
  job.delivered = stamp(user);
  logTrip(trip, user, 'delivered', `Delivered ${job.orderNo} · ${job.itemName} to ${stop.vendorName}${stop.challanNo ? ` (challan ${stop.challanNo})` : ''}.`);
  // The vehicle waits and brings it back: the line comes back on this trip.
  if (job.bringBack) {
    addReturnJob(trip, stop, order, line, user);
    await order.save();
  }
  trip.status = deriveTripStatus(trip);
  await trip.save();
  return trip;
}

// ── The vehicle waits & brings it back (2026-10-21) ──────────────────────
// docs/outsource-v2/vehicle-waits-bring-back-2026-10.md. A delivered line's
// requests (now with the vendor) go on THIS trip as a return job — no new
// trip, no second freight. Same rules as a return trip.
function addReturnJob(trip, stop, order, line, user) {
  const back = (line.requests || []).filter(r => r.status === 'Sent' && !r.returnDispatch?.trip && withVendorQty(r) > 0);
  if (!back.length) {
    const onTrip = (line.requests || []).find(r => r.status === 'Sent' && r.returnDispatch?.trip);
    throw new HttpError(400, onTrip
      ? `${order.orderNo} · ${line.itemName} already comes back on ${onTrip.returnDispatch.tripNo}.`
      : `${order.orderNo} · ${line.itemName}: nothing of it is with the vendor to bring back.`);
  }
  stop.jobs.push({
    kind: 'outsourceReturn', outsourceOrder: order._id, orderNo: order.orderNo, lineId: line._id,
    itemName: line.itemName, stepNames: line.stepNames, sameTrip: true,
    returns: back.map(r => ({ requestId: r._id, orderCode: r.orderCode, qty: withVendorQty(r), unit: line.qtyUnit, lostNote: lostNoteOf(r) })),
  });
  for (const r of back) r.returnDispatch = { trip: trip._id, tripNo: trip.tripNo };
  order.activity.push({ at: new Date(), by: user._id, byName: who(user), action: 'dispatch', summary: `The vehicle waits at ${stop.vendorName} and brings ${line.itemName} back on ${trip.tripNo} (${back.map(r => r.orderCode).join(', ')}).` });
  logTrip(trip, user, 'bring-back', `The vehicle waits and brings back ${order.orderNo} · ${line.itemName} (${back.map(r => r.orderCode).join(', ')}).`);
}

const BRING_BACK_HOURS = 24;

// For the trip list: can each delivered send still be brought back on its
// trip? Only the server knows whether its requests are still with the vendor
// and not on another trip (a later return trip, a collect already done) —
// sets job.canBringBack on lean trips.
export async function annotateBringBack(trips, companyId) {
  const cutoff = Date.now() - BRING_BACK_HOURS * 3600 * 1000;
  const want = [];
  for (const t of trips) {
    for (const s of t.stops || []) for (const j of s.jobs || []) {
      j.canBringBack = false;
      if (t.status === 'Cancelled' || j.kind !== 'outsourceSend' || !j.delivered?.at) continue;
      if (new Date(j.delivered.at).getTime() < cutoff) continue;
      want.push(j);
    }
  }
  if (!want.length) return trips;
  const orders = await OutsourceOrder.find({ company: companyId, _id: { $in: [...new Set(want.map(j => String(j.outsourceOrder)))] } }).select('lines._id lines.requests.status lines.requests.returnDispatch').lean();
  const lines = new Map(orders.flatMap(o => o.lines.map(l => [String(l._id), l])));
  for (const j of want) {
    const line = lines.get(String(j.lineId));
    j.canBringBack = !!line && line.requests.some(r => r.status === 'Sent' && !r.returnDispatch?.trip);
  }
  return trips;
}

// Fallback 2 — not planned, but the vendor is done while the vehicle is there.
export async function bringBackOnTrip(trip, stop, job, user) {
  if (trip.status === 'Cancelled') throw new HttpError(400, 'This trip is cancelled.');
  if (job.kind !== 'outsourceSend') throw new HttpError(400, 'Only a line sent on this trip can be brought back on it.');
  if (!job.delivered?.at) throw new HttpError(400, 'Deliver it to the vendor first.');
  if (Date.now() - new Date(job.delivered.at).getTime() > BRING_BACK_HOURS * 3600 * 1000) {
    throw new HttpError(400, `Delivered more than ${BRING_BACK_HOURS} hours ago — plan a return trip from "To collect".`);
  }
  const order = await OutsourceOrder.findOne({ _id: job.outsourceOrder, company: trip.company });
  const line = order?.lines.id(job.lineId);
  if (!line) throw new HttpError(404, 'The Outsource Order line no longer exists.');
  addReturnJob(trip, stop, order, line, user);
  job.bringBack = true;
  line.dispatch.bringBack = true;
  await order.save();
  trip.status = deriveTripStatus(trip); // a Done trip is out again
  await trip.save();
  return trip;
}

// Fallback 1 — the vendor isn't ready: the uncounted requests leave this trip
// and wait in "To collect" for a later one.
export async function collectLater(trip, stop, job, user) {
  assertLiveTrip(trip);
  if (job.kind !== 'outsourceReturn') throw new HttpError(400, 'Only a collection can be left for later.');
  const open = (job.returns || []).filter(e => !e.collected?.at && !e.short?.at);
  if (!open.length) throw new HttpError(400, 'Everything on it is already counted.');
  const counted = (job.returns || []).length - open.length;
  if (!counted && trip.stops.flatMap(s => s.jobs).length === 1) {
    throw new HttpError(400, 'That\'s the only job on this trip — cancel the trip instead.');
  }
  const order = await OutsourceOrder.findOne({ _id: job.outsourceOrder, company: trip.company });
  const line = order?.lines.id(job.lineId);
  for (const e of open) {
    const r = line?.requests.id(e.requestId);
    if (r && String(r.returnDispatch?.trip) === String(trip._id)) r.returnDispatch = { trip: null, tripNo: '' };
  }
  if (counted) job.returns = job.returns.filter(e => e.collected?.at || e.short?.at);
  else {
    stop.jobs.pull(job._id);
    // It no longer comes back on this trip: the send stops saying "the vehicle waits".
    if (job.sameTrip) {
      const send = stop.jobs.find(x => x.kind === 'outsourceSend' && String(x.lineId) === String(job.lineId));
      if (send) send.bringBack = false;
      if (line?.dispatch && String(line.dispatch.trip) === String(trip._id)) line.dispatch.bringBack = false;
    }
  }
  if (order) {
    order.activity.push({ at: new Date(), by: user._id, byName: who(user), action: 'dispatch', summary: `${stop.vendorName} not ready — ${open.map(e => e.orderCode).join(', ')} left for a later trip (${trip.tripNo}).` });
    await order.save();
  }
  trip.status = deriveTripStatus(trip);
  logTrip(trip, user, 'collect-later', `Vendor not ready — ${job.orderNo} · ${job.itemName} (${open.map(e => e.orderCode).join(', ')}) left for a later trip.`);
  await trip.save();
  return trip;
}

// ── Handover 5 — PO picked up ────────────────────────────────────────────

export async function markPickedUp(trip, stop, job, user) {
  assertLiveTrip(trip);
  if (job.kind !== 'poPickup') throw new HttpError(400, 'Only a PO pickup is picked up.');
  if (job.pickedUp?.at) throw new HttpError(400, 'Already picked up.');
  // By line: every line not left for later and not already picked up (at
  // Store's receive).
  const open = (job.poLines || []).filter(e => !e.later?.at && !e.pickedUp?.at);
  if ((job.poLines || []).length && !open.length) throw new HttpError(400, 'Nothing left to pick up on it.');
  const s = stamp(user);
  for (const e of open) e.pickedUp = s;
  job.pickedUp = s;
  trip.status = deriveTripStatus(trip);
  const what = open.length ? ` (${open.map(e => e.itemName).join(', ')})` : '';
  logTrip(trip, user, 'picked-up', `Picked up ${job.poNumber}${what} from ${stop.vendorName} — on its way to Store.`);
  await trip.save();
  return trip;
}

// "Not ready — collect later" for one PO line (2026-10-26): it leaves this
// trip and is back on the Purchase list for another one. Also the correction
// when Dispatch pressed "Picked up" but this line wasn't on the vehicle —
// allowed until Store receives it (Store receives only what really arrived),
// even on a Done trip.
export async function poLineLater(trip, stop, job, lineId, user) {
  if (job.kind !== 'poPickup' || !(job.poLines || []).length) throw new HttpError(400, 'Only a PO line on a pickup can be left for later.');
  const e = job.poLines.find(x => String(x.lineId) === String(lineId));
  if (!e) throw new HttpError(404, 'That line is not on this pickup.');
  if (e.received?.at) throw new HttpError(400, `${e.itemName} is already received at Store.`);
  if (e.pickedUp?.viaStore) throw new HttpError(400, `${e.itemName} is being received at Store — it arrived.`);
  if (e.later?.at) throw new HttpError(400, `${e.itemName} is already left for later.`);
  const correction = !!e.pickedUp?.at;
  if (correction) {
    if (trip.status === 'Cancelled') throw new HttpError(400, 'This trip is cancelled.');
  } else {
    assertLiveTrip(trip);
    const anyOther = trip.stops.flatMap(x => x.jobs).some(x => String(x._id) !== String(job._id))
      || job.poLines.some(x => x !== e && !x.later?.at);
    if (!anyOther) throw new HttpError(400, 'That\'s the only thing on this trip — cancel the trip instead.');
  }
  const wrong = correction ? e.pickedUp : null;
  e.later = stamp(user);
  if (correction) e.pickedUp = { at: null, by: null, byName: '', viaStore: false };
  trip.status = deriveTripStatus(trip);
  logTrip(trip, user, 'collect-later', correction
    ? `Correction: ${job.poNumber} · ${e.itemName} wasn't on the vehicle (marked picked up by ${wrong.byName || '—'} on ${new Date(wrong.at).toLocaleDateString('en-IN')}) — left for a later trip.`
    : `${stop.vendorName} not ready — ${job.poNumber} · ${e.itemName} left for a later trip.`);
  await trip.save();
  return trip;
}

// Store's receive of a "We pick up" PO line (2026-10-26): the trip entry it
// arrived on — planned or picked up, not yet received. null = not on a trip
// (Store can't receive it). An older whole-PO job counts for every line.
export async function pickupForPoLine(companyId, poId, lineId) {
  const trips = await DispatchTrip.find({ company: companyId, status: { $ne: 'Cancelled' }, 'stops.jobs.purchase': poId }).sort({ createdAt: -1 });
  let legacy = null;
  for (const trip of trips) for (const stop of trip.stops) for (const job of stop.jobs) {
    if (job.kind !== 'poPickup' || String(job.purchase) !== String(poId)) continue;
    if (!(job.poLines || []).length) { if (!legacy) legacy = { trip, stop, job, entry: null }; continue; }
    const entry = job.poLines.find(e => String(e.lineId) === String(lineId) && !e.later?.at && !e.received?.at);
    if (entry) return { trip, stop, job, entry };
  }
  return legacy;
}

// After Store received the line: the entry is received, and its pickup is
// recorded if Dispatch hadn't pressed it ("whoever records first"). lineDone
// false = a one-request receive with more requests still open on the line.
export async function recordPoLineReceived(found, user, { lineDone = true } = {}) {
  const { trip, stop, job, entry } = found;
  const s = stamp(user);
  const what = entry ? `${job.poNumber} · ${entry.itemName}` : job.poNumber;
  if (entry) {
    if (!entry.pickedUp?.at) {
      entry.pickedUp = { ...s, viaStore: true };
      logTrip(trip, user, 'picked-up', `Picked up ${what} from ${stop.vendorName} — recorded at Store's receive.`);
    }
    if (lineDone) entry.received = s;
  } else if (!job.pickedUp?.at) {
    job.pickedUp = { ...s, viaStore: true };
    logTrip(trip, user, 'picked-up', `Picked up ${what} from ${stop.vendorName} — recorded at Store's receive.`);
  }
  if (lineDone) logTrip(trip, user, 'received', `Store received ${what}.`);
  if (trip.status !== 'Cancelled') trip.status = deriveTripStatus(trip);
  await trip.save();
}

// Store's PO list: where each "We pick up" line stands — { [lineId]:
// { tripNo, state: 'planned' | 'picked' } }; an older whole-PO job under
// `po:<poId>`.
export async function pickupStateForPos(companyId, poIds) {
  if (!poIds.length) return {};
  const claims = await poPickupClaims(companyId, poIds);
  const out = {};
  for (const [id, c] of claims.lines) out[id] = c;
  for (const [id, w] of claims.wholePo) out[`po:${id}`] = { tripNo: w.tripNo, state: w.pickedUp ? 'picked' : 'planned' };
  return out;
}

// ── Slice 7 — the way back ───────────────────────────────────────────────
// Handover 3: Dispatch collects at the vendor (the count must equal what was
// sent, else "Report short" — R1). Handover 4: Store receives (its count must
// match Dispatch's), the receive runs as before (QC, bill), a job-work
// order's cost comes from the order (T10), offcuts / unused material go to
// stock (R3). A hybrid order's returned units then wait AT STORE (R2) until
// Store hands them to Production (per unit, once QC passed — R4, T8) or to
// Dispatch with the next trip.

async function orderLineRequest(companyId, outsourceOrderId, lineId, requestId) {
  const order = await OutsourceOrder.findOne({ _id: outsourceOrderId, company: companyId });
  const line = order?.lines.id(lineId);
  const r = line?.requests.id(requestId);
  if (!r) throw new HttpError(404, 'The Outsource Order request no longer exists.');
  return { order, line, r };
}

// T9 — Dispatch marks "vendor says ready" (Purchase does it on the order).
export async function vendorReadyFromDispatch(companyId, { outsourceOrder, requestId }, user) {
  const order = await OutsourceOrder.findOne({ _id: outsourceOrder, company: companyId });
  if (!order) throw new HttpError(404, 'Outsource order not found.');
  for (const line of order.lines) {
    const r = line.requests.id(requestId);
    if (r) { markVendorReady(order, line, r, user); await order.save(); return order; }
  }
  throw new HttpError(404, 'Request not found on this order.');
}

const findReturn = (job, requestId) => {
  const e = (job.returns || []).find(x => String(x.requestId) === String(requestId));
  if (!e) throw new HttpError(404, 'That request is not on this job.');
  return e;
};

// Handover 3 — counts: { [requestId]: n }.
export async function markCollected(trip, stop, job, counts, user) {
  assertLiveTrip(trip);
  if (job.kind !== 'outsourceReturn') throw new HttpError(400, 'Only a return is collected.');
  const entries = Object.entries(counts || {}).filter(([, n]) => n !== '' && n != null);
  if (!entries.length) throw new HttpError(400, 'Enter the count for at least one request.');
  const order = await OutsourceOrder.findOne({ _id: job.outsourceOrder, company: trip.company });
  const line = order?.lines.id(job.lineId);
  if (!line) throw new HttpError(404, 'The Outsource Order line no longer exists.');
  // Pieces (a Sub Child Part line) can come back in parts (2026-10-26): fewer
  // than are still with the vendor is "collected N — the rest still with the
  // vendor". Units must still all come (split by unit is Store's, at receive).
  const pieces = line.qtyUnit === 'pcs';
  const checked = entries.map(([id, n]) => {
    const e = findReturn(job, id);
    if (e.collected?.at || e.short?.at) throw new HttpError(400, `${e.orderCode} is already ${e.collected?.at ? 'collected' : 'reported short'}.`);
    const r = line.requests.id(e.requestId);
    if (!r || r.status !== 'Sent') throw new HttpError(400, `${e.orderCode} isn't with the vendor.`);
    const count = Number(n);
    const left = withVendorQty(r);
    if (pieces) {
      if (!(count > 0)) throw new HttpError(400, `${e.orderCode}: enter how many came — nothing ready is "Not ready — collect later".`);
      if (count > left) throw new HttpError(400, `${e.orderCode}: ${fmt(count)} counted, but only ${fmt(left)} ${e.unit} are still with the vendor.`);
    } else if (!(Number.isInteger(count) && count >= 1 && count <= Number(e.qty))) {
      // Units (3c): fewer is fine — Store picks which came at its receive and
      // the rest becomes its own request, still with the vendor.
      throw new HttpError(400, `${e.orderCode}: enter how many of the ${fmt(e.qty)} ${e.unit} came (nothing ready is "Not ready — collect later").`);
    }
    // A part of the request, or the rest after an earlier part.
    const part = pieces && (count < left || (r.arrivals || []).length > 0);
    return { e, r, count, part, rest: left - count };
  });
  for (const { e, r, count, part } of checked) {
    e.collected = { ...stamp(user), count };
    r.collected = { at: new Date(), byName: who(user), count, tripNo: trip.tripNo };
    if (part) {
      r.arrivals = [...(r.arrivals || []), { count, tripNo: trip.tripNo, via: 'Dispatch', collectedAt: new Date(), collectedBy: who(user) }];
      // The rest is free for another trip straight away.
      if (String(r.returnDispatch?.trip) === String(trip._id)) r.returnDispatch = { trip: null, tripNo: '' };
    }
  }
  const restNote = (c) => (c.part && c.rest > 0 ? ` — ${fmt(c.rest)} still with the vendor`
    : !pieces && c.count < Number(c.e.qty) ? ` — ${fmt(Number(c.e.qty) - c.count)} more still with the vendor` : '');
  order.activity.push({ at: new Date(), by: user._id, byName: who(user), action: 'collected', summary: `Dispatch collected ${checked.map(c => `${c.e.orderCode} (${fmt(c.count)} ${c.e.unit}${restNote(c)})`).join(', ')} from ${stop.vendorName} — ${trip.tripNo}; Store receives it.` });
  await order.save();
  const partial = checked.filter(c => c.part && c.rest > 0);
  if (partial.length) {
    try {
      await notificationService.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Outsource work back in part',
        message: `${job.orderNo} · ${job.itemName}: ${partial.map(c => `${c.e.orderCode} ${fmt(c.count)} back, ${fmt(c.rest)} still with ${stop.vendorName}`).join('; ')}.`,
        type: 'purchase', icon: 'package', priority: 'medium',
        data: { outsourceOrderId: String(order._id), orderNo: order.orderNo, outsourceRequest: true }, targetCompanyId: trip.company,
      });
    } catch (err) { console.error('[DispatchTrip] notify part back:', err.message); }
  }
  trip.status = deriveTripStatus(trip);
  logTrip(trip, user, 'collected', `Collected ${checked.map(c => c.e.orderCode).join(', ')} (${job.orderNo} · ${job.itemName}).`);
  await trip.save();
  return trip;
}

// R1 — fewer than sent. From Dispatch: the request leaves this trip and waits
// for a later one. From Store after Dispatch collected (it counts fewer than
// Dispatch did): it stays on Store's list. From Store BEFORE Dispatch
// collected (2026-10-26 — Store doesn't wait): the same as Dispatch's short,
// checked against what was sent. Purchase is told either way.
export async function reportShort(trip, stop, job, requestId, { count, note } = {}, user, from = 'Dispatch') {
  if (job.kind !== 'outsourceReturn') throw new HttpError(400, 'Only a return can be short.');
  const e = findReturn(job, requestId);
  if (e.received?.at) throw new HttpError(400, `${e.orderCode} is already received.`);
  // The request leaves this trip: Dispatch's short, or Store's before any collection.
  const leaves = from === 'Dispatch' || !e.collected?.at;
  if (from === 'Dispatch') {
    assertLiveTrip(trip);
    if (e.collected?.at) throw new HttpError(400, `${e.orderCode} is already collected — Store reports a difference.`);
  } else if (trip.status === 'Cancelled') {
    throw new HttpError(400, 'This trip is cancelled.');
  }
  if (leaves && e.short?.at) throw new HttpError(400, `${e.orderCode} is already reported short.`);
  const n = Number(count);
  if (!(n >= 0) || count === '' || count == null) throw new HttpError(400, 'Enter how many actually came back.');
  const expected = leaves ? e.qty : e.collected.count;
  if (n >= Number(expected)) throw new HttpError(400, 'That isn\'t short — collect / receive it normally.');
  const { order, line, r } = await orderLineRequest(trip.company, job.outsourceOrder, job.lineId, requestId);
  const shortInfo = { at: new Date(), byName: who(user), count: n, note: String(note || '').trim(), from, tripNo: trip.tripNo };
  // The request's own short is the vendor's side only (2026-10-27): Store
  // counting fewer than Dispatch collected stays on the trip entry — Dispatch's
  // "to collect" (what the vendor still has) never shows it.
  if (leaves) r.short = shortInfo;
  e.short = { ...stamp(user), count: n, note: shortInfo.note, from };
  if (leaves && String(r.returnDispatch?.trip) === String(trip._id)) r.returnDispatch = { trip: null, tripNo: '' };
  const msg = `${job.orderNo} · ${job.itemName}: ${r.orderCode} — ${from === 'Store' ? 'Store counted' : `${stop.vendorName} gave back`} ${fmt(n)} of ${fmt(expected)} ${e.unit}${shortInfo.note ? ` ("${shortInfo.note}")` : ''}.`;
  order.activity.push({ at: new Date(), by: user._id, byName: who(user), action: 'short', summary: `Short — ${msg} ${leaves ? 'Not received; it waits for a later trip.' : 'Not received yet.'}` });
  await order.save();
  try {
    if (leaves) {
      // Fewer came from the vendor (Dispatch's count, or Store's with no
      // Dispatch count) — Purchase sorts it out with the vendor.
      await notificationService.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Outsource work short', message: `${msg} Please sort it out with the vendor.`,
        type: 'purchase', icon: 'alert-triangle', priority: 'high',
        data: { outsourceOrderId: String(order._id), orderNo: order.orderNo }, targetCompanyId: trip.company,
      });
    } else {
      // Store counted fewer than Dispatch collected (2026-10-27): the pieces
      // are inside the company, between Dispatch and Store — not the vendor's
      // matter. Dispatch and Store find them, then Store receives.
      await notificationService.notifyRoles(['Dispatch Head', 'Dispatch Employee', 'Store Head', 'Store Employee'], {
        title: 'Count mismatch: Dispatch vs Store',
        message: `${job.orderNo} · ${job.itemName}: ${r.orderCode} — Store counted ${fmt(n)} of the ${fmt(expected)} ${e.unit} Dispatch collected (${trip.tripNo})${shortInfo.note ? ` ("${shortInfo.note}")` : ''}. Find the missing ${e.unit}, then Store receives.`,
        type: 'dispatch', icon: 'alert-triangle', priority: 'high',
        data: { outsourceCountMismatch: true, tripId: String(trip._id), tripNo: trip.tripNo, orderNo: order.orderNo }, targetCompanyId: trip.company,
      });
    }
  } catch (err) { console.error('[DispatchTrip] notify short:', err.message); }
  if (leaves) trip.status = deriveTripStatus(trip);
  logTrip(trip, user, 'short', `Short (${from}): ${msg}`);
  await trip.save();
  return trip;
}

// Store's list to receive: every request on a return trip not yet received —
// collected by Dispatch, or not yet (2026-10-26: Store never waits for
// Dispatch's entry; its count is then checked against what was sent). A
// request Dispatch reported short has left the trip.
export async function pendingStoreReceive(companyId) {
  const trips = await DispatchTrip.find({ company: companyId, status: { $ne: 'Cancelled' }, 'stops.jobs.kind': 'outsourceReturn' }).sort({ date: 1 });
  const out = [];
  for (const t of trips) for (const s of t.stops) for (const j of s.jobs) {
    if (j.kind !== 'outsourceReturn') continue;
    const waiting = (j.returns || []).filter(e => !e.received?.at && (e.collected?.at || !e.short?.at));
    if (!waiting.length) continue;
    const order = await OutsourceOrder.findOne({ _id: j.outsourceOrder, company: companyId });
    const line = order?.lines.id(j.lineId);
    if (!line) continue;
    const { store } = linePickList(line);
    const returnable = [
      ...store.groups.map(g => ({ key: g.key, kind: g.kind, itemName: g.itemName })),
      ...store.cuts.map(c => ({ key: c.key, kind: 'length', itemName: c.itemName })),
    ];
    for (const e of waiting) {
      const r = line.requests.id(e.requestId);
      if (!r || r.status !== 'Sent') continue;
      let needs = {};
      try { needs = await requestNeeds(new RecordSet(companyId), line, r, companyId); } catch { /* shown without extras */ }
      // Units (3c): which units this request covers — Store ticks the ones that came.
      let unitNumbers = [];
      if (line.qtyUnit !== 'pcs' && r.kind === 'handoff') {
        const po = await ProductionOrder.findOne({ _id: r.productionOrder, company: companyId }).select('outsourceHandoffs._id outsourceHandoffs.unitIndices').lean();
        unitNumbers = (po?.outsourceHandoffs || []).find(h => String(h._id) === String(r.handoffId))?.unitIndices?.map(i => i + 1) || [];
      }
      out.push({
        unitNumbers,
        tripId: t._id, tripNo: t.tripNo, date: t.date, vehicleNumber: t.vehicleNumber, vendorName: s.vendorName,
        jobId: j._id, outsourceOrder: order._id, orderNo: order.orderNo, itemName: j.itemName, stepNames: j.stepNames,
        requestId: e.requestId, orderCode: e.orderCode, qty: e.qty, unit: e.unit,
        collectedCount: e.collected?.at ? e.collected.count : null,
        // What Store's count is checked against: Dispatch's count, or what's
        // still with the vendor. Pieces can be fewer (a part — 2026-10-26).
        expectedCount: e.collected?.at ? e.collected.count : withVendorQty(r),
        pieces: line.qtyUnit === 'pcs',
        sentQty: r.qty, backQty: (r.arrivals || []).filter(a => a.receivedAt).reduce((n, a) => n + a.count, 0), lostQty: r.lostQty || 0,
        storeShort: e.short?.from === 'Store' ? e.short : null,
        leftoverRequired: !!needs.leftoverRequired, leftoverIsSheet: !!needs.leftoverIsSheet,
        // Only fabrication material (sheet / length offcuts) comes back into
        // stock — not parts, tools or other items (2026-10-23, the user).
        returnable,
      });
    }
  }
  return out;
}

// ── Paged lists (2026-10-21) ─────────────────────────────────────────────
// Lists that only grow (trips, Store's receives) are paged on the server.

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pageArgs({ page, limit } = {}, defLimit = 20) {
  const l = Math.max(1, Math.min(Number(limit) || defLimit, 100));
  const p = Math.max(1, Math.floor(Number(page) || 1));
  return { page: p, limit: l, skip: (p - 1) * l };
}
// from / to as YYYY-MM-DD (whole days, server time).
function dayRange(from, to) {
  const r = {};
  if (from) { const d = new Date(from); if (!Number.isNaN(d.getTime())) { d.setHours(0, 0, 0, 0); r.$gte = d; } }
  if (to) { const d = new Date(to); if (!Number.isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); r.$lte = d; } }
  return Object.keys(r).length ? r : null;
}
const pageInfo = (page, limit, total) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });

// Vendor Pickups → Trips: newest first. `status` = comma list; `search`
// matches trip no., vehicle, vendor, Outsource Order no. or PO no.; from / to
// on the trip date.
export async function listTripsPaged(companyId, { status, search, from, to, page, limit } = {}) {
  const pg = pageArgs({ page, limit });
  const q = { company: companyId };
  if (status) q.status = { $in: String(status).split(',').filter(Boolean) };
  const range = dayRange(from, to);
  if (range) q.date = range;
  const s = String(search || '').trim();
  if (s) {
    const rx = new RegExp(escapeRegex(s), 'i');
    q.$or = [{ tripNo: rx }, { vehicleNumber: rx }, { vehicleNumber: new RegExp(escapeRegex(s.replace(/\s+/g, '')), 'i') },
      { 'stops.vendorName': rx }, { 'stops.jobs.orderNo': rx }, { 'stops.jobs.poNumber': rx }];
  }
  const [data, total] = await Promise.all([
    DispatchTrip.find(q).sort({ date: -1, createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    DispatchTrip.countDocuments(q),
  ]);
  await annotateBringBack(data, companyId);
  return { data, pagination: pageInfo(pg.page, pg.limit, total) };
}

// Store's Received list (2026-10-21): every outsource receive, newest first,
// with the leftovers Store entered at it. Paged in the database (one row per
// received request). `search` matches order / part / vendor / trip / order
// code; from / to on the receive date.
export async function receivedAtStore(companyId, { search = '', from, to, page, limit } = {}) {
  const pg = pageArgs({ page, limit });
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const rowMatch = { 'stops.jobs.kind': 'outsourceReturn', 'stops.jobs.returns.received.at': { $type: 'date' } };
  const range = dayRange(from, to);
  if (range) rowMatch['stops.jobs.returns.received.at'] = { $type: 'date', ...range };
  const s = String(search || '').trim();
  if (s) {
    const rx = new RegExp(escapeRegex(s), 'i');
    rowMatch.$or = [{ tripNo: rx }, { 'stops.vendorName': rx }, { 'stops.jobs.orderNo': rx }, { 'stops.jobs.itemName': rx }, { 'stops.jobs.returns.orderCode': rx }];
  }
  const [res] = await DispatchTrip.aggregate([
    // $type, not $ne: null — over an array $ne drops a trip as soon as one of
    // its returns isn't received yet.
    { $match: { company: cid, 'stops.jobs.returns.received.at': { $type: 'date' } } },
    { $unwind: '$stops' }, { $unwind: '$stops.jobs' }, { $unwind: '$stops.jobs.returns' },
    { $match: rowMatch },
    { $sort: { 'stops.jobs.returns.received.at': -1 } },
    { $facet: {
      rows: [{ $skip: pg.skip }, { $limit: pg.limit }],
      total: [{ $count: 'n' }],
    } },
  ]);
  const data = (res?.rows || []).map(t => {
    const st = t.stops; const j = st.jobs; const e = j.returns;
    return {
      tripId: t._id, tripNo: t.tripNo, vehicleNumber: t.vehicleNumber, vendorName: st.vendorName,
      outsourceOrder: j.outsourceOrder, orderNo: j.orderNo, itemName: j.itemName, stepNames: j.stepNames,
      orderCode: e.orderCode, qty: e.qty, unit: e.unit,
      collectedCount: e.collected?.count ?? null, collectedBy: e.collected?.byName || '', collectedAt: e.collected?.at || null,
      collectedViaStore: !!e.collected?.viaStore,
      receivedCount: e.received.count, receivedBy: e.received.byName || '', receivedAt: e.received.at,
      returned: e.received.returned || [],
    };
  });
  return { data, pagination: pageInfo(pg.page, pg.limit, res?.total?.[0]?.n || 0) };
}

// R3 — offcuts / unused material Store got back with the work. Returns what
// was recorded (kept on the trip's receive for Store's Received list).
async function applyReturnedMaterial(trip, order, line, returned, user, orderCode = '') {
  const offcuts = (returned?.offcuts || []).filter(o => Number(o.pieces) > 0);
  if (!offcuts.length) return []; // items are refused up front (storeReceive)
  const recs = [];
  const { store } = linePickList(line);
  const sources = new Map([
    ...store.groups.map(g => [g.key, { kind: g.kind, itemId: g.itemId, variantId: g.variantId, itemName: g.itemName }]),
    ...store.cuts.map(c => [c.key, { kind: 'length', itemId: c.itemId, variantId: c.variantId, itemName: c.itemName }]),
  ]);
  const notes = [];
  for (const o of offcuts) {
    const src = sources.get(o.key);
    if (!src) throw new HttpError(400, 'An offcut isn\'t for this line\'s material.');
    const item = await Item.findOne({ _id: src.itemId, companyId: trip.company });
    const base = item?.dimensionVariants.id(src.variantId);
    if (!base) throw new HttpError(400, `${src.itemName}: its size no longer exists.`);
    const values = leftoverValuesFrom(src.kind, base.values, { ...o, pieceCount: o.pieces });
    pushOrMergeLeftover(item, base, values, Number(o.pieces));
    await item.save();
    const rec = { kind: 'offcut', itemName: src.itemName, sizeKind: src.kind, values, pieces: Number(o.pieces) };
    line.returnedMaterial.push({ ...rec, byName: who(user), orderCode, tripNo: trip.tripNo });
    recs.push(rec);
    notes.push(`${o.pieces} × ${src.itemName} offcut ${src.kind === 'sheetArea' ? `${fmt(values.width)} × ${fmt(values.length)}` : fmt(values.length)} mm`);
  }
  order.activity.push({ at: new Date(), by: user._id, byName: who(user), action: 'returned-material', summary: `Back from the vendor into stock: ${notes.join('; ')}.` });
  return recs;
}

// Handover 4 — Store receives one collected request.
// body: { count, leftover: { leftoverLengthValue, … } (an older whole-sheet
//   send only), returned: { offcuts: [{ key, lengthValue, lengthUnit,
//   widthValue, widthUnit, pieces }] } }
export async function storeReceive(trip, stop, job, requestId, body, user) {
  if (job.kind !== 'outsourceReturn') throw new HttpError(400, 'Only a return is received.');
  // Checked before anything is saved: only sheet / length offcuts come back
  // (2026-10-23) — parts, tools and other items don't.
  if ((body?.returned?.items || []).some(i => Number(i.qty) > 0)) {
    throw new HttpError(400, 'Only sheet / length offcuts come back into stock here — not parts, tools or other items.');
  }
  if (trip.status === 'Cancelled') throw new HttpError(400, 'This trip is cancelled.');
  const e = findReturn(job, requestId);
  if (e.received?.at) throw new HttpError(400, `${e.orderCode} is already received.`);
  // Dispatch hasn't entered the collection (2026-10-26): Store doesn't wait —
  // its count is checked against what was sent, and it records the collection.
  const byStore = !e.collected?.at;
  if (byStore && e.short?.at) throw new HttpError(400, `${e.orderCode} was reported short — it's waiting for a later trip.`);
  const count = Number(body?.count);
  const { order, line, r } = await orderLineRequest(trip.company, job.outsourceOrder, job.lineId, requestId);
  if (r.status !== 'Sent') throw new HttpError(400, `${r.orderCode} is ${r.status}.`);
  // Pieces can come back in parts (2026-10-26): fewer than are still with the
  // vendor is an arrival — it waits at Store; the request is received (QC,
  // bill, next step) once everything is back or written off.
  const pieces = line.qtyUnit === 'pcs';
  const left = withVendorQty(r);
  const dispatchPart = !byStore ? (r.arrivals || []).find(a => a.tripNo === trip.tripNo && !a.receivedAt) : null;
  if (byStore) {
    if (pieces) {
      if (!(count > 0) || count > left) throw new HttpError(400, `Store counts ${fmt(count)}, but ${fmt(left)} ${e.unit} are still with the vendor — recount, or report it short.`);
    } else if (!(Number.isInteger(count) && count >= 1 && count <= Number(e.qty))) {
      throw new HttpError(400, `Store counts ${fmt(count)}, but ${fmt(e.qty)} ${e.unit} were sent — recount, or report it short.`);
    }
  } else if (count !== Number(e.collected.count)) {
    throw new HttpError(400, `Store counts ${fmt(count)}, but Dispatch collected ${fmt(e.collected.count)} — recount with Dispatch, or report it short.`);
  }
  const part = pieces && (byStore ? (count < left || (r.arrivals || []).length > 0) : !!dispatchPart);
  const now = new Date();
  if (byStore) {
    e.collected = { ...stamp(user), count, viaStore: true };
    r.collected = { at: now, byName: `${who(user)} (at Store's receive)`, count, tripNo: trip.tripNo };
    order.activity.push({ at: now, by: user._id, byName: who(user), action: 'collected', summary: `Collected ${r.orderCode} (${fmt(count)} ${e.unit}) from ${stop.vendorName} — ${trip.tripNo}; recorded at Store's receive.` });
    logTrip(trip, user, 'collected', `Collected ${e.orderCode} (${job.orderNo} · ${job.itemName}) — recorded at Store's receive.`);
    if (part) r.arrivals = [...(r.arrivals || []), { count, tripNo: trip.tripNo, via: 'Store', collectedAt: now, collectedBy: who(user), receivedAt: now, receivedBy: who(user) }];
  } else if (dispatchPart) {
    dispatchPart.receivedAt = now;
    dispatchPart.receivedBy = who(user);
  }
  // Units in part (3c): the units that came are received now; the rest
  // become a request of their own (its own hand-off), still with the vendor.
  const unitsPart = !pieces && count < Number(e.qty);
  if (unitsPart) {
    if (r.kind !== 'handoff') throw new HttpError(400, 'Only a Child Part / Machine trip comes back unit by unit.');
    const po = await ProductionOrder.findOne({ _id: r.productionOrder, company: trip.company });
    const h = po?.outsourceHandoffs.id(r.handoffId);
    if (!h) throw new HttpError(404, 'Its production order hand-off no longer exists.');
    const nums = [...new Set((Array.isArray(body?.unitNumbers) ? body.unitNumbers : []).map(Number))];
    const valid = new Set(h.unitIndices.map(i => i + 1));
    if (nums.length !== count || nums.some(n => !valid.has(n))) {
      throw new HttpError(400, `Pick which ${fmt(count)} of units ${[...valid].join(', ')} came back.`);
    }
    const { handoff: rest, roundIdMap } = splitHandoffByUnits(po, h, nums.map(n => n - 1));
    await po.save();
    line.requests.push({
      kind: 'handoff', productionOrder: r.productionOrder, handoffId: rest._id, orderCode: r.orderCode, stepIndices: r.stepIndices,
      qty: rest.unitIndices.length, roundId: roundIdMap.get(String(r.roundId)) || null, status: 'Sent',
      vendorReady: r.vendorReady?.at ? r.vendorReady : undefined,
      // Its material was settled when the trip went out — never again at receive.
      materialPlan: Array.isArray(r.materialPlan) ? [] : undefined,
    });
    r.qty = count;
    order.activity.push({ at: now, by: user._id, byName: who(user), action: 'received', summary: `${line.itemName}: ${r.orderCode} — unit${nums.length === 1 ? '' : 's'} ${nums.join(', ')} back; unit${rest.unitIndices.length === 1 ? '' : 's'} ${rest.unitIndices.map(i => i + 1).join(', ')} still with the vendor (collected on a later trip).` });
  }
  // Everything back (or written off) → the real receive; a part just waits.
  const complete = !part || allBack(r);

  // Store never types a cost: a job-work order's cost is read from its
  // Outsource Orders once it completes (slice 4, 2026-10-24 —
  // partCostService), and waits for any per minute / per hour time by itself.
  if (complete) await completeRequestReceive(order, line, r, user, { ...(body?.leftover || {}) });
  const returnedRecs = await applyReturnedMaterial(trip, order, line, body?.returned, user, r.orderCode);
  // A trip sent before Outsource Orders (whole sheet / length): its leftover.
  const lo = body?.leftover;
  if (lo && Number(lo.leftoverLengthValue) > 0) {
    returnedRecs.unshift({ kind: 'leftover', itemName: line.itemName, values: { length: Number(lo.leftoverLengthValue), width: Number(lo.leftoverWidthValue) || null }, pieces: 1 });
  }
  r.returnDispatch = { trip: null, tripNo: '' };
  if (part) {
    const back = (r.arrivals || []).filter(a => a.receivedAt).reduce((s, a) => s + a.count, 0);
    order.activity.push({ at: now, by: user._id, byName: who(user), action: 'received', summary: complete
      ? `${line.itemName}: ${r.orderCode} — the last ${fmt(count)} ${e.unit} back; all ${fmt(back)} received together.`
      : `${line.itemName}: ${r.orderCode} — ${fmt(count)} ${e.unit} back (${fmt(back)} of ${fmt(r.qty)} at Store, ${fmt(withVendorQty(r))} still with the vendor); they wait at Store for the rest.` });
  }
  await order.save();
  e.received = { ...stamp(user), count, partial: (part && !complete) || unitsPart, returned: returnedRecs };
  logTrip(trip, user, 'received', `Store received ${e.orderCode} (${fmt(count)} ${e.unit}${part && !complete ? `; ${fmt(withVendorQty(r))} still with the vendor` : ''}) — ${job.orderNo} · ${job.itemName}.`);
  trip.status = deriveTripStatus(trip); // a collection recorded here can close the trip
  await trip.save();
  // No QC on the trip and the next step is outsourced too → requested now.
  if (complete && r.kind === 'handoff') await autoRequestAtStore(trip.company, r.productionOrder, user);
  return trip;
}

// The real receive of a request (QC, bill, the holder's round) — once all of
// it is back at Store (or the rest written off). The caller saves the order.
export async function completeRequestReceive(order, line, r, user, recvBody = {}) {
  await receiveRequestCore(order, line, r, user, recvBody, {
    viaStore: true,
    // R2 — a hybrid order's units now wait at Store, unless this trip did
    // the order's last step (then they go into stock as before).
    onRecords: async (records) => {
      if (r.kind !== 'handoff') return;
      const { doc, handoff } = await records.handoffOf(r);
      const round = handoff.rounds.id(r.roundId);
      const idxs = roundStepIndices(handoff, round);
      const last = Math.max(...idxs);
      for (const u of (handoff.unitIndices?.length ? handoff.unitIndices : [0])) {
        const procs = unitProcs(doc, u);
        if (!procs || last >= procs.length - 1) continue;
        for (const w of (doc.workAtStore || []).filter(x => x.unitIndex === u)) doc.workAtStore.pull(w._id);
        doc.workAtStore.push({ unitIndex: u, handoffId: handoff._id, roundId: round._id, outsourceOrderNo: order.orderNo });
      }
    },
  });
}

// One unit's work at Store: where it stands (R2 / R4).
function workState(po, w) {
  const h = po.outsourceHandoffs.id(w.handoffId);
  const round = h?.rounds.id(w.roundId);
  const procs = unitProcs(po, w.unitIndex);
  if (!h || !round || !procs) return { state: 'unknown', label: 'Unknown' };
  const idxs = roundStepIndices(h, round);
  const steps = idxs.map(i => procs[i]);
  const next = procs[Math.max(...idxs) + 1] || null;
  const base = { stepNames: steps.map(p => p?.step), nextStep: next?.step || null };
  if (steps.some(p => p?.outsourceStatus === 'NotStarted' && p?.status !== 'Completed')) return { ...base, state: 'rework', label: 'QC rework — goes out again from Store' };
  if (!steps.every(p => p?.status === 'Completed')) return { ...base, state: 'qc', label: 'In QC' };
  if (!next) return { ...base, state: 'done', label: 'Last step done' };
  if (next.type === 'Outsourcing') return { ...base, state: 'outsource', label: `Next step ${next.step} is outsourced — stays at Store for the next trip` };
  return { ...base, state: 'ready', label: `QC passed — next: ${next.step} (in-house)` };
}

// Work back from a vendor whose next step is in-house goes to Production by
// itself (2026-10-25, the user — replaces Store's "Hand to Production", slice
// 7 T8 / R4): QC passing it IS the handover; with no QC on those steps it goes
// at Store's receive. Recorded in workHandovers. Mutates po; returns the units.
function releaseReadyToProduction(po, user = null) {
  const ready = (po.workAtStore || []).filter(w => workState(po, w).state === 'ready');
  for (const w of ready) {
    po.workHandovers.push({ unitIndex: w.unitIndex, to: 'Production', by: user?._id || null, byName: user ? who(user) : 'automatic',
      note: `${w.outsourceOrderNo} — QC passed / no QC: straight to Production` });
    po.workAtStore.pull(w._id);
  }
  return ready.map(w => w.unitIndex);
}

// Client change (2026-10-22): units back from a vendor, waiting at Store, QC
// passed, whose NEXT step is Out Source again — requested to Purchase
// automatically (Production has nothing to do on them). Since 2026-10-25 it
// also sends work whose next step is in-house straight to Production
// (releaseReadyToProduction). Called after Store's receive and after every QC
// decision on a production order. Never throws.
export async function autoRequestAtStore(companyId, productionOrderId, user = null) {
  try {
    const po = await ProductionOrder.findOne({ _id: productionOrderId, company: companyId });
    if (!po?.workAtStore?.length) return [];
    if (releaseReadyToProduction(po, user).length && !po.workAtStore.length) { await po.save(); return []; }
    const units = po.workAtStore.filter(w => workState(po, w).state === 'outsource').map(w => w.unitIndex);
    const made = units.length ? autoRequestOutsourceRuns(po, units) : [];
    if (made.length || po.isModified()) await po.save();
    if (made.length) await notifyAutoRequests(po, made);
    return made;
  } catch (err) {
    console.error('[DispatchTrip] auto outsource request at Store failed:', err.message);
    return [];
  }
}

// Store's list of work waiting at Store.
export async function pendingAtStore(companyId) {
  const orders = await ProductionOrder.find({ company: companyId, 'workAtStore.0': { $exists: true } });
  // Anything QC-passed left from before 2026-10-25 goes to Production now.
  for (const po of orders) if (releaseReadyToProduction(po).length) await po.save();
  const out = orders.map(po => ({
    productionOrder: po._id, orderCode: po.orderId, itemName: po.machineName, orderKind: po.orderKind,
    units: po.workAtStore.map(w => ({ unitIndex: w.unitIndex, unitNumber: w.unitIndex + 1, outsourceOrderNo: w.outsourceOrderNo, since: w.since, ...workState(po, w) })),
  })).filter(o => o.units.length);
  return [...out, ...await jobWorkAtStore(companyId)];
}

// Pieces back in part, waiting at Store for the rest (2026-10-26 — partial
// returns): requests still with the vendor that have something received.
export async function partlyBackAtStore(companyId) {
  const orders = await OutsourceOrder.find({ company: companyId, status: { $in: LIVE_ORDER }, 'lines.requests.arrivals.0': { $exists: true } })
    .select('orderNo vendorName lines').lean();
  const out = [];
  for (const o of orders) for (const l of o.lines || []) for (const r of l.requests || []) {
    if (r.status !== 'Sent') continue;
    const got = (r.arrivals || []).filter(a => a.receivedAt);
    if (!got.length) continue;
    out.push({
      outsourceOrder: o._id, orderNo: o.orderNo, vendorName: o.vendorName, lineId: l._id, itemName: l.itemName, stepNames: l.stepNames, unit: l.qtyUnit,
      requestId: r._id, holderId: holderOf(r), orderCode: r.orderCode, sentQty: r.qty, backQty: got.reduce((s, a) => s + a.count, 0),
      withVendor: withVendorQty(r), lostQty: r.lostQty || 0, onTrip: r.returnDispatch?.tripNo || '',
      arrivals: got.map(a => ({ count: a.count, tripNo: a.tripNo, receivedAt: a.receivedAt, receivedBy: a.receivedBy })),
    });
  }
  return out;
}

// Job-work pieces (a fully outsourced Sub Child Part) waiting at Store between
// trips (2026-10-22): a trip is back, steps are left, and no trip is out or
// ordered. They only ever go on to the next vendor trip (Store hands them to
// Dispatch), never to Production — so nothing here is "ready" to hand over.
async function jobWorkAtStore(companyId) {
  const jws = await SubChildPartJobWorkOrder.find({ company: companyId, status: { $in: ['In Progress', 'Pending QC'] }, 'rounds.status': 'Received' }).lean();
  const out = [];
  const osoIds = new Set();
  const rows = [];
  for (const o of jws) {
    const rounds = o.rounds || [];
    if (rounds.some(r => ['Ordered', 'Sent'].includes(r.status))) continue; // out with a vendor
    const done = new Set(rounds.filter(r => r.status === 'Received').flatMap(r => r.jobWorkTypes));
    const next = (o.jobWorkTypes || []).find(s => !done.has(s));
    if (!next) continue; // last step back — its final check / stock, not "at Store between trips"
    const last = rounds.filter(r => r.status === 'Received').sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))[0];
    if (last?.outsourceOrder) osoIds.add(String(last.outsourceOrder));
    rows.push({ o, last, next });
  }
  const osoNo = new Map((osoIds.size ? await OutsourceOrder.find({ _id: { $in: [...osoIds] } }).select('orderNo').lean() : []).map(x => [String(x._id), x.orderNo]));
  for (const { o, last, next } of rows) {
    // Less pieces written off at a vendor too (2026-10-26).
    const pcs = Math.max(0, (o.orderQuantity || 0) - (o.qc?.rejectedQty || 0) - lostTotal(o));
    const qc = last?.qc?.status;
    const label = qc === 'Pending' ? `${pcs} pcs · In QC (${(last.qc.stepNames || last.jobWorkTypes).join(', ')})`
      : qc === 'Rejected' ? `${pcs} pcs · QC rejected`
      : `${pcs} pcs · next ${next} is outsourced — stays at Store for the next trip`;
    out.push({
      productionOrder: o._id, jobWork: true, orderCode: o.orderId, itemName: o.itemName, orderKind: 'SubChildPart',
      units: [{ unitIndex: 0, unitNumber: 1, outsourceOrderNo: last?.outsourceOrder ? osoNo.get(String(last.outsourceOrder)) || '' : '', since: last?.receivedAt,
        stepNames: last?.jobWorkTypes || [], nextStep: next, state: qc === 'Pending' ? 'qc' : qc === 'Rejected' ? 'rework' : 'outsource', label }],
    });
  }
  return out;
}

// T8 / R4 — Store hands units whose QC passed (next step in-house) to Production.
export async function handToProduction(companyId, productionOrderId, unitIndices, user) {
  const po = await ProductionOrder.findOne({ _id: productionOrderId, company: companyId });
  if (!po) throw new HttpError(404, 'Production order not found.');
  const units = (Array.isArray(unitIndices) ? unitIndices : []).map(Number);
  if (!units.length) throw new HttpError(400, 'Pick the units to hand over.');
  const moving = units.map(u => {
    const w = (po.workAtStore || []).find(x => x.unitIndex === u);
    if (!w) throw new HttpError(400, `Unit ${u + 1} isn't at Store.`);
    const st = workState(po, w);
    if (st.state !== 'ready') throw new HttpError(400, `Unit ${u + 1}: ${st.label}.`);
    return w;
  });
  for (const w of moving) {
    po.workHandovers.push({ unitIndex: w.unitIndex, to: 'Production', by: user._id, byName: who(user), note: w.outsourceOrderNo });
    po.workAtStore.pull(w._id);
  }
  await po.save();
  return po;
}

// ── Partial returns: "not coming" (2026-10-26) ──────────────────────────────
// docs/outsource-v2/partial-returns-2026-10.md. Pieces of a Sub Child Part
// request that won't come back from the vendor (lost, or kept / scrapped by
// it) — written off by Purchase or Store, with a reason. Recorded on the
// request (lostQty) and on its order (lostAtVendor): every "how many pieces"
// place then uses order qty − lost (QC, stock, cost, the next trips). Their
// value comes off the bill as "lost at vendor". A cascade order (a sales order
// / a Child Part build needs them) gets a replacement order for the lost qty;
// a low-stock order doesn't (the low-stock job re-raises if needed). When
// everything else is back at Store, the request is received now.
export async function markNotComing(companyId, { outsourceOrder, requestId, qty, reason, lostUnitIds, acknowledgeWarnings }, user, from = 'Purchase') {
  const why = String(reason || '').trim();
  if (!why) throw new HttpError(400, 'Say why they\'re not coming (e.g. lost at the vendor, scrapped by the vendor).');
  const n = Number(qty);
  if (!(Number.isInteger(n) && n > 0)) throw new HttpError(400, 'Enter how many pieces aren\'t coming (a whole number).');
  const order = await OutsourceOrder.findOne({ _id: outsourceOrder, company: companyId });
  if (!order) throw new HttpError(404, 'Outsource order not found.');
  let line = null; let r = null;
  for (const l of order.lines) { const x = l.requests.id(requestId); if (x) { line = l; r = x; break; } }
  if (!r) throw new HttpError(404, 'Request not found on this order.');
  if (line.qtyUnit !== 'pcs') throw new HttpError(400, 'Units aren\'t written off here — a missing unit comes back later, or Purchase re-orders it.');
  if (r.status !== 'Sent') throw new HttpError(400, `${r.orderCode} isn't with the vendor.`);
  const left = withVendorQty(r);
  if (n > left) throw new HttpError(400, `Only ${fmt(left)} ${line.qtyUnit} of ${r.orderCode} are still with the vendor.`);
  // Lost pieces holding a serial: which ones (2 Nov review). Nothing reaches
  // Store, so they skip Defective Inventory.
  const lostHolder = r.kind === 'jobWork'
    ? await SubChildPartJobWorkOrder.findOne({ _id: r.jobWorkOrder, company: companyId }).select('orderId subChildPartItem').lean()
    : await ProductionOrder.findOne({ _id: r.productionOrder, company: companyId }).select('orderId subChildPartItem').lean();
  let lostPick = null;
  if (lostHolder?.subChildPartItem) {
    lostPick = await checkPiecePick({ companyId, orderRef: lostHolder._id, itemId: lostHolder.subChildPartItem, qty: n, onHand: Number(r.qty) || n, unitIds: lostUnitIds });
    if (lostPick.error) throw new HttpError(400, lostPick.error);
  }
  if (lostPick?.skip && !acknowledged(acknowledgeWarnings)) throw needConfirm([lostPick.skip.text]);

  const byName = who(user);
  r.lostQty = (Number(r.lostQty) || 0) + n;
  r.lost = [...(r.lost || []), { at: new Date(), qty: n, reason: why, byName, from }];

  // The order the pieces belong to.
  const lostEntry = { qty: n, reason: why, at: new Date(), byName, outsourceOrderNo: order.orderNo };
  let holder;
  if (r.kind === 'jobWork') {
    holder = await SubChildPartJobWorkOrder.findOne({ _id: r.jobWorkOrder, company: companyId });
    if (!holder) throw new HttpError(404, 'Its job-work order no longer exists.');
    lostEntry.jobWorkTypes = holder.rounds.id(r.roundId)?.jobWorkTypes || [];
  } else {
    holder = await ProductionOrder.findOne({ _id: r.productionOrder, company: companyId });
    const h = holder?.outsourceHandoffs.id(r.handoffId);
    if (!h) throw new HttpError(404, 'Its production order hand-off no longer exists.');
    lostEntry.handoffId = h._id;
    lostEntry.stepIndex = Math.min(...(h.stepIndices?.length ? h.stepIndices : [0]));
    lostEntry.onRework = h.subChildPartQty != null;
    if (lostEntry.onRework) {
      // A rework resend: off the batch as scrap at the QC step it was resent for.
      const QCJob = (await import('../models/QCJob.js')).default;
      const { qcJobSourceForOrder } = await import('../controllers/productionMfgController.js');
      const { getQcStepIndices } = await import('./qcStepService.js');
      const qcIdx = getQcStepIndices(holder, holder.processes).filter(i => h.stepIndices.includes(i));
      const qcJob = qcIdx.length ? await QCJob.findOne({ source: qcJobSourceForOrder(holder), sourceRefId: holder.orderId, company: companyId }) : null;
      const proc = qcIdx.length ? holder.processes[Math.min(...qcIdx)] : null;
      const entry = proc ? qcJob?.batchSteps?.find(b => b.category === proc.category && b.stepName === proc.step) : null;
      if (entry) {
        entry.scrapQty = (Number(entry.scrapQty) || 0) + n;
        entry.reworkPendingQty = Math.max(0, (Number(entry.reworkPendingQty) || 0) - n);
        await qcJob.save();
      }
    }
  }

  // A cascade order: the same need gets a replacement order for the lost qty.
  let replacement = null;
  if (['MachineCascade', 'ChildPartCascade'].includes(holder.demandSource)) {
    const item = await Item.findOne({ _id: holder.subChildPartItem, companyId });
    if (item) {
      const { createSubChildPartOrderForItem } = await import('./subChildPartOrderService.js');
      const res = await createSubChildPartOrderForItem(item, companyId, {
        demandSource: holder.demandSource, demandRefId: holder.demandRefId, buildQtyOverride: n,
        deliverToParent: !!holder.deliverToParent, parentOrderNo: holder.parentOrderNo || '',
        replacesLostOf: { orderId: holder._id, orderCode: holder.orderId, why: 'Lost at the vendor' },
      });
      const { addCoverOrder, coverNotReplaced } = await import('./cascadeDeliveryService.js');
      if (res.created) {
        replacement = res.order;
        lostEntry.replacementOrderId = res.order._id;
        lostEntry.replacementOrderCode = res.order.orderId;
        if (holder.deliverToParent) {
          await addCoverOrder(holder.demandRefId, item._id, { model: res.kind === 'out-source' ? 'SubChildPartJobWorkOrder' : 'ProductionOrder', orderRef: res.order._id, orderNo: res.order.orderId });
        }
      } else {
        await coverNotReplaced(holder, item, n);
      }
    }
  }
  holder.lostAtVendor = [...(holder.lostAtVendor || []), lostEntry];
  await holder.save(); // before any receive below, so it counts the right pieces
  await logSkippedSerials(companyId, [lostPick?.skip], { screen: 'Lost at vendor', reference: `${order.orderNo} · ${lostHolder?.orderId || ''}`, by: byName });
  if (lostPick?.unitIds?.length) {
    await move({ unitIds: lostPick.unitIds, place: { kind: 'Lost', order: lostHolder._id, orderNo: lostHolder.orderId }, what: `Lost at ${order.vendorName || 'the vendor'} (${order.orderNo})`, by: byName, note: why, from: ['Issued'] });
  }

  const { takeLostOffBill } = await import('./outsourceBillService.js');
  const offBill = await takeLostOffBill(order, line, r, n, user);
  const replNote = replacement ? ` Replacement order ${replacement.orderId} raised for ${fmt(n)}.`
    : holder.demandSource === 'LowStock' ? ' (A low-stock order — the low-stock job raises another if the stock is still low.)' : '';
  order.activity.push({ at: new Date(), by: user?._id || null, byName, action: 'not-coming', summary: `${line.itemName}: ${r.orderCode} — ${fmt(n)} ${line.qtyUnit} not coming back from ${order.vendorName} (${from}: "${why}")${offBill ? `; ₹${offBill.toLocaleString('en-IN')} off the bill` : ''}.${replNote}` });

  // The rest still on a planned return trip: its entry follows.
  if (r.returnDispatch?.trip) {
    const trip = await DispatchTrip.findOne({ _id: r.returnDispatch.trip, company: companyId });
    if (trip && trip.status !== 'Cancelled') {
      for (const s of trip.stops) for (const j of s.jobs) {
        const e = (j.returns || []).find(x => String(x.requestId) === String(r._id) && !x.collected?.at && !x.received?.at);
        if (!e) continue;
        if (withVendorQty(r) > 0) { e.qty = withVendorQty(r); e.lostNote = lostNoteOf(r); }
        else j.returns = j.returns.filter(x => x !== e);
      }
      for (const s of trip.stops) for (const j of [...s.jobs]) if (j.kind === 'outsourceReturn' && !(j.returns || []).length) s.jobs.pull(j._id);
      if (withVendorQty(r) === 0) r.returnDispatch = { trip: null, tripNo: '' };
      trip.status = deriveTripStatus(trip);
      logTrip(trip, user, 'not-coming', `${order.orderNo} · ${line.itemName}: ${fmt(n)} of ${r.orderCode} not coming (${why}).`);
      await trip.save();
    }
  }

  // Everything else is back at Store → received now (QC, bill, next step).
  // Nothing came back at all → nothing for QC to check (2026-11-04).
  const complete = allBack(r);
  const wholeLoss = complete && takenBackQty(r) === 0;
  let closedOrderNo = '';
  if (wholeLoss) closedOrderNo = await closeWhollyLost(order, line, r, holder, user);
  else if (complete) await completeRequestReceive(order, line, r, user);
  await order.save();
  if (complete && r.kind === 'handoff') await autoRequestAtStore(companyId, r.productionOrder, user);
  return { order, request: r, complete, replacement, wholeLoss, closedOrderNo };
}

// Every piece of a request written off, nothing back (2026-11-04,
// docs/outsource-v2/all-lost-at-vendor-logic-2026-11.md). No QC, no stock, no
// offcut: the request closes with 0 accepted, so the bill stops waiting. With no
// pieces left the order closes as all lost; a rework resend whose batch has
// passed pieces lets that batch go on. Returns the closed order's number, or ''.
// The caller saves the Outsource Order.
async function closeWhollyLost(order, line, r, holder, user) {
  const now = new Date();
  let closes = true;
  let qcJob = null;
  if (r.kind === 'jobWork') {
    const round = holder.rounds.id(r.roundId);
    if (round) {
      Object.assign(round, { status: 'Received', receivedAt: now, receivedBy: user?._id || null });
      round.qc = { needed: false, status: 'Passed', sentQty: 0, passedQty: 0, rejectedQty: 0, decidedAt: now };
    }
    const { jobWorkPiecesLeft } = await import('../controllers/subChildPartJobWorkOrderController.js');
    closes = jobWorkPiecesLeft(holder) <= 0;
    if (closes && holder.qc) holder.qc.approvedQty = 0;
  } else {
    const QCJob = (await import('../models/QCJob.js')).default;
    const { qcJobSourceForOrder } = await import('../controllers/productionMfgController.js');
    const { getQcStepIndices, markJobApproved } = await import('./qcStepService.js');
    qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(holder), sourceRefId: holder.orderId, company: holder.company });
    const h = holder.outsourceHandoffs.id(r.handoffId);
    const round = h.rounds.id(r.roundId);
    Object.assign(round, { status: 'Received', receivedAt: now, receivedBy: user?._id || null });
    h.status = 'Completed';
    h.completedAt = now;
    const procs = holder.processes;
    const idxs = roundStepIndices(h, round);
    for (const i of idxs) if (procs[i]) procs[i].outsourceStatus = 'Received';
    if (h.subChildPartQty != null) {
      // A rework resend: its pieces are already scrap at the QC step. Pieces
      // that passed that step earlier carry on, and the step can now resolve.
      const qcIdx = getQcStepIndices(holder, procs).filter(i => idxs.includes(i));
      const qcProc = qcIdx.length ? procs[Math.min(...qcIdx)] : null;
      const entry = qcProc ? qcJob?.batchSteps?.find(b => b.category === qcProc.category && b.stepName === qcProc.step) : null;
      closes = !(Number(entry?.passedQty) > 0);
      if (!closes) {
        const resolved = (Number(entry.reworkPendingQty) || 0) === 0 && (Number(entry.passedQty) || 0) + (Number(entry.scrapQty) || 0) === Number(entry.qtyEnteringStep);
        for (const i of idxs) {
          if (resolved) Object.assign(procs[i], { status: 'Completed', completedAt: now, endDate: now.toISOString().split('T')[0] });
          else Object.assign(procs[i], { status: 'Pending', outsourceStatus: 'NotStarted' });
        }
        if (resolved && Math.max(...idxs) === procs.length - 1) {
          holder.status = 'Completed';
          holder.completedAt = now;
          holder.workAtStore = [];
          markJobApproved(qcJob);
          await qcJob.save();
        }
      }
    }
    if (closes) {
      // Later steps never run: nothing stays open for Purchase or Store.
      for (const other of holder.outsourceHandoffs) {
        if (other.status === 'Completed') continue;
        other.status = 'Completed';
        other.completedAt = now;
      }
      holder.workAtStore = [];
      if (qcJob && qcJob.status !== 'Approved') {
        markJobApproved(qcJob);
        await qcJob.save();
      }
    }
  }
  if (closes) {
    holder.status = 'Completed';
    holder.completedAt = now;
    holder.closedAllLost = true;
  }
  await holder.save(); // its Completed status also releases the reservations

  r.status = 'Received';
  r.receivedAt = now;
  r.qcAttempts = [];
  order.activity.push({ at: now, by: user?._id || null, byName: who(user), action: 'received', summary: `${line.itemName}: ${r.orderCode} — 0 back, ${fmt(r.lostQty)} not coming${closes ? ': the order closes as all lost, 0 made' : ''}.` });
  const { refreshAcceptance } = await import('./outsourceBillService.js');
  await refreshAcceptance(order, user);
  order.status = deriveStatus(order);
  return closes ? holder.orderId : '';
}
