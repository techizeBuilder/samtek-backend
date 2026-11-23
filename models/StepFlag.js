import mongoose from 'mongoose';

// Feature 19 (client, 20 Nov 2026 — decision D): Production flags a step whose job is
// unusual ("needs 16 h, not 12.5 h, because …"). Work never waits for it: only that
// step's score does. The Company Admin approves (the flagged hours count) or rejects
// (the standard counts). One open flag per step and unit.
const StepFlagSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
  orderNo: { type: String, default: '' },
  partCode: { type: String, default: '' },
  partName: { type: String, default: '' },
  unitIndex: { type: Number, required: true },
  stepIndex: { type: Number, required: true },
  stepName: { type: String, default: '' },
  standardHours: { type: Number, default: null }, // what the standard said when flagged
  requestedHours: { type: Number, required: true },
  reason: { type: String, required: true },
  flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  flaggedByName: { type: String, default: '' },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  note: { type: String, default: '' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
}, { timestamps: true });

StepFlagSchema.index({ order: 1, unitIndex: 1, stepIndex: 1, status: 1 });
StepFlagSchema.index({ company: 1, status: 1, createdAt: -1 });
StepFlagSchema.index({ order: 1, unitIndex: 1, stepIndex: 1 }, { unique: true, partialFilterExpression: { status: 'Pending' } });

export default mongoose.model('StepFlag', StepFlagSchema);
