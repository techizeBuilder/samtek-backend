import mongoose from 'mongoose';

// The fixed catalog of Inventory item fields BOM columns can be drawn from —
// deliberately bounded to what actually exists on Inventory's own create/edit
// form (SimpleInventoryForm.jsx) right now, field-for-field, so BOM Format &
// Modification never offers something that isn't really there. Listed in the
// same order as the form. Category/Sub Category, Size (freeform),
// Specifications/Applications/Warranty, and Pricing & Tax (Standard
// Cost/Purchase Cost/Sale Price/MRP/GST/HSN) were removed from here when they
// were removed from that form — they still exist on RDBOM.MaterialSchema for
// older BOMs' historical data, just not offered as a column choice anymore.
export const BOM_FIELD_CATALOG = [
  { key: 'itemType', label: 'Item Type' },
  { key: 'name', label: 'Item Name' },
  { key: 'code', label: 'Item Code' },
  { key: 'modelNumber', label: 'Model Number' },
  { key: 'brand', label: 'Brand' },
  { key: 'itemCategories', label: 'Item Category' },
  { key: 'sourceType', label: 'Source Type' },
  { key: 'itemSourceType', label: 'Item Source Type' },
  { key: 'metrology', label: 'Metrology' },
  { key: 'materialGrade', label: 'Material Grade' },
  { key: 'unitWeightValue', label: 'Unit Weight' },
  { key: 'unit', label: 'Used Unit' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'description', label: 'Description' },
];

// One config document per company — which of the fields above show up as
// columns in every BOM's material table. Editable any time; the same set
// applies to all BOMs going forward (not saved per-BOM).
const RDBOMFieldConfigSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  enabledFields: {
    type: [String],
    default: ['code', 'name', 'itemType', 'unit'],
    validate: {
      validator: (arr) => arr.every(k => BOM_FIELD_CATALOG.some(f => f.key === k)),
      message: 'enabledFields must only contain keys from BOM_FIELD_CATALOG',
    },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('RDBOMFieldConfig', RDBOMFieldConfigSchema);
