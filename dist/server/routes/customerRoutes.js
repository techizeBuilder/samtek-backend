"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const customerController_js_1 = require("../controllers/customerController.js");
const resetCustomerCollection_js_1 = require("../utils/resetCustomerCollection.js");
const inspectDatabase_js_1 = require("../utils/inspectDatabase.js");
const seedCustomers_js_1 = require("../seed/seedCustomers.js");
const customerBalanceController_js_1 = require("../controllers/customerBalanceController.js");
const router = express_1.default.Router();
// Utility routes (must be before /:id route)
router.post('/customers/reset-collection', auth_js_1.authenticateToken, resetCustomerCollection_js_1.resetCustomerCollectionRoute);
router.post('/customers/seed', auth_js_1.authenticateToken, seedCustomers_js_1.seedCustomersRoute);
router.get('/customers/stats', auth_js_1.authenticateToken, customerController_js_1.getCustomerStats);
router.get('/customers/export', auth_js_1.authenticateToken, customerController_js_1.exportCustomersToExcel);
router.post('/customers/import', auth_js_1.authenticateToken, customerController_js_1.importCustomersFromExcel);
router.get('/customers/recalc-balances', auth_js_1.authenticateToken, customerBalanceController_js_1.recalculateCustomerBalances);
// New dropdown and salesperson-customer APIs
router.get('/customers/dropdown/list', auth_js_1.authenticateToken, customerController_js_1.getCustomerDropdownList);
router.get('/customers/salespeople', auth_js_1.authenticateToken, customerController_js_1.getSalespeople);
router.get('/customers/salesperson/:salespersonId', auth_js_1.authenticateToken, customerController_js_1.getCustomersBySalesperson);
// Customer CRUD routes
router.get('/customers', auth_js_1.authenticateToken, customerController_js_1.getCustomers);
router.post('/customers', auth_js_1.authenticateToken, customerController_js_1.createCustomer);
router.get('/customers/:id', auth_js_1.authenticateToken, customerController_js_1.getCustomerById);
router.put('/customers/:id', auth_js_1.authenticateToken, customerController_js_1.updateCustomer);
router.delete('/customers/:id', auth_js_1.authenticateToken, customerController_js_1.deleteCustomer);
exports.default = router;
