"use strict";
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
exports.changePassword = exports.getCurrentUser = exports.logout = exports.login = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const auth_js_1 = require("../middleware/auth.js");
const permissions_js_1 = require("../middleware/permissions.js");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const login = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('=== LOGIN CONTROLLER EXECUTING ===');
        console.log('Request body:', req.body);
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }
        const user = yield User_js_1.default.findOne({
            $or: [{ username }, { email: username }],
            isActive: true
        });
        console.log('=== USER LOOKUP RESULT ===');
        console.log('Search username/email:', username);
        console.log('User found:', !!user);
        if (user) {
            console.log('Found user details:', {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                unit: user.unit,
                isActive: user.isActive,
                hasPassword: !!user.password,
                passwordLength: user.password ? user.password.length : 0
            });
        }
        else {
            // Check if user exists but is inactive
            const inactiveUser = yield User_js_1.default.findOne({
                $or: [{ username }, { email: username }]
            });
            if (inactiveUser) {
                console.log('User exists but is INACTIVE:', {
                    username: inactiveUser.username,
                    email: inactiveUser.email,
                    isActive: inactiveUser.isActive
                });
                return res.status(401).json({ message: 'Account is deactivated. Please contact administrator.' });
            }
        }
        if (!user) {
            console.log('No user found with username/email:', username);
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        console.log('=== PASSWORD VERIFICATION ===');
        console.log('Provided password:', password);
        console.log('Stored password hash:', user.password);
        const isPasswordValid = yield bcryptjs_1.default.compare(password, user.password);
        console.log('Password validation result:', isPasswordValid);
        if (!isPasswordValid) {
            console.log('Password mismatch for user:', username);
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        // Update last login
        user.lastLogin = new Date();
        yield user.save();
        const token = (0, auth_js_1.generateToken)(user._id);
        const userModules = (0, permissions_js_1.getUserModules)(user.role);
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        const userResponse = {
            id: user._id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            unit: user.unit,
            isActive: user.isActive,
            modules: userModules,
            lastLogin: user.lastLogin,
            permissions: userModules // Always return simple module names array
        };
        const response = {
            message: 'Login successful',
            success: true,
            user: userResponse,
            token
        };
        console.log('=== LOGIN SUCCESS - SENDING RESPONSE ===');
        console.log('User modules for role', user.role, ':', userModules);
        console.log('Response user permissions:', userResponse.permissions);
        console.log('User:', userResponse.username, 'Role:', userResponse.role);
        res.status(200).json(response);
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.login = login;
const logout = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        res.clearCookie('token');
        res.json({ message: 'Logout successful' });
    }
    catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.logout = logout;
const getCurrentUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }
        const userModulesForCurrentUser = (0, permissions_js_1.getUserModules)(user.role);
        const userResponse = {
            id: user._id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            profilePicture: user.profilePicture,
            role: user.role,
            unit: user.unit || ((_a = user.companyId) === null || _a === void 0 ? void 0 : _a.unitName) || 'Main Unit',
            companyId: ((_b = user.companyId) === null || _b === void 0 ? void 0 : _b._id) || user.companyId,
            company: user.companyId ? {
                id: user.companyId._id || user.companyId,
                name: user.companyId.name,
                unitName: user.companyId.unitName,
                location: user.companyId.city && user.companyId.state ? `${user.companyId.city}, ${user.companyId.state}` : user.companyId.location
            } : null,
            isActive: user.isActive,
            lastLogin: user.lastLogin,
            permissions: userModulesForCurrentUser
        };
        res.json(userResponse);
    }
    catch (error) {
        console.error('Get current user error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.getCurrentUser = getCurrentUser;
const changePassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters long' });
        }
        const user = yield User_js_1.default.findById(req.user._id);
        const isCurrentPasswordValid = yield user.comparePassword(currentPassword);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }
        user.password = newPassword;
        yield user.save();
        res.json({ message: 'Password changed successfully' });
    }
    catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.changePassword = changePassword;
