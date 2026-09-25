import express from 'express';
import {
  requestOutsourceHandoff,
  sendOutsourceHandoffRound,
  receiveOutsourceHandoffRound,
  listOutsourceWork,
  getHandoffMaterialInfo,
  getEligibleUnits,
} from '../controllers/outsourceWorkController.js';
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
router.post('/orders/:id/handoffs', ordersEdit, requestOutsourceHandoff);
router.get('/orders/:id/handoffs/:handoffId/material-info', purchasesView, getHandoffMaterialInfo);
router.post('/orders/:id/handoffs/:handoffId/rounds', purchasesEdit, sendOutsourceHandoffRound);
router.put('/orders/:id/handoffs/:handoffId/rounds/:roundId/receive', purchasesEdit, receiveOutsourceHandoffRound);

export default router;
