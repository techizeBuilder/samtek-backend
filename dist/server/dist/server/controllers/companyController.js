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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCompaniesSimple = exports.getCompaniesDropdown = exports.getCompanyStats = exports.deleteCompany = exports.updateCompany = exports.createCompany = exports.getCompanyById = exports.getCompanies = void 0;
const Company_js_1 = require("../models/Company.js");
const User_js_1 = __importDefault(require("../models/User.js"));
const schema_js_1 = require("../shared/schema.js");
// Helper function to check company permissions
const checkCompanyPermission = (user, action) => {
    var _a, _b;
    console.log('Checking company permission for user:', user === null || user === void 0 ? void 0 : user.role, 'action:', action);
    // Super Admin has all permissions (support both 'Superadmin' and 'Super Admin' variants)
    if ((user === null || user === void 0 ? void 0 : user.role) === 'Superadmin' || (user === null || user === void 0 ? void 0 : user.role) === 'Super Admin' || (user === null || user === void 0 ? void 0 : user.role) === 'HR-Admin') {
        return true;
    }
    // Unit Head / Company Admin has all company permissions
    if ((user === null || user === void 0 ? void 0 : user.role) === 'Unit Head' || (user === null || user === void 0 ? void 0 : user.role) === 'Company Admin') {
        return true;
    }
    return ((_b = (_a = user === null || user === void 0 ? void 0 : user.permissions) === null || _a === void 0 ? void 0 : _a.Company) === null || _b === void 0 ? void 0 : _b[action]) === true;
};
// Get all companies with filters
const getCompanies = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        console.log('Get companies request from user:', (_a = req.user) === null || _a === void 0 ? void 0 : _a.role);
        if (!checkCompanyPermission(req.user, 'view')) {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }
        const { city, unitName, name, state, isActive, search, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        // Build filter object
        const filter = {};
        // Role-based filtering for non-super admins
        if (req.user.role !== 'Superadmin' && req.user.role !== 'Super Admin' && req.user.role !== 'super_user') {
            if (req.user.companyId) {
                filter._id = req.user.companyId;
                console.log('Restricting companies to assigned company:', req.user.companyId);
            }
        }
        // Individual field filters
        if (city)
            filter.city = new RegExp(city, 'i');
        if (unitName)
            filter.unitName = new RegExp(unitName, 'i');
        if (name)
            filter.name = new RegExp(name, 'i');
        if (state)
            filter.state = new RegExp(state, 'i');
        if (isActive !== undefined)
            filter.isActive = isActive === 'true';
        // Global search across multiple fields
        if (search) {
            filter.$or = [
                { name: new RegExp(search, 'i') },
                { unitName: new RegExp(search, 'i') },
                { city: new RegExp(search, 'i') },
                { state: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') },
                { mobile: new RegExp(search, 'i') }
            ];
        }
        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
        // Get companies with pagination
        const companies = yield Company_js_1.Company.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));
        // Get total count for pagination
        const total = yield Company_js_1.Company.countDocuments(filter);
        // Get unique cities for filter options
        const cities = yield Company_js_1.Company.distinct('city', { isActive: true });
        const states = yield Company_js_1.Company.distinct('state', { isActive: true });
        console.log(`Found ${companies.length} companies, total: ${total}`);
        res.json({
            success: true,
            companies,
            pagination: {
                current: parseInt(page),
                total: Math.ceil(total / parseInt(limit)),
                count: total,
                hasNext: skip + companies.length < total,
                hasPrev: parseInt(page) > 1
            },
            filters: {
                cities: cities.sort(),
                states: states.sort()
            }
        });
    }
    catch (error) {
        console.error('Get companies error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.getCompanies = getCompanies;
// Get company by ID
const getCompanyById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!checkCompanyPermission(req.user, 'view')) {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }
        const { id } = req.params;
        const company = yield Company_js_1.Company.findById(id);
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json({ company });
    }
    catch (error) {
        console.error('Get company by ID error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.getCompanyById = getCompanyById;
// Create new company
const createCompany = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log('\n=== CREATE COMPANY REQUEST ===');
        console.log('Requested by role:', (_a = req.user) === null || _a === void 0 ? void 0 : _a.role);
        console.log('createAdmin flag:', req.body.createAdmin, typeof req.body.createAdmin);
        console.log('adminEmail:', req.body.adminEmail);
        console.log('adminName:', req.body.adminName);
        if (!checkCompanyPermission(req.user, 'create') || req.user.role === 'Company Admin') {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }
        const companyData = req.body;
        // Auto-generate name from unitName if not provided
        if (!companyData.name && companyData.unitName) {
            companyData.name = companyData.unitName;
        }
        // Clean up empty companyType to prevent validation errors
        if (companyData.companyType === '' || companyData.companyType === null) {
            companyData.companyType = undefined;
        }
        // Validate required fields (name is now optional as it can be auto-generated)
        const requiredFields = ['unitName', 'locationPin', 'city', 'state'];
        const missingFields = requiredFields.filter(field => !companyData[field]);
        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields',
                missingFields,
                errors: missingFields.reduce((acc, field) => {
                    acc[field] = `${field} is required`;
                    return acc;
                }, {})
            });
        }
        // Additional validation (only validate if fields are provided)
        if (companyData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyData.email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format',
                errors: { email: 'Please provide a valid email address' }
            });
        }
        if (companyData.mobile && !/^[\+]?[1-9][\d]{0,15}$/.test(companyData.mobile.replace(/[\s\-\(\)]/g, ''))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid mobile number format',
                errors: { mobile: 'Please provide a valid mobile number' }
            });
        }
        if (companyData.locationPin && !/^[1-9][0-9]{5}$/.test(companyData.locationPin)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid PIN code format',
                errors: { locationPin: 'Please provide a valid 6-digit PIN code' }
            });
        }
        if (companyData.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(companyData.pan)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid PAN format',
                errors: { pan: 'Please provide a valid PAN (format: ABCDE1234F)' }
            });
        }
        if (companyData.gst && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/.test(companyData.gst)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid GST format',
                errors: { gst: 'Please provide a valid GST number (15 characters)' }
            });
        }
        // Create company
        const company = yield Company_js_1.Company.create(companyData);
        // Create Company Admin if requested
        if (companyData.createAdmin === 'true' || companyData.createAdmin === true) {
            const adminData = {
                fullName: companyData.adminName,
                username: companyData.adminEmail,
                email: companyData.adminEmail,
                password: companyData.adminPassword,
                mobile: companyData.adminPhone,
                role: schema_js_1.USER_ROLES.COMPANY_ADMIN,
                companyId: company._id,
                unit: company.unitName,
                permissions: {
                    role: schema_js_1.USER_ROLES.COMPANY_ADMIN,
                    canAccessAllUnits: false,
                    modules: [
                        { name: 'hrms', dashboard: true, features: [] }
                    ]
                }
            };
            console.log('\n=== ADMIN DATA BEING SAVED ===');
            console.log(JSON.stringify({
                fullName: adminData.fullName,
                username: adminData.username,
                email: adminData.email,
                passwordLength: (_b = adminData.password) === null || _b === void 0 ? void 0 : _b.length,
                role: adminData.role,
                companyId: adminData.companyId,
                unit: adminData.unit,
            }, null, 2));
            try {
                const createdAdmin = yield User_js_1.default.create(adminData);
                console.log('✅ Company Admin created:', createdAdmin._id, createdAdmin.email);
            }
            catch (adminError) {
                // Extract detailed validation errors
                let errorDetail = adminError.message;
                if (adminError.name === 'ValidationError') {
                    errorDetail = Object.values(adminError.errors).map(e => e.message).join(', ');
                }
                else if (adminError.code === 11000) {
                    const dupField = Object.keys(adminError.keyPattern || {})[0];
                    errorDetail = `A user with this ${dupField} already exists.`;
                }
                console.error('❌ Failed to create company admin:');
                console.error('  Error name:', adminError.name);
                console.error('  Error code:', adminError.code);
                console.error('  Error detail:', errorDetail);
                console.error('  Full error:', adminError);
                return res.status(201).json({
                    success: true,
                    message: 'Company created, but admin creation failed.',
                    company,
                    adminError: errorDetail
                });
            }
        }
        res.status(201).json({
            success: true,
            message: 'Company created successfully',
            company
        });
    }
    catch (error) {
        console.error('Create company error:', error);
        // Handle validation errors
        if (error.name === 'ValidationError') {
            const validationErrors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: 'Validation failed: ' + validationErrors.join(', ')
            });
        }
        // Handle duplicate key errors
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Company with this information already exists'
            });
        }
        // Generic error
        res.status(500).json({
            success: false,
            message: 'Failed to create company. Please try again later.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
exports.createCompany = createCompany;
// Update company
const updateCompany = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        console.log('Update company request:', {
            userId: (_a = req.user) === null || _a === void 0 ? void 0 : _a._id,
            userRole: (_b = req.user) === null || _b === void 0 ? void 0 : _b.role,
            companyId: req.params.id,
            updateData: req.body
        });
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required. Please log in.'
            });
        }
        if (!checkCompanyPermission(req.user, 'edit')) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Insufficient permissions to edit companies.'
            });
        }
        const { id } = req.params;
        const updateData = req.body;
        // Validate company ID format
        if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }
        // Auto-generate name from unitName if name is not provided but unitName is
        if (!updateData.name && updateData.unitName) {
            updateData.name = updateData.unitName;
        }
        // Clean up empty companyType to prevent validation errors
        if (updateData.companyType === '' || updateData.companyType === null) {
            updateData.companyType = undefined;
        }
        console.log('Finding and updating company:', id);
        const company = yield Company_js_1.Company.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found with the provided ID'
            });
        }
        console.log('Company updated successfully:', company._id);
        res.json({
            success: true,
            message: 'Company updated successfully',
            company
        });
    }
    catch (error) {
        console.error('Update company error:', error);
        // Handle validation errors
        if (error.name === 'ValidationError') {
            const validationErrors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: 'Validation failed: ' + validationErrors.join(', ')
            });
        }
        // Handle duplicate key errors
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Company with this information already exists'
            });
        }
        // Handle cast errors (invalid ObjectId)
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            });
        }
        // Generic error
        res.status(500).json({
            success: false,
            message: 'Failed to update company. Please try again later.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
exports.updateCompany = updateCompany;
// Delete company
const deleteCompany = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!checkCompanyPermission(req.user, 'delete') || req.user.role === 'Company Admin') {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }
        const { id } = req.params;
        const company = yield Company_js_1.Company.findByIdAndDelete(id);
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json({
            success: true,
            message: 'Company deleted successfully'
        });
    }
    catch (error) {
        console.error('Delete company error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.deleteCompany = deleteCompany;
// Get company statistics
const getCompanyStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!checkCompanyPermission(req.user, 'view')) {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }
        const totalCompanies = yield Company_js_1.Company.countDocuments({ isActive: true });
        const companiesByCity = yield Company_js_1.Company.aggregate([
            { $match: { isActive: true } },
            {
                $group: {
                    _id: '$city',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);
        const companiesByUnit = yield Company_js_1.Company.aggregate([
            { $match: { isActive: true } },
            {
                $group: {
                    _id: '$unitName',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);
        res.json({
            success: true,
            total: totalCompanies,
            byCity: companiesByCity,
            byUnit: companiesByUnit
        });
    }
    catch (error) {
        console.error('Get company stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.getCompanyStats = getCompanyStats;
// Get companies for dropdown/select options
const getCompaniesDropdown = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!checkCompanyPermission(req.user, 'view')) {
            return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
        }
        const { city, unitName, search } = req.query;
        // Build filter object
        const filter = { isActive: true };
        // Role-based filtering
        if (req.user.role === 'Superadmin' || req.user.role === 'Super Admin') {
            // SUPER ADMIN: Show ALL companies (no filtering)
            console.log('Super Admin access - showing all companies');
        }
        else if ((req.user.role === 'Unit Head' || req.user.role === 'Company Admin') && req.user.companyId) {
            // UNIT HEAD / COMPANY ADMIN: Only show their assigned company/location
            filter._id = req.user.companyId;
            console.log(`${req.user.role} location filtering - showing only assigned company:`, req.user.companyId);
        }
        else if ((req.user.role === 'Unit Manager' || req.user.role === 'Sales' || req.user.role === 'Production') && req.user.companyId) {
            // OTHER ROLES WITH COMPANY: Only show their assigned company
            filter._id = req.user.companyId;
            console.log(`${req.user.role} location filtering - showing only assigned company:`, req.user.companyId);
        }
        if (city)
            filter.city = new RegExp(city, 'i');
        if (unitName)
            filter.unitName = new RegExp(unitName, 'i');
        // Global search
        if (search) {
            filter.$or = [
                { name: new RegExp(search, 'i') },
                { city: new RegExp(search, 'i') },
                { unitName: new RegExp(search, 'i') }
            ];
        }
        const companies = yield Company_js_1.Company.find(filter)
            .select('_id name city state unitName')
            .sort({ name: 1, city: 1 })
            .limit(100); // Limit for dropdown performance
        // Format for dropdown
        const dropdownOptions = companies.map(company => ({
            value: company._id,
            label: `${company.name} - ${company.city}, ${company.state}`,
            name: company.name,
            city: company.city,
            state: company.state,
            unitName: company.unitName
        }));
        res.json({
            success: true,
            companies: dropdownOptions,
            count: dropdownOptions.length
        });
    }
    catch (error) {
        console.error('Get companies dropdown error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.getCompaniesDropdown = getCompaniesDropdown;
// Simple companies list for public/reusable access (no authentication required)
const getCompaniesSimple = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
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
        const companies = yield Company_js_1.Company.find(filter)
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
        console.error('Get companies simple error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.getCompaniesSimple = getCompaniesSimple;
