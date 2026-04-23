import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
  unitName: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    trim: true
  },
  legalName: {
    type: String,
    trim: true
  },
  companyType: {
    type: String,
    required: false,
    trim: true,
    default: undefined,
    validate: {
      validator: function(v) {
        // Skip validation if value is null, undefined, or empty string
        if (v == null || v === '' || v === undefined) {
          return true;
        }
        return ['Private Limited', 'Public Limited', 'LLP', 'Partnership', 'Proprietorship', 'OPC', 'Other'].includes(v);
      },
      message: 'Invalid company type. Allowed values: Private Limited, Public Limited, LLP, Partnership, Proprietorship, OPC, Other'
    }
  },
  mobile: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty values
        return /^[\+]?[1-9][\d]{0,15}$/.test(v.replace(/[\s\-\(\)]/g, ''));
      },
      message: 'Invalid mobile number format'
    }
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty values
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Invalid email format'
    }
  },
  address: {
    type: String,
    trim: true
  },
  locationPin: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[1-9][0-9]{5}$/.test(v);
      },
      message: 'Invalid PIN code format'
    }
  },
  city: {
    type: String,
    required: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  pan: {
    type: String,
    trim: true,
    uppercase: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty values
        return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v);
      },
      message: 'Invalid PAN format (should be ABCDE1234F)'
    }
  },
  gst: {
    type: String,
    trim: true
  },
  website: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Location specific data for better organization
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      default: [0, 0]
    },
    address: String,
    landmark: String
  },
  businessHours: {
    opening: {
      type: String,
      default: '09:00'
    },
    closing: {
      type: String,
      default: '18:00'
    }
  }
}, {
  timestamps: true
});

// Create indexes for better search performance
companySchema.index({ unitName: 1 });
companySchema.index({ city: 1 });
companySchema.index({ name: 1 });
companySchema.index({ gst: 1 });
companySchema.index({ isActive: 1 });
companySchema.index({ 'location': '2dsphere' });

// Compound indexes for common queries
companySchema.index({ city: 1, isActive: 1 });
companySchema.index({ unitName: 1, city: 1 });

// Virtual for full address
companySchema.virtual('fullAddress').get(function() {
  return `${this.address}, ${this.city}, ${this.state} - ${this.locationPin}`;
});

// Virtual for display name with location
companySchema.virtual('displayName').get(function() {
  return `${this.name} - ${this.city}`;
});

// Ensure virtuals are included when converting to JSON
companySchema.set('toJSON', { virtuals: true });
companySchema.set('toObject', { virtuals: true });

export const Company = mongoose.model('Company', companySchema);