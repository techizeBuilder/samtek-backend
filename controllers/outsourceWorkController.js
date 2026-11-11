// Phase 2 — the generalized outsource hand-off mechanic for Child Part,
// Machine, and hybrid Sub Child Part orders (see
// server/docs/process-inhouse-outsource-redesign-discussion-2026-09.md and
// the Phase 2 plan's Stage 3). Deliberately separate from
// subChildPartJobWorkOrderController.js — a PURE Out Source Sub Child Part
// order flows through SubChildPartJobWorkOrder, visible to Purchase only;
// this controller only ever touches ProductionOrder's own outsourceHandoffs[]
// field (see ProductionOrder.js's OutsourceHandoffSchema). The Out Source
// Work list (listOutsourceWork) shows both.
//
// Material (outsource-v2 slices 5–8): every trip goes out through a Dispatch
// trip, moved by the request's material plan — Store hands its part to
// Dispatch (the real stock movement, dispatchTripService.storeHandover) and
// Production its part. The send itself (sendHandoffTrip) moves no stock.
// The Child Part / Machine "dummy" first send and Purchase's temporary send
// with its material picker are gone (slice 8).
import mongoose from 'mongoose';
import ProductionOrder from '../models/ProductionOrder.js';
import { lostBetween, lostOnHandoff } from '../utils/lostAtVendor.js';
import QCJob from '../models/QCJob.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import { Item } from '../models/Inventory.js';
import notificationService from '../services/notificationService.js';
import { resolveStepMaterialLines, commitStepMaterialConsumption, completeMachineUnit, allUnitsCompleted, ensureQCJobForOrder, qcJobSourceForOrder } from './productionMfgController.js';
import { getQcStepIndices, submitBatchStepForQC, submitUnitStepForQC, markJobApproved } from '../services/qcStepService.js';
import { buildFreshUnitProcesses } from '../services/processStepBuilderService.js';
import { HttpError, captureFinalLeftover } from '../services/subChildPartMaterialSendService.js';
import { rowDemandUnits } from '../services/outsourceEarmarkService.js';
import { getCategoryByKey } from '../utils/fabricationCategories.js';
// Serial number work step 1 (2026-10-31): a finished cascade part goes to its parent order, else stock.
import { deliverFinishedParts } from '../services/cascadeDeliveryService.js';

const today = () => new Date().toISOString().split('T')[0];

// Resolves which processes[] array a given unitIndex refers to — same
// 0-based-on-top-level-then-extraUnits convention productionMfgController.js's
// own (unexported) getUnitProcesses uses.
//
// Fixed 2026-09-24 (found live: a Child Part order whose first step is
// Outsourcing could never batch Unit 2 into a hand-off — its own tab was
// open in Process Execution, but nothing had ever persisted its extraUnits
// entry). This used to deliberately throw instead of lazily materializing,
// reasoning "Production's own execution UI is what lazily creates a later
// unit's pipeline on first touch" — true for an In-House step (Production's
// first real action is assignTeam/startProcess, both of which DO lazily
// materialize via productionMfgController.js's own getUnitProcesses), but
// never true for an Outsourcing step: Production's UI shows no
// assignTeam/startProcess action for one at all, so that "first touch"
// never happens. Now lazily materializes here too, same
// buildFreshUnitProcesses helper productionMfgController.js's own
// getUnitProcesses uses, same one-way street either fix takes. On a real
// (non-lean) order document this persists once the caller's own
// order.save() runs (every write path in this file already ends with one);
// on the .lean() object getEligibleUnitsForRun reads, it's a same-request-
// only simulation — never written, exactly the read-only behavior a GET
// should have.
function resolveUnitProcesses(order, unitIndex) {
  if (!unitIndex) return order.processes;
  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  if (unitIndex >= buildQty) throw new HttpError(400, `Unit ${unitIndex + 1} is beyond this order's quantity (${buildQty}).`);
  while (order.extraUnits.length < unitIndex) {
    order.extraUnits.push({ processes: buildFreshUnitProcesses(order.processes) });
  }
  return order.extraUnits[unitIndex - 1].processes;
}

function validateContiguousOutSourceRun(procs, stepIndices) {
  if (!Array.isArray(stepIndices) || !stepIndices.length) {
    throw new HttpError(400, 'Select at least one step to send for outsourcing.');
  }
  const sorted = [...stepIndices].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) throw new HttpError(400, 'Selected steps must be consecutive.');
  }
  for (const idx of sorted) {
    if (idx < 0 || idx >= procs.length) throw new HttpError(400, `Invalid step index ${idx} for this order.`);
    if (procs[idx].type !== 'Outsourcing') throw new HttpError(400, `"${procs[idx].step}" isn't an Out Source step.`);
    if (procs[idx].outsourceStatus !== 'NotStarted') throw new HttpError(400, `"${procs[idx].step}" is already part of another hand-off.`);
  }
  // Must be the next actionable run — the step right before this run (if
  // any) has to already be Completed, otherwise this would let Production
  // request a hand-off out of sequence.
  const first = sorted[0];
  if (first > 0 && procs[first - 1].status !== 'Completed') {
    throw new HttpError(400, `Complete "${procs[first - 1].step}" before sending "${procs[first].step}" for outsourcing.`);
  }
  return sorted;
}

// Multi-unit outsource hand-off batching (2026-09-25 — see the discussion
// doc's own section). Given a reference unit + stepIndices run, finds every
// OTHER unit of this order currently eligible to be bundled into the same
// hand-off — the data behind the "who else is on this step" picker
// Production sees when sending. Batching is keyed on step INDEX (the
// confirmed design), but a candidate unit's step at each index must also
// carry the SAME step NAME as the reference unit's — index alone isn't
// quite enough on its own: a unit that diverged via rework could have a
// different step sitting at the same numeric position, and silently
// batching that in would mislabel what's actually being sent. Every unit
// from 0..buildQty-1 is considered (2026-09-24 — resolveUnitProcesses now
// lazily materializes instead of throwing, so a not-yet-touched unit is
// virtually simulated as fresh/eligible here rather than skipped — see
// that function's own comment; nothing persists from this read-only path).
function getEligibleUnitsForRun(order, referenceUnitIndex, stepIndices) {
  const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
  const refProcs = resolveUnitProcesses(order, referenceUnitIndex);
  const refStepNames = stepIndices.map(idx => refProcs?.[idx]?.step);
  const eligible = [];
  for (let i = 0; i < buildQty; i++) {
    let procs;
    try {
      procs = resolveUnitProcesses(order, i);
    } catch (_) {
      continue; // not yet materialized — not offered
    }
    if (stepIndices.some((idx, k) => procs[idx]?.step !== refStepNames[k])) continue; // diverged — not really "the same step"
    try {
      validateContiguousOutSourceRun(procs, stepIndices);
      eligible.push(i);
    } catch (_) {
      // not eligible for this exact run right now — skip
    }
  }
  return eligible;
}

// ── Automatic requests (client change, 2026-10-22) ────────────────────────
// docs/outsource-v2/auto-outsource-requests-2026-10.md. Production no longer
// clicks "Send for Outsourcing" when there's nothing for it to do:
//   - an order whose FIRST step is Out Source (all three levels) — requested
//     when the order is created, all units in one request;
//   - units back from a vendor, waiting at Store, whose NEXT step is Out
//     Source again (a fully outsourced Child Part / Machine, or two outsource
//     runs in a row) — requested once their QC passes.
// Each request covers the whole run of consecutive Out Source steps; Purchase
// still picks how many go on each Outsource Order. In-house → Out Source is
// unchanged: Production sends it (it has the work in hand).

// The next run of consecutive, not-yet-requested Out Source steps on one
// unit's processes, starting at its first unfinished step — or null.
export function nextOutsourceRun(procs) {
  if (!procs?.length) return null;
  const start = procs.findIndex(p => p.status !== 'Completed');
  if (start < 0) return null;
  const run = [];
  for (let i = start; i < procs.length; i++) {
    if (procs[i].type !== 'Outsourcing' || procs[i].outsourceStatus !== 'NotStarted') break;
    run.push(i);
  }
  return run.length ? run : null;
}

// Requests the next Out Source run for the given units — units on the same
// run (same step indices and names) share one request. Mutates the order;
// the caller saves it, then calls notifyAutoRequests. Returns what it made.
export function autoRequestOutsourceRuns(order, unitIndices) {
  const units = order.orderKind === 'SubChildPart' ? [0] : [...new Set(unitIndices.map(Number))];
  const groups = new Map();
  for (const u of units) {
    const procs = resolveUnitProcesses(order, u);
    const run = nextOutsourceRun(procs);
    if (!run) continue;
    const names = run.map(i => procs[i].step);
    const k = `${run.join(',')}|${names.join('›')}`;
    if (!groups.has(k)) groups.set(k, { run, names, units: [] });
    groups.get(k).units.push(u);
  }
  const made = [];
  for (const g of groups.values()) {
    order.outsourceHandoffs.push({
      unitIndices: g.units, stepIndices: g.run, stepNames: g.names,
      isFirstStepOfOrder: g.run[0] === 0, subChildPartQty: null,
      status: 'Requested', requestedAt: new Date(), requestedBy: null, autoRequested: true,
    });
    for (const u of g.units) {
      const procs = resolveUnitProcesses(order, u);
      for (const idx of g.run) procs[idx].outsourceStatus = 'Requested';
    }
    made.push({ stepNames: g.names, units: g.units });
  }
  return made;
}

export async function notifyAutoRequests(order, made) {
  for (const m of made) {
    try {
      await notificationService.triggerAccountsNotification({
        action: 'outsource_handoff_requested',
        data: { orderCode: order.orderId, orderId: order._id, machineName: order.machineName, stepNames: m.stepNames },
        targetCompanyId: order.company,
      });
    } catch (e) { console.error('[OutsourceWork] auto-request notification error:', e); }
  }
}

// At order creation: if the first step is Out Source, request it for every
// unit (Sub Child Part: the batch). Saves the order when something was made.
export async function autoRequestFirstOutsourceRun(order) {
  if (order.processes?.[0]?.type !== 'Outsourcing') return [];
  const qty = order.orderKind === 'SubChildPart' ? 1 : Math.max(1, Number(order.orderQuantity) || 1);
  const made = autoRequestOutsourceRuns(order, Array.from({ length: qty }, (_, i) => i));
  if (made.length) {
    await order.save();
    await notifyAutoRequests(order, made);
  }
  return made;
}

// GET /api/outsource-work/orders/:id/eligible-units?stepIndices=0,1 —
// Production action, queried before sending a hand-off to populate the
// multi-unit picker. Returns every unit index currently eligible for the
// given step run (see getEligibleUnitsForRun above) — the caller decides
// whether to show a picker at all (a single eligible unit needs no popup).
// GET /orders/:id/rework?stepIndex=N — is this Sub Child Part step a QC
// rework resend, and for how many pieces (2026-10-27)? Production's Send
// dialog shows the quantity and offers only this step.
export const getReworkInfo = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const idx = Number(req.query.stepIndex);
    const proc = order.processes[idx];
    if (order.orderKind !== 'SubChildPart' || !proc || !getQcStepIndices(order, order.processes).includes(idx)) return res.json({ success: true, data: { rework: false } });
    const qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: order.company }).lean();
    const entry = qcJob?.batchSteps?.find(b => b.category === proc.category && b.stepName === proc.step);
    const rework = !!entry && entry.attempts.length > 0 && entry.reworkPendingQty > 0;
    res.json({ success: true, data: { rework, qty: rework ? entry.reworkPendingQty : null, passedQty: entry?.passedQty ?? null } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getEligibleUnits = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const stepIndices = String(req.query.stepIndices || '').split(',').map(Number).filter(n => Number.isInteger(n));
    if (!stepIndices.length) return res.status(400).json({ success: false, message: 'stepIndices is required.' });
    const referenceUnitIndex = Number(req.query.unitIndex) || 0;
    const eligibleUnitIndices = getEligibleUnitsForRun(order, referenceUnitIndex, stepIndices);
    res.json({ success: true, data: { eligibleUnitIndices } });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/outsource-work/orders/:id/handoffs — Production action. Picks
// which of the upcoming consecutive Out Source steps to bundle into one
// hand-off to Purchase (see processStepBuilderService.js's
// groupConsecutiveOutSourceRuns for how a whole run is computed — this
// endpoint lets Production send less than the full run if they choose to),
// AND (2026-09-25) which unit(s) currently sitting at that exact step run
// to bundle together — see getEligibleUnitsForRun above for how the
// frontend's picker knows who else is eligible. A hand-off's unit set is
// fixed once created; sending the rest of the units later is a new hand-off.
// This is the ONLY way Child Part/Machine ever reach Purchase — even on
// their own first step, Production must click this explicitly (confirmed
// 2026-09-22: unlike Sub Child Part, there is no auto-bypass at these two
// levels). For a Hybrid Sub Child Part order whose first step is Out
// Source, this hand-off is instead seeded automatically at order creation
// (see subChildPartOrderService.js) — this endpoint is never the one that
// creates that particular hand-off.
export const requestOutsourceHandoff = async (req, res) => {
  try {
    const { unitIndices, stepIndices } = req.body;
    const units = Array.isArray(unitIndices) ? [...new Set(unitIndices.map(Number))] : [];
    if (!units.length) return res.status(400).json({ success: false, message: 'Select at least one unit to send for outsourcing.' });

    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    // A Sub Child Part goes out as ONE batch (its whole quantity) — never per
    // unit; only Child Part / Machine orders are unit-wise (2026-10-22).
    if (order.orderKind === 'SubChildPart' && units.some(u => u !== 0)) {
      return res.status(400).json({ success: false, message: 'A Sub Child Part is sent as one batch (its whole quantity), not unit by unit.' });
    }

    // Every included unit must independently pass the same contiguous-run
    // check against the SAME stepIndices — same-step-INDEX batching, per
    // the confirmed design — AND actually carry the same step NAME at each
    // of those indices (guards against silently batching a diverged unit
    // whose step happens to sit at the same numeric position but isn't
    // really "the same step" — see getEligibleUnitsForRun's own comment).
    // Any one unit's failure fails the whole request.
    let sorted = null;
    let stepNames = null;
    for (const unitIndex of units) {
      const procs = resolveUnitProcesses(order, unitIndex);
      const unitSorted = validateContiguousOutSourceRun(procs, stepIndices);
      const unitStepNames = unitSorted.map(i => procs[i].step);
      if (!sorted) {
        sorted = unitSorted;
        stepNames = unitStepNames;
      } else if (unitStepNames.some((name, k) => name !== stepNames[k])) {
        throw new HttpError(400, `Unit ${unitIndex + 1}'s step at this position doesn't match the others in this batch.`);
      }
    }

    // "First step of order" is a step-position property, not a which-unit
    // property — true whenever this run starts at index 0, regardless of
    // which unit(s) are the ones reaching it.
    const isFirstStepOfOrder = sorted[0] === 0;

    // QC multi-checkpoint redesign, slice 3 (2026-09-26) — Sub Child Part
    // only. If this run covers a QC-flagged step, snapshot how much this
    // hand-off actually needs to move: null (whole order) for a first-ever
    // send, or the exact reworkPendingQty QC decided on for a resend after
    // Rework — never typed by Production, same "computed, not typed"
    // convention submitBatchStepForQC already uses. No "nothing outstanding"
    // guard needed here: validateContiguousOutSourceRun above already
    // refuses re-requesting a step whose outsourceStatus isn't 'NotStarted',
    // and the only way it's back to 'NotStarted' with a real batchSteps
    // entry already on record is submitBatchQcDecision's own Rework reset —
    // which only ever fires with reworkPendingQty>0 by construction (the
    // Passed/Rework/Scrap split always sums to the whole outstanding
    // quantity, so "resolved" and "reworkPendingQty===0" happen together).
    let subChildPartQty = null;
    if (order.orderKind === 'SubChildPart') {
      const qcStepIndices = getQcStepIndices(order, order.processes);
      const qcStepIdx = sorted.find(idx => qcStepIndices.includes(idx));
      if (qcStepIdx !== undefined) {
        const proc = order.processes[qcStepIdx];
        const qcJob = await QCJob.findOne({ source: qcJobSourceForOrder(order), sourceRefId: order.orderId, company: order.company });
        const entry = qcJob?.batchSteps?.find(b => b.category === proc.category && b.stepName === proc.step);
        if (entry && entry.attempts.length > 0) {
          subChildPartQty = entry.reworkPendingQty;
          // A rework resend carries only the rework pieces — a later step on
          // it would go out for those alone and leave the passed pieces stuck
          // (it'd be marked sent). Later steps go out afterwards with the
          // whole batch (2026-10-27, found in browser testing).
          const later = sorted.filter(idx => idx > qcStepIdx);
          if (later.length) {
            return res.status(400).json({ success: false, message: `This is a rework of "${proc.step}" (${entry.reworkPendingQty} pcs) — send only "${proc.step}". "${later.map(i => order.processes[i].step).join('", "')}" goes out later with the whole batch.` });
          }
        }
      }
    }

    order.outsourceHandoffs.push({
      unitIndices: units,
      stepIndices: sorted,
      stepNames,
      isFirstStepOfOrder,
      subChildPartQty,
      status: 'Requested',
      requestedAt: new Date(),
      requestedBy: req.user._id,
    });
    for (const unitIndex of units) {
      const procs = resolveUnitProcesses(order, unitIndex);
      for (const idx of sorted) procs[idx].outsourceStatus = 'Requested';
    }

    await order.save();
    await order.populate('processes.assignedTeam', 'name supervisor members');

    try {
      await notificationService.triggerAccountsNotification({
        action: 'outsource_handoff_requested',
        data: { orderCode: order.orderId, orderId: order._id, machineName: order.machineName, stepNames },
        targetCompanyId: order.company,
      });
    } catch (e) { console.error('[OutsourceWork] notification error:', e); }

    res.json({ success: true, data: order });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── One trip out and back (outsource-v2 slice 2, 2026-10-20) ──────────────
// A round is one trip: Ordered (claimed by an Outsource Order) → Sent →
// Received. These two core functions do the work; the Outsource Order
// (outsourceOrderController.js, through outsourceRequestService.js) calls
// them. Neither saves the order — the caller does.

const GONE_OUT = ['Sent', 'Received'];

// The hand-off's step positions this round covers (stepNames is aligned with
// stepIndices — requestOutsourceHandoff builds both from the same run).
// Partial returns, 3c (2026-10-26 — docs/outsource-v2/partial-returns-2026-10.md):
// only some of a Child Part / Machine hand-off's units came back. The rest
// becomes a hand-off of its own — same steps, a copy of every trip so far (its
// current one still Sent, on the same Outsource Order line) — so the units
// that came are received now and the rest are collected later. Returns the
// new hand-off and old → new round ids. The caller saves the order.
export function splitHandoffByUnits(order, handoff, keepUnitIdxs) {
  const keep = handoff.unitIndices.filter(i => keepUnitIdxs.includes(i));
  const rest = handoff.unitIndices.filter(i => !keepUnitIdxs.includes(i));
  if (!keep.length || !rest.length) throw new HttpError(400, 'Pick the units that came back — some, not all.');
  const src = handoff.toObject();
  const roundIdMap = new Map();
  const rounds = (src.rounds || []).map(r => {
    const id = new mongoose.Types.ObjectId();
    roundIdMap.set(String(r._id), id);
    return { ...r, _id: id };
  });
  order.outsourceHandoffs.push({ ...src, _id: new mongoose.Types.ObjectId(), unitIndices: rest, rounds });
  handoff.unitIndices = keep;
  return { handoff: order.outsourceHandoffs[order.outsourceHandoffs.length - 1], roundIdMap };
}

export function roundStepIndices(handoff, round) {
  return (handoff.stepIndices || []).filter((idx, k) => (round.coveredSteps || []).includes(handoff.stepNames[k]));
}

// Dispatch delivered a trip (slice 6). `round` is the Ordered round an
// Outsource Order claimed; it becomes Sent. No stock moves here: Store and
// Production already handed the material to Dispatch through the request's
// material plan (slice 5). With a plan, Production's planned part of each
// material line counts as used now (it left Production's floor); the Store
// part never touches Production's figures, and receive records no material
// use again (receiveHandoffTrip).
export async function sendHandoffTrip({ order, handoff, materialPlan = null, user, round }) {
  if (!round) throw new HttpError(400, 'Trips go out through an Outsource Order and Dispatch.');
  if (handoff.status === 'Completed') throw new HttpError(400, 'This hand-off is already completed.');
  if (round && round.status !== 'Ordered') throw new HttpError(400, 'This trip has already been sent.');
  const requested = [...round.coveredSteps];
  if (!requested.length) throw new HttpError(400, 'This trip covers no step.');
  const onOtherTrips = new Set(handoff.rounds.filter(r => r !== round && GONE_OUT.includes(r.status)).flatMap(r => r.coveredSteps));
  const invalid = requested.filter(s => !handoff.stepNames.includes(s) || onOtherTrips.has(s));
  if (invalid.length) {
    throw new HttpError(400, `These steps can't be sent: ${invalid.join(', ')} (not on this hand-off, or already sent).`);
  }

  const firstSend = handoff.isFirstStepOfOrder && !handoff.rounds.some(r => r !== round && GONE_OUT.includes(r.status));
  if (firstSend) {
    handoff.rawMaterial = handoff.rawMaterial || {};
    handoff.rawMaterial.dummy = false;
    if (!handoff.rawMaterial.sentAt) {
      handoff.rawMaterial.sentAt = new Date();
      handoff.rawMaterial.sentBy = user._id;
    }
  }

  round.status = 'Sent';
  round.sentAt = new Date();
  round.sentBy = user._id;
  if (Array.isArray(materialPlan) && order.orderKind !== 'SubChildPart') {
    const byKey = new Map((order.materialDemands || []).map(d => [d.materialCode, d]));
    for (const row of materialPlan) {
      const used = rowDemandUnits(row).production;
      const d = byKey.get(row.demandKey);
      if (d && used > 0) d.consumedQuantity = Math.round(((d.consumedQuantity || 0) + used) * 10000) / 10000;
    }
  }
  if (handoff.status === 'Requested') handoff.status = 'InProgress';
  // Stamp every unit this hand-off covers, not just one (2026-09-25 —
  // multi-unit batching; a round has no per-unit state).
  for (const unitIndex of handoff.unitIndices) {
    const procsForSend = resolveUnitProcesses(order, unitIndex);
    for (const idx of handoff.stepIndices) {
      if (requested.includes(procsForSend[idx].step)) procsForSend[idx].outsourceStatus = 'Sent';
    }
  }
}

// Purchase receives a trip back. Since outsource-v2 slice 2 (2026-10-20)
// only THIS round's own steps are processed (roundStepIndices), on every unit
// of this hand-off — before, nothing happened until every step of the
// hand-off was back, so a step received in round 1 never completed or
// reached QC. The hand-off is Completed once every step is received.
//
// Every QC-flagged step submits straight to the order's QC job (batchSteps
// for Sub Child Part, unitChecks[].steps for Child Part/Machine) the moment
// it's received — no self-check phase. A non-QC step completes straight
// through; if it's the true last step, it credits stock/Sale directly
// (Item.qty for Sub Child Part/Child Part, completeMachineUnit for Machine).
// A Child Part / Machine order whose BOM has no QC step at all is refused
// before anything changes.
export async function receiveHandoffTrip({ order, handoff, round, body = {}, materialPlan = null, user }) {
  // A planned trip's material was settled when it went out (sendHandoffTrip).
  const planned = Array.isArray(materialPlan);
  if (round.status !== 'Sent') throw new HttpError(400, round.status === 'Received' ? 'This round has already been received.' : 'This trip hasn\'t been sent yet.');
  const isUnitKind = order.orderKind === 'ChildPart' || order.orderKind === 'Machine';
  if (isUnitKind && getQcStepIndices(order, order.processes).length === 0) {
    throw new HttpError(400, `${order.machineName || order.orderId} has no QC step configured on its BOM — ask R&D to flag at least one step before outsourcing work for it.`);
  }
  if (order.orderKind !== 'SubChildPart' && !isUnitKind) {
    throw new HttpError(400, `${order.machineName || order.orderId} has no QC step configured on its BOM — ask R&D to flag at least one step before outsourcing work for it.`);
  }
  const actor = user.fullName || user.username;

  // A Sub Child Part's "whole sheet / piece" real first send: the measured
  // leftover comes back with the first trip home (outsource-v2, 2026-10-20).
  // Validated before anything below changes.
  if (order.orderKind === 'SubChildPart') {
    const needsLeftover = handoff.rawMaterial?.sentCase === 'whole' && !handoff.rawMaterial.leftoverCaptured && !handoff.rawMaterial.dummy;
    if (needsLeftover) {
      const item = await Item.findOne({ _id: order.subChildPartItem, companyId: order.company });
      const sourceItem = item ? await Item.findOne({ _id: item.subChildPartDetails?.sourceItem, companyId: order.company }) : null;
      if (!item || !sourceItem) throw new HttpError(404, 'Sub Child Part or its source material Item no longer exists.');
      await captureFinalLeftover({ company: order.company, rawMaterial: handoff.rawMaterial }, sourceItem, body);
    }
  }

  round.status = 'Received';
  round.receivedAt = new Date();
  round.receivedBy = user._id;
  const stepIdxs = roundStepIndices(handoff, round);

  if (order.orderKind === 'SubChildPart') {
    // A Sub Child Part hand-off's unitIndices is always [0] (one whole
    // batch), so this works directly on order.processes. A QC-flagged step
    // submits to the batchSteps mechanic (submitBatchStepForQC) — two QC
    // steps in one round still chain their quantity there.
    const procs = order.processes;
    const qcStepIndices = getQcStepIndices(order, procs);
    let qcJob = null;
    for (const idx of stepIdxs) {
      const proc = procs[idx];
      proc.outsourceStatus = 'Received';
      if (!planned) {
        const materialLines = await resolveStepMaterialLines(order, proc, order.company);
        if (materialLines.length) commitStepMaterialConsumption(order, materialLines);
      }

      if (qcStepIndices.includes(idx)) {
        if (!qcJob) qcJob = await ensureQCJobForOrder(order, actor, user._id);
        // Quantity is never typed — the whole batch on a first send, or the
        // rework quantity snapshotted at request time on a resend.
        // A rework resend: its quantity, less any pieces lost at the vendor on
        // this trip (partial returns, 2026-10-26 — taken off as scrap already).
        submitBatchStepForQC(qcJob, order, procs, idx, actor || 'Purchase (Outsourced)', { qtyOverride: handoff.subChildPartQty != null ? Math.max(0, handoff.subChildPartQty - lostOnHandoff(order, handoff._id)) : undefined });
      } else {
        proc.status = 'Completed';
        proc.endDate = today();
        proc.completedAt = new Date();
        // True last step with no QC flag: whoever finishes it runs the
        // finishing logic (whatever survived the last QC step).
        if (idx === procs.length - 1 && order.subChildPartItem) {
          let survivedQty = Math.max(1, Number(order.orderQuantity) || 1);
          let lastQcIdx = -1;
          if (qcStepIndices.length) {
            lastQcIdx = Math.max(...qcStepIndices);
            const lastQcStep = procs[lastQcIdx];
            if (!qcJob) qcJob = await ensureQCJobForOrder(order, actor, user._id);
            const batchEntry = qcJob.batchSteps.find(b => b.category === lastQcStep.category && b.stepName === lastQcStep.step);
            survivedQty = batchEntry?.passedQty ?? survivedQty;
          }
          // Pieces lost at a vendor after the last QC step aren't here (2026-10-26).
          survivedQty = Math.max(0, survivedQty - lostBetween(order, lastQcIdx, procs.length - 1));
          await deliverFinishedParts({ order, itemId: order.subChildPartItem, qty: survivedQty, by: actor || '' });
          order.status = 'Completed';
        }
      }
    }
    if (qcJob) await qcJob.save();
  } else {
    // Child Part / Machine — per unit. Every QC-flagged step goes to its own
    // per-unit QC entry (submitUnitStepForQC). A non-QC true last step
    // credits stock/Sale for that unit. No cost here (vendor cost comes with
    // slice 4).
    let qcJob = null;
    for (const unitIndex of handoff.unitIndices) {
      const procs = resolveUnitProcesses(order, unitIndex);
      const qcStepIndices = getQcStepIndices(order, procs);
      for (const idx of stepIdxs) {
        const proc = procs[idx];
        proc.outsourceStatus = 'Received';
        if (!planned) {
          const materialLines = await resolveStepMaterialLines(order, proc, order.company);
          if (materialLines.length) commitStepMaterialConsumption(order, materialLines);
        }

        if (qcStepIndices.includes(idx)) {
          if (!qcJob) qcJob = await ensureQCJobForOrder(order, actor, user._id);
          const unit = qcJob.unitChecks.find(u => u.unitNumber === unitIndex + 1);
          submitUnitStepForQC(qcJob, unit, proc, actor || 'Purchase (Outsourced)');
        } else {
          proc.status = 'Completed';
          proc.endDate = today();
          proc.completedAt = new Date();
          if (idx === procs.length - 1) {
            if (order.subChildPartItem) {
              await deliverFinishedParts({ order, itemId: order.subChildPartItem, qty: 1, by: actor || '' });
              if (allUnitsCompleted(order)) {
                order.status = 'Completed';
                if (!qcJob) qcJob = await ensureQCJobForOrder(order, actor, user._id);
                markJobApproved(qcJob);
              }
            } else if (order.orderKind === 'Machine') {
              if (!qcJob) qcJob = await ensureQCJobForOrder(order, actor, user._id);
              await completeMachineUnit(order, qcJob, unitIndex + 1, { actorName: actor, userId: user._id });
            }
          }
        }
      }
    }
    if (qcJob) await qcJob.save();
  }

  const covered = new Set(handoff.rounds.filter(r => r.status === 'Received').flatMap(r => r.coveredSteps));
  if (handoff.stepNames.every(s => covered.has(s))) {
    handoff.status = 'Completed';
    handoff.completedAt = new Date();
  }
}

// POST /api/outsource-work/orders/:id/handoffs/:handoffId/rounds — the old
// direct "Send Round". Closed (outsource-v2 slice 2, user decision Q1): every
// trip now goes through an Outsource Order (a vendor, a price, approval).
export const sendOutsourceHandoffRound = async (req, res) => {
  res.status(400).json({ success: false, message: 'Make an Outsource Order for this request — trips are sent from the order.' });
};

// PUT /api/outsource-work/orders/:id/handoffs/:handoffId/rounds/:roundId/receive
// — receive one trip. Still open for a round sent before slice 2 (no order);
// a round on an Outsource Order is collected by Dispatch and received by Store.
export const receiveOutsourceHandoffRound = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const handoff = order.outsourceHandoffs.id(req.params.handoffId);
    if (!handoff) return res.status(404).json({ success: false, message: 'Hand-off not found' });
    const round = handoff.rounds.id(req.params.roundId);
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });
    if (round.outsourceOrder) return res.status(400).json({ success: false, message: 'This trip is on an Outsource Order — Dispatch collects it and Store receives it (Material Transfers → From Outsource).' });
    await receiveHandoffTrip({ order, handoff, round, body: req.body, user: req.user });
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Unified list (Stage 4) — merges SubChildPartJobWorkOrder (pure
// Out Source Sub Child Part, untouched) with ProductionOrder's own
// outsourceHandoffs[] (Child Part/Machine/hybrid Sub Child Part), one row
// per job-work order OR per hand-off, normalized onto a shared status
// vocabulary so Purchase's page (client/src/pages/accounts/SubChildJobWork.jsx)
// can filter/paginate across both with one control set. Two different
// collections merged in application code, not one DB query — pagination is
// applied after the merge/sort, same trade-off already accepted for this
// company-scale data (not a high-volume table).
const HANDOFF_STATUS_MAP = { AwaitingRequest: 'Pending', Requested: 'Pending', InProgress: 'In Progress', Completed: 'Completed' };

function normalizeJobWorkOrderRow(o) {
  const covered = new Set((o.rounds || []).filter(r => r.status === 'Received').flatMap(r => r.jobWorkTypes));
  return {
    id: `scpjw-${o._id}`,
    sourceType: 'JobWorkOrder',
    orderKind: 'SubChildPart',
    orderRecordId: o._id,
    orderCode: o.orderId,
    code: o.itemCode,
    name: o.itemName,
    orderQuantity: o.orderQuantity,
    // Same field name as normalizeHandoffRow's own unitCount below, so the
    // frontend list can read one field for the Qty column regardless of row
    // kind (2026-09-25). Sub Child Part has no per-hand-off unit subset —
    // the whole order quantity is the meaningful number here, unchanged.
    unitCount: o.orderQuantity,
    stepNames: o.jobWorkTypes || [],
    coveredSteps: [...covered],
    rounds: o.rounds || [],
    status: o.status,
    qcRejectedQty: o.qc?.rejectedQty || 0,
    createdAt: o.createdAt,
    // Full original document — lets the frontend reuse the existing Send/
    // Receive Round dialog logic (which reads rawMaterial/qc/etc.) against
    // this row without a second round-trip; this list endpoint is the only
    // thing that changed for Sub Child Part rows, not that dialog.
    raw: o,
  };
}

function normalizeHandoffRow(order, handoff) {
  const covered = new Set((handoff.rounds || []).filter(r => r.status === 'Received').flatMap(r => r.coveredSteps));
  return {
    id: `handoff-${order._id}-${handoff._id}`,
    sourceType: 'Handoff',
    orderKind: order.orderKind,
    orderRecordId: order._id,
    handoffId: handoff._id,
    orderCode: order.orderId,
    code: order.machineCode,
    name: order.machineName,
    orderQuantity: order.orderQuantity,
    // How many units THIS hand-off covers (2026-09-25 — multi-unit
    // batching), not the whole order's build quantity — orderQuantity above
    // stays for context, but the Qty column reads this instead, since a
    // hand-off no longer necessarily covers every unit of the order.
    //
    // Sub Child Part excluded (2026-09-24 fix, found live): confirmed with
    // the user — Sub Child Part is always ONE physical batch (e.g. a sheet
    // cut into orderQuantity blades in one continuous run), never
    // independently-progressing units the way Child Part/Machine are, even
    // though a Hybrid Sub Child Part order structurally reuses the same
    // ProductionOrder/outsourceHandoffs machinery (so `unitIndices` exists
    // on its hand-offs too, always `[0]` in practice — there's no real
    // second unit to batch). Showing unitIndices.length there was
    // technically accurate but meaningless — always `orderQuantity` instead,
    // matching pre-batching display and normalizeJobWorkOrderRow's own
    // unitCount below for the same order kind — UNLESS this hand-off is a
    // slice-3 rework resend, which covers only part of the order
    // (`subChildPartQty`, see OutsourceHandoffSchema); showing the whole
    // order's quantity there would be actively misleading to Purchase.
    unitCount: order.orderKind === 'SubChildPart'
      ? (handoff.subChildPartQty ?? order.orderQuantity)
      : (handoff.unitIndices || []).length,
    stepNames: handoff.stepNames || [],
    coveredSteps: [...covered],
    rounds: handoff.rounds || [],
    status: HANDOFF_STATUS_MAP[handoff.status] || 'Pending',
    isFirstStepOfOrder: handoff.isFirstStepOfOrder,
    // outsource-v2 (2026-10-20) — the receive that completes this hand-off
    // asks for the measured leftover (receiveOutsourceHandoffRound's Sub
    // Child Part branch).
    leftoverRequired: order.orderKind === 'SubChildPart' && handoff.rawMaterial?.sentCase === 'whole'
      && !handoff.rawMaterial?.leftoverCaptured && !handoff.rawMaterial?.dummy,
    qcRejectedQty: 0,
    createdAt: handoff.requestedAt || order.createdAt,
    raw: { handoff },
  };
}

function computeOutsourceWorkSummary(rows) {
  return {
    total: rows.length,
    pending: rows.filter(r => r.status === 'Pending').length,
    inProgress: rows.filter(r => r.status === 'In Progress').length,
    pendingQC: rows.filter(r => r.status === 'Pending QC').length,
    completed: rows.filter(r => r.status === 'Completed').length,
    qcRejected: rows.filter(r => r.qcRejectedQty > 0).length,
  };
}

// GET /api/outsource-work — search/status/orderKind filters, opt-in
// pagination (page/limit), same convention getSubChildParts
// (subChildPartMasterController.js, Phase 1) already uses.
export const listOutsourceWork = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { search, status, orderKind, page, limit } = req.query;

    const includeSubChildPart = !orderKind || orderKind === 'all' || orderKind === 'SubChildPart';
    const scpQuery = { company: companyId };
    if (search) {
      scpQuery.$or = [
        { itemCode: { $regex: search, $options: 'i' } },
        { itemName: { $regex: search, $options: 'i' } },
        { orderId: { $regex: search, $options: 'i' } },
      ];
    }
    const scpOrders = includeSubChildPart ? await SubChildPartJobWorkOrder.find(scpQuery).sort({ createdAt: -1 }).lean() : [];

    const includeHandoffs = !orderKind || orderKind === 'all' || ['ChildPart', 'Machine', 'SubChildPart'].includes(orderKind);
    const poQuery = { company: companyId, 'outsourceHandoffs.0': { $exists: true } };
    if (orderKind && orderKind !== 'all') poQuery.orderKind = orderKind;
    if (search) {
      poQuery.$or = [
        { machineCode: { $regex: search, $options: 'i' } },
        { machineName: { $regex: search, $options: 'i' } },
        { orderId: { $regex: search, $options: 'i' } },
      ];
    }
    const poOrders = includeHandoffs ? await ProductionOrder.find(poQuery).sort({ createdAt: -1 }).lean() : [];

    let rows = [
      ...scpOrders.map(normalizeJobWorkOrderRow),
      ...poOrders.flatMap(o => (o.outsourceHandoffs || []).map(h => normalizeHandoffRow(o, h))),
    ];

    // A leftover still to be measured: is it sheet metal (needs a width
    // too)? Read from the size that was sent (captureFinalLeftover's rule).
    const leftoverRows = rows.filter(r => r.leftoverRequired && r.raw.handoff.rawMaterial?.sourceItem);
    if (leftoverRows.length) {
      const sources = await Item.find({ _id: { $in: leftoverRows.map(r => r.raw.handoff.rawMaterial.sourceItem) } }).select('dimensionVariants').lean();
      const byId = new Map(sources.map(s => [String(s._id), s]));
      for (const r of leftoverRows) {
        const rm = r.raw.handoff.rawMaterial;
        const variant = (byId.get(String(rm.sourceItem))?.dimensionVariants || []).find(v => String(v._id) === String(rm.sentDimensionVariantId));
        r.leftoverIsSheet = getCategoryByKey(variant?.category)?.calcType === 'sheet';
      }
    }
    const summary = computeOutsourceWorkSummary(rows);

    if (status && status !== 'all' && status !== 'QC Rejected') rows = rows.filter(r => r.status === status);
    if (status === 'QC Rejected') rows = rows.filter(r => r.qcRejectedQty > 0);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const isPaginated = !!(page || limit);
    if (!isPaginated) return res.json({ success: true, data: rows, summary });

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20)); // at most 100 a page (2026-10-19)
    const total = rows.length;
    const paged = rows.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    res.json({
      success: true, data: paged, summary,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
