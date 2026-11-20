import mongoose from 'mongoose';

// Feature 10 (2026-11-13): an incentive for a person. A department head (today
// the Production Head) requests it; HR approves it with the amount and month,
// or rejects it, or gives one directly (direct: true). An approved incentive is
// paid with that month's payroll. docs/client-features-2026-11/10-performance-score-logic.md §8
const IncentiveRequestSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  personName: { type: String, default: '' },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  month: { type: String, required: true }, // 'YYYY-MM': the payroll it's paid with
  reason: { type: String, default: '' },
  suggestedAmount: { type: Number, default: null },
  // AwaitingAdmin (feature 15, 2026-11-18): HR approved or gave it above the cap, so the
  // Company Admin decides; not paid until then. docs/client-features-2026-11/15-incentive-cap-logic.md
  status: { type: String, enum: ['Requested', 'AwaitingAdmin', 'Approved', 'Rejected'], default: 'Requested' },
  amount: { type: Number, default: null },
  direct: { type: Boolean, default: false },
  // The score when it was asked for (or given), kept as it was.
  scoreSnapshot: {
    score: Number, timing: Number, accuracy: Number, measured: Number, band: String, from: Date, to: Date,
    // Feature 13 (2026-11-17): the scorecard's grade, the month, the points it was out of, and each part.
    grade: String, month: String, earned: Number, possible: Number, parts: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  requestedByName: { type: String, default: '' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
  rejectReason: { type: String, default: '' },
  // Feature 15: who sent it to the Company Admin, and what the cap check saw.
  forwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  forwardedByName: { type: String, default: '' },
  forwardedAt: { type: Date, default: null },
  capCheck: { type: { _id: false, cap: Number, approvedBefore: Number }, default: undefined },
}, { timestamps: true });

IncentiveRequestSchema.index({ company: 1, status: 1, createdAt: -1 });
IncentiveRequestSchema.index({ company: 1, person: 1, month: 1 });
// 17 Nov 2026: the list with no status filter (newest first), and payroll's monthly
// lookup (approvedForMonth asks by person + month, without the company).
IncentiveRequestSchema.index({ company: 1, createdAt: -1 });
IncentiveRequestSchema.index({ person: 1, month: 1 });

export default mongoose.model('IncentiveRequest', IncentiveRequestSchema);
