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
  metrology: { type: String, default: '', trim: true },
  size: { type: String, default: '', trim: true },

  // Unit Weight: a numeric value plus its own Unit Type -> Unit pair (dynamic,
  // sourced from /api/inventory/unit-types — same system BOM Management uses).
  unitWeightValue: { type: Number, default: null },
  unitWeightUnitType: { type: String, default: '', trim: true },
  unitWeightUnit: { type: String, default: '', trim: true },

  // Input Unit (how this product is purchased) / Output Unit (how it's issued
  // or stocked) — unit-only, no value. Mirrors Inventory Item's
  // purchaseUnitType/purchaseUnit + unitType/unit convention.
  inputUnitType: { type: String, default: '', trim: true },
  inputUnit: { type: String, default: '', trim: true },
  outputUnitType: { type: String, default: '', trim: true },
  outputUnit: { type: String, default: '', trim: true },

  // Dynamic Key-Value Specifications
  specifications: [{
    key: { type: String, trim: true },
    value: { type: String, trim: true }
  }],

  // Dynamic Custom Fields (parent label -> sub-field name -> value),
  // shaped per the RDCustomFieldTemplate matching pType+category+pSourceType
  customFields: [{
    groupLabel: { type: String, trim: true },
    fieldName: { type: String, trim: true },
    value: { type: String, trim: true, default: '' }
  }],

  // Manual gate: only machines forwarded here show up in Design Approval / Prototype
  forwardToNextPhase: { type: Boolean, default: false },

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
  // Set the first time a ProductionOrder for this machine reaches
  // 'Completed'. Until then, the linked Item's cost/MRP/Sale Price stays
  // whatever R&D entered manually — see itemPricingService.js.
  firstBuiltAt: { type: Date, default: null },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDMachineSchema.index({ company: 1, designStatus: 1 });
RDMachineSchema.index({ company: 1, isDiscontinued: 1 });

export default mongoose.model('RDMachine', RDMachineSchema);