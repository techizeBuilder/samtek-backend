import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
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

// Dashboard Routes
// GET /api/packing/dashboard - Get dashboard statistics
router.get('/dashboard', getDashboardStats);

// Production Groups for Packing Routes
// GET /api/packing/production-groups - Get production groups with item details for packing
router.get('/production-groups', getProductionGroupsForPacking);

// Packing Sheet Management Routes
// GET /api/packing/sheets - Get all packing sheets (with optional date and status filters)
router.get('/sheets', getPackingSheets);

// POST /api/packing/sheets - Create a new packing sheet
router.post('/sheets', createPackingSheet);

// PUT /api/packing/sheets - Update packing sheet by batchNo/batchId
router.put('/sheets', updatePackingSheet);

// GET /api/packing/sheets/:packingSheetId - Get specific packing sheet by ID
router.get('/sheets/:packingSheetId', getPackingSheetById);

// Packing Timing Control Routes
// POST /api/packing/sheets/:packingSheetId/start - Start packing timing (punch in)
router.post('/sheets/:packingSheetId/start', startPackingTiming);

// POST /api/packing/sheets/:packingSheetId/stop - Stop packing timing (punch out)
router.post('/sheets/:packingSheetId/stop', stopPackingTiming);

// Packing Data Update Routes
// PUT /api/packing/sheets/:packingSheetId/loss - Update packing loss (manual entry)
router.put('/sheets/:packingSheetId/loss', updatePackingLoss);

// PUT /api/packing/sheets/:packingSheetId/quantities - Update item quantities in packing sheet
router.put('/sheets/:packingSheetId/quantities', updatePackingQuantities);

// PUT /api/packing/sheets/:packingSheetId/item - Update individual item fields (packingLoss, notes, batchId, batchNo)
router.put('/sheets/:packingSheetId/item', updatePackingItem);

// POST /api/packing/sheets/:packingSheetId/approve - Approve a completed packing sheet
router.post('/sheets/:packingSheetId/approve', approvePackingSheet);

// Packing Statistics Routes
// GET /api/packing/stats - Get packing statistics and performance metrics
router.get('/stats', getPackingStats);

// History Routes
// GET /api/packing/history - Get packing history with pagination and filters
router.get('/history', getPackingHistory);

// Utility Routes
// POST /api/packing/cleanup-duplicates - Clean up duplicate packing sheets
router.post('/cleanup-duplicates', cleanupDuplicatePackingSheets);

export default router;