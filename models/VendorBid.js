import mongoose from 'mongoose';

const vendorBidSchema = new mongoose.Schema({
  rfq: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RFQ',
    required: true
  },
  rfqNo: {
    type: String,
    required: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  vendorName: {
    type: String,
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  // Fabrication Master items only — same read-only breakdown snapshot as
  // RFQ.fabricationDimensionLines, copied per-vendor at invite time so this
  // vendor's own bid record (and their public quote form) can show it
  // without a populate back to the RFQ. Never affects unitPrice/totalPrice
  // math, which is always against the single `quantity` above.
  fabricationDimensionLines: {
    type: [{
      values: { type: mongoose.Schema.Types.Mixed, required: true },
      quantity: { type: Number, required: true },
      lineWeightKg: { type: Number, default: null },
    }],
    default: []
  },
  // Bid details filled by vendor (via public form)
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  deliveryDays: {
    type: Number,
    required: true,
    min: 1
  },
  warrantyMonths: {
    type: Number,
    default: 0
  },
  remarks: {
    type: String
  },
  // Token for public (no-login) bid submission
  bidToken: {
    type: String,
    unique: true,
    sparse: true
  },
  tokenExpiry: {
    type: Date
  },
  // Status tracking
  status: {
    type: String,
    enum: ['Invited', 'Submitted', 'Selected', 'Rejected'],
    default: 'Invited'
  },
  submittedAt: {
    type: Date
  },
  // Tracks whether the RFQ invite email actually reached this vendor, so a
  // failed send (e.g. Purchase SMTP unconfigured) is visible per-vendor
  // instead of only in the create-time API response, and can be retried.
  emailStatus: {
    type: String,
    enum: ['Sent', 'Failed'],
    default: 'Sent'
  },
  emailError: {
    type: String
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  unit: {
    type: String,
    required: true
  }
}, { timestamps: true });

export default mongoose.model('VendorBid', vendorBidSchema);
