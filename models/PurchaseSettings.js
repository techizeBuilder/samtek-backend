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
  poApprovalThreshold: { type: Number, min: 0, default: null },
  chargeLabels: [{
    name: { type: String, trim: true, required: true },
    defaultGstPercent: { type: Number, min: 0, max: 100, default: 0 }
  }],
  termLabels: [{
    name: { type: String, trim: true, required: true }
  }],
  quoteValidityDays: { type: Number, min: 1, max: 365, default: 30 },
  priceJumpWarnPercent: { type: Number, min: 0, max: 1000, default: 10 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

export default mongoose.model('PurchaseSettings', purchaseSettingsSchema);
