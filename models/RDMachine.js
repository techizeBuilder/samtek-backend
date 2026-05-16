import mongoose from 'mongoose';

const RDMachineSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  designStatus: {
    type: String,
    enum: ['Draft', 'Testing', 'Approved', 'Rejected'],
    default: 'Draft',
  },
  releaseStatus: {
    type: String,
    enum: ['Not Released', 'Released'],
    default: 'Not Released',
  },
  machineType: { type: String, enum: ['Standard', 'Custom', 'Special Purpose Machine (SPM)'], default: 'Standard' },
  isDiscontinued: { type: Boolean, default: false },
  rejectionNote: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDMachineSchema.index({ company: 1, designStatus: 1 });
RDMachineSchema.index({ company: 1, isDiscontinued: 1 });

export default mongoose.model('RDMachine', RDMachineSchema);
