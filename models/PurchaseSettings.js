import mongoose from 'mongoose';

// Company-wide purchase settings (procurement-v2, 2026-10-08) — one document
// per company, created with defaults on first read
// (purchaseSettingsController.js getOrCreateSettings).
//
// Two owners, two endpoints:
//   - Company Admin ("Purchase & Vendor Approval" page → Settings tab):
//       minVendorsPerItem — the "fewer than N vendors" warning (one number
//         for every item, client decision; warning only, never blocks)
//       poApprovalThreshold — a PO whose final total (goods + charges + all
//         GST) is ABOVE this needs Company Admin approval before it becomes a
//         real PO. null = no PO ever needs approval.
//   - Purchase (Accounts → Purchase & Outsource → Settings tab, gated by the
//     accounts.purchaseSettings permission):
//       chargeLabels / termLabels — the master template of names offered
//         when creating a PO; the values are typed per PO. Charges and
//         payment terms are whole-PO (client decision). Advance % and Credit
//         Days are built-in terms the system acts on, so they're not stored
//         here.
//       quoteValidityDays — a quote can become a PO for this many days after
//         the vendor gave it; after that it's expired (2026-10-09, QT4).
//       priceJumpWarnPercent — warn when a quote is this % or more above the
//         item's last PO price (warning only). See services/quoteChecksService.js.
const purchaseSettingsSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    unique: true
  },
  minVendorsPerItem: { type: Number, min: 1, default: 3 },
  // Quotations RECEIVED from different vendors before an item can go on a PO
  // (2026-10-29, docs/procurement-v2/minimum-quotations-2026-10.md) — never
  // above minVendorsPerItem. 1 = no change (a PO line is always a quote).
  minQuotationsPerItem: { type: Number, min: 1, default: 1 },
  poApprovalThreshold: { type: Number, min: 0, default: null },
  // Outsource Order approval limit (outsource-v2 slice 2, 2026-10-20, D4) —
  // the Company Admin's, separate from the PO limit: an outsource order whose
  // grand total is ABOVE this waits for the Company Admin. null = never.
  outsourceApprovalThreshold: { type: Number, min: 0, default: null },
  // Pricing types (2026-10-22): when on, an outsource order with a per minute /
  // per hour step waits for the Company Admin even under the limit (the rate
  // is checked). Off: entering the time later only notifies the admin.
  approveTimeBasedOutsource: { type: Boolean, default: false },
  chargeLabels: [{
    name: { type: String, trim: true, required: true },
    defaultGstPercent: { type: Number, min: 0, max: 100, default: 0 },
    // A transport charge (Freight, Cartage…). Never offered on an Outsource
    // Order — outsource transport is always ours, arranged by Dispatch
    // (2026-10-21). POs still use it when the vendor delivers.
    isTransport: { type: Boolean, default: false }
  }],
  termLabels: [{
    name: { type: String, trim: true, required: true }
  }],
  // Vendor Master's Entity Type choices (2026-10-28, client: a list Purchase
  // can edit, not a fixed one). Starts as the old fixed list; a company that
  // never edited it gets these too (the default applies on read).
  // Vendor documents (2026-10-28, docs/procurement-v2/vendor-documents-design-2026-10.md):
  // the choice per type — none / required / verified — for the nine built-in
  // types (builtIn: true, only the rule is kept) and the Company Admin's own
  // types. Empty = today's rules (services/vendorDocumentRulesService.js).
  vendorDocumentTypes: {
    type: [{
      name: { type: String, trim: true, required: true },
      builtIn: { type: Boolean, default: false },
      rule: { type: String, enum: ['none', 'required', 'verified'], default: 'none' },
    }],
    default: [],
  },
  entityTypes: {
    type: [{ name: { type: String, trim: true, required: true } }],
    default: () => ['Individual', 'HUF', 'Company', 'Firm', 'Others'].map(name => ({ name })),
  },
  quoteValidityDays: { type: Number, min: 1, max: 365, default: 30 },
  priceJumpWarnPercent: { type: Number, min: 0, max: 1000, default: 10 },
  // Vendor score (2026-10-13, blueprint §11–§12 — services/vendorScoreService.js),
  // the Company Admin's: the weights (whole numbers adding up to 100) and the
  // score below which a vendor goes on the Watchlist. Empty = the defaults.
  vendorScore: {
    weights: {
      price: { type: Number, default: null },
      quality: { type: Number, default: null },
      delivery: { type: Number, default: null },
      credit: { type: Number, default: null },
      warranty: { type: Number, default: null },
      response: { type: Number, default: null },
    },
    watchlistBelow: { type: Number, min: 0, max: 100, default: null },
  },
  // Purchaser score (2026-10-13, blueprint §13 — services/purchaserScoreService.js),
  // the Company Admin's: the nine weights (whole numbers adding up to 100).
  // Empty = the blueprint defaults.
  purchaserScore: {
    weights: {
      coverage: { type: Number, default: null },
      completeness: { type: Number, default: null },
      savings: { type: Number, default: null },
      followUp: { type: Number, default: null },
      quality: { type: Number, default: null },
      documentation: { type: Number, default: null },
      poAccuracy: { type: Number, default: null },
      relationship: { type: Number, default: null },
      policy: { type: Number, default: null },
    },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

export default mongoose.model('PurchaseSettings', purchaseSettingsSchema);
