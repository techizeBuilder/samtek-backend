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
exports.approveNOC = exports.getNOCRequests = exports.approveSaleOrder = exports.updateOrderStoreInfo = exports.updateSaleStoreInfo = exports.generateGatePass = exports.getOrderTracking = exports.addPaymentEvidence = exports.approveAccountOrder = exports.verifyServiceOrder = exports.checkExistingOrder = exports.deleteOrder = exports.updateOrderStatus = exports.updateOrder = exports.getOrderById = exports.getOrders = exports.createOrder = void 0;
const Order_js_1 = __importDefault(require("../models/Order.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const ProductDailySummary_js_1 = __importDefault(require("../models/ProductDailySummary.js"));
const CutoffTime_js_1 = __importDefault(require("../models/CutoffTime.js"));
const notificationService_js_1 = __importDefault(require("../services/notificationService.js"));
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Account_js_1 = require("../models/Account.js");
const mongoose_1 = __importDefault(require("mongoose"));
const QCJob_js_1 = __importDefault(require("../models/QCJob.js"));
const ProductionOrder_js_1 = __importDefault(require("../models/ProductionOrder.js"));
const PurchaseRequest_js_1 = __importDefault(require("../models/PurchaseRequest.js"));
const today = () => new Date().toISOString().split('T')[0];
function generateQCJobId() {
    return __awaiter(this, void 0, void 0, function* () {
        const year = new Date().getFullYear();
        // Find the job with the highest sequence number for the current year
        const lastJob = yield QCJob_js_1.default.findOne({
            qcJobId: new RegExp(`^QC-${year}-`)
        }).sort({ qcJobId: -1 }).lean();
        let nextNumber = 1;
        if (lastJob && lastJob.qcJobId) {
            const parts = lastJob.qcJobId.split('-');
            if (parts.length === 3) {
                const lastNumber = parseInt(parts[2]);
                if (!isNaN(lastNumber)) {
                    nextNumber = lastNumber + 1;
                }
            }
        }
        return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
    });
}
// Create new order
const createOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { customerId, orderDate, products, notes } = req.body;
        // Validation
        const errors = {};
        if (!customerId) {
            errors.customerId = 'Customer ID is required';
        }
        else {
            // Check if customer exists
            const customerExists = yield Customer_js_1.default.findById(customerId);
            if (!customerExists) {
                errors.customerId = 'Customer not found';
            }
        }
        if (!orderDate) {
            errors.orderDate = 'Order date is required';
        }
        else if (new Date(orderDate).toString() === 'Invalid Date') {
            errors.orderDate = 'Order date must be a valid date';
        }
        if (!products || !Array.isArray(products) || products.length === 0) {
            errors.products = 'At least one product is required';
        }
        else {
            // Validate each product
            for (let i = 0; i < products.length; i++) {
                const product = products[i];
                if (!product.productId) {
                    errors[`products[${i}].productId`] = 'Product ID is required';
                }
                else {
                    // Check if product exists in inventory
                    const productExists = yield Inventory_js_1.Item.findById(product.productId);
                    if (!productExists) {
                        errors[`products[${i}].productId`] = 'Product not found';
                    }
                }
                if (!product.quantity || product.quantity <= 0) {
                    errors[`products[${i}].quantity`] = 'Quantity must be greater than 0';
                }
            }
        }
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({
                status: false,
                message: 'Validation failed.',
                errors
            });
        }
        // ============ CUTOFF TIME VALIDATION ============
        // Check if order creation is allowed based on cutoff time (only for Sales role)
        if (req.user.role === 'Sales' || req.user.role === 'sales') {
            console.log('🕐 Checking cutoff time for Sales user:', req.user.username, 'Company:', req.user.companyId);
            if (req.user.companyId) {
                try {
                    const orderPermission = yield CutoffTime_js_1.default.canPlaceOrder(req.user.companyId);
                    if (!orderPermission.allowed) {
                        console.log('❌ Order blocked by cutoff time:', orderPermission.message);
                        return res.status(403).json({
                            status: false,
                            message: orderPermission.message,
                            cutoffTime: orderPermission.cutoffTime,
                            isPastCutoff: true
                        });
                    }
                    console.log('✅ Order allowed by cutoff time check:', orderPermission.message);
                }
                catch (cutoffError) {
                    console.error('Error checking cutoff time:', cutoffError);
                    // If cutoff time check fails, allow order creation (fail-safe approach)
                    console.log('⚠️ Cutoff time check failed, allowing order creation');
                }
            }
        }
        // Calculate total amount
        let totalAmount = 0;
        const orderProducts = [];
        for (const productItem of products) {
            const product = yield Inventory_js_1.Item.findById(productItem.productId);
            const itemTotal = product.salePrice * productItem.quantity;
            totalAmount += itemTotal;
            orderProducts.push({
                product: productItem.productId,
                quantity: productItem.quantity,
                price: product.salePrice,
                total: itemTotal
            });
        }
        // Generate unique order code
        let orderCode;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            const orderCount = yield Order_js_1.default.countDocuments();
            orderCode = `ORD-${String(orderCount + 1 + attempts).padStart(4, '0')}`;
            // Check if this code already exists
            const existingOrder = yield Order_js_1.default.findOne({ orderCode });
            if (!existingOrder) {
                isUnique = true;
            }
            else {
                attempts++;
            }
        }
        if (!isUnique) {
            // Fallback to timestamp-based code if still not unique
            orderCode = `ORD-${Date.now().toString().slice(-6)}`;
        }
        // Create order
        const order = new Order_js_1.default({
            orderCode,
            customer: customerId,
            salesPerson: req.user._id || req.user.id, // Use _id or id from authenticated user
            companyId: req.user.companyId, // Auto-assign company from logged-in user
            unit: req.user.unit, // Auto-assign unit from logged-in user
            orderDate: new Date(orderDate),
            products: orderProducts,
            totalAmount,
            status: 'pending',
            notes
        });
        console.log('Creating order with salesPerson:', req.user._id || req.user.id, 'User:', req.user.username);
        yield order.save();
        // Populate order with customer details for notification
        yield order.populate('customer', 'name email');
        // Trigger notification for new order - Sales to Unit Manager + Unit Head
        try {
            yield notificationService_js_1.default.triggerSalesNotification({
                action: 'order_created',
                orderData: {
                    _id: order._id,
                    orderCode: order.orderCode,
                    customerName: order.customer.name
                },
                targetUnit: req.user.unit || null,
                targetCompanyId: req.user.companyId || null,
                userId: req.user._id || req.user.id
            });
        }
        catch (notificationError) {
            console.error('Failed to send order notification:', notificationError);
            // Don't fail the order creation if notification fails
        }
        res.status(201).json({
            status: true,
            message: 'Order created successfully.',
            orderId: order._id
        });
    }
    catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            status: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.createOrder = createOrder;
// Get all orders with filtering and pagination
const getOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 10, search = '', status = '', date = '', startDate = '', endDate = '', customerId = '', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const salespersonId = req.user._id || req.user.id;
        const userRole = req.user.role;
        const userCompanyId = req.user.companyId;
        console.log('=== ORDER FILTERING ===');
        console.log('User details:', {
            id: salespersonId,
            role: userRole,
            companyId: userCompanyId,
            username: req.user.username
        });
        // Build filter query with role-based filtering
        const filter = {};
        // 1. Super Admin role sees all orders (no company or sales person restriction)
        if (userRole === 'Superadmin' || userRole === 'Super Admin') {
            console.log('👑 SUPER ADMIN FILTERING - Showing all orders');
        }
        // 2. Sales roles see only their own orders
        else if (userRole === 'Sales' || userRole === 'Sales Employee' || userRole === 'Sales Head') {
            filter.salesPerson = new mongoose_1.default.Types.ObjectId(salespersonId);
            if (userCompanyId) {
                filter.companyId = new mongoose_1.default.Types.ObjectId(userCompanyId);
            }
            console.log('👤 SALES ROLE FILTERING - Showing own orders only');
        }
        // 3. Other company-scoped roles (Managers, Heads, Employees of Service/Accounts/Store/QC) see all orders in their company
        else {
            if (userCompanyId) {
                filter.companyId = new mongoose_1.default.Types.ObjectId(userCompanyId);
                console.log(`🏢 COMPANY SCOPED FILTERING FOR ROLE '${userRole}' - Showing all orders for company: ${userCompanyId}`);
            }
            else {
                // Fallback: If no company assigned, show all orders since they are not a Sales role and don't create orders
                console.log(`🏢 UNRESTRICTED ROLE '${userRole}' WITH NO COMPANY - Showing all orders`);
            }
        }
        if (search) {
            filter.$or = [
                { orderCode: { $regex: search, $options: 'i' } },
                { notes: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) {
            filter.status = status;
        }
        if (customerId) {
            filter.customer = customerId;
        }
        // Date filtering - support both single date and date range
        if (date) {
            // Single date filter
            const filterDate = new Date(date);
            filterDate.setUTCHours(0, 0, 0, 0);
            const nextDay = new Date(filterDate.getTime() + 24 * 60 * 60 * 1000);
            filter.orderDate = {
                $gte: filterDate,
                $lt: nextDay
            };
        }
        else if (startDate || endDate) {
            // Date range filter
            filter.orderDate = {};
            if (startDate) {
                filter.orderDate.$gte = new Date(startDate);
            }
            if (endDate) {
                filter.orderDate.$lte = new Date(endDate);
            }
        }
        // Build sort query
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
        console.log('Sort query:', sort, 'sortBy:', sortBy, 'sortOrder:', sortOrder);
        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        console.log('=== FINAL FILTER APPLIED ===');
        console.log('Filter object:', JSON.stringify(filter, null, 2));
        console.log('Pagination:', { page, limit, skip });
        // Get orders with population
        const orders = yield Order_js_1.default.find(filter)
            .populate('customer', 'name email mobile')
            .populate('products.product', 'name salePrice purchaseCost mrp brand category subCategory image')
            .populate('salesPerson', 'username fullName email role companyId')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));
        // Get total count for pagination
        const totalOrders = yield Order_js_1.default.countDocuments(filter);
        const totalPages = Math.ceil(totalOrders / parseInt(limit));
        console.log('=== QUERY RESULTS ===');
        console.log('Orders found:', orders.length);
        console.log('Total orders matching filter:', totalOrders);
        if (orders.length > 0) {
            console.log('Sample orders:');
            orders.slice(0, 3).forEach(order => {
                var _a, _b;
                console.log(`  Order ${order.orderCode}: Sales Person: ${((_a = order.salesPerson) === null || _a === void 0 ? void 0 : _a.username) || 'Unknown'} (ID: ${(_b = order.salesPerson) === null || _b === void 0 ? void 0 : _b._id})`);
            });
        }
        res.json({
            success: true,
            orders,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalOrders,
                hasNextPage: parseInt(page) < totalPages,
                hasPrevPage: parseInt(page) > 1
            }
        });
    }
    catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.getOrders = getOrders;
// Get single order by ID
const getOrderById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const order = yield Order_js_1.default.findById(id)
            .populate('customer', 'name email mobile address city state')
            .populate('products.product', 'name salePrice purchaseCost mrp brand category subCategory image');
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        res.json({
            success: true,
            order
        });
    }
    catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.getOrderById = getOrderById;
// Update order
const updateOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { customerId, orderDate, products, notes, status } = req.body;
        console.log('Update order request:', { id, body: req.body });
        const order = yield Order_js_1.default.findById(id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        // ============ CUTOFF TIME VALIDATION ============
        // Check if order editing is allowed based on cutoff time (only for Sales role)
        if (req.user.role === 'Sales' || req.user.role === 'sales') {
            console.log('🕐 Checking cutoff time for order edit by Sales user:', req.user.username, 'Company:', req.user.companyId);
            if (req.user.companyId) {
                try {
                    const orderPermission = yield CutoffTime_js_1.default.canPlaceOrder(req.user.companyId);
                    if (!orderPermission.allowed) {
                        console.log('❌ Order edit blocked by cutoff time:', orderPermission.message);
                        return res.status(403).json({
                            success: false,
                            message: `Order editing ${orderPermission.message.toLowerCase()}`,
                            cutoffTime: orderPermission.cutoffTime,
                            isPastCutoff: true
                        });
                    }
                    console.log('✅ Order edit allowed by cutoff time check:', orderPermission.message);
                }
                catch (cutoffError) {
                    console.error('Error checking cutoff time for order edit:', cutoffError);
                    // If cutoff time check fails, allow order editing (fail-safe approach)
                    console.log('⚠️ Cutoff time check failed, allowing order editing');
                }
            }
        }
        // Update basic fields
        if (customerId)
            order.customer = customerId;
        if (orderDate)
            order.orderDate = new Date(orderDate);
        if (notes !== undefined)
            order.notes = notes;
        if (status)
            order.status = status;
        // Update products if provided
        if (products && products.length > 0) {
            console.log('🔄 Updating products:', products);
            let totalAmount = 0;
            const orderProducts = [];
            for (const productItem of products) {
                console.log('🔍 Processing product:', productItem);
                const product = yield Inventory_js_1.Item.findById(productItem.productId);
                console.log('📦 Found product:', product ? { id: product._id, name: product.name, salePrice: product.salePrice } : 'Not found');
                if (product) {
                    const itemTotal = (product.salePrice || 0) * productItem.quantity;
                    totalAmount += itemTotal;
                    orderProducts.push({
                        product: productItem.productId,
                        quantity: productItem.quantity,
                        price: product.salePrice || 0,
                        total: itemTotal
                    });
                    console.log('✅ Added product to order:', {
                        productId: productItem.productId,
                        quantity: productItem.quantity,
                        price: product.salePrice || 0,
                        total: itemTotal
                    });
                }
                else {
                    console.log('⚠️ Product not found:', productItem.productId);
                }
            }
            console.log('💰 Total amount calculated:', totalAmount);
            console.log('📋 Order products array:', orderProducts);
            order.products = orderProducts;
            order.totalAmount = totalAmount;
            console.log('🔄 Updated order products count:', order.products.length);
        }
        console.log('💾 Saving updated order...');
        yield order.save();
        console.log('✅ Order saved successfully');
        // Populate the updated order
        console.log('🔍 Fetching updated order with populated data...');
        const updatedOrder = yield Order_js_1.default.findById(id)
            .populate('customer', 'name email mobile address city state')
            .populate('products.product', 'name salePrice purchaseCost mrp brand category subCategory image');
        console.log('📊 Final order data:', {
            id: updatedOrder._id,
            productsCount: ((_a = updatedOrder.products) === null || _a === void 0 ? void 0 : _a.length) || 0,
            totalAmount: updatedOrder.totalAmount
        });
        res.json({
            success: true,
            message: 'Order updated successfully',
            order: updatedOrder
        });
    }
    catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.updateOrder = updateOrder;
// Delete order
const deleteOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const order = yield Order_js_1.default.findById(id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        // Store order details before deletion for summary updates
        const orderProducts = order.products;
        const orderDate = order.orderDate;
        const companyId = order.companyId;
        // Delete the order
        yield Order_js_1.default.findByIdAndDelete(id);
        res.json({
            success: true,
            message: 'Order deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.deleteOrder = deleteOrder;
// Update order status only
const updateOrderStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;
        // Enhanced validation for Unit Manager workflow
        const validStatuses = ['pending', 'approved', 'rejected', 'in_production', 'completed', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Valid statuses are: ' + validStatuses.join(', ')
            });
        }
        const order = yield Order_js_1.default.findById(id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        // Role-based permissions for status updates
        const userRole = req.user.role;
        // Unit Manager and Superadmin can update any status
        if (userRole === 'Unit Manager' || userRole === 'Superadmin' || userRole === 'Super Admin' || userRole === 'Sale Head' || userRole === 'Sales Employee') {
            // Allow all status updates
        }
        // Sales can only update to Cancelled if pending
        // Sales can approve their own orders or cancel them if pending
        else if (userRole === 'Sales' || userRole === 'sales') {
            if (((_a = order.salesPerson) === null || _a === void 0 ? void 0 : _a.toString()) !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only update your own orders'
                });
            }
            const allowedSalesStatuses = ['cancelled', 'approved'];
            if (!allowedSalesStatuses.includes(status)) {
                return res.status(403).json({
                    success: false,
                    message: 'Sales can only approve or cancel orders'
                });
            }
            if (order.status !== 'pending') {
                return res.status(400).json({
                    success: false,
                    message: `Cannot change status from ${order.status} to ${status}`
                });
            }
        }
        // Other roles have limited permissions
        else {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to update order status'
            });
        }
        // Set context for status history (if schema supports it)
        if (order.statusHistory) {
            order._updatedBy = req.user._id;
            order._statusRemarks = remarks || '';
        }
        // Update fields based on status
        const oldStatus = order.status;
        order.status = status;
        if (status === 'approved') {
            order.approvedBy = req.user._id;
            order.approvedAt = new Date();
            // If approved by Sales, mark as approved (Manual Invoice Generation will happen in Accounts)
            if (userRole === 'Sales' || userRole === 'sales') {
                order.status = 'approved';
                order.statusHistory.push({
                    status: 'approved',
                    updatedBy: req.user._id,
                    updatedAt: new Date(),
                    remarks: 'Order approved by Sales person. Pending invoice generation.'
                });
                yield order.save();
                console.log(`✅ Order ${order.orderCode} approved by Sales. Pending manual invoicing.`);
            }
        }
        else if (status === 'rejected') {
            order.rejectionReason = remarks;
        }
        else if (status === 'in_production') {
            order.productionStartDate = new Date();
        }
        else if (status === 'completed') {
            order.productionEndDate = new Date();
            if (!order.actualDeliveryDate) {
                order.actualDeliveryDate = new Date();
            }
        }
        yield order.save();
        // Populate the updated order
        const updatedOrder = yield Order_js_1.default.findById(id)
            .populate('customer', 'name email mobile address city state')
            .populate('products.product', 'name price brand image')
            .populate('salesPerson', 'username fullName email')
            .populate('approvedBy', 'username fullName');
        res.json({
            success: true,
            message: `Order status updated from ${oldStatus} to ${status}`,
            order: updatedOrder
        });
    }
    catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.updateOrderStatus = updateOrderStatus;
// Check if order exists for sales person + customer + date
const checkExistingOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { salesPersonId, customerId, orderDate } = req.query;
        console.log('🔍 Checking for existing order:', { salesPersonId, customerId, orderDate });
        if (!salesPersonId || !customerId || !orderDate) {
            return res.status(400).json({
                success: false,
                message: 'Sales person, customer, and order date are required'
            });
        }
        // Parse the order date
        const targetDate = new Date(orderDate);
        const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
        // Check if an order exists
        const existingOrder = yield Order_js_1.default.findOne({
            salesPerson: salesPersonId,
            customer: customerId,
            orderDate: {
                $gte: startOfDay,
                $lte: endOfDay
            },
            companyId: req.user.companyId
        }).lean();
        console.log('🔍 Existing order found:', existingOrder ? 'YES' : 'NO');
        res.json({
            success: true,
            data: {
                exists: !!existingOrder,
                orderId: existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder._id,
                orderCode: existingOrder === null || existingOrder === void 0 ? void 0 : existingOrder.orderCode
            }
        });
    }
    catch (error) {
        console.error('Error checking existing order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check existing order',
            error: error.message
        });
    }
});
exports.checkExistingOrder = checkExistingOrder;
// 🔄 NEW: Service Team Verification for Lead-to-Order Flow
const verifyServiceOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, remarks, callRecordingUrl, isFakeCommitmentChecked } = req.body;
        console.log(`🔍 Service Verification - Order: ${id}, Status: ${status}`);
        const order = yield Order_js_1.default.findById(id).populate('customer').populate('leadId');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        // Update service verification
        order.serviceVerification = {
            status: status || 'verified',
            verifiedBy: req.user._id,
            verifiedAt: new Date(),
            callRecordingUrl,
            isFakeCommitmentChecked,
            remarks
        };
        // Update status history
        order.statusHistory.push({
            status: `service_${status || 'verified'}`,
            updatedBy: req.user._id,
            updatedAt: new Date(),
            remarks: `Service Verification: ${remarks || 'No remarks'}`
        });
        if (status === 'verified' || status === 'Confirm') {
            // ✅ VERIFIED: Move to Store for product type selection
            order.status = 'pending'; // Now visible to Store
            console.log(`✅ Order ${order.orderCode} verified by Service - Moving to Store`);
        }
        else {
            // ❌ REJECTED: Mark as rejected by service
            order.status = 'rejected_by_service';
            console.log(`❌ Order ${order.orderCode} rejected by Service`);
        }
        yield order.save();
        // 📋 Update Lead status if this order came from a lead
        if (order.leadId) {
            const Lead = (yield Promise.resolve().then(() => __importStar(require('../models/Lead.js')))).default;
            const lead = yield Lead.findById(order.leadId);
            if (lead) {
                if (status === 'verified' || status === 'Confirm') {
                    lead.status = 'Service Verified';
                }
                else {
                    lead.status = 'Service Rejected';
                }
                lead.history.push({
                    action: 'Service Verification',
                    notes: `Order ${order.orderCode} ${status === 'verified' ? 'verified' : 'rejected'} by Service Team. ${remarks || ''}`,
                    performedBy: req.user._id
                });
                yield lead.save();
                console.log(`📋 Lead ${lead.leadCode} status updated to: ${lead.status}`);
            }
        }
        res.json({
            success: true,
            message: `Order ${status === 'verified' ? 'verified' : 'rejected'} successfully`,
            order
        });
    }
    catch (error) {
        console.error('❌ Service verification error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.verifyServiceOrder = verifyServiceOrder;
// Accounts Approval & Payment Confirmation
const approveAccountOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, remarks, paymentMode, referenceNo, amount } = req.body;
        const order = yield Order_js_1.default.findById(id).populate('customer');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        if (order.serviceVerification.status !== 'verified') {
            return res.status(400).json({
                success: false,
                message: 'Order must be verified by Service Team before Account Approval'
            });
        }
        order.accountApproval = {
            status: status || 'approved',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            remarks
        };
        if (status === 'approved') {
            order.paymentStatus = 'Paid';
            order.status = 'approved'; // Final approval for production
            // Automatically create a CustomerPayment entry
            const CustomerPayment = (yield Promise.resolve().then(() => __importStar(require('../models/CustomerPayment.js')))).default;
            const payment = new CustomerPayment({
                customer: order.customer._id,
                amount: amount || order.totalAmount,
                paymentMode: paymentMode || 'Bank Transfer',
                referenceNo: referenceNo || 'DIRECT-ORDER-APPV',
                unit: order.unit,
                companyId: order.companyId,
                createdBy: req.user._id,
                notes: `Auto-generated from Order Approval: ${order.orderCode}. ${remarks || ''}`
            });
            yield payment.save();
        }
        order.statusHistory.push({
            status: `account_${status || 'approved'}`,
            updatedBy: req.user._id,
            updatedAt: new Date(),
            remarks: `Accounts Approval: ${remarks || 'No remarks'}`
        });
        yield order.save();
        res.json({
            success: true,
            message: 'Accounts approval updated successfully',
            order
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.approveAccountOrder = approveAccountOrder;
// Add Payment Evidence (Slip/Cheque)
const addPaymentEvidence = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { fileUrl, fileType } = req.body;
        const order = yield Order_js_1.default.findById(id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        order.paymentEvidence.push({
            fileUrl,
            fileType,
            uploadedBy: req.user._id,
            uploadedAt: new Date()
        });
        yield order.save();
        res.json({
            success: true,
            message: 'Payment evidence added successfully',
            order
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.addPaymentEvidence = addPaymentEvidence;
// Get orders with tracking info (Orders that have invoices)
const getOrderTracking = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const userCompanyId = req.user.companyId;
        const userRole = req.user.role;
        let query = {};
        // Only Superadmin/Super Admin sees all companies.
        if (userRole !== 'Superadmin' && userRole !== 'Super Admin') {
            if (!userCompanyId) {
                return res.status(400).json({ success: false, message: 'User company not configured.' });
            }
            query.companyId = userCompanyId;
        }
        console.log(`🔍 Order Tracking: Fetching for role ${userRole}, Company: ${userCompanyId}`);
        // 1. Fetch Sale-based records (approved/invoiced orders)
        const sales = yield Sale_js_1.default.find(query)
            .populate('order')
            .populate('customer', 'name mobile outstandingAmount')
            .lean();
        const saleOrderIds = new Set(sales.map(s => { var _a, _b; return (_b = (_a = s.order) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString(); }).filter(Boolean));
        const saleTrackingData = sales.map(sale => {
            var _a, _b, _c;
            const order = sale.order || {};
            return {
                _id: sale._id,
                orderId: order._id || null,
                orderCode: order.orderCode || 'Direct Invoice',
                orderDate: order.orderDate || sale.saleDate || new Date(),
                customerName: ((_a = sale.customer) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Customer',
                customerMobile: ((_b = sale.customer) === null || _b === void 0 ? void 0 : _b.mobile) || 'N/A',
                customerOutstanding: ((_c = sale.customer) === null || _c === void 0 ? void 0 : _c.outstandingAmount) || 0,
                invoiceNumber: sale.invoiceNumber || 'N/A',
                invoiceType: sale.invoiceType || 'Pakka',
                totalAmount: sale.totalAmount || 0,
                paidAmount: sale.paidAmount || 0,
                balanceAmount: sale.balanceAmount || 0,
                paymentStatus: sale.paymentStatus || 'Pending',
                saleDate: sale.saleDate || new Date(),
                gatePass: sale.gatePass || { status: 'Pending' },
                productType: sale.productType || null,
                isAvailableInInventory: sale.isAvailableInInventory || null,
                orderStatus: order.status || 'pending',
                source: 'sale'
            };
        });
        // 🔄 NEW: Also fetch Orders with status='pending_service_approval' (from Lead-to-Order flow)
        // and 'pending' (service verified) that have NO Sale yet
        const orderQuery = Object.assign(Object.assign({}, query), { status: { $in: ['pending_service_approval', 'pending'] } });
        const pendingOrders = yield Order_js_1.default.find(orderQuery)
            .populate('customer', 'name mobile outstandingAmount')
            .populate('leadId', 'leadCode dealValue') // 📋 NEW: Include lead reference
            .lean();
        const pendingOrderTrackingData = [];
        for (const order of pendingOrders.filter(order => !saleOrderIds.has(order._id.toString()))) {
            // Check if this order has a Sale record (could be auto-created)
            const orderSale = yield Sale_js_1.default.findOne({ order: order._id }).lean();
            const trackingItem = {
                _id: order._id,
                orderId: order._id,
                orderCode: order.orderCode || 'N/A',
                orderDate: order.orderDate || order.createdAt || new Date(),
                customerName: ((_a = order.customer) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Customer',
                customerMobile: ((_b = order.customer) === null || _b === void 0 ? void 0 : _b.mobile) || 'N/A',
                customerOutstanding: ((_c = order.customer) === null || _c === void 0 ? void 0 : _c.outstandingAmount) || 0,
                invoiceNumber: (orderSale === null || orderSale === void 0 ? void 0 : orderSale.invoiceNumber) || 'Pending',
                invoiceType: (orderSale === null || orderSale === void 0 ? void 0 : orderSale.invoiceType) || 'N/A',
                totalAmount: order.totalAmount || 0,
                paidAmount: 0,
                balanceAmount: order.totalAmount || 0,
                paymentStatus: order.paymentStatus || 'Pending',
                saleDate: order.createdAt || new Date(),
                gatePass: { status: 'Pending' },
                productType: (orderSale === null || orderSale === void 0 ? void 0 : orderSale.productType) || null,
                isAvailableInInventory: (orderSale === null || orderSale === void 0 ? void 0 : orderSale.isAvailableInInventory) || null,
                orderStatus: order.status, // 🔄 NEW: Include actual status (pending_service_approval/pending)
                serviceVerification: order.serviceVerification || { status: 'pending' }, // 🔄 NEW: Service verification info
                leadId: ((_d = order.leadId) === null || _d === void 0 ? void 0 : _d._id) || null, // 📋 NEW: Lead reference
                leadCode: ((_e = order.leadId) === null || _e === void 0 ? void 0 : _e.leadCode) || null, // 📋 NEW: Lead code
                dealValue: ((_f = order.leadId) === null || _f === void 0 ? void 0 : _f.dealValue) || order.totalAmount, // 📋 NEW: Deal value from lead
                source: 'order'
            };
            pendingOrderTrackingData.push(trackingItem);
        }
        const trackingData = [...saleTrackingData, ...pendingOrderTrackingData];
        console.log(`📊 Order Tracking: Found ${trackingData.length} records (${saleTrackingData.length} from Sales, ${pendingOrderTrackingData.length} pending orders) for company ${userCompanyId}`);
        res.json({
            success: true,
            data: trackingData
        });
    }
    catch (error) {
        console.error('❌ Error in getOrderTracking:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching order tracking data',
            error: error.message
        });
    }
});
exports.getOrderTracking = getOrderTracking;
// Generate Gate Pass for a Sale
const generateGatePass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { saleId } = req.params;
        const { vehicleNumber, driverName, contactNumber } = req.body;
        const sale = yield Sale_js_1.default.findById(saleId).populate('order').populate('customer');
        if (!sale) {
            return res.status(404).json({ success: false, message: 'Sale record not found' });
        }
        // Only enforce NOC check for new orders (old orders won't have nocStatus set)
        if (((_a = sale.gatePass) === null || _a === void 0 ? void 0 : _a.nocStatus) === 'Pending') {
            return res.status(400).json({ success: false, message: 'NOC must be approved by Accounts before generating a Gate Pass.' });
        }
        // Generate Gate Pass Number
        const count = yield Sale_js_1.default.countDocuments({ 'gatePass.status': 'Generated' });
        const gatePassNumber = `GP-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
        sale.gatePass = Object.assign(Object.assign({}, sale.gatePass), { gatePassNumber, generatedAt: new Date(), generatedBy: req.user._id, status: 'Generated', vehicleNumber: vehicleNumber || 'N/A', driverName: driverName || 'N/A', contactNumber: contactNumber || 'N/A' });
        yield sale.save();
        res.json({
            success: true,
            message: 'Gate Pass generated successfully',
            gatePass: sale.gatePass
        });
    }
    catch (error) {
        console.error('Error generating gate pass:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.generateGatePass = generateGatePass;
// Update Store Info for an Order (when no Sale exists yet)
const updateOrderStoreInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { orderId } = req.params;
        const { productType, isAvailableInInventory } = req.body;
        console.log(`🏪 Store Info Update - Order ID: ${orderId}, ProductType: ${productType}, Available: ${isAvailableInInventory}`);
        const order = yield Order_js_1.default.findById(orderId).populate('customer').populate('products.product');
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        // 🔄 NEW UNIFIED FLOW: Check if Sale exists, if not create temp Sale for consistency
        let sale = yield Sale_js_1.default.findOne({ order: orderId });
        let isNewSale = false;
        if (!sale) {
            // Create a temporary Sale record to maintain workflow consistency
            const invoiceNumber = `TEMP-${order.orderCode}-${Date.now()}`;
            // Convert order products to sale items format
            const saleItems = order.products.map(product => {
                var _a;
                return ({
                    productName: ((_a = product.product) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Product',
                    quantity: product.quantity,
                    unitPrice: product.price,
                    totalPrice: product.total,
                    tax: 0
                });
            });
            sale = new Sale_js_1.default({
                invoiceNumber,
                order: order._id,
                customer: order.customer._id,
                items: saleItems,
                subtotal: order.totalAmount,
                taxAmount: 0,
                totalAmount: order.totalAmount,
                dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
                unit: order.unit,
                companyId: order.companyId || req.user.companyId, // Ensure company ID is set
                createdBy: req.user._id,
                notes: `Auto-created from Order ${order.orderCode} for store management`,
                invoiceType: 'Kachha', // Temporary invoice
                paymentStatus: 'Pending' // Will be updated when accounts approve
            });
            yield sale.save();
            isNewSale = true;
            console.log(`📋 Created temporary Sale record ${sale._id} for Order ${orderId}`);
        }
        else {
            console.log(`📋 Using existing Sale record ${sale._id} for Order ${orderId}`);
            // Check if we need to fix "Unknown Product" in existing sale items
            const hasUnknown = sale.items && sale.items.some(item => item.productName === 'Unknown Product');
            if (hasUnknown && order.products && order.products.length > 0) {
                console.log(`🛠️ Fixing "Unknown Product" in existing Sale items for Order ${orderId}`);
                sale.items = order.products.map(product => {
                    var _a;
                    return ({
                        productName: ((_a = product.product) === null || _a === void 0 ? void 0 : _a.name) || 'Unknown Product',
                        quantity: product.quantity,
                        unitPrice: product.price,
                        totalPrice: product.total,
                        tax: 0
                    });
                });
                yield sale.save();
            }
        }
        // 🔄 UPDATE STORE INFO: Same validation as existing flow
        if (productType !== undefined) {
            if (productType === '' || productType === null) {
                sale.productType = null;
            }
            else {
                const validTypes = ['In-house Manufactured', 'Purchased (Trading Product)'];
                if (!validTypes.includes(productType)) {
                    return res.status(400).json({ success: false, message: 'Invalid product type' });
                }
                sale.productType = productType;
            }
        }
        if (isAvailableInInventory !== undefined) {
            if (isAvailableInInventory === '' || isAvailableInInventory === null) {
                sale.isAvailableInInventory = null;
            }
            else {
                const validAvailability = ['Available', 'Not Available'];
                if (!validAvailability.includes(isAvailableInInventory)) {
                    return res.status(400).json({ success: false, message: 'Invalid inventory status' });
                }
                sale.isAvailableInInventory = isAvailableInInventory;
            }
        }
        // 🚀 UNIFIED AUTOMATION: Same logic as existing updateSaleStoreInfo function
        const orderCode = order.orderCode;
        const sourceRefId = sale.invoiceNumber || sale._id.toString();
        console.log(`🔄 Applying automation for ${orderCode} - ProductType: ${sale.productType}, Available: ${sale.isAvailableInInventory}`);
        // CASE 1: Available -> Create QC Job & Cleanup Pending Production/Purchase
        if (sale.isAvailableInInventory === 'Available') {
            try {
                yield ProductionOrder_js_1.default.deleteMany({
                    company: sale.companyId,
                    notes: new RegExp(sourceRefId),
                    status: 'Pending'
                });
                yield PurchaseRequest_js_1.default.deleteMany({
                    companyId: sale.companyId,
                    itemId: sourceRefId,
                    status: 'Pending'
                });
                const existingQC = yield QCJob_js_1.default.findOne({
                    source: 'Store',
                    sourceRefId: sourceRefId,
                    company: sale.companyId
                });
                if (!existingQC) {
                    const qcJobId = yield generateQCJobId();
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const itemName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    yield QCJob_js_1.default.create({
                        qcJobId,
                        source: 'Store',
                        sourceRefId: sourceRefId,
                        sourceDepartment: 'Store',
                        sentBy: req.user.fullName || req.user.username || 'Store Dept',
                        itemName: itemName,
                        itemCode: orderCode,
                        category: 'Finished Good',
                        quantity: ((_a = sale.items) === null || _a === void 0 ? void 0 : _a.reduce((acc, item) => acc + (item.quantity || 0), 0)) || 1,
                        unit: 'pcs',
                        receivedDate: today(),
                        status: 'Pending',
                        company: sale.companyId,
                        createdBy: req.user._id,
                        notes: `Automatically created from Store Order ${orderCode}`
                    });
                    console.log(`✅ QC Job ${qcJobId} created for Order ${orderId}`);
                }
            }
            catch (qcError) {
                console.error('❌ Error in Available case automation:', qcError);
            }
        }
        // CASE 2: Not Available & In-house Manufactured -> Create Production Order
        if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'In-house Manufactured') {
            try {
                yield QCJob_js_1.default.deleteMany({
                    company: sale.companyId,
                    sourceRefId: sourceRefId,
                    status: 'Pending'
                });
                yield PurchaseRequest_js_1.default.deleteMany({
                    companyId: sale.companyId,
                    itemId: sourceRefId,
                    status: 'Pending'
                });
                const existingProduction = yield ProductionOrder_js_1.default.findOne({
                    company: sale.companyId,
                    notes: new RegExp(sourceRefId)
                });
                if (!existingProduction) {
                    const year = new Date().getFullYear();
                    const timestamp = Date.now().toString().slice(-6);
                    const prodOrderId = `PROD-${year}-${timestamp}`;
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const machineName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    yield ProductionOrder_js_1.default.create({
                        orderId: prodOrderId,
                        machineCode: orderCode,
                        machineName: machineName,
                        priority: order.priority === 'High' ? 'Urgent' : 'Normal',
                        receivedDate: today(),
                        deliveryDate: today(),
                        status: 'Pending',
                        company: sale.companyId,
                        createdBy: req.user._id,
                        notes: `Automatically triggered from Store - Product Not Available in Inventory. Ref: ${sourceRefId}`
                    });
                    console.log(`✅ Production Order ${prodOrderId} created for Order ${orderId}`);
                }
            }
            catch (prodError) {
                console.error('❌ Error in In-house case automation:', prodError);
            }
        }
        // CASE 3: Not Available & Purchased (Trading Product) -> Create Purchase Request
        if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'Purchased (Trading Product)') {
            try {
                yield QCJob_js_1.default.deleteMany({
                    company: sale.companyId,
                    sourceRefId: sourceRefId,
                    status: 'Pending'
                });
                yield ProductionOrder_js_1.default.deleteMany({
                    company: sale.companyId,
                    notes: new RegExp(sourceRefId),
                    status: 'Pending'
                });
                const existingPurchaseReq = yield PurchaseRequest_js_1.default.findOne({
                    companyId: sale.companyId,
                    itemId: sourceRefId
                });
                if (!existingPurchaseReq) {
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const productName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    const count = yield PurchaseRequest_js_1.default.countDocuments({});
                    const requestId = `PR${String(count + 1).padStart(3, '0')}`;
                    yield PurchaseRequest_js_1.default.create({
                        requestId,
                        productName,
                        quantity: ((_b = sale.items) === null || _b === void 0 ? void 0 : _b.reduce((acc, item) => acc + (item.quantity || 0), 0)) || 1,
                        requestFromDepartment: 'Store',
                        priority: order.priority || 'Medium',
                        companyId: sale.companyId,
                        storeOrderId: order._id,
                        itemId: sourceRefId
                    });
                    console.log(`✅ Purchase Request ${requestId} created for Order ${orderId}`);
                }
            }
            catch (purchaseError) {
                console.error('❌ Error in Purchased case automation:', purchaseError);
            }
        }
        yield sale.save();
        // 📊 RESPONSE: Include flow information for frontend
        const response = {
            success: true,
            message: 'Store information updated successfully',
            data: {
                orderId: order._id,
                orderCode: order.orderCode,
                saleId: sale._id,
                invoiceNumber: sale.invoiceNumber,
                productType: sale.productType,
                isAvailableInInventory: sale.isAvailableInInventory,
                isNewSale: isNewSale,
                flowStatus: 'store_completed'
            }
        };
        console.log(`✅ Store Info Updated - Order: ${orderCode}, Sale: ${sale.invoiceNumber}, Flow: ${isNewSale ? 'New' : 'Existing'}`);
        res.json(response);
    }
    catch (error) {
        console.error('Error updating order store info:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.updateOrderStoreInfo = updateOrderStoreInfo;
// Update Store Info for a Sale (Product Type & Inventory Availability) - Legacy function
const updateSaleStoreInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const { saleId } = req.params;
        const { productType, isAvailableInInventory } = req.body;
        const sale = yield Sale_js_1.default.findById(saleId).populate('order');
        if (!sale) {
            return res.status(404).json({ success: false, message: 'Sale not found' });
        }
        if (productType !== undefined) {
            if (productType === '' || productType === null) {
                sale.productType = null;
            }
            else {
                const validTypes = ['In-house Manufactured', 'Purchased (Trading Product)'];
                if (!validTypes.includes(productType)) {
                    return res.status(400).json({ success: false, message: 'Invalid product type' });
                }
                sale.productType = productType;
            }
        }
        if (isAvailableInInventory !== undefined) {
            if (isAvailableInInventory === '' || isAvailableInInventory === null) {
                sale.isAvailableInInventory = null;
            }
            else {
                const validAvailability = ['Available', 'Not Available'];
                if (!validAvailability.includes(isAvailableInInventory)) {
                    return res.status(400).json({ success: false, message: 'Invalid inventory status' });
                }
                sale.isAvailableInInventory = isAvailableInInventory;
            }
        }
        // --- AUTOMATION LOGIC WITH CLEANUP ---
        // CASE 1: Available -> Create QC Job & Cleanup Pending Production/Purchase
        if (sale.isAvailableInInventory === 'Available') {
            try {
                const orderCode = ((_a = sale.order) === null || _a === void 0 ? void 0 : _a.orderCode) || 'N/A';
                const sourceRefId = sale.invoiceNumber || sale._id.toString();
                // 1. Cleanup existing Pending Production Orders or Purchase Requests
                yield ProductionOrder_js_1.default.deleteMany({
                    company: sale.companyId,
                    notes: new RegExp(sourceRefId),
                    status: 'Pending'
                });
                yield PurchaseRequest_js_1.default.deleteMany({
                    companyId: sale.companyId,
                    itemId: sourceRefId,
                    status: 'Pending'
                });
                // 2. Create QC Job
                const existingQC = yield QCJob_js_1.default.findOne({
                    source: 'Store',
                    sourceRefId: sourceRefId,
                    company: sale.companyId
                });
                if (!existingQC) {
                    const qcJobId = yield generateQCJobId();
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const itemName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    yield QCJob_js_1.default.create({
                        qcJobId,
                        source: 'Store',
                        sourceRefId: sourceRefId,
                        sourceDepartment: 'Store',
                        sentBy: req.user.fullName || req.user.username || 'Store Dept',
                        itemName: itemName,
                        itemCode: orderCode,
                        category: 'Finished Good',
                        quantity: ((_b = sale.items) === null || _b === void 0 ? void 0 : _b.reduce((acc, item) => acc + (item.quantity || 0), 0)) || 1,
                        unit: 'pcs',
                        receivedDate: today(),
                        status: 'Pending',
                        company: sale.companyId,
                        createdBy: req.user._id,
                        notes: `Automatically created from Store Order ${orderCode}`
                    });
                    console.log(`✅ QC Job ${qcJobId} created and Production/Purchase cleaned up for Sale ${saleId}`);
                }
            }
            catch (qcError) {
                console.error('❌ Error in Available case automation:', qcError);
            }
        }
        // CASE 2: Not Available & In-house Manufactured -> Create Production Order & Cleanup Pending QC/Purchase
        if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'In-house Manufactured') {
            try {
                const orderCode = ((_c = sale.order) === null || _c === void 0 ? void 0 : _c.orderCode) || 'N/A';
                const sourceRefId = sale.invoiceNumber || sale._id.toString();
                console.log(`🏭 Triggering Production for ${orderCode} & cleaning up other workflows...`);
                // 1. Cleanup existing Pending QC Jobs or Purchase Requests
                yield QCJob_js_1.default.deleteMany({
                    company: sale.companyId,
                    sourceRefId: sourceRefId,
                    status: 'Pending'
                });
                yield PurchaseRequest_js_1.default.deleteMany({
                    companyId: sale.companyId,
                    itemId: sourceRefId,
                    status: 'Pending'
                });
                // 2. Create Production Order
                const existingProduction = yield ProductionOrder_js_1.default.findOne({
                    company: sale.companyId,
                    notes: new RegExp(sourceRefId)
                });
                if (!existingProduction) {
                    const year = new Date().getFullYear();
                    const timestamp = Date.now().toString().slice(-6);
                    const prodOrderId = `PROD-${year}-${timestamp}`;
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const machineName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    yield ProductionOrder_js_1.default.create({
                        orderId: prodOrderId,
                        machineCode: orderCode,
                        machineName: machineName,
                        priority: ((_d = sale.order) === null || _d === void 0 ? void 0 : _d.priority) === 'High' ? 'Urgent' : 'Normal',
                        receivedDate: today(),
                        deliveryDate: sale.dueDate ? sale.dueDate.toISOString().split('T')[0] : today(),
                        status: 'Pending',
                        company: sale.companyId,
                        createdBy: req.user._id,
                        notes: `Automatically triggered from Store - Product Not Available in Inventory. Ref: ${sourceRefId}`
                    });
                    console.log(`✅ Production Order ${prodOrderId} created successfully for Sale ${saleId}`);
                }
            }
            catch (prodError) {
                console.error('❌ Error in In-house case automation:', prodError);
            }
        }
        // CASE 3: Not Available & Purchased (Trading Product) -> Create Purchase Request & Cleanup Pending QC/Production
        if (sale.isAvailableInInventory === 'Not Available' && sale.productType === 'Purchased (Trading Product)') {
            try {
                const orderCode = ((_e = sale.order) === null || _e === void 0 ? void 0 : _e.orderCode) || 'N/A';
                const sourceRefId = sale.invoiceNumber || sale._id.toString();
                console.log(`🛒 Triggering Purchase Request for ${orderCode} & cleaning up other workflows...`);
                // 1. Cleanup existing Pending QC Jobs or Production Orders
                yield QCJob_js_1.default.deleteMany({
                    company: sale.companyId,
                    sourceRefId: sourceRefId,
                    status: 'Pending'
                });
                yield ProductionOrder_js_1.default.deleteMany({
                    company: sale.companyId,
                    notes: new RegExp(sourceRefId),
                    status: 'Pending'
                });
                // 2. Create Purchase Request
                const existingPurchaseReq = yield PurchaseRequest_js_1.default.findOne({
                    companyId: sale.companyId,
                    itemId: sourceRefId
                });
                if (!existingPurchaseReq) {
                    const firstItem = sale.items && sale.items.length > 0 ? sale.items[0].productName : 'Order Items';
                    const productName = sale.items && sale.items.length > 1 ? `${firstItem} + ${sale.items.length - 1} more` : firstItem;
                    const count = yield PurchaseRequest_js_1.default.countDocuments({});
                    const requestId = `PR${String(count + 1).padStart(3, '0')}`;
                    yield PurchaseRequest_js_1.default.create({
                        requestId,
                        productName,
                        quantity: ((_f = sale.items) === null || _f === void 0 ? void 0 : _f.reduce((acc, item) => acc + (item.quantity || 0), 0)) || 1,
                        requestFromDepartment: 'Store',
                        priority: ((_g = sale.order) === null || _g === void 0 ? void 0 : _g.priority) || 'Medium',
                        companyId: sale.companyId,
                        storeOrderId: ((_h = sale.order) === null || _h === void 0 ? void 0 : _h._id) || sale._id,
                        itemId: sourceRefId
                    });
                    console.log(`✅ Purchase Request ${requestId} created successfully for Sale ${saleId}`);
                }
            }
            catch (purchaseError) {
                console.error('❌ Error in Purchased case automation:', purchaseError);
            }
        }
        yield sale.save();
        res.json({
            success: true,
            message: 'Store information updated successfully',
            productType: sale.productType,
            isAvailableInInventory: sale.isAvailableInInventory
        });
    }
    catch (error) {
        console.error('Error updating store info:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.updateSaleStoreInfo = updateSaleStoreInfo;
// Approve Sale Order from Accounts Sales Tracking
const approveSaleOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { saleId } = req.params;
        const sale = yield Sale_js_1.default.findById(saleId).populate('order');
        if (!sale) {
            return res.status(404).json({ success: false, message: 'Sale not found' });
        }
        if (sale.order) {
            const order = yield Order_js_1.default.findById(sale.order._id);
            if (order) {
                order.status = 'approved';
                if (order.statusHistory) {
                    order.statusHistory.push({
                        status: 'approved',
                        updatedBy: req.user._id,
                        updatedAt: new Date(),
                        remarks: 'Approved from Sales Tracking'
                    });
                }
                yield order.save();
            }
        }
        res.json({ success: true, message: 'Order approved successfully and sent to Store' });
    }
    catch (error) {
        console.error('Error in approveSaleOrder:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.approveSaleOrder = approveSaleOrder;
// Get NOC Requests
const getNOCRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
        const PackagingJob = (yield Promise.resolve().then(() => __importStar(require('../models/PackagingJob.js')))).default;
        const LeadPayment = (yield Promise.resolve().then(() => __importStar(require('../models/LeadPayment.js')))).default;
        // Find all sales with populated orders
        const sales = yield Sale.find({ companyId: req.user.companyId })
            .populate({
            path: 'order',
            populate: { path: 'customer' }
        })
            .sort({ createdAt: -1 });
        const nocRequests = [];
        // Check if there is a Packed job for the sale's order
        for (const sale of sales) {
            if (sale.order && sale.gatePass && sale.gatePass.status === 'Pending') {
                const job = yield PackagingJob.findOne({
                    orderId: sale.order.orderCode,
                    status: 'Packed',
                    company: req.user.companyId
                });
                if (job) {
                    // Fetch advanced payment from linked lead (if any)
                    let advancedPaymentAmount = sale.advancedPaymentAmount || 0;
                    if (!advancedPaymentAmount && sale.order.leadId) {
                        const leadPayments = yield LeadPayment.find({
                            leadId: sale.order.leadId,
                            status: 'Verified',
                            companyId: req.user.companyId
                        }).select('amount').lean();
                        advancedPaymentAmount = leadPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
                    }
                    const effectivePaidAmount = (sale.paidAmount || 0) + advancedPaymentAmount;
                    const effectiveBalance = Math.max(0, sale.totalAmount - effectivePaidAmount);
                    let effectivePaymentStatus = sale.paymentStatus;
                    if (advancedPaymentAmount > 0 && effectiveBalance <= 0) {
                        effectivePaymentStatus = 'Paid';
                    }
                    else if (advancedPaymentAmount > 0 && effectivePaidAmount > 0) {
                        effectivePaymentStatus = 'Partially Paid';
                    }
                    nocRequests.push({
                        saleId: sale._id,
                        orderId: sale.order._id,
                        orderCode: sale.order.orderCode,
                        customerName: ((_a = sale.order.customer) === null || _a === void 0 ? void 0 : _a.name) || 'N/A',
                        customerMobile: ((_b = sale.order.customer) === null || _b === void 0 ? void 0 : _b.mobile) || 'N/A',
                        totalAmount: sale.totalAmount,
                        paidAmount: effectivePaidAmount,
                        advancedPaymentAmount,
                        balanceAmount: effectiveBalance,
                        paymentStatus: effectivePaymentStatus,
                        nocStatus: ((_c = sale.gatePass) === null || _c === void 0 ? void 0 : _c.nocStatus) || 'Pending',
                        gatePassStatus: ((_d = sale.gatePass) === null || _d === void 0 ? void 0 : _d.status) || 'Pending',
                        machineName: job.machineName,
                        machineCode: job.machineCode,
                        serialNumber: job.serialNumber
                    });
                }
            }
        }
        res.json({ success: true, data: nocRequests });
    }
    catch (error) {
        console.error('Error in getNOCRequests:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getNOCRequests = getNOCRequests;
// Approve NOC
const approveNOC = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { saleId } = req.params;
        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
        const sale = yield Sale.findById(saleId);
        if (!sale)
            return res.status(404).json({ success: false, message: 'Sale not found' });
        sale.gatePass = sale.gatePass || {};
        sale.gatePass.nocStatus = 'Approved';
        yield sale.save();
        res.json({ success: true, message: 'NOC Approved successfully' });
    }
    catch (error) {
        console.error('Error in approveNOC:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.approveNOC = approveNOC;
