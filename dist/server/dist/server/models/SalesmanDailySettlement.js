"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const salesmanDailySettlementSchema = new mongoose_1.default.Schema({
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
    totalInvoiceSale: {
        type: Number,
        default: 0
    },
    totalReturn: {
        type: Number,
        default: 0
    },
    cashSale: {
        type: Number,
        default: 0
    },
    creditSale: {
        type: Number,
        default: 0
    },
    expectedCash: {
        type: Number,
        default: 0
    },
    actualCash: {
        type: Number,
        default: 0
    },
    transactionType: {
        type: String,
        enum: ['Debit', 'Credit'],
        default: 'Credit'
    },
    entryType: {
        type: String,
        required: true
    },
    bankAccountId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Account',
        default: null
    },
    difference: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Shortage', 'Excess', 'Clear'],
        default: 'Clear'
    },
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    settledBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});
// Calculate status and difference before saving
salesmanDailySettlementSchema.pre('save', function (next) {
    this.difference = this.actualCash - this.expectedCash;
    if (this.difference < 0) {
        this.status = 'Shortage';
    }
    else if (this.difference > 0) {
        this.status = 'Excess';
    }
    else {
        this.status = 'Clear';
    }
    next();
});
const SalesmanDailySettlement = mongoose_1.default.model('SalesmanDailySettlement', salesmanDailySettlementSchema);
exports.default = SalesmanDailySettlement;
