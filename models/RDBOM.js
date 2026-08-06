import mongoose from 'mongoose';

const MaterialSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  childPart: { type: String, default: '' },
  subChildPart: { type: String, default: '' },
  item: { type: String, required: true, trim: true }, // Replaces 'name'
  // Independent BOM-only classification (RDMasterOption field "MaterialType") —
  // not derived from Product Master's P-Type. Optional: no longer collected on the form.
  itemType: { type: String, default: '', trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true },
  isDiscontinued: { type: Boolean, default: false },

  // Snapshot of extra Product Master data captured when the material code matched an
  // RDMachine entry at add/edit time. Kept as a snapshot (not a live populate) so a locked
  // BOM stays stable even if the underlying Product Master record changes later.
  category: { type: String, default: '' },
  pType: { type: String, default: '' },
  pSourceType: { type: String, default: '' },
  brand: { type: String, default: '' },
  description: { type: String, default: '' },
  metrology: { type: String, default: '' },
  size: { type: String, default: '' },
  unitWeightValue: { type: Number, default: null },
  unitWeightUnitType: { type: String, default: '' },
  unitWeightUnit: { type: String, default: '' },
  inputUnitType: { type: String, default: '' },
  inputUnit: { type: String, default: '' },
  outputUnitType: { type: String, default: '' },
  outputUnit: { type: String, default: '' },
  specifications: [{ key: String, value: String }],
  customFields: [{ groupLabel: String, fieldName: String, value: String }],
});

const RDBOMSchema = new mongoose.Schema({
  // Product Master machines now live in the Item collection (productKind:'Machine')
  // instead of the old separate RDMachine collection — see rdController.js's
  // toMachineResponse for the field-name translation this implies on read.
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  variant: { type: String, default: 'Standard' }, // Added Machine Variant
  version: { type: String, default: 'v1.0' },
  isLocked: { type: Boolean, default: false },
  lockedAt: { type: String, default: null },
  materials: { type: [MaterialSchema], default: [] },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDBOMSchema.index({ company: 1, machine: 1 }, { unique: true });

export default mongoose.model('RDBOM', RDBOMSchema);