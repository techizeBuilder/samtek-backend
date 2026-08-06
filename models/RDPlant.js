import mongoose from 'mongoose';

// Plant Master is deliberately its OWN lightweight collection — not an Item —
// since a plant isn't a stock-carrying product, just a named grouping that
// references existing Product Master machines / Motor Master motors by id
// (+ how many of each). Used later to build sales quotations off a plant's
// machine/motor list.
const RDPlantSchema = new mongoose.Schema({
  category: { type: String, required: true, trim: true },
  subCategory: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  productionRate: { type: String, default: '', trim: true }, // e.g. "500 kg/hr"
  machines: [{
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    quantity: { type: Number, default: 1, min: 1 },
  }],
  motors: [{
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    quantity: { type: Number, default: 1, min: 1 },
  }],
  isDiscontinued: { type: Boolean, default: false },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

RDPlantSchema.index({ company: 1, category: 1, subCategory: 1 });

export default mongoose.model('RDPlant', RDPlantSchema);
