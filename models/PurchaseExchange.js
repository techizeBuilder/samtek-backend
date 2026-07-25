import mongoose from 'mongoose';

// Created automatically when QC rejects a Purchase-sourced item (full or
// partial quantity). Distinct from PurchaseReturn (an accounting debit-note
// record) — this tracks the physical replacement-goods workflow: vendor
// email → vendor accepts via a tokenized public link → a new incoming
// PurchaseRequest is auto-seeded so the replacement goods flow through the
// normal Store (Mark Received) → QC → Inventory/Dispatch pipeline.
const PurchaseExchangeSchema = new mongoose.Schema({
  originalPurchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
  originalPurchaseRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },
  qcJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', required: true },

  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },

  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  itemName: { type: String, required: true },

  // Qty QC rejected, in the base/QC unit (e.g. 2 pieces).
  rejectedQtyBaseUnit: { type: Number, required: true },
  baseUnit: { type: String, default: 'pcs' },

  // Reverse-converted qty to raise with the vendor, in the original
  // Purchase Unit (e.g. 1 kg). Equal to rejectedQtyBaseUnit when the item
  // was never unit-converted (conversionFactorUsed is null).
  exchangeQtyPurchaseUnit: { type: Number, required: true },
  purchaseUnit: { type: String, default: null },
  conversionFactorUsed: { type: Number, default: null },

  reason: { type: String, default: '' },

  status: {
    type: String,
    enum: ['Pending Vendor Response', 'Needs Manual Vendor Selection', 'Accepted', 'Declined', 'Expired', 'Fulfilled', 'Cancelled'],
    default: 'Pending Vendor Response',
  },

  vendorToken: { type: String, unique: true, sparse: true },
  vendorTokenExpiry: { type: Date, default: null },
  acceptedAt: { type: Date, default: null },
  declinedAt: { type: Date, default: null },

  // The replacement-goods PurchaseRequest auto-created once the vendor accepts.
  newPurchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },

  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

PurchaseExchangeSchema.index({ companyId: 1, status: 1 });

export default mongoose.model('PurchaseExchange', PurchaseExchangeSchema);
