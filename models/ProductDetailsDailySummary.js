import mongoose from 'mongoose';

const productDetailsDailySummarySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  orderIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    index: true
  }],
  productDailySummaryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductDailySummary',
    required: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  
  // Manual Input Fields (Daily Values)
  packing: {
    type: Number,
    default: 0,
    min: 0
  },
  physicalStock: {
    type: Number,
    default: 0,
    min: 0
  },
  batchAdjusted: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Auto-Calculated Fields (Daily Values)
  totalQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  totalIndent: {
    type: Number,
    default: 0,
    min: 0
  },
  productionFinalBatches: {
    type: Number,
    default: 0
  },
  toBeProducedDay: {
    type: Number,
    default: 0
  },
  toBeProducedBatches: {
    type: Number,
    default: 0
  },
  produceBatches: {
    type: Number,
    default: 0
  },
  expiryShortage: {
    type: Number,
    default: 0
  },
  balanceFinalBatches: {
    type: Number,
    default: 0
  },
  
  // Status field for approval workflow
  status: {
    type: String,
    enum: ['pending', 'approved'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Unique index: ONE entry per product per day per company
productDetailsDailySummarySchema.index({ productId: 1, companyId: 1, date: 1 }, { unique: true });

// Non-unique indexes for efficient queries
productDetailsDailySummarySchema.index({ companyId: 1, date: 1 });
productDetailsDailySummarySchema.index({ productId: 1, date: 1 });
productDetailsDailySummarySchema.index({ productDailySummaryId: 1, date: 1 });

// Helper method to calculate formulas
productDetailsDailySummarySchema.methods.calculateFormulas = function(qtyPerBatch) {
  // productionFinalBatches = batchAdjusted * qtyPerBatch
  this.productionFinalBatches = Math.round((this.batchAdjusted * qtyPerBatch) * 100) / 100;
  
  // produceBatches = toBeProducedDay / qtyPerBatch
  if (qtyPerBatch > 0) {
    this.produceBatches = Math.round((this.toBeProducedDay / qtyPerBatch) * 100) / 100;
  }
  
  // toBeProducedBatches = qtyPerBatch > 0 ? toBeProducedDay / qtyPerBatch : 0 (same as produceBatches)
  this.toBeProducedBatches = this.produceBatches;
  
  // expiryShortage = productionFinalBatches - toBeProducedDay
  this.expiryShortage = Math.round((this.productionFinalBatches - this.toBeProducedDay) * 100) / 100;
  
  return this;
};

export default mongoose.model('ProductDetailsDailySummary', productDetailsDailySummarySchema);