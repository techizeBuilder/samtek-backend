"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_js_1 = require("../../middleware/auth.js");
const roleMiddleware_js_1 = require("../../middleware/roleMiddleware.js");
const Production_js_1 = require("../../models/production/Production.js");
const productionController_js_1 = require("./productionController.js");
const router = express_1.default.Router();
// Apply authentication middleware to all production routes
router.use(auth_js_1.authenticateToken);
// Dashboard Routes (Both Super Admin and Unit Head can view)
router.get('/dashboard', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.getProductionDashboard);
// Batch Planning Routes
router.get('/batch-plans', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.getBatchPlans);
router.post('/batch-plans', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.createBatchPlan);
router.put('/batch-plans/:id', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.updateBatchPlan);
router.patch('/batch-plans/:id/approve', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.approveBatchPlan);
// Production Execution Routes
router.get('/batches', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.getProductionBatches);
router.post('/batches', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.createProductionBatch);
router.put('/batches/:id', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.updateProductionBatch);
// Production Register Routes
router.get('/records', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.getProductionRecords);
router.post('/records', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.createProductionRecord);
router.put('/records/:id', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.updateProductionRecord);
// Verification & Approval Routes
router.get('/verifications/pending', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.getPendingVerifications);
router.post('/verify/:id', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), productionController_js_1.verifyProduction);
// Additional Production Routes
// Delete Routes (Super Admin only for safety)
router.delete('/batch-plans/:id', (0, roleMiddleware_js_1.checkRole)(['Superadmin']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield Production_js_1.BatchPlan.findByIdAndDelete(id);
        res.json({
            success: true,
            message: 'Batch plan deleted successfully'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error deleting batch plan',
            error: error.message
        });
    }
}));
router.delete('/batches/:id', (0, roleMiddleware_js_1.checkRole)(['Superadmin']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield Production_js_1.ProductionBatch.findByIdAndDelete(id);
        res.json({
            success: true,
            message: 'Production batch deleted successfully'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error deleting production batch',
            error: error.message
        });
    }
}));
router.delete('/records/:id', (0, roleMiddleware_js_1.checkRole)(['Superadmin']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        yield Production_js_1.ProductionRecord.findByIdAndDelete(id);
        res.json({
            success: true,
            message: 'Production record deleted successfully'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error deleting production record',
            error: error.message
        });
    }
}));
// Bulk Operations (Super Admin only)
router.post('/batch-plans/bulk-approve', (0, roleMiddleware_js_1.checkRole)(['Superadmin']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { planIds } = req.body;
        const user = req.user;
        yield Production_js_1.BatchPlan.updateMany({ _id: { $in: planIds } }, {
            status: 'Approved',
            approvedBy: user.id,
            approvedAt: new Date()
        });
        res.json({
            success: true,
            message: `${planIds.length} batch plans approved successfully`
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error bulk approving batch plans',
            error: error.message
        });
    }
}));
// Reports Routes
router.get('/reports/production-summary', (0, roleMiddleware_js_1.checkRole)(['Superadmin', 'Unit Head']), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { startDate, endDate } = req.query;
        const user = req.user;
        let query = {};
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
        const [batchesReport, recordsReport] = yield Promise.all([
            Production_js_1.ProductionBatch.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                        totalQuantity: { $sum: '$totalOutput' }
                    }
                }
            ]),
            Production_js_1.ProductionRecord.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        totalRecords: { $sum: 1 },
                        totalProduced: { $sum: '$finalQuantity' },
                        totalDamages: { $sum: '$damages.quantity' }
                    }
                }
            ])
        ]);
        res.json({
            success: true,
            data: {
                batches: batchesReport,
                records: recordsReport[0] || { totalRecords: 0, totalProduced: 0, totalDamages: 0 }
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error generating production summary',
            error: error.message
        });
    }
}));
exports.default = router;
