"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const salesmanLedgerSchema = new mongoose_1.default.Schema({
    salesmanId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    date: {
        type: Date,
        required: true,
        index: true
    },
    transactionType: {
        type: String,
        enum: ['Debit', 'Credit'],
        required: true
    },
    entryType: {
        type: String,
        enum: [
            'Cash Deposit',
            'Shortage',
            'Advance',
            'Salary',
            'Commission',
            'Expense Reimbursement',
            'Incentive',
            'Opening Balance'
        ],
        required: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    runningBalance: {
        type: Number,
        default: 0
    },
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    referenceId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        required: false
    },
    referenceType: {
        type: String,
        required: false
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});
// Index for getting historical entries for running balance
salesmanLedgerSchema.index({ salesmanId: 1, date: 1, createdAt: 1 });
const SalesmanLedger = mongoose_1.default.model('SalesmanLedger', salesmanLedgerSchema);
exports.default = SalesmanLedger;
