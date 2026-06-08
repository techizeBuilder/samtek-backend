import mongoose from 'mongoose';

const rfqSchema = new mongoose.Schema({
  rfqNo: {
    type: String,
    required: true,
    unique: true
  },
  purchaseRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequest',
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
  requiredByDate: {
    type: Date
  },
  vendors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  }],
  status: {
    type: String,
    enum: ['Open', 'Closed', 'Awarded'],
    default: 'Open'
  },
  notes: {
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
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Selected vendor after bid comparison
  selectedVendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier'
  },
  selectedBid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VendorBid'
  },
  // Auto-created PO reference
  purchaseOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase'
  },
  emailSentAt: {
    type: Date
  }
}, { timestamps: true });

rfqSchema.pre('validate', function () {
  if (!this.rfqNo) {
    this.rfqNo = `RFQ-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
});

export default mongoose.model('RFQ', rfqSchema);
