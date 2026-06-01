"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const marketingUpload_js_1 = require("../middleware/marketingUpload.js");
const marketingController_js_1 = require("../controllers/marketingController.js");
const router = express_1.default.Router();
router.use(auth_js_1.authenticateToken);
// Dashboard
router.get('/dashboard', marketingController_js_1.getDashboard);
// Assets
router.get('/assets', marketingController_js_1.getAssets);
router.get('/assets/:id', marketingController_js_1.getAsset);
router.post('/assets', marketingUpload_js_1.marketingUpload.single('file'), marketingController_js_1.createAsset);
router.put('/assets/:id', marketingController_js_1.updateAsset);
router.delete('/assets/:id', marketingController_js_1.deleteAsset);
router.post('/assets/:id/share', marketingController_js_1.shareAsset);
// Categories
router.get('/categories', marketingController_js_1.getCategories);
router.post('/categories', marketingController_js_1.createCategory);
router.put('/categories/:id', marketingController_js_1.updateCategory);
router.delete('/categories/:id', marketingController_js_1.deleteCategory);
// Reports, Audit, Notifications
router.get('/reports', marketingController_js_1.getReports);
router.get('/audit-logs', marketingController_js_1.getAuditLogs);
router.get('/notifications', marketingController_js_1.getNotifications);
exports.default = router;
