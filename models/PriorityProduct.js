import mongoose from 'mongoose';

const priorityProductSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Track how often this product is used for order creation
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index to ensure one priority product per user per product per company
priorityProductSchema.index({ userId: 1, productId: 1, companyId: 1 }, { unique: true });

// Index for efficient queries
priorityProductSchema.index({ userId: 1, companyId: 1, isActive: 1 });
priorityProductSchema.index({ priority: -1, lastUsed: -1 });

// Update lastUsed when product is used in order
priorityProductSchema.methods.markAsUsed = function() {
  this.usageCount += 1;
  this.lastUsed = new Date();
  return this.save();
};

const PriorityProduct = mongoose.model('PriorityProduct', priorityProductSchema);

export default PriorityProduct;