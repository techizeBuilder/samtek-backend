import mongoose from 'mongoose';
import { MaterialLineSchema } from './ChildPartBOM.js';
import { ProcessCategorySchema } from './ProcessDefinitionSchema.js';

// One line per Child Part this Machine is assembled from (see
// server/docs/bom-hierarchy-redesign-2026-09.md §5, §9) — a real reference
// (ObjectId + qty), mirroring exactly how ChildPartBOM.subChildParts[]
// references a Sub Child Part. code/name are a display-name snapshot;
// unitCost/unitWeightKg are copied from the referenced Child Part's own
// ChildPartBOM total cost/weight at add/update time AND re-derived on every
// GET (see machineBOMController.js's getMachineBOM, reusing
// childPartBOMController.js's exported refreshAndComputeChildPart).
const ChildPartLineSchema = new mongoose.Schema({
  childPart: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unitCost: { type: Number, default: 0 },
  totalPrice: { type: Number, default: 0 },
  unitWeightKg: { type: Number, default: 0 },
  totalWeightKg: { type: Number, default: 0 },
  isDiscontinued: { type: Boolean, default: false },
}, { timestamps: true });

// A Machine's own new-flow BOM (see server/docs/bom-hierarchy-redesign-2026-09.md
// §5, §9) — references Child Parts instead of a flat tagged material list,
// plus its own extra Materials/Tools (paint, wiring, generic hardware not
// tied to any one Child Part). Deliberately parallel to, not a replacement
// for, the OLD per-machine RDBOM flow — see machineBOMController.js's own
// top comment for how the two coexist. One document per Machine/Motor Item.
const MachineBOMSchema = new mongoose.Schema({
  machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  variant: { type: String, default: 'Standard' },
  version: { type: String, default: 'v1.0' },
  isLocked: { type: Boolean, default: false },
  lockedAt: { type: String, default: null },
  childParts: { type: [ChildPartLineSchema], default: [] },
  // Machine's own extra Materials/Tools — same MaterialLineSchema
  // ChildPartBOM's own materials[] uses (imported, not re-copied a third
  // time), split by materialKind exactly like every other BOM level.
  materials: { type: [MaterialLineSchema], default: [] },
  // Category -> Internal Process pipeline for this Machine (see
  // ProcessDefinitionSchema.js) — an OutSource internal process's
  // materialRefs points at entries in materials[] above.
  processDefinition: { type: [ProcessCategorySchema], default: [] },
  // Assembly labor / one-off build cost — same manual-estimate shape as the
  // OLD RDBOM's own Production Cost card. productionCostSource stays
  // 'Manual' in this pass — no Production-side write path to this new model
  // yet (confirmed out of scope; see docs/bom-hierarchy-redesign-2026-09.md).
  productionCost: { type: Number, default: null, min: 0 },
  productionExpense: { type: Number, default: null, min: 0 },
  productionCostSource: { type: String, enum: ['Manual', 'Actual'], default: 'Manual' },
  productionCostUpdatedAt: { type: Date, default: null },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

MachineBOMSchema.index({ company: 1, machine: 1 }, { unique: true });

export default mongoose.model('MachineBOM', MachineBOMSchema);
