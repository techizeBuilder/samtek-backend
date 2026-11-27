// Feature 23 (client, 23 Nov 2026): reading a unit's step photos / videos, and the Company
// Admin's clean-up page. Production's upload / remove live on the production-mfg routes
// (orders "edit"). docs/client-features-2026-11/23-step-media-logic.md
import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { userHasPermission } from '../middleware/permissions.js';
import { getUnitMedia, getAdminSummary, getAdminList, postAdminDelete } from '../controllers/stepMediaController.js';

const router = Router();
const COMPANY_ADMIN_ROLES = ['Company Admin', 'Super Admin'];
const admin = authorizeRoles(...COMPANY_ADMIN_ROLES);
// Production (orders view) or QC (inspection view) reads them; the Company Admin too.
const canSee = (req, res, next) => (COMPANY_ADMIN_ROLES.includes(req.user?.role)
  || userHasPermission(req.user, 'production', 'orders', 'view')
  || userHasPermission(req.user, 'quality-control', 'qcInspection', 'view')
  ? next()
  : res.status(403).json({ success: false, message: "You don't have access to Production's step photos." }));

router.use(authenticateToken);
router.get('/order/:orderRef', canSee, getUnitMedia);
router.get('/admin/summary', admin, getAdminSummary);
router.get('/admin/list', admin, getAdminList);
router.post('/admin/delete', admin, postAdminDelete);

export default router;
