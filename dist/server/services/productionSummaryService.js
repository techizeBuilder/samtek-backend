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
exports.initializeProductSummary = exports.getSalesBreakdown = exports.updateProductSummary = void 0;
const Order_js_1 = __importDefault(require("../models/Order.js"));
const ProductDailySummary_js_1 = __importDefault(require("../models/ProductDailySummary.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Update product summary when orders change
 * @param {string} productId - Product ID
 * @param {Date} date - Order date
 * @param {string} companyId - Company ID
 */
const updateProductSummary = (productId, date, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Normalize date to start of day
        const summaryDate = new Date(date);
        summaryDate.setUTCHours(0, 0, 0, 0);
        // Get product details
        const product = yield Inventory_js_1.Item.findById(productId);
        if (!product) {
            throw new Error(`Product not found: ${productId}`);
        }
        // Aggregate total indent for this product/date/company
        const aggregationResult = yield Order_js_1.default.aggregate([
            {
                $match: {
                    companyId: new mongoose_1.default.Types.ObjectId(companyId),
                    orderDate: {
                        $gte: summaryDate,
                        $lt: new Date(summaryDate.getTime() + 24 * 60 * 60 * 1000) // Next day
                    },
                    'products.product': new mongoose_1.default.Types.ObjectId(productId),
                    status: { $nin: ['cancelled', 'rejected'] } // Exclude cancelled/rejected orders
                }
            },
            {
                $unwind: '$products'
            },
            {
                $match: {
                    'products.product': new mongoose_1.default.Types.ObjectId(productId)
                }
            },
            {
                $group: {
                    _id: null,
                    totalIndent: { $sum: '$products.quantity' }
                }
            }
        ]);
        const totalIndent = aggregationResult.length > 0 ? aggregationResult[0].totalIndent : 0;
        // Find existing summary document (IGNORE DATE - use only company+product)
        let summary = yield ProductDailySummary_js_1.default.findOne({
            companyId: new mongoose_1.default.Types.ObjectId(companyId),
            productId: new mongoose_1.default.Types.ObjectId(productId)
        });
        if (summary) {
            // Update existing summary
            summary.totalIndent = totalIndent;
            summary.calculateFormulas();
            yield summary.save();
            console.log(`Updated product summary for ${product.name} on ${summaryDate.toISOString().split('T')[0]}: totalIndent = ${totalIndent}`);
        }
        else {
            console.log(`No existing summary found for ${product.name} on ${summaryDate.toISOString().split('T')[0]}, skipping auto-creation`);
            return null;
        }
        return summary;
    }
    catch (error) {
        console.error('Error updating product summary:', error);
        throw error;
    }
});
exports.updateProductSummary = updateProductSummary;
/**
 * Get sales breakdown for a product on a specific date
 * @param {string} productId - Product ID
 * @param {Date} date - Date
 * @param {string} companyId - Company ID
 */
const getSalesBreakdown = (productIds, date, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log(`🔍 Getting sales breakdown for ${Array.isArray(productIds) ? productIds.length : 1} products, date: ${date}, companyId: ${companyId}`);
        // Handle single productId or array of productIds
        const productIdArray = Array.isArray(productIds) ? productIds : [productIds];
        const objectIds = productIdArray.map(id => new mongoose_1.default.Types.ObjectId(id._id || id));
        // Build match filter for orders
        const matchFilter = {
            status: 'approved' // Only count approved orders for production summary
        };
        // Add company filter if provided
        if (companyId) {
            matchFilter.companyId = new mongoose_1.default.Types.ObjectId(companyId);
        }
        // Apply date filter if provided
        if (date) {
            if (date instanceof Date) {
                // Single date logic
                const filterDate = new Date(date);
                filterDate.setUTCHours(0, 0, 0, 0);
                const nextDay = new Date(filterDate.getTime() + 24 * 60 * 60 * 1000);
                matchFilter.orderDate = {
                    $gte: filterDate,
                    $lt: nextDay
                };
                console.log(`📅 Single date filter: ${filterDate.toISOString()} to ${nextDay.toISOString()}`);
            }
            else if (typeof date === 'object' && (date.$gte || date.$lte)) {
                // Range filter already formatted (from controller)
                matchFilter.orderDate = date;
                console.log('📅 Date range filter applied from object:', JSON.stringify(date));
            }
        }
        else {
            console.log(`📅 No date filter applied - getting all orders`);
        }
        console.log('🔍 Match filter for orders:', matchFilter);
        const breakdown = yield Order_js_1.default.aggregate([
            {
                $match: matchFilter
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'salesPerson',
                    foreignField: '_id',
                    as: 'salesPersonDetails'
                }
            },
            {
                $lookup: {
                    from: 'customers',
                    localField: 'customer',
                    foreignField: '_id',
                    as: 'customerDetails'
                }
            },
            {
                $unwind: '$products'
            },
            {
                $match: {
                    'products.product': { $in: objectIds }
                }
            },
            {
                $group: {
                    _id: {
                        productId: '$products.product',
                        salesPersonId: '$salesPerson'
                    },
                    productId: { $first: '$products.product' },
                    salesPersonId: { $first: '$salesPerson' },
                    salesPersonName: {
                        $first: {
                            $ifNull: [
                                { $arrayElemAt: ['$salesPersonDetails.fullName', 0] },
                                { $arrayElemAt: ['$salesPersonDetails.username', 0] },
                                'Unknown'
                            ]
                        }
                    },
                    totalQuantity: { $sum: '$products.quantity' },
                    orderCount: { $sum: 1 },
                    orderIds: { $push: '$_id' }
                }
            },
            // Group by product to collect all salesperson data for each product
            {
                $group: {
                    _id: '$productId',
                    productId: { $first: '$productId' },
                    salesBreakdown: {
                        $push: {
                            salesPersonId: '$salesPersonId',
                            salesPersonName: '$salesPersonName',
                            totalQuantity: '$totalQuantity',
                            orderCount: '$orderCount',
                            orderIds: '$orderIds'
                        }
                    },
                    totalIndent: { $sum: '$totalQuantity' },
                    totalOrderCount: { $sum: '$orderCount' }
                }
            },
            {
                $project: {
                    _id: 0,
                    productId: 1,
                    summary: {
                        totalIndent: '$totalIndent',
                        orderCount: '$totalOrderCount'
                    },
                    salesBreakdown: 1
                }
            }
        ]);
        console.log(`📊 Sales breakdown result: ${breakdown.length} products found with salesperson data`);
        // Log sample data
        if (breakdown.length > 0) {
            console.log('📋 Sample breakdown:', JSON.stringify(breakdown[0], null, 2));
            console.log('📋 Full breakdown structure:', breakdown.map(b => {
                var _a, _b;
                return ({
                    productId: b.productId,
                    salesBreakdownCount: ((_a = b.salesBreakdown) === null || _a === void 0 ? void 0 : _a.length) || 0,
                    totalIndent: ((_b = b.summary) === null || _b === void 0 ? void 0 : _b.totalIndent) || 0
                });
            }));
        }
        else {
            console.log(`📭 No orders found for products on date: ${date || 'all dates'}`);
            console.log('📋 Match filter used:', matchFilter);
        }
        return breakdown;
    }
    catch (error) {
        console.error('Error getting sales breakdown:', error);
        return [];
    }
});
exports.getSalesBreakdown = getSalesBreakdown;
/**
 * Initialize summary for a new product
 * @param {string} productId - Product ID
 * @param {string} productName - Product name
 * @param {string} companyId - Company ID
 */
const initializeProductSummary = (productId, productName, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        // ✅ FIXED: Check for existing entry by productId + companyId ONLY (ignore date)
        const existingSummary = yield ProductDailySummary_js_1.default.findOne({
            companyId: new mongoose_1.default.Types.ObjectId(companyId),
            productId: new mongoose_1.default.Types.ObjectId(productId)
        });
        if (existingSummary) {
            console.log(`Found existing summary for product ${productName}, updating date to today`);
            // Update the existing entry's date to today and return
            existingSummary.date = today;
            yield existingSummary.save();
            return existingSummary;
        }
        // Create new summary ONLY if no entry exists for this product + company
        const summary = new ProductDailySummary_js_1.default({
            date: today,
            companyId: new mongoose_1.default.Types.ObjectId(companyId),
            productId: new mongoose_1.default.Types.ObjectId(productId),
            productName: productName,
            qtyPerBatch: 0,
            packing: 0,
            physicalStock: 0,
            batchAdjusted: 0,
            totalIndent: 0
        });
        summary.calculateFormulas();
        yield summary.save();
        console.log(`Initialized NEW summary for product: ${productName}`);
        return summary;
    }
    catch (error) {
        console.error('Error initializing product summary:', error);
        throw error;
    }
});
exports.initializeProductSummary = initializeProductSummary;
