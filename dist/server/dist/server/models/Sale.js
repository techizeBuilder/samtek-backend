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
const schema_js_1 = require("../shared/schema.js");
const saleItemSchema = new mongoose_1.default.Schema({
    productName: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    unitPrice: {
        type: Number,
        required: true,
        min: 0
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0
    },
    tax: {
        type: Number,
        default: 0,
        min: 0
    }
});
const saleSchema = new mongoose_1.default.Schema({
    invoiceNumber: {
        type: String,
        required: true
    },
    order: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Order'
    },
    customer: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true
    },
    items: [saleItemSchema],
    subtotal: {
        type: Number,
        required: true,
        min: 0
    },
    taxAmount: {
        type: Number,
        required: true,
        min: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    tdsAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    tdsPercent: {
        type: Number,
        default: 0,
        min: 0
    },
    paymentStatus: {
        type: String,
        enum: Object.values(schema_js_1.PAYMENT_STATUS),
        default: schema_js_1.PAYMENT_STATUS.PENDING
    },
    paymentMethod: {
        type: String,
        enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Cheque', 'UPI']
    },
    saleDate: {
        type: Date,
        default: Date.now
    },
    dueDate: {
        type: Date,
        required: true
    },
    paidDate: {
        type: Date
    },
    paidAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    balanceAmount: {
        type: Number,
        default: 0
    },
    // Advanced payment already received from Lead (before invoice)
    advancedPaymentAmount: {
        type: Number,
        default: 0,
        min: 0
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
        ref: 'User'
    },
    dispatch: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Dispatch'
    },
    notes: {
        type: String
    },
    invoiceType: {
        type: String,
        enum: ['Pakka', 'Kachha'],
        default: 'Pakka'
    },
    gstType: {
        type: String,
        enum: ['CGST_SGST', 'IGST'],
        default: 'CGST_SGST'
    },
    // Gate Pass & NOC Information
    gatePass: {
        nocStatus: { type: String, enum: ['Pending', 'Approved'], default: 'Pending' },
        gatePassNumber: { type: String },
        generatedAt: { type: Date },
        generatedBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User' },
        status: { type: String, enum: ['Pending', 'Generated'], default: 'Pending' },
        vehicleNumber: { type: String },
        driverName: { type: String },
        contactNumber: { type: String }
    },
    // Product Type (defined by Store Head)
    productType: {
        type: String,
        enum: ['In-house Manufactured', 'Purchased (Trading Product)'],
        default: null
    },
    // Inventory Availability (defined by Store Head)
    isAvailableInInventory: {
        type: String,
        enum: ['Available', 'Not Available'],
        default: null
    },
    // Track dates when reminders were sent (avoid duplicate emails)
    reminderSentDates: [
        {
            sentAt: { type: Date },
            type: { type: String, enum: ['first', 'second', 'overdue'] }
        }
    ]
}, {
    timestamps: true
});
saleSchema.pre('save', function () {
    return __awaiter(this, void 0, void 0, function* () {
        if (!this.invoiceNumber) {
            this.invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        }
        // Calculate balance: totalAmount - advancedPayment - any other paidAmount
        const totalPaid = (this.advancedPaymentAmount || 0) + (this.paidAmount || 0);
        this.balanceAmount = this.totalAmount - totalPaid;
        if (this.balanceAmount <= 0) {
            this.paymentStatus = 'Paid';
        }
        else if (totalPaid > 0) {
            this.paymentStatus = 'Partially Paid';
        }
        else {
            // Check for overdue (simplified: if dueDate is in the past)
            if (this.dueDate && new Date(this.dueDate) < new Date()) {
                this.paymentStatus = 'Overdue';
            }
            else {
                this.paymentStatus = 'Pending';
            }
        }
    });
});
exports.default = mongoose_1.default.model('Sale', saleSchema);
