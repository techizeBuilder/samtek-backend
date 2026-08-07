import mongoose from 'mongoose';

// The fixed catalog of Inventory item fields BOM columns can be drawn from —
// deliberately bounded to what actually exists on Inventory's own create/edit
// form (SimpleInventoryForm.jsx), field-for-field, so BOM Format &
// Modification never offers something that isn't really there. Importance,
// Warranty, stock fields (Available Stock/Min Stock/Qty-per-Batch) and Lead
// Time are on that form too but deliberately excluded — not relevant to BOM.
export const BOM_FIELD_CATALOG = [
  { key: 'name', label: 'Item Name' },
  { key: 'code', label: 'Item Code' },
  { key: 'description', label: 'Description' },
  { key: 'brand', label: 'Brand' },
  { key: 'modelNumber', label: 'Model Number' },
  { key: 'size', label: 'Size' },
  { key: 'metrology', label: 'Metrology' },
  { key: 'materialGrade', label: 'Material Grade' },
  { key: 'unitWeightValue', label: 'Unit Weight' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'category', label: 'Category' },
  { key: 'subCategory', label: 'Sub Category' },
  { key: 'sourceType', label: 'Source Type' },
  { key: 'itemSourceType', label: 'Item Source Type' },
  { key: 'unit', label: 'Unit' },
  { key: 'itemCategories', label: 'Item Category' },
  { key: 'specifications', label: 'Specifications' },
  { key: 'applications', label: 'Applications' },
  { key: 'stdCost', label: 'Standard Cost' },
  { key: 'purchaseCost', label: 'Purchase Cost' },
  { key: 'salePrice', label: 'Sale Price' },
  { key: 'mrp', label: 'MRP' },
  { key: 'gst', label: 'GST %' },
  { key: 'hsn', label: 'HSN Code' },
];

// One config document per company — which of the fields above show up as
// columns in every BOM's material table. Editable any time; the same set
// applies to all BOMs going forward (not saved per-BOM).
const RDBOMFieldConfigSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  enabledFields: {
    type: [String],
    default: ['code', 'name', 'category', 'unit', 'purchaseCost'],
    validate: {
      validator: (arr) => arr.every(k => BOM_FIELD_CATALOG.some(f => f.key === k)),
      message: 'enabledFields must only contain keys from BOM_FIELD_CATALOG',
    },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('RDBOMFieldConfig', RDBOMFieldConfigSchema);
