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
exports.updateUserPassword = exports.resetUserPassword = exports.deleteUser = exports.updateUser = exports.createUser = exports.getUserById = exports.getUsers = exports.getNextEmployeeId = void 0;
const User_js_1 = __importDefault(require("../models/User.js"));
const Company_js_1 = require("../models/Company.js");
const schema_js_1 = require("../shared/schema.js");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const employeeUtils_js_1 = require("../utils/employeeUtils.js");
const getNextEmployeeId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { companyId } = req.query;
        const nextId = yield (0, employeeUtils_js_1.generateEmployeeId)(companyId);
        return res.json({ employeeId: nextId });
    }
    catch (error) {
        console.error("Generate Employee ID error:", error);
        return res.status(500).json({ message: "Failed to generate employee ID" });
    }
});
exports.getNextEmployeeId = getNextEmployeeId;
const getUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const currentUser = req.user;
        const { page = 1, limit = 15, role, unit, search, status, companyId, // Extract companyId from frontend
        sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        const skip = (page - 1) * parseInt(limit);
        let query = {};
        // 1. Enforce Role-Based Data Isolation
        if (currentUser.role !== 'Superadmin' && currentUser.role !== 'Super Admin' && currentUser.role !== 'super_user') {
            // Non-super admins MUST be restricted to their own company
            if (currentUser.companyId) {
                query.companyId = currentUser.companyId;
            }
            else {
                // If an HR-Admin somehow lacks a companyId, prevent them from seeing ALL companies!
                // We set it to a non-existent value so they don't leak other companies' users.
                query.companyId = null;
            }
            // If role is Manager, only show users reporting to them
            if (currentUser.role === 'Manager') {
                query.reportingManager = currentUser._id;
            }
            // Filter by unit only if the current user has a specific unit assigned in the DB
            if (currentUser.unit && currentUser.unit !== ((_a = currentUser.company) === null || _a === void 0 ? void 0 : _a.unitName)) {
                query.unit = currentUser.unit;
            }
        }
        else {
            // If Super Admin, they can filter by companyId from frontend
            if (companyId && companyId !== 'all') {
                query.companyId = companyId;
            }
        }
        // 2. Apply Frontend Filters
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
        if (unit && unit !== 'all') {
            query.unit = unit;
        }
        if (status && status !== 'all') {
            query.isActive = status === 'active';
        }
        // 3. Execute Query
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        // Use mongoose.Types.ObjectId for aggregation match if it's a string
        const aggregateQuery = Object.assign({}, query);
        if (aggregateQuery.companyId && typeof aggregateQuery.companyId === 'string') {
            try {
                const mongoose = yield Promise.resolve().then(() => __importStar(require('mongoose')));
                aggregateQuery.companyId = new mongoose.default.Types.ObjectId(aggregateQuery.companyId);
            }
            catch (e) {
                console.error('ObjectId casting error:', e);
            }
        }
        console.log('=== getUsers Query ===', JSON.stringify(query));
        const [users, totalUsers] = yield Promise.all([
            User_js_1.default.find(query)
                .select('-password')
                .populate('companyId', 'name unitName city state displayName')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            User_js_1.default.countDocuments(query)
        ]);
        // 4. Get Summary for the restricted scope
        const stats = yield User_js_1.default.aggregate([
            { $match: aggregateQuery }, // Use the casted query for aggregate!
            {
                $group: {
                    _id: null,
                    totalUsers: { $sum: 1 },
                    activeUsers: {
                        $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
                    },
                    roleBreakdown: { $push: '$role' }
                }
            }
        ]);
        const summaryData = stats[0] || { totalUsers: 0, activeUsers: 0, roleBreakdown: [] };
        const roleStats = {};
        if (summaryData.roleBreakdown) {
            summaryData.roleBreakdown.forEach(r => {
                roleStats[r] = (roleStats[r] || 0) + 1;
            });
        }
        // 5. Return Response
        res.status(200).json({
            success: true,
            users,
            data: {
                users,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalUsers,
                    pages: Math.ceil(totalUsers / limit)
                }
            },
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalUsers,
                pages: Math.ceil(totalUsers / limit)
            },
            summary: {
                totalUsers: summaryData.totalUsers,
                activeUsers: summaryData.activeUsers,
                inactiveUsers: summaryData.totalUsers - summaryData.activeUsers,
                roleStats
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
exports.getUsers = getUsers;
const getUserById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const user = yield User_js_1.default.findById(id)
            .select('-password')
            .populate('companyId', 'name unitName city state displayName')
            .populate('branchId', 'name')
            .populate('departmentId', 'name')
            .populate('designationId', 'name')
            .populate('reportingManager', 'fullName name email profilePicture');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Allow access (unit restrictions removed)
        res.json({ user });
    }
    catch (error) {
        console.error('Get user by ID error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.getUserById = getUserById;
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, email, password, fullName, role, unit, companyId, branchId, departmentId, designationId, permissions, isActive, mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType, employeeId, isTrainee, technicianSkills, serviceZone // 🔥 NEW: Added Technician Fields
         } = req.body;
        if (!email || !password || !role) {
            return res.status(400).json({ message: 'Email, password, and role are required', success: false });
        }
        const existingUser = yield User_js_1.default.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already exists', success: false });
        }
        let finalCompanyId = companyId;
        let finalUnit = unit;
        if (req.user && (req.user.role === 'HR-Admin' || req.user.role === 'Hr Admin' || req.user.role === 'Company Admin')) {
            finalCompanyId = req.user.companyId || finalCompanyId;
            finalUnit = req.user.unit || finalUnit;
        }
        let parsedPermissions = permissions;
        if (permissions) {
            try {
                if (typeof permissions === 'string')
                    parsedPermissions = JSON.parse(permissions);
                if (typeof parsedPermissions === 'string')
                    parsedPermissions = JSON.parse(parsedPermissions);
            }
            catch (e) {
                parsedPermissions = { role: role, canAccessAllUnits: false, modules: [] };
            }
        }
        const defaultPermissions = parsedPermissions || { role: role, canAccessAllUnits: false, modules: [] };
        if (!defaultPermissions.role)
            defaultPermissions.role = role;
        // 🔥 AUTOMATIC LMS FEATURE INJECTION (FRONTEND FIX)
        const finalIsTrainee = isTrainee === true || isTrainee === 'true';
        if (finalIsTrainee) {
            if (defaultPermissions.modules && defaultPermissions.modules.length > 0) {
                const primaryModule = defaultPermissions.modules[0];
                if (!primaryModule.features) {
                    primaryModule.features = [];
                }
                const hasLmsFeature = primaryModule.features.some(f => f.key === 'traineeDashboard');
                if (!hasLmsFeature) {
                    primaryModule.features.push({
                        key: "traineeDashboard",
                        view: true,
                        add: false,
                        edit: false,
                        delete: false,
                        alter: false
                    });
                }
            }
        }
        let finalEmployeeId = employeeId;
        if (!finalEmployeeId && finalCompanyId) {
            // Ensure generateEmployeeId is imported
            finalEmployeeId = yield (0, employeeUtils_js_1.generateEmployeeId)(finalCompanyId);
        }
        // 🔥 PARSE TECHNICIAN SKILLS
        // Safely handles arrays, JSON strings, or comma-separated strings from the frontend
        let finalSkills = [];
        if (technicianSkills) {
            if (Array.isArray(technicianSkills)) {
                finalSkills = technicianSkills;
            }
            else if (typeof technicianSkills === 'string') {
                try {
                    finalSkills = JSON.parse(technicianSkills);
                }
                catch (e) {
                    finalSkills = technicianSkills.split(',').map(s => s.trim());
                }
            }
        }
        const userData = {
            username: username || email.toLowerCase(),
            email: email.toLowerCase(),
            password,
            fullName: fullName || '',
            role,
            unit: finalUnit || '',
            companyId: finalCompanyId || null,
            branchId: branchId || null,
            departmentId: departmentId || null,
            designationId: designationId || null,
            isActive: isActive !== undefined ? isActive : true,
            isTrainee: finalIsTrainee,
            permissions: defaultPermissions,
            employeeId: finalEmployeeId,
            mobile: mobile || '',
            gender: gender || '',
            dob: dob || null,
            joiningDate: joiningDate || new Date(),
            reportingManager: reportingManager || managerId || null,
            employeeType: employeeType || employmentType || '',
            // 🔥 INJECT TECHNICIAN FIELDS
            // Only attach these if the user is actually a Complaint Management Employee
            technicianSkills: role === 'Complaint Management Employee' ? finalSkills : [],
            serviceZone: role === 'Complaint Management Employee' ? (serviceZone || finalUnit || '') : ''
        };
        const user = new User_js_1.default(userData);
        yield user.save();
        const _a = user.toObject(), { password: _ } = _a, userWithoutPassword = __rest(_a, ["password"]);
        res.status(201).json({ message: 'User created successfully', success: true, user: userWithoutPassword });
    }
    catch (error) {
        console.error('Create user error:', error);
        // Mongoose validation error (e.g. role not in enum, required field missing)
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message).join(', ');
            return res.status(400).json({ message: messages, success: false });
        }
        // Duplicate key (email or username already exists)
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0] || 'field';
            return res.status(400).json({ message: `${field} already exists`, success: false });
        }
        res.status(500).json({
            message: error.message || 'Internal server error',
            success: false
        });
    }
});
exports.createUser = createUser;
const updateUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        console.log('Update user request:', id, req.body);
        const { username, email, password, fullName, role, unit, companyId, branchId, departmentId, designationId, permissions, isActive, mobile, gender, dob, joiningDate, reportingManager, managerId, employeeType, employmentType, employeeId } = req.body;
        // Check if user exists
        const user = yield User_js_1.default.findById(id);
        if (!user) {
            return res.status(404).json({
                message: 'User not found',
                success: false
            });
        }
        // Validate fields ONLY if they are provided
        if (email) {
            // Check for duplicate email (excluding current user)
            const existingUser = yield User_js_1.default.findOne({
                _id: { $ne: id },
                email: email.toLowerCase()
            });
            if (existingUser) {
                return res.status(400).json({
                    message: 'Email already exists',
                    success: false
                });
            }
        }
        const updateData = {};
        // Map status to isActive
        if (req.body.status !== undefined) {
            updateData.isActive = req.body.status === 'ACTIVE' || req.body.status === 'active' || req.body.status === true;
        }
        else if (isActive !== undefined) {
            updateData.isActive = isActive;
        }
        if (username !== undefined)
            updateData.username = username || (email === null || email === void 0 ? void 0 : email.toLowerCase());
        if (email !== undefined)
            updateData.email = email.toLowerCase();
        if (fullName !== undefined)
            updateData.fullName = fullName;
        if (role !== undefined)
            updateData.role = role;
        if (unit !== undefined)
            updateData.unit = unit;
        if (companyId !== undefined)
            updateData.companyId = companyId || null;
        if (branchId !== undefined)
            updateData.branchId = branchId || null;
        if (departmentId !== undefined)
            updateData.departmentId = departmentId || null;
        if (designationId !== undefined)
            updateData.designationId = designationId || null;
        if (employeeId !== undefined)
            updateData.employeeId = employeeId;
        if (permissions !== undefined) {
            let parsedPermissions = permissions;
            try {
                if (typeof permissions === 'string') {
                    parsedPermissions = JSON.parse(permissions);
                }
                if (typeof parsedPermissions === 'string') {
                    parsedPermissions = JSON.parse(parsedPermissions);
                }
            }
            catch (e) {
                console.error('Failed to parse permissions:', e);
            }
            updateData.permissions = parsedPermissions;
        }
        // HRMS fields
        if (mobile !== undefined)
            updateData.mobile = mobile;
        if (gender !== undefined)
            updateData.gender = gender;
        if (dob !== undefined)
            updateData.dob = dob || null;
        if (joiningDate !== undefined)
            updateData.joiningDate = joiningDate || null;
        if (reportingManager !== undefined || managerId !== undefined) {
            updateData.reportingManager = reportingManager || managerId || null;
        }
        if (employeeType !== undefined || employmentType !== undefined) {
            updateData.employeeType = employeeType || employmentType || '';
        }
        // Profile Picture
        if (req.file) {
            updateData.profilePicture = req.file.filename;
        }
        // Hash password if provided
        if (password && password.trim() !== '') {
            const hashedPassword = yield bcryptjs_1.default.hash(password, 12);
            updateData.password = hashedPassword;
        }
        console.log('Updating user with data:', updateData);
        const updatedUser = yield User_js_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).select('-password');
        console.log('User updated successfully:', updatedUser);
        res.json({
            message: 'User updated successfully',
            success: true,
            user: updatedUser
        });
    }
    catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            message: 'Internal server error',
            success: false,
            error: error.message
        });
    }
});
exports.updateUser = updateUser;
const deleteUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const user = yield User_js_1.default.findById(id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Allow deletion (unit restrictions removed)
        // Prevent deleting yourself
        if (user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ message: 'Cannot delete your own account' });
        }
        yield User_js_1.default.findByIdAndDelete(id);
        res.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.deleteUser = deleteUser;
const resetUserPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        console.log('Reset password request:', { id, newPassword: newPassword ? '***' : 'missing' });
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters long' });
        }
        const user = yield User_js_1.default.findById(id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        console.log('Found user for password reset:', { username: user.username, role: user.role });
        // Non-super users can only reset passwords for users from their unit
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER && user.unit !== req.user.unit) {
            return res.status(403).json({ message: 'Access denied' });
        }
        // Hash the new password using the pre-save middleware
        user.password = newPassword;
        yield user.save();
        console.log('Password reset successful for user:', user.username);
        res.json({ message: 'Password reset successfully' });
    }
    catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.resetUserPassword = resetUserPassword;
// Update user password - specific endpoint for password updates with encryption
const updateUserPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        console.log('=== UPDATE PASSWORD ROUTE HIT ===');
        console.log('User ID:', id);
        console.log('Has newPassword:', !!newPassword);
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }
        // Hash the new password with bcrypt for encryption
        const hashedPassword = yield bcryptjs_1.default.hash(newPassword, 12);
        console.log('Password hashed successfully with bcrypt');
        const user = yield User_js_1.default.findByIdAndUpdate(id, {
            password: hashedPassword,
            updatedAt: new Date()
        }, { new: true }).select('-password');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        console.log('Password updated successfully for user:', user.username);
        res.json({
            success: true,
            message: 'Password updated successfully',
            user
        });
    }
    catch (error) {
        console.error('Update password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during password update'
        });
    }
});
exports.updateUserPassword = updateUserPassword;
