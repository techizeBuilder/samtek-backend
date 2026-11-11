// Dispatch trips to vendors (outsource-v2 slice 6, 2026-10-20). Thin handlers
// over services/dispatchTripService.js — see that file's header.
import DispatchTrip from '../models/DispatchTrip.js';
import OutsourceOrder from '../models/OutsourceOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { withVendorQty } from '../services/outsourceRequestService.js';
import Vehicle, { normaliseVehicleNumber } from '../models/Vehicle.js';
import {
  waitingForDispatch, createTrip, cancelTrip, updateTripDetails, findJob, storeHandover, productionHandover,
  pendingForProductionOrder, pendingForStore, markDelivered, markPickedUp,
  vendorReadyFromDispatch, markCollected, reportShort, pendingStoreReceive, storeReceive, pendingAtStore, handToProduction,
  receivedAtStore, bringBackOnTrip, collectLater, annotateBringBack, listTripsPaged, poLineLater, partlyBackAtStore, markNotComing,
} from '../services/dispatchTripService.js';

function sendError(res, err) {
  const status = err.status || (err.code === 11000 ? 400 : 500);
  if (status === 500) console.error('[DispatchTrip]', err);
  res.status(status).json({ success: false, message: err.code === 11000 ? 'That vehicle number is already in the list.' : err.message, ...(err.confirmWarnings ? { data: { confirmWarnings: err.confirmWarnings } } : {}) });
}

async function loadTrip(req) {
  const trip = await DispatchTrip.findOne({ _id: req.params.id, company: req.user.companyId });
  if (!trip) { const e = new Error('Trip not found'); e.status = 404; throw e; }
  return trip;
}

const isSuper = (u) => ['Superadmin', 'Super Admin'].includes(u?.role);

// GET /api/dispatch-trips/waiting — POs to pick up and outsource lines to send, by vendor.
export const getWaiting = async (req, res) => {
  try {
    const data = await waitingForDispatch(req.user.companyId, { unit: isSuper(req.user) ? null : (req.user.unit || null) });
    res.json({ success: true, data });
  } catch (err) { sendError(res, err); }
};

// GET /api/dispatch-trips?status=Planned,Out
export const listTrips = async (req, res) => {
  try {
    // Paged on the server (2026-10-21): ?status=&search=&from=&to=&page=&limit=
    const { status, search, from, to, page, limit } = req.query;
    const { data, pagination } = await listTripsPaged(req.user.companyId, { status, search, from, to, page, limit });
    res.json({ success: true, data, pagination });
  } catch (err) { sendError(res, err); }
};

export const getTrip = async (req, res) => {
  try {
    const trip = await DispatchTrip.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });
    await annotateBringBack([trip], req.user.companyId);
    res.json({ success: true, data: trip });
  } catch (err) { sendError(res, err); }
};

export const postTrip = async (req, res) => {
  try {
    const trip = await createTrip(req.body || {}, req.user);
    res.status(201).json({ success: true, message: `${trip.tripNo} planned.`, data: trip });
  } catch (err) { sendError(res, err); }
};

export const postCancelTrip = async (req, res) => {
  try {
    const trip = await cancelTrip(await loadTrip(req), req.user);
    res.json({ success: true, message: `${trip.tripNo} cancelled — its jobs are waiting again.`, data: trip });
  } catch (err) { sendError(res, err); }
};

// PUT /api/dispatch-trips/:id — change the vehicle / driver / date of a
// Planned trip (2026-10-24), even after the handovers.
export const putTripDetails = async (req, res) => {
  try {
    const { trip, what } = await updateTripDetails(await loadTrip(req), req.body || {}, req.user);
    res.json({ success: true, message: `${trip.tripNo} changed: ${what}.`, data: trip });
  } catch (err) { sendError(res, err); }
};

export const postDelivered = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await markDelivered(trip, stop, job, req.body || {}, req.user);
    res.json({ success: true, message: `${job.orderNo} · ${job.itemName} delivered to ${stop.vendorName}.`, data: trip });
  } catch (err) { sendError(res, err); }
};

export const postPickedUp = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await markPickedUp(trip, stop, job, req.user);
    res.json({ success: true, message: `${job.poNumber} picked up.`, data: trip });
  } catch (err) { sendError(res, err); }
};

// ── Slice 7 — the way back ───────────────────────────────────────────────

// POST /api/dispatch-trips/vendor-ready  body: { outsourceOrder, requestId } (T9)
export const postVendorReady = async (req, res) => {
  try {
    await vendorReadyFromDispatch(req.user.companyId, req.body || {}, req.user);
    res.json({ success: true, message: 'Marked ready to collect.' });
  } catch (err) { sendError(res, err); }
};

// POST /:id/jobs/:jobId/collected  body: { counts: { [requestId]: n } } (handover 3)
export const postCollected = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await markCollected(trip, stop, job, req.body?.counts, req.user);
    res.json({ success: true, message: 'Collected — Store receives it.', data: trip });
  } catch (err) { sendError(res, err); }
};

// The vehicle waits & brings it back (2026-10-21) — fallback 2: a delivered
// line comes back on this same trip.
export const postBringBack = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await bringBackOnTrip(trip, stop, job, req.user);
    res.json({ success: true, message: `${job.orderNo} · ${job.itemName} comes back on ${trip.tripNo}.`, data: trip });
  } catch (err) { sendError(res, err); }
};

// Fallback 1: the vendor isn't ready — the uncounted requests leave this trip.
export const postCollectLater = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await collectLater(trip, stop, job, req.user);
    res.json({ success: true, message: `${job.orderNo} · ${job.itemName} left for a later trip (To collect).`, data: trip });
  } catch (err) { sendError(res, err); }
};

// POST /:id/jobs/:jobId/po-line-later  body: { lineId } — one PO line not ready (2026-10-26)
export const postPoLineLater = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await poLineLater(trip, stop, job, req.body?.lineId, req.user);
    res.json({ success: true, message: 'Left for a later trip — it is back on the Purchase list.', data: trip });
  } catch (err) { sendError(res, err); }
};

// POST /:id/jobs/:jobId/short  body: { requestId, count, note } (R1, Dispatch)
export const postShort = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await reportShort(trip, stop, job, req.body?.requestId, req.body || {}, req.user, 'Dispatch');
    res.json({ success: true, message: 'Reported short — Purchase is told; it waits for a later trip.', data: trip });
  } catch (err) { sendError(res, err); }
};

// ── Store ────────────────────────────────────────────────────────────────

export const getStoreReceive = async (req, res) => {
  try {
    res.json({ success: true, data: await pendingStoreReceive(req.user.companyId) });
  } catch (err) { sendError(res, err); }
};

export const postStoreReceive = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await storeReceive(trip, stop, job, req.body?.requestId, req.body || {}, req.user);
    // Say what really happens next (2026-10-24 — it always said "goes to QC",
    // even for steps with no QC).
    let toQc = false;
    const order = await OutsourceOrder.findOne({ _id: job.outsourceOrder, company: req.user.companyId }).lean();
    const r = order?.lines.flatMap(l => l.requests).find(x => String(x._id) === String(req.body?.requestId));
    // Pieces back in part (2026-10-26): they wait at Store for the rest.
    if (r?.status === 'Sent') {
      const left = withVendorQty(r);
      return res.json({ success: true, message: `Received — ${left} still with the vendor; these wait at Store until the rest is back (or written off as not coming).`, data: trip });
    }
    if (r?.kind === 'handoff') toQc = (r.qcAttempts || []).length > 0;
    else if (r?.kind === 'jobWork') {
      const jw = await SubChildPartJobWorkOrder.findById(r.jobWorkOrder).select('status rounds').lean();
      const round = (jw?.rounds || []).find(x => String(x._id) === String(r.roundId));
      toQc = jw?.status === 'Pending QC' || round?.qc?.needed === true;
    }
    res.json({ success: true, message: toQc ? 'Received — it goes to QC.' : 'Received — no QC on these steps; the work is accepted.', data: trip });
  } catch (err) { sendError(res, err); }
};

export const postStoreShort = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { stop, job } = findJob(trip, req.params.jobId);
    await reportShort(trip, stop, job, req.body?.requestId, req.body || {}, req.user, 'Store');
    // Before Dispatch collected (2026-10-26) it left the trip, like Dispatch's short.
    const e = (job.returns || []).find(x => String(x.requestId) === String(req.body?.requestId));
    const message = e && !e.collected?.at
      ? 'Reported short — Purchase is told; it goes back to Dispatch\'s "To collect" for a later trip.'
      : 'Reported — Store counted fewer than Dispatch collected; Dispatch and Store are told to find the rest (not a vendor matter).';
    res.json({ success: true, message, data: trip });
  } catch (err) { sendError(res, err); }
};

// Store's Received list (Outsource Receive page) — every receive + its leftovers.
export const getStoreReceived = async (req, res) => {
  try {
    const { search, from, to, page, limit } = req.query;
    const { data, pagination } = await receivedAtStore(req.user.companyId, { search, from, to, page, limit });
    res.json({ success: true, data, pagination });
  } catch (err) { sendError(res, err); }
};

export const getAtStore = async (req, res) => {
  try {
    res.json({ success: true, data: await pendingAtStore(req.user.companyId) });
  } catch (err) { sendError(res, err); }
};

// GET /store/partly-back — pieces back in part, waiting for the rest (2026-10-26).
export const getPartlyBack = async (req, res) => {
  try {
    res.json({ success: true, data: await partlyBackAtStore(req.user.companyId) });
  } catch (err) { sendError(res, err); }
};

// POST /store/not-coming  body: { outsourceOrder, requestId, qty, reason } (2026-10-26).
export const postStoreNotComing = async (req, res) => {
  try {
    const { notComingMessage } = await import('./outsourceOrderController.js');
    const out = await markNotComing(req.user.companyId, req.body || {}, req.user, 'Store');
    res.json({ success: true, message: notComingMessage(out) });
  } catch (err) { sendError(res, err); }
};

export const postHandToProduction = async (req, res) => {
  try {
    const po = await handToProduction(req.user.companyId, req.body?.productionOrder, req.body?.unitIndices, req.user);
    res.json({ success: true, message: `Handed to Production — ${po.orderId}.` });
  } catch (err) { sendError(res, err); }
};

export const getStorePending = async (req, res) => {
  try {
    res.json({ success: true, data: await pendingForStore(req.user.companyId) });
  } catch (err) { sendError(res, err); }
};

export const postStoreHandover = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { job } = findJob(trip, req.params.jobId);
    await storeHandover(trip, job, req.body || {}, req.user);
    res.json({ success: true, message: `Handed over to Dispatch (${trip.tripNo}).`, data: trip });
  } catch (err) { sendError(res, err); }
};

// ── Production ───────────────────────────────────────────────────────────

export const getProductionPending = async (req, res) => {
  try {
    res.json({ success: true, data: await pendingForProductionOrder(req.user.companyId, req.params.orderId) });
  } catch (err) { sendError(res, err); }
};

export const postProductionHandover = async (req, res) => {
  try {
    const trip = await loadTrip(req);
    const { job } = findJob(trip, req.params.jobId);
    await productionHandover(trip, job, req.body?.productionOrder, req.user);
    res.json({ success: true, message: `Handed over to Dispatch (${trip.tripNo}).`, data: trip });
  } catch (err) { sendError(res, err); }
};

// ── Vehicles ─────────────────────────────────────────────────────────────

function vehicleFields(body) {
  const out = {};
  if (body.number != null) out.number = normaliseVehicleNumber(body.number);
  if (body.type != null) out.type = ['Tempo', 'Pickup', 'Truck', 'Other'].includes(body.type) ? body.type : 'Other';
  if (body.ownership != null) out.ownership = body.ownership === 'Hired' ? 'Hired' : 'Own';
  for (const k of ['transporterName', 'transporterPhone', 'driverName', 'driverPhone']) if (body[k] != null) out[k] = String(body[k]).trim();
  if (body.capacityKg !== undefined) out.capacityKg = body.capacityKg === '' || body.capacityKg == null ? null : Number(body.capacityKg);
  if (body.active != null) out.active = !!body.active;
  return out;
}

export const listVehicles = async (req, res) => {
  try {
    const q = { company: req.user.companyId };
    if (req.query.active === 'true') q.active = true;
    res.json({ success: true, data: await Vehicle.find(q).sort({ active: -1, number: 1 }).lean() });
  } catch (err) { sendError(res, err); }
};

export const postVehicle = async (req, res) => {
  try {
    const f = vehicleFields(req.body || {});
    if (!f.number) return res.status(400).json({ success: false, message: 'Enter the vehicle number.' });
    const v = await Vehicle.create({ ...f, company: req.user.companyId, createdBy: req.user._id });
    res.status(201).json({ success: true, message: `${v.number} added.`, data: v });
  } catch (err) { sendError(res, err); }
};

export const putVehicle = async (req, res) => {
  try {
    const f = vehicleFields(req.body || {});
    if (f.number === '') return res.status(400).json({ success: false, message: 'Enter the vehicle number.' });
    const v = await Vehicle.findOneAndUpdate({ _id: req.params.vehicleId, company: req.user.companyId }, { $set: f }, { new: true, runValidators: true });
    if (!v) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    res.json({ success: true, message: `${v.number} saved.`, data: v });
  } catch (err) { sendError(res, err); }
};
