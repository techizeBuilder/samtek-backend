"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const schema_js_1 = require("../shared/schema.js");
const purchaseItemSchema = new mongoose_1.default.Schema({
    item: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Inventory',
        required: true
    },
    itemName: {
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
    receivedQuantity: {
        type: Number,
        default: 0,
        min: 0
    },
    pendingQuantity: {
        type: Number,
        default: 0,
        min: 0
    }
});
const purchaseSchema = new mongoose_1.default.Schema({
    purchaseOrderNumber: {
        type: String,
        required: true,
        unique: true
    },
    supplier: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    items: [purchaseItemSchema],
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    taxAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    grandTotal: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ['Draft', 'Sent', 'Acknowledged', 'Partially Received', 'Received', 'Cancelled'],
        default: 'Draft'
    },
    paymentStatus: {
        type: String,
        enum: Object.values(schema_js_1.PAYMENT_STATUS),
        default: schema_js_1.PAYMENT_STATUS.PENDING
    },
    orderDate: {
        type: Date,
        default: Date.now
    },
    expectedDeliveryDate: {
        type: Date,
        required: true
    },
    actualDeliveryDate: {
        type: Date
    },
    unit: {
        type: String,
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
    deliveryAddress: {
        type: String
    },
    terms: {
        type: String
    },
    notes: {
        type: String
    },
    isApproved: {
        type: Boolean,
        default: false
    },
    purchaseRequest: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'PurchaseRequest'
    }
}, {
    timestamps: true
});
purchaseSchema.pre('validate', function () {
    if (!this.purchaseOrderNumber) {
        this.purchaseOrderNumber = `PO-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }
    // Calculate pending quantities
    if (this.items && Array.isArray(this.items)) {
        this.items.forEach(item => {
            item.pendingQuantity = (item.quantity || 0) - (item.receivedQuantity || 0);
        });
    }
});
exports.default = mongoose_1.default.model('Purchase', purchaseSchema);
