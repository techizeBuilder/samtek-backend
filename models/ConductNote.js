import mongoose from 'mongoose';

// Feature 13 (2026-11-17): a conduct note about a person — the employee
// scorecard's Behaviour, Discipline, Teamwork, Ownership and Safety.
// docs/client-features-2026-11/13-employee-scorecard-logic.md §5.
// A department head records it with a written reason; it counts only once HR
// verifies it. A verified Concern takes a share of that parameter's points off
// in the month of its date (Minor / Major / Serious, settable). Appreciation is
// kept for the record and adds nothing. Nothing is deleted: a verified note can
// be cancelled with a reason.
export const CONDUCT_TYPES = ['Behaviour', 'Discipline', 'Teamwork', 'Ownership', 'Safety'];
export const CONDUCT_SEVERITIES = ['Minor', 'Major', 'Serious'];
export const CONDUCT_STATUSES = ['Pending', 'Verified', 'Rejected', 'Cancelled'];
// Feature 24 (2026-11-23): a Warning comes before any concern (no direct action). It takes
// nothing off. HR's rules (ConductWarningRules) say how many per type, and whether one counts
// at once or after HR approves. docs/client-features-2026-11/24-conduct-warnings-logic.md
export const CONDUCT_KINDS = ['Concern', 'Warning', 'Appreciation'];

const ConductNoteSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  personName: { type: String, default: '' },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  kind: { type: String, enum: CONDUCT_KINDS, default: 'Concern' },
  // Feature 24: a warning's place, fixed when recorded ("Warning 1 of 2").
  warningNumber: { type: Number, default: null },
  warningsAllowed: { type: Number, default: null },
  autoCounted: { type: Boolean, default: false }, // a warning counted at once (HR's rule), not verified by a person
  // Immediate action: a concern HR writes without a warning first, because it can't wait.
  // The Company Admin approves it (not HR); until then it doesn't count.
  immediate: { type: Boolean, default: false },
  immediateReason: { type: String, default: '' },
  type: { type: String, enum: CONDUCT_TYPES, required: true },
  severity: { type: String, enum: [...CONDUCT_SEVERITIES, null], default: null }, // Concern only
  date: { type: String, required: true }, // 'YYYY-MM-DD' (India), the day it happened
  reason: { type: String, required: true },
  attachment: { type: { _id: false, file: String, name: String }, default: null }, // served only through the API
  status: { type: String, enum: CONDUCT_STATUSES, default: 'Pending' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedByName: { type: String, default: '' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
  decisionReason: { type: String, default: '' }, // why it was rejected
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledByName: { type: String, default: '' },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: '' },
}, { timestamps: true });

ConductNoteSchema.index({ company: 1, person: 1, date: 1 });
ConductNoteSchema.index({ company: 1, status: 1, createdAt: -1 });
ConductNoteSchema.index({ company: 1, createdAt: -1 }); // the list with no status filter, newest first
ConductNoteSchema.index({ company: 1, person: 1, kind: 1, date: 1 }); // feature 24: a person's warnings in the last 3 months

export default mongoose.model('ConductNote', ConductNoteSchema);
