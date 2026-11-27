// Feature 23 (client, 23 Nov 2026): a photo or video Production attaches when it finishes a
// step, for QC to see. docs/client-features-2026-11/23-step-media-logic.md
// One record per file, in its own collection (nothing is added to the production order, so
// order reads don't get heavier). The Company Admin's clean-up deletes the file and keeps the
// record as a note ("removed by … on …"); an uploader's own correction deletes both.
import mongoose from 'mongoose';

const StepMediaSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
  orderNo: { type: String, default: '' },
  orderKind: { type: String, default: '' },
  itemName: { type: String, default: '' },
  unitIndex: { type: Number, default: 0 }, // 0-based (0 = the order's own processes)
  stepIndex: { type: Number, required: true },
  category: { type: String, default: '' },
  stepName: { type: String, default: '' },
  attempt: { type: Number, default: null }, // the QC submission it came with; null on an ordinary step
  kind: { type: String, enum: ['photo', 'video'], required: true },
  url: { type: String, required: true },
  fileName: { type: String, default: '' },
  mime: { type: String, default: '' },
  size: { type: Number, default: 0 },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  uploadedByName: { type: String, default: '' },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deletedByName: { type: String, default: '' },
}, { timestamps: true });

StepMediaSchema.index({ order: 1, unitIndex: 1, stepIndex: 1 });
StepMediaSchema.index({ company: 1, deletedAt: 1, createdAt: 1 });

export default mongoose.models.StepMedia || mongoose.model('StepMedia', StepMediaSchema);
