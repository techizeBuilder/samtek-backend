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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadInvoicePDF = exports.getSalesItems = exports.getSalesSummary = exports.getReceivableAgeing = exports.rejectOrderAccount = exports.approveOrderAccount = exports.getPendingAccountOrders = exports.getSalesInvoices = exports.createSalesInvoice = void 0;
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const Account_js_1 = require("../models/Account.js");
const mongoose_1 = __importDefault(require("mongoose"));
const invoicePdf_js_1 = require("../utils/invoicePdf.js");
const Company_js_1 = require("../models/Company.js");
/**
 * Create a new Sales Invoice and auto-post to ledger
 */
const createSalesInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { customerId, invoiceNo, saleDate, dueDate, items, subtotal, taxAmount, totalAmount, tdsAmount, tdsPercent, gstType, notes, invoiceType, orderId } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;
        if (!companyId || !unit) {
            throw new Error('Company or Unit assignment missing.');
        }
        // 1. Logic for Order-linked Invoices (Dual Billing Support)
        let finalInvoiceNo = invoiceNo;
        if (orderId) {
            const existingInvoices = yield Sale_js_1.default.find({ order: orderId, companyId });
            // Check if this specific type already exists
            const sameType = existingInvoices.find(inv => inv.invoiceType === (invoiceType || 'Pakka'));
            if (sameType) {
                throw new Error(`${invoiceType || 'Pakka'} bill is already generated for this order.`);
            }
            // If any invoice exists for this order, reuse its number
            if (existingInvoices.length > 0) {
                finalInvoiceNo = existingInvoices[0].invoiceNumber;
            }
        }
        // 2. Global Duplicate check (if not reusing from order)
        if (finalInvoiceNo && !orderId) {
            const globalExisting = yield Sale_js_1.default.findOne({ invoiceNumber: finalInvoiceNo, companyId });
            if (globalExisting) {
                throw new Error(`Invoice number "${finalInvoiceNo}" already exists.`);
            }
        }
        // 2. Check if customer is active
        const customer = yield Customer_js_1.default.findById(customerId);
        if (!customer || customer.active === 'No') {
            throw new Error('Customer is inactive or not found');
        }
        // Determine actual tax and total based on invoiceType
        const isKachha = invoiceType === 'Kachha';
        const finalTaxAmount = isKachha ? 0 : taxAmount;
        const finalTotalAmount = isKachha ? subtotal : totalAmount;
        // 3a. Fetch advanced payment for linked lead (if order has leadId)
        let advancedPaymentAmount = 0;
        if (orderId) {
            const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
            const LeadPayment = (yield Promise.resolve().then(() => __importStar(require('../models/LeadPayment.js')))).default;
            const linkedOrder = yield Order.findById(orderId).select('leadId').lean();
            if (linkedOrder === null || linkedOrder === void 0 ? void 0 : linkedOrder.leadId) {
                const leadPayments = yield LeadPayment.find({
                    leadId: linkedOrder.leadId,
                    status: 'Verified',
                    companyId
                }).select('amount').lean();
                advancedPaymentAmount = leadPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
            }
        }
        // Net payable after deducting advanced payment
        const netPayable = Math.max(0, finalTotalAmount - advancedPaymentAmount);
        // 3. Create Sale Record
        const sale = new Sale_js_1.default({
            invoiceNumber: finalInvoiceNo, // If null, pre-save hook will generate
            order: orderId,
            customer: customerId,
            saleDate: saleDate || new Date(),
            dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            items: items.map(item => ({
                productName: item.productName || item.itemName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                tax: isKachha ? 0 : (item.gstPercent || item.tax || 0)
            })),
            subtotal,
            taxAmount: finalTaxAmount,
            totalAmount: finalTotalAmount,
            tdsAmount: tdsAmount || 0,
            tdsPercent: tdsPercent || 0,
            gstType: gstType || 'CGST_SGST',
            invoiceType: invoiceType || 'Pakka',
            advancedPaymentAmount,
            paidAmount: advancedPaymentAmount, // advanced already paid
            balanceAmount: netPayable,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        yield sale.save();
        // If it's linked to an order, update order status
        if (orderId) {
            const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
            yield Order.findByIdAndUpdate(orderId, {
                status: 'completed',
                $push: {
                    statusHistory: {
                        status: 'completed',
                        updatedBy: req.user._id,
                        updatedAt: new Date(),
                        remarks: `Invoiced as ${invoiceType} Bill (Invoice: ${invoiceNo})`
                    }
                }
            });
        }
        // 4. Auto Journal Posting
        // Debit Accounts Receivable (totalAmount)
        // Credit Sales Account (subtotal)
        // Credit Output GST (taxAmount)
        const receivableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Receivable', unit });
        const salesAccount = yield Account_js_1.Account.findOne({ accountName: 'Sales Account', unit });
        const gstAccount = yield Account_js_1.Account.findOne({ accountName: 'Output GST', unit });
        const tdsReceivableAccount = yield Account_js_1.Account.findOne({ accountName: 'TDS Receivable', unit });
        if (receivableAccount && salesAccount && gstAccount) {
            const entries = [
                { account: receivableAccount._id, debit: finalTotalAmount, credit: 0 },
                { account: salesAccount._id, debit: 0, credit: subtotal },
                { account: gstAccount._id, debit: 0, credit: finalTaxAmount }
            ];
            // Add TDS entry if applicable
            if (tdsAmount > 0 && tdsReceivableAccount) {
                entries.push({ account: tdsReceivableAccount._id, debit: tdsAmount, credit: 0 });
            }
            const txn = new Account_js_1.Transaction({
                transactionNumber: `TXN-SLE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `${invoiceType || 'Sales'} Invoice: ${sale.invoiceNumber} to ${customer.name}${tdsAmount > 0 ? ' (Includes TDS Deduction)' : ''}`,
                reference: sale.invoiceNumber,
                totalAmount: subtotal + finalTaxAmount,
                unit,
                relatedDocument: 'Sale',
                relatedDocumentId: sale._id,
                createdBy: req.user._id,
                entries
            });
            yield txn.save();
            // Update account balances
            receivableAccount.balance += finalTotalAmount;
            salesAccount.balance += subtotal;
            gstAccount.balance += finalTaxAmount;
            if (tdsAmount > 0 && tdsReceivableAccount) {
                tdsReceivableAccount.balance += tdsAmount;
                yield tdsReceivableAccount.save();
            }
            yield receivableAccount.save();
            yield salesAccount.save();
            yield gstAccount.save();
        }
        // 5. Update Inventory (Reduction)
        for (const item of items) {
            if (item.item) { // item._id from Inventory
                yield Inventory_js_1.Item.findByIdAndUpdate(item.item, {
                    $inc: { qty: -Number(item.quantity) }
                });
            }
        }
        // 6. Update Customer Outstanding Amount (net of advanced payment)
        yield Customer_js_1.default.findByIdAndUpdate(customerId, {
            $inc: {
                outstandingAmount: netPayable,
                // Deduct from advancePayment balance if advanced was used
                advancePayment: -advancedPaymentAmount
            }
        });
        res.status(201).json({ success: true, data: sale });
    }
    catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});
exports.createSalesInvoice = createSalesInvoice;
/**
 * Get Sales Invoices for the company
 */
const getSalesInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 20, status, search, type } = req.query;
        const query = { companyId: req.user.companyId };
        if (status && status !== 'All')
            query.paymentStatus = status;
        if (type)
            query.invoiceType = type;
        if (search) {
            query.$or = [
                { invoiceNumber: { $regex: search, $options: 'i' } }
            ];
        }
        const invoices = yield Sale_js_1.default.find(query)
            .populate('customer', 'name mobile email gstin address1 city state pin contactPerson')
            .populate('companyId', 'name unitName address city state locationPin email mobile gst')
            .sort({ saleDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        const total = yield Sale_js_1.default.countDocuments(query);
        // Fetch approved orders that are NOT yet invoiced
        const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
        const invoicedOrderIds = yield Sale_js_1.default.find({ companyId: req.user.companyId }).distinct('order');
        const pendingOrdersQuery = {
            companyId: req.user.companyId,
            status: 'approved',
            'accountApproval.status': 'approved',
            _id: { $nin: invoicedOrderIds }
        };
        const pendingOrders = yield Order.find(pendingOrdersQuery)
            .populate('customer', 'name mobile email gstin address1 city state pin contactPerson')
            .populate('products.product', 'name price brand unit')
            .sort({ orderDate: -1 });
        res.json({
            success: true,
            data: {
                invoices,
                pendingOrders,
                pagination: { total, page: parseInt(page), limit: parseInt(limit) }
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getSalesInvoices = getSalesInvoices;
// Fetch orders approved by Salesman (for Account Head approval and invoicing)
const getPendingAccountOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
        const Sale = (yield Promise.resolve().then(() => __importStar(require('../models/Sale.js')))).default;
        const LeadPayment = (yield Promise.resolve().then(() => __importStar(require('../models/LeadPayment.js')))).default;
        const query = {
            companyId: req.user.companyId,
            status: { $in: ['approved', 'completed'] }
        };
        const orders = yield Order.find(query)
            .populate('customer', 'name mobile email gstin address1 city state pin contactPerson customerCode')
            .populate('products.product', 'name price brand unit')
            .sort({ orderDate: -1 })
            .lean();
        // Enrich with invoicing status + advanced payment from linked lead
        const ordersWithInvoices = yield Promise.all(orders.map((order) => __awaiter(void 0, void 0, void 0, function* () {
            const invoices = yield Sale.find({ order: order._id }).select('invoiceType');
            // Fetch verified advanced payments for the linked lead (if any)
            let advancedPaymentAmount = 0;
            let advancedPayments = [];
            if (order.leadId) {
                const leadPayments = yield LeadPayment.find({
                    leadId: order.leadId,
                    status: 'Verified',
                    companyId: req.user.companyId
                }).select('amount paymentDate paymentMethod transactionId leadCode').lean();
                advancedPayments = leadPayments;
                advancedPaymentAmount = leadPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
            }
            return Object.assign(Object.assign({}, order), { generatedInvoices: invoices.map(inv => inv.invoiceType), advancedPaymentAmount,
                advancedPayments });
        })));
        res.json({ success: true, data: ordersWithInvoices });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getPendingAccountOrders = getPendingAccountOrders;
// Approve Order by Account Head
const approveOrderAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { orderId, remarks } = req.body;
        const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
        const order = yield Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        order.accountApproval = {
            status: 'approved',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            remarks: remarks || 'Approved by Account Head'
        };
        yield order.save();
        res.json({ success: true, message: 'Order approved by Account Head' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.approveOrderAccount = approveOrderAccount;
// Reject Order by Account Head
const rejectOrderAccount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { orderId, remarks } = req.body;
        const Order = (yield Promise.resolve().then(() => __importStar(require('../models/Order.js')))).default;
        const order = yield Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        order.status = 'rejected';
        order.accountApproval = {
            status: 'rejected',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            remarks: remarks || 'Rejected by Account Head'
        };
        // Add to status history
        order.statusHistory.push({
            status: 'rejected',
            updatedBy: req.user._id,
            updatedAt: new Date(),
            remarks: remarks || 'Rejected by Account Head'
        });
        yield order.save();
        res.json({ success: true, message: 'Order rejected by Account Head' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.rejectOrderAccount = rejectOrderAccount;
/**
 * Get Customer Outstanding / Receivable Ageing
 */
const getReceivableAgeing = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        const { customerId } = req.query;
        let matchQuery = {
            companyId: new mongoose_1.default.Types.ObjectId(companyId),
            balanceAmount: { $gt: 0 }
        };
        if (customerId) {
            matchQuery.customer = new mongoose_1.default.Types.ObjectId(customerId);
        }
        const today = new Date();
        const outstandingData = yield Sale_js_1.default.aggregate([
            { $match: matchQuery },
            {
                $project: {
                    customer: 1,
                    balanceAmount: 1,
                    invoiceNumber: 1,
                    saleDate: 1,
                    totalAmount: 1,
                    dueDate: 1,
                    ageDays: {
                        $floor: {
                            $divide: [
                                { $subtract: [today, '$saleDate'] },
                                1000 * 60 * 60 * 24
                            ]
                        }
                    }
                }
            },
            {
                $group: {
                    _id: '$customer',
                    totalOutstanding: { $sum: '$balanceAmount' },
                    invoiceCount: { $sum: 1 },
                    slab0_30: {
                        $sum: { $cond: [{ $lte: ['$ageDays', 30] }, '$balanceAmount', 0] }
                    },
                    slab31_60: {
                        $sum: { $cond: [{ $and: [{ $gt: ['$ageDays', 30] }, { $lte: ['$ageDays', 60] }] }, '$balanceAmount', 0] }
                    },
                    slab61_plus: {
                        $sum: { $cond: [{ $gt: ['$ageDays', 60] }, '$balanceAmount', 0] }
                    },
                    invoices: {
                        $push: {
                            _id: '$_id',
                            invoiceNo: '$invoiceNumber',
                            date: '$saleDate',
                            totalAmount: '$totalAmount',
                            balance: '$balanceAmount',
                            dueDate: '$dueDate',
                            age: '$ageDays'
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'customers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'customerInfo'
                }
            },
            { $unwind: '$customerInfo' },
            {
                $project: {
                    customerId: '$_id',
                    customerName: '$customerInfo.name',
                    customerCode: '$customerInfo.customerCode',
                    customerMobile: '$customerInfo.mobile',
                    customerEmail: '$customerInfo.email',
                    totalOutstanding: 1,
                    invoiceCount: 1,
                    slab0_30: 1,
                    slab31_60: 1,
                    slab61_plus: 1,
                    invoices: 1
                }
            },
            { $sort: { totalOutstanding: -1 } }
        ]);
        res.json({ success: true, data: outstandingData });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getReceivableAgeing = getReceivableAgeing;
/**
 * Get Sales Summary for Reports
 */
const getSalesSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const companyId = req.user.companyId;
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        // 1. Total Sales (Lifetime) & Month Sales
        const totalSalesPromise = Sale_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId) } },
            { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
        ]);
        const monthSalesPromise = Sale_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId), saleDate: { $gte: firstDayOfMonth } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        // 2. Customer-wise Sales (Top 5)
        const customerSalesPromise = Sale_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId) } },
            { $group: { _id: '$customer', total: { $sum: '$totalAmount' } } },
            { $sort: { total: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: 'customers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'customerInfo'
                }
            },
            { $unwind: '$customerInfo' },
            { $project: { name: '$customerInfo.name', total: 1 } }
        ]);
        // 3. Monthly Trend (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        const monthlyTrendPromise = Sale_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId), saleDate: { $gte: sixMonthsAgo } } },
            {
                $group: {
                    _id: { month: { $month: '$saleDate' }, year: { $year: '$saleDate' } },
                    amount: { $sum: '$totalAmount' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);
        const [totalSales, monthSales, customerSales, monthlyTrend] = yield Promise.all([
            totalSalesPromise,
            monthSalesPromise,
            customerSalesPromise,
            monthlyTrendPromise
        ]);
        res.json({
            success: true,
            data: {
                totalSales: ((_a = totalSales[0]) === null || _a === void 0 ? void 0 : _a.total) || 0,
                saleCount: ((_b = totalSales[0]) === null || _b === void 0 ? void 0 : _b.count) || 0,
                monthSales: ((_c = monthSales[0]) === null || _c === void 0 ? void 0 : _c.total) || 0,
                customerSales,
                monthlyTrend
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getSalesSummary = getSalesSummary;
/**
 * Get Items for Sales (Finished Goods/Products)
 */
const getSalesItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search = '', skip = 0, limit = 50 } = req.query;
        const companyId = req.user.companyId;
        let filter = {
            store: companyId.toString(),
            type: { $in: ['Product', 'Assemblies'] } // Items sellable to customers
        };
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { code: { $regex: search, $options: 'i' } }
            ];
        }
        const [items, total] = yield Promise.all([
            Inventory_js_1.Item.find(filter)
                .select('_id name code category type qty unit stdCost mrp salePrice hsn gst store')
                .skip(parseInt(skip))
                .limit(parseInt(limit))
                .sort({ name: 1 })
                .lean(),
            Inventory_js_1.Item.countDocuments(filter)
        ]);
        res.json({
            success: true,
            data: {
                items,
                pagination: { total, skip: parseInt(skip), limit: parseInt(limit) }
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getSalesItems = getSalesItems;
/**
 * Download Invoice as PDF
 */
const downloadInvoicePDF = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;
        const [invoice, company] = yield Promise.all([
            Sale_js_1.default.findById(id).populate('customer').lean(),
            Company_js_1.Company.findById(companyId).lean()
        ]);
        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }
        const invoiceData = {
            company: {
                name: (company === null || company === void 0 ? void 0 : company.name) || (company === null || company === void 0 ? void 0 : company.unitName),
                address: company === null || company === void 0 ? void 0 : company.address,
                gst: company === null || company === void 0 ? void 0 : company.gst,
                mobile: company === null || company === void 0 ? void 0 : company.mobile,
                email: company === null || company === void 0 ? void 0 : company.email
            },
            customer: {
                name: (_a = invoice.customer) === null || _a === void 0 ? void 0 : _a.name,
                address1: (_b = invoice.customer) === null || _b === void 0 ? void 0 : _b.address1,
                city: (_c = invoice.customer) === null || _c === void 0 ? void 0 : _c.city,
                state: (_d = invoice.customer) === null || _d === void 0 ? void 0 : _d.state,
                pin: (_e = invoice.customer) === null || _e === void 0 ? void 0 : _e.pin,
                gstin: (_f = invoice.customer) === null || _f === void 0 ? void 0 : _f.gstin,
                contactPerson: (_g = invoice.customer) === null || _g === void 0 ? void 0 : _g.contactPerson
            },
            invoiceNo: invoice.invoiceNumber,
            date: new Date(invoice.saleDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            notes: invoice.notes,
            advancedPaymentAmount: invoice.advancedPaymentAmount || 0,
            items: invoice.items.map(item => ({
                productName: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                hsn: item.hsn || '',
                gst: item.tax || 0
            })),
            isInterState: invoice.gstType === 'IGST'
        };
        yield (0, invoicePdf_js_1.generateStandardizedInvoicePDF)(res, invoiceData);
    }
    catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.downloadInvoicePDF = downloadInvoicePDF;
