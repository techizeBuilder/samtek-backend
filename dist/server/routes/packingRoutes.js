"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../middleware/auth.js");
const packingController_js_1 = require("../controllers/packingController.js");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(auth_js_1.authenticateToken);
// Dashboard Routes
// GET /api/packing/dashboard - Get dashboard statistics
router.get('/dashboard', packingController_js_1.getDashboardStats);
// Production Groups for Packing Routes
// GET /api/packing/production-groups - Get production groups with item details for packing
router.get('/production-groups', packingController_js_1.getProductionGroupsForPacking);
// Packing Sheet Management Routes
// GET /api/packing/sheets - Get all packing sheets (with optional date and status filters)
router.get('/sheets', packingController_js_1.getPackingSheets);
// POST /api/packing/sheets - Create a new packing sheet
router.post('/sheets', packingController_js_1.createPackingSheet);
// PUT /api/packing/sheets - Update packing sheet by batchNo/batchId
router.put('/sheets', packingController_js_1.updatePackingSheet);
// GET /api/packing/sheets/:packingSheetId - Get specific packing sheet by ID
router.get('/sheets/:packingSheetId', packingController_js_1.getPackingSheetById);
// Packing Timing Control Routes
// POST /api/packing/sheets/:packingSheetId/start - Start packing timing (punch in)
router.post('/sheets/:packingSheetId/start', packingController_js_1.startPackingTiming);
// POST /api/packing/sheets/:packingSheetId/stop - Stop packing timing (punch out)
router.post('/sheets/:packingSheetId/stop', packingController_js_1.stopPackingTiming);
// Packing Data Update Routes
// PUT /api/packing/sheets/:packingSheetId/loss - Update packing loss (manual entry)
router.put('/sheets/:packingSheetId/loss', packingController_js_1.updatePackingLoss);
// PUT /api/packing/sheets/:packingSheetId/quantities - Update item quantities in packing sheet
router.put('/sheets/:packingSheetId/quantities', packingController_js_1.updatePackingQuantities);
// PUT /api/packing/sheets/:packingSheetId/item - Update individual item fields (packingLoss, notes, batchId, batchNo)
router.put('/sheets/:packingSheetId/item', packingController_js_1.updatePackingItem);
// POST /api/packing/sheets/:packingSheetId/approve - Approve a completed packing sheet
router.post('/sheets/:packingSheetId/approve', packingController_js_1.approvePackingSheet);
// Packing Statistics Routes
// GET /api/packing/stats - Get packing statistics and performance metrics
router.get('/stats', packingController_js_1.getPackingStats);
// History Routes
// GET /api/packing/history - Get packing history with pagination and filters
router.get('/history', packingController_js_1.getPackingHistory);
// Utility Routes
// POST /api/packing/cleanup-duplicates - Clean up duplicate packing sheets
router.post('/cleanup-duplicates', packingController_js_1.cleanupDuplicatePackingSheets);
exports.default = router;
