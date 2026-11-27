import mongoose from 'mongoose';

// Feature 24 (client, 2026-11-23): HR's warning rules for conduct notes, one set per company.
// For each type: how many warnings someone gets before a concern can be recorded (1–5; a
// warning always comes first, so never 0), and whether a warning counts at once or only after
// HR approves it. A type that isn't saved uses the defaults (1, after HR approves). Changes
// apply to new notes. docs/client-features-2026-11/24-conduct-warnings-logic.md
const rule = { _id: false, allowed: { type: Number, min: 1, max: 5, default: 1 }, countsAt: { type: String, enum: ['approval', 'once'], default: 'approval' } };

const ConductWarningRulesSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  rules: {
    Behaviour: rule, Discipline: rule, Teamwork: rule, Ownership: rule, Safety: rule,
  },
  savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  savedByName: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.ConductWarningRules || mongoose.model('ConductWarningRules', ConductWarningRulesSchema);
