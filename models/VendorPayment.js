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
