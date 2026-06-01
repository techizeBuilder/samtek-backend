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
exports.getCustomerPaymentStats = exports.getCustomerPayments = exports.createCustomerPayment = void 0;
const CustomerPayment_js_1 = __importDefault(require("../models/CustomerPayment.js"));
const Sale_js_1 = __importDefault(require("../models/Sale.js"));
const Account_js_1 = require("../models/Account.js");
const mongoose_1 = __importDefault(require("mongoose"));
const Customer_js_1 = __importDefault(require("../models/Customer.js"));
/**
 * Record Customer Payment and allocate to outstanding invoices
 */
const createCustomerPayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { customerId, paymentDate, amount, paymentMode, referenceNo, notes, accountId } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;
        console.log('💳 Processing customer payment (Standalone Mode):', { customerId, amount, paymentMode, unit, accountId });
        // 1. Create Payment record
        const paymentData = {
            customer: customerId,
            paymentDate: paymentDate || new Date(),
            amount,
            paymentMode,
            referenceNo,
            bankAccount: accountId, // Save the ledger account ID
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        };
        const payment = new CustomerPayment_js_1.default(paymentData);
        yield payment.save();
        // 2. Update Invoices (FIFO logic)
        let remainingAmount = amount;
        const unpaidInvoices = yield Sale_js_1.default.find({
            customer: customerId,
            balanceAmount: { $gt: 0 }
        }).sort({ saleDate: 1 });
        console.log(`📄 Found ${unpaidInvoices.length} unpaid invoices for customer`);
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
        let receivableAccount = yield Account_js_1.Account.findOne({ accountName: 'Accounts Receivable', unit });
        if (!receivableAccount) {
            receivableAccount = new Account_js_1.Account({
                accountNumber: `AR-${unit.replace(/\s+/g, '-')}-${Date.now()}`,
                accountName: 'Accounts Receivable',
                accountType: 'Asset',
                balance: 0,
                unit,
                companyId,
                description: 'Auto-generated account for customer receivables'
            });
            yield receivableAccount.save();
        }
        let bankAccount;
        if (accountId) {
            bankAccount = yield Account_js_1.Account.findById(accountId);
        }
        else {
            bankAccount = yield Account_js_1.Account.findOne({ isBankOrCash: true, unit });
        }
        if (!bankAccount) {
            throw new Error('Bank or Cash account not found for receipt. Please create one in Bank & Cash module.');
        }
        if (receivableAccount && bankAccount) {
            const txnData = {
                transactionNumber: `TXN-REC-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Customer Receipt - Ref: ${referenceNo || 'N/A'}`,
                totalAmount: amount,
                unit,
                mode: paymentMode,
                relatedDocument: 'Receipt',
                relatedDocumentId: payment._id,
                createdBy: req.user._id,
                isApproved: true, // Auto-approve receipt transactions
                entries: [
                    { account: bankAccount._id, debit: amount, credit: 0 },
                    { account: receivableAccount._id, debit: 0, credit: amount }
                ]
            };
            const txn = new Account_js_1.Transaction(txnData);
            yield txn.save();
            // Update Account Balances
            bankAccount.balance += amount; // Debit increases asset
            receivableAccount.balance -= amount; // Credit decreases asset
            yield bankAccount.save();
            yield receivableAccount.save();
        }
        // 4. Update Customer Outstanding Amount
        yield Customer_js_1.default.findByIdAndUpdate(customerId, {
            $inc: { outstandingAmount: -amount }
        });
        res.json({ success: true, data: payment });
    }
    catch (error) {
        console.error('❌ Error in createCustomerPayment:', error);
        res.status(400).json({ success: false, message: error.message });
    }
});
exports.createCustomerPayment = createCustomerPayment;
/**
 * Get Customer Payments
 */
const getCustomerPayments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const query = { companyId: req.user.companyId };
        const payments = yield CustomerPayment_js_1.default.find(query)
            .populate('customer', 'name')
            .sort({ paymentDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        const total = yield CustomerPayment_js_1.default.countDocuments(query);
        res.json({
            success: true,
            data: {
                payments,
                pagination: { total, page: parseInt(page), limit: parseInt(limit) }
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getCustomerPayments = getCustomerPayments;
/**
 * Get Customer Payment Stats
 */
const getCustomerPaymentStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const companyId = req.user.companyId;
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const stats = yield CustomerPayment_js_1.default.aggregate([
            { $match: { companyId: new mongoose_1.default.Types.ObjectId(companyId), paymentDate: { $gte: firstDayOfMonth } } },
            {
                $group: {
                    _id: '$paymentMode',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);
        const totalPaid = stats.reduce((sum, s) => sum + s.total, 0);
        const modes = stats.map(s => ({
            _id: s._id,
            total: s.total,
            count: s.count,
            percentage: totalPaid > 0 ? Math.round((s.total / totalPaid) * 100) : 0
        }));
        res.json({
            success: true,
            data: {
                totalPaid,
                modes
            }
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
exports.getCustomerPaymentStats = getCustomerPaymentStats;
