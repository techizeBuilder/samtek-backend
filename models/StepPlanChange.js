import mongoose from 'mongoose';

// Feature 18 (client, 20 Nov 2026 — docs/client-features-2026-11/18-step-history-logic.md):
// someone planned on a step that hadn't started, then removed from the plan before
// it started. Removing a planned person deletes their StepCrewEntry (feature 9:
// nothing was worked), so this keeps the change for the step's History on Process
// Execution. Kept apart from StepCrewEntry on purpose: closed crew entries are
// read as worked stints (crew hours, labour cost, the scorecard, Manpower history,
// the delivery estimate's sticky people), and a plan change was never worked.
const StepPlanChangeSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
  orderNo: { type: String, default: '' },
  unitIndex: { type: Number, required: true }, // 0 = unit 1, also a Sub Child Part batch
  stepIndex: { type: Number, required: true },
  stepName: { type: String, default: '' },
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  personName: { type: String, default: '' },
  plannedAt: { type: Date, default: null }, // when they were put on the plan (the crew entry's creation)
  plannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  plannedByName: { type: String, default: '' },
  removedAt: { type: Date, required: true },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  removedByName: { type: String, default: '' },
}, { timestamps: true });

// The step's History reads one step and unit at a time.
StepPlanChangeSchema.index({ order: 1, unitIndex: 1, stepIndex: 1 });

export default mongoose.model('StepPlanChange', StepPlanChangeSchema);
