import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkAnyPermission } from '../middleware/permissions.js';
import { getSerialNumbers, getQcJobSerials } from '../controllers/purchasedUnitController.js';

// Serial numbers of what Store received from vendors (2026-10-13) — read
// only. For Store (its Serial Numbers tab), QC (ticking rejected serials),
// Purchase, and the Company Admin (checkAnyPermission alone doesn't let that
// role through — same as the price history routes).
const router = express.Router();
router.use(authenticateToken);

const ADMIN_ROLES = ['Company Admin', 'Super Admin', 'Superadmin'];
const modules = [['Store', 'purchaseOrders'], ['accounts', 'purchases'], ['quality-control', 'qcInspection']];
const anyView = checkAnyPermission(modules, 'view');
const canView = (req, res, next) => (ADMIN_ROLES.includes(req.user?.role) ? next() : anyView(req, res, next));

router.get('/', canView, getSerialNumbers);
router.get('/qc-job/:id', canView, getQcJobSerials);

export default router;
