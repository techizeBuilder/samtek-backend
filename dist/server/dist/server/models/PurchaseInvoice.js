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
const purchaseInvoiceItemSchema = new mongoose_1.default.Schema({
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
        min: 0.001
    },
    unitPrice: {
        type: Number,
        required: true,
        min: 0
    },
    gstPercent: {
        type: Number,
        default: 0
    },
    gstAmount: {
        type: Number,
        default: 0
    },
    totalPrice: {
        type: Number,
        required: true,
        min: 0
    }
});
const purchaseInvoiceSchema = new mongoose_1.default.Schema({
    vendor: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    invoiceNo: {
        type: String,
        required: true
    },
    invoiceDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    dueDate: {
        type: Date
    },
    items: [purchaseInvoiceItemSchema],
    subtotal: {
        type: Number,
        required: true,
        default: 0
    },
    gstAmount: {
        type: Number,
        required: true,
        default: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        default: 0
    },
    tdsAmount: {
        type: Number,
        default: 0
    },
    tdsPercent: {
        type: Number,
        default: 0
    },
    gstType: {
        type: String,
        enum: ['CGST_SGST', 'IGST'],
        default: 'CGST_SGST'
    },
    paidAmount: {
        type: Number,
        default: 0
    },
    balanceAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Unpaid', 'Partially Paid', 'Paid', 'Cancelled'],
        default: 'Unpaid'
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
    notes: {
        type: String
    }
}, {
    timestamps: true
});
// Composite unique key for vendor + invoiceNo
purchaseInvoiceSchema.index({ vendor: 1, invoiceNo: 1 }, { unique: true });
purchaseInvoiceSchema.pre('save', function () {
    return __awaiter(this, void 0, void 0, function* () {
        this.balanceAmount = this.totalAmount - this.paidAmount;
        if (this.balanceAmount <= 0) {
            this.status = 'Paid';
        }
        else if (this.paidAmount > 0) {
            this.status = 'Partially Paid';
        }
        else {
            this.status = 'Unpaid';
        }
    });
});
exports.default = mongoose_1.default.model('PurchaseInvoice', purchaseInvoiceSchema);
