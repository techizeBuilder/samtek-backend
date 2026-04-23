import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getUnitHeadOrders,
  getUnitHeadOrderById,
  createUnitHeadOrder,
  updateUnitHeadOrder,
  updateUnitHeadOrderStatus,
  deleteUnitHeadOrder,
  getUnitHeadSales,
  getUnitHeadSalesPersons,
  getUnitHeadSalesPersonOrders,
  createUnitHeadSalesPerson,
  updateUnitHeadSalesPerson,
  deleteUnitHeadSalesPerson,
  getUnitHeadSalesPersonById,
  getUnitHeadCustomers,
  getUnitHeadCustomerById,
  createUnitHeadCustomer,
  updateUnitHeadCustomer,
  deleteUnitHeadCustomer,
  getUnitHeadSalesPersonsList,
  getUnitHeadDashboard,
  // Production Groups functions
  getUnitHeadProductionGroups,
  getUnitHeadProductionGroupById,
  createUnitHeadProductionGroup,
  updateUnitHeadProductionGroup,
  deleteUnitHeadProductionGroup,
  getUnitHeadAvailableItems,
  // Cutoff Time functions
  getCutoffTime,
  setCutoffTime,
  toggleCutoffTime
} from '../controllers/unitHeadController.js';

// Import Unit User management functions (all unit roles)
import {
  getUnitUsers,
  createUnitUser,
  updateUnitUser,
  updateUnitUserPassword,
  deleteUnitUser,
  getUnitUserById,
  getUnitHeadCompanyInfo,
  bulkImportUnitUsers,
  // Keep existing functions for backward compatibility
  getUnitManagers,
  createUnitManager,
  updateUnitManager,
  updateUnitManagerPassword,
  deleteUnitManager,
  getUnitManagerById,
  getUnitManagerModules
} from '../controllers/unitHeadUserController.js';

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
  exportCustomerCategoriesToExcel,
  reorderItems
} from '../controllers/inventoryController.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Unit Head Dashboard
router.get('/dashboard', 
  checkPermission('unitHead', 'dashboard', 'view'), 
  getUnitHeadDashboard
);

// Unit Head Orders Routes (Full CRUD access)
router.get('/orders', 
  checkPermission('unitHead', 'orders', 'view'), 
  getUnitHeadOrders
);

router.get('/orders/:id', 
  checkPermission('unitHead', 'orders', 'view'), 
  getUnitHeadOrderById
);

router.post('/orders', 
  checkPermission('unitHead', 'orders', 'add'), 
  createUnitHeadOrder
);

router.put('/orders/:id', 
  checkPermission('unitHead', 'orders', 'edit'), 
  updateUnitHeadOrder
);

router.patch('/orders/:id/status', 
  checkPermission('unitHead', 'orders', 'edit'), 
  updateUnitHeadOrderStatus
);

router.delete('/orders/:id', 
  checkPermission('unitHead', 'orders', 'delete'), 
  deleteUnitHeadOrder
);

// Unit Head Sales Routes
router.get('/sales', 
  checkPermission('unitHead', 'sales', 'view'), 
  getUnitHeadSales
);

// Unit Head Sales Persons with their orders
router.get('/sales-persons', 
  checkPermission('unitHead', 'sales', 'view'), 
  getUnitHeadSalesPersons
);

router.get('/sales-persons/:salesPersonId/orders', 
  checkPermission('unitHead', 'sales', 'view'), 
  getUnitHeadSalesPersonOrders
);

// Unit Head Sales Person CRUD Routes
router.get('/sales-persons/:id', 
  checkPermission('unitHead', 'sales', 'view'), 
  getUnitHeadSalesPersonById
);

router.post('/sales-persons', 
  checkPermission('unitHead', 'sales', 'add'), 
  createUnitHeadSalesPerson
);

router.put('/sales-persons/:id', 
  checkPermission('unitHead', 'sales', 'edit'), 
  updateUnitHeadSalesPerson
);

router.delete('/sales-persons/:id', 
  checkPermission('unitHead', 'sales', 'delete'), 
  deleteUnitHeadSalesPerson
);

// Unit Head Customers Routes
router.get('/customers', 
  checkPermission('unitHead', 'customers', 'view'), 
  getUnitHeadCustomers
);

router.get('/customers/:id', 
  checkPermission('unitHead', 'customers', 'view'), 
  getUnitHeadCustomerById
);

router.post('/customers', 
  checkPermission('unitHead', 'customers', 'add'), 
  createUnitHeadCustomer
);

router.put('/customers/:id', 
  checkPermission('unitHead', 'customers', 'edit'), 
  updateUnitHeadCustomer
);

router.delete('/customers/:id', 
  checkPermission('unitHead', 'customers', 'delete'), 
  deleteUnitHeadCustomer
);

// Get sales persons for customer assignment dropdown
router.get('/sales-persons-list', 
  checkPermission('unitHead', 'customers', 'view'), 
  getUnitHeadSalesPersonsList
);

// Unit Head Inventory Routes (Full CRUD access)
// Item routes
router.get('/inventory/items', 
  checkPermission('unitHead', 'inventory', 'view'), 
  getItems
);

router.get('/inventory/items/:id', 
  checkPermission('unitHead', 'inventory', 'view'), 
  getItemById
);

router.post('/inventory/items', 
  checkPermission('unitHead', 'inventory', 'add'), 
  createItem
);

router.post('/inventory/items/bulk-delete', 
  checkPermission('unitHead', 'inventory', 'delete'), 
  bulkDeleteItems
);

router.put('/inventory/items/reorder',
  checkPermission('unitHead', 'inventory', 'edit'),
  reorderItems
);

router.put('/inventory/items/:id', 
  checkPermission('unitHead', 'inventory', 'edit'), 
  updateItem
);

router.delete('/inventory/items/:id', 
  checkPermission('unitHead', 'inventory', 'delete'), 
  deleteItem
);

router.post('/inventory/items/:id/adjust-stock', 
  checkPermission('unitHead', 'inventory', 'edit'), 
  adjustStock
);


// Category routes (Full CRUD access)
router.get('/inventory/categories', 
  checkPermission('unitHead', 'inventory', 'view'), 
  getCategories
);

router.post('/inventory/categories', 
  checkPermission('unitHead', 'inventory', 'add'), 
  createCategory
);

router.put('/inventory/categories/:id', 
  checkPermission('unitHead', 'inventory', 'edit'), 
  updateCategory
);

router.delete('/inventory/categories/:id', 
  checkPermission('unitHead', 'inventory', 'delete'), 
  deleteCategory
);

// Customer category routes (Full CRUD access)
router.get('/inventory/customer-categories', 
  checkPermission('unitHead', 'inventory', 'view'), 
  getCustomerCategories
);

router.post('/inventory/customer-categories', 
  checkPermission('unitHead', 'inventory', 'add'), 
  createCustomerCategory
);

router.put('/inventory/customer-categories/:id', 
  checkPermission('unitHead', 'inventory', 'edit'), 
  updateCustomerCategory
);

router.delete('/inventory/customer-categories/:id', 
  checkPermission('unitHead', 'inventory', 'delete'), 
  deleteCustomerCategory
);

// Utility routes (Read-only)
router.get('/inventory/low-stock', 
  checkPermission('unitHead', 'inventory', 'view'), 
  getLowStockItems
);

router.get('/inventory/stats', 
  checkPermission('unitHead', 'inventory', 'view'), 
  getInventoryStats
);

// Excel import/export routes
router.get('/inventory/items/export', 
  checkPermission('unitHead', 'inventory', 'view'), 
  exportItemsToExcel
);

router.post('/inventory/items/import', 
  checkPermission('unitHead', 'inventory', 'add'), 
  importItemsFromExcel
);

router.get('/inventory/categories/export', 
  checkPermission('unitHead', 'inventory', 'view'), 
  exportCategoriesToExcel
);

router.get('/inventory/customer-categories/export', 
  checkPermission('unitHead', 'inventory', 'view'), 
  exportCustomerCategoriesToExcel
);

// Get Unit Head company information for form pre-population
router.get('/company-info', getUnitHeadCompanyInfo);

// Unit User Management Routes (All unit roles: Unit Manager, Sales, Production, Accounts, Dispatch, Packing)
router.get('/unit-users', 
  checkPermission('unitHead', 'userManagement', 'view'), 
  getUnitUsers
);

router.get('/unit-users/:userId', 
  checkPermission('unitHead', 'userManagement', 'view'), 
  getUnitUserById
);

router.post('/unit-users', 
  checkPermission('unitHead', 'userManagement', 'add'), 
  createUnitUser
);

router.post('/unit-users/bulk-import', 
  checkPermission('unitHead', 'userManagement', 'add'), 
  bulkImportUnitUsers
);

router.put('/unit-users/:userId', 
  checkPermission('unitHead', 'userManagement', 'edit'), 
  updateUnitUser
);

router.put('/unit-users/:userId/password', 
  checkPermission('unitHead', 'userManagement', 'edit'), 
  updateUnitUserPassword
);

router.delete('/unit-users/:userId', 
  checkPermission('unitHead', 'userManagement', 'delete'), 
  deleteUnitUser
);

// Unit Manager Management Routes (Legacy - for backward compatibility)
router.get('/unit-managers', 
  checkPermission('unitHead', 'userManagement', 'view'), 
  getUnitManagers
);

router.get('/unit-managers/:userId', 
  checkPermission('unitHead', 'userManagement', 'view'), 
  getUnitManagerById
);

router.post('/unit-managers', 
  checkPermission('unitHead', 'userManagement', 'add'), 
  createUnitManager
);

router.put('/unit-managers/:userId', 
  checkPermission('unitHead', 'userManagement', 'edit'), 
  updateUnitManager
);

router.put('/unit-managers/:userId/password', 
  checkPermission('unitHead', 'userManagement', 'edit'), 
  updateUnitManagerPassword
);

router.delete('/unit-managers/:userId', 
  checkPermission('unitHead', 'userManagement', 'delete'), 
  deleteUnitManager
);

router.get('/modules', 
  checkPermission('unitHead', 'userManagement', 'view'), 
  getUnitManagerModules
);

// Unit Head Role Permission Management endpoint
router.get('/role-permission-management', 
  checkPermission('unitHead', 'userManagement', 'view'), 
  (req, res) => {
    res.json({
      success: true,
      message: 'Unit Head Role Permission Management endpoint',
      data: {
        modules: ['Sales', 'Production', 'Inventory', 'Reports'],
        role: 'Unit Manager',
        unit: req.user.unit
      }
    });
  }
);

// ============= PRODUCTION GROUPS ROUTES =============

// Get all production groups with pagination and filtering
router.get('/production-groups', 
  getUnitHeadProductionGroups
);

// Get single production group with items
router.get('/production-groups/:id', 
  getUnitHeadProductionGroupById
);

// Create a new production group
router.post('/production-groups', 
  createUnitHeadProductionGroup
);

// Update a production group
router.put('/production-groups/:id', 
  updateUnitHeadProductionGroup
);

// Delete (soft delete) a production group
router.delete('/production-groups/:id', 
  deleteUnitHeadProductionGroup
);

// Get available inventory items for assignment
router.get('/production-groups/items/available', 
  getUnitHeadAvailableItems
);

// ============ CUTOFF TIME MANAGEMENT ROUTES ============

// Get current cutoff time setting
router.get('/cutoff-time',
  checkPermission('unitHead', 'sales', 'view'),
  getCutoffTime
);

// Set or update cutoff time
router.post('/cutoff-time',
  checkPermission('unitHead', 'sales', 'add'),
  setCutoffTime
);

router.put('/cutoff-time',
  checkPermission('unitHead', 'sales', 'edit'),
  setCutoffTime
);

// Toggle cutoff time active status
router.patch('/cutoff-time/toggle',
  checkPermission('unitHead', 'sales', 'edit'),
  toggleCutoffTime
);

export default router;