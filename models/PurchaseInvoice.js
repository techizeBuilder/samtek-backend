import mongoose from 'mongoose';

const purchaseInvoiceItemSchema = new mongoose.Schema({
    item: {
        type: mongoose.Schema.Types.ObjectId,
        // The real registered model name is 'Item' (see server/models/
        // Inventory.js) — 'Inventory' is a pre-existing typo shared by a
        // few other models. Never populated before now, so it never
        // crashed; left as 'Inventory' here would break the moment
        // getPurchaseInvoices starts populating this field (2026-10, to
        // show each billed line's purchase unit).
        ref: 'Item',
        required: true
    },
    itemName: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 0.001
    },
    unitPrice: {
        type: Number,
        required: true,
        min: 0
    },
    gstPercent: {
        type: Number,
        default: 0
    },
    gstAmount: {
        type: Number,
        default: 0
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0
    }
});

const purchaseInvoiceSchema = new mongoose.Schema({
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    // Which PO this invoice was auto-generated from (2026-10) — previously
    // only a free-text mention in `notes`, not a real queryable link.
    // Optional: a manually-created invoice ("Record New Bill") has no PO.
    purchaseOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Purchase',
        default: null
    },
    invoiceNo: {
        type: String,
        required: true
    },
    invoiceDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    dueDate: {
        type: Date
    },
    items: [purchaseInvoiceItemSchema],
    subtotal: {
        type: Number,
        required: true,
        default: 0
    },
    gstAmount: {
        type: Number,
        required: true,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        default: 0
    },
    tdsAmount: {
        type: Number,
        default: 0
    },
    tdsPercent: {
        type: Number,
        default: 0
    },
    gstType: {
        type: String,
        enum: ['CGST_SGST', 'IGST'],
        default: 'CGST_SGST'
    },
    paidAmount: {
        type: Number,
        default: 0
    },
    balanceAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Unpaid', 'Partially Paid', 'Paid', 'Cancelled'],
        default: 'Unpaid'
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
        ref: 'User',
        required: true
    },
    notes: {
        type: String
    },

    // ── The PO bill (procurement-v2, 2026-10-12) ─────────────────────────
    // A PO's own invoice IS the bill (client): its payment terms decide the
    // money — the advance when the PO becomes a real order, the full
    // payment `creditDays` after every line is received AND QC-passed, and
    // an optional part payment in between for material already accepted.
    // See docs/procurement-v2/accounts-bill-ledger-payments-2026-10.md.
    // Only set on a PO's invoice; a manual "Record New Bill" leaves them.
    advancePercent: { type: Number, default: 0 },
    advanceAmount: { type: Number, default: 0 },   // fixed when the bill is made
    advancePaid: { type: Number, default: 0 },     // the advance part of paidAmount
    acceptedValue: { type: Number, default: 0 },   // material QC-passed so far, incl. GST
    fullyAcceptedAt: { type: Date, default: null },
    creditDays: { type: Number, default: null },
    overdueNotifiedAt: { type: Date, default: null }, // the full payment went overdue — Accounts told once
    stage: {
        type: String,
        enum: ['Advance due', 'Awaiting material', 'Payable', 'Paid', 'Cancelled', null],
        default: null
    },
    // Why the bill's total changed after it was made (a short close, a QC
    // rejection the vendor won't replace…). The total itself is changed by
    // whoever adds an entry here; balanceAmount always follows from it.
    adjustments: [{
        kind: { type: String, enum: ['ShortClose', 'Cancel', 'Rejection'], required: true },
        amount: { type: Number, required: true }, // ₹ taken off (positive)
        reason: { type: String, default: '' },
        ref: { type: mongoose.Schema.Types.ObjectId, default: null },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    }]
}, {
    timestamps: true
});

// Composite unique key for vendor + invoiceNo
purchaseInvoiceSchema.index({ vendor: 1, invoiceNo: 1 }, { unique: true });

// Where a PO bill stands (null for a manual bill). Exported for the
// controllers and tests.
export function billStage(inv) {
    if (!inv.purchaseOrder) return null;
    if (inv.status === 'Cancelled') return 'Cancelled';
    if ((inv.advanceAmount || 0) > 0 && (inv.advancePaid || 0) + 0.005 < inv.advanceAmount) return 'Advance due';
    if (!inv.fullyAcceptedAt) return 'Awaiting material';
    return (inv.totalAmount - (inv.paidAmount || 0)) > 0.005 ? 'Payable' : 'Paid';
}

purchaseInvoiceSchema.pre('save', async function () {
    // A cancelled invoice (its PO was cancelled — gap 13, 2026-10-09) stays
    // Cancelled with nothing owed; before this, any later save flipped it
    // back to Unpaid. Anything already paid on it is a vendor credit,
    // recorded on the PO's cancellation.
    if (this.status === 'Cancelled') {
        this.balanceAmount = 0;
        if (this.purchaseOrder) this.stage = 'Cancelled';
        return;
    }
    this.balanceAmount = this.totalAmount - this.paidAmount;
    if (this.balanceAmount <= 0) {
        this.status = 'Paid';
    } else if (this.paidAmount > 0) {
        this.status = 'Partially Paid';
    } else {
        this.status = 'Unpaid';
    }
    if (this.purchaseOrder) this.stage = billStage(this);
});

export default mongoose.model('PurchaseInvoice', purchaseInvoiceSchema);
