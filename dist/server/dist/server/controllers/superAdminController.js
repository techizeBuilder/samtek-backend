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
exports.getSuperAdminDispatchById = exports.getSuperAdminDispatches = exports.getSuperAdminCustomerById = exports.getSuperAdminCustomers = exports.getSalesPersonById = exports.getSuperAdminSales = exports.getSuperAdminOrderById = exports.getSuperAdminOrders = exports.getSystemModules = exports.getRoles = exports.updateUserRole = exports.getAllUsers = exports.getSuperAdminDashboard = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const Order_js_1 = __importDefault(require("../models/Order.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const Company_js_1 = require("../models/Company.js");
// Super Admin Dashboard
const getSuperAdminDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        console.log('🔍 Fetching Super Admin dashboard data...');
        // Get basic counts with proper error handling
        const [totalUsers, totalOrders, totalCustomers, totalItems, totalRevenue, recentOrders, recentCustomers, recentSalesPersons, companies] = yield Promise.all([
            // Simple counts instead of complex aggregations
            User_js_1.default.countDocuments(),
            Order_js_1.default.countDocuments(),
            Customer_js_1.default.countDocuments(),
            Inventory_js_1.Item.countDocuments(),
            Order_js_1.default.aggregate([
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]).then(result => { var _a; return ((_a = result[0]) === null || _a === void 0 ? void 0 : _a.total) || 0; }),
            // Recent Orders
            Order_js_1.default.find()
                .populate('customer', 'name contactPerson')
                .populate('salesPerson', 'fullName username')
                .populate('companyId', 'name city')
                .sort({ createdAt: -1 })
                .limit(10)
                .select('orderCode totalAmount status createdAt customer salesPerson companyId')
                .lean(),
            // Recent Customers
            Customer_js_1.default.find()
                .populate('companyId', 'name city')
                .populate('salesContact', 'fullName username')
                .sort({ createdAt: -1 })
                .limit(10)
                .select('name contactPerson email mobile city active createdAt companyId salesContact')
                .lean(),
            // Recent Sales Persons
            User_js_1.default.find({ role: 'Sales' })
                .populate('companyId', 'name city')
                .sort({ createdAt: -1 })
                .limit(10)
                .select('fullName username email role companyId createdAt')
                .lean(),
            // Companies list
            Company_js_1.Company.find()
                .sort({ createdAt: -1 })
                .select('name city address mobile email createdAt')
                .lean()
        ]);
        // Safe data processing
        const overview = {
            totalOrders: totalOrders || 0,
            totalRevenue: totalRevenue || 0,
            totalUsers: totalUsers || 0,
            totalCustomers: totalCustomers || 0,
            totalItems: totalItems || 0,
            totalCompanies: (companies === null || companies === void 0 ? void 0 : companies.length) || 0
        };
        console.log('✅ Super Admin Dashboard data compiled successfully');
        res.status(200).json({
            success: true,
            data: {
                overview,
                recentOrders: recentOrders || [],
                recentCustomers: recentCustomers || [],
                recentSalesPersons: recentSalesPersons || [],
                companies: companies || [],
                timestamp: new Date().toISOString()
            }
        });
    }
    catch (error) {
        console.error('❌ Super Admin dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard data',
            error: error.message
        });
    }
});
exports.getSuperAdminDashboard = getSuperAdminDashboard;
// Get all users for role management
const getAllUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { page = 1, limit = 20, search, role, status } = req.query;
        const skip = (page - 1) * limit;
        let query = {};
        if (search) {
            query.$or = [
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { fullName: { $regex: search, $options: 'i' } }
            ];
        }
        if (role && role !== 'all') {
            query.role = role;
        }
        if (status && status !== 'all') {
            query.isActive = status === 'active';
        }
        const [users, totalUsers] = yield Promise.all([
            User_js_1.default.find(query)
                .select('-password')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            User_js_1.default.countDocuments(query)
        ]);
        res.status(200).json({
            success: true,
            data: {
                users,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalUsers,
                    pages: Math.ceil(totalUsers / limit)
                }
            }
        });
    }
    catch (error) {
        console.error('❌ Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users',
            error: error.message
        });
    }
});
exports.getAllUsers = getAllUsers;
// Update user role
const updateUserRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { userId } = req.params;
        const { role, permissions } = req.body;
        const targetUser = yield User_js_1.default.findById(userId);
        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        // Update user role and permissions
        targetUser.role = role;
        if (permissions) {
            targetUser.permissions = permissions;
        }
        yield targetUser.save();
        res.status(200).json({
            success: true,
            message: 'User role updated successfully',
            data: {
                user: {
                    id: targetUser._id,
                    username: targetUser.username,
                    role: targetUser.role,
                    permissions: targetUser.permissions
                }
            }
        });
    }
    catch (error) {
        console.error('❌ Update user role error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user role',
            error: error.message
        });
    }
});
exports.updateUserRole = updateUserRole;
// Get available roles
const getRoles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roles = [
            'Super Admin',
            'Unit Head',
            'Unit Manager',
            'Sales',
            'Production',
            'Manufacturing',
            'Packing',
            'Dispatch',
            'Accounts'
        ];
        res.status(200).json({
            success: true,
            data: roles
        });
    }
    catch (error) {
        console.error('❌ Get roles error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch roles',
            error: error.message
        });
    }
});
exports.getRoles = getRoles;
// Get system modules
const getSystemModules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const modules = [
            'Dashboard',
            'Orders',
            'Purchases',
            'Manufacturing',
            'Production',
            'Dispatches',
            'Sales',
            'Accounts',
            'Inventory',
            'Customers',
            'Suppliers',
            'Companies',
            'Settings',
            'Role Management'
        ];
        res.status(200).json({
            success: true,
            data: modules
        });
    }
    catch (error) {
        console.error('❌ Get system modules error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch system modules',
            error: error.message
        });
    }
});
exports.getSystemModules = getSystemModules;
// Super Admin Orders Management
const getSuperAdminOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { page = 1, limit = 20, customerId, salesPersonId, status, search, startDate, endDate, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const skip = (page - 1) * limit;
        let query = {};
        // Apply filters
        if (customerId) {
            query.customer = customerId;
        }
        if (salesPersonId) {
            query.salesPerson = salesPersonId;
        }
        if (status && status !== 'all') {
            // Only allow the 3 valid order statuses
            const validStatuses = ['pending', 'approved', 'rejected'];
            if (validStatuses.includes(status)) {
                query.status = status;
            }
        }
        if (search) {
            query.$or = [
                { orderCode: { $regex: search, $options: 'i' } },
                { orderNumber: { $regex: search, $options: 'i' } },
                { notes: { $regex: search, $options: 'i' } }
            ];
        }
        // Date range filter
        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        const [orders, totalOrders] = yield Promise.all([
            Order_js_1.default.find(query)
                .populate({
                path: 'customer',
                select: 'name contactPerson email mobile'
            })
                .populate({
                path: 'salesPerson',
                select: 'username fullName email'
            })
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            Order_js_1.default.countDocuments(query)
        ]);
        // Get summary stats
        const stats = yield Order_js_1.default.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$totalAmount' },
                    avgOrderValue: { $avg: '$totalAmount' },
                    statusBreakdown: { $push: '$status' }
                }
            }
        ]);
        const summary = stats[0] || { totalAmount: 0, avgOrderValue: 0, statusBreakdown: [] };
        summary.totalOrders = totalOrders;
        res.json({
            success: true,
            data: {
                orders,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalOrders,
                    pages: Math.ceil(totalOrders / limit)
                },
                summary
            }
        });
    }
    catch (error) {
        console.error('❌ Super Admin Orders error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
});
exports.getSuperAdminOrders = getSuperAdminOrders;
// Get Single Order Details
const getSuperAdminOrderById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { id } = req.params;
        const order = yield Order_js_1.default.findById(id)
            .populate('customer', 'name contactPerson email mobile address city')
            .populate('salesPerson', 'username fullName email')
            .populate('products.product', 'name code category price')
            .lean();
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        res.json({
            success: true,
            data: order
        });
    }
    catch (error) {
        console.error('❌ Super Admin Order detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order details',
            error: error.message
        });
    }
});
exports.getSuperAdminOrderById = getSuperAdminOrderById;
// Super Admin Sales Management (Sales Persons)
const getSuperAdminSales = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { page = 1, limit = 20, search, sortBy = 'totalOrders', sortOrder = 'desc' } = req.query;
        const skip = (page - 1) * limit;
        let query = { role: 'Sales' };
        // Apply search filter
        if (search) {
            query.$or = [
                { username: { $regex: search, $options: 'i' } },
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        // Get sales persons with their order statistics
        const salesPersons = yield User_js_1.default.find(query)
            .select('username fullName email isActive createdAt')
            .lean();
        // Get order statistics for each sales person
        const salesPersonsWithStats = yield Promise.all(salesPersons.map((person) => __awaiter(void 0, void 0, void 0, function* () {
            const orderStats = yield Order_js_1.default.aggregate([
                { $match: { salesPerson: person._id } },
                {
                    $group: {
                        _id: null,
                        totalOrders: { $sum: 1 },
                        totalAmount: { $sum: '$totalAmount' },
                        completedOrders: {
                            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                        },
                        pendingOrders: {
                            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                        },
                        avgOrderValue: { $avg: '$totalAmount' },
                        lastOrderDate: { $max: '$createdAt' }
                    }
                }
            ]);
            const stats = orderStats[0] || {
                totalOrders: 0,
                totalAmount: 0,
                completedOrders: 0,
                pendingOrders: 0,
                avgOrderValue: 0,
                lastOrderDate: null
            };
            return Object.assign(Object.assign({}, person), { orderStats: stats });
        })));
        // Apply sorting
        let sortField = 'orderStats.totalOrders';
        if (sortBy === 'totalAmount')
            sortField = 'orderStats.totalAmount';
        if (sortBy === 'avgOrderValue')
            sortField = 'orderStats.avgOrderValue';
        if (sortBy === 'fullName')
            sortField = 'fullName';
        salesPersonsWithStats.sort((a, b) => {
            const aValue = sortField.includes('.') ? sortField.split('.').reduce((obj, key) => obj[key], a) : a[sortField];
            const bValue = sortField.includes('.') ? sortField.split('.').reduce((obj, key) => obj[key], b) : b[sortField];
            if (sortOrder === 'asc') {
                return (aValue || 0) - (bValue || 0);
            }
            return (bValue || 0) - (aValue || 0);
        });
        // Apply pagination
        const paginatedSalesPersons = salesPersonsWithStats.slice(skip, skip + parseInt(limit));
        const totalSalesPersons = salesPersonsWithStats.length;
        // Calculate summary statistics
        const summary = {
            totalSalesPersons,
            totalSales: salesPersonsWithStats.reduce((sum, person) => sum + person.orderStats.totalOrders, 0),
            totalAmount: salesPersonsWithStats.reduce((sum, person) => sum + person.orderStats.totalAmount, 0),
            avgSaleValue: salesPersonsWithStats.length > 0 ?
                salesPersonsWithStats.reduce((sum, person) => sum + person.orderStats.totalAmount, 0) /
                    salesPersonsWithStats.reduce((sum, person) => sum + person.orderStats.totalOrders, 0) : 0
        };
        res.json({
            success: true,
            data: {
                sales: paginatedSalesPersons,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalSalesPersons,
                    pages: Math.ceil(totalSalesPersons / limit)
                },
                summary
            }
        });
    }
    catch (error) {
        console.error('❌ Super Admin Sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sales data',
            error: error.message
        });
    }
});
exports.getSuperAdminSales = getSuperAdminSales;
// Get Sales Person Details with Orders
const getSalesPersonById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { salesPersonId } = req.params;
        // Get sales person details
        const salesPerson = yield User_js_1.default.findById(salesPersonId)
            .select('username fullName email isActive createdAt permissions role')
            .lean();
        if (!salesPerson || salesPerson.role !== 'Sales') {
            return res.status(404).json({
                success: false,
                message: 'Sales person not found'
            });
        }
        // Get all orders for this sales person
        const orders = yield Order_js_1.default.find({ salesPerson: salesPersonId })
            .populate('customer', 'name contactPerson email mobile')
            .sort({ createdAt: -1 })
            .lean();
        // Get order statistics
        const orderStats = yield Order_js_1.default.aggregate([
            { $match: { salesPerson: salesPerson._id } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' },
                    completedOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    pendingOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                    },
                    cancelledOrders: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    },
                    avgOrderValue: { $avg: '$totalAmount' },
                    lastOrderDate: { $max: '$createdAt' }
                }
            }
        ]);
        const stats = orderStats[0] || {
            totalOrders: 0,
            totalAmount: 0,
            completedOrders: 0,
            pendingOrders: 0,
            cancelledOrders: 0,
            avgOrderValue: 0,
            lastOrderDate: null
        };
        res.json({
            success: true,
            data: {
                salesPerson,
                orders,
                statistics: stats
            }
        });
    }
    catch (error) {
        console.error('❌ Sales person details error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sales person details',
            error: error.message
        });
    }
});
exports.getSalesPersonById = getSalesPersonById;
// Super Admin Customers Management
const getSuperAdminCustomers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { page = 1, limit = 20, search, city, status = 'all', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const skip = (page - 1) * limit;
        console.log('🔍 SuperAdmin customers filter params:', {
            page, limit, search, city, status, sortBy, sortOrder
        });
        let query = {};
        // Apply filters
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { contactPerson: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { mobile: { $regex: search, $options: 'i' } }
            ];
        }
        if (city) {
            query.city = { $regex: city, $options: 'i' };
        }
        if (status !== 'all') {
            if (status === 'active') {
                query.active = 'Yes';
            }
            else if (status === 'inactive') {
                query.active = 'No';
            }
        }
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        console.log('🔍 Final customer query:', JSON.stringify(query));
        console.log('🔍 Sort options:', sort);
        const [customers, totalCustomers] = yield Promise.all([
            Customer_js_1.default.find(query)
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            Customer_js_1.default.countDocuments(query)
        ]);
        // Get customer stats with orders
        const customersWithStats = yield Promise.all(customers.map((customer) => __awaiter(void 0, void 0, void 0, function* () {
            const orderStats = yield Order_js_1.default.aggregate([
                { $match: { customer: customer._id } },
                {
                    $group: {
                        _id: null,
                        totalOrders: { $sum: 1 },
                        totalAmount: { $sum: '$totalAmount' },
                        lastOrder: { $max: '$createdAt' }
                    }
                }
            ]);
            const stats = orderStats[0] || { totalOrders: 0, totalAmount: 0, lastOrder: null };
            return Object.assign(Object.assign({}, customer), { orderStats: stats });
        })));
        // Get summary stats
        const summaryStats = yield Customer_js_1.default.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalCustomers: { $sum: 1 },
                    activeCustomers: {
                        $sum: { $cond: [{ $eq: ['$active', 'Yes'] }, 1, 0] }
                    }
                }
            }
        ]);
        const summary = summaryStats[0] || { totalCustomers: 0, activeCustomers: 0 };
        res.json({
            success: true,
            data: {
                customers: customersWithStats,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCustomers,
                    pages: Math.ceil(totalCustomers / limit)
                },
                summary
            }
        });
    }
    catch (error) {
        console.error('❌ Super Admin customers error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customers',
            error: error.message
        });
    }
});
exports.getSuperAdminCustomers = getSuperAdminCustomers;
// Get Single Customer Details
const getSuperAdminCustomerById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { id } = req.params;
        const customer = yield Customer_js_1.default.findById(id).lean();
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }
        // Get customer orders
        const orders = yield Order_js_1.default.find({ customer: id })
            .populate('salesPerson', 'username fullName')
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();
        // Get order statistics
        const orderStats = yield Order_js_1.default.aggregate([
            { $match: { customer: customer._id } },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' },
                    avgOrderValue: { $avg: '$totalAmount' },
                    statusBreakdown: { $push: '$status' }
                }
            }
        ]);
        const stats = orderStats[0] || { totalOrders: 0, totalAmount: 0, avgOrderValue: 0, statusBreakdown: [] };
        res.json({
            success: true,
            data: {
                customer,
                recentOrders: orders,
                statistics: stats
            }
        });
    }
    catch (error) {
        console.error('❌ Super Admin customer detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customer details',
            error: error.message
        });
    }
});
exports.getSuperAdminCustomerById = getSuperAdminCustomerById;
// Super Admin Dispatches - Get all dispatches with pagination
const getSuperAdminDispatches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        console.log('🚚 Super Admin fetching all dispatches...');
        // Import Dispatch model
        const Dispatch = (yield Promise.resolve().then(() => __importStar(require('../models/Dispatch.js')))).default;
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        // Search and filter parameters
        const search = req.query.search || '';
        const status = req.query.status || '';
        const companyId = req.query.companyId || '';
        const dateFrom = req.query.dateFrom || '';
        const dateTo = req.query.dateTo || '';
        // Build filter query
        let filter = {};
        if (search) {
            filter.$or = [
                { batchNo: { $regex: search, $options: 'i' } },
                { productGroup: { $regex: search, $options: 'i' } },
                { productName: { $regex: search, $options: 'i' } },
                { remarks: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) {
            filter.status = status;
        }
        if (companyId) {
            filter.company = companyId;
        }
        if (dateFrom || dateTo) {
            filter.date = {};
            if (dateFrom) {
                filter.date.$gte = new Date(dateFrom);
            }
            if (dateTo) {
                filter.date.$lte = new Date(dateTo);
            }
        }
        // Get dispatches with pagination
        const [dispatches, totalDispatches] = yield Promise.all([
            Dispatch.find(filter)
                .populate('company', 'name city state')
                .populate('packingSheetId', 'orderCode')
                .populate('customer', 'name')
                .populate('salesPerson', 'fullName')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Dispatch.countDocuments(filter)
        ]);
        // Calculate pagination metadata
        const totalPages = Math.ceil(totalDispatches / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        // Get dispatch statistics for dashboard
        const dispatchStats = yield Dispatch.aggregate([
            {
                $group: {
                    _id: null,
                    totalDispatches: { $sum: 1 },
                    totalPackedQty: { $sum: '$packedQuantityReadyForDispatch' },
                    totalReturnQty: { $sum: '$returnQuantityYesterdayReturns' },
                    totalAvailableStock: { $sum: '$totalAvailableStock' },
                    statusBreakdown: { $push: '$status' }
                }
            }
        ]);
        const stats = dispatchStats[0] || {
            totalDispatches: 0,
            totalPackedQty: 0,
            totalReturnQty: 0,
            totalAvailableStock: 0,
            statusBreakdown: []
        };
        // Calculate status distribution
        const statusCounts = {};
        stats.statusBreakdown.forEach(status => {
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        res.json({
            success: true,
            data: {
                dispatches,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalDispatches,
                    limit,
                    hasNextPage,
                    hasPrevPage
                },
                statistics: Object.assign(Object.assign({}, stats), { statusCounts })
            }
        });
    }
    catch (error) {
        console.error('❌ Super Admin dispatches error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispatches',
            error: error.message
        });
    }
});
exports.getSuperAdminDispatches = getSuperAdminDispatches;
// Super Admin Dispatch Detail - Get single dispatch by ID
const getSuperAdminDispatchById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        if (user.role !== 'Super Admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied - Super Admin role required'
            });
        }
        const { id } = req.params;
        console.log('🔍 Super Admin fetching dispatch details for ID:', id);
        // Import Dispatch model
        const Dispatch = (yield Promise.resolve().then(() => __importStar(require('../models/Dispatch.js')))).default;
        const dispatch = yield Dispatch.findById(id)
            .populate('company', 'name city state address phone')
            .populate('packingSheetId', 'orderCode')
            .populate('customer', 'name contactPerson phone email')
            .populate('salesPerson', 'fullName username email')
            .populate('orderId', 'orderCode')
            .lean();
        if (!dispatch) {
            return res.status(404).json({
                success: false,
                message: 'Dispatch not found'
            });
        }
        res.json({
            success: true,
            data: { dispatch }
        });
    }
    catch (error) {
        console.error('❌ Super Admin dispatch detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispatch details',
            error: error.message
        });
    }
});
exports.getSuperAdminDispatchById = getSuperAdminDispatchById;
