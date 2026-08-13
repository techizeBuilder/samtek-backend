import mongoose from 'mongoose';

const StoreTransferLogSchema = new mongoose.Schema({
    productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
    orderId: { type: String, required: true },
    machineCode: { type: String, required: true },
    materialCode: { type: String, required: true },
    // The real Inventory Item code — equal to materialCode for every
    // non-fabrication transfer. Only diverges for fabrication demands, where
    // materialCode is a synthetic per-cut tracking key (see
    // ProductionOrder.js's MaterialDemandSchema comment).
    sourceItemCode: { type: String, default: null },
    materialName: { type: String, required: true },
    quantityTransferred: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    // Fabrication Master transfers only — audit trail of what was actually
    // cut: which stock variant it came from, the exact size sent to
    // Production, and (if Store recorded one) the leftover piece's size.
    fromDimensions: { type: mongoose.Schema.Types.Mixed, default: null },
    toDimensions: { type: mongoose.Schema.Types.Mixed, default: null },
    leftoverDimensions: { type: mongoose.Schema.Types.Mixed, default: null },
    transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Store Employee
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

// 🚨 Optimized Indexing Strategy for Store Logs
StoreTransferLogSchema.index({ company: 1, orderId: 1, createdAt: -1 }); // Fast searches
StoreTransferLogSchema.index({ company: 1, createdAt: -1 });           // Fast standard browsing
StoreTransferLogSchema.index({ productionOrderId: 1 });

export default mongoose.model('StoreTransferLog', StoreTransferLogSchema);