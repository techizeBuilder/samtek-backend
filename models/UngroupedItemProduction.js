import mongoose from 'mongoose';

const ungroupedItemProductionSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  
  // Batch number for supporting individual batch tracking
  batchNumber: {
    type: Number,
    default: 1,
    min: 1
  },
  
  // Formatted batch number (BATNO01, BATNO02, etc.)
  batchNo: {
    type: String,
    default: 'BATNO01'
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
  
  // Auto-calculated field
  qtyAchieved: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Production Date (for daily tracking)
  productionDate: {
    type: Date,
    default: () => new Date().setHours(0, 0, 0, 0) // Start of day
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'completed'],
    default: 'not_started'
  },
  
  // Metadata
  createdBy: {
    type: String,
    required: true
  },
  updatedBy: {
    type: String
  },
  
  // Auto-update qtyAchieved when productionLoss or qtyPerBatch changes
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Compound index to ensure one production record per batch per day per company
// This allows the same item to have multiple batches on the same day
ungroupedItemProductionSchema.index(
  { companyId: 1, batchNo: 1, productionDate: 1 }, 
  { unique: true }
);

// Pre-save middleware to calculate qtyAchieved
ungroupedItemProductionSchema.pre('save', function(next) {
  // Auto-calculate qtyAchieved = qtyPerBatch - productionLoss
  this.qtyAchieved = Math.max(0, (this.qtyPerBatch || 0) - (this.productionLoss || 0));
  
  // Update status based on timing data
  if (this.mouldingTime && this.unloadingTime) {
    this.status = 'completed';
  } else if (this.mouldingTime) {
    this.status = 'in_progress';
  } else {
    this.status = 'not_started';
  }
  
  next();
});

// Instance method to get formatted timing data
ungroupedItemProductionSchema.methods.getFormattedTimings = function() {
  return {
    mouldingTime: this.mouldingTime ? {
      date: this.mouldingTime.toLocaleDateString(),
      time: this.mouldingTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    } : null,
    unloadingTime: this.unloadingTime ? {
      date: this.unloadingTime.toLocaleDateString(),
      time: this.unloadingTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    } : null
  };
};

// Static method to get or create production record for today with batch support
ungroupedItemProductionSchema.statics.getOrCreateTodayRecord = async function(companyId, itemId, createdBy, batchNumber = 1) {
  const today = new Date().setHours(0, 0, 0, 0);
  
  let record = await this.findOne({
    companyId,
    itemId,
    batchNumber,
    productionDate: today
  });
  
  if (!record) {
    record = new this({
      companyId,
      itemId,
      batchNumber,
      productionDate: today,
      createdBy
    });
    await record.save();
  }
  
  return record;
};

const UngroupedItemProduction = mongoose.model('UngroupedItemProduction', ungroupedItemProductionSchema);

export default UngroupedItemProduction;