import mongoose from 'mongoose';

// Shared by all three BOM levels (Sub Child Part, Child Part, Machine — see
// server/docs/process-inhouse-outsource-redesign-discussion-2026-09.md).
// Schema-only module (no mongoose.model() call here) — Inventory.js,
// ChildPartBOM.js, and MachineBOM.js all import these directly rather than
// one importing from another (Inventory.js is foundational; ChildPartBOM.js
// already depends on it, so the reverse would be backwards).
//
// Two-tier structure: a category (top-level label, e.g. "Fabrication") gates
// its own internal processes — every internal process in a category
// completes before the next category starts. Ordering at both levels is
// array position, not a stored number — same convention this codebase
// already uses for ProductionOrder.js's own hardcoded step arrays
// (PROCESS_STEPS/SUB_CHILD_PART_STEPS/MACHINE_BOM_STEPS), so order can never
// drift from an explicit sequence field that duplicates it.

// One internal process (leaf) — independently typed In-House/Out Source.
//
// materialRefs/materialSource apply to ANY internal process now (2026-09-23
// — originally built Out-Source-only, generalized once the gap surfaced: an
// In-House step had no material association at all, so Production's
// "material issued before you can assign a team/start" gate — hardcoded to
// literal legacy step names ('Job Work'/'Assembly') — silently never fired
// for a dynamic order. See the discussion doc's "In-House material
// consumption gap" section for the full reasoning): ids pointing at entries
// in the BOM's OWN lines (Child Part/Machine only — Sub Child Part has no
// lines of its own, its one sourceItem is the implicit material) — both the
// flat materials[]/tools lines AND the assembly reference lines (a Child
// Part's subChildParts[], a Machine's childParts[]), since either can be
// what a step consumes (or, for an Out Source step, what's physically sent
// to a vendor). A pure reference into quantities the app already computes
// correctly — never a re-derivation.
//
// materialSource says WHETHER this step also/only ships the assembled
// sub-build so far, confirmed with the user 2026-09-22: a step isn't
// guaranteed to be downstream of the step before it (two categories can
// build separate things that only meet at a later "Assembly" category), so
// this is a per-step choice, not inferred from position — except the very
// first internal process overall, which has nothing built yet to hand off
// and is always 'ExplicitMaterials' (enforced server-side in
// cleanProcessDefinition, not just left to the UI).
// 'AssembledPart' and materialRefs are NOT mutually exclusive (corrected
// 2026-09-23 — they used to be, materialRefs got cleared on switching to
// 'AssembledPart'; a step can genuinely need both, e.g. a bracket fastened
// onto an already-assembled frame). materialRefs empty + 'AssembledPart' ==
// this step ships whatever exists at that point in the build, no additional
// pick needed. An assembly-reference id (subChildParts[]/childParts[], never
// a plain material/tool line) can only ever appear in ONE step's
// materialRefs across the whole definition — once picked, it's consumed,
// unavailable to every later step (validated in processDefinitionValidation.js,
// enforced live in the UI by walking the definition in order) — deliberately
// NOT a "once AssembledPart appears nothing later can be ExplicitMaterials"
// rule, since that would wrongly block the two-independent-categories case.
//
// materialQuantities is sparse — populated ONLY for a materialRefs id that's
// actually split across more than one step (confirmed with the user
// 2026-09-23, worked example: a BOM line of 4 nut-bolts, 2 consumed at one
// step and 2 at a later one). A ref picked by exactly one step needs no
// entry here at all — that step implicitly gets the line's whole BOM
// quantity, identical to today's zero-extra-input behavior. The sum of
// every materialQuantities entry across every step referencing the same
// line can never exceed that line's own BOM quantity (validated
// server-side) — an allocation of an already-computed number, never a new
// calculation.
//
// qcRequired marks this internal process as the ONE QC checkpoint for the
// whole order — confirmed with the user 2026-09-22: not "mandatory final
// gate plus optional extras", exactly one checkpoint per order, wherever
// R&D flags it, reusing whichever single checklist structure that level
// already has (Sub Child Part's flat checklist, Child Part's initial+process
// combo, Machine's final checklist). Steps after the flagged one get no
// further QC review. Meaningless for Sub Child Part (its rule is simply
// "always the last step", not a per-BOM choice — the UI never shows this
// toggle there) — validated as exactly-one-flagged for Child Part/Machine
// only (see processDefinitionValidation.js).
const InternalProcessSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['InHouse', 'OutSource'], required: true },
  materialSource: { type: String, enum: ['ExplicitMaterials', 'AssembledPart'], default: 'ExplicitMaterials' },
  materialRefs: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  materialQuantities: {
    type: [{ ref: { type: mongoose.Schema.Types.ObjectId, required: true }, qty: { type: Number, required: true } }],
    default: [],
  },
  qcRequired: { type: Boolean, default: false },
}, { _id: true, timestamps: false });

const ProcessCategorySchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true },
  internalProcesses: { type: [InternalProcessSchema], default: [] },
}, { _id: true, timestamps: false });

export { ProcessCategorySchema, InternalProcessSchema };
