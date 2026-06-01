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
exports.uploadProfilePicture = exports.changePassword = exports.updateProfile = exports.getProfile = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const permissions_js_1 = require("../middleware/permissions.js");
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = 'uploads/profiles/';
        if (!fs_1.default.existsSync(uploadPath)) {
            fs_1.default.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Allow only image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});
// Get current user's profile
const getProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        console.log('=== GET PROFILE ROUTE HIT ===');
        console.log('User from request:', req.user);
        // Handle different user ID formats from auth middleware
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.id) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c._id);
        console.log('Looking for user ID:', userId);
        if (!userId) {
            return res.status(401).json({ message: 'User not authenticated' });
        }
        const user = yield User_js_1.default.findById(userId)
            .select('-password')
            .populate('companyId', 'name city state');
        console.log('Found user:', user ? 'Yes' : 'No');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Get simple module names for the user's role
        const userModules = (0, permissions_js_1.getUserModules)(user.role);
        const profileData = {
            id: user._id,
            username: user.username,
            email: user.email,
            fullName: user.fullName,
            profilePicture: user.profilePicture ? `/uploads/profiles/${user.profilePicture}` : null,
            role: user.role,
            unit: user.unit,
            companyId: (_d = user.companyId) === null || _d === void 0 ? void 0 : _d._id,
            company: user.companyId ? {
                id: user.companyId._id,
                name: user.companyId.name,
                location: user.companyId.location
            } : null,
            permissions: userModules, // Use simple module names instead of complex DB permissions
            profile: user.profile
        };
        console.log('Returning profile data:', profileData);
        res.json(profileData);
    }
    catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});
exports.getProfile = getProfile;
// Update profile (fullName and email)
const updateProfile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { fullName, email } = req.body;
        // Handle different user ID formats from auth middleware
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.id) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c._id);
        // Check if email is already taken by another user
        if (email) {
            const existingUser = yield User_js_1.default.findOne({
                email,
                _id: { $ne: userId }
            });
            if (existingUser) {
                return res.status(400).json({ message: 'Email already in use' });
            }
        }
        const updateData = {};
        if (fullName !== undefined)
            updateData.fullName = fullName;
        if (email !== undefined)
            updateData.email = email;
        const user = yield User_js_1.default.findByIdAndUpdate(userId, updateData, { new: true, runValidators: true }).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                fullName: user.fullName,
                profilePicture: user.profilePicture ? `/uploads/profiles/${user.profilePicture}` : null,
                role: user.role,
                unit: user.unit,
                permissions: user.permissions,
                profile: user.profile
            }
        });
    }
    catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});
exports.updateProfile = updateProfile;
// Change password
const changePassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ message: 'Old password and new password are required' });
        }
        // Handle different user ID formats from auth middleware
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.id) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c._id);
        const user = yield User_js_1.default.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Verify old password
        const isValidPassword = yield bcryptjs_1.default.compare(oldPassword, user.password);
        if (!isValidPassword) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }
        // Hash new password
        const saltRounds = 10;
        const hashedNewPassword = yield bcryptjs_1.default.hash(newPassword, saltRounds);
        // Update password
        yield User_js_1.default.findByIdAndUpdate(userId, {
            password: hashedNewPassword
        });
        res.json({ message: 'Password changed successfully' });
    }
    catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});
exports.changePassword = changePassword;
// Upload profile picture
exports.uploadProfilePicture = [
    upload.single('picture'),
    (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }
            // Handle different user ID formats from auth middleware
            const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.userId) || ((_b = req.user) === null || _b === void 0 ? void 0 : _b.id) || ((_c = req.user) === null || _c === void 0 ? void 0 : _c._id);
            const user = yield User_js_1.default.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            // Delete old profile picture if exists
            if (user.profilePicture) {
                const oldImagePath = path_1.default.join('uploads/profiles/', user.profilePicture);
                if (fs_1.default.existsSync(oldImagePath)) {
                    fs_1.default.unlinkSync(oldImagePath);
                }
            }
            // Update user with new profile picture filename
            const updatedUser = yield User_js_1.default.findByIdAndUpdate(userId, { profilePicture: req.file.filename }, { new: true }).select('-password');
            res.json({
                message: 'Profile picture uploaded successfully',
                profilePicture: `/uploads/profiles/${req.file.filename}`,
                user: {
                    id: updatedUser._id,
                    username: updatedUser.username,
                    email: updatedUser.email,
                    fullName: updatedUser.fullName,
                    profilePicture: `/uploads/profiles/${updatedUser.profilePicture}`,
                    role: updatedUser.role,
                    unit: updatedUser.unit,
                    permissions: updatedUser.permissions,
                    profile: updatedUser.profile
                }
            });
        }
        catch (error) {
            console.error('Upload profile picture error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    })
];
