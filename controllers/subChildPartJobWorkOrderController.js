// Sub Child Part — Out-Source (Purchase) job-work order actions. See
// server/models/SubChildPartJobWorkOrder.js for the full shape/rationale.
// These orders are raised only by the cron (subChildPartOrderService.js) —
// no manual creation endpoint in this pass.
//
// Trips go out and come back through Dispatch and Store (outsource-v2 slices
// 6–8): Store hands the raw material over (dispatchTripService), so the send
// here moves no stock. An older whole-sheet send's leftover is still measured
// at the receive (subChildPartMaterialSendService.captureFinalLeftover; this
// order is passed as the `holder`).
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { lostTotal } from '../utils/lostAtVendor.js';
import { Item } from '../models/Inventory.js';
import QCJob from '../models/QCJob.js';
import { computeSubChildPartRawMaterialAvailabilityLive } from '../services/subChildPartOrderService.js';
import { HttpError, captureFinalLeftover } from '../services/subChildPartMaterialSendService.js';
import { captureSubChildPartActualCost } from './subChildPartMasterController.js';
import notificationService from '../services/notificationService.js';
// Serial number work step 1 (2026-10-31): a finished cascade part goes to its parent order, else stock.
import { deliverFinishedParts } from '../services/cascadeDeliveryService.js';

// order.rawMaterial is a creation-time snapshot (see the model's own
// comment) — Store stock can move afterward, so both the list and detail
// GETs re-run the same availability math live, read-only (no Purchase
// Request side effect, and no new MaterialReservation write — see
// computeSubChildPartRawMaterialAvailabilityLive's own header comment on why
// this must stay separate from the PR-raising creation-time version the
// cron uses). Batches the two Item lookups per order into one query each
// rather than N+1, since the list endpoint has no pagination.
async function attachLiveAvailability(orders) {
  const subChildPartIds = orders.map(o => o.subChildPartItem).filter(Boolean);
  const sourceItemIds = orders.map(o => o.rawMaterial?.sourceItem).filter(Boolean);
  const [subChildParts, sourceItems] = await Promise.all([
    Item.find({ _id: { $in: subChildPartIds } }).lean(),
    Item.find({ _id: { $in: sourceItemIds } }).lean(),
  ]);
  const subChildPartById = new Map(subChildParts.map(i => [String(i._id), i]));
  const sourceItemById = new Map(sourceItems.map(i => [String(i._id), i]));

  for (const order of orders) {
    const item = subChildPartById.get(String(order.subChildPartItem));
    const sourceItem = sourceItemById.get(String(order.rawMaterial?.sourceItem));
    order.liveAvailability = (item && sourceItem)
      ? await computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order)
      : null;
  }
  return orders;
}

// GET /api/purchase/sub-child-job-work
export const listSubChildPartJobWorkOrders = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search, status } = req.query;
    const query = { company: companyId };
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { itemCode: { $regex: search, $options: 'i' } },
        { itemName: { $regex: search, $options: 'i' } },
        { orderId: { $regex: search, $options: 'i' } },
      ];
    }
    const [data, total, pending, inProgress, pendingQC, completed, qcRejected] = await Promise.all([
      SubChildPartJobWorkOrder.find(query).sort({ createdAt: -1 }).lean(),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'Pending' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'In Progress' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'Pending QC' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, status: 'Completed' }),
      SubChildPartJobWorkOrder.countDocuments({ company: companyId, 'qc.rejectedQty': { $gt: 0 } }),
    ]);
    await attachLiveAvailability(data);
    res.json({ success: true, data, summary: { total, pending, inProgress, pendingQC, completed, qcRejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/purchase/sub-child-job-work/:id
export const getSubChildPartJobWorkOrder = async (req, res) => {
  try {
    const order = await SubChildPartJobWorkOrder.findOne({ _id: req.params.id, company: req.user.companyId })
      .populate('subChildPartItem', 'name code qty unit')
      .populate('rawMaterial.sourceItem', 'name code unit')
      .lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    // .populate() above replaced these ObjectId fields with partial Item
    // objects (name/code/qty/unit only) — extract the real _id back out to
    // fetch the FULL Item (subChildPartDetails included), which the
    // availability computation below actually needs.
    const subChildPartId = order.subChildPartItem?._id || order.subChildPartItem;
    const sourceItemId = order.rawMaterial?.sourceItem?._id || order.rawMaterial?.sourceItem;
    const [item, sourceItem] = await Promise.all([
      subChildPartId ? Item.findById(subChildPartId).lean() : null,
      sourceItemId ? Item.findById(sourceItemId).lean() : null,
    ]);
    order.liveAvailability = (item && sourceItem)
      ? await computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order)
      : null;
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const coveredJobWorkTypes = (order) =>
  new Set(order.rounds.filter(r => r.status === 'Received').flatMap(r => r.jobWorkTypes));

// ── One trip out and back (outsource-v2 slice 2, 2026-10-20) ──────────────
// A round is one trip: Ordered (claimed by an Outsource Order) → Sent →
// Received. The Outsource Order (outsourceOrderController.js, through
// outsourceRequestService.js) calls these two core functions; neither saves
// the order — the caller does.

// Purchase sends a trip. `round` is the Ordered round an Outsource Order
// claimed (it becomes Sent). The first trip of the order is the only time
// its raw material leaves Store (`material` = the cut / whole / leftover
// choice); every later trip moves the same, already-sent material on.
// Dispatch delivered a trip (outsource-v2 slices 6 / 8). Store already handed
// the raw material to Dispatch (dispatchTripService.storeHandover — stock
// out, reservation issued), so no stock moves here.
export async function sendJobWorkTrip({ order, user, round }) {
  if (!round) throw new HttpError(400, 'Trips go out through an Outsource Order and Dispatch.');
  if (order.status === 'Completed') throw new HttpError(400, 'This order is already completed.');
  if (round && round.status !== 'Ordered') throw new HttpError(400, 'This trip has already been sent.');
  const requested = [...round.jobWorkTypes];
  if (!requested.length) throw new HttpError(400, 'This trip covers no job work type.');
  const onOtherTrips = new Set(order.rounds.filter(r => r !== round && (r.status === 'Sent' || r.status === 'Received')).flatMap(r => r.jobWorkTypes));
  const validSet = new Set(order.jobWorkTypes);
  const invalid = requested.filter(t => !validSet.has(t) || onOtherTrips.has(t));
  if (invalid.length) {
    throw new HttpError(400, `These job work types can't be sent: ${invalid.join(', ')} (not on this order, or already sent).`);
  }

  round.status = 'Sent';
  round.sentAt = new Date();
  round.sentBy = user._id;
  if (order.status === 'Pending') order.status = 'In Progress';
}

// POST /api/purchase/sub-child-job-work/:id/rounds — the old direct "Send
// Round". Closed (outsource-v2 slice 2, user decision Q1): every trip now
// goes through an Outsource Order (a vendor, a price, approval).
export const sendSubChildPartJobWorkRound = async (req, res) => {
  res.status(400).json({ success: false, message: 'Make an Outsource Order for this request — trips are sent from the order.' });
};

// Duplicated (not imported) from qcController.js/purchaseRequestController.js's
// own identical helper — this codebase's established convention for small,
// private per-controller ID generators rather than cross-importing them.
async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({ qcJobId: new RegExp(`^QC-${year}-`) }).sort({ qcJobId: -1 }).lean();
  let nextNumber = 1;
  if (lastJob?.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
  }
  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// Sends the finished order's quantity to QC instead of crediting stock
// directly — mirrors createPurchaseQCJob (purchaseRequestController.js) as
// closely as this order shape allows. Stock is only credited once QC
// actually approves (qcController.js's submitDecision,
// source:'SubChildPartJobWork' branch). Also where the job's real cost is
// captured: Purchase enters what the whole order was invoiced for, divided
// here by orderQuantity into the per-unit BOM figure, alongside a fresh
// Materials Cost pull (the raw material's price may have moved since this
// Sub Child Part was last priced) — the Manual estimate flips to 'Actual'
// exactly like RDBOM.productionCost's own mechanic does at Production's
// Final Testing step, just entered as a batch total here since this order
// completes as one whole batch, not a tracked-per-unit build.
// ── Per-step QC (2026-10-22) ──────────────────────────────────────────────
// Each trip's steps that have "QC required" (the Sub Child Part's process
// definition) are checked when the trip comes back: the next step can be
// ordered only after the check passes, and the trip's Outsource Order line is
// paid from its own check. A trip with no QC step passes straight away. The
// last trip's check is the order's final one (credits stock on Pass).
const normStep = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export function jobWorkQcSteps(item) {
  const out = new Set();
  for (const cat of item?.subChildPartDetails?.processDefinition || []) {
    for (const p of cat.internalProcesses || []) if (p.qcRequired) out.add(normStep(p.name));
  }
  return out;
}
// Pieces still in the order: what QC hasn't rejected so far.
// Pieces still in the order: less QC rejects and pieces lost at a vendor (2026-10-26).
export const jobWorkPiecesLeft = (order) => Math.max(0, (Number(order.orderQuantity) || 0) - (Number(order.qc?.rejectedQty) || 0) - lostTotal(order));

async function createJobWorkQcJob(order, round, item, user, stepNames, { final = false } = {}) {
  const qty = jobWorkPiecesLeft(order);
  const qcJob = await QCJob.create({
    qcJobId: await generateQCJobId(),
    source: 'SubChildPartJobWork',
    subChildPartJobWorkOrderId: order._id,
    jobWorkRoundId: round._id,
    sourceRefId: order.orderId,
    sourceDepartment: 'Purchase',
    sentBy: user.fullName || user.username || 'Purchase Dept',
    itemName: item.name,
    itemCode: item.code,
    category: item.category || 'Assemblies',
    quantity: qty,
    unit: item.unit || 'pcs',
    receivedDate: new Date().toISOString().split('T')[0],
    status: 'Pending',
    company: order.company,
    createdBy: user._id,
    notes: final
      ? `Job Work order ${order.orderId} — last step(s): ${stepNames.join(', ')}. Pass puts the pieces into stock.`
      : `Job Work order ${order.orderId} — step check after trip ${round.roundNumber}: ${stepNames.join(', ')}. Pass lets the next step go out.`,
  });
  round.qc = { needed: true, stepNames, qcJobId: qcJob._id, status: 'Pending', sentQty: qty, passedQty: null, rejectedQty: 0, decidedAt: null };
  try {
    await notificationService.triggerQCNotification({
      action: 'qc_job_created',
      data: { qcJobId: qcJob.qcJobId, itemName: item.name, quantity: qty },
      targetCompanyId: order.company,
    });
  } catch (e) { console.error('[SubChildPartJobWork] QC notification error:', e); }
  return qcJob;
}

async function sendToQCAndCaptureCost(order, item, sourceItem, body, user, round, stepNames) {
  // Slice 4 (2026-10-24): a trip on an Outsource Order is costed
  // automatically from that order (partCostService.pushJobWorkCost, once the
  // order completes). Only an older trip sent before Outsource Orders still
  // types the total here.
  if (!round.outsourceOrder) {
    const totalJobWorkCost = Number(body.totalJobWorkCost);
    if (!(totalJobWorkCost > 0)) {
      throw new HttpError(400, 'Enter the total job work cost for this order before completing the receive.');
    }
    await captureSubChildPartActualCost(item, sourceItem, totalJobWorkCost, order.orderQuantity);
    order.jobWorkCostTotal = totalJobWorkCost;
  }
  order.qc.sentQty = jobWorkPiecesLeft(order);

  const existingQC = order.qcJobId ? await QCJob.findById(order.qcJobId) : null;
  if (existingQC) return;
  if (stepNames.length) {
    order.status = 'Pending QC';
    const qcJob = await createJobWorkQcJob(order, round, item, user, stepNames, { final: true });
    order.qcJobId = qcJob._id;
    return;
  }
  // The last step has no QC: the pieces go straight into stock.
  const qty = jobWorkPiecesLeft(order);
  await deliverFinishedParts({ order, model: 'SubChildPartJobWorkOrder', itemId: order.subChildPartItem, qty, by: user?.fullName || user?.username || '' });
  order.qc.approvedQty = qty;
  order.status = 'Completed';
  order.completedAt = new Date();
  round.qc = { needed: false, status: 'Passed', sentQty: qty, passedQty: qty, rejectedQty: 0, decidedAt: new Date() };
}

// Purchase receives a trip back. When this trip finishes the order (every
// job work type back): the total job-work cost is required (pre-filled from
// the Outsource Order on the page, outsource-v2 slice 2), a "whole sheet /
// piece" first send needs the measured leftover, and the whole order goes to
// QC — stock is credited only when QC approves (qcController.js). The cost
// is checked BEFORE the leftover is credited (2026-10-20 — before, a refused
// receive had already credited the leftover, so a retry credited it twice).
export async function receiveJobWorkTrip({ order, round, body = {}, user }) {
  if (round.status !== 'Sent') throw new HttpError(400, round.status === 'Received' ? 'This round has already been received.' : 'This trip hasn\'t been sent yet.');

  const coveredAfter = new Set([...coveredJobWorkTypes(order), ...round.jobWorkTypes]);
  const nowComplete = order.jobWorkTypes.every(t => coveredAfter.has(t));
  // Slice 4 (2026-10-24, Q3): no "enter the time first" block any more — the
  // cost waits for the time by itself and is pushed when it's entered.
  if (nowComplete && !round.outsourceOrder && !(Number(body.totalJobWorkCost) > 0)) {
    throw new HttpError(400, 'Enter the total job work cost for this order before completing the receive.');
  }

  round.status = 'Received';
  round.receivedAt = new Date();
  round.receivedBy = user._id;

  const scpItem = await Item.findById(order.subChildPartItem).lean();
  const qcSet = jobWorkQcSteps(scpItem);
  const qcSteps = round.jobWorkTypes.filter(s => qcSet.has(normStep(s)));

  if (!nowComplete) {
    // A trip before the last: check its QC steps now (per-step QC); no QC step → passed.
    if (qcSteps.length) await createJobWorkQcJob(order, round, scpItem, user, qcSteps);
    else {
      const qty = jobWorkPiecesLeft(order);
      round.qc = { needed: false, status: 'Passed', sentQty: qty, passedQty: qty, rejectedQty: 0, decidedAt: new Date() };
    }
  }

  if (nowComplete) {
    // Case 2 ("whole sheet/piece" sent on round 1) — the real leftover is
    // only knowable now, once the finished Sub Child Part actually comes
    // back. Case 1 (already logged its leftover, if any, at send time) and
    // plain material skip this entirely.
    let sourceItem = null;
    if (order.rawMaterial?.sentCase === 'whole' && !order.rawMaterial.leftoverCaptured) {
      sourceItem = await Item.findById(order.rawMaterial.sourceItem);
      if (!sourceItem) throw new HttpError(404, 'Source material Item no longer exists.');
      await captureFinalLeftover(order, sourceItem, body);
    }

    const item = await Item.findById(order.subChildPartItem);
    if (!item) throw new HttpError(404, 'Sub Child Part Item no longer exists.');
    if (!sourceItem) sourceItem = await Item.findById(order.rawMaterial.sourceItem);
    if (!sourceItem) throw new HttpError(404, 'Source material Item no longer exists.');

    // The last step(s) with QC → the final check (stock on Pass); none → stock now.
    await sendToQCAndCaptureCost(order, item, sourceItem, body, user, round, qcSteps);
  }
}

// PUT /api/purchase/sub-child-job-work/:id/rounds/:roundId/receive — receive
// one trip. Still open for a round sent before slice 2 (no order); a round
// on an Outsource Order is collected by Dispatch and received by Store.
export const receiveSubChildPartJobWorkRound = async (req, res) => {
  try {
    const order = await SubChildPartJobWorkOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const round = order.rounds.id(req.params.roundId);
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });
    if (round.outsourceOrder) return res.status(400).json({ success: false, message: 'This trip is on an Outsource Order — Dispatch collects it and Store receives it (Material Transfers → From Outsource).' });
    await receiveJobWorkTrip({ order, round, body: req.body, user: req.user });
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};
