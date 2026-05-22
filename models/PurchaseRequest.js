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
  }
}, { timestamps: true });

export default mongoose.model('PurchaseRequest', purchaseRequestSchema);
