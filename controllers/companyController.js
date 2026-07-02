import { Company } from '../models/Company.js';
import User from '../models/User.js';
import { USER_ROLES } from '../shared/schema.js';
import Lead from '../models/Lead.js';
import Customer from '../models/Customer.js';
import Order from '../models/Order.js';
import Sale from '../models/Sale.js';
import ProductionBatch from '../models/ProductionBatch.js';
import { Item } from '../models/Inventory.js';
import DispatchOrder from '../models/DispatchOrder.js';
import ServiceTicket from '../models/ComplaintServiceModel.js';

// Helper function to check company permissions
const checkCompanyPermission = (user, action) => {
  console.log('Checking company permission for user:', user?.role, 'action:', action);

  // Super Admin has all permissions (support both 'Superadmin' and 'Super Admin' variants)
  if (user?.role === 'Superadmin' || user?.role === 'Super Admin' || user?.role === 'HR-Admin') {
    return true;
  }
  // Unit Head / Company Admin has all company permissions
  if (user?.role === 'Unit Head' || user?.role === 'Company Admin') {
    return true;
  }
  return user?.permissions?.Company?.[action] === true;
};

// Get all companies with filters
export const getCompanies = async (req, res) => {
  try {
    console.log('Get companies request from user:', req.user?.role);

    if (!checkCompanyPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const {
      city,
      unitName,
      name,
      state,
      isActive,
      search,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

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
    if (city) filter.city = new RegExp(city, 'i');
    if (unitName) filter.unitName = new RegExp(unitName, 'i');
    if (name) filter.name = new RegExp(name, 'i');
    if (state) filter.state = new RegExp(state, 'i');
    if (isActive !== undefined) filter.isActive = isActive === 'true';

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
    const companies = await Company.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Company.countDocuments(filter);

    // Get unique cities for filter options
    const cities = await Company.distinct('city', { isActive: true });
    const states = await Company.distinct('state', { isActive: true });

    // Fetch Company Admins for each company (role = 'Company Admin')
    const companyIds = companies.map(c => c._id);
    const admins = await User.find({
      companyId: { $in: companyIds },
      role: 'Company Admin'
    }).select('_id fullName email mobile companyId');

    // Map admins by companyId for quick lookup
    const adminMap = {};
    admins.forEach(admin => {
      const key = admin.companyId?.toString();
      if (key && !adminMap[key]) adminMap[key] = admin;
    });

    // Enrich companies with admin data
    const enrichedCompanies = companies.map(company => {
      const admin = adminMap[company._id.toString()];
      return {
        ...company.toJSON(),
        companyAdmin: admin ? {
          _id: admin._id,
          fullName: admin.fullName,
          email: admin.email,
          mobile: admin.mobile
        } : null
      };
    });

    console.log(`Found ${companies.length} companies, total: ${total}`);

    res.json({
      success: true,
      companies: enrichedCompanies,
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
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get company by ID
export const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    // A user is always allowed to view their own company
    const isOwnCompany = req.user && req.user.companyId && req.user.companyId.toString() === id;

    if (!isOwnCompany && !checkCompanyPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const company = await Company.findById(id);

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json({ company });
  } catch (error) {
    console.error('Get company by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Create new company
export const createCompany = async (req, res) => {
  try {
    console.log('\n=== CREATE COMPANY REQUEST ===');
    console.log('Requested by role:', req.user?.role);
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
    const company = await Company.create(companyData);

    // Create Company Admin if requested
    if (companyData.createAdmin === 'true' || companyData.createAdmin === true) {
      const adminData = {
        fullName: companyData.adminName,
        username: companyData.adminEmail,
        email: companyData.adminEmail,
        password: companyData.adminPassword,
        mobile: companyData.adminPhone,
        role: USER_ROLES.COMPANY_ADMIN,
        companyId: company._id,
        unit: company.unitName,
        permissions: {
          role: USER_ROLES.COMPANY_ADMIN,
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
        passwordLength: adminData.password?.length,
        role: adminData.role,
        companyId: adminData.companyId,
        unit: adminData.unit,
      }, null, 2));

      try {
        const createdAdmin = await User.create(adminData);
        console.log('✅ Company Admin created:', createdAdmin._id, createdAdmin.email);
      } catch (adminError) {
        // Extract detailed validation errors
        let errorDetail = adminError.message;
        if (adminError.name === 'ValidationError') {
          errorDetail = Object.values(adminError.errors).map(e => e.message).join(', ');
        } else if (adminError.code === 11000) {
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
  } catch (error) {
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
};

// Update company
export const updateCompany = async (req, res) => {
  try {
    console.log('Update company request:', {
      userId: req.user?._id,
      userRole: req.user?.role,
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

    const company = await Company.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

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
  } catch (error) {
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
};

// Delete company
export const deleteCompany = async (req, res) => {
  try {
    if (!checkCompanyPermission(req.user, 'delete') || req.user.role === 'Company Admin') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;

    const company = await Company.findByIdAndDelete(id);

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json({
      success: true,
      message: 'Company deleted successfully'
    });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get company statistics
export const getCompanyStats = async (req, res) => {
  try {
    if (!checkCompanyPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const totalCompanies = await Company.countDocuments({ isActive: true });
    const companiesByCity = await Company.aggregate([
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

    const companiesByUnit = await Company.aggregate([
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
  } catch (error) {
    console.error('Get company stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get companies for dropdown/select options
export const getCompaniesDropdown = async (req, res) => {
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
    } else if ((req.user.role === 'Unit Head' || req.user.role === 'Company Admin') && req.user.companyId) {
      // UNIT HEAD / COMPANY ADMIN: Only show their assigned company/location
      filter._id = req.user.companyId;
      console.log(`${req.user.role} location filtering - showing only assigned company:`, req.user.companyId);
    } else if ((req.user.role === 'Unit Manager' || req.user.role === 'Sales' || req.user.role === 'Production') && req.user.companyId) {
      // OTHER ROLES WITH COMPANY: Only show their assigned company
      filter._id = req.user.companyId;
      console.log(`${req.user.role} location filtering - showing only assigned company:`, req.user.companyId);
    }

    if (city) filter.city = new RegExp(city, 'i');
    if (unitName) filter.unitName = new RegExp(unitName, 'i');

    // Global search
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { city: new RegExp(search, 'i') },
        { unitName: new RegExp(search, 'i') }
      ];
    }

    const companies = await Company.find(filter)
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
  } catch (error) {
    console.error('Get companies dropdown error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Simple companies list for public/reusable access (no authentication required)
export const getCompaniesSimple = async (req, res) => {
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

    const companies = await Company.find(filter)
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
  } catch (error) {
    console.error('Get companies simple error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get comprehensive company report
export const getCompanyReport = async (req, res) => {
  try {
    if (!checkCompanyPermission(req.user, 'view')) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;

    // Verify company exists
    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // Dynamically import models to avoid circular dependency issues
    const mongoose = (await import('mongoose')).default;

    // Helper: safe count
    const safeCount = async (modelName, filter) => {
      try {
        const model = mongoose.models[modelName];
        if (!model) return 0;
        return await model.countDocuments(filter);
      } catch {
        return 0;
      }
    };

    // Helper: safe aggregate
    const safeAggregate = async (modelName, pipeline) => {
      try {
        const model = mongoose.models[modelName];
        if (!model) return [];
        return await model.aggregate(pipeline);
      } catch {
        return [];
      }
    };

    // Get users belonging to this company
    const companyUsers = await User.find({ companyId: id }).select('_id');
    const userIds = companyUsers.map(u => u._id);

    // ─── LEADS ───
    const totalLeads = await Lead.countDocuments({ companyId: id });
    const leadsByStatus = await Lead.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const dealWonLeads = leadsByStatus.find(l => l._id === 'Deal Won')?.count || 0;

    // ─── CUSTOMERS ───
    const totalCustomers = await Customer.countDocuments({ companyId: id });

    // ─── ORDERS ───
    const totalOrders = await Order.countDocuments({ companyId: id });
    const ordersByStatus = await Order.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' } } },
      { $sort: { count: -1 } }
    ]);
    const ordersTotalAmount = await Order.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    // ─── SALES ───
    const totalSales = await Sale.countDocuments({ companyId: id });
    const salesTotalAmount = await Sale.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: null, total: { $sum: '$totalAmount' }, paid: { $sum: '$paidAmount' }, balance: { $sum: '$balanceAmount' } } }
    ]);

    // ─── PRODUCTION ───
    const productionAgg = await ProductionBatch.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: {
          _id: null,
          totalQtyAchieved: { $sum: '$qtyAchieved' },
          totalProductionLoss: { $sum: '$productionLoss' }
        }
      }
    ]);
    const productionStatusStats = await ProductionBatch.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$status', count: { $sum: '$qtyAchieved' } } },
      { $sort: { count: -1 } }
    ]);

    // ─── INVENTORY ───
    const totalInventoryItems = await Item.countDocuments({ companyId: id });
    const inventoryStats = await Item.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: null, totalItems: { $sum: 1 }, totalStock: { $sum: '$qty' }, lowStockCount: { $sum: { $cond: [{ $lte: ['$qty', '$minStock'] }, 1, 0] } } } }
    ]);

    // ─── DISPATCH ───
    const totalDispatches = await DispatchOrder.countDocuments({ company: new mongoose.Types.ObjectId(id) });
    const dispatchStats = await DispatchOrder.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    const totalItemsDispatched = await DispatchOrder.countDocuments({ 
      company: new mongoose.Types.ObjectId(id), 
      status: { $in: ['Dispatched', 'In Transit', 'Delivered', 'Closed'] } 
    });

    // ─── COMPLAINTS ───
    const totalComplaints = await ServiceTicket.countDocuments({ companyId: id });
    const complaintsByStatus = await ServiceTicket.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // ─── USERS / EMPLOYEES ───
    const totalUsers = userIds.length;
    const usersByRole = await User.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Company Admin info
    const companyAdmin = await User.findOne({ companyId: id, role: 'Company Admin' })
      .select('fullName email mobile');

    res.json({
      success: true,
      company: {
        _id: company._id,
        name: company.name,
        unitName: company.unitName,
        city: company.city,
        state: company.state,
        isActive: company.isActive
      },
      companyAdmin: companyAdmin ? {
        fullName: companyAdmin.fullName,
        email: companyAdmin.email,
        mobile: companyAdmin.mobile
      } : null,
      report: {
        leads: {
          total: totalLeads,
          dealWon: dealWonLeads,
          byStatus: leadsByStatus
        },
        customers: {
          total: totalCustomers
        },
        orders: {
          total: totalOrders,
          totalAmount: ordersTotalAmount[0]?.total || 0,
          byStatus: ordersByStatus
        },
        sales: {
          total: totalSales,
          totalAmount: salesTotalAmount[0]?.total || 0,
          paidAmount: salesTotalAmount[0]?.paid || 0,
          balanceAmount: salesTotalAmount[0]?.balance || 0
        },
        production: {
          totalQtyProduced: productionAgg[0]?.totalQtyAchieved || 0,
          totalProductionLoss: productionAgg[0]?.totalProductionLoss || 0,
          byStatus: productionStatusStats
        },
        inventory: {
          totalItems: totalInventoryItems,
          totalStock: inventoryStats[0]?.totalStock || 0,
          lowStockCount: inventoryStats[0]?.lowStockCount || 0
        },
        dispatch: {
          total: totalDispatches,
          totalDispatchedItems: totalItemsDispatched,
          byStatus: dispatchStats
        },
        complaints: {
          total: totalComplaints,
          byStatus: complaintsByStatus
        },
        users: {
          total: totalUsers,
          byRole: usersByRole
        }
      }
    });
  } catch (error) {
    console.error('Get company report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate company report'
    });
  }
};