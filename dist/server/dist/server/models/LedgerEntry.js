"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ledgerEntrySchema = new mongoose_1.default.Schema({
    entryNumber: {
        type: String,
        required: true,
        unique: true
    },
    entryDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    entryType: {
        type: String,
        enum: ['Receipt', 'Payment', 'Journal', 'Contra'],
        required: true
    },
    referenceType: {
        type: String,
        enum: ['Lead Payment', 'Customer Payment', 'Vendor Payment', 'Expense', 'Sale', 'Purchase', 'Other'],
        required: true
    },
    referenceId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        required: true
    },
    referenceNumber: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    totalAmount: {
        type: Number,
        required: true
    },
    // Double Entry Accounting - Each entry has multiple line items
    lineItems: [{
            accountType: {
                type: String,
                enum: ['Bank', 'Cash', 'Customer', 'Vendor', 'Income', 'Expense', 'Asset', 'Liability', 'Equity'],
                required: true
            },
            accountId: {
                type: mongoose_1.default.Schema.Types.ObjectId,
                required: true
            },
            accountName: {
                type: String,
                required: true
            },
            debitAmount: {
                type: Number,
                default: 0
            },
            creditAmount: {
                type: Number,
                default: 0
            },
            description: String
        }],
    status: {
        type: String,
        enum: ['Draft', 'Posted', 'Cancelled'],
        default: 'Posted'
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
    approvedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedDate: Date
}, {
    timestamps: true
});
// Index for performance
ledgerEntrySchema.index({ companyId: 1 });
ledgerEntrySchema.index({ entryDate: 1 });
ledgerEntrySchema.index({ entryType: 1 });
ledgerEntrySchema.index({ referenceType: 1 });
ledgerEntrySchema.index({ referenceId: 1 });
ledgerEntrySchema.index({ status: 1 });
// Auto-generate entry number
ledgerEntrySchema.pre('validate', function (next) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.entryNumber) {
            const count = yield mongoose_1.default.model('LedgerEntry').countDocuments({ companyId: this.companyId });
            this.entryNumber = `LE-${String(count + 1).padStart(6, '0')}`;
        }
        if (next)
            next();
    });
});
exports.default = mongoose_1.default.model('LedgerEntry', ledgerEntrySchema);
