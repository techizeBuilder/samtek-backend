// Purchase audit log — read only (procurement-v2 gap 17, 2026-10-10).
// The Audit Log tab (Purchase, with the accounts.purchaseAuditLog permission;
// Company Admin → Purchase & Vendor Approval → Purchase Orders) and each PO's
// History. Nothing here writes: rows are added by services/purchaseAuditService.js.
import mongoose from 'mongoose';
import PurchaseAuditLog from '../models/PurchaseAuditLog.js';
import { PO_AUDIT_ACTIONS, PO_AUDIT_ACTION_LABELS } from '../services/purchaseAuditService.js';

const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/purchase-audit?po=&search=&action=&user=&from=&to=&page=&limit=
//   po     — one PO's history (oldest first, all of it)
//   search — PO number or vendor name
//   from / to — YYYY-MM-DD, whole days
export const listPurchaseAudit = async (req, res) => {
  try {
    if (!req.user.companyId) return res.status(400).json({ message: 'Your account is not linked to a company.' });
    const query = { companyId: new mongoose.Types.ObjectId(String(req.user.companyId)) };
    const timeline = isId(req.query.po);
    if (timeline) query.entityId = new mongoose.Types.ObjectId(String(req.query.po));
    if (PO_AUDIT_ACTIONS.includes(req.query.action)) query.action = req.query.action;
    if (isId(req.query.user)) query.by = new mongoose.Types.ObjectId(String(req.query.user));
    const search = String(req.query.search || '').trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ entityRef: rx }, { vendorName: rx }, { byName: rx }];
    }
    const at = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ''))) at.$gte = new Date(`${req.query.from}T00:00:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ''))) at.$lte = new Date(`${req.query.to}T23:59:59.999`);
    if (Object.keys(at).length) query.at = at;

    const page = timeline ? 1 : Math.max(1, parseInt(req.query.page) || 1);
    const limit = timeline ? 500 : Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const [total, logs] = await Promise.all([
      PurchaseAuditLog.countDocuments(query),
      PurchaseAuditLog.find(query).sort({ at: timeline ? 1 : -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({
      logs,
      actions: PO_AUDIT_ACTIONS.map(a => ({ value: a, label: PO_AUDIT_ACTION_LABELS[a] || a })),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error('listPurchaseAudit error:', error);
    res.status(500).json({ message: 'Could not load the audit log.' });
  }
};
