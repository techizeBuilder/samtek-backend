import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import { Item } from '../models/Inventory.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';

/**
 * Create a new Sales Invoice and auto-post to ledger
 */
export const createSalesInvoice = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const {
            customerId, invoiceNo, saleDate, dueDate, items,
            subtotal, taxAmount, totalAmount, tdsAmount, tdsPercent, gstType, notes
        } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;

        if (!companyId || !unit) {
            throw new Error('Company or Unit assignment missing.');
        }

        // 1. Check for duplicate invoice
        if (invoiceNo) {
            const existing = await Sale.findOne({ invoiceNumber: invoiceNo, companyId }).session(session);
            if (existing) {
                throw new Error(`Invoice number "${invoiceNo}" already exists.`);
            }
        }

        // 2. Check if customer is active
        const customer = await Customer.findById(customerId).session(session);
        if (!customer || customer.active === 'No') {
            throw new Error('Customer is inactive or not found');
        }

        // 3. Create Sale Record
        const sale = new Sale({
            invoiceNumber: invoiceNo, // If null, pre-save hook will generate
            customer: customerId,
            saleDate: saleDate || new Date(),
            dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            items: items.map(item => ({
                productName: item.itemName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                tax: item.gstPercent
            })),
            subtotal,
            taxAmount,
            totalAmount,
            tdsAmount: tdsAmount || 0,
            tdsPercent: tdsPercent || 0,
            gstType: gstType || 'CGST_SGST',
            paidAmount: 0,
            balanceAmount: totalAmount,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        await sale.save({ session });

        // 4. Auto Journal Posting
        // Debit Accounts Receivable (totalAmount)
        // Credit Sales Account (subtotal)
        // Credit Output GST (taxAmount)

        const receivableAccount = await Account.findOne({ accountName: 'Accounts Receivable', unit }).session(session);
        const salesAccount = await Account.findOne({ accountName: 'Sales Account', unit }).session(session);
        const gstAccount = await Account.findOne({ accountName: 'Output GST', unit }).session(session);
        const tdsReceivableAccount = await Account.findOne({ accountName: 'TDS Receivable', unit }).session(session);

        if (receivableAccount && salesAccount && gstAccount) {
            const entries = [
                { account: receivableAccount._id, debit: totalAmount, credit: 0 },
                { account: salesAccount._id, debit: 0, credit: subtotal },
                { account: gstAccount._id, debit: 0, credit: taxAmount }
            ];

            // Add TDS entry if applicable
            if (tdsAmount > 0 && tdsReceivableAccount) {
                entries.push({ account: tdsReceivableAccount._id, debit: tdsAmount, credit: 0 });
            }

            const txn = new Transaction({
                transactionNumber: `TXN-SLE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
                description: `Sales Invoice: ${sale.invoiceNumber} to ${customer.name}${tdsAmount > 0 ? ' (Includes TDS Deduction)' : ''}`,
                reference: sale.invoiceNumber,
                totalAmount: subtotal + taxAmount,
                unit,
                relatedDocument: 'Sale',
                relatedDocumentId: sale._id,
                createdBy: req.user._id,
                entries
            });
            await txn.save({ session });

            // Update account balances
            receivableAccount.balance += totalAmount;
            salesAccount.balance += subtotal;
            gstAccount.balance += taxAmount;
            if (tdsAmount > 0 && tdsReceivableAccount) {
                tdsReceivableAccount.balance += tdsAmount;
                await tdsReceivableAccount.save({ session });
            }

            await receivableAccount.save({ session });
            await salesAccount.save({ session });
            await gstAccount.save({ session });
        }

        // 5. Update Inventory (Reduction)
        for (const item of items) {
            if (item.item) { // item._id from Inventory
                await Item.findByIdAndUpdate(item.item, {
                    $inc: { quantity: -item.quantity }
                }, { session });
            }
        }

        // 6. Update Customer Outstanding Amount
        await Customer.findByIdAndUpdate(customerId, {
            $inc: { outstandingAmount: totalAmount }
        }, { session });

        await session.commitTransaction();
        res.status(201).json({ success: true, data: sale });
    } catch (error) {
        await session.abortTransaction();
        res.status(400).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * Get Sales Invoices for the company
 */
export const getSalesInvoices = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        const query = { companyId: req.user.companyId };

        if (status && status !== 'All') query.paymentStatus = status;
        if (search) {
            query.$or = [
                { invoiceNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const invoices = await Sale.find(query)
            .populate('customer', 'name mobile email gstin address1 city state pin contactPerson')
            .populate('companyId', 'name unitName address city state locationPin email mobile gst')
            .sort({ saleDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await Sale.countDocuments(query);

        res.json({
            success: true,
            data: {
                invoices,
                pagination: { total, page: parseInt(page), limit: parseInt(limit) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Customer Outstanding / Receivable Ageing
 */
export const getReceivableAgeing = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { customerId } = req.query;

        let matchQuery = {
            companyId: new mongoose.Types.ObjectId(companyId),
            balanceAmount: { $gt: 0 }
        };

        if (customerId) {
            matchQuery.customer = new mongoose.Types.ObjectId(customerId);
        }

        const today = new Date();
        const outstandingData = await Sale.aggregate([
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
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Sales Summary for Reports
 */
export const getSalesSummary = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // 1. Total Sales (Lifetime) & Month Sales
        const totalSalesPromise = Sale.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
            { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
        ]);

        const monthSalesPromise = Sale.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId), saleDate: { $gte: firstDayOfMonth } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        // 2. Customer-wise Sales (Top 5)
        const customerSalesPromise = Sale.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
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

        const monthlyTrendPromise = Sale.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId), saleDate: { $gte: sixMonthsAgo } } },
            {
                $group: {
                    _id: { month: { $month: '$saleDate' }, year: { $year: '$saleDate' } },
                    amount: { $sum: '$totalAmount' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        const [
            totalSales,
            monthSales,
            customerSales,
            monthlyTrend
        ] = await Promise.all([
            totalSalesPromise,
            monthSalesPromise,
            customerSalesPromise,
            monthlyTrendPromise
        ]);

        res.json({
            success: true,
            data: {
                totalSales: totalSales[0]?.total || 0,
                saleCount: totalSales[0]?.count || 0,
                monthSales: monthSales[0]?.total || 0,
                customerSales,
                monthlyTrend
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Items for Sales (Finished Goods/Products)
 */
export const getSalesItems = async (req, res) => {
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

        const [items, total] = await Promise.all([
            Item.find(filter)
                .select('_id name code category type qty unit stdCost mrp salePrice hsn gst store')
                .skip(parseInt(skip))
                .limit(parseInt(limit))
                .sort({ name: 1 })
                .lean(),
            Item.countDocuments(filter)
        ]);

        res.json({
            success: true,
            data: {
                items,
                pagination: { total, skip: parseInt(skip), limit: parseInt(limit) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
