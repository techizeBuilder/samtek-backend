"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const dispatchController_js_1 = require("../controllers/dispatchController.js");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(auth_js_1.authenticateToken);
// Dispatch CRUD Routes
router.get('/', dispatchController_js_1.getDispatches); // GET /api/dispatches
router.get('/stats', dispatchController_js_1.getDispatchStats); // GET /api/dispatches/stats
router.get('/dashboard', dispatchController_js_1.getDispatchDashboardData); // GET /api/dispatches/dashboard
router.get('/dashboard-entry-history', dispatchController_js_1.getDispatchDashboardEntryHistory); // GET /api/dispatches/dashboard-entry-history
router.get('/delivery-challan', dispatchController_js_1.getDeliveryChallanData); // GET /api/dispatches/delivery-challan
router.get('/history', dispatchController_js_1.getDispatchHistory); // GET /api/dispatches/history
router.put('/manual-stock', dispatchController_js_1.updateManualStock); // PUT /api/dispatches/manual-stock
router.put('/update-delivery/:dispatchId', dispatchController_js_1.updateDispatchDelivery); // PUT /api/dispatches/update-delivery/:dispatchId
// New routes for packing integration
router.post('/check-existing', dispatchController_js_1.checkExistingDispatch); // POST /api/dispatches/check-existing
router.post('/create-from-packing', dispatchController_js_1.createDispatchFromPacking); // POST /api/dispatches/create-from-packing
// Delivery Challan specific routes
router.get('/todays-products', dispatchController_js_1.getTodaysProducts); // GET /api/dispatches/todays-products
router.get('/items-history', dispatchController_js_1.getDispatchItemsHistory); // GET /api/dispatches/items-history
router.get('/validate-dc-number', dispatchController_js_1.validateDCNumber); // GET /api/dispatches/validate-dc-number
router.post('/create-delivery-challan', dispatchController_js_1.createDeliveryChallan); // POST /api/dispatches/create-delivery-challan
router.post('/generate-invoice/:dcId', dispatchController_js_1.generateInvoiceForDC); // POST /api/dispatches/generate-invoice/:dcId
router.post('/create-dispatch-order', dispatchController_js_1.createDispatchOrder); // POST /api/dispatches/create-dispatch-order
// Direct order creation routes
router.post('/create-direct-order', dispatchController_js_1.createDirectOrder); // POST /api/dispatches/create-direct-order
router.get('/sales-persons', dispatchController_js_1.getSalesPersonsForDispatch); // GET /api/dispatches/sales-persons
router.get('/customers', dispatchController_js_1.getCustomersForDispatch); // GET /api/dispatches/customers
router.get('/products', dispatchController_js_1.getProductsForDispatch); // GET /api/dispatches/products
router.get('/today-order-items', dispatchController_js_1.getTodayOrderItems); // GET /api/dispatches/today-order-items
router.put('/update-qty-issued', dispatchController_js_1.updateQtyIssued); // PUT /api/dispatches/update-qty-issued
router.post('/approve-product', dispatchController_js_1.approveProduct); // POST /api/dispatches/approve-product
router.post('/generate-invoice', dispatchController_js_1.generateInvoice); // POST /api/dispatches/generate-invoice
router.post('/generate-invoice-by-dc', dispatchController_js_1.generateInvoiceByDC); // POST /api/dispatches/generate-invoice-by-dc
router.get('/:id', dispatchController_js_1.getDispatchById); // GET /api/dispatches/:id
router.post('/', dispatchController_js_1.createDispatch); // POST /api/dispatches
router.put('/:id', dispatchController_js_1.updateDispatch); // PUT /api/dispatches/:id
router.delete('/:id', dispatchController_js_1.deleteDispatch); // DELETE /api/dispatches/:id
exports.default = router;
