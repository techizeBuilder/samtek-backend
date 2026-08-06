import mongoose from 'mongoose';

// Inventory's own dynamic ("+"-addable) dropdown values — separate from R&D's
// RDMasterOption (Product/Motor/Plant Master) since these fields are
// genuinely Inventory-specific concepts with no equivalent elsewhere:
// ItemCategory (multi-select: Fabrication/Sheet Metal/Machining/Job Work/
// Assembly), SourceType (Purchase/In House), ItemSourceType (In House/Out
// Source/Both). Client's "Item Type" classification (Raw Material/Tool/
// Readymade Material/Assets/Job Work) is handled via the existing
// category/subCategory system instead, not here.
// Deliberately NOT reusing the existing Category/Group models — those are a
// different, already-live system (storeFlowService.js depends on Category's
// exact values) that this work intentionally leaves untouched.
const InventoryMasterOptionSchema = new mongoose.Schema({
  field: {
    type: String,
    enum: ['ItemCategory', 'SourceType', 'ItemSourceType'],
    required: true,
  },
  value: { type: String, required: true, trim: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

InventoryMasterOptionSchema.index({ companyId: 1, field: 1, value: 1 }, { unique: true });

export default mongoose.model('InventoryMasterOption', InventoryMasterOptionSchema);
