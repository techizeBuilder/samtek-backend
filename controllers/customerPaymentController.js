import CustomerPayment from '../models/CustomerPayment.js';
import Sale from '../models/Sale.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';
import Customer from '../models/Customer.js';

/**
 * Record Customer Payment and allocate to outstanding invoices
 */
export const createCustomerPayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { customerId, paymentDate, amount, paymentMode, referenceNo, notes } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;

        // 1. Create Payment record
        const payment = new CustomerPayment({
            customer: customerId,
            paymentDate,
            amount,
            paymentMode,
            referenceNo,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        await payment.save({ session });

        // 2. Update Invoices (FIFO logic)
        let remainingAmount = amount;
        const unpaidInvoices = await Sale.find({
            customer: customerId,
            balanceAmount: { $gt: 0 }
        }).sort({ saleDate: 1 }).session(session);

        for (const inv of unpaidInvoices) {
            if (remainingAmount <= 0) break;
            const payToThis = Math.min(inv.balanceAmount, remainingAmount);
            inv.paidAmount += payToThis;
            inv.balanceAmount -= payToThis;
            remainingAmount -= payToThis;

            // paymentStatus is handled by pre-save hook in Sale model
            await inv.save({ session });
        }

        // 3. Ledger Posting
        // Debit Bank/Cash (Bank Account)
        // Ledger Posting: Debit Bank/Cash, Credit Accounts Receivable
        let receivableAccount = await Account.findOne({ accountName: 'Accounts Receivable', unit }).session(session);
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
            await receivableAccount.save({ session });
        }

        const bankAccount = req.body.accountId
            ? await Account.findById(req.body.accountId).session(session)
            : await Account.findOne({ isBankOrCash: true, unit }).session(session);

        if (!bankAccount) {
            throw new Error('Bank or Cash account not found for receipt. Please create one in Bank & Cash module.');
        }

        if (receivableAccount && bankAccount) {
            const txn = new Transaction({
                transactionNumber: `TXN-REC-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Customer Receipt - Ref: ${referenceNo || 'N/A'}`,
                totalAmount: amount,
                unit,
                mode: paymentMode,
                relatedDocument: 'Receipt',
                relatedDocumentId: payment._id,
                createdBy: req.user._id,
                entries: [
                    { account: bankAccount._id, debit: amount, credit: 0 },
                    { account: receivableAccount._id, debit: 0, credit: amount }
                ]
            });
            await txn.save({ session });

            bankAccount.balance += amount; // Debit increases asset
            receivableAccount.balance -= amount; // Credit decreases asset

            await bankAccount.save({ session });
            await receivableAccount.save({ session });
        }

        // 4. Update Customer Outstanding Amount
        // Since this is a payment received, outstanding amount reduces.
        await Customer.findByIdAndUpdate(customerId, {
            $inc: { outstandingAmount: -amount }  // Decrease by payment amount
        }, { session });

        await session.commitTransaction();
        res.json({ success: true, data: payment });
    } catch (error) {
        await session.abortTransaction();
        res.status(400).json({ success: false, message: error.message });
    } finally {
        session.endSession();
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
            .sort({ paymentDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await CustomerPayment.countDocuments(query);

        res.json({
            success: true,
            data: {
                payments,
                pagination: { total, page: parseInt(page), limit: parseInt(limit) }
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
