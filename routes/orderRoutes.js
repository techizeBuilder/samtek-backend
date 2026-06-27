import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  createOrder,
  getOrders,
  getOrderByLeadId,
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
  updateOrderStoreInfo,
  approveSaleOrder,
  getNOCRequests,
  approveNOC,
  checkInventoryForItem,
  getDealVerifications,
  repairStoreQCStatus,
} from '../controllers/orderController.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/', createOrder);
router.get('/', getOrders);
router.get('/deal-verifications', getDealVerifications);
// NOC Request & Gate Pass Generation Flow
router.get('/noc-requests', getNOCRequests);
router.post('/approve-noc/:saleId', approveNOC);

router.get('/get-tracking', getOrderTracking);
router.get('/check-existing', checkExistingOrder);
router.get('/check-inventory', checkInventoryForItem);
router.get('/by-lead/:leadId', getOrderByLeadId);
router.get('/:id', getOrderById);
router.put('/:id', updateOrder);
router.patch('/:id/status', updateOrderStatus);
router.patch('/:id/service-verify', verifyServiceOrder);
router.patch('/:id/account-approve', approveAccountOrder);
router.post('/gate-pass/:saleId', generateGatePass);
router.post('/approve-sale/:saleId', approveSaleOrder);
router.post('/:id/payment-evidence', addPaymentEvidence);
router.patch('/:orderId/store-info', updateOrderStoreInfo);
router.patch('/sale/:saleId/store-info', updateSaleStoreInfo);
router.patch('/order/:orderId/store-info', updateOrderStoreInfo);

// One-time repair endpoint — fixes Sales stuck at 'Goes to Purchase' after QC approval
router.post('/repair-store-status', repairStoreQCStatus);

router.delete('/:id', deleteOrder);

export default router;