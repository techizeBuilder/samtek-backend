import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
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

// Dispatch CRUD Routes
router.get('/', getDispatches);                    // GET /api/dispatches
router.get('/stats', getDispatchStats);            // GET /api/dispatches/stats
router.get('/dashboard', getDispatchDashboardData); // GET /api/dispatches/dashboard
router.get('/dashboard-entry-history', getDispatchDashboardEntryHistory); // GET /api/dispatches/dashboard-entry-history
router.get('/delivery-challan', getDeliveryChallanData); // GET /api/dispatches/delivery-challan
router.get('/history', getDispatchHistory);        // GET /api/dispatches/history
router.put('/manual-stock', updateManualStock);    // PUT /api/dispatches/manual-stock
router.put('/update-delivery/:dispatchId', updateDispatchDelivery); // PUT /api/dispatches/update-delivery/:dispatchId

// New routes for packing integration
router.post('/check-existing', checkExistingDispatch);     // POST /api/dispatches/check-existing
router.post('/create-from-packing', createDispatchFromPacking); // POST /api/dispatches/create-from-packing

// Delivery Challan specific routes
router.get('/todays-products', getTodaysProducts);              // GET /api/dispatches/todays-products
router.get('/items-history', getDispatchItemsHistory);          // GET /api/dispatches/items-history
router.get('/validate-dc-number', validateDCNumber);            // GET /api/dispatches/validate-dc-number
router.post('/create-delivery-challan', createDeliveryChallan); // POST /api/dispatches/create-delivery-challan
router.post('/generate-invoice/:dcId', generateInvoiceForDC);   // POST /api/dispatches/generate-invoice/:dcId
router.post('/create-dispatch-order', createDispatchOrder);     // POST /api/dispatches/create-dispatch-order

// Direct order creation routes
router.post('/create-direct-order', createDirectOrder);         // POST /api/dispatches/create-direct-order
router.get('/sales-persons', getSalesPersonsForDispatch);       // GET /api/dispatches/sales-persons
router.get('/customers', getCustomersForDispatch);              // GET /api/dispatches/customers
router.get('/products', getProductsForDispatch);                // GET /api/dispatches/products
router.get('/today-order-items', getTodayOrderItems);           // GET /api/dispatches/today-order-items

router.put('/update-qty-issued', updateQtyIssued);              // PUT /api/dispatches/update-qty-issued
router.post('/approve-product', approveProduct);                // POST /api/dispatches/approve-product
router.post('/generate-invoice', generateInvoice);              // POST /api/dispatches/generate-invoice
router.post('/generate-invoice-by-dc', generateInvoiceByDC);    // POST /api/dispatches/generate-invoice-by-dc

router.get('/:id', getDispatchById);                   // GET /api/dispatches/:id
router.post('/', createDispatch);                  // POST /api/dispatches
router.put('/:id', updateDispatch);                // PUT /api/dispatches/:id
router.delete('/:id', deleteDispatch);             // DELETE /api/dispatches/:id

export default router;