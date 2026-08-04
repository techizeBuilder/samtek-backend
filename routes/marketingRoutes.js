import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { marketingUpload } from '../middleware/marketingUpload.js';
import {
  getDashboard, getAssets, getAsset, createAsset, updateAsset, deleteAsset, shareAsset,
  getCategories, createCategory, updateCategory, deleteCategory,
  getReports, getAuditLogs, getNotifications,
  getItemFilters, getMarketingItems, uploadItemMedia,
} from '../controllers/marketingController.js';
import {
  createRequest, getMyRequests, getAllRequests,
  getMatchingAssets, approveRequest, rejectRequest,
} from '../controllers/marketingRequestController.js';
import {
  getMarketingExpenseCategories, createMarketingExpense, getMarketingExpenses,
  getMarketingExpenseSummary, updateMarketingExpense, deleteMarketingExpense,
} from '../controllers/marketingExpenseController.js';

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

// Item media — Group/Category/SubCategory filtered product picker (same
// filter as Sales > Send Quotation) + image/video/brochure upload per item
router.get('/item-filters', getItemFilters);
router.get('/items', getMarketingItems);
router.post('/items/:id/media', marketingUpload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'brochure', maxCount: 1 },
]), uploadItemMedia);

// Content Requests (Sales ↔ Marketing)
router.post('/requests', createRequest);
router.get('/requests/my', getMyRequests);
router.get('/requests', getAllRequests);
router.get('/requests/:id/matching-assets', getMatchingAssets);
router.post('/requests/:id/approve', approveRequest);
router.post('/requests/:id/reject', rejectRequest);

// Reports, Audit, Notifications
router.get('/reports', getReports);
router.get('/audit-logs', getAuditLogs);
router.get('/notifications', getNotifications);

// Marketing Expenses — logged by Marketing Head / Marketing Employee
router.get('/expenses/categories', getMarketingExpenseCategories);
router.get('/expenses/summary', getMarketingExpenseSummary);
router.get('/expenses', getMarketingExpenses);
router.post('/expenses', createMarketingExpense);
router.put('/expenses/:id', updateMarketingExpense);
router.delete('/expenses/:id', deleteMarketingExpense);

export default router;
