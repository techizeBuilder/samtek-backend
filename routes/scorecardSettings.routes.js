// Feature 13 (2026-11-17): the employee scorecard's settings (Company Admin).
// docs/client-features-2026-11/13-employee-scorecard-logic.md §14.
// Read: the Company Admin, and HR with Employee Performance view (read-only).
// Save: the Company Admin only — the one who decides on people doesn't set the rules.
import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { userHasPermission } from '../middleware/permissions.js';
import { getScorecardSettings, putScorecardSettings } from '../controllers/scorecardController.js';

const router = Router();
const COMPANY_ADMIN_ROLES = ['Company Admin', 'Super Admin'];

const canRead = (req, res, next) => {
  if (COMPANY_ADMIN_ROLES.includes(req.user?.role) || userHasPermission(req.user, 'hrms', 'manpowerScore', 'view')) return next();
  return res.status(403).json({ success: false, message: 'Access denied' });
};

router.use(authenticateToken);
router.get('/', canRead, getScorecardSettings);
router.put('/', authorizeRoles(...COMPANY_ADMIN_ROLES), putScorecardSettings);

export default router;
