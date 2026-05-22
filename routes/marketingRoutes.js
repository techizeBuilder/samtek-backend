import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { marketingUpload } from '../middleware/marketingUpload.js';
import {
  getDashboard, getAssets, getAsset, createAsset, updateAsset, deleteAsset, shareAsset,
  getCategories, createCategory, updateCategory, deleteCategory,
  getReports, getAuditLogs, getNotifications,
} from '../controllers/marketingController.js';

const router = express.Router();
router.use(authenticateToken);

// Dashboard
router.get('/dashboard', getDashboard);

// Assets
router.get('/assets', getAssets);
router.get('/assets/:id', getAsset);
router.post('/assets', marketingUpload.single('file'), createAsset);
router.put('/assets/:id', updateAsset);
router.delete('/assets/:id', deleteAsset);
router.post('/assets/:id/share', shareAsset);

// Categories
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Reports, Audit, Notifications
router.get('/reports', getReports);
router.get('/audit-logs', getAuditLogs);
router.get('/notifications', getNotifications);

export default router;
