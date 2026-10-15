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
}, { timestamps: true });

// One serial per item per company — a lot number may repeat.
purchasedUnitSchema.index(
  { companyId: 1, itemKey: 1, serialKey: 1 },
  { unique: true, partialFilterExpression: { isLot: false } },
);
purchasedUnitSchema.index({ companyId: 1, receivedAt: -1 });

export default mongoose.model('PurchasedUnit', purchasedUnitSchema);
