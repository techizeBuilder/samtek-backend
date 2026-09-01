import mongoose from 'mongoose';

// One entry per physical catalog sheet actually purchased for this plan —
// e.g. sheet 1 uses the full catalog size, sheet 2 (added separately) is a
// second whole sheet bought just to cut a much smaller remaining piece from.
// sheetsNeededPerUnit is simply this array's length now — no longer a
// division-derived guess assuming everything tiles evenly across identical
// sheets (see the 2026-08-29 follow-on in sheet-metal-bom-planning.md).
const SheetEntrySchema = new mongoose.Schema({
  lengthValue: { type: Number, required: true, min: 0 },
  lengthUnit: { type: String, required: true },
  widthValue: { type: Number, required: true, min: 0 },
  widthUnit: { type: String, required: true },
});

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
  // R&D's own real-world nesting/layout entry — one array entry per physical
  // sheet actually purchased, each with its own Length x Width (how much of
  // THAT sheet gets used — never entered as a raw area, always derived
  // server-side same as before). A single entry's own dimensions can never
  // exceed the catalog sheet's own size (checked server-side, either
  // orientation) — it represents one real sheet, not a combined layout.
  sheets: { type: [SheetEntrySchema], required: true },
  // Sum of every entry's own length(mm) x width(mm), server-computed.
  plannedAreaMm2: { type: Number, required: true },
  // Snapshot of the catalog variant's own one-sheet area (mm²) at plan-save
  // time — stays stable even if the Item's catalog dimensions are edited later.
  sheetAreaMm2: { type: Number, required: true },
  // sheets.length — a direct count of the physical sheets R&D actually
  // added, not a division-derived ceiling.
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
