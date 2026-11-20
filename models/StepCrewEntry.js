import mongoose from 'mongoose';

// Stage 5 (2026-11-12): who worked on a production step, and when. One row per
// person per stint (joined → left); a person can rejoin, which is a new row.
// leftAt null = still on the step. Hours come from these plus attendance:
// services/crew/crewHoursCalc.js. Logic: docs/client-features-2026-11/02e-assign-and-hours-logic.md
const StepCrewEntrySchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
  orderNo: { type: String, default: '' },
  orderKind: { type: String, default: '' },
  partCode: { type: String, default: '' },
  partName: { type: String, default: '' },
  unitIndex: { type: Number, required: true }, // 0 = unit 1, also a Sub Child Part batch
  stepIndex: { type: Number, required: true },
  stepName: { type: String, default: '' },
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionTeam', default: null }, // their team at the time
  borrowed: { type: Boolean, default: false }, // from a team other than the step's own
  joinedAt: { type: Date, required: true },
  leftAt: { type: Date, default: null },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Feature 7 (2026-11-12): when joinedAt / leftAt was back-dated, the real
  // moment it was entered (null = entered at that time).
  joinedEnteredAt: { type: Date, default: null },
  leftEnteredAt: { type: Date, default: null },
  // Feature 8 (2026-11-12): put on to fill an absent member's place when a team
  // was put on the step — whom they cover and for which team (that team's
  // efficiency gets their hours). The team on Manpower doesn't change.
  coveringFor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  coveringForName: { type: String, default: '' },
  forTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionTeam', default: null },
  rework: { type: Boolean, default: false }, // joined after a QC rejection of this step
}, { timestamps: true });

StepCrewEntrySchema.index({ company: 1, person: 1, leftAt: 1 });
StepCrewEntrySchema.index({ order: 1, unitIndex: 1, stepIndex: 1 });
// closeFinishedCrews runs before every crew read or change and asks for the open
// crews (leftAt null): without this it read every crew entry ever (17 Nov 2026).
StepCrewEntrySchema.index({ company: 1, leftAt: 1 });
// Delivery estimate (2026-11-18): a part's last orders, for its usual people at once.
StepCrewEntrySchema.index({ company: 1, partCode: 1, joinedAt: -1 });

export default mongoose.model('StepCrewEntry', StepCrewEntrySchema);
