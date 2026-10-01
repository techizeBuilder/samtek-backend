// QC multi-checkpoint redesign — shared helpers (slice 2, 2026-09-26). See
// server/docs/qc-multi-checkpoint-redesign-discussion-2026-09.md. Used by
// productionMfgController.js (Production's submit side) and qcController.js
// (QC's decide side) so both read "which steps are QC steps" and "which
// checklist applies to this step" the same way, in one place.
import { resolveSelectedChecklist } from '../controllers/qcChecklistController.js';
import { resolveFlatChecklistRows } from './qcChecklistPullService.js';

// Every index with a QC flag, ascending — replaces the old single-checkpoint
// qcCheckpointIndex (which returned the FIRST qcRequired step, or -1). An
// empty array here means the same thing -1 used to: a legacy order with
// nothing flagged, which still runs the old hardcoded-name pipeline
// completely untouched. Includes finalQc so a Machine step flagged ONLY
// finalQc (no qcRequired) still counts as a QC step needing a decision.
export function getQcStepIndices(order, procs) {
  return (procs || [])
    .map((p, i) => (p?.qcRequired || p?.finalQc ? i : -1))
    .filter(i => i !== -1);
}

// Broadens the old isPerUnitMachineOrder (Machine only) — now also true for
// a Machine flagged ONLY finalQc, not just qcRequired.
export function needsUnitSteps(order) {
  return order?.orderKind === 'Machine' && getQcStepIndices(order, order.processes).length > 0;
}

// Sub Child Part is always handled as one whole-quantity batch (never per-
// unit — see BatchStepEntrySchema's own comment) — this is the Sub Child
// Part twin of needsUnitSteps above, gating whether a job gets `batchSteps[]`.
export function needsBatchSteps(order) {
  return order?.orderKind === 'SubChildPart' && getQcStepIndices(order, order.processes).length > 0;
}

// Shared by steps[] (unit-based) and batchSteps[] (whole-batch) — both are
// keyed by category+stepName, appended lazily (only on first submission,
// nothing pre-listed per the design). Mutates `list` in place and returns
// the found/created entry.
export function findOrCreateStepEntry(list, category, stepName, emptyEntry) {
  let entry = list.find(s => s.category === category && s.stepName === stepName);
  if (!entry) {
    list.push({ category, stepName, ...emptyEntry });
    entry = list[list.length - 1];
  }
  return entry;
}

// This step's own configured checklist rows — Process master, keyed by
// category+stepName (slice 1 already built this exact filter shape on
// QCItemChecklist, this is just a named call site for it). `module`/`stage`
// follow slice 1's own per-level convention (subChildPart/default,
// childPart/process, productMaster/process). Returns rows already shaped
// for QCFilledRowSchema (parameter/standardValue/type/actualValue/status/
// remarks/source) — QC fills them directly, no separate conversion needed
// at the call site — `source` is always 'process' here; a Machine step's
// separate Final rows are resolved via resolveFlatChecklistRows instead and
// tagged 'final' by the caller.
export async function resolveStepProcessRows(companyId, module, stage, itemId, category, stepName) {
  const { selected } = await resolveSelectedChecklist({
    module, stage, item: itemId, childPartId: null, subChildPartId: null,
    stepCategory: category, stepName, company: companyId,
  });
  return selected.map(row => ({
    parameter: row.label,
    standardValue: row.type === 'value' ? (row.expectedValue || '') : (row.reference || 'Checkbox'),
    type: row.type === 'value' ? 'value' : 'checkbox',
    actualValue: '',
    status: 'Pending',
    remarks: '',
    source: 'process',
  }));
}

// Machine's Final checklist stays item-level (never per-step) — same
// existing resolver Stage 3b already used, unchanged. Re-exported here so
// every QC-step call site can import one module regardless of which
// checklist it needs.
export { resolveFlatChecklistRows };

// Stage C (2026-09-28) — the `finalQc` sibling of resolveStepProcessRows
// above, for a step that carries the Final flag. Item-level, never per-step
// (same module/stage flatModuleStageForItem already uses for a Machine's
// flat job.checklist — `{module:'productMaster', stage:'final'}`), so no
// stepCategory/stepName is passed — resolveSelectedChecklist already treats
// an omitted step as NOT_STEP_SCOPED. A step flagged with BOTH qcRequired
// and finalQc gets rows from both this and resolveStepProcessRows,
// concatenated into the same attempt by the caller — "one review with two
// sections" per the discussion doc's own agreed design.
export async function resolveStepFinalRows(companyId, itemId) {
  const { selected } = await resolveSelectedChecklist({
    module: 'productMaster', stage: 'final', item: itemId, childPartId: null, subChildPartId: null,
    company: companyId,
  });
  return selected.map(row => ({
    parameter: row.label,
    standardValue: row.type === 'value' ? (row.expectedValue || '') : (row.reference || 'Checkbox'),
    type: row.type === 'value' ? 'value' : 'checkbox',
    actualValue: '',
    status: 'Pending',
    remarks: '',
    source: 'final',
  }));
}

// Recomputes a per-order-kind QCJob's own top-level lifecycle status after
// every submit/decide (2026-09-26 — a small refinement of the earlier
// "Waiting/In Progress/Approved" discussion: instead of a stored status that
// can go stale, only the coarse Pending->In Progress->Approved lifecycle is
// stored; "N of M steps waiting right now" is computed live wherever it's
// displayed, e.g. getQCJobs, never stored). One-way: never reverts Approved
// back to In Progress here (a reject after the order was already marked
// Completed is a rare edge case handled explicitly by the caller, same as
// today's reopenFinalTestingForRejection un-completing an order).
export function markJobStarted(job) {
  if (job.status === 'Pending' || job.status === 'Draft') job.status = 'In Progress';
}

export function markJobApproved(job) {
  job.status = 'Approved';
}

const today = () => new Date().toISOString().split('T')[0];

// The shared "submit a batch step to QC" mechanic (slice 2's
// submitBatchQcStep, factored out in slice 3 so the outsourced-receive
// trigger — receiveOutsourceHandoffRound — can reach the exact same
// accounting instead of duplicating it). Finds/creates the batchSteps entry,
// lazily fixes qtyEnteringStep once (the previous QC step's own resolved
// passedQty, or the build quantity for the first QC step), computes the
// outstanding quantity, pushes a new attempt, flips proc.status. Quantity is
// never typed by the caller: `qtyOverride` exists only for the outsourced
// rework-resend case, where the exact quantity was already snapshotted at
// hand-off request time (see OutsourceHandoffSchema.subChildPartQty) —
// omitted, it auto-computes exactly like a normal Production submission.
export function submitBatchStepForQC(qcJob, order, procs, idx, submittedBy, { qtyOverride } = {}) {
  const proc = procs[idx];
  const entry = findOrCreateStepEntry(qcJob.batchSteps, proc.category, proc.step, {
    qtyEnteringStep: null, passedQty: 0, scrapQty: 0, reworkPendingQty: 0, attempts: [],
  });
  const isFirstSubmission = entry.attempts.length === 0;

  if (entry.qtyEnteringStep === null) {
    const qcStepIndices = getQcStepIndices(order, procs);
    const posInList = qcStepIndices.indexOf(idx);
    const buildQty = Math.max(1, Number(order.orderQuantity) || 1);
    if (posInList <= 0) {
      entry.qtyEnteringStep = buildQty;
    } else {
      const prevProc = procs[qcStepIndices[posInList - 1]];
      const prevEntry = qcJob.batchSteps.find(b => b.category === prevProc.category && b.stepName === prevProc.step);
      const prevLatestAttempt = prevEntry?.attempts[prevEntry.attempts.length - 1];
      // Two (or more) consecutive QC-flagged steps bundled into the same
      // hand-off/round are submitted to QC together, before the earlier one
      // has been decided (2026-09-26, found live — bundling two Out Source
      // QC steps into one hand-off threw "nothing outstanding" on the
      // second step, since its naive prevEntry.passedQty read 0 — nothing's
      // been sorted yet, not that nothing survived). Nothing has been
      // decided means nothing has been rejected/scrapped either, so the
      // same quantity that entered the previous (still-undecided) step is
      // exactly what's entering this one too — chain off ITS qtyEnteringStep
      // instead of its not-yet-meaningful passedQty. Once a step actually
      // has a decision, its passedQty is correct again, same as before.
      const prevUndecided = prevLatestAttempt && !prevLatestAttempt.decidedAt;
      entry.qtyEnteringStep = prevUndecided ? prevEntry.qtyEnteringStep : (prevEntry?.passedQty ?? buildQty);
    }
  }

  const autoQty = isFirstSubmission
    ? entry.qtyEnteringStep - entry.passedQty - entry.scrapQty
    : entry.reworkPendingQty;
  const qtyToSubmit = qtyOverride ?? autoQty;
  if (!(qtyToSubmit > 0)) {
    const err = new Error('Nothing outstanding to submit for this step.');
    err.status = 400;
    throw err;
  }

  entry.attempts.push({
    attemptNumber: entry.attempts.length + 1,
    qtySubmitted: qtyToSubmit,
    submittedAt: new Date(),
    submittedBy,
    rows: [],
  });

  proc.status = 'QC Pending';
  proc.endDate = today();
  proc.completedAt = new Date();

  markJobStarted(qcJob);
  return { entry, isFirstSubmission };
}

// Stage B (2026-09-26) — the per-UNIT sibling of submitBatchStepForQC, for
// Child Part orders. No quantity concept here (unlike Sub Child Part's
// whole-batch split) — a unit's own step is Pass/Reject, one unit at a time,
// each fully independent of its siblings (confirmed 2026-09-16, same
// principle the old flat unitChecks[] already followed). `unit` is one
// entry of qcJob.unitChecks (already resolved by the caller), `proc` is that
// same unit's own process step object.
export function submitUnitStepForQC(qcJob, unit, proc, submittedBy) {
  const entry = findOrCreateStepEntry(unit.steps, proc.category, proc.step, {
    finalQc: !!proc.finalQc, status: 'Awaiting Production', attempts: [],
    pendingProductionCost: null, pendingProductionExpense: null,
  });
  entry.attempts.push({
    attemptNumber: entry.attempts.length + 1,
    submittedAt: new Date(),
    submittedBy,
    rows: [],
  });
  entry.status = 'QC Pending';

  proc.status = 'QC Pending';
  proc.endDate = today();
  proc.completedAt = new Date();

  markJobStarted(qcJob);
  return entry;
}
