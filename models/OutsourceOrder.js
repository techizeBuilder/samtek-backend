import mongoose from 'mongoose';

// Outsource Order (outsource-v2 slice 2, 2026-10-20 — server/docs/outsource-v2/
// slice-2-outsource-order-plan.md). Purchase picks outsource requests, then a
// vendor, and orders the next step(s) of each at a price per piece. No
// quotation: prices, GST and charges are typed here. Above the company's
// outsourceApprovalThreshold the Company Admin approves it first.
//
// A request is one of two existing records — how they arrive never changes:
//   - 'jobWork': a SubChildPartJobWorkOrder (a Sub Child Part with every
//     step Out Source — Purchase only)
//   - 'handoff': ProductionOrder.outsourceHandoffs[] (a hybrid Sub Child
//     Part's step 0, or a Child Part / Machine sent by Production)
// Each request on a line gets one round on its own record (status 'Ordered'
// when the order is made → Sent → Received), referencing this order + line.
// Nothing here writes to a production order directly — the round does, on
// that order's own steps (services/outsourceRequestService.js).

// Slice 5 (2026-10-20) — the material plan: per material line of the steps a
// request's trip covers, how much comes from Production and how much from
// Store (docs/outsource-v2/material-logic-2026-10.md; built by
// services/outsourceMaterialPlanService.js when the order is made).
//   kind: plain | parts | cutPieces | sheetArea (need in mm²) | length (a Sub
//         Child Part's source length, need in mm) | wip (the units / pieces)
//   demandKey: the production order's Material List key (null for a job-work
//         order, which has no Material List, and for wip)
//   storeShare: sheets / lengths booked to this row from the line's combined
//         Store material (sheetArea / length only)
const MaterialPlanRowSchema = new mongoose.Schema({
  kind: { type: String, enum: ['plain', 'parts', 'cutPieces', 'sheetArea', 'length', 'wip'], required: true },
  bomLineId: { type: String, default: null },
  demandKey: { type: String, default: null },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  itemCode: { type: String, default: '' },
  itemName: { type: String, default: '' },
  variantId: { type: String, default: null },
  unit: { type: String, default: '' },
  need: { type: Number, default: 0 },
  fromProduction: { type: Number, default: 0 },
  fromStore: { type: Number, default: 0 },
  // Of fromProduction: still being built by the parent's cascade order(s), so
  // Dispatch waits until it's delivered (serial number work, 2 Nov review).
  awaitingDelivery: { type: Number, default: 0 },
  awaitingOrders: { type: [String], default: undefined },
  pieceSize: { type: Number, default: null },      // one sheet's mm² / one length's mm
  planSheetsPerPc: { type: Number, default: null }, // a Sub Child Part's Sheet Plan ratio
  qty: { type: Number, default: 0 },                // the request's units / pieces
  storeShare: { type: Number, default: null },
}, { _id: false });

// A line's combined Store sheet / length material (M2): whole sheets / lengths
// for the total of its rows.
const CombinedMaterialSchema = new mongoose.Schema({
  kind: { type: String, enum: ['sheetArea', 'length'], required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  itemCode: { type: String, default: '' },
  itemName: { type: String, default: '' },
  variantId: { type: String, default: null },
  total: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  pieceSize: { type: Number, default: null },
  pieces: { type: Number, default: 0 },
  method: { type: String, enum: ['area', 'plan'], default: 'area' },
}, { _id: false });

const RequestRefSchema = new mongoose.Schema({
  kind: { type: String, enum: ['jobWork', 'handoff'], required: true },
  jobWorkOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SubChildPartJobWorkOrder', default: null },
  productionOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
  handoffId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // SCJW-… / ORD-… — for display.
  orderCode: { type: String, default: '' },
  // Hand-off only: this request's OWN step positions on its own order (never
  // matched by position across requests — workflow §4.4).
  stepIndices: { type: [Number], default: [] },
  qty: { type: Number, required: true, min: 0 },
  // The round this order claimed on that record.
  roundId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Mirrors the round: Ordered → Sent → Received; Released when the order is
  // rejected / cancelled before anything went out.
  status: { type: String, enum: ['Ordered', 'Sent', 'Received', 'Released'], default: 'Ordered' },
  // Slice 3 (2026-10-20) — the bill: the QC attempts this trip sent when it
  // was received (hand-off only; a job-work order is QC'd once, at its end),
  // and what was accepted (paid for) once QC decided them.
  receivedAt: { type: Date, default: null },
  qcAttempts: {
    type: [{
      unitNumber: { type: Number, default: null }, // null = a Sub Child Part batch
      category: { type: String, default: '' },
      stepName: { type: String, default: '' },
      attemptNumber: { type: Number, required: true },
    }],
    default: [],
  },
  acceptance: {
    decidedAt: { type: Date, default: null },
    acceptedQty: { type: Number, default: null },
    net: { type: Number, default: 0 },        // rate × accepted qty
    gst: { type: Number, default: 0 },
    rejectedQty: { type: Number, default: 0 },
    rejectedValue: { type: Number, default: 0 }, // incl. GST — taken off the bill
    // The parts already applied to the bill — 'all', or 'u1', 'u2'… for a
    // Child Part / Machine trip, where each unit is payable as it passes.
    appliedKeys: { type: [String], default: [] },
  },
  materialPlan: { type: [MaterialPlanRowSchema], default: undefined },
  // Slice 7 (2026-10-21) — the way back. vendorReady: the vendor called to
  // say it's done (T9). returnDispatch: the Dispatch trip bringing it back
  // (while live). collected: Dispatch's count at the vendor. short: the last
  // "fewer than sent" report (R1) — it waits for a later trip.
  vendorReady: { at: { type: Date, default: null }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, byName: { type: String, default: '' } },
  returnDispatch: { trip: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchTrip', default: null }, tripNo: { type: String, default: '' } },
  collected: { at: { type: Date, default: null }, byName: { type: String, default: '' }, count: { type: Number, default: null }, tripNo: { type: String, default: '' } },
  short: {
    at: { type: Date, default: null }, byName: { type: String, default: '' }, count: { type: Number, default: null },
    note: { type: String, default: '' }, from: { type: String, default: '' }, tripNo: { type: String, default: '' },
  },
  // Partial returns (2026-10-26 — docs/outsource-v2/partial-returns-2026-10.md).
  // Pieces (a Sub Child Part line) can come back in parts: each part taken
  // from the vendor is an arrival (Dispatch's collect, or Store's receive
  // when Store is first); Store's receive confirms it (receivedAt). The rest
  // stays with the vendor — qty − Σ arrivals − lostQty — and is collected on
  // a later trip. The request is received (QC, bill, next step) once, when
  // everything is back or written off.
  arrivals: {
    type: [{
      count: { type: Number, required: true },
      tripNo: { type: String, default: '' },
      via: { type: String, enum: ['Dispatch', 'Store'], default: 'Dispatch' },
      collectedAt: { type: Date, default: null }, collectedBy: { type: String, default: '' },
      receivedAt: { type: Date, default: null }, receivedBy: { type: String, default: '' },
    }],
    default: undefined,
  },
  // "Not coming" (lost / kept by the vendor) — Purchase or Store, with a reason.
  lostQty: { type: Number, default: 0 },
  lost: {
    type: [{
      at: { type: Date, default: Date.now }, qty: { type: Number, required: true }, reason: { type: String, required: true },
      byName: { type: String, default: '' }, from: { type: String, enum: ['Purchase', 'Store'], default: 'Purchase' },
    }],
    default: undefined,
  },
}, { _id: true });

const LineSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  itemCode: { type: String, default: '' },
  itemName: { type: String, default: '' },
  orderKind: { type: String, enum: ['SubChildPart', 'ChildPart', 'Machine'], required: true },
  // The steps this trip covers, in order (the next steps of every request).
  stepNames: { type: [String], required: true },
  qty: { type: Number, required: true, min: 0 },
  // 'pcs' (Sub Child Part batch) or 'units' (Child Part / Machine units).
  qtyUnit: { type: String, enum: ['pcs', 'units'], default: 'pcs' },
  // One full price per piece / unit for these steps (D1 — the client's
  // pricing method isn't known yet). ₹0 allowed (a free redo).
  ratePerPiece: { type: Number, required: true, min: 0 },
  // A price for each step the line covers (2026-10-21, user: two steps can
  // cost differently, and it shows what each step cost). ratePerPiece is
  // their sum, so everything downstream (bill acceptance, job-work cost)
  // keeps working off it. Empty on lines saved before this.
  // Pricing types (2026-10-22, client change 2 — services/outsourcePricingService.js):
  // each step is priced its own way. type missing = 'piece' (older lines).
  // operationsPerPiece/operationName: copied from the BOM step (per job work).
  // time: entered by Purchase later for a per minute / per hour step; amount
  // stays null until then.
  stepRates: {
    type: [{
      step: { type: String, required: true },
      type: { type: String, enum: ['piece', 'line', 'operation', 'minute', 'hour'], default: 'piece' },
      rate: { type: Number, required: true, min: 0 },
      operationsPerPiece: { type: Number, default: null },
      operationName: { type: String, default: '' },
      time: {
        minutes: { type: Number, default: null },
        enteredAt: { type: Date, default: null },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        byName: { type: String, default: '' },
      },
      amount: { type: Number, default: null },
    }],
    default: [],
  },
  // A time-based step still has no time — the line's amount leaves it out.
  timePending: { type: Boolean, default: false },
  gstPercent: { type: Number, default: 0, min: 0, max: 100 },
  amount: { type: Number, default: 0 }, // the known step amounts added up
  gstAmount: { type: Number, default: 0 },
  lineTotal: { type: Number, default: 0 }, // amount + GST
  expectedBy: { type: Date, default: null },
  requests: { type: [RequestRefSchema], default: [] },
  combinedMaterial: { type: [CombinedMaterialSchema], default: [] },
  // Slice 7 (R3) — offcuts / unused material Store got back from the vendor
  // with this line's work (into stock).
  returnedMaterial: {
    type: [{
      at: { type: Date, default: Date.now }, byName: { type: String, default: '' },
      kind: { type: String, enum: ['offcut', 'item'], required: true },
      itemName: { type: String, default: '' }, values: { type: mongoose.Schema.Types.Mixed, default: null },
      pieces: { type: Number, default: 0 }, qty: { type: Number, default: 0 }, unit: { type: String, default: '' },
      orderCode: { type: String, default: '' }, tripNo: { type: String, default: '' }, // which receive (2026-10-21)
    }],
    default: [],
  },
  // Slice 6 — the Dispatch trip this line goes out on (set while that trip is
  // live). Purchase's temporary Mark sent is refused then: Dispatch sends it.
  dispatch: {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'DispatchTrip', default: null },
    tripNo: { type: String, default: '' },
    bringBack: { type: Boolean, default: false }, // the vehicle waits and brings it back (2026-10-21)
  },
  sentAt: { type: Date, default: null },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: true });

const ChargeSchema = new mongoose.Schema({
  label: { type: String, required: true },
  amount: { type: Number, default: 0 },
  gstPercent: { type: Number, default: 0 },
  gstAmount: { type: Number, default: 0 },
}, { _id: false });

const ActivitySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  action: { type: String, default: '' },
  summary: { type: String, default: '' },
}, { _id: false });

const OutsourceOrderSchema = new mongoose.Schema({
  // OSO-0001, per company — numbered from the highest in use.
  orderNo: { type: String, required: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  unit: { type: String, default: '' },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  vendorName: { type: String, default: '' },
  status: {
    type: String,
    enum: ['Pending Approval', 'Rejected', 'Open', 'With vendor', 'Partly received', 'Received', 'Cancelled'],
    default: 'Open',
  },
  lines: { type: [LineSchema], default: [] },
  charges: { type: [ChargeSchema], default: [] },
  // CGST + SGST vs IGST, from the two GSTINs (gstSplitFor), changeable.
  gstType: { type: String, enum: ['CGST_SGST', 'IGST'], default: 'CGST_SGST' },
  subtotal: { type: Number, default: 0 },
  lineGst: { type: Number, default: 0 },
  chargesTotal: { type: Number, default: 0 },
  chargesGst: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  // Pricing types (2026-10-22): some step is priced per minute / hour; some
  // such step still has no time (grandTotal then leaves it out).
  hasTimeBased: { type: Boolean, default: false },
  timePending: { type: Boolean, default: false },
  // Used from slice 3 (the bill): advance %, credit days, free-text terms.
  // advanceType (2026-10-22): 'percent' of the known total, or a 'flat'
  // amount — the only choice when every step is time-based.
  paymentTerms: {
    advanceType: { type: String, enum: ['percent', 'flat'], default: 'percent' },
    advanceFlat: { type: Number, default: null },
    advancePercent: { type: Number, default: null },
    creditDays: { type: Number, default: null },
    others: { type: [{ label: String, value: String }], default: [] },
  },
  notes: { type: String, default: '' },
  // Company Admin approval — same shape as the PO's.
  approval: {
    required: { type: Boolean, default: false },
    threshold: { type: Number, default: null },
    decision: { type: String, enum: ['Pending', 'Approved', 'Rejected', null], default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: '' },
    // Why it waits (2026-10-22): 'limit' (known total above the limit) and/or
    // 'time' (a time-based rate, with the admin's setting on).
    reasons: { type: [String], default: [] },
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelReason: { type: String, default: '' },
  activity: { type: [ActivitySchema], default: [] },
}, { timestamps: true });

OutsourceOrderSchema.index({ company: 1, orderNo: 1 }, { unique: true });
// The QC hook finds the orders holding a record's trips (slice 3).
OutsourceOrderSchema.index({ 'lines.requests.productionOrder': 1 });
OutsourceOrderSchema.index({ 'lines.requests.jobWorkOrder': 1 });
OutsourceOrderSchema.index({ company: 1, status: 1, createdAt: -1 });
OutsourceOrderSchema.index({ 'lines.item': 1, company: 1 });

export default mongoose.models.OutsourceOrder || mongoose.model('OutsourceOrder', OutsourceOrderSchema);
