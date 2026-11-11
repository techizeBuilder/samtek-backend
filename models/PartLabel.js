import mongoose from 'mongoose';
import { PLACE_KINDS, TrailEventSchema } from './PurchasedUnit.js';

// A stickered made unit (serial number work step 2, 2026-10-31 — docs/serial
// number work/serial-tracking-logic-2026-10.md §5.4). Only a CARRIER (a made
// Sub Child Part piece / Child Part unit / Machine holding a "Built into the
// product" vendor serial) that goes into STOCK gets one: it appears
// Unlabelled when it enters stock; Store sticks the client's printed sticker,
// enters its number and pairs the vendor serials (or stickered parts) inside
// it. Cascade parts never need one — they go straight to their parent order.
const partLabelSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  itemCode: { type: String, default: '' },
  itemName: { type: String, default: '' },
  productKind: { type: String, default: '' },               // SubChildPart / ChildPart / Machine
  labelNo: { type: String, default: '', trim: true },       // as typed from the sticker
  labelKey: { type: String, default: '' },                  // upper-cased, for duplicates / search
  status: { type: String, enum: ['Unlabelled', 'Labelled', 'Retired', 'Not needed'], default: 'Unlabelled', index: true },
  builtIn: {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
    orderNo: { type: String, default: '' },
    unitIndex: { type: Number, default: 0 },                // Child Part / Machine unit, or the piece #
  },
  // How many tracked things one unit holds (BOM quantity per unit) — the
  // pairing count Store must enter.
  holdsCount: { type: Number, default: 0 },
  contains: {
    units: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PurchasedUnit' }],
    labels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PartLabel' }],
  },
  labelledAt: { type: Date, default: null },
  labelledBy: { type: String, default: '' },
  place: {
    kind: { type: String, enum: [null, ...PLACE_KINDS], default: 'Stock' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', default: null },
    orderNo: { type: String, default: '' },
    label: { type: mongoose.Schema.Types.ObjectId, ref: 'PartLabel', default: null },
    labelNo: { type: String, default: '' },
    customerOrderCode: { type: String, default: '' },
    // Defective: the Defective Inventory row (material code) it sits under.
    defectiveOf: { type: String, default: '' },
    // Sold on a service visit: the ticket and the customer it went to.
    ticketNo: { type: String, default: '' },
    customerMobile: { type: String, default: '' },
  },
  trail: { type: [TrailEventSchema], default: [] },
}, { timestamps: true });

// A sticker number is never used twice for the same part — retired ones
// included (they're kept, never reused).
partLabelSchema.index(
  { companyId: 1, item: 1, labelKey: 1 },
  { unique: true, partialFilterExpression: { labelKey: { $gt: '' } } },
);
partLabelSchema.index({ companyId: 1, item: 1, status: 1, 'place.kind': 1 });
partLabelSchema.index({ companyId: 1, 'builtIn.order': 1 });

export default mongoose.models.PartLabel || mongoose.model('PartLabel', partLabelSchema);
