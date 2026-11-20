import mongoose from 'mongoose';

// Feature 13 (2026-11-17): the employee scorecard's settings — the points for
// each of the 13 parameters (adding up to 100) and how much a verified conduct
// note takes off. Set by the Company Admin. Every save is a new version that
// applies from a month the admin picks, so a month's score always uses the
// version in force for that month and an earlier month never changes.
// docs/client-features-2026-11/13-employee-scorecard-logic.md §14.
const n = { type: Number, required: true, min: 0 };

const ScorecardSettingsSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null }, // null = the whole company
  effectiveFrom: { type: String, required: true }, // 'YYYY-MM'
  points: {
    attendance: n, punctuality: n, noDelay: n,
    accuracy: n, quality: n, productivity: n, taskCompletion: n,
    behaviour: n, discipline: n, teamwork: n,
    ownership: n, safety: n, learning: n,
  },
  deductions: { minor: { ...n, max: 100 }, major: { ...n, max: 100 }, serious: { ...n, max: 100 } }, // % of the parameter's points
  // Feature 15 (2026-11-18): HR approves incentives alone up to this much per person per
  // payroll month; above it, the Company Admin decides. null = no limit.
  incentiveCap: { type: Number, default: null, min: 0 },
  savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  savedByName: { type: String, default: '' },
}, { timestamps: true });

ScorecardSettingsSchema.index({ company: 1, department: 1, effectiveFrom: -1, createdAt: -1 });

export default mongoose.model('ScorecardSettings', ScorecardSettingsSchema);
