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
exports.createAutoPurchaseInvoice = exports.createQCRejectedPurchaseReturn = exports.getSuppliersForAccounts = exports.getVendorPurchasedItems = exports.getPaymentStats = exports.getPurchaseSummary = exports.updatePurchaseReturn = exports.getPurchaseReturnById = exports.getPurchaseReturns = exports.createPurchaseReturn = exports.getVendorOutstanding = exports.createVendorPayment = exports.getPurchaseInvoices = exports.createPurchaseInvoice = void 0;
const PurchaseInvoice_js_1 = __importDefault(require("../models/PurchaseInvoice.js"));
const VendorPayment_js_1 = __importDefault(require("../models/VendorPayment.js"));
const PurchaseReturn_js_1 = __importDefault(require("../models/PurchaseReturn.js"));
const Supplier_js_1 = __importDefault(require("../models/Supplier.js"));
const Inventory_js_1 = require("../models/Inventory.js");
const Account_js_1 = require("../models/Account.js");
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Create a new Purchase Invoice and auto-post to ledger
 */
const createPurchaseInvoice = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { vendorId, invoiceNo, invoiceDate, dueDate, items, subtotal, gstAmount, totalAmount, tdsAmount, tdsPercent, notes } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;
        if (!companyId || !unit) {
            throw new Error('Your account is missing mandatory Company or Unit assignment. Please contact admin.');
        }
        // 1. Check for duplicate invoice
        const existing = yield PurchaseInvoice_js_1.default.findOne({ vendor: vendorId, invoiceNo });
        if (existing) {
            throw new Error(`Duplicate invoice number "${invoiceNo}" already exists for this vendor.`);
        }
        // 2. Check if vendor is active
        const vendor = yield Supplier_js_1.default.findById(vendorId);
        if (!vendor || vendor.status === 'inactive') {
            throw new Error('Vendor is inactive or not found');
        }
        // 3. Create Invoice
        const invoice = new PurchaseInvoice_js_1.default({
            vendor: vendorId,
            invoiceNo,
            invoiceDate,
            dueDate,
            items,
            subtotal,
            gstAmount,
            totalAmount,
            tdsAmount: tdsAmount || 0,
            tdsPercent: tdsPercent || 0,
            balanceAmount: totalAmount,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        yield invoice.save();
        // 4. Auto Journal Posting
        const purchaseAccount = yield Account_js_1.Account.findOne({ accountName: 'Purchase Account', unit });
        const gstAccount = yield Account_js_1.Account.findOne({ accountName: 'Input GST', unit });
        const payableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Payable', unit });
        const tdsPayableAccount = yield Account_js_1.Account.findOne({ accountName: 'TDS Payable', unit });
        if (purchaseAccount && gstAccount && payableAccount) {
            const entries = [
                { account: purchaseAccount._id, debit: subtotal, credit: 0 },
                { account: gstAccount._id, debit: gstAmount, credit: 0 },
                { account: payableAccount._id, debit: 0, credit: totalAmount }
            ];
            if (tdsAmount > 0 && tdsPayableAccount) {
                entries.push({ account: tdsPayableAccount._id, debit: 0, credit: tdsAmount });
            }
            const txn = new Account_js_1.Transaction({
                transactionNumber: `TXN-PUR-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Purchase Invoice: ${invoiceNo} from ${vendor.supplierName}${tdsAmount > 0 ? ' (Includes TDS Payable)' : ''}`,
                reference: invoiceNo,
                totalAmount: subtotal + gstAmount,
                unit,
                relatedDocument: 'Purchase',
                relatedDocumentId: invoice._id,
                createdBy: req.user._id,
                entries
            });
            yield txn.save();
            // Update account balances
            purchaseAccount.balance += subtotal;
            gstAccount.balance += gstAmount;
            payableAccount.balance += totalAmount;
            if (tdsAmount > 0 && tdsPayableAccount) {
                tdsPayableAccount.balance += tdsAmount;
                yield tdsPayableAccount.save();
            }
            yield purchaseAccount.save();
            yield gstAccount.save();
            yield payableAccount.save();
        }
        res.status(201).json({ success: true, data: invoice });
    }
    catch (error) {
        console.error('❌ Error in createPurchaseInvoice:', error);
        res.status(400).json({ success: false, message: error.message });
    }
});
exports.createPurchaseInvoice = createPurchaseInvoice;
/**
 * Get Purchase Invoices for the company
 */
const getPurchaseInvoices = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        const query = { companyId: req.user.companyId };
        if (status && status !== 'All')
            query.status = status;
        if (search) {
            query.$or = [
                { invoiceNo: { $regex: search, $options: 'i' } }
            ];
        }
        const invoices = yield PurchaseInvoice_js_1.default.find(query)
            .populate('vendor', 'supplierName gstNumber')
            .sort({ invoiceDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        const total = yield PurchaseInvoice_js_1.default.countDocuments(query);
        res.json({
            success: true,
            data: {
                invoices,
                pagination: { total, page: parseInt(page), limit: parseInt(limit) }
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getPurchaseInvoices = getPurchaseInvoices;
/**
 * Record Vendor Payment
 */
const createVendorPayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { vendorId, paymentDate, amount, paymentMode, referenceNo, notes } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;
        // 1. Create Payment record
        const payment = new VendorPayment_js_1.default({
            vendor: vendorId,
            paymentDate,
            amount,
            paymentMode,
            referenceNo,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        yield payment.save();
        // 2. Update Invoices (FIFO logic)
        let remainingAmount = amount;
        const unpaidInvoices = yield PurchaseInvoice_js_1.default.find({
            vendor: vendorId,
            status: { $ne: 'Paid' }
        }).sort({ invoiceDate: 1 });
        for (const inv of unpaidInvoices) {
            if (remainingAmount <= 0)
                break;
            const payToThis = Math.min(inv.balanceAmount, remainingAmount);
            inv.paidAmount += payToThis;
            inv.balanceAmount -= payToThis;
            remainingAmount -= payToThis;
            yield inv.save();
        }
        // 3. Ledger Posting
        let payableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Payable', unit });
        if (!payableAccount) {
            payableAccount = new Account_js_1.Account({
                accountNumber: `AP-${unit.replace(/\s+/g, '-')}-${Date.now()}`,
                accountName: 'Accounts Payable',
                accountType: 'Liability',
                balance: 0,
                unit,
                companyId,
                description: 'Auto-generated account for vendor payables'
            });
            yield payableAccount.save();
        }
        const bankAccount = req.body.accountId
            ? yield Account_js_1.Account.findById(req.body.accountId)
            : yield Account_js_1.Account.findOne({ isBankOrCash: true, unit });
        if (!bankAccount) {
            throw new Error('Bank or Cash account not found for payment. Please create one in Bank & Cash module.');
        }
        if (bankAccount.balance < amount) {
            throw new Error(`Insufficient funds in ${bankAccount.accountName}. Available: ₹${bankAccount.balance}`);
        }
        if (payableAccount && bankAccount) {
            const txn = new Account_js_1.Transaction({
                transactionNumber: `TXN-PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Payment to Vendor - Ref: ${referenceNo || 'N/A'}`,
                totalAmount: amount,
                unit,
                mode: paymentMode,
                relatedDocument: 'Payment',
                relatedDocumentId: payment._id,
                createdBy: req.user._id,
                entries: [
                    { account: payableAccount._id, debit: amount, credit: 0 },
                    { account: bankAccount._id, debit: 0, credit: amount }
                ]
            });
            yield txn.save();
            payableAccount.balance -= amount;
            bankAccount.balance -= amount;
            yield payableAccount.save();
            yield bankAccount.save();
        }
        res.json({ success: true, data: payment });
    }
    catch (error) {
        console.error('❌ Error in createVendorPayment:', error);
        res.status(400).json({ success: false, message: error.message });
    }
});
exports.createVendorPayment = createVendorPayment;
/**
 * Get Vendor Outstanding / Payable Ageing
 */
const getVendorOutstanding = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        const { vendorId } = req.query;
        let matchQuery = {
            companyId: new mongoose_1.default.Types.ObjectId(companyId),
            balanceAmount: { $gt: 0 }
        };
        if (vendorId) {
            matchQuery.vendor = new mongoose_1.default.Types.ObjectId(vendorId);
        }
        const outstandingData = yield PurchaseInvoice_js_1.default.aggregate([
            { $match: matchQuery },
            {
                $group: {
                    _id: '$vendor',
                    totalOutstanding: { $sum: '$balanceAmount' },
                    invoiceCount: { $sum: 1 },
                    invoices: {
                        $push: {
                            _id: '$_id',
                            invoiceNo: '$invoiceNo',
                            date: '$invoiceDate',
                            totalAmount: '$totalAmount',
                            balance: '$balanceAmount',
                            dueDate: '$dueDate'
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'suppliers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'vendorInfo'
                }
            },
            { $unwind: '$vendorInfo' },
            {
                $project: {
                    vendorId: '$_id',
                    vendorName: '$vendorInfo.supplierName',
                    vendorCode: '$vendorInfo.supplierCode',
                    totalOutstanding: 1,
                    invoiceCount: 1,
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
exports.getVendorOutstanding = getVendorOutstanding;
/**
 * Create Purchase Return
 */
const createPurchaseReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { vendorId, invoiceId, returnDate, items, totalAmount, reason, bankAccountId } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;
        // 1. Create Return Record
        const pReturn = new PurchaseReturn_js_1.default({
            vendor: vendorId,
            purchaseInvoice: invoiceId || undefined,
            returnDate,
            items,
            totalAmount,
            unit,
            companyId,
            createdBy: req.user._id,
            reason
        });
        yield pReturn.save();
        // 2. Update Inventory
        for (const item of items) {
            if (item.item) {
                yield Inventory_js_1.Item.findByIdAndUpdate(item.item, {
                    $inc: { qty: -item.quantity }
                });
            }
        }
        // 3. Update Invoice Balance
        if (invoiceId) {
            const invoice = yield PurchaseInvoice_js_1.default.findById(invoiceId);
            if (invoice) {
                invoice.balanceAmount -= totalAmount;
                yield invoice.save();
            }
        }
        // 4. Ledger Posting
        let payableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Payable', unit });
        let purchaseReturnAccount = yield Account_js_1.Account.findOne({ accountName: 'Purchase Return', unit });
        if (!payableAccount) {
            payableAccount = new Account_js_1.Account({
                accountName: 'Accounts Payable',
                accountNumber: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Liability',
                unit,
                balance: 0
            });
            yield payableAccount.save();
        }
        if (!purchaseReturnAccount) {
            purchaseReturnAccount = new Account_js_1.Account({
                accountName: 'Purchase Return',
                accountNumber: `PRT-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Revenue',
                unit,
                balance: 0
            });
            yield purchaseReturnAccount.save();
        }
        if (payableAccount && purchaseReturnAccount) {
            const txn = new Account_js_1.Transaction({
                transactionNumber: `TXN-PRT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Purchase Return - Reason: ${reason}. Ref: ${invoiceId || 'Direct Return'}`,
                totalAmount,
                unit,
                relatedDocument: 'PurchaseReturn',
                relatedDocumentId: pReturn._id,
                createdBy: req.user._id,
                companyId,
                entries: [
                    { account: payableAccount._id, debit: totalAmount, credit: 0 },
                    { account: purchaseReturnAccount._id, debit: 0, credit: totalAmount }
                ]
            });
            yield txn.save();
            if (bankAccountId && bankAccountId !== 'none') {
                const bankAccount = yield Account_js_1.Account.findById(bankAccountId);
                if (bankAccount) {
                    const refundTxn = new Account_js_1.Transaction({
                        transactionNumber: `TXN-REF-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                        description: `Refund from Vendor for Return - Ref: ${pReturn._id}`,
                        totalAmount,
                        unit,
                        relatedDocument: 'Receipt',
                        relatedDocumentId: pReturn._id,
                        createdBy: req.user._id,
                        companyId,
                        entries: [
                            { account: bankAccount._id, debit: totalAmount, credit: 0 },
                            { account: payableAccount._id, debit: 0, credit: totalAmount }
                        ]
                    });
                    yield refundTxn.save();
                    bankAccount.balance += totalAmount;
                    payableAccount.balance += totalAmount;
                    yield bankAccount.save();
                }
            }
            payableAccount.balance -= totalAmount;
            purchaseReturnAccount.balance += totalAmount;
            yield payableAccount.save();
            yield purchaseReturnAccount.save();
        }
        res.status(201).json({ success: true, data: pReturn });
    }
    catch (error) {
        console.error('❌ Error in createPurchaseReturn:', error);
        res.status(400).json({ success: false, message: error.message });
    }
});
exports.createPurchaseReturn = createPurchaseReturn;
/**
 * Get Purchase Returns
 */
const getPurchaseReturns = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const query = { companyId: req.user.companyId };
        if (search) {
            query.$or = [
                { reason: { $regex: search, $options: 'i' } }
            ];
        }
        const returns = yield PurchaseReturn_js_1.default.find(query)
            .populate('vendor', 'supplierName')
            .populate('items.item', 'name code')
            .sort({ returnDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        const total = yield PurchaseReturn_js_1.default.countDocuments(query);
        res.json({
            success: true,
            data: {
                returns,
                pagination: { total, page: parseInt(page), limit: parseInt(limit) }
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getPurchaseReturns = getPurchaseReturns;
/**
 * Get single Purchase Return by ID
 */
const getPurchaseReturnById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ret = yield PurchaseReturn_js_1.default.findOne({
            _id: req.params.id,
            companyId: req.user.companyId
        })
            .populate('vendor', 'supplierName email phone gstNumber')
            .populate('items.item', 'name code');
        if (!ret)
            return res.status(404).json({ success: false, message: 'Return not found' });
        res.json({ success: true, data: ret });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getPurchaseReturnById = getPurchaseReturnById;
/**
 * Update Purchase Return (reason, items, totalAmount, returnDate)
 */
const updatePurchaseReturn = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { reason, returnDate, totalAmount, items } = req.body;
        const ret = yield PurchaseReturn_js_1.default.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!ret)
            return res.status(404).json({ success: false, message: 'Return not found' });
        if (reason !== undefined)
            ret.reason = reason;
        if (returnDate !== undefined)
            ret.returnDate = returnDate;
        if (totalAmount !== undefined)
            ret.totalAmount = totalAmount;
        if (items !== undefined)
            ret.items = items;
        yield ret.save();
        res.json({ success: true, data: ret, message: 'Return updated successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.updatePurchaseReturn = updatePurchaseReturn;
/**
 * Get Purchase Summary for Reports
 */
const getPurchaseSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const companyId = req.user.companyId;
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        // 1. Total Purchases (Lifetime) & Month Purchases
        const totalPurchasesPromise = PurchaseInvoice_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId) } },
            { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
        ]);
        const monthPurchasesPromise = PurchaseInvoice_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId), invoiceDate: { $gte: firstDayOfMonth } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        const totalReturnsPromise = PurchaseReturn_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId) } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        // 2. Vendor-wise spending (Top 5)
        const vendorSpendingPromise = PurchaseInvoice_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId) } },
            { $group: { _id: '$vendor', total: { $sum: '$totalAmount' } } },
            { $sort: { total: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: 'suppliers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'vendorInfo'
                }
            },
            { $unwind: '$vendorInfo' },
            { $project: { name: '$vendorInfo.supplierName', total: 1 } }
        ]);
        // 3. Category-wise spending
        const categorySpendingPromise = PurchaseInvoice_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId) } },
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'items',
                    localField: 'items.item',
                    foreignField: '_id',
                    as: 'itemDetail'
                }
            },
            { $unwind: '$itemDetail' },
            { $group: { _id: '$itemDetail.category', total: { $sum: '$items.totalPrice' } } },
            { $sort: { total: -1 } }
        ]);
        // 4. Monthly Trend (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        const monthlyTrendPromise = PurchaseInvoice_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId), invoiceDate: { $gte: sixMonthsAgo } } },
            {
                $group: {
                    _id: { month: { $month: '$invoiceDate' }, year: { $year: '$invoiceDate' } },
                    amount: { $sum: '$totalAmount' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);
        const [totalPurchases, monthPurchases, totalReturns, vendorSpending, categorySpending, monthlyTrend] = yield Promise.all([
            totalPurchasesPromise,
            monthPurchasesPromise,
            totalReturnsPromise,
            vendorSpendingPromise,
            categorySpendingPromise,
            monthlyTrendPromise
        ]);
        res.json({
            success: true,
            data: {
                totalPurchases: ((_a = totalPurchases[0]) === null || _a === void 0 ? void 0 : _a.total) || 0,
                purchaseCount: ((_b = totalPurchases[0]) === null || _b === void 0 ? void 0 : _b.count) || 0,
                monthPurchases: ((_c = monthPurchases[0]) === null || _c === void 0 ? void 0 : _c.total) || 0,
                totalReturns: ((_d = totalReturns[0]) === null || _d === void 0 ? void 0 : _d.total) || 0,
                vendorSpending,
                categorySpending,
                monthlyTrend
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getPurchaseSummary = getPurchaseSummary;
/**
 * Get Vendor Payment Statistics (Monthly Total & Modes Breakdown)
 */
const getPaymentStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const companyId = req.user.companyId;
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const stats = yield VendorPayment_js_1.default.aggregate([
            {
                $match: {
                    companyId: new mongoose_1.default.Types.ObjectId(companyId),
                    paymentDate: { $gte: startOfMonth }
                }
            },
            {
                $facet: {
                    totalPaid: [
                        { $group: { _id: null, total: { $sum: '$amount' } } }
                    ],
                    modesBreakdown: [
                        { $group: { _id: '$paymentMode', count: { $sum: 1 }, total: { $sum: '$amount' } } },
                        { $sort: { total: -1 } }
                    ]
                }
            }
        ]);
        const totalPaid = ((_b = (_a = stats[0]) === null || _a === void 0 ? void 0 : _a.totalPaid[0]) === null || _b === void 0 ? void 0 : _b.total) || 0;
        const modes = ((_c = stats[0]) === null || _c === void 0 ? void 0 : _c.modesBreakdown) || [];
        // Calculate percentages
        const modesWithPercentage = modes.map(m => (Object.assign(Object.assign({}, m), { percentage: totalPaid > 0 ? Math.round((m.total / totalPaid) * 100) : 0 })));
        res.json({
            success: true,
            data: {
                totalPaid,
                modes: modesWithPercentage
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getPaymentStats = getPaymentStats;
/**
 * Get items purchased from a specific vendor
 */
const getVendorPurchasedItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { vendorId } = req.query;
        const unit = req.user.unit;
        const companyId = req.user.companyId;
        if (!vendorId) {
            return res.status(400).json({ success: false, message: 'Vendor ID is required' });
        }
        const items = yield PurchaseInvoice_js_1.default.aggregate([
            {
                $match: {
                    vendor: new mongoose_1.default.Types.ObjectId(vendorId),
                    unit: unit,
                    companyId: new mongoose_1.default.Types.ObjectId(companyId)
                }
            },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.item',
                    itemName: { $first: '$items.itemName' },
                    lastUnitPrice: { $last: '$items.unitPrice' }
                }
            },
            { $sort: { itemName: 1 } }
        ]);
        res.json({ success: true, data: items });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getVendorPurchasedItems = getVendorPurchasedItems;
/**
 * For Dropdown: Get all active suppliers for the unit
 */
const getSuppliersForAccounts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const unit = req.user.unit;
        // Allow suppliers from specific unit OR 'Main' unit (common suppliers)
        const suppliers = yield Supplier_js_1.default.find({
            unit: { $in: [unit, 'Main'] },
            status: 'active'
        }).sort({ supplierName: 1 });
        res.json({ success: true, data: suppliers });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getSuppliersForAccounts = getSuppliersForAccounts;
/**
 * Auto-creates a Purchase Return when a purchased product fails QC inspection.
 */
const createQCRejectedPurchaseReturn = (qcJob, user) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = qcJob.company;
        const unit = user.unit || 'Main';
        // 1. Find Supplier/Vendor
        const Purchase = mongoose_1.default.model('Purchase');
        const PurchaseRequest = mongoose_1.default.model('PurchaseRequest');
        let supplierId = null;
        let po = null;
        // Search by sourceRefId in Purchase
        if (qcJob.sourceRefId) {
            po = yield Purchase.findOne({ purchaseOrderNumber: qcJob.sourceRefId }).populate('supplier');
        }
        // If not found, search by itemCode/requestId in PurchaseRequest
        if (!po) {
            const pr = yield PurchaseRequest.findOne({
                $or: [
                    { requestId: qcJob.sourceRefId },
                    { requestId: qcJob.itemCode }
                ]
            }).populate({
                path: 'purchaseOrder',
                populate: { path: 'supplier' }
            });
            if (pr && pr.purchaseOrder) {
                po = pr.purchaseOrder;
            }
        }
        if (po && po.supplier) {
            supplierId = po.supplier._id || po.supplier;
        }
        else {
            // Fallback: get the first active supplier for the unit
            const Supplier = mongoose_1.default.model('Supplier');
            const fallbackSupplier = yield Supplier.findOne({ status: 'active' });
            if (fallbackSupplier) {
                supplierId = fallbackSupplier._id;
            }
        }
        if (!supplierId) {
            console.error('❌ [QC Rejection Return] Could not find vendor/supplier for return.');
            return null;
        }
        // 2. Find Item from inventory
        let inventoryItem = null;
        // Attempt 1: Search by ObjectId
        if (qcJob.itemCode && /^[0-9a-fA-F]{24}$/.test(qcJob.itemCode)) {
            inventoryItem = yield Inventory_js_1.Item.findById(qcJob.itemCode);
        }
        // Attempt 2: Search by Code
        if (!inventoryItem && qcJob.itemCode) {
            inventoryItem = yield Inventory_js_1.Item.findOne({
                code: qcJob.itemCode,
                companyId: companyId
            });
        }
        // Attempt 3: Search by Name
        if (!inventoryItem && qcJob.itemName) {
            inventoryItem = yield Inventory_js_1.Item.findOne({
                name: qcJob.itemName,
                companyId: companyId
            });
        }
        // 3. Price calculation
        let unitPrice = 0;
        if (po && po.items) {
            const poItem = po.items.find(i => i.itemName.toLowerCase() === qcJob.itemName.toLowerCase() ||
                (inventoryItem && String(i.item) === String(inventoryItem._id)));
            if (poItem) {
                unitPrice = poItem.unitPrice;
            }
        }
        if (unitPrice === 0 && inventoryItem) {
            unitPrice = inventoryItem.purchaseCost || inventoryItem.stdCost || 100;
        }
        else if (unitPrice === 0) {
            unitPrice = 100;
        }
        const totalPrice = unitPrice * (qcJob.quantity || 1);
        // 4. Find linked PurchaseInvoice if exists
        let invoiceId = undefined;
        const PurchaseInvoiceModel = mongoose_1.default.model('PurchaseInvoice');
        if (supplierId) {
            const invoice = yield PurchaseInvoiceModel.findOne({
                vendor: supplierId,
                companyId: companyId,
                $or: [
                    { invoiceNo: qcJob.sourceRefId },
                    { notes: new RegExp(qcJob.sourceRefId, 'i') }
                ]
            });
            if (invoice) {
                invoiceId = invoice._id;
                invoice.balanceAmount = Math.max(0, invoice.balanceAmount - totalPrice);
                yield invoice.save();
            }
        }
        // 5. Create Return record
        const items = [{
                item: inventoryItem ? inventoryItem._id : new mongoose_1.default.Types.ObjectId(),
                itemName: qcJob.itemName,
                quantity: qcJob.quantity || 1,
                unitPrice: unitPrice,
                gstPercent: 18,
                gstAmount: Math.round(totalPrice * 0.18),
                totalPrice: totalPrice
            }];
        const pReturn = new PurchaseReturn_js_1.default({
            vendor: supplierId,
            purchaseInvoice: invoiceId,
            returnDate: new Date(),
            items,
            subtotal: totalPrice,
            gstAmount: Math.round(totalPrice * 0.18),
            totalAmount: totalPrice,
            unit: qcJob.unit || 'pcs',
            companyId,
            createdBy: user._id,
            reason: qcJob.failReason || `QC Rejected: Fail QC Inspection Job ${qcJob.qcJobId}`
        });
        yield pReturn.save();
        console.log(`✅ [QC Rejection Return] Recorded Purchase Return successfully for ${qcJob.itemName}`);
        // 6. Ledger Posting
        let payableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Payable', unit });
        let purchaseReturnAccount = yield Account_js_1.Account.findOne({ accountName: 'Purchase Return', unit });
        if (!payableAccount) {
            payableAccount = new Account_js_1.Account({
                accountName: 'Accounts Payable',
                accountNumber: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Liability',
                unit,
                companyId,
                balance: 0
            });
            yield payableAccount.save();
        }
        if (!purchaseReturnAccount) {
            purchaseReturnAccount = new Account_js_1.Account({
                accountName: 'Purchase Return',
                accountNumber: `PRT-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Revenue',
                unit,
                companyId,
                balance: 0
            });
            yield purchaseReturnAccount.save();
        }
        if (payableAccount && purchaseReturnAccount) {
            const txn = new Account_js_1.Transaction({
                transactionNumber: `TXN-PRT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `QC Auto Return - Reason: ${pReturn.reason}`,
                totalAmount: totalPrice,
                unit,
                relatedDocument: 'PurchaseReturn',
                relatedDocumentId: pReturn._id,
                createdBy: user._id,
                companyId,
                entries: [
                    { account: payableAccount._id, debit: totalPrice, credit: 0 },
                    { account: purchaseReturnAccount._id, debit: 0, credit: totalPrice }
                ]
            });
            yield txn.save();
            payableAccount.balance -= totalPrice;
            purchaseReturnAccount.balance += totalPrice;
            yield payableAccount.save();
            yield purchaseReturnAccount.save();
            console.log(`✅ [QC Rejection Return] Posted transaction to ledger successfully`);
        }
        return pReturn;
    }
    catch (error) {
        console.error('❌ Error creating QC-rejected purchase return:', error);
        throw error;
    }
});
exports.createQCRejectedPurchaseReturn = createQCRejectedPurchaseReturn;
/**
 * Auto-creates a Purchase Invoice when a purchase request is received.
 */
const createAutoPurchaseInvoice = (purchaseRequest, user) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const companyId = purchaseRequest.companyId;
        const unit = user.unit || 'Main';
        // 1. Populate purchase order if not populated
        const PurchaseRequestModel = mongoose_1.default.model('PurchaseRequest');
        let request = purchaseRequest;
        request = yield PurchaseRequestModel.findById(purchaseRequest._id).populate({
            path: 'purchaseOrder',
            populate: { path: 'supplier' }
        });
        if (!request) {
            console.error('❌ [Auto Invoice] Purchase Request not found.');
            return null;
        }
        // 2. Determine vendor/supplier
        let vendorId = null;
        if (request.purchaseOrder && request.purchaseOrder.supplier) {
            vendorId = request.purchaseOrder.supplier._id || request.purchaseOrder.supplier;
        }
        else {
            // Fallback: search for active supplier
            const Supplier = mongoose_1.default.model('Supplier');
            const fallbackSupplier = yield Supplier.findOne({ status: 'active' });
            if (fallbackSupplier) {
                vendorId = fallbackSupplier._id;
            }
        }
        if (!vendorId) {
            console.error('❌ [Auto Invoice] Could not identify vendor/supplier for invoice.');
            return null;
        }
        // 3. Generate invoice number
        const poNumber = ((_a = request.purchaseOrder) === null || _a === void 0 ? void 0 : _a.purchaseOrderNumber) || request.requestId;
        const invoiceNo = `INV-PO-${poNumber}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        // 4. Duplicate invoice check
        const existing = yield PurchaseInvoice_js_1.default.findOne({ vendor: vendorId, invoiceNo });
        if (existing) {
            console.log(`⚠️ [Auto Invoice] Invoice ${invoiceNo} already exists.`);
            return existing;
        }
        // 5. Gather items
        let items = [];
        let subtotal = 0;
        if (request.purchaseOrder && request.purchaseOrder.items && request.purchaseOrder.items.length > 0) {
            // Copy items from Purchase Order
            items = request.purchaseOrder.items.map(item => {
                const itemTotal = (item.quantity || 1) * (item.unitPrice || 100);
                subtotal += itemTotal;
                return {
                    item: item.item,
                    itemName: item.itemName,
                    quantity: item.quantity || 1,
                    unitPrice: item.unitPrice || 100,
                    totalPrice: itemTotal
                };
            });
        }
        else {
            // Build single item from request
            const itemTotal = (request.quantity || 1) * 100;
            subtotal += itemTotal;
            items = [{
                    item: request.itemId && /^[0-9a-fA-F]{24}$/.test(request.itemId)
                        ? new mongoose_1.default.Types.ObjectId(request.itemId)
                        : new mongoose_1.default.Types.ObjectId(),
                    itemName: request.productName,
                    quantity: request.quantity || 1,
                    unitPrice: 100,
                    totalPrice: itemTotal
                }];
        }
        const gstAmount = Math.round(subtotal * 0.18);
        const totalAmount = subtotal + gstAmount;
        // 6. Create Invoice
        const invoice = new PurchaseInvoice_js_1.default({
            vendor: vendorId,
            invoiceNo,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Net 30 default
            items,
            subtotal,
            gstAmount,
            totalAmount,
            balanceAmount: totalAmount,
            unit,
            companyId,
            createdBy: user._id,
            notes: `Automatically generated on receipt of Store Purchase Requisition: ${request.requestId}`
        });
        yield invoice.save();
        console.log(`✅ [Auto Invoice] Purchase Invoice ${invoiceNo} recorded successfully.`);
        // 7. Auto Journal Posting to General Ledger
        const purchaseAccount = yield Account_js_1.Account.findOne({ accountName: 'Purchase Account', unit });
        const gstAccount = yield Account_js_1.Account.findOne({ accountName: 'Input GST', unit });
        const payableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Payable', unit });
        if (purchaseAccount && gstAccount && payableAccount) {
            const entries = [
                { account: purchaseAccount._id, debit: subtotal, credit: 0 },
                { account: gstAccount._id, debit: gstAmount, credit: 0 },
                { account: payableAccount._id, debit: 0, credit: totalAmount }
            ];
            const txn = new Account_js_1.Transaction({
                transactionNumber: `TXN-PUR-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Auto Invoice: ${invoiceNo} for Purchase Request ${request.requestId}`,
                reference: invoiceNo,
                totalAmount: subtotal + gstAmount,
                unit,
                relatedDocument: 'Purchase',
                relatedDocumentId: invoice._id,
                createdBy: user._id,
                companyId,
                entries
            });
            yield txn.save();
            // Update account balances
            purchaseAccount.balance += subtotal;
            gstAccount.balance += gstAmount;
            payableAccount.balance += totalAmount;
            yield purchaseAccount.save();
            yield gstAccount.save();
            yield payableAccount.save();
            console.log(`✅ [Auto Invoice] Posted transaction to ledger successfully`);
        }
        return invoice;
    }
    catch (error) {
        console.error('❌ Error creating auto purchase invoice:', error);
        throw error;
    }
});
exports.createAutoPurchaseInvoice = createAutoPurchaseInvoice;
