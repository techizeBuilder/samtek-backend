import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getHrmsDashboardStats } from '../controllers/hrmsDashboardController.js';

const router = express.Router();

// Apply authentication
router.use(authenticateToken);

// GET /api/hrms-dashboard/stats
router.get('/stats', getHrmsDashboardStats);

export default router;
