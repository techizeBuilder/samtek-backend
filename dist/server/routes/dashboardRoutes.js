"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const dashboardController_js_1 = require("../controllers/dashboardController.js");
const router = express_1.default.Router();
// Apply authentication to all dashboard routes
router.use(auth_js_1.authenticateToken);
// GET /api/dashboard/metrics - Get dashboard metrics
router.get('/metrics', dashboardController_js_1.getDashboardMetrics);
// GET /api/dashboard/production-chart - Get production chart data
router.get('/production-chart', dashboardController_js_1.getProductionChart);
// GET /api/dashboard/sales-chart - Get sales chart data
router.get('/sales-chart', dashboardController_js_1.getSalesChart);
// GET /api/dashboard/recent-orders - Get recent orders
router.get('/recent-orders', dashboardController_js_1.getRecentOrders);
// GET /api/dashboard/alerts - Get system alerts
router.get('/alerts', dashboardController_js_1.getAlerts);
exports.default = router;
