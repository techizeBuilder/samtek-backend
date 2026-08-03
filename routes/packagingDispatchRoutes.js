import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { deliveryDocsMiddleware } from '../middleware/deliveryDocUpload.js';
import {
  getDashboard,
  getReadyForPackaging,
  getPackagingJobs,
  getActivePackagingJobs,
  createPackagingJob,
  updatePackingType,
  startPacking,
  updateChecklist,
  completePacking,
  getDispatchOrders,
  getActiveDispatchOrders,
  createDispatchOrder,
  executeDispatch,
  markInTransit,
  confirmDelivery,
  closeDispatch,
  updateDispatchOrder,
} from '../controllers/packagingDispatchController.js';
import {
  getPackagingDispatchExpenseCategories,
  createPackagingDispatchExpense,
  getPackagingDispatchExpenses,
  getPackagingDispatchExpenseSummary,
  updatePackagingDispatchExpense,
  deletePackagingDispatchExpense,
} from '../controllers/packagingDispatchExpenseController.js';

const router = express.Router();
router.use(authenticateToken);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', getDashboard);

// ── Packaging Queue ───────────────────────────────────────────────────────────
router.get('/ready-for-packaging', getReadyForPackaging);

// ── Packaging Jobs ────────────────────────────────────────────────────────────
router.get('/jobs', getPackagingJobs);
router.get('/jobs/active', getActivePackagingJobs);
router.post('/jobs', createPackagingJob);
router.put('/jobs/:id/packing-type', updatePackingType);
router.put('/jobs/:id/start', startPacking);
router.put('/jobs/:id/checklist', updateChecklist);
router.put('/jobs/:id/complete', completePacking);

// ── Dispatch Orders ───────────────────────────────────────────────────────────
router.get('/dispatch-orders', getDispatchOrders);
router.get('/dispatch-orders/active', getActiveDispatchOrders);
router.post('/dispatch-orders', createDispatchOrder);
router.put('/dispatch-orders/:id', updateDispatchOrder);
router.put('/dispatch-orders/:id/execute', deliveryDocsMiddleware, executeDispatch);
router.put('/dispatch-orders/:id/in-transit', markInTransit);
router.put('/dispatch-orders/:id/deliver', confirmDelivery);
router.put('/dispatch-orders/:id/close', closeDispatch);

// ── Packing & Dispatch Expenses (shared by Packing + Dispatch roles) ────────
router.get('/expenses/categories', getPackagingDispatchExpenseCategories);
router.get('/expenses/summary', getPackagingDispatchExpenseSummary);
router.get('/expenses', getPackagingDispatchExpenses);
router.post('/expenses', createPackagingDispatchExpense);
router.put('/expenses/:id', updatePackagingDispatchExpense);
router.delete('/expenses/:id', deletePackagingDispatchExpense);

export default router;
