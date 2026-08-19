import mongoose from 'mongoose';

// Company-added materials for the Dimension Calculator's Material dropdown,
// on top of the 5 built-in ones in fabricationCategories.js's
// MATERIAL_DENSITY_TABLE (MS/GI/SS202/SS304/SS316). Added via the "+" next
// to the Material select — user names the material and enters its density
// once; it's then reusable across every future Fabrication Item for this
// company, same "+"-to-extend-a-dropdown pattern InventoryMasterOption uses
// elsewhere in this app.
const FabricationMaterialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  densityKgM3: { type: Number, required: true, min: 0 },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

FabricationMaterialSchema.index({ company: 1, name: 1 }, { unique: true });

export default mongoose.model('FabricationMaterial', FabricationMaterialSchema);
