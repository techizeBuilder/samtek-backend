import mongoose from 'mongoose';

const productDailySummarySchema = new mongoose.Schema({
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
  productName: {
    type: String,
    required: true
  },
  
  // Master Data Fields (Not daily-specific)
  qtyPerBatch: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// Unique index: ONE entry per product per company (Master data)
productDailySummarySchema.index({ productId: 1, companyId: 1 }, { unique: true });

// Non-unique indexes for efficient queries
productDailySummarySchema.index({ companyId: 1 });
productDailySummarySchema.index({ productId: 1 });

export default mongoose.model('ProductDailySummary', productDailySummarySchema);