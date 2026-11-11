import express from 'express';
import {
  requestOutsourceHandoff,
  sendOutsourceHandoffRound,
  receiveOutsourceHandoffRound,
  listOutsourceWork,
  getEligibleUnits, getReworkInfo,
} from '../controllers/outsourceWorkController.js';
import {
  getRequests, getDoneRequests, getVendorsForSteps, getPriceHistory, listOutsourceOrders, createOutsourceOrder, getOutsourceOrder,
  updateOutsourceOrder, cancelOutsourceOrder, postVendorReady, postStepTime, postNotComing,
} from '../controllers/outsourceOrderController.js';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(authenticateToken);

// Production requests a hand-off — same module/feature Process Execution's
// own step actions already gate (productionMfgRoutes.js's ordersEdit).
const ordersView = checkPermission('production', 'orders', 'view');
const ordersEdit = checkPermission('production', 'orders', 'edit');
// Purchase views/sends/receives a hand-off — same module/feature
// subChildPartJobWorkOrderRoutes.js already gates.
const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');

router.get('/', purchasesView, listOutsourceWork);
// Multi-unit outsource handoff batching (2026-09-25) — queried by
// Production's "Send for Outsourcing" picker before creating a hand-off.
router.get('/orders/:id/eligible-units', ordersView, getEligibleUnits);
router.get('/orders/:id/rework', ordersView, getReworkInfo); // rework resend qty (2026-10-27)
router.post('/orders/:id/handoffs', ordersEdit, requestOutsourceHandoff);
router.post('/orders/:id/handoffs/:handoffId/rounds', purchasesEdit, sendOutsourceHandoffRound);
router.put('/orders/:id/handoffs/:handoffId/rounds/:roundId/receive', purchasesEdit, receiveOutsourceHandoffRound);


// Outsource Orders (outsource-v2 slice 2, 2026-10-20) — Purchase picks
// requests, then a vendor, and orders the next step(s); the trip is sent and
// received through the order (outsourceOrderController.js).
router.get('/requests', purchasesView, getRequests);
router.get('/requests/done', purchasesView, getDoneRequests); // finished requests, paged (2026-10-23)
router.get('/vendors', purchasesView, getVendorsForSteps);
router.get('/price-history', purchasesView, getPriceHistory);
router.get('/outsource-orders', purchasesView, listOutsourceOrders);
router.post('/outsource-orders', purchasesEdit, createOutsourceOrder);
router.get('/outsource-orders/:id', purchasesView, getOutsourceOrder);
router.put('/outsource-orders/:id', purchasesEdit, updateOutsourceOrder);
router.post('/outsource-orders/:id/cancel', purchasesEdit, cancelOutsourceOrder);
router.post('/outsource-orders/:id/requests/:requestId/vendor-ready', purchasesEdit, postVendorReady);
router.post('/outsource-orders/:id/requests/:requestId/not-coming', purchasesEdit, postNotComing); // partial returns (2026-10-26)
// Pricing types (2026-10-22): Purchase enters the time of a per minute / per hour step.
router.post('/outsource-orders/:id/lines/:lineId/time', purchasesEdit, postStepTime);
export default router;
