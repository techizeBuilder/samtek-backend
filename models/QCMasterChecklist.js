import mongoose from 'mongoose';

// The three QC modules this checklist system serves — Inventory QC is built
// first; Product Master QC / Motor Master QC reuse this exact same model
// (and controller/routes, see qcChecklistController.js) once R&D gets to
// them, just under their own `module` value. See
// server/docs/qc-module-restructure-client-request.md's 2026-08-31 follow-on
// for the design discussion.
export const QC_MODULES = ['inventory', 'productMaster', 'motorMaster'];

// One row in a module's master checklist — a possible check R&D has defined,
// not yet tied to any specific item. 'value' rows name WHAT gets measured
// (e.g. "Diameter") but never carry a number here — the acceptable
// value/tolerance is entered per item on QCItemChecklist instead, since the
// same measured parameter means a different range on every item (a 25mm
// shaft and a 40mm shaft can't share one tolerance). 'checkbox' rows are
// fully self-contained — nothing item-specific to add beyond selecting them.
const ChecklistRowSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: ['checkbox', 'value'], required: true },
  reference: { type: String, default: '', trim: true },
  // Soft-disable once any item has selected this row (see
  // deleteMasterChecklistItem's usage guard) — same convention as
  // RDChildPart/Item's own isDiscontinued: hides the row from "select checks
  // for an item" going forward without silently dropping it off items that
  // already picked it.
  isDiscontinued: { type: Boolean, default: false },
}, { timestamps: true });

// Which stages a module's checklist is split into. Inventory QC / Motor
// Master QC are flat — one catalog, always stage 'default'. Product Master
// QC is staged (2026-08-31 follow-on, see
// qc-module-restructure-client-request.md): 'initial'/'process' apply per
// Sub Child Part (see QCItemChecklist's childPartId/subChildPartId),
// 'final' applies to the whole assembled product — same as Purchase-type
// products, which only ever get 'final'. Exported so the controller and
// routes validate a module+stage pair the same way, in one place.
export const QC_MODULE_STAGES = {
  inventory: ['default'],
  motorMaster: ['default'],
  productMaster: ['initial', 'process', 'final'],
};

// One document per {company, module, stage} — deliberately NOT a library of
// many named templates. R&D maintains a single, growing catalog of possible
// checks per module+stage; items pick a subset of these rows (see
// QCItemChecklist) rather than getting a whole separate template attached.
const QCMasterChecklistSchema = new mongoose.Schema({
  module: { type: String, enum: QC_MODULES, required: true },
  stage: { type: String, enum: ['default', 'initial', 'process', 'final'], default: 'default' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  items: { type: [ChecklistRowSchema], default: [] },
}, { timestamps: true });

QCMasterChecklistSchema.index({ module: 1, stage: 1, company: 1 }, { unique: true });

export default mongoose.model('QCMasterChecklist', QCMasterChecklistSchema);
