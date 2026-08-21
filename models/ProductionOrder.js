import mongoose from 'mongoose';

const PROCESS_STEPS = ['Job Work', 'Fabrication', 'Assembly', 'Painting', 'Re-Assembly', 'Final Testing'];
const PROCESS_TYPE_MAP = {
  'Job Work': 'Outsourcing',
  'Fabrication': 'In-House',
  'Assembly': 'In-House',
  'Painting': 'In-House',
  'Re-Assembly': 'In-House',
  'Final Testing': 'In-House',
};

const ReworkSchema = new mongoose.Schema({
  date: { type: String, default: null },
  reason: { type: String, default: '' },
  rejectedBy: { type: String, default: '' },
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

// Builds a fresh set of process steps — same shape used both for the
// top-level `processes` default (Unit 1) and for each entry in `extraUnits`
// (Units 2..N of a multi-quantity order).
function buildProcessSteps() {
  return PROCESS_STEPS.map(step => ({
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
  unitPrice: { type: Number, default: null },
  bomQuantity: { type: Number, default: null },
  quantity: { type: Number, required: true, min: 0 },

  // ── NEW: 2-Step Fulfillment Tracking ──
  returnPendingQuantity: { type: Number, default: 0, min: 0 },
  transferredQuantity: { type: Number, default: 0, min: 0 }, // Store sent it
  issuedQuantity: { type: Number, default: 0, min: 0 },      // Production received it

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
    enum: ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Completed'],
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
  // NEW: Store the snapshot of the design URLs
  designDocuments: [{
    name: { type: String },
    fileUrl: { type: String },
    version: { type: String }
  }],
}, { timestamps: true });

ProductionOrderSchema.index({ company: 1, status: 1 });
ProductionOrderSchema.index({ company: 1, priority: 1 });
ProductionOrderSchema.index({ company: 1, createdAt: -1 });

export { PROCESS_STEPS, PROCESS_TYPE_MAP, buildProcessSteps };
export default mongoose.model('ProductionOrder', ProductionOrderSchema);
