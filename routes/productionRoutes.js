import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
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
router.get('/expenses/categories', getProductionExpenseCategories);
router.get('/expenses/summary', getProductionExpenseSummary);
router.get('/expenses', getProductionExpenses);
router.post('/expenses', createProductionExpense);
router.put('/expenses/:id', updateProductionExpense);
router.delete('/expenses/:id', deleteProductionExpense);

export default router;