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
exports.getReturnStats = exports.deleteReturn = exports.updateReturnStatus = exports.updateReturn = exports.createReturn = exports.getReturnById = exports.getAllReturns = void 0;
const Return_js_1 = __importDefault(require("../models/Return.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Product_js_1 = __importDefault(require("../models/Product.js"));
const Brand_js_1 = __importDefault(require("../models/Brand.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const express_validator_1 = require("express-validator");
// Get all returns with filtering and pagination
const getAllReturns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        // Build filter object
        const filter = {};
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.type) {
            filter.type = req.query.type;
        }
        if (req.query.customerId) {
            filter.customerId = req.query.customerId;
        }
        if (req.query.search) {
            filter.$or = [
                { customerName: { $regex: req.query.search, $options: 'i' } },
                { reason: { $regex: req.query.search, $options: 'i' } },
                { 'items.productName': { $regex: req.query.search, $options: 'i' } }
            ];
        }
        if (req.query.startDate || req.query.endDate) {
            filter.returnDate = {};
            if (req.query.startDate) {
                filter.returnDate.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filter.returnDate.$lte = new Date(req.query.endDate);
            }
        }
        // Get total count for pagination
        const total = yield Return_js_1.default.countDocuments(filter);
        // Get returns with population (use Item model for productId)
        const returns = yield Return_js_1.default.find(filter)
            .populate('customerId', 'name email mobile')
            .populate('items.productId', 'name salePrice stdCost image category', 'Item')
            .populate('items.brandId', 'name')
            .populate('createdBy', 'username fullName')
            .populate('updatedBy', 'username fullName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        res.json({
            success: true,
            returns,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit),
                limit
            }
        });
    }
    catch (error) {
        console.error('Error fetching returns:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching returns',
            error: error.message
        });
    }
});
exports.getAllReturns = getAllReturns;
// Get single return by ID
const getReturnById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const returnDoc = yield Return_js_1.default.findById(req.params.id)
            .populate('customerId', 'name email mobile address')
            .populate('items.productId', 'name salePrice stdCost image description category', 'Item')
            .populate('items.brandId', 'name description')
            .populate('createdBy', 'username fullName')
            .populate('updatedBy', 'username fullName');
        if (!returnDoc) {
            return res.status(404).json({
                success: false,
                message: 'Return entry not found'
            });
        }
        res.json({
            success: true,
            return: returnDoc
        });
    }
    catch (error) {
        console.error('Error fetching return:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching return',
            error: error.message
        });
    }
});
exports.getReturnById = getReturnById;
// Create new return
const createReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // Check for validation errors
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.mapped()
            });
        }
        const { customerId, returnDate, reason, items, type, notes } = req.body;
        // Verify customer exists
        const customer = yield Customer_js_1.default.findById(customerId);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }
        // Verify all inventory items exist
        for (const item of items) {
            const inventoryItem = yield Inventory_js_1.Item.findById(item.productId);
            if (!inventoryItem) {
                return res.status(404).json({
                    success: false,
                    message: `Inventory item not found: ${item.productName}`
                });
            }
            // Optional: Check if brandId is provided and validate it
            if (item.brandId) {
                const brand = yield Brand_js_1.default.findById(item.brandId);
                if (!brand) {
                    return res.status(404).json({
                        success: false,
                        message: `Brand not found for item: ${item.productName}`
                    });
                }
            }
        }
        // Create return entry data
        const returnData = {
            customerId,
            customerName: customer.name,
            returnDate: returnDate || new Date(),
            reason,
            items,
            type: type || 'refund',
            notes: notes || '',
            createdBy: (_a = req.user) === null || _a === void 0 ? void 0 : _a.id
        };
        // If order ID is provided in body, fetch order to get orderDate
        if (req.body.order) {
            try {
                const orderDoc = yield (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default.findById(req.body.order);
                if (orderDoc) {
                    returnData.orderDate = orderDoc.orderDate || orderDoc.createdAt;
                    returnData.order = req.body.order;
                }
            }
            catch (err) {
                console.error('Error fetching order for return date (creation):', err);
            }
        }
        else if (req.body.orderId) { // some APIs use orderId
            try {
                const orderDoc = yield (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default.findById(req.body.orderId);
                if (orderDoc) {
                    returnData.orderDate = orderDoc.orderDate || orderDoc.createdAt;
                    returnData.order = req.body.orderId;
                }
            }
            catch (err) {
                console.error('Error fetching order for return date (creation via orderId):', err);
            }
        }
        const returnDoc = new Return_js_1.default(returnData);
        yield returnDoc.save();
        // Populate the created return (use Item model for productId)
        yield returnDoc.populate([
            { path: 'customerId', select: 'name email mobile' },
            { path: 'items.productId', select: 'name salePrice stdCost image category', model: 'Item' },
            { path: 'items.brandId', select: 'name' },
            { path: 'createdBy', select: 'username fullName' }
        ]);
        res.status(201).json({
            success: true,
            message: 'Return entry created successfully',
            returnId: returnDoc._id,
            return: returnDoc
        });
    }
    catch (error) {
        console.error('Error creating return:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating return entry',
            error: error.message
        });
    }
});
exports.createReturn = createReturn;
// Update return
const updateReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        // Check for validation errors
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.mapped()
            });
        }
        const returnDoc = yield Return_js_1.default.findById(req.params.id);
        if (!returnDoc) {
            return res.status(404).json({
                success: false,
                message: 'Return entry not found'
            });
        }
        const { customerId, returnDate, reason, items, type, notes, status } = req.body;
        // If customer is being changed, verify it exists
        if (customerId && customerId !== returnDoc.customerId.toString()) {
            const customer = yield Customer_js_1.default.findById(customerId);
            if (!customer) {
                return res.status(404).json({
                    success: false,
                    message: 'Customer not found'
                });
            }
            returnDoc.customerId = customerId;
            returnDoc.customerName = customer.name;
        }
        // Update fields
        if (returnDate)
            returnDoc.returnDate = returnDate;
        if (reason)
            returnDoc.reason = reason;
        if (items)
            returnDoc.items = items;
        if (type)
            returnDoc.type = type;
        if (notes !== undefined)
            returnDoc.notes = notes;
        if (status)
            returnDoc.status = status;
        returnDoc.updatedBy = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        yield returnDoc.save();
        // Populate the updated return (use Item model for productId)
        yield returnDoc.populate([
            { path: 'customerId', select: 'name email mobile' },
            { path: 'items.productId', select: 'name salePrice stdCost image category', model: 'Item' },
            { path: 'items.brandId', select: 'name' },
            { path: 'updatedBy', select: 'username fullName' }
        ]);
        res.json({
            success: true,
            message: 'Return entry updated successfully',
            return: returnDoc
        });
    }
    catch (error) {
        console.error('Error updating return:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating return entry',
            error: error.message
        });
    }
});
exports.updateReturn = updateReturn;
// Update return status
const updateReturnStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { status } = req.body;
        if (!status || !['pending', 'approved', 'completed', 'rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Valid status is required (pending, approved, completed, rejected)'
            });
        }
        const returnDoc = yield Return_js_1.default.findById(req.params.id);
        if (!returnDoc) {
            return res.status(404).json({
                success: false,
                message: 'Return entry not found'
            });
        }
        // If status is being updated to 'approved', deduct amount from customer outstanding and sync with Invoices
        if (status === 'approved' && returnDoc.status !== 'approved') {
            try {
                const customer = yield Customer_js_1.default.findById(returnDoc.customerId);
                if (customer) {
                    const oldBalance = customer.outstandingAmount || 0;
                    customer.outstandingAmount = oldBalance - (returnDoc.totalAmount || 0);
                    yield customer.save();
                    console.log(`💰 Updated Customer ${customer.name} balance via general update: ${oldBalance} -> ${customer.outstandingAmount}`);
                    // SYNC INVOICE BALANCES FOR AGEING REPORT
                    let remainingReturnAmount = returnDoc.totalAmount || 0;
                    // 1. Try targeted invoice if order is linked
                    if (returnDoc.order) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const targetInvoice = yield Sale.findOne({ order: returnDoc.order });
                        if (targetInvoice && targetInvoice.balanceAmount > 0) {
                            const reduction = Math.min(targetInvoice.balanceAmount, remainingReturnAmount);
                            targetInvoice.balanceAmount -= reduction;
                            remainingReturnAmount -= reduction;
                            yield targetInvoice.save();
                            console.log(`📑 Reduced targeted invoice ${targetInvoice.invoiceNumber} balance by ${reduction}`);
                        }
                    }
                    // 2. FIFO reduction for remaining amount
                    if (remainingReturnAmount > 0) {
                        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                        const unpaidInvoices = yield Sale.find({
                            customer: returnDoc.customerId,
                            balanceAmount: { $gt: 0 }
                        }).sort({ saleDate: 1 });
                        for (const inv of unpaidInvoices) {
                            if (remainingReturnAmount <= 0)
                                break;
                            const reduction = Math.min(inv.balanceAmount, remainingReturnAmount);
                            inv.balanceAmount -= reduction;
                            remainingReturnAmount -= reduction;
                            yield inv.save();
                            console.log(`📑 Reduced invoice ${inv.invoiceNumber} balance by ${reduction} (FIFO)`);
                        }
                    }
                }
            }
            catch (err) {
                console.error('❌ Error updating customer balance in return status update:', err);
            }
        }
        returnDoc.status = status;
        returnDoc.updatedBy = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        yield returnDoc.save();
        res.json({
            success: true,
            message: 'Return status updated successfully',
            return: returnDoc
        });
    }
    catch (error) {
        console.error('Error updating return status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating return status',
            error: error.message
        });
    }
});
exports.updateReturnStatus = updateReturnStatus;
// Delete return
const deleteReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const returnDoc = yield Return_js_1.default.findById(req.params.id);
        if (!returnDoc) {
            return res.status(404).json({
                success: false,
                message: 'Return entry not found'
            });
        }
        yield Return_js_1.default.findByIdAndDelete(req.params.id);
        res.json({
            success: true,
            message: 'Return entry deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting return:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting return entry',
            error: error.message
        });
    }
});
exports.deleteReturn = deleteReturn;
// Get return statistics
const getReturnStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const total = yield Return_js_1.default.countDocuments();
        const pending = yield Return_js_1.default.countDocuments({ status: 'pending' });
        const approved = yield Return_js_1.default.countDocuments({ status: 'approved' });
        const completed = yield Return_js_1.default.countDocuments({ status: 'completed' });
        const rejected = yield Return_js_1.default.countDocuments({ status: 'rejected' });
        const refunds = yield Return_js_1.default.countDocuments({ type: 'refund' });
        const damages = yield Return_js_1.default.countDocuments({ type: 'damage' });
        // Calculate total amount
        const totalAmountResult = yield Return_js_1.default.aggregate([
            { $group: { _id: null, totalAmount: { $sum: '$totalAmount' } } }
        ]);
        const totalAmount = ((_a = totalAmountResult[0]) === null || _a === void 0 ? void 0 : _a.totalAmount) || 0;
        res.json({
            success: true,
            stats: {
                total,
                pending,
                approved,
                completed,
                rejected,
                refunds,
                damages,
                totalAmount
            }
        });
    }
    catch (error) {
        console.error('Error fetching return stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching return statistics',
            error: error.message
        });
    }
});
exports.getReturnStats = getReturnStats;
