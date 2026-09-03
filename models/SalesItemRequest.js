import mongoose from 'mongoose';

// A Sales user's request for R&D to add a brand-new product to the catalog,
// raised from a specific lead's Quotation page. Approve/Reject here is just
// a status change — R&D still creates the actual Item via their own Product
// Master flow, using this as reference (see salesItemRequestController.js).
const salesItemRequestSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true,
    index: true
  },
  leadCode: {
    type: String,
    default: ''
  },
  productName: {
    type: String,
    required: true,
    trim: true
  },
  production: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    default: ''
  },
  image: {
    type: String,
    default: null
  },
  application: {
    type: String,
    default: ''
  },
  quantity: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  reviewRemarks: {
    type: String,
    default: ''
  }
}, { timestamps: true });

salesItemRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });

export default mongoose.model('SalesItemRequest', salesItemRequestSchema);
