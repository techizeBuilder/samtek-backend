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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveUnitManagerDamage = exports.deleteUnitManagerDamage = exports.updateUnitManagerDamage = exports.createUnitManagerDamage = exports.getUnitManagerDamages = exports.approveUnitManagerReturn = exports.deleteUnitManagerReturn = exports.updateUnitManagerReturn = exports.createUnitManagerReturn = exports.getUnitManagerReturns = exports.getUnitManagerSalesPersons = exports.getApprovedProductSummaries = exports.getUnitManagerAvailableItems = exports.deleteUnitManagerProductionGroup = exports.updateUnitManagerProductionGroup = exports.createUnitManagerProductionGroup = exports.getUnitManagerProductionGroupById = exports.getUnitManagerProductionGroups = exports.approveProductSummaries = exports.getOrderById = exports.getAllOrders = exports.getSalesPersons = exports.getDashboardStats = exports.getOrders = exports.fixOrdersSalesPersonAssignment = exports.updateOrderStatus = exports.getItems = void 0;
const Order_js_1 = __importDefault(require("../models/Order.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const User_js_1 = __importDefault(require("../models/User.js"));
const Return_js_1 = __importDefault(require("../models/Return.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const ProductDailySummary_js_1 = __importDefault(require("../models/ProductDailySummary.js"));
const ProductDetailsDailySummary_js_1 = __importDefault(require("../models/ProductDetailsDailySummary.js"));
const ProductionBatch_js_1 = __importDefault(require("../models/ProductionBatch.js"));
const ProductionGroup_js_1 = __importDefault(require("../models/ProductionGroup.js"));
const mongoose_1 = __importDefault(require("mongoose"));
// Get items for Unit Manager (inventory access)
const getItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;
        // Create base filter to ensure company isolation
        const baseFilter = {
            companyId: user.companyId
        };
        // Add unit to filter only if it exists (backward compatibility)
        if (user.unit) {
            baseFilter.unit = user.unit;
        }
        // Build search query
        const searchQuery = Object.assign({}, baseFilter);
        if (search) {
            searchQuery.$and = [
                baseFilter,
                {
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { code: { $regex: search, $options: 'i' } },
                        { category: { $regex: search, $options: 'i' } }
                    ]
                }
            ];
        }
        // Get items with pagination
        const [items, totalItems] = yield Promise.all([
            Inventory_js_1.Item.find(searchQuery)
                .select('name code category subCategory price stock')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Inventory_js_1.Item.countDocuments(searchQuery)
        ]);
        res.status(200).json({
            success: true,
            items,
            pagination: {
                total: totalItems,
                page,
                pages: Math.ceil(totalItems / limit),
                limit
            }
        });
    }
    catch (error) {
        console.error('Unit Manager getItems error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch items',
            error: error.message
        });
    }
});
exports.getItems = getItems;
// Update order status (approve/reject/move to production or bulk approve all)
const updateOrderStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        console.log('🚀 UNIT MANAGER updateOrderStatus called');
        console.log('Request params:', req.params);
        console.log('Request body:', req.body);
        console.log('User:', { id: req.user._id, role: req.user.role, companyId: req.user.companyId });
        const user = req.user;
        const { id: orderId } = req.params;
        const { status, notes, bulkApprove } = req.body;
        console.log('🔍 DEBUG - orderId:', orderId);
        console.log('🔍 DEBUG - bulkApprove:', bulkApprove);
        console.log('🔍 DEBUG - status:', status);
        console.log('🔍 DEBUG - Condition check:', bulkApprove === true || orderId === 'bulk-approve');
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        // 🎯 BULK APPROVE ALL ORDERS
        if (bulkApprove === true || orderId === 'bulk-approve') {
            console.log('📦 BULK APPROVE MODE ACTIVATED');
            // Create base filter to ensure company isolation
            const baseFilter = {
                companyId: user.companyId,
                status: 'pending' // Only approve pending orders
            };
            // Add unit to filter only if it exists (backward compatibility)
            if (user.unit) {
                baseFilter.unit = user.unit;
            }
            // Get all orders that need to be approved
            const orders = yield Order_js_1.default.find(baseFilter).populate('products.product', 'name code');
            console.log(`🔍 Found ${orders.length} orders to approve`);
            if (orders.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: 'No orders found to approve',
                    approvedCount: 0
                });
            }
            let approvedCount = 0;
            const errors = [];
            // Process each order
            for (const order of orders) {
                try {
                    const previousStatus = order.status;
                    // 🎯 CREATE PRODUCTDAILYSUMMARY ENTRIES
                    console.log(`📊 Creating ProductDailySummary entries for order ${order.orderCode}...`);
                    console.log('Order details:', {
                        orderId: order._id,
                        orderCode: order.orderCode,
                        currentStatus: order.status,
                        newStatus: 'approved',
                        productsCount: ((_a = order.products) === null || _a === void 0 ? void 0 : _a.length) || 0,
                        orderDate: order.orderDate,
                        companyId: order.companyId
                    });
                    try {
                        for (const productItem of order.products) {
                            console.log(`\n🔍 Processing product: ${((_b = productItem.product) === null || _b === void 0 ? void 0 : _b.name) || 'Unknown'}`);
                            console.log(`   Product ID: ${(_c = productItem.product) === null || _c === void 0 ? void 0 : _c._id}`);
                            console.log(`   Quantity: ${productItem.quantity}`);
                            // Get complete product details including qtyPerBatch
                            let productName = (_d = productItem.product) === null || _d === void 0 ? void 0 : _d.name;
                            const productId = ((_e = productItem.product) === null || _e === void 0 ? void 0 : _e._id) || productItem.product;
                            let qtyPerBatch = 0;
                            // Always fetch complete product details for batch information
                            console.log(`📦 Fetching complete product details from database...`);
                            const productDetails = yield Inventory_js_1.Item.findById(productId).select('name batch qty unit price').lean();
                            if (!productDetails) {
                                console.log(`⚠️ Product not found in database: ${productId}`);
                                continue;
                            }
                            // Use product details - batch field contains the quantity value (e.g., "169" = 169g/units)
                            productName = productName || productDetails.name;
                            // Parse batch as qtyPerBatch - it contains the numeric quantity value
                            qtyPerBatch = productDetails.batch ? parseFloat(productDetails.batch) || 1 : 1;
                            console.log(`   Using product name: ${productName}`);
                            console.log(`   Product qtyPerBatch: ${qtyPerBatch}`);
                            console.log(`   Product details: batch=${productDetails.batch}, qty=${productDetails.qty}, unit=${productDetails.unit}, price=${productDetails.price}`);
                            // ✅ FIXED: Check if ProductDailySummary entry exists for this product + company (ignore date)
                            const existingSummary = yield ProductDailySummary_js_1.default.findOne({
                                productId: productId,
                                companyId: order.companyId
                            });
                            if (existingSummary) {
                                // Update existing entry - set productionFinalBatches to 0 instead of adding quantity
                                const oldBatches = existingSummary.productionFinalBatches;
                                existingSummary.productionFinalBatches = 0; // Always set to 0 as requested
                                // ✅ UPDATE DATE TO CURRENT ORDER DATE
                                existingSummary.date = order.orderDate;
                                // Update qtyPerBatch if it was 0 or not set
                                if (!existingSummary.qtyPerBatch || existingSummary.qtyPerBatch === 0) {
                                    existingSummary.qtyPerBatch = qtyPerBatch;
                                    console.log(`   📝 Updated qtyPerBatch from ${existingSummary.qtyPerBatch} to ${qtyPerBatch}`);
                                }
                                yield existingSummary.save();
                                console.log(`   ✅ Updated ProductDailySummary: ${productName}, ${oldBatches} set to 0 (was ${oldBatches})`);
                                console.log(`   📅 Updated date to: ${order.orderDate}`);
                            }
                            else {
                                // Create new ProductDailySummary entry with proper qtyPerBatch
                                const newSummary = new ProductDailySummary_js_1.default({
                                    productId: productId,
                                    productName: productName,
                                    date: order.orderDate,
                                    companyId: order.companyId,
                                    productionFinalBatches: 0, // Always set to 0 as requested
                                    qtyPerBatch: qtyPerBatch, // ✅ SET FROM ITEM DATA
                                    totalRequirements: productItem.quantity,
                                    createdAt: new Date(),
                                    updatedAt: new Date()
                                });
                                yield newSummary.save();
                                console.log(`   ✅ Created new ProductDailySummary: ${productName}`);
                                console.log(`      - ProductionFinalBatches: 0 (always set to 0)`);
                                console.log(`      - QtyPerBatch: ${qtyPerBatch}`);
                                console.log(`      - TotalRequirements: ${productItem.quantity}`);
                            }
                        }
                        console.log(`🎉 Successfully updated ProductDailySummary for order ${order.orderCode}`);
                    }
                    catch (summaryError) {
                        console.error('❌ Failed to update ProductDailySummary:', summaryError);
                        console.error('Error details:', summaryError.message);
                        console.error('Stack trace:', summaryError.stack);
                        // Log error but don't fail the order approval
                    }
                    // Update order status
                    const newHistoryEntry = {
                        status: 'approved',
                        updatedBy: user._id,
                        updatedAt: new Date(),
                        notes: `Bulk approved by Unit Manager: ${user.fullName || user.username}`,
                        previousStatus: previousStatus
                    };
                    yield Order_js_1.default.findByIdAndUpdate(order._id, {
                        $set: {
                            status: 'approved',
                            updatedAt: new Date()
                        },
                        $push: {
                            statusHistory: newHistoryEntry
                        }
                    }, {
                        new: true,
                        runValidators: false
                    });
                    approvedCount++;
                    console.log(`✅ Approved order ${order.orderCode}`);
                }
                catch (error) {
                    console.error(`❌ Error approving order ${order.orderCode}:`, error.message);
                    errors.push({ orderCode: order.orderCode, error: error.message });
                }
            }
            return res.status(200).json({
                success: true,
                message: `Successfully approved ${approvedCount} orders`,
                approvedCount,
                totalOrders: orders.length,
                errors: errors.length > 0 ? errors : undefined
            });
        }
        // 🎯 SINGLE ORDER STATUS UPDATE
        // Validate status for single order update
        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required for single order update'
            });
        }
        const allowedStatuses = ['pending', 'approved', 'rejected'];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`
            });
        }
        // Create base filter to ensure company isolation
        const baseFilter = {
            companyId: user.companyId
        };
        // Add unit to filter only if it exists (backward compatibility)
        if (user.unit) {
            baseFilter.unit = user.unit;
        }
        // Find the order with company isolation and populate products
        const order = yield Order_js_1.default.findOne(Object.assign({ _id: orderId }, baseFilter))
            .populate('products.product', 'name code');
        console.log('🔍 Found order:', order ? `${order.orderCode} (${order.status})` : 'NOT FOUND');
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or not accessible'
            });
        }
        // Update order status and add new history entry without validating existing entries
        const previousStatus = order.status; // Store previous status before updating
        // 🎯 CREATE PRODUCTDAILYSUMMARY ENTRIES WHEN ORDER IS APPROVED
        if (status === 'approved') {
            console.log('📊 Creating ProductDailySummary entries for approved order by Unit Manager...');
            console.log('Order details:', {
                orderId: order._id,
                orderCode: order.orderCode,
                currentStatus: order.status,
                newStatus: status,
                productsCount: ((_f = order.products) === null || _f === void 0 ? void 0 : _f.length) || 0,
                orderDate: order.orderDate,
                companyId: order.companyId
            });
            try {
                for (const productItem of order.products) {
                    console.log(`\n🔍 Processing product: ${((_g = productItem.product) === null || _g === void 0 ? void 0 : _g.name) || 'Unknown'}`);
                    console.log(`   Product ID: ${(_h = productItem.product) === null || _h === void 0 ? void 0 : _h._id}`);
                    console.log(`   Quantity: ${productItem.quantity}`);
                    // Get complete product details including qtyPerBatch
                    let productName = (_j = productItem.product) === null || _j === void 0 ? void 0 : _j.name;
                    const productId = ((_k = productItem.product) === null || _k === void 0 ? void 0 : _k._id) || productItem.product;
                    let qtyPerBatch = 0;
                    // Always fetch complete product details for batch information
                    console.log(`📦 Fetching complete product details from database...`);
                    const productDetails = yield Inventory_js_1.Item.findById(productId).select('name batch qty unit price').lean();
                    if (!productDetails) {
                        console.log(`⚠️ Product not found in database: ${productId}`);
                        continue;
                    }
                    // Use product details - batch field contains the quantity value (e.g., "169" = 169g/units)
                    productName = productName || productDetails.name;
                    // Parse batch as qtyPerBatch - it contains the numeric quantity value
                    qtyPerBatch = productDetails.batch ? parseFloat(productDetails.batch) || 1 : 1;
                    console.log(`   Using product name: ${productName}`);
                    console.log(`   Product qtyPerBatch: ${qtyPerBatch}`);
                    console.log(`   Product details: batch=${productDetails.batch}, qty=${productDetails.qty}, unit=${productDetails.unit}, price=${productDetails.price}`);
                    // ✅ NORMALIZE DATE TO START OF DAY for storage
                    const summaryDate = new Date(order.orderDate);
                    summaryDate.setUTCHours(0, 0, 0, 0);
                    console.log(`   📅 Original order date: ${order.orderDate}`);
                    console.log(`   📅 Normalized summary date: ${summaryDate}`);
                    // Check if ProductDailySummary entry already exists for this product and company
                    // FIXED: Use only company+product ID, completely ignore date
                    const existingSummary = yield ProductDailySummary_js_1.default.findOne({
                        productId: productId,
                        companyId: order.companyId
                    });
                    if (existingSummary) {
                        // Update existing entry - ADD the new quantity to existing totalQuantity
                        const oldQuantity = existingSummary.totalQuantity || 0;
                        const newQuantity = oldQuantity + productItem.quantity;
                        existingSummary.totalQuantity = newQuantity;
                        // Update qtyPerBatch if it was 0 or not set
                        if (!existingSummary.qtyPerBatch || existingSummary.qtyPerBatch === 0) {
                            existingSummary.qtyPerBatch = qtyPerBatch;
                            console.log(`   📝 Updated qtyPerBatch from ${existingSummary.qtyPerBatch} to ${qtyPerBatch}`);
                        }
                        yield existingSummary.save();
                        console.log(`   ✅ Updated ProductDailySummary: ${productName}, quantity: ${oldQuantity} + ${productItem.quantity} = ${newQuantity}`);
                    }
                    else {
                        // Create new ProductDailySummary entry with proper qtyPerBatch
                        try {
                            const newSummary = new ProductDailySummary_js_1.default({
                                productId: productId,
                                productName: productName,
                                date: summaryDate, // ✅ USE NORMALIZED DATE
                                companyId: order.companyId,
                                productionFinalBatches: 0, // Initialize to 0
                                qtyPerBatch: qtyPerBatch, // ✅ SET FROM ITEM DATA
                                totalQuantity: productItem.quantity, // Set initial quantity
                                status: 'pending', // ✅ SET DEFAULT STATUS
                                createdAt: new Date(),
                                updatedAt: new Date()
                            });
                            yield newSummary.save();
                            console.log(`   ✅ Created new ProductDailySummary: ${productName}`);
                            console.log(`      - ProductionFinalBatches: 0 (initialized)`);
                            console.log(`      - QtyPerBatch: ${qtyPerBatch}`);
                            console.log(`      - TotalQuantity: ${productItem.quantity}`);
                        }
                        catch (createError) {
                            // Handle duplicate key error (race condition)
                            if (createError.code === 11000) {
                                console.log(`   ⚠️ ProductDailySummary already exists (race condition), updating instead...`);
                                // Try to find and update the existing entry
                                const raceSummary = yield ProductDailySummary_js_1.default.findOne({
                                    productId: productId,
                                    companyId: order.companyId
                                });
                                if (raceSummary) {
                                    // ADD the new quantity to existing totalQuantity
                                    const oldQuantity = raceSummary.totalQuantity || 0;
                                    const newQuantity = oldQuantity + productItem.quantity;
                                    raceSummary.totalQuantity = newQuantity;
                                    if (!raceSummary.qtyPerBatch || raceSummary.qtyPerBatch === 0) {
                                        raceSummary.qtyPerBatch = qtyPerBatch;
                                    }
                                    yield raceSummary.save();
                                    console.log(`   ✅ Updated existing ProductDailySummary after race condition: ${productName}, quantity: ${oldQuantity} + ${productItem.quantity} = ${newQuantity}`);
                                }
                                else {
                                    console.log(`   ❌ Could not find or create ProductDailySummary for: ${productName}`);
                                }
                            }
                            else {
                                throw createError; // Re-throw other errors
                            }
                        }
                    }
                }
                console.log(`🎉 Successfully updated ProductDailySummary for order ${order.orderCode}`);
            }
            catch (summaryError) {
                console.error('❌ Failed to update ProductDailySummary:', summaryError);
                console.error('Error details:', summaryError.message);
                console.error('Stack trace:', summaryError.stack);
                // Log error but don't fail the order approval
            }
        }
        else {
            console.log(`ℹ️ Order status '${status}' - ProductDailySummary creation skipped (only for 'approved' status)`);
        }
        const newHistoryEntry = {
            status: status,
            updatedBy: user._id,
            updatedAt: new Date(),
            notes: notes || `Status updated by Unit Manager: ${user.fullName || user.username}`,
            previousStatus: previousStatus
        };
        // Use findByIdAndUpdate to avoid validation issues with existing statusHistory entries
        const updatedOrder = yield Order_js_1.default.findByIdAndUpdate(orderId, {
            $set: {
                status: status,
                updatedAt: new Date()
            },
            $push: {
                statusHistory: newHistoryEntry
            }
        }, {
            new: true,
            runValidators: false // Skip validation to avoid issues with existing invalid entries
        });
        res.status(200).json({
            success: true,
            message: `Order ${status} successfully`,
            order: {
                _id: updatedOrder._id,
                orderCode: updatedOrder.orderCode,
                status: updatedOrder.status,
                previousStatus: previousStatus,
                updatedAt: updatedOrder.updatedAt,
                statusHistory: updatedOrder.statusHistory
            }
        });
    }
    catch (error) {
        console.error('Unit Manager updateOrderStatus error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update order status',
            error: error.message
        });
    }
});
exports.updateOrderStatus = updateOrderStatus;
// Utility function to fix orders without salesPerson (run once to fix existing data)
const fixOrdersSalesPersonAssignment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        // Only allow Unit Manager or Super Admin role for this operation
        if (user.role !== 'Unit Manager' && user.role !== 'Superadmin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager or Super Admin role required'
            });
        }
        // Create base filter to ensure company isolation for Unit Managers
        let findQuery = { salesPerson: { $exists: false } };
        if (user.role === 'Unit Manager') {
            findQuery = Object.assign(Object.assign({}, findQuery), { companyId: user.companyId });
            // Add unit to filter only if it exists (backward compatibility)
            if (user.unit) {
                findQuery.unit = user.unit;
            }
        }
        // Find orders without salesPerson
        const ordersWithoutSalesPerson = yield Order_js_1.default.find(findQuery);
        console.log('Found orders without salesPerson:', ordersWithoutSalesPerson.length);
        if (ordersWithoutSalesPerson.length === 0) {
            return res.json({
                success: true,
                message: 'No orders found without salesPerson assignment',
                updatedCount: 0
            });
        }
        // For now, we can't automatically assign these to specific users
        // This would need to be done manually or with business logic
        // But we can provide information about them
        const orderCodes = ordersWithoutSalesPerson.map(order => order.orderCode);
        res.json({
            success: true,
            message: `Found ${ordersWithoutSalesPerson.length} orders without salesPerson`,
            orderCodes,
            note: 'These orders need manual salesPerson assignment. New orders will automatically have salesPerson assigned.'
        });
    }
    catch (error) {
        console.error('Error fixing orders salesPerson assignment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check orders',
            error: error.message
        });
    }
});
exports.fixOrdersSalesPersonAssignment = fixOrdersSalesPersonAssignment;
// Get orders for Unit Manager dashboard
const getOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🚀 NEW ENHANCED getOrders FUNCTION CALLED 🚀');
        const user = req.user;
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('=== COMPANY FILTERING ===');
        console.log('User details:', {
            id: user.id,
            username: user.username,
            role: user.role,
            companyId: user.companyId
        });
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000; // Increased to get all orders for proper grouping
        const status = req.query.status;
        // Build filter query - company filtering handled through salesPerson
        const filterQuery = {};
        if (status && status !== 'all') {
            filterQuery.status = status;
        }
        // Get sales persons from the same company for filtering
        if (user.companyId) {
            // Enhanced debugging - find all users with different filters
            console.log('=== DEBUGGING USER FILTERING ===');
            // Check all users in the same company
            const allCompanyUsers = yield User_js_1.default.find({
                companyId: user.companyId
            }).select('_id username role fullName').lean();
            console.log('All users in company:', allCompanyUsers.map(u => ({
                id: u._id,
                username: u.username,
                role: u.role,
                fullName: u.fullName
            })));
            // Check specifically for Sales role variations
            const salesUsers = yield User_js_1.default.find({
                companyId: user.companyId,
                role: { $regex: /sales/i }
            }).select('_id username role fullName').lean();
            console.log('Sales users (case insensitive):', salesUsers.map(u => ({
                id: u._id,
                username: u.username,
                role: u.role,
                fullName: u.fullName
            })));
            // Use broader role matching for sales
            const companySalesPersons = yield User_js_1.default.find({
                companyId: user.companyId,
                $or: [
                    { role: 'Sales' },
                    { role: 'sales' },
                    { role: 'Unit Manager' },
                    { role: 'Unit Head' },
                    { role: { $regex: /sales/i } } // Case insensitive sales role
                ]
            }).select('_id username role fullName').lean();
            console.log('Found company sales persons:', companySalesPersons.map(u => ({
                id: u._id,
                username: u.username,
                role: u.role,
                fullName: u.fullName
            })));
            const salesPersonIds = companySalesPersons.map(sp => sp._id);
            console.log('Company sales person IDs:', salesPersonIds);
            // Filter orders by sales persons from the same company
            filterQuery.salesPerson = { $in: salesPersonIds };
            console.log('Filtering orders by sales persons from companyId:', user.companyId);
        }
        else {
            console.log('⚠️ WARNING: User has no company assignment - showing all orders');
        }
        console.log('Filter query:', filterQuery);
        const [orders, totalOrders] = yield Promise.all([
            Order_js_1.default.find(filterQuery)
                .populate('customer', 'name email phone')
                .populate('salesPerson', 'fullName username email role companyId')
                .populate('products.product', 'name code price')
                .sort({ createdAt: -1 })
                .lean(),
            Order_js_1.default.countDocuments(filterQuery)
        ]);
        console.log('=== ENHANCED API PROCESSING ===');
        console.log('Total orders found:', orders.length);
        // Debug: Check which sales persons have orders
        const ordersGroupedBySalesPerson = orders.reduce((acc, order) => {
            var _a, _b, _c, _d, _e;
            const spId = ((_b = (_a = order.salesPerson) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString()) || 'unassigned';
            const spName = ((_c = order.salesPerson) === null || _c === void 0 ? void 0 : _c.username) || ((_d = order.salesPerson) === null || _d === void 0 ? void 0 : _d.fullName) || 'unassigned';
            if (!acc[spId]) {
                acc[spId] = { name: spName, count: 0, orders: [] };
            }
            acc[spId].count++;
            acc[spId].orders.push({
                orderCode: order.orderCode,
                customer: (_e = order.customer) === null || _e === void 0 ? void 0 : _e.name,
                status: order.status
            });
            return acc;
        }, {});
        console.log('Orders grouped by sales person:');
        Object.entries(ordersGroupedBySalesPerson).forEach(([spId, data]) => {
            console.log(`  ${data.name} (${spId}): ${data.count} orders`);
            data.orders.forEach(order => {
                console.log(`    - ${order.orderCode} (${order.customer}) - ${order.status}`);
            });
        });
        console.log('Processing product-salesperson-quantity grouping...');
        // Create product-based grouping with salesperson quantities
        const productGrouping = {};
        // Process each order to build the product-salesperson structure
        orders.forEach(order => {
            const orderProducts = order.products || [];
            orderProducts.forEach(orderProduct => {
                var _a, _b;
                if (!orderProduct.product)
                    return;
                const product = orderProduct.product;
                const productKey = product._id.toString();
                const productName = product.name || 'Unknown Product';
                const quantity = orderProduct.quantity || 0;
                // Initialize product group if not exists
                if (!productGrouping[productKey]) {
                    productGrouping[productKey] = {
                        productId: product._id,
                        productName: productName,
                        productCode: product.code || '',
                        totalOrders: 0,
                        totalQuantity: 0,
                        salesPersons: {}
                    };
                }
                // Count this order for the product
                productGrouping[productKey].totalOrders += 1;
                productGrouping[productKey].totalQuantity += quantity;
                // Handle salesperson data
                if (order.salesPerson && order.salesPerson._id) {
                    const salesPersonKey = order.salesPerson._id.toString();
                    if (!productGrouping[productKey].salesPersons[salesPersonKey]) {
                        productGrouping[productKey].salesPersons[salesPersonKey] = {
                            _id: order.salesPerson._id,
                            fullName: order.salesPerson.fullName || order.salesPerson.username || 'Unknown',
                            username: order.salesPerson.username || '',
                            email: order.salesPerson.email || '',
                            role: order.salesPerson.role || 'Sales',
                            totalQuantity: 0,
                            orderCount: 0,
                            orders: []
                        };
                    }
                    productGrouping[productKey].salesPersons[salesPersonKey].totalQuantity += quantity;
                    productGrouping[productKey].salesPersons[salesPersonKey].orderCount += 1;
                    productGrouping[productKey].salesPersons[salesPersonKey].orders.push({
                        orderId: order._id,
                        orderCode: order.orderCode,
                        quantity: quantity,
                        customerName: ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Customer',
                        status: order.status,
                        orderDate: order.orderDate
                    });
                }
                else {
                    // Handle unassigned orders
                    if (!productGrouping[productKey].salesPersons['unassigned']) {
                        productGrouping[productKey].salesPersons['unassigned'] = {
                            _id: 'unassigned',
                            fullName: 'Unassigned',
                            username: 'unassigned',
                            email: null,
                            role: null,
                            totalQuantity: 0,
                            orderCount: 0,
                            orders: []
                        };
                    }
                    productGrouping[productKey].salesPersons['unassigned'].totalQuantity += quantity;
                    productGrouping[productKey].salesPersons['unassigned'].orderCount += 1;
                    productGrouping[productKey].salesPersons['unassigned'].orders.push({
                        orderId: order._id,
                        orderCode: order.orderCode,
                        quantity: quantity,
                        customerName: ((_b = order.customer) === null || _b === void 0 ? void 0 : _b.name) || 'Unknown Customer',
                        status: order.status,
                        orderDate: order.orderDate
                    });
                }
            });
        });
        // Convert to final response format
        const finalData = Object.values(productGrouping).map(productGroup => ({
            productId: productGroup.productId,
            productName: productGroup.productName,
            productCode: productGroup.productCode,
            totalOrders: productGroup.totalOrders,
            totalQuantity: productGroup.totalQuantity,
            salesPersons: Object.values(productGroup.salesPersons)
        }));
        console.log('=== PRODUCT GROUPING SUMMARY ===');
        finalData.forEach(product => {
            console.log(`Product: ${product.productName}`);
            console.log(`  Total Orders: ${product.totalOrders}, Total Quantity: ${product.totalQuantity}`);
            product.salesPersons.forEach(sp => {
                console.log(`    ${sp.fullName} (${sp.username}): ${sp.orderCount} orders, ${sp.totalQuantity} quantity`);
            });
        });
        console.log('=== END PRODUCT GROUPING ===');
        // Enhanced response structure
        res.status(200).json({
            success: true,
            data: finalData,
            metadata: {
                totalProducts: finalData.length,
                totalOrders: orders.length,
                ordersWithSalesPerson: orders.filter(o => o.salesPerson).length,
                ordersWithoutSalesPerson: orders.filter(o => !o.salesPerson).length
            },
            pagination: {
                total: totalOrders,
                page,
                pages: Math.ceil(totalOrders / limit),
                limit
            }
        });
    }
    catch (error) {
        console.error('Error in Unit Manager getOrders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
});
exports.getOrders = getOrders;
// Get dashboard statistics
const getDashboardStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const user = req.user;
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('📊 Dashboard API called for Unit Manager:', user.username);
        console.log('📊 Unit Manager details - Unit:', user.unit, 'CompanyId:', user.companyId);
        // Validate Unit Manager has proper company assignment
        if (!user.companyId) {
            return res.status(400).json({
                success: false,
                message: 'Unit Manager must be assigned to a company. Please contact administrator.',
                debug: { companyId: user.companyId }
            });
        }
        // Create base filter for Unit Manager's company (unit not required)
        const baseFilter = {
            companyId: user.companyId
        };
        // Add unit to filter only if it exists (backward compatibility)
        if (user.unit) {
            baseFilter.unit = user.unit;
        }
        console.log('📊 Using filter:', baseFilter);
        const period = req.query.period || 'current-month';
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        const startOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const endOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
        // Get comprehensive order statistics with proper status distribution - filtered by Unit Manager's unit and company
        const [orderStats, inventoryStats] = yield Promise.all([
            Order_js_1.default.aggregate([
                // Apply base filter to only get orders from Unit Manager's unit/company
                { $match: baseFilter },
                {
                    $facet: {
                        total: [{ $count: "count" }],
                        totalRevenue: [
                            { $group: { _id: null, total: { $sum: "$totalAmount" } } }
                        ],
                        thisMonth: [
                            { $match: { createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
                            {
                                $group: {
                                    _id: null,
                                    count: { $sum: 1 },
                                    revenue: { $sum: "$totalAmount" }
                                }
                            }
                        ],
                        lastMonth: [
                            { $match: { createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth } } },
                            {
                                $group: {
                                    _id: null,
                                    count: { $sum: 1 },
                                    revenue: { $sum: "$totalAmount" }
                                }
                            }
                        ],
                        statusDistribution: [
                            {
                                $group: {
                                    _id: "$status",
                                    count: { $sum: 1 },
                                    totalAmount: { $sum: "$totalAmount" }
                                }
                            }
                        ],
                        pendingOrders: [
                            { $match: { status: "pending" } },
                            { $count: "count" }
                        ],
                        approvedOrders: [
                            { $match: { status: "approved" } },
                            { $count: "count" }
                        ],
                        inProductionOrders: [
                            { $match: { status: "in_production" } },
                            { $count: "count" }
                        ],
                        completedOrders: [
                            { $match: { status: "completed" } },
                            { $count: "count" }
                        ],
                        monthlyTrends: [
                            {
                                $match: {
                                    createdAt: { $gte: new Date(today.getFullYear(), today.getMonth() - 5, 1) }
                                }
                            },
                            {
                                $group: {
                                    _id: {
                                        year: { $year: "$createdAt" },
                                        month: { $month: "$createdAt" }
                                    },
                                    orderCount: { $sum: 1 },
                                    totalRevenue: { $sum: "$totalAmount" }
                                }
                            },
                            {
                                $addFields: {
                                    avgOrderValue: { $divide: ["$totalRevenue", "$orderCount"] }
                                }
                            },
                            { $sort: { "_id.year": 1, "_id.month": 1 } }
                        ]
                    }
                }
            ]),
            Inventory_js_1.Item.aggregate([
                // Apply base filter to only get inventory from Unit Manager's unit/company
                { $match: baseFilter },
                {
                    $facet: {
                        total: [{ $count: "count" }],
                        lowStock: [
                            {
                                $match: {
                                    $or: [
                                        { currentStock: { $lte: 10 } },
                                        { stock: { $lte: 10 } },
                                        { qty: { $lte: 10 } }
                                    ]
                                }
                            },
                            {
                                $project: {
                                    name: 1,
                                    category: 1,
                                    currentStock: 1,
                                    stock: 1,
                                    qty: 1,
                                    minStockLevel: 1,
                                    minStock: 1
                                }
                            }
                        ],
                        lowStockCount: [
                            {
                                $match: {
                                    $or: [
                                        { currentStock: { $lte: 10 } },
                                        { stock: { $lte: 10 } },
                                        { qty: { $lte: 10 } }
                                    ]
                                }
                            },
                            { $count: "count" }
                        ],
                        byCategory: [
                            {
                                $group: {
                                    _id: "$category",
                                    count: { $sum: 1 },
                                    totalValue: {
                                        $sum: {
                                            $multiply: [
                                                {
                                                    $ifNull: [
                                                        "$currentStock",
                                                        { $ifNull: ["$stock", { $ifNull: ["$qty", 0] }] }
                                                    ]
                                                },
                                                {
                                                    $ifNull: [
                                                        "$price",
                                                        { $ifNull: ["$salePrice", { $ifNull: ["$purchaseCost", 0] }] }
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                }
                            },
                            { $sort: { totalValue: -1 } },
                            { $limit: 10 }
                        ]
                    }
                }
            ])
        ]);
        // Get sales person performance with more inclusive role matching - filtered by Unit Manager's unit/company
        const salesPersonStats = yield User_js_1.default.aggregate([
            {
                $match: Object.assign(Object.assign({}, baseFilter), { $or: [
                        { role: 'Sales' },
                        { role: 'sales' },
                        { role: 'SALES' },
                        { role: 'Sales Person' },
                        { role: 'SALESPERSON' },
                        { role: 'sales person' },
                        { role: { $regex: /sales/i } }
                    ] })
            },
            {
                $lookup: {
                    from: 'orders',
                    localField: '_id',
                    foreignField: 'salesPerson',
                    as: 'orders'
                }
            },
            {
                $addFields: {
                    totalOrders: { $size: '$orders' },
                    totalRevenue: { $sum: '$orders.totalAmount' }
                }
            },
            {
                $project: {
                    _id: 1,
                    name: { $ifNull: ['$fullName', '$username'] },
                    username: 1,
                    email: 1,
                    role: 1,
                    totalOrders: 1,
                    totalRevenue: 1
                }
            },
            { $sort: { totalRevenue: -1 } }
        ]);
        // Get customer analytics - filtered by Unit Manager's unit/company
        const customerStats = yield Order_js_1.default.aggregate([
            // Apply base filter first
            { $match: baseFilter },
            {
                $group: {
                    _id: "$customer",
                    orderCount: { $sum: 1 },
                    totalSpent: { $sum: "$totalAmount" },
                    lastOrder: { $max: "$createdAt" }
                }
            },
            {
                $lookup: {
                    from: 'customers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'customerInfo'
                }
            },
            { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: null,
                    totalCustomers: { $sum: 1 },
                    activeCustomers: {
                        $sum: {
                            $cond: [
                                { $gte: ['$lastOrder', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);
        // Extract and calculate metrics
        const totalOrders = ((_a = orderStats[0].total[0]) === null || _a === void 0 ? void 0 : _a.count) || 0;
        const totalRevenue = ((_b = orderStats[0].totalRevenue[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        const thisMonthData = orderStats[0].thisMonth[0] || { count: 0, revenue: 0 };
        const lastMonthData = orderStats[0].lastMonth[0] || { count: 0, revenue: 0 };
        const orderGrowth = lastMonthData.count > 0 ?
            ((thisMonthData.count - lastMonthData.count) / lastMonthData.count * 100) : 0;
        const revenueGrowth = lastMonthData.revenue > 0 ?
            ((thisMonthData.revenue - lastMonthData.revenue) / lastMonthData.revenue * 100) : 0;
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        // Format status distribution 
        const statusDistribution = {};
        if (orderStats[0].statusDistribution && orderStats[0].statusDistribution.length > 0) {
            orderStats[0].statusDistribution.forEach(status => {
                statusDistribution[status._id || 'unknown'] = status.count;
            });
        }
        // Format monthly trends
        const monthlyTrends = orderStats[0].monthlyTrends.map(trend => ({
            year: trend._id.year,
            month: trend._id.month,
            orderCount: trend.orderCount,
            totalRevenue: trend.totalRevenue,
            avgOrderValue: trend.avgOrderValue || 0
        }));
        // Customer analytics
        const customerAnalytics = customerStats[0] || { totalCustomers: 0, activeCustomers: 0 };
        console.log('✅ Dashboard data compiled successfully');
        console.log('📈 Status Distribution:', statusDistribution);
        console.log('👥 Sales Team Found:', salesPersonStats.length, 'sales persons');
        const responseData = {
            success: true,
            data: {
                overview: {
                    totalOrders,
                    totalRevenue,
                    averageOrderValue,
                    orderGrowth: parseFloat(orderGrowth.toFixed(1)),
                    revenueGrowth: parseFloat(revenueGrowth.toFixed(1))
                },
                orders: {
                    statusDistribution,
                    pendingOrders: ((_c = orderStats[0].pendingOrders[0]) === null || _c === void 0 ? void 0 : _c.count) || 0,
                    approvedOrders: ((_d = orderStats[0].approvedOrders[0]) === null || _d === void 0 ? void 0 : _d.count) || 0,
                    inProductionOrders: ((_e = orderStats[0].inProductionOrders[0]) === null || _e === void 0 ? void 0 : _e.count) || 0,
                    completedOrders: ((_f = orderStats[0].completedOrders[0]) === null || _f === void 0 ? void 0 : _f.count) || 0
                },
                inventory: {
                    totalItems: ((_g = inventoryStats[0].total[0]) === null || _g === void 0 ? void 0 : _g.count) || 0,
                    lowStockCount: ((_h = inventoryStats[0].lowStockCount[0]) === null || _h === void 0 ? void 0 : _h.count) || 0,
                    lowStockItems: inventoryStats[0].lowStock || [],
                    byCategory: inventoryStats[0].byCategory || []
                },
                salesPersons: salesPersonStats || [],
                customers: {
                    total: customerAnalytics.totalCustomers,
                    active: customerAnalytics.activeCustomers,
                    growth: 0
                },
                monthlyTrends
            }
        };
        res.status(200).json(responseData);
    }
    catch (error) {
        console.error('❌ Unit Manager getDashboardStats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard statistics',
            error: error.message
        });
    }
});
exports.getDashboardStats = getDashboardStats;
// Get sales persons for Unit Manager
const getSalesPersons = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('🔍 Unit Manager getSalesPersons - Company filtering enabled');
        console.log('User details:', {
            username: user.username,
            companyId: user.companyId,
            unit: user.unit
        });
        // Validate Unit Manager has proper company assignment
        if (!user.companyId) {
            return res.status(400).json({
                success: false,
                message: 'Unit Manager must be assigned to a company. Please contact administrator.',
                users: [] // Return empty array
            });
        }
        // Get users with Sales-related roles from the same company only
        const salesPersons = yield User_js_1.default.find({
            companyId: user.companyId, // Filter by same company
            $or: [
                { role: 'Sales' },
                { role: 'sales' },
                { role: 'Sales Person' },
                { role: 'Sales Manager' },
                { role: 'Sales Managers' },
                { username: { $regex: /sales/i } }
            ],
            isActive: { $ne: false } // Include users where isActive is true or undefined
        })
            .select('_id username email fullName role companyId')
            .sort({ username: 1 })
            .lean();
        console.log(`✅ Found ${salesPersons.length} sales persons from same company`);
        res.status(200).json({
            success: true,
            users: salesPersons
        });
    }
    catch (error) {
        console.error('Unit Manager getSalesPersons error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sales persons',
            error: error.message
        });
    }
});
exports.getSalesPersons = getSalesPersons;
// Get all orders for unit manager
const getAllOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const user = req.user;
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('🚀 getAllOrders with company filtering');
        console.log('User details:', {
            id: user.id,
            username: user.username,
            role: user.role,
            companyId: user.companyId
        });
        const { page = 1, limit = 10, status, customerId, salesPersonId, dateFrom, dateTo, search } = req.query;
        // Calculate skip for pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        // Build aggregation pipeline
        const pipeline = [];
        // Lookup customer data
        pipeline.push({
            $lookup: {
                from: 'customers',
                localField: 'customer',
                foreignField: '_id',
                as: 'customer'
            }
        });
        // Lookup salesperson data
        pipeline.push({
            $lookup: {
                from: 'users',
                localField: 'salesPerson',
                foreignField: '_id',
                as: 'salesPerson'
            }
        });
        // Unwind the arrays (since they should have only one element each)
        pipeline.push({ $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } });
        pipeline.push({ $unwind: { path: '$salesPerson', preserveNullAndEmptyArrays: true } });
        // Build match conditions
        const matchConditions = [];
        // COMPANY FILTERING: Only show orders from sales persons in the same company
        if (user.companyId) {
            const companySalesPersons = yield User_js_1.default.find({
                companyId: user.companyId,
                role: { $in: ['Sales', 'Unit Manager', 'Unit Head'] }
            }).select('_id').lean();
            const salesPersonIds = companySalesPersons.map(sp => sp._id);
            console.log('Company sales person IDs for filtering:', salesPersonIds.length);
            // Filter orders by sales persons from the same company
            matchConditions.push({ 'salesPerson._id': { $in: salesPersonIds } });
            console.log('Applied company-based filtering for companyId:', user.companyId);
        }
        else {
            console.log('⚠️ WARNING: User has no company assignment - showing all orders');
        }
        // Filter by status
        if (status && status !== 'all') {
            matchConditions.push({ status: status });
        }
        // Filter by customer
        if (customerId && customerId !== 'all') {
            try {
                const customerObjectId = new mongoose_1.default.Types.ObjectId(customerId);
                matchConditions.push({ 'customer._id': customerObjectId });
            }
            catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid customer ID format'
                });
            }
        }
        // Filter by salesperson
        if (salesPersonId && salesPersonId !== 'all') {
            try {
                const salespersonObjectId = new mongoose_1.default.Types.ObjectId(salesPersonId);
                matchConditions.push({ 'salesPerson._id': salespersonObjectId });
            }
            catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid salesperson ID format'
                });
            }
        }
        // Filter by date range
        if (dateFrom || dateTo) {
            const dateFilter = {};
            if (dateFrom) {
                dateFilter.$gte = new Date(dateFrom);
            }
            if (dateTo) {
                dateFilter.$lte = new Date(dateTo + 'T23:59:59.999Z');
            }
            matchConditions.push({ createdAt: dateFilter });
        }
        // Filter by search
        if (search && search.trim()) {
            const searchRegex = { $regex: search.trim(), $options: 'i' };
            matchConditions.push({
                $or: [
                    { orderCode: searchRegex },
                    { 'customer.name': searchRegex },
                    { 'customer.email': searchRegex },
                    { 'salesPerson.fullName': searchRegex },
                    { 'salesPerson.username': searchRegex }
                ]
            });
        }
        // Add match stage if there are conditions
        if (matchConditions.length > 0) {
            pipeline.push({ $match: { $and: matchConditions } });
        }
        // Get total count for pagination
        const countPipeline = [...pipeline, { $count: "total" }];
        const countResult = yield Order_js_1.default.aggregate(countPipeline);
        const totalCount = countResult.length > 0 ? countResult[0].total : 0;
        // Add sorting, skip and limit for main query
        pipeline.push({ $sort: { createdAt: -1 } });
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: parseInt(limit) });
        // Execute main query
        const orders = yield Order_js_1.default.aggregate(pipeline);
        // Calculate pagination
        const totalPages = Math.ceil(totalCount / parseInt(limit));
        // Calculate summary statistics using the same base conditions
        const summaryPipeline = [];
        // Add lookups for summary as well
        summaryPipeline.push({
            $lookup: {
                from: 'customers',
                localField: 'customer',
                foreignField: '_id',
                as: 'customer'
            }
        });
        summaryPipeline.push({
            $lookup: {
                from: 'users',
                localField: 'salesPerson',
                foreignField: '_id',
                as: 'salesPerson'
            }
        });
        summaryPipeline.push({ $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } });
        summaryPipeline.push({ $unwind: { path: '$salesPerson', preserveNullAndEmptyArrays: true } });
        // Apply same filters for summary
        if (matchConditions.length > 0) {
            summaryPipeline.push({ $match: { $and: matchConditions } });
        }
        // Group by status for summary
        summaryPipeline.push({
            $group: {
                _id: '$status',
                count: { $sum: 1 }
            }
        });
        const statusCounts = yield Order_js_1.default.aggregate(summaryPipeline);
        const summary = {
            total: totalCount,
            pending: ((_a = statusCounts.find(s => s._id === 'pending')) === null || _a === void 0 ? void 0 : _a.count) || 0,
            approved: ((_b = statusCounts.find(s => s._id === 'approved')) === null || _b === void 0 ? void 0 : _b.count) || 0,
            rejected: ((_c = statusCounts.find(s => s._id === 'rejected')) === null || _c === void 0 ? void 0 : _c.count) || 0,
            disapproved: ((_d = statusCounts.find(s => s._id === 'disapproved')) === null || _d === void 0 ? void 0 : _d.count) || 0,
            in_production: ((_e = statusCounts.find(s => s._id === 'in_production')) === null || _e === void 0 ? void 0 : _e.count) || 0,
            completed: ((_f = statusCounts.find(s => s._id === 'completed')) === null || _f === void 0 ? void 0 : _f.count) || 0,
            cancelled: ((_g = statusCounts.find(s => s._id === 'cancelled')) === null || _g === void 0 ? void 0 : _g.count) || 0
        };
        res.status(200).json({
            success: true,
            data: {
                orders,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: parseInt(limit),
                    hasNext: parseInt(page) < totalPages,
                    hasPrev: parseInt(page) > 1
                },
                summary
            }
        });
    }
    catch (error) {
        console.error('Error fetching orders for unit manager:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
});
exports.getAllOrders = getAllOrders;
// Get single order details
const getOrderById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const { id: orderId } = req.params;
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        // Create base filter to ensure company isolation
        const baseFilter = {
            companyId: user.companyId
        };
        // Add unit to filter only if it exists (backward compatibility)
        if (user.unit) {
            baseFilter.unit = user.unit;
        }
        const order = yield Order_js_1.default.findOne(Object.assign({ _id: orderId }, baseFilter))
            .populate('customer', 'name email phone address city state pincode')
            .populate('salesPerson', 'fullName email phone')
            .populate('products.product', 'name code category subCategory brand specifications')
            .lean();
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or not accessible'
            });
        }
        res.status(200).json({
            success: true,
            data: order
        });
    }
    catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order details',
            error: error.message
        });
    }
});
exports.getOrderById = getOrderById;
// Approve product daily summaries (individual or bulk)
const approveProductSummaries = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const { summaryIds, summaryId, date, productSummaries } = req.body;
        // Only allow Unit Manager role
        if (user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        // Handle new bulk approval format with production data
        if (productSummaries && Array.isArray(productSummaries)) {
            console.log('🔄 Processing new bulk approval with production data for', productSummaries.length, 'products');
            const approvalResults = [];
            // FIX: Properly handle date to avoid timezone issues
            // Create today's date at midnight UTC using current UTC date components
            let approvalDate;
            if (date) {
                // If date is provided, parse it and set to UTC midnight
                approvalDate = new Date(date);
                approvalDate.setUTCHours(0, 0, 0, 0);
            }
            else {
                // If no date provided, use CURRENT UTC date at midnight
                const now = new Date();
                // Use UTC components to ensure correct date regardless of server timezone
                approvalDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
            }
            console.log(`📅 Approval date set to: ${approvalDate.toISOString()} (UTC: ${approvalDate.toUTCString()})`);
            // Step 1: Update all ProductDetailsDailySummary entries and collect data
            const productDataForBatching = [];
            for (const productSummary of productSummaries) {
                try {
                    const { productId, productName, batchAdjusted, qtyPerBatch, physicalStock, packing, toBeProducedDay, produceBatches, orderIds, dailyDetailsId } = productSummary;
                    console.log(`📋 Processing ${productName} with batchAdjusted: ${batchAdjusted}`);
                    // Validate batchAdjusted - must be greater than 0 for approval
                    if (!batchAdjusted || batchAdjusted <= 0) {
                        console.log(`⚠️ ${productName} cannot be approved - batchAdjusted must be greater than 0 (current: ${batchAdjusted})`);
                        approvalResults.push({
                            productId,
                            productName,
                            status: 'validation_error',
                            error: 'Batch Adjusted must be greater than 0 to approve the product'
                        });
                        continue;
                    }
                    // Find and update the ProductDetailsDailySummary
                    const updatedSummary = yield ProductDetailsDailySummary_js_1.default.findOneAndUpdate({
                        productId: productId,
                        companyId: user.companyId,
                        date: approvalDate
                    }, Object.assign({ status: 'approved', batchAdjusted: batchAdjusted, qtyPerBatch: qtyPerBatch, physicalStock: physicalStock, packing: packing, toBeProducedDay: toBeProducedDay, produceBatches: produceBatches }, (orderIds && Array.isArray(orderIds) && orderIds.length > 0 && {
                        orderIds: orderIds.map(id => new mongoose_1.default.Types.ObjectId(id))
                    })), { new: true });
                    if (updatedSummary) {
                        // Collect data for batch creation - will be grouped later
                        productDataForBatching.push({
                            productId: productId,
                            productName: productName,
                            batchAdjusted: batchAdjusted,
                            qtyPerBatch: qtyPerBatch || 1,
                            approvedBy: user.username,
                            dailyDetailsId: updatedSummary._id
                        });
                        approvalResults.push({
                            productId,
                            productName,
                            status: 'approved',
                            batchAdjusted: batchAdjusted
                        });
                        console.log(`✅ Approved ${productName} with batchAdjusted: ${batchAdjusted}`);
                    }
                    else {
                        console.log(`⚠️ Product summary not found for ${productName}`);
                        approvalResults.push({
                            productId,
                            productName,
                            status: 'not_found'
                        });
                    }
                }
                catch (error) {
                    console.error(`❌ Error processing ${productSummary.productName}:`, error);
                    approvalResults.push({
                        productId: productSummary.productId,
                        productName: productSummary.productName,
                        status: 'error',
                        error: error.message
                    });
                }
            }
            // Step 2: Create ProductionBatch entries with intelligent grouping
            console.log('🏭 Creating ProductionBatch entries with intelligent grouping...');
            const batchCreationResults = yield createGroupedProductionBatchEntries({
                productDataList: productDataForBatching,
                companyId: user.companyId,
                date: approvalDate
            });
            // Update approval results with batch creation info
            batchCreationResults.forEach(batchResult => {
                const approvalResult = approvalResults.find(r => r.productId === batchResult.productId);
                if (approvalResult && approvalResult.status === 'approved') {
                    approvalResult.status = 'success';
                    approvalResult.batchesCreated = batchResult.batchesCreated;
                }
            });
            const successCount = approvalResults.filter(r => r.status === 'success' || r.status === 'approved').length;
            const validationErrors = approvalResults.filter(r => r.status === 'validation_error').length;
            const totalBatches = approvalResults
                .filter(r => r.status === 'success')
                .reduce((sum, r) => sum + (r.batchesCreated || 0), 0);
            // If there are validation errors, return appropriate response
            if (validationErrors > 0 && successCount === 0) {
                return res.status(400).json({
                    success: false,
                    message: `All products failed validation - Batch Adjusted must be greater than 0`,
                    results: approvalResults,
                    summary: {
                        totalProcessed: productSummaries.length,
                        successful: successCount,
                        validationErrors: validationErrors,
                        totalBatchesCreated: totalBatches
                    }
                });
            }
            return res.json({
                success: true,
                message: `Successfully approved ${successCount} products and created ${totalBatches} ProductionBatch entries${validationErrors > 0 ? `. ${validationErrors} products failed validation.` : ''}`,
                results: approvalResults,
                summary: {
                    totalProcessed: productSummaries.length,
                    successful: successCount,
                    validationErrors: validationErrors,
                    totalBatchesCreated: totalBatches
                }
            });
        }
        // Legacy support for old bulk approval format with summaryIds
        let idsToApprove = [];
        if (summaryId) {
            idsToApprove = [summaryId]; // Single approve
        }
        else if (summaryIds && Array.isArray(summaryIds)) {
            idsToApprove = summaryIds; // Bulk approve
        }
        else {
            return res.status(400).json({
                success: false,
                message: 'Either productSummaries array, summaryId, or summaryIds array is required'
            });
        }
        console.log('🔍 Approve summaries - IDs:', idsToApprove, 'companyId:', user.companyId);
        // Update multiple product daily summaries
        const updateResult = yield ProductDailySummary_js_1.default.updateMany({
            _id: { $in: idsToApprove },
            companyId: user.companyId // Ensure company isolation
        }, {
            status: 'approved'
        });
        // Get updated summaries to return details
        const updatedSummaries = yield ProductDailySummary_js_1.default.find({
            _id: { $in: idsToApprove },
            companyId: user.companyId,
            status: 'approved'
        }).populate('productId', 'name code');
        console.log('✅ Approval successful:', updateResult.modifiedCount, 'summaries updated');
        // 🎯 NEW FEATURE: Create ProductionBatch entries for bulk approved products
        console.log('🏭 Creating ProductionBatch entries for bulk approved products...');
        // FIX: Properly handle date to avoid timezone issues - use CURRENT UTC date
        const now = new Date();
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        console.log(`📅 Creating batches for date: ${today.toISOString()} (UTC: ${today.toUTCString()})`);
        for (const summary of updatedSummaries) {
            try {
                // Get batchAdjusted from ProductDetailsDailySummary
                const dailyDetails = yield ProductDetailsDailySummary_js_1.default.findOne({
                    productId: summary.productId._id,
                    companyId: user.companyId,
                    date: today,
                    status: 'approved'
                });
                const batchAdjusted = (dailyDetails === null || dailyDetails === void 0 ? void 0 : dailyDetails.batchAdjusted) || 1;
                const batchesToCreate = Math.max(1, Math.ceil(batchAdjusted)); // At least 1 batch
                yield createBulkProductionBatchEntries({
                    productId: summary.productId._id,
                    companyId: user.companyId,
                    date: today,
                    qtyPerBatch: summary.qtyPerBatch || 1,
                    produceBatches: batchesToCreate,
                    batchAdjusted: batchAdjusted,
                    approvedBy: user.username,
                    productName: summary.productId.name,
                    dailyDetailsId: dailyDetails === null || dailyDetails === void 0 ? void 0 : dailyDetails._id
                });
                console.log(`📦 Created ${batchesToCreate} batch entry for: ${summary.productId.name}`);
            }
            catch (error) {
                console.error(`❌ Failed to create batch entries for ${summary.productId.name}:`, error.message);
                // Continue with other products even if one fails
            }
        }
        const isPlural = idsToApprove.length > 1;
        res.json({
            success: true,
            message: `Successfully approved ${updateResult.modifiedCount} product ${isPlural ? 'summaries' : 'summary'}`,
            modifiedCount: updateResult.modifiedCount,
            summaries: updatedSummaries
        });
    }
    catch (error) {
        console.error('Error approving product summaries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve product summaries',
            error: error.message
        });
    }
});
exports.approveProductSummaries = approveProductSummaries;
/**
 * Helper function to create ProductionBatch entries with intelligent grouping
 * Groups items by groupId + itemId (SAME product only) and applies smart batching logic:
 * - Values >= 1: Create separate entries
 * - Fractional values < 1: Combine if sum < 1, otherwise keep separate
 * - Different products: NEVER combine (always separate batches)
 */
const createGroupedProductionBatchEntries = (_a) => __awaiter(void 0, [_a], void 0, function* ({ productDataList, companyId, date }) {
    try {
        console.log('🔍 Starting group-based batch creation for', productDataList.length, 'products');
        // FIX: Use the date directly - it's already a proper UTC Date object
        const today = date instanceof Date ? date : new Date(date);
        console.log(`📅 Production date set to: ${today.toISOString()} (${today.toDateString()})`);
        // Step 1: Get groupId for each product
        const productsWithGroups = yield Promise.all(productDataList.map((product) => __awaiter(void 0, void 0, void 0, function* () {
            const productionGroup = yield ProductionGroup_js_1.default.findOne({
                company: companyId,
                items: product.productId,
                isActive: true
            });
            return Object.assign(Object.assign({}, product), { groupId: productionGroup ? productionGroup._id : null, groupName: productionGroup ? productionGroup.groupName : null });
        })));
        // Step 2: Separate products into groups and ungrouped
        const groupedProducts = new Map(); // Map<groupId, products[]>
        const ungroupedProducts = [];
        productsWithGroups.forEach(product => {
            if (product.groupId) {
                const groupKey = product.groupId.toString();
                if (!groupedProducts.has(groupKey)) {
                    groupedProducts.set(groupKey, {
                        groupId: product.groupId,
                        groupName: product.groupName,
                        products: []
                    });
                }
                groupedProducts.get(groupKey).products.push(product);
            }
            else {
                ungroupedProducts.push(product);
            }
        });
        console.log(`📊 Found ${groupedProducts.size} production groups and ${ungroupedProducts.length} ungrouped products`);
        const results = [];
        // Step 3: Process each production group with "all items per batch" logic
        for (const [groupKey, groupData] of groupedProducts.entries()) {
            console.log(`\n🔸 Processing group: ${groupData.groupName} (${groupData.products.length} products)`);
            // 🔁 SIMPLE RULE: On every bulk approve, remove ALL existing batches
            // for this group/date (pending, in_progress, completed) and recreate
            // them fresh from the current approved data.
            const deleteExistingGroupBatches = yield ProductionBatch_js_1.default.deleteMany({
                groupId: groupData.groupId,
                companyId,
                productionDate: today
            });
            console.log(`   🗑️ Deleted ${deleteExistingGroupBatches.deletedCount} existing batches for group before recreation`);
            // Get ALL approved products in the group from database
            const productionGroup = yield ProductionGroup_js_1.default.findById(groupData.groupId);
            const allGroupProducts = yield ProductDetailsDailySummary_js_1.default.find({
                date: today,
                productId: { $in: productionGroup.items },
                companyId: companyId,
                status: 'approved'
            });
            // Calculate FINAL total from ALL approved products
            const totalBatchAdjusted = allGroupProducts.reduce((sum, p) => sum + (p.batchAdjusted || 0), 0);
            console.log(`   📊 ALL approved products total: ${totalBatchAdjusted}`);
            console.log(`   📦 ALL approved products in group: ${allGroupProducts.length}`);
            // Calculate required batches: Math.ceil(total)
            const requiredBatches = Math.ceil(totalBatchAdjusted);
            console.log(`   Required batches: ${requiredBatches}`);
            // Prepare combinedItems array (ALL approved products - existing + new)
            const combinedItems = allGroupProducts.map(detail => ({
                itemId: detail.productId,
                DailyProductionId: detail._id,
                batchAdjustedValue: detail.batchAdjusted || 0,
                qtyContribution: detail.qtyPerBatch || 0
            }));
            // Get next batch number
            const allExistingBatches = yield ProductionBatch_js_1.default.find({
                companyId,
                productionDate: today
            }).sort({ batchNumber: -1 }).limit(1);
            let nextBatchNumber = 1;
            if (allExistingBatches.length > 0) {
                nextBatchNumber = allExistingBatches[0].batchNumber + 1;
            }
            console.log(`   Starting batch number: ${nextBatchNumber}`);
            // Get first product's details for batch metadata
            const firstProduct = allGroupProducts[0] || groupData.products[0];
            // ✅ FIX: Get qtyPerBatch from Item.batch field if not set in summary
            let masterQtyPerBatch = firstProduct.qtyPerBatch || 0;
            if (masterQtyPerBatch === 0) {
                console.log(`   ⚠️ qtyPerBatch is 0! Fetching from Item.batch for product ${firstProduct.productId}...`);
                const item = yield Inventory_js_1.Item.findById(firstProduct.productId).select('batch name').lean();
                console.log(`   📦 Item: ${item === null || item === void 0 ? void 0 : item.name}, batch field = "${item === null || item === void 0 ? void 0 : item.batch}" (type: ${typeof (item === null || item === void 0 ? void 0 : item.batch)})`);
                if (item === null || item === void 0 ? void 0 : item.batch) {
                    masterQtyPerBatch = parseFloat(item.batch) || 0;
                    console.log(`   ✅ Parsed qtyPerBatch from Item.batch = ${masterQtyPerBatch}`);
                    // Update the ProductDetailsDailySummary so it's correct for future use
                    if (masterQtyPerBatch > 0) {
                        yield ProductDetailsDailySummary_js_1.default.updateOne({ _id: firstProduct._id }, { $set: { qtyPerBatch: masterQtyPerBatch } });
                        console.log(`   ✅ Updated ProductDetailsDailySummary with qtyPerBatch = ${masterQtyPerBatch}`);
                    }
                }
                else {
                    console.log(`   ❌ ERROR: Item has no batch field! qtyPerBatch will be 0!`);
                }
            }
            console.log(`   🎯 FINAL masterQtyPerBatch for group = ${masterQtyPerBatch}`);
            // Create the required number of batches (recreate from scratch)
            for (let i = 0; i < requiredBatches; i++) {
                const currentBatchNumber = nextBatchNumber + i;
                const batchNo = `BATNO${String(currentBatchNumber).padStart(2, '0')}`;
                // Calculate dynamic totalBatchAdjusted for this batch
                const isLastBatch = (i === requiredBatches - 1);
                const remainder = parseFloat((totalBatchAdjusted - Math.floor(totalBatchAdjusted)).toFixed(2));
                const batchAdjusted = isLastBatch && remainder > 0 ? remainder : 1.0;
                // Use master qtyPerBatch fetched from Item.batch
                const qtyPerBatch = masterQtyPerBatch;
                const qtyAchieved = parseFloat((qtyPerBatch * batchAdjusted).toFixed(2));
                console.log(`   📊 Batch ${batchNo}: qtyPerBatch=${qtyPerBatch}, batchAdjusted=${batchAdjusted}, qtyAchieved=${qtyAchieved}`);
                const newBatch = new ProductionBatch_js_1.default({
                    itemId: firstProduct.productId || firstProduct._id, // Reference first product as primary
                    groupId: groupData.groupId,
                    companyId: companyId,
                    productionDate: today,
                    batchNumber: currentBatchNumber,
                    batchNo: batchNo,
                    qtyPerBatch: qtyPerBatch,
                    qtyAchieved: qtyAchieved,
                    totalBatchAdjusted: batchAdjusted,
                    status: 'pending',
                    combinedItems: combinedItems, // ALL approved products (existing + new)
                    approvedBy: groupData.products[0].approvedBy,
                    createdAt: new Date()
                });
                yield newBatch.save();
                console.log(`   ✅ Created batch ${batchNo} (${i + 1}/${requiredBatches})`);
            }
            results.push({
                productId: firstProduct.productId,
                productName: groupData.groupName,
                batchesCreated: requiredBatches
            });
        }
        // Step 4: Process ungrouped products (ALWAYS SEPARATE ENTRIES - NEVER combine)
        if (ungroupedProducts.length > 0) {
            console.log(`\n🔹 Processing ${ungroupedProducts.length} ungrouped products...`);
            for (const product of ungroupedProducts) {
                try {
                    console.log(`   📦 UNGROUPED PRODUCT: ${product.productName}`);
                    console.log(`   📊 batchAdjusted: ${product.batchAdjusted}`);
                    console.log(`   📊 status: ${product.status}`);
                    // 🔁 SIMPLE RULE: On every bulk approve, remove ALL existing batches
                    // for this ungrouped product/date and recreate them fresh.
                    const deleteResult = yield ProductionBatch_js_1.default.deleteMany({
                        "combinedItems.itemId": product.productId,
                        companyId: companyId,
                        productionDate: today,
                        groupId: null // Only ungrouped products
                    });
                    console.log(`   🗑️ Deleted ${deleteResult.deletedCount} existing batches for ${product.productName} before recreation`);
                    // For ungrouped products: ALWAYS create SEPARATE entries
                    // Never combine with existing batches
                    const fullBatches = Math.floor(product.batchAdjusted);
                    const remainder = parseFloat((product.batchAdjusted - fullBatches).toFixed(2));
                    console.log(`   📈 Splitting: ${fullBatches} full batch(es) + ${remainder} remainder`);
                    // Get next batch number
                    const existingBatches = yield ProductionBatch_js_1.default.find({
                        companyId: companyId,
                        productionDate: today
                    }).select('batchNumber').sort({ batchNumber: -1 }).limit(1);
                    let nextBatchNumber = 1;
                    if (existingBatches.length > 0) {
                        nextBatchNumber = existingBatches[0].batchNumber + 1;
                    }
                    let batchCounter = 0;
                    // Create full batches (each with totalBatchAdjusted = 1.0)
                    for (let i = 0; i < fullBatches; i++) {
                        const currentBatchNumber = nextBatchNumber + batchCounter;
                        const batchNo = `BATNO${String(currentBatchNumber).padStart(2, '0')}`;
                        const batchEntry = {
                            companyId: companyId,
                            groupId: null, // Ungrouped - no group
                            batchNumber: currentBatchNumber,
                            batchNo: batchNo,
                            productionDate: today,
                            qtyPerBatch: product.qtyPerBatch || 0,
                            qtyAchieved: product.qtyPerBatch || 0, // Full batch = 1.0 * qtyPerBatch
                            totalBatchAdjusted: 1.0, // Full batch
                            status: 'pending',
                            mouldingTime: null,
                            unloadingTime: null,
                            productionLoss: 0,
                            createdBy: product.approvedBy || 'system',
                            combinedItems: [{
                                    itemId: product.productId,
                                    DailyProductionId: product.dailyDetailsId || null,
                                    batchAdjustedValue: 1.0,
                                    qtyContribution: product.qtyPerBatch || 0
                                }],
                            notes: ``
                        };
                        yield ProductionBatch_js_1.default.create(batchEntry);
                        console.log(`   ✅ Created full batch ${batchNo}`);
                        batchCounter++;
                    }
                    // Create remainder batch if exists
                    if (remainder > 0) {
                        const currentBatchNumber = nextBatchNumber + batchCounter;
                        const batchNo = `BATNO${String(currentBatchNumber).padStart(2, '0')}`;
                        const batchEntry = {
                            companyId: companyId,
                            groupId: null,
                            batchNumber: currentBatchNumber,
                            batchNo: batchNo,
                            productionDate: today,
                            qtyPerBatch: product.qtyPerBatch || 0,
                            qtyAchieved: (product.qtyPerBatch || 0) * remainder, // Partial batch
                            totalBatchAdjusted: remainder, // Partial batch
                            status: 'pending',
                            mouldingTime: null,
                            unloadingTime: null,
                            productionLoss: 0,
                            createdBy: product.approvedBy || 'system',
                            combinedItems: [{
                                    itemId: product.productId,
                                    DailyProductionId: product.dailyDetailsId || null,
                                    batchAdjustedValue: remainder,
                                    qtyContribution: (product.qtyPerBatch || 0) * remainder
                                }],
                            notes: ``
                        };
                        yield ProductionBatch_js_1.default.create(batchEntry);
                        console.log(`   ✅ Created remainder batch ${batchNo} with totalBatchAdjusted = ${remainder.toFixed(2)}`);
                        batchCounter++;
                    }
                    results.push({
                        productId: product.productId,
                        productName: product.productName,
                        batchesCreated: batchCounter
                    });
                    console.log(`   ✅ COMPLETE: Created ${batchCounter} separate batch entry(ies) for ${product.productName}`);
                }
                catch (error) {
                    console.error(`   ❌ Error creating batches for ${product.productName}:`, error.message);
                    // Continue with next product
                }
            }
        }
        console.log(`✅ Completed batch creation - created batches for ${results.length} products/groups`);
        return results;
    }
    catch (error) {
        console.error('❌ Error in createGroupedProductionBatchEntries:', error);
        return [];
    }
});
/**
 * Intelligent batch grouping logic for items in SAME group with MAX 1.0 WEIGHT RULE
 * Input: Array of items (can be different products in same group)
 * Returns array of batch groups to create
 *
 * RULES:
 * 1. Each batch totalBatchWeight must be ≤ 1.0 (never exceed 1.0)
 * 2. Values >= 1.0: Create full batches (1.0 each) + remaining as separate batch
 * 3. Fractional values < 1.0: Smart combine with bin packing algorithm
 */
const intelligentBatchGrouping = (items) => {
    const batchGroups = [];
    const itemsToProcess = [];
    console.log(`   🧮 Starting smart batch grouping for ${items.length} items`);
    // Step 1: Process items and break down values >= 1.0
    items.forEach(item => {
        const value = item.batchAdjusted;
        if (value >= 1.0) {
            const fullBatches = Math.floor(value);
            const remainder = value - fullBatches;
            console.log(`   📦 Item value ${value}: ${fullBatches} full batch(es) + ${remainder.toFixed(2)} remainder`);
            // Create full batches (each 1.0)
            for (let i = 0; i < fullBatches; i++) {
                batchGroups.push({
                    totalQty: 1.0,
                    approvedBy: item.approvedBy,
                    combinedItems: [{
                            itemId: item.productId,
                            DailyProductionId: item.dailyDetailsId,
                            batchAdjustedValue: 1.0,
                            qtyContribution: 1.0
                        }]
                });
            }
            // Add remainder to items to process
            if (remainder > 0) {
                itemsToProcess.push(Object.assign(Object.assign({}, item), { batchAdjusted: remainder }));
            }
        }
        else if (value > 0) {
            itemsToProcess.push(item);
        }
    });
    console.log(`   🔢 After processing: ${batchGroups.length} full batches, ${itemsToProcess.length} fractional items to combine`);
    // Step 2: Smart combine fractional values using bin packing (descending order)
    if (itemsToProcess.length > 0) {
        // Sort descending for optimal bin packing
        itemsToProcess.sort((a, b) => b.batchAdjusted - a.batchAdjusted);
        console.log(`   📊 Fractional values (sorted desc): [${itemsToProcess.map(i => i.batchAdjusted.toFixed(2)).join(', ')}]`);
        const partialBatches = []; // Array of current partial batches
        itemsToProcess.forEach(item => {
            let placed = false;
            // Try to fit in existing partial batch (must be ≤ 1.0)
            for (let batch of partialBatches) {
                if (batch.totalQty + item.batchAdjusted <= 1.0) {
                    // Fits! Add to this batch
                    batch.totalQty += item.batchAdjusted;
                    batch.combinedItems.push({
                        itemId: item.productId,
                        DailyProductionId: item.dailyDetailsId,
                        batchAdjustedValue: item.batchAdjusted,
                        qtyContribution: item.batchAdjusted
                    });
                    placed = true;
                    console.log(`   ✅ Added ${item.batchAdjusted.toFixed(2)} to existing batch (new total: ${batch.totalQty.toFixed(2)})`);
                    break;
                }
            }
            // Doesn't fit anywhere, create new partial batch
            if (!placed) {
                partialBatches.push({
                    totalQty: item.batchAdjusted,
                    approvedBy: item.approvedBy,
                    combinedItems: [{
                            itemId: item.productId,
                            DailyProductionId: item.dailyDetailsId,
                            batchAdjustedValue: item.batchAdjusted,
                            qtyContribution: item.batchAdjusted
                        }]
                });
                console.log(`   🆕 Created new partial batch with ${item.batchAdjusted.toFixed(2)}`);
            }
        });
        // Add all partial batches to final result
        batchGroups.push(...partialBatches);
        console.log(`   🎯 Final result: ${batchGroups.length} total batches`);
        partialBatches.forEach((batch, idx) => {
            const values = batch.combinedItems.map(i => i.batchAdjustedValue.toFixed(2)).join(' + ');
            console.log(`      Batch ${idx + 1}: ${values} = ${batch.totalQty.toFixed(2)} ${batch.totalQty > 1.0 ? '❌ EXCEEDS 1.0!' : '✅'}`);
        });
    }
    return batchGroups;
};
/**
 * Create a single ProductionBatch entry with MAX 1.0 WEIGHT VALIDATION
 */
const createSingleProductionBatch = (_a) => __awaiter(void 0, [_a], void 0, function* ({ productId, productName, masterQtyPerBatch, batchAdjustedTotal, companyId, date, groupId, combinedItems, approvedBy }) {
    try {
        // 🔒 CRITICAL: Enforce max 1.0 weight rule
        if (batchAdjustedTotal > 1.0) {
            console.error(`   ❌ VALIDATION ERROR: batchAdjustedTotal ${batchAdjustedTotal.toFixed(2)} exceeds 1.0 limit!`);
            console.error(`      This should never happen with intelligentBatchGrouping logic.`);
            throw new Error(`Batch weight ${batchAdjustedTotal.toFixed(2)} exceeds maximum 1.0`);
        }
        // Get the next batch number
        const existingBatches = yield ProductionBatch_js_1.default.find({
            companyId,
            productionDate: date
        }).select('batchNumber').sort({ batchNumber: -1 }).limit(1);
        let nextBatchNumber = 1;
        if (existingBatches.length > 0) {
            nextBatchNumber = existingBatches[0].batchNumber + 1;
        }
        const paddedBatchNumber = String(nextBatchNumber).padStart(2, '0');
        const batchNo = `BATNO${paddedBatchNumber}`;
        // Calculate actual quantity: masterQtyPerBatch × totalBatchAdjusted
        const actualQty = masterQtyPerBatch * batchAdjustedTotal;
        // Determine if batch is combined by checking combinedItems array length
        const isCombinedBatch = combinedItems.length > 1;
        const batchEntry = {
            companyId,
            groupId: groupId,
            batchNumber: nextBatchNumber,
            batchNo,
            productionDate: date,
            qtyPerBatch: masterQtyPerBatch, // Base batch quantity (e.g., 234)
            qtyAchieved: actualQty, // Adjusted quantity = masterQtyPerBatch * batchAdjustedTotal (e.g., 234 * 0.7 = 163.8)
            productionLoss: 0,
            status: 'pending',
            mouldingTime: null,
            unloadingTime: null,
            createdBy: approvedBy,
            totalBatchAdjusted: batchAdjustedTotal, // Max 1.0 enforced above
            combinedItems: combinedItems,
            notes: ''
        };
        const createdBatch = yield ProductionBatch_js_1.default.create(batchEntry);
        console.log(`   ✅ Created batch ${batchNo} | Weight: ${batchAdjustedTotal.toFixed(2)} | Qty: ${actualQty.toFixed(2)} ${isCombinedBatch ? '(COMBINED ✨)' : ''}`);
        return [createdBatch];
    }
    catch (error) {
        console.error(`   ❌ Error creating batch for ${productName}:`, error);
        return [];
    }
});
/**
 * Helper function to create ProductionBatch entries for bulk approved products
 * Similar to createProductionBatchEntries in salesSummaryController but simpler for bulk operations
 */
const createBulkProductionBatchEntries = (_a) => __awaiter(void 0, [_a], void 0, function* ({ productId, companyId, date, qtyPerBatch, produceBatches, batchAdjusted = 1, approvedBy, productName, dailyDetailsId }) {
    try {
        console.log('🏭 Creating ProductionBatch entries for bulk approval:', {
            productName,
            productId,
            companyId,
            produceBatches,
            qtyPerBatch,
            approvedBy
        });
        // Validate inputs - CRITICAL: Prevent creation of 0-batch entries
        if (!produceBatches || produceBatches <= 0 || produceBatches === 0) {
            console.log(`⚠️ Invalid produceBatches value: ${produceBatches} - skipping ProductionBatch creation for ${productName}`);
            return [];
        }
        // Additional safety check for edge cases
        if (isNaN(produceBatches) || !isFinite(produceBatches)) {
            console.log(`⚠️ Invalid produceBatches value (NaN or infinite): ${produceBatches} - skipping ProductionBatch creation for ${productName}`);
            return [];
        }
        // 🔒 ATOMIC DUPLICATE PREVENTION: Remove and recreate in single operation
        // FIX: Use the date directly - it's already a proper UTC Date object
        const today = date instanceof Date ? date : new Date(date);
        console.log(`📅 Production date set to: ${today.toISOString()} (${today.toDateString()})`);
        // First, remove ALL existing ProductionBatch entries for this product and date (except completed)
        const deleteResult = yield ProductionBatch_js_1.default.deleteMany({
            "combinedItems.itemId": productId,
            companyId,
            productionDate: today,
            status: { $ne: 'completed' } // Remove all except completed batches
        });
        console.log(`🗑️ Removed ${deleteResult.deletedCount} existing non-completed ProductionBatch entries for ${productName} on ${today.toDateString()}`);
        // Re-validate inputs after cleanup - if no valid batches to produce, return early
        if (!produceBatches || produceBatches <= 0 || isNaN(produceBatches) || !isFinite(produceBatches)) {
            console.log(`⚠️ No valid batches to produce after cleanup - ProductionBatch creation skipped for ${productName} (produceBatches: ${produceBatches})`);
            return [];
        }
        // Get the next batch number for this company and date (after cleanup)
        const existingBatches = yield ProductionBatch_js_1.default.find({
            companyId,
            productionDate: today
        }).select('batchNumber').sort({ batchNumber: -1 }).limit(1);
        let nextBatchNumber = 1;
        if (existingBatches.length > 0) {
            nextBatchNumber = existingBatches[0].batchNumber + 1;
        }
        console.log(`📊 Next batch number will start from: ${nextBatchNumber}`);
        // Check if this product is part of a production group
        const productionGroup = yield ProductionGroup_js_1.default.findOne({
            company: companyId,
            items: productId,
            isActive: true
        });
        const groupId = productionGroup ? productionGroup._id : null;
        console.log(`🔗 Product ${groupId ? 'IS' : 'IS NOT'} part of a production group: ${groupId}`);
        // Create ProductionBatch entries
        // IMPORTANT: split batchAdjusted into full + remainder
        // so "1.3" becomes [1.0, 0.3] instead of two 1.3 batches.
        const safeBatchAdjusted = Math.max(0, Number(batchAdjusted) || 0);
        const fullBatches = Math.floor(safeBatchAdjusted);
        const remainder = parseFloat((safeBatchAdjusted - fullBatches).toFixed(2));
        const totalBatchesToCreate = fullBatches + (remainder > 0 ? 1 : 0);
        if (totalBatchesToCreate === 0) {
            console.log(`⚠️ batchAdjusted=${batchAdjusted} results in 0 batches — skipping ProductionBatch creation for ${productName}`);
            return [];
        }
        const batchEntries = [];
        for (let i = 0; i < totalBatchesToCreate; i++) {
            const currentBatchNumber = nextBatchNumber + i;
            const paddedBatchNumber = String(currentBatchNumber).padStart(2, '0');
            const batchNo = `BATNO${paddedBatchNumber}`;
            // Determine this batch's weight (1.0 for full batches, remainder for last one)
            const isRemainderBatch = i >= fullBatches;
            const batchWeight = isRemainderBatch && remainder > 0 ? remainder : 1.0;
            const actualQty = (qtyPerBatch || 0) * batchWeight;
            const batchEntry = {
                companyId,
                groupId, // Optional - will be null for ungrouped items
                batchNumber: currentBatchNumber,
                batchNo,
                productionDate: today,
                qtyPerBatch: qtyPerBatch, // Base qty per batch
                qtyAchieved: actualQty,
                productionLoss: 0,
                status: 'pending', // Start with pending status
                mouldingTime: null,
                unloadingTime: null,
                createdBy: approvedBy,
                totalBatchAdjusted: batchWeight,
                combinedItems: [{
                        itemId: productId,
                        DailyProductionId: dailyDetailsId || null,
                        batchAdjustedValue: batchWeight,
                        qtyContribution: actualQty
                    }],
                notes: `Created by unit manager bulk approval`
            };
            batchEntries.push(batchEntry);
            console.log(`📦 Prepared batch ${i + 1}/${totalBatchesToCreate}: ${batchNo} with weight ${batchWeight} and qty ${actualQty}`);
        }
        // Insert all batch entries at once
        const createdBatches = yield ProductionBatch_js_1.default.insertMany(batchEntries);
        console.log(`✅ Successfully created ${createdBatches.length} ProductionBatch entries for ${productName}`);
        // Log the created batch numbers for verification
        const createdBatchNos = createdBatches.map(batch => batch.batchNo);
        console.log(`🏷️ Created batch numbers: ${createdBatchNos.join(', ')}`);
        return createdBatches;
    }
    catch (error) {
        console.error('❌ Error creating ProductionBatch entries for bulk approval:', error);
        // Don't throw - this is a supplementary feature, main functionality should continue
        console.error('⚠️ ProductionBatch creation failed but product approval will continue');
        return [];
    }
});
// Get all production groups for unit manager
const getUnitManagerProductionGroups = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🚀 Unit Manager Production Groups Request:', {
            role: req.user.role,
            username: req.user.username,
            companyId: req.user.companyId
        });
        // Only allow Unit Manager role
        if (req.user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const query = {
            company: req.user.companyId,
            isActive: true
        };
        const groups = yield ProductionGroup_js_1.default.find(query)
            .populate({
            path: 'items',
            select: 'name code category subCategory qty unit price'
        })
            .populate({
            path: 'createdBy',
            select: 'username fullName'
        })
            .populate({
            path: 'company',
            select: 'name location'
        })
            .sort({ createdAt: -1 })
            .lean();
        console.log(`✅ Found ${groups.length} production groups for company: ${req.user.companyId}`);
        res.json({
            success: true,
            message: 'Production groups fetched successfully',
            data: {
                groups: groups,
                pagination: {
                    totalPages: 1,
                    currentPage: 1,
                    totalGroups: groups.length
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching unit manager production groups:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch production groups',
            error: error.message
        });
    }
});
exports.getUnitManagerProductionGroups = getUnitManagerProductionGroups;
// Get single production group by ID for unit manager
const getUnitManagerProductionGroupById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔍 Unit Manager Get Production Group by ID:', {
            groupId: req.params.id,
            role: req.user.role,
            companyId: req.user.companyId
        });
        // Only allow Unit Manager role
        if (req.user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const group = yield ProductionGroup_js_1.default.findOne({
            _id: req.params.id,
            company: req.user.companyId,
            isActive: true
        })
            .populate({
            path: 'items',
            select: 'name code category subCategory qty unit price image description'
        })
            .populate({
            path: 'createdBy',
            select: 'username fullName email'
        })
            .populate({
            path: 'company',
            select: 'name location'
        })
            .lean();
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Production group not found'
            });
        }
        console.log('✅ Found production group:', group.name);
        res.json({
            success: true,
            message: 'Production group fetched successfully',
            data: group // Return group directly, not nested in data.group
        });
    }
    catch (error) {
        console.error('Error fetching unit manager production group by ID:', error);
        console.error('Error stack:', error.stack);
        console.error('Request details:', {
            groupId: req.params.id,
            userId: req.user.userId,
            companyId: req.user.companyId
        });
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid group ID provided'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to fetch production group',
            error: error.message
        });
    }
});
exports.getUnitManagerProductionGroupById = getUnitManagerProductionGroupById;
// Create new production group for unit manager
const createUnitManagerProductionGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🆕 Unit Manager Create Production Group:', {
            role: req.user.role,
            companyId: req.user.companyId,
            body: req.body
        });
        // Only allow Unit Manager role
        if (req.user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const { name, description, items = [] } = req.body;
        // Validation
        if (!name || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Group name is required'
            });
        }
        // Check for duplicate name
        const existingGroup = yield ProductionGroup_js_1.default.findOne({
            name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
            company: req.user.companyId,
            isActive: true
        });
        if (existingGroup) {
            return res.status(400).json({
                success: false,
                message: `Production group "${name.trim()}" already exists in your company`
            });
        }
        // Validate and calculate qtyPerBatch from ProductDailySummary
        let validatedItems = [];
        let calculatedQtyPerBatch = 0;
        if (items.length > 0) {
            const inventoryItems = yield Inventory_js_1.Item.find({
                _id: { $in: items },
                store: req.user.companyId
            }).select('_id name qty');
            validatedItems = inventoryItems.map(item => item._id);
            // Get ProductDailySummary data for qtyPerBatch calculation
            const productSummaries = yield ProductDailySummary_js_1.default.find({
                productId: { $in: validatedItems },
                companyId: req.user.companyId
            }).select('productId qtyPerBatch');
            console.log('📊 ProductDailySummary data found:', productSummaries.map(summary => ({
                productId: summary.productId,
                qtyPerBatch: summary.qtyPerBatch || 0
            })));
            // ✅ QUANTITY/BATCH VALIDATION LOGIC
            if (productSummaries.length > 0) {
                // Get all qtyPerBatch values
                const qtyPerBatchValues = productSummaries.map(summary => summary.qtyPerBatch || 0);
                const uniqueQtyValues = [...new Set(qtyPerBatchValues)];
                console.log('🔍 All qtyPerBatch values:', qtyPerBatchValues);
                console.log('🔍 Unique qtyPerBatch values:', uniqueQtyValues);
                // Check if all items have the same qtyPerBatch
                if (uniqueQtyValues.length > 1) {
                    // Items have different quantities - return error with details
                    const itemDetails = productSummaries.map(summary => {
                        const item = inventoryItems.find(item => item._id.toString() === summary.productId.toString());
                        return {
                            name: (item === null || item === void 0 ? void 0 : item.name) || 'Unknown',
                            qtyPerBatch: summary.qtyPerBatch || 0
                        };
                    });
                    const quantityList = itemDetails.map(item => `${item.name}: ${item.qtyPerBatch}`).join(', ');
                    return res.status(400).json({
                        success: false,
                        message: `Items have different batch quantities and cannot be grouped together. Found quantities: ${quantityList}. All items in a production group must have the same batch quantity.`
                    });
                }
                // All items have the same qtyPerBatch - use it
                calculatedQtyPerBatch = Math.max(...qtyPerBatchValues, 0);
                console.log('✅ All items have matching qtyPerBatch:', calculatedQtyPerBatch);
            }
            else {
                // Fallback to inventory qty if no ProductDailySummary found
                const itemQuantities = inventoryItems.map(item => item.qty || 0);
                const uniqueInventoryQty = [...new Set(itemQuantities)];
                console.log('📦 Inventory quantities:', itemQuantities);
                console.log('📦 Unique inventory quantities:', uniqueInventoryQty);
                // Check if all items have the same inventory quantity
                if (uniqueInventoryQty.length > 1) {
                    const itemDetails = inventoryItems.map(item => ({
                        name: item.name,
                        qty: item.qty || 0
                    }));
                    const quantityList = itemDetails.map(item => `${item.name}: ${item.qty}`).join(', ');
                    return res.status(400).json({
                        success: false,
                        message: `Items have different inventory quantities and cannot be grouped together. Found quantities: ${quantityList}. All items in a production group must have the same quantity.`
                    });
                }
                calculatedQtyPerBatch = Math.max(...itemQuantities, 0);
                console.log('⚠️ No ProductDailySummary found, using inventory quantities as fallback');
                console.log('✅ All items have matching inventory qty:', calculatedQtyPerBatch);
            }
        }
        // Create new production group
        const newGroup = new ProductionGroup_js_1.default({
            name: name.trim(),
            description: (description === null || description === void 0 ? void 0 : description.trim()) || '',
            company: req.user.companyId,
            createdBy: req.user.userId,
            items: validatedItems,
            qtyPerBatch: calculatedQtyPerBatch,
            qtyAchievedPerBatch: 0,
            isActive: true,
            metadata: {
                totalItems: validatedItems.length,
                lastUpdated: new Date()
            }
        });
        const savedGroup = yield newGroup.save();
        console.log('✅ Unit Manager production group created successfully:', savedGroup._id);
        // Populate and return
        yield savedGroup.populate('items', 'name code category');
        yield savedGroup.populate('createdBy', 'username fullName');
        res.status(201).json({
            success: true,
            message: 'Production group created successfully',
            data: savedGroup // Changed from 'group' to 'data' for consistency
        });
    }
    catch (error) {
        console.error('Error creating unit manager production group:', error);
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Production group with this name already exists'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to create production group',
            error: error.message
        });
    }
});
exports.createUnitManagerProductionGroup = createUnitManagerProductionGroup;
// Update production group for unit manager
const updateUnitManagerProductionGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('📝 Unit Manager Update Production Group:', {
            groupId: req.params.id,
            role: req.user.role,
            companyId: req.user.companyId,
            body: req.body
        });
        // Only allow Unit Manager role
        if (req.user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const { name, description, items = [], qtyPerBatch, qtyAchievedPerBatch } = req.body;
        // Validation
        if (!name || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Group name is required'
            });
        }
        // Find existing group
        const existingGroup = yield ProductionGroup_js_1.default.findOne({
            _id: req.params.id,
            company: req.user.companyId,
            isActive: true
        });
        if (!existingGroup) {
            return res.status(404).json({
                success: false,
                message: 'Production group not found'
            });
        }
        // Check name uniqueness (excluding current group)
        if (name.trim() !== existingGroup.name) {
            const duplicateGroup = yield ProductionGroup_js_1.default.findOne({
                name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
                company: req.user.companyId,
                isActive: true,
                _id: { $ne: req.params.id }
            });
            if (duplicateGroup) {
                return res.status(400).json({
                    success: false,
                    message: `Production group "${name.trim()}" already exists in your company`
                });
            }
        }
        // Validate items and recalculate qtyPerBatch with quantity validation
        let validatedItems = [];
        let calculatedQtyPerBatch = existingGroup.qtyPerBatch;
        if (items.length > 0) {
            const inventoryItems = yield Inventory_js_1.Item.find({
                _id: { $in: items },
                store: req.user.companyId
            }).select('_id name qty');
            validatedItems = inventoryItems.map(item => item._id);
            // Recalculate qtyPerBatch from ProductDailySummary with validation
            const updateProductSummaries = yield ProductDailySummary_js_1.default.find({
                productId: { $in: validatedItems },
                companyId: req.user.companyId
            }).select('productId qtyPerBatch');
            // ✅ QUANTITY/BATCH VALIDATION LOGIC FOR UNIT MANAGER UPDATE
            if (updateProductSummaries.length > 0) {
                // Get all qtyPerBatch values
                const qtyPerBatchValues = updateProductSummaries.map(summary => summary.qtyPerBatch || 0);
                const uniqueQtyValues = [...new Set(qtyPerBatchValues)];
                console.log('🔍 Unit Manager Update - All qtyPerBatch values:', qtyPerBatchValues);
                console.log('🔍 Unit Manager Update - Unique qtyPerBatch values:', uniqueQtyValues);
                // Check if all items have the same qtyPerBatch
                if (uniqueQtyValues.length > 1) {
                    // Items have different quantities - return error with details
                    const itemDetails = updateProductSummaries.map(summary => {
                        const item = inventoryItems.find(item => item._id.toString() === summary.productId.toString());
                        return {
                            name: (item === null || item === void 0 ? void 0 : item.name) || 'Unknown',
                            qtyPerBatch: summary.qtyPerBatch || 0
                        };
                    });
                    const quantityList = itemDetails.map(item => `${item.name}: ${item.qtyPerBatch}`).join(', ');
                    return res.status(400).json({
                        success: false,
                        message: `Items have different batch quantities and cannot be grouped together. Found quantities: ${quantityList}. All items in a production group must have the same batch quantity.`
                    });
                }
                // All items have the same qtyPerBatch - use it
                calculatedQtyPerBatch = Math.max(...qtyPerBatchValues, 0);
                console.log('✅ Unit Manager Update - All items have matching qtyPerBatch:', calculatedQtyPerBatch);
            }
            else {
                // Fallback to inventory qty if no ProductDailySummary found
                const itemQuantities = inventoryItems.map(item => item.qty || 0);
                const uniqueInventoryQty = [...new Set(itemQuantities)];
                console.log('📦 Unit Manager Update - Inventory quantities:', itemQuantities);
                console.log('📦 Unit Manager Update - Unique inventory quantities:', uniqueInventoryQty);
                // Check if all items have the same inventory quantity
                if (uniqueInventoryQty.length > 1) {
                    const itemDetails = inventoryItems.map(item => ({
                        name: item.name,
                        qty: item.qty || 0
                    }));
                    const quantityList = itemDetails.map(item => `${item.name}: ${item.qty}`).join(', ');
                    return res.status(400).json({
                        success: false,
                        message: `Items have different inventory quantities and cannot be grouped together. Found quantities: ${quantityList}. All items in a production group must have the same quantity.`
                    });
                }
                calculatedQtyPerBatch = Math.max(...itemQuantities, 0);
                console.log('⚠️ Unit Manager Update - No ProductDailySummary found, using inventory quantities as fallback');
                console.log('✅ Unit Manager Update - All items have matching inventory qty:', calculatedQtyPerBatch);
            }
        }
        // Update group
        existingGroup.name = name.trim();
        existingGroup.description = (description === null || description === void 0 ? void 0 : description.trim()) || '';
        existingGroup.items = validatedItems;
        existingGroup.qtyPerBatch = calculatedQtyPerBatch;
        if (qtyAchievedPerBatch !== undefined) {
            existingGroup.qtyAchievedPerBatch = parseFloat(qtyAchievedPerBatch) || 0;
        }
        existingGroup.metadata = {
            totalItems: validatedItems.length,
            lastUpdated: new Date()
        };
        const savedGroup = yield existingGroup.save();
        console.log('✅ Unit Manager production group updated successfully');
        // Populate and return
        yield savedGroup.populate('items', 'name code category');
        yield savedGroup.populate('createdBy', 'username fullName');
        res.json({
            success: true,
            message: 'Production group updated successfully',
            data: savedGroup // Changed from 'group' to 'data' for consistency
        });
    }
    catch (error) {
        console.error('Unit Manager update production group error:', error);
        console.error('Error stack:', error.stack);
        console.error('Request details:', {
            groupId: req.params.id,
            userId: req.user.userId,
            companyId: req.user.companyId,
            body: req.body
        });
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Production group with this name already exists'
            });
        }
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: Object.values(error.errors).map(err => err.message)
            });
        }
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid group ID provided'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to update production group',
            error: error.message
        });
    }
});
exports.updateUnitManagerProductionGroup = updateUnitManagerProductionGroup;
// Delete production group for unit manager
const deleteUnitManagerProductionGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🗑️ Unit Manager Delete Production Group:', {
            groupId: req.params.id,
            role: req.user.role,
            companyId: req.user.companyId
        });
        // Only allow Unit Manager role
        if (req.user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const group = yield ProductionGroup_js_1.default.findOne({
            _id: req.params.id,
            company: req.user.companyId,
            isActive: true
        });
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Production group not found'
            });
        }
        // Soft delete
        group.isActive = false;
        yield group.save();
        console.log('✅ Unit Manager production group deleted successfully');
        res.json({
            success: true,
            message: 'Production group deleted successfully'
        });
    }
    catch (error) {
        console.error('Unit Manager delete production group error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete production group',
            error: error.message
        });
    }
});
exports.deleteUnitManagerProductionGroup = deleteUnitManagerProductionGroup;
// Get available items for unit manager production groups
const getUnitManagerAvailableItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔍 Unit Manager Get Available Items:', {
            role: req.user.role,
            companyId: req.user.companyId,
            query: req.query
        });
        // Only allow Unit Manager role
        if (req.user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const { search = '', excludeGroupId } = req.query;
        // Get all items for this company
        let itemFilter = {
            store: req.user.companyId
        };
        // Add search filter if provided
        if (search.trim()) {
            itemFilter.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { code: { $regex: search.trim(), $options: 'i' } },
                { category: { $regex: search.trim(), $options: 'i' } }
            ];
        }
        // Get all items
        const allItems = yield Inventory_js_1.Item.find(itemFilter)
            .select('name code category subCategory batch qty unit price image')
            .lean();
        // Get items already assigned to production groups (excluding current group if provided)
        let groupFilter = {
            company: req.user.companyId,
            isActive: true
        };
        if (excludeGroupId) {
            groupFilter._id = { $ne: excludeGroupId };
        }
        const assignedGroups = yield ProductionGroup_js_1.default.find(groupFilter)
            .select('items')
            .lean();
        const assignedItemIds = assignedGroups.flatMap(group => group.items.map(item => item.toString()));
        // Filter out assigned items
        const availableItems = allItems.filter(item => !assignedItemIds.includes(item._id.toString()));
        console.log(`✅ Found ${availableItems.length} available items (${assignedItemIds.length} already assigned)`);
        res.json({
            success: true,
            message: 'Available items fetched successfully',
            data: {
                items: availableItems,
                totalItems: availableItems.length,
                assignedItemsCount: assignedItemIds.length
            }
        });
    }
    catch (error) {
        console.error('Error fetching unit manager available items:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch available items',
            error: error.message
        });
    }
});
exports.getUnitManagerAvailableItems = getUnitManagerAvailableItems;
// Get approved product summaries with available batches (non-zero)
const getApprovedProductSummaries = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🚀 Unit Manager Approved Product Summaries Request:', {
            role: req.user.role,
            username: req.user.username,
            companyId: req.user.companyId
        });
        // Only allow Unit Manager role
        if (req.user.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const { search = '', date } = req.query;
        // Date filtering support - default to current date if no date provided
        let summaryDate = null;
        if (date) {
            summaryDate = new Date(date);
            if (isNaN(summaryDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid date format. Use YYYY-MM-DD'
                });
            }
            summaryDate.setUTCHours(0, 0, 0, 0);
        }
        else {
            // Default to current date for dashboard
            summaryDate = new Date();
            summaryDate.setUTCHours(0, 0, 0, 0);
        }
        console.log('📅 Date filter:', summaryDate.toISOString().split('T')[0]);
        // Get master product data from ProductDailySummary
        const masterFilter = {
            companyId: req.user.companyId
        };
        // Add search functionality for master data
        if (search.trim()) {
            masterFilter.productName = { $regex: search.trim(), $options: 'i' };
        }
        const masterProducts = yield ProductDailySummary_js_1.default.find(masterFilter)
            .populate({
            path: 'productId',
            select: 'name code category subCategory price stock image'
        })
            .select('productName qtyPerBatch productId')
            .lean();
        // Get daily details for the specific date - SHOW ALL APPROVED PRODUCTS
        const dailyFilter = {
            date: summaryDate,
            companyId: req.user.companyId,
            status: 'approved'
            // REMOVED: Only show items with production final batches > 0 or batch adjusted > 0
            // $or: [
            //   { productionFinalBatches: { $gt: 0 } },
            //   { batchAdjusted: { $gt: 0 } }
            // ]
        };
        console.log('📋 Showing ALL approved products (including zero batches)');
        const dailyDetails = yield ProductDetailsDailySummary_js_1.default.find(dailyFilter)
            .populate({
            path: 'productId',
            select: 'name code category subCategory price stock image'
        })
            .select('productName qtyPerBatch batchAdjusted productionFinalBatches totalQuantity totalIndent physicalStock status createdAt updatedAt productId toBeProducedDay toBeProducedBatches produceBatches expiryShortage balanceFinalBatches')
            .sort({ updatedAt: -1 })
            .lean();
        // Create a map of daily details by productId
        const dailyDetailsMap = new Map();
        dailyDetails.forEach(detail => {
            if (detail.productId && detail.productId._id) {
                dailyDetailsMap.set(detail.productId._id.toString(), detail);
            }
        });
        // Combine master data with daily details - only include products that have approved daily data
        const combinedSummaries = [];
        masterProducts.forEach(masterProduct => {
            const productId = masterProduct.productId ? masterProduct.productId._id.toString() : null;
            const dailyDetail = dailyDetailsMap.get(productId);
            // Only include products that have approved daily data with available batches
            if (dailyDetail) {
                combinedSummaries.push(Object.assign(Object.assign(Object.assign({}, masterProduct), dailyDetail), { 
                    // Ensure master data takes precedence for qtyPerBatch
                    qtyPerBatch: masterProduct.qtyPerBatch || dailyDetail.qtyPerBatch || 0 }));
            }
        });
        // Use all combined results (no pagination)
        const totalCount = combinedSummaries.length;
        const allSummaries = combinedSummaries;
        // Get all production groups for this company to find which products belong to which groups
        const productionGroups = yield ProductionGroup_js_1.default.find({
            company: req.user.companyId,
            isActive: true
        }).select('name items').lean();
        // Create a map of productId to group names
        const productToGroupMap = {};
        productionGroups.forEach(group => {
            group.items.forEach(itemId => {
                const itemIdStr = itemId.toString();
                if (!productToGroupMap[itemIdStr]) {
                    productToGroupMap[itemIdStr] = [];
                }
                productToGroupMap[itemIdStr].push(group.name);
            });
        });
        // Format the response data
        const formattedSummaries = allSummaries.map(summary => {
            var _a, _b, _c, _d, _e, _f, _g;
            const productId = ((_b = (_a = summary.productId) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString()) || ((_c = summary.productId) === null || _c === void 0 ? void 0 : _c.toString());
            const productGroups = productToGroupMap[productId] || [];
            // Calculate available batches with better logic
            // let availableBatches = 0;
            // if (summary.batchAdjusted && summary.batchAdjusted > 0) {
            //   availableBatches = summary.batchAdjusted;
            // } else if (summary.productionFinalBatches && summary.productionFinalBatches > 0) {
            //   availableBatches = summary.productionFinalBatches;
            // } else if (summary.qtyPerBatch && summary.qtyPerBatch > 0) {
            //   // If no batches set, default to 1 batch based on qtyPerBatch
            //   availableBatches = 1;
            // }
            return {
                id: summary._id,
                productName: summary.productName,
                productCode: ((_d = summary.productId) === null || _d === void 0 ? void 0 : _d.code) || 'N/A',
                category: ((_e = summary.productId) === null || _e === void 0 ? void 0 : _e.category) || 'N/A',
                subCategory: ((_f = summary.productId) === null || _f === void 0 ? void 0 : _f.subCategory) || 'N/A',
                qtyPerBatch: summary.qtyPerBatch || 0,
                batchAdjusted: summary.batchAdjusted || 0,
                productionFinalBatches: summary.productionFinalBatches || 0,
                totalQuantity: summary.totalQuantity || 0,
                totalIndent: summary.totalIndent || 0,
                physicalStock: summary.physicalStock || 0,
                toBeProducedDay: summary.toBeProducedDay || 0,
                toBeProducedBatches: summary.toBeProducedBatches || 0,
                produceBatches: summary.produceBatches || 0,
                expiryShortage: summary.expiryShortage || 0,
                balanceFinalBatches: summary.balanceFinalBatches || 0,
                status: summary.status || 'approved',
                lastUpdated: summary.updatedAt,
                productImage: (_g = summary.productId) === null || _g === void 0 ? void 0 : _g.image,
                productGroups: productGroups // Add product groups array
            };
        });
        console.log(`✅ Found ${formattedSummaries.length} approved product summaries for date: ${summaryDate.toISOString().split('T')[0]}`);
        res.json({
            success: true,
            message: 'All approved product summaries fetched successfully',
            data: {
                summaries: formattedSummaries,
                stats: {
                    totalApproved: totalCount,
                    totalCount: formattedSummaries.length
                },
                filterApplied: {
                    date: summaryDate.toISOString().split('T')[0],
                    search: search.trim() || null
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching approved product summaries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch approved product summaries',
            error: error.message
        });
    }
});
exports.getApprovedProductSummaries = getApprovedProductSummaries;
// ===============================================
// UNIT MANAGER RETURNS/DAMAGES MANAGEMENT
// ===============================================
// Get sales persons for the unit manager's company
const getUnitManagerSalesPersons = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('🔍 Getting sales persons for Unit Manager:', {
            userId: unitManager._id,
            companyId: unitManager.companyId
        });
        const salesPersons = yield User_js_1.default.find({
            companyId: unitManager.companyId,
            role: { $in: ['Sales', 'sales', 'SALES', 'Sales Person', 'SalesPerson', 'Sales Head', 'Sales Employee'] },
            isActive: { $ne: false }
        }).select('_id username fullName email').sort({ username: 1 });
        console.log('✅ Found sales persons:', salesPersons.length);
        res.json({
            success: true,
            data: salesPersons
        });
    }
    catch (error) {
        console.error('Error fetching sales persons:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sales persons',
            error: error.message
        });
    }
});
exports.getUnitManagerSalesPersons = getUnitManagerSalesPersons;
// Get returns for Unit Manager (all returns for the company)
const getUnitManagerReturns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const { salesPersonId, status, type } = req.query;
        console.log('🔍 Getting returns for Unit Manager:', {
            userId: unitManager._id,
            companyId: unitManager.companyId,
            salesPersonId,
            status,
            type
        });
        // Build filter for company - include both returns and damages
        const filter = {
            companyId: unitManager.companyId,
            type: { $in: ['refund', 'exchange', 'damage'] } // Include both returns and damages
        };
        if (salesPersonId) {
            filter.salesPerson = salesPersonId;
        }
        if (status) {
            filter.status = status;
        }
        if (type && type !== 'all') {
            filter.type = type; // Override the $in filter if specific type is requested
        }
        const returns = yield Return_js_1.default.find(filter)
            .populate('salesPerson', 'username fullName')
            .populate('customerId', 'name address')
            .sort({ createdAt: -1 });
        // Add enriched data
        const enrichedReturns = returns.map(returnItem => {
            var _a, _b;
            return (Object.assign(Object.assign({}, returnItem.toObject()), { salesPersonName: ((_a = returnItem.salesPerson) === null || _a === void 0 ? void 0 : _a.username) || ((_b = returnItem.salesPerson) === null || _b === void 0 ? void 0 : _b.fullName) || 'N/A' }));
        });
        console.log('✅ Found returns:', enrichedReturns.length);
        res.json({
            success: true,
            data: enrichedReturns
        });
    }
    catch (error) {
        console.error('Error fetching returns:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch returns',
            error: error.message
        });
    }
});
exports.getUnitManagerReturns = getUnitManagerReturns;
// Create return for Unit Manager (assign to selected sales person)
const createUnitManagerReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const _a = req.body, { salesPersonId, order } = _a, returnData = __rest(_a, ["salesPersonId", "order"]);
        if (!salesPersonId) {
            return res.status(400).json({
                success: false,
                message: 'Sales person selection is required'
            });
        }
        console.log('🔄 Unit Manager creating return:', {
            userId: unitManager._id,
            companyId: unitManager.companyId,
            salesPersonId,
            order,
            body: returnData
        });
        // Verify the sales person belongs to the same company
        const salesPerson = yield User_js_1.default.findOne({
            _id: salesPersonId,
            companyId: unitManager.companyId,
            role: { $in: ['Sales', 'sales', 'SALES', 'Sales Person', 'SalesPerson', 'Sales Head', 'Sales Employee'] }
        });
        if (!salesPerson) {
            return res.status(400).json({
                success: false,
                message: 'Invalid sales person selected'
            });
        }
        // Normalize optional order id
        const normalizedOrder = order === '' ? null : order;
        if (normalizedOrder && !mongoose_1.default.isValidObjectId(String(normalizedOrder))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid order id'
            });
        }
        // Fetch orderDate if order is provided
        let orderDate = null;
        if (normalizedOrder) {
            const orderRecord = yield Order_js_1.default.findById(normalizedOrder);
            if (orderRecord) {
                orderDate = orderRecord.orderDate || orderRecord.createdAt;
            }
        }
        // Prepare return data with associations
        const finalReturnData = Object.assign(Object.assign({}, returnData), { order: normalizedOrder, orderDate, companyId: unitManager.companyId, salesPerson: salesPersonId, createdBy: unitManager._id, status: 'pending' // Unit Manager creates in pending state
         });
        const newReturn = new Return_js_1.default(finalReturnData);
        const savedReturn = yield newReturn.save();
        res.status(201).json({
            success: true,
            message: 'Return created successfully',
            return: savedReturn
        });
    }
    catch (error) {
        console.error('Unit Manager create return error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create return',
            error: error.message
        });
    }
});
exports.createUnitManagerReturn = createUnitManagerReturn;
// Update return for Unit Manager
const updateUnitManagerReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        const { id } = req.params;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('🔄 Unit Manager updating return:', {
            returnId: id,
            userId: unitManager._id,
            companyId: unitManager.companyId
        });
        // Find return - Unit Manager can update any return in their company
        const existingReturn = yield Return_js_1.default.findOne({
            _id: id,
            companyId: unitManager.companyId
        });
        if (!existingReturn) {
            return res.status(404).json({
                success: false,
                message: 'Return not found or access denied'
            });
        }
        // Build safe update payload (avoid ObjectId cast errors from empty strings)
        const updatePayload = Object.assign({}, req.body);
        // Normalize optional ObjectId fields
        if (updatePayload.order === '') {
            updatePayload.order = null;
            updatePayload.orderDate = null;
        }
        else if (updatePayload.order === null) {
            updatePayload.orderDate = null;
        }
        else if (updatePayload.order !== undefined) {
            if (!mongoose_1.default.isValidObjectId(String(updatePayload.order))) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid order id'
                });
            }
            const orderRecord = yield Order_js_1.default.findById(updatePayload.order);
            updatePayload.orderDate = orderRecord ? (orderRecord.orderDate || orderRecord.createdAt) : null;
        }
        // Update the return
        const updatedReturn = yield Return_js_1.default.findByIdAndUpdate(id, Object.assign(Object.assign({}, updatePayload), { updatedBy: unitManager._id, updatedAt: new Date() }), { new: true });
        console.log('✅ Return updated successfully');
        res.json({
            success: true,
            message: 'Return updated successfully',
            return: updatedReturn
        });
    }
    catch (error) {
        console.error('Unit Manager update return error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update return',
            error: error.message
        });
    }
});
exports.updateUnitManagerReturn = updateUnitManagerReturn;
// Delete return for Unit Manager
const deleteUnitManagerReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        const { id } = req.params;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('🗑️ Unit Manager deleting return:', {
            returnId: id,
            userId: unitManager._id,
            companyId: unitManager.companyId
        });
        // Find return - Unit Manager can delete any return in their company
        const existingReturn = yield Return_js_1.default.findOne({
            _id: id,
            companyId: unitManager.companyId
        });
        if (!existingReturn) {
            return res.status(404).json({
                success: false,
                message: 'Return not found or access denied'
            });
        }
        // Delete the return
        yield Return_js_1.default.findByIdAndDelete(id);
        console.log('✅ Return deleted successfully');
        res.json({
            success: true,
            message: 'Return deleted successfully'
        });
    }
    catch (error) {
        console.error('Unit Manager delete return error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete return',
            error: error.message
        });
    }
});
exports.deleteUnitManagerReturn = deleteUnitManagerReturn;
// Approve return for Unit Manager
const approveUnitManagerReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        const { id } = req.params;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('✅ Unit Manager approving return:', {
            returnId: id,
            userId: unitManager._id,
            companyId: unitManager.companyId
        });
        // Find return - Unit Manager can approve any return in their company
        const existingReturn = yield Return_js_1.default.findOne({
            _id: id,
            companyId: unitManager.companyId,
            status: 'pending' // Only approve pending returns
        });
        if (!existingReturn) {
            return res.status(404).json({
                success: false,
                message: 'Return not found, already processed, or access denied'
            });
        }
        // Approve the return
        const approvedReturn = yield Return_js_1.default.findByIdAndUpdate(id, {
            status: 'approved',
            approvedBy: unitManager._id,
            approvedAt: new Date(),
            updatedAt: new Date()
        }, { new: true });
        console.log('✅ Return approved successfully');
        // Deduct the return amount from customer's outstanding balance and sync with Invoices
        if (approvedReturn.customerId) {
            try {
                const customer = yield Customer_js_1.default.findById(approvedReturn.customerId);
                if (customer) {
                    const oldBalance = customer.outstandingAmount || 0;
                    customer.outstandingAmount = oldBalance - (approvedReturn.totalAmount || 0);
                    yield customer.save();
                    console.log(`💰 Updated Customer ${customer.name} balance: ${oldBalance} -> ${customer.outstandingAmount}`);
                    // SYNC INVOICE BALANCES FOR AGEING REPORT
                    let remainingReturnAmount = approvedReturn.totalAmount || 0;
                    // 1. Try to find the specific order's invoice first
                    if (approvedReturn.order) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const targetInvoice = yield Sale.findOne({ order: approvedReturn.order });
                        if (targetInvoice && targetInvoice.balanceAmount > 0) {
                            const reduction = Math.min(targetInvoice.balanceAmount, remainingReturnAmount);
                            targetInvoice.balanceAmount -= reduction;
                            remainingReturnAmount -= reduction;
                            yield targetInvoice.save();
                            console.log(`📑 Reduced targeted invoice ${targetInvoice.invoiceNumber} balance by ${reduction}`);
                        }
                    }
                    // 2. If still amount left or no order linked, use FIFO to reduce other invoices
                    if (remainingReturnAmount > 0) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const unpaidInvoices = yield Sale.find({
                            customer: approvedReturn.customerId,
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
                console.error('❌ Error updating customer outstanding amount and Sale balances on return approval:', err);
            }
        }
        res.json({
            success: true,
            message: 'Return approved successfully',
            return: approvedReturn
        });
    }
    catch (error) {
        console.error('Unit Manager approve return error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve return',
            error: error.message
        });
    }
});
exports.approveUnitManagerReturn = approveUnitManagerReturn;
// Get damages for Unit Manager (all damages for the company)
const getUnitManagerDamages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const { salesPersonId, status } = req.query;
        console.log('🔍 Getting damages for Unit Manager:', {
            userId: unitManager._id,
            companyId: unitManager.companyId,
            salesPersonId,
            status
        });
        // Build filter for company
        const filter = {
            companyId: unitManager.companyId,
            type: { $in: ['damage', 'defective', 'expired'] } // Damages only
        };
        if (salesPersonId) {
            filter.salesPerson = salesPersonId;
        }
        if (status) {
            filter.status = status;
        }
        const damages = yield Return_js_1.default.find(filter)
            .populate('salesPerson', 'username fullName')
            .populate('customerId', 'name address')
            .sort({ createdAt: -1 });
        // Add enriched data
        const enrichedDamages = damages.map(damageItem => {
            var _a, _b;
            return (Object.assign(Object.assign({}, damageItem.toObject()), { salesPersonName: ((_a = damageItem.salesPerson) === null || _a === void 0 ? void 0 : _a.username) || ((_b = damageItem.salesPerson) === null || _b === void 0 ? void 0 : _b.fullName) || 'N/A' }));
        });
        console.log('✅ Found damages:', enrichedDamages.length);
        res.json({
            success: true,
            data: enrichedDamages
        });
    }
    catch (error) {
        console.error('Error fetching damages:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch damages',
            error: error.message
        });
    }
});
exports.getUnitManagerDamages = getUnitManagerDamages;
// Create damage for Unit Manager (assign to selected sales person)
const createUnitManagerDamage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        const _a = req.body, { salesPersonId, order } = _a, damageData = __rest(_a, ["salesPersonId", "order"]);
        if (!salesPersonId) {
            return res.status(400).json({
                success: false,
                message: 'Sales person selection is required'
            });
        }
        console.log('🔄 Unit Manager creating damage:', {
            userId: unitManager._id,
            companyId: unitManager.companyId,
            salesPersonId,
            order,
            body: damageData
        });
        // Verify the sales person belongs to the same company
        const salesPerson = yield User_js_1.default.findOne({
            _id: salesPersonId,
            companyId: unitManager.companyId,
            role: { $in: ['Sales', 'sales', 'SALES', 'Sales Person', 'SalesPerson', 'Sales Head', 'Sales Employee'] }
        });
        if (!salesPerson) {
            return res.status(400).json({
                success: false,
                message: 'Invalid sales person selected'
            });
        }
        // Fetch orderDate if order is provided
        let orderDate = null;
        if (order) {
            const orderRecord = yield Order_js_1.default.findById(order);
            if (orderRecord) {
                orderDate = orderRecord.orderDate || orderRecord.createdAt;
            }
        }
        // Prepare damage data with associations
        const finalDamageData = Object.assign(Object.assign({}, damageData), { order,
            orderDate, companyId: unitManager.companyId, salesPerson: salesPersonId, createdBy: unitManager._id, status: 'pending' // Unit Manager creates in pending state
         });
        const newDamage = new Return_js_1.default(finalDamageData);
        const savedDamage = yield newDamage.save();
        res.status(201).json({
            success: true,
            message: 'Damage created successfully',
            damage: savedDamage
        });
    }
    catch (error) {
        console.error('Unit Manager create damage error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create damage',
            error: error.message
        });
    }
});
exports.createUnitManagerDamage = createUnitManagerDamage;
// Update damage for Unit Manager
const updateUnitManagerDamage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        const { id } = req.params;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('🔄 Unit Manager updating damage:', {
            damageId: id,
            userId: unitManager._id,
            companyId: unitManager.companyId
        });
        // Find damage - Unit Manager can update any damage in their company
        const existingDamage = yield Return_js_1.default.findOne({
            _id: id,
            companyId: unitManager.companyId
        });
        if (!existingDamage) {
            return res.status(404).json({
                success: false,
                message: 'Damage not found or access denied'
            });
        }
        // Update the damage
        const updatedDamage = yield Return_js_1.default.findByIdAndUpdate(id, Object.assign(Object.assign({}, req.body), { updatedBy: unitManager._id, updatedAt: new Date() }), { new: true });
        console.log('✅ Damage updated successfully');
        res.json({
            success: true,
            message: 'Damage updated successfully',
            damage: updatedDamage
        });
    }
    catch (error) {
        console.error('Unit Manager update damage error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update damage',
            error: error.message
        });
    }
});
exports.updateUnitManagerDamage = updateUnitManagerDamage;
// Delete damage for Unit Manager
const deleteUnitManagerDamage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        const { id } = req.params;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('🗑️ Unit Manager deleting damage:', {
            damageId: id,
            userId: unitManager._id,
            companyId: unitManager.companyId
        });
        // Find damage - Unit Manager can delete any damage in their company
        const existingDamage = yield Return_js_1.default.findOne({
            _id: id,
            companyId: unitManager.companyId
        });
        if (!existingDamage) {
            return res.status(404).json({
                success: false,
                message: 'Damage not found or access denied'
            });
        }
        // Delete the damage
        yield Return_js_1.default.findByIdAndDelete(id);
        console.log('✅ Damage deleted successfully');
        res.json({
            success: true,
            message: 'Damage deleted successfully'
        });
    }
    catch (error) {
        console.error('Unit Manager delete damage error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete damage',
            error: error.message
        });
    }
});
exports.deleteUnitManagerDamage = deleteUnitManagerDamage;
// Approve damage for Unit Manager
const approveUnitManagerDamage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unitManager = req.user;
        const { id } = req.params;
        if (unitManager.role !== 'Unit Manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Unit Manager role required'
            });
        }
        console.log('✅ Unit Manager approving damage:', {
            damageId: id,
            userId: unitManager._id,
            companyId: unitManager.companyId
        });
        // Find damage - Unit Manager can approve any damage in their company
        const existingDamage = yield Return_js_1.default.findOne({
            _id: id,
            companyId: unitManager.companyId,
            status: 'pending' // Only approve pending damages
        });
        if (!existingDamage) {
            return res.status(404).json({
                success: false,
                message: 'Damage not found, already processed, or access denied'
            });
        }
        // Approve the damage
        const approvedDamage = yield Return_js_1.default.findByIdAndUpdate(id, {
            status: 'approved',
            approvedBy: unitManager._id,
            approvedAt: new Date(),
            updatedAt: new Date()
        }, { new: true });
        console.log('✅ Damage approved successfully');
        // Deduct the damage amount from customer's outstanding balance and sync with Invoices
        if (approvedDamage.customerId) {
            try {
                const customer = yield Customer_js_1.default.findById(approvedDamage.customerId);
                if (customer) {
                    const oldBalance = customer.outstandingAmount || 0;
                    customer.outstandingAmount = oldBalance - (approvedDamage.totalAmount || 0);
                    yield customer.save();
                    console.log(`💰 Updated Customer ${customer.name} balance (Damage): ${oldBalance} -> ${customer.outstandingAmount}`);
                    // SYNC INVOICE BALANCES FOR AGEING REPORT
                    let remainingReturnAmount = approvedDamage.totalAmount || 0;
                    // 1. Try to find the specific order's invoice first
                    if (approvedDamage.order) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const targetInvoice = yield Sale.findOne({ order: approvedDamage.order });
                        if (targetInvoice && targetInvoice.balanceAmount > 0) {
                            const reduction = Math.min(targetInvoice.balanceAmount, remainingReturnAmount);
                            targetInvoice.balanceAmount -= reduction;
                            remainingReturnAmount -= reduction;
                            yield targetInvoice.save();
                            console.log(`📑 Reduced targeted invoice ${targetInvoice.invoiceNumber} balance by ${reduction} (Damage)`);
                        }
                    }
                    // 2. If still amount left or no order linked, use FIFO
                    if (remainingReturnAmount > 0) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const unpaidInvoices = yield Sale.find({
                            customer: approvedDamage.customerId,
                            balanceAmount: { $gt: 0 }
                        }).sort({ saleDate: 1 });
                        for (const inv of unpaidInvoices) {
                            if (remainingReturnAmount <= 0)
                                break;
                            const reduction = Math.min(inv.balanceAmount, remainingReturnAmount);
                            inv.balanceAmount -= reduction;
                            remainingReturnAmount -= reduction;
                            yield inv.save();
                            console.log(`📑 Reduced invoice ${inv.invoiceNumber} balance by ${reduction} (FIFO - Damage)`);
                        }
                    }
                }
            }
            catch (err) {
                console.error('❌ Error updating customer outstanding amount and Sale balances on damage approval:', err);
            }
        }
        res.json({
            success: true,
            message: 'Damage approved successfully',
            return: approvedDamage
        });
    }
    catch (error) {
        console.error('Unit Manager approve damage error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve damage',
            error: error.message
        });
    }
});
exports.approveUnitManagerDamage = approveUnitManagerDamage;
