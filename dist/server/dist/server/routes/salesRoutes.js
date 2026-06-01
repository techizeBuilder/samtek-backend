"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const itemUpload_js_1 = require("../middleware/itemUpload.js");
const salesController_js_1 = require("../controllers/salesController.js");
// Import with different names to avoid conflicts
const salesSummaryController_js_1 = require("../controllers/salesSummaryController.js");
const salesRouter = express_1.default.Router();
// Debug endpoint without auth to test route registration - MUST be before middleware
salesRouter.get('/debug', (req, res) => {
    res.json({
        success: true,
        message: 'Sales routes are working!',
        timestamp: new Date().toISOString(),
        serverTime: new Date().toLocaleString(),
        availableRoutes: [
            'GET /api/sales/debug (no auth)',
            'GET /api/sales/debug-customers (no auth)',
            'GET /api/sales/test-summary (needs auth)',
            'GET /api/sales/product-summary (needs auth)',
            'POST /api/sales/update-product-summary (needs auth)'
        ]
    });
});
// Debug customers endpoint - NO AUTH REQUIRED
salesRouter.get('/debug-customers', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { default: Customer } = yield Promise.resolve().then(() => __importStar(require('../models/Customer.js')));
        // Get sample customers
        const sampleCustomers = yield Customer.find({}).select('name category active').limit(5);
        // Get distinct categories
        const categories = yield Customer.distinct('category');
        // Get distinct active values
        const activeValues = yield Customer.distinct('active');
        // Count by category
        const categoryCounts = {};
        for (const cat of categories) {
            categoryCounts[cat] = yield Customer.countDocuments({ category: cat });
        }
        // Count by active status
        const activeCounts = {};
        for (const active of activeValues) {
            activeCounts[active] = yield Customer.countDocuments({ active });
        }
        res.json({
            success: true,
            message: 'Customer data debug info',
            data: {
                totalCustomers: yield Customer.countDocuments(),
                categories,
                activeValues,
                categoryCounts,
                activeCounts,
                sampleCustomers
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching debug info',
            error: error.message
        });
    }
}));
// Apply authentication to all other sales routes
salesRouter.use(auth_js_1.authenticateToken);
// Test endpoint with auth to verify middleware is working
salesRouter.get('/test-summary', (req, res) => {
    res.json({
        success: true,
        message: 'Sales summary routes are authenticated and working',
        timestamp: new Date().toISOString(),
        user: req.user ? {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role,
            companyId: req.user.companyId
        } : 'No user found',
        endpoints: [
            'GET /api/sales/product-summary',
            'POST /api/sales/update-product-summary'
        ]
    });
});
// Sales approval dashboard routes (product summary with calculations)
salesRouter.get('/product-summary', (req, res) => {
    console.log('🔍 GET /product-summary called');
    console.log('User:', req.user ? { id: req.user.id, role: req.user.role, companyId: req.user.companyId } : 'No user');
    console.log('Query params:', req.query);
    try {
        (0, salesSummaryController_js_1.getSalesSummary)(req, res);
    }
    catch (error) {
        console.error('Error in product-summary route:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
// Alias: /products-summary (plural) — used by Unit Head Indent Summary page
salesRouter.get('/products-summary', (0, auth_js_1.authorizeRoles)('Sales', 'Sales Head', 'Sales Employee', 'Unit Manager', 'Superadmin', 'Unit Head'), (req, res) => {
    console.log('🔍 GET /products-summary (Unit Head alias) called');
    console.log('User:', req.user ? { id: req.user.id, role: req.user.role } : 'No user');
    console.log('Query params:', req.query);
    try {
        (0, salesSummaryController_js_1.getSalesSummary)(req, res);
    }
    catch (error) {
        console.error('Error in products-summary route:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});
// Apply role-based authorization for other sales routes only
salesRouter.use((0, auth_js_1.authorizeRoles)('Sales', 'Sales Head', 'Sales Employee', 'Unit Manager', 'Superadmin'));
// MOVED: Only Unit Managers and Super Admins can update product summary
salesRouter.post('/update-product-summary', (0, auth_js_1.authorizeRoles)('Unit Manager', 'Superadmin'), (req, res) => {
    console.log('🔍 POST /update-product-summary called');
    console.log('User:', req.user ? { id: req.user.id, role: req.user.role, companyId: req.user.companyId } : 'No user');
    console.log('Body:', req.body);
    try {
        (0, salesSummaryController_js_1.updateSalesSummary)(req, res);
    }
    catch (error) {
        console.error('Error in update-product-summary route:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
// Sales-specific dashboard routes
salesRouter.get('/summary', salesController_js_1.getSalesSummary);
salesRouter.get('/recent-orders', salesController_js_1.getSalesRecentOrders);
// Sales-specific order routes (filtered by individual salesperson)
salesRouter.get('/orders', salesController_js_1.getSalesOrders);
// Priority Products routes
salesRouter.get('/priority-products', salesController_js_1.getPriorityProducts);
salesRouter.post('/priority-products', salesController_js_1.addPriorityProduct);
salesRouter.delete('/priority-products/:id', salesController_js_1.removePriorityProduct);
salesRouter.post('/priority-products/usage', salesController_js_1.updatePriorityProductUsage);
// Cutoff time status for sales persons
salesRouter.get('/cutoff-time-status', salesController_js_1.getSalesCutoffTimeStatus);
// Sales-specific customer routes (filtered by salesperson assignment)
salesRouter.get('/customers', salesController_js_1.getSalespersonCustomers);
// Other salesperson-specific routes
salesRouter.get('/my-customers', salesController_js_1.getSalespersonCustomers);
salesRouter.get('/my-deliveries', salesController_js_1.getSalespersonDeliveries);
salesRouter.get('/my-invoices', salesController_js_1.getSalespersonInvoices);
salesRouter.get('/refund-return', salesController_js_1.getSalespersonRefundReturns);
salesRouter.get('/returns', salesController_js_1.getSalespersonReturns);
salesRouter.get('/damages', salesController_js_1.getSalespersonDamages);
salesRouter.post('/create-return', salesController_js_1.createSalespersonReturn);
salesRouter.put('/update-return/:id', salesController_js_1.updateSalespersonReturn);
salesRouter.delete('/delete-return/:id', salesController_js_1.deleteSalespersonReturn);
salesRouter.post('/create-damage', salesController_js_1.createSalespersonDamage);
salesRouter.put('/update-damage/:id', salesController_js_1.updateSalespersonDamage);
salesRouter.delete('/delete-damage/:id', salesController_js_1.deleteSalespersonDamage);
salesRouter.get('/items', salesController_js_1.getSalespersonItems);
salesRouter.post('/create-item', itemUpload_js_1.itemUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'brochure', maxCount: 1 }]), salesController_js_1.createSalespersonItem);
salesRouter.get('/invoice/:id/pdf', salesController_js_1.downloadInvoicePDF);
salesRouter.post('/send-quotation-email', salesController_js_1.sendQuotationEmailHandler);
exports.default = salesRouter;
