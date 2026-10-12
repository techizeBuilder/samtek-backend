import mongoose from 'mongoose';

// One quotation email / link to ONE vendor covering SEVERAL items
// (procurement-v2, 2026-10-08). Replaces the old one-email-per-item request:
// Purchase ticks items on a vendor's card on RFQ/PO and sends one email; the
// vendor opens /vendor-quotation/:token and prices every item on one page,
// plus their whole-quote charges and payment terms. Each item still gets its
// own VendorBid (one quote per item group per vendor, as before —
// vendorBid.quotationRequest points back here); the charges / terms live on
// this request and pre-fill the PO review. One submission only (client
// decision) — the page is read-only afterwards.
const quotationRequestSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  unit: { type: String, required: true },
  number: { type: String, required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  vendorName: { type: String, default: '' },
  token: { type: String, required: true, unique: true },
  tokenExpiry: { type: Date, required: true },
  status: { type: String, enum: ['Sent', 'Submitted', 'Expired'], default: 'Sent' },
  emailStatus: { type: String, enum: ['Sent', 'Failed'], default: 'Sent' },
  emailError: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Quote reminders (point 16, 2026-10-10 — services/quoteReminderService.js):
  // each "Send reminder" Purchase pressed (the same link, re-emailed), and
  // when the sender was nudged about no reply / the link running out.
  vendorReminders: [{
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    emailStatus: { type: String, enum: ['Sent', 'Failed'], default: 'Sent' },
    emailError: { type: String, default: '' },
  }],
  noReplyNotifiedAt: { type: Date, default: null },
  linkExpiredNotifiedAt: { type: Date, default: null },

  items: [{
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'ItemQuoteGroup', required: true },
    vendorBid: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorBid', required: true },
    itemName: { type: String, default: '' },
    itemCode: { type: String, default: '' },
    quantity: { type: Number, default: 0 },
    purchaseUnit: { type: String, default: null },
    purchaseUnitType: { type: String, default: null },
    fabricationDimensionLines: { type: mongoose.Schema.Types.Mixed, default: [] },
  }],

  // The company's template names offered on the vendor's page at send time
  // (PurchaseSettings) — a snapshot, so later template edits don't change
  // what this vendor was shown.
  offeredChargeLabels: [{ name: String, defaultGstPercent: { type: Number, default: 0 } }],
  offeredTermLabels: [{ name: String }],

  // The vendor's answer (filled once, on submission). `custom` = a name the
  // vendor added themselves — it stays on this quotation only, the company
  // template is never changed.
  charges: [{
    label: { type: String, required: true },
    amount: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    custom: { type: Boolean, default: false },
  }],
  paymentTerms: {
    advancePercent: { type: Number, default: null },
    creditDays: { type: Number, default: null },
    others: [{ label: String, value: String, custom: { type: Boolean, default: false } }],
  },
  vendorRemarks: { type: String, default: '' },
  submittedAt: { type: Date, default: null },
}, { timestamps: true });

quotationRequestSchema.index({ companyId: 1, vendor: 1, createdAt: -1 });

export default mongoose.model('QuotationRequest', quotationRequestSchema);
