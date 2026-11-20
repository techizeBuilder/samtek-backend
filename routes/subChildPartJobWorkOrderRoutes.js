import express from 'express';
import {
  listSubChildPartJobWorkOrders,
  getSubChildPartJobWorkOrder,
  sendSubChildPartJobWorkRound,
  receiveSubChildPartJobWorkRound,
} from '../controllers/subChildPartJobWorkOrderController.js';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
// Purchase separated from Accounts (2026-11-16): docs/purchase-separation/01-logic.md.
import { purchaseGate, buyOrPayView, purchaseOrStorePairs, purchaseSettingsGate, purchaseAuditGate } from '../middleware/purchaseGates.js';

const router = express.Router();

router.use(authenticateToken);

// Matches the sidebar entry's own module/feature (client/src/config/
// moduleRoutes.js's Purchases submodules all share module:'accounts',
// feature:'purchases') — no new permission key needed.
const purchasesView = purchaseGate('view');
const purchasesEdit = purchaseGate('edit');

router.get('/', purchasesView, listSubChildPartJobWorkOrders);
router.get('/:id', purchasesView, getSubChildPartJobWorkOrder);
router.post('/:id/rounds', purchasesEdit, sendSubChildPartJobWorkRound);
router.put('/:id/rounds/:roundId/receive', purchasesEdit, receiveSubChildPartJobWorkRound);

export default router;
