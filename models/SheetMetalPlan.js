import mongoose from 'mongoose';

// One plan per distinct (BOM, sheet-metal Item, catalog dimensionVariant) —
// R&D's real-world nesting/cutting decision for that sheet size across the
// WHOLE BOM, replacing the old per-child-part cutting decision Store used to
// make at transfer time (see rdController.js's processRDRequest WORKFLOW 2
// and inventoryController.js's transferSheetMetalPlanToProduction). Values
// here are all PER ONE UNIT of the finished machine, same convention as
// every other RDBOM.materials[] quantity — a Production Order's own
// orderQuantity is applied on top when a demand is actually pushed, so one
// plan serves orders of any build size.
const SheetMetalPlanSchema = new mongoose.Schema({
  bom: { type: mongoose.Schema.Types.ObjectId, ref: 'RDBOM', required: true },
  itemCode: { type: String, required: true, trim: true },
  // Matches RDBOM.MaterialSchema's own dimensionVariantId — which
  // Item.dimensionVariants[] entry (i.e. which catalog sheet size) this plan
  // is for.
  dimensionVariantId: { type: String, required: true },
  // Display snapshot, avoids a live Item lookup everywhere this plan is shown.
  itemName: { type: String, default: '' },
  materialGrade: { type: String, default: '' },
  // Server-computed sum of bomDimensions.area (mm²) across every 'raw' BOM
  // line on this bom sharing {itemCode, dimensionVariantId} — the raw
  // theoretical minimum, recomputed authoritatively on every save. Never
  // shown to R&D before they enter their own planned Length/Width (see the
  // planning screen's own comment) — only used afterward for the advisory warning.
  requiredAreaMm2: { type: Number, default: 0 },
  // R&D's own real-world nesting/layout entry — the actual Length x Width of
  // the laser-cutting layout for one unit (each independently unit-picked,
  // e.g. cm/inch — mm is the base, same convention as Fabrication Master's
  // own dimension fields, see fabricationCategories.js's sheet_plate
  // category). This may legitimately exceed requiredAreaMm2 (kerf, margins,
  // non-tiling part shapes are real) — area is never entered directly, only
  // ever derived from these two dimensions, server-side.
  plannedLengthValue: { type: Number, required: true, min: 0 },
  plannedLengthUnit: { type: String, required: true },
  plannedWidthValue: { type: Number, required: true, min: 0 },
  plannedWidthUnit: { type: String, required: true },
  plannedAreaMm2: { type: Number, required: true }, // = plannedLength(mm) x plannedWidth(mm), server-computed
  // Snapshot of the catalog variant's own one-sheet area (mm²) at plan-save
  // time — stays stable even if the Item's catalog dimensions are edited later.
  sheetAreaMm2: { type: Number, required: true },
  // Math.ceil(plannedAreaMm2 / sheetAreaMm2) — whole sheets needed per ONE unit.
  sheetsNeededPerUnit: { type: Number, required: true, min: 1 },
  // Advisory only (per the client's explicit resolution) — plannedAreaMm2 <
  // requiredAreaMm2 at last save. Never blocks save or BOM lock.
  warningBelowRequired: { type: Boolean, default: false },
  laserFileUrl: { type: String, default: '' },
  laserFileName: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

SheetMetalPlanSchema.index({ bom: 1, itemCode: 1, dimensionVariantId: 1 }, { unique: true });

export default mongoose.model('SheetMetalPlan', SheetMetalPlanSchema);
