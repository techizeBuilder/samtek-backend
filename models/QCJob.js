import mongoose from 'mongoose';

const ChecklistItemSchema = new mongoose.Schema({
  parameter: { type: String, required: true },
  standardValue: { type: String, default: '' },
  // Carried through from the master checklist's own row.type (see
  // qcChecklistPullService.js's toChecklistItems) — drives whether the fill-
  // in UI shows a real value box ('value') or just Pass/Fail ('checkbox').
  type: { type: String, enum: ['checkbox', 'value'], default: 'checkbox' },
  // Whoever fills this row first records their own result here — Production
  // self-checking (Sub Child Part initial/process, or Final Testing) for a
  // manufactured job, or QC directly for every other job type.
  actualValue: { type: String, default: '' },
  status: { type: String, enum: ['Pending', 'Pass', 'Fail'], default: 'Pending' },
  remarks: { type: String, default: '' },
  // QC's OWN separate verdict on this same row, once Production has filled
  // it in first — never overwrites actualValue/status/remarks above, which
  // stay Production's own record (confirmed 2026-09-02: "show the result
  // from production in display only and let the qc pass or fail them
  // again"). Unused (stays default) for every job type where there's no
  // Production self-check layer — there, status/actualValue/remarks above
  // ARE QC's own record, exactly as before this change.
  qcStatus: { type: String, enum: ['Pending', 'Pass', 'Fail'], default: 'Pending' },
  qcRemarks: { type: String, default: '' },
}, { _id: true });

// One entry per Sub Child Part of an in-house/outsource-manufactured
// product's BOM (see qc-module-restructure-client-request.md's 2026-09-01
// follow-on) — lets ONE QCJob per machine hold the full nested history of
// every part's inspection, instead of a separate job per part (client's
// explicit call: easier to review "how was this machine checked and by
// whom" from one record). `initial`/`process` are the SAME rows Production
// itself ticks first (their own pre-flight/build log — see
// productionMfgController.js's savePartChecklist) as their own record; QC
// reviews/edits those same rows and renders the actual verdict in `status`.
// Never touches QCItemChecklist (R&D's reusable per-part selection) —
// that's read-only context for which rows to show; the actual tick/value
// results for THIS production run live only here.
const PartQCEntrySchema = new mongoose.Schema({
  childPartId: { type: mongoose.Schema.Types.ObjectId, required: true },
  subChildPartId: { type: mongoose.Schema.Types.ObjectId, required: true },
  childPartName: { type: String, default: '' },
  subChildPartName: { type: String, default: '' },
  // Same "material present -> allot team -> start" chain as Job Work
  // (confirmed 2026-09-01), narrowed to just this part's own BOM material
  // lines — see productionMfgController.js's getPartUnissuedMaterials.
  // assignedTeam can only be set once every one of those is 'Issued'; the
  // Initial/Process checklists below can't be saved until startedAt is set.
  assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionTeam', default: null },
  startedAt: { type: Date, default: null },
  initial: { type: [ChecklistItemSchema], default: [] },
  process: { type: [ChecklistItemSchema], default: [] },
  // 'Awaiting Production': Production hasn't finished the part yet (nothing
  // for QC to act on). 'QC Pending': Production saved its Process checklist
  // (with Initial already saved) — this IS the automatic "sent to QC"
  // moment, no separate manual send action (confirmed 2026-09-01).
  // 'Approved'/'Rejected': QC's verdict — a Reject automatically reverts to
  // 'Awaiting Production' (also confirmed automatic, not a manual send-back).
  status: { type: String, enum: ['Awaiting Production', 'QC Pending', 'Approved', 'Rejected'], default: 'Awaiting Production' },
  producedBy: { type: String, default: '' },
  producedAt: { type: Date, default: null },
  qcBy: { type: String, default: '' },
  qcDate: { type: String, default: null },
  rejectReason: { type: String, default: '' },
}, { timestamps: true });

// QC multi-checkpoint redesign (2026-09-26, slice 2 — see
// server/docs/qc-multi-checkpoint-redesign-discussion-2026-09.md). Production
// no longer self-checks: it only submits a step, and QC fills the checklist
// and decides. One layer, not two — the old ChecklistItemSchema's
// actualValue/status-vs-qcStatus/qcRemarks split existed only because
// Production filled first and QC verified second; that's gone, so this
// collapses back to one fill, by QC. `source` distinguishes a Machine step's
// Process rows from its Final rows on the one step that carries both flags
// (finalQc + qcRequired) — everywhere else it's always 'process'.
const QCFilledRowSchema = new mongoose.Schema({
  parameter: { type: String, required: true },
  standardValue: { type: String, default: '' },
  type: { type: String, enum: ['checkbox', 'value'], default: 'checkbox' },
  actualValue: { type: String, default: '' },
  status: { type: String, enum: ['Pending', 'Pass', 'Fail'], default: 'Pending' },
  remarks: { type: String, default: '' },
  source: { type: String, enum: ['process', 'final'], default: 'process' },
}, { _id: false });

// One submit-then-decide cycle on a single QC-flagged step, for a Child
// Part/Machine unit. A reject doesn't overwrite the previous attempt — it
// stays in `steps[].attempts[]` as history, and Production's resubmission
// pushes a NEW attempt (confirmed with the user: "how qc will work on
// resubmitted" — every attempt kept, full re-check each time).
const StepAttemptSchema = new mongoose.Schema({
  attemptNumber: { type: Number, required: true },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: String, default: '' },
  rows: { type: [QCFilledRowSchema], default: [] },
  decidedAt: { type: Date, default: null },
  decidedBy: { type: String, default: '' },
  decision: { type: String, enum: ['', 'Pass', 'Reject'], default: '' },
  rejectReason: { type: String, default: '' },
}, { _id: true, timestamps: true });

// One QC-flagged BOM step's own history, for one unit. A unit can now have
// SEVERAL of these (replacing the old single-checkpoint-per-order rule) —
// identified by category+stepName, since that's the same key BOM Management/
// QC Parameters already use (QCItemChecklist.stepCategory/stepName, slice 1).
const StepEntrySchema = new mongoose.Schema({
  category: { type: String, required: true },
  stepName: { type: String, required: true },
  // Machine only — this step also carries the machine's mandatory Final
  // checklist (see QCFilledRowSchema's own `source` tag) on top of its
  // Process one, if it's also qcRequired.
  finalQc: { type: Boolean, default: false },
  // Mirrors the latest attempt's own state — same convention the old
  // per-unit `status` used, just one per step instead of one per unit.
  // 'Awaiting Production': nothing submitted yet, or rejected and not yet
  // resubmitted. 'QC Pending': submitted, QC hasn't decided the latest
  // attempt. 'Approved'/'Rejected': the latest attempt's own decision.
  status: { type: String, enum: ['Awaiting Production', 'QC Pending', 'Approved', 'Rejected'], default: 'Awaiting Production' },
  attempts: { type: [StepAttemptSchema], default: [] },
  // Set only when this step is the true last step of the flattened
  // sequence — Production reports cost/expense once, on submission, and the
  // QC decision applies it only once Approved (same "Production uploads it,
  // QC's approval triggers the credit" split every order kind already uses).
  pendingProductionCost: { type: Number, default: null },
  pendingProductionExpense: { type: Number, default: null },
}, { _id: true, timestamps: true });

// One entry per UNIT of a Child Part order (source:'ChildPartProduction') or
// a per-unit Machine order — direct sibling of PartQCEntrySchema above, same
// nested-under-one-job shape, just keyed by unitNumber instead of
// childPartId/subChildPartId. Confirmed with the user (2026-09-16) as the
// deliberate pattern to mirror: ONE QCJob per order, but each unit reaches/
// leaves QC entirely independently of its siblings. No assignedTeam/
// startedAt of its own — Child Part/Machine already track those at the real
// processes[]/extraUnits[] step level, so this only needs to own the
// checklists + the QC verdicts.
//
// `steps[]` (2026-09-26, slice 2) is the NEW home for what used to sit
// directly on the unit (`initial`/`process`/`status`/`producedBy`/`qcBy`/
// `pendingProductionCost`) — a unit can now have several independent QC
// steps, so all of that moves down into StepEntrySchema, one per step.
// Nothing pre-listed: an entry is appended to `steps[]` only the first time
// that step is actually submitted, per the design ("a step appears in the
// QC job only when it is submitted").
//
// The old flat fields below stay on the schema, UNUSED by `steps[]`-based
// orders, only because slice 2 is built and tested one order kind at a time
// (Sub Child Part first, per the discussion doc) — Child Part and Machine's
// CURRENT single-checkpoint code (getQcCheckpoint/submitQcCheckpoint/
// decideChildPartUnit, untouched until that same slice's Child Part/Machine
// stages) still reads/writes these directly. Remove them once every order
// kind is migrated onto `steps[]` (slice 2's own cleanup, not slice 4 — that
// one's for the OLDER single-checkpoint design, a separate thing).
const UnitQCEntrySchema = new mongoose.Schema({
  unitNumber: { type: Number, required: true },
  steps: { type: [StepEntrySchema], default: [] },
  initial: { type: [ChecklistItemSchema], default: [] },
  process: { type: [ChecklistItemSchema], default: [] },
  status: { type: String, enum: ['Awaiting Production', 'QC Pending', 'Approved', 'Rejected'], default: 'Awaiting Production' },
  producedBy: { type: String, default: '' },
  producedAt: { type: Date, default: null },
  qcBy: { type: String, default: '' },
  qcDate: { type: String, default: null },
  rejectReason: { type: String, default: '' },
  pendingProductionCost: { type: Number, default: null },
  pendingProductionExpense: { type: Number, default: null },
  // Per-unit Machine (and, from slice 2, Child Part) — set once this unit is
  // fully done: every QC step Approved AND its true last step finished,
  // whichever came last (productionMfgController.js's completeMachineUnit /
  // the Child Part equivalent). That is the moment it counts toward the
  // Sale item's approvedQty (or stock, for a no-Sale order) — also what
  // makes the trigger idempotent, and what the Packaging Queue counts as
  // "N of M units ready" (packagingDispatchController.js reads only this
  // field on unitChecks[], untouched by the steps[] reshape above).
  readyAt: { type: Date, default: null },
}, { timestamps: true });

// One submit-then-decide cycle on a Sub Child Part's whole-batch QC step.
// Unlike the unit-based StepAttemptSchema, a decision here is a QUANTITY
// split, not a plain Pass/Reject — QC splits whatever was submitted into
// Passed/Rework/Scrap (must sum to qtySubmitted), with a reason required
// once Rework or Scrap is non-zero.
const BatchStepAttemptSchema = new mongoose.Schema({
  attemptNumber: { type: Number, required: true },
  qtySubmitted: { type: Number, required: true },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: String, default: '' },
  rows: { type: [QCFilledRowSchema], default: [] },
  decidedAt: { type: Date, default: null },
  decidedBy: { type: String, default: '' },
  passedQty: { type: Number, default: null },
  reworkQty: { type: Number, default: null },
  scrapQty: { type: Number, default: null },
  reason: { type: String, default: '' },
}, { _id: true, timestamps: true });

// One QC-flagged BOM step's own history, for a Sub Child Part order's whole
// build quantity (Sub Child Part is always handled as one physical batch,
// never per-unit — confirmed with the user: "sub child part is deal with in
// whole qty"). `qtyEnteringStep` is fixed once, the first time this step is
// reached — order.orderQuantity for the very first QC step, or the previous
// QC step's own resolved `passedQty` for any step after it (whatever
// survived every earlier step's scrap). A step is fully resolved once
// `passedQty + scrapQty === qtyEnteringStep && reworkPendingQty === 0` — the
// next step (or, on the true last step, stock/Sale crediting) reads that off
// the real processes[] step's own `status`, exactly the same "previous step
// Completed" gate every other step already uses (see submitBatchQcDecision).
const BatchStepEntrySchema = new mongoose.Schema({
  category: { type: String, required: true },
  stepName: { type: String, required: true },
  qtyEnteringStep: { type: Number, default: null },
  passedQty: { type: Number, default: 0 },
  scrapQty: { type: Number, default: 0 },
  // Currently out for rework, not yet resubmitted — 0 means this step has
  // nothing outstanding (either never had a reject, or the rework already
  // came back and was itself decided).
  reworkPendingQty: { type: Number, default: 0 },
  attempts: { type: [BatchStepAttemptSchema], default: [] },
  pendingProductionCost: { type: Number, default: null },
  pendingProductionExpense: { type: Number, default: null },
}, { _id: true, timestamps: true });

const QCJobSchema = new mongoose.Schema({
  qcJobId: { type: String, unique: true },

  // Source info
  source: {
    type: String,
    enum: ['Purchase', 'Production', 'Store', 'QC_Rejected', 'Stock', 'SubChildPartJobWork', 'SubChildPartProduction', 'ChildPartProduction'],
    required: true,
  },
  sourceRefId: { type: String, default: '' },   // orderId / PO number / stock ref
  sourceDepartment: { type: String, default: '' },
  sentBy: { type: String, default: '' },

  // Item info
  itemName: { type: String, required: true, trim: true },
  itemCode: { type: String, default: '', trim: true },
  category: {
    type: String,
    required: true,
  },
  quantity: { type: Number, default: 1 },
  unit: { type: String, default: 'pcs' },
  receivedDate: { type: String, required: true },

  // Inspection
  inspector: { type: String, default: '' },
  inspectionStartDate: { type: String, default: null },
  inspectionEndDate: { type: String, default: null },
  // The single overall checklist — for every job EXCEPT an in-house/outsource
  // manufactured product's Production-source job, this is the whole
  // inspection (Inventory QC / Motor Master QC / Product Master QC's Final
  // stage). For an in-house one, this same field/decision IS the Final
  // Check (the whole assembled product) — see submitDecision's partChecks
  // gate below; no separate "finalCheck" object needed, this only continues
  // once every partChecks[] entry is Approved.
  checklist: [ChecklistItemSchema],
  // Empty for every job except a Production-source one for an in-house/
  // outsource-manufactured product — see PartQCEntrySchema's own comment.
  partChecks: { type: [PartQCEntrySchema], default: [] },
  // Empty for every job except source:'ChildPartProduction' and a dynamic-
  // Process-Definition Machine order's job — see UnitQCEntrySchema's own
  // comment.
  unitChecks: { type: [UnitQCEntrySchema], default: [] },
  // Empty for every job except source:'SubChildPartProduction' with at
  // least one QC-flagged step (slice 2) — see BatchStepEntrySchema's own
  // comment. Sibling of unitChecks, same lazy-append convention, just
  // whole-batch instead of per-unit.
  batchSteps: { type: [BatchStepEntrySchema], default: [] },
  // Set once Production fills in `checklist` above themselves, on the Final
  // Testing process step (see productionMfgController.js's
  // saveFinalChecklist) — their own pre-flight record, same rows QC then
  // reviews/edits before the real decision (confirmed 2026-09-02: wire the
  // Final Check to R&D's Final checklist in Production first, QC second).
  // Empty for every job whose checklist Production never touches.
  finalCheckFilledBy: { type: String, default: '' },
  finalCheckFilledAt: { type: Date, default: null },
  // Captured ONCE, on the very first Final Testing submission (redesigned
  // 2026-09-19 — Production reports the real build cost as part of
  // submitting the checklist, not through a separate self-certify step).
  // `finalCheckFilledAt` being already set is what tells saveFinalChecklist
  // a later submission is a QC-reject resubmit, not a first submit — on a
  // resubmit these two stay exactly as first captured, never re-asked for.
  finalCheckProductionCost: { type: Number, default: null },
  finalCheckProductionExpense: { type: Number, default: null },

  // Decision
  status: {
    type: String,
    enum: ['Draft', 'Pending', 'In Progress', 'Approved', 'Rejected'],
    default: 'Pending',
  },
  decision: { type: String, enum: ['', 'Pass', 'Fail'], default: '' },
  failReason: { type: String, default: '' },
  inspectorRemarks: { type: String, default: '' },

  // Attachments
  attachments: [{ url: String, type: { type: String, enum: ['Image', 'Video', 'Document'] }, label: String }],

  // Back-reference to the Purchase Request that originated this QC job (Purchase source only)
  purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },
  // Back-reference to the Sale that originated this QC job (Store source only)
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  // Which specific Sale item (Sale.items._id) this QC job is for — multi-item
  // orders create one QC job per item, and the decision updates only that
  // item's storeQCStatus. Null on legacy/whole-order jobs.
  saleItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Back-reference to the SubChildPartJobWorkOrder that originated this QC
  // job (source:'SubChildPartJobWork' only) — same pattern as
  // purchaseRequestId/saleId above, used to credit stock back onto the
  // right Sub Child Part Item and close out the order on approval/rejection.
  subChildPartJobWorkOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubChildPartJobWorkOrder', default: null },
  // The customer-facing sales Order.orderCode this job traces back to
  // (e.g. "ORD-0043") — lets QC screens group jobs of the same order.
  orderCode: { type: String, default: '', trim: true },

  // Post-decision
  transferredToStore: { type: Boolean, default: false },
  returnedToSource: { type: Boolean, default: false },

  // Audit trail of partial rejections. When a job's quantity is >1 and QC
  // rejects only part of it, we log each rejected slice here and reduce
  // `quantity` by that amount rather than closing the job — the remaining
  // quantity stays in QC pending an Approve/Fail decision of its own.
  partialRejections: [{
    qty: { type: Number, required: true },
    reason: { type: String, default: '' },
    rejectedAt: { type: Date, default: Date.now },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],

  notes: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

QCJobSchema.index({ company: 1, status: 1 });
QCJobSchema.index({ company: 1, source: 1 });

export default mongoose.model('QCJob', QCJobSchema);
