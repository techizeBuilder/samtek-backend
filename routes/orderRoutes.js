import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
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
  getNOCDetails,
  checkInventoryForItem,
  getDealVerifications,
  repairStoreQCStatus,
} from '../controllers/orderController.js';

const router = express.Router();

router.use(authenticateToken);

const ordersView = checkPermission('sales', 'orders', 'view');
const ordersAdd = checkPermission('sales', 'orders', 'add');
const ordersEdit = checkPermission('sales', 'orders', 'edit');
const ordersDelete = checkPermission('sales', 'orders', 'delete');

router.post('/', ordersAdd, createOrder);
router.get('/', ordersView, getOrders);
router.get('/deal-verifications', ordersView, getDealVerifications);
// NOC Request & Gate Pass Generation Flow
router.get('/noc-requests', ordersView, getNOCRequests);
router.post('/approve-noc/:saleId', ordersEdit, approveNOC);
router.get('/noc-details/:saleId', ordersView, getNOCDetails);

router.get('/get-tracking', ordersView, getOrderTracking);
router.get('/check-existing', ordersView, checkExistingOrder);
router.get('/check-inventory', ordersView, checkInventoryForItem);
router.get('/by-lead/:leadId', ordersView, getOrderByLeadId);
router.get('/:id', ordersView, getOrderById);
router.put('/:id', ordersEdit, updateOrder);
router.patch('/:id/status', ordersEdit, updateOrderStatus);
router.patch('/:id/service-verify', ordersEdit, verifyServiceOrder);
router.patch('/:id/account-approve', ordersEdit, approveAccountOrder);
router.post('/gate-pass/:saleId', ordersEdit, generateGatePass);
router.post('/approve-sale/:saleId', ordersEdit, approveSaleOrder);
router.post('/:id/payment-evidence', ordersEdit, addPaymentEvidence);
router.patch('/:orderId/store-info', ordersEdit, updateOrderStoreInfo);
router.patch('/sale/:saleId/store-info', ordersEdit, updateSaleStoreInfo);
router.patch('/order/:orderId/store-info', ordersEdit, updateOrderStoreInfo);

// One-time repair endpoint — fixes Sales stuck at 'Goes to Purchase' after QC approval
router.post('/repair-store-status', ordersEdit, repairStoreQCStatus);

router.delete('/:id', ordersDelete, deleteOrder);

export default router;