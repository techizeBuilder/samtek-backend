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
