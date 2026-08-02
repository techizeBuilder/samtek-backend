import CustomerPayment from '../models/CustomerPayment.js';
import Sale from '../models/Sale.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';

/**
 * Record Customer Payment and allocate to outstanding invoices
 */
export const createCustomerPayment = async (req, res) => {
    try {
        const { customerId, paymentDate, amount, paymentMode, referenceNo, notes, accountId, orderId } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;

        console.log('💳 Processing customer payment (Standalone Mode):', { customerId, amount, paymentMode, unit, accountId, orderId });

        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Please select an order before recording a payment.' });
        }

        // Resolve order (order-wise payment tracking) — required
        const Order = (await import('../models/Order.js')).default;
        const linkedOrder = await Order.findOne({ _id: orderId, companyId }).select('orderCode customer').lean();

        if (!linkedOrder) {
            return res.status(400).json({ success: false, message: 'Selected order was not found. Please select a valid order.' });
        }

        // 1. Create Payment record
        const paymentData = {
            customer: customerId,
            order: linkedOrder?._id || null,
            orderCode: linkedOrder?.orderCode || '',
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

        const payment = new CustomerPayment(paymentData);
        await payment.save();

        // 2. Update Invoices — order-targeted first, then FIFO for the remainder.
        // If an order is selected, that order's invoices get paid first so
        // order-wise Paid/Due tracking stays accurate.
        let remainingAmount = amount;

        if (linkedOrder) {
            const orderInvoices = await Sale.find({
                customer: customerId,
                order: linkedOrder._id,
                balanceAmount: { $gt: 0 }
            }).sort({ saleDate: 1 });
            for (const inv of orderInvoices) {
                if (remainingAmount <= 0) break;
                const payToThis = Math.min(inv.balanceAmount, remainingAmount);
                inv.paidAmount += payToThis;
                inv.balanceAmount -= payToThis;
                remainingAmount -= payToThis;
                await inv.save();
            }
        }

        if (remainingAmount > 0) {
            const unpaidInvoices = await Sale.find({
                customer: customerId,
                balanceAmount: { $gt: 0 }
            }).sort({ saleDate: 1 });

            console.log(`📄 Found ${unpaidInvoices.length} unpaid invoices for customer (FIFO remainder)`);

            for (const inv of unpaidInvoices) {
                if (remainingAmount <= 0) break;
                const payToThis = Math.min(inv.balanceAmount, remainingAmount);
                inv.paidAmount += payToThis;
                inv.balanceAmount -= payToThis;
                remainingAmount -= payToThis;

                await inv.save();
            }
        }

        // 3. Ledger Posting
        let receivableAccount = await Account.findOne({ accountName: 'Accounts Receivable', unit });

        if (!receivableAccount) {
            receivableAccount = new Account({
                accountNumber: `AR-${unit.replace(/\s+/g, '-')}-${Date.now()}`,
                accountName: 'Accounts Receivable',
                accountType: 'Asset',
                balance: 0,
                unit,
                companyId,
                description: 'Auto-generated account for customer receivables'
            });
            await receivableAccount.save();
        }

        let bankAccount;
        if (accountId) {
            bankAccount = await Account.findById(accountId);
        } else {
            bankAccount = await Account.findOne({ isBankOrCash: true, unit });
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

            const txn = new Transaction(txnData);
            await txn.save();

            // Update Account Balances
            bankAccount.balance += amount; // Debit increases asset
            receivableAccount.balance -= amount; // Credit decreases asset

            await bankAccount.save();
            await receivableAccount.save();
        }

        // 4. Update Customer Outstanding Amount
        await Customer.findByIdAndUpdate(customerId, {
            $inc: { outstandingAmount: -amount }
        });

        res.json({ success: true, data: payment });
    } catch (error) {
        console.error('❌ Error in createCustomerPayment:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Get Customer Payments
 */
export const getCustomerPayments = async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const query = { companyId: req.user.companyId };

        const payments = await CustomerPayment.find(query)
            .populate('customer', 'name')
            .populate('order', 'orderCode')
            .sort({ paymentDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await CustomerPayment.countDocuments(query);

        res.json({
            success: true,
            data: {
                payments,
                pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Customer Payment Stats
 */
export const getCustomerPaymentStats = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const stats = await CustomerPayment.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId), paymentDate: { $gte: firstDayOfMonth } } },
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
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
