import express from 'express';
import {
  listSubChildPartJobWorkOrders,
  getSubChildPartJobWorkOrder,
  getSubChildPartJobWorkMaterialOptions,
  sendSubChildPartJobWorkRound,
  receiveSubChildPartJobWorkRound,
} from '../controllers/subChildPartJobWorkOrderController.js';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';

const router = express.Router();

router.use(authenticateToken);

// Matches the sidebar entry's own module/feature (client/src/config/
// moduleRoutes.js's Purchases submodules all share module:'accounts',
// feature:'purchases') — no new permission key needed.
const purchasesView = checkPermission('accounts', 'purchases', 'view');
const purchasesEdit = checkPermission('accounts', 'purchases', 'edit');

router.get('/', purchasesView, listSubChildPartJobWorkOrders);
router.get('/:id', purchasesView, getSubChildPartJobWorkOrder);
router.get('/:id/material-options', purchasesView, getSubChildPartJobWorkMaterialOptions);
router.post('/:id/rounds', purchasesEdit, sendSubChildPartJobWorkRound);
router.put('/:id/rounds/:roundId/receive', purchasesEdit, receiveSubChildPartJobWorkRound);

export default router;
