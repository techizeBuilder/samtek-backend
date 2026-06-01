"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const expenseSchema = new mongoose_1.default.Schema({
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    unit: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Production', 'Operational', 'Other'],
        default: 'Operational'
    },
    expenseType: {
        type: String,
        required: true,
        trim: true
        // e.g., Flour, Sugar, Gas, Electricity, Rent, Salary, Fuel, etc.
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    paymentMode: {
        type: String,
        enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Credit Card'],
        default: 'Cash'
    },
    notes: {
        type: String,
        trim: true
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});
// Indexes for common queries
expenseSchema.index({ companyId: 1 });
expenseSchema.index({ unit: 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });
exports.default = mongoose_1.default.model('Expense', expenseSchema);
