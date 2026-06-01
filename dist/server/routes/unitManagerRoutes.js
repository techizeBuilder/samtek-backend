"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
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
const unitManagerController_js_1 = require("../controllers/unitManagerController.js");
const bulkGroupApprovalController_js_1 = require("../controllers/bulkGroupApprovalController.js");
// Import models for debug endpoint
const User_js_1 = __importDefault(require("../models/User.js"));
const Order_js_1 = __importDefault(require("../models/Order.js"));
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(auth_js_1.authenticateToken);
// Test endpoint to verify API structure
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Unit Manager API is working with enhanced grouping',
        timestamp: new Date().toISOString(),
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        },
        codeVersion: 'PRODUCTDAILYSUMMARY_FIX_v2.0'
    });
});
// Debug endpoint to check users and orders
router.get('/debug', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        // Check users in same company
        const companyUsers = yield User_js_1.default.find({
            companyId: user.companyId
        }).select('_id username role fullName companyId').lean();
        // Check orders for these users
        const userIds = companyUsers.map(u => u._id);
        const orders = yield Order_js_1.default.find({
            salesPerson: { $in: userIds }
        }).populate('salesPerson', 'username fullName role')
            .populate('customer', 'name')
            .select('orderCode customer salesPerson status orderDate')
            .lean();
        res.json({
            success: true,
            debug: {
                currentUser: {
                    id: user._id,
                    username: user.username,
                    role: user.role,
                    companyId: user.companyId
                },
                companyUsers: companyUsers.map(u => ({
                    id: u._id,
                    username: u.username,
                    role: u.role,
                    fullName: u.fullName,
                    companyId: u.companyId
                })),
                ordersCount: orders.length,
                ordersBySalesPerson: orders.reduce((acc, order) => {
                    var _a, _b;
                    const spName = ((_a = order.salesPerson) === null || _a === void 0 ? void 0 : _a.username) || 'unassigned';
                    if (!acc[spName])
                        acc[spName] = [];
                    acc[spName].push({
                        orderCode: order.orderCode,
                        customer: (_b = order.customer) === null || _b === void 0 ? void 0 : _b.name,
                        status: order.status
                    });
                    return acc;
                }, {})
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}));
// Unit Manager specific routes - Fixed to use proper items endpoint
router.get('/items', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Import necessary modules
        const { Item } = yield Promise.resolve().then(() => __importStar(require('../models/Inventory.js')));
        const user = req.user;
        console.log('🔍 Unit Manager Items API:', {
            role: user.role,
            companyId: user.companyId,
            store: user.companyId
        });
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        // Get all items for this company using correct field 'store'
        const items = yield Item.find({
            store: user.companyId // Items use 'store' field, not 'companyId'
        })
            .select('name code category subCategory batch qty unit price image salePrice stdCost')
            .sort({ name: 1 })
            .lean();
        console.log(`Unit Manager items API: Found ${items.length} items for company ${user.companyId}`);
        res.json({
            success: true,
            data: items,
            items: items // Also include 'items' for backward compatibility
        });
    }
    catch (error) {
        console.error('Unit Manager items API error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch items',
            error: error.message
        });
    }
}));
// COMMENTED OUT - Using product summary API instead
// router.get('/orders', getOrders); // Main API with all data
router.get('/all-orders', unitManagerController_js_1.getAllOrders); // New endpoint for sales order list
router.get('/sales-order-list', unitManagerController_js_1.getAllOrders); // Alternative endpoint for sales order list
router.get('/orders/:id', unitManagerController_js_1.getOrderById); // Get single order details
router.get('/customers', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { authenticateToken } = yield Promise.resolve().then(() => __importStar(require('../middleware/auth.js')));
        const Customer = (yield Promise.resolve().then(() => __importStar(require('../models/Customer.js')))).default;
        // Get user's company ID for filtering
        const userCompanyId = req.user.companyId;
        if (!userCompanyId) {
            return res.status(400).json({
                success: false,
                message: 'User company not found'
            });
        }
        // Get customers only for the unit manager's company
        const customers = yield Customer.find({
            companyId: userCompanyId
        }, 'name email phone companyId').sort({ name: 1 }).lean();
        console.log(`Unit Manager customers API: Found ${customers.length} customers for company ${userCompanyId}`);
        res.json({ success: true, data: customers });
    }
    catch (error) {
        console.error('Unit Manager customers API error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch customers', error: error.message });
    }
})); // Get customers for filter dropdown
router.get('/salespersons', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const User = (yield Promise.resolve().then(() => __importStar(require('../models/User.js')))).default;
        // Get all sales persons for dropdown - using multiple role variations
        const salesPersons = yield User.find({
            role: { $in: ['Sales', 'sales', 'SALES', 'Sales Person', 'SalesPerson', 'Sales Head', 'Sales Employee'] }
        }, 'fullName email username').sort({ fullName: 1 }).lean();
        res.json({ success: true, data: salesPersons });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch salespersons', error: error.message });
    }
})); // Get salespersons for filter dropdown
router.get('/fix-orders', unitManagerController_js_1.fixOrdersSalesPersonAssignment); // Utility to fix existing orders
// router.get('/users', getSalesPersons); // Commented - data now included in /orders
router.put('/orders/:id/status', unitManagerController_js_1.updateOrderStatus); // Single or bulk approve
router.patch('/orders/:id/status', unitManagerController_js_1.updateOrderStatus); // Add PATCH support
router.get('/dashboard/stats', unitManagerController_js_1.getDashboardStats);
// Product Summary Approval Routes (Single endpoint for both individual and bulk)
router.post('/product-summary/approve', unitManagerController_js_1.approveProductSummaries); // Individual & Bulk approve
router.post('/approve-product-summaries', unitManagerController_js_1.approveProductSummaries); // Alternative endpoint for frontend compatibility
// 🎯 NEW: Bulk approve entire production group (optimal batch creation)
router.post('/bulk-approve-group', (req, res) => {
    console.log('🎯 POST /unit-manager/bulk-approve-group called');
    console.log('User:', req.user ? { id: req.user.id, role: req.user.role } : 'No user');
    console.log('Body:', req.body);
    try {
        (0, bulkGroupApprovalController_js_1.bulkApproveGroup)(req, res);
    }
    catch (error) {
        console.error('Error in bulk-approve-group route:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
// Get approved product summaries with available batches
router.get('/product-summaries/approved', unitManagerController_js_1.getApprovedProductSummaries);
// Production Groups routes (Unit Manager specific functions)
router.get('/production-groups', unitManagerController_js_1.getUnitManagerProductionGroups);
router.get('/production-groups/:id', unitManagerController_js_1.getUnitManagerProductionGroupById);
router.post('/production-groups', unitManagerController_js_1.createUnitManagerProductionGroup);
router.put('/production-groups/:id', unitManagerController_js_1.updateUnitManagerProductionGroup);
router.delete('/production-groups/:id', unitManagerController_js_1.deleteUnitManagerProductionGroup);
router.get('/production-groups/items/available', unitManagerController_js_1.getUnitManagerAvailableItems);
// Unit Manager Returns & Damage Management Routes (Consolidated)
router.get('/returns', unitManagerController_js_1.getUnitManagerReturns);
router.post('/create-return', unitManagerController_js_1.createUnitManagerReturn);
router.put('/update-return/:id', unitManagerController_js_1.updateUnitManagerReturn);
router.delete('/delete-return/:id', unitManagerController_js_1.deleteUnitManagerReturn);
router.post('/approve-return/:id', unitManagerController_js_1.approveUnitManagerReturn);
router.post('/update-return-status/:id', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const Return = (yield Promise.resolve().then(() => __importStar(require('../models/Return.js')))).default;
        const { status } = req.body;
        const { id } = req.params;
        const user = req.user;
        console.log('🔄 Updating return status:', { id, status, userId: user._id });
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        // Validate status
        const validStatuses = ['pending', 'approved', 'rejected', 'processing', 'completed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
            });
        }
        // Find and update the return
        const returnRecord = yield Return.findOne({
            _id: id,
            companyId: user.companyId
        });
        if (!returnRecord) {
            return res.status(404).json({
                success: false,
                message: 'Return not found'
            });
        }
        // If status is being updated to 'approved', deduct amount from customer outstanding and sync with Invoices
        if (status === 'approved' && returnRecord.status !== 'approved') {
            try {
                const Customer = (yield Promise.resolve().then(() => __importStar(require('../models/Customer.js')))).default;
                const customer = yield Customer.findById(returnRecord.customerId);
                if (customer) {
                    const oldBalance = customer.outstandingAmount || 0;
                    customer.outstandingAmount = oldBalance - (returnRecord.totalAmount || 0);
                    yield customer.save();
                    console.log(`💰 Updated Customer ${customer.name} balance via inline route: ${oldBalance} -> ${customer.outstandingAmount}`);
                    // SYNC INVOICE BALANCES FOR AGEING REPORT
                    let remainingReturnAmount = returnRecord.totalAmount || 0;
                    // 1. Try targeted invoice if order is linked
                    if (returnRecord.order) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const targetInvoice = yield Sale.findOne({ order: returnRecord.order });
                        if (targetInvoice && targetInvoice.balanceAmount > 0) {
                            const reduction = Math.min(targetInvoice.balanceAmount, remainingReturnAmount);
                            targetInvoice.balanceAmount -= reduction;
                            remainingReturnAmount -= reduction;
                            yield targetInvoice.save();
                            console.log(`📑 Reduced targeted invoice ${targetInvoice.invoiceNumber} balance by ${reduction}`);
                        }
                    }
                    // 2. FIFO reduction
                    if (remainingReturnAmount > 0) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const unpaidInvoices = yield Sale.find({
                            customer: returnRecord.customerId,
                            balanceAmount: { $gt: 0 }
                        }).sort({ saleDate: 1 });
                        for (const inv of unpaidInvoices) {
                            if (remainingReturnAmount <= 0)
                                break;
                            const reduction = Math.min(inv.balanceAmount, remainingReturnAmount);
                            inv.balanceAmount -= reduction;
                            remainingReturnAmount -= reduction;
                            yield inv.save();
                            console.log(`📑 Reduced invoice ${inv.invoiceNumber} balance by ${reduction} (FIFO)`);
                        }
                    }
                }
            }
            catch (err) {
                console.error('❌ Error updating customer balance in inline status update:', err);
            }
        }
        // Update status
        returnRecord.status = status;
        returnRecord.updatedAt = new Date();
        returnRecord.updatedBy = user._id;
        yield returnRecord.save();
        console.log('✅ Return status updated successfully');
        res.json({
            success: true,
            message: 'Return status updated successfully',
            data: returnRecord
        });
    }
    catch (error) {
        console.error('❌ Error updating return status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update return status',
            error: error.message
        });
    }
}));
// Unit Manager Damages Management Routes
router.get('/damages', unitManagerController_js_1.getUnitManagerDamages);
router.post('/create-damage', unitManagerController_js_1.createUnitManagerDamage);
router.put('/update-damage/:id', unitManagerController_js_1.updateUnitManagerDamage);
router.delete('/delete-damage/:id', unitManagerController_js_1.deleteUnitManagerDamage);
router.post('/approve-damage/:id', unitManagerController_js_1.approveUnitManagerDamage);
// Get sales persons for the company (for dropdowns)
router.get('/sales-persons', unitManagerController_js_1.getUnitManagerSalesPersons);
exports.default = router;
