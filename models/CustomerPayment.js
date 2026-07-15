import mongoose from 'mongoose';

const customerPaymentSchema = new mongoose.Schema({
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    // Order-wise payment tracking — which order this receipt is against.
    // null = general/unallocated receipt (FIFO across all invoices)
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        default: null
    },
    orderCode: {
        type: String,
        default: ''
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

export default mongoose.model('CustomerPayment', customerPaymentSchema);
