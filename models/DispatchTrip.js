import mongoose from 'mongoose';

// A Dispatch trip to a vendor (outsource-v2 slice 6, 2026-10-20 —
// docs/outsource-v2/dispatch-design-2026-10.md). One vehicle, one date, and
// for now exactly ONE stop (one vendor, T2) — kept as stops[] so several
// stops later is a screen change, not a data change.
//
// Jobs on a stop:
//   - poPickup: a "We pick up" PO's chosen lines — Dispatch collects them
//     (handover 5); Store receives only a line on a trip, and its receive
//     records the pickup if Dispatch hasn't (2026-10-26).
//   - outsourceSend: a whole Outsource Order line (T6) — Store and Production
//     hand their parts to Dispatch (handover 1, from the line's material plan),
//     then Dispatch delivers it to the vendor (handover 2: the rounds go Sent).
// Returns (collect from the vendor, Store's receive) come with slice 7.

const StampSchema = {
  at: { type: Date, default: null },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
};

const ProductionHandoverSchema = new mongoose.Schema({
  productionOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
  orderCode: { type: String, default: '' },
  // What Production gives, in words (units, material) — from the plan.
  summary: { type: String, default: '' },
  handedOver: StampSchema,
}, { _id: false });

// A step Dispatch would press, recorded by Store's receive instead
// (2026-10-26: whoever records first — Store never waits for Dispatch).
const ByStoreStamp = { ...StampSchema, viaStore: { type: Boolean, default: false } };

// One PO line on a poPickup job (2026-10-26): Dispatch picks which lines go
// on a trip; Store can receive only a line that's on one.
const PoLineEntrySchema = new mongoose.Schema({
  lineId: { type: mongoose.Schema.Types.ObjectId, required: true },
  itemName: { type: String, default: '' },
  quantity: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  pickedUp: ByStoreStamp,
  later: StampSchema,      // "not ready — collect later": back on the list
  received: StampSchema,   // Store received it
}, { _id: false });

// Slice 7 — one request brought back on an outsourceReturn job.
const ReturnEntrySchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, required: true },
  orderCode: { type: String, default: '' },
  qty: { type: Number, default: 0 },
  unit: { type: String, default: '' },
  // Pieces written off as not coming, with the reason (2026-10-26).
  lostNote: { type: String, default: '' },
  collected: { ...ByStoreStamp, count: { type: Number, default: null } },     // handover 3
  short: { ...StampSchema, count: { type: Number, default: null }, note: { type: String, default: '' }, from: { type: String, default: '' } },
  // handover 4 (Store). `returned` = the leftovers / unused material Store
  // entered with this receive (2026-10-21: shown on Store's Outsource Receive page).
  // `partial` (2026-10-26): only part of the request (pieces) — the rest is
  // still with the vendor.
  received: { ...StampSchema, count: { type: Number, default: null }, partial: { type: Boolean, default: false }, returned: { type: [mongoose.Schema.Types.Mixed], default: [] } },
}, { _id: false });

const JobSchema = new mongoose.Schema({
  kind: { type: String, enum: ['poPickup', 'outsourceSend', 'outsourceReturn'], required: true },
  // poPickup
  purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
  poNumber: { type: String, default: '' },
  pickedUp: ByStoreStamp,
  // The PO lines on this pickup (2026-10-26). Empty on older jobs = the whole PO.
  poLines: { type: [PoLineEntrySchema], default: [] },
  // outsourceSend
  outsourceOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'OutsourceOrder', default: null },
  orderNo: { type: String, default: '' },
  lineId: { type: mongoose.Schema.Types.ObjectId, default: null },
  itemName: { type: String, default: '' },
  stepNames: { type: [String], default: [] },
  // Store's part (handover 1): needed when the line's plan has anything from
  // Store; `picks` logs what Store actually gave (sizes, pieces, offcuts).
  store: {
    needed: { type: Boolean, default: false },
    summary: { type: String, default: '' },
    handedOver: StampSchema,
    picks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  production: { type: [ProductionHandoverSchema], default: [] },
  delivered: StampSchema,
  // 2026-10-21 (docs/outsource-v2/vehicle-waits-bring-back-2026-10.md):
  // the vehicle waits at the vendor and brings this line back on the same
  // trip — set at trip creation, or by "Bring back on this trip".
  bringBack: { type: Boolean, default: false },
  // outsourceReturn: added from a send on this same trip (the vehicle waited).
  sameTrip: { type: Boolean, default: false },
  // outsourceReturn (slice 7): the requests brought back.
  returns: { type: [ReturnEntrySchema], default: [] },
}, { _id: true });

const StopSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  vendorName: { type: String, default: '' },
  // T4 — typed for now (a printed challan is ready to build if the client asks).
  challanNo: { type: String, default: '', trim: true },
  ewayBillNo: { type: String, default: '', trim: true },
  jobs: { type: [JobSchema], default: [] },
}, { _id: true });

const ActivitySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byName: { type: String, default: '' },
  action: { type: String, default: '' },
  summary: { type: String, default: '' },
}, { _id: false });

const DispatchTripSchema = new mongoose.Schema({
  tripNo: { type: String, required: true }, // TRP-0001, per company
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  unit: { type: String, default: '' },
  date: { type: Date, required: true },
  // Planned → Out (something delivered / picked up) → Done (every job); or
  // Cancelled (only before any handover).
  status: { type: String, enum: ['Planned', 'Out', 'Done', 'Cancelled'], default: 'Planned' },
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  oneTimeVehicle: {
    number: { type: String, default: '' },
    type: { type: String, default: '' },
    transporterName: { type: String, default: '' },
    transporterPhone: { type: String, default: '' },
  },
  vehicleNumber: { type: String, default: '' }, // snapshot, for lists
  ownership: { type: String, enum: ['Own', 'Hired'], default: 'Own' },
  driverName: { type: String, default: '', trim: true },
  driverPhone: { type: String, default: '', trim: true },
  // T3 — a hired vehicle's freight; becomes a Dispatch "Transporting Cost"
  // expense (PackagingDispatchExpense.dispatchTrip).
  freight: {
    amount: { type: Number, default: 0, min: 0 },
    paidBy: { type: String, enum: ['Cash', 'Bank', 'Transporter bills', null], default: null },
    expenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackagingDispatchExpense', default: null },
  },
  stops: { type: [StopSchema], default: [] },
  notes: { type: String, default: '' },
  activity: { type: [ActivitySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true });

DispatchTripSchema.index({ company: 1, tripNo: 1 }, { unique: true });
DispatchTripSchema.index({ company: 1, status: 1, date: -1 });
DispatchTripSchema.index({ 'stops.jobs.lineId': 1 });
DispatchTripSchema.index({ 'stops.jobs.purchase': 1 });

export default mongoose.models.DispatchTrip || mongoose.model('DispatchTrip', DispatchTripSchema);
