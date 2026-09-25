import mongoose from 'mongoose';

// A running "claimed but not yet issued" ledger, separate from an Item's own
// raw `qty` — fixes a real, verified bug (2026-09-17): every material-
// availability check in the new BOM hierarchy (Machine's own Tier 1/2/3 +
// Child Part reference, Child Part's own Tier 1/2/3 + Sub Child Part
// reference, Sub Child Part's own raw-material check) used to read `qty`
// directly and compare it to ONE consumer's own need, with zero awareness
// of what any OTHER concurrent consumer had already claimed against that
// same stock — two machines needing 3 and 4 units of a Child Part with only
// 5 in stock (genuinely short by 2) would BOTH independently see "5
// available, enough for me" and neither would ever raise a shortfall.
//
// One document per (item, claiming order) pair — not a single aggregate
// counter on Item — so it stays auditable and safely idempotent to
// re-write (see materialReservationService.js's checkAndReserve, upserted
// by this same key so re-running the same order's own check just updates
// its one row instead of accumulating duplicates).
//
// Released (deleted) once the claiming order no longer needs the claim —
// see ProductionOrder.js/SubChildPartJobWorkOrder.js's own post('save')
// hook (order reaches 'Completed') and storeFlowService.js's explicit
// release-before-delete (an order deleted before completion, e.g. Store
// re-routing an item away from Production).
const MaterialReservationSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true, min: 0 },
  // Generic — the claiming order can be a ProductionOrder (Machine/
  // ChildPart/SubChildPart orderKind, the vast majority of callers) or a
  // SubChildPartJobWorkOrder (the Out-Source route's own order model).
  reservedByOrderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reservedByOrderModel: { type: String, enum: ['ProductionOrder', 'SubChildPartJobWorkOrder'], required: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

// Every getFreeQty() call filters by {item, company} — this is the hot path.
MaterialReservationSchema.index({ item: 1, company: 1 });
// releaseReservationsForOrder() looks up by this.
MaterialReservationSchema.index({ reservedByOrderId: 1 });

export default mongoose.model('MaterialReservation', MaterialReservationSchema);
