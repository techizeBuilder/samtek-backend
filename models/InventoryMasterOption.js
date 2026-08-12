import mongoose from 'mongoose';

// Inventory's own dynamic ("+"-addable) dropdown values — separate from R&D's
// RDMasterOption (Product/Motor/Plant Master) since these fields are
// genuinely Inventory-specific concepts with no equivalent elsewhere:
// ItemCategory (multi-select: Fabrication/Sheet Metal/Machining/Job Work/
// Assembly), SourceType (Purchase/In House), ItemSourceType (In House/Out
// Source/Both), ItemType (the client's real business classification — Raw
// Material/Tool/Readymade Material/Assets).
// Deliberately NOT reusing the existing Category/Group models — those are a
// different, already-live system used by Product/Motor Master's own
// dropdowns and Sales/Quotation filtering, left untouched by this.
const InventoryMasterOptionSchema = new mongoose.Schema({
  field: {
    type: String,
    enum: ['ItemCategory', 'SourceType', 'ItemSourceType', 'ItemType', 'ItemProcessType'],
    required: true,
  },
  value: { type: String, required: true, trim: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

InventoryMasterOptionSchema.index({ companyId: 1, field: 1, value: 1 }, { unique: true });

export default mongoose.model('InventoryMasterOption', InventoryMasterOptionSchema);
