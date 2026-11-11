import mongoose from 'mongoose';

const ProductionTeamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // Names copied from the people below (2026-11-11), so every screen that shows
  // a team's supervisor and members keeps working. Old typed teams have only these.
  supervisor: { type: String, required: true, trim: true },
  members: [{ type: String, trim: true }],
  // The team's people, picked from HR's records (Production department, never
  // the Production Head; one person, one team). The supervisor is one of them.
  people: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  supervisorPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  skills: [{ type: String }],
  // Worked out by the system later, from Process Execution. null = not measured yet.
  efficiency: { type: Number, default: null, min: 0, max: 100 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

ProductionTeamSchema.index({ company: 1, isActive: 1 });

export default mongoose.model('ProductionTeam', ProductionTeamSchema);
