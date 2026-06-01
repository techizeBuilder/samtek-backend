"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const superAdminController_js_1 = require("../controllers/superAdminController.js");
// Import company management functions
const companyController_js_1 = require("../controllers/companyController.js");
// Import inventory functions
const inventoryController_js_1 = require("../controllers/inventoryController.js");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(auth_js_1.authenticateToken);
// Debug logging
console.log('🔧 Super Admin routes loading...');
console.log('📁 Available functions:', {
    getItems: !!inventoryController_js_1.getItems,
    createItem: !!inventoryController_js_1.createItem,
    bulkDeleteItems: !!inventoryController_js_1.bulkDeleteItems,
    deleteItem: !!inventoryController_js_1.deleteItem,
    updateItem: !!inventoryController_js_1.updateItem
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
router.get('/dashboard', superAdminController_js_1.getSuperAdminDashboard);
// Role and Permission Management Routes
router.get('/users', superAdminController_js_1.getAllUsers);
router.put('/users/:userId/role', superAdminController_js_1.updateUserRole);
router.get('/roles', superAdminController_js_1.getRoles);
router.get('/modules', superAdminController_js_1.getSystemModules);
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
router.get('/orders', superAdminController_js_1.getSuperAdminOrders);
router.get('/orders/:id', superAdminController_js_1.getSuperAdminOrderById);
// Sales Management  
router.get('/sales', superAdminController_js_1.getSuperAdminSales);
router.get('/sales-person/:salesPersonId', superAdminController_js_1.getSalesPersonById);
// Customers Management
router.get('/customers', superAdminController_js_1.getSuperAdminCustomers);
router.get('/customers/:id', superAdminController_js_1.getSuperAdminCustomerById);
// Company Management Routes
router.get('/companies/dropdown', companyController_js_1.getCompaniesDropdown);
router.get('/companies/stats', companyController_js_1.getCompanyStats);
router.get('/companies', companyController_js_1.getCompanies);
router.get('/companies/:id', companyController_js_1.getCompanyById);
router.post('/companies', companyController_js_1.createCompany);
router.put('/companies/:id', companyController_js_1.updateCompany);
router.delete('/companies/:id', companyController_js_1.deleteCompany);
// Inventory Management Routes
router.get('/inventory/items', inventoryController_js_1.getItems);
router.get('/inventory/items/:id', inventoryController_js_1.getItemById);
router.post('/inventory/items', inventoryController_js_1.createItem);
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
    var _a;
    console.log('🎯 Bulk delete route hit!', {
        method: req.method,
        path: req.path,
        body: req.body,
        user: (_a = req.user) === null || _a === void 0 ? void 0 : _a.username
    });
    next();
}, inventoryController_js_1.bulkDeleteItems);
router.put('/inventory/items/:id', inventoryController_js_1.updateItem);
router.delete('/inventory/items/:id', inventoryController_js_1.deleteItem);
router.post('/inventory/items/:id/adjust-stock', inventoryController_js_1.adjustStock);
// Category routes
router.get('/inventory/categories', inventoryController_js_1.getCategories);
router.post('/inventory/categories', inventoryController_js_1.createCategory);
router.put('/inventory/categories/:id', inventoryController_js_1.updateCategory);
router.delete('/inventory/categories/:id', inventoryController_js_1.deleteCategory);
// Customer category routes
router.get('/inventory/customer-categories', inventoryController_js_1.getCustomerCategories);
router.post('/inventory/customer-categories', inventoryController_js_1.createCustomerCategory);
router.put('/inventory/customer-categories/:id', inventoryController_js_1.updateCustomerCategory);
router.delete('/inventory/customer-categories/:id', inventoryController_js_1.deleteCustomerCategory);
// Utility routes
router.get('/inventory/low-stock', inventoryController_js_1.getLowStockItems);
router.get('/inventory/stats', inventoryController_js_1.getInventoryStats);
// Excel import/export routes
router.get('/inventory/items/export', inventoryController_js_1.exportItemsToExcel);
router.post('/inventory/items/import', inventoryController_js_1.importItemsFromExcel);
router.get('/inventory/categories/export', inventoryController_js_1.exportCategoriesToExcel);
router.get('/inventory/customer-categories/export', inventoryController_js_1.exportCustomerCategoriesToExcel);
// Dispatch Routes
router.get('/dispatches', superAdminController_js_1.getSuperAdminDispatches);
router.get('/dispatches/:id', superAdminController_js_1.getSuperAdminDispatchById);
exports.default = router;
