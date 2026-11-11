// Fewer serials picked than pieces, and someone went ahead after the warning
// (serial number work, 2026-11-03 — serial-tracking-logic-2026-10.md §12).
// Shown on Serial Numbers → "Went without a serial".
import mongoose from 'mongoose';

const serialSkipLogSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  itemName: { type: String, default: '' },
  screen: { type: String, default: '' },
  qty: { type: Number, default: 0 },
  picked: { type: Number, default: 0 },
  reference: { type: String, default: '' }, // the order, ticket or Defective row
  byName: { type: String, default: '' },
}, { timestamps: true });

serialSkipLogSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.SerialSkipLog || mongoose.model('SerialSkipLog', serialSkipLogSchema);
