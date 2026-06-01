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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postCommissionToLedger = exports.calculateCommission = exports.getSalesmanLedger = exports.createDailySettlement = exports.getSalesmanDailyStats = void 0;
const SalesmanDailySettlement_js_1 = __importDefault(require("../models/SalesmanDailySettlement.js"));
const SalesmanLedger_js_1 = __importDefault(require("../models/SalesmanLedger.js"));
const Order_js_1 = __importDefault(require("../models/Order.js"));
const Return_js_1 = __importDefault(require("../models/Return.js"));
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
const Account_js_1 = require("../models/Account.js");
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * Get daily statistics for a salesman to perform settlement
 */
const getSalesmanDailyStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { salesmanId, date } = req.query;
        const companyId = req.user.companyId;
        if (!salesmanId || !date) {
            return res.status(400).json({ success: false, message: 'Salesman ID and Date are required' });
        }
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        // 1. Fetch Orders (Sales)
        const orders = yield Order_js_1.default.find({
            salesPerson: salesmanId,
            companyId: companyId,
            orderDate: { $gte: startOfDay, $lte: endOfDay }
        }).populate('customer', 'name');
        const totalInvoiceSale = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const cashSale = orders.filter(o => o.paymentMethod === 'Cash' || o.paymentMethod === 'Other').reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const creditSale = totalInvoiceSale - cashSale;
        // 2. Fetch Returns
        const customers = yield Customer_js_1.default.find({ salesContact: salesmanId, companyId: companyId });
        const customerIds = customers.map(c => c._id);
        const returns = yield Return_js_1.default.find({
            $or: [
                { salesPerson: salesmanId },
                { customerId: { $in: customerIds } }
            ],
            companyId: companyId,
            returnDate: { $gte: startOfDay, $lte: endOfDay },
            status: 'approved'
        }).populate('customerId', 'name');
        const totalReturn = returns.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
        // 3. Expected Cash Logic
        const netSale = totalInvoiceSale - totalReturn;
        const expectedCash = netSale - creditSale;
        res.json({
            success: true,
            data: {
                totalInvoiceSale,
                totalReturn,
                cashSale,
                creditSale,
                netSale,
                expectedCash: expectedCash < 0 ? 0 : expectedCash,
                orders: orders.map(o => {
                    var _a;
                    return ({
                        _id: o._id,
                        orderCode: o.orderCode,
                        customerName: ((_a = o.customer) === null || _a === void 0 ? void 0 : _a.name) || 'N/A',
                        totalAmount: o.totalAmount,
                        paymentMethod: o.paymentMethod
                    });
                }),
                returns: returns.map(r => {
                    var _a;
                    return ({
                        _id: r._id,
                        returnNumber: r.returnNumber || 'N/A',
                        customerName: ((_a = r.customerId) === null || _a === void 0 ? void 0 : _a.name) || r.customerName || 'N/A',
                        totalAmount: r.totalAmount
                    });
                })
            }
        });
    }
    catch (error) {
        console.error('Error in getSalesmanDailyStats:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch daily stats', error: error.message });
    }
});
exports.getSalesmanDailyStats = getSalesmanDailyStats;
/**
 * Create a daily settlement entry and update the ledger
 */
const createDailySettlement = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const session = yield mongoose_1.default.startSession();
    session.startTransaction();
    try {
        const { salesmanId, date, totalInvoiceSale, totalReturn, cashSale, creditSale, expectedCash, amount, transactionType, entryType, bankAccountId, commissionAmount, notes } = req.body;
        const companyId = req.user.companyId;
        const userId = req.user._id;
        // 1. Create Settlement Entry
        const settlement = new SalesmanDailySettlement_js_1.default({
            salesmanId,
            date,
            totalInvoiceSale,
            totalReturn,
            cashSale,
            creditSale,
            expectedCash,
            actualCash: amount,
            transactionType,
            entryType,
            bankAccountId,
            companyId,
            settledBy: userId,
            notes
        });
        yield settlement.save({ session });
        const dateStr = new Date(date).toLocaleDateString();
        // 2. Create Single Salesman Ledger Entry (Manual Adjustment/Collection)
        const manualEntry = new SalesmanLedger_js_1.default({
            salesmanId,
            date,
            transactionType,
            entryType,
            description: notes || `${entryType} entry for ${dateStr}`,
            amount: amount,
            companyId,
            referenceId: settlement._id,
            referenceType: 'SalesmanDailySettlement',
            createdBy: userId
        });
        yield manualEntry.save({ session });
        // 3. Handle Bank Integration if bankAccountId is provided
        if (bankAccountId && amount > 0) {
            console.log(`🏦 Processing Bank Integration: Account=${bankAccountId}, Amount=${amount}, Type=${transactionType}`);
            // Find account by ID - MUST handle legacy records where companyId is missing or null
            const account = yield Account_js_1.Account.findOne({
                _id: bankAccountId,
                $or: [
                    { companyId: companyId },
                    { companyId: { $exists: false } },
                    { companyId: null }
                ]
            }).session(session);
            if (account) {
                console.log(`✅ Found Account: ${account.accountName}, Current Balance: ${account.balance}`);
                const isCredit = transactionType === 'Credit';
                // Adjust bank balance: Credit = Add (Money In), Debit = Deduct (Money Out)
                if (isCredit) {
                    account.balance += amount;
                }
                else {
                    account.balance -= amount;
                }
                yield account.save({ session });
                console.log(`💰 Updated Balance: ${account.balance}`);
                // Create Bank Transaction record
                const bankTxn = new Account_js_1.Transaction({
                    transactionNumber: `TXN-SET-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                    date: date || new Date(),
                    description: `Salesman Settlement (${entryType}): ${salesmanId} - ${notes || 'No notes'}`,
                    entries: [
                        {
                            account: bankAccountId,
                            debit: isCredit ? amount : 0, // Credit adds to bank -> Debit Bank
                            credit: isCredit ? 0 : amount // Debit deducts from bank -> Credit Bank
                        }
                    ],
                    totalAmount: amount,
                    unit: account.unit || 'Nos',
                    relatedDocument: isCredit ? 'Receipt' : 'Payment',
                    relatedDocumentId: settlement._id,
                    createdBy: userId,
                    companyId,
                    isApproved: true
                });
                yield bankTxn.save({ session });
            }
        }
        yield session.commitTransaction();
        session.endSession();
        res.json({ success: true, message: 'Settlement recorded successfully', data: settlement });
    }
    catch (error) {
        yield session.abortTransaction();
        session.endSession();
        console.error('Error in createDailySettlement:', error);
        res.status(500).json({ success: false, message: 'Failed to create settlement', error: error.message });
    }
});
exports.createDailySettlement = createDailySettlement;
/**
 * Get salesman ledger with running balance
 */
const getSalesmanLedger = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { startDate, endDate } = req.query;
        const companyId = req.user.companyId;
        let query = { salesmanId: id, companyId };
        if (startDate && endDate) {
            query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }
        const entries = yield SalesmanLedger_js_1.default.find(query).sort({ date: 1, createdAt: 1 }).lean();
        // Calculate Running Balance
        let runningBalance = 0;
        const entriesWithBalance = entries.map(entry => {
            if (entry.transactionType === 'Debit') {
                runningBalance += entry.amount;
            }
            else {
                runningBalance -= entry.amount;
            }
            return Object.assign(Object.assign({}, entry), { runningBalance });
        });
        res.json({
            success: true,
            data: entriesWithBalance.reverse() // Newest first for UI
        });
    }
    catch (error) {
        console.error('Error in getSalesmanLedger:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch ledger', error: error.message });
    }
});
exports.getSalesmanLedger = getSalesmanLedger;
/**
 * Calculate commission for a salesman
 */
const calculateCommission = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { salesmanId, startDate, endDate, method, rate, target, slabs } = req.body;
        const companyId = req.user.companyId;
        const query = {
            salesPerson: salesmanId,
            companyId: companyId,
            orderDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
            status: { $in: ['approved', 'completed', 'delivered'] }
        };
        const orders = yield Order_js_1.default.find(query);
        const totalSale = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        let commissionAmount = 0;
        if (method === 'Fixed') {
            commissionAmount = totalSale * (rate / 100);
        }
        else if (method === 'Target') {
            if (totalSale >= target) {
                commissionAmount = totalSale * (rate / 100);
            }
        }
        else if (method === 'Slab') {
            for (const slab of slabs) {
                if (totalSale > slab.min) {
                    const eligibleAmount = Math.min(totalSale, slab.max || Infinity) - slab.min;
                    commissionAmount += eligibleAmount * (slab.rate / 100);
                }
            }
        }
        res.json({
            success: true,
            data: {
                totalSale,
                commissionAmount,
                parameters: { method, rate, target, slabs }
            }
        });
    }
    catch (error) {
        console.error('Error in calculateCommission:', error);
        res.status(500).json({ success: false, message: 'Failed to calculate commission', error: error.message });
    }
});
exports.calculateCommission = calculateCommission;
/**
 * Add commission to ledger
 */
const postCommissionToLedger = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { salesmanId, amount, description, date } = req.body;
        const companyId = req.user.companyId;
        const userId = req.user._id;
        const ledgerEntry = new SalesmanLedger_js_1.default({
            salesmanId,
            date: date || new Date(),
            transactionType: 'Credit',
            entryType: 'Commission',
            description: description || `Commission for period`,
            amount,
            companyId,
            createdBy: userId
        });
        yield ledgerEntry.save();
        res.json({ success: true, message: 'Commission posted to ledger', data: ledgerEntry });
    }
    catch (error) {
        console.error('Error in postCommissionToLedger:', error);
        res.status(500).json({ success: false, message: 'Failed to post commission', error: error.message });
    }
});
exports.postCommissionToLedger = postCommissionToLedger;
