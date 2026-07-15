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
  stampUrl: {
    type: String,
    trim: true,
    default: null
  },
  // 6-digit password set by the Company Admin, required as the first factor
  // before an Accounts user can view a customer's Cash Amount. Stored AES
  // encrypted (not hashed) so the Company Admin can view it back — see
  // utils/cashCrypto.js. select:false so it's never returned by default.
  cashPasswordEnc: {
    type: String,
    default: null,
    select: false
  },
  // Pricing rules for auto-calculated R&D item MRP/Sale Price (see
  // itemPricingService.js). Once an item's real cost is known (BOM
  // roll-up or actual purchase price), MRP = cost + cost*profitPercent/100
  // and SalePrice = cost - cost*discountPercent/100.
  profitPercent: {
    type: Number,
    min: 0,
    max: 1000,
    default: 0
  },
  discountPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  // Bank details shown on quotation PDFs (BANK DETAILS block). Filled by the
  // Company Admin in My Company; unfilled fields render blank on the quotation.
  bankDetails: {
    companyName:   { type: String, trim: true, default: '' }, // account holder / name of company
    bankName:      { type: String, trim: true, default: '' },
    accountNumber: { type: String, trim: true, default: '' },
    ifsc:          { type: String, trim: true, default: '' },
    branch:        { type: String, trim: true, default: '' }
  },
  // Social / contact links — multiple entries allowed, each has a type and value
  socialLinks: [
    {
      type: {
        type: String,
        enum: ['website', 'email', 'facebook', 'instagram', 'linkedin', 'twitter', 'youtube', 'other'],
        required: true
      },
      label: { type: String, trim: true },  // optional custom label
      url: { type: String, trim: true, required: true }
    }
  ],
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