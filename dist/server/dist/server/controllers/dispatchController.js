"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s)
        if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
            t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayOrderItems = exports.getProductsForDispatch = exports.getCustomersForDispatch = exports.getSalesPersonsForDispatch = exports.createDirectOrder = exports.generateInvoiceByDC = exports.generateInvoiceForDC = exports.createDeliveryChallan = exports.validateDCNumber = exports.getDispatchItemsHistory = exports.getTodaysProducts = exports.createDispatchOrder = exports.getNextDCNumber = exports.generateInvoice = exports.approveProduct = exports.updateQtyIssued = exports.getDeliveryChallanData = exports.createDispatchFromPacking = exports.checkExistingDispatch = exports.updateDispatchDelivery = exports.getDispatchHistory = exports.updateManualStock = exports.getDispatchDashboardEntryHistory = exports.getDispatchDashboardData = exports.getDispatchStats = exports.deleteDispatch = exports.updateDispatch = exports.createDispatch = exports.getDispatchById = exports.getDispatches = void 0;
const Dispatch_js_1 = __importDefault(require("../models/Dispatch.js"));
const Order_js_1 = __importDefault(require("../models/Order.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Packing_js_1 = __importDefault(require("../models/Packing.js"));
const schema_js_1 = require("../shared/schema.js");
const mongoose_1 = __importDefault(require("mongoose"));
const User_js_1 = __importDefault(require("../models/User.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Account_js_1 = require("../models/Account.js");
const invoicePdf_js_1 = require("../utils/invoicePdf.js");
/**
 * Reusable helper to ensure a formal Sale record exists for a given DC.
 * This links the Dispatch to the Accounts/Payments module.
 */
const ensureSaleRecordForDC = (dcNo, dispatches, user, companyId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        if (!dispatches || dispatches.length === 0)
            return null;
        const firstDispatch = dispatches[0];
        // 1. Check if Sale already exists for this DC to prevent duplicates
        const existingSale = yield Sale_js_1.default.findOne({ invoiceNumber: dcNo, companyId });
        if (existingSale)
            return existingSale;
        let subtotal = 0;
        let totalTax = 0;
        const saleItems = dispatches.map(d => {
            var _a, _b, _c;
            const qty = d.qtyIssued || d.indentQty || 0;
            const rate = ((_a = d.productId) === null || _a === void 0 ? void 0 : _a.salePrice) || d.rate || 0;
            const itemTotal = qty * rate;
            const gstPercent = ((_b = d.productId) === null || _b === void 0 ? void 0 : _b.gst) || 0;
            const itemTax = itemTotal * (gstPercent / 100);
            subtotal += itemTotal;
            totalTax += itemTax;
            return {
                productName: ((_c = d.productId) === null || _c === void 0 ? void 0 : _c.name) || d.productName || d.productGroup || 'Unknown',
                quantity: qty,
                unitPrice: rate,
                totalPrice: itemTotal,
                tax: gstPercent
            };
        });
        const totalAmount = subtotal + totalTax;
        const sale = new Sale_js_1.default({
            invoiceNumber: dcNo,
            customer: ((_a = firstDispatch.customer) === null || _a === void 0 ? void 0 : _a._id) || firstDispatch.customer,
            order: firstDispatch.orderId,
            dispatch: firstDispatch._id,
            items: saleItems,
            subtotal,
            taxAmount: totalTax,
            totalAmount,
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days
            unit: firstDispatch.unit || user.unit,
            companyId: companyId,
            createdBy: user.id || user._id,
            notes: firstDispatch.notes || `Auto-generated from Delivery Challan: ${dcNo}`
        });
        yield sale.save();
        // Update Customer Outstanding Amount
        yield Customer_js_1.default.findByIdAndUpdate(sale.customer, {
            $inc: { outstandingAmount: totalAmount }
        });
        // 4. Auto Journal Posting (Ledger)
        const unit = sale.unit;
        const receivableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Receivable', unit });
        const salesAccount = yield Account_js_1.Account.findOne({ accountName: 'Sales Account', unit });
        const gstAccount = yield Account_js_1.Account.findOne({ accountName: 'Output GST', unit });
        if (receivableAccount && salesAccount && gstAccount) {
            const entries = [
                { account: receivableAccount._id, debit: totalAmount, credit: 0 },
                { account: salesAccount._id, debit: 0, credit: subtotal },
                { account: gstAccount._id, debit: 0, credit: totalTax }
            ];
            const txn = new Account_js_1.Transaction({
                transactionNumber: `TXN-DCINV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Dispatch Invoice: ${sale.invoiceNumber} to ${((_b = firstDispatch.customer) === null || _b === void 0 ? void 0 : _b.name) || 'Customer'}`,
                reference: sale.invoiceNumber,
                totalAmount: totalAmount,
                unit,
                relatedDocument: 'Sale',
                relatedDocumentId: sale._id,
                createdBy: user.id || user._id,
                entries
            });
            yield txn.save();
            // Update account balances
            receivableAccount.balance += totalAmount;
            salesAccount.balance += subtotal;
            gstAccount.balance += totalTax;
            yield receivableAccount.save();
            yield salesAccount.save();
            yield gstAccount.save();
            console.log(`📊 Ledger posting completed for DC Invoice: ${dcNo}`);
        }
        console.log(`✅ Formal Sales Invoice created for ${dcNo}. Total Amount: ${totalAmount}`);
        return sale;
    }
    catch (error) {
        console.error('❌ Error in ensureSaleRecordForDC:', error);
        return null;
    }
});
const getDispatches = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 10, status, unit, search } = req.query;
        const skip = (page - 1) * limit;
        let query = {};
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER) {
            query.unit = req.user.unit;
        }
        else if (unit) {
            query.unit = unit;
        }
        if (status) {
            query.status = status;
        }
        if (search) {
            query.$or = [
                { productName: { $regex: search, $options: 'i' } },
                { productGroup: { $regex: search, $options: 'i' } },
                { batchNo: { $regex: search, $options: 'i' } }
            ];
        }
        const dispatches = yield Dispatch_js_1.default.find(query)
            .populate('packingSheetId', 'slNo productionGroupName status')
            .populate('productId', 'name code category unit')
            .populate('lastUpdatedBy', 'username fullName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        const total = yield Dispatch_js_1.default.countDocuments(query);
        res.json({
            dispatches,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    }
    catch (error) {
        console.error('Get dispatches error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.getDispatches = getDispatches;
const getDispatchById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        if (!mongoose_1.default.isValidObjectId(id)) {
            return res.status(400).json({ message: 'Invalid dispatch id' });
        }
        const dispatch = yield Dispatch_js_1.default.findById(id)
            .populate('packingSheetId', 'slNo productionGroupName status totalPackedQty')
            .populate('productId', 'name code category unit')
            .populate('lastUpdatedBy', 'username fullName')
            .populate('verifiedBy', 'username fullName');
        if (!dispatch) {
            return res.status(404).json({ message: 'Dispatch not found' });
        }
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER && dispatch.unit !== req.user.unit) {
            return res.status(403).json({ message: 'Access denied' });
        }
        res.json({ dispatch });
    }
    catch (error) {
        console.error('Get dispatch by ID error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.getDispatchById = getDispatchById;
const createDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { order, customer, items, expectedDeliveryDate, transporterName, vehicleNumber, driverName, driverContact, shippingAddress, notes } = req.body;
        if (!order || !customer || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Order, customer, and items are required' });
        }
        // Validate order and customer exist
        const [orderDoc, customerDoc] = yield Promise.all([
            Order_js_1.default.findById(order),
            Customer_js_1.default.findById(customer)
        ]);
        if (!orderDoc) {
            return res.status(400).json({ message: 'Order not found' });
        }
        if (!customerDoc) {
            return res.status(400).json({ message: 'Customer not found' });
        }
        const dispatchData = {
            order,
            customer,
            items,
            expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : new Date(),
            transporterName,
            vehicleNumber,
            driverName,
            driverContact,
            shippingAddress: shippingAddress || customerDoc.address,
            unit: req.user.role === schema_js_1.USER_ROLES.SUPER_USER ? req.body.unit : req.user.unit,
            notes
        };
        const dispatch = yield Dispatch_js_1.default.create(dispatchData);
        yield dispatch.populate([
            { path: 'packingSheetId', select: 'slNo productionGroupName status' },
            { path: 'productId', select: 'name code category unit' },
            { path: 'lastUpdatedBy', select: 'username fullName' }
        ]);
        res.status(201).json({
            message: 'Dispatch created successfully',
            dispatch
        });
    }
    catch (error) {
        console.error('Create dispatch error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.createDispatch = createDispatch;
const updateDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { status, actualDeliveryDate, transporterName, vehicleNumber, driverName, driverContact, trackingNumber, assignedTo, shippingAddress, notes } = req.body;
        const dispatch = yield Dispatch_js_1.default.findById(id);
        if (!dispatch) {
            return res.status(404).json({ message: 'Dispatch not found' });
        }
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER && dispatch.unit !== req.user.unit) {
            return res.status(403).json({ message: 'Access denied' });
        }
        const updateData = {};
        if (status) {
            updateData.status = status;
            if (status === 'Delivered') {
                updateData.actualDeliveryDate = actualDeliveryDate ? new Date(actualDeliveryDate) : new Date();
            }
        }
        if (transporterName)
            updateData.transporterName = transporterName;
        if (vehicleNumber)
            updateData.vehicleNumber = vehicleNumber;
        if (driverName)
            updateData.driverName = driverName;
        if (driverContact)
            updateData.driverContact = driverContact;
        if (trackingNumber)
            updateData.trackingNumber = trackingNumber;
        if (assignedTo)
            updateData.assignedTo = assignedTo;
        if (shippingAddress)
            updateData.shippingAddress = shippingAddress;
        if (notes)
            updateData.notes = notes;
        const updatedDispatch = yield Dispatch_js_1.default.findByIdAndUpdate(id, updateData, { new: true }).populate([
            { path: 'packingSheetId', select: 'slNo productionGroupName status' },
            { path: 'productId', select: 'name code category unit' },
            { path: 'lastUpdatedBy', select: 'username fullName' }
        ]);
        res.json({
            message: 'Dispatch updated successfully',
            dispatch: updatedDispatch
        });
    }
    catch (error) {
        console.error('Update dispatch error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.updateDispatch = updateDispatch;
const deleteDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const dispatch = yield Dispatch_js_1.default.findById(id);
        if (!dispatch) {
            return res.status(404).json({ message: 'Dispatch not found' });
        }
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER && dispatch.unit !== req.user.unit) {
            return res.status(403).json({ message: 'Access denied' });
        }
        if (['In Transit', 'Delivered'].includes(dispatch.status)) {
            return res.status(400).json({ message: 'Cannot delete dispatch that is in transit or delivered' });
        }
        yield Dispatch_js_1.default.findByIdAndDelete(id);
        res.json({ message: 'Dispatch deleted successfully' });
    }
    catch (error) {
        console.error('Delete dispatch error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.deleteDispatch = deleteDispatch;
const getDispatchStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { unit } = req.query;
        let query = {};
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER) {
            query.unit = req.user.unit;
        }
        else if (unit) {
            query.unit = unit;
        }
        const stats = yield Dispatch_js_1.default.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);
        const totalDispatches = yield Dispatch_js_1.default.countDocuments(query);
        const onTimeDeliveries = yield Dispatch_js_1.default.countDocuments(Object.assign(Object.assign({}, query), { status: 'Delivered', $expr: { $lte: ['$actualDeliveryDate', '$expectedDeliveryDate'] } }));
        res.json({
            stats,
            totalDispatches,
            onTimeDeliveryRate: totalDispatches > 0 ? (onTimeDeliveries / totalDispatches) * 100 : 0
        });
    }
    catch (error) {
        console.error('Get dispatch stats error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
exports.getDispatchStats = getDispatchStats;
// Get dispatch dashboard data for console view
const getDispatchDashboardData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Support optional date range filters from query params
        const today = new Date();
        const { startDate, endDate } = req.query;
        let startOfDay, endOfDay;
        if (startDate || endDate) {
            // If provided, use provided dates (normalize times)
            if (startDate) {
                const s = new Date(startDate);
                startOfDay = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0);
            }
            if (endDate) {
                const e = new Date(endDate);
                endOfDay = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999);
            }
            // If only one bound provided, default the other to the same day
            if (!startOfDay && endOfDay)
                startOfDay = new Date(endOfDay.getFullYear(), endOfDay.getMonth(), endOfDay.getDate(), 0, 0, 0, 0);
            if (!endOfDay && startOfDay)
                endOfDay = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), startOfDay.getDate(), 23, 59, 59, 999);
        }
        else {
            // Default to today's range when no explicit dates provided
            startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
            endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        }
        console.log('📊 Fetching dispatch console data for company:', req.user.companyId);
        // Build base query with date range
        let baseQuery = { date: { $gte: startOfDay, $lte: endOfDay } };
        // If user is not super user, limit to their company
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER) {
            baseQuery.company = req.user.companyId;
        }
        else {
            // For super users, allow optional location filter to select companies by location
            const { location } = req.query;
            if (location) {
                const Company = (yield Promise.resolve().then(() => __importStar(require('../models/Company.js')))).default;
                const matchingCompanies = yield Company.find({ location: { $regex: `^${location}$`, $options: 'i' } }).select('_id');
                const companyIds = matchingCompanies.map(c => c._id);
                if (companyIds.length > 0)
                    baseQuery.company = { $in: companyIds };
            }
            else {
                baseQuery.company = req.user.companyId;
            }
        }
        // Get dispatch console entries with full relations
        const dispatchConsoleData = yield Dispatch_js_1.default.find(baseQuery)
            .populate({
            path: 'packingSheetId',
            select: 'slNo productionGroupName batchNo totalPackedQty packingDate status items createdBy',
            populate: {
                path: 'createdBy',
                select: 'username fullName'
            }
        })
            .populate('productId', 'name code category batch unit') // Populate product details
            .populate('lastUpdatedBy', 'username fullName')
            .populate('company', 'name location')
            .sort({ createdAt: -1 });
        // Infer Previous Closing Stock as cumulative Physical Stock entries up to previous day (single-day view)
        // Example: 14th physical=20, 15th physical=30 => 16th previous closing shows 50
        const inferredPreviousClosingByProductId = new Map();
        const inferredPreviousClosingByProductGroup = new Map();
        // Infer "Return Quantity Yesterday Returns" from Return entries of previous day (single-day view)
        const inferredReturnsYesterdayByProductId = new Map();
        const isSingleDayView = startOfDay &&
            endOfDay &&
            startOfDay.getFullYear() === endOfDay.getFullYear() &&
            startOfDay.getMonth() === endOfDay.getMonth() &&
            startOfDay.getDate() === endOfDay.getDate();
        if (isSingleDayView) {
            const { date: _ignoredDate } = baseQuery, baseQueryWithoutDate = __rest(baseQuery, ["date"]);
            const priorQuery = Object.assign(Object.assign({}, baseQueryWithoutDate), { date: { $lt: startOfDay } });
            const byProductId = yield Dispatch_js_1.default.aggregate([
                { $match: Object.assign(Object.assign({}, priorQuery), { productId: { $ne: null } }) },
                {
                    $group: {
                        _id: '$productId',
                        totalPhysical: { $sum: { $ifNull: ['$physicalStockEntryManualVerification', 0] } }
                    }
                }
            ]);
            for (const row of byProductId) {
                inferredPreviousClosingByProductId.set(String(row._id), Number(row.totalPhysical) || 0);
            }
            const byProductGroup = yield Dispatch_js_1.default.aggregate([
                { $match: Object.assign(Object.assign({}, priorQuery), { productGroup: { $ne: null } }) },
                {
                    $group: {
                        _id: '$productGroup',
                        totalPhysical: { $sum: { $ifNull: ['$physicalStockEntryManualVerification', 0] } }
                    }
                }
            ]);
            for (const row of byProductGroup) {
                inferredPreviousClosingByProductGroup.set(String(row._id), Number(row.totalPhysical) || 0);
            }
            // Yesterday's returns (Return model) for this company (or selected companies for super user)
            const Return = (yield Promise.resolve().then(() => __importStar(require('../models/Return.js')))).default;
            const prevStart = new Date(startOfDay);
            prevStart.setDate(prevStart.getDate() - 1);
            prevStart.setHours(0, 0, 0, 0);
            const prevEnd = new Date(startOfDay);
            prevEnd.setDate(prevEnd.getDate() - 1);
            prevEnd.setHours(23, 59, 59, 999);
            let companyIdMatch = baseQuery.company;
            if (companyIdMatch && typeof companyIdMatch === 'object' && Array.isArray(companyIdMatch.$in)) {
                companyIdMatch = { $in: companyIdMatch.$in };
            }
            const returnsAgg = yield Return.aggregate([
                {
                    $match: {
                        companyId: companyIdMatch,
                        returnDate: { $gte: prevStart, $lte: prevEnd },
                        status: { $in: ['approved', 'completed'] }
                    }
                },
                { $unwind: '$items' },
                {
                    $group: {
                        _id: '$items.productId',
                        totalQty: { $sum: { $ifNull: ['$items.quantity', 0] } }
                    }
                }
            ]);
            for (const row of returnsAgg) {
                inferredReturnsYesterdayByProductId.set(String(row._id), Number(row.totalQty) || 0);
            }
        }
        // Get approved packing sheets that don't have dispatch entries yet
        const PackingSheet = (yield Promise.resolve().then(() => __importStar(require('../models/Packing.js')))).default;
        // For packing sheets, apply same company filter as dispatch query
        const packingQuery = {
            status: 'approved',
            approvedAt: { $gte: startOfDay, $lte: endOfDay },
            _id: { $nin: dispatchConsoleData.map(d => { var _a; return (_a = d.packingSheetId) === null || _a === void 0 ? void 0 : _a._id; }).filter(Boolean) }
        };
        if (baseQuery.company)
            packingQuery.company = baseQuery.company;
        const approvedPackingSheetsWithoutDispatch = yield PackingSheet.find(packingQuery)
            .populate('createdBy', 'username fullName')
            .populate('approvedBy', 'username fullName')
            .select('slNo productionGroupName batchNo totalPackedQty approvedAt createdBy approvedBy');
        console.log('📊 Dashboard data summary:', {
            dispatchEntries: dispatchConsoleData.length,
            orphanedPackingSheets: approvedPackingSheetsWithoutDispatch.length
        });
        // Format response data
        const formattedData = dispatchConsoleData.map(entry => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            // Calculate values on-the-fly (in case database has old 0 values)
            const packedQty = entry.packedQuantityReadyForDispatch || 0;
            const productIdStr = ((_a = entry.productId) === null || _a === void 0 ? void 0 : _a._id)
                ? String(entry.productId._id)
                : (entry.productId ? String(entry.productId) : null);
            const productGroupStr = entry.productGroup ? String(entry.productGroup) : '';
            const isUngrouped = productGroupStr.toLowerCase().startsWith('ungrouped items');
            // NOTE: physical stock is updated by productGroup in UI, so for Ungrouped rows
            // use productGroup-based cumulative previous closing.
            const inferredPreviousClosing = isUngrouped && productGroupStr && inferredPreviousClosingByProductGroup.has(productGroupStr)
                ? inferredPreviousClosingByProductGroup.get(productGroupStr)
                : (productIdStr && inferredPreviousClosingByProductId.has(productIdStr)
                    ? inferredPreviousClosingByProductId.get(productIdStr)
                    : (productGroupStr && inferredPreviousClosingByProductGroup.has(productGroupStr)
                        ? inferredPreviousClosingByProductGroup.get(productGroupStr)
                        : 0));
            const storedPreviousClosingRaw = Number(entry.previousClosingStockYesterdayBalance);
            const previousClosing = isSingleDayView
                ? inferredPreviousClosing
                : (Number.isFinite(storedPreviousClosingRaw) ? storedPreviousClosingRaw : 0);
            const inferredReturnsYesterday = productIdStr && inferredReturnsYesterdayByProductId.has(productIdStr)
                ? inferredReturnsYesterdayByProductId.get(productIdStr)
                : 0;
            const storedReturnsRaw = Number(entry.returnQuantityYesterdayReturns);
            const returns = isSingleDayView
                ? inferredReturnsYesterday
                : (Number.isFinite(storedReturnsRaw) ? storedReturnsRaw : 0);
            const totalIndent = entry.totalIndentQuantityOrdersForTheDay || 0;
            const dispatched = entry.dispatchedQuantitySentToday || 0;
            const physicalStock = entry.physicalStockEntryManualVerification || 0;
            // Calculate totalAvailableStock = Packed + Previous Closing + Returns
            const calculatedTotalAvailable = packedQty + previousClosing + returns;
            // Calculate excessShortage = Total Indent - Total Available (positive = shortage, negative = excess)
            const calculatedExcessShortage = totalIndent - calculatedTotalAvailable;
            // Calculate overallLoss = Total Available - Dispatched - Physical Stock
            const calculatedOverallLoss = calculatedTotalAvailable - dispatched - physicalStock;
            console.log(`🧮 Calculating for ${entry.productGroup}:`, {
                packed: packedQty,
                previousClosing: previousClosing,
                returns: returns,
                calculated_total: calculatedTotalAvailable,
                stored_total: entry.totalAvailableStock,
                totalIndent: totalIndent,
                excessShortage: calculatedExcessShortage
            });
            return {
                id: entry._id,
                packingSheetId: (_b = entry.packingSheetId) === null || _b === void 0 ? void 0 : _b._id,
                packingSheetSlNo: (_c = entry.packingSheetId) === null || _c === void 0 ? void 0 : _c.slNo,
                packingSheetBatchNo: (_d = entry.packingSheetId) === null || _d === void 0 ? void 0 : _d.batchNo,
                packingDate: (_e = entry.packingSheetId) === null || _e === void 0 ? void 0 : _e.packingDate,
                productGroup: entry.productGroup,
                productId: (_f = entry.productId) === null || _f === void 0 ? void 0 : _f._id,
                productName: entry.productName || ((_g = entry.productId) === null || _g === void 0 ? void 0 : _g.name) || entry.productGroup, // Show product name if available
                productCode: (_h = entry.productId) === null || _h === void 0 ? void 0 : _h.code,
                productCategory: (_j = entry.productId) === null || _j === void 0 ? void 0 : _j.category,
                // Main dispatch console columns - use calculated values
                packedQuantityReadyForDispatch: packedQty,
                previousClosingStockYesterdayBalance: previousClosing,
                returnQuantityYesterdayReturns: returns,
                totalAvailableStock: calculatedTotalAvailable, // ✅ Now calculated!
                totalIndentQuantityOrdersForTheDay: totalIndent,
                excessShortage: calculatedExcessShortage, // ✅ Now calculated!
                dispatchedQuantitySentToday: dispatched,
                closingStockEndOfDayBalance: entry.closingStockEndOfDayBalance || 0,
                physicalStockEntryManualVerification: physicalStock,
                overallLoss: calculatedOverallLoss, // ✅ Now calculated!
                // Additional tracking info
                batchNo: entry.batchNo,
                status: entry.status,
                date: entry.date,
                lastUpdatedBy: entry.lastUpdatedBy,
                company: entry.company,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
                // Packing sheet creator info
                packingSheetCreator: (_k = entry.packingSheetId) === null || _k === void 0 ? void 0 : _k.createdBy
            };
        });
        // Get summary statistics using calculated values from formattedData
        const totalPacked = formattedData.reduce((sum, entry) => sum + (entry.packedQuantityReadyForDispatch || 0), 0);
        const totalIndent = formattedData.reduce((sum, entry) => sum + (entry.totalIndentQuantityOrdersForTheDay || 0), 0);
        const totalAvailable = formattedData.reduce((sum, entry) => sum + (entry.totalAvailableStock || 0), 0);
        const totalDispatched = formattedData.reduce((sum, entry) => sum + (entry.dispatchedQuantitySentToday || 0), 0);
        const totalExcessShortage = formattedData.reduce((sum, entry) => sum + (entry.excessShortage || 0), 0);
        console.log('📊 Dashboard summary calculations completed:', {
            totalPacked,
            totalIndent,
            totalAvailable,
            totalDispatched,
            totalExcessShortage,
            entriesCount: formattedData.length
        });
        res.json({
            success: true,
            data: {
                dispatchConsoleEntries: formattedData,
                orphanedPackingSheets: approvedPackingSheetsWithoutDispatch,
                summary: {
                    totalEntries: dispatchConsoleData.length,
                    totalPackedQuantity: totalPacked,
                    totalIndentQuantity: totalIndent,
                    totalAvailableStock: totalAvailable,
                    totalDispatchedQuantity: totalDispatched,
                    totalExcessShortage: totalExcessShortage,
                    averageExcessShortage: dispatchConsoleData.length > 0 ? totalExcessShortage / dispatchConsoleData.length : 0,
                    orphanedSheets: approvedPackingSheetsWithoutDispatch.length
                },
                meta: {
                    startDate: startOfDay ? startOfDay.toISOString().split('T')[0] : null,
                    endDate: endOfDay ? endOfDay.toISOString().split('T')[0] : null,
                    companyId: req.user.companyId,
                    generatedAt: new Date().toISOString()
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching dispatch dashboard data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispatch dashboard data',
            error: error.message
        });
    }
});
exports.getDispatchDashboardData = getDispatchDashboardData;
// Get dispatch dashboard entry history (for row expand)
const getDispatchDashboardEntryHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { productId, productGroup, days = 30 } = req.query;
        const daysIntRaw = parseInt(String(days), 10);
        const daysInt = Number.isFinite(daysIntRaw) ? Math.min(Math.max(daysIntRaw, 1), 31) : 30;
        if (!productId && !productGroup) {
            return res.status(400).json({
                success: false,
                message: 'productId or productGroup is required'
            });
        }
        if (productId && !mongoose_1.default.isValidObjectId(String(productId))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid productId'
            });
        }
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - (daysInt - 1));
        // Company filter (same behavior as dashboard)
        let companyFilter;
        if (req.user.role !== schema_js_1.USER_ROLES.SUPER_USER) {
            companyFilter = req.user.companyId;
        }
        else {
            companyFilter = req.user.companyId;
        }
        const dispatchQuery = {
            company: companyFilter,
            date: { $gte: startDate, $lte: endDate }
        };
        const productGroupStr = productGroup ? String(productGroup) : '';
        const isUngrouped = productGroupStr.toLowerCase().startsWith('ungrouped items');
        // NOTE: physical/dispatched updates are saved by productGroup in UI, so for Ungrouped rows
        // prefer matching by productGroup even if a productId exists.
        if (isUngrouped && productGroupStr) {
            dispatchQuery.productGroup = productGroupStr;
        }
        else if (productId) {
            dispatchQuery.productId = new mongoose_1.default.Types.ObjectId(String(productId));
        }
        else {
            dispatchQuery.productGroup = productGroupStr;
        }
        const docs = yield Dispatch_js_1.default.find(dispatchQuery)
            .select([
            'date',
            'productId',
            'productGroup',
            'packedQuantityReadyForDispatch',
            'totalIndentQuantityOrdersForTheDay',
            'dispatchedQuantitySentToday',
            'physicalStockEntryManualVerification'
        ].join(' '))
            .sort({ date: 1, createdAt: 1 })
            .lean();
        const perDay = new Map();
        for (const d of docs) {
            const dateObj = d.date ? new Date(d.date) : null;
            if (!dateObj || Number.isNaN(dateObj.getTime()))
                continue;
            const dateKey = dateObj.toISOString().split('T')[0];
            if (!perDay.has(dateKey)) {
                perDay.set(dateKey, {
                    date: dateKey,
                    packedQuantityReadyForDispatch: 0,
                    totalIndentQuantityOrdersForTheDay: 0,
                    dispatchedQuantitySentToday: 0,
                    physicalStockEntryManualVerification: 0
                });
            }
            const row = perDay.get(dateKey);
            row.packedQuantityReadyForDispatch += Number(d.packedQuantityReadyForDispatch) || 0;
            row.totalIndentQuantityOrdersForTheDay += Number(d.totalIndentQuantityOrdersForTheDay) || 0;
            row.dispatchedQuantitySentToday += Number(d.dispatchedQuantitySentToday) || 0;
            row.physicalStockEntryManualVerification += Number(d.physicalStockEntryManualVerification) || 0;
        }
        // Returns aggregation (only reliable when productId is known)
        const returnsOnDay = new Map();
        if (productId) {
            const Return = (yield Promise.resolve().then(() => __importStar(require('../models/Return.js')))).default;
            const prevStart = new Date(startDate);
            prevStart.setDate(prevStart.getDate() - 1);
            prevStart.setHours(0, 0, 0, 0);
            const prevEnd = new Date(endDate);
            prevEnd.setDate(prevEnd.getDate() - 1);
            prevEnd.setHours(23, 59, 59, 999);
            const returnsAgg = yield Return.aggregate([
                {
                    $match: {
                        companyId: companyFilter,
                        returnDate: { $gte: prevStart, $lte: prevEnd },
                        status: { $in: ['approved', 'completed'] }
                    }
                },
                { $unwind: '$items' },
                { $match: { 'items.productId': new mongoose_1.default.Types.ObjectId(String(productId)) } },
                {
                    $group: {
                        _id: {
                            date: {
                                $dateToString: {
                                    format: '%Y-%m-%d',
                                    date: '$returnDate'
                                }
                            }
                        },
                        totalQty: { $sum: { $ifNull: ['$items.quantity', 0] } }
                    }
                }
            ]);
            for (const r of returnsAgg) {
                const dateKey = (_a = r === null || r === void 0 ? void 0 : r._id) === null || _a === void 0 ? void 0 : _a.date;
                if (!dateKey)
                    continue;
                returnsOnDay.set(String(dateKey), Number(r.totalQty) || 0);
            }
        }
        // Build history with cumulative previous closing and "yesterday returns"
        const dayKeysAsc = Array.from(perDay.keys()).sort();
        let cumulativePhysical = 0;
        const history = dayKeysAsc.map((dateKey) => {
            const row = perDay.get(dateKey);
            const prevClosing = cumulativePhysical;
            const prevDate = new Date(dateKey);
            prevDate.setDate(prevDate.getDate() - 1);
            const prevDateKey = prevDate.toISOString().split('T')[0];
            const returnsYesterday = returnsOnDay.get(prevDateKey) || 0;
            const totalAvailable = (row.packedQuantityReadyForDispatch || 0) + prevClosing + returnsYesterday;
            const excessShortage = (row.totalIndentQuantityOrdersForTheDay || 0) - totalAvailable;
            const closingStock = totalAvailable - (row.dispatchedQuantitySentToday || 0);
            const overallLoss = totalAvailable - (row.dispatchedQuantitySentToday || 0) - (row.physicalStockEntryManualVerification || 0);
            cumulativePhysical += (row.physicalStockEntryManualVerification || 0);
            return {
                date: dateKey,
                packedQuantityReadyForDispatch: row.packedQuantityReadyForDispatch || 0,
                previousClosingStockYesterdayBalance: prevClosing,
                returnQuantityYesterdayReturns: returnsYesterday,
                totalAvailableStock: totalAvailable,
                totalIndentQuantityOrdersForTheDay: row.totalIndentQuantityOrdersForTheDay || 0,
                excessShortage,
                dispatchedQuantitySentToday: row.dispatchedQuantitySentToday || 0,
                physicalStockEntryManualVerification: row.physicalStockEntryManualVerification || 0,
                closingStockEndOfDayBalance: closingStock,
                overallLoss
            };
        }).reverse();
        return res.json({
            success: true,
            data: {
                days: daysInt,
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
                productId: productId || null,
                productGroup: productGroup || null,
                history
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching dispatch dashboard entry history:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch dispatch dashboard entry history',
            error: error.message
        });
    }
});
exports.getDispatchDashboardEntryHistory = getDispatchDashboardEntryHistory;
// Update manual stock entry for dispatch - ONLY updates physical stock field
const updateManualStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { packingSheetId, productId, productGroup, physicalStockEntryManualVerification, dispatchedQuantitySentToday } = req.body;
        console.log('📝 Updating stock entry:', {
            packingSheetId,
            productId,
            productGroup,
            physicalStockEntryManualVerification,
            dispatchedQuantitySentToday
        });
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        // Build the query to find the specific dispatch entry
        let query = {
            date: { $gte: startOfDay, $lte: endOfDay },
            company: req.user.companyId
        };
        // Add optional filters
        if (packingSheetId) {
            query.packingSheetId = packingSheetId;
        }
        if (productId) {
            query.productId = productId;
        }
        if (productGroup) {
            query.productGroup = productGroup;
        }
        console.log('🔍 Finding dispatch entry:', JSON.stringify(query, null, 2));
        // Find the existing dispatch record
        const existingDispatch = yield Dispatch_js_1.default.findOne(query);
        if (!existingDispatch) {
            return res.status(404).json({
                success: false,
                message: 'Dispatch entry not found for today'
            });
        }
        // Update fields based on what was provided
        if (physicalStockEntryManualVerification !== undefined && physicalStockEntryManualVerification !== null) {
            existingDispatch.physicalStockEntryManualVerification = physicalStockEntryManualVerification;
            // Recalculate overallLoss = Closing Stock - Physical Stock
            existingDispatch.overallLoss = existingDispatch.closingStockEndOfDayBalance - physicalStockEntryManualVerification;
        }
        if (dispatchedQuantitySentToday !== undefined && dispatchedQuantitySentToday !== null) {
            existingDispatch.dispatchedQuantitySentToday = dispatchedQuantitySentToday;
            existingDispatch.qtyIssued = dispatchedQuantitySentToday;
            // Recalculate closing stock
            const totalAvailableStock = (existingDispatch.packedQuantityReadyForDispatch || 0) +
                (existingDispatch.previousClosingStockYesterdayBalance || 0) +
                (existingDispatch.returnQuantityYesterdayReturns || 0);
            existingDispatch.closingStockEndOfDayBalance = totalAvailableStock - dispatchedQuantitySentToday;
        }
        existingDispatch.lastUpdatedBy = req.user._id;
        existingDispatch.updatedAt = new Date();
        // Save the updated dispatch entry
        yield existingDispatch.save();
        console.log('✅ Stock updated successfully:', {
            dispatchId: existingDispatch._id,
            dispatchedQuantitySentToday: existingDispatch.dispatchedQuantitySentToday,
            physicalStock: existingDispatch.physicalStockEntryManualVerification,
            closingStock: existingDispatch.closingStockEndOfDayBalance
        });
        res.json({
            success: true,
            message: 'Physical stock updated successfully',
            data: {
                id: existingDispatch._id,
                dispatchedQuantitySentToday: existingDispatch.dispatchedQuantitySentToday,
                qtyIssued: existingDispatch.qtyIssued,
                physicalStockEntryManualVerification: existingDispatch.physicalStockEntryManualVerification,
                closingStockEndOfDayBalance: existingDispatch.closingStockEndOfDayBalance,
                overallLoss: existingDispatch.overallLoss,
                updatedAt: existingDispatch.updatedAt
            }
        });
    }
    catch (error) {
        console.error('Error updating stock:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update stock',
            error: error.message
        });
    }
});
exports.updateManualStock = updateManualStock;
// Get dispatch history with pagination and filters
const getDispatchHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 20, startDate, endDate, status, vehicleId, customerId } = req.query;
        const userCompanyId = req.user.companyId;
        console.log('📊 Fetching dispatch history with params:', { page, limit, startDate, endDate, status, vehicleId, customerId, userCompanyId });
        // Build filter object - using correct field names for Dispatch model
        const filter = {
            company: userCompanyId // Assuming Dispatch uses 'company' field
        };
        // Add date range filter
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) {
                filter.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                const endDateObj = new Date(endDate);
                endDateObj.setHours(23, 59, 59, 999);
                filter.createdAt.$lte = endDateObj;
            }
        }
        // Add status filter
        if (status && status !== 'all') {
            filter.status = status;
        }
        // Add vehicle filter (if applicable - using productGroup as vehicle equivalent)
        if (vehicleId && vehicleId !== 'all') {
            filter.productGroup = { $regex: vehicleId, $options: 'i' };
        }
        // Add product filter (using productName)
        if (customerId && customerId !== 'all') {
            filter.productName = { $regex: customerId, $options: 'i' };
        }
        console.log('🔍 Query filter:', JSON.stringify(filter, null, 2));
        const skip = (parseInt(page) - 1) * parseInt(limit);
        // Get paginated dispatch history with populated details
        const dispatchHistory = yield Dispatch_js_1.default.find(filter)
            .populate({
            path: 'packingSheetId',
            select: 'slNo productionGroupName status totalPackedQty items'
        })
            .populate({
            path: 'productId',
            select: 'name code category unit'
        })
            .populate({
            path: 'company',
            select: 'companyName'
        })
            .populate({
            path: 'customer',
            select: 'name phone email address city'
        })
            .populate({
            path: 'salesPerson',
            select: 'username fullName'
        })
            .populate({
            path: 'lastUpdatedBy',
            select: 'username fullName'
        })
            .populate({
            path: 'verifiedBy',
            select: 'username fullName'
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();
        console.log(`📋 Found ${dispatchHistory.length} dispatch records`);
        // Get total count for pagination
        const totalCount = yield Dispatch_js_1.default.countDocuments(filter);
        const totalPages = Math.ceil(totalCount / parseInt(limit));
        // Calculate summary statistics
        const summaryStats = yield Dispatch_js_1.default.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalDispatches: { $sum: 1 },
                    verifiedDispatches: {
                        $sum: { $cond: [{ $eq: ['$status', 'verified'] }, 1, 0] }
                    },
                    dispatchedDispatches: {
                        $sum: { $cond: [{ $eq: ['$status', 'dispatched'] }, 1, 0] }
                    },
                    completedDispatches: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    pendingDispatches: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                    },
                    totalPackedQty: { $sum: '$packedQuantityReadyForDispatch' },
                    totalDispatchedQty: { $sum: '$dispatchedQuantitySentToday' }
                }
            }
        ]);
        const stats = summaryStats[0] || {
            totalDispatches: 0,
            verifiedDispatches: 0,
            dispatchedDispatches: 0,
            completedDispatches: 0,
            pendingDispatches: 0,
            totalPackedQty: 0,
            totalDispatchedQty: 0
        };
        console.log('📊 Summary stats:', stats);
        // Format the dispatch history data to match frontend expectations
        const formattedData = dispatchHistory.map(dispatch => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
            return ({
                id: dispatch._id,
                dispatchId: dispatch._id,
                customer: dispatch.customer ? {
                    id: dispatch.customer._id,
                    name: dispatch.customer.name || 'Unknown',
                    phone: dispatch.customer.phone || '',
                    email: dispatch.customer.email || '',
                    address: dispatch.customer.address || '',
                    city: dispatch.customer.city || ''
                } : null,
                salesPerson: dispatch.salesPerson ? {
                    id: dispatch.salesPerson._id,
                    username: dispatch.salesPerson.username || '',
                    fullName: dispatch.salesPerson.fullName || ''
                } : null,
                packingSheet: {
                    id: (_a = dispatch.packingSheetId) === null || _a === void 0 ? void 0 : _a._id,
                    slNo: ((_b = dispatch.packingSheetId) === null || _b === void 0 ? void 0 : _b.slNo) || 'N/A',
                    productGroup: ((_c = dispatch.packingSheetId) === null || _c === void 0 ? void 0 : _c.productionGroupName) || dispatch.productGroup || 'N/A',
                    status: ((_d = dispatch.packingSheetId) === null || _d === void 0 ? void 0 : _d.status) || 'N/A'
                },
                product: {
                    id: (_e = dispatch.productId) === null || _e === void 0 ? void 0 : _e._id,
                    name: dispatch.productName || ((_f = dispatch.productId) === null || _f === void 0 ? void 0 : _f.name) || 'N/A',
                    code: ((_g = dispatch.productId) === null || _g === void 0 ? void 0 : _g.code) || '',
                    category: ((_h = dispatch.productId) === null || _h === void 0 ? void 0 : _h.category) || '',
                    unit: ((_j = dispatch.productId) === null || _j === void 0 ? void 0 : _j.unit) || ''
                },
                quantities: {
                    packedQty: dispatch.packedQuantityReadyForDispatch || 0,
                    previousClosing: dispatch.previousClosingStockYesterdayBalance || 0,
                    returns: dispatch.returnQuantityYesterdayReturns || 0,
                    totalAvailable: dispatch.totalAvailableStock || 0,
                    totalIndent: dispatch.totalIndentQuantityOrdersForTheDay || 0,
                    dispatched: dispatch.dispatchedQuantitySentToday || 0,
                    closingStock: dispatch.closingStockEndOfDayBalance || 0,
                    physicalStock: dispatch.physicalStockEntryManualVerification || 0
                },
                calculations: {
                    excessShortage: dispatch.excessShortage || 0,
                    overallLoss: dispatch.overallLoss || 0
                },
                status: dispatch.status || 'pending',
                date: dispatch.date,
                deliveryDate: dispatch.approvedAt || null,
                dcno: dispatch.dcno || '',
                batchNo: dispatch.batchNo || '',
                remarks: dispatch.remarks || '',
                vehicleNumber: dispatch.vehicleNumber || '',
                transporterName: dispatch.transporterName || '',
                verifiedBy: ((_k = dispatch.verifiedBy) === null || _k === void 0 ? void 0 : _k.username) || ((_l = dispatch.verifiedBy) === null || _l === void 0 ? void 0 : _l.fullName) || null,
                verifiedAt: dispatch.verifiedAt,
                lastUpdatedBy: ((_m = dispatch.lastUpdatedBy) === null || _m === void 0 ? void 0 : _m.username) || ((_o = dispatch.lastUpdatedBy) === null || _o === void 0 ? void 0 : _o.fullName) || 'Unknown',
                createdAt: dispatch.createdAt,
                updatedAt: dispatch.updatedAt
            });
        });
        console.log(`✅ Formatted ${formattedData.length} dispatch history records`);
        res.json({
            success: true,
            message: 'Dispatch history retrieved successfully',
            data: {
                reports: formattedData,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalCount,
                    limit: parseInt(limit),
                    hasNext: parseInt(page) < totalPages,
                    hasPrev: parseInt(page) > 1
                },
                summary: stats,
                filters: {
                    startDate,
                    endDate,
                    status,
                    vehicleId,
                    customerId,
                    companyId: filter.company
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching dispatch history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispatch history',
            error: error.message
        });
    }
});
exports.getDispatchHistory = getDispatchHistory;
// Update dispatch delivery date and qty issued
const updateDispatchDelivery = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { dispatchId } = req.params;
        const { deliveryDate, qtyIssued } = req.body;
        const userCompanyId = req.user.companyId;
        console.log('📝 Updating dispatch delivery:', { dispatchId, deliveryDate, qtyIssued, userCompanyId });
        // Validate dispatch ID
        if (!dispatchId || !mongoose_1.default.Types.ObjectId.isValid(dispatchId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid dispatch ID is required'
            });
        }
        // Find dispatch and verify company access
        const dispatch = yield Dispatch_js_1.default.findOne({
            _id: dispatchId,
            company: userCompanyId
        });
        if (!dispatch) {
            return res.status(404).json({
                success: false,
                message: 'Dispatch not found or access denied'
            });
        }
        // Build update object
        const updateData = {
            lastUpdatedBy: req.user.id,
            updatedAt: new Date()
        };
        if (deliveryDate) {
            updateData.deliveryDate = new Date(deliveryDate);
            updateData.approvedAt = new Date(deliveryDate); // Set approvedAt as delivery date
        }
        if (qtyIssued !== undefined && qtyIssued !== null) {
            updateData.qtyIssued = parseFloat(qtyIssued);
        }
        // Update dispatch
        const updatedDispatch = yield Dispatch_js_1.default.findByIdAndUpdate(dispatchId, { $set: updateData }, { new: true, runValidators: true })
            .populate('customer', 'name phone email')
            .populate('salesPerson', 'username fullName')
            .populate('productId', 'name code category unit')
            .lean();
        console.log('✅ Dispatch updated successfully:', updatedDispatch._id);
        res.json({
            success: true,
            message: 'Dispatch updated successfully',
            data: updatedDispatch
        });
    }
    catch (error) {
        console.error('❌ Error updating dispatch delivery:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update dispatch',
            error: error.message
        });
    }
});
exports.updateDispatchDelivery = updateDispatchDelivery;
// Check if dispatch entry already exists for a packing sheet
const checkExistingDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { packingSheetId } = req.body;
        if (!packingSheetId) {
            return res.status(400).json({ message: 'Packing sheet ID is required' });
        }
        // Check by packing sheet ID in notes field
        const existingDispatch = yield Dispatch_js_1.default.findOne({
            notes: { $regex: packingSheetId, $options: 'i' }
        }).select('_id dispatchNumber status createdAt');
        return res.status(200).json({
            success: true,
            exists: !!existingDispatch,
            dispatch: existingDispatch
        });
    }
    catch (error) {
        console.error('Error checking existing dispatch:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to check existing dispatch',
            error: error.message
        });
    }
});
exports.checkExistingDispatch = checkExistingDispatch;
// Create dispatch entry from approved packing sheet
const createDispatchFromPacking = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { packingSheetId } = req.body;
        if (!packingSheetId) {
            return res.status(400).json({ message: 'Packing sheet ID is required' });
        }
        // Get the approved packing sheet with full details
        const PackingSheet = (yield Promise.resolve().then(() => __importStar(require('../models/Packing.js')))).default;
        const packingSheet = yield PackingSheet.findById(packingSheetId)
            .populate({
            path: 'productionGroup',
            select: 'name description items',
            populate: {
                path: 'items',
                select: 'name code category unit'
            }
        })
            .populate('company', 'name')
            .lean();
        if (!packingSheet) {
            return res.status(404).json({ message: 'Packing sheet not found' });
        }
        if (packingSheet.status !== 'approved') {
            return res.status(400).json({ message: 'Packing sheet must be approved first' });
        }
        // Check if dispatch already exists for this packing sheet
        const existingDispatch = yield Dispatch_js_1.default.findOne({
            notes: { $regex: packingSheetId, $options: 'i' }
        });
        if (existingDispatch) {
            return res.status(400).json({
                message: 'Dispatch already exists for this packing sheet',
                existingDispatch: existingDispatch.dispatchNumber
            });
        }
        // Prepare dispatch items from packed quantities (only items with packedQty > 0)
        const dispatchItems = packingSheet.items
            .filter(item => item.packedQty > 0)
            .map(item => ({
            productName: item.productName,
            quantity: item.packedQty, // Use actual packed quantity
            batchNumber: `BATCH-${packingSheet.productionGroupName}-${Date.now()}`
        }));
        if (dispatchItems.length === 0) {
            return res.status(400).json({ message: 'No items with packed quantities to dispatch' });
        }
        // Create dispatch entry with proper structure matching dashboard
        const dispatchData = {
            // Auto-generate dispatch number
            dispatchNumber: `DISP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
            // Company info
            company: packingSheet.company._id,
            unit: ((_a = req.user) === null || _a === void 0 ? void 0 : _a.unit) || 'default',
            // Items to dispatch
            items: dispatchItems,
            // Dates
            dispatchDate: new Date(),
            expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            // Status
            status: 'PENDING',
            // Tracking info
            assignedTo: (_b = req.user) === null || _b === void 0 ? void 0 : _b._id,
            // Reference to source packing sheet
            notes: `Auto-created from approved packing sheet: ${packingSheet.productionGroupName} (ID: ${packingSheetId})`,
            // Additional metadata for tracking
            sourcePackingSheetId: packingSheetId,
            sourceProductionGroup: packingSheet.productionGroupName
        };
        // Create the dispatch record
        const newDispatch = new Dispatch_js_1.default(dispatchData);
        const savedDispatch = yield newDispatch.save();
        console.log('✅ Successfully created dispatch from packing sheet:', {
            dispatchNumber: savedDispatch.dispatchNumber,
            packingSheetId: packingSheetId,
            itemsCount: dispatchItems.length,
            totalQuantity: dispatchItems.reduce((sum, item) => sum + item.quantity, 0)
        });
        return res.status(201).json({
            success: true,
            message: 'Dispatch entry created successfully from approved packing sheet',
            data: {
                dispatch: savedDispatch,
                packingSheet: {
                    id: packingSheet._id,
                    productionGroup: packingSheet.productionGroupName,
                    totalPackedQty: packingSheet.totalPackedQty,
                    packingLoss: packingSheet.packingLoss
                }
            }
        });
    }
    catch (error) {
        console.error('Error creating dispatch from packing sheet:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create dispatch from packing sheet',
            error: error.message
        });
    }
});
exports.createDispatchFromPacking = createDispatchFromPacking;
// Get delivery challan data - simplified API for Product/Product Group and Indent Qty only
const getDeliveryChallanData = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        console.log('📋 Fetching delivery challan data for company:', req.user.companyId);
        // Get dispatch console entries for today with minimal data needed for delivery challan
        const deliveryChallanData = yield Dispatch_js_1.default.find({
            company: req.user.companyId,
            date: { $gte: startOfDay, $lte: endOfDay }
        })
            .populate({
            path: 'packingSheetId',
            select: 'productionGroupName batchNo'
        })
            .populate('company', 'name')
            .select('productGroup productName totalIndentQuantityOrdersForTheDay batchNo packingSheetId dcno qtyIssued status indentQty')
            .sort({ productGroup: 1, productName: 1 });
        console.log('📋 Found delivery challan entries:', deliveryChallanData.length);
        // Format data to include DCno, Product/Product Group, Indent Qty and Qty Issued
        const formattedData = deliveryChallanData.map(entry => {
            var _a;
            return ({
                id: entry._id,
                dcno: entry.dcno || 'N/A',
                productGroup: entry.productGroup,
                productName: entry.productName || entry.productGroup, // Fallback to productGroup if productName not available
                indentQty: entry.indentQty || entry.totalIndentQuantityOrdersForTheDay || 0,
                qtyIssued: entry.qtyIssued || 0,
                status: entry.status || 'pending',
                batchNo: entry.batchNo || ((_a = entry.packingSheetId) === null || _a === void 0 ? void 0 : _a.batchNo) || 'N/A'
            });
        });
        // Group by product group for better organization
        const groupedData = formattedData.reduce((acc, item) => {
            const group = item.productGroup;
            if (!acc[group]) {
                acc[group] = [];
            }
            acc[group].push(item);
            return acc;
        }, {});
        // Calculate totals
        const totalIndentQty = formattedData.reduce((sum, item) => sum + item.indentQty, 0);
        const totalProducts = formattedData.length;
        const totalGroups = Object.keys(groupedData).length;
        console.log('📋 Delivery challan summary:', {
            totalProducts,
            totalGroups,
            totalIndentQty
        });
        res.json({
            success: true,
            data: {
                products: formattedData,
                groupedProducts: groupedData,
                summary: {
                    totalProducts,
                    totalGroups,
                    totalIndentQty
                },
                meta: {
                    date: today.toISOString().split('T')[0],
                    companyId: req.user.companyId,
                    generatedAt: new Date().toISOString()
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching delivery challan data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch delivery challan data',
            error: error.message
        });
    }
});
exports.getDeliveryChallanData = getDeliveryChallanData;
// Update Qty Issued for Delivery Challan
const updateQtyIssued = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { dcNo, qtyIssued, dispatchId, indentQty, forceUpdate } = req.body;
        if ((!dcNo && !dispatchId) || qtyIssued === undefined) {
            return res.status(400).json({
                success: false,
                message: 'DC No or Dispatch ID and Qty Issued are required'
            });
        }
        let dispatch;
        // Find dispatch by ID or DC No
        if (dispatchId) {
            dispatch = yield Dispatch_js_1.default.findById(dispatchId);
        }
        else if (dcNo) {
            dispatch = yield Dispatch_js_1.default.findOne({ dcno: dcNo });
        }
        if (!dispatch) {
            return res.status(404).json({
                success: false,
                message: 'Delivery challan not found'
            });
        }
        // Check if qty exceeds indent qty (if indent qty > 0).
        // NOTE: We no longer block or require confirmation when qtyIssued exceeds indentQty.
        //       This value is kept only for information/logging.
        const exceedsIndent = indentQty && indentQty > 0 && qtyIssued > indentQty;
        // Check if already dispatched or approved - require confirmation unless forceUpdate is true
        const isFinalStatus = dispatch.status === 'dispatched' || dispatch.status === 'approved';
        if (isFinalStatus && !forceUpdate) {
            const message = `This item is already ${dispatch.status}. Updating Qty Issued for dispatched items may affect stock calculations. Do you want to proceed?`;
            return res.status(409).json({
                success: false,
                requiresConfirmation: true,
                message: message,
                currentStatus: dispatch.status,
                currentQtyIssued: dispatch.qtyIssued,
                newQtyIssued: qtyIssued,
                indentQty: indentQty,
                exceedsIndent: exceedsIndent
            });
        }
        // Previously we validated qtyIssued against available item.batch inventory
        // and blocked when requested quantity was greater than available.
        // Business requirement: allow issuing more than available and track the
        // negative stock in closing balance, so this validation is now removed.
        // Store old qty for logging if this is a forced update
        const oldQtyIssued = dispatch.qtyIssued;
        // Update qty issued and related stock fields
        dispatch.qtyIssued = qtyIssued;
        dispatch.dispatchedQuantitySentToday = qtyIssued;
        // Recalculate all stock fields properly
        // Total Available Stock = Packed + Previous Closing + Returns
        const totalAvailableStock = (dispatch.packedQuantityReadyForDispatch || 0) +
            (dispatch.previousClosingStockYesterdayBalance || 0) +
            (dispatch.returnQuantityYesterdayReturns || 0);
        dispatch.totalAvailableStock = totalAvailableStock;
        // Closing Stock End of Day = Total Available - Dispatched
        // NOTE: We now allow this value to be negative so that overs-issuing
        // beyond available stock is reflected as a minus balance.
        dispatch.closingStockEndOfDayBalance = totalAvailableStock - (qtyIssued || 0);
        // Overall Loss = Closing Stock - Physical Stock Entry
        if (dispatch.physicalStockEntryManualVerification !== undefined) {
            dispatch.overallLoss = dispatch.closingStockEndOfDayBalance - (dispatch.physicalStockEntryManualVerification || 0);
        }
        dispatch.updatedAt = new Date();
        const updatedDispatch = yield dispatch.save();
        // Log if this was a forced update
        if (forceUpdate && (isFinalStatus || exceedsIndent)) {
            console.log(`⚠️ Forced qty update:`, {
                dispatchId: dispatch._id,
                dcNo: dispatch.dcno,
                oldQty: oldQtyIssued,
                newQty: qtyIssued,
                indentQty: indentQty,
                exceedsIndent: exceedsIndent,
                status: dispatch.status
            });
        }
        // Populate related data
        yield updatedDispatch.populate('productId', 'name code category unit');
        res.status(200).json({
            success: true,
            message: forceUpdate
                ? 'Qty issued updated successfully (with override)'
                : 'Qty issued updated successfully',
            data: updatedDispatch,
            wasForced: !!forceUpdate
        });
    }
    catch (error) {
        console.error('Error in updateQtyIssued:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.updateQtyIssued = updateQtyIssued;
// Approve Product in Delivery Challan
const approveProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { dcNo } = req.body;
        if (!dcNo) {
            return res.status(400).json({
                success: false,
                message: 'DC No is required'
            });
        }
        // Find the dispatch record by DC No (note: field name is 'dcno' in DB)
        const dispatch = yield Dispatch_js_1.default.findOne({ dcno: dcNo });
        if (!dispatch) {
            return res.status(404).json({
                success: false,
                message: 'Delivery challan not found with DC No: ' + dcNo
            });
        }
        // Update status to approved
        dispatch.status = 'approved';
        dispatch.approvedAt = new Date();
        dispatch.approvedBy = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id;
        dispatch.updatedAt = new Date();
        const updatedDispatch = yield dispatch.save();
        // Populate related data
        yield updatedDispatch.populate('productId', 'name code category unit');
        yield updatedDispatch.populate('customerId', 'name address phone email');
        res.status(200).json({
            success: true,
            message: 'Product approved successfully',
            data: updatedDispatch
        });
    }
    catch (error) {
        console.error('Error in approveProduct:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});
exports.approveProduct = approveProduct;
// Generate Invoice PDF for Delivery Challan
const generateInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { dcNo } = req.body;
        if (!dcNo) {
            return res.status(400).json({ success: false, message: 'DC No is required' });
        }
        const { Company } = yield Promise.resolve().then(() => __importStar(require('../models/Company.js')));
        // Get all dispatches for this DC number
        const dispatches = yield Dispatch_js_1.default.find({ dcno: dcNo })
            .populate('productId', 'name code unit salePrice gst hsn')
            .populate('customer', 'name address1 mobile email gstin city state pin customerCode')
            .populate('company', 'name unitName address mobile email gst city state locationPin');
        if (!dispatches || dispatches.length === 0) {
            return res.status(404).json({ success: false, message: 'Delivery challan not found with DC No: ' + dcNo });
        }
        const firstDispatch = dispatches[0];
        // Validate status
        const allowedStatuses = ['approved', 'dispatched', 'completed', 'updated', 'delivered', 'verified'];
        const status = (firstDispatch.status || '').toLowerCase();
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: `Cannot generate invoice. Status: ${firstDispatch.status}` });
        }
        const company = yield Company.findById(req.user.companyId);
        const customerDoc = firstDispatch.customer;
        yield (0, invoicePdf_js_1.generateStandardizedInvoicePDF)(res, {
            company: company ? company.toObject() : (firstDispatch.company || {}),
            customer: customerDoc ? (customerDoc.toObject ? customerDoc.toObject() : customerDoc) : {},
            invoiceNo: dcNo,
            date: new Date(firstDispatch.date || firstDispatch.createdAt).toLocaleDateString('en-IN'),
            ref: ((_a = firstDispatch.salesPerson) === null || _a === void 0 ? void 0 : _a.fullName) || '',
            notes: firstDispatch.notes || '',
            items: dispatches.map(d => {
                var _a, _b, _c, _d, _e;
                return ({
                    productName: ((_a = d.productId) === null || _a === void 0 ? void 0 : _a.name) || d.productName || d.productGroup || 'Unknown',
                    hsn: ((_b = d.productId) === null || _b === void 0 ? void 0 : _b.hsn) || '',
                    quantity: d.qtyIssued || d.indentQty || 0,
                    unit: ((_c = d.productId) === null || _c === void 0 ? void 0 : _c.unit) || 'nos',
                    rate: ((_d = d.productId) === null || _d === void 0 ? void 0 : _d.salePrice) || d.rate || 0,
                    discount: 0,
                    mrp: ((_e = d.productId) === null || _e === void 0 ? void 0 : _e.salePrice) || d.rate || 0,
                });
            })
        });
        // Mark invoice as generated
        yield Dispatch_js_1.default.updateMany({ dcno: dcNo }, { invoiceGenerated: true, invoiceGeneratedAt: new Date() });
        // ─── AUTO-CREATE FORMAL SALE RECORD ─────────────────────────────────────
        yield ensureSaleRecordForDC(dcNo, dispatches, req.user, req.user.companyId);
    }
    catch (error) {
        console.error('Error in generateInvoice:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate invoice', error: error.message });
        }
    }
});
exports.generateInvoice = generateInvoice;
// Get Next DC Number
const getNextDCNumber = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Use the static method from Dispatch model to generate next DCno
        const nextDCno = yield Dispatch_js_1.default.generateNextDCno(req.user.companyId);
        res.status(200).json({
            success: true,
            nextDCNumber: nextDCno,
            dcNo: nextDCno // Keep both for compatibility
        });
    }
    catch (error) {
        console.error('Error getting next DC number:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate DC number',
            error: error.message
        });
    }
});
exports.getNextDCNumber = getNextDCNumber;
// Create Dispatch Order from Delivery Challan
const createDispatchOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { dcNo, salesmanId, customerId, by, to } = req.body;
        // Validate required fields
        if (!salesmanId || !customerId) {
            return res.status(400).json({
                success: false,
                message: 'Salesman and customer are required'
            });
        }
        // Import required models
        const User = (yield Promise.resolve().then(() => __importStar(require('../models/User.js')))).default;
        const Company = (yield Promise.resolve().then(() => __importStar(require('../models/Company.js')))).default;
        // Verify salesman exists
        const salesman = yield User.findById(salesmanId);
        if (!salesman) {
            return res.status(404).json({
                success: false,
                message: 'Salesman not found'
            });
        }
        // Verify customer exists
        const customer = yield Customer_js_1.default.findById(customerId);
        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }
        // Get today's date range
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        // Find today's orders for this customer
        const orders = yield Order_js_1.default.find({
            customer: customerId,
            orderDate: { $gte: startOfDay, $lte: endOfDay }
        })
            .populate('products.product', 'name code category productGroup')
            .populate('companyId', 'name');
        if (!orders || orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No orders found for this customer today'
            });
        }
        // Generate DC number if not provided
        const finalDCNo = dcNo || (yield Dispatch_js_1.default.generateNextDCno());
        // Create dispatch entries for each product in the orders
        const dispatchEntries = [];
        for (const order of orders) {
            for (const productItem of order.products) {
                const existingDispatch = yield Dispatch_js_1.default.findOne({
                    dcno: finalDCNo,
                    productId: productItem.product._id,
                    company: order.companyId
                });
                if (!existingDispatch) {
                    const dispatchEntry = new Dispatch_js_1.default({
                        dcno: finalDCNo,
                        dcNo: finalDCNo,
                        orderId: order._id,
                        productId: productItem.product._id,
                        productName: productItem.product.name,
                        productGroup: productItem.product.productGroup || productItem.product.category,
                        company: order.companyId,
                        indentQty: 0,
                        totalIndentQuantityOrdersForTheDay: productItem.quantity,
                        qtyIssued: productItem.quantity,
                        status: 'pending',
                        date: new Date(),
                        salesPerson: salesmanId,
                        customer: customerId,
                        by: by || salesman.fullName || salesman.username,
                        to: to || customer.name,
                        createdBy: req.user.id,
                        lastUpdatedBy: req.user.id,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                    yield dispatchEntry.save();
                    dispatchEntries.push(dispatchEntry);
                }
            }
        }
        res.status(201).json({
            success: true,
            message: `Dispatch order created successfully with DC No: ${finalDCNo}`,
            dcNo: finalDCNo,
            dispatchCount: dispatchEntries.length,
            dispatches: dispatchEntries
        });
    }
    catch (error) {
        console.error('Error creating dispatch order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create dispatch order',
            error: error.message
        });
    }
});
exports.createDispatchOrder = createDispatchOrder;
// Get today's products for a specific salesman and customer
const getTodaysProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    try {
        const { salesmanId, customerId } = req.query;
        console.log('📦 Fetching today\'s products for:', { salesmanId, customerId, companyId: req.user.companyId });
        // Get today's date range (start and end of day) - Use UTC time for consistency
        const today = new Date();
        const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999));
        console.log('📅 Date range:', { startOfDay, endOfDay, today });
        // First, check if ANY dispatches exist for this company
        const totalDispatches = yield Dispatch_js_1.default.countDocuments({ company: req.user.companyId });
        console.log(`📊 Total dispatches for company: ${totalDispatches}`);
        // Check dispatches for today without status filter
        const todayDispatches = yield Dispatch_js_1.default.countDocuments({
            company: req.user.companyId,
            date: { $gte: startOfDay, $lte: endOfDay }
        });
        console.log(`📊 Dispatches for today (any status): ${todayDispatches}`);
        // Build query with optional filters
        const query = {
            date: {
                $gte: startOfDay,
                $lte: endOfDay
            },
            company: req.user.companyId,
            status: { $in: ['pending', 'updated', 'approved', 'dispatched'] }
        };
        // Add optional filters if provided
        if (salesmanId) {
            query.salesPerson = new mongoose_1.default.Types.ObjectId(salesmanId);
            console.log('🔍 Filtering by salesPerson:', salesmanId);
        }
        if (customerId) {
            query.customer = new mongoose_1.default.Types.ObjectId(customerId);
            console.log('🔍 Filtering by customer:', customerId);
        }
        console.log('🔎 Query:', JSON.stringify(query, null, 2));
        // Find dispatch entries for today
        const dispatchProducts = yield Dispatch_js_1.default.find(query)
            .populate('packingSheetId')
            .populate('salesPerson', 'fullName username email')
            .populate('customer', 'name customerCode address phone email')
            .sort({ createdAt: -1 });
        console.log(`✅ Found ${dispatchProducts.length} dispatch products for today with filters`);
        // If no results, check what statuses exist for today
        if (dispatchProducts.length === 0 && todayDispatches > 0) {
            const todayDispatchSample = yield Dispatch_js_1.default.find({
                company: req.user.companyId,
                date: { $gte: startOfDay, $lte: endOfDay }
            }).limit(5).select('status productGroup date');
            console.log('⚠️ Sample today dispatches with different statuses:', todayDispatchSample.map(d => ({
                status: d.status,
                productGroup: d.productGroup,
                date: d.date
            })));
        }
        // Import required models
        const PackingSheet = (yield Promise.resolve().then(() => __importStar(require('../models/Packing.js')))).default;
        const ProductionBatch = (yield Promise.resolve().then(() => __importStar(require('../models/ProductionBatch.js')))).default;
        const { Item } = yield Promise.resolve().then(() => __importStar(require('../models/Inventory.js')));
        // Group dispatches by packingSheetId
        const groupedByPackingSheet = {};
        console.log(`\n🔍 DEBUG: Processing ${dispatchProducts.length} dispatches...`);
        for (const dispatch of dispatchProducts) {
            const packingSheetId = ((_b = (_a = dispatch.packingSheetId) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString()) || ((_c = dispatch.packingSheetId) === null || _c === void 0 ? void 0 : _c.toString());
            console.log(`\n📋 Dispatch ${dispatch._id}:`);
            console.log(`   Product: ${dispatch.productName || dispatch.productGroup}`);
            console.log(`   PackingSheetId: ${packingSheetId || 'NULL/UNDEFINED'}`);
            console.log(`   Has packingSheetId? ${!!packingSheetId}`);
            if (!packingSheetId) {
                // Handle ungrouped items (no packing sheet) - Group by productId to avoid duplicates
                console.log(`   ✅ THIS IS AN UNGROUPED ITEM`);
                const productIdStr = ((_e = (_d = dispatch.productId) === null || _d === void 0 ? void 0 : _d._id) === null || _e === void 0 ? void 0 : _e.toString()) || ((_f = dispatch.productId) === null || _f === void 0 ? void 0 : _f.toString()) || `unknown_${dispatch._id}`;
                const key = `ungrouped_${productIdStr}`;
                // Add item details for ungrouped item
                let itemDetails = null;
                if (dispatch.productId) {
                    try {
                        itemDetails = yield Item.findById(dispatch.productId).select('name stock batch location qty').lean();
                        console.log(`✅ Fetched ungrouped item details:`, {
                            productId: dispatch.productId,
                            name: itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.name,
                            batch: itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.batch,
                            stock: itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.stock
                        });
                    }
                    catch (err) {
                        console.error(`❌ Could not fetch item details for productId: ${dispatch.productId}`, err.message);
                    }
                }
                // Check if this ungrouped item already exists - if so, consolidate quantities
                if (groupedByPackingSheet[key]) {
                    console.log(`   ✅ CONSOLIDATING: Item already exists, merging quantities...`);
                    const existing = groupedByPackingSheet[key];
                    // Accumulate quantities
                    existing.indentQty = (existing.indentQty || 0) + (dispatch.indentQty || 0);
                    existing.qtyIssued = (existing.qtyIssued || 0) + (dispatch.qtyIssued || 0);
                    existing.totalIndentQuantityOrdersForTheDay = (existing.totalIndentQuantityOrdersForTheDay || 0) + (dispatch.totalIndentQuantityOrdersForTheDay || 0);
                    existing.dispatchedQuantitySentToday = (existing.dispatchedQuantitySentToday || 0) + (dispatch.dispatchedQuantitySentToday || 0);
                    // Update items array with new dispatch info if not already present
                    const existingItemIds = ((_g = existing.items) === null || _g === void 0 ? void 0 : _g.map(i => { var _a, _b, _c, _d; return ((_b = (_a = i.itemId) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) || ((_d = (_c = i.itemId) === null || _c === void 0 ? void 0 : _c.toString) === null || _d === void 0 ? void 0 : _d.call(_c)) || i.itemId; })) || [];
                    const newItemId = ((_k = (_j = (_h = dispatch.productId) === null || _h === void 0 ? void 0 : _h._id) === null || _j === void 0 ? void 0 : _j.toString) === null || _k === void 0 ? void 0 : _k.call(_j)) || ((_m = (_l = dispatch.productId) === null || _l === void 0 ? void 0 : _l.toString) === null || _m === void 0 ? void 0 : _m.call(_l));
                    if (!existingItemIds.includes(newItemId)) {
                        existing.items.push({
                            itemId: ((_o = dispatch.productId) === null || _o === void 0 ? void 0 : _o._id) || dispatch.productId,
                            productName: dispatch.productName || (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.name) || 'Unknown',
                            batch: (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.batch) || dispatch.batchNo || null,
                            stock: (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.stock) || (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.qty) || dispatch.totalAvailableStock || 0,
                            qtyIssued: dispatch.qtyIssued || 0,
                            status: dispatch.status,
                            totalAvailableStock: dispatch.totalAvailableStock || 0
                        });
                    }
                    continue;
                }
                // Create a separate entry for each ungrouped item (no grouping)
                groupedByPackingSheet[key] = {
                    _id: dispatch._id,
                    packingSheetId: null,
                    productGroup: dispatch.productGroup || 'Ungrouped',
                    productName: dispatch.productName || (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.name) || 'Unknown',
                    company: dispatch.company,
                    date: dispatch.date,
                    packedQuantityReadyForDispatch: dispatch.packedQuantityReadyForDispatch,
                    previousClosingStockYesterdayBalance: dispatch.previousClosingStockYesterdayBalance,
                    returnQuantityYesterdayReturns: dispatch.returnQuantityYesterdayReturns,
                    totalAvailableStock: dispatch.totalAvailableStock,
                    totalIndentQuantityOrdersForTheDay: dispatch.totalIndentQuantityOrdersForTheDay,
                    excessShortage: dispatch.excessShortage,
                    dispatchedQuantitySentToday: dispatch.dispatchedQuantitySentToday,
                    closingStockEndOfDayBalance: dispatch.closingStockEndOfDayBalance,
                    physicalStockEntryManualVerification: dispatch.physicalStockEntryManualVerification,
                    overallLoss: dispatch.overallLoss,
                    dcno: dispatch.dcno,
                    batchNo: dispatch.batchNo,
                    remarks: dispatch.remarks,
                    verifiedBy: dispatch.verifiedBy,
                    verifiedAt: dispatch.verifiedAt,
                    salesPerson: dispatch.salesPerson ? {
                        _id: dispatch.salesPerson._id,
                        fullName: dispatch.salesPerson.fullName,
                        username: dispatch.salesPerson.username,
                        email: dispatch.salesPerson.email
                    } : null,
                    customer: dispatch.customer ? {
                        _id: dispatch.customer._id,
                        name: dispatch.customer.name,
                        customerCode: dispatch.customer.customerCode,
                        address: dispatch.customer.address,
                        phone: dispatch.customer.phone,
                        email: dispatch.customer.email
                    } : null,
                    orderId: dispatch.orderId,
                    indentQty: dispatch.indentQty || 0,
                    qtyIssued: dispatch.qtyIssued || 0,
                    approvedBy: dispatch.approvedBy,
                    approvedAt: dispatch.approvedAt,
                    invoiceGenerated: dispatch.invoiceGenerated,
                    status: dispatch.status,
                    lastUpdatedBy: dispatch.lastUpdatedBy,
                    // Single item data (not an array - for ungrouped items)
                    items: [{
                            itemId: ((_p = dispatch.productId) === null || _p === void 0 ? void 0 : _p._id) || dispatch.productId,
                            productName: dispatch.productName || (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.name) || 'Unknown',
                            batch: (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.batch) || dispatch.batchNo || null,
                            stock: (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.stock) || (itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.qty) || dispatch.totalAvailableStock || 0,
                            qtyIssued: dispatch.qtyIssued || 0,
                            status: dispatch.status,
                            totalAvailableStock: dispatch.totalAvailableStock || 0
                        }],
                    totalItemBatch: parseFloat(itemDetails === null || itemDetails === void 0 ? void 0 : itemDetails.batch) || 0,
                    isUngrouped: true
                };
            }
            else {
                // Handle grouped items with packing sheet
                if (!groupedByPackingSheet[packingSheetId]) {
                    groupedByPackingSheet[packingSheetId] = {
                        _id: dispatch._id,
                        packingSheetId: packingSheetId,
                        productGroup: dispatch.productGroup,
                        productId: dispatch.productId,
                        productName: dispatch.productName,
                        company: dispatch.company,
                        date: dispatch.date,
                        packedQuantityReadyForDispatch: dispatch.packedQuantityReadyForDispatch,
                        previousClosingStockYesterdayBalance: dispatch.previousClosingStockYesterdayBalance,
                        returnQuantityYesterdayReturns: dispatch.returnQuantityYesterdayReturns,
                        totalAvailableStock: dispatch.totalAvailableStock,
                        totalIndentQuantityOrdersForTheDay: dispatch.totalIndentQuantityOrdersForTheDay,
                        excessShortage: dispatch.excessShortage,
                        dispatchedQuantitySentToday: dispatch.dispatchedQuantitySentToday,
                        closingStockEndOfDayBalance: dispatch.closingStockEndOfDayBalance,
                        physicalStockEntryManualVerification: dispatch.physicalStockEntryManualVerification,
                        overallLoss: dispatch.overallLoss,
                        dcno: dispatch.dcno,
                        batchNo: dispatch.batchNo,
                        remarks: dispatch.remarks,
                        verifiedBy: dispatch.verifiedBy,
                        verifiedAt: dispatch.verifiedAt,
                        salesPerson: dispatch.salesPerson ? {
                            _id: dispatch.salesPerson._id,
                            fullName: dispatch.salesPerson.fullName,
                            username: dispatch.salesPerson.username,
                            email: dispatch.salesPerson.email
                        } : null,
                        customer: dispatch.customer ? {
                            _id: dispatch.customer._id,
                            name: dispatch.customer.name,
                            customerCode: dispatch.customer.customerCode,
                            address: dispatch.customer.address,
                            phone: dispatch.customer.phone,
                            email: dispatch.customer.email
                        } : null,
                        orderId: dispatch.orderId,
                        indentQty: dispatch.indentQty || 0,
                        qtyIssued: dispatch.qtyIssued || 0,
                        approvedBy: dispatch.approvedBy,
                        approvedAt: dispatch.approvedAt,
                        invoiceGenerated: dispatch.invoiceGenerated,
                        status: dispatch.status,
                        lastUpdatedBy: dispatch.lastUpdatedBy,
                        items: []
                    };
                }
            }
        }
        // For each packing sheet, get production batch details and items
        const products = [];
        console.log(`🔄 Processing ${Object.keys(groupedByPackingSheet).length} grouped packing sheets...`);
        for (const [key, group] of Object.entries(groupedByPackingSheet)) {
            if (key.startsWith('ungrouped_')) {
                // Already processed ungrouped items
                console.log(`  ✅ Adding ungrouped item: ${group.productGroup}`);
                products.push(group);
                continue;
            }
            console.log(`  🔍 Processing packing sheet: ${group.packingSheetId}`);
            try {
                // Get packing sheet details
                const packingSheet = yield PackingSheet.findById(group.packingSheetId);
                if (!packingSheet) {
                    console.log(`  ⚠️ Packing sheet not found: ${group.packingSheetId}, skipping...`);
                    continue;
                }
                // If packing sheet has no production group, treat as ungrouped
                if (!packingSheet.productionGroup) {
                    console.log(`  ⚠️ Packing sheet has no production group - UNGROUPED ITEM`);
                    console.log(`  🔍 ProductId from group: ${group.productId}`);
                    console.log(`  🔍 ProductId type: ${typeof group.productId}`);
                    // Simple: Get batch from Item table using productId
                    let batchValue = 0;
                    let item = null;
                    if (group.productId) {
                        try {
                            console.log(`  📡 Querying Item collection for ID: ${group.productId}`);
                            item = yield Item.findById(group.productId).select('name batch stock qty').lean();
                            console.log(`  📦 Item query result:`, item);
                            if (item) {
                                if (item.batch) {
                                    batchValue = parseFloat(item.batch);
                                    console.log(`  ✅✅✅ SUCCESS! Found batch: ${item.batch}, parsed: ${batchValue}`);
                                }
                                else {
                                    console.log(`  ❌ Item found but batch field is: ${item.batch}`);
                                }
                            }
                            else {
                                console.log(`  ❌ Item.findById returned null - Item not found in database!`);
                            }
                        }
                        catch (err) {
                            console.error(`  ❌ Error fetching item:`, err);
                        }
                    }
                    else {
                        console.log(`  ❌ No productId in group!`);
                    }
                    // Ensure this "no production group" case still behaves like an ungrouped item on frontend
                    if (!Array.isArray(group.items) || group.items.length === 0) {
                        group.items = [{
                                itemId: group.productId,
                                productName: group.productName || (item === null || item === void 0 ? void 0 : item.name) || 'Unknown',
                                batch: (item === null || item === void 0 ? void 0 : item.batch) || group.batchNo || null,
                                stock: (item === null || item === void 0 ? void 0 : item.stock) || (item === null || item === void 0 ? void 0 : item.qty) || group.totalAvailableStock || 0,
                                qtyIssued: group.qtyIssued || 0,
                                status: group.status || 'pending',
                                totalAvailableStock: group.totalAvailableStock || ((item === null || item === void 0 ? void 0 : item.stock) || (item === null || item === void 0 ? void 0 : item.qty) || 0)
                            }];
                    }
                    // Set totalItemBatch directly
                    group.totalItemBatch = batchValue;
                    group.indentQty = group.indentQty || 0;
                    group.isUngrouped = true;
                    console.log(`  ✅ FINAL UNGROUPED RESULT - totalItemBatch: ${group.totalItemBatch}, indentQty: ${group.indentQty}`);
                    products.push(group);
                    continue;
                }
                console.log(`  📄 Found packing sheet with productionGroup: ${packingSheet.productionGroup}`);
                // Get ALL production batches for this productionGroup for TODAY only
                const productionBatches = yield ProductionBatch.find({
                    groupId: packingSheet.productionGroup,
                    companyId: req.user.companyId,
                    productionDate: { $gte: startOfDay, $lte: endOfDay }
                }).populate('combinedItems.itemId');
                if (!productionBatches || productionBatches.length === 0) {
                    console.log(`  ⚠️ No production batches found for group: ${packingSheet.productionGroup}, skipping...`);
                    continue;
                }
                console.log(`  📦 Found ${productionBatches.length} production batch(es) for packing sheet ${group.packingSheetId}`);
                // Get dispatch details for this packing sheet to get indent quantities
                const relatedDispatches = dispatchProducts.filter(d => {
                    var _a, _b, _c;
                    const dPackingSheetId = ((_b = (_a = d.packingSheetId) === null || _a === void 0 ? void 0 : _a._id) === null || _b === void 0 ? void 0 : _b.toString()) || ((_c = d.packingSheetId) === null || _c === void 0 ? void 0 : _c.toString());
                    return dPackingSheetId === group.packingSheetId;
                });
                // Track unique items to avoid duplicates
                const addedItemIds = new Set();
                // Build items array from ALL production batches
                for (const productionBatch of productionBatches) {
                    if (!productionBatch.combinedItems || productionBatch.combinedItems.length === 0) {
                        console.log(`⚠️ Batch ${productionBatch.batchNo} has no combined items`);
                        continue;
                    }
                    console.log(`  📦 Processing batch ${productionBatch.batchNo} with ${productionBatch.combinedItems.length} items`);
                    for (const combinedItem of productionBatch.combinedItems) {
                        const item = combinedItem.itemId;
                        if (!item) {
                            console.log(`  ⚠️ Item not found in combinedItems`);
                            continue;
                        }
                        // Skip if we've already added this item
                        const itemIdStr = item._id.toString();
                        if (addedItemIds.has(itemIdStr)) {
                            console.log(`  ⏭️ Skipping duplicate item: ${item.name}`);
                            continue;
                        }
                        addedItemIds.add(itemIdStr);
                        // Fetch fresh item details from Item collection to get current batch number
                        let itemBatch = null;
                        let itemStock = 0;
                        try {
                            const freshItem = yield Item.findById(item._id).select('batch stock qty').lean();
                            if (freshItem) {
                                itemBatch = freshItem.batch;
                                itemStock = freshItem.stock || freshItem.qty || 0;
                            }
                        }
                        catch (err) {
                            console.log(`  ⚠️ Could not fetch fresh item data for ${item._id}`);
                        }
                        // Find matching dispatch entry for this item
                        const matchingDispatch = relatedDispatches.find(d => { var _a; return ((_a = d.productId) === null || _a === void 0 ? void 0 : _a.toString()) === item._id.toString(); });
                        group.items.push({
                            itemId: item._id,
                            productName: item.name || 'Unknown',
                            batch: itemBatch || item.batch || null, // ✅ Each item's batch from Item table
                            stock: itemStock || item.stock || item.qty || 0,
                            qtyIssued: (matchingDispatch === null || matchingDispatch === void 0 ? void 0 : matchingDispatch.qtyIssued) || 0,
                            status: (matchingDispatch === null || matchingDispatch === void 0 ? void 0 : matchingDispatch.status) || 'pending',
                            totalAvailableStock: (matchingDispatch === null || matchingDispatch === void 0 ? void 0 : matchingDispatch.totalAvailableStock) || itemStock || 0
                        });
                        console.log(`  ✅ Added item: ${item.name} (Batch: ${itemBatch}, Stock: ${itemStock})`);
                    }
                }
                // ✅ Keep existing indentQty from dispatch (already set from database)
                // ✅ Calculate totalItemBatch: sum of all item.batch values in this group
                const totalItemBatch = group.items.reduce((sum, item) => {
                    const batchValue = parseFloat(item.batch) || 0;
                    return sum + batchValue;
                }, 0);
                group.totalItemBatch = totalItemBatch;
                products.push(group);
            }
            catch (err) {
                console.error(`❌ Error processing packing sheet ${group.packingSheetId}:`, err);
            }
        }
        console.log(`✅ Returning ${products.length} grouped products`);
        res.json({
            success: true,
            data: {
                products: products,
                count: products.length
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching today\'s products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch today\'s products',
            error: error.message
        });
    }
});
exports.getTodaysProducts = getTodaysProducts;
// Get dispatch history summary for specific items (default: last 30 days)
const getDispatchItemsHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { itemIds, days = 30, salesmanId, customerId } = req.query;
        if (!((_a = req.user) === null || _a === void 0 ? void 0 : _a.companyId)) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required with valid company'
            });
        }
        if (!itemIds) {
            return res.status(400).json({
                success: false,
                message: 'itemIds is required'
            });
        }
        const idsCsv = Array.isArray(itemIds) ? itemIds.join(',') : String(itemIds);
        const idStrings = idsCsv
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        if (idStrings.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'itemIds must contain at least one id'
            });
        }
        if (idStrings.length > 200) {
            return res.status(400).json({
                success: false,
                message: 'Too many itemIds (max 200)'
            });
        }
        const invalidIds = idStrings.filter(id => !mongoose_1.default.isValidObjectId(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid itemIds provided',
                invalidIds
            });
        }
        const itemObjectIds = idStrings.map(id => new mongoose_1.default.Types.ObjectId(id));
        const daysIntRaw = parseInt(String(days), 10);
        const daysInt = Number.isFinite(daysIntRaw) ? Math.min(Math.max(daysIntRaw, 1), 31) : 30;
        const companyIdStr = String(req.user.companyId);
        if (!mongoose_1.default.isValidObjectId(companyIdStr)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid companyId'
            });
        }
        const companyObjectId = new mongoose_1.default.Types.ObjectId(companyIdStr);
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - (daysInt - 1));
        const query = {
            company: companyObjectId,
            productId: { $in: itemObjectIds },
            date: { $gte: startDate, $lte: endDate },
            status: { $in: ['dispatched', 'completed'] }
        };
        if (salesmanId) {
            if (!mongoose_1.default.isValidObjectId(salesmanId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid salesmanId'
                });
            }
            query.salesPerson = new mongoose_1.default.Types.ObjectId(salesmanId);
        }
        if (customerId) {
            if (!mongoose_1.default.isValidObjectId(customerId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid customerId'
                });
            }
            query.customer = new mongoose_1.default.Types.ObjectId(customerId);
        }
        const docs = yield Dispatch_js_1.default.find(query)
            .select('productId qtyIssued date dcno batchNo totalAvailableStock createdAt')
            .sort({ date: -1, createdAt: -1 })
            .lean();
        const items = {};
        for (const doc of docs) {
            const productIdStr = String(doc.productId);
            const qty = Number(doc.qtyIssued);
            if (!Number.isFinite(qty) || qty <= 0)
                continue;
            if (!items[productIdStr]) {
                items[productIdStr] = { records: [] };
            }
            items[productIdStr].records.push({
                qtyIssued: qty,
                date: doc.date || doc.createdAt || null,
                dcno: doc.dcno || null,
                batchNo: doc.batchNo || null,
                totalAvailableStock: doc.totalAvailableStock || 0
            });
        }
        return res.json({
            success: true,
            data: {
                days: daysInt,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                items
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching dispatch items history:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch dispatch items history',
            error: error.message
        });
    }
});
exports.getDispatchItemsHistory = getDispatchItemsHistory;
// Validate DC number uniqueness
const validateDCNumber = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { dcNo } = req.query;
        console.log('🔍 Validating DC number:', dcNo);
        if (!dcNo) {
            return res.status(400).json({
                success: false,
                isUnique: false,
                message: 'DC number is required'
            });
        }
        // Check if DC number already exists
        const existingDC = yield Dispatch_js_1.default.findOne({
            dcno: dcNo,
            company: req.user.companyId
        });
        const isUnique = !existingDC;
        console.log(`${isUnique ? '✅' : '❌'} DC number ${dcNo} is ${isUnique ? 'unique' : 'already in use'}`);
        res.json({
            success: true,
            isUnique: isUnique,
            message: isUnique ? 'DC number is available' : 'DC number already exists'
        });
    }
    catch (error) {
        console.error('❌ Error validating DC number:', error);
        res.status(500).json({
            success: false,
            isUnique: false,
            message: 'Failed to validate DC number',
            error: error.message
        });
    }
});
exports.validateDCNumber = validateDCNumber;
// Create a new delivery challan with all items
const createDeliveryChallan = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        let { dcNo, salesmanId, customerId, items } = req.body;
        // Clean dcNo - remove hyphens and spaces
        if (dcNo) {
            dcNo = dcNo.toString().replace(/[-\s]/g, '').toUpperCase();
        }
        console.log('📋 Creating delivery challan:', { dcNo, salesmanId, customerId, itemsCount: items === null || items === void 0 ? void 0 : items.length });
        // Validate required fields
        if (!dcNo || !salesmanId || !customerId || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'DC number, salesman, customer, and items are required'
            });
        }
        // Note: sequential DC number enforcement removed. Any DC format is accepted
        // here as long as it's unique per company. DC numbering (generation) is
        // still available via helper APIs if needed, but we don't enforce
        // that the provided dcNo matches the next sequential number.
        // Validate DC number uniqueness
        const existingDC = yield Dispatch_js_1.default.findOne({
            dcno: dcNo,
            company: req.user.companyId
        });
        if (existingDC) {
            return res.status(400).json({
                success: false,
                message: 'DC number already exists. Please use a different number.'
            });
        }
        // Get salesman and customer details
        const User = (yield Promise.resolve().then(() => __importStar(require('../models/User.js')))).default;
        const Customer = (yield Promise.resolve().then(() => __importStar(require('../models/Customer.js')))).default;
        const salesman = yield User.findById(salesmanId).select('fullName username email');
        const customer = yield Customer.findById(customerId).select('name customerCode category outstandingAmount state tdsSection entityType');
        console.log('👤 Salesman lookup:', { salesmanId, found: !!salesman });
        console.log('🏢 Customer lookup:', { customerId, found: !!customer });
        if (!salesman || !customer) {
            return res.status(404).json({
                success: false,
                message: 'Salesman or customer not found',
                details: {
                    salesmanFound: !!salesman,
                    customerFound: !!customer
                }
            });
        }
        // Create dispatch entries for all items with the same DC number
        const dispatchEntries = [];
        const saleItems = [];
        let totalChallanAmount = 0;
        let totalTaxAmount = 0;
        let totalSubtotal = 0;
        const today = new Date();
        const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
        for (const item of items) {
            // PRIMARY METHOD: Frontend should pass dispatchId (_id from dispatch table)
            // This is the expected and preferred way
            let existingDispatch = null;
            if (item.dispatchId || item._id || item.id) {
                // Use dispatchId from frontend (primary method)
                const dispatchIdToUse = item.dispatchId || item._id || item.id;
                console.log(`🎯 PRIMARY: Looking for dispatch by _id: ${dispatchIdToUse}`);
                existingDispatch = yield Dispatch_js_1.default.findOne({
                    _id: dispatchIdToUse,
                    company: req.user.companyId
                });
                if (existingDispatch) {
                    console.log(`✅ Found dispatch record by _id: ${existingDispatch._id}`);
                }
                else {
                    console.log(`⚠️ Dispatch _id ${dispatchIdToUse} not found in company ${req.user.companyId}`);
                }
            }
            else {
                // FALLBACK: If dispatchId not provided, try to find by productId and today's date
                console.log(`⚠️ No dispatchId provided for ${item.productName}, using fallback search by productId`);
                existingDispatch = yield Dispatch_js_1.default.findOne({
                    productId: item.productId,
                    company: req.user.companyId,
                    date: startOfDay
                });
                if (existingDispatch) {
                    console.log(`✅ FALLBACK: Found dispatch by productId: ${item.productId}`);
                }
                else {
                    console.log(`❌ FALLBACK: No dispatch found for productId: ${item.productId}`);
                }
            }
            if (existingDispatch) {
                // Check if already dispatched
                if (existingDispatch.status === 'dispatched' && existingDispatch.dcno) {
                    console.log(`⚠️ Dispatch ${existingDispatch._id} already dispatched with DC: ${existingDispatch.dcno}`);
                    return res.status(400).json({
                        success: false,
                        message: `Item "${item.productName}" has already been dispatched with DC number ${existingDispatch.dcno}. Cannot create duplicate delivery challan.`,
                        alreadyDispatched: true,
                        existingDC: existingDispatch.dcno,
                        productName: item.productName
                    });
                }
                // Update existing dispatch entry with delivery challan details
                console.log(`🔄 Updating dispatch entry ${existingDispatch._id} with DC details`);
                existingDispatch.dcno = dcNo;
                existingDispatch.qtyIssued = item.qtyIssued;
                existingDispatch.dispatchedQuantitySentToday = item.qtyIssued;
                existingDispatch.salesPerson = salesmanId;
                existingDispatch.customer = customerId;
                existingDispatch.status = 'dispatched';
                existingDispatch.lastUpdatedBy = req.user.id;
                existingDispatch.updatedAt = new Date();
                yield existingDispatch.save();
                dispatchEntries.push(existingDispatch);
                console.log(`✅ Successfully updated dispatch ${existingDispatch._id} with DC ${dcNo}`);
                // Reduce item stock/batch quantity
                if (item.productId && item.qtyIssued > 0) {
                    try {
                        const itemToUpdate = yield Inventory_js_1.Item.findById(item.productId);
                        if (itemToUpdate) {
                            // Reduce stock quantity
                            const previousStock = itemToUpdate.stock || itemToUpdate.qty || 0;
                            itemToUpdate.stock = Math.max(0, previousStock - item.qtyIssued);
                            itemToUpdate.qty = itemToUpdate.stock;
                            // Reduce batch number (stored as string number)
                            if (itemToUpdate.batch) {
                                const previousBatch = parseInt(itemToUpdate.batch) || 0;
                                itemToUpdate.batch = Math.max(0, previousBatch - item.qtyIssued).toString();
                            }
                            yield itemToUpdate.save();
                            console.log(`📉 Reduced inventory for ${item.productName}: stock ${previousStock} → ${itemToUpdate.stock}, batch ${itemToUpdate.batch} (dispatched: ${item.qtyIssued})`);
                            // Calculate price for Account integration
                            const priceObj = (_a = itemToUpdate.customerPrices) === null || _a === void 0 ? void 0 : _a.find(p => p.category === customer.category);
                            const unitPrice = priceObj ? priceObj.price : (itemToUpdate.salePrice || 0);
                            const gstPercent = itemToUpdate.gst || 0;
                            const itemSubtotal = unitPrice * item.qtyIssued;
                            const itemTax = itemSubtotal * (gstPercent / 100);
                            const itemTotal = itemSubtotal + itemTax;
                            totalSubtotal += itemSubtotal;
                            totalTaxAmount += itemTax;
                            totalChallanAmount += itemTotal;
                            saleItems.push({
                                productName: item.productName,
                                quantity: item.qtyIssued,
                                unitPrice: unitPrice,
                                totalPrice: itemSubtotal,
                                tax: gstPercent
                            });
                        }
                    }
                    catch (err) {
                        console.error(`⚠️ Could not reduce stock for productId ${item.productId}:`, err.message);
                    }
                }
            }
            else {
                // Create new dispatch entry only if no existing record found
                console.log(`✨ Creating NEW dispatch entry for product: ${item.productName}`);
                const dispatchEntry = new Dispatch_js_1.default({
                    dcno: dcNo,
                    productId: item.productId,
                    productName: item.productName,
                    productGroup: item.productGroup,
                    company: req.user.companyId,
                    date: startOfDay,
                    totalIndentQuantityOrdersForTheDay: item.indentQty || 0,
                    indentQty: 0,
                    qtyIssued: item.qtyIssued || 0,
                    dispatchedQuantitySentToday: item.qtyIssued || 0,
                    packedQuantityReadyForDispatch: item.qtyIssued || 0,
                    salesPerson: salesmanId,
                    customer: customerId,
                    status: 'dispatched',
                    lastUpdatedBy: req.user.id
                });
                yield dispatchEntry.save();
                dispatchEntries.push(dispatchEntry);
                console.log(`✅ Created new dispatch entry with _id: ${dispatchEntry._id}`);
                // Reduce item stock/batch quantity
                if (item.productId && item.qtyIssued > 0) {
                    try {
                        const itemToUpdate = yield Inventory_js_1.Item.findById(item.productId);
                        if (itemToUpdate) {
                            // Reduce stock quantity
                            const previousStock = itemToUpdate.stock || itemToUpdate.qty || 0;
                            itemToUpdate.stock = Math.max(0, previousStock - item.qtyIssued);
                            itemToUpdate.qty = itemToUpdate.stock;
                            // Reduce batch number (stored as string number)
                            if (itemToUpdate.batch) {
                                const previousBatch = parseInt(itemToUpdate.batch) || 0;
                                itemToUpdate.batch = Math.max(0, previousBatch - item.qtyIssued).toString();
                            }
                            yield itemToUpdate.save();
                            console.log(`📉 Reduced inventory for ${item.productName}: stock ${previousStock} → ${itemToUpdate.stock}, batch ${itemToUpdate.batch} (dispatched: ${item.qtyIssued})`);
                            // Calculate price for Account integration
                            const priceObj = (_b = itemToUpdate.customerPrices) === null || _b === void 0 ? void 0 : _b.find(p => p.category === customer.category);
                            const unitPrice = priceObj ? priceObj.price : (itemToUpdate.salePrice || 0);
                            const gstPercent = itemToUpdate.gst || 0;
                            const itemSubtotal = unitPrice * item.qtyIssued;
                            const itemTax = itemSubtotal * (gstPercent / 100);
                            const itemTotal = itemSubtotal + itemTax;
                            totalSubtotal += itemSubtotal;
                            totalTaxAmount += itemTax;
                            totalChallanAmount += itemTotal;
                            saleItems.push({
                                productName: item.productName,
                                quantity: item.qtyIssued,
                                unitPrice: unitPrice,
                                totalPrice: itemSubtotal,
                                tax: gstPercent
                            });
                        }
                    }
                    catch (err) {
                        console.error(`⚠️ Could not reduce stock for productId ${item.productId}:`, err.message);
                    }
                }
            }
        }
        // Connect to Accounts: Create Sale record and Update Customer Outstanding
        if (totalChallanAmount > 0) {
            try {
                const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
                const { Transaction, Account: LedgerAccount } = yield Promise.resolve().then(() => __importStar(require('../models/Account.js')));
                const { Company } = yield Promise.resolve().then(() => __importStar(require('../models/Company.js')));
                const unit = req.user.unit || 'default';
                const companyId = req.user.companyId;
                // Fetch Company to get state for GST calculation
                const company = yield Company.findById(companyId);
                const companyState = ((company === null || company === void 0 ? void 0 : company.state) || '').toLowerCase().trim();
                const customerState = ((customer === null || customer === void 0 ? void 0 : customer.state) || '').toLowerCase().trim();
                const isSameState = companyState && customerState && (companyState === customerState);
                const gstType = isSameState ? 'CGST_SGST' : 'IGST';
                // Calculate TDS
                let tdsPercent = 0;
                let tdsAmount = 0;
                if (customer.tdsSection && customer.tdsSection !== 'None') {
                    switch (customer.tdsSection) {
                        case '194C':
                            tdsPercent = (customer.entityType === 'Individual' || customer.entityType === 'HUF') ? 1 : 2;
                            break;
                        case '194J':
                            tdsPercent = 10;
                            break;
                        case '194Q':
                        case '206C_1H':
                            tdsPercent = 0.1;
                            break;
                    }
                    tdsAmount = (totalSubtotal * tdsPercent) / 100;
                }
                const netReceivable = totalChallanAmount - tdsAmount;
                // 1. Create Sale Record (Invoice)
                const sale = new Sale({
                    invoiceNumber: `INV-${dcNo}`,
                    customer: customerId,
                    saleDate: today,
                    dueDate: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days default
                    items: saleItems,
                    subtotal: totalSubtotal,
                    taxAmount: totalTaxAmount,
                    totalAmount: netReceivable, // ✅ GRAND TOTAL should be net of TDS
                    tdsAmount: tdsAmount,
                    tdsPercent: tdsPercent,
                    gstType: gstType,
                    paidAmount: 0,
                    balanceAmount: netReceivable, // Outstanding is net of TDS
                    unit: unit,
                    companyId: companyId,
                    createdBy: req.user.id,
                    dispatch: (_c = dispatchEntries[0]) === null || _c === void 0 ? void 0 : _c._id,
                    notes: `Created from Delivery Challan: ${dcNo} (TDS Section: ${customer.tdsSection || 'None'})`
                });
                yield sale.save();
                console.log(`💰 Created Sale record for DC ${dcNo}, Net Receivable: ${netReceivable} (GST: ${gstType}, TDS: ${tdsAmount})`);
                // 2. Ledger Posting
                const receivableAccount = yield LedgerAccount.findOne({ accountName: 'Accounts Receivable', unit });
                const salesAccount = yield LedgerAccount.findOne({ accountName: 'Sales Account', unit });
                const gstAccount = yield LedgerAccount.findOne({ accountName: 'Output GST', unit });
                const tdsReceivableAccount = yield LedgerAccount.findOne({ accountName: 'TDS Receivable', unit });
                if (receivableAccount && salesAccount && gstAccount) {
                    const entries = [
                        { account: receivableAccount._id, debit: netReceivable, credit: 0 },
                        { account: salesAccount._id, debit: 0, credit: totalSubtotal },
                        { account: gstAccount._id, debit: 0, credit: totalTaxAmount }
                    ];
                    if (tdsAmount > 0 && tdsReceivableAccount) {
                        entries.push({ account: tdsReceivableAccount._id, debit: tdsAmount, credit: 0 });
                    }
                    const txn = new Transaction({
                        transactionNumber: `TXN-DSP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                        description: `Sales Invoice: ${sale.invoiceNumber} to ${customer.name} (DC: ${dcNo})${tdsAmount > 0 ? ' (Includes TDS Receivable)' : ''}`,
                        reference: dcNo,
                        totalAmount: totalChallanAmount, // Total transaction value
                        unit,
                        relatedDocument: 'Sale',
                        relatedDocumentId: sale._id,
                        createdBy: req.user.id,
                        entries
                    });
                    yield txn.save();
                    // Update ledger balances
                    receivableAccount.balance += netReceivable;
                    salesAccount.balance += totalSubtotal;
                    gstAccount.balance += totalTaxAmount;
                    if (tdsAmount > 0 && tdsReceivableAccount) {
                        tdsReceivableAccount.balance += tdsAmount;
                        yield tdsReceivableAccount.save();
                    }
                    yield receivableAccount.save();
                    yield salesAccount.save();
                    yield gstAccount.save();
                    console.log(`📊 Posted to Ledger for DC ${dcNo}`);
                }
                // 3. Update Customer Outstanding Amount (Net Receivable)
                yield Customer.findByIdAndUpdate(customerId, {
                    $inc: { outstandingAmount: netReceivable }
                });
                console.log(`✅ Updated Customer ${customer.name} outstanding by ${netReceivable}`);
                // 4. Update Dispatch records with invoiceGenerated: true
                for (const entry of dispatchEntries) {
                    entry.invoiceGenerated = true;
                    entry.invoiceGeneratedAt = new Date();
                    yield entry.save();
                }
            }
            catch (accErr) {
                console.error('❌ Error in Account integration:', accErr);
                // We don't fail the whole dispatch if account integration fails, but we log it
            }
        }
        console.log(`✅ Created delivery challan ${dcNo} with ${dispatchEntries.length} items`);
        res.status(201).json({
            success: true,
            message: `Delivery challan ${dcNo} created successfully`,
            data: {
                dcId: dispatchEntries[0]._id, // Return first entry ID for invoice generation
                dcNo: dcNo,
                itemsCount: dispatchEntries.length,
                dispatches: dispatchEntries
            }
        });
    }
    catch (error) {
        console.error('❌ Error creating delivery challan:', error);
        // Handle validation errors specifically
        if (error.name === 'ValidationError') {
            const validationErrors = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: 'Validation failed while creating delivery challan',
                errors: validationErrors,
                details: error.message
            });
        }
        // Handle duplicate DC number error
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'DC number already exists. This delivery challan may have already been created.',
                error: 'Duplicate DC number'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to create delivery challan',
            error: error.message
        });
    }
});
exports.createDeliveryChallan = createDeliveryChallan;
// Generate invoice for a delivery challan
const generateInvoiceForDC = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { dcId } = req.params;
        const requestBody = req.body || {};
        const { Company } = yield Promise.resolve().then(() => __importStar(require('../models/Company.js')));
        const dispatch = yield Dispatch_js_1.default.findById(dcId)
            .populate('productId', 'name code unit salePrice gst hsn')
            .populate('customer', 'name address1 mobile email gstin city state pin customerCode')
            .populate('salesPerson', 'fullName username')
            .populate('company', 'name unitName address mobile email gst city state locationPin');
        if (!dispatch) {
            return res.status(404).json({ success: false, message: 'Delivery challan not found' });
        }
        const allowedStatuses = ['dispatched', 'approved', 'completed', 'updated', 'delivered', 'verified'];
        const currentStatus = (dispatch.status || '').toLowerCase();
        if (!allowedStatuses.includes(currentStatus)) {
            return res.status(400).json({
                success: false,
                message: `Cannot generate invoice. Current status: ${dispatch.status}`,
                currentStatus: dispatch.status
            });
        }
        const company = yield Company.findById(req.user.companyId);
        // Get all items for this DC number
        const allDCItems = yield Dispatch_js_1.default.find({ dcno: dispatch.dcno, company: req.user.companyId })
            .populate('productId', 'name code unit salePrice gst hsn')
            .lean();
        const customerDoc = dispatch.customer;
        yield (0, invoicePdf_js_1.generateStandardizedInvoicePDF)(res, {
            company: company ? company.toObject() : (dispatch.company || {}),
            customer: customerDoc ? (customerDoc.toObject ? customerDoc.toObject() : customerDoc) : {},
            invoiceNo: dispatch.dcno,
            date: new Date(dispatch.date || dispatch.createdAt).toLocaleDateString('en-IN'),
            ref: requestBody.salesmanName || ((_a = dispatch.salesPerson) === null || _a === void 0 ? void 0 : _a.fullName) || '',
            notes: dispatch.notes || requestBody.notes || '',
            items: allDCItems.map(d => {
                var _a, _b, _c, _d, _e;
                return ({
                    productName: ((_a = d.productId) === null || _a === void 0 ? void 0 : _a.name) || d.productName || d.productGroup || 'Unknown',
                    hsn: ((_b = d.productId) === null || _b === void 0 ? void 0 : _b.hsn) || '',
                    quantity: d.qtyIssued || d.indentQty || 0,
                    unit: ((_c = d.productId) === null || _c === void 0 ? void 0 : _c.unit) || 'nos',
                    rate: ((_d = d.productId) === null || _d === void 0 ? void 0 : _d.salePrice) || d.rate || 0,
                    discount: 0,
                    mrp: ((_e = d.productId) === null || _e === void 0 ? void 0 : _e.salePrice) || d.rate || 0,
                });
            })
        });
        // ─── AUTO-CREATE FORMAL SALE RECORD ─────────────────────────────────────
        yield ensureSaleRecordForDC(dispatch.dcno, allDCItems, req.user, req.user.companyId);
    }
    catch (error) {
        console.error('❌ Error generating invoice for DC:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate invoice', error: error.message });
        }
    }
});
exports.generateInvoiceForDC = generateInvoiceForDC;
// Global Invoice Generation by DC Number
const generateInvoiceByDC = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { dcNo, salesPersonId } = req.body;
        if (!dcNo) {
            return res.status(400).json({ success: false, message: 'DC Number is required' });
        }
        const { Company } = yield Promise.resolve().then(() => __importStar(require('../models/Company.js')));
        const dispatches = yield Dispatch_js_1.default.find({ dcno: dcNo })
            .populate('productId', 'name code unit salePrice gst hsn')
            .populate('customer', 'name address1 mobile email gstin city state pin customerCode')
            .populate('salesPerson', 'fullName username')
            .populate('company', 'name unitName address mobile email gst city state locationPin')
            .sort({ createdAt: 1 });
        if (!dispatches || dispatches.length === 0) {
            return res.status(404).json({ success: false, message: 'No dispatches found with this DC number' });
        }
        const firstDispatch = dispatches[0];
        // ─── AUTO-CREATE FORMAL SALE RECORD ─────────────────────────────────────
        yield ensureSaleRecordForDC(dcNo, dispatches, req.user, (req.user.companyId || firstDispatch.company));
        // Override salesperson if provided
        let salesPersonName = ((_a = firstDispatch.salesPerson) === null || _a === void 0 ? void 0 : _a.fullName) || ((_b = firstDispatch.salesPerson) === null || _b === void 0 ? void 0 : _b.username) || '';
        if (salesPersonId) {
            const sp = yield User_js_1.default.findById(salesPersonId);
            if (sp)
                salesPersonName = sp.fullName || sp.username || salesPersonName;
        }
        const company = yield Company.findById(req.user.companyId);
        const customerDoc = firstDispatch.customer;
        yield (0, invoicePdf_js_1.generateStandardizedInvoicePDF)(res, {
            company: company ? company.toObject() : (firstDispatch.company || {}),
            customer: customerDoc ? (customerDoc.toObject ? customerDoc.toObject() : customerDoc) : {},
            invoiceNo: dcNo,
            date: new Date(firstDispatch.date || firstDispatch.createdAt).toLocaleDateString('en-IN'),
            ref: salesPersonName,
            notes: '',
            items: dispatches.map(d => {
                var _a, _b, _c, _d, _e;
                return ({
                    productName: ((_a = d.productId) === null || _a === void 0 ? void 0 : _a.name) || d.productName || d.productGroup || 'Unknown',
                    hsn: ((_b = d.productId) === null || _b === void 0 ? void 0 : _b.hsn) || '',
                    quantity: d.qtyIssued || d.indentQty || 0,
                    unit: ((_c = d.productId) === null || _c === void 0 ? void 0 : _c.unit) || 'nos',
                    rate: ((_d = d.productId) === null || _d === void 0 ? void 0 : _d.salePrice) || d.rate || 0,
                    discount: 0,
                    mrp: ((_e = d.productId) === null || _e === void 0 ? void 0 : _e.salePrice) || d.rate || 0,
                });
            })
        });
    }
    catch (error) {
        console.error('❌ Error generating invoice by DC:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate invoice', error: error.message });
        }
    }
});
exports.generateInvoiceByDC = generateInvoiceByDC;
// Create Direct Order from Dispatch (similar to sales order creation)
const createDirectOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { customerId, salesPersonId, orderDate, products, notes, autoDispatch } = req.body;
        console.log('📦 Creating direct order from dispatch:', { customerId, salesPersonId, orderDate, productsCount: products === null || products === void 0 ? void 0 : products.length, autoDispatch });
        // Validation
        const errors = {};
        if (!customerId) {
            errors.customerId = 'Customer ID is required';
        }
        else {
            const customerExists = yield Customer_js_1.default.findById(customerId);
            if (!customerExists) {
                errors.customerId = 'Customer not found';
            }
        }
        if (!salesPersonId) {
            errors.salesPersonId = 'Sales person ID is required';
        }
        if (!orderDate) {
            errors.orderDate = 'Order date is required';
        }
        else if (new Date(orderDate).toString() === 'Invalid Date') {
            errors.orderDate = 'Order date must be a valid date';
        }
        if (!products || !Array.isArray(products) || products.length === 0) {
            errors.products = 'At least one product is required';
        }
        else {
            // Validate each product
            for (let i = 0; i < products.length; i++) {
                const product = products[i];
                if (!product.productId) {
                    errors[`products[${i}].productId`] = 'Product ID is required';
                }
                if (!product.quantity || product.quantity <= 0) {
                    errors[`products[${i}].quantity`] = 'Quantity must be greater than 0';
                }
                if (!product.unitPrice || product.unitPrice < 0) {
                    errors[`products[${i}].unitPrice`] = 'Unit price is required';
                }
            }
        }
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed.',
                errors
            });
        }
        // Calculate total amount
        let totalAmount = 0;
        const orderProducts = [];
        for (const productItem of products) {
            const itemTotal = productItem.unitPrice * productItem.quantity;
            totalAmount += itemTotal;
            orderProducts.push({
                product: productItem.productId,
                quantity: productItem.quantity,
                price: productItem.unitPrice,
                total: itemTotal
            });
        }
        // Generate unique order code
        let orderCode;
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
            const orderCount = yield Order_js_1.default.countDocuments();
            orderCode = `ORD-${String(orderCount + 1 + attempts).padStart(4, '0')}`;
            const existingOrder = yield Order_js_1.default.findOne({ orderCode });
            if (!existingOrder) {
                isUnique = true;
            }
            else {
                attempts++;
            }
        }
        if (!isUnique) {
            orderCode = `ORD-${Date.now().toString().slice(-6)}`;
        }
        // Parse order date correctly to avoid timezone issues
        // Create UTC date to prevent timezone conversion: YYYY-MM-DD -> UTC midnight
        const parsedOrderDate = new Date(orderDate + 'T00:00:00.000Z');
        console.log('📅 Order date parsed:', { input: orderDate, parsed: parsedOrderDate });
        // Create order
        const order = new Order_js_1.default({
            orderCode,
            customer: customerId,
            salesPerson: salesPersonId,
            companyId: req.user.companyId,
            unit: req.user.unit,
            orderDate: parsedOrderDate,
            products: orderProducts,
            totalAmount,
            status: 'pending',
            notes,
            createdBy: req.user._id || req.user.id,
            createdByRole: 'Dispatch' // Mark that this order was created by dispatch
        });
        console.log('✅ Creating order with salesPerson:', salesPersonId, 'Created by Dispatch user:', req.user.username);
        yield order.save();
        // Populate order with customer and salesperson details
        yield order.populate([
            { path: 'customer', select: 'name email mobile' },
            { path: 'salesPerson', select: 'username fullName email' },
            { path: 'products.product', select: 'name code category unit' }
        ]);
        console.log('📦 Order created, now creating dispatch entries for products...');
        // Step 2: Create dispatch entries for each product in the order
        // Use the parsed order date for dispatch entries, not today's date
        const dispatchDate = new Date(parsedOrderDate);
        const dispatchStartOfDay = new Date(Date.UTC(dispatchDate.getUTCFullYear(), dispatchDate.getUTCMonth(), dispatchDate.getUTCDate(), 0, 0, 0, 0));
        console.log('📅 Dispatch date:', { orderDate: parsedOrderDate, dispatchDate: dispatchStartOfDay });
        // Generate DC number if auto-dispatch is requested
        let dcNumber = null;
        if (autoDispatch) {
            dcNumber = yield Dispatch_js_1.default.generateNextDCno(req.user.companyId);
            console.log('📋 Generated DC number for auto-dispatch:', dcNumber);
        }
        const dispatchEntries = [];
        for (const orderProduct of order.products) {
            const productId = orderProduct.product._id;
            const productName = orderProduct.product.name;
            const indentQty = orderProduct.quantity;
            // Get total indent quantity for this product from all orders for today
            const totalOrderQtyForProduct = yield Order_js_1.default.aggregate([
                {
                    $match: {
                        customer: customerId,
                        orderDate: dispatchStartOfDay,
                        status: { $ne: 'cancelled' }
                    }
                },
                { $unwind: '$products' },
                {
                    $match: {
                        'products.product': productId
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalQty: { $sum: '$products.quantity' }
                    }
                }
            ]);
            const totalIndentQty = totalOrderQtyForProduct.length > 0 ? totalOrderQtyForProduct[0].totalQty : indentQty;
            console.log(`📊 Total indent qty for ${productName} from all orders today: ${totalIndentQty}`);
            // Check if there's already a dispatch entry for this product on the order date
            const existingDispatch = yield Dispatch_js_1.default.findOne({
                productId: productId,
                company: req.user.companyId,
                date: dispatchStartOfDay
            });
            let newDispatchData;
            if (existingDispatch) {
                // Use existing dispatch data as template
                console.log(`📋 Found existing dispatch for product ${productName}, copying data...`);
                newDispatchData = {
                    productId: productId,
                    productName: productName,
                    productGroup: existingDispatch.productGroup,
                    company: req.user.companyId,
                    date: dispatchStartOfDay,
                    // Copy existing stock data
                    packedQuantityReadyForDispatch: existingDispatch.packedQuantityReadyForDispatch || 0,
                    previousClosingStockYesterdayBalance: existingDispatch.previousClosingStockYesterdayBalance || 0,
                    returnQuantityYesterdayReturns: existingDispatch.returnQuantityYesterdayReturns || 0,
                    totalAvailableStock: existingDispatch.totalAvailableStock || 0,
                    physicalStockEntryManualVerification: existingDispatch.physicalStockEntryManualVerification || 0,
                    // Add new order data
                    totalIndentQuantityOrdersForTheDay: totalIndentQty,
                    indentQty: 0,
                    qtyIssued: indentQty,
                    dispatchedQuantitySentToday: indentQty,
                    // Recalculate closing stock
                    closingStockEndOfDayBalance: existingDispatch.closingStockEndOfDayBalance || 0,
                    // Copy other fields
                    batchNo: existingDispatch.batchNo,
                    packingSheetId: existingDispatch.packingSheetId,
                    // New order references
                    salesPerson: salesPersonId,
                    customer: customerId,
                    orderId: order._id,
                    // Auto-dispatch fields
                    dcno: autoDispatch ? dcNumber : null,
                    status: autoDispatch ? 'dispatched' : 'pending',
                    lastUpdatedBy: req.user._id || req.user.id,
                    createdBy: req.user._id || req.user.id
                };
            }
            else {
                // Create new dispatch entry with basic data
                console.log(`✨ Creating new dispatch entry for product ${productName}...`);
                // Get product details for additional info
                const productDetails = yield Inventory_js_1.Item.findById(productId).select('category unit');
                newDispatchData = {
                    productId: productId,
                    productName: productName,
                    productGroup: (productDetails === null || productDetails === void 0 ? void 0 : productDetails.category) || orderProduct.product.category || 'N/A',
                    company: req.user.companyId,
                    date: dispatchStartOfDay,
                    // Basic stock data
                    packedQuantityReadyForDispatch: 0,
                    previousClosingStockYesterdayBalance: 0,
                    returnQuantityYesterdayReturns: 0,
                    totalAvailableStock: 0,
                    totalIndentQuantityOrdersForTheDay: totalIndentQty,
                    indentQty: 0,
                    qtyIssued: indentQty,
                    dispatchedQuantitySentToday: indentQty,
                    closingStockEndOfDayBalance: 0,
                    physicalStockEntryManualVerification: 0,
                    // Order references
                    salesPerson: salesPersonId,
                    customer: customerId,
                    orderId: order._id,
                    // No packing sheet for direct orders
                    packingSheetId: null,
                    // Auto-dispatch fields
                    dcno: autoDispatch ? dcNumber : null,
                    status: autoDispatch ? 'dispatched' : 'pending',
                    lastUpdatedBy: req.user._id || req.user.id,
                    createdBy: req.user._id || req.user.id
                };
            }
            // Create and save the dispatch entry
            const dispatchEntry = new Dispatch_js_1.default(newDispatchData);
            yield dispatchEntry.save();
            dispatchEntries.push(dispatchEntry);
            console.log(`✅ Created dispatch entry for ${productName} with indent qty: ${indentQty}`);
        }
        console.log(`✅ Created ${dispatchEntries.length} dispatch entries for order ${order.orderCode}`);
        // Log auto-dispatch completion
        if (autoDispatch && dcNumber) {
            console.log(`✅ Auto-dispatch completed with DC number: ${dcNumber}`);
        }
        res.status(201).json({
            success: true,
            message: autoDispatch
                ? `Order created and dispatched successfully with DC No: ${dcNumber}`
                : 'Order created successfully from dispatch.',
            order: {
                _id: order._id,
                orderCode: order.orderCode,
                customer: order.customer,
                salesPerson: order.salesPerson,
                orderDate: order.orderDate,
                products: order.products,
                totalAmount: order.totalAmount,
                status: order.status
            },
            dispatchEntries: {
                count: dispatchEntries.length,
                entries: dispatchEntries.map(d => ({
                    _id: d._id,
                    productName: d.productName,
                    indentQty: d.indentQty,
                    status: d.status
                }))
            },
            dcNo: dcNumber,
            autoDispatched: autoDispatch && dcNumber !== null
        });
    }
    catch (error) {
        console.error('❌ Error creating direct order from dispatch:', error);
        // Handle duplicate key error for DC number
        if (error.code === 11000 && error.message.includes('dcno')) {
            return res.status(409).json({
                success: false,
                message: 'DC Number already exists. Please try again.',
                error: 'A dispatch with this DC number has already been created. The system will generate a new number on retry.'
            });
        }
        // Handle validation errors
        if (error.name === 'ValidationError') {
            const validationErrors = {};
            Object.keys(error.errors).forEach(key => {
                validationErrors[key] = error.errors[key].message;
            });
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validationErrors
            });
        }
        // Generic error
        res.status(500).json({
            success: false,
            message: 'Failed to create order and dispatch',
            error: error.message
        });
    }
});
exports.createDirectOrder = createDirectOrder;
// Get all sales persons for dispatch order creation
const getSalesPersonsForDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('👥 Fetching sales persons for dispatch');
        const query = { role: 'Sales', isActive: true };
        // Filter by company if user has companyId
        if (req.user.companyId) {
            query.companyId = req.user.companyId;
        }
        const salesPersons = yield User_js_1.default.find(query)
            .select('_id username fullName email role')
            .sort({ fullName: 1 });
        res.json({
            success: true,
            data: {
                salesPersons,
                count: salesPersons.length
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching sales persons:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sales persons',
            error: error.message
        });
    }
});
exports.getSalesPersonsForDispatch = getSalesPersonsForDispatch;
// Get customers for dispatch order creation - shows ALL customers regardless of salesperson
const getCustomersForDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('👥 Fetching all customers for dispatch (no salesperson filter)');
        const query = { isActive: true };
        // Filter by company if user has companyId
        if (req.user.companyId) {
            query.companyId = req.user.companyId;
        }
        // Show ALL customers - do NOT filter by salesPersonId
        // Sales person is only used when creating/updating the dispatch entry
        const customers = yield Customer_js_1.default.find(query)
            .select('_id name contactPerson mobile email address city state')
            .sort({ name: 1 });
        console.log('✅ Found customers:', customers.length);
        res.json({
            success: true,
            data: {
                customers,
                count: customers.length
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching customers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customers',
            error: error.message
        });
    }
});
exports.getCustomersForDispatch = getCustomersForDispatch;
// Get all products for dispatch order creation
const getProductsForDispatch = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('📦 Fetching products for dispatch order creation');
        console.log('👤 User company:', req.user.companyId);
        // COMMENTED OUT: Previous logic that filtered only dispatched products
        // Step 1: Get all unique product IDs from dispatches collection filtered by company
        // const query = {};
        // if (req.user.companyId) {
        //   query.company = req.user.companyId;
        // }
        // const allDispatches = await Dispatch.find(query).select('productId').lean();
        // console.log('📦 Total dispatch records for company:', allDispatches.length);
        // const dispatchedProductIds = [...new Set(allDispatches.map(d => d.productId?.toString()).filter(Boolean))];
        // console.log('📦 Unique dispatched product IDs:', dispatchedProductIds.length);
        // NEW LOGIC: Return ALL items for the company by default
        let products = [];
        // Always fetch all items filtered by store (company)
        console.log('✅ Fetching ALL items for company store');
        const itemQuery = {};
        if (req.user.companyId) {
            // Filter by store field which contains company ID
            itemQuery.store = req.user.companyId.toString();
            console.log('🔍 Filtering items by store (companyId):', req.user.companyId);
        }
        products = yield Inventory_js_1.Item.find(itemQuery)
            .select('_id name code category unit salePrice purchasePrice stock store batch')
            .sort({ name: 1 })
            .lean();
        console.log('📦 Found ALL items for company store:', products.length);
        // COMMENTED OUT: Previous logic for dispatched products only
        // if (dispatchedProductIds.length === 0) {
        //   // No dispatched products found - return items filtered by store (company)
        //   console.log('⚠️ No dispatched products found - fetching items by store (company)');
        //   
        //   const itemQuery = {};
        //   if (req.user.companyId) {
        //     // Filter by store field which contains company ID
        //     itemQuery.store = req.user.companyId.toString();
        //     console.log('🔍 Filtering items by store (companyId):', req.user.companyId);
        //   }
        //   
        //   products = await Item.find(itemQuery)
        //     .select('_id name code category unit salePrice purchasePrice stock store batch')
        //     .sort({ name: 1 })
        //     .lean();
        //   
        //   console.log('📦 Found items for company store:', products.length);
        // } else {
        //   // Step 2: Get those products from Item collection, filtered by store (company)
        //   const itemQuery = {
        //     _id: { $in: dispatchedProductIds }
        //   };
        //   
        //   if (req.user.companyId) {
        //     // Also filter by store to ensure items belong to this company
        //     itemQuery.store = req.user.companyId.toString();
        //     console.log('🔍 Filtering dispatched items by store (companyId):', req.user.companyId);
        //   }
        //   
        //   products = await Item.find(itemQuery)
        //     .select('_id name code category unit salePrice purchasePrice stock store batch')
        //     .sort({ name: 1 })
        //     .lean();
        //   console.log('📦 Found dispatched products for company store:', products.length);
        // }
        if (products.length > 0) {
            console.log('📦 Sample product:', products[0]);
        }
        res.json({
            success: true,
            data: {
                products: products.map(p => ({
                    _id: p._id,
                    name: p.name,
                    code: p.code,
                    category: p.category,
                    unit: p.unit,
                    price: p.salePrice,
                    salePrice: p.salePrice,
                    stock: p.stock || 0,
                    store: p.store || 'N/A',
                    batch: p.batch || null
                })),
                count: products.length
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            error: error.message
        });
    }
});
exports.getProductsForDispatch = getProductsForDispatch;
/**
 * Get today's order items for selected sales person and customer
 * GET /api/dispatches/today-order-items?salesPersonId=xxx&customerId=xxx
 */
const getTodayOrderItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { salesPersonId, customerId } = req.query;
        console.log('📦 Fetching today\'s order items');
        console.log('👤 Sales Person:', salesPersonId);
        console.log('👥 Customer:', customerId);
        // Validation
        if (!salesPersonId || !customerId) {
            return res.status(400).json({
                success: false,
                message: 'Sales Person ID and Customer ID are required'
            });
        }
        // Get today's date in YYYY-MM-DD format
        const todayString = new Date().toISOString().split('T')[0];
        // Create date range for today in UTC (since orderDate is stored as Date at 00:00:00 UTC)
        const todayStart = new Date(todayString + 'T00:00:00.000Z');
        const todayEnd = new Date(todayString + 'T23:59:59.999Z');
        console.log('📅 Today:', todayString);
        console.log('📅 Date range (UTC):', { from: todayStart, to: todayEnd });
        // Find today's orders for this sales person + customer
        const orders = yield Order_js_1.default.find({
            salesPerson: salesPersonId,
            customer: customerId,
            orderDate: {
                $gte: todayStart,
                $lte: todayEnd
            }
        })
            .populate({
            path: 'products.product',
            select: 'name code category unit batch salePrice'
        })
            .lean();
        console.log('📦 Found orders:', orders.length);
        if (orders.length === 0) {
            return res.json({
                success: true,
                data: {
                    items: [],
                    count: 0,
                    message: 'No orders found for today'
                }
            });
        }
        // Aggregate items from all orders
        const itemsMap = new Map();
        orders.forEach(order => {
            order.products.forEach(orderProduct => {
                const product = orderProduct.product;
                if (!product)
                    return;
                const productId = product._id.toString();
                if (itemsMap.has(productId)) {
                    // Add to existing item
                    const existing = itemsMap.get(productId);
                    existing.indentQty += orderProduct.quantity;
                    existing.orderValue += orderProduct.total;
                }
                else {
                    // Create new item entry
                    itemsMap.set(productId, {
                        _id: product._id,
                        name: product.name,
                        code: product.code,
                        category: product.category,
                        unit: product.unit,
                        batch: product.batch || null,
                        price: orderProduct.price,
                        indentQty: orderProduct.quantity,
                        orderValue: orderProduct.total
                    });
                }
            });
        });
        const items = Array.from(itemsMap.values());
        console.log('📦 Aggregated items:', items.length);
        items.forEach(item => {
            console.log(`   - ${item.name}: Qty=${item.indentQty}, Value=${item.orderValue}, Batch=${item.batch}`);
        });
        res.json({
            success: true,
            data: {
                items: items,
                count: items.length,
                totalOrders: orders.length,
                totalValue: items.reduce((sum, item) => sum + item.orderValue, 0)
            }
        });
    }
    catch (error) {
        console.error('❌ Error fetching today\'s order items:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch today\'s order items',
            error: error.message
        });
    }
});
exports.getTodayOrderItems = getTodayOrderItems;
