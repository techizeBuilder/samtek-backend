import mongoose from 'mongoose';

// Sub Child Parts are created under a specific Child Part and only ever
// listed/selected scoped to that parent — no separate top-level collection
// needed, they live as a subdocument array here.
const SubChildPartSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true },
  // Same "Design File" upload the parent Child Part has (image field
  // below) — image or PDF, stored the identical way, so Sub Child Parts get
  // the same Documentation-page visibility (see Documentation.jsx's
  // childPartDocs merge).
  image: { type: String, default: '' },
  // Denormalized the same way name/code/image already are — mirrors
  // Item.specification so this list doesn't need to populate the linked
  // Item just to show it.
  specification: { type: String, default: '', trim: true },
  isDiscontinued: { type: Boolean, default: false },
  // Sub Child Part Inventory — an Item (productKind: 'ChildPart') that
  // Production builds to stock and Store holds, reusable across every
  // machine that links to the SAME one here. Set either by auto-creating a
  // new one (typing a brand-new code) or by picking an existing one (same
  // real part reused on this machine too) — see addSubChildPart. Item.code
  // is globally unique per company, so once linked, "same code" is
  // guaranteed to mean "same part", never a coincidental collision.
  inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
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
