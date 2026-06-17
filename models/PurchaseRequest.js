import mongoose from 'mongoose';

const purchaseRequestSchema = new mongoose.Schema({
  requestId: {
    type: String,
    required: true,
    unique: true
  },
  productName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  requestFromDepartment: {
    type: String,
    required: true,
    enum: ['Store', 'Production', 'QC', 'Sales', 'Other'],
    default: 'Store'
  },
  requestDate: {
    type: Date,
    default: Date.now
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Ordered', 'Received'],
    default: 'Pending'
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  storeOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  itemId: {
    type: String
  },
  purchaseOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase'
  },
  // Fields required at the time of marking as Received
  serialNumber: {
    type: String,
    trim: true,
    default: null
  },
  warrantyPeriod: {
    type: Number,   // in months
    default: null
  },
  warrantyCardUrl: {
    type: String,
    trim: true,
    default: null
  },
  receivedAt: {
    type: Date,
    default: null
  },
  // Source of the purchase request
  source: {
    type: String,
    enum: ['Store', 'Production', 'QC'],
    default: 'Store'
  },
  // Whether Store has approved a Production-sourced request to go to Purchase dept
  storeApproved: {
    type: Boolean,
    default: false
  },
  storeApprovedAt: {
    type: Date,
    default: null
  },
  // Production material demand details
  unit: {
    type: String,
    default: null
  },
  materialCode: {
    type: String,
    default: null
  }
}, { timestamps: true });

export default mongoose.model('PurchaseRequest', purchaseRequestSchema);
