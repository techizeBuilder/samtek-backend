// Delivery estimate for Sales (rebuilt 18 Nov 2026). docs/delivery-estimate/.
// Estimating and saving on a lead need Sales orders view (as the old estimator).
// The settings: anyone who can estimate reads them; only the Company Admin saves
// (by role — their permissions start empty), like Performance Settings.
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { listEstimableItems, postEstimate, putLeadEstimate, getSettings, putSettings } from '../controllers/deliveryEstimateController.js';

const router = express.Router();
router.use(authenticateToken);

const COMPANY_ADMIN_ROLES = ['Company Admin', 'Super Admin'];
const ordersView = checkPermission('sales', 'orders', 'view');
const salesOrAdmin = (req, res, next) => (COMPANY_ADMIN_ROLES.includes(req.user?.role) ? next() : ordersView(req, res, next));
const adminOnly = (req, res, next) => (COMPANY_ADMIN_ROLES.includes(req.user?.role)
  ? next() : res.status(403).json({ success: false, message: 'Only the Company Admin can change these.' }));

router.get('/items', ordersView, listEstimableItems);
router.post('/estimate', ordersView, postEstimate);
router.put('/leads/:id', ordersView, putLeadEstimate);
router.get('/settings', salesOrAdmin, getSettings);
router.put('/settings', adminOnly, putSettings);

export default router;
