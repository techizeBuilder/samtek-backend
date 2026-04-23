import mongoose from 'mongoose';

const purchaseInvoiceItemSchema = new mongoose.Schema({
    item: {
        type: mongoose.Schema.Types.ObjectId,
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

const purchaseInvoiceSchema = new mongoose.Schema({
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
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
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
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

purchaseInvoiceSchema.pre('save', function (next) {
    this.balanceAmount = this.totalAmount - this.paidAmount;
    if (this.balanceAmount <= 0) {
        this.status = 'Paid';
    } else if (this.paidAmount > 0) {
        this.status = 'Partially Paid';
    } else {
        this.status = 'Unpaid';
    }
    next();
});

export default mongoose.model('PurchaseInvoice', purchaseInvoiceSchema);
