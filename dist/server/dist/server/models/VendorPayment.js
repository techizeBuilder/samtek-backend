"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const vendorPaymentSchema = new mongoose_1.default.Schema({
    vendor: {
        type: mongoose_1.default.Schema.Types.ObjectId,
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
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Account' // Reference to Bank/Cash account in ledger
    },
    unit: {
        type: String,
        required: true
    },
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    notes: {
        type: String
    }
}, {
    timestamps: true
});
exports.default = mongoose_1.default.model('VendorPayment', vendorPaymentSchema);
