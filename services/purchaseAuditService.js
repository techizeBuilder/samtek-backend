// Writes the purchase audit log (procurement-v2 gap 17, 2026-10-10) — see
// models/PurchaseAuditLog.js. Called once at each point a PO's life moves.
// Never throws: a failed log line must never undo or block the PO action
// itself — it's reported on the console instead.
import PurchaseAuditLog, { PO_AUDIT_ACTIONS } from '../models/PurchaseAuditLog.js';
import Supplier from '../models/Supplier.js';
import mongoose from 'mongoose';

export const PO_AUDIT_ACTION_LABELS = {
  created: 'Created',
  sent_for_approval: 'Sent for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  emailed: 'Emailed to vendor',
  email_failed: 'Email failed',
  cancel_requested: 'Cancel asked',
  cancelled: 'Cancelled',
  short_closed: 'Short closed',
  cancel_refused: 'Cancel refused',
  line_received: 'Line received',
  fully_received: 'Fully received',
  date_revised: 'Date changed',
  delivery_overdue: 'Delivery overdue',
  advance_paid: 'Advance paid',
  payment_made: 'Payment made',
  fully_accepted: 'Fully accepted',
  qc_rejected: 'QC rejected',
  rejection_recorded: 'Vendor answer recorded',
  refund_received: 'Refund received',
};
export { PO_AUDIT_ACTIONS };

export const inr = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;

function ipOf(req) {
  if (!req) return null;
  const fwd = req.headers?.['x-forwarded-for'];
  const ip = (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.ip || req.socket?.remoteAddress || null;
  return ip ? String(ip).replace(/^::ffff:/, '') : null;
}

// Store received one PO line (receiveLineItems / receiveLineFabrication):
// logs it, then "fully received" if no live line is left to receive (a line
// is received when every request on it is; cancelled lines don't count).
export async function logLineReceived({ po, line, user, req, text }) {
  await logPoEvent({ po, user, req, action: 'line_received', summary: `Received ${line.itemName}: ${text}.`, details: { line: String(line._id), item: line.itemName, text } });
  try {
    const PurchaseRequest = mongoose.model('PurchaseRequest');
    const live = (po.items || []).filter(l => !l.cancelled?.at);
    const ids = live.flatMap(l => (l.purchaseRequests?.length ? l.purchaseRequests : (l.purchaseRequest ? [l.purchaseRequest] : []))).map(id => id?._id || id);
    if (!ids.length) return;
    const open = await PurchaseRequest.countDocuments({ _id: { $in: ids }, status: { $ne: 'Received' } });
    if (open === 0) await logPoEvent({ po, user, req, action: 'fully_received', summary: 'Everything on this PO has been received.' });
  } catch (err) {
    console.error('Purchase audit log (fully_received check) failed:', err.message);
  }
}

// po: a Purchase doc (or lean object). user: who did it (null = the system).
export async function logPoEvent({ po, action, user = null, summary = '', details = null, req = null }) {
  try {
    if (!po?._id || !PO_AUDIT_ACTIONS.includes(action)) return;
    const supplierId = po.supplier?._id || po.supplier || null;
    let vendorName = po.supplier?.supplierName || '';
    if (!vendorName && supplierId) {
      vendorName = (await Supplier.findById(supplierId).select('supplierName').lean())?.supplierName || '';
    }
    await PurchaseAuditLog.create({
      companyId: po.companyId,
      unit: po.unit || null,
      entityId: po._id,
      entityRef: po.purchaseOrderNumber || '',
      vendor: supplierId,
      vendorName,
      action,
      summary,
      details,
      by: user?._id || null,
      byName: user ? (user.fullName || user.username || user.name || '') : 'System',
      byRole: user?.role || '',
      ip: ipOf(req),
      at: new Date(),
    });
  } catch (err) {
    console.error(`Purchase audit log (${action}) failed:`, err.message);
  }
}
