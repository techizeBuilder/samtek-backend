import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import {
  getProductionGroupsForPacking,
  getPackingSheets,
  createPackingSheet,
  updatePackingSheet,
  startPackingTiming,
  stopPackingTiming,
  updatePackingLoss,
  updatePackingQuantities,
  updatePackingItem,
  getPackingSheetById,
  getPackingStats,
  cleanupDuplicatePackingSheets,
  getDashboardStats,
  approvePackingSheet,
  getPackingHistory
} from '../controllers/packingController.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Fine-grained module/feature permission checks (module: 'packing')
const packingDashboardView = checkPermission('packing', 'dashboard', 'view');
const packingSheetView = checkPermission('packing', 'packingSheet', 'view');
const packingSheetAdd = checkPermission('packing', 'packingSheet', 'add');
const packingSheetEdit = checkPermission('packing', 'packingSheet', 'edit');
const packingSheetDelete = checkPermission('packing', 'packingSheet', 'delete');
const packingHistoryView = checkPermission('packing', 'packingHistory', 'view');

// Dashboard Routes
// GET /api/packing/dashboard - Get dashboard statistics
router.get('/dashboard', packingDashboardView, getDashboardStats);

// Production Groups for Packing Routes
// GET /api/packing/production-groups - Get production groups with item details for packing
router.get('/production-groups', packingSheetView, getProductionGroupsForPacking);

// Packing Sheet Management Routes
// GET /api/packing/sheets - Get all packing sheets (with optional date and status filters)
router.get('/sheets', packingSheetView, getPackingSheets);

// POST /api/packing/sheets - Create a new packing sheet
router.post('/sheets', packingSheetAdd, createPackingSheet);

// PUT /api/packing/sheets - Update packing sheet by batchNo/batchId
router.put('/sheets', packingSheetEdit, updatePackingSheet);

// GET /api/packing/sheets/:packingSheetId - Get specific packing sheet by ID
router.get('/sheets/:packingSheetId', packingSheetView, getPackingSheetById);

// Packing Timing Control Routes
// POST /api/packing/sheets/:packingSheetId/start - Start packing timing (punch in)
router.post('/sheets/:packingSheetId/start', packingSheetEdit, startPackingTiming);

// POST /api/packing/sheets/:packingSheetId/stop - Stop packing timing (punch out)
router.post('/sheets/:packingSheetId/stop', packingSheetEdit, stopPackingTiming);

// Packing Data Update Routes
// PUT /api/packing/sheets/:packingSheetId/loss - Update packing loss (manual entry)
router.put('/sheets/:packingSheetId/loss', packingSheetEdit, updatePackingLoss);

// PUT /api/packing/sheets/:packingSheetId/quantities - Update item quantities in packing sheet
router.put('/sheets/:packingSheetId/quantities', packingSheetEdit, updatePackingQuantities);

// PUT /api/packing/sheets/:packingSheetId/item - Update individual item fields (packingLoss, notes, batchId, batchNo)
router.put('/sheets/:packingSheetId/item', packingSheetEdit, updatePackingItem);

// POST /api/packing/sheets/:packingSheetId/approve - Approve a completed packing sheet
router.post('/sheets/:packingSheetId/approve', packingSheetEdit, approvePackingSheet);

// Packing Statistics Routes
// GET /api/packing/stats - Get packing statistics and performance metrics
router.get('/stats', packingDashboardView, getPackingStats);

// History Routes
// GET /api/packing/history - Get packing history with pagination and filters
router.get('/history', packingHistoryView, getPackingHistory);

// Utility Routes
// POST /api/packing/cleanup-duplicates - Clean up duplicate packing sheets (deletes duplicate sheets)
router.post('/cleanup-duplicates', packingSheetDelete, cleanupDuplicatePackingSheets);

export default router;