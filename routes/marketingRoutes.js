import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { marketingUpload } from '../middleware/marketingUpload.js';
import { eventFlyerUpload } from '../middleware/eventFlyerUpload.js';
import {
  getDashboard, getAssets, getAsset, createAsset, updateAsset, deleteAsset, shareAsset,
  getCategories, createCategory, updateCategory, deleteCategory,
  getReports, getLeadReports, getAuditLogs, getNotifications,
  getItemFilters, getMarketingItemFacets, getMarketingItems, uploadItemMedia,
} from '../controllers/marketingController.js';
import {
  createRequest, getMyRequests, getAllRequests,
  getMatchingAssets, approveRequest, rejectRequest,
} from '../controllers/marketingRequestController.js';
import {
  getMarketingExpenseCategories, createMarketingExpense, getMarketingExpenses,
  getMarketingExpenseSummary, updateMarketingExpense, deleteMarketingExpense,
} from '../controllers/marketingExpenseController.js';
import {
  getEventTypes, getEventFlyers, createEventFlyer, updateEventFlyer, deleteEventFlyer,
} from '../controllers/marketingEventController.js';

const router = express.Router();
router.use(authenticateToken);

// roleModulesConfig.js MODULES['marketing'].features = library, upload,
// categories, reports, auditLogs, notifications, lms. Only routes that map
// onto one of those keys are gated below.
const marketingLibraryView = checkPermission('marketing', 'library', 'view');
const marketingLibraryEdit = checkPermission('marketing', 'library', 'edit');
const marketingLibraryDelete = checkPermission('marketing', 'library', 'delete');

const marketingUploadView = checkPermission('marketing', 'upload', 'view');
const marketingUploadAdd = checkPermission('marketing', 'upload', 'add');

const marketingCategoriesView = checkPermission('marketing', 'categories', 'view');
const marketingCategoriesAdd = checkPermission('marketing', 'categories', 'add');
const marketingCategoriesEdit = checkPermission('marketing', 'categories', 'edit');
const marketingCategoriesDelete = checkPermission('marketing', 'categories', 'delete');

const marketingReportsView = checkPermission('marketing', 'reports', 'view');
const marketingAuditLogsView = checkPermission('marketing', 'auditLogs', 'view');
const marketingNotificationsView = checkPermission('marketing', 'notifications', 'view');

// Dashboard — no 'dashboard' key exists in the marketing module's features
// array (roleModulesConfig.js), so no grantable feature to gate this on.
// Left as authenticateToken-only.
router.get('/dashboard', getDashboard);

// Assets — browsing/editing/sharing existing library content maps to
// 'library'; creating a new asset goes through the upload middleware, so it
// maps to 'upload' (mirrors the "Upload Content" page).
router.get('/assets', marketingLibraryView, getAssets);
router.get('/assets/:id', marketingLibraryView, getAsset);
router.post('/assets', marketingUploadAdd, marketingUpload.single('file'), createAsset);
router.put('/assets/:id', marketingLibraryEdit, updateAsset);
router.delete('/assets/:id', marketingLibraryDelete, deleteAsset);
router.post('/assets/:id/share', marketingLibraryEdit, shareAsset);

// Categories
router.get('/categories', marketingCategoriesView, getCategories);
router.post('/categories', marketingCategoriesAdd, createCategory);
router.put('/categories/:id', marketingCategoriesEdit, updateCategory);
router.delete('/categories/:id', marketingCategoriesDelete, deleteCategory);

// Item media — Group/Category/SubCategory filtered product picker (same
// filter as Sales > Send Quotation) + image/video/brochure upload per item
router.get('/item-filters', marketingUploadView, getItemFilters);
router.get('/items/facets', marketingUploadView, getMarketingItemFacets);
router.get('/items', marketingUploadView, getMarketingItems);
router.post('/items/:id/media', marketingUploadAdd, marketingUpload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'brochure', maxCount: 1 },
]), uploadItemMedia);

// Content Requests (Sales ↔ Marketing) — no matching feature key in the
// marketing module's features array (not "library"/"upload"/etc — this is a
// distinct Sales<->Marketing request workflow). Left ungated pending a
// product decision on whether/where this should get its own permission key.
router.post('/requests', createRequest);
router.get('/requests/my', getMyRequests);
router.get('/requests', getAllRequests);
router.get('/requests/:id/matching-assets', getMatchingAssets);
router.post('/requests/:id/approve', approveRequest);
router.post('/requests/:id/reject', rejectRequest);

// Reports, Audit, Notifications
router.get('/reports', marketingReportsView, getReports);
router.get('/reports/leads', marketingReportsView, getLeadReports);
router.get('/audit-logs', marketingAuditLogsView, getAuditLogs);
router.get('/notifications', marketingNotificationsView, getNotifications);

// Marketing Expenses — logged by Marketing Head / Marketing Employee.
// 'expenses' is NOT a key in the marketing module's features array in
// roleModulesConfig.js (the sidebar's "Marketing Expenses" page has no
// corresponding grantable permission key yet). Left ungated — needs a
// product decision before this can be gated without 403'ing everyone.
router.get('/expenses/categories', getMarketingExpenseCategories);
router.get('/expenses/summary', getMarketingExpenseSummary);
router.get('/expenses', getMarketingExpenses);
router.post('/expenses', createMarketingExpense);
router.put('/expenses/:id', updateMarketingExpense);
router.delete('/expenses/:id', deleteMarketingExpense);

// Event Flyers — Marketing Head / Marketing Employee log Event Name, Event
// Type & Event Date and upload the event's flyer/poster image. No matching
// feature key in the marketing module's features array either — left
// ungated pending a product decision.
router.get('/events/types', getEventTypes);
router.get('/events', getEventFlyers);
router.post('/events', eventFlyerUpload.single('image'), createEventFlyer);
router.put('/events/:id', eventFlyerUpload.single('image'), updateEventFlyer);
router.delete('/events/:id', deleteEventFlyer);

export default router;
