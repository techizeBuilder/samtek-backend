import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { listPurchaseAudit } from '../controllers/purchaseAuditController.js';

// Purchase audit log (procurement-v2 gap 17, 2026-10-10) — read only.
// Who can see it: the Company Admin (and Super Admin), or anyone given the
// accounts.purchaseAuditLog permission (Company Admin → Roles & Permissions).
// checkPermission alone doesn't let the Company Admin role through, hence
// the role check first.
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const auditPermission = checkPermission('accounts', 'purchaseAuditLog', 'view');
export const canSeePurchaseAudit = (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) ? next() : auditPermission(req, res, next));

router.get('/', canSeePurchaseAudit, listPurchaseAudit);

export default router;
