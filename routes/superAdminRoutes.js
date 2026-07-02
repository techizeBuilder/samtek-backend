import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth.js';
import {
  getSuperAdminDashboard,
  getAllUsers,
  updateUserRole,
  getRoles,
  getSystemModules,
  getSuperAdminOrders,
  getSuperAdminOrderById,
  getSuperAdminSales,
  getSalesPersonById,
  getSuperAdminCustomers,
  getSuperAdminCustomerById,
  getSuperAdminDispatches,
  getSuperAdminDispatchById
} from '../controllers/superAdminController.js';

// Import API Settings functions from leadController
import { getApiSettings, saveApiSettings } from '../controllers/leadController.js';

// Import company management functions
import {
  getCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyStats,
  getCompaniesDropdown,
  getCompanyReport
} from '../controllers/companyController.js';

// Import inventory functions
import {
  getItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  bulkDeleteItems,
  adjustStock,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCustomerCategories,
  createCustomerCategory,
  updateCustomerCategory,
  deleteCustomerCategory,
  getLowStockItems,
  getInventoryStats,
  exportItemsToExcel,
  importItemsFromExcel,
  exportCategoriesToExcel,
  exportCustomerCategoriesToExcel
} from '../controllers/inventoryController.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Debug logging
console.log('🔧 Super Admin routes loading...');
console.log('📁 Available functions:', { 
  getItems: !!getItems,
  createItem: !!createItem,
  bulkDeleteItems: !!bulkDeleteItems,
  deleteItem: !!deleteItem,
  updateItem: !!updateItem
});

// Test endpoint to verify Super Admin API structure
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Super Admin API is working',
    timestamp: new Date().toISOString(),
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role
    }
  });
});

// Super Admin Dashboard
router.get('/dashboard', getSuperAdminDashboard);

// Role and Permission Management Routes
router.get('/users', getAllUsers);
router.put('/users/:userId/role', updateUserRole);
router.get('/roles', getRoles);
router.get('/modules', getSystemModules);

// Role Permission Management (main endpoint for the page)
router.get('/role-permission-management', (req, res) => {
  res.json({
    success: true,
    message: 'Role Permission Management endpoint',
    data: {
      modules: [
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
        'Companies'
      ]
    }
  });
});

// Orders Management
router.get('/orders', getSuperAdminOrders);
router.get('/orders/:id', getSuperAdminOrderById);

// Sales Management  
router.get('/sales', getSuperAdminSales);
router.get('/sales-person/:salesPersonId', getSalesPersonById);

// Customers Management
router.get('/customers', getSuperAdminCustomers);
router.get('/customers/:id', getSuperAdminCustomerById);

// Company Management Routes
router.get('/companies/dropdown', getCompaniesDropdown);
router.get('/companies/stats', getCompanyStats);
router.get('/companies/:id/report', getCompanyReport);
router.get('/companies', getCompanies);
router.get('/companies/:id', getCompanyById);
router.post('/companies', createCompany);
router.put('/companies/:id', updateCompany);
router.delete('/companies/:id', deleteCompany);

// Company Stamp Upload (super-admin path)
const stampStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/company-stamps';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `stamp_${req.params.id}_${Date.now()}${ext}`);
  }
});
const stampUpload = multer({
  storage: stampStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP images are allowed for stamp'));
  }
});
router.put('/companies/:id/stamp', stampUpload.single('stamp'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No stamp image uploaded' });
    }
    const { Company } = await import('../models/Company.js');
    const stampUrl = `/uploads/company-stamps/${req.file.filename}`;
    const company = await Company.findByIdAndUpdate(
      req.params.id,
      { stampUrl },
      { new: true }
    );
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    res.json({ success: true, message: 'Stamp uploaded successfully', stampUrl, company });
  } catch (err) {
    console.error('Stamp upload error (super-admin):', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Inventory Management Routes
router.get('/inventory/items', getItems);
router.get('/inventory/items/:id', getItemById);
router.post('/inventory/items', createItem);

// Test route to debug bulk delete
router.post('/inventory/items/bulk-delete-test', (req, res) => {
  res.json({
    success: true,
    message: 'Test bulk delete route working',
    receivedBody: req.body,
    timestamp: new Date().toISOString()
  });
});

router.post('/inventory/items/bulk-delete', (req, res, next) => {
  console.log('🎯 Bulk delete route hit!', {
    method: req.method,
    path: req.path,
    body: req.body,
    user: req.user?.username
  });
  next();
}, bulkDeleteItems);
router.put('/inventory/items/:id', updateItem);
router.delete('/inventory/items/:id', deleteItem);
router.post('/inventory/items/:id/adjust-stock', adjustStock);

// Category routes
router.get('/inventory/categories', getCategories);
router.post('/inventory/categories', createCategory);
router.put('/inventory/categories/:id', updateCategory);
router.delete('/inventory/categories/:id', deleteCategory);

// Customer category routes
router.get('/inventory/customer-categories', getCustomerCategories);
router.post('/inventory/customer-categories', createCustomerCategory);
router.put('/inventory/customer-categories/:id', updateCustomerCategory);
router.delete('/inventory/customer-categories/:id', deleteCustomerCategory);

// Utility routes
router.get('/inventory/low-stock', getLowStockItems);
router.get('/inventory/stats', getInventoryStats);

// Excel import/export routes
router.get('/inventory/items/export', exportItemsToExcel);
router.post('/inventory/items/import', importItemsFromExcel);
router.get('/inventory/categories/export', exportCategoriesToExcel);
router.get('/inventory/customer-categories/export', exportCustomerCategoriesToExcel);

// Dispatch Routes
router.get('/dispatches', getSuperAdminDispatches);
router.get('/dispatches/:id', getSuperAdminDispatchById);

// ─── API Integration Settings (IndiaMART + Acefone IVR) ───────────────────────
// Super Admin manages API keys, Caller ID, IndiaMART seller mobile globally
router.get('/api-settings', getApiSettings);
router.post('/api-settings', saveApiSettings);

// Get all Sales Employees for assigning in API settings
router.get('/sales-employees', async (req, res) => {
  try {
    const User = (await import('../models/User.js')).default;
    const employees = await User.find({
      companyId: req.query.companyId || req.user.companyId,
      role: { $in: ['Sales Employee', 'Sales', 'Sales Head'] },
      isActive: true
    }).select('fullName username role employeeId designationId').populate('designationId', 'name');
    res.json({ success: true, employees });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;