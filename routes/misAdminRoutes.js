import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import {
  getMISDashboard,
  getSalesReport,
  getFinanceReport,
  getProductionReport,
  getInventoryReport,
  getComplaintReport,
  getHRMSReport,
  getQualityReport
} from '../controllers/misAdminController.js';

const router = express.Router();

// All MIS routes require authentication
router.use(authenticateToken);

// MIS Admin + Super Admin can access these
const MIS_ROLES = ['MIS Admin', 'Super Admin', 'Superadmin'];
router.use(authorizeRoles(...MIS_ROLES));

router.get('/dashboard', getMISDashboard);
router.get('/sales-report', getSalesReport);
router.get('/finance-report', getFinanceReport);
router.get('/production-report', getProductionReport);
router.get('/inventory-report', getInventoryReport);
router.get('/complaint-report', getComplaintReport);
router.get('/hrms-report', getHRMSReport);
router.get('/quality-report', getQualityReport);

export default router;
