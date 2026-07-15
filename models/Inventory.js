import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  group: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  subCategory: {
    type: String,
    trim: true
  },
  batch: {
    type: String,
    trim: true
  },
  qty: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  store: {
    type: String,
    trim: true
  },
  importance: {
    type: String,
    enum: ['Low', 'Normal', 'High', 'Critical'],
    default: 'Normal'
  },
  type: {
    type: String,
    required: true,
    enum: ['Product', 'Material', 'Spares', 'Assemblies']
  },
  stdCost: {
    type: Number,
    min: 0,
    default: 0
  },
  purchaseCost: {
    type: Number,
    min: 0,
    default: 0
  },
  salePrice: {
    type: Number,
    min: 0,
    default: 0
  },
  hsn: {
    type: String,
    trim: true
  },
  gst: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  unitType: {
    type: String,
    default: 'Nos'
  },
  mrp: {
    type: Number,
    min: 0,
    default: 0
  },
  // Tracks whether stdCost/purchaseCost/salePrice/mrp are still R&D's manual
  // guess, or have been auto-computed from a real BOM roll-up / purchase
  // price. See server/services/itemPricingService.js.
  costSource: {
    type: String,
    enum: ['Manual', 'BOM', 'Purchase'],
    default: 'Manual'
  },
  costResolvedAt: {
    type: Date,
    default: null
  },
  // Human-readable reason costSource is still 'Manual' despite
  // internalManufacturing/purchase being set (e.g. missing BOM material
  // link, machine not built yet) — surfaced in the Add/Edit Item form.
  costResolutionIssue: {
    type: String,
    trim: true,
    default: null
  },
  internalManufacturing: {
    type: Boolean,
    default: false
  },
  purchase: {
    type: Boolean,
    default: true
  },
  purchaseUnitType: {
    type: String,
    trim: true
  },
  purchaseUnit: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  internalNotes: {
    type: String,
    trim: true
  },
  minStock: {
    type: Number,
    min: 0,
    default: 0
  },
  leadTime: {
    type: Number,
    min: 0,
    default: 0
  },
  customerCategory: {
    type: String,
    required: false,
    trim: true,
    default: 'Retail'
  },
  tags: [{
    type: String,
    trim: true
  }],
  customerPrices: [{
    category: String,
    price: Number
  }],
  image: {
    type: String,
    trim: true,
    default: null
  },
  quantity: {
    type: String,
    trim: true,
    default: ""
  },
  dealerPrice: {
    type: Number,
    min: 0,
    default: 0
  },
  brochureUrl: {
    type: String,
    trim: true,
    default: null
  },
  videoUrl: {
    type: String,
    trim: true,
    default: null
  },
  uses: {
    type: String,
    trim: true
  },
  otherInfo: {
    type: String,
    trim: true
  },
  specifications: [{
    key: String,
    value: String
  }],
  minOrderQty: {
    type: Number,
    min: 0,
    default: 1
  },
  variant: {
    type: String,
    trim: true
  },
  order: {
    type: Number,
    default: 0
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  // NEW: Product variants for quotation price list
  variants: [{
    name: {
      type: String,
      trim: true
    },
    price: {
      type: Number,
      min: 0
    },
    code: {
      type: String,
      trim: true
    },
    // 💥 Clean dynamic key-value array for unlimited custom columns/fields
    attributes: [{
      label: { type: String, trim: true }, // e.g., "Chamber Size", "Phase Type", "Color"
      value: { type: String, trim: true }  // e.g., "400mm", "3-Phase", "Red"
    }]
  }],
  // NEW: Product applications (for flour mill, etc.)
  applications: [{
    type: String,
    trim: true
  }],
  // NEW: Warranty information
  warranty: {
    period: {
      type: Number,
      default: 12 // months
    },
    type: {
      type: String,
      enum: ['Parts Only', 'Labor Only', 'Comprehensive'],
      default: 'Comprehensive'
    },
    terms: {
      type: String,
      trim: true
    },
    // Warranty card document uploaded at time of receiving item from purchase
    cardUrl: {
      type: String,
      trim: true,
      default: null
    },
    cardUploadedAt: {
      type: Date,
      default: null
    }
  },
  // Serial number of the physical item (added at time of receiving from purchase)
  serialNumber: {
    type: String,
    trim: true,
    default: null
  },
  // Reference back to the purchase request that brought this item in
  receivedFromPurchaseRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequest',
    default: null
  }
}, {
  timestamps: true
});

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    // unique: true, <--- REMOVE THIS GLOBAL UNIQUE CONSTRAINT
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  subcategories: [{
    type: String,
    trim: true
  }],
  // ADD COMPANY ID
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});



const customerCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    // unique: true,  <--- REMOVE THIS GLOBAL CONSTRAINT
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  // ADD COMPANY ID
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});

// ADD THIS: Ensures names are unique PER COMPANY, not globally
customerCategorySchema.index({ name: 1, companyId: 1 }, { unique: true });

// Indexes for better performance
itemSchema.index({ name: 1, code: 1 });
itemSchema.index({ category: 1, subCategory: 1 });
itemSchema.index({ type: 1 });
itemSchema.index({ qty: 1, minStock: 1 });
itemSchema.index({ order: 1 });
itemSchema.index({ companyId: 1 });
itemSchema.index({ store: 1 });
// ADD THIS: Ensures category names are unique PER COMPANY, not globally
categorySchema.index({ name: 1, companyId: 1 }, { unique: true });

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});

groupSchema.index({ name: 1, companyId: 1 }, { unique: true });

const unitTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  units: [{
    type: String,
    trim: true
  }],
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  }
}, {
  timestamps: true
});

unitTypeSchema.index({ name: 1, companyId: 1 }, { unique: true });

export const Item = mongoose.model('Item', itemSchema);
export const Category = mongoose.model('Category', categorySchema);
export const CustomerCategory = mongoose.model('CustomerCategory', customerCategorySchema);
export const Group = mongoose.model('Group', groupSchema);
export const UnitType = mongoose.model('UnitType', unitTypeSchema);