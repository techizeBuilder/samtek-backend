import mongoose from 'mongoose';

// What a customer was told when they asked where their order is (feature 12, the
// order tracker, 2026-11-14 — docs/client-features-2026-11/12-order-tracker-logic.md).
// Kept apart from Order so a note never rewrites the busy Order document.
const OrderEnquirySchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  orderCode: { type: String, required: true, trim: true },
  note: { type: String, required: true, trim: true, maxlength: 500 },
  // The order's stage (tracker bar label) at the time, stamped automatically.
  toldStage: { type: String, default: '' },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  byName: { type: String, default: '' },
  at: { type: Date, default: Date.now },
});

OrderEnquirySchema.index({ company: 1, orderCode: 1, at: -1 });

export default mongoose.models.OrderEnquiry || mongoose.model('OrderEnquiry', OrderEnquirySchema);
