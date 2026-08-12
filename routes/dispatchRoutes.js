import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getDispatches,
  getDispatchById,
  createDispatch,
  updateDispatch,
  deleteDispatch,
  getDispatchStats,
  getDispatchDashboardData,
  getDispatchDashboardEntryHistory,
  getDeliveryChallanData,
  updateManualStock,
  getDispatchHistory,
  updateDispatchDelivery,
  checkExistingDispatch,
  createDispatchFromPacking,
  updateQtyIssued,
  approveProduct,
  generateInvoice,
  createDispatchOrder,
  getTodaysProducts,
  getDispatchItemsHistory,
  validateDCNumber,
  createDeliveryChallan,
  generateInvoiceForDC,
  createDirectOrder,
  getSalesPersonsForDispatch,
  getCustomersForDispatch,
  getProductsForDispatch,
  generateInvoiceByDC,
  getTodayOrderItems
} from '../controllers/dispatchController.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Fine-grained module/feature permission checks (module: 'dispatches')
const dashboardView = checkPermission('dispatches', 'dashboard', 'view');
const dashboardAdd = checkPermission('dispatches', 'dashboard', 'add');
const dashboardEdit = checkPermission('dispatches', 'dashboard', 'edit');
const deliveryChallanView = checkPermission('dispatches', 'deliveryChallan', 'view');
const deliveryChallanAdd = checkPermission('dispatches', 'deliveryChallan', 'add');
const deliveryChallanEdit = checkPermission('dispatches', 'deliveryChallan', 'edit');
const dispatchHistoryView = checkPermission('dispatches', 'dispatchHistory', 'view');
const dispatchPlanningAdd = checkPermission('dispatches', 'dispatchPlanning', 'add');
const dispatchPlanningDelete = checkPermission('dispatches', 'dispatchPlanning', 'delete');
const activeDispatchesView = checkPermission('dispatches', 'activeDispatches', 'view');
const activeDispatchesEdit = checkPermission('dispatches', 'activeDispatches', 'edit');

// Dispatch CRUD Routes
router.get('/', activeDispatchesView, getDispatches);                    // GET /api/dispatches
router.get('/stats', activeDispatchesView, getDispatchStats);            // GET /api/dispatches/stats
router.get('/dashboard', dashboardView, getDispatchDashboardData); // GET /api/dispatches/dashboard
router.get('/dashboard-entry-history', dashboardView, getDispatchDashboardEntryHistory); // GET /api/dispatches/dashboard-entry-history
router.get('/delivery-challan', deliveryChallanView, getDeliveryChallanData); // GET /api/dispatches/delivery-challan
router.get('/history', dispatchHistoryView, getDispatchHistory);        // GET /api/dispatches/history
router.put('/manual-stock', dashboardEdit, updateManualStock);    // PUT /api/dispatches/manual-stock
router.put('/update-delivery/:dispatchId', dashboardEdit, updateDispatchDelivery); // PUT /api/dispatches/update-delivery/:dispatchId

// New routes for packing integration
router.post('/check-existing', dashboardView, checkExistingDispatch);     // POST /api/dispatches/check-existing (read-only lookup)
router.post('/create-from-packing', dashboardAdd, createDispatchFromPacking); // POST /api/dispatches/create-from-packing

// Delivery Challan specific routes
router.get('/todays-products', deliveryChallanView, getTodaysProducts);              // GET /api/dispatches/todays-products
router.get('/items-history', deliveryChallanView, getDispatchItemsHistory);          // GET /api/dispatches/items-history
router.get('/validate-dc-number', deliveryChallanView, validateDCNumber);            // GET /api/dispatches/validate-dc-number
router.post('/create-delivery-challan', deliveryChallanAdd, createDeliveryChallan); // POST /api/dispatches/create-delivery-challan
router.post('/generate-invoice/:dcId', deliveryChallanEdit, generateInvoiceForDC);   // POST /api/dispatches/generate-invoice/:dcId
router.post('/create-dispatch-order', deliveryChallanAdd, createDispatchOrder);     // POST /api/dispatches/create-dispatch-order

// Direct order creation routes
router.post('/create-direct-order', deliveryChallanAdd, createDirectOrder);         // POST /api/dispatches/create-direct-order
router.get('/sales-persons', deliveryChallanView, getSalesPersonsForDispatch);       // GET /api/dispatches/sales-persons
router.get('/customers', deliveryChallanView, getCustomersForDispatch);              // GET /api/dispatches/customers
router.get('/products', deliveryChallanView, getProductsForDispatch);                // GET /api/dispatches/products
router.get('/today-order-items', deliveryChallanView, getTodayOrderItems);           // GET /api/dispatches/today-order-items

router.put('/update-qty-issued', deliveryChallanEdit, updateQtyIssued);              // PUT /api/dispatches/update-qty-issued
router.post('/approve-product', deliveryChallanEdit, approveProduct);                // POST /api/dispatches/approve-product
router.post('/generate-invoice', deliveryChallanEdit, generateInvoice);              // POST /api/dispatches/generate-invoice
router.post('/generate-invoice-by-dc', deliveryChallanEdit, generateInvoiceByDC);    // POST /api/dispatches/generate-invoice-by-dc

router.get('/:id', activeDispatchesView, getDispatchById);                   // GET /api/dispatches/:id
router.post('/', dispatchPlanningAdd, createDispatch);                  // POST /api/dispatches
router.put('/:id', activeDispatchesEdit, updateDispatch);                // PUT /api/dispatches/:id
router.delete('/:id', dispatchPlanningDelete, deleteDispatch);             // DELETE /api/dispatches/:id

export default router;