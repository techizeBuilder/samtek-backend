import mongoose from 'mongoose';

const MaterialReturnLogSchema = new mongoose.Schema({
    productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true },
    orderId: { type: String, required: true },
    machineCode: { type: String, required: true },
    materialCode: { type: String, required: true },
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