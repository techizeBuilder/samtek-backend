"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const purchaseRequestSchema = new mongoose_1.default.Schema({
    requestId: {
        type: String,
        required: true,
        unique: true
    },
    productName: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true
    },
    requestFromDepartment: {
        type: String,
        required: true,
        enum: ['Store', 'Production', 'QC', 'Sales', 'Other'],
        default: 'Store'
    },
    requestDate: {
        type: Date,
        default: Date.now
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'Medium'
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Ordered', 'Received'],
        default: 'Pending'
    },
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    storeOrderId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Order'
    },
    itemId: {
        type: String
    },
    purchaseOrder: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Purchase'
    }
}, { timestamps: true });
exports.default = mongoose_1.default.model('PurchaseRequest', purchaseRequestSchema);
