"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const permissions_js_1 = require("../middleware/permissions.js");
const unitHeadController_js_1 = require("../controllers/unitHeadController.js");
// Import Unit User management functions (all unit roles)
const unitHeadUserController_js_1 = require("../controllers/unitHeadUserController.js");
// Import inventory functions
const inventoryController_js_1 = require("../controllers/inventoryController.js");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(auth_js_1.authenticateToken);
// Unit Head Dashboard
router.get('/dashboard', (0, permissions_js_1.checkPermission)('unitHead', 'dashboard', 'view'), unitHeadController_js_1.getUnitHeadDashboard);
// Unit Head Orders Routes (Full CRUD access)
router.get('/orders', (0, permissions_js_1.checkPermission)('unitHead', 'orders', 'view'), unitHeadController_js_1.getUnitHeadOrders);
router.get('/orders/:id', (0, permissions_js_1.checkPermission)('unitHead', 'orders', 'view'), unitHeadController_js_1.getUnitHeadOrderById);
router.post('/orders', (0, permissions_js_1.checkPermission)('unitHead', 'orders', 'add'), unitHeadController_js_1.createUnitHeadOrder);
router.put('/orders/:id', (0, permissions_js_1.checkPermission)('unitHead', 'orders', 'edit'), unitHeadController_js_1.updateUnitHeadOrder);
router.patch('/orders/:id/status', (0, permissions_js_1.checkPermission)('unitHead', 'orders', 'edit'), unitHeadController_js_1.updateUnitHeadOrderStatus);
router.delete('/orders/:id', (0, permissions_js_1.checkPermission)('unitHead', 'orders', 'delete'), unitHeadController_js_1.deleteUnitHeadOrder);
// Unit Head Sales Routes
router.get('/sales', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'view'), unitHeadController_js_1.getUnitHeadSales);
// Unit Head Sales Persons with their orders
router.get('/sales-persons', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'view'), unitHeadController_js_1.getUnitHeadSalesPersons);
router.get('/sales-persons/:salesPersonId/orders', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'view'), unitHeadController_js_1.getUnitHeadSalesPersonOrders);
// Unit Head Sales Person CRUD Routes
router.get('/sales-persons/:id', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'view'), unitHeadController_js_1.getUnitHeadSalesPersonById);
router.post('/sales-persons', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'add'), unitHeadController_js_1.createUnitHeadSalesPerson);
router.put('/sales-persons/:id', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'edit'), unitHeadController_js_1.updateUnitHeadSalesPerson);
router.delete('/sales-persons/:id', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'delete'), unitHeadController_js_1.deleteUnitHeadSalesPerson);
// Unit Head Customers Routes
router.get('/customers', (0, permissions_js_1.checkPermission)('unitHead', 'customers', 'view'), unitHeadController_js_1.getUnitHeadCustomers);
router.get('/customers/:id', (0, permissions_js_1.checkPermission)('unitHead', 'customers', 'view'), unitHeadController_js_1.getUnitHeadCustomerById);
router.post('/customers', (0, permissions_js_1.checkPermission)('unitHead', 'customers', 'add'), unitHeadController_js_1.createUnitHeadCustomer);
router.put('/customers/:id', (0, permissions_js_1.checkPermission)('unitHead', 'customers', 'edit'), unitHeadController_js_1.updateUnitHeadCustomer);
router.delete('/customers/:id', (0, permissions_js_1.checkPermission)('unitHead', 'customers', 'delete'), unitHeadController_js_1.deleteUnitHeadCustomer);
// Get sales persons for customer assignment dropdown
router.get('/sales-persons-list', (0, permissions_js_1.checkPermission)('unitHead', 'customers', 'view'), unitHeadController_js_1.getUnitHeadSalesPersonsList);
// Unit Head Inventory Routes (Full CRUD access)
// Item routes
router.get('/inventory/items', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.getItems);
router.get('/inventory/items/:id', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.getItemById);
router.post('/inventory/items', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'add'), inventoryController_js_1.createItem);
router.post('/inventory/items/bulk-delete', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'delete'), inventoryController_js_1.bulkDeleteItems);
router.put('/inventory/items/reorder', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'edit'), inventoryController_js_1.reorderItems);
router.put('/inventory/items/:id', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'edit'), inventoryController_js_1.updateItem);
router.delete('/inventory/items/:id', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'delete'), inventoryController_js_1.deleteItem);
router.post('/inventory/items/:id/adjust-stock', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'edit'), inventoryController_js_1.adjustStock);
// Category routes (Full CRUD access)
router.get('/inventory/categories', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.getCategories);
router.post('/inventory/categories', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'add'), inventoryController_js_1.createCategory);
router.put('/inventory/categories/:id', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'edit'), inventoryController_js_1.updateCategory);
router.delete('/inventory/categories/:id', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'delete'), inventoryController_js_1.deleteCategory);
// Customer category routes (Full CRUD access)
router.get('/inventory/customer-categories', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.getCustomerCategories);
router.post('/inventory/customer-categories', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'add'), inventoryController_js_1.createCustomerCategory);
router.put('/inventory/customer-categories/:id', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'edit'), inventoryController_js_1.updateCustomerCategory);
router.delete('/inventory/customer-categories/:id', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'delete'), inventoryController_js_1.deleteCustomerCategory);
// Utility routes (Read-only)
router.get('/inventory/low-stock', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.getLowStockItems);
router.get('/inventory/stats', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.getInventoryStats);
// Excel import/export routes
router.get('/inventory/items/export', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.exportItemsToExcel);
router.post('/inventory/items/import', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'add'), inventoryController_js_1.importItemsFromExcel);
router.get('/inventory/categories/export', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.exportCategoriesToExcel);
router.get('/inventory/customer-categories/export', (0, permissions_js_1.checkPermission)('unitHead', 'inventory', 'view'), inventoryController_js_1.exportCustomerCategoriesToExcel);
// Get Unit Head company information for form pre-population
router.get('/company-info', unitHeadUserController_js_1.getUnitHeadCompanyInfo);
// Unit User Management Routes (All unit roles: Unit Manager, Sales, Production, Accounts, Dispatch, Packing)
router.get('/unit-users', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'view'), unitHeadUserController_js_1.getUnitUsers);
router.get('/unit-users/:userId', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'view'), unitHeadUserController_js_1.getUnitUserById);
router.post('/unit-users', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'add'), unitHeadUserController_js_1.createUnitUser);
router.post('/unit-users/bulk-import', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'add'), unitHeadUserController_js_1.bulkImportUnitUsers);
router.put('/unit-users/:userId', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'edit'), unitHeadUserController_js_1.updateUnitUser);
router.put('/unit-users/:userId/password', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'edit'), unitHeadUserController_js_1.updateUnitUserPassword);
router.delete('/unit-users/:userId', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'delete'), unitHeadUserController_js_1.deleteUnitUser);
// Unit Manager Management Routes (Legacy - for backward compatibility)
router.get('/unit-managers', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'view'), unitHeadUserController_js_1.getUnitManagers);
router.get('/unit-managers/:userId', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'view'), unitHeadUserController_js_1.getUnitManagerById);
router.post('/unit-managers', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'add'), unitHeadUserController_js_1.createUnitManager);
router.put('/unit-managers/:userId', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'edit'), unitHeadUserController_js_1.updateUnitManager);
router.put('/unit-managers/:userId/password', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'edit'), unitHeadUserController_js_1.updateUnitManagerPassword);
router.delete('/unit-managers/:userId', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'delete'), unitHeadUserController_js_1.deleteUnitManager);
router.get('/modules', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'view'), unitHeadUserController_js_1.getUnitManagerModules);
// Unit Head Role Permission Management endpoint
router.get('/role-permission-management', (0, permissions_js_1.checkPermission)('unitHead', 'userManagement', 'view'), (req, res) => {
    res.json({
        success: true,
        message: 'Unit Head Role Permission Management endpoint',
        data: {
            modules: ['Sales', 'Production', 'Inventory', 'Reports'],
            role: 'Unit Manager',
            unit: req.user.unit
        }
    });
});
// ============= PRODUCTION GROUPS ROUTES =============
// Get all production groups with pagination and filtering
router.get('/production-groups', unitHeadController_js_1.getUnitHeadProductionGroups);
// Get single production group with items
router.get('/production-groups/:id', unitHeadController_js_1.getUnitHeadProductionGroupById);
// Create a new production group
router.post('/production-groups', unitHeadController_js_1.createUnitHeadProductionGroup);
// Update a production group
router.put('/production-groups/:id', unitHeadController_js_1.updateUnitHeadProductionGroup);
// Delete (soft delete) a production group
router.delete('/production-groups/:id', unitHeadController_js_1.deleteUnitHeadProductionGroup);
// Get available inventory items for assignment
router.get('/production-groups/items/available', unitHeadController_js_1.getUnitHeadAvailableItems);
// ============ CUTOFF TIME MANAGEMENT ROUTES ============
// Get current cutoff time setting
router.get('/cutoff-time', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'view'), unitHeadController_js_1.getCutoffTime);
// Set or update cutoff time
router.post('/cutoff-time', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'add'), unitHeadController_js_1.setCutoffTime);
router.put('/cutoff-time', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'edit'), unitHeadController_js_1.setCutoffTime);
// Toggle cutoff time active status
router.patch('/cutoff-time/toggle', (0, permissions_js_1.checkPermission)('unitHead', 'sales', 'edit'), unitHeadController_js_1.toggleCutoffTime);
exports.default = router;
