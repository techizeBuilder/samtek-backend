"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.getAllProductionReports = exports.updateUngroupedItemProductionWithBatch = exports.updateUngroupedItemProduction = exports.getUngroupedItemProduction = exports.getUngroupedItemGroup = exports.getUngroupedItemsForSheet = exports.getUngroupedItems = exports.debugProductSummaryData = exports.updateProductionShiftTiming = exports.getProductionGroupShiftDetails = exports.getProductionShiftData = exports.getProductionDashboard = void 0;
const ProductionGroup_js_1 = __importDefault(require("../models/ProductionGroup.js"));
const ProductDailySummary_js_1 = __importDefault(require("../models/ProductDailySummary.js"));
const ProductDetailsDailySummary_js_1 = __importDefault(require("../models/ProductDetailsDailySummary.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const User_js_1 = __importDefault(require("../models/User.js"));
const ProductionBatch_js_1 = __importDefault(require("../models/ProductionBatch.js")); // Unified model
const mongoose_1 = __importDefault(require("mongoose"));
// Helper function to get next global batch number from database
const getNextGlobalBatchNumber = (companyId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Get the highest batch number across ALL items for this company today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const lastBatch = yield ProductionBatch_js_1.default.findOne({
            companyId: companyId,
            productionDate: { $gte: today, $lt: tomorrow }
        }).sort({ batchNumber: -1 }).limit(1);
        const nextNumber = ((lastBatch === null || lastBatch === void 0 ? void 0 : lastBatch.batchNumber) || 0) + 1;
        return {
            batchNumber: nextNumber,
            batchNo: `BATNO${nextNumber.toString().padStart(2, '0')}`
        };
    }
    catch (error) {
        console.error('Error getting next global batch number:', error);
        return { batchNumber: 1, batchNo: 'BATNO01' };
    }
});
// Helper function to calculate number of batches for a production group
const calculateBatchesForGroup = (groupId, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Get the production group
        const group = yield ProductionGroup_js_1.default.findById(groupId);
        if (!group || !group.items || group.items.length === 0) {
            return 0;
        }
        // Get all item IDs from this production group
        const itemIds = group.items.map(item => item._id);
        // Query ProductDetailsDailySummary for all items in this group for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const summaryQuery = {
            productId: { $in: itemIds },
            date: {
                $gte: today,
                $lt: tomorrow
            }
        };
        // Add company filter if provided
        if (companyId) {
            summaryQuery.companyId = companyId;
        }
        const productDetailsSummaries = yield ProductDetailsDailySummary_js_1.default.find(summaryQuery);
        // Calculate total batchAdjusted for all items in this group
        const totalBatches = productDetailsSummaries.reduce((total, summary) => {
            return total + (summary.batchAdjusted || 0);
        }, 0);
        return totalBatches;
    }
    catch (error) {
        console.error('Error calculating batches for group:', error);
        return 0;
    }
});
// Get production dashboard statistics and recent data
const getProductionDashboard = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        console.log('📊 Production Dashboard Request');
        console.log('User details:', {
            username: ((_a = req.user) === null || _a === void 0 ? void 0 : _a.username) || 'Unknown',
            role: ((_b = req.user) === null || _b === void 0 ? void 0 : _b.role) || 'Unknown',
            companyId: ((_c = req.user) === null || _c === void 0 ? void 0 : _c.companyId) || 'Unknown'
        });
        // Validate user and company
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        let query = {};
        // COMPANY FILTERING: Only show data from the same company
        if (req.user.companyId) {
            query.company = req.user.companyId;
            console.log('Filtering by company:', req.user.companyId);
        }
        else {
            console.log('⚠️ Warning: User has no company ID, showing all data');
        }
        // ACTIVE STATUS FILTERING: Only show active production groups
        query.isActive = true;
        console.log('Filtering by isActive: true');
        // UNIT/LOCATION FILTERING: Only show production groups assigned to this user
        // Unit Heads and Unit Managers should only see their assigned production groups
        if (req.user.role === 'Unit Head' || req.user.role === 'Unit Manager') {
            query.unitHeadOrManager = req.user._id;
            console.log('Filtering by unitHeadOrManager:', req.user._id, '(Role:', req.user.role, ')');
        }
        // Super Admin and other roles can see all production groups in their company
        // Get all production groups with error handling
        console.log('Querying ProductionGroup with filter:', query);
        let allGroups = [];
        try {
            allGroups = yield ProductionGroup_js_1.default.find(query)
                .populate({
                path: 'items',
                select: 'name code category qty unit'
            })
                .populate({
                path: 'createdBy',
                select: 'username'
            })
                .sort({ createdAt: -1 })
                .lean();
            console.log(`Found ${allGroups.length} production groups`);
        }
        catch (dbError) {
            console.error('Database query error:', dbError);
            return res.status(500).json({
                success: false,
                message: 'Database error while fetching production groups',
                error: dbError.message
            });
        }
        // Ensure allGroups is an array
        if (!Array.isArray(allGroups)) {
            allGroups = [];
        }
        // Calculate production batches for each group from ProductionBatch
        const dashBoardData = [];
        // Get today's date range
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        for (const group of allGroups) {
            try {
                // Count actual ProductionBatch entries for this group today
                const batchCount = yield ProductionBatch_js_1.default.countDocuments({
                    companyId: req.user.companyId,
                    groupId: group._id,
                    productionDate: { $gte: today, $lt: tomorrow }
                });
                dashBoardData.push({
                    productGroup: group.name,
                    noOfBatchesForProduction: batchCount
                });
                console.log(`Group "${group.name}": ${batchCount} batches in production for today`);
            }
            catch (groupError) {
                console.error(`Error processing group "${group.name}":`, groupError);
                // Add group with 0 batches if error occurs
                dashBoardData.push({
                    productGroup: group.name,
                    noOfBatchesForProduction: 0
                });
            }
        }
        console.log('Dashboard data calculated:', dashBoardData);
        // Calculate summary stats from ACTUAL ProductionBatch entries for today
        // Reuse the today and tomorrow variables already declared above
        // Count grouped batches (items with groupId)
        const groupedBatchesCount = yield ProductionBatch_js_1.default.countDocuments({
            companyId: req.user.companyId,
            productionDate: { $gte: today, $lt: tomorrow },
            groupId: { $exists: true, $ne: null }
        });
        // Count ungrouped batches (items without groupId)
        const ungroupedBatchesCount = yield ProductionBatch_js_1.default.countDocuments({
            companyId: req.user.companyId,
            productionDate: { $gte: today, $lt: tomorrow },
            $or: [
                { groupId: { $exists: false } },
                { groupId: null }
            ]
        });
        const totalItemsInProduction = groupedBatchesCount + ungroupedBatchesCount;
        console.log(`📊 Stats: ${allGroups.length} groups, ${groupedBatchesCount} grouped batches, ${ungroupedBatchesCount} ungrouped batches, ${totalItemsInProduction} total items in production`);
        // Return the new dashboard format with accurate stats
        res.json({
            success: true,
            message: 'Production dashboard data fetched successfully',
            data: dashBoardData,
            stats: {
                totalGroups: allGroups.length,
                totalItems: totalItemsInProduction, // Total batches in production for today (grouped + ungrouped)
                groupedBatches: groupedBatchesCount,
                ungroupedBatches: ungroupedBatchesCount
            }
        });
    }
    catch (error) {
        console.error('Error fetching production dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch production dashboard data',
            error: error.message
        });
    }
});
exports.getProductionDashboard = getProductionDashboard;
// Get all production groups with their items and total quantities for shift management
const getProductionShiftData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        console.log('🏭 Production Shift Data Request');
        console.log('User details:', {
            username: (_a = req.user) === null || _a === void 0 ? void 0 : _a.username,
            role: (_b = req.user) === null || _b === void 0 ? void 0 : _b.role,
            companyId: (_c = req.user) === null || _c === void 0 ? void 0 : _c.companyId
        });
        let query = {};
        // COMPANY FILTERING: Only show production groups from the same company
        if (req.user.companyId) {
            query.company = req.user.companyId;
            console.log('Filtering production groups by company:', req.user.companyId);
        }
        // ACTIVE FILTERING: Only show active production groups for production shift
        query.isActive = true;
        const productionGroups = yield ProductionGroup_js_1.default.find(query)
            .populate({
            path: 'items',
            select: 'name code category qty unit price image'
        })
            .populate({
            path: 'createdBy',
            select: 'username'
        })
            .lean();
        console.log(`Found ${productionGroups.length} production groups`);
        // Get date range - allow querying specific date via query param
        const queryDate = req.query.date ? new Date(req.query.date) : new Date();
        const today = new Date(queryDate);
        today.setUTCHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        console.log(`📅 Querying batches for date: ${today.toISOString()} to ${tomorrow.toISOString()}`);
        // First, get today's approved ProductionBatches to find which groups have data
        const todayBatches = yield ProductionBatch_js_1.default.find({
            companyId: req.user.companyId,
            productionDate: { $gte: today, $lt: tomorrow }
            // Include ALL batches regardless of status to show completed ones
        })
            .populate({
            path: 'groupId',
            select: 'name description qtyPerBatch qtyAchievedPerBatch unitHeadOrManager mouldingTime unloadingTime productionLoss createdBy createdAt isActive'
        })
            .populate({
            path: 'combinedItems.itemId',
            model: 'Item',
            select: 'name code category qty unit price image batch'
        })
            .populate({
            path: 'combinedItems.DailyProductionId',
            model: 'ProductDetailsDailySummary',
            select: 'date batchAdjusted'
        })
            .sort({ batchNumber: 1 })
            .lean();
        console.log(`📦 Found ${todayBatches.length} production batches for today`);
        // Group batches by groupId
        const groupBatchMap = {};
        todayBatches.forEach(batch => {
            if (!batch.groupId)
                return;
            const groupIdStr = batch.groupId._id.toString();
            if (!groupBatchMap[groupIdStr]) {
                groupBatchMap[groupIdStr] = {
                    group: batch.groupId,
                    batches: []
                };
            }
            groupBatchMap[groupIdStr].batches.push(batch);
        });
        console.log(`📦 Found ${Object.keys(groupBatchMap).length} groups with approved batches for today`);
        // Transform production groups data using only groups that have batches today
        const shiftData = [];
        for (const [groupIdStr, groupData] of Object.entries(groupBatchMap)) {
            const { group, batches } = groupData;
            console.log(`📦 Processing group "${group.name}" with ${batches.length} approved batches`);
            // Resolve qtyPerBatch directly from Item.batch (as per requirement)
            // Assumption: all items in the group share the same Item.batch value.
            const parseQtyPerBatch = (value) => {
                const num = typeof value === 'number' ? value : parseFloat(value);
                return Number.isFinite(num) && num > 0 ? num : 0;
            };
            const calculateQtyAchieved = ({ totalBatchAdjusted, qtyPerBatch, productionLoss }) => {
                const adjusted = Number(totalBatchAdjusted);
                const perBatch = Number(qtyPerBatch);
                const loss = Number(productionLoss);
                const adjustedSafe = Number.isFinite(adjusted) ? adjusted : 1;
                const perBatchSafe = Number.isFinite(perBatch) ? perBatch : 0;
                const lossSafe = Number.isFinite(loss) ? loss : 0;
                const achieved = (adjustedSafe * perBatchSafe) - lossSafe;
                return Math.max(0, Math.round(achieved * 100) / 100);
            };
            const resolvedQtyPerBatchFromItems = (() => {
                var _a, _b;
                for (const batch of batches) {
                    if (!((_a = batch === null || batch === void 0 ? void 0 : batch.combinedItems) === null || _a === void 0 ? void 0 : _a.length))
                        continue;
                    for (const combined of batch.combinedItems) {
                        const fromItem = parseQtyPerBatch((_b = combined === null || combined === void 0 ? void 0 : combined.itemId) === null || _b === void 0 ? void 0 : _b.batch);
                        if (fromItem > 0)
                            return fromItem;
                    }
                }
                return 0;
            })();
            // Format items with ProductionBatch data
            // Handle both combined and individual batches
            const itemsWithBatchQty = batches.map(batch => {
                var _a, _b;
                // For combined batches (itemId is null), use group info
                if (!batch.itemId && batch.isCombined) {
                    return {
                        _id: batch._id,
                        name: `${group.name} (Combined)`,
                        code: batch.batchNo,
                        category: 'Combined Batch',
                        qty: batch.totalBatchAdjusted || 0,
                        unit: '',
                        price: 0,
                        image: null,
                        productionFinalBatches: 1,
                        qtyPerBatch: resolvedQtyPerBatchFromItems || batch.qtyPerBatch || 0,
                        batchNo: batch.batchNo,
                        batchNumber: batch.batchNumber,
                        productionStatus: batch.productionStatus || 'not_started',
                        batchId: batch._id,
                        groupId: ((_a = batch.groupId) === null || _a === void 0 ? void 0 : _a._id) || batch.groupId,
                        isCombined: true,
                        combinedItems: batch.combinedItems || [],
                        totalBatchAdjusted: batch.totalBatchAdjusted || 0
                    };
                }
                // For individual batches (normal case)
                if (!batch.itemId)
                    return null; // Skip if no itemId and not combined
                return {
                    _id: batch.itemId._id,
                    name: batch.itemId.name,
                    code: batch.itemId.code,
                    category: batch.itemId.category,
                    qty: batch.itemId.qty || 0,
                    unit: batch.itemId.unit || '',
                    price: batch.itemId.price || 0,
                    image: batch.itemId.image,
                    productionFinalBatches: 1,
                    qtyPerBatch: resolvedQtyPerBatchFromItems || batch.qtyPerBatch || 0,
                    batchNo: batch.batchNo,
                    batchNumber: batch.batchNumber,
                    productionStatus: batch.productionStatus || 'not_started',
                    batchId: batch._id,
                    groupId: ((_b = batch.groupId) === null || _b === void 0 ? void 0 : _b._id) || batch.groupId
                };
            }).filter(Boolean);
            const batchCount = batches.length;
            const batchDataMap = {};
            batches.forEach(batch => {
                var _a;
                const effectiveQtyPerBatch = resolvedQtyPerBatchFromItems || batch.qtyPerBatch || 0;
                const effectiveQtyAchieved = resolvedQtyPerBatchFromItems
                    ? calculateQtyAchieved({
                        totalBatchAdjusted: batch.totalBatchAdjusted !== undefined ? batch.totalBatchAdjusted : 1.0,
                        qtyPerBatch: effectiveQtyPerBatch,
                        productionLoss: batch.productionLoss || 0
                    })
                    : (batch.qtyAchieved || 0);
                batchDataMap[batch.batchNo] = {
                    _id: batch._id,
                    batchId: batch._id,
                    groupId: ((_a = batch.groupId) === null || _a === void 0 ? void 0 : _a._id) || batch.groupId,
                    mouldingTime: batch.mouldingTime,
                    unloadingTime: batch.unloadingTime,
                    productionLoss: batch.productionLoss || 0,
                    productionStatus: batch.status || 'not_started', // Use batch.status field
                    status: batch.status || 'not_started', // Also include status for consistency
                    totalBatchAdjusted: batch.totalBatchAdjusted || 1.0, // Include batch remainder
                    qtyPerBatch: effectiveQtyPerBatch,
                    qtyAchieved: effectiveQtyAchieved,
                    notes: batch.notes || '', // Include notes field
                    combinedItems: batch.combinedItems || [] // Include populated combinedItems with full item details
                };
            });
            // Use resolved qtyPerBatch from Item.batch; fallback to stored ProductionBatch.qtyPerBatch if missing.
            const fallbackTotalQuantity = batches.reduce((sum, batch) => sum + (batch.qtyPerBatch || 0), 0);
            const qtyPerBatch = resolvedQtyPerBatchFromItems || (batchCount > 0 ? Math.round(fallbackTotalQuantity / batchCount) : 0);
            const totalQuantity = resolvedQtyPerBatchFromItems ? (qtyPerBatch * batchCount) : fallbackTotalQuantity;
            shiftData.push({
                _id: group._id,
                name: group.name,
                description: group.description || '',
                totalItems: batchCount, // Count of approved batches, not group items
                totalQuantity: totalQuantity,
                qtyPerBatch: qtyPerBatch,
                qtyAchievedPerBatch: group.qtyAchievedPerBatch || 0,
                noOfBatchesForProduction: batchCount,
                batchData: batchDataMap,
                unitHeadOrManager: group.unitHeadOrManager || null,
                mouldingTime: (group === null || group === void 0 ? void 0 : group.mouldingTime) ?
                    group.mouldingTime.toISOString().slice(0, 16) : null,
                unloadingTime: (group === null || group === void 0 ? void 0 : group.unloadingTime) ?
                    group.unloadingTime.toISOString().slice(0, 16) : null,
                productionLoss: (group === null || group === void 0 ? void 0 : group.productionLoss) !== undefined ? group.productionLoss : 0,
                items: itemsWithBatchQty,
                createdBy: ((_d = group.createdBy) === null || _d === void 0 ? void 0 : _d.username) || 'Unknown',
                createdAt: group.createdAt,
                isActive: group.isActive !== false
            });
            console.log(`✅ Added group: ${group.name} with ${batchCount} approved batches`);
        }
        // 🔄 SORT SHIFT DATA BY qtyPerBatch IN ASCENDING ORDER
        shiftData.sort((a, b) => {
            const qtyA = a.qtyPerBatch || 0;
            const qtyB = b.qtyPerBatch || 0;
            return qtyA - qtyB; // Ascending order: smallest first
        });
        console.log('✅ Sorted all production groups by qtyPerBatch in ascending order');
        console.log('📊 Sorted order:', shiftData.map(group => `${group.name}: ${group.qtyPerBatch}`).join(' → '));
        // Get ungrouped items from ProductionBatch
        console.log('\n🔍 Adding ungrouped items from ProductionBatch...');
        const ungroupedBatches = yield ProductionBatch_js_1.default.find({
            companyId: req.user.companyId,
            productionDate: { $gte: today, $lt: tomorrow },
            $or: [
                { groupId: { $exists: false } },
                { groupId: null }
            ]
        })
            .populate({
            path: 'groupId',
            select: 'name description'
        })
            .populate({
            path: 'combinedItems.itemId',
            model: 'Item',
            select: 'name code category subCategory qty unit price image batch'
        })
            .sort({ batchNumber: 1 })
            .lean();
        console.log(`📦 Found ${ungroupedBatches.length} ungrouped batches`);
        // Format ungrouped items
        const formattedUngroupedItems = ungroupedBatches.map(batch => {
            var _a, _b, _c, _d;
            const parseQtyPerBatch = (value) => {
                const num = typeof value === 'number' ? value : parseFloat(value);
                return Number.isFinite(num) && num > 0 ? num : 0;
            };
            const resolvedQtyPerBatchFromItems = (() => {
                var _a, _b;
                if (!((_a = batch === null || batch === void 0 ? void 0 : batch.combinedItems) === null || _a === void 0 ? void 0 : _a.length))
                    return 0;
                for (const combined of batch.combinedItems) {
                    const fromItem = parseQtyPerBatch((_b = combined === null || combined === void 0 ? void 0 : combined.itemId) === null || _b === void 0 ? void 0 : _b.batch);
                    if (fromItem > 0)
                        return fromItem;
                }
                return 0;
            })();
            // Handle combined batches without itemId
            if (batch.combinedItems && batch.combinedItems.length > 0) {
                console.log(`📦 Combined batch ${batch.batchNo} with ${batch.combinedItems.length} items`);
                // Extract group name from notes if available
                const groupName = ((_b = (_a = batch.notes) === null || _a === void 0 ? void 0 : _a.split('|')[0]) === null || _b === void 0 ? void 0 : _b.replace('Group:', '').trim()) || 'Combined Batch';
                // Get the first item's name for display, or create a combined name
                let displayName = groupName;
                if (batch.combinedItems.length > 0 && batch.combinedItems[0].itemId) {
                    if (batch.combinedItems.length === 1) {
                        // Single item - use item name
                        displayName = batch.combinedItems[0].itemId.name || groupName;
                    }
                    else {
                        // Multiple items - show first item + count
                        displayName = `${batch.combinedItems[0].itemId.name || 'Item'} (+${batch.combinedItems.length - 1} more)`;
                    }
                }
                return {
                    _id: `combined_batch_${batch.batchNumber}`,
                    name: displayName,
                    code: batch.batchNo,
                    category: 'Combined Batch',
                    subCategory: '',
                    qty: batch.totalBatchAdjusted || 0,
                    unit: '',
                    price: 0,
                    image: ((_d = (_c = batch.combinedItems[0]) === null || _c === void 0 ? void 0 : _c.itemId) === null || _d === void 0 ? void 0 : _d.image) || null,
                    qtyPerBatch: resolvedQtyPerBatchFromItems || batch.qtyPerBatch || 0,
                    batchAdjusted: batch.totalBatchAdjusted || 0,
                    batchNo: batch.batchNo,
                    batchNumber: batch.batchNumber,
                    productionStatus: batch.status || 'pending',
                    isUngrouped: true,
                    isCombined: true,
                    combinedItems: batch.combinedItems,
                    totalBatchAdjusted: batch.totalBatchAdjusted,
                    mouldingTime: batch.mouldingTime,
                    unloadingTime: batch.unloadingTime,
                    productionLoss: batch.productionLoss || 0,
                    notes: batch.notes || '',
                    batchId: batch._id,
                    groupName: groupName,
                    productGroup: groupName
                };
            }
            // For batches without combinedItems, they shouldn't exist in new system
            // but keep this for backwards compatibility
            console.warn(`⚠️ Batch ${batch.batchNo} has no combinedItems - this is unexpected`);
            return {
                _id: `batch_${batch.batchNumber}`,
                name: batch.notes || 'Unknown Batch',
                code: batch.batchNo,
                category: 'Single Item',
                subCategory: '',
                qty: batch.totalBatchAdjusted || 0,
                unit: '',
                price: 0,
                image: null,
                qtyPerBatch: resolvedQtyPerBatchFromItems || batch.qtyPerBatch || 0,
                batchAdjusted: batch.totalBatchAdjusted || 1,
                batchNo: batch.batchNo,
                batchNumber: batch.batchNumber,
                productionStatus: batch.status || 'pending',
                isUngrouped: true,
                mouldingTime: batch.mouldingTime,
                unloadingTime: batch.unloadingTime,
                productionLoss: batch.productionLoss || 0,
                notes: batch.notes || '',
                batchId: batch._id,
                groupName: 'Ungrouped Items',
                productGroup: 'Ungrouped Items'
            };
        }).filter(Boolean);
        // 🔄 SORT UNGROUPED ITEMS BY qtyPerBatch IN ASCENDING ORDER
        formattedUngroupedItems.sort((a, b) => {
            const qtyA = a.qtyPerBatch || 0;
            const qtyB = b.qtyPerBatch || 0;
            return qtyA - qtyB; // Ascending order: smallest first
        });
        console.log('✅ Sorted all ungrouped items by qtyPerBatch in ascending order');
        console.log('📊 Ungrouped items sorted order:', formattedUngroupedItems.map(item => `${item.name}: ${item.qtyPerBatch}`).join(' → '));
        res.json({
            success: true,
            message: 'Production shift data fetched successfully',
            data: {
                groups: shiftData,
                ungroupedItems: formattedUngroupedItems,
                totalGroups: shiftData.length,
                totalActiveGroups: shiftData.filter(g => g.isActive).length,
                totalUngroupedItems: formattedUngroupedItems.length
            }
        });
    }
    catch (error) {
        console.error('Error fetching production shift data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch production shift data',
            error: error.message
        });
    }
});
exports.getProductionShiftData = getProductionShiftData;
const getProductionGroupShiftDetails = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { groupId } = req.params;
        console.log('🔍 Getting production group shift details for ID:', groupId);
        let query = { _id: groupId };
        // COMPANY FILTERING: Only show production groups from the same company
        if (req.user.companyId) {
            query.company = req.user.companyId;
        }
        const group = yield ProductionGroup_js_1.default.findOne(query)
            .populate({
            path: 'items',
            select: 'name code category qty unit price image'
        })
            .populate({
            path: 'createdBy',
            select: 'username'
        })
            .lean();
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Production group not found'
            });
        }
        // Calculate batch details
        const totalQuantity = ((_a = group.items) === null || _a === void 0 ? void 0 : _a.reduce((sum, item) => sum + (item.qty || 0), 0)) || 0;
        const totalItems = ((_b = group.items) === null || _b === void 0 ? void 0 : _b.length) || 0;
        const shiftDetails = {
            _id: group._id,
            name: group.name,
            description: group.description || '',
            totalItems: totalItems,
            totalQuantity: totalQuantity,
            items: ((_c = group.items) === null || _c === void 0 ? void 0 : _c.map(item => ({
                _id: item._id,
                name: item.name,
                code: item.code,
                category: item.category,
                qty: item.qty || 0,
                unit: item.unit || '',
                price: item.price || 0,
                image: item.image,
                // Production shift specific data
                mouldingTime: '00:00', // Default values for shift management
                unloadingTime: '00:00',
                productionLoss: 0,
                qtyAchieved: item.qty || 0
            }))) || [],
            createdBy: ((_d = group.createdBy) === null || _d === void 0 ? void 0 : _d.username) || 'Unknown',
            createdAt: group.createdAt,
            isActive: group.isActive !== false
        };
        res.json({
            success: true,
            message: 'Production group shift details fetched successfully',
            data: shiftDetails
        });
    }
    catch (error) {
        console.error('Error fetching production group shift details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch production group shift details',
            error: error.message
        });
    }
});
exports.getProductionGroupShiftDetails = getProductionGroupShiftDetails;
// Update production shift timing data (moulding time, unloading time, etc.)
const updateProductionShiftTiming = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Handle both URL param and body groupId
        let batchKey = req.params.groupId || req.body.groupId;
        const { field, value, timingData } = req.body;
        console.log('⏱️ Updating production shift timing for batch:', batchKey);
        console.log('Field:', field, 'Value:', value);
        if (!batchKey) {
            return res.status(400).json({
                success: false,
                message: 'Batch key is required'
            });
        }
        let groupId, batchNumber;
        // Extract group ID and batch number from batch key (format: "groupId_batch_X")
        if (batchKey.includes('_batch_')) {
            const parts = batchKey.split('_batch_');
            groupId = parts[0];
            batchNumber = parseInt(parts[1]);
        }
        else {
            // Backward compatibility: if no batch number, treat as batch 1
            groupId = batchKey;
            batchNumber = 1;
            batchKey = `${groupId}_batch_1`;
        }
        console.log('📊 Parsed:', { groupId, batchNumber, batchKey });
        // Verify the production group exists and user has access
        let groupQuery = { _id: groupId };
        if (req.user.companyId) {
            groupQuery.company = req.user.companyId;
        }
        const group = yield ProductionGroup_js_1.default.findOne(groupQuery);
        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Production group not found'
            });
        }
        // Find or create individual batch data in unified ProductionBatch table
        let batchData = yield ProductionBatch_js_1.default.findOne({
            batchNo: batchKey,
            companyId: req.user.companyId,
            productionDate: {
                $gte: new Date(new Date().setHours(0, 0, 0, 0)),
                $lt: new Date(new Date().setHours(23, 59, 59, 999))
            }
        });
        if (!batchData) {
            // Create new batch data record
            batchData = new ProductionBatch_js_1.default({
                companyId: req.user.companyId,
                itemId: null, // Will be set when first item is processed
                batchNo: batchKey,
                batchNumber: batchNumber,
                productionDate: new Date(new Date().setHours(0, 0, 0, 0)),
                status: 'in_progress',
                createdBy: req.user.username || req.user._id,
                updatedBy: req.user.username || req.user._id
            });
        }
        // Handle auto-save field updates
        if (field && value !== undefined) {
            switch (field) {
                case 'mouldingTime':
                    batchData.mouldingTime = value ? new Date(value) : null;
                    break;
                case 'unloadingTime':
                    batchData.unloadingTime = value ? new Date(value) : null;
                    break;
                case 'productionLoss':
                    batchData.productionLoss = parseFloat(value) || 0;
                    // Auto-calculate qtyAchieved when production loss changes
                    const qtyPerBatch = group.qtyPerBatch || 0;
                    batchData.qtyAchieved = Math.max(0, qtyPerBatch - batchData.productionLoss);
                    break;
                default:
                    return res.status(400).json({
                        success: false,
                        message: `Invalid field: ${field}`
                    });
            }
            yield batchData.save();
            console.log('✅ Batch timing updated successfully:', {
                batchKey,
                field,
                value,
                updatedData: batchData
            });
            return res.json({
                success: true,
                message: `${field} updated successfully`,
                data: {
                    batchKey: batchKey,
                    groupId: groupId,
                    batchNumber: batchNumber,
                    field,
                    value,
                    updatedAt: batchData.updatedAt
                }
            });
        }
        // Handle bulk timing data updates (if needed for backward compatibility)
        if (timingData) {
            if (timingData.mouldingTime !== undefined) {
                batchData.mouldingTime = timingData.mouldingTime ? new Date(timingData.mouldingTime) : null;
            }
            if (timingData.unloadingTime !== undefined) {
                batchData.unloadingTime = timingData.unloadingTime ? new Date(timingData.unloadingTime) : null;
            }
            if (timingData.productionLoss !== undefined) {
                batchData.productionLoss = parseFloat(timingData.productionLoss) || 0;
                // Auto-calculate qtyAchieved
                const qtyPerBatch = group.qtyPerBatch || 0;
                batchData.qtyAchieved = Math.max(0, qtyPerBatch - batchData.productionLoss);
            }
            yield batchData.save();
            return res.json({
                success: true,
                message: 'Production shift timing updated successfully',
                data: {
                    batchKey: batchKey,
                    groupId: groupId,
                    batchNumber: batchNumber,
                    timingData: {
                        mouldingTime: batchData.mouldingTime,
                        unloadingTime: batchData.unloadingTime,
                        productionLoss: batchData.productionLoss,
                        qtyAchieved: batchData.qtyAchieved
                    },
                    updatedAt: batchData.updatedAt
                }
            });
        }
        return res.status(400).json({
            success: false,
            message: 'No valid update data provided'
        });
    }
    catch (error) {
        console.error('Error updating production shift timing:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update production shift timing',
            error: error.message
        });
    }
});
exports.updateProductionShiftTiming = updateProductionShiftTiming;
// Debug endpoint to check ProductDailySummary data
const debugProductSummaryData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔍 Debug: Checking ProductDailySummary data...');
        const ProductDailySummary = (yield Promise.resolve().then(() => __importStar(require('../models/ProductDailySummary.js')))).default;
        // Get all ProductDailySummary records for this company
        const summaries = yield ProductDailySummary.find({
            companyId: req.user.companyId
        }).lean();
        console.log(`Found ${summaries.length} ProductDailySummary records for company: ${req.user.companyId}`);
        // Also get summaries without company filter to see all data
        const allSummaries = yield ProductDailySummary.find({}).lean();
        console.log(`Total ProductDailySummary records in database: ${allSummaries.length}`);
        // Get production groups to compare
        const ProductionGroup = (yield Promise.resolve().then(() => __importStar(require('../models/ProductionGroup.js')))).default;
        const groups = yield ProductionGroup.find({
            company: req.user.companyId,
            isActive: true
        }).populate('items', 'name code').lean();
        const itemNames = groups.flatMap(g => { var _a; return ((_a = g.items) === null || _a === void 0 ? void 0 : _a.map(i => i.name)) || []; });
        console.log('Production group item names:', itemNames);
        res.json({
            success: true,
            data: {
                companyId: req.user.companyId,
                companySummaries: summaries.map(s => ({
                    productName: s.productName,
                    productId: s.productId,
                    qtyPerBatch: s.qtyPerBatch,
                    date: s.date
                })),
                allSummaries: allSummaries.map(s => ({
                    productName: s.productName,
                    productId: s.productId,
                    qtyPerBatch: s.qtyPerBatch,
                    companyId: s.companyId,
                    date: s.date
                })),
                productionGroupItems: itemNames,
                matches: summaries.filter(s => itemNames.includes(s.productName))
            }
        });
    }
    catch (error) {
        console.error('Debug endpoint error:', error);
        res.status(500).json({
            success: false,
            message: 'Debug failed',
            error: error.message
        });
    }
});
exports.debugProductSummaryData = debugProductSummaryData;
// Get ungrouped items only (dedicated endpoint)
const getUngroupedItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        console.log('🏭 Getting Ungrouped Items with batchAdjusted values');
        console.log('User details:', {
            username: (_a = req.user) === null || _a === void 0 ? void 0 : _a.username,
            role: (_b = req.user) === null || _b === void 0 ? void 0 : _b.role,
            companyId: (_c = req.user) === null || _c === void 0 ? void 0 : _c.companyId
        });
        // Get today's date
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        console.log('Date filter:', {
            date: today.toISOString().split('T')[0]
        });
        // Get ProductDetailsDailySummary for batch values (batchAdjusted)
        const productDetailsSummary = yield ProductDetailsDailySummary_js_1.default.find({
            companyId: req.user.companyId,
            date: today
        })
            .populate('productId', 'name code category subCategory qty unit price image description')
            .lean();
        console.log(`📦 Found ${productDetailsSummary.length} ProductDetailsDailySummary records for today`);
        // Filter items that are not assigned to any production group
        const assignedGroups = yield ProductionGroup_js_1.default.find({
            company: req.user.companyId,
            isActive: true
        }).select('items');
        const assignedItemIds = assignedGroups.flatMap(group => group.items.map(item => item.toString()));
        console.log(`🚫 ${assignedItemIds.length} items are assigned to production groups`);
        // Filter ungrouped items from ProductDetailsDailySummary
        // Only show items with batchAdjusted > 0 AND status='approved' (exclude pending items)
        const ungroupedItems = productDetailsSummary.filter(item => {
            var _a;
            const hasProduct = item.productId;
            const isNotAssigned = !assignedItemIds.includes((_a = item.productId) === null || _a === void 0 ? void 0 : _a._id.toString());
            const hasBatches = (item.batchAdjusted || 0) > 0;
            const isApproved = item.status === 'approved';
            return hasProduct && isNotAssigned && hasBatches && isApproved;
        });
        console.log(`🔄 Found ${ungroupedItems.length} ungrouped items with batches > 0`);
        // Format the data for frontend with batchAdjusted values
        const formattedItems = ungroupedItems.map(item => {
            const { productId, batchAdjusted, productionFinalBatches, packing, physicalStock } = item;
            // Use batchAdjusted as the batch count (this gives 0.6, 0.3, 0.1, 0.9, 1.2, 1, 0)
            const batchCount = batchAdjusted || 0;
            console.log(`📊 Item: ${productId === null || productId === void 0 ? void 0 : productId.name} - batchAdjusted: ${batchCount}`);
            return {
                _id: productId._id,
                name: productId.name || 'Unnamed Item',
                code: productId.code || 'No Code',
                category: productId.category || 'No Category',
                subCategory: productId.subCategory || '',
                qty: productId.qty || 0,
                unit: productId.unit || '',
                price: productId.price || 0,
                image: productId.image,
                description: productId.description,
                // Use batchAdjusted for batch count (fractional batches like 0.6, 0.3, etc.)
                noOfBatchesForProduction: batchCount,
                productionFinalBatches: productionFinalBatches || 0,
                batchAdjusted: batchCount,
                packing: packing || 0,
                physicalStock: physicalStock || 0,
                qtyPerBatch: productId.qty || 0,
                productionStatus: batchCount > 0 ? 'pending' : 'not_started',
                isUngrouped: true
            };
        });
        console.log('📊 Formatted ungrouped items with batch values:', formattedItems.map(item => ({
            name: item.name,
            noOfBatchesForProduction: item.noOfBatchesForProduction,
            batchAdjusted: item.batchAdjusted
        })));
        res.json({
            success: true,
            message: 'Ungrouped items fetched successfully',
            data: {
                items: formattedItems,
                totalItems: formattedItems.length
            }
        });
    }
    catch (error) {
        console.error('Error fetching ungrouped items:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch ungrouped items',
            error: error.message
        });
    }
});
exports.getUngroupedItems = getUngroupedItems;
// Get ungrouped items for production sheet with individual batch entries
const getUngroupedItemsForSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔍 Production Sheet Ungrouped Items Request:', {
            role: req.user.role,
            username: req.user.username,
            companyId: req.user.companyId,
            query: req.query
        });
        // Validate user and company
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required with valid company'
            });
        }
        const { search = '' } = req.query;
        console.log('📝 Search params:', { search });
        // Get total items in company
        const totalCompanyItems = yield Inventory_js_1.Item.countDocuments({ store: req.user.companyId });
        console.log('🔢 Total items in company:', totalCompanyItems);
        // Get items already assigned to production groups
        const assignedGroups = yield ProductionGroup_js_1.default.find({
            company: req.user.companyId,
            isActive: true
        }).select('items');
        const assignedItemIds = assignedGroups.flatMap(group => group.items.map(item => item.toString()));
        console.log('🚫 Total assigned items count:', assignedItemIds.length);
        // Build filter for ungrouped items
        const filter = {
            store: req.user.companyId,
            _id: { $nin: assignedItemIds }
        };
        // Add search filter
        if (search && search.trim()) {
            filter.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { code: { $regex: search.trim(), $options: 'i' } },
                { category: { $regex: search.trim(), $options: 'i' } }
            ];
        }
        console.log('🔍 Filter object:', JSON.stringify(filter, null, 2));
        // Get ungrouped items
        const items = yield Inventory_js_1.Item.find(filter)
            .select('name code category subCategory qty unit price image description store')
            .sort({ name: 1 })
            .lean();
        console.log('📦 Retrieved ungrouped items:', items.length);
        // Format items with proper image URLs and ProductDailySummary data
        const formattedItems = yield Promise.all(items.map((item) => __awaiter(void 0, void 0, void 0, function* () {
            const imageUrl = item.image ? (item.image.startsWith('/uploads/data:') ? item.image.replace('/uploads/', '') : item.image) : null;
            // Get ProductDailySummary data for qtyPerBatch
            const itemSummary = yield ProductDailySummary_js_1.default.findOne({
                productId: item._id,
                companyId: req.user.companyId
            }).lean();
            // Get today's ProductDetailsDailySummary for batchAdjusted
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const todayDetails = yield ProductDetailsDailySummary_js_1.default.findOne({
                productId: item._id,
                companyId: req.user.companyId,
                date: {
                    $gte: today,
                    $lt: tomorrow
                }
            }).lean();
            return {
                _id: item._id,
                name: item.name || 'Unnamed Item',
                code: item.code || 'No Code',
                category: item.category || 'No Category',
                subCategory: item.subCategory || '',
                qty: item.qty || 0,
                unit: item.unit || '',
                price: item.price || 0,
                description: item.description || '',
                image: imageUrl,
                batchAdjusted: (todayDetails === null || todayDetails === void 0 ? void 0 : todayDetails.batchAdjusted) || 0,
                qtyPerBatch: (itemSummary === null || itemSummary === void 0 ? void 0 : itemSummary.qtyPerBatch) || 0
            };
        })));
        // Filter out items with batchAdjusted = 0 and create individual batch entries
        const itemsWithBatches = formattedItems.filter(item => item.batchAdjusted > 0);
        // Get the last batch number from database to continue sequence
        const lastBatch = yield ProductionBatch_js_1.default.findOne({
            companyId: req.user.companyId
        }).sort({ batchNumber: -1 }).limit(1);
        let globalBatchCounter = 1;
        if (lastBatch && lastBatch.batchNumber) {
            globalBatchCounter = lastBatch.batchNumber + 1;
        }
        console.log(`🔢 Starting batch numbering from: ${globalBatchCounter} (last batch: ${(lastBatch === null || lastBatch === void 0 ? void 0 : lastBatch.batchNumber) || 'none'})`);
        // Create individual batch entries for each item based on batchAdjusted
        const batchEntries = [];
        for (const item of itemsWithBatches) {
            const totalBatches = Math.ceil(item.batchAdjusted); // Round up to get whole number of batches
            for (let itemBatchNumber = 1; itemBatchNumber <= totalBatches; itemBatchNumber++) {
                // Calculate quantity for this batch
                let batchQuantity = item.qtyPerBatch;
                // For the last batch, if it's a partial batch, calculate the remaining quantity
                if (itemBatchNumber === totalBatches && item.batchAdjusted % 1 !== 0) {
                    const remainingBatchFraction = item.batchAdjusted % 1;
                    batchQuantity = Math.round(item.qtyPerBatch * remainingBatchFraction);
                }
                // Generate formatted batch number with global counter
                const batchNo = `BATNO${globalBatchCounter.toString().padStart(2, '0')}`;
                batchEntries.push({
                    _id: `${item._id}_batch_${itemBatchNumber}`, // Unique ID for each batch entry
                    originalItemId: item._id, // Reference to original item
                    name: item.name,
                    code: item.code,
                    category: item.category,
                    subCategory: item.subCategory,
                    qty: item.qty,
                    unit: item.unit,
                    price: item.price,
                    description: item.description,
                    image: item.image,
                    batchNumber: itemBatchNumber, // Item-specific batch number
                    batchNo: batchNo, // Global formatted batch number (BATNO01, BATNO02, etc.)
                    globalBatchNumber: globalBatchCounter, // Global batch counter
                    batchQuantity: batchQuantity,
                    qtyPerBatch: item.qtyPerBatch,
                    totalBatches: totalBatches,
                    originalBatchAdjusted: item.batchAdjusted
                });
                globalBatchCounter++; // Increment global counter
            }
        }
        console.log(`📊 Batch entries created: ${itemsWithBatches.length} items → ${batchEntries.length} batch entries`);
        console.log('📤 Returning ungrouped items as individual batch entries for production sheet:', {
            totalBatchEntries: batchEntries.length,
            uniqueItems: itemsWithBatches.length,
            withImages: batchEntries.filter(item => item.image).length,
            assignedItemsCount: assignedItemIds.length,
            totalCompanyItems: totalCompanyItems,
            filteredOut: formattedItems.length - itemsWithBatches.length
        });
        res.json({
            success: true,
            data: {
                items: batchEntries,
                totalItems: batchEntries.length,
                totalBatchEntries: batchEntries.length,
                uniqueItems: itemsWithBatches.length,
                assignedItemsCount: assignedItemIds.length,
                companyItemsCount: totalCompanyItems,
                ungroupedItemsCount: batchEntries.length,
                filteredItemsCount: formattedItems.length - itemsWithBatches.length
            }
        });
    }
    catch (error) {
        console.error('Error fetching ungrouped items for production sheet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch ungrouped items for production sheet',
            error: error.message
        });
    }
});
exports.getUngroupedItemsForSheet = getUngroupedItemsForSheet;
// Get ungrouped item group (duplicate of getUngroupedItems with different function name)
const getUngroupedItemGroup = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔍 Production Ungrouped Item Group Request:', {
            role: req.user.role,
            username: req.user.username,
            companyId: req.user.companyId,
            query: req.query
        });
        // Validate user and company
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required with valid company'
            });
        }
        const { search = '' } = req.query;
        console.log('📝 Search params:', { search });
        // Get total items in company
        const totalCompanyItems = yield Inventory_js_1.Item.countDocuments({ store: req.user.companyId });
        console.log('🔢 Total items in company:', totalCompanyItems);
        // Get items already assigned to production groups
        const assignedGroups = yield ProductionGroup_js_1.default.find({
            company: req.user.companyId,
            isActive: true
        }).select('items');
        const assignedItemIds = assignedGroups.flatMap(group => group.items.map(item => item.toString()));
        console.log('🚫 Total assigned items count:', assignedItemIds.length);
        // Build filter for ungrouped items
        const filter = {
            store: req.user.companyId,
            _id: { $nin: assignedItemIds }
        };
        // Add search filter
        if (search && search.trim()) {
            filter.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { code: { $regex: search.trim(), $options: 'i' } },
                { category: { $regex: search.trim(), $options: 'i' } }
            ];
        }
        console.log('🔍 Filter object:', JSON.stringify(filter, null, 2));
        // Get ungrouped items
        const items = yield Inventory_js_1.Item.find(filter)
            .select('name code category subCategory qty unit price image description store')
            .sort({ name: 1 })
            .lean();
        console.log('📦 Retrieved ungrouped item group:', items.length);
        // Format items with proper image URLs and ProductDetailsDailySummary data for item group
        const formattedItems = yield Promise.all(items.map((item) => __awaiter(void 0, void 0, void 0, function* () {
            const imageUrl = item.image ? (item.image.startsWith('/uploads/data:') ? item.image.replace('/uploads/', '') : item.image) : null;
            // Get ProductDailySummary data for qtyPerBatch
            const itemSummary = yield ProductDailySummary_js_1.default.findOne({
                productId: item._id,
                companyId: req.user.companyId
            }).lean();
            // Get today's ProductDetailsDailySummary for batchAdjusted
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const todayDetails = yield ProductDetailsDailySummary_js_1.default.findOne({
                productId: item._id,
                companyId: req.user.companyId,
                date: {
                    $gte: today,
                    $lt: tomorrow
                }
            }).lean();
            return {
                _id: item._id,
                name: item.name || 'Unnamed Item',
                code: item.code || 'No Code',
                category: item.category || 'No Category',
                subCategory: item.subCategory || '',
                qty: item.qty || 0,
                unit: item.unit || '',
                price: item.price || 0,
                description: item.description || '',
                image: imageUrl,
                batchAdjusted: (todayDetails === null || todayDetails === void 0 ? void 0 : todayDetails.batchAdjusted) || 0,
                qtyPerBatch: (itemSummary === null || itemSummary === void 0 ? void 0 : itemSummary.qtyPerBatch) || 0
            };
        })));
        // Filter out items with qtyPerBatch = 0 (only return items with available Qty/Batch)
        const availableItems = formattedItems.filter(item => item.qtyPerBatch > 0);
        console.log(`📊 Filtered item group: ${formattedItems.length} total → ${availableItems.length} with qtyPerBatch > 0`);
        console.log('📤 Returning ungrouped item group with available Qty/Batch:', {
            total: availableItems.length,
            withImages: availableItems.filter(item => item.image).length,
            assignedItemsCount: assignedItemIds.length,
            totalCompanyItems: totalCompanyItems,
            filteredOut: formattedItems.length - availableItems.length
        });
        res.json({
            success: true,
            data: {
                items: availableItems,
                totalItems: availableItems.length,
                assignedItemsCount: assignedItemIds.length,
                companyItemsCount: totalCompanyItems,
                ungroupedItemsCount: availableItems.length,
                filteredItemsCount: formattedItems.length - availableItems.length
            }
        });
    }
    catch (error) {
        console.error('Error fetching ungrouped item group:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch ungrouped item group',
            error: error.message
        });
    }
});
exports.getUngroupedItemGroup = getUngroupedItemGroup;
// Get ungrouped item production data for today
const getUngroupedItemProduction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔍 Ungrouped Item Production Request:', {
            role: req.user.role,
            username: req.user.username,
            companyId: req.user.companyId,
            query: req.query
        });
        // Validate user and company
        if (!req.user || !req.user.companyId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required with valid company'
            });
        }
        const today = new Date().setHours(0, 0, 0, 0);
        console.log('📅 Fetching production data for date:', new Date(today));
        // Get all ungrouped item production records for today
        const productionRecords = yield ProductionBatch_js_1.default.find({
            companyId: req.user.companyId,
            productionDate: today
        }).populate('itemId', 'name code category image qtyPerBatch').lean();
        console.log('📊 Found production records:', productionRecords.length);
        // Format the response with batch support
        const formattedRecords = {};
        productionRecords.forEach(record => {
            if (record.itemId) {
                // Always create item key with batch support for consistency
                const itemKey = `ungrouped_${record.itemId._id}_batch_${record.batchNumber || 1}`;
                formattedRecords[itemKey] = {
                    _id: record._id,
                    mouldingTime: record.mouldingTime ? record.mouldingTime.toISOString() : '',
                    unloadingTime: record.unloadingTime ? record.unloadingTime.toISOString() : '',
                    productionLoss: record.productionLoss || '',
                    qtyPerBatch: record.qtyPerBatch || record.itemId.qtyPerBatch || 0,
                    qtyAchieved: record.qtyAchieved || 0,
                    status: record.status,
                    itemId: record.itemId._id,
                    batchNumber: record.batchNumber || 1,
                    productionDate: record.productionDate
                };
            }
        });
        console.log('📤 Returning production data for items:', Object.keys(formattedRecords).length);
        res.json({
            success: true,
            data: {
                productionRecords: formattedRecords,
                totalRecords: Object.keys(formattedRecords).length,
                productionDate: today
            }
        });
    }
    catch (error) {
        console.error('Error fetching ungrouped item production data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch ungrouped item production data',
            error: error.message
        });
    }
});
exports.getUngroupedItemProduction = getUngroupedItemProduction;
// Update production data - handles both grouped and ungrouped items
const updateUngroupedItemProduction = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🔄 Universal Production Update Request:', req.body);
        console.log('🔄 User Info:', {
            userId: req.user._id,
            username: req.user.username,
            companyId: req.user.companyId
        });
        const { _id, field, value, batchno } = req.body;
        // Validate required fields
        if (!_id) {
            return res.status(400).json({
                success: false,
                message: '_id (item ID) is required'
            });
        }
        if (!field) {
            return res.status(400).json({
                success: false,
                message: 'field is required'
            });
        }
        if (!batchno) {
            return res.status(400).json({
                success: false,
                message: 'batchno is required'
            });
        }
        console.log(`📦 Processing: itemId=${_id}, batchNo=${batchno}, field=${field}`);
        // Set production date - use from request if available, otherwise default to today
        let productionDate;
        if (req.body.productionDate) {
            productionDate = new Date(req.body.productionDate);
            productionDate.setUTCHours(0, 0, 0, 0);
            console.log(`📅 Using productionDate from request: ${productionDate.toISOString()}`);
        }
        else {
            productionDate = new Date();
            productionDate.setUTCHours(0, 0, 0, 0);
            console.log(`📅 Using default productionDate (today): ${productionDate.toISOString()}`);
        }
        const today = productionDate; // Keeping variable name for compatibility with existing code
        // Find existing ProductionBatch record by batchNo
        let productionRecord = yield ProductionBatch_js_1.default.findOne({
            companyId: req.user.companyId,
            batchNo: batchno,
            productionDate: today
        });
        if (!productionRecord) {
            console.log(`🆕 NO existing ProductionBatch record found for batchNo: ${batchno} - CREATING NEW`);
            // Get qtyPerBatch from ProductDailySummary
            const itemSummary = yield ProductDailySummary_js_1.default.findOne({
                productId: _id,
                companyId: req.user.companyId
            }).lean();
            const defaultQtyPerBatch = (itemSummary === null || itemSummary === void 0 ? void 0 : itemSummary.qtyPerBatch) || 100; // Default to 100 instead of 0
            const batchNumber = parseInt(batchno.replace('BATNO', '')) || 1;
            console.log(`📊 Using qtyPerBatch from ProductDailySummary: ${defaultQtyPerBatch}`);
            if (!itemSummary) {
                console.warn(`⚠️ No ProductDailySummary found for productId: ${_id}, using default qtyPerBatch: ${defaultQtyPerBatch}`);
            }
            // Calculate correct qtyAchieved based on totalBatchAdjusted (if available)
            // Default to 1.0 if not specified
            const totalBatchAdjusted = 1.0; // Will be updated when batch record is found/created
            const initialQtyAchieved = defaultQtyPerBatch * totalBatchAdjusted;
            // Create new production record
            productionRecord = new ProductionBatch_js_1.default({
                companyId: req.user.companyId,
                itemId: _id,
                batchNo: batchno,
                batchNumber: batchNumber,
                productionDate: today,
                qtyPerBatch: defaultQtyPerBatch,
                qtyAchieved: initialQtyAchieved,
                totalBatchAdjusted: totalBatchAdjusted,
                productionLoss: 0,
                status: 'in_progress',
                createdBy: req.user.username || req.user._id,
                updatedBy: req.user.username || req.user._id
            });
            console.log(`🆕 Created new record for batchNo: ${batchno}, itemId: ${_id}, totalBatchAdjusted: ${totalBatchAdjusted}`);
        }
        else {
            console.log(`✅ Found existing ProductionBatch record for batchNo: ${batchno}`, {
                qtyPerBatch: productionRecord.qtyPerBatch,
                totalBatchAdjusted: productionRecord.totalBatchAdjusted,
                qtyAchieved: productionRecord.qtyAchieved,
                productionLoss: productionRecord.productionLoss
            });
        }
        // Validate field
        const allowedFields = ['mouldingTime', 'unloadingTime', 'productionLoss', 'qtyPerBatch', 'qtyAchieved', 'notes'];
        if (!allowedFields.includes(field)) {
            return res.status(400).json({
                success: false,
                message: `Invalid field. Allowed fields: ${allowedFields.join(', ')}`
            });
        }
        // Process the field value based on type
        let processedValue = value;
        if (field === 'mouldingTime' || field === 'unloadingTime') {
            if (value) {
                processedValue = new Date(value);
                if (isNaN(processedValue.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid datetime format'
                    });
                }
            }
            else {
                processedValue = null;
            }
        }
        else if (field === 'productionLoss' || field === 'qtyPerBatch' || field === 'qtyAchieved') {
            processedValue = parseFloat(value);
            if (isNaN(processedValue)) {
                processedValue = 0;
            }
        }
        // Update the field
        productionRecord[field] = processedValue;
        productionRecord.updatedBy = req.user.username || req.user._id;
        productionRecord.updatedAt = new Date();
        // ALWAYS recalculate qtyAchieved based on totalBatchAdjusted, qtyPerBatch, and productionLoss
        // Formula: qtyAchieved = (totalBatchAdjusted × qtyPerBatch) - productionLoss
        const totalBatchAdjusted = productionRecord.totalBatchAdjusted || 1;
        const qtyPerBatch = productionRecord.qtyPerBatch || 0;
        const productionLoss = productionRecord.productionLoss || 0;
        const calculatedQtyAchieved = (totalBatchAdjusted * qtyPerBatch) - productionLoss;
        console.log(`🧮 Recalculating qtyAchieved:`);
        console.log(`   Formula: (${totalBatchAdjusted} × ${qtyPerBatch}) - ${productionLoss} = ${calculatedQtyAchieved}`);
        // Validate that production loss doesn't exceed the batch quantity
        if (productionLoss > (totalBatchAdjusted * qtyPerBatch)) {
            return res.status(400).json({
                success: false,
                message: 'Production loss cannot exceed batch quantity',
                error: `Production loss (${productionLoss}) exceeds available quantity (${totalBatchAdjusted * qtyPerBatch})`
            });
        }
        // Set the calculated qtyAchieved rounded to 2 decimal places
        productionRecord.qtyAchieved = Math.round(Math.max(0, calculatedQtyAchieved) * 100) / 100;
        console.log(`   ✅ Set qtyAchieved to: ${productionRecord.qtyAchieved}`);
        // Auto-update status based on field changes
        if (field === 'mouldingTime' && processedValue) {
            // When moulding time is set, change status to 'in_progress' 
            if (productionRecord.status === 'pending' || productionRecord.status === 'not_started') {
                productionRecord.status = 'in_progress';
                console.log(`📊 Auto-updating status to 'in_progress' due to moulding time being set`);
            }
        }
        if (field === 'unloadingTime' && processedValue) {
            // When unloading time is set, change status to 'completed'
            productionRecord.status = 'completed';
            console.log(`📊 Auto-updating status to 'completed' due to unloading time being set`);
        }
        if (field === 'productionLoss') {
            // When production loss is entered, change status to 'completed'
            productionRecord.status = 'completed';
            console.log(`📊 Auto-updating status to 'completed' due to production loss being entered`);
        }
        // Check if both times are set and auto-complete
        if (productionRecord.mouldingTime && productionRecord.unloadingTime && productionRecord.status !== 'completed') {
            productionRecord.status = 'completed';
            console.log(`📊 Auto-updating status to 'completed' because both moulding and unloading times are set`);
        }
        console.log(`🔧 Updated field: ${field} with value:`, processedValue);
        // Save the record with proper error handling
        let savedRecord;
        try {
            savedRecord = yield productionRecord.save();
        }
        catch (validationError) {
            console.error('❌ Validation error during save:', validationError);
            // Handle validation errors with user-friendly messages
            if (validationError.name === 'ValidationError') {
                const validationMessages = [];
                for (let field in validationError.errors) {
                    const error = validationError.errors[field];
                    if (error.kind === 'min') {
                        validationMessages.push(`${field} cannot be negative (current value: ${error.value})`);
                    }
                    else {
                        validationMessages.push(`${field}: ${error.message}`);
                    }
                }
                return res.status(400).json({
                    success: false,
                    message: 'Validation failed',
                    details: validationMessages,
                    error: 'Please check your input values and ensure they meet the requirements'
                });
            }
            // Re-throw if not a validation error
            throw validationError;
        }
        console.log(`✅ Successfully ${savedRecord.isNew === false ? 'UPDATED' : 'CREATED'} record for batchNo: ${batchno}`);
        // Return success response
        res.json({
            success: true,
            message: `${field} updated successfully for batch ${batchno}`,
            data: {
                _id: savedRecord._id,
                batchNo: savedRecord.batchNo,
                batchNumber: savedRecord.batchNumber,
                itemId: savedRecord.itemId,
                groupId: savedRecord.groupId,
                companyId: savedRecord.companyId,
                productionDate: savedRecord.productionDate,
                mouldingTime: savedRecord.mouldingTime,
                unloadingTime: savedRecord.unloadingTime,
                productionLoss: savedRecord.productionLoss,
                qtyPerBatch: savedRecord.qtyPerBatch,
                qtyAchieved: savedRecord.qtyAchieved,
                status: savedRecord.status,
                updatedField: field,
                updatedValue: processedValue
            }
        });
    }
    catch (error) {
        console.error('❌ Error updating production data:', error);
        // Handle specific database errors with better error messages
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Duplicate entry detected',
                error: 'A record with this batch number and date already exists'
            });
        }
        // Handle validation errors
        if (error.name === 'ValidationError') {
            const validationMessages = [];
            for (let field in error.errors) {
                const fieldError = error.errors[field];
                if (fieldError.kind === 'min') {
                    validationMessages.push(`${field} cannot be negative (current value: ${fieldError.value})`);
                }
                else {
                    validationMessages.push(`${field}: ${fieldError.message}`);
                }
            }
            return res.status(400).json({
                success: false,
                message: 'Input validation failed',
                details: validationMessages,
                error: 'Please ensure all values meet the required constraints'
            });
        }
        // Handle CastError (invalid ObjectId, etc.)
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid data format',
                error: `Invalid ${error.path}: ${error.value}`
            });
        }
        // Generic server error
        res.status(500).json({
            success: false,
            message: 'Failed to update production data',
            error: 'An unexpected error occurred. Please try again.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});
exports.updateUngroupedItemProduction = updateUngroupedItemProduction;
// Helper function to generate batch number in format BATNO01, BATNO02, etc.
const generateBatchNumber = (itemId, companyId, productionDate) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Find the highest batch number for this item, company, and date
        const existingBatches = yield ProductionBatch_js_1.default.find({
            itemId: itemId,
            companyId: companyId,
            productionDate: productionDate
        }).sort({ batchNumber: -1 }).limit(1);
        let nextBatchNumber = 1;
        if (existingBatches.length > 0) {
            nextBatchNumber = (existingBatches[0].batchNumber || 0) + 1;
        }
        // Format as BATNO01, BATNO02, etc.
        const batchNo = `BATNO${nextBatchNumber.toString().padStart(2, '0')}`;
        return { batchNo, batchNumber: nextBatchNumber };
    }
    catch (error) {
        console.error('Error generating batch number:', error);
        return { batchNo: 'BATNO01', batchNumber: 1 };
    }
});
// Create/update ungrouped item production with batch tracking
const updateUngroupedItemProductionWithBatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('🏭 updateUngroupedItemProductionWithBatch called');
        console.log('Request body:', req.body);
        console.log('User:', { id: req.user._id, role: req.user.role, companyId: req.user.companyId });
        // return false;
        const { itemId, field, value, batchno } = req.body;
        const userId = req.user._id.toString();
        const companyId = req.user.companyId;
        // Validate required fields
        if (!itemId) {
            return res.status(400).json({
                success: false,
                message: 'Item ID is required'
            });
        }
        if (!field) {
            return res.status(400).json({
                success: false,
                message: 'Field name is required'
            });
        }
        // Set production date - use from request if available, otherwise default to today
        let productionDate;
        if (req.body.productionDate) {
            productionDate = new Date(req.body.productionDate);
            productionDate.setUTCHours(0, 0, 0, 0);
        }
        else {
            const today = new Date();
            productionDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
        }
        console.log('📅 Production date (UTC):', productionDate.toISOString());
        // batchno is required from frontend
        if (!batchno) {
            return res.status(400).json({
                success: false,
                message: 'batchno is required'
            });
        }
        const finalBatchNo = batchno;
        // Extract number from provided batch no (e.g., BATNO01 -> 1)
        const match = batchno.match(/BATNO(\d+)/);
        const batchNumber = match ? parseInt(match[1]) : 1;
        console.log(`📝 Using provided batch number: ${finalBatchNo} (${batchNumber})`);
        // Find existing production record for this batch
        // FIX: Try multiple query strategies to prevent duplicate creation
        console.log('🔍 Searching for existing production record...');
        // Strategy 1: Match by batchNo, companyId, and productionDate (most specific)
        let productionRecord = yield ProductionBatch_js_1.default.findOne({
            batchNo: finalBatchNo,
            companyId: companyId,
            productionDate: productionDate
        });
        // Strategy 2: If not found and itemId is provided, try with itemId
        if (!productionRecord && itemId) {
            console.log('   Strategy 1 failed, trying with itemId...');
            productionRecord = yield ProductionBatch_js_1.default.findOne({
                itemId: itemId,
                batchNo: finalBatchNo,
                companyId: companyId,
                productionDate: productionDate
            });
        }
        // Strategy 3: If still not found, search by batchNo and companyId only (for today)
        if (!productionRecord) {
            console.log('   Strategy 2 failed, trying by batchNo + companyId for today...');
            const todayStart = new Date(productionDate);
            todayStart.setUTCHours(0, 0, 0, 0);
            const todayEnd = new Date(todayStart);
            todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
            productionRecord = yield ProductionBatch_js_1.default.findOne({
                batchNo: finalBatchNo,
                companyId: companyId,
                productionDate: {
                    $gte: todayStart,
                    $lt: todayEnd
                }
            });
        }
        if (productionRecord) {
            console.log(`✅ Found existing record: ${productionRecord._id}`);
        }
        if (!productionRecord) {
            console.log('❌ No existing record found, creating new...');
            // Get item details for qtyPerBatch
            const item = itemId ? yield Inventory_js_1.Item.findById(itemId).select('name qty batch') : null;
            const qtyPerBatch = (item === null || item === void 0 ? void 0 : item.batch) ? parseInt(item.batch) : (item === null || item === void 0 ? void 0 : item.qty) || 234; // Default fallback
            console.log('🆕 Creating new production record...');
            productionRecord = new ProductionBatch_js_1.default({
                companyId: companyId,
                itemId: itemId,
                batchNumber: batchNumber,
                batchNo: finalBatchNo,
                qtyPerBatch: qtyPerBatch,
                productionDate: productionDate,
                createdBy: userId,
                notes: `Batch: ${finalBatchNo}`,
                status: 'pending'
            });
        }
        // Update the specified field
        const allowedFields = ['mouldingTime', 'unloadingTime', 'productionLoss', 'qtyPerBatch'];
        if (!allowedFields.includes(field)) {
            return res.status(400).json({
                success: false,
                message: `Invalid field. Allowed fields: ${allowedFields.join(', ')}`
            });
        }
        // Set the field value
        if (field === 'mouldingTime' || field === 'unloadingTime') {
            productionRecord[field] = new Date(value);
        }
        else {
            productionRecord[field] = parseFloat(value) || 0;
        }
        productionRecord.updatedBy = userId;
        // If we're updating productionLoss or qtyPerBatch, ensure qtyAchieved is recalculated
        if (field === 'productionLoss' || field === 'qtyPerBatch') {
            console.log(`📊 AUTO-CALCULATING qtyAchieved: ${productionRecord.qtyPerBatch} - ${productionRecord.productionLoss}`);
            productionRecord.qtyAchieved = Math.max(0, (productionRecord.qtyPerBatch || 0) - (productionRecord.productionLoss || 0));
            console.log(`📊 NEW qtyAchieved: ${productionRecord.qtyAchieved}`);
        }
        // Save the record (pre-save middleware will calculate qtyAchieved and status)
        yield productionRecord.save();
        console.log('✅ Production record updated successfully');
        console.log('Updated record:', {
            id: productionRecord._id,
            itemId: productionRecord.itemId,
            batchNo: finalBatchNo,
            batchNumber: productionRecord.batchNumber,
            field: field,
            value: productionRecord[field],
            status: productionRecord.status
        });
        res.json({
            success: true,
            message: 'Ungrouped item production updated successfully',
            data: {
                id: productionRecord._id,
                itemId: productionRecord.itemId,
                companyId: productionRecord.companyId,
                batchNo: finalBatchNo,
                batchNumber: productionRecord.batchNumber,
                mouldingTime: productionRecord.mouldingTime,
                unloadingTime: productionRecord.unloadingTime,
                productionLoss: productionRecord.productionLoss,
                qtyPerBatch: productionRecord.qtyPerBatch,
                qtyAchieved: productionRecord.qtyAchieved,
                status: productionRecord.status,
                productionDate: productionRecord.productionDate,
                updatedField: field,
                updatedValue: productionRecord[field],
                createdAt: productionRecord.createdAt,
                updatedAt: productionRecord.updatedAt
            }
        });
    }
    catch (error) {
        console.error('Error updating ungrouped item production with batch:', error);
        // Handle duplicate key error
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A production record for this item and batch already exists for today',
                error: 'Duplicate batch entry'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to update ungrouped item production',
            error: error.message
        });
    }
});
exports.updateUngroupedItemProductionWithBatch = updateUngroupedItemProductionWithBatch;
// Get all production data for reports (history)
const getAllProductionReports = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 10, fromDate, toDate, startDate, endDate, companyId, status, itemId, groupId } = req.query;
        const userCompanyId = req.user.companyId;
        console.log('📊 Production Reports Query Parameters:', {
            page, limit, fromDate, toDate, startDate, endDate, status
        });
        // Build filter object
        const filter = {
            companyId: companyId || userCompanyId
        };
        // Add date range filter - support both fromDate/toDate and startDate/endDate
        const start = fromDate || startDate;
        const end = toDate || endDate;
        if (start || end) {
            filter.productionDate = {};
            if (start) {
                filter.productionDate.$gte = new Date(start);
            }
            if (end) {
                const endDateObj = new Date(end);
                endDateObj.setHours(23, 59, 59, 999); // Include full end date
                filter.productionDate.$lte = endDateObj;
            }
        }
        // Add status filter
        if (status && status !== 'all') {
            filter.status = status;
        }
        // Add item filter (search in combinedItems array)
        if (itemId) {
            filter['combinedItems.itemId'] = itemId;
        }
        // Add group filter
        if (groupId) {
            filter.groupId = groupId;
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        // Get paginated production data with populated item and group details
        const productionData = yield ProductionBatch_js_1.default.find(filter)
            .populate({
            path: 'combinedItems.itemId',
            model: 'Item',
            select: 'name code category subCategory unit type importance store'
        })
            .populate({
            path: 'groupId',
            select: 'name description'
        })
            .populate({
            path: 'companyId',
            select: 'companyName'
        })
            .sort({ productionDate: -1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();
        // Get total count for pagination
        const totalCount = yield ProductionBatch_js_1.default.countDocuments(filter);
        const totalPages = Math.ceil(totalCount / parseInt(limit));
        // Calculate summary statistics
        const summaryStats = yield ProductionBatch_js_1.default.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalBatches: { $sum: 1 },
                    totalProduced: { $sum: '$qtyAchieved' },
                    totalPlanned: { $sum: '$qtyPerBatch' },
                    totalLoss: { $sum: '$productionLoss' },
                    completedBatches: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    inProgressBatches: {
                        $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] }
                    },
                    pendingBatches: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                    }
                }
            }
        ]);
        const stats = summaryStats[0] || {
            totalBatches: 0,
            totalProduced: 0,
            totalPlanned: 0,
            totalLoss: 0,
            completedBatches: 0,
            inProgressBatches: 0,
            pendingBatches: 0
        };
        // Calculate efficiency percentage
        stats.efficiency = stats.totalPlanned > 0
            ? ((stats.totalProduced / stats.totalPlanned) * 100).toFixed(2)
            : 0;
        // Format the production data
        const formattedData = productionData.map(batch => {
            // Get item details from combinedItems (can be single or multiple items)
            let itemInfo = null;
            let itemsList = [];
            if (batch.combinedItems && batch.combinedItems.length > 0) {
                itemsList = batch.combinedItems.map(ci => {
                    var _a, _b, _c, _d, _e, _f, _g, _h;
                    return ({
                        id: (_a = ci.itemId) === null || _a === void 0 ? void 0 : _a._id,
                        name: ((_b = ci.itemId) === null || _b === void 0 ? void 0 : _b.name) || 'Unknown Item',
                        code: (_c = ci.itemId) === null || _c === void 0 ? void 0 : _c.code,
                        category: (_d = ci.itemId) === null || _d === void 0 ? void 0 : _d.category,
                        subCategory: (_e = ci.itemId) === null || _e === void 0 ? void 0 : _e.subCategory,
                        unit: (_f = ci.itemId) === null || _f === void 0 ? void 0 : _f.unit,
                        type: (_g = ci.itemId) === null || _g === void 0 ? void 0 : _g.type,
                        importance: (_h = ci.itemId) === null || _h === void 0 ? void 0 : _h.importance,
                        batchAdjustedValue: ci.batchAdjustedValue,
                        qtyContribution: ci.qtyContribution
                    });
                });
                // For single item, use it directly
                if (itemsList.length === 1) {
                    itemInfo = {
                        id: itemsList[0].id,
                        name: itemsList[0].name,
                        code: itemsList[0].code,
                        category: itemsList[0].category,
                        subCategory: itemsList[0].subCategory,
                        unit: itemsList[0].unit,
                        type: itemsList[0].type,
                        importance: itemsList[0].importance
                    };
                }
                else {
                    // For multiple items, show combined info
                    itemInfo = {
                        id: null,
                        name: `Combined Batch (${itemsList.length} items)`,
                        code: batch.batchNo,
                        category: 'Combined',
                        subCategory: '',
                        unit: '',
                        type: 'combined',
                        importance: ''
                    };
                }
            }
            return {
                id: batch._id,
                batchNo: batch.batchNo,
                batchNumber: batch.batchNumber,
                productionDate: batch.productionDate,
                item: itemInfo,
                items: itemsList.length > 1 ? itemsList : undefined, // Only include if multiple items
                isCombined: batch.combinedItems && batch.combinedItems.length > 1,
                group: batch.groupId ? {
                    id: batch.groupId._id,
                    name: batch.groupId.name,
                    description: batch.groupId.description
                } : null,
                company: batch.companyId ? {
                    id: batch.companyId._id,
                    name: batch.companyId.companyName
                } : null,
                production: {
                    qtyPerBatch: batch.qtyPerBatch,
                    qtyAchieved: batch.qtyAchieved,
                    productionLoss: batch.productionLoss,
                    totalBatchAdjusted: batch.totalBatchAdjusted,
                    efficiency: batch.qtyPerBatch > 0
                        ? ((batch.qtyAchieved / batch.qtyPerBatch) * 100).toFixed(2)
                        : 0
                },
                timing: {
                    mouldingTime: batch.mouldingTime,
                    unloadingTime: batch.unloadingTime,
                    duration: batch.mouldingTime && batch.unloadingTime
                        ? Math.round((new Date(batch.unloadingTime) - new Date(batch.mouldingTime)) / (1000 * 60)) + ' minutes'
                        : null
                },
                status: batch.status,
                notes: batch.notes,
                createdBy: batch.createdBy,
                updatedBy: batch.updatedBy,
                createdAt: batch.createdAt,
                updatedAt: batch.updatedAt
            };
        });
        res.json({
            success: true,
            message: 'Production reports retrieved successfully',
            data: {
                reports: formattedData,
                totalRecords: totalCount
            },
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalCount,
                totalItems: totalCount,
                limit: parseInt(limit),
                hasNext: parseInt(page) < totalPages,
                hasPrev: parseInt(page) > 1
            },
            summary: stats,
            filters: {
                fromDate: start,
                toDate: end,
                companyId: filter.companyId,
                status,
                itemId,
                groupId
            }
        });
    }
    catch (error) {
        console.error('Error fetching production reports:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch production reports',
            error: error.message
        });
    }
});
exports.getAllProductionReports = getAllProductionReports;
