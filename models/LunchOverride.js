import mongoose from 'mongoose';

// Stage 5 (2026-11-12): a person's lunch on one day, when it wasn't at their
// shift's usual time — confirmed by Production when completing a step. "later"
// with the real times, or "none". The usual time is the default and isn't stored.
// One per person per day, so every step they worked that day uses the same answer.
const LunchOverrideSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD, the working day (India)
  kind: { type: String, enum: ['later', 'none'], required: true },
  from: { type: String, default: null }, // HH:MM
  to: { type: String, default: null },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedByName: { type: String, default: '' },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
  stepName: { type: String, default: '' },
}, { timestamps: true });

LunchOverrideSchema.index({ company: 1, person: 1, date: 1 }, { unique: true });

export default mongoose.model('LunchOverride', LunchOverrideSchema);
