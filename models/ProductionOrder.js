import mongoose from 'mongoose';
import { releaseReservationsForOrder } from '../services/materialReservationService.js';
import { StepOperationSchema } from './ProcessDefinitionSchema.js';

const PROCESS_STEPS = ['Job Work', 'Fabrication', 'Assembly', 'Painting', 'Re-Assembly', 'Final Testing'];
// Child Part's own pipeline shape — Job Work dropped (2026-09-16): a Sub
// Child Part is now independently stocked/replenished by its own order flow,
// so Child Part just receives already-stocked Sub Child Part units from
// Store like any other material category, the same way it already receives
// Raw Material/Tool (see server/docs/bom-hierarchy-redesign-2026-09.md §4).
// QC now sits between Assembly and Painting instead of at the very end —
// see productionMfgController.js's per-unit QCJob.unitChecks[] flow
// (QCJob.js), not a processes[] step of its own.
const SUB_CHILD_PART_STEPS = ['Fabrication', 'Assembly', 'Painting'];
// A Machine order whose Item has a real MachineBOM (the new hierarchy) —
// its Child Parts are each already built, painted, and QC'd on their own
// independent pipeline (SUB_CHILD_PART_STEPS above) before ever being
// issued to this order, so there's nothing left to fabricate/paint/
// re-assemble in-house here; the order is just "assemble the already-
// finished pieces, then test the whole machine" (confirmed with the user
// 2026-09-17). Which shape a given order actually gets is decided once,
// at creation time, by whether its target Item has a MachineBOM — see
// machineReorderService.js's resolveMachineOrderProcesses; this constant
// can NEVER be reached via the bare orderKind-keyed stepsForKind/
// buildProcessSteps below, since both old-RDBOM and new-MachineBOM
// machines share the same orderKind:'Machine'.
const MACHINE_BOM_STEPS = ['Assembly', 'Final Testing'];
const PROCESS_TYPE_MAP = {
  'Job Work': 'Outsourcing',
  'Fabrication': 'In-House',
  'Assembly': 'In-House',
  'Painting': 'In-House',
  'Re-Assembly': 'In-House',
  'Final Testing': 'In-House',
};
const stepsForKind = (orderKind) => orderKind === 'ChildPart' ? SUB_CHILD_PART_STEPS : PROCESS_STEPS;

const ReworkSchema = new mongoose.Schema({
  date: { type: String, default: null },
  reason: { type: String, default: '' },
  rejectedBy: { type: String, default: '' },
  // QC's photos of what it rejected (urls) and the failed checks' names +
  // remarks (2026-10-30) — Production sees why next to the reason.
  photos: { type: [String], default: [] },
  failedChecks: { type: [String], default: [] },
}, { _id: false });

const SubEntrySchema = new mongoose.Schema({
  parentPart: { type: String, required: true },
  childPart: { type: String, required: true },
  assignedMember: { type: String, required: true },
  fabricationType: { type: String, default: 'Other' },
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  qcStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  reworks: { type: [ReworkSchema], default: [] },
  createdAt: { type: Date, default: Date.now }
});

const ProcessStepSchema = new mongoose.Schema({
  step: { type: String, required: true },
  type: { type: String, enum: ['Outsourcing', 'In-House'], required: true },
  // ── Phase 2 (dynamic Process Definition execution) additions — see
  // server/docs/process-inhouse-outsource-redesign-discussion-2026-09.md
  // and server/services/processStepBuilderService.js, which is the only
  // place that ever sets these at order-creation time. All five stay at
  // their defaults for any step built the OLD hardcoded way (a machine with
  // no MachineBOM yet still falls back to buildProcessSteps('Machine')) —
  // nothing downstream may assume they're populated.
  category: { type: String, default: '' },
  materialSource: { type: String, enum: ['ExplicitMaterials', 'AssembledPart'], default: 'ExplicitMaterials' },
  materialRefs: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  // Sparse — only populated for a materialRefs id actually split across more
  // than one step of the BOM's own Process Definition (2026-09-23, mirrors
  // InternalProcessSchema.materialQuantities exactly — see that field's own
  // comment in ProcessDefinitionSchema.js for the full reasoning).
  materialQuantities: {
    type: [{ ref: { type: mongoose.Schema.Types.ObjectId }, qty: { type: Number } }],
    default: [],
  },
  qcRequired: { type: Boolean, default: false },
  // Machine only — snapshot of the BOM step's Final QC flag (QC multi-
  // checkpoint redesign, 2026-09-25). Carried onto orders now; read from
  // slice 2 of that redesign onward.
  finalQc: { type: Boolean, default: false },
  // Operations per piece (2026-10-22, outsource "per job work" pricing) —
  // snapshot of the BOM step's own, so a later BOM edit doesn't change it.
  operation: { type: StepOperationSchema, default: null },
  // Only meaningful when type === 'Outsourcing' — drives the "waiting on
  // outsource" vs "send for outsourcing" UI (ProcessExecution.jsx, Stage 5).
  // Advanced by outsourceWorkController.js (Stage 3), never by the generic
  // assignTeam/startProcess/markProcessComplete path an In-House step uses.
  outsourceStatus: { type: String, enum: ['NotStarted', 'AwaitingRequest', 'Requested', 'Sent', 'Received'], default: 'NotStarted' },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'QC Pending', 'Completed'],
    default: 'Pending',
  },
  assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionTeam', default: null },
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  // Precise timestamps alongside the display-only date strings above — used
  // only by the delivery-date estimator's lead-time measurement
  // (recordLeadTimeSample in approveQC), which needs real sub-day precision.
  // startDate/endDate stay plain YYYY-MM-DD strings for existing UI display.
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  qcStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  qcBy: { type: String, default: null },
  qcDate: { type: String, default: null },
  notes: { type: String, default: '' },
  reworks: { type: [ReworkSchema], default: [] },
  subEntries: { type: [SubEntrySchema], default: [] },
}, { _id: false });

// One Production-initiated (or, for Sub Child Part's auto-routed first
// step, cron-initiated) hand-off to Purchase, covering one-or-more
// CONSECUTIVE Out Source internal processes (see
// processStepBuilderService.js's groupConsecutiveOutSourceRuns) — the
// generalized, multi-BOM-level counterpart to SubChildPartJobWorkOrder's
// own rounds mechanic, reused here rather than redesigned (field names/
// shapes intentionally mirror SubChildPartJobWorkOrder.js's rawMaterial/
// rounds blocks). QC is deliberately NOT tracked here — it's tied to
// whichever single processes[] entry has qcRequired:true, independent of
// hand-off completion (see productionMfgController.js's QC wiring, Stage 3b).
const OutsourceHandoffRoundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true },
  // Internal process names (from this hand-off's own stepIndices) this
  // round physically covers — no per-round quantity, mirrors
  // SubChildPartJobWorkRoundSchema.jobWorkTypes exactly, just renamed since
  // these are named process steps now, not job-work-type strings.
  coveredSteps: { type: [String], required: true },
  // 'Ordered' (outsource-v2 slice 2, 2026-10-20): an Outsource Order claimed
  // this trip — the steps are taken, nothing has gone out yet. Then Sent
  // (out to the vendor) → Received.
  status: { type: String, enum: ['Ordered', 'Sent', 'Received'], default: 'Sent' },
  sentAt: { type: Date, default: Date.now },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receivedAt: { type: Date, default: null },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  notes: { type: String, default: '' },
  // The Outsource Order (and its line) this trip belongs to — null for a
  // round sent before slice 2.
  outsourceOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'OutsourceOrder', default: null },
  lineId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { _id: true });

const OutsourceHandoffSchema = new mongoose.Schema({
  // The fixed SET of units this hand-off covers, decided once at creation
  // (2026-09-25 — see the discussion doc's "Multi-unit outsource handoff
  // batching" section) — a hand-off is atomic once created, no partial
  // completion inside one; sending more units later is a brand new hand-off,
  // never an addition to this array. Each entry: 0 = the order's top-level
  // `processes` (Unit 1); N>=1 = extraUnits[N-1] — same unit-indexing
  // convention outsourceWorkController.js's own resolveUnitProcesses and
  // productionMfgController.js's getUnitProcesses already use elsewhere in
  // this file's own controllers. Every unit in the set must sit at the exact
  // same stepIndices run (validated at request time) — batching is keyed on
  // matching step INDEX, not step name, since a reworked unit could diverge.
  unitIndices: { type: [Number], required: true },
  // Indices into that unit's own processes[] array this hand-off covers —
  // always a contiguous run (see groupConsecutiveOutSourceRuns).
  stepIndices: { type: [Number], required: true },
  // Snapshot of the covered internal process names, so the UI/rounds can
  // display without re-resolving indices against a possibly-since-reordered
  // BOM (a Process Definition can be edited after an order's already built
  // from it — this hand-off's own step list must stay exactly what was
  // true when it was created).
  stepNames: { type: [String], default: [] },
  // True only when stepIndices includes index 0 — a step-position property,
  // not a which-unit-is-included property (2026-09-25 — a batched hand-off
  // can cover several units, so this is true whenever the run starts at the
  // pipeline's true first step, regardless of which unit(s) are in it).
  // Decides which material-resolution case applies (Stage 3): a first-step
  // hand-off pulls fresh from Store (reusing Sub Child Part's own resolution logic);
  // every other hand-off is a pure status/tracking action against material
  // Production already issued to itself — see this plan's own Stage 3 note
  // on why no new reservation-ledger work is needed for that second case.
  isFirstStepOfOrder: { type: Boolean, default: false },
  status: { type: String, enum: ['AwaitingRequest', 'Requested', 'InProgress', 'Completed'], default: 'AwaitingRequest' },
  requestedAt: { type: Date, default: null },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Made by the system, not Production's click (2026-10-22): the order's
  // first step, or the next run while the units wait at Store.
  autoRequested: { type: Boolean, default: false },
  // Only ever populated for a first-step-of-order hand-off — stays entirely
  // unset for every other case, since nothing is sourced fresh from Store
  // there. Same shape as SubChildPartJobWorkOrder.rawMaterial, reused as-is.
  rawMaterial: {
    sourceItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
    neededQty: { type: Number, default: null },
    unit: { type: String, default: null },
    availableQty: { type: Number, default: null },
    shortfallQty: { type: Number, default: 0 },
    purchaseRequestId: { type: String, default: null },
    checkedAt: { type: Date, default: null },
    sentCase: { type: String, enum: [null, 'cut', 'whole'], default: null },
    sentDimensionVariantId: { type: String, default: null },
    sentLeftoverUsedVariantId: { type: String, default: null },
    sentAt: { type: Date, default: null },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    leftoverCaptured: { type: Boolean, default: false },
    leftoverValues: { type: mongoose.Schema.Types.Mixed, default: null },
    // Testing bridge (2026-09-23, see the discussion doc's "First-step
    // outsource material send" section) — true whenever this first-step
    // hand-off was sent WITHOUT the real Logistics/vendor handshake in
    // place: whatever's recorded above (sentCase/sentDimensionVariantId/
    // etc., if Purchase chose to fill them in — entirely optional here) is
    // informational only and was never applied against real Store
    // inventory. Lets a later pass tell a dummy send apart from a real one
    // once the actual Store-deduction build lands.
    // LEGACY since outsource-v2 slice 8 (2026-10-21): never set true any more
    // (every send goes through Dispatch with Store's real handover); still
    // read so an old dummy send isn't asked for a leftover at its receive.
    dummy: { type: Boolean, default: false },
  },
  rounds: { type: [OutsourceHandoffRoundSchema], default: [] },
  // QC multi-checkpoint redesign, slice 3 (2026-09-26) — Sub Child Part
  // only. null means "covers the whole order" (every existing hand-off, and
  // every normal first-time send of a QC-flagged step). Set to a number
  // only when this hand-off is a REWORK RESEND for a Sub Child Part step
  // QC already partially decided on: the exact reworkPendingQty QC set,
  // snapshotted once at request time (outsourceWorkController.js's
  // requestOutsourceHandoff) — never typed by Purchase or Production, same
  // "never typed" convention submitBatchQcStep already uses for the
  // in-house side. Read back on receive (receiveOutsourceHandoffRound) as
  // the new attempt's qtySubmitted.
  subChildPartQty: { type: Number, default: null },
  // What Purchase actually paid the vendor for this hand-off — captured on
  // the completing round. Independent of QC (see this schema's own header
  // comment).
  costTotal: { type: Number, default: null },
  notes: { type: String, default: '' },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

// Shapes a plain list of step names into the real ProcessStepSchema-matching
// objects every processes[]/extraUnits[].processes array is built from —
// shared by buildProcessSteps below (orderKind-keyed shapes only) and by
// resolveMachineOrderProcesses (machineReorderService.js), which needs the
// MACHINE_BOM_STEPS shape and can't go through buildProcessSteps at all
// (that function takes orderKind, not an arbitrary step list, and
// MACHINE_BOM_STEPS isn't reachable from any orderKind value).
function buildStepsFromList(stepNames) {
  return stepNames.map(step => ({
    step,
    type: PROCESS_TYPE_MAP[step],
    status: 'Pending',
    assignedTeam: null,
    startDate: null,
    endDate: null,
    startedAt: null,
    completedAt: null,
    qcStatus: 'Pending',
    qcBy: null,
    qcDate: null,
    notes: '',
    reworks: [],
    subEntries: [],
  }));
}

// Builds a fresh set of process steps — same shape used both for the
// top-level `processes` default (Unit 1) and for each entry in `extraUnits`
// (Units 2..N of a multi-quantity order). Pass orderKind === 'ChildPart'
// to get the trimmed Job Work → Fabrication → Assembly → Painting pipeline
// (no Re-Assembly / Final Testing — there's no machine to re-assemble). The
// no-arg call keeps the full 6-step machine pipeline, so it stays valid as
// a bare Mongoose `default` for the machine case. Does NOT know about
// MACHINE_BOM_STEPS — that shape depends on a specific Item's MachineBOM,
// not orderKind alone, so it's never reachable here; every MachineBOM-driven
// order gets its processes[] built explicitly at creation time instead (see
// machineReorderService.js's resolveMachineOrderProcesses + buildStepsFromList
// above).
function buildProcessSteps(orderKind) {
  return buildStepsFromList(stepsForKind(orderKind));
}

// One extra physical unit's process pipeline, for orders with orderQuantity
// > 1. Unit 1 always lives in the top-level `processes` field below — this
// keeps every existing single-quantity order (the overwhelming majority)
// byte-for-byte unaffected by the multi-unit feature. Units 2..N are stored
// here, index 0 = Unit 2, index 1 = Unit 3, etc., and are created lazily by
// the controller the first time that unit's process tab is actually used.
const ExtraUnitSchema = new mongoose.Schema({
  processes: { type: [ProcessStepSchema], default: buildProcessSteps },
}, { _id: false });

const MaterialDemandSchema = new mongoose.Schema({
  // For a fabrication material (see fabricationCategory below), this is a
  // synthetic per-cut-unique key (`${itemCode}#${dimensionSignature}`), NOT
  // a real Inventory code — see rdController.js's processRDRequest, which
  // merges BOM lines by this exact key so two different cuts of the same
  // raw material never collapse into one demand entry. Every other place
  // that finds/updates a demand by materialCode (Store issue/transfer/
  // return, Add Demand) treats it as an opaque unique string, so this needs
  // no changes there. sourceItemCode below is the real Inventory code.
  materialCode: { type: String, required: true, trim: true },
  materialName: { type: String, required: true, trim: true },
  // The real Inventory Item code — equal to materialCode for every
  // non-fabrication demand (no behavior difference there). Only diverges
  // from materialCode for fabrication lines, where materialCode is the
  // synthetic per-cut key above. Wherever the real Item actually needs
  // resolving (Store transfer/return, Purchase Request creation), this is
  // the field to use — NOT YET WIRED into those (still keyed off
  // materialCode directly as of this field's introduction; that's the next
  // phase of this work, not this one).
  sourceItemCode: { type: String, default: null, trim: true },
  // Fabrication Master materials only (see RDBOM.MaterialSchema's matching
  // fields, which these mirror) — this demand line's own committed cut
  // dimensions/weight, so Production/Store can see what to prepare without
  // a round-trip to R&D. Empty/null for every non-fabrication demand.
  bomDimensions: { type: mongoose.Schema.Types.Mixed, default: {} },
  fabricationCategory: { type: String, default: '' },
  computedWeightPerPieceKg: { type: Number, default: null },
  // Fabrication Master materials only — which catalog
  // Item.dimensionVariants[] entry this demand line was cut from.
  dimensionVariantId: { type: String, default: null },
  // amountValue/amountUnit: the single amount consumed per piece (a length,
  // or an area for sheets) — for fabrication, what bomDimensions above was
  // synthesized from; for a non-fabrication material whose Used Unit is
  // Length/Area/Volume (mirrors RDBOM.MaterialSchema's matching fields —
  // see UnitAmountField.jsx), the same concept without a dimensionVariant.
  // Lets Production/Store show "Amount × Quantity" instead of a bare
  // quantity that can't say "2 pieces of 1m length each". Null/'' for a
  // Mass/Count-unit material, where quantity alone is already unambiguous.
  amountValue: { type: Number, default: null },
  amountUnit: { type: String, default: null },
  // Set only for a Sheet Metal plan-driven demand (see SheetMetalPlan.js) —
  // lets Store's transfer screen and Production's demand list tell a
  // flat-N-sheets plan demand apart from a normal per-cut fabrication demand
  // without re-deriving it. quantity/unit above are already "N Pieces" of
  // the catalog sheet size for these; bomDimensions stays {} since there's
  // no per-cut sizing left to track once a plan exists.
  sheetMetalPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'SheetMetalPlan', default: null },
  unitPrice: { type: Number, default: null },
  bomQuantity: { type: Number, default: null },
  quantity: { type: Number, required: true, min: 0 },

  // ── NEW: 2-Step Fulfillment Tracking ──
  returnPendingQuantity: { type: Number, default: 0, min: 0 },
  transferredQuantity: { type: Number, default: 0, min: 0 }, // Store sent it
  issuedQuantity: { type: Number, default: 0, min: 0 },      // Production received it
  // How much of what was received has been used up so far. Committed when a
  // step using it starts, or when its vendor trip goes out (issuedQuantity −
  // consumedQuantity − returnPendingQuantity is "still on the floor"); a QC
  // rejection does NOT release it (Production reworks with what's there). Stays
  // 0 on a Sub Child Part batch order, whose source material isn't a step line.
  consumedQuantity: { type: Number, default: 0, min: 0 },
  // Part of quantity / transferred / issued that came straight from this
  // order's own cascade order (serial number work step 1) — not from Store.
  cascadeDeliveredQuantity: { type: Number, default: 0, min: 0 },
  // Store's own free-text entry at transfer time — who they physically
  // handed the material to (mirrors ProcessStepSchema.qcBy's pattern: plain
  // typed text, not a User ref, since the recipient may be a floor worker
  // with no login). Overwritten on each subsequent transfer of the same
  // demand, so only the most recent issuer survives — acceptable since a
  // demand is normally transferred in one shot.
  issuedToName: { type: String, default: null, trim: true },

  unit: { type: String, required: true },
  status: {
    type: String,
    // Added 'In Transit'
    enum: ['Pending R&D', 'Requested', 'In Transit', 'Issued', 'Pending Purchase', 'R&D Rejected', 'Pending Return'],
    default: 'Pending R&D',
  },
});

const ProductionOrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  // The real sales Order's orderCode (e.g. "ORD-0066") this run was generated
  // from — resolved via saleId → Sale.order at creation time. Null for
  // manually-created/Stock entries that aren't tied to a customer order.
  orderCode: { type: String, default: null, trim: true },
  // 'Machine' (default, every existing order) vs 'ChildPart' — a Child
  // Part item's own stock-replenishment build, raised automatically when
  // its stock hits Min Stock (see childPartReorderService.js), never tied
  // to a customer order. For a
  // SubChildPart order, machineCode/machineName below hold the SUB CHILD
  // PART's own code/name (not a real machine) — kept on the same fields
  // rather than adding parallel ones, so every existing process-step/QC/
  // material-demand mechanism keeps working unchanged; subChildPartItem is
  // the actual Item reference wherever code needs to tell the two apart or
  // resolve the real Inventory record.
  //
  // 'SubChildPart' — despite the name overlap with the (renamed) 'ChildPart'
  // kind above, this is the real, new, LOWEST hierarchy level
  // (Item.subChildPartDetails, productKind:'SubChildPart'), raised by
  // subChildPartOrderService.js (a separate cron from the ChildPart one).
  // Same machineCode/machineName/subChildPartItem reuse as ChildPart, but a
  // deliberately simpler single-order-level flow — no ProcessStepSchema
  // steps (processes stays []), see assignedTeam/subChildPartJobWorkTypes/
  // startedAt/completedAt below instead.
  orderKind: { type: String, enum: ['Machine', 'ChildPart', 'SubChildPart'], default: 'Machine' },
  subChildPartItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  machineCode: { type: String, required: true, trim: true },
  machineName: { type: String, required: true, trim: true },
  priority: { type: String, enum: ['Urgent', 'Normal'], default: 'Normal' },
  source: {
    type: String,
    enum: ['Store', 'QC_Rejected', 'Stock'],
    default: 'Store'
  },
  // purpose field removed — use 'source' to distinguish:
  //   'Store' / 'QC_Rejected' = order-triggered → dispatch after QC
  //   'Stock'                 = company stock production → inventory after QC
  rejectionDetails: {
    originalOrderId: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    rejectedDate: { type: String, default: null },
    qcJobId: { type: String, default: null }
  },
  // Only meaningful for source: 'QC_Rejected' orders. Newly-created rejected
  // orders sit at 'Pending' (BOM/R&D verification hidden in the UI) until
  // Production explicitly chooses Rework (full rebuild — normal pipeline
  // unlocked) or Repair (routed to the separate Repair Production module).
  reworkDecision: { type: String, enum: ['Pending', 'Rework', 'Repair'], default: 'Pending' },
  repair: {
    status: { type: String, enum: ['Pending', 'In Progress', 'Completed'], default: 'Pending' },
    assignedTo: { type: String, default: '' },
    notes: { type: String, default: '' },
    completedAt: { type: Date, default: null },
  },
  status: {
    type: String,
    // 'Pending QC' — orderKind:'SubChildPart' only, once Submit to QC has been
    // pressed (see subChildPartOrderMfgController.js) — the in-house build is
    // done and awaiting QC's Approve/Reject, stock not yet credited.
    enum: ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Pending QC', 'Completed'],
    default: 'Pending',
  },
  receivedDate: { type: String, required: true },
  deliveryDate: { type: String, required: true },
  bomVerified: { type: Boolean, default: false },
  designVerified: { type: Boolean, default: false },
  rdRequestRaised: { type: Boolean, default: false },
  materialIssued: { type: Boolean, default: false },
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  // Which specific Sale item (Sale.items._id) this run produces — one
  // Production Order per order item. Null for Stock/legacy runs.
  saleItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // How many units of the machine this run must produce (the order item's
  // qty). R&D BOM stays per-unit; material demand = bomQuantity × orderQuantity.
  orderQuantity: { type: Number, default: 1, min: 1 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notes: { type: String, default: '' },
  processes: {
    type: [ProcessStepSchema], default: buildProcessSteps
  },
  materialDemands: { type: [MaterialDemandSchema], default: [] },
  // Units 2..N of this order's process pipeline — see ExtraUnitSchema above.
  // Stays empty for orderQuantity === 1 orders.
  extraUnits: { type: [ExtraUnitSchema], default: [] },
  // Phase 2 — one entry per Production-initiated hand-off to Purchase for a
  // run of consecutive Out Source steps (see OutsourceHandoffSchema above).
  // Stays empty for an order with no Out Source steps at all, and for a
  // pure-Out-Source Sub Child Part order (that case still uses
  // SubChildPartJobWorkOrder entirely, untouched — see the Phase 2 plan's
  // own "Architecture decision" section).
  outsourceHandoffs: { type: [OutsourceHandoffSchema], default: [] },
  // outsource-v2 slice 7 (2026-10-21, R2/R4/T8): a unit's outsourced work that
  // Store received and still holds — until Store hands it to Production (next
  // step in-house) or to Dispatch (next step outsourced / a rework). While a
  // unit is here, Production can't give its next step to a team.
  // unitIndex: 0 = unit 1 (a Sub Child Part batch is always 0).
  workAtStore: {
    type: [{
      unitIndex: { type: Number, required: true },
      handoffId: { type: mongoose.Schema.Types.ObjectId, default: null },
      roundId: { type: mongoose.Schema.Types.ObjectId, default: null },
      outsourceOrderNo: { type: String, default: '' },
      since: { type: Date, default: Date.now },
    }],
    default: [],
  },
  workHandovers: {
    type: [{
      unitIndex: { type: Number, required: true },
      to: { type: String, enum: ['Production', 'Dispatch'], required: true },
      at: { type: Date, default: Date.now },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      byName: { type: String, default: '' },
      note: { type: String, default: '' },
    }],
    default: [],
  },
  // Outsource v2 slice 4 (2026-10-24): each unit's build cost (a Sub Child
  // Part batch is unitIndex 0). Production types its own cost / expense at
  // the unit's LAST IN-HOUSE step; the outsourced money is read from the
  // Outsource Orders. All three go to the BOM once, when the true last step
  // finishes (partCostService.pushPartCost) — again if a late time / QC
  // pass changes the outsourced money.
  unitCosts: {
    type: [{
      unitIndex: { type: Number, required: true },
      productionCost: { type: Number, default: null },
      productionExpense: { type: Number, default: null },
      enteredAt: { type: Date, default: null },
      enteredBy: { type: String, default: '' },
      finishedAt: { type: Date, default: null },
      finishedQty: { type: Number, default: null },
      jobWorkCost: { type: Number, default: null },
      waitingFor: { type: [String], default: [] },
      pushedAt: { type: Date, default: null },
    }],
    default: [],
  },
  // NEW: Store the snapshot of the design URLs
  designDocuments: [{
    name: { type: String },
    fileUrl: { type: String },
    version: { type: String }
  }],
  // ── orderKind: 'SubChildPart' only (single order-level flow, no
  // per-step ProcessStepSchema tracking — see orderKind's own comment
  // above). Left null/empty and never touched for 'Machine'/'ChildPart'.
  assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionTeam', default: null },
  // Informational snapshot of item.subChildPartDetails.jobWorkTypes at
  // creation time — displayed on the order, never re-read from the Item and
  // never gates anything (no per-type tracking in this pass).
  subChildPartJobWorkTypes: { type: [String], default: [] },
  // Which trigger raised THIS order — 'LowStock' (this Sub Child Part's own
  // reorder-point cron), 'ChildPartCascade' (a Child Part order's own
  // cascade needing more of it than is on hand), or 'MachineCascade' (a
  // Machine order's own cascade — propagates through a Child Part order all
  // the way down to whatever Sub Child Part orders IT cascades too, see
  // childPartReorderService.js's checkSubChildPartMaterialAvailability, so a
  // Machine-triggered build chain stays independent from a cron-triggered
  // one at every tier, not just the first). See the identical field's
  // comment on SubChildPartJobWorkOrder.js for the full rationale — same
  // meaning, same dedup convention, just the In-House route's counterpart.
  demandSource: { type: String, enum: ['LowStock', 'ChildPartCascade', 'MachineCascade'], default: 'LowStock' },
  // Which SPECIFIC immediate-parent order asked for this cascade — the
  // Machine order for a Child Part order raised via demandSource:
  // 'MachineCascade', or the Child Part order for a Sub Child Part order
  // raised via 'ChildPartCascade'/'MachineCascade' — null for
  // demandSource:'LowStock' (the reorder cron has no parent order; it's
  // this Item's own generic restock trigger). Narrows dedup (see
  // createChildPartOrderForItem/createSubChildPartOrderForItem's
  // demandSourceMatch) from "one open order per demandSource TYPE" to "one
  // open order per demandSource type PER TRIGGERING ORDER" — two different
  // Machine orders needing the same Child Part are two different demands,
  // not one; without this, the second one's cascade was silently dropped
  // (confirmed bug, 2026-09-17).
  demandRefId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
  // Serial number work step 1 (2026-10-31, docs/serial number work/
  // cascade-to-parent-logic-2026-10.md): a cascade order raised under the new
  // rule delivers its finished parts STRAIGHT to its parent order (demandRefId)
  // instead of stock. False on every order made before — they still go to stock.
  deliverToParent: { type: Boolean, default: false },
  deliveredToParentQty: { type: Number, default: 0 },
  parentOrderNo: { type: String, default: '' }, // the parent's order number, for display
  // The parent side: per part this order's cascades build for it (the shortfall
  // after free stock), and how much has been delivered so far. Read by the
  // Material List (issue cap: only the stock part is issued by Store) and by
  // cascadeDeliveryService.
  cascadeCovers: {
    type: [{
      partItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
      partCode: String, partName: String, unit: String,
      qty: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      // The part's own last step is outsourced (or it's a job-work order): it
      // comes back through Store + QC, not from Production's floor (2 Nov review).
      viaStore: { type: Boolean, default: false },
      orders: [{ model: String, orderRef: mongoose.Schema.Types.ObjectId, orderNo: String, _id: false }],
      // atStore: this delivery waits at Store for the parent's outsourced step.
      deliveries: [{ orderNo: String, qty: Number, at: Date, by: String, atStore: Boolean, _id: false }],
      _id: false,
    }],
    default: [],
  },
  // Partial returns (2026-10-26 — docs/outsource-v2/partial-returns-2026-10.md):
  // pieces written off at an outsource vendor ("not coming" — lost, or kept by
  // the vendor). orderQuantity stays what was ordered; every "how many pieces"
  // place uses orderQuantity − these. stepIndex: the first step of the trip
  // they were lost on (a production order); onRework: lost on a rework resend
  // (already taken off the batch as scrap at that QC step).
  // Every piece was lost at the vendor, nothing left to build (2026-11-04,
  // docs/outsource-v2/all-lost-at-vendor-logic-2026-11.md): Completed with 0 made.
  closedAllLost: { type: Boolean, default: false },
  lostAtVendor: {
    type: [{
      qty: { type: Number, required: true },
      stepIndex: { type: Number, default: null },
      jobWorkTypes: { type: [String], default: undefined },
      handoffId: { type: mongoose.Schema.Types.ObjectId, default: null },
      onRework: { type: Boolean, default: false },
      reason: { type: String, default: '' },
      at: { type: Date, default: Date.now }, byName: { type: String, default: '' },
      outsourceOrderNo: { type: String, default: '' },
      replacementOrderId: { type: mongoose.Schema.Types.ObjectId, default: null },
      replacementOrderCode: { type: String, default: '' },
    }],
    default: undefined,
  },
  // A replacement for pieces lost at a vendor on another order (same demand).
  replacesLostOf: {
    orderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    orderCode: { type: String, default: '' },
    why: { type: String, default: '' }, // "Lost at the vendor" / "Scrapped at QC (laser cutting)"
  },
  // Replacement orders raised for this order's pieces that won't reach stock
  // (QC scrap / reject, 2026-10-27 — a lost-at-vendor one is on lostAtVendor).
  replacements: {
    type: [{
      qty: { type: Number, required: true }, why: { type: String, default: '' },
      orderId: { type: mongoose.Schema.Types.ObjectId, default: null }, orderCode: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
    default: undefined,
  },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

ProductionOrderSchema.index({ company: 1, status: 1 });
ProductionOrderSchema.index({ company: 1, priority: 1 });
ProductionOrderSchema.index({ company: 1, createdAt: -1 });

// Releases any MaterialReservation this order holds once it's genuinely
// done — schema-level so every current AND future path that flips
// status to 'Completed' (Sub Child Part's own completion, Child Part's
// per-unit Painting completion, Machine's own legacy completion path) is
// covered automatically, without hunting down and patching every
// controller that sets it. Idempotent (a no-op query) if this order never
// held a reservation, or already had one released — safe to fire on every
// save while status happens to already be 'Completed', not just the one
// save that transitions into it. A deliberately separate, narrower release
// path exists for deletion BEFORE completion — see storeFlowService.js's
// applyStoreDecisionToItem.
ProductionOrderSchema.post('save', async function (doc) {
  if (doc.status !== 'Completed') return;
  try {
    await releaseReservationsForOrder(doc._id);
  } catch (err) {
    console.error(`[ProductionOrder] Failed to release material reservations for ${doc.orderId}:`, err);
  }
});

export { PROCESS_STEPS, SUB_CHILD_PART_STEPS, MACHINE_BOM_STEPS, PROCESS_TYPE_MAP, buildProcessSteps, buildStepsFromList, stepsForKind };
export default mongoose.model('ProductionOrder', ProductionOrderSchema);
