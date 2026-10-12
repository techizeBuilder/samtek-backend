import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  // Added 2026-10-06 — this model had NO company-level scoping at all before
  // this, only `unit` (a branch-name string, see below). Confirmed via a
  // real cross-tenant collision in the live DB (two different companies
  // both using the branch name "Test Unit") that `unit`-only scoping is a
  // genuine data-isolation gap, not a theoretical one. `unit` stays exactly
  // as-is and keeps meaning "which branch within this company" — companyId
  // is the actual tenant boundary, layered on top everywhere this model is
  // queried. Existing documents were backfilled by
  // scripts/backfillSupplierPurchaseCompanyId.js, not left to a default.
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
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
  // Payment terms (Advance/Balance %, Credit Days, Notes), GST Rate and the
  // automatic Charges list used to live here. All removed (procurement-v2,
  // 2026-10-08): they're decided per order, so they're entered on the PO
  // (Purchase.paymentTerms / items[].gstRate / charges); the old data was
  // dropped (scripts/dropVendorCommercialFields.js).
  // Maximum amount this vendor can be owed at once across all orders — a
  // vendor-wide cap, so it stays here (credit-exposure warning at PO time).
  creditLimit: { type: Number, min: 0, default: null },
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
  },

  // ── Vendor Master v2 (procurement-v2, 2026-10-08) ─────────────────────────
  // Client blueprint §8 profile fields. Commercial terms (payment terms, GST,
  // charges, freight terms, Incoterm, quote validity, MOQ/lead time/warranty)
  // are deliberately NOT here — the quote or the PO decides them.
  tradeName: { type: String, trim: true, default: '' },
  businessTypes: {
    type: [{ type: String, enum: ['Manufacturer', 'Trader', 'Service Provider'] }],
    default: []
  },
  oemStatus: { type: String, enum: ['None', 'OEM', 'Authorized Distributor'], default: 'None' },
  cinNumber: { type: String, trim: true, default: '' },
  msmeNumber: { type: String, trim: true, default: '' },
  iecNumber: { type: String, trim: true, default: '' },
  contactDesignation: { type: String, trim: true, default: '' },
  whatsappNumber: { type: String, trim: true, default: '' },
  alternateContactPerson: { type: String, trim: true, default: '' },
  // `address` above is the Registered Address. Billing/Dispatch either copy it
  // (the *SameAsRegistered flag) or carry their own.
  billingSameAsRegistered: { type: Boolean, default: true },
  billingAddress: {
    street: String, city: String, state: String, zipCode: String,
    country: { type: String, default: 'India' }
  },
  dispatchSameAsRegistered: { type: Boolean, default: true },
  dispatchAddress: {
    street: String, city: String, state: String, zipCode: String,
    country: { type: String, default: 'India' }
  },
  capacity: { type: String, trim: true, default: '' },
  locationsServed: { type: String, trim: true, default: '' },
  qualitySystem: { type: String, trim: true, default: '' },
  providesInspectionCertificate: { type: Boolean, default: false },
  providesMaterialTestCertificate: { type: Boolean, default: false },
  riskClass: { type: String, enum: ['Low', 'Medium', 'High', null], default: null },
  // Blueprint §14 — does this vendor have any relationship with a company
  // employee? `declared: null` = not answered yet (required before submitting
  // for approval), true/false = answered.
  conflictOfInterest: {
    declared: { type: Boolean, default: null },
    details: { type: String, default: '' }
  },

  // Compliance documents (blueprint §8). Files live under
  // uploads/vendor-documents/ (middleware/vendorDocumentUpload.js). The two
  // reminded* flags de-duplicate the daily expiry reminder
  // (vendorApprovalService.js runVendorDocumentExpirySweep).
  documents: [{
    docType: {
      type: String,
      enum: ['GST Certificate', 'PAN Card', 'MSME/Udyam Certificate', 'Company Registration',
        'ISO/Quality Certificate', 'Authorization/Dealership Certificate', 'Product Certificate',
        'Cancelled Cheque/Bank Proof', 'Other'],
      required: true
    },
    docNumber: { type: String, trim: true, default: '' },
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: '' },
    expiryDate: { type: Date, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
    remindedBeforeExpiry: { type: Boolean, default: false },
    remindedOnExpiry: { type: Boolean, default: false }
  }],

  // Approval lifecycle (blueprint §9, §25, §29) — every approval goes to the
  // Company Admin ("Purchase & Vendor Approval" page). Only an Approved +
  // status:'active' vendor can be quoted or given a PO
  // (vendorApprovalService.js ELIGIBLE_VENDOR_FILTER). Probationary/Watchlist
  // are NOT stored here — they're derived live from the vendor rating
  // (getVendorStanding). Server-controlled: never accepted from a request
  // body (see supplierController.js stripServerControlled).
  approvalStatus: {
    type: String,
    enum: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Suspended', 'Blacklisted'],
    default: 'Draft'
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  // Last rejection reason, shown to Purchase so they know what to fix.
  rejectionReason: { type: String, default: '' },
  // Set while Suspended/Blacklisted.
  restriction: {
    reason: { type: String, default: '' },
    effectiveDate: { type: Date, default: null },
    reviewDate: { type: Date, default: null }
  },
  // Filled by the Company Admin when approving a new vendor.
  verification: {
    gstVerified: { type: Boolean, default: false },
    panVerified: { type: Boolean, default: false },
    bankVerified: { type: Boolean, default: false },
    documentsVerified: { type: Boolean, default: false },
    remarks: { type: String, default: '' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // This vendor's own history timeline (blueprint §8 "audit history").
  activity: [{
    action: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
    remarks: { type: String, default: '' }
  }]
}, {
  timestamps: true
});

supplierSchema.pre('validate', function () {
  if (!this.supplierCode) {
    this.supplierCode = `SUPP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
});

export default mongoose.model('Supplier', supplierSchema);
