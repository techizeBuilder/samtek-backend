import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  createOrder,
  getOrders,
  getOrderById,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  checkExistingOrder,
  verifyServiceOrder,
  approveAccountOrder,
  addPaymentEvidence,
  getOrderTracking,
  generateGatePass,
  updateSaleStoreInfo,
  approveSaleOrder,
  getNOCRequests,
  approveNOC
} from '../controllers/orderController.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createOrder);
router.get('/', getOrders);
// NOC Request & Gate Pass Generation Flow
router.get('/noc-requests', getNOCRequests);
router.post('/approve-noc/:saleId', approveNOC);

router.get('/get-tracking', getOrderTracking);
router.get('/check-existing', checkExistingOrder);
router.get('/:id', getOrderById);
router.put('/:id', updateOrder);
router.patch('/:id/status', updateOrderStatus);
router.patch('/:id/service-verify', verifyServiceOrder);
router.patch('/:id/account-approve', approveAccountOrder);
router.post('/gate-pass/:saleId', generateGatePass);
router.post('/approve-sale/:saleId', approveSaleOrder);
router.post('/:id/payment-evidence', addPaymentEvidence);
router.patch('/sale/:saleId/store-info', updateSaleStoreInfo);

router.delete('/:id', deleteOrder);

export default router;