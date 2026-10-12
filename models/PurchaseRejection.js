// QC rejected purchased material — and what the vendor agreed to
// (procurement-v2, accounts Slice 3, 2026-10-12; client's five cases,
// docs/procurement-v2/accounts-bill-ledger-payments-2026-10.md §3.5).
//
// Made automatically when QC fails a purchase job (all of it, or part).
// Purchase talks to the vendor and records the answer:
//   refused  — no replacement, no refund: taken off the bill, any advance
//              paid on it written off, the vendor's score goes down
//   replace  — the bill is unchanged; the quantity is expected again on the
//              same PO line, received by Store and QC'd as usual
//   refund   — taken off the bill; the advance paid on it is owed back
//   credit   — taken off the bill; the advance paid on it stays with the
//              vendor as credit for a later payment
// Nothing is emailed to the vendor automatically (it used to be: an
// "exchange" link went out on every rejection, and a return was booked at
// the same time — opposite outcomes, both every time).
import mongoose from 'mongoose';

export const REJECTION_OUTCOMES = ['refused', 'replace', 'refund', 'credit'];
export const REJECTION_STATUSES = [
  'Awaiting vendor answer', 'Replacement expected', 'Replaced',
  'Refund due', 'Refunded', 'Credited', 'Written off', 'Taken off the bill',
];

const purchaseRejectionSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  unit: { type: String, default: null },
  number: { type: String, required: true },                       // REJ-0001
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', required: true, index: true },
  poNumber: { type: String, default: '' },
  lineId: { type: mongoose.Schema.Types.ObjectId, required: true },
  purchaseRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true },
  qcJob: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', required: true },
  qcJobRef: { type: String, default: '' },                        // QC job number, for people
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  vendorName: { type: String, default: '' },
  itemName: { type: String, default: '' },
  rejectedQty: { type: Number, required: true },
  qtyUnit: { type: String, default: '' },
  reason: { type: String, default: '' },                          // QC's fail reason
  // Its money on the bill (incl. GST), and the split for the ledger.
  value: { type: Number, default: 0 },
  net: { type: Number, default: 0 },
  gst: { type: Number, default: 0 },
  // When this rejection is of a REPLACEMENT that failed again: the one it replaced.
  replacementOf: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRejection', default: null },

  outcome: { type: String, enum: [...REJECTION_OUTCOMES, null], default: null },
  status: { type: String, enum: REJECTION_STATUSES, default: 'Awaiting vendor answer', index: true },
  advanceShare: { type: Number, default: 0 },                     // advance paid on the rejected part
  replacement: {
    purchaseRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },
    expectedDate: { type: Date, default: null },
  },
  moneyBack: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorMoneyBack', default: null },
  note: { type: String, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, default: '' },
  recordedAt: { type: Date, default: null },
}, { timestamps: true });

purchaseRejectionSchema.index({ companyId: 1, number: 1 }, { unique: true });

export default mongoose.model('PurchaseRejection', purchaseRejectionSchema);
