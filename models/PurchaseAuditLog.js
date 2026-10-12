import mongoose from 'mongoose';

// Purchase audit log (procurement-v2 gap 17, 2026-10-10). Client blueprint
// §14: "maintain immutable audit logs for … approvals, PO changes …". One row
// per thing that happened to a PO — who, when, from where, and a plain
// sentence of what — written by services/purchaseAuditService.js at the
// moment it happens.
//
// Append-only: the app never edits or deletes a row (no route does, and the
// hooks below refuse it). A tamper-detection hash chain (workflow doc X4) can
// be added later without changing this shape.
export const PO_AUDIT_ACTIONS = [
  'created', 'sent_for_approval', 'approved', 'rejected',
  'emailed', 'email_failed',
  'cancel_requested', 'cancelled', 'short_closed', 'cancel_refused',
  'line_received', 'fully_received',
  // Delivery follow-up (2026-10-10).
  'date_revised', 'delivery_overdue',
  // Money (2026-10-12): advance, payments, QC acceptance, rejections.
  'advance_paid', 'payment_made', 'fully_accepted', 'qc_rejected', 'rejection_recorded', 'refund_received',
];

const purchaseAuditLogSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  unit: { type: String, default: null },
  entityType: { type: String, enum: ['PurchaseOrder'], default: 'PurchaseOrder' },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
  entityRef: { type: String, default: '' },           // PO number
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  vendorName: { type: String, default: '' },
  action: { type: String, enum: PO_AUDIT_ACTIONS, required: true },
  summary: { type: String, default: '' },              // one plain sentence
  details: { type: mongoose.Schema.Types.Mixed, default: null },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = the system
  byName: { type: String, default: '' },
  byRole: { type: String, default: '' },
  ip: { type: String, default: null },
  at: { type: Date, default: Date.now },
}, { versionKey: false });

purchaseAuditLogSchema.index({ companyId: 1, at: -1 });
purchaseAuditLogSchema.index({ entityId: 1, at: 1 });
purchaseAuditLogSchema.index({ companyId: 1, action: 1, at: -1 });

const refuse = () => { throw new Error('The purchase audit log can\'t be changed or deleted.'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace']) {
  purchaseAuditLogSchema.pre(op, refuse);
}
purchaseAuditLogSchema.pre('save', function () {
  if (!this.isNew) refuse();
});

export default mongoose.model('PurchaseAuditLog', purchaseAuditLogSchema);
