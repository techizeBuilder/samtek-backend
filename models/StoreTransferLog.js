import mongoose from 'mongoose';

const StoreTransferLogSchema = new mongoose.Schema({
    productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
    orderId: { type: String, required: true },
    machineCode: { type: String, required: true },
    materialCode: { type: String, required: true },
    materialName: { type: String, required: true },
    quantityTransferred: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Store Employee
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// 🚨 Optimized Indexing Strategy for Store Logs
StoreTransferLogSchema.index({ company: 1, orderId: 1, createdAt: -1 }); // Fast searches
StoreTransferLogSchema.index({ company: 1, createdAt: -1 });           // Fast standard browsing
StoreTransferLogSchema.index({ productionOrderId: 1 });

export default mongoose.model('StoreTransferLog', StoreTransferLogSchema);