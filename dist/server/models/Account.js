"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = exports.Account = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const accountSchema = new mongoose_1.default.Schema({
    accountNumber: {
        type: String,
        required: true,
        unique: true
    },
    accountName: {
        type: String,
        required: true
    },
    accountType: {
        type: String,
        enum: ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'],
        required: true
    },
    balance: {
        type: Number,
        default: 0
    },
    unit: {
        type: String,
        required: true
    },
    parentAccount: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Account'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    description: {
        type: String
    },
    isBankOrCash: {
        type: Boolean,
        default: false
    },
    bankDetails: {
        bankName: String,
        accountNumber: String,
        ifsc: String,
        branch: String,
        upiId: String
    }
}, {
    timestamps: true
});
const transactionSchema = new mongoose_1.default.Schema({
    transactionNumber: {
        type: String,
        required: true,
        unique: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    description: {
        type: String,
        required: true
    },
    reference: {
        type: String
    },
    entries: [{
            account: {
                type: mongoose_1.default.Schema.Types.ObjectId,
                ref: 'Account',
                required: true
            },
            debit: {
                type: Number,
                default: 0,
                min: 0
            },
            credit: {
                type: Number,
                default: 0,
                min: 0
            }
        }],
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    unit: {
        type: String,
        required: true
    },
    relatedDocument: {
        type: String,
        enum: ['Sale', 'Purchase', 'Order', 'Payment', 'Receipt', 'PurchaseReturn', 'SalesReturn', 'Expense']
    },
    relatedDocumentId: {
        type: mongoose_1.default.Schema.Types.ObjectId
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isApproved: {
        type: Boolean,
        default: false
    },
    approvedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User'
    },
    isReconciled: {
        type: Boolean,
        default: false
    },
    reconciliationDate: {
        type: Date
    },
    clearedAmount: {
        type: Number
    },
    mode: {
        type: String,
        enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'NEFT', 'Other'],
        default: 'Cash'
    }
}, {
    timestamps: true
});
transactionSchema.pre('save', function () {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.transactionNumber) {
            this.transactionNumber = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        }
    });
});
exports.Account = mongoose_1.default.model('Account', accountSchema);
exports.Transaction = mongoose_1.default.model('Transaction', transactionSchema);
