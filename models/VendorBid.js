import mongoose from 'mongoose';

const vendorBidSchema = new mongoose.Schema({
  // Legacy path (RFQ Management / Vendor Bids, being retired) — kept
  // optional so old records stay valid; a new quote (purchaseRequest set
  // below) never has one.
  rfq: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RFQ',
  },
  rfqNo: {
    type: String,
  },
  // Direct PR link (Purchase redesign) — every quote created going forward
  // sets this instead of going through an RFQ. One PR can have many quotes
  // over time (one per vendor contact, any channel); whichever has the
  // latest createdAt is the active one for that PR, read live rather than
  // tracked with its own flag.
  purchaseRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequest',
  },
  // Item-wise PR consolidation (2026-10) — the group-based quote flow sets
  // THIS instead of purchaseRequest above: one combined quote now covers
  // whichever PRs are currently selected into an ItemQuoteGroup for this
  // item, not a single PR. purchaseRequest stays untouched/still used by
  // the legacy RFQ flow (createRFQ/selectVendor) and the original
  // single-PR direct-quote path — both permanently 1-PR:1-bid, kept as-is
  // rather than forced to become array-aware for no benefit. A bid has
  // either `group` or `purchaseRequest` set, never both.
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemQuoteGroup',
    default: null,
  },
  // How this quote was captured — Email is the only channel with real
  // automatic capture (the vendor fills the public token form below).
  // Manual covers everything else a vendor could say a price over — a
  // phone call, WhatsApp, in person — Purchase just types it in; there is
  // no functional difference between those, only this one label.
  source: {
    type: String,
    enum: ['Email', 'Manual'],
    default: 'Email',
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  vendorName: {
    type: String,
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  // The unit this quote's quantity/unitPrice are actually expressed in — the
  // item's own Purchase Unit when it has one (e.g. quoted/bought by the kg
  // even though stocked by the piece — same distinction PurchaseRequest.js's
  // own purchaseUnit/purchaseQuantity fields already make), otherwise null
  // and `quantity` is just the plain request quantity. Carried on the quote
  // itself so later steps (batching into a PO) never have to re-resolve the
  // source Item again to know what unit they're working in.
  purchaseUnitType: {
    type: String,
    default: null
  },
  purchaseUnit: {
    type: String,
    default: null
  },
  quantity: {
    type: Number,
    required: true
  },
  // Fabrication Master items only — same read-only breakdown snapshot as
  // RFQ.fabricationDimensionLines, copied per-vendor at invite time so this
  // vendor's own bid record (and their public quote form) can show it
  // without a populate back to the RFQ. Never affects unitPrice/totalPrice
  // math, which is always against the single `quantity` above.
  fabricationDimensionLines: {
    type: [{
      values: { type: mongoose.Schema.Types.Mixed, required: true },
      quantity: { type: Number, required: true },
      lineWeightKg: { type: Number, default: null },
    }],
    default: []
  },
  // Whether unitPrice above already includes GST, or GST sits on top of it —
  // set by whoever actually enters the rate: Purchase for a Manual quote,
  // the vendor themselves on the public bid form for an Email quote. No
  // single rule works for every vendor, so this is captured per quote.
  gstInclusive: {
    type: Boolean,
    default: false
  },
  // The GST % the vendor (or Purchase, on a manual quote) gave for this item
  // (procurement-v2, 2026-10-08) — pre-fills that line's GST on the PO
  // review. null = not given.
  gstPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  // The one email / link this quote was asked through, when it came from a
  // multi-item quotation request (procurement-v2) — that request also holds
  // the vendor's whole-quote charges and payment terms.
  quotationRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuotationRequest',
    default: null
  },
  // A manual quote's evidence (2026-10-09) — the uploaded WhatsApp / PDF /
  // email proof it was entered with (several items share one record).
  // null on manual quotes entered before evidence was required.
  manualQuotation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ManualQuotation',
    default: null
  },
  // Quote reminders (point 16, 2026-10-10): when the person who got this
  // quote was told it's about to expire — once per quote.
  expiryNotifiedAt: {
    type: Date,
    default: null
  },
  // A manual quote that replaces this vendor's earlier priced quote for the
  // same item must say why (negotiation, blueprint §10 / QT3).
  revisionReason: {
    type: String,
    trim: true,
    default: ''
  },
  replacesBid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VendorBid',
    default: null
  },
  // Bid details filled by vendor (via public form)
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  // Item-scoped vendor charges (see services/vendorChargesService.js),
  // computed once against this quote's own raw quantity × unitPrice — at
  // Manual creation, or at Email submission once the vendor's rate is
  // known. Never recomputed later, including when this quote is batched
  // into a PO (confirmed design: a quote is a quote).
  itemCharges: {
    type: [{
      name: String,
      type: { type: String, enum: ['Flat', 'Percent'] },
      value: Number,
      freeAboveAmount: Number,
      amount: Number,
      waived: Boolean,
    }],
    default: []
  },
  itemChargesTotal: {
    type: Number,
    default: 0
  },
  deliveryDays: {
    type: Number,
    required: true,
    min: 1
  },
  warrantyMonths: {
    type: Number,
    default: 0
  },
  remarks: {
    type: String
  },
  // Token for public (no-login) bid submission
  bidToken: {
    type: String,
    unique: true,
    sparse: true
  },
  tokenExpiry: {
    type: Date
  },
  // Status tracking
  // Declined   — the vendor left this item blank on a quotation request
  // Superseded — replaced by a newer quote from the same vendor for the same
  //              item group; kept so the quote history shows every price
  //              (procurement-v2, 2026-10-08)
  status: {
    type: String,
    enum: ['Invited', 'Submitted', 'Selected', 'Rejected', 'Declined', 'Superseded'],
    default: 'Invited'
  },
  submittedAt: {
    type: Date
  },
  // Tracks whether the RFQ invite email actually reached this vendor, so a
  // failed send (e.g. Purchase SMTP unconfigured) is visible per-vendor
  // instead of only in the create-time API response, and can be retried.
  emailStatus: {
    type: String,
    enum: ['Sent', 'Failed'],
    default: 'Sent'
  },
  emailError: {
    type: String
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  unit: {
    type: String,
    required: true
  }
}, { timestamps: true });

export default mongoose.model('VendorBid', vendorBidSchema);
