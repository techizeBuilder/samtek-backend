import mongoose from 'mongoose';

// Which rows off that module's single QCMasterChecklist apply to one
// specific item, plus — for 'value' type rows only — the expected
// value/tolerance for THIS item (e.g. the master's "Diameter" row means
// something different on a 25mm shaft vs a 40mm shaft, so the number lives
// here, never on the shared master row; see QCMasterChecklist.js's own
// comment). 'checkbox' rows carry no expectedValue — selecting one just
// means it applies to this item.
const SelectedRowSchema = new mongoose.Schema({
  masterItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  expectedValue: { type: String, default: '', trim: true },
}, { _id: false });

// One document per {company, module, stage, item, childPartId, subChildPartId}.
// `item` is always the top-level Item this checklist is ultimately about —
// for Product Master QC's 'initial'/'process' stages that's still the
// PRODUCT (not the part), so "every part-level checklist for this product"
// stays a simple { module, item } query; childPartId/subChildPartId then
// narrow it down to the exact Sub Child Part (RDChildPart.js). Both stay
// null for every flat-module selection and for 'final' stage, which always
// targets the whole assembled/purchased product, never a part.
const QCItemChecklistSchema = new mongoose.Schema({
  module: { type: String, enum: ['inventory', 'productMaster', 'motorMaster', 'childPart', 'subChildPart'], required: true },
  stage: { type: String, enum: ['default', 'initial', 'process', 'final'], default: 'default' },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  childPartId: { type: mongoose.Schema.Types.ObjectId, default: null },
  subChildPartId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Per-step checklists (QC multi-checkpoint redesign, 2026-09-25): one
  // document per QC-flagged BOM step, identified by its Process Definition
  // category + step name (step names are unique within a category, never
  // across the whole BOM — so both are needed). null on every item-level
  // (and legacy part-level) checklist — readers that don't pass these get
  // them defaulted to null (qcChecklistController.js's
  // resolveSelectedChecklist), so a step row can never be mistaken for the
  // item-level one.
  stepCategory: { type: String, default: null, trim: true },
  stepName: { type: String, default: null, trim: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  selectedItems: { type: [SelectedRowSchema], default: [] },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

QCItemChecklistSchema.index({ module: 1, stage: 1, item: 1, childPartId: 1, subChildPartId: 1, stepCategory: 1, stepName: 1, company: 1 }, { unique: true });

export default mongoose.model('QCItemChecklist', QCItemChecklistSchema);
