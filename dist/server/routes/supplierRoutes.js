"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const supplierController_js_1 = require("../controllers/supplierController.js");
const router = express_1.default.Router();
// Supplier CRUD routes
router.get('/suppliers', auth_js_1.authenticateToken, supplierController_js_1.getSuppliers);
router.get('/suppliers/:id', auth_js_1.authenticateToken, supplierController_js_1.getSupplierById);
router.post('/suppliers', auth_js_1.authenticateToken, supplierController_js_1.createSupplier);
router.put('/suppliers/:id', auth_js_1.authenticateToken, supplierController_js_1.updateSupplier);
router.delete('/suppliers/:id', auth_js_1.authenticateToken, supplierController_js_1.deleteSupplier);
// Supplier stats
router.get('/suppliers/stats', auth_js_1.authenticateToken, supplierController_js_1.getSupplierStats);
// Excel import/export routes
router.get('/suppliers/export', auth_js_1.authenticateToken, supplierController_js_1.exportSuppliersToExcel);
router.post('/suppliers/import', auth_js_1.authenticateToken, supplierController_js_1.importSuppliersFromExcel);
exports.default = router;
