import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getProductionShiftData,
  getProductionGroupShiftDetails,
  updateProductionShiftTiming,
  getProductionDashboard,
  updateUngroupedItemProduction,
  getUngroupedItems,
  getAllProductionReports
} from '../controllers/productionController.js';
import {
  getProductionExpenseCategories,
  createProductionExpense,
  getProductionExpenses,
  getProductionExpenseSummary,
  updateProductionExpense,
  deleteProductionExpense,
} from '../controllers/productionExpenseController.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

const expensesView = checkPermission('production', 'expenses', 'view');
const expensesAdd = checkPermission('production', 'expenses', 'add');
const expensesEdit = checkPermission('production', 'expenses', 'edit');
const expensesDelete = checkPermission('production', 'expenses', 'delete');

// NOTE: Dashboard / Reports / Production-Shift / Ungrouped-Items routes below are
// intentionally left WITHOUT checkPermission — the 'production' module's grantable
// feature catalogue (roleModulesConfig.js) only defines: orders, repairProduction,
// workPlanning, processQc, jobCards, manpower, expenses, lms. There is no 'dashboard'
// or generic overview feature key, and the frontend sidebar entry for '/production/dashboard'
// carries no `feature` at all (see moduleRoutes.js), confirming this is an intentionally
// ungated overview. Gating these with an invented key would 403 them for every non-Superadmin
// user. Flagged for a product decision rather than guessed.

// Production Dashboard
router.get('/dashboard', getProductionDashboard);

// Production Reports - All production history data
router.get('/reports', getAllProductionReports);

// Ungrouped Items
router.get('/ungrouped-items', getUngroupedItems);

// Production Shift Management (includes both grouped and ungrouped items)
router.get('/production-shift', getProductionShiftData);
router.get('/production-shift/:groupId', getProductionGroupShiftDetails);
// Consolidated Production Updates (handles both grouped and ungrouped items)
router.put('/ungrouped-items/production', updateUngroupedItemProduction);

// Production Expenses (labor, tools, job work, raw material, etc.)
router.get('/expenses/categories', expensesView, getProductionExpenseCategories);
router.get('/expenses/summary', expensesView, getProductionExpenseSummary);
router.get('/expenses', expensesView, getProductionExpenses);
router.post('/expenses', expensesAdd, createProductionExpense);
router.put('/expenses/:id', expensesEdit, updateProductionExpense);
router.delete('/expenses/:id', expensesDelete, deleteProductionExpense);

export default router;