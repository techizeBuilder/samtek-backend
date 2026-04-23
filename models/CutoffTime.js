import mongoose from 'mongoose';

const cutoffTimeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  unitHeadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cutoffTime: {
    type: String, // Format: "HH:MM" (24-hour format, e.g., "15:00" for 3:00 PM)
    required: true,
    validate: {
      validator: function(time) {
        // Validate HH:MM format
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeRegex.test(time);
      },
      message: 'Cutoff time must be in HH:MM format (24-hour)'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  description: {
    type: String,
    maxLength: 200,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Ensure only one cutoff time per company
cutoffTimeSchema.index({ companyId: 1 }, { unique: true });

// Index for faster queries
cutoffTimeSchema.index({ companyId: 1, isActive: 1 });
cutoffTimeSchema.index({ unitHeadId: 1 });

// Instance method to check if current time is past cutoff
cutoffTimeSchema.methods.isPastCutoff = function(currentTime = new Date()) {
  const [hours, minutes] = this.cutoffTime.split(':').map(Number);
  const cutoffDate = new Date();
  cutoffDate.setHours(hours, minutes, 0, 0);
  
  const currentDate = new Date(currentTime);
  return currentDate > cutoffDate;
};

// Static method to check if orders are allowed for a company
cutoffTimeSchema.statics.canPlaceOrder = async function(companyId) {
  const cutoffSetting = await this.findOne({ 
    companyId, 
    isActive: true 
  });
  
  if (!cutoffSetting) {
    // If no cutoff time set, orders are always allowed
    return { 
      allowed: true, 
      message: 'No cutoff time restrictions' 
    };
  }
  
  const isPastCutoff = cutoffSetting.isPastCutoff();
  
  return {
    allowed: !isPastCutoff,
    message: isPastCutoff ? 
      `Orders are not allowed after ${cutoffSetting.cutoffTime}` : 
      `Orders allowed until ${cutoffSetting.cutoffTime}`,
    cutoffTime: cutoffSetting.cutoffTime,
    isPastCutoff
  };
};

// Static method to get cutoff time for a company
cutoffTimeSchema.statics.getCutoffTime = async function(companyId) {
  return this.findOne({ companyId, isActive: true }).populate('unitHeadId', 'username fullName');
};

export default mongoose.model('CutoffTime', cutoffTimeSchema);