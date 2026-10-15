import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { getPurchaseDashboard } from '../controllers/purchaseDashboardController.js';

// Purchase Dashboard (2026-10-13). The Company Admin, or anyone who can view
// Purchases; the controller picks the view from the role.
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const purchasesView = checkPermission('accounts', 'purchases', 'view');
const canSee = (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) ? next() : purchasesView(req, res, next));

router.get('/', canSee, getPurchaseDashboard);

export default router;
