import mongoose from 'mongoose';

const RDMasterOptionSchema = new mongoose.Schema({
    // The dropdown this option belongs to
    field: {
        type: String,
        // MotorCategory/MotorSubCategory: Motor Master's own scoped, cascading
        // classification (MotorSubCategory.parentValue -> a MotorCategory value) —
        // deliberately separate from Product Master's Category so the two lists
        // never mix, same reasoning as Category vs MaterialType above.
        // ProductName/ProductVariant: a second, parallel cascade off P-Type
        // (ProductName.parentValue -> a P-Type value, ProductVariant.parentValue
        // -> a ProductName value) — pre-entering the product name/variant
        // vocabulary ahead of time so Add Product picks from it instead of
        // free-typing (confirmed 2026-09-02).
        // PlantName/PlantProduction: same pre-entered-vocabulary pattern for
        // Plant Master's own chain — PlantCategory -> PlantSubCategory ->
        // PlantName -> PlantProduction (confirmed 2026-09-02, no custom-fields
        // feature for Plant Master, just the classification hierarchy).
        enum: ['Category', 'P-Type', 'P-SourceType', 'Metrology', 'MaterialType', 'MotorCategory', 'MotorSubCategory', 'MotorType', 'MaterialGrade', 'PowerSource', 'PlantCategory', 'PlantSubCategory', 'ProductName', 'ProductVariant', 'PlantName', 'PlantProduction'],
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