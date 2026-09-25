// Phase 2 — the generalized outsource hand-off mechanic for Child Part,
// Machine, and hybrid Sub Child Part orders (see
// server/docs/process-inhouse-outsource-redesign-discussion-2026-09.md and
// the Phase 2 plan's Stage 3). Deliberately separate from
// subChildPartJobWorkOrderController.js, which stays untouched — a PURE
// Out Source Sub Child Part order still flows through SubChildPartJobWorkOrder
// exactly as before; this controller only ever touches ProductionOrder's own
// new outsourceHandoffs[] field (see ProductionOrder.js's OutsourceHandoffSchema).
//
// Scope note (honest, not a placeholder — updated 2026-09-23, see the
// discussion doc's "First-step outsource material send — testing bridge"
// section): a hand-off covering the literal FIRST step of the whole order
// needs a real Store pull once the actual Logistics/vendor handshake exists
// — that real build is still deferred. Until then, getHandoffMaterialInfo/
// sendOutsourceHandoffRound run a TESTING BRIDGE for this one case: the same
// proven material determination SubChildPartJobWorkOrder's own send flow
// already has (reused as-is for Sub Child Part) or a straightforward
// per-`materialRefs`-line lookup (Child Part/Machine) is shown to Purchase,
// selecting it is entirely optional, and — regardless of whether a
// selection is made — real Store inventory (Item.qty/dimensionVariants[].
// subStock) is NEVER touched by this path (see rawMaterial.dummy on
// OutsourceHandoffSchema). Every OTHER hand-off (any step after the first,
// any level) still needs no Store write at all, dummy or otherwise — see
// this file's own comment on sendOutsourceHandoffRound for why.
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import { Item } from '../models/Inventory.js';
import notificationService from '../services/notificationService.js';
import { qcCheckpointIndex, resolveStepMaterialLines, commitStepMaterialConsumption, completeMachineUnit, allUnitsCompleted } from './productionMfgController.js';
import { buildFreshUnitProcesses } from '../services/processStepBuilderService.js';
import { computeSubChildPartRawMaterialAvailabilityLive } from '../services/subChildPartOrderService.js';
import { resolveCatalogVariant, wholeSheetTargets } from './subChildPartJobWorkOrderController.js';
import { dimensionSignature } from '../services/fabricationDemandService.js';

const today = () => new Date().toISOString().split('T')[0];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

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

// GET /api/outsource-work/orders/:id/eligible-units?stepIndices=0,1 —
// Production action, queried before sending a hand-off to populate the
// multi-unit picker. Returns every unit index currently eligible for the
// given step run (see getEligibleUnitsForRun above) — the caller decides
// whether to show a picker at all (a single eligible unit needs no popup).
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

    order.outsourceHandoffs.push({
      unitIndices: units,
      stepIndices: sorted,
      stepNames,
      isFirstStepOfOrder,
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

// GET /api/outsource-work/orders/:id/handoffs/:handoffId/material-info —
// Testing bridge (2026-09-23). Read-only: shows Purchase what material a
// FIRST-STEP hand-off nominally needs, before they optionally choose
// something and send. Only ever meaningful before the first round (material
// only ever moves once, on round 1) — returns kind:'none' otherwise so the
// frontend knows there's nothing to show.
export const getHandoffMaterialInfo = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId }).lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const handoff = (order.outsourceHandoffs || []).find(h => String(h._id) === req.params.handoffId);
    if (!handoff) return res.status(404).json({ success: false, message: 'Hand-off not found' });
    if (!handoff.isFirstStepOfOrder || (handoff.rounds || []).length > 0) {
      return res.json({ success: true, data: { kind: 'none' } });
    }

    if (order.orderKind === 'SubChildPart') {
      const item = await Item.findById(order.subChildPartItem);
      const sourceItem = item ? await Item.findById(item.subChildPartDetails?.sourceItem) : null;
      if (!item || !sourceItem) return res.status(404).json({ success: false, message: 'Sub Child Part or its source material Item no longer exists.' });
      const availability = await computeSubChildPartRawMaterialAvailabilityLive(item, sourceItem, order);

      if (!sourceItem.fabricationRef) {
        return res.json({ success: true, data: { kind: 'plain', availability, sourceItem: { _id: sourceItem._id, code: sourceItem.code, name: sourceItem.name, qty: sourceItem.qty, unit: sourceItem.unit } } });
      }

      const catalogVariant = resolveCatalogVariant(item, sourceItem);
      const leftovers = (sourceItem.dimensionVariants || []).filter(v => v.isLeftover);

      if (availability.kind === 'sheet') {
        const { plan, targets } = await wholeSheetTargets(item, catalogVariant);
        const targetSigs = new Set(targets.map(t => dimensionSignature(t)));
        const leftoverOptions = leftovers.map(v => {
          const area = (Number(v.values?.width) || 0) * (Number(v.values?.length) || 0);
          return { _id: v._id, values: v.values, subStock: v.subStock, matchesWholeSheet: targetSigs.has(dimensionSignature(v.values)), cutCapacityAreaMm2: area };
        });
        return res.json({ success: true, data: {
          kind: 'sheet', availability, sheetPlan: plan,
          catalogVariant: catalogVariant && { _id: catalogVariant._id, values: catalogVariant.values, subStock: catalogVariant.subStock },
          leftoverOptions,
        } });
      }

      const leftoverOptions = leftovers.map(v => ({
        _id: v._id, values: v.values, subStock: v.subStock,
        matchesRemainder: availability.remainderMm > 0 && Number(v.values?.length) === availability.remainderMm,
      }));
      return res.json({ success: true, data: {
        kind: 'length', availability,
        catalogVariant: catalogVariant && { _id: catalogVariant._id, values: catalogVariant.values, subStock: catalogVariant.subStock },
        leftoverOptions,
      } });
    }

    // Child Part / Machine — a straightforward per-referenced-line lookup,
    // informational only (no cut/whole/catalog/leftover picker — the
    // sheet-metal/length-fabrication resolution that would need lives in
    // bomMaterialGroupsService.js/SheetMetalPlan and is a bigger lift than
    // this testing bridge calls for, since selecting anything here is
    // optional and nothing gets applied to real stock either way).
    // Any one unit in the hand-off's own unitIndices works to read
    // materialRefs from — every included unit shares the same stepIndices
    // run by construction (same-step-INDEX batching, requestOutsourceHandoff's
    // own validation), so their materialRefs at that step are identical.
    const repUnitIndex = (handoff.unitIndices || [0])[0];
    const procs = repUnitIndex ? order.extraUnits?.[repUnitIndex - 1]?.processes : order.processes;
    const proc = procs?.[handoff.stepIndices[0]];
    const materialRefs = (proc?.materialRefs || []).map(String);
    if (!materialRefs.length) return res.json({ success: true, data: { kind: 'multi', lines: [] } });

    let bom = null;
    if (order.orderKind === 'ChildPart') {
      bom = await ChildPartBOM.findOne({ childPart: order.subChildPartItem, company: order.company }).lean();
    } else {
      const mfgItem = await Item.findOne({ $or: [{ code: order.machineCode }, { name: order.machineName }], companyId: order.company }).lean();
      if (mfgItem) bom = await MachineBOM.findOne({ machine: mfgItem._id, company: order.company }).lean();
    }
    const lines = (bom?.materials || []).filter(m => materialRefs.includes(String(m._id)));
    const codes = lines.map(m => m.code).filter(Boolean);
    const stockItems = codes.length ? await Item.find({ code: { $in: codes }, companyId: order.company }).lean() : [];
    const itemByCode = new Map(stockItems.map(i => [i.code, i]));
    // Scaled by how many units THIS hand-off actually covers, not the whole
    // order's build quantity (2026-09-25 fix — the same order-qty-vs-
    // handoff-scope bug the Purchase list's Qty column had, here too: a
    // hand-off sent for 2 of an order's 5 units needs 2x material, not 5x).
    const buildQty = Math.max(1, (handoff.unitIndices || []).length || Number(order.orderQuantity) || 1);
    const infoLines = lines.map(m => {
      const stockItem = itemByCode.get(m.code);
      const perUnitQty = Number(m.quantity) || 0;
      return {
        itemCode: m.code, itemName: m.item, unit: m.unit,
        perUnitQty, neededQty: perUnitQty * buildQty,
        availableQty: stockItem ? (stockItem.qty || 0) : null,
      };
    });
    res.json({ success: true, data: { kind: 'multi', lines: infoLines } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/outsource-work/orders/:id/handoffs/:handoffId/rounds —
// Purchase's "Send Round", generalized from SubChildPartJobWorkOrder's own.
//
// Material resolution splits into two genuinely different cases (confirmed
// 2026-09-22, testing bridge added 2026-09-23):
// 1. handoff.isFirstStepOfOrder — real fresh-from-Store pull, once the real
//    Logistics/vendor handshake exists (still deferred). Until then this is
//    a TESTING BRIDGE: req.body.materialSelection is entirely optional (see
//    getHandoffMaterialInfo above for what Purchase can see beforehand) —
//    whatever's chosen, if anything, is only ever recorded on
//    handoff.rawMaterial for reference (rawMaterial.dummy: true), never
//    applied against real Item.qty/dimensionVariants[].subStock.
// 2. Every other hand-off — no Store write at all, dummy or otherwise. The
//    physical material is either the literal AssembledPart (whatever
//    Production built — nothing to move) or an ExplicitMaterials pick
//    Production must have already issued to itself through the existing,
//    unchanged Material List "Issue" mechanism. This is a pure
//    status-transition action.
export const sendOutsourceHandoffRound = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const handoff = order.outsourceHandoffs.id(req.params.handoffId);
    if (!handoff) return res.status(404).json({ success: false, message: 'Hand-off not found' });
    if (handoff.status === 'Completed') return res.status(400).json({ success: false, message: 'This hand-off is already completed.' });

    const requested = Array.isArray(req.body.coveredSteps) ? req.body.coveredSteps.filter(Boolean) : [];
    if (!requested.length) return res.status(400).json({ success: false, message: 'Select at least one step to send.' });
    const alreadyCovered = new Set(handoff.rounds.filter(r => r.status === 'Received').flatMap(r => r.coveredSteps));
    const invalid = requested.filter(s => !handoff.stepNames.includes(s) || alreadyCovered.has(s));
    if (invalid.length) {
      return res.status(400).json({ success: false, message: `These steps can't be sent: ${invalid.join(', ')} (not on this hand-off, or already received).` });
    }

    if (handoff.rounds.length === 0 && handoff.isFirstStepOfOrder) {
      // Testing bridge — see this function's own header comment and the
      // discussion doc. Recording a selection is entirely optional and
      // purely informational; nothing here ever touches real Store stock.
      const selection = req.body.materialSelection;
      handoff.rawMaterial = handoff.rawMaterial || {};
      handoff.rawMaterial.dummy = true;
      handoff.rawMaterial.sentAt = new Date();
      handoff.rawMaterial.sentBy = req.user._id;
      if (selection && typeof selection === 'object') {
        if (selection.materialCase) handoff.rawMaterial.sentCase = selection.materialCase;
        if (selection.dimensionVariantId) handoff.rawMaterial.sentDimensionVariantId = String(selection.dimensionVariantId);
        if (selection.leftoverVariantId) handoff.rawMaterial.sentLeftoverUsedVariantId = String(selection.leftoverVariantId);
        if (selection.notes) handoff.rawMaterial.leftoverValues = { notes: selection.notes };
      }
    }

    handoff.rounds.push({
      roundNumber: handoff.rounds.length + 1,
      coveredSteps: requested,
      status: 'Sent',
      sentAt: new Date(),
      sentBy: req.user._id,
    });
    if (handoff.status === 'Requested') handoff.status = 'InProgress';
    // Stamp every unit this hand-off covers, not just one (2026-09-25 —
    // multi-unit batching; OutsourceHandoffRoundSchema itself stays
    // per-hand-off, not per-unit, per the confirmed atomic-once-created design).
    for (const unitIndex of handoff.unitIndices) {
      const procsForSend = resolveUnitProcesses(order, unitIndex);
      for (const idx of handoff.stepIndices) {
        if (requested.includes(procsForSend[idx].step)) procsForSend[idx].outsourceStatus = 'Sent';
      }
    }
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/outsource-work/orders/:id/handoffs/:handoffId/rounds/:roundId/receive
// — Purchase's "Receive Round". Once every step on this hand-off has been
// received, the hand-off completes and each covered step is marked done.
// A NON-checkpoint step goes straight to 'Completed' (no review needed —
// only the ONE real checkpoint, qcCheckpointIndex, ever needs QC). The
// checkpoint step itself is handled differently (2026-09-24 design change,
// see the discussion doc's own section — supersedes this function's
// original Stage 3/3b behavior, which sent an Out Source checkpoint
// straight to QC with no Production self-check at all): Production DOES
// self-check + submit an outsourced checkpoint now, same as an in-house
// one, just gated on the hand-off actually being back — so this only flips
// the checkpoint to 'In Progress' (unlocking QcCheckpointPanel, per
// ProcessExecution.jsx's own `proc.status !== 'Pending'` mount gate) and
// leaves QCJob creation to submitQcCheckpoint, exactly like it already
// works for an in-house checkpoint. No QCJob touched here at all anymore.
export const receiveOutsourceHandoffRound = async (req, res) => {
  try {
    const order = await ProductionOrder.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const handoff = order.outsourceHandoffs.id(req.params.handoffId);
    if (!handoff) return res.status(404).json({ success: false, message: 'Hand-off not found' });
    const round = handoff.rounds.id(req.params.roundId);
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });
    if (round.status !== 'Sent') return res.status(400).json({ success: false, message: 'This round has already been received.' });

    round.status = 'Received';
    round.receivedAt = new Date();
    round.receivedBy = req.user._id;

    const covered = new Set(handoff.rounds.filter(r => r.status === 'Received').flatMap(r => r.coveredSteps));
    const nowComplete = handoff.stepNames.every(s => covered.has(s));
    // Units whose TRUE LAST step this receive just completed, with their QC
    // checkpoint earlier in the sequence (already approved — the only way
    // the steps after it ever unlock). Those units are done right here, the
    // outsourced twin of completeFinalProcessStep (2026-09-24, found while
    // planning the per-unit Machine QC redesign: nothing ever marked such a
    // unit done — no Sale/stock credit, order never Completed). No
    // Production cost here: the vendor's own cost is the separate, still
    // deferred Purchase-side capture.
    const unitsFinishedHere = [];
    if (nowComplete) {
      handoff.status = 'Completed';
      handoff.completedAt = new Date();
      // Advance every unit this hand-off covers (2026-09-25 — multi-unit
      // batching), each against its OWN qcCheckpointIndex — position-based,
      // but resolved per unit since it reads that unit's own procs array
      // (always the same index in practice, since batching requires every
      // included unit to share the same stepIndices run, but computed
      // properly rather than assumed).
      for (const unitIndex of handoff.unitIndices) {
        const procs = resolveUnitProcesses(order, unitIndex);
        const cpIdx = qcCheckpointIndex(order, procs);
        for (const idx of handoff.stepIndices) {
          const proc = procs[idx];
          proc.outsourceStatus = 'Received';
          // Bookkeeping, not a gate (2026-09-24, found live: an Out Source
          // step's own materialRefs never had their consumption committed
          // anywhere — commitStepMaterialConsumption only ever fired from
          // startProcess, which an Outsourcing step never goes through at
          // all, so "on floor" for whatever it references stayed frozen
          // forever). Same mirror-shape fix as startProcess's own commit:
          // resolve this step's lines against this unit, commit unconditionally.
          const materialLines = await resolveStepMaterialLines(order, proc, req.user.companyId);
          if (materialLines.length) commitStepMaterialConsumption(order, materialLines);
          if (idx === cpIdx) {
            proc.status = 'In Progress';
            if (!proc.startDate) { proc.startDate = today(); proc.startedAt = new Date(); }
          } else {
            proc.status = 'Completed';
            proc.endDate = today();
            proc.completedAt = new Date();
            if (cpIdx !== -1 && idx === procs.length - 1) unitsFinishedHere.push(unitIndex + 1);
          }
        }
      }
    }

    if (order.orderKind === 'Machine') {
      // completeMachineUnit saves the order itself (per unit, in turn).
      for (const unitNumber of unitsFinishedHere) {
        await completeMachineUnit(order, null, unitNumber, { actorName: req.user.fullName || req.user.username, userId: req.user._id });
      }
    } else if (order.orderKind === 'ChildPart' && unitsFinishedHere.length) {
      // Same stock credit completeFinalProcessStep's Child Part branch gives
      // an in-house last step, one per finished unit.
      if (order.subChildPartItem) {
        await Item.updateOne({ _id: order.subChildPartItem, companyId: order.company }, { $inc: { qty: unitsFinishedHere.length } });
      }
      if (allUnitsCompleted(order)) order.status = 'Completed';
    }

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
    // technically accurate but meaningless — always `orderQuantity`
    // instead, matching pre-batching display and normalizeJobWorkOrderRow's
    // own unitCount below for the same order kind.
    unitCount: order.orderKind === 'SubChildPart' ? order.orderQuantity : (handoff.unitIndices || []).length,
    stepNames: handoff.stepNames || [],
    coveredSteps: [...covered],
    rounds: handoff.rounds || [],
    status: HANDOFF_STATUS_MAP[handoff.status] || 'Pending',
    isFirstStepOfOrder: handoff.isFirstStepOfOrder,
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
    const summary = computeOutsourceWorkSummary(rows);

    if (status && status !== 'all' && status !== 'QC Rejected') rows = rows.filter(r => r.status === status);
    if (status === 'QC Rejected') rows = rows.filter(r => r.qcRejectedQty > 0);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const isPaginated = !!(page || limit);
    if (!isPaginated) return res.json({ success: true, data: rows, summary });

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
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
