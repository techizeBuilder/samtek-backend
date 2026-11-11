// What Store received from a vendor, one record per physical unit or lot
// (procurement-v2, serial numbers Part 1, 2026-10-13 —
// docs/procurement-v2/serial-numbers-and-warranty-discussion-2026-10.md).
//
//   Unit — an item the vendor gave a warranty on, counted in pieces: one
//          record per piece, each with its own serial (unique per item).
//   Lot  — everything else (no warranty, or bought by weight / length): one
//          record per purchase request for the receipt, with the lot number.
//
// Receive used to write the serial / warranty onto the Item master itself,
// so every new receipt overwrote the last one. These records replace that;
// the Item master is no longer written. The vendor's warranty months live
// here — the warranty claims (Part 2) and the vendor score read them.
import mongoose from 'mongoose';

export const UNIT_STATUSES = ['In QC', 'Accepted', 'Part rejected', 'QC rejected'];
export const PLACE_KINDS = ['Stock', 'Issued', 'Used', 'Fitted', 'Defective', 'Lost', 'Scrapped', 'Sold'];

// One move of a tracked unit / stickered part (serial number work step 2).
export const TrailEventSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: String, default: '' },
  what: { type: String, required: true },        // e.g. 'Issued', 'Returned (Excess)', 'Fitted'
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
  orderNo: { type: String, default: '' },
  label: { type: mongoose.Schema.Types.ObjectId, ref: 'PartLabel', default: null },
  labelNo: { type: String, default: '' },
  note: { type: String, default: '' },
}, { _id: false });

const purchasedUnitSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  // The item's id (or its name, lower-cased, when no master item was found) —
  // what a serial has to be unique within.
  itemKey: { type: String, required: true },
  itemName: { type: String, default: '' },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
  vendorName: { type: String, default: '' },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
  poNumber: { type: String, default: '' },
  lineId: { type: mongoose.Schema.Types.ObjectId, default: null },
  purchaseRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true, index: true },
  qcJob: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', default: null },

  serialNumber: { type: String, required: true, trim: true },     // as typed (or the lot number)
  serialKey: { type: String, required: true },                     // upper-cased, for duplicates / search
  isLot: { type: Boolean, default: false },
  lotQty: { type: Number, default: 1 },                            // a unit is 1
  qtyUnit: { type: String, default: '' },

  vendorWarrantyMonths: { type: Number, default: 0 },
  warrantyCardUrl: { type: String, default: null },

  status: { type: String, enum: UNIT_STATUSES, default: 'In QC', index: true },
  acceptedQty: { type: Number, default: 0 },
  rejectedQty: { type: Number, default: 0 },
  rejections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRejection' }],

  receivedAt: { type: Date, default: Date.now },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receivedByName: { type: String, default: '' },
  // Serial number work step 2 (2026-10-31, docs/serial number work/
  // serial-tracking-logic-2026-10.md): where the unit is after QC, and every
  // move it made (never overwritten). place.kind:
  //   Stock — in Store · Issued — handed to a production order (built into it)
  //   Used — used to make that order (its trail ends) · Fitted — paired into a
  //   stickered part (place.label) · Defective — returned as a defect
  //   Lost — lost at a vendor · Scrapped — scrapped with its part
  //   Sold — gone to a customer Order (place.customerOrderCode)
  place: {
    kind: { type: String, enum: [null, ...PLACE_KINDS], default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
    orderNo: { type: String, default: '' },
    label: { type: mongoose.Schema.Types.ObjectId, ref: 'PartLabel', default: null },
    labelNo: { type: String, default: '' },
    customerOrderCode: { type: String, default: '' },
    // Defective: the Defective Inventory row (material code) it sits under.
    defectiveOf: { type: String, default: '' },
    // Sold on a service visit: the ticket and the customer it went to.
    ticketNo: { type: String, default: '' },
    customerMobile: { type: String, default: '' },
  },
  trail: { type: [TrailEventSchema], default: [] },
}, { timestamps: true });

// One serial per item per company — a lot number may repeat.
purchasedUnitSchema.index(
  { companyId: 1, itemKey: 1, serialKey: 1 },
  { unique: true, partialFilterExpression: { isLot: false } },
);
purchasedUnitSchema.index({ companyId: 1, receivedAt: -1 });
purchasedUnitSchema.index({ companyId: 1, item: 1, 'place.kind': 1 });
purchasedUnitSchema.index({ companyId: 1, 'place.order': 1 });

export default mongoose.model('PurchasedUnit', purchasedUnitSchema);
