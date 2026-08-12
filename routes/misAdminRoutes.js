import express from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
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

// roleModulesConfig.js MODULES['mis'].features = dashboard, salesReport,
// financeReport, productionReport, inventoryReport, complaintReport,
// hrmsReport, qualityReport. MIS is read-only reporting, so all 'view'.
const misDashboardView = checkPermission('mis', 'dashboard', 'view');
const misSalesReportView = checkPermission('mis', 'salesReport', 'view');
const misFinanceReportView = checkPermission('mis', 'financeReport', 'view');
const misProductionReportView = checkPermission('mis', 'productionReport', 'view');
const misInventoryReportView = checkPermission('mis', 'inventoryReport', 'view');
const misComplaintReportView = checkPermission('mis', 'complaintReport', 'view');
const misHrmsReportView = checkPermission('mis', 'hrmsReport', 'view');
const misQualityReportView = checkPermission('mis', 'qualityReport', 'view');

router.get('/dashboard', misDashboardView, getMISDashboard);
router.get('/sales-report', misSalesReportView, getSalesReport);
router.get('/finance-report', misFinanceReportView, getFinanceReport);
router.get('/production-report', misProductionReportView, getProductionReport);
router.get('/inventory-report', misInventoryReportView, getInventoryReport);
router.get('/complaint-report', misComplaintReportView, getComplaintReport);
router.get('/hrms-report', misHrmsReportView, getHRMSReport);
router.get('/quality-report', misQualityReportView, getQualityReport);

export default router;
