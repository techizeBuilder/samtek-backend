import mongoose from 'mongoose';

const ProductionTeamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  supervisor: { type: String, required: true, trim: true },
  members: [{ type: String, trim: true }],
  skills: [{ type: String }],
  efficiency: { type: Number, default: 85, min: 0, max: 100 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

ProductionTeamSchema.index({ company: 1, isActive: 1 });

export default mongoose.model('ProductionTeam', ProductionTeamSchema);
