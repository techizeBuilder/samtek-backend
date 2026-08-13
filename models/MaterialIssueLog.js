import mongoose from 'mongoose';

const MaterialIssueLogSchema = new mongoose.Schema({
    productionOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProductionOrder',
        required: true
    },
    orderId: { type: String, required: true },
    machineCode: { type: String, required: true },
    materialCode: { type: String, required: true },
    materialName: { type: String, required: true },
    // For fabrication demands, materialCode is a synthetic per-cut tracking
    // key (itemCode#dimensionSignature) — sourceItemCode carries the real
    // Inventory Item code. Both equal materialCode for non-fabrication demands.
    sourceItemCode: { type: String, default: null },
    fabricationCategory: { type: String, default: '' },
    bomDimensions: { type: mongoose.Schema.Types.Mixed, default: null },
    quantityIssued: {
        type: Number,
        required: true,
        min: 0
    },
    unit: { type: String, required: true },
    // Tracks the production worker who received/requested the item
    issuedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    }
}, { timestamps: true });

// Index for fast searching by store employees
MaterialIssueLogSchema.index({ company: 1, orderId: 1, createdAt: -1 });
MaterialIssueLogSchema.index({ company: 1, createdAt: -1 });
MaterialIssueLogSchema.index({ company: 1, materialCode: 1 });
MaterialIssueLogSchema.index({ productionOrderId: 1 });

export default mongoose.model('MaterialIssueLog', MaterialIssueLogSchema);