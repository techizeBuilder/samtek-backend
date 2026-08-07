import mongoose from 'mongoose';

// Sub Child Parts are created under a specific Child Part and only ever
// listed/selected scoped to that parent — no separate top-level collection
// needed, they live as a subdocument array here.
const SubChildPartSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true },
  isDiscontinued: { type: Boolean, default: false },
}, { timestamps: true });

// Child Part master data — created once per (manufacturing) Product, then
// picked from (not re-typed) every time a BOM is built for that product.
const RDChildPartSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  productCode: { type: String, required: true, trim: true }, // snapshot, for display without populate
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true },
  image: { type: String, default: '' },
  isDiscontinued: { type: Boolean, default: false },
  subChildParts: { type: [SubChildPartSchema], default: [] },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// Child Part code unique per product (a code can repeat across different
// products' own parts lists). Sub Child Part code uniqueness within its
// parent Child Part is enforced in the controller — Mongoose can't index
// uniqueness within a single document's subdocument array.
RDChildPartSchema.index({ company: 1, product: 1, code: 1 }, { unique: true });
RDChildPartSchema.index({ company: 1, product: 1 });

export default mongoose.model('RDChildPart', RDChildPartSchema);
