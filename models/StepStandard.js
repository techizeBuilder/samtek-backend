import mongoose from 'mongoose';

// Feature 19 (client, 20 Nov 2026 — docs/client-features-2026-11/19-standard-hours-logic.md):
// one decision by the Company Admin on a step's standard hours. 'Approved' rows are the
// versions in force (the latest approved one for a part's step is active, dated by
// approvedAt); 'Rejected' rows keep a turned-down R&D change or history proposal from
// being asked again until something new comes in.
//   standard(n, k) = setup + n × p1 × ( sigma + (1 − sigma) ÷ k )
const StepStandardSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  partCode: { type: String, required: true },
  partName: { type: String, default: '' },
  partKind: { type: String, default: '' }, // Machine / ChildPart / SubChildPart
  stepName: { type: String, required: true },
  stepKey: { type: String, required: true }, // lower-case, trimmed
  status: { type: String, enum: ['Approved', 'Rejected'], required: true },
  source: { type: String, enum: ['R&D', 'History'], required: true },
  hoursPerPiece: { type: Number, default: null }, // with `crew` people
  crew: { type: Number, default: 1 },
  setupHours: { type: Number, default: 0 },
  splitAnswer: { type: String, default: null },
  sigma: { type: Number, default: null },
  p1: { type: Number, default: null }, // hours per piece for one person
  basedOnRuns: { type: Number, default: 0 }, // a history proposal: runs behind it
  lastRunAt: { type: Date, default: null }, // a history proposal: the newest run behind it
  note: { type: String, default: '' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, default: '' },
  decidedAt: { type: Date, required: true },
}, { timestamps: true });

StepStandardSchema.index({ company: 1, partCode: 1, stepKey: 1, decidedAt: -1 });
StepStandardSchema.index({ company: 1, status: 1, decidedAt: -1 });

export default mongoose.model('StepStandard', StepStandardSchema);
