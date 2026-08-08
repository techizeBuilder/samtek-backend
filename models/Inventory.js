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
  // Legacy classification pair — still shared, productKind-scoped storage for
  // Product Master ("P-Type"/"Category") and Motor Master ("MotorCategory"/
  // "MotorSubCategory"); see rdController.js. No longer required/shown on the
  // plain-Inventory form (superseded there by itemType below) — old items and
  // other productKind's data keep working untouched.
  category: {
    type: String,
    default: '',
    trim: true,
  },
  subCategory: {
    type: String,
    trim: true
  },
  // The client's real "Item Type" business classification (Raw Material/
  // Tool/Readymade Material/Assets) — Inventory-own, dynamic ("+"-addable),
  // InventoryMasterOption-backed, same pattern as sourceType/itemSourceType
  // below. Deliberately separate from the internal `type` field further down
  // (system classification: Product/Material/Spares/Assemblies, hidden from
  // this form, governs Pricing Value/QC/Sales/codegen — untouched by this).
  itemType: { type: String, default: '', trim: true },
  // Inventory's own new classification fields (InventoryMasterOption-backed,
  // "+"-addable) — deliberately separate from the Category Management system
  // above (which Product/Motor Master's own dropdowns and Sales/Quotation
  // filtering still use) and from Product/Motor Master's own lists.
  itemCategories: [{ type: String, trim: true }], // multi-select, e.g. Fabrication, Sheet Metal, Machining
  sourceType: { type: String, default: '', trim: true }, // e.g. Purchase, In House
  itemSourceType: { type: String, default: '', trim: true }, // e.g. In House, Out Source, Both
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
  // Internal/system classification — Product Master and Motor Master hardcode
  // 'Product' here server-side (see productKind below); plain Inventory items
  // pick from this fixed list. NOT the client's "Item Type" business
  // classification (Raw Material/Tool/etc.) — that lives in category/subCategory.
  type: {
    type: String,
    required: true,
    enum: ['Product', 'Material', 'Spares', 'Assemblies']
  },
  // Only meaningful when type: 'Product' — distinguishes which "master" this
  // sellable item is managed under (Product Master's machines vs Motor
  // Master's motors). Everything genuinely shared (price, stock, purchase
  // unit, specs, description, image) stays on the item's common fields above;
  // only what's truly master-specific lives in the nested details below.
  productKind: {
    type: String,
    enum: ['Machine', 'Motor', null],
    default: null,
  },
  // Universal active/discontinued toggle — client asked for this on both
  // Inventory items and Product Master machines ("Continue"/"Discontinue"),
  // so it lives here as a genuinely common field rather than duplicated per kind.
  isDiscontinued: { type: Boolean, default: false },
  // Explicit dynamic "Source Type" field (Manufacturing/Purchase for Product
  // Master) — kept as its own real field per the client's literal requirement,
  // even though it drives the same purchase/internalManufacturing booleans
  // itemPricingService already depends on. Never silently collapsed away.
  productSourceType: { type: String, default: '', trim: true },
  // Product Master (Machine) specific fields
  machineDetails: {
    variant: { type: String, default: '', trim: true },
    productionRate: { type: String, default: '', trim: true }, // e.g. "200 Kg/hr"
    powerSource: { type: String, default: '', trim: true }, // Motor / Gas / Engine
    powerRequiredHP: { type: Number, default: null },
    powerRequiredKWH: { type: Number, default: null },
    powerRequiredRPM: { type: Number, default: null },
    accessories: [{ type: String, trim: true }],
    modelNumber: { type: String, default: '', trim: true },
    machineType: { type: String, enum: ['Standard', 'Custom', 'Special Purpose Machine (SPM)'], default: 'Standard' },
    // R&D workflow state — migrated as-is from the old RDMachine collection.
    forwardToNextPhase: { type: Boolean, default: false },
    designStatus: { type: String, enum: ['Draft', 'Testing', 'Approved', 'Rejected'], default: 'Draft' },
    releaseStatus: { type: String, enum: ['Not Released', 'Released'], default: 'Not Released' },
    rejectionNote: { type: String, default: '' },
    // Set the first time a ProductionOrder for this machine reaches 'Completed'
    // — see itemPricingService.js.
    firstBuiltAt: { type: Date, default: null },
  },
  // R&D custom field templates (parent label -> sub-field name -> value),
  // shaped per RDCustomFieldTemplate matching category+subCategory+productSourceType.
  // Kept at the top level (not nested in machineDetails) since it's plain
  // key/value data with no other Machine-only typing needs.
  customFields: [{
    groupLabel: { type: String, trim: true },
    fieldName: { type: String, trim: true },
    value: { type: String, trim: true, default: '' }
  }],
  // Motor Master specific fields
  motorDetails: {
    motorType: { type: String, default: '', trim: true },
    modelNumber: { type: String, default: '', trim: true },
    version: { type: String, default: '', trim: true },
    hp: { type: Number, default: null },
    kwh: { type: Number, default: null }, // auto-calculated from hp (see client formula)
    rpm: { type: Number, default: null },
    pole: { type: String, default: '', trim: true },
    phase: { type: String, default: '', trim: true },
    // Set the first time a ProductionOrder for this motor reaches 'Completed'
    // — mirrors machineDetails.firstBuiltAt, see itemPricingService.js.
    firstBuiltAt: { type: Date, default: null },
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
  // Per-item Pricing Value (Company Admin > Pricing Value) — set only on
  // items the company actually sells (type: 'Product'). Once a real cost is
  // known (BOM roll-up or purchase price), MRP = cost + cost*profitPercent/100
  // and Sale Price = cost - cost*discountPercent/100. null means "not set
  // yet" — treated as 0 (no markup/discount) by itemPricingService.js.
  profitPercent: {
    type: Number,
    min: 0,
    max: 1000,
    default: null
  },
  discountPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: null
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
  // Optional attributes mirrored from Product Master when the item's code matches an
  // R&D-defined product (see itemCode autofill in SimpleInventoryForm). Independent of
  // Product Master's own Category/P-Type taxonomy — never populated from those.
  brand: {
    type: String,
    trim: true,
    default: ''
  },
  metrology: {
    type: String,
    trim: true,
    default: ''
  },
  // Shared/universal — same real-world spec (e.g. SS304) regardless of whether
  // it's an Inventory item or a Product Master machine, so Product Master's
  // Material Grade dropdown (RDMasterOption field 'MaterialGrade') reads and
  // writes this same top-level field rather than keeping its own copy.
  materialGrade: {
    type: String,
    trim: true,
    default: ''
  },
  modelNumber: {
    type: String,
    trim: true,
    default: ''
  },
  size: {
    type: String,
    trim: true,
    default: ''
  },
  // Structured dimension breakdown (Inventory-specific — Product Master keeps
  // its own simple free-text `size` field above for "6x12" style dimensions).
  dimensions: {
    length: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    height: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    width: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    diaOD: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    diaID: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
    thickness: { value: { type: Number, default: null }, unit: { type: String, default: '', trim: true } },
  },
  unitWeightValue: {
    type: Number,
    default: null
  },
  unitWeightUnitType: {
    type: String,
    trim: true,
    default: ''
  },
  unitWeightUnit: {
    type: String,
    trim: true,
    default: ''
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
itemSchema.index({ productKind: 1, purchase: 1 });
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