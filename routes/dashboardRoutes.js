import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getDashboardMetrics,
  getProductionChart,
  getSalesChart,
  getRecentOrders,
  getAlerts
} from '../controllers/dashboardController.js';

const router = express.Router();

// Apply authentication to all dashboard routes
router.use(authenticateToken);

// GET /api/dashboard/metrics - Get dashboard metrics
router.get('/metrics', getDashboardMetrics);

// GET /api/dashboard/production-chart - Get production chart data
router.get('/production-chart', getProductionChart);

// GET /api/dashboard/sales-chart - Get sales chart data
router.get('/sales-chart', getSalesChart);

// GET /api/dashboard/recent-orders - Get recent orders
router.get('/recent-orders', getRecentOrders);

// GET /api/dashboard/alerts - Get system alerts
router.get('/alerts', getAlerts);

export default router;