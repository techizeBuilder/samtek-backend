import Customer from '../models/Customer.js';
import User from '../models/User.js';
import Sale from '../models/Sale.js';
import Order from '../models/Order.js';
import OrderForm from '../models/OrderForm.js';
import * as XLSX from 'xlsx';
import multer from 'multer';
import { body, validationResult, query } from 'express-validator';
import notificationService from '../services/notificationService.js';
import mongoose from 'mongoose';


// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
    }
  }
});

// Validation rules for customer creation
export const validateCustomer = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),

  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .isIn(['Distributor', 'Retailer', 'Wholesaler', 'End User'])
    .withMessage('Category must be one of: Distributor, Retailer, Wholesaler, End User'),

  body('active')
    .optional()
    .isIn(['Yes', 'No'])
    .withMessage('Active must be either Yes or No'),

  body('gstin')
    .optional()
    .custom((value) => {
      if (value && value.length !== 15) {
        throw new Error('GSTIN must be exactly 15 characters');
      }
      return true;
    }),

  body('mobile')
    .notEmpty()
    .withMessage('Mobile number is required')
    .matches(/^[0-9]{10}$/)
    .withMessage('Mobile number must be exactly 10 digits'),

  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please enter a valid email address')
    .normalizeEmail(),

  body('pin')
    .optional()
    .matches(/^\d{6}$/)
    .withMessage('PIN code must be exactly 6 digits'),

  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),

  body('entityType')
    .optional()
    .isIn(['Individual', 'HUF', 'Company', 'Firm', 'Others'])
    .withMessage('Invalid Entity Type'),

  body('tdsSection')
    .optional()
    .isIn(['194C', '194J', '194Q', '206C_1H', 'None'])
    .withMessage('Invalid TDS Section')
];

// Validation rules for queries
export const validateCustomerQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('status')
    .optional()
    .isIn(['Active', 'Inactive'])
    .withMessage('Status filter must be Active or Inactive'),

  query('customerType')
    .optional()
    .isIn(['Distributor', 'Retailer', 'Wholesaler', 'End User'])
    .withMessage('Customer type filter is invalid'),

  query('sortBy')
    .optional()
    .isIn(['createdAt', 'name', 'category', 'active'])
    .withMessage('Sort field must be one of: createdAt, name, category, active'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc')
];

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
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

export const getCustomers = [
  ...validateCustomerQuery,
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        status,
        customerType,
        name,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Build filter object
      const filter = {};

      console.log('🔍 getCustomers called by user:', req.user?.username, 'Role:', req.user?.role);

      // STRICT company filtering based on user role
      if (req.user.role === 'Superadmin' || req.user.role === 'Super Admin') {
        // Super Admin can see all customers
        console.log('🔐 Super Admin access - no company filtering');
      } else {
        // ALL other roles MUST have company filtering
        if (!req.user.companyId) {
          console.error('❌ User has no company assignment:', req.user.username);
          return res.status(400).json({
            success: false,
            message: 'User is not assigned to any company/location. Please contact system administrator.'
          });
        }
        filter.companyId = new mongoose.Types.ObjectId(req.user.companyId);
        console.log('✅ Company filtering applied for role', req.user.role, ':', req.user.companyId);
      }

      if (status) {
        // Handle status filter - backend stores 'Yes'/'No' but query might send 'Active'/'Inactive'
        if (status === 'Active') filter.active = 'Yes';
        else if (status === 'Inactive') filter.active = 'No';
        else filter.active = status; // Handle direct 'Yes'/'No' values
      }
      if (customerType) filter.category = customerType;
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
      const [customers, total] = await Promise.all([
        Customer.find(filter)
          .populate('salesContact', 'username email')
          .populate('companyId', 'name')
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Customer.countDocuments(filter)
      ]);

      // Outstanding only means anything once a Sales Order Form has actually
      // been submitted for this customer — stamp a computed (not stored)
      // hasOrderForm flag so the UI can show '-' instead of '0' until then.
      const custIds = customers.map(c => c._id);
      if (custIds.length) {
        const orders = await Order.find({ customer: { $in: custIds } }).select('_id customer').lean();
        const orderIds = orders.map(o => o._id);
        const forms = orderIds.length
          ? await OrderForm.find({ orderId: { $in: orderIds }, status: 'Submitted' }).select('orderId').lean()
          : [];
        const submittedOrderIds = new Set(forms.map(f => f.orderId.toString()));
        const customersWithForm = new Set(
          orders.filter(o => submittedOrderIds.has(o._id.toString())).map(o => o.customer.toString())
        );
        customers.forEach(c => { c.hasOrderForm = customersWithForm.has(c._id.toString()); });
      }

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
    } catch (error) {
      console.error('Error fetching customers:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching customers',
        error: error.message
      });
    }
  }
];

export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format'
      });
    }

    const customer = await Customer.findById(id)
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
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customer',
      error: error.message
    });
  }
};

export const createCustomer = [
  ...validateCustomer,
  handleValidationErrors,
  async (req, res) => {
    try {
      // Check for duplicate mobile number
      const existingCustomer = await Customer.findOne({ mobile: req.body.mobile });
      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          message: 'Customer with this mobile number already exists',
          errors: [{ field: 'mobile', message: 'Mobile number must be unique' }]
        });
      }

      // Check for duplicate email if provided
      if (req.body.email) {
        const existingEmail = await Customer.findOne({ email: req.body.email });
        if (existingEmail) {
          return res.status(400).json({
            success: false,
            message: 'Customer with this email already exists',
            errors: [{ field: 'email', message: 'Email must be unique' }]
          });
        }
      }

      // Prepare customer data with auto-assigned fields
      const customerData = {
        ...req.body,
        // Auto-assign company from logged-in user
        companyId: req.user.companyId,
        // Auto-assign sales contact for Sales users
        salesContact: req.user.role === 'Sales' ? req.user._id || req.user.id : req.body.salesContact || null
      };

      const customer = new Customer(customerData);
      await customer.save();

      // Trigger notification for new customer - Sales to Unit Manager + Unit Head
      try {
        await notificationService.triggerSalesNotification({
          action: 'customer_added',
          customerData: {
            _id: customer._id,
            name: customer.name
          },
          targetUnit: req.user.unit || null,
          targetCompanyId: req.user.companyId || null,
          userId: req.user._id || req.user.id
        });
      } catch (notificationError) {
        console.error('Failed to send customer notification:', notificationError);
      }

      res.status(201).json({
        success: true,
        message: 'Customer created successfully',
        customer
      });
    } catch (error) {
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
  }
];

export const updateCustomer = [
  ...validateCustomer,
  handleValidationErrors,
  async (req, res) => {
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
        const existingCustomer = await Customer.findOne({
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
        const existingEmail = await Customer.findOne({
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
      const updateData = { ...req.body };

      // Handle salesContact field - convert username to ObjectId if needed
      if (req.body.salesContact !== undefined) {
        if (req.body.salesContact === '' || req.body.salesContact === null) {
          // Handle empty/null values - remove the field
          delete updateData.salesContact;
        } else if (typeof req.body.salesContact === 'string') {
          // Check if it's already a valid ObjectId string
          if (req.body.salesContact.match(/^[0-9a-fA-F]{24}$/)) {
            // It's already an ObjectId string, keep it
            updateData.salesContact = req.body.salesContact;
          } else {
            // It's a username, try to find the user
            const salesUser = await User.findOne({ username: req.body.salesContact });
            if (salesUser) {
              updateData.salesContact = salesUser._id;
            } else {
              // Username not found, remove the field
              delete updateData.salesContact;
            }
          }
        }
      }

      const customer = await Customer.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      );

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
    } catch (error) {
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
  }
];

export const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format'
      });
    }

    const customer = await Customer.findByIdAndDelete(id);
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
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting customer',
      error: error.message
    });
  }
};

export const getCustomerStats = async (req, res) => {
  try {
    const [
      totalCustomers,
      activeCustomers,
      distributorCustomers,
      retailerCustomers,
      wholesalerCustomers,
      endUserCustomers
    ] = await Promise.all([
      Customer.countDocuments(),
      Customer.countDocuments({ active: 'Yes' }),
      Customer.countDocuments({ category: 'Distributor' }),
      Customer.countDocuments({ category: 'Retailer' }),
      Customer.countDocuments({ category: 'Wholesaler' }),
      Customer.countDocuments({ category: 'End User' })
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
  } catch (error) {
    console.error('Error fetching customer stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customer statistics',
      error: error.message
    });
  }
};

// Export customers to Excel
export const exportCustomersToExcel = async (req, res) => {
  try {
    const customers = await Customer.find({}).sort({ createdAt: -1 });

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
      const maxLength = Math.max(
        key.length,
        ...excelData.map(row => String(row[key] || '').length)
      );
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
  } catch (error) {
    console.error('Error exporting customers to Excel:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting customers to Excel',
      error: error.message
    });
  }
};

// Import customers from Excel
export const importCustomersFromExcel = [upload.single('file'), async (req, res) => {
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
        const existingCustomer = await Customer.findOne({ mobile: customerData.mobile });
        if (existingCustomer) {
          // Update existing customer
          await Customer.findByIdAndUpdate(existingCustomer._id, customerData, { runValidators: true });
          results.warnings.push(`Row ${rowNumber}: Customer with mobile ${customerData.mobile} updated`);
        } else {
          // Create new customer
          await Customer.create(customerData);
        }

        results.successful++;
      } catch (rowError) {
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

  } catch (error) {
    console.error('Error importing Excel file:', error);
    res.status(500).json({
      success: false,
      message: 'Error importing Excel file',
      error: error.message
    });
  }
}];

// Get all salespeople for dropdown
export const getSalespeople = async (req, res) => {
  try {
    console.log('👥 Getting salespeople list for dropdown');

    const salespeople = await User.find({
      role: { $in: ['Sales', 'Sales Person', 'Salesman', 'Agent'] }
    }).select('_id fullName username email').sort({ fullName: 1 });

    console.log(`📋 Found ${salespeople.length} salespeople`);

    res.status(200).json({
      success: true,
      data: salespeople,
      count: salespeople.length
    });

  } catch (error) {
    console.error('❌ Error fetching salespeople:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching salespeople',
      error: error.message
    });
  }
};

// Get customer list for dropdown
export const getCustomerDropdownList = async (req, res) => {
  try {
    console.log('📋 Getting customer dropdown list');

    // Build filter object
    const filter = { active: 'Yes' };

    // STRICT company filtering based on user role
    if (req.user.role === 'Superadmin' || req.user.role === 'Super Admin') {
      console.log('🔐 Super Admin access - no company filtering');
    } else {
      if (!req.user.companyId) {
        console.error('❌ User has no company assignment:', req.user.username);
        return res.status(400).json({
          success: false,
          message: 'User is not assigned to any company/location. Please contact system administrator.'
        });
      }
      filter.companyId = new mongoose.Types.ObjectId(req.user.companyId);
      console.log('✅ Company filtering applied for role', req.user.role, ':', req.user.companyId);
    }

    const customers = await Customer.find(filter)
      .select('_id name customerCode category entityType tdsSection outstandingAmount')
      .sort({ name: 1 });

    console.log(`👥 Found ${customers.length} active customers`);

    res.status(200).json({
      success: true,
      data: customers,
      count: customers.length
    });

  } catch (error) {
    console.error('❌ Error fetching customer dropdown list:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customer dropdown list',
      error: error.message
    });
  }
};

// Get customers assigned to specific salesperson
export const getCustomersBySalesperson = async (req, res) => {
  try {
    const { salespersonId } = req.params;
    console.log(`🎯 Getting customers for salesperson: ${salespersonId}`);

    if (!salespersonId) {
      return res.status(400).json({
        success: false,
        message: 'Salesperson ID is required'
      });
    }

    const customers = await Customer.find({
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

  } catch (error) {
    console.error('❌ Error fetching customers by salesperson:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customers by salesperson',
      error: error.message
    });
  }
};

// ─── Order-wise financials for one customer ─────────────────────────────────
// GET /api/customers/:id/order-financials
// A customer can have multiple orders — this breaks Total / Advance / Paid /
// Due down PER ORDER so Accounts can see which order the money belongs to.
// Fetched on-demand (modal / payment form), so list APIs stay light.
export const getCustomerOrderFinancials = async (req, res) => {
  try {
    const { id: customerId } = req.params;
    const companyId = req.user.companyId;

    const customer = await Customer.findOne({ _id: customerId, companyId })
      .select('name customerCode outstandingAmount advancePayment')
      .lean();
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const orders = await Order.find({ customer: customerId, companyId })
      .select('orderCode createdAt leadId totalAmount products status')
      .populate('products.product', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Order Form is the source of truth here (same as the customer's
    // outstanding): Total = form items' Bill Amount, Advance = form's
    // Payment section. Orders without a Submitted form are not listed.
    const forms = await OrderForm.find({
      orderId: { $in: orders.map(o => o._id) },
      status: 'Submitted'
    }).select('orderId items totals receivedAmount paymentType').lean();
    const formByOrder = new Map(forms.map(f => [f.orderId.toString(), f]));

    const CustomerPayment = (await import('../models/CustomerPayment.js')).default;
    const LeadPayment = (await import('../models/LeadPayment.js')).default;

    const orderRows = [];
    let ordersWithoutForm = 0;
    for (const order of orders) {
      const form = formByOrder.get(order._id.toString());
      if (!form) { ordersWithoutForm++; continue; }

      const formItems = (form.items || []).filter(it => !it.hiddenCharge);
      // Total = Bill Amount + GST Amount (GST is charged on top of the bill,
      // same as the Order Form's own "Bill Amt + GST" figure)
      const billSum = form.totals?.billAmount
        ?? formItems.reduce((s, it) => s + (it.billAmount || 0), 0);
      const gstSum = form.totals?.gstAmount
        ?? formItems.reduce((s, it) => s + (it.gstAmount || 0), 0);
      const total = billSum + gstSum;

      // Sale/invoice for this order — Pakka preferred (dual-billing safe)
      const sales = await Sale.find({ order: order._id, companyId })
        .select('totalAmount paidAmount balanceAmount advancedPaymentAmount invoiceType paymentStatus')
        .lean();
      const sale = sales.find(s => s.invoiceType === 'Pakka') || sales[0] || null;

      // Advance = Order Form ke Payment section ka Advance Payment;
      // fallback to invoice/lead payments for older forms with no amount
      let advance = form.paymentType === 'Advance Payment' ? (form.receivedAmount || 0) : 0;
      if (!advance) advance = sale?.advancedPaymentAmount || 0;
      if (!advance && order.leadId) {
        const lps = await LeadPayment.find({ leadId: order.leadId, status: 'Verified', companyId })
          .select('amount').lean();
        advance = lps.reduce((s, p) => s + (p.amount || 0), 0);
      }

      // Receipts recorded against this order (order-wise payments)
      const orderPayments = await CustomerPayment.find({ customer: customerId, order: order._id, companyId })
        .select('amount paymentDate paymentMode referenceNo').lean();
      const receiptsSum = orderPayments.reduce((s, p) => s + (p.amount || 0), 0);

      // Paid (receipts) — invoice allocation is authoritative; if no invoice yet,
      // fall back to the receipts recorded directly against the order
      const paidReceipts = sale ? (sale.paidAmount || 0) : receiptsSum;
      const due = Math.max(0, total - advance - paidReceipts);

      orderRows.push({
        orderId: order._id,
        orderCode: order.orderCode,
        orderDate: order.createdAt,
        productName: formItems.map(it => it.itemName).filter(Boolean).join(', ')
          || order.products?.map(p => p.product?.name).filter(Boolean).join(', ') || '',
        items: formItems.map(it => ({
          itemName: it.itemName || '',
          specification: it.specification || '',
          qty: it.qty || 0,
          // Item price shown to Accounts = Bill Amount + its GST share
          billAmount: (it.billAmount || 0) + (it.gstAmount || 0)
        })),
        total,
        advance,
        paid: paidReceipts,
        due,
        paymentStatus: due <= 0 ? 'Paid' : (advance + paidReceipts) > 0 ? 'Partially Paid' : 'Pending',
        payments: orderPayments
      });
    }

    // Receipts not linked to any order (general / FIFO)
    const unallocatedPayments = await CustomerPayment.find({ customer: customerId, order: null, companyId })
      .select('amount paymentDate paymentMode referenceNo').lean();

    res.json({
      success: true,
      data: {
        customer: {
          _id: customer._id,
          name: customer.name,
          customerCode: customer.customerCode,
          outstandingAmount: customer.outstandingAmount || 0,
          advancePayment: customer.advancePayment || 0
        },
        orders: orderRows,
        ordersWithoutForm,
        unallocated: {
          count: unallocatedPayments.length,
          total: unallocatedPayments.reduce((s, p) => s + (p.amount || 0), 0),
          payments: unallocatedPayments
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching customer order financials:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};