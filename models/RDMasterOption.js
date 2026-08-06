import mongoose from 'mongoose';

const RDMasterOptionSchema = new mongoose.Schema({
    // The dropdown this option belongs to
    field: {
        type: String,
        // MotorCategory/MotorSubCategory: Motor Master's own scoped, cascading
        // classification (MotorSubCategory.parentValue -> a MotorCategory value) —
        // deliberately separate from Product Master's Category so the two lists
        // never mix, same reasoning as Category vs MaterialType above.
        enum: ['Category', 'P-Type', 'P-SourceType', 'Metrology', 'MaterialType', 'MotorCategory', 'MotorSubCategory', 'MotorType', 'MaterialGrade', 'PowerSource', 'PlantCategory', 'PlantSubCategory'],
        required: true
    },
    // The actual text value in the dropdown
    value: { type: String, required: true, trim: true },
    // For cascading dropdowns: P-Type -> Category -> P-SourceType.
    // Null means top-level (P-Type) or unlinked legacy data.
    parentValue: { type: String, default: null, trim: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

// Prevent duplicate options in the same dropdown (under the same parent) for the same company
RDMasterOptionSchema.index({ company: 1, field: 1, value: 1, parentValue: 1 }, { unique: true });

export default mongoose.model('RDMasterOption', RDMasterOptionSchema);