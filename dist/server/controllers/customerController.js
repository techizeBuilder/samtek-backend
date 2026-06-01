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
exports.getCustomersBySalesperson = exports.getCustomerDropdownList = exports.getSalespeople = exports.importCustomersFromExcel = exports.exportCustomersToExcel = exports.getCustomerStats = exports.deleteCustomer = exports.updateCustomer = exports.createCustomer = exports.getCustomerById = exports.getCustomers = exports.validateCustomerQuery = exports.validateCustomer = void 0;
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const XLSX = __importStar(require("xlsx"));
const multer_1 = __importDefault(require("multer"));
const express_validator_1 = require("express-validator");
const notificationService_js_1 = __importDefault(require("../services/notificationService.js"));
const mongoose_1 = __importDefault(require("mongoose"));
// Configure multer for file upload
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
        }
    }
});
// Validation rules for customer creation
exports.validateCustomer = [
    (0, express_validator_1.body)('name')
        .trim()
        .notEmpty()
        .withMessage('Name is required')
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters'),
    (0, express_validator_1.body)('category')
        .notEmpty()
        .withMessage('Category is required')
        .isIn(['Distributor', 'Retailer', 'Wholesaler', 'End User'])
        .withMessage('Category must be one of: Distributor, Retailer, Wholesaler, End User'),
    (0, express_validator_1.body)('active')
        .optional()
        .isIn(['Yes', 'No'])
        .withMessage('Active must be either Yes or No'),
    (0, express_validator_1.body)('gstin')
        .optional()
        .custom((value) => {
        if (value && value.length !== 15) {
            throw new Error('GSTIN must be exactly 15 characters');
        }
        return true;
    }),
    (0, express_validator_1.body)('mobile')
        .notEmpty()
        .withMessage('Mobile number is required')
        .matches(/^[0-9]{10}$/)
        .withMessage('Mobile number must be exactly 10 digits'),
    (0, express_validator_1.body)('email')
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Please enter a valid email address')
        .normalizeEmail(),
    (0, express_validator_1.body)('pin')
        .optional()
        .matches(/^\d{6}$/)
        .withMessage('PIN code must be exactly 6 digits'),
    (0, express_validator_1.body)('notes')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Notes cannot exceed 500 characters'),
    (0, express_validator_1.body)('entityType')
        .optional()
        .isIn(['Individual', 'HUF', 'Company', 'Firm', 'Others'])
        .withMessage('Invalid Entity Type'),
    (0, express_validator_1.body)('tdsSection')
        .optional()
        .isIn(['194C', '194J', '194Q', '206C_1H', 'None'])
        .withMessage('Invalid TDS Section')
];
// Validation rules for queries
exports.validateCustomerQuery = [
    (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    (0, express_validator_1.query)('status')
        .optional()
        .isIn(['Active', 'Inactive'])
        .withMessage('Status filter must be Active or Inactive'),
    (0, express_validator_1.query)('customerType')
        .optional()
        .isIn(['Distributor', 'Retailer', 'Wholesaler', 'End User'])
        .withMessage('Customer type filter is invalid'),
    (0, express_validator_1.query)('sortBy')
        .optional()
        .isIn(['createdAt', 'name', 'category', 'active'])
        .withMessage('Sort field must be one of: createdAt, name, category, active'),
    (0, express_validator_1.query)('sortOrder')
        .optional()
        .isIn(['asc', 'desc'])
        .withMessage('Sort order must be asc or desc')
];
// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array().map(error => ({
                field: error.path,
                message: error.msg,
                value: error.value
            }))
        });
    }
    next();
};
exports.getCustomers = [
    ...exports.validateCustomerQuery,
    handleValidationErrors,
    (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        try {
            const { page = 1, limit = 50, status, customerType, name, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
            // Build filter object
            const filter = {};
            console.log('🔍 getCustomers called by user:', (_a = req.user) === null || _a === void 0 ? void 0 : _a.username, 'Role:', (_b = req.user) === null || _b === void 0 ? void 0 : _b.role);
            // STRICT company filtering based on user role
            if (req.user.role === 'Superadmin' || req.user.role === 'Super Admin') {
                // Super Admin can see all customers
                console.log('🔐 Super Admin access - no company filtering');
            }
            else {
                // ALL other roles MUST have company filtering
                if (!req.user.companyId) {
                    console.error('❌ User has no company assignment:', req.user.username);
                    return res.status(400).json({
                        success: false,
                        message: 'User is not assigned to any company/location. Please contact system administrator.'
                    });
                }
                filter.companyId = new mongoose_1.default.Types.ObjectId(req.user.companyId);
                console.log('✅ Company filtering applied for role', req.user.role, ':', req.user.companyId);
            }
            if (status) {
                // Handle status filter - backend stores 'Yes'/'No' but query might send 'Active'/'Inactive'
                if (status === 'Active')
                    filter.active = 'Yes';
                else if (status === 'Inactive')
                    filter.active = 'No';
                else
                    filter.active = status; // Handle direct 'Yes'/'No' values
            }
            if (customerType)
                filter.category = customerType;
            if (name) {
                filter.$or = [
                    { name: { $regex: name, $options: 'i' } },
                    { contactPerson: { $regex: name, $options: 'i' } },
                    { mobile: { $regex: name, $options: 'i' } },
                    { email: { $regex: name, $options: 'i' } },
                    { city: { $regex: name, $options: 'i' } },
                    { state: { $regex: name, $options: 'i' } }
                ];
            }
            // Build sort object
            const sort = {};
            sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
            // Calculate pagination
            const skip = (parseInt(page) - 1) * parseInt(limit);
            // Execute queries
            const [customers, total] = yield Promise.all([
                Customer_js_1.default.find(filter)
                    .populate('salesContact', 'username email')
                    .populate('companyId', 'name')
                    .sort(sort)
                    .skip(skip)
                    .limit(parseInt(limit))
                    .lean(),
                Customer_js_1.default.countDocuments(filter)
            ]);
            res.json({
                success: true,
                customers,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            });
        }
        catch (error) {
            console.error('Error fetching customers:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching customers',
                error: error.message
            });
        }
    })
];
const getCustomerById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid customer ID format'
            });
        }
        const customer = yield Customer_js_1.default.findById(id)
            .populate('salesContact', 'username email')
            .populate('companyId', 'name');
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }
        res.json({
            success: true,
            customer
        });
    }
    catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching customer',
            error: error.message
        });
    }
});
exports.getCustomerById = getCustomerById;
exports.createCustomer = [
    ...exports.validateCustomer,
    handleValidationErrors,
    (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            // Check for duplicate mobile number
            const existingCustomer = yield Customer_js_1.default.findOne({ mobile: req.body.mobile });
            if (existingCustomer) {
                return res.status(400).json({
                    success: false,
                    message: 'Customer with this mobile number already exists',
                    errors: [{ field: 'mobile', message: 'Mobile number must be unique' }]
                });
            }
            // Check for duplicate email if provided
            if (req.body.email) {
                const existingEmail = yield Customer_js_1.default.findOne({ email: req.body.email });
                if (existingEmail) {
                    return res.status(400).json({
                        success: false,
                        message: 'Customer with this email already exists',
                        errors: [{ field: 'email', message: 'Email must be unique' }]
                    });
                }
            }
            // Prepare customer data with auto-assigned fields
            const customerData = Object.assign(Object.assign({}, req.body), { 
                // Auto-assign company from logged-in user
                companyId: req.user.companyId, 
                // Auto-assign sales contact for Sales users
                salesContact: req.user.role === 'Sales' ? req.user._id || req.user.id : req.body.salesContact || null });
            const customer = new Customer_js_1.default(customerData);
            yield customer.save();
            // Trigger notification for new customer - Sales to Unit Manager + Unit Head
            try {
                yield notificationService_js_1.default.triggerSalesNotification({
                    action: 'customer_added',
                    customerData: {
                        _id: customer._id,
                        name: customer.name
                    },
                    targetUnit: req.user.unit || null,
                    targetCompanyId: req.user.companyId || null,
                    userId: req.user._id || req.user.id
                });
            }
            catch (notificationError) {
                console.error('Failed to send customer notification:', notificationError);
            }
            res.status(201).json({
                success: true,
                message: 'Customer created successfully',
                customer
            });
        }
        catch (error) {
            console.error('Error creating customer:', error);
            if (error.name === 'ValidationError') {
                const errors = Object.values(error.errors).map(err => ({
                    field: err.path,
                    message: err.message
                }));
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors
                });
            }
            res.status(500).json({
                success: false,
                message: 'Error creating customer',
                error: error.message
            });
        }
    })
];
exports.updateCustomer = [
    ...exports.validateCustomer,
    handleValidationErrors,
    (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const { id } = req.params;
            if (!id.match(/^[0-9a-fA-F]{24}$/)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid customer ID format'
                });
            }
            // Check for duplicate mobile number (excluding current customer)
            if (req.body.mobile) {
                const existingCustomer = yield Customer_js_1.default.findOne({
                    mobile: req.body.mobile,
                    _id: { $ne: id }
                });
                if (existingCustomer) {
                    return res.status(400).json({
                        success: false,
                        message: 'Customer with this mobile number already exists',
                        errors: [{ field: 'mobile', message: 'Mobile number must be unique' }]
                    });
                }
            }
            // Check for duplicate email if provided (excluding current customer)
            if (req.body.email) {
                const existingEmail = yield Customer_js_1.default.findOne({
                    email: req.body.email,
                    _id: { $ne: id }
                });
                if (existingEmail) {
                    return res.status(400).json({
                        success: false,
                        message: 'Customer with this email already exists',
                        errors: [{ field: 'email', message: 'Email must be unique' }]
                    });
                }
            }
            // Prepare update data with proper salesContact handling
            const updateData = Object.assign({}, req.body);
            // Handle salesContact field - convert username to ObjectId if needed
            if (req.body.salesContact !== undefined) {
                if (req.body.salesContact === '' || req.body.salesContact === null) {
                    // Handle empty/null values - remove the field
                    delete updateData.salesContact;
                }
                else if (typeof req.body.salesContact === 'string') {
                    // Check if it's already a valid ObjectId string
                    if (req.body.salesContact.match(/^[0-9a-fA-F]{24}$/)) {
                        // It's already an ObjectId string, keep it
                        updateData.salesContact = req.body.salesContact;
                    }
                    else {
                        // It's a username, try to find the user
                        const salesUser = yield User_js_1.default.findOne({ username: req.body.salesContact });
                        if (salesUser) {
                            updateData.salesContact = salesUser._id;
                        }
                        else {
                            // Username not found, remove the field
                            delete updateData.salesContact;
                        }
                    }
                }
            }
            const customer = yield Customer_js_1.default.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
            if (!customer) {
                return res.status(404).json({
                    success: false,
                    message: 'Customer not found'
                });
            }
            res.json({
                success: true,
                message: 'Customer updated successfully',
                customer
            });
        }
        catch (error) {
            console.error('Error updating customer:', error);
            if (error.name === 'ValidationError') {
                const errors = Object.values(error.errors).map(err => ({
                    field: err.path,
                    message: err.message
                }));
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    errors
                });
            }
            res.status(500).json({
                success: false,
                message: 'Error updating customer',
                error: error.message
            });
        }
    })
];
const deleteCustomer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        if (!id.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid customer ID format'
            });
        }
        const customer = yield Customer_js_1.default.findByIdAndDelete(id);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }
        res.json({
            success: true,
            message: 'Customer deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting customer:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting customer',
            error: error.message
        });
    }
});
exports.deleteCustomer = deleteCustomer;
const getCustomerStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [totalCustomers, activeCustomers, distributorCustomers, retailerCustomers, wholesalerCustomers, endUserCustomers] = yield Promise.all([
            Customer_js_1.default.countDocuments(),
            Customer_js_1.default.countDocuments({ active: 'Yes' }),
            Customer_js_1.default.countDocuments({ category: 'Distributor' }),
            Customer_js_1.default.countDocuments({ category: 'Retailer' }),
            Customer_js_1.default.countDocuments({ category: 'Wholesaler' }),
            Customer_js_1.default.countDocuments({ category: 'End User' })
        ]);
        res.json({
            success: true,
            stats: {
                total: totalCustomers,
                active: activeCustomers,
                inactive: totalCustomers - activeCustomers,
                byType: {
                    distributor: distributorCustomers,
                    retailer: retailerCustomers,
                    wholesaler: wholesalerCustomers,
                    endUser: endUserCustomers
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching customer stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching customer statistics',
            error: error.message
        });
    }
});
exports.getCustomerStats = getCustomerStats;
// Export customers to Excel
const exportCustomersToExcel = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const customers = yield Customer_js_1.default.find({}).sort({ createdAt: -1 });
        const excelData = customers.map(customer => ({
            'Customer Code': customer.customerCode || '',
            'Customer Name': customer.customerName || '',
            'Customer Type': customer.customerType || '',
            'Status': customer.status || '',
            'GSTIN': customer.gstin || '',
            'Contact Name': customer.contactName || '',
            'Mobile': customer.mobile || '',
            'Email': customer.email || '',
            'Address Line 1': customer.addressLine1 || '',
            'City': customer.city || '',
            'State': customer.state || '',
            'Country': customer.country || '',
            'PIN': customer.pin || '',
            'Notes': customer.notes || '',
            'Credit Limit': customer.creditLimit || 0,
            'Outstanding Amount': customer.outstandingAmount || 0,
            'Created Date': customer.createdAt ? customer.createdAt.toISOString().split('T')[0] : ''
        }));
        if (excelData.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No customers found to export'
            });
        }
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        // Auto-size columns
        const colWidths = [];
        Object.keys(excelData[0] || {}).forEach(key => {
            const maxLength = Math.max(key.length, ...excelData.map(row => String(row[key] || '').length));
            colWidths.push({ width: Math.min(maxLength + 2, 50) });
        });
        worksheet['!cols'] = colWidths;
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');
        const excelBuffer = XLSX.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx'
        });
        const filename = `customers_export_${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(excelBuffer);
        console.log(`Customers Excel file exported: ${filename} (${excelData.length} records)`);
    }
    catch (error) {
        console.error('Error exporting customers to Excel:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting customers to Excel',
            error: error.message
        });
    }
});
exports.exportCustomersToExcel = exportCustomersToExcel;
// Import customers from Excel
exports.importCustomersFromExcel = [upload.single('file'), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
            }
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            if (jsonData.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Excel file is empty or has no valid data'
                });
            }
            const results = {
                total: jsonData.length,
                successful: 0,
                failed: 0,
                errors: [],
                warnings: []
            };
            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const rowNumber = i + 2;
                try {
                    // Map Excel columns to database fields with multiple possible column names
                    const customerData = {
                        customerName: row['Customer Name'] || row['Name'] || '',
                        customerType: row['Customer Type'] || row['Type'] || 'Retail',
                        status: row['Status'] || 'Active',
                        gstin: row['GSTIN'] || row['GST'] || '',
                        contactName: row['Contact Name'] || row['Contact'] || '',
                        mobile: row['Mobile'] || row['Phone'] || '',
                        email: row['Email'] || '',
                        addressLine1: row['Address Line 1'] || row['Address'] || '',
                        city: row['City'] || '',
                        state: row['State'] || '',
                        country: row['Country'] || 'India',
                        pin: row['PIN'] || row['Pincode'] || '',
                        notes: row['Notes'] || '',
                        creditLimit: parseFloat(row['Credit Limit']) || 0,
                        outstandingAmount: parseFloat(row['Outstanding Amount']) || 0
                    };
                    // Validate required fields
                    if (!customerData.customerName) {
                        results.errors.push(`Row ${rowNumber}: Customer name is required`);
                        results.failed++;
                        continue;
                    }
                    if (!customerData.contactName) {
                        results.errors.push(`Row ${rowNumber}: Contact name is required`);
                        results.failed++;
                        continue;
                    }
                    if (!customerData.mobile) {
                        results.errors.push(`Row ${rowNumber}: Mobile number is required`);
                        results.failed++;
                        continue;
                    }
                    // Validate mobile number format
                    if (!/^[6-9]\d{9}$/.test(customerData.mobile)) {
                        results.errors.push(`Row ${rowNumber}: Mobile number must be 10 digits starting with 6, 7, 8, or 9`);
                        results.failed++;
                        continue;
                    }
                    // Validate customer type
                    if (!['Retail', 'Wholesale', 'Export', 'Distributor', 'Manufacturer'].includes(customerData.customerType)) {
                        results.warnings.push(`Row ${rowNumber}: Invalid customer type "${customerData.customerType}", using "Retail"`);
                        customerData.customerType = 'Retail';
                    }
                    // Validate status
                    if (!['Active', 'Inactive'].includes(customerData.status)) {
                        results.warnings.push(`Row ${rowNumber}: Invalid status "${customerData.status}", using "Active"`);
                        customerData.status = 'Active';
                    }
                    // Check for duplicate mobile number
                    const existingCustomer = yield Customer_js_1.default.findOne({ mobile: customerData.mobile });
                    if (existingCustomer) {
                        // Update existing customer
                        yield Customer_js_1.default.findByIdAndUpdate(existingCustomer._id, customerData, { runValidators: true });
                        results.warnings.push(`Row ${rowNumber}: Customer with mobile ${customerData.mobile} updated`);
                    }
                    else {
                        // Create new customer
                        yield Customer_js_1.default.create(customerData);
                    }
                    results.successful++;
                }
                catch (rowError) {
                    console.error(`Error processing row ${rowNumber}:`, rowError);
                    let errorMessage = rowError.message;
                    if (rowError.name === 'ValidationError') {
                        const validationErrors = Object.values(rowError.errors).map(err => err.message);
                        errorMessage = validationErrors.join(', ');
                    }
                    results.errors.push(`Row ${rowNumber}: ${errorMessage}`);
                    results.failed++;
                }
            }
            res.json({
                success: results.failed === 0,
                message: `Import completed: ${results.successful} successful, ${results.failed} failed`,
                results
            });
        }
        catch (error) {
            console.error('Error importing Excel file:', error);
            res.status(500).json({
                success: false,
                message: 'Error importing Excel file',
                error: error.message
            });
        }
    })];
// Get all salespeople for dropdown
const getSalespeople = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('👥 Getting salespeople list for dropdown');
        const salespeople = yield User_js_1.default.find({
            role: { $in: ['Sales', 'Sales Person', 'Salesman', 'Agent'] }
        }).select('_id fullName username email').sort({ fullName: 1 });
        console.log(`📋 Found ${salespeople.length} salespeople`);
        res.status(200).json({
            success: true,
            data: salespeople,
            count: salespeople.length
        });
    }
    catch (error) {
        console.error('❌ Error fetching salespeople:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching salespeople',
            error: error.message
        });
    }
});
exports.getSalespeople = getSalespeople;
// Get customer list for dropdown
const getCustomerDropdownList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('📋 Getting customer dropdown list');
        const customers = yield Customer_js_1.default.find({
            active: 'Yes'
        }).select('_id name customerCode category entityType tdsSection').sort({ name: 1 });
        console.log(`👥 Found ${customers.length} active customers`);
        res.status(200).json({
            success: true,
            data: customers,
            count: customers.length
        });
    }
    catch (error) {
        console.error('❌ Error fetching customer dropdown list:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching customer dropdown list',
            error: error.message
        });
    }
});
exports.getCustomerDropdownList = getCustomerDropdownList;
// Get customers assigned to specific salesperson
const getCustomersBySalesperson = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { salespersonId } = req.params;
        console.log(`🎯 Getting customers for salesperson: ${salespersonId}`);
        if (!salespersonId) {
            return res.status(400).json({
                success: false,
                message: 'Salesperson ID is required'
            });
        }
        const customers = yield Customer_js_1.default.find({
            salesContact: salespersonId,
            active: 'Yes'
        }).select('_id name customerCode category').sort({ name: 1 });
        console.log(`👥 Found ${customers.length} customers for salesperson ${salespersonId}`);
        res.status(200).json({
            success: true,
            data: customers,
            count: customers.length,
            salespersonId
        });
    }
    catch (error) {
        console.error('❌ Error fetching customers by salesperson:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching customers by salesperson',
            error: error.message
        });
    }
});
exports.getCustomersBySalesperson = getCustomersBySalesperson;
