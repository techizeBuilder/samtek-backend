import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
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

// Fine-grained module/feature permission checks (module: 'dispatches')
const dashboardView = checkPermission('dispatches', 'dashboard', 'view');
const packagingQueueView = checkPermission('dispatches', 'packagingQueue', 'view');
const packagingJobsView = checkPermission('dispatches', 'packagingJobs', 'view');
const packagingJobsAdd = checkPermission('dispatches', 'packagingJobs', 'add');
const packagingJobsEdit = checkPermission('dispatches', 'packagingJobs', 'edit');
const dispatchPlanningAdd = checkPermission('dispatches', 'dispatchPlanning', 'add');
const dispatchPlanningEdit = checkPermission('dispatches', 'dispatchPlanning', 'edit');
const activeDispatchesView = checkPermission('dispatches', 'activeDispatches', 'view');
const activeDispatchesEdit = checkPermission('dispatches', 'activeDispatches', 'edit');
const dispatchHistoryEdit = checkPermission('dispatches', 'dispatchHistory', 'edit');

// GET /dispatch-orders backs two different frontend pages off the same
// controller: the plain list (Dispatch Planning) and, with ?scope=history,
// Dispatch History (see getDispatchOrders in the controller). Gate on
// whichever feature actually matches the request instead of picking one.
const dispatchOrdersListView = (req, res, next) => {
  const feature = req.query.scope === 'history' ? 'dispatchHistory' : 'dispatchPlanning';
  return checkPermission('dispatches', feature, 'view')(req, res, next);
};

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', dashboardView, getDashboard);

// ── Packaging Queue ───────────────────────────────────────────────────────────
router.get('/ready-for-packaging', packagingQueueView, getReadyForPackaging);

// ── Packaging Jobs ────────────────────────────────────────────────────────────
router.get('/jobs', packagingJobsView, getPackagingJobs);
router.get('/jobs/active', packagingJobsView, getActivePackagingJobs);
router.post('/jobs', packagingJobsAdd, createPackagingJob);
router.put('/jobs/:id/packing-type', packagingJobsEdit, updatePackingType);
router.put('/jobs/:id/start', packagingJobsEdit, startPacking);
router.put('/jobs/:id/checklist', packagingJobsEdit, updateChecklist);
router.put('/jobs/:id/complete', packagingJobsEdit, completePacking);

// ── Dispatch Orders ───────────────────────────────────────────────────────────
router.get('/dispatch-orders', dispatchOrdersListView, getDispatchOrders);
router.get('/dispatch-orders/active', activeDispatchesView, getActiveDispatchOrders);
router.post('/dispatch-orders', dispatchPlanningAdd, createDispatchOrder);
router.put('/dispatch-orders/:id', dispatchPlanningEdit, updateDispatchOrder);
router.put('/dispatch-orders/:id/execute', activeDispatchesEdit, deliveryDocsMiddleware, executeDispatch);
router.put('/dispatch-orders/:id/in-transit', activeDispatchesEdit, markInTransit);
router.put('/dispatch-orders/:id/deliver', activeDispatchesEdit, confirmDelivery);
router.put('/dispatch-orders/:id/close', dispatchHistoryEdit, closeDispatch);

// ── Packing & Dispatch Expenses (shared by Packing + Dispatch roles) ────────
// NOTE: no matching grantable feature key exists for "expenses" under either
// the 'packing' or 'dispatches' module in roleModulesConfig.js — left
// unguarded (authenticateToken only) pending a product decision on where
// this feature should live in the permissions catalogue.
router.get('/expenses/categories', getPackagingDispatchExpenseCategories);
router.get('/expenses/summary', getPackagingDispatchExpenseSummary);
router.get('/expenses', getPackagingDispatchExpenses);
router.post('/expenses', createPackagingDispatchExpense);
router.put('/expenses/:id', updatePackagingDispatchExpense);
router.delete('/expenses/:id', deletePackagingDispatchExpense);

export default router;
