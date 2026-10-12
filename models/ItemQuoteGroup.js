import mongoose from 'mongoose';

// Item-wise PR consolidation (2026-10) — the real original intent behind the
// whole Purchase redesign, only articulated clearly after 17 earlier build
// passes: By Item should show ONE combined card per item, summing every
// open PurchaseRequest's need for that item, not one card per PR. This
// model is the live, shared "current combined ask" for one item at a time —
// the thing every vendor's bid on that item's By Item card quotes against.
//
// Confirmed design (see procurement-redesign-discussion-2026-09.md's
// "Item-wise consolidation" section):
//  - Purchase explicitly SELECTS which pending PRs a round covers (not
//    automatic grouping) — purchaseRequests[] below is that selection.
//  - Selection is a binary commitment: once a PO is created from this
//    group, every PR in purchaseRequests[] counts as fully processed,
//    regardless of how much was actually ordered. To keep a PR alive for a
//    future round, Purchase must unselect it (PUT .../selection) BEFORE
//    the PO is created, not after.
//  - quantity is always a free, manually-overridable number — summed from
//    the selection as a starting default, never locked to it.
//  - Changing the selection always refreshes quantity to the new sum (see
//    itemQuoteGroupController.js's updateGroupSelection) — Purchase can
//    then retype it again. This can repeat until the group is Batched.
const itemQuoteGroupSchema = new mongoose.Schema({
  // The one real Inventory item this group is for — resolved once (via
  // resolveMasterItemId, purchaseQuoteController.js) when the group is
  // first created, and reused everywhere after (every quote against this
  // group reads itemObjectId from here instead of re-resolving per PR).
  item: {
    type: mongoose.Schema.Types.ObjectId,
    // The registered model name is 'Item' (models/Inventory.js: `export
    // const Item = mongoose.model('Item', itemSchema)`), NOT 'Inventory' —
    // easy to get wrong since the file is Inventory.js and several other
    // pre-existing models in this codebase (Purchase.js, Manufacturing.js,
    // Packing.js, ProductionGroup.js, PurchaseInvoice.js) make the exact
    // same mistake. Those happen to never populate the field so it's never
    // surfaced; this one is actually populated (listOpenGroups,
    // createQuoteForGroup), so it has to be right.
    ref: 'Item',
    required: true,
  },
  // Branch scoping (req.user.unit) — same meaning as VendorBid.unit and
  // Purchase.unit (a business location/branch), NOT a measurement unit.
  // This exact feature already overloads "unit" the other way too —
  // PurchaseRequest.unit/purchaseUnit are kg/pieces — so don't misread this
  // field against those: {item, unit} together are what the partial unique
  // index below keys on, meaning two branches can each run their own Open
  // group for the same company-wide item at the same time.
  unit: {
    type: String,
    required: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  // Open = still being selected/quoted, at most one per (item, unit) — see
  // the partial unique index below. Batched = consumed into a PO (frees the
  // item for a brand-new, empty Open group next time Purchase selects PRs
  // for it — confirmed design: no PRs selected, no quote price carried
  // over). Cancelled = abandoned with nothing ordered (not currently set by
  // any endpoint in this pass, reserved for a future explicit "discard"
  // action if ever wanted).
  status: {
    type: String,
    enum: ['Open', 'Batched', 'Cancelled'],
    default: 'Open',
  },
  // The current selection — explicit, not automatic. Every VendorBid quoted
  // against this group (VendorBid.group) is quoting on behalf of exactly
  // this set, whatever it is at the time of batching.
  purchaseRequests: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseRequest',
  }],
  // Same self-describing-snapshot pattern VendorBid.purchaseUnit/
  // purchaseUnitType already uses — set once when the group's item resolves
  // a Purchase Unit, so later steps (quoting, batching) never have to
  // re-resolve the source Item again.
  quantity: {
    type: Number,
    default: 0,
  },
  purchaseUnit: {
    type: String,
    default: null,
  },
  purchaseUnitType: {
    type: String,
    default: null,
  },
  // One card per fabrication SIZE (procurement-v2, 2026-10-09). A
  // fabrication item is ordered as pieces of one catalog size; the group
  // quantity (kg, or whatever Mass Unit the item is bought in) is CALCULATED
  // from size × pieces with resolveFabricationLines — never typed. Every
  // request in the group has exactly this size (requests are one size each,
  // see purchaseRequestController.splitFabricationLinesPerSize).
  //   sizeKey — dimensionSignature of the size; '' for a non-fabrication
  //     item (then nothing below applies and the group works as before)
  //   pieces — what will be ordered; can go UP, never below requestedPieces
  //   requestedPieces — what the selected requests ask for
  sizeKey: {
    type: String,
    default: '',
  },
  sizeValues: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  pieces: {
    type: Number,
    default: null,
  },
  requestedPieces: {
    type: Number,
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

// At most one Open group per item per branch at a time — this is what
// keeps the whole design simple: there's never a competing second
// selection for the same item to reconcile against. A Batched/Cancelled
// group doesn't count against this, so a brand-new Open group can always
// be created for the same item once the previous one is Batched.
// 2026-10-09: per SIZE for fabrication items — { item, unit, sizeKey }
// (sizeKey '' for every other item, so those keep one Open group per item).
// The old { item, unit } index must be dropped first:
// scripts/splitFabricationRequestsBySize.js does that.
itemQuoteGroupSchema.index(
  { item: 1, unit: 1, sizeKey: 1 },
  { unique: true, partialFilterExpression: { status: 'Open' } }
);

export default mongoose.model('ItemQuoteGroup', itemQuoteGroupSchema);
