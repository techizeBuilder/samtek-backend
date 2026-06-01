"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const bankAccountSchema = new mongoose_1.default.Schema({
    accountName: {
        type: String,
        required: true,
        trim: true
    },
    accountNumber: {
        type: String,
        required: true,
        trim: true
    },
    bankName: {
        type: String,
        required: true,
        trim: true
    },
    branchName: {
        type: String,
        trim: true
    },
    ifscCode: {
        type: String,
        trim: true
    },
    accountType: {
        type: String,
        enum: ['Savings', 'Current', 'Cash', 'FD', 'Other'],
        default: 'Current'
    },
    openingBalance: {
        type: Number,
        default: 0
    },
    currentBalance: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
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
    }
}, {
    timestamps: true
});
// Index for performance
bankAccountSchema.index({ companyId: 1 });
bankAccountSchema.index({ accountNumber: 1 });
bankAccountSchema.index({ isActive: 1 });
exports.default = mongoose_1.default.model('BankAccount', bankAccountSchema);
