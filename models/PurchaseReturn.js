import mongoose from 'mongoose';

const purchaseReturnSchema = new mongoose.Schema({
    vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true
    },
    purchaseInvoice: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PurchaseInvoice'
    },
    returnDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    items: [{
        item: {
            type: mongoose.Schema.Types.ObjectId,
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
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reason: {
        type: String
    }
}, {
    timestamps: true
});

export default mongoose.model('PurchaseReturn', purchaseReturnSchema);
