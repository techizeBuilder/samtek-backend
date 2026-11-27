import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { getHrmsDashboardStats } from '../controllers/hrmsDashboardController.js';

const router = express.Router();

// Apply authentication
// Security check day 3 (26 Nov 2026, note 6): the figures (head count, pending leaves, open jobs) were open
// to any login. Now the dashboards that show them: HR, the Company Admin, a Manager (and the Super Admin).
router.use(authenticateToken, authorizeRoles('HR-Admin', 'Hr Admin', 'Company Admin', 'Manager', 'Super Admin', 'Superadmin'));

// GET /api/hrms-dashboard/stats
router.get('/stats', getHrmsDashboardStats);

export default router;
