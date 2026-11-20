import mongoose from 'mongoose';

// Stage 5 (2026-11-12): one finished run of a production step, saved when it
// completes, for the average time per step (by number of people) and efficiency.
// A QC rework round is its own run, marked rework, and kept out of averages.
const StepRunSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  partCode: { type: String, required: true },
  partName: { type: String, default: '' },
  stepName: { type: String, required: true },
  orderKind: { type: String, default: '' },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
  orderNo: { type: String, default: '' },
  unitIndex: { type: Number, required: true },
  stepIndex: { type: Number, required: true },
  pieces: { type: Number, required: true },
  personHours: { type: Number, required: true },
  workingHours: { type: Number, required: true }, // hours anyone was working on it
  crewSize: { type: Number, required: true },     // people working at once, on average, rounded
  clockHours: { type: Number, default: 0 },
  plannedHours: { type: Number, default: null },
  rework: { type: Boolean, default: false },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, required: true },
  byTeam: { type: [{ team: mongoose.Schema.Types.ObjectId, personHours: Number }], default: [] },
  // Stage 6 (2026-11-12): each person's labour, priced once when the run is
  // saved (the salary in force then). days keeps the hours per day so a
  // missing salary entered later can be priced. Never sent to any screen:
  // hours and cost together would show someone's pay.
  byPerson: {
    type: [{
      person: mongoose.Schema.Types.ObjectId,
      team: { type: mongoose.Schema.Types.ObjectId, default: null }, // feature 13: their team on this run (a cover: the team covered)
      personHours: Number,
      days: { type: [{ _id: false, date: String, hours: Number, shiftHours: Number }], default: [] },
      labour: { type: Number, default: 0 },
      missing: { type: Boolean, default: false }, // no salary entered: counted ₹0
    }],
    default: [],
  },
  labour: { type: Number, default: 0 },
}, { timestamps: true });

StepRunSchema.index({ order: 1, unitIndex: 1, stepIndex: 1, completedAt: 1 }, { unique: true });
StepRunSchema.index({ company: 1, partCode: 1, stepName: 1, completedAt: -1 });
StepRunSchema.index({ company: 1, 'byPerson.person': 1 });
// The scorecard reads a period's finished steps (feature 13): without this, every run ever saved is read.
StepRunSchema.index({ company: 1, completedAt: 1 });

export default mongoose.model('StepRun', StepRunSchema);
