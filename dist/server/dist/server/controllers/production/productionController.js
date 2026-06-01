"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyProduction = exports.getPendingVerifications = exports.updateProductionRecord = exports.createProductionRecord = exports.getProductionRecords = exports.updateProductionBatch = exports.createProductionBatch = exports.getProductionBatches = exports.approveBatchPlan = exports.updateBatchPlan = exports.createBatchPlan = exports.getBatchPlans = exports.getProductionDashboard = void 0;
const Production_js_1 = require("../../models/production/Production.js");
// Dashboard Controllers
const getProductionDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        let query = {};
        // Role-based filtering
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        // Get today's date range
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        // Fetch dashboard statistics
        const [totalBatches, pendingTasks, ongoingBatches, completedBatches, recentBatches, damages] = yield Promise.all([
            Production_js_1.ProductionBatch.countDocuments(Object.assign(Object.assign({}, query), { createdAt: { $gte: startOfDay, $lt: endOfDay } })),
            Production_js_1.ProductionBatch.countDocuments(Object.assign(Object.assign({}, query), { status: { $in: ['Ready', 'Paused'] } })),
            Production_js_1.ProductionBatch.countDocuments(Object.assign(Object.assign({}, query), { status: 'In Progress' })),
            Production_js_1.ProductionBatch.countDocuments(Object.assign(Object.assign({}, query), { status: 'Completed', createdAt: { $gte: startOfDay, $lt: endOfDay } })),
            Production_js_1.ProductionBatch.find(Object.assign(Object.assign({}, query), { status: 'In Progress' })).limit(10).sort({ createdAt: -1 }),
            Production_js_1.ProductionBatch.aggregate([
                { $match: Object.assign(Object.assign({}, query), { createdAt: { $gte: startOfDay, $lt: endOfDay } }) },
                { $unwind: '$damages' },
                {
                    $group: {
                        _id: null,
                        totalDamages: { $sum: '$damages.quantity' },
                        totalCost: { $sum: '$damages.cost' }
                    }
                }
            ])
        ]);
        const damagesSummary = damages.length > 0 ? damages[0] : { totalDamages: 0, totalCost: 0 };
        res.json({
            success: true,
            data: {
                overview: {
                    totalBatches,
                    pendingTasks,
                    ongoingBatches,
                    completedBatches,
                    damages: damagesSummary.totalDamages,
                    damagesCost: damagesSummary.totalCost,
                    efficiency: 95.5 // Calculate based on actual data
                },
                recentBatches,
                alerts: [
                    {
                        type: 'warning',
                        message: 'Low raw material stock for Product A',
                        time: '10 mins ago'
                    },
                    {
                        type: 'info',
                        message: 'Quality check passed for BATCH003',
                        time: '1 hour ago'
                    }
                ]
            }
        });
    }
    catch (error) {
        console.error('Production dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching production dashboard data',
            error: error.message
        });
    }
});
exports.getProductionDashboard = getProductionDashboard;
// Batch Planning Controllers
const getBatchPlans = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        let query = {};
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const plans = yield Production_js_1.BatchPlan.find(query)
            .populate('createdBy', 'username')
            .populate('approvedBy', 'username')
            .sort({ createdAt: -1 });
        res.json({
            success: true,
            data: { plans }
        });
    }
    catch (error) {
        console.error('Get batch plans error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching batch plans',
            error: error.message
        });
    }
});
exports.getBatchPlans = getBatchPlans;
const createBatchPlan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const planData = req.body;
        // Generate unique plan ID
        const planId = `BP${Date.now().toString().slice(-6)}`;
        const newPlan = new Production_js_1.BatchPlan(Object.assign(Object.assign({}, planData), { planId, createdBy: user.id, companyId: user.companyId }));
        yield newPlan.save();
        res.status(201).json({
            success: true,
            message: 'Batch plan created successfully',
            data: { plan: newPlan }
        });
    }
    catch (error) {
        console.error('Create batch plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating batch plan',
            error: error.message
        });
    }
});
exports.createBatchPlan = createBatchPlan;
const updateBatchPlan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const user = req.user;
        let query = { _id: id };
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const updatedPlan = yield Production_js_1.BatchPlan.findOneAndUpdate(query, updateData, { new: true });
        if (!updatedPlan) {
            return res.status(404).json({
                success: false,
                message: 'Batch plan not found'
            });
        }
        res.json({
            success: true,
            message: 'Batch plan updated successfully',
            data: { plan: updatedPlan }
        });
    }
    catch (error) {
        console.error('Update batch plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating batch plan',
            error: error.message
        });
    }
});
exports.updateBatchPlan = updateBatchPlan;
const approveBatchPlan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const user = req.user;
        let query = { _id: id };
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const updatedPlan = yield Production_js_1.BatchPlan.findOneAndUpdate(query, {
            status: 'Approved',
            approvedBy: user.id,
            approvedAt: new Date()
        }, { new: true });
        if (!updatedPlan) {
            return res.status(404).json({
                success: false,
                message: 'Batch plan not found'
            });
        }
        res.json({
            success: true,
            message: 'Batch plan approved successfully',
            data: { plan: updatedPlan }
        });
    }
    catch (error) {
        console.error('Approve batch plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Error approving batch plan',
            error: error.message
        });
    }
});
exports.approveBatchPlan = approveBatchPlan;
// Production Execution Controllers
const getProductionBatches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        let query = {};
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const batches = yield Production_js_1.ProductionBatch.find(query)
            .populate('planId', 'planId indentId')
            .sort({ createdAt: -1 });
        res.json({
            success: true,
            data: { batches }
        });
    }
    catch (error) {
        console.error('Get production batches error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching production batches',
            error: error.message
        });
    }
});
exports.getProductionBatches = getProductionBatches;
const createProductionBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const batchData = req.body;
        // Generate unique batch ID
        const batchId = `BATCH${Date.now().toString().slice(-6)}`;
        const newBatch = new Production_js_1.ProductionBatch(Object.assign(Object.assign({}, batchData), { batchId, companyId: user.companyId }));
        yield newBatch.save();
        res.status(201).json({
            success: true,
            message: 'Production batch created successfully',
            data: { batch: newBatch }
        });
    }
    catch (error) {
        console.error('Create production batch error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating production batch',
            error: error.message
        });
    }
});
exports.createProductionBatch = createProductionBatch;
const updateProductionBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const user = req.user;
        let query = { _id: id };
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const updatedBatch = yield Production_js_1.ProductionBatch.findOneAndUpdate(query, updateData, { new: true });
        if (!updatedBatch) {
            return res.status(404).json({
                success: false,
                message: 'Production batch not found'
            });
        }
        res.json({
            success: true,
            message: 'Production batch updated successfully',
            data: { batch: updatedBatch }
        });
    }
    catch (error) {
        console.error('Update production batch error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating production batch',
            error: error.message
        });
    }
});
exports.updateProductionBatch = updateProductionBatch;
// Production Register Controllers
const getProductionRecords = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        let query = {};
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const records = yield Production_js_1.ProductionRecord.find(query)
            .populate('batchId', 'batchId productName')
            .populate('verifiedBy', 'username')
            .sort({ createdAt: -1 });
        res.json({
            success: true,
            data: { records }
        });
    }
    catch (error) {
        console.error('Get production records error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching production records',
            error: error.message
        });
    }
});
exports.getProductionRecords = getProductionRecords;
const createProductionRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        const recordData = req.body;
        // Generate unique record ID
        const recordId = `PR${Date.now().toString().slice(-6)}`;
        const newRecord = new Production_js_1.ProductionRecord(Object.assign(Object.assign({}, recordData), { recordId, companyId: user.companyId }));
        yield newRecord.save();
        res.status(201).json({
            success: true,
            message: 'Production record created successfully',
            data: { record: newRecord }
        });
    }
    catch (error) {
        console.error('Create production record error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating production record',
            error: error.message
        });
    }
});
exports.createProductionRecord = createProductionRecord;
const updateProductionRecord = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const user = req.user;
        let query = { _id: id };
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const updatedRecord = yield Production_js_1.ProductionRecord.findOneAndUpdate(query, updateData, { new: true });
        if (!updatedRecord) {
            return res.status(404).json({
                success: false,
                message: 'Production record not found'
            });
        }
        res.json({
            success: true,
            message: 'Production record updated successfully',
            data: { record: updatedRecord }
        });
    }
    catch (error) {
        console.error('Update production record error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating production record',
            error: error.message
        });
    }
});
exports.updateProductionRecord = updateProductionRecord;
// Production Verification Controllers
const getPendingVerifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.user;
        let query = { status: 'Pending Verification' };
        if (user.role === 'Unit Head' && user.companyId) {
            query.companyId = user.companyId;
        }
        const pendingBatches = yield Production_js_1.ProductionBatch.find(query)
            .populate('planId', 'planId indentId')
            .sort({ createdAt: -1 });
        res.json({
            success: true,
            data: { batches: pendingBatches }
        });
    }
    catch (error) {
        console.error('Get pending verifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching pending verifications',
            error: error.message
        });
    }
});
exports.getPendingVerifications = getPendingVerifications;
const verifyProduction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const verificationData = req.body;
        const user = req.user;
        // Generate unique verification ID
        const verificationId = `VER${Date.now().toString().slice(-6)}`;
        const verification = new Production_js_1.ProductionVerification(Object.assign(Object.assign({}, verificationData), { verificationId, verifiedBy: user.id, companyId: user.companyId }));
        yield verification.save();
        // Update the production batch status
        yield Production_js_1.ProductionBatch.findByIdAndUpdate(id, {
            status: verificationData.approvalStatus === 'Approved' ? 'Verified' : 'Rejected'
        });
        res.json({
            success: true,
            message: 'Production verification completed successfully',
            data: { verification }
        });
    }
    catch (error) {
        console.error('Verify production error:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying production',
            error: error.message
        });
    }
});
exports.verifyProduction = verifyProduction;
