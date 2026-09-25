import mongoose from 'mongoose';
import { releaseReservationsForOrder } from '../services/materialReservationService.js';

// Sub Child Part — Out-Source (Purchase) job-work order.
//
// The Purchase-side counterpart to a 'SubChildPart'-kind ProductionOrder:
// raised by the same cron (subChildPartOrderService.js) when a Sub Child
// Part Item's subChildPartDetails.jobWork is true (Outsourced) instead of
// false (In-House). Deliberately NOT a ProductionOrder variant (no process
// steps, no team, no Store material handshake on this route) and NOT built
// on PurchaseRequest/Purchase (those are single-shot receive; this needs N
// independent send/receive "rounds", each covering a chosen subset of the
// item's jobWorkTypes, repeated until every type has been sent and received
// at least once — no vendor selection in this first pass).
const SubChildPartJobWorkRoundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true },
  // The subset (or all) of the order's jobWorkTypes this round covers — no
  // per-round quantity field; every round always covers the order's full
  // orderQuantity, only which job-work-types are included varies.
  jobWorkTypes: { type: [String], required: true },
  status: { type: String, enum: ['Sent', 'Received'], default: 'Sent' },
  sentAt: { type: Date, default: Date.now },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receivedAt: { type: Date, default: null },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  notes: { type: String, default: '' },
});

const SubChildPartJobWorkOrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  subChildPartItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  // Snapshot — avoids a populate() on every list call.
  itemCode: { type: String, required: true, trim: true },
  itemName: { type: String, required: true, trim: true },
  orderQuantity: { type: Number, required: true, min: 1 },
  // Full snapshot of item.subChildPartDetails.jobWorkTypes at creation —
  // the checklist every round must eventually cover between them.
  jobWorkTypes: { type: [String], required: true },
  // Completion is otherwise computed (union of every Received round's
  // jobWorkTypes covers the full list above) — this field mirrors that
  // computed state for querying/display, kept in sync by the controller on
  // every round change rather than derived on every read.
  // 'Pending QC' — every round received, material handled, job work cost
  // entered — but stock isn't credited yet. That now only happens once QC
  // approves (see qcController.js's submitDecision, source:'SubChildPartJobWork'
  // branch); 'Completed' is QC's terminal state for this order, not
  // Purchase's own last-round-received moment anymore.
  status: { type: String, enum: ['Pending', 'In Progress', 'Pending QC', 'Completed'], default: 'Pending' },
  // Which trigger raised THIS order — 'LowStock' (this Sub Child Part's own
  // reorder-point cron, subChildPartOrderService.js's runSubChildPartOrderSweep),
  // 'ChildPartCascade' (a Child Part order's own cascade, discovering it
  // needs more of this Sub Child Part than is currently on hand —
  // childPartReorderService.js's checkSubChildPartMaterialAvailability), or
  // 'MachineCascade' (that same Child Part cascade, but propagated because
  // the Child Part order itself was raised by a Machine's own cascade —
  // keeps a Machine-triggered build chain independent from a Child-Part-
  // cron-triggered one at every tier, not just the first). Each source
  // independently caps at ONE open order per Sub Child Part at a time (see
  // createSubChildPartOrderForItem's dedup, scoped by this field) — they're
  // deliberately allowed to coexist, since they're genuinely different
  // reasons to build more (see build log's cascade fix write-up for why).
  // Every order that predates this field is 'LowStock' by definition (the
  // cascade didn't exist before it) — dedup queries treat a missing value
  // as 'LowStock' rather than requiring a migration to backfill it.
  demandSource: { type: String, enum: ['LowStock', 'ChildPartCascade', 'MachineCascade'], default: 'LowStock' },
  // Which SPECIFIC immediate-parent order asked for this cascade (the Child
  // Part order, for demandSource:'ChildPartCascade'/'MachineCascade') —
  // null for demandSource:'LowStock' (no parent order — this Item's own
  // reorder-point cron). See the identical field's comment on
  // ProductionOrder.js for the full rationale: narrows dedup from "one open
  // order per demandSource type" to "one open order per demandSource type
  // PER TRIGGERING ORDER", so two different Child Part orders needing the
  // same Sub Child Part are correctly treated as two different demands.
  demandRefId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
  rounds: { type: [SubChildPartJobWorkRoundSchema], default: [] },
  // Back-reference to the QCJob this order's finished quantity was sent to
  // (set once, when the last round is received — see
  // receiveSubChildPartJobWorkRound).
  qcJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', default: null },
  qc: {
    // Snapshot of orderQuantity at the moment it was sent to QC.
    sentQty: { type: Number, default: null },
    // Set once QC's decision lands (fully, or after any partial rejections
    // have already shrunk the QCJob's own quantity) — the amount actually
    // credited to the Sub Child Part's stock.
    approvedQty: { type: Number, default: null },
    // Cumulative across any partial rejections plus a possible final full
    // reject — see qcController.js's submitDecision. No rework/return flow
    // exists yet for this quantity (explicitly deferred) — it's surfaced on
    // Purchase's own Job Work page as a "QC Rejected" landing spot only.
    rejectedQty: { type: Number, default: 0 },
    rejectedReason: { type: String, default: '' },
    rejectedAt: { type: Date, default: null },
  },
  // What Purchase actually entered at final receive (their vendor invoice
  // total for the whole order) — kept for audit. The per-unit figure this
  // becomes lives on Item.subChildPartDetails.jobWorkCost (= this ÷
  // orderQuantity), the number every downstream BOM cost rollup reads.
  jobWorkCostTotal: { type: Number, default: null },
  // Raw-material availability snapshot, checked once at creation — NOT a
  // full materialDemands[]/Store issue-receive-return handshake (that shape
  // belongs to the In-House ProductionOrder route only). The material
  // itself only ever leaves Store ONCE, on whichever round is sent first
  // (order.rounds.length === 0 at send time) — see
  // subChildPartJobWorkOrderController.js's sendSubChildPartJobWorkRound.
  // Later rounds (covering more job-work-types on the same order) are pure
  // status tracking: it's the same physical material moving on to the next
  // operation, nothing more to send.
  rawMaterial: {
    sourceItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
    neededQty: { type: Number, default: null },
    unit: { type: String, default: null },
    availableQty: { type: Number, default: null },
    shortfallQty: { type: Number, default: 0 },
    purchaseRequestId: { type: String, default: null },
    checkedAt: { type: Date, default: null },
    // Set once, on the first Send Round, once material actually leaves
    // Store. 'cut' = a specific piece was cut to size and sent now (its
    // leftover, if any, was logged immediately). 'whole' = a whole
    // sheet/catalog piece(s) were sent now; the real leftover isn't known
    // until the finished Sub Child Part physically comes back, so it's
    // measured on the LAST Receive Round instead (the one that completes
    // the order) — see receiveSubChildPartJobWorkRound.
    sentCase: { type: String, enum: [null, 'cut', 'whole'], default: null },
    // Which of sourceItem.dimensionVariants[] was drawn down for the send
    // (fabrication only) — the fresh catalog/whole-piece variant.
    sentDimensionVariantId: { type: String, default: null },
    // Set only if an existing isLeftover:true variant was consumed as part
    // of the send (either used directly, or combined with fresh whole
    // pieces via the length-fabrication exact-remainder match).
    sentLeftoverUsedVariantId: { type: String, default: null },
    sentAt: { type: Date, default: null },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // 'whole'-case only — flips true once the completing Receive Round has
    // measured and credited the real leftover back onto sourceItem.
    leftoverCaptured: { type: Boolean, default: false },
    leftoverValues: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  priority: { type: String, enum: ['Urgent', 'Normal'], default: 'Normal' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receivedDate: { type: String, required: true },
  deliveryDate: { type: String, required: true },
  notes: { type: String, default: '' },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

SubChildPartJobWorkOrderSchema.index({ company: 1, status: 1 });
SubChildPartJobWorkOrderSchema.index({ company: 1, subChildPartItem: 1, status: 1 });

// Same release-on-completion hook as ProductionOrder.js — see that file's
// own comment for the full rationale.
SubChildPartJobWorkOrderSchema.post('save', async function (doc) {
  if (doc.status !== 'Completed') return;
  try {
    await releaseReservationsForOrder(doc._id);
  } catch (err) {
    console.error(`[SubChildPartJobWorkOrder] Failed to release material reservations for ${doc.orderId}:`, err);
  }
});

export default mongoose.model('SubChildPartJobWorkOrder', SubChildPartJobWorkOrderSchema);
