import mongoose from 'mongoose';

const MaterialReturnLogSchema = new mongoose.Schema({
    productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
    orderId: { type: String, required: true },
    machineCode: { type: String, required: true },
    materialCode: { type: String, required: true },
    // The real Inventory Item code — equal to materialCode for every
    // non-fabrication return. Only diverges for fabrication demands, where
    // materialCode is a synthetic per-cut tracking key (see
    // ProductionOrder.js's MaterialDemandSchema comment).
    sourceItemCode: { type: String, default: null },
    fabricationCategory: { type: String, default: '' },
    bomDimensions: { type: mongoose.Schema.Types.Mixed, default: null },
    // Sheet Metal plan returns only: Production's own actually-measured
    // leftover size, kept separate from bomDimensions above (which stays
    // "what was originally demanded/sent" — untouched, still what every
    // non-plan fabrication return keys off). confirmReturn credits stock at
    // THESE dimensions instead of bomDimensions when present.
    leftoverValues: { type: mongoose.Schema.Types.Mixed, default: null },
    isSheetMetalPlanReturn: { type: Boolean, default: false },
    materialName: { type: String, required: true },
    quantityReturned: { type: Number, required: true, min: 1 },
    // 🚨 FIX: Add status tracking to allow dashboard filtering
    status: {
        type: String,
        enum: ['Pending', 'Accepted', 'Rejected'],
        default: 'Pending',
        required: true
    },
    returnType: {
        type: String,
        enum: ['Excess', 'Defect'],
        default: 'Excess',
        required: true
    },
    unit: { type: String, required: true },
    returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The Production Worker
    reason: { type: String, default: 'Excess/Defective' },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

MaterialReturnLogSchema.index({ company: 1, createdAt: -1 });
MaterialReturnLogSchema.index({ productionOrderId: 1 });

export default mongoose.model('MaterialReturnLog', MaterialReturnLogSchema);