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
const User_js_1 = __importDefault(require("./models/User.js"));
const auth_js_1 = require("./middleware/auth.js");
const userController_js_1 = require("./controllers/userController.js");
const settingsController_js_1 = require("./controllers/settingsController.js");
const brandController_js_1 = require("./controllers/brandController.js");
const productController_js_1 = require("./controllers/productController.js");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const upload_js_1 = require("./middleware/upload.js");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = express_1.default.Router();
// Test route
router.get('/test', (req, res) => {
    console.log('=== TEST ROUTE HIT ===');
    res.json({ message: 'API working', success: true, timestamp: new Date().toISOString() });
});
// Public companies endpoint (no authentication required)
router.get('/companies/public', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { Company } = yield Promise.resolve().then(() => __importStar(require('./models/Company.js')));
        const { search, limit = 100 } = req.query;
        // Build filter object - only active companies
        const filter = { isActive: true };
        // Global search
        if (search) {
            filter.$or = [
                { name: new RegExp(search, 'i') },
                { city: new RegExp(search, 'i') },
                { unitName: new RegExp(search, 'i') }
            ];
        }
        const companies = yield Company.find(filter)
            .select('_id name city state unitName companyType')
            .sort({ name: 1, city: 1 })
            .limit(parseInt(limit));
        // Format for dropdown with consistent structure
        const simpleList = companies.map(company => ({
            value: company._id.toString(),
            label: `${company.name} - ${company.city}, ${company.state}`,
            name: company.name,
            city: company.city,
            state: company.state,
            unitName: company.unitName,
            companyType: company.companyType
        }));
        res.json({
            success: true,
            companies: simpleList,
            count: simpleList.length
        });
    }
    catch (error) {
        console.error('Get companies public error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
}));
// Clean up permissions route - remove production permissions from non-production roles
router.get('/cleanup-permissions', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { cleanupUserPermissions } = yield Promise.resolve().then(() => __importStar(require('./utils/cleanupPermissions.js')));
        const result = yield cleanupUserPermissions();
        res.json(result);
    }
    catch (error) {
        console.error('Cleanup permissions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cleanup permissions',
            error: error.message
        });
    }
}));
// Login route
router.post('/auth/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        console.log('=== LOGIN ROUTE HIT ===');
        console.log('Request body:', req.body);
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }
        console.log('Looking for user with username:', username);
        // Check all users first
        const allUsers = yield User_js_1.default.find({}, 'username email role');
        console.log('All users in database:', allUsers);
        const user = yield User_js_1.default.findOne({
            $or: [
                { username: username },
                { email: username }
            ]
        }).populate('companyId', 'name unitName city state country locationPin address');
        console.log('Found user:', user ? 'Yes' : 'No');
        if (user) {
            console.log('User details:', {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                companyId: (_a = user.companyId) === null || _a === void 0 ? void 0 : _a._id,
                companyLocation: user.companyId ? `${user.companyId.city}, ${user.companyId.state}` : 'No company assigned',
                passwordHash: user.password.substring(0, 20) + '...'
            });
            // Auto-assign company if user doesn't have one (for development/testing)
            if (!user.companyId && (user.role === 'Unit Manager' || user.role === 'Unit Head' || user.role === 'Sales')) {
                console.log('⚠️ User has no company assigned, attempting auto-assignment...');
                try {
                    const { Company } = yield Promise.resolve().then(() => __importStar(require('./models/Company.js')));
                    const defaultCompany = yield Company.findOne({}).select('name unitName city state country locationPin address');
                    if (defaultCompany) {
                        user.companyId = defaultCompany._id;
                        yield user.save();
                        // Reload user with populated company
                        const updatedUser = yield User_js_1.default.findById(user._id).populate('companyId', 'name unitName city state country locationPin address');
                        Object.assign(user, updatedUser._doc);
                        console.log('✅ Auto-assigned company:', {
                            companyName: defaultCompany.name,
                            location: `${defaultCompany.city}, ${defaultCompany.state}`
                        });
                    }
                }
                catch (error) {
                    console.error('Failed to auto-assign company:', error.message);
                }
            }
        }
        if (!user) {
            console.log('User not found');
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        console.log('Comparing password with hash...');
        const isValidPassword = yield bcryptjs_1.default.compare(password, user.password);
        console.log('Password valid:', isValidPassword);
        if (!isValidPassword) {
            console.log('Invalid password');
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        if (!user.isActive) {
            return res.status(401).json({ message: 'Account is disabled' });
        }
        // Generate JWT token
        const token = (0, auth_js_1.generateToken)(user._id.toString());
        // Filter permissions based on user role - remove inappropriate modules
        let filteredPermissions = Object.assign({}, user.permissions);
        console.log('🔍 BEFORE FILTERING - User Role:', user.role);
        console.log('🔍 BEFORE FILTERING - Modules:', user.permissions.modules.map(m => m.name));
        if (user.role === 'Super Admin') {
            console.log('✅ Applying Super Admin filtering');
            // Super Admin should only have superAdmin module
            filteredPermissions.modules = user.permissions.modules.filter(module => module.name === 'superAdmin');
        }
        else if (user.role === 'Unit Head') {
            console.log('✅ Applying Unit Head filtering');
            // Unit Head should only have unitHead module  
            filteredPermissions.modules = user.permissions.modules.filter(module => module.name === 'unitHead');
        }
        else if (user.role === 'Production') {
            console.log('✅ Applying Production filtering');
            // Production should only have production module
            filteredPermissions.modules = user.permissions.modules.filter(module => module.name === 'production');
        }
        else if (user.role === 'HR-Admin') {
            console.log('✅ Applying HR-Admin filtering');
            // HR-Admin should only have hrms module
            filteredPermissions.modules = user.permissions.modules.filter(module => module.name === 'hrms');
        }
        // For other roles, keep all their modules as-is
        console.log('🔍 AFTER FILTERING - Modules:', filteredPermissions.modules.map(m => m.name));
        const userResponse = {
            id: user._id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            profilePicture: user.profilePicture ? `/uploads/profiles/${user.profilePicture}` : null,
            role: user.role,
            permissions: filteredPermissions,
            unit: user.unit || ((_b = user.companyId) === null || _b === void 0 ? void 0 : _b.unitName) || 'Main Unit',
            companyId: (_c = user.companyId) === null || _c === void 0 ? void 0 : _c._id,
            company: user.companyId ? {
                id: user.companyId._id,
                name: user.companyId.name,
                unitName: user.companyId.unitName,
                city: user.companyId.city,
                state: user.companyId.state,
                country: user.companyId.country,
                locationPin: user.companyId.locationPin,
                address: user.companyId.address,
                location: `${user.companyId.city}, ${user.companyId.state}`
            } : null,
            profile: {
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone
            }
        };
        const response = {
            message: 'Login successful',
            success: true,
            user: userResponse,
            token
        };
        res.status(200).json(response);
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}));
// Get current user
router.get('/auth/me', auth_js_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log('=== AUTH/ME ROUTE HIT ===');
        const userId = req.user.userId || req.user._id;
        const user = yield User_js_1.default.findById(userId).select('-password').populate('companyId', 'name unitName city state country locationPin address');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const userResponse = {
            id: user._id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            profilePicture: user.profilePicture ? `/uploads/profiles/${user.profilePicture}` : null,
            role: user.role,
            permissions: user.permissions,
            unit: user.unit || ((_a = user.companyId) === null || _a === void 0 ? void 0 : _a.unitName) || 'Main Unit',
            companyId: (_b = user.companyId) === null || _b === void 0 ? void 0 : _b._id,
            company: user.companyId ? {
                id: user.companyId._id,
                name: user.companyId.name,
                unitName: user.companyId.unitName,
                city: user.companyId.city,
                state: user.companyId.state,
                country: user.companyId.country,
                locationPin: user.companyId.locationPin,
                address: user.companyId.address,
                location: `${user.companyId.city}, ${user.companyId.state}`
            } : null,
            profile: {
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone
            }
        };
        res.json(userResponse);
    }
    catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}));
// Logout route
router.post('/auth/logout', (req, res) => {
    // Client handles token removal from localStorage
    res.json({ message: 'Logged out successfully', success: true });
});
// Change password
router.post('/auth/change-password', auth_js_1.authenticateToken, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== CHANGE PASSWORD ROUTE HIT ===');
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }
        const user = yield User_js_1.default.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const isValidPassword = yield bcryptjs_1.default.compare(currentPassword, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }
        const hashedPassword = yield bcryptjs_1.default.hash(newPassword, 12);
        yield User_js_1.default.findByIdAndUpdate(req.user.userId, { password: hashedPassword });
        res.json({ message: 'Password changed successfully', success: true });
    }
    catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}));
// Middleware to verify token
const verifyToken = auth_js_1.authenticateToken;
// Profile routes are now handled by dedicated profile routes
// User Management Routes (Super User Only) - These come AFTER profile routes
router.get('/users', verifyToken, userController_js_1.getUsers);
router.get('/users/generate-employee-id', verifyToken, userController_js_1.getNextEmployeeId);
router.get('/users/:id', verifyToken, userController_js_1.getUserById);
// profileUpload.single() parses multipart/form-data so req.body is populated
router.post('/users', verifyToken, upload_js_1.profileUpload.single('profilePicture'), userController_js_1.createUser);
router.put('/users/:id', verifyToken, upload_js_1.profileUpload.single('profilePicture'), userController_js_1.updateUser);
router.patch('/users/:id', verifyToken, upload_js_1.profileUpload.single('profilePicture'), userController_js_1.updateUser);
router.patch('/users/:id/profile-picture', verifyToken, upload_js_1.profileUpload.single('profilePicture'), userController_js_1.updateUser);
router.delete('/users/:id', verifyToken, userController_js_1.deleteUser);
router.post('/users/:id/reset-password', verifyToken, userController_js_1.resetUserPassword);
router.put('/users/:id/password', verifyToken, userController_js_1.updateUserPassword);
// Settings Routes (Super Admin Only)
router.get('/settings', verifyToken, settingsController_js_1.getSettings);
router.get('/settings/debug', (req, res) => {
    res.json({ message: 'Debug endpoint working', timestamp: new Date().toISOString() });
});
router.put('/settings/company', verifyToken, settingsController_js_1.updateCompanySettings);
router.put('/settings/system', verifyToken, settingsController_js_1.updateSystemSettings);
router.put('/settings/notifications', verifyToken, settingsController_js_1.updateNotificationSettings);
router.post('/settings/company/logo', verifyToken, settingsController_js_1.upload.single('logo'), settingsController_js_1.uploadCompanyLogo);
// Brand routes
router.get('/brands', verifyToken, brandController_js_1.getBrands);
router.post('/brands', verifyToken, brandController_js_1.createBrand);
router.put('/brands/:id', verifyToken, brandController_js_1.updateBrand);
router.delete('/brands/:id', verifyToken, brandController_js_1.deleteBrand);
// Product routes
router.get('/products', verifyToken, productController_js_1.getProducts);
router.get('/products/:id', verifyToken, productController_js_1.getProductById);
router.post('/products', verifyToken, productController_js_1.createProduct);
router.put('/products/:id', verifyToken, productController_js_1.updateProduct);
router.delete('/products/:id', verifyToken, productController_js_1.deleteProduct);
router.get('/brands/:brandId/products', verifyToken, productController_js_1.getProductsByBrand);
exports.default = router;
