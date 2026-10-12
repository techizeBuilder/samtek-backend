import mongoose from 'mongoose';
import { PAYMENT_STATUS } from '../shared/schema.js';

const purchaseItemSchema = new mongoose.Schema({
  item: {
    type: mongoose.Schema.Types.ObjectId,
    // The real registered model name is 'Item' (see server/models/
    // Inventory.js) — 'Inventory' is a pre-existing typo shared by a few
    // other models (ItemQuoteGroup.js and PurchaseInvoice.js both had the
    // same bug, fixed 2026-10). Never populated before now, so it never
    // crashed; left as 'Inventory' here would break the moment getPurchases
    // starts populating it (2026-10, for Store's line-level receive dialogs
    // to read a line's real stock unit).
    ref: 'Item',
    required: false,  // Optional — item link is added when goods are received into inventory
    default: null
  },
  itemName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
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
  // Item-scoped vendor charges, carried straight from this line's quote
  // (VendorBid.itemCharges/itemChargesTotal) — decided once at quote time,
  // never recalculated here at batch time (see vendorChargesService.js).
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
  // Real GST, computed once here at PO creation (2026-10) — previously
  // nothing actually multiplied the vendor's gstRate against anything;
  // `Purchase.taxAmount` just took whatever the request sent, which was
  // always 0 since no caller sent one. gstInclusive is carried from this
  // line's own quote (VendorBid.gstInclusive); gstRate is the vendor's rate
  // actually used; gstAmount is this line's own computed tax — 0 when
  // gstInclusive is true (the quoted unitPrice already contains it, so
  // adding it again to Purchase.taxAmount would double-count against
  // grandTotal). The invoice (createAutoPurchaseInvoice) copies these
  // verbatim, never recomputes.
  gstInclusive: {
    type: Boolean,
    default: false
  },
  // The GST % typed for this line at PO creation (procurement-v2,
  // 2026-10-08 — GST moved off Vendor Master onto the PO, per item line,
  // since one PO can mix items with different rates).
  gstRate: {
    type: Number,
    default: 0
  },
  gstAmount: {
    type: Number,
    default: 0
  },
  // Stored on the line (procurement-v2) so a PO waiting for Company Admin
  // approval can be finalized later from its own record — the winning quote
  // (losing quotes on the same group get rejected at finalize), and the
  // purchase unit the quantity/rate are in (synced onto each PR).
  vendorBid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VendorBid',
    default: null
  },
  purchaseUnit: { type: String, default: null },
  purchaseUnitType: { type: String, default: null },
  // Legacy — only the old RFQ-era receive endpoint
  // (purchaseController.js's own receivePurchase) ever wrote these. The new
  // quote->batch flow receives on the PurchaseRequest itself (status/
  // receivedAt), never touches these, so they stay 0 for any PO created
  // that way — not a bug to fix, just dead weight from the earlier design.
  // Real per-line receive status for the new flow reads `purchaseRequest`
  // below instead.
  receivedQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  pendingQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  // Which PurchaseRequest this line came from (2026-10) — lets the By
  // Vendor tab's Active POs view show real per-line receive status
  // (PurchaseRequest.status) instead of the dead receivedQuantity above.
  // Optional: legacy POs and any caller that doesn't tag a line keep
  // working, just without this link.
  purchaseRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequest',
    default: null
  },
  // Item-wise PR consolidation (2026-10) — plural, additive, alongside
  // purchaseRequest above. A line created from an ItemQuoteGroup carries
  // EVERY PR that group's selection covered, not just one. purchaseRequest
  // (singular) stays as-is and is still what the legacy RFQ-to-PO path
  // (rfqController.js's selectVendor) and the single-item "Create PO"
  // modal (PurchaseRequest.jsx) write — both permanently one-PR-per-line.
  // A line has either purchaseRequests (new flow) or purchaseRequest
  // (legacy), never both populated meaningfully.
  //
  // NAMING HAZARD — read before touching either array: this is a
  // *per-line* list (just this line's own PRs). It is NOT the same as the
  // existing *top-level* `Purchase.purchaseRequests` further down this
  // file, which lists every PR across the WHOLE batch. Two different
  // schema paths, same field name, one level apart — don't confuse them.
  //
  // Every reader of purchaseRequest/purchaseRequests on a line should go
  // through one shared normalize-to-array helper (prIdsOf, exported from
  // purchaseController.js) rather than reimplementing this fallback.
  purchaseRequests: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest' }],
    default: []
  },
  // Traceability only (2026-10) — which ItemQuoteGroup this line's winning
  // bid came from, if any. Not read by any sync/status logic; purely for
  // audit/debugging back to the quote round that produced this line.
  itemQuoteGroup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemQuoteGroup',
    default: null
  },
  // This line's own expected delivery date (2026-10) — computed server-side
  // from its quote's own deliveryDays at batch time (orderDate + that many
  // days), since a batch's lines can each have been quoted with a
  // different delivery promise. The PO's own top-level expectedDeliveryDate
  // is the latest of these (see createPurchase) — kept for anything that
  // still needs one single order-level date — but Store receives and this
  // tracks progress per line, not against that one shared date.
  expectedDeliveryDate: {
    type: Date,
    default: null
  },
  // The delivery time the vendor quoted for this line, in days
  // (2026-10-12). With an advance on the PO, the line's date is only set
  // when the advance is paid (that date + these days — client); until
  // then expectedDeliveryDate stays null ("Waiting for advance").
  deliveryDays: {
    type: Number,
    default: null
  },
  // This line's own quoted warranty (2026-10), carried straight from
  // VendorBid.warrantyMonths at batch time — previously only ever folded
  // into the free-text Purchase.terms string and never read back anywhere.
  // Lets Store's receive step ask for warranty only when the vendor
  // actually quoted one (0/unset = this material has no warranty, don't
  // force Store to enter anything), instead of demanding it on every
  // single receive regardless of whether one was ever promised.
  warrantyMonths: {
    type: Number,
    default: 0
  },
  // Fabrication Master items only — read-only dimension-breakdown snapshot
  // carried from the RFQ, for the (separately deferred) Store-receiving flow
  // to eventually reconcile a delivered bulk weight back into per-dimension
  // stock. Never affects unitPrice/totalPrice, which stay against the single
  // aggregate `quantity` above.
  fabricationDimensionLines: {
    type: [{
      values: { type: mongoose.Schema.Types.Mixed, required: true },
      quantity: { type: Number, required: true },
      lineWeightKg: { type: Number, default: null },
    }],
    default: []
  },
  // Delivery follow-up (2026-10-10, blueprint §17 step 13): every change of
  // this line's expected date, with the vendor's reason — the date itself
  // stays in expectedDeliveryDate. overdueNotifiedFor = the date the overdue
  // alert already went out for, so each date alerts once
  // (services/deliveryFollowUpService.js).
  deliveryDateHistory: {
    type: [{
      from: { type: Date, default: null },
      to: { type: Date, required: true },
      reason: { type: String, trim: true, default: '' },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      byName: { type: String, default: '' },
      at: { type: Date, default: Date.now },
    }],
    default: []
  },
  overdueNotifiedFor: { type: Date, default: null },
  // Set when this line was cancelled (gap 13, 2026-10-09) — the whole PO, or
  // a short close of what wasn't received. null = a live line. A cancelled
  // line stays on the PO for the record but can't be received.
  cancelled: {
    type: new mongoose.Schema({
      at: { type: Date, default: null },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    }, { _id: false }),
    default: null
  }
});

// Cancelling a PO (gap 13, 2026-10-09 — services/poCancellationService.js).
// Purchase asks, the Company Admin decides. Every request is kept, including
// refused ones. A PO is never edited after it's ordered: a change of price /
// quantity = cancel and order again.
export const PO_CANCEL_REASONS = ['Vendor can\'t supply', 'Vendor changed price', 'Vendor delay', 'Need no longer exists', 'Ordered by mistake', 'Other'];
const poCancellationSchema = new mongoose.Schema({
  status: { type: String, enum: ['Requested', 'Approved', 'Rejected'], default: 'Requested' },
  // Full = every line; ShortClose = only the lines not yet received. Set on approval.
  kind: { type: String, enum: ['Full', 'ShortClose', null], default: null },
  reasons: { type: [String], default: [] },
  side: { type: String, enum: ['Vendor', 'Ours'], required: true }, // whose side the cancel is on
  note: { type: String, trim: true, default: '' },
  // Requests Purchase marked "no longer needed" — closed instead of reopened.
  closeRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest' }],
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  requestedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  remarks: { type: String, trim: true, default: '' },
  // Filled on approval:
  lines: [{ type: mongoose.Schema.Types.ObjectId }], // the line ids actually cancelled
  vendorCredit: { type: Number, default: 0 },          // advance paid above what's still owed
  invoiceNote: { type: String, default: '' },
  emailSent: { type: Boolean, default: false },
}, { _id: true });

const purchaseSchema = new mongoose.Schema({
  purchaseOrderNumber: {
    type: String,
    required: true,
    unique: true
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  items: [purchaseItemSchema],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  // PO-scoped vendor charges (see vendorChargesService.js) — only knowable
  // once this batch's full raw goods value exists, so computed fresh here
  // at PO creation, against totalAmount (raw, pre-tax, pre-charges) —
  // never recalculated afterward. grandTotal = totalAmount + taxAmount +
  // poChargesTotal + the sum of every item's own itemChargesTotal.
  poCharges: {
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
  poChargesTotal: {
    type: Number,
    default: 0
  },
  // ── PO-time terms (procurement-v2, 2026-10-08) ────────────────────────────
  // Charges and payment terms are typed when the PO is created, whole-PO,
  // from the Purchase master template of names (PurchaseSettings) — they're
  // no longer vendor defaults. poCharges / items[].itemCharges above are the
  // OLD automatic vendor charges: kept readable for old POs, never written now.
  charges: {
    type: [{
      label: { type: String, required: true },
      amount: { type: Number, min: 0, default: 0 },
      gstPercent: { type: Number, min: 0, max: 100, default: 0 },
      gstAmount: { type: Number, default: 0 },
    }],
    default: []
  },
  chargesTotal: { type: Number, default: 0 },
  chargesGstTotal: { type: Number, default: 0 },
  // Advance % and Credit Days are built in — the system uses them: the
  // advance is due when the PO becomes a real order, and the full payment
  // is due Credit Days after every line is received and QC-passed (blank /
  // 0 = straight away) — 2026-10-12, see models/PurchaseInvoice.js.
  // `others` are the template's free-text terms, printed on the PO.
  paymentTerms: {
    advancePercent: { type: Number, min: 0, max: 100, default: null },
    creditDays: { type: Number, min: 0, default: null },
    others: {
      type: [{ label: String, value: String }],
      default: []
    }
  },
  // Company Admin approval (procurement-v2): a PO whose grandTotal is above
  // PurchaseSettings.poApprovalThreshold is saved as 'Pending Approval' with
  // NO side effects (no PR links, no invoice, groups stay Open) until the
  // Company Admin approves it (purchaseController.finalizePurchase) or
  // rejects it (status 'Rejected').
  approval: {
    required: { type: Boolean, default: false },
    threshold: { type: Number, default: null },
    decision: { type: String, enum: ['Pending', 'Approved', 'Rejected', null], default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: '' },
    // Why it needs approval (2026-10-09): 'threshold' (over the ₹ limit)
    // and/or 'selection' (failed the vendor selection check — gap 12).
    reasons: { type: [String], default: [] }
  },
  // Vendor selection check at PO time (gap 12, blueprint §11 "preserve the
  // calculated score"): the snapshot the server calculated when the PO was
  // created — competition per line, landed-cost basket, item hints — plus
  // Purchase's reason when it failed. null on POs not made from quotes.
  selectionCheck: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  cancellations: { type: [poCancellationSchema], default: [] },
  // CGST + SGST vs IGST (point 15, 2026-10-10 — services/gstStateService.js),
  // fixed when the PO is created from the company's and the vendor's GSTIN /
  // state: { type: 'CGST_SGST' | 'IGST' | null, ours: {code, name}, theirs:
  // {code, name}, missing }. type null = a side couldn't be told. The GST
  // amounts don't change — only how they're split and labelled.
  gstSplit: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  // grandTotal = goods (qty × rate) + line GST (exclusive lines) + charges +
  // charges' GST (+ old poCharges/itemCharges on legacy POs).
  grandTotal: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    // 'Pending Approval' / 'Rejected' — Company Admin PO approval
    // (procurement-v2). Neither is ever shown to Store or Dispatch.
    enum: ['Pending Approval', 'Rejected', 'Draft', 'Sent', 'Acknowledged', 'Partially Received', 'Received', 'Cancelled'],
    default: 'Draft'
  },
  paymentStatus: {
    type: String,
    enum: Object.values(PAYMENT_STATUS),
    default: PAYMENT_STATUS.PENDING
  },
  orderDate: {
    type: Date,
    default: Date.now
  },
  // The latest live line date. Not required any more (2026-10-12): a PO
  // with an advance has no dates until the advance is paid.
  expectedDeliveryDate: {
    type: Date,
    default: null
  },
  // When the vendor's delivery days start counting (client, 2026-10-12):
  // 'advance' — from the day the full advance is paid (startedAt is set
  // then); 'order' — from the PO date (no advance). null on POs made
  // before this, which keep the dates they were given.
  deliveryClock: {
    startsOn: { type: String, enum: ['advance', 'order', null], default: null },
    startedAt: { type: Date, default: null }
  },
  actualDeliveryDate: {
    type: Date
  },
  // Who physically handles getting this order here (2026-10) — chosen by
  // Purchase at batch-creation time (By Vendor tab). 'Company' means
  // Logistics/Dispatch needs to arrange a pickup from the vendor; see the
  // Dispatch stub page that reads this. Also what PO-scoped charges marked
  // isTransportCharge (Supplier.charges) get excluded against — if the
  // company is handling transport itself, the vendor's own freight charge
  // shouldn't apply (see vendorChargesService.js's excludeTransportCharges).
  transportBy: {
    type: String,
    enum: ['Vendor', 'Company'],
    default: 'Vendor'
  },
  unit: {
    type: String,
    required: true
  },
  // Added 2026-10-06 — this model had NO company-level scoping at all
  // before this, only `unit` (a branch-name string, above). Confirmed via a
  // real cross-tenant collision in the live DB (two different companies
  // both using the branch name "Test Unit") that `unit`-only scoping is a
  // genuine data-isolation gap, not a theoretical one — same issue as
  // Supplier.js, fixed the same way. `unit` stays exactly as-is ("which
  // branch within this company"); companyId is the actual tenant boundary,
  // layered on top everywhere this model is queried. Existing documents
  // were backfilled by scripts/backfillSupplierPurchaseCompanyId.js.
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deliveryAddress: {
    type: String
  },
  terms: {
    type: String
  },
  notes: {
    type: String
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  // Plural — a PO can now be a real batch of several independently-raised
  // PRs for the same vendor, not just one. Each included PR gets its own
  // {purchaseOrder, status:'Ordered'} flip (see purchaseController.js).
  purchaseRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequest'
  }]
}, {
  timestamps: true
});

purchaseSchema.pre('validate', function () {
  if (!this.purchaseOrderNumber) {
    this.purchaseOrderNumber = `PO-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  // Calculate pending quantities
  if (this.items && Array.isArray(this.items)) {
    this.items.forEach(item => {
      item.pendingQuantity = (item.quantity || 0) - (item.receivedQuantity || 0);
    });
  }
});

export default mongoose.model('Purchase', purchaseSchema);
