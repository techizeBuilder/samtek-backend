import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission, checkAnyPermission } from '../middleware/permissions.js';
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

// Deal Verifications page (Complaint Management) reads/writes orders through
// this same router, so these need to also accept the complaints module's
// dealVerifications grant — not just Sales' orders grant — or a Complaint
// Management Head/Employee with no Sales permissions gets 403'd out of a
// page their role is otherwise fully allowed to open.
const dealVerificationsView = checkAnyPermission([['sales', 'orders'], ['complaints', 'dealVerifications']], 'view');
const dealVerificationsEdit = checkAnyPermission([['sales', 'orders'], ['complaints', 'dealVerifications']], 'edit');

// Store's Orders page (QC/tracking view + store-info updates) also reads/writes
// through this router under its own 'Store' module 'orders' feature grant,
// same cross-module situation as dealVerifications above.
const storeOrdersView = checkAnyPermission([['sales', 'orders'], ['Store', 'orders']], 'view');
const storeInfoEdit = checkAnyPermission([['sales', 'orders'], ['Store', 'orders']], 'edit');

// Accounts' NOC Request / Gate Pass page also reads/writes orders through this
// router under its own 'accounts' module 'sales' feature grant — same
// cross-module situation as above (an Accounts Head has no 'sales' module
// entry at all, only 'accounts' with a 'sales' feature key inside it).
const nocView = checkAnyPermission([['sales', 'orders'], ['accounts', 'sales']], 'view');
const nocEdit = checkAnyPermission([['sales', 'orders'], ['accounts', 'sales']], 'edit');

router.post('/', ordersAdd, createOrder);
router.get('/', ordersView, getOrders);
router.get('/deal-verifications', dealVerificationsView, getDealVerifications);
// NOC Request & Gate Pass Generation Flow
router.get('/noc-requests', nocView, getNOCRequests);
router.post('/approve-noc/:saleId', nocEdit, approveNOC);
router.get('/noc-details/:saleId', nocView, getNOCDetails);

router.get('/get-tracking', storeOrdersView, getOrderTracking);
router.get('/check-existing', ordersView, checkExistingOrder);
router.get('/check-inventory', ordersView, checkInventoryForItem);
router.get('/by-lead/:leadId', ordersView, getOrderByLeadId);
router.get('/:id', storeOrdersView, getOrderById);
router.put('/:id', dealVerificationsEdit, updateOrder);
router.patch('/:id/status', ordersEdit, updateOrderStatus);
router.patch('/:id/service-verify', dealVerificationsEdit, verifyServiceOrder);
router.patch('/:id/account-approve', ordersEdit, approveAccountOrder);
router.post('/gate-pass/:saleId', nocEdit, generateGatePass);
router.post('/approve-sale/:saleId', ordersEdit, approveSaleOrder);
router.post('/:id/payment-evidence', ordersEdit, addPaymentEvidence);
router.patch('/:orderId/store-info', storeInfoEdit, updateOrderStoreInfo);
router.patch('/sale/:saleId/store-info', storeInfoEdit, updateSaleStoreInfo);
router.patch('/order/:orderId/store-info', storeInfoEdit, updateOrderStoreInfo);

// One-time repair endpoint — fixes Sales stuck at 'Goes to Purchase' after QC approval
router.post('/repair-store-status', ordersEdit, repairStoreQCStatus);

router.delete('/:id', ordersDelete, deleteOrder);

export default router;