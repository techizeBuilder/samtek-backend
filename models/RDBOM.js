import mongoose from 'mongoose';

const MaterialSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  childPart: { type: String, default: '' },
  subChildPart: { type: String, default: '' },
  // Codes of the Child Part / Sub Child Part (RDChildPart) this material line
  // was picked under — childPart/subChildPart above stay as the display-name
  // snapshot (unchanged), these are the stronger reference back to the
  // selected master record.
  childPartCode: { type: String, default: '' },
  subChildPartCode: { type: String, default: '' },
  item: { type: String, required: true, trim: true }, // Replaces 'name'
  // Independent BOM-only classification (RDMasterOption field "MaterialType") —
  // not derived from Product Master's P-Type. Optional: no longer collected on the form.
  itemType: { type: String, default: '', trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true },
  // Auto-calculated from the matched Inventory item's purchaseCost × quantity
  // at the moment the material was added/edited — a snapshot, like the other
  // Inventory fields below, not a live lookup.
  unitPrice: { type: Number, default: 0 },
  totalPrice: { type: Number, default: 0 },
  isDiscontinued: { type: Boolean, default: false },

  // Snapshot of extra Inventory item data captured when the material code
  // matched, field-for-field with BOM_FIELD_CATALOG (RDBOMFieldConfig.js) —
  // itself matched field-for-field against Inventory's real create/edit form
  // (SimpleInventoryForm.jsx) — so whichever fields an admin later enables as
  // BOM columns always have real data to show. Not a live populate, so a
  // locked BOM stays stable even if the underlying Inventory item changes.
  category: { type: String, default: '' },
  subCategory: { type: String, default: '' },
  sourceType: { type: String, default: '' },
  itemSourceType: { type: String, default: '' },
  itemCategories: [{ type: String }],
  stdCost: { type: Number, default: null },
  salePrice: { type: Number, default: null },
  mrp: { type: Number, default: null },
  hsn: { type: String, default: '' },
  gst: { type: Number, default: null },
  brand: { type: String, default: '' },
  description: { type: String, default: '' },
  modelNumber: { type: String, default: '' },
  metrology: { type: String, default: '' },
  materialGrade: { type: String, default: '' },
  size: { type: String, default: '' },
  unitWeightValue: { type: Number, default: null },
  unitWeightUnitType: { type: String, default: '' },
  unitWeightUnit: { type: String, default: '' },
  // Mirrors Item.dimensions' shape ({length,height,width,diaOD,diaID,thickness},
  // each {value,unit}) — kept as Mixed since it's a read-only snapshot, not
  // something this form edits field-by-field.
  dimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
  applications: [{ type: String }],
  specifications: [{ key: String, value: String }],
  // Legacy Product-Master-only fields — no longer populated (Inventory items
  // don't have them), kept only so older BOMs built before this change still
  // display their existing data.
  pType: { type: String, default: '' },
  pSourceType: { type: String, default: '' },
  inputUnitType: { type: String, default: '' },
  inputUnit: { type: String, default: '' },
  outputUnitType: { type: String, default: '' },
  outputUnit: { type: String, default: '' },
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
  // Cost of actually building this machine/motor (labor, job-work, etc. — not
  // material cost, which is Σ(material.unitPrice × qty) above) and any other
  // one-off production expense, folded into the BOM's total cost (see
  // itemPricingService.resolveManufacturingItemCost). Before the item has
  // ever been built, R&D fills these in as a manual estimate; once Production
  // completes a build, Process Execution overwrites them with the real
  // figures from that build (latest build always wins — see approveQC).
  productionCost: { type: Number, default: null, min: 0 },
  productionExpense: { type: Number, default: null, min: 0 },
  // 'Manual' = R&D's pre-build estimate; 'Actual' = auto-filled from the most
  // recently completed build of this machine/motor in Process Execution.
  productionCostSource: { type: String, enum: ['Manual', 'Actual'], default: 'Manual' },
  productionCostUpdatedAt: { type: Date, default: null },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDBOMSchema.index({ company: 1, machine: 1 }, { unique: true });

export default mongoose.model('RDBOM', RDBOMSchema);