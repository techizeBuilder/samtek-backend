import mongoose from 'mongoose';

const RDMachineSchema = new mongoose.Schema({
  // Existing Base Fields (Mapped to Product Code, P-Name, P-Description on Frontend)
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  // Dynamic Dropdown Fields
  category: { type: String, required: true, trim: true },
  pType: { type: String, required: true, trim: true },
  pSourceType: { type: String, required: true, trim: true },

  // New Text Fields
  pSpecification: { type: String, default: '' },
  brand: { type: String, default: '' },

  // Status Fields (These remain hardcoded enums as they dictate system logic)
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