import mongoose from 'mongoose';

// One document per Store Head stock-audit action — a physical count compared
// against the system quantity, with a required reason, at the moment the
// adjustment was applied. Kept as its own historical-event collection (same
// convention as LeadPayment/LedgerEntry) rather than an array embedded on
// Item, so past audits stay queryable as their own list. Works for a plain
// Inventory item, a Product Master machine, or a Motor Master motor alike —
// they're all the same underlying Item collection (see inventoryController.js
// auditStock), productKind here is just for reporting/filtering later.
const stockAuditSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
    index: true
  },
  itemCode: { type: String, default: '' },
  itemName: { type: String, default: '' },
  productKind: { type: String, default: '' },
  unit: { type: String, default: '' },
  // Set only for a fabrication item — which dimensionVariants[] subdocument
  // this audit applies to (its subStock, not the item's unused top-level
  // qty). variantLabel is a snapshot so history still reads fine even if the
  // variant is later renamed/removed.
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  variantLabel: { type: String, default: '' },
  systemQty: { type: Number, required: true },
  countedQty: { type: Number, required: true },
  variance: { type: Number, required: true },
  reason: { type: String, required: true, trim: true },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  auditedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

stockAuditSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model('StockAudit', stockAuditSchema);
