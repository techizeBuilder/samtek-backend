import mongoose from 'mongoose';

// Fabrication Master is deliberately its OWN lightweight collection — not an
// Item — same reasoning as RDPlant.js: it's a catalog of raw-material shapes
// (Metal Sheet, Angle, Pipe, Beam...) with pre-computed per-piece weights per
// dimension variant, not itself a stock-carrying/purchasable thing. When an
// Inventory Item is created from one of these (see Inventory.js's
// `fabricationRef`/`dimensionVariants`), Inventory gets its own copy of the
// dimensions with a per-dimension `subStock` counter — stock only ever lives
// on the Item side, never here.
const FabricationMasterSchema = new mongoose.Schema({
  itemName: { type: String, required: true, trim: true },
  itemCode: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true }, // FABRICATION_CATEGORIES[].key
  density: {
    value: { type: Number, required: true },
    unit: { type: String, enum: ['kg/m3', 'g/cm3'], default: 'kg/m3' },
  },
  dimensions: [{
    // Mixed, not Map — Map fields serialize to {} whenever a response path
    // goes through .toObject()/.lean() without flattenMaps (e.g. Inventory's
    // getItemById); Mixed stores the same shape-specific key/value bag
    // (thickness, width, length, etc.) without that pitfall.
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    designation: { type: String, default: '', trim: true }, // only for lookup categories, e.g. "IPE 200"
    weightPerMeterKg: { type: Number, default: null }, // null for the sheet/plate category
    weightPerPieceKg: { type: Number, required: true },
    // pieces: Dimension Calculator convenience field (Total Weight =
    // weightPerPieceKg x pieces). pricePerKg: no longer collected by the
    // form (removed — a manual price here duplicated/conflicted with
    // Accounts' own real pricing, Item.weightUnitPrice); field kept, always
    // null on new rows, purely so a pre-existing row saved before removal
    // keeps its old value instead of losing data on the next edit.
    pieces: { type: Number, default: 1 },
    pricePerKg: { type: Number, default: null },
  }],
  isDiscontinued: { type: Boolean, default: false },
  // Purchase/Used/Receive Unit — same Type+Unit pairing Inventory's Add Item
  // form uses (UnitType collection, see Inventory.js's unitTypeSchema).
  // Carried on the catalog entry so picking a Fabrication Item in Inventory's
  // Add Item (see FabricationItemPicker.jsx) can auto-fill these onto the
  // new Item, the same way dimensions already auto-fill.
  purchaseUnitType: { type: String, default: '', trim: true },
  purchaseUnit: { type: String, default: '', trim: true },
  usedUnitType: { type: String, default: '', trim: true },
  usedUnit: { type: String, default: '', trim: true },
  receiveUnitType: { type: String, default: '', trim: true },
  receiveUnit: { type: String, default: '', trim: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// itemCode is globally unique, NOT company-scoped — deliberately matching
// Item.code's own global `unique: true` (Inventory.js), since a Fabrication
// Master code becomes an Inventory Item's code verbatim the moment it's
// picked in Inventory's Add Item form (see FabricationItemPicker.jsx). A
// compound {company, itemCode} index used to be here, which let two
// different companies independently generate the identical code — harmless
// within this collection, but the resulting Item.code duplicate-key error
// only surfaced later, downstream, when either company actually tried to
// create the Inventory Item.
FabricationMasterSchema.index({ itemCode: 1 }, { unique: true });
FabricationMasterSchema.index({ company: 1, category: 1 });

export default mongoose.model('FabricationMaster', FabricationMasterSchema);
