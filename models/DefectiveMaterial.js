import mongoose from 'mongoose';

const defectiveInventorySchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    materialCode: { type: String, required: true },
    materialName: { type: String, required: true },
    quantity: { type: Number, required: true, default: 0, min: 0 },
    unit: String
}, { timestamps: true });

// Ensure we only have one unique record per material code per company
defectiveInventorySchema.index({ companyId: 1, materialCode: 1 }, { unique: true });

export default mongoose.model('DefectiveInventory', defectiveInventorySchema);