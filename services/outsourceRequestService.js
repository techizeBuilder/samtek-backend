// Outsource requests — one adapter over the two records an outsource request
// can be (outsource-v2 slice 2, 2026-10-20 — server/docs/outsource-v2/
// slice-2-outsource-order-plan.md §1–§2). How requests ARRIVE never changes;
// this only reads them and claims / sends / receives their trips for an
// Outsource Order:
//   - 'jobWork': SubChildPartJobWorkOrder — a Sub Child Part with every step
//     Out Source (Purchase only). Steps = jobWorkTypes. QC per QC step, on
//     each receive (2026-10-22; was once, at the end).
//   - 'handoff': ProductionOrder.outsourceHandoffs[] — a hybrid Sub Child
//     Part's step 0, or a Child Part / Machine sent by Production. Steps =
//     stepNames at its own stepIndices. QC per QC step, on each receive.
// A trip is a round on that record: Ordered → Sent → Received.
import mongoose from 'mongoose';
import { lostTotal, lostBetween, lostOnHandoff } from '../utils/lostAtVendor.js';
import QCJob from '../models/QCJob.js';
import { getQcStepIndices } from './qcStepService.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import ProductionOrder from '../models/ProductionOrder.js';
import { Item } from '../models/Inventory.js';
import { HttpError } from './subChildPartMaterialSendService.js';
import { sendJobWorkTrip, receiveJobWorkTrip } from '../controllers/subChildPartJobWorkOrderController.js';
import { sendHandoffTrip, receiveHandoffTrip } from '../controllers/outsourceWorkController.js';

const TAKEN = ['Ordered', 'Sent', 'Received'];
const IN_FLIGHT = ['Ordered', 'Sent'];
const JOB_WORK_OPEN = ['Pending', 'In Progress', 'Pending QC'];

// Step names compared ignoring case and repeated spaces (vendor Services and
// merging — workflow V7: services still match by name).
export const normStep = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const stepsKey = (names) => (names || []).map(normStep).join(' › ');

// Partial returns (2026-10-26 — docs/outsource-v2/partial-returns-2026-10.md).
// An Outsource Order request's pieces taken from the vendor so far, how many
// are written off, and how many are still with the vendor.
export const takenBackQty = (r) => (r.arrivals || []).reduce((s, a) => s + (Number(a.count) || 0), 0);
export const withVendorQty = (r) => Math.max(0, (Number(r.qty) || 0) - takenBackQty(r) - (Number(r.lostQty) || 0));
// Every part back at Store (received) and nothing left with the vendor.
export const allBack = (r) => withVendorQty(r) === 0 && (r.arrivals || []).every(a => a.receivedAt);

// The request key the page and the order use: 'jobWork:<id>' or
// 'handoff:<productionOrderId>:<handoffId>'.
export const requestKey = (r) => (r.kind === 'jobWork'
  ? `jobWork:${r.jobWorkOrder || r.id}`
  : `handoff:${r.productionOrder || r.id}:${r.handoffId}`);

export function parseRequestKey(key) {
  const [kind, a, b] = String(key || '').split(':');
  if (kind === 'jobWork' && mongoose.isValidObjectId(a)) return { kind, jobWorkOrder: a };
  if (kind === 'handoff' && mongoose.isValidObjectId(a) && mongoose.isValidObjectId(b)) return { kind, productionOrder: a, handoffId: b };
  return null;
}

// A unit's processes (unit 0 = order.processes, then extraUnits) — null when
// a later unit isn't materialized yet.
const unitProcs = (order, unitIndex) => (unitIndex ? order.extraUnits?.[unitIndex - 1]?.processes || null : order.processes);

function roundRef(round) {
  return round ? { roundId: round._id, status: round.status, outsourceOrder: round.outsourceOrder || null } : null;
}

// ── Views — what the request list shows (read-only, works on lean docs) ────

// The gate before a job-work order's next trip (per-step QC, 2026-10-22): a
// received trip's QC check must have passed (no QC step = passed at receive).
// Rounds received before this existed carry no check and don't block.
function jobWorkGate(o) {
  for (const r of (o.rounds || []).filter(x => x.status === 'Received')) {
    if (r.qc?.status === 'Pending') return `In QC — ${(r.qc.stepNames || r.jobWorkTypes).join(', ')}`;
    if (r.qc?.status === 'Rejected') return `QC rejected — ${(r.qc.stepNames || r.jobWorkTypes).join(', ')}`;
  }
  return null;
}

export function jobWorkView(o) {
  const all = o.jobWorkTypes || [];
  const taken = new Set((o.rounds || []).filter(r => TAKEN.includes(r.status)).flatMap(r => r.jobWorkTypes));
  const stepsLeft = all.filter(s => !taken.has(s));
  const openTrip = (o.rounds || []).find(r => IN_FLIGHT.includes(r.status)) || null;
  const gate = stepsLeft.length ? jobWorkGate(o) : null;
  let waiting = null;
  if (openTrip) waiting = openTrip.status === 'Ordered' ? 'Ordered' : 'With vendor';
  else if (gate) waiting = gate;
  else if (!stepsLeft.length) waiting = o.status === 'Completed' ? 'Done' : 'In QC';
  return {
    key: requestKey({ kind: 'jobWork', jobWorkOrder: o._id }),
    kind: 'jobWork',
    jobWorkOrder: o._id,
    orderCode: o.orderId,
    item: o.subChildPartItem,
    itemCode: o.itemCode,
    itemName: o.itemName,
    orderKind: 'SubChildPart',
    fullyOutsourced: true,
    // Pieces QC rejected on an earlier step don't go on — nor pieces lost at a vendor (2026-10-26).
    qty: Math.max(0, (o.orderQuantity || 0) - (o.qc?.rejectedQty || 0) - lostTotal(o)),
    qtyUnit: 'pcs',
    steps: all,
    stepsLeft,
    stepsReceived: all.filter(s => (o.rounds || []).some(r => r.status === 'Received' && r.jobWorkTypes.includes(s))),
    ready: !openTrip && !gate && stepsLeft.length > 0 && o.status !== 'Completed',
    waiting,
    openTrip: roundRef(openTrip),
    createdAt: o.createdAt,
  };
}

// The gate before a hand-off's next trip (QC design §5): every step already
// received is Completed on every unit (QC passed, or not a QC step).
function handoffGate(order, h) {
  const received = new Set((h.rounds || []).filter(r => r.status === 'Received').flatMap(r => r.coveredSteps));
  for (const unitIndex of h.unitIndices || [0]) {
    const procs = unitProcs(order, unitIndex);
    if (!procs) continue;
    for (let k = 0; k < (h.stepIndices || []).length; k++) {
      if (!received.has(h.stepNames[k])) continue;
      const proc = procs[h.stepIndices[k]];
      if (!proc || proc.status === 'Completed') continue;
      if (proc.outsourceStatus === 'NotStarted') return `QC rework of ${proc.step} — Production resends it`;
      return `In QC — ${proc.step}`;
    }
  }
  return null;
}

// The pieces entering a Sub Child Part step (2026-10-27): what passed the
// QC step before it (or the build quantity when there's none), less pieces
// lost at a vendor since — the same count QC uses for "entering". It used
// to be the order quantity less lost pieces only, so QC scrap (and pieces
// lost on a rework trip, which become scrap) still went out on later trips.
export function batchQtyAtStep(order, stepIdx, batchSteps = null) {
  const procs = order.processes || [];
  const qcBefore = getQcStepIndices(order, procs).filter(i => i < stepIdx);
  const prev = qcBefore.length ? Math.max(...qcBefore) : -1;
  let base = Number(order.orderQuantity) || 0;
  if (prev >= 0) {
    const p = procs[prev];
    const e = (batchSteps || []).find(b => b.category === p.category && b.stepName === p.step);
    if (e?.attempts?.length && !(e.reworkPendingQty > 0)) base = Number(e.passedQty) || 0;
  }
  return Math.max(0, base - lostBetween(order, prev, stepIdx - 1));
}

// QC batch entries per Sub Child Part production order, for the views.
export async function batchStepsByOrder(orders) {
  const scp = orders.filter(o => o.orderKind === 'SubChildPart');
  if (!scp.length) return new Map();
  const jobs = await QCJob.find({ sourceRefId: { $in: scp.map(o => o.orderId) }, company: { $in: [...new Set(scp.map(o => String(o.company)))] } }).select('sourceRefId batchSteps').lean();
  return new Map(jobs.map(j => [j.sourceRefId, j.batchSteps || []]));
}

export function handoffView(order, h, machineItemId = null, batchSteps = null) {
  const all = h.stepNames || [];
  const taken = new Set((h.rounds || []).filter(r => TAKEN.includes(r.status)).flatMap(r => r.coveredSteps));
  const stepsLeft = all.filter(s => !taken.has(s));
  const openTrip = (h.rounds || []).find(r => IN_FLIGHT.includes(r.status)) || null;
  const gate = handoffGate(order, h);
  let waiting = null;
  if (openTrip) waiting = openTrip.status === 'Ordered' ? 'Ordered' : 'With vendor';
  else if (gate) waiting = gate;
  else if (!stepsLeft.length || h.status === 'Completed') waiting = 'Done';
  const isScp = order.orderKind === 'SubChildPart';
  return {
    key: requestKey({ kind: 'handoff', productionOrder: order._id, handoffId: h._id }),
    kind: 'handoff',
    productionOrder: order._id,
    handoffId: h._id,
    orderCode: order.orderId,
    item: order.orderKind === 'Machine' ? machineItemId : order.subChildPartItem,
    itemCode: order.machineCode,
    itemName: order.machineName,
    orderKind: order.orderKind || 'Machine',
    fullyOutsourced: false,
    // A batch less pieces lost at a vendor (2026-10-26): a rework resend less
    // its own lost, a first send less every piece lost before its steps.
    qty: isScp
      ? (h.subChildPartQty != null ? Math.max(0, h.subChildPartQty - lostOnHandoff(order, h._id)) : Math.max(0, batchQtyAtStep(order, Math.min(...(h.stepIndices?.length ? h.stepIndices : [0])), batchSteps) - lostOnHandoff(order, h._id)))
      : (h.unitIndices || []).length,
    qtyUnit: isScp ? 'pcs' : 'units',
    unitNumbers: isScp ? [] : (h.unitIndices || []).map(i => i + 1),
    steps: all,
    stepIndices: h.stepIndices || [],
    stepsLeft,
    stepsReceived: all.filter(s => (h.rounds || []).some(r => r.status === 'Received' && r.coveredSteps.includes(s))),
    ready: !openTrip && !gate && stepsLeft.length > 0 && h.status !== 'Completed',
    waiting,
    openTrip: roundRef(openTrip),
    createdAt: h.requestedAt || order.createdAt,
    // Operations per piece per step (2026-10-22, "per job work" pricing):
    // the steps whose BOM gives a count — the only ones priceable that way.
    stepOperations: Object.fromEntries((h.stepNames || []).map((s, k) => {
      const procs = unitProcs(order, (h.unitIndices || [0])[0]) || order.processes || [];
      const op = procs[h.stepIndices?.[k]]?.operation;
      return [s, op?.perPiece > 0 ? { name: op.name, perPiece: op.perPiece } : null];
    }).filter(([, v]) => v)),
  };
}

// Operations per piece per step from a process definition (job-work orders
// carry no steps of their own — their Sub Child Part's definition is read).
function opsFromDefinition(def, stepNames) {
  const out = {};
  for (const s of stepNames || []) {
    for (const cat of def || []) for (const p of cat.internalProcesses || []) {
      if (normStep(p.name) === normStep(s) && p.operation?.perPiece > 0) out[s] = { name: p.operation.name, perPiece: p.operation.perPiece };
    }
  }
  return out;
}

// Every outsource request with Purchase (open ones; Done ones only when
// includeDone). Machine orders carry no item id — resolved by code, the same
// lookup getHandoffMaterialInfo uses.
export async function listRequests(companyId, { search = '', orderKind = '', includeDone = false } = {}) {
  const rx = search ? { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } : null;
  const views = [];

  if (!orderKind || orderKind === 'SubChildPart') {
    const q = { company: companyId };
    if (!includeDone) q.status = { $in: JOB_WORK_OPEN };
    if (rx) q.$or = [{ itemCode: rx }, { itemName: rx }, { orderId: rx }];
    const jobs = await SubChildPartJobWorkOrder.find(q).sort({ createdAt: -1 }).lean();
    const itemIds = [...new Set(jobs.map(j => String(j.subChildPartItem)))];
    const defs = new Map((itemIds.length ? await Item.find({ _id: { $in: itemIds } }).select('subChildPartDetails.processDefinition').lean() : [])
      .map(i => [String(i._id), i.subChildPartDetails?.processDefinition || []]));
    views.push(...jobs.map(j => ({ ...jobWorkView(j), stepOperations: opsFromDefinition(defs.get(String(j.subChildPartItem)), j.jobWorkTypes) })));
  }

  const pq = { company: companyId, 'outsourceHandoffs.0': { $exists: true } };
  if (orderKind) pq.orderKind = orderKind;
  if (rx) pq.$or = [{ machineCode: rx }, { machineName: rx }, { orderId: rx }];
  const orders = await ProductionOrder.find(pq).sort({ createdAt: -1 }).lean();
  const machineCodes = [...new Set(orders.filter(o => o.orderKind === 'Machine').map(o => o.machineCode).filter(Boolean))];
  const machineItems = machineCodes.length ? await Item.find({ companyId, code: { $in: machineCodes } }).select('_id code').lean() : [];
  const machineIdByCode = new Map(machineItems.map(i => [i.code, i._id]));
  const steps = await batchStepsByOrder(orders);
  for (const o of orders) {
    for (const h of o.outsourceHandoffs || []) {
      if (!includeDone && h.status === 'Completed') continue;
      views.push(handoffView(o, h, machineIdByCode.get(o.machineCode) || null, steps.get(o.orderId)));
    }
  }
  return views;
}

// Finished requests, newest first, PAGED IN THE DATABASE (2026-10-23 — the
// In progress tab's "Show done" used to load every finished request ever).
// Completed hand-offs (production orders) and completed job-work orders are
// unioned, sorted by when they finished, then one page of views is built.
export async function listDoneRequests(companyId, { search = '', orderKind = '', page = 1, limit = 20 } = {}) {
  const l = Math.max(1, Math.min(Number(limit) || 20, 100));
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const rx = search ? { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } : null;
  const prodMatch = { company: cid, 'outsourceHandoffs.status': 'Completed' };
  if (orderKind) prodMatch.orderKind = orderKind;
  if (rx) prodMatch.$or = [{ machineCode: rx }, { machineName: rx }, { orderId: rx }];
  const pipeline = [
    { $match: prodMatch },
    { $unwind: '$outsourceHandoffs' },
    { $match: { 'outsourceHandoffs.status': 'Completed' } },
    { $project: { kind: { $literal: 'handoff' }, docId: '$_id', handoffId: '$outsourceHandoffs._id', at: { $ifNull: ['$outsourceHandoffs.completedAt', { $ifNull: ['$outsourceHandoffs.updatedAt', '$updatedAt'] }] } } },
  ];
  if (!orderKind || orderKind === 'SubChildPart') {
    const jwMatch = { company: cid, status: 'Completed' };
    if (rx) jwMatch.$or = [{ itemCode: rx }, { itemName: rx }, { orderId: rx }];
    pipeline.push({ $unionWith: { coll: SubChildPartJobWorkOrder.collection.name, pipeline: [
      { $match: jwMatch },
      { $project: { kind: { $literal: 'jobWork' }, docId: '$_id', handoffId: null, at: { $ifNull: ['$completedAt', '$updatedAt'] } } },
    ] } });
  }
  pipeline.push({ $sort: { at: -1, docId: -1 } }, { $facet: { rows: [{ $skip: (p - 1) * l }, { $limit: l }], total: [{ $count: 'n' }] } });
  const [res] = await ProductionOrder.aggregate(pipeline);
  const rows = res?.rows || [];
  const total = res?.total?.[0]?.n || 0;

  // One page of views, in order.
  const prodIds = [...new Set(rows.filter(r => r.kind === 'handoff').map(r => String(r.docId)))];
  const jwIds = rows.filter(r => r.kind === 'jobWork').map(r => r.docId);
  const [prods, jobs] = await Promise.all([
    prodIds.length ? ProductionOrder.find({ _id: { $in: prodIds } }).lean() : [],
    jwIds.length ? SubChildPartJobWorkOrder.find({ _id: { $in: jwIds } }).lean() : [],
  ]);
  const prodById = new Map(prods.map(o => [String(o._id), o]));
  const jobById = new Map(jobs.map(o => [String(o._id), o]));
  const machineCodes = [...new Set(prods.filter(o => o.orderKind === 'Machine').map(o => o.machineCode).filter(Boolean))];
  const machineItems = machineCodes.length ? await Item.find({ companyId, code: { $in: machineCodes } }).select('_id code').lean() : [];
  const machineIdByCode = new Map(machineItems.map(i => [i.code, i._id]));
  const doneSteps = await batchStepsByOrder(prods);
  const data = [];
  for (const r of rows) {
    if (r.kind === 'jobWork') { const o = jobById.get(String(r.docId)); if (o) data.push({ ...jobWorkView(o), doneAt: r.at }); continue; }
    const o = prodById.get(String(r.docId));
    const h = o?.outsourceHandoffs?.find(x => String(x._id) === String(r.handoffId));
    if (o && h) data.push({ ...handoffView(o, h, machineIdByCode.get(o.machineCode) || null, doneSteps.get(o.orderId)), doneAt: r.at });
  }
  return { data, pagination: { page: p, limit: l, total, pages: Math.max(1, Math.ceil(total / l)) } };
}

// ── Records — load once per operation, save once (two requests of one
// production order must not be saved from two copies of the document) ────

export class RecordSet {
  constructor(companyId) {
    this.companyId = companyId;
    this.docs = new Map();
  }

  async get(ref) {
    const isJob = ref.kind === 'jobWork';
    const id = String(isJob ? ref.jobWorkOrder : ref.productionOrder);
    const k = `${ref.kind}:${id}`;
    if (!this.docs.has(k)) {
      const Model = isJob ? SubChildPartJobWorkOrder : ProductionOrder;
      const doc = await Model.findOne({ _id: id, company: this.companyId });
      if (!doc) throw new HttpError(404, `${isJob ? 'Job-work order' : 'Production order'} not found.`);
      this.docs.set(k, doc);
    }
    return this.docs.get(k);
  }

  async handoffOf(ref) {
    const doc = await this.get(ref);
    if (ref.kind === 'jobWork') return { doc, handoff: null };
    const handoff = doc.outsourceHandoffs.id(ref.handoffId);
    if (!handoff) throw new HttpError(404, `Hand-off not found on ${doc.orderId}.`);
    return { doc, handoff };
  }

  // The current view of a request, from the loaded (live) document.
  async view(ref) {
    const { doc, handoff } = await this.handoffOf(ref);
    if (ref.kind === 'jobWork') return jobWorkView(doc.toObject());
    let machineItemId = null;
    if (doc.orderKind === 'Machine') {
      machineItemId = (await Item.findOne({ companyId: this.companyId, code: doc.machineCode }).select('_id').lean())?._id || null;
    }
    const obj = doc.toObject();
    return handoffView(obj, handoff.toObject(), machineItemId, (await batchStepsByOrder([obj])).get(obj.orderId));
  }

  // Operations per piece for one step of a request (2026-10-22, "per job
  // work" pricing — R3): { name, perPiece } or null. A hand-off reads its
  // own order's step (copied from the BOM when the order was made); a
  // job-work order reads the Sub Child Part's process definition; an order
  // made before the copy existed falls back to the live BOM.
  async stepOperation(ref, stepName) {
    const want = normStep(stepName);
    const fromDef = (def) => {
      for (const cat of def || []) for (const p of cat.internalProcesses || []) {
        if (normStep(p.name) === want && p.operation?.perPiece > 0) return { name: p.operation.name, perPiece: p.operation.perPiece };
      }
      return null;
    };
    const { doc, handoff } = await this.handoffOf(ref);
    if (ref.kind === 'jobWork') {
      const item = await Item.findOne({ _id: doc.subChildPartItem, companyId: this.companyId }).select('subChildPartDetails.processDefinition').lean();
      return fromDef(item?.subChildPartDetails?.processDefinition);
    }
    const k = (handoff.stepNames || []).findIndex(s => normStep(s) === want);
    const idx = k >= 0 ? handoff.stepIndices[k] : -1;
    const procs = unitProcs(doc, (handoff.unitIndices || [0])[0]) || doc.processes;
    const own = idx >= 0 ? procs?.[idx]?.operation : null;
    if (own?.perPiece > 0) return { name: own.name, perPiece: own.perPiece };
    // Older order: the live BOM.
    if (doc.orderKind === 'SubChildPart') {
      const item = await Item.findOne({ _id: doc.subChildPartItem, companyId: this.companyId }).select('subChildPartDetails.processDefinition').lean();
      return fromDef(item?.subChildPartDetails?.processDefinition);
    }
    if (doc.orderKind === 'ChildPart') {
      const bom = await mongoose.model('ChildPartBOM').findOne({ childPart: doc.subChildPartItem, company: this.companyId }).select('processDefinition').lean();
      return fromDef(bom?.processDefinition);
    }
    const machine = await Item.findOne({ companyId: this.companyId, code: doc.machineCode }).select('_id').lean();
    const mbom = machine ? await mongoose.model('MachineBOM').findOne({ machine: machine._id, company: this.companyId }).select('processDefinition').lean() : null;
    return fromDef(mbom?.processDefinition);
  }

  async saveAll() {
    for (const doc of this.docs.values()) {
      if (doc.isModified()) await doc.save();
    }
  }
}

// ── Trips ─────────────────────────────────────────────────────────────────

// Claims a trip for an Outsource Order: an 'Ordered' round for these steps,
// so no other order can take them. Returns the new round.
export async function claimRound(records, ref, stepNames, { outsourceOrderId, lineId }) {
  const { doc, handoff } = await records.handoffOf(ref);
  const rounds = ref.kind === 'jobWork' ? doc.rounds : handoff.rounds;
  const roundNumber = rounds.reduce((m, r) => Math.max(m, r.roundNumber || 0), 0) + 1;
  rounds.push({
    roundNumber,
    ...(ref.kind === 'jobWork' ? { jobWorkTypes: stepNames } : { coveredSteps: stepNames }),
    status: 'Ordered',
    sentAt: null,
    sentBy: null,
    outsourceOrder: outsourceOrderId,
    lineId,
  });
  return rounds[rounds.length - 1];
}

// Frees a claimed trip (the order was rejected / cancelled before it went
// out). A round that already went out is never removed.
export async function releaseRound(records, ref, roundId) {
  const { doc, handoff } = await records.handoffOf(ref);
  const rounds = ref.kind === 'jobWork' ? doc.rounds : handoff.rounds;
  const round = rounds.id(roundId);
  if (!round) return false;
  if (round.status !== 'Ordered') throw new HttpError(400, 'A trip that already went out can\'t be released.');
  rounds.pull(round._id);
  return true;
}

async function roundOf(records, ref, roundId) {
  const { doc, handoff } = await records.handoffOf(ref);
  const round = (ref.kind === 'jobWork' ? doc.rounds : handoff.rounds).id(roundId);
  if (!round) throw new HttpError(404, `The trip on ${doc.orderId} no longer exists.`);
  return { doc, handoff, round };
}

// materialPlan (slice 5): the request's plan on its Outsource Order, when it
// has one — the trip then uses Production's planned part only.
// Always through a Dispatch trip (slices 6 / 8): Store / Production already
// handed the material over, so the send itself moves no stock.
export async function sendRound(records, ref, roundId, { materialPlan, user }) {
  const { doc, handoff, round } = await roundOf(records, ref, roundId);
  if (ref.kind === 'jobWork') await sendJobWorkTrip({ order: doc, user, round });
  else await sendHandoffTrip({ order: doc, handoff, materialPlan, user, round });
}

export async function receiveRound(records, ref, roundId, { body, materialPlan, user }) {
  const { doc, handoff, round } = await roundOf(records, ref, roundId);
  if (ref.kind === 'jobWork') await receiveJobWorkTrip({ order: doc, round, body, user });
  else await receiveHandoffTrip({ order: doc, handoff, round, body, materialPlan, user });
}
