"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const productionController_js_1 = require("../controllers/productionController.js");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(auth_js_1.authenticateToken);
// Production Dashboard
router.get('/dashboard', productionController_js_1.getProductionDashboard);
// Production Reports - All production history data
router.get('/reports', productionController_js_1.getAllProductionReports);
// Ungrouped Items
router.get('/ungrouped-items', productionController_js_1.getUngroupedItems);
// Production Shift Management (includes both grouped and ungrouped items)
router.get('/production-shift', productionController_js_1.getProductionShiftData);
router.get('/production-shift/:groupId', productionController_js_1.getProductionGroupShiftDetails);
// Consolidated Production Updates (handles both grouped and ungrouped items)
router.put('/ungrouped-items/production', productionController_js_1.updateUngroupedItemProduction);
exports.default = router;
