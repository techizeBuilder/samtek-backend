"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const purchaseReturnSchema = new mongoose_1.default.Schema({
    vendor: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    purchaseInvoice: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'PurchaseInvoice'
    },
    returnDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    items: [{
            item: {
                type: mongoose_1.default.Schema.Types.ObjectId,
                ref: 'Item',
                required: true
            },
            itemName: String,
            quantity: Number,
            unitPrice: Number,
            gstPercent: Number,
            gstAmount: Number,
            totalPrice: Number
        }],
    subtotal: {
        type: Number,
        default: 0
    },
    gstAmount: {
        type: Number,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true
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
    reason: {
        type: String
    }
}, {
    timestamps: true
});
exports.default = mongoose_1.default.model('PurchaseReturn', purchaseReturnSchema);
