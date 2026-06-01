"use strict";
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s)
        if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
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
exports.bulkImportUnitUsers = exports.deleteUnitUser = exports.updateUnitUserPassword = exports.updateUnitUser = exports.createUnitUser = exports.getUnitUserById = exports.getUnitUsers = exports.getUnitHeadCompanyInfo = exports.getUnitManagerModules = exports.getUnitManagerById = exports.deleteUnitManager = exports.updateUnitManagerPassword = exports.updateUnitManager = exports.createUnitManager = exports.getUnitManagers = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const schema_js_1 = require("../shared/schema.js");
const Company_js_1 = require("../models/Company.js");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// Get all Unit Managers under the current Unit Head
const getUnitManagers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        console.log('=== getUnitManagers API called ===');
        console.log('Query parameters:', req.query);
        console.log('Unit Head user:', (_a = req.user) === null || _a === void 0 ? void 0 : _a.username, 'Unit:', (_b = req.user) === null || _b === void 0 ? void 0 : _b.unit, 'CompanyId:', (_c = req.user) === null || _c === void 0 ? void 0 : _c.companyId);
        // Debug: Check if companyId exists
        if (!((_d = req.user) === null || _d === void 0 ? void 0 : _d.companyId)) {
            console.log('🚨 WARNING: Unit Head has no companyId assigned!');
            return res.status(400).json({
                success: false,
                message: 'Unit Head must be assigned to a company. Please contact administrator.',
                debug: {
                    user: (_e = req.user) === null || _e === void 0 ? void 0 : _e.username,
                    unit: (_f = req.user) === null || _f === void 0 ? void 0 : _f.unit,
                    companyId: (_g = req.user) === null || _g === void 0 ? void 0 : _g.companyId
                }
            });
        }
        const { page = 1, limit = 100, search, sortBy = 'createdAt', sortOrder = 'desc', status = 'all' } = req.query;
        const skip = (page - 1) * limit;
        // Unit Head can only see Unit Managers from their own unit AND company
        let query = {
            role: 'Unit Manager',
            unit: req.user.unit, // Only show users from the same unit
            companyId: req.user.companyId // Only show users from the same company
        };
        console.log('Filtering query:', query);
        console.log('Unit Head companyId:', req.user.companyId);
        // Filter by status
        if (status !== 'all') {
            query.isActive = status === 'active';
        }
        // Search functionality
        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        // Sorting
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        // Fetch unit managers with pagination
        const unitManagers = yield User_js_1.default.find(query)
            .select('-password')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit))
            .lean();
        // Get total count for pagination
        const total = yield User_js_1.default.countDocuments(query);
        // Get summary statistics for this unit and company
        const stats = yield User_js_1.default.aggregate([
            {
                $match: {
                    unit: req.user.unit,
                    role: 'Unit Manager',
                    companyId: req.user.companyId // Filter by company
                }
            },
            {
                $group: {
                    _id: null,
                    totalManagers: { $sum: 1 },
                    activeManagers: {
                        $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
                    },
                    inactiveManagers: {
                        $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
                    }
                }
            }
        ]);
        const summary = stats[0] || {
            totalManagers: 0,
            activeManagers: 0,
            inactiveManagers: 0
        };
        console.log('=== getUnitManagers response ===');
        console.log('Total unit managers found:', total);
        console.log('Unit managers count:', unitManagers.length);
        console.log('Unit managers sample:', unitManagers.slice(0, 2).map(u => ({
            username: u.username,
            unit: u.unit,
            companyId: u.companyId
        })));
        res.json({
            success: true,
            data: {
                users: unitManagers,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                },
                summary,
                unit: req.user.unit
            }
        });
    }
    catch (error) {
        console.error('Get unit managers error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch unit managers',
            error: error.message
        });
    }
});
exports.getUnitManagers = getUnitManagers;
// Create a new Unit Manager (only Unit Heads can do this)
const createUnitManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== createUnitManager API called ===');
        console.log('Request body:', req.body);
        console.log('Unit Head user:', req.user.username, 'Company ID:', req.user.companyId);
        const { username, email, password, fullName, permissions, isActive = true } = req.body;
        // Check if Unit Head has company assignment
        if (!req.user.companyId) {
            return res.status(400).json({
                success: false,
                message: 'Unit Head must be assigned to a company/location before creating Unit Managers. Please contact system administrator.'
            });
        }
        // Get Unit Head's company information
        const unitHeadCompany = yield Company_js_1.Company.findById(req.user.companyId);
        if (!unitHeadCompany) {
            return res.status(400).json({
                success: false,
                message: 'Unit Head company assignment not found. Please contact system administrator.'
            });
        }
        // Validation
        if (!username || !email || !password || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'Username, email, password, and full name are required'
            });
        }
        // Check if user already exists
        const existingUser = yield User_js_1.default.findOne({
            $or: [{ email }, { username }]
        });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email or username already exists'
            });
        }
        // Create new unit manager under the same unit and company as the Unit Head
        const newUser = new User_js_1.default({
            username,
            email,
            password,
            fullName,
            role: 'Unit Manager', // Fixed role
            unit: req.user.unit, // Same unit as the Unit Head
            companyId: req.user.companyId, // Same company as the Unit Head
            permissions: Object.assign({ role: 'unit_manager', canAccessAllUnits: false, modules: (permissions === null || permissions === void 0 ? void 0 : permissions.modules) || [] }, permissions),
            isActive
        });
        yield newUser.save();
        // Remove password from response
        const userResponse = newUser.toObject();
        delete userResponse.password;
        console.log('=== Unit Manager created successfully ===');
        console.log('New user:', { id: newUser._id, username, role: 'Unit Manager', unit: req.user.unit });
        res.status(201).json({
            success: true,
            message: 'Unit Manager created successfully',
            data: userResponse
        });
    }
    catch (error) {
        console.error('Create unit manager error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create unit manager',
            error: error.message
        });
    }
});
exports.createUnitManager = createUnitManager;
// Update Unit Manager details and permissions
const updateUnitManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== updateUnitManager API called ===');
        console.log('User ID:', req.params.userId);
        console.log('Request body:', req.body);
        const { userId } = req.params;
        const { username, email, fullName, permissions, isActive } = req.body;
        // Find the user and ensure they are a Unit Manager in the same unit AND company
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: 'Unit Manager',
            unit: req.user.unit,
            companyId: req.user.companyId // Ensure same company
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Unit Manager not found or not in your unit'
            });
        }
        // Check if email/username is already taken by another user
        if (username && username !== user.username) {
            const existingUsername = yield User_js_1.default.findOne({ username, _id: { $ne: userId } });
            if (existingUsername) {
                return res.status(400).json({
                    success: false,
                    message: 'Username already taken'
                });
            }
        }
        if (email && email !== user.email) {
            const existingEmail = yield User_js_1.default.findOne({ email, _id: { $ne: userId } });
            if (existingEmail) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already taken'
                });
            }
        }
        // Update user fields
        if (username)
            user.username = username;
        if (email)
            user.email = email;
        if (fullName)
            user.fullName = fullName;
        if (permissions) {
            user.permissions = Object.assign({ role: 'unit_manager', canAccessAllUnits: false, modules: (permissions === null || permissions === void 0 ? void 0 : permissions.modules) || [] }, permissions);
        }
        if (typeof isActive === 'boolean')
            user.isActive = isActive;
        yield user.save();
        // Remove password from response
        const userResponse = user.toObject();
        delete userResponse.password;
        console.log('=== Unit Manager updated successfully ===');
        res.json({
            success: true,
            message: 'Unit Manager updated successfully',
            data: userResponse
        });
    }
    catch (error) {
        console.error('Update unit manager error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update unit manager',
            error: error.message
        });
    }
});
exports.updateUnitManager = updateUnitManager;
// Update Unit Manager password
const updateUnitManagerPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== updateUnitManagerPassword API called ===');
        console.log('User ID:', req.params.userId);
        console.log('Unit Head:', req.user.username, 'Unit:', req.user.unit);
        const { userId } = req.params;
        const { newPassword } = req.body;
        console.log('Has newPassword:', !!newPassword);
        console.log('Password length:', newPassword ? newPassword.length : 0);
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }
        // Find the user and ensure they are a Unit Manager in the same unit AND company
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: 'Unit Manager',
            unit: req.user.unit,
            companyId: req.user.companyId // Ensure same company
        });
        if (!user) {
            console.log('Unit Manager not found or not in unit');
            return res.status(404).json({
                success: false,
                message: 'Unit Manager not found or not in your unit'
            });
        }
        console.log('Found Unit Manager:', user.username, 'Email:', user.email);
        // Update password (using .save() to trigger User model's pre-save middleware for hashing)
        user.password = newPassword;
        user.updatedAt = new Date();
        yield user.save();
        console.log('=== Unit Manager password updated successfully ===');
        console.log('Updated user:', user.username);
        res.json({
            success: true,
            message: 'Password updated successfully',
            data: {
                _id: user._id,
                username: user.username,
                email: user.email
            }
        });
    }
    catch (error) {
        console.error('Update unit manager password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update password',
            error: error.message
        });
    }
});
exports.updateUnitManagerPassword = updateUnitManagerPassword;
// Delete/Deactivate Unit Manager
const deleteUnitManager = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== deleteUnitManager API called ===');
        console.log('User ID:', req.params.userId);
        const { userId } = req.params;
        const { permanent = false } = req.body;
        // Find the user and ensure they are a Unit Manager in the same unit AND company
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: 'Unit Manager',
            unit: req.user.unit,
            companyId: req.user.companyId // Ensure same company
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Unit Manager not found or not in your unit'
            });
        }
        if (permanent) {
            // Permanently delete the user
            yield User_js_1.default.findByIdAndDelete(userId);
            console.log('=== Unit Manager deleted permanently ===');
            res.json({
                success: true,
                message: 'Unit Manager deleted permanently'
            });
        }
        else {
            // Just deactivate the user
            user.isActive = false;
            yield user.save();
            console.log('=== Unit Manager deactivated ===');
            res.json({
                success: true,
                message: 'Unit Manager deactivated successfully',
                data: {
                    _id: user._id,
                    username: user.username,
                    isActive: user.isActive
                }
            });
        }
    }
    catch (error) {
        console.error('Delete unit manager error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete unit manager',
            error: error.message
        });
    }
});
exports.deleteUnitManager = deleteUnitManager;
// Get Unit Manager by ID
const getUnitManagerById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== getUnitManagerById API called ===');
        console.log('User ID:', req.params.userId);
        const { userId } = req.params;
        // Find the user and ensure they are a Unit Manager in the same unit AND company
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: 'Unit Manager',
            unit: req.user.unit,
            companyId: req.user.companyId // Ensure same company
        }).select('-password');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Unit Manager not found or not in your unit'
            });
        }
        console.log('=== Unit Manager found ===');
        res.json({
            success: true,
            data: user
        });
    }
    catch (error) {
        console.error('Get unit manager by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch unit manager',
            error: error.message
        });
    }
});
exports.getUnitManagerById = getUnitManagerById;
// Get available modules and permissions for Unit Manager role
const getUnitManagerModules = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== getUnitManagerModules API called ===');
        // Define modules that Unit Managers can access
        const availableModules = [
            {
                name: 'sales',
                label: 'Sales',
                features: [
                    { key: 'orders', label: 'View Orders' },
                    { key: 'myOrders', label: 'My Orders' },
                    { key: 'myCustomers', label: 'My Customers' },
                    { key: 'salesApproval', label: 'Sales Approval' },
                    { key: 'salesOrderList', label: 'Sales Order List' }
                ]
            },
            {
                name: 'production',
                label: 'Production',
                features: [
                    { key: 'view', label: 'View Production' },
                    { key: 'schedule', label: 'Production Schedule' },
                    { key: 'quality', label: 'Quality Control' }
                ]
            },
            {
                name: 'inventory',
                label: 'Inventory',
                features: [
                    { key: 'view', label: 'View Inventory' },
                    { key: 'update', label: 'Update Stock' }
                ]
            },
            {
                name: 'reports',
                label: 'Reports',
                features: [
                    { key: 'salesReport', label: 'Sales Reports' },
                    { key: 'productionReport', label: 'Production Reports' }
                ]
            }
        ];
        res.json({
            success: true,
            data: {
                modules: availableModules,
                roles: ['Unit Manager'], // Only Unit Manager role for this context
                units: [req.user.unit] // Only current unit
            }
        });
    }
    catch (error) {
        console.error('Get unit manager modules error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch modules',
            error: error.message
        });
    }
});
exports.getUnitManagerModules = getUnitManagerModules;
// Get Unit Head's company information for form pre-population
const getUnitHeadCompanyInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== getUnitHeadCompanyInfo API called ===');
        console.log('Unit Head user:', req.user.username, 'Company ID:', req.user.companyId);
        // Check if Unit Head has company assignment
        if (!req.user.companyId) {
            return res.status(400).json({
                success: false,
                message: 'Unit Head is not assigned to any company/location. Please contact system administrator.'
            });
        }
        // Get Unit Head's company information
        const company = yield Company_js_1.Company.findById(req.user.companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company information not found. Please contact system administrator.'
            });
        }
        // Return company info for form pre-population
        res.json({
            success: true,
            data: {
                companyId: company._id,
                companyName: company.name,
                unitName: company.unitName,
                location: `${company.name}, ${company.city}`,
                city: company.city,
                address: company.address
            }
        });
    }
    catch (error) {
        console.error('Get unit head company info error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch company information',
            error: error.message
        });
    }
});
exports.getUnitHeadCompanyInfo = getUnitHeadCompanyInfo;
// ============ NEW FUNCTIONS FOR ALL UNIT USERS ============
// Unit Head manageable roles
const UNIT_HEAD_MANAGEABLE_ROLES = [
    'Unit Manager',
    'Sales',
    'Production',
    'Accounts',
    'Dispatch',
    'Packing'
];
// Get all unit users (Unit Manager, Sales, Production, Accounts, Dispatch, Packing)
const getUnitUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        console.log('=== getUnitUsers API called ===');
        console.log('Unit Head user:', (_a = req.user) === null || _a === void 0 ? void 0 : _a.username, 'Unit:', (_b = req.user) === null || _b === void 0 ? void 0 : _b.unit, 'CompanyId:', (_c = req.user) === null || _c === void 0 ? void 0 : _c.companyId);
        if (!((_d = req.user) === null || _d === void 0 ? void 0 : _d.companyId)) {
            return res.status(400).json({
                success: false,
                message: 'Unit Head must be assigned to a company. Please contact administrator.',
            });
        }
        const { page = 1, limit = 100, search, sortBy = 'createdAt', sortOrder = 'desc', status = 'all' } = req.query;
        const skip = (page - 1) * limit;
        // Unit Head can only see users from their unit, company, and manageable roles
        let query = {
            role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
            unit: req.user.unit,
            companyId: req.user.companyId
        };
        // Filter by status
        if (status !== 'all') {
            query.isActive = status === 'active';
        }
        // Search functionality
        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { role: { $regex: search, $options: 'i' } }
            ];
        }
        // Sorting
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        // Fetch unit users with pagination
        const unitUsers = yield User_js_1.default.find(query)
            .select('-password')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit))
            .populate('companyId', 'name city state unitName');
        console.log('=== Unit Users Debug ===');
        console.log('Total users found:', unitUsers.length);
        console.log('Query used:', JSON.stringify(query, null, 2));
        if (unitUsers.length > 0) {
            console.log('First user sample:', {
                username: unitUsers[0].username,
                companyId: unitUsers[0].companyId,
                companyIdType: typeof unitUsers[0].companyId,
                companyIdValue: JSON.stringify(unitUsers[0].companyId)
            });
        }
        // Convert to JSON to ensure proper serialization
        const formattedUsers = unitUsers.map(user => {
            const userObj = user.toObject();
            console.log('User company after toObject:', userObj.companyId);
            return userObj;
        });
        // Get total count for pagination
        const total = yield User_js_1.default.countDocuments(query);
        // Get summary statistics by role
        const stats = yield User_js_1.default.aggregate([
            {
                $match: {
                    unit: req.user.unit,
                    role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
                    companyId: req.user.companyId
                }
            },
            {
                $group: {
                    _id: '$role',
                    total: { $sum: 1 },
                    active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } },
                    inactive: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] } }
                }
            }
        ]);
        const summary = {
            totalUsers: total,
            activeUsers: formattedUsers.filter(u => u.isActive).length,
            inactiveUsers: formattedUsers.filter(u => !u.isActive).length,
            byRole: stats.reduce((acc, stat) => {
                acc[stat._id] = {
                    total: stat.total,
                    active: stat.active,
                    inactive: stat.inactive
                };
                return acc;
            }, {})
        };
        res.json({
            success: true,
            data: {
                users: formattedUsers,
                summary,
                unit: req.user.unit,
                pagination: {
                    current: parseInt(page),
                    total: Math.ceil(total / limit),
                    count: total,
                    hasNext: skip + formattedUsers.length < total,
                    hasPrev: parseInt(page) > 1
                }
            }
        });
    }
    catch (error) {
        console.error('Get unit users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch unit users',
            error: error.message
        });
    }
});
exports.getUnitUsers = getUnitUsers;
// Get unit user by ID
const getUnitUserById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
            unit: req.user.unit,
            companyId: req.user.companyId
        }).select('-password');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or access denied'
            });
        }
        res.json({
            success: true,
            data: user
        });
    }
    catch (error) {
        console.error('Get unit user by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user',
            error: error.message
        });
    }
});
exports.getUnitUserById = getUnitUserById;
// Create new unit user
const createUnitUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, email, fullName, role, password, permissions } = req.body;
        // Validate required fields
        if (!username || !email || !fullName || !role || !password) {
            return res.status(400).json({
                success: false,
                message: 'All required fields must be provided'
            });
        }
        // Validate role
        if (!UNIT_HEAD_MANAGEABLE_ROLES.includes(role)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role. Must be one of: ${UNIT_HEAD_MANAGEABLE_ROLES.join(', ')}`
            });
        }
        // Check if username or email already exists
        const existingUser = yield User_js_1.default.findOne({
            $or: [{ username }, { email }]
        });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: existingUser.username === username
                    ? 'Username already exists'
                    : 'Email already exists'
            });
        }
        // Create user with Unit Head's company and unit info (User model will handle password hashing automatically)
        const newUser = new User_js_1.default({
            username,
            email,
            fullName,
            role,
            password,
            unit: req.user.unit,
            companyId: req.user.companyId,
            permissions: Object.assign({ role: role.toLowerCase().replace(' ', '_') }, permissions),
            isActive: true
        });
        yield newUser.save();
        // Return user without password
        const _a = newUser.toObject(), { password: _ } = _a, userResponse = __rest(_a, ["password"]);
        res.status(201).json({
            success: true,
            message: `${role} created successfully`,
            data: userResponse
        });
    }
    catch (error) {
        console.error('Create unit user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create user',
            error: error.message
        });
    }
});
exports.createUnitUser = createUnitUser;
// Update unit user
const updateUnitUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const { username, email, fullName, role, permissions, isActive } = req.body;
        // Find user and verify access
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
            unit: req.user.unit,
            companyId: req.user.companyId
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or access denied'
            });
        }
        // Validate role if provided
        if (role && !UNIT_HEAD_MANAGEABLE_ROLES.includes(role)) {
            return res.status(400).json({
                success: false,
                message: `Invalid role. Must be one of: ${UNIT_HEAD_MANAGEABLE_ROLES.join(', ')}`
            });
        }
        // Check for duplicate username/email (excluding current user)
        if (username || email) {
            const duplicateQuery = { _id: { $ne: userId } };
            if (username)
                duplicateQuery.username = username;
            if (email)
                duplicateQuery.email = email;
            const existingUser = yield User_js_1.default.findOne({
                $or: [
                    ...(username ? [{ username, _id: { $ne: userId } }] : []),
                    ...(email ? [{ email, _id: { $ne: userId } }] : [])
                ]
            });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: existingUser.username === username
                        ? 'Username already exists'
                        : 'Email already exists'
                });
            }
        }
        // Update user fields
        const updateData = {};
        if (username)
            updateData.username = username;
        if (email)
            updateData.email = email;
        if (fullName)
            updateData.fullName = fullName;
        if (role)
            updateData.role = role;
        if (permissions !== undefined)
            updateData.permissions = permissions;
        if (isActive !== undefined)
            updateData.isActive = isActive;
        const updatedUser = yield User_js_1.default.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true }).select('-password');
        res.json({
            success: true,
            message: 'User updated successfully',
            data: updatedUser
        });
    }
    catch (error) {
        console.error('Update unit user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user',
            error: error.message
        });
    }
});
exports.updateUnitUser = updateUnitUser;
// Update unit user password
const updateUnitUserPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }
        // Find user and verify access
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
            unit: req.user.unit,
            companyId: req.user.companyId
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or access denied'
            });
        }
        // Update password (using .save() to trigger User model's pre-save middleware for hashing)
        user.password = newPassword;
        yield user.save();
        res.json({
            success: true,
            message: 'Password updated successfully'
        });
    }
    catch (error) {
        console.error('Update unit user password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update password',
            error: error.message
        });
    }
});
exports.updateUnitUserPassword = updateUnitUserPassword;
// Delete unit user
const deleteUnitUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        // Find user and verify access
        const user = yield User_js_1.default.findOne({
            _id: userId,
            role: { $in: UNIT_HEAD_MANAGEABLE_ROLES },
            unit: req.user.unit,
            companyId: req.user.companyId
        });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or access denied'
            });
        }
        yield User_js_1.default.findByIdAndDelete(userId);
        res.json({
            success: true,
            message: `${user.role} deleted successfully`
        });
    }
    catch (error) {
        console.error('Delete unit user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user',
            error: error.message
        });
    }
});
exports.deleteUnitUser = deleteUnitUser;
// Helper function to get default permissions based on role
const getDefaultPermissionsByRole = (role) => {
    const defaultPermissions = {
        role: role, // Required field in User model
        canAccessAllUnits: false,
        modules: []
    };
    switch (role) {
        case 'Unit Manager':
            defaultPermissions.modules = [{
                    name: 'unitManager',
                    dashboard: true,
                    features: [
                        { key: 'salesApproval', view: true, add: true, edit: true, delete: false },
                        { key: 'salesOrderList', view: true, add: false, edit: true, delete: false },
                        { key: 'productionGroup', view: true, add: true, edit: true, delete: false },
                        { key: 'returns', view: true, add: true, edit: true, delete: false }
                    ]
                }];
            break;
        case 'Sales':
            defaultPermissions.modules = [{
                    name: 'sales',
                    dashboard: true,
                    features: [
                        { key: 'orders', view: true, add: true, edit: true, delete: false },
                        { key: 'myCustomers', view: true, add: true, edit: true, delete: false },
                        { key: 'myDeliveries', view: true, add: false, edit: false, delete: false },
                        { key: 'myInvoices', view: true, add: false, edit: false, delete: false },
                        { key: 'returns', view: true, add: true, edit: true, delete: false }
                    ]
                }];
            break;
        case 'Production':
            defaultPermissions.modules = [{
                    name: 'production',
                    dashboard: true,
                    features: [
                        { key: 'productionDashboard', view: true, add: false, edit: false, delete: false },
                        { key: 'productionReports', view: true, add: false, edit: false, delete: false },
                        { key: 'productionSheet', view: true, add: true, edit: true, delete: false }
                    ]
                }];
            break;
        case 'Packing':
            defaultPermissions.modules = [{
                    name: 'packing',
                    dashboard: true,
                    features: [
                        { key: 'dashboard', view: true, add: false, edit: false, delete: false },
                        { key: 'packingSheet', view: true, add: true, edit: true, delete: false },
                        { key: 'packingHistory', view: true, add: false, edit: false, delete: false }
                    ]
                }];
            break;
        case 'Accounts':
            defaultPermissions.modules = [{
                    name: 'accounts',
                    dashboard: true,
                    features: [
                        { key: 'transactions', view: true, add: true, edit: true, delete: false },
                        { key: 'balanceSheet', view: true, add: false, edit: false, delete: false },
                        { key: 'reports', view: true, add: false, edit: false, delete: false },
                        { key: 'payments', view: true, add: true, edit: true, delete: false }
                    ]
                }];
            break;
        case 'Dispatch':
            defaultPermissions.modules = [{
                    name: 'dispatch',
                    dashboard: true,
                    features: [
                        { key: 'dashboard', view: true, add: false, edit: false, delete: false },
                        { key: 'deliveryChallan', view: true, add: true, edit: true, delete: false },
                        { key: 'dispatchHistory', view: true, add: false, edit: false, delete: false }
                    ]
                }];
            break;
        default:
            break;
    }
    return defaultPermissions;
};
// Bulk import unit users
const bulkImportUnitUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    try {
        const { users } = req.body;
        if (!Array.isArray(users) || users.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Users array is required and must not be empty'
            });
        }
        const results = {
            success: [],
            failed: [],
            skipped: [],
            total: users.length
        };
        for (let i = 0; i < users.length; i++) {
            const userData = users[i];
            const rowNumber = i + 2; // Excel row number (accounting for header)
            try {
                // Validate required fields
                const username = (_a = userData.username) === null || _a === void 0 ? void 0 : _a.toString().trim();
                const email = (_b = userData.email) === null || _b === void 0 ? void 0 : _b.toString().trim();
                const role = (_c = userData.role) === null || _c === void 0 ? void 0 : _c.toString().trim();
                const fullName = ((_d = userData.fullName) === null || _d === void 0 ? void 0 : _d.toString().trim()) || username;
                // Check for missing required fields
                if (!username || !email || !role) {
                    results.failed.push({
                        row: rowNumber,
                        username: username || 'N/A',
                        email: email || 'N/A',
                        error: 'Missing required fields (username, email, or role)'
                    });
                    continue;
                }
                // Validate email format
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    results.failed.push({
                        row: rowNumber,
                        username,
                        email,
                        error: 'Invalid email format'
                    });
                    continue;
                }
                // Validate role
                if (!UNIT_HEAD_MANAGEABLE_ROLES.includes(role)) {
                    results.failed.push({
                        row: rowNumber,
                        username,
                        email,
                        error: `Invalid role. Must be one of: ${UNIT_HEAD_MANAGEABLE_ROLES.join(', ')}`
                    });
                    continue;
                }
                // Check for duplicate username or email in database
                const existingUser = yield User_js_1.default.findOne({
                    $or: [{ username }, { email }],
                    unit: req.user.unit,
                    companyId: req.user.companyId
                });
                if (existingUser) {
                    results.skipped.push({
                        row: rowNumber,
                        username,
                        email,
                        reason: existingUser.username === username
                            ? 'Username already exists'
                            : 'Email already exists'
                    });
                    continue;
                }
                // Get default permissions based on role
                const defaultPermissions = getDefaultPermissionsByRole(role);
                // Create new user with default password
                const newUser = new User_js_1.default({
                    username,
                    email,
                    fullName,
                    role,
                    password: 'Welcome@123', // Default password
                    unit: req.user.unit,
                    companyId: req.user.companyId,
                    permissions: defaultPermissions,
                    isActive: ((_e = userData.status) === null || _e === void 0 ? void 0 : _e.toString().toLowerCase()) !== 'inactive'
                });
                yield newUser.save();
                results.success.push({
                    row: rowNumber,
                    username,
                    email,
                    role,
                    fullName
                });
            }
            catch (error) {
                results.failed.push({
                    row: rowNumber,
                    username: userData.username || 'N/A',
                    email: userData.email || 'N/A',
                    error: error.message || 'Unknown error occurred'
                });
            }
        }
        // Prepare response message
        const message = `Import completed: ${results.success.length} created, ${results.skipped.length} skipped (duplicates), ${results.failed.length} failed`;
        res.status(200).json({
            success: true,
            message,
            data: {
                summary: {
                    total: results.total,
                    successful: results.success.length,
                    skipped: results.skipped.length,
                    failed: results.failed.length
                },
                details: results
            }
        });
    }
    catch (error) {
        console.error('Bulk import error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to import users',
            error: error.message
        });
    }
});
exports.bulkImportUnitUsers = bulkImportUnitUsers;
