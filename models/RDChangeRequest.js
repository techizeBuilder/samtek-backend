import mongoose from 'mongoose';

const RDChangeRequestSchema = new mongoose.Schema({
  changeId: { type: String, unique: true },
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
  machineName: { type: String, required: true },
  machineCode: { type: String, required: true },
  raisedBy: { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  changeType: {
    type: String,
    enum: ['Material', 'Design', 'Tool', 'Process', 'Other'],
    required: true,
  },
  description: { type: String, required: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  rdNotes: { type: String, default: '' },
  raisedAt: { type: String },
  resolvedAt: { type: String, default: null },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDChangeRequestSchema.index({ company: 1, status: 1 });
RDChangeRequestSchema.index({ company: 1, machine: 1 });

export default mongoose.model('RDChangeRequest', RDChangeRequestSchema);
