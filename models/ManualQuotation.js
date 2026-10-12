import mongoose from 'mongoose';

// Manual quotation with evidence (procurement-v2, 2026-10-09). Client
// blueprint §10: "Quotation evidence should be uploaded ... if quotation is
// entered manually, purchaser must record source and date."
//
// Purchase ticks items on a vendor's card on RFQ/PO → "Manual quotation" →
// uploads the proof (WhatsApp screenshot, vendor's PDF, email print, written
// quote …) and types each item's price in the SAME step. One record per
// save; each item still gets its own VendorBid (source 'Manual',
// manualQuotation → this), so the board, batching and PO work unchanged.
// New items or a new price need a new record with new evidence.
//
// Immutable once saved (blueprint §14): no edit / delete / file replace — a
// mistake is fixed by a new manual quotation, which replaces the old quotes.
// Files live in uploads/quote-evidence/ (middleware/quoteEvidenceUpload.js);
// they're written in the same request that creates this record and deleted
// if it fails, so there are never files without a record.
export const MANUAL_QUOTE_CHANNELS = ['WhatsApp', 'Vendor PDF / letterhead', 'Email (outside the system)', 'Visit / written quote', 'Other'];

const manualQuotationSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  unit: { type: String, default: null },
  number: { type: String, required: true }, // MQ-0001
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  vendorName: { type: String, default: '' },
  // How the vendor gave the quote. No "phone call" on its own — without a
  // call-recording integration a call has no proof (blueprint §10); the
  // vendor confirms in writing and that's what gets uploaded.
  channel: { type: String, enum: MANUAL_QUOTE_CHANNELS, required: true },
  channelOther: { type: String, trim: true, default: '' }, // typed when channel = Other
  // The date on the evidence — quote validity counts from here.
  quoteDate: { type: Date, required: true },
  contactPerson: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  // The vendor's charges and payment terms, as they quoted them (2026-10-09)
  // — same shape as QuotationRequest, so manual and email quotes compare on
  // the same landed cost (vendorSelectionCheckService) and pre-fill the PO
  // review the same way. `custom` = a name not in the Purchase template.
  charges: [{
    label: { type: String, trim: true },
    amount: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    custom: { type: Boolean, default: false },
  }],
  paymentTerms: {
    advancePercent: { type: Number, default: null },
    creditDays: { type: Number, default: null },
    others: [{
      label: { type: String, trim: true },
      value: { type: String, trim: true },
      custom: { type: Boolean, default: false },
    }],
  },
  files: [{
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  }],
  items: [{
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'ItemQuoteGroup' },
    vendorBid: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorBid' },
    itemName: { type: String, default: '' },
    itemCode: { type: String, default: '' },
    quantity: { type: Number, default: 0 },
    purchaseUnit: { type: String, default: '' },
    unitPrice: { type: Number, default: 0 },
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

manualQuotationSchema.index({ companyId: 1, vendor: 1, createdAt: -1 });

export default mongoose.model('ManualQuotation', manualQuotationSchema);
