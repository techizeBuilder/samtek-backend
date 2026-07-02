import mongoose from 'mongoose';

const RDMachineSchema = new mongoose.Schema({
  // Existing Base Fields
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  // Dynamic Dropdown Fields
  category: { type: String, required: true, trim: true },
  pType: { type: String, required: true, trim: true },
  pSourceType: { type: String, required: true, trim: true },

  // Other Text Fields
  brand: { type: String, default: '' },

  // Dynamic Key-Value Specifications
  specifications: [{
    key: { type: String, trim: true },
    value: { type: String, trim: true }
  }],

  // Status Fields
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
  machineType: {
    type: String,
    enum: ['Standard', 'Custom', 'Special Purpose Machine (SPM)'],
    default: 'Standard'
  },

  isDiscontinued: { type: Boolean, default: false },
  rejectionNote: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDMachineSchema.index({ company: 1, designStatus: 1 });
RDMachineSchema.index({ company: 1, isDiscontinued: 1 });

export default mongoose.model('RDMachine', RDMachineSchema);