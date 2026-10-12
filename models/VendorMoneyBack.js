// Money a vendor holds of ours that came off a PO's bill (procurement-v2,
// accounts Slice 3, 2026-10-12): the advance paid on rejected material the
// vendor takes back, or on lines cancelled after the advance was paid.
//
//   Refund  — the vendor pays it back: "Refund due" until Accounts records
//             it received (bank + date + reference).
//   Credit  — the vendor keeps it; it's taken off a later payment to them
//             ("Credit available" → "Credit used").
//   Written off — the vendor refused to replace or refund (case 1).
//   (none)  — a cancellation's leftover advance: Accounts decides refund or
//             credit ("To decide").
// Ledger (services/purchaseLedgerService.js): the money sits in Advance to
// Vendors while it's credit; a refund moves it to Vendor Refund Due, then to
// the bank; a write-off to Purchase Loss.
import mongoose from 'mongoose';

const vendorMoneyBackSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  unit: { type: String, default: null },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  vendorName: { type: String, default: '' },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
  poNumber: { type: String, default: '' },
  source: { type: String, enum: ['Rejection', 'Cancellation'], required: true },
  rejection: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRejection', default: null },
  amount: { type: Number, required: true, min: 0 },
  mode: { type: String, enum: ['Refund', 'Credit', 'WrittenOff', null], default: null },
  status: {
    type: String,
    enum: ['To decide', 'Refund due', 'Refunded', 'Credit available', 'Credit used', 'Written off'],
    required: true,
    index: true,
  },
  refund: {
    receivedAt: { type: Date, default: null },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    reference: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  used: { type: Number, default: 0 },                             // credit already taken off payments
  uses: [{
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorPayment' },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase' },
    amount: Number,
    at: { type: Date, default: Date.now },
  }],
  note: { type: String, default: '' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('VendorMoneyBack', vendorMoneyBackSchema);
