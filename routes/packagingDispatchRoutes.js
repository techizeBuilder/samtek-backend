import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getDashboard,
  getReadyForPackaging,
  getPackagingJobs,
  createPackagingJob,
  updatePackingType,
  startPacking,
  updateChecklist,
  completePacking,
  getDispatchOrders,
  createDispatchOrder,
  executeDispatch,
  markInTransit,
  confirmDelivery,
  closeDispatch,
  updateDispatchOrder,
} from '../controllers/packagingDispatchController.js';

const router = express.Router();
router.use(authenticateToken);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', getDashboard);

// ── Packaging Queue ───────────────────────────────────────────────────────────
router.get('/ready-for-packaging', getReadyForPackaging);

// ── Packaging Jobs ────────────────────────────────────────────────────────────
router.get('/jobs', getPackagingJobs);
router.post('/jobs', createPackagingJob);
router.put('/jobs/:id/packing-type', updatePackingType);
router.put('/jobs/:id/start', startPacking);
router.put('/jobs/:id/checklist', updateChecklist);
router.put('/jobs/:id/complete', completePacking);

// ── Dispatch Orders ───────────────────────────────────────────────────────────
router.get('/dispatch-orders', getDispatchOrders);
router.post('/dispatch-orders', createDispatchOrder);
router.put('/dispatch-orders/:id', updateDispatchOrder);
router.put('/dispatch-orders/:id/execute', executeDispatch);
router.put('/dispatch-orders/:id/in-transit', markInTransit);
router.put('/dispatch-orders/:id/deliver', confirmDelivery);
router.put('/dispatch-orders/:id/close', closeDispatch);

export default router;
