import mongoose from 'mongoose';

// StagedPurchase.js (Mongoose Schema)
const stagedPurchaseSchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    productName: String,
    materialCode: String,
    quantity: Number,
    unit: String,
    storeOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder' },
    itemId: mongoose.Schema.Types.ObjectId,
    stagedBy: String // Tracks who added it
}, { timestamps: true });


export default mongoose.model('StagedPurchase', stagedPurchaseSchema);