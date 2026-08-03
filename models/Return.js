import mongoose from 'mongoose';

const returnItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  brandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand',
    required: false
  },
  productName: {
    type: String,
    required: true
  },
  categoryName: {
    type: String,
    required: false
  },
  unit: {
    type: String,
    required: false
  },
  brandName: {
    type: String,
    required: false
  },
  pricePerUnit: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  totalAmount: {
    type: Number,
    min: 0
  }
});

const returnSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  orderDate: {
    type: Date
  },
  returnDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  reason: {
    type: String,
    required: true,
    minlength: 5
  },
  items: [returnItemSchema],
  status: {
    type: String,
    enum: ['pending', 'approved', 'completed', 'rejected'],
    default: 'pending'
  },
  type: {
    type: String,
    enum: ['refund', 'damage', 'exchange', 'defective', 'expired'],
    default: 'refund'
  },
  totalAmount: {
    type: Number,
    required: true,
    default: 0
  },
  totalQuantity: {
    type: Number,
    required: true,
    default: 0
  },
  notes: {
    type: String,
    default: ''
  },
  // Company and sales person associations
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  salesPerson: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Approval tracking
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Calculate totals before saving
returnSchema.pre('save', function (next) {
  if (this.items && this.items.length > 0) {
    this.totalAmount = this.items.reduce((sum, item) => sum + (item.pricePerUnit * item.quantity), 0);
    this.totalQuantity = this.items.reduce((sum, item) => sum + item.quantity, 0);

    // Set totalAmount for each item
    this.items.forEach(item => {
      item.totalAmount = item.pricePerUnit * item.quantity;
    });
  }
  next();
});

// Indexes for better performance
returnSchema.index({ customerId: 1 });
returnSchema.index({ returnDate: -1 });
returnSchema.index({ status: 1 });
returnSchema.index({ type: 1 });
returnSchema.index({ createdAt: -1 });
returnSchema.index({ companyId: 1 });
returnSchema.index({ salesPerson: 1 });
// Supports the paginated getSalespersonReturns/getSalespersonDamages queries
// (type + optional status filter, sorted by createdAt).
returnSchema.index({ type: 1, status: 1, createdAt: -1 });

export default mongoose.model('Return', returnSchema);