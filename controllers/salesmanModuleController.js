import SalesmanDailySettlement from '../models/SalesmanDailySettlement.js';
import SalesmanLedger from '../models/SalesmanLedger.js';
import Order from '../models/Order.js';
import Return from '../models/Return.js';
import Sale from '../models/Sale.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import { Account, Transaction } from '../models/Account.js';
import mongoose from 'mongoose';

/**
 * Get daily statistics for a salesman to perform settlement
 */
export const getSalesmanDailyStats = async (req, res) => {
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
        const orders = await Order.find({
            salesPerson: salesmanId,
            companyId: companyId,
            orderDate: { $gte: startOfDay, $lte: endOfDay }
        }).populate('customer', 'name');

        const totalInvoiceSale = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const cashSale = orders.filter(o => o.paymentMethod === 'Cash' || o.paymentMethod === 'Other').reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const creditSale = totalInvoiceSale - cashSale;

        // 2. Fetch Returns
        const customers = await Customer.find({ salesContact: salesmanId, companyId: companyId });
        const customerIds = customers.map(c => c._id);

        const returns = await Return.find({
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
                orders: orders.map(o => ({
                    _id: o._id,
                    orderCode: o.orderCode,
                    customerName: o.customer?.name || 'N/A',
                    totalAmount: o.totalAmount,
                    paymentMethod: o.paymentMethod
                })),
                returns: returns.map(r => ({
                    _id: r._id,
                    returnNumber: r.returnNumber || 'N/A',
                    customerName: r.customerId?.name || r.customerName || 'N/A',
                    totalAmount: r.totalAmount
                }))
            }
        });

    } catch (error) {
        console.error('Error in getSalesmanDailyStats:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch daily stats', error: error.message });
    }
};

/**
 * Create a daily settlement entry and update the ledger
 */
export const createDailySettlement = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const {
            salesmanId,
            date,
            totalInvoiceSale,
            totalReturn,
            cashSale,
            creditSale,
            expectedCash,
            amount,
            transactionType,
            entryType,
            bankAccountId,
            commissionAmount,
            notes
        } = req.body;
        const companyId = req.user.companyId;
        const userId = req.user._id;

        // 1. Create Settlement Entry
        const settlement = new SalesmanDailySettlement({
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

        await settlement.save({ session });

        const dateStr = new Date(date).toLocaleDateString();

        // 2. Create Single Salesman Ledger Entry (Manual Adjustment/Collection)
        const manualEntry = new SalesmanLedger({
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
        await manualEntry.save({ session });

        // 3. Handle Bank Integration if bankAccountId is provided
        if (bankAccountId && amount > 0) {
            console.log(`🏦 Processing Bank Integration: Account=${bankAccountId}, Amount=${amount}, Type=${transactionType}`);

            // Find account by ID - MUST handle legacy records where companyId is missing or null
            const account = await Account.findOne({
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
                } else {
                    account.balance -= amount;
                }
                await account.save({ session });
                console.log(`💰 Updated Balance: ${account.balance}`);

                // Create Bank Transaction record
                const bankTxn = new Transaction({
                    transactionNumber: `TXN-SET-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                    date: date || new Date(),
                    description: `Salesman Settlement (${entryType}): ${salesmanId} - ${notes || 'No notes'}`,
                    entries: [
                        {
                            account: bankAccountId,
                            debit: isCredit ? amount : 0,    // Credit adds to bank -> Debit Bank
                            credit: isCredit ? 0 : amount    // Debit deducts from bank -> Credit Bank
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
                await bankTxn.save({ session });
            }
        }

        await session.commitTransaction();
        session.endSession();

        res.json({ success: true, message: 'Settlement recorded successfully', data: settlement });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error in createDailySettlement:', error);
        res.status(500).json({ success: false, message: 'Failed to create settlement', error: error.message });
    }
};

/**
 * Get salesman ledger with running balance
 */
export const getSalesmanLedger = async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate } = req.query;
        const companyId = req.user.companyId;

        let query = { salesmanId: id, companyId };

        if (startDate && endDate) {
            query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        const entries = await SalesmanLedger.find(query).sort({ date: 1, createdAt: 1 }).lean();

        // Calculate Running Balance
        let runningBalance = 0;
        const entriesWithBalance = entries.map(entry => {
            if (entry.transactionType === 'Debit') {
                runningBalance += entry.amount;
            } else {
                runningBalance -= entry.amount;
            }
            return { ...entry, runningBalance };
        });

        res.json({
            success: true,
            data: entriesWithBalance.reverse() // Newest first for UI
        });

    } catch (error) {
        console.error('Error in getSalesmanLedger:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch ledger', error: error.message });
    }
};

/**
 * Calculate commission for a salesman
 */
export const calculateCommission = async (req, res) => {
    try {
        const { salesmanId, startDate, endDate, method, rate, target, slabs } = req.body;
        const companyId = req.user.companyId;

        const query = {
            salesPerson: salesmanId,
            companyId: companyId,
            orderDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
            status: { $in: ['approved', 'completed', 'delivered'] }
        };

        const orders = await Order.find(query);
        const totalSale = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

        let commissionAmount = 0;

        if (method === 'Fixed') {
            commissionAmount = totalSale * (rate / 100);
        } else if (method === 'Target') {
            if (totalSale >= target) {
                commissionAmount = totalSale * (rate / 100);
            }
        } else if (method === 'Slab') {
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

    } catch (error) {
        console.error('Error in calculateCommission:', error);
        res.status(500).json({ success: false, message: 'Failed to calculate commission', error: error.message });
    }
};

/**
 * Add commission to ledger
 */
export const postCommissionToLedger = async (req, res) => {
    try {
        const { salesmanId, amount, description, date } = req.body;
        const companyId = req.user.companyId;
        const userId = req.user._id;

        const ledgerEntry = new SalesmanLedger({
            salesmanId,
            date: date || new Date(),
            transactionType: 'Credit',
            entryType: 'Commission',
            description: description || `Commission for period`,
            amount,
            companyId,
            createdBy: userId
        });

        await ledgerEntry.save();

        res.json({ success: true, message: 'Commission posted to ledger', data: ledgerEntry });

    } catch (error) {
        console.error('Error in postCommissionToLedger:', error);
        res.status(500).json({ success: false, message: 'Failed to post commission', error: error.message });
    }
};
