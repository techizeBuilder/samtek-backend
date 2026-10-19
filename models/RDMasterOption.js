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
    // Null means top-level (P-Type) or unlinked legacy data. The parent's
    // TEXT, kept in step with it — products store text and the filter pages
    // read it. Which parent it is comes from parentId below.
    parentValue: { type: String, default: null, trim: true },
    // The parent option itself (2026-10-19, client bug). Linking by name only
    // made two same-named parents share one list: a Sub Category "Chakki"
    // under a new Category showed the Product Names / Variants of the
    // "Chakki" under another Category, and the same name couldn't be added
    // to both. Null for top-level values (and unmatched legacy orphans).
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'RDMasterOption', default: null },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

// No duplicate in the same dropdown under the same parent: the same name under
// two different parents (two "Chakki"s) is allowed. parentValue keeps old
// orphans (no parentId) distinct.
RDMasterOptionSchema.index({ company: 1, field: 1, value: 1, parentId: 1, parentValue: 1 }, { unique: true });

export default mongoose.model('RDMasterOption', RDMasterOptionSchema);