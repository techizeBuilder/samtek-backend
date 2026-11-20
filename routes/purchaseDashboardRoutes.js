import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
// Purchase separated from Accounts (2026-11-16): docs/purchase-separation/01-logic.md.
import { purchaseGate, buyOrPayView, purchaseOrStorePairs, purchaseSettingsGate, purchaseAuditGate } from '../middleware/purchaseGates.js';
import { getPurchaseDashboard } from '../controllers/purchaseDashboardController.js';

// Purchase Dashboard (2026-10-13). The Company Admin, or anyone who can view
// Purchases; the controller picks the view from the role.
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const purchasesView = purchaseGate('view');
const canSee = (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) ? next() : purchasesView(req, res, next));

router.get('/', canSee, getPurchaseDashboard);

export default router;
