import mongoose from 'mongoose';

const rdRequestSchema = new mongoose.Schema({
    productionOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProductionOrder',
        required: true
    },
    machineCode: { type: String, required: true },
    machineName: { type: String, required: true },

    // ── NEW: Distinguish between the two workflows ──
    requestType: {
        type: String,
        enum: ['Initial BOM', 'Material Change'],
        default: 'Initial BOM'
    },

    // ── NEW: Holds data if requestType is 'Material Change' ──
    materialChangeDetails: {
        materialCode: String,
        materialName: String,
        bomQuantity: { type: Number, default: null },
        requestedQuantity: Number,
        unit: String
    },

    status: {
        type: String,
        enum: ['Pending', 'Drafting BOM', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    // Who approved/rejected this request, and when — and why, for rejections.
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
    rejectReason: { type: String, default: null },
    draftBOM: [{
        itemCode: { type: String, required: true },
        quantity: { type: Number, required: true },
        notes: String
    }],
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model('RDRequest', rdRequestSchema);