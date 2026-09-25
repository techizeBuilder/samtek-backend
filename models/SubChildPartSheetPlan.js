import mongoose from 'mongoose';

// Same shape as SheetMetalPlan.js's own SheetEntrySchema — duplicated rather
// than imported since that file doesn't export it. One entry per physical
// catalog sheet actually purchased for this plan.
const SheetEntrySchema = new mongoose.Schema({
  lengthValue: { type: Number, required: true, min: 0 },
  lengthUnit: { type: String, required: true },
  widthValue: { type: Number, required: true, min: 0 },
  widthUnit: { type: String, required: true },
});

// The Sheet Metal Plan for a Sub Child Part (see
// server/docs/bom-hierarchy-redesign-2026-09.md §7) — same real-world
// nesting/cutting concept SheetMetalPlan.js already has for a whole Machine
// BOM, just re-homed: a Sub Child Part has no BOM with multiple lines to
// aggregate a required area from, it's one source material with one
// per-piece amount (Item.subChildPartDetails.sourceQty/sourceUnit). So the
// one thing SheetMetalPlan.js doesn't need that this does is `orderQty` —
// how many Sub Child Part units this specific cutting run/laser file
// produces — since that's what turns "area per piece" into "area actually
// required for this plan". One plan per Sub Child Part (unique, upserted —
// R&D replaces it whenever a new cutting run happens, same as the Job Work
// Cost estimate; not a running log of every historical run).
const SubChildPartSheetPlanSchema = new mongoose.Schema({
  subChildPart: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  // How many Sub Child Part units this cutting run/laser file covers.
  orderQty: { type: Number, required: true, min: 1 },
  // = toMm2(subChildPartDetails.sourceQty, subChildPartDetails.sourceUnit) *
  // orderQty — the real theoretical minimum, recomputed authoritatively on
  // every save from the Sub Child Part's own live sourceQty/sourceUnit,
  // never trusted from the client. Only used afterward for the advisory
  // warning and the scrap-cost math (see computeSheetMetalPlanCostBreakdown,
  // itemPricingService.js — reused as-is via an adapter object, not
  // duplicated here).
  requiredAreaMm2: { type: Number, required: true },
  // R&D's own real-world nesting/layout entry — one array entry per physical
  // sheet actually purchased, each with its own Length x Width. A single
  // entry's own dimensions can never exceed the catalog sheet's own size
  // (checked server-side, either orientation).
  sheets: { type: [SheetEntrySchema], required: true },
  // Sum of every entry's own length(mm) x width(mm), server-computed.
  plannedAreaMm2: { type: Number, required: true },
  // Snapshot of the catalog variant's own one-sheet area (mm²) at plan-save
  // time — stays stable even if the Item's catalog dimensions are edited later.
  sheetAreaMm2: { type: Number, required: true },
  // sheets.length — a direct count of the physical sheets R&D actually
  // added for this whole orderQty run (not "per unit" — see
  // computeSheetMetalPlanCostBreakdown's own sheetsNeededPerUnit field,
  // which this feeds via an adapter that maps sheetsUsed onto it).
  sheetsUsed: { type: Number, required: true, min: 1 },
  // Advisory only — plannedAreaMm2 < requiredAreaMm2 at last save. Never
  // blocks save.
  warningBelowRequired: { type: Boolean, default: false },
  laserFileUrl: { type: String, default: '' },
  laserFileName: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

SubChildPartSheetPlanSchema.index({ subChildPart: 1, company: 1 }, { unique: true });

export default mongoose.model('SubChildPartSheetPlan', SubChildPartSheetPlanSchema);
