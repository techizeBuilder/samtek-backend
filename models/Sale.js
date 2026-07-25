import mongoose from 'mongoose';
import { PAYMENT_STATUS } from '../shared/schema.js';

// Per-item Store flow state. Each sale item is routed and tracked
// independently (multi-item orders): Store decides its path, the linked
// QC Job / Production Order / Purchase Request reports back into these
// fields, and Dispatch opens only when every item reaches a ready status.
const ITEM_STORE_QC_STATUSES = [
  null,
  'Goes to QC',
  'Approved from QC',
  'Rejected from QC',
  'Goes to Purchase',
  'Purchase Completed',
  'Goes to Production',
  'Production Completed'
];

const saleItemSchema = new mongoose.Schema({
  productName: {
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
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  // Link to the inventory Item this row maps to (resolved from the Order
  // Form's MC Code / Item Name). Null when no inventory match was found.
  itemRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    default: null
  },
  // ── Per-item Store decision & progress (mirrors the legacy sale-level
  //    fields, which are now kept as computed aggregates for old consumers) ──
  productType: {
    type: String,
    enum: [null, 'In-house Manufactured', 'Purchased (Trading Product)'],
    default: null
  },
  isAvailableInInventory: {
    type: String,
    enum: [null, 'Available', 'Not Available'],
    default: null
  },
  storeQCStatus: {
    type: String,
    enum: ITEM_STORE_QC_STATUSES,
    default: null
  },
  // How much of this item's ordered `quantity` has been QC-approved so far.
  // Only relevant when a QC job's quantity was reduced by a partial reject
  // (see QCJob.partialRejections) — the rejected portion re-enters QC later
  // (via Rework/Repair/Purchase Exchange) as its own QC job and adds to this
  // total on its own Approve. storeQCStatus only advances to 'Approved from
  // QC' once approvedQty reaches the full quantity — for every item that was
  // never partially rejected, this still happens on the first (and only)
  // Approve, exactly as before.
  approvedQty: {
    type: Number,
    default: 0
  },
  // Which QCJob.source produced the most recent 'Rejected from QC' on this
  // item. Store sends some items (e.g. a Purchase/Manufacturing Machine
  // already sitting in stock) straight to QC itself (source: 'Store') — if
  // QC rejects that, the qty comes back to Store's inventory and Store's
  // own Check Inventory button must reactivate so Store can re-route it.
  // A 'Production' (or 'QC_Rejected' rework-cycle) rejection instead flows
  // through the Production Rework/Repair module — Store has no inventory
  // stake there, so the button stays disabled.
  lastRejectionSource: {
    type: String,
    enum: [null, 'Store', 'Production', 'QC_Rejected'],
    default: null
  }
});

// Status that means "this item is ready for packing/dispatch".
// Note: 'Purchase Completed' is NOT ready — a purchased trading item goes
// back through Store re-check → QC ('Goes to QC' → 'Approved from QC')
// before it can be packed, same as the legacy single-item loop.
export const ITEM_READY_STATUSES = ['Approved from QC'];

const saleSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  // Auto-created internally (by Store's order-info update) purely to give
  // Store/QC/Production automation a Sale record to key off of before
  // Accounts has actually generated a real invoice. Never a real Kachha/Pakka
  // bill — must be excluded from every "is this order invoiced" check.
  isPlaceholder: {
    type: Boolean,
    default: false
  },
  items: [saleItemSchema],
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  taxAmount: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  tdsAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  tdsPercent: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: Object.values(PAYMENT_STATUS),
    default: PAYMENT_STATUS.PENDING
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Cheque', 'UPI']
  },
  saleDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  paidDate: {
    type: Date
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  balanceAmount: {
    type: Number,
    default: 0
  },
  // Advanced payment already received from Lead (before invoice)
  advancedPaymentAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  unit: {
    type: String,
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dispatch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dispatch'
  },
  notes: {
    type: String
  },
  invoiceType: {
    type: String,
    enum: ['Pakka', 'Kachha'],
    default: 'Pakka'
  },
  gstType: {
    type: String,
    enum: ['CGST_SGST', 'IGST'],
    default: 'CGST_SGST'
  },
  // Gate Pass & NOC Information
  gatePass: {
    nocStatus: { type: String, enum: ['Pending', 'Approved'], default: 'Pending' },
    nocApprovedAt: { type: Date, default: null },
    gatePassNumber: { type: String },
    generatedAt: { type: Date },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['Pending', 'Generated'], default: 'Pending' },
    vehicleNumber: { type: String },
    driverName: { type: String },
    contactNumber: { type: String }
  },
  // Product Type (defined by Store Head)
  productType: {
    type: String,
    enum: ['In-house Manufactured', 'Purchased (Trading Product)'],
    default: null
  },
  // Inventory Availability (defined by Store Head)
  isAvailableInInventory: {
    type: String,
    enum: ['Available', 'Not Available'],
    default: null
  },
  // Store QC Status - visible to Store team to track where item went
  // Available path:     'Goes to QC' -> 'Approved from QC' | 'Rejected from QC'
  // Purchase path:      'Goes to Purchase' -> 'Purchase Completed'
  // Production path:    'Goes to Production' -> 'Production Completed'
  storeQCStatus: {
    type: String,
    enum: [
      null,
      'Goes to QC',
      'Approved from QC',
      'Rejected from QC',
      'Goes to Purchase',
      'Purchase Completed',
      'Goes to Production',
      'Production Completed'
    ],
    default: null
  },
  // Track dates when reminders were sent (avoid duplicate emails)
  reminderSentDates: [
    {
      sentAt: { type: Date },
      type: { type: String, enum: ['first', 'second', 'overdue'] }
    }
  ],
  paymentProofUrl: { type: String, default: '' }
}, {
  timestamps: true
});

// ── Multi-item helpers ───────────────────────────────────────────────────────

// True when this sale is tracked per-item (any item carries flow state).
// Legacy sales (created before multi-item support) have no per-item state and
// keep using the sale-level fields directly.
saleSchema.methods.hasPerItemFlow = function () {
  return (this.items || []).some(it =>
    it.storeQCStatus || it.isAvailableInInventory || it.productType
  );
};

// Recompute the legacy sale-level aggregate fields from per-item state so
// every old consumer (dashboards, NOC page, gate pass, tracking) keeps
// working unchanged. Priority: the furthest-behind item defines the order.
saleSchema.methods.recomputeAggregateStoreStatus = function () {
  if (!this.hasPerItemFlow()) return; // legacy sale — leave fields alone

  const items = (this.items || []).filter(it => (it.quantity || 0) > 0);
  const statuses = items.map(it => it.storeQCStatus);

  let agg = null;
  if (statuses.some(s => s === 'Rejected from QC')) agg = 'Rejected from QC';
  else if (statuses.some(s => !s)) agg = null; // some item not yet routed
  else if (statuses.some(s => s === 'Goes to Production')) agg = 'Goes to Production';
  else if (statuses.some(s => s === 'Goes to Purchase')) agg = 'Goes to Purchase';
  else if (statuses.some(s => s === 'Production Completed')) agg = 'Production Completed';
  else if (statuses.some(s => s === 'Purchase Completed')) agg = 'Purchase Completed';
  else if (statuses.some(s => s === 'Goes to QC')) agg = 'Goes to QC';
  else if (statuses.length > 0 && statuses.every(s => s === 'Approved from QC')) agg = 'Approved from QC';
  this.storeQCStatus = agg;

  const avails = items.map(it => it.isAvailableInInventory);
  if (avails.length && avails.every(a => a === 'Available')) this.isAvailableInInventory = 'Available';
  else if (avails.some(a => a === 'Not Available')) this.isAvailableInInventory = 'Not Available';
  else this.isAvailableInInventory = null;

  const types = items.map(it => it.productType).filter(Boolean);
  if (types.length && types.every(t => t === types[0]) && types.length === items.length) {
    this.productType = types[0];
  } else if (types.length === 0) {
    this.productType = null;
  }
  // mixed types → keep whatever was there (informational only)
};

// True when every item of this sale is ready for packing/dispatch.
saleSchema.methods.allItemsReadyForDispatch = function () {
  if (!this.hasPerItemFlow()) {
    // Legacy sale — fall back to the sale-level status
    return ITEM_READY_STATUSES.includes(this.storeQCStatus);
  }
  const items = (this.items || []).filter(it => (it.quantity || 0) > 0);
  return items.length > 0 && items.every(it => ITEM_READY_STATUSES.includes(it.storeQCStatus));
};

saleSchema.pre('save', async function () {
  if (!this.invoiceNumber) {
    this.invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  // Calculate balance: totalAmount - advancedPayment - any other paidAmount
  const totalPaid = (this.advancedPaymentAmount || 0) + (this.paidAmount || 0);
  this.balanceAmount = this.totalAmount - totalPaid;

  if (this.balanceAmount <= 0) {
    this.paymentStatus = 'Paid';
  } else if (totalPaid > 0) {
    this.paymentStatus = 'Partially Paid';
  } else {
    // Check for overdue (simplified: if dueDate is in the past)
    if (this.dueDate && new Date(this.dueDate) < new Date()) {
      this.paymentStatus = 'Overdue';
    } else {
      this.paymentStatus = 'Pending';
    }
  }
});

export default mongoose.model('Sale', saleSchema);
//sales check