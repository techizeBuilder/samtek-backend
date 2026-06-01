"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const permissions_js_1 = require("../middleware/permissions.js");
const inventoryController_js_1 = require("../controllers/inventoryController.js");
const router = express_1.default.Router();
// Item routes (temporarily remove permission check for Sales order creation)
router.get('/items', auth_js_1.authenticateToken, inventoryController_js_1.getItems);
router.get('/items/:id', auth_js_1.authenticateToken, inventoryController_js_1.getItemById);
router.post('/items', auth_js_1.authenticateToken, inventoryController_js_1.createItem);
router.post('/items/bulk-delete', auth_js_1.authenticateToken, inventoryController_js_1.bulkDeleteItems);
router.put('/items/:id', auth_js_1.authenticateToken, inventoryController_js_1.updateItem);
router.delete('/items/:id', auth_js_1.authenticateToken, inventoryController_js_1.deleteItem);
router.post('/items/:id/adjust-stock', auth_js_1.authenticateToken, inventoryController_js_1.adjustStock);
// Category routes
router.get('/categories', auth_js_1.authenticateToken, inventoryController_js_1.getCategories);
router.post('/categories', auth_js_1.authenticateToken, inventoryController_js_1.createCategory);
router.put('/categories/:id', auth_js_1.authenticateToken, inventoryController_js_1.updateCategory);
router.delete('/categories/:id', auth_js_1.authenticateToken, inventoryController_js_1.deleteCategory);
// Customer category routes
router.get('/customer-categories', auth_js_1.authenticateToken, inventoryController_js_1.getCustomerCategories);
router.post('/customer-categories', auth_js_1.authenticateToken, inventoryController_js_1.createCustomerCategory);
router.put('/customer-categories/:id', auth_js_1.authenticateToken, inventoryController_js_1.updateCustomerCategory);
router.delete('/customer-categories/:id', auth_js_1.authenticateToken, inventoryController_js_1.deleteCustomerCategory);
// Utility routes
router.get('/inventory/low-stock', auth_js_1.authenticateToken, inventoryController_js_1.getLowStockItems);
router.get('/inventory/stats', auth_js_1.authenticateToken, inventoryController_js_1.getInventoryStats);
// Excel import/export routes
router.get('/items/export', auth_js_1.authenticateToken, inventoryController_js_1.exportItemsToExcel);
router.post('/inventory/items/import', auth_js_1.authenticateToken, inventoryController_js_1.importItemsFromExcel);
router.get('/categories/export', auth_js_1.authenticateToken, inventoryController_js_1.exportCategoriesToExcel);
router.get('/customer-categories/export', auth_js_1.authenticateToken, inventoryController_js_1.exportCustomerCategoriesToExcel);
exports.default = router;
