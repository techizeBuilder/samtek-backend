import mongoose from 'mongoose';

// Unified Production Batch Model - combines ungrouped items and grouped production batches
const productionBatchSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  
  // Optional group reference (for grouped production items)
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionGroup',
    required: false,
    default: null
  },
  
  // Batch identifiers - both must be unique per company per date
  batchNumber: {
    type: Number,
    required: true,
    min: 1
  },
  batchNo: {
    type: String,
    required: true,
    trim: true
    // Format: BATNO01, BATNO02, etc.
  },
  
  // Production date (day-level granularity)
  productionDate: {
    type: Date,
    required: true,
    index: true
  },
  
  // Production Timing Fields
  mouldingTime: {
    type: Date,
    default: null
  },
  unloadingTime: {
    type: Date,
    default: null
  },
  
  // Production Data Fields
  productionLoss: {
    type: Number,
    default: 0,
    min: 0
  },
  qtyPerBatch: {
    type: Number,
    default: 0,
    min: 0
  },
  qtyAchieved: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Production status
  status: {
    type: String,
    enum: ['pending', 'not_started', 'in_progress', 'completed', 'paused', 'cancelled', 'migrated_from_batchdata'],
    default: 'pending'
  },
  
  // Tracking fields
  createdBy: {
    type: String,
    default: 'system'
  },
  updatedBy: {
    type: String,
    default: 'system'  
  },
  
  // Optional notes
  notes: {
    type: String,
    default: '',
    maxlength: 1000
  },
  
  // Batch tracking (combined or single)
  totalBatchAdjusted: {
    type: Number,
    default: 0,
    min: 0
  },
  combinedItems: [{
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item'
    },
    DailyProductionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductDetailsDailySummary'
    },
    batchAdjustedValue: {
      type: Number,
      min: 0
    },
    qtyContribution: {
      type: Number,
      min: 0
    }
  }]
  
}, {
  timestamps: true, // Automatically adds createdAt and updatedAt
  collection: 'productionbatches' // Explicitly set collection name
});

// UNIQUE INDEXES - These ensure no duplicates
productionBatchSchema.index(
  { companyId: 1, batchNo: 1, productionDate: 1 }, 
  { 
    unique: true, 
    name: 'unique_company_batchno_date',
    background: true 
  }
);

// ADDITIONAL INDEXES for performance
productionBatchSchema.index(
  { companyId: 1, productionDate: 1 }, 
  { 
    name: 'company_date_lookup',
    background: true 
  }
);

productionBatchSchema.index(
  { itemId: 1, companyId: 1 }, 
  { 
    name: 'item_company_lookup',
    background: true 
  }
);

// PRE-SAVE MIDDLEWARE
productionBatchSchema.pre('save', function(next) {
  try {
    // Auto-calculate qtyAchieved based on: (totalBatchAdjusted × qtyPerBatch) - productionLoss
    if (this.isModified('qtyPerBatch') || this.isModified('productionLoss') || this.isModified('totalBatchAdjusted') || this.isNew) {
      const totalBatchAdjusted = Number(this.totalBatchAdjusted) || 1;
      const qtyPerBatch = Number(this.qtyPerBatch) || 0;
      const productionLoss = Number(this.productionLoss) || 0;
      const calculated = (totalBatchAdjusted * qtyPerBatch) - productionLoss;
      this.qtyAchieved = Math.round(calculated * 100) / 100; // Round to 2 decimal places
      console.log(`📊 PRE-SAVE: qtyAchieved = (${totalBatchAdjusted} × ${qtyPerBatch}) - ${productionLoss} = ${this.qtyAchieved}`);
    }
    
    // Auto-update status based on timing fields
    if (this.isModified('mouldingTime') || this.isModified('unloadingTime')) {
      if (this.mouldingTime && this.unloadingTime) {
        this.status = 'completed';
      } else if (this.mouldingTime || this.unloadingTime) {
        this.status = 'in_progress';
      }
    }
    
    // Ensure production date is at day-level (no time component) - USE UTC!
    if (this.productionDate) {
      this.productionDate.setUTCHours(0, 0, 0, 0);
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// INSTANCE METHODS
productionBatchSchema.methods.calculateEfficiency = function() {
  if (!this.qtyPerBatch || this.qtyPerBatch === 0) return 0;
  return Math.round((this.qtyAchieved / this.qtyPerBatch) * 100);
};

productionBatchSchema.methods.getProductionDuration = function() {
  if (!this.mouldingTime || !this.unloadingTime) return null;
  return Math.round((this.unloadingTime - this.mouldingTime) / (1000 * 60)); // Duration in minutes
};

// STATIC METHODS
productionBatchSchema.statics.getNextBatchNumber = async function(companyId, date = new Date()) {
  const productionDate = new Date(date);
  productionDate.setHours(0, 0, 0, 0);
  
  const lastBatch = await this.findOne({
    companyId: companyId,
    productionDate: productionDate
  }).sort({ batchNumber: -1 }).limit(1);
  
  const nextNumber = (lastBatch?.batchNumber || 0) + 1;
  return {
    batchNumber: nextNumber,
    batchNo: `BATNO${nextNumber.toString().padStart(2, '0')}`
  };
};

productionBatchSchema.statics.getDailyProduction = async function(companyId, date = new Date()) {
  const productionDate = new Date(date);
  productionDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(productionDate);
  nextDay.setDate(nextDay.getDate() + 1);
  
  return this.find({
    companyId: companyId,
    productionDate: { $gte: productionDate, $lt: nextDay }
  }).populate('itemId', 'name code category').sort({ batchNumber: 1 });
};

const ProductionBatch = mongoose.model('ProductionBatch', productionBatchSchema);

export default ProductionBatch;