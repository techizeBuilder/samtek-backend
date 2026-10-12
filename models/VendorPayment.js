import mongoose from 'mongoose';

const vendorPaymentSchema = new mongoose.Schema({
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    paymentDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    amount: {
        type: Number,
        required: true,
        min: 0.01
    },
    paymentMode: {
        type: String,
        enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Other'],
        required: true
    },
    referenceNo: {
        type: String
    },
    bankAccount: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account' // Reference to Bank/Cash account in ledger
    },
    // Which invoice(s) this payment actually paid down, and how much of
    // each (2026-10) — previously no record existed anywhere of this, even
    // under the old FIFO-only behavior, so a payment had no audit trail
    // back to what it settled. Filled in regardless of whether the payment
    // targeted one specific invoice or fell through to FIFO across several.
    allocations: [{
        invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseInvoice' },
        amount: { type: Number, min: 0 },
    }],
    // A payment against a PO bill (procurement-v2, 2026-10-12): the
    // advance, or a payment for accepted material (part or full). Old
    // payments made before this have neither.
    kind: { type: String, enum: ['Advance', 'Payment', null], default: null },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
    // Paid out of credit the vendor already held of ours (no bank) — 2026-10-12.
    fromCredit: { type: Boolean, default: false },
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
    }
}, {
    timestamps: true
});

export default mongoose.model('VendorPayment', vendorPaymentSchema);
