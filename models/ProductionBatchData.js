import mongoose from 'mongoose';

const ProductionBatchDataSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionGroup',
    required: true
  },
  batchNumber: {
    type: Number,
    required: true,
    min: 1
  },
  batchKey: {
    type: String,
    required: true,
    unique: true // Ensures each batch key is unique
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  // Individual batch timing data
  mouldingTime: {
    type: Date,
    default: null
  },
  unloadingTime: {
    type: Date,
    default: null
  },
  productionLoss: {
    type: Number,
    default: 0,
    min: 0
  },
  // Calculated fields
  qtyAchieved: {
    type: Number,
    default: 0,
    min: 0
  },
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for efficient queries
ProductionBatchDataSchema.index({ groupId: 1, batchNumber: 1 });
ProductionBatchDataSchema.index({ company: 1, groupId: 1 });

// Update the updatedAt field before saving
ProductionBatchDataSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const ProductionBatchData = mongoose.model('ProductionBatchData', ProductionBatchDataSchema);
export default ProductionBatchData;