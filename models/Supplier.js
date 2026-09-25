import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  supplierCode: {
    type: String,
    required: true,
    unique: true
  },
  supplierName: {
    type: String,
    required: true
  },
  contactPerson: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true
  },
  alternatePhone: {
    type: String
  },
  address: {
    street: {
      type: String
    },
    city: {
      type: String
    },
    state: {
      type: String
    },
    zipCode: {
      type: String
    },
    country: {
      type: String,
      default: 'India'
    }
  },
  gstNumber: {
    type: String
  },
  panNumber: {
    type: String
  },
  bankDetails: {
    accountNumber: String,
    accountName: String,
    bankName: String,
    branchName: String,
    ifscCode: String
  },
  paymentTerms: {
    type: String,
    default: 'Net 30'
  },
  unit: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  supplierType: {
    type: String,
    enum: ['Raw Material', 'Services', 'Equipment', 'Consumables'],
    default: 'Raw Material'
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: 3
  },
  notes: {
    type: String
  },
  openingBalance: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  entityType: {
    type: String,
    enum: ['Individual', 'HUF', 'Company', 'Firm', 'Others'],
    default: 'Others'
  },
  tdsSection: {
    type: String,
    enum: ['194C', '194J', '194Q', '206C_1H', 'None'],
    default: 'None'
  },
  // Old free-text tags — kept (and still shown on the form) because the RFQ
  // module's vendor auto-match scores against them (rfqController.js).
  vendorCategories: {
    type: [String],
    default: []
  },
  // Vendor Master redesign (2026-09-25) — what this vendor actually covers,
  // as real links instead of free text. Product tab: Items flagged
  // Purchasable (Inventory / Product Master / Motor Master — never a Child
  // Part or Sub Child Part, which the BOM creates in-house; their vendor
  // need is job work, i.e. `services`). Stored by id, so an item rename
  // never breaks the link.
  suppliedItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Item' }],
  // Services tab: Process Template step names this vendor does as job work.
  // Matched by name across every BOM level (confirmed with the user) to any
  // BOM step with that name marked Out Source — the same plain-name key BOMs
  // themselves store (templates have no ids), see getSupplierCatalog.
  services: {
    type: [String],
    default: []
  }
}, {
  timestamps: true
});

supplierSchema.pre('validate', function () {
  if (!this.supplierCode) {
    this.supplierCode = `SUPP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
});

export default mongoose.model('Supplier', supplierSchema);
