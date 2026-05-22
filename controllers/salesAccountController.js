import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import { Item } from '../models/Inventory.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';
import { generateStandardizedInvoicePDF } from '../utils/invoicePdf.js';
import { Company } from '../models/Company.js';

/**
 * Create a new Sales Invoice and auto-post to ledger
 */
export const createSalesInvoice = async (req, res) => {
    try {
        const {
            customerId, invoiceNo, saleDate, dueDate, items,
            subtotal, taxAmount, totalAmount, tdsAmount, tdsPercent, gstType, notes,
            invoiceType, orderId
        } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;

        if (!companyId || !unit) {
            throw new Error('Company or Unit assignment missing.');
        }

        // 1. Logic for Order-linked Invoices (Dual Billing Support)
        let finalInvoiceNo = invoiceNo;
        if (orderId) {
            const existingInvoices = await Sale.find({ order: orderId, companyId });

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
            const globalExisting = await Sale.findOne({ invoiceNumber: finalInvoiceNo, companyId });
            if (globalExisting) {
                throw new Error(`Invoice number "${finalInvoiceNo}" already exists.`);
            }
        }

        // 2. Check if customer is active
        const customer = await Customer.findById(customerId);
        if (!customer || customer.active === 'No') {
            throw new Error('Customer is inactive or not found');
        }

        // Determine actual tax and total based on invoiceType
        const isKachha = invoiceType === 'Kachha';
        const finalTaxAmount = isKachha ? 0 : taxAmount;
        const finalTotalAmount = isKachha ? subtotal : totalAmount;

        // 3. Create Sale Record
        const sale = new Sale({
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
            paidAmount: 0,
            balanceAmount: finalTotalAmount,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        await sale.save();

        // If it's linked to an order, update order status
        if (orderId) {
            const Order = (await import('../models/Order.js')).default;
            await Order.findByIdAndUpdate(orderId, {
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

        const receivableAccount = await Account.findOne({ accountName: 'Accounts Receivable', unit });
        const salesAccount = await Account.findOne({ accountName: 'Sales Account', unit });
        const gstAccount = await Account.findOne({ accountName: 'Output GST', unit });
        const tdsReceivableAccount = await Account.findOne({ accountName: 'TDS Receivable', unit });

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

            const txn = new Transaction({
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
            await txn.save();

            // Update account balances
            receivableAccount.balance += finalTotalAmount;
            salesAccount.balance += subtotal;
            gstAccount.balance += finalTaxAmount;
            if (tdsAmount > 0 && tdsReceivableAccount) {
                tdsReceivableAccount.balance += tdsAmount;
                await tdsReceivableAccount.save();
            }

            await receivableAccount.save();
            await salesAccount.save();
            await gstAccount.save();
        }

        // 5. Update Inventory (Reduction)
        for (const item of items) {
            if (item.item) { // item._id from Inventory
                await Item.findByIdAndUpdate(item.item, {
                    $inc: { qty: -Number(item.quantity) }
                });
            }
        }

        // 6. Update Customer Outstanding Amount
        await Customer.findByIdAndUpdate(customerId, {
            $inc: { outstandingAmount: finalTotalAmount }
        });

        res.status(201).json({ success: true, data: sale });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Get Sales Invoices for the company
 */
export const getSalesInvoices = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search, type } = req.query;
        const query = { companyId: req.user.companyId };

        if (status && status !== 'All') query.paymentStatus = status;
        if (type) query.invoiceType = type;
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

        // Fetch approved orders that are NOT yet invoiced
        const Order = (await import('../models/Order.js')).default;
        const invoicedOrderIds = await Sale.find({ companyId: req.user.companyId }).distinct('order');

        const pendingOrdersQuery = {
            companyId: req.user.companyId,
            status: 'approved',
            'accountApproval.status': 'approved',
            _id: { $nin: invoicedOrderIds }
        };

        const pendingOrders = await Order.find(pendingOrdersQuery)
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
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Fetch orders approved by Salesman (for Account Head approval and invoicing)
export const getPendingAccountOrders = async (req, res) => {
    try {
        const Order = (await import('../models/Order.js')).default;
        const Sale = (await import('../models/Sale.js')).default;
        const query = {
            companyId: req.user.companyId,
            status: { $in: ['approved', 'completed'] }
        };

        const orders = await Order.find(query)
            .populate('customer', 'name mobile email gstin address1 city state pin contactPerson customerCode')
            .populate('products.product', 'name price brand unit')
            .sort({ orderDate: -1 })
            .lean();

        // Enrich with invoicing status
        const ordersWithInvoices = await Promise.all(orders.map(async (order) => {
            const invoices = await Sale.find({ order: order._id }).select('invoiceType');
            return {
                ...order,
                generatedInvoices: invoices.map(inv => inv.invoiceType)
            };
        }));

        res.json({ success: true, data: ordersWithInvoices });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Approve Order by Account Head
export const approveOrderAccount = async (req, res) => {
    try {
        const { orderId, remarks } = req.body;
        const Order = (await import('../models/Order.js')).default;

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        order.accountApproval = {
            status: 'approved',
            approvedBy: req.user._id,
            approvedAt: new Date(),
            remarks: remarks || 'Approved by Account Head'
        };

        await order.save();

        res.json({ success: true, message: 'Order approved by Account Head' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Reject Order by Account Head
export const rejectOrderAccount = async (req, res) => {
    try {
        const { orderId, remarks } = req.body;
        const Order = (await import('../models/Order.js')).default;

        const order = await Order.findById(orderId);
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

        await order.save();

        res.json({ success: true, message: 'Order rejected by Account Head' });
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

/**
 * Download Invoice as PDF
 */
export const downloadInvoicePDF = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const [invoice, company] = await Promise.all([
            Sale.findById(id).populate('customer').lean(),
            Company.findById(companyId).lean()
        ]);

        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        const invoiceData = {
            company: {
                name: company?.name || company?.unitName,
                address: company?.address,
                gst: company?.gst,
                mobile: company?.mobile,
                email: company?.email
            },
            customer: {
                name: invoice.customer?.name,
                address1: invoice.customer?.address1,
                city: invoice.customer?.city,
                state: invoice.customer?.state,
                pin: invoice.customer?.pin,
                gstin: invoice.customer?.gstin,
                contactPerson: invoice.customer?.contactPerson
            },
            invoiceNo: invoice.invoiceNumber,
            date: new Date(invoice.saleDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            notes: invoice.notes,
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

        await generateStandardizedInvoicePDF(res, invoiceData);
    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
