import mongoose from 'mongoose';

const RDDocumentSchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
  machineCode: { type: String, required: true },
  machineName: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['Design Files', 'BOM', 'Process Sheet', 'QC Checklist', 'User Manual', 'Test Report', 'Certificate', 'Specification', 'Other'],
    required: true,
  },
  version: { type: String, default: 'v1.0' },
  size: { type: String, default: '' },
  fileUrl: { type: String, default: '' },
  originalName: { type: String, default: '' },
  notes: { type: String, default: '' },
  uploadedBy: { type: String, required: true },
  uploadedAt: { type: String },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDDocumentSchema.index({ company: 1, machine: 1 });

export default mongoose.model('RDDocument', RDDocumentSchema);
