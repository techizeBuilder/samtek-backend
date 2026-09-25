import mongoose from 'mongoose';
import { ProcessCategorySchema } from './ProcessDefinitionSchema.js';

// One line per Sub Child Part Master item this Child Part is assembled from
// (see server/docs/bom-hierarchy-redesign-2026-09.md §4). code/name are a
// display-name snapshot (mirrors RDBOM.MaterialSchema's own snapshot
// convention); materialsCost/jobWorkCost/scrapCost are copied from the
// referenced Item's subChildPartDetails at add/update time AND re-derived on
// every GET (see childPartBOMController.js's getChildPartMaster) since those
// numbers keep changing on Sub Child Part Master after this line is added.
const SubChildPartLineSchema = new mongoose.Schema({
  subChildPart: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, default: 'Pieces' },
  materialsCost: { type: Number, default: 0 },
  jobWorkCost: { type: Number, default: 0 },
  scrapCost: { type: Number, default: 0 },
  unitCost: { type: Number, default: 0 },
  totalPrice: { type: Number, default: 0 },
  // Weight of one Sub Child Part unit, in kg — copied from the referenced
  // Item's subChildPartDetails.unitWeightKg at add/update time AND
  // re-derived on every GET, same live-refresh convention as the cost
  // fields above (see childPartBOMController.js's getChildPartMaster).
  unitWeightKg: { type: Number, default: 0 },
  totalWeightKg: { type: Number, default: 0 },
  isDiscontinued: { type: Boolean, default: false },
}, { timestamps: true });

// Material/Tool line — RDBOM.MaterialSchema, trimmed. Dropped:
// childPart/subChildPart/childPartCode/subChildPartCode (this whole document
// is already scoped to one Child Part, no per-line re-tagging needed) and
// every legacy Product-Master-only field (pType/pSourceType/inputUnitType/
// inputUnit/outputUnitType/outputUnit/customFields). Kept field-for-field
// identical otherwise, so this line prices EXACTLY like a Machine BOM
// material line (see childPartBOMController.js's addChildPartMasterMaterial,
// mirroring rdController.js's addMaterial). Exported so MachineBOM.js can
// reuse this exact shape for its own Materials/Tools array instead of a
// third copy-paste — Machine's own extra materials price/weigh identically.
export const MaterialLineSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  item: { type: String, required: true, trim: true },
  materialKind: { type: String, enum: ['raw', 'tool'], default: 'raw' },
  isSheetMetal: { type: Boolean, default: false },
  itemType: { type: String, default: '', trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true },
  unitPrice: { type: Number, default: 0 },
  totalPrice: { type: Number, default: 0 },
  isDiscontinued: { type: Boolean, default: false },
  category: { type: String, default: '' },
  subCategory: { type: String, default: '' },
  inventoryItemType: { type: String, default: '' },
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
  dimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
  fabricationCategory: { type: String, default: '' },
  bomDimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
  computedWeightPerPieceKg: { type: Number, default: null },
  dimensionVariantId: { type: String, default: null },
  amountValue: { type: Number, default: null },
  amountUnit: { type: String, default: null },
  applications: [{ type: String }],
  specifications: [{ key: String, value: String }],
}, { timestamps: true });

// A Child Part's own BOM (see server/docs/bom-hierarchy-redesign-2026-09.md
// §4, §9) — the standalone material list a Child Part Master owns directly,
// distinct from the OLD per-machine RDChildPart/RDBOM flow (see
// childPartBOMController.js's own top comment for how the two coexist
// without colliding). One document per Child Part Item.
const ChildPartBOMSchema = new mongoose.Schema({
  childPart: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  subChildParts: { type: [SubChildPartLineSchema], default: [] },
  // Both Material and Tool rows, split by materialKind — same one-array
  // convention RDBOM already uses.
  materials: { type: [MaterialLineSchema], default: [] },
  // Category -> Internal Process pipeline for this Child Part (see
  // ProcessDefinitionSchema.js) — an OutSource internal process's
  // materialRefs points at entries in materials[] above.
  processDefinition: { type: [ProcessCategorySchema], default: [] },
  // Assembly labor / one-off build cost — same manual-estimate shape as
  // RDBOM's own Production Cost card (see design doc §6).
  productionCost: { type: Number, default: null, min: 0 },
  productionExpense: { type: Number, default: null, min: 0 },
  productionCostSource: { type: String, enum: ['Manual', 'Actual'], default: 'Manual' },
  productionCostUpdatedAt: { type: Date, default: null },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

ChildPartBOMSchema.index({ company: 1, childPart: 1 }, { unique: true });

export default mongoose.model('ChildPartBOM', ChildPartBOMSchema);
