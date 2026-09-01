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

const QCJobSchema = new mongoose.Schema({
  qcJobId: { type: String, unique: true },

  // Source info
  source: {
    type: String,
    enum: ['Purchase', 'Production', 'Store', 'QC_Rejected', 'Stock'],
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
  // Set once Production fills in `checklist` above themselves, on the Final
  // Testing process step (see productionMfgController.js's
  // saveFinalChecklist) — their own pre-flight record, same rows QC then
  // reviews/edits before the real decision (confirmed 2026-09-02: wire the
  // Final Check to R&D's Final checklist in Production first, QC second).
  // Empty for every job whose checklist Production never touches.
  finalCheckFilledBy: { type: String, default: '' },
  finalCheckFilledAt: { type: Date, default: null },

  // Decision
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Approved', 'Rejected'],
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
