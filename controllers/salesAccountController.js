import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import { Item } from '../models/Inventory.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';
import { generateStandardizedInvoicePDF } from '../utils/invoicePdf.js';
import { Company } from '../models/Company.js';
import { computeOrderFinancials } from '../utils/orderFinancials.js';

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
        // Placeholder Sales (Store's internal auto-created record, see
        // orderController.js updateOrderStoreInfo) are never real invoices —
        // excluded here so they can't block generation or leak their
        // throwaway TEMP- number into a real Kachha/Pakka bill.
        let finalInvoiceNo = invoiceNo;
        if (orderId) {
            const existingInvoices = await Sale.find({ order: orderId, companyId, isPlaceholder: { $ne: true } });

            // Check if this specific type already exists
            const sameType = existingInvoices.find(inv => inv.invoiceType === (invoiceType || 'Pakka'));
            if (sameType) {
                throw new Error(`${invoiceType || 'Pakka'} bill is already generated for this order.`);
            }

            // If a real invoice already exists for this order, reuse its number
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

        const isKachha = invoiceType === 'Kachha';

        // 3. Order-linked bills are built from the ORDER FORM (source of
        // truth), never from client-sent amounts. Additional charges are
        // already folded into the items' Bill Amounts by sales, so nothing
        // is added separately; GST rides on top of the Bill Amount.
        //   Pakka  = Σ billAmount + Σ gstAmount
        //   Kachha = Σ billAmount + Σ gstAmount + Σ cashAmount
        let finalItems = items || [];
        let finalSubtotal = subtotal;
        let finalTaxAmount = isKachha ? 0 : taxAmount;
        let finalTotalAmount = isKachha ? subtotal : totalAmount;
        let formAdvance = 0;

        if (orderId) {
            const OrderForm = (await import('../models/OrderForm.js')).default;
            const form = await OrderForm.findOne({ orderId, status: 'Submitted' }).lean();
            if (!form) {
                throw new Error('Order Form is not submitted for this order — bill Order Form ke amounts se banta hai.');
            }

            const rows = form.items || [];
            const billSum = rows.reduce((s, it) => s + (it.billAmount || 0), 0);
            const gstSum = rows.reduce((s, it) => s + (it.gstAmount || 0), 0);
            const cashSum = rows.reduce((s, it) => s + (it.cashAmount || 0), 0);

            finalSubtotal = isKachha ? billSum + cashSum : billSum;
            finalTaxAmount = gstSum;
            finalTotalAmount = finalSubtotal + gstSum;

            // Each item line carries its full share (bill + GST, + cash for
            // Kachha) because the printed bill sums rate × qty with no
            // separate GST line — the items must add up to the invoice total.
            finalItems = rows.filter(it => !it.hiddenCharge).map(it => {
                const qty = it.qty || 1;
                const lineTotal = (it.billAmount || 0) + (it.gstAmount || 0) + (isKachha ? (it.cashAmount || 0) : 0);
                return {
                    productName: it.itemName || 'Item',
                    quantity: qty,
                    unitPrice: Math.round((lineTotal / qty) * 100) / 100,
                    totalPrice: lineTotal,
                    tax: 0
                };
            });

            if (form.paymentType === 'Advance Payment') {
                formAdvance = form.receivedAmount || 0;
            }
        }

        // 3a. Advance — Order Form's Payment section first, else verified
        // lead payments (older forms without an amount)
        let advancedPaymentAmount = formAdvance;
        if (!advancedPaymentAmount && orderId) {
            const Order = (await import('../models/Order.js')).default;
            const LeadPayment = (await import('../models/LeadPayment.js')).default;
            const linkedOrder = await Order.findById(orderId).select('leadId').lean();
            if (linkedOrder?.leadId) {
                const leadPayments = await LeadPayment.find({
                    leadId: linkedOrder.leadId,
                    status: 'Verified',
                    companyId
                }).select('amount').lean();
                advancedPaymentAmount = leadPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
            }
        }

        // 3b. Create Sale Record — paidAmount stays 0: the pre-save hook
        // already deducts advancedPaymentAmount while computing the balance,
        // so mirroring the advance into paidAmount double-counted it.
        const sale = new Sale({
            invoiceNumber: finalInvoiceNo, // If null, pre-save hook will generate
            order: orderId,
            customer: customerId,
            saleDate: saleDate || new Date(),
            dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            items: finalItems.map(item => ({
                productName: item.productName || item.itemName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                tax: item.gstPercent || item.tax || 0
            })),
            subtotal: finalSubtotal,
            taxAmount: finalTaxAmount,
            totalAmount: finalTotalAmount,
            tdsAmount: tdsAmount || 0,
            tdsPercent: tdsPercent || 0,
            gstType: gstType || 'CGST_SGST',
            invoiceType: invoiceType || 'Pakka',
            advancedPaymentAmount,
            paidAmount: 0,
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
                { account: salesAccount._id, debit: 0, credit: finalSubtotal },
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
                totalAmount: finalSubtotal + finalTaxAmount,
                unit,
                relatedDocument: 'Sale',
                relatedDocumentId: sale._id,
                createdBy: req.user._id,
                entries
            });
            await txn.save();

            // Update account balances
            receivableAccount.balance += finalTotalAmount;
            salesAccount.balance += finalSubtotal;
            gstAccount.balance += finalTaxAmount;
            if (tdsAmount > 0 && tdsReceivableAccount) {
                tdsReceivableAccount.balance += tdsAmount;
                await tdsReceivableAccount.save();
            }

            await receivableAccount.save();
            await salesAccount.save();
            await gstAccount.save();
        }

        // 5. Update Inventory (Reduction) — only manual invoices carry
        // inventory item ids; order-form items don't touch stock here
        for (const item of (items || [])) {
            if (item.item) { // item._id from Inventory
                await Item.findByIdAndUpdate(item.item, {
                    $inc: { qty: -Number(item.quantity) }
                });
            }
        }

        // NOTE: Customer Master is intentionally NOT touched here. Customer
        // outstanding/advance is driven by the Order Form alone — invoices
        // must never reflect into the Customer Master balances.

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

        const [invoices, total, statsAgg] = await Promise.all([
            Sale.find(query)
                .populate('customer', 'name mobile email gstin address1 city state pin contactPerson')
                .populate('companyId', 'name unitName address city state locationPin email mobile gst')
                .sort({ saleDate: -1 })
                .skip((page - 1) * limit)
                .limit(parseInt(limit))
                .lean(),
            Sale.countDocuments(query),
            // Stat cards (Total Invoice/Revenue/Unpaid Balance) reflect every
            // matching invoice, not just the current page.
            Sale.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$totalAmount' },
                        unpaidAmount: { $sum: { $cond: [{ $ne: ['$paymentStatus', 'Paid'] }, '$totalAmount', 0] } },
                    }
                }
            ]),
        ]);

        const stats = statsAgg[0] || { totalAmount: 0, unpaidAmount: 0 };

        // Fetch approved orders that are NOT yet invoiced. Placeholder Sales
        // (Store's internal auto-created record — see updateOrderStoreInfo)
        // are never real invoices and must not count as "already invoiced".
        const Order = (await import('../models/Order.js')).default;
        const invoicedOrderIds = await Sale.find({ companyId: req.user.companyId, isPlaceholder: { $ne: true } }).distinct('order');

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

        // This list is filtered to one invoiceType (`type` query param) at a
        // time, so an order with BOTH a Kachha and Pakka bill only ever shows
        // one row here. Attach the other type's Sale (if any) as
        // `siblingInvoice` so the frontend can offer a choice at
        // print/download time instead of guessing which one the user wants.
        const orderIds = [...new Set(invoices.map(inv => inv.order?.toString()).filter(Boolean))];
        const siblingCandidates = orderIds.length
            ? await Sale.find({ order: { $in: orderIds }, isPlaceholder: { $ne: true } })
                .select('order invoiceType invoiceNumber')
                .lean()
            : [];
        const salesByOrder = {};
        siblingCandidates.forEach(s => {
            const key = s.order?.toString();
            if (!key) return;
            (salesByOrder[key] ||= []).push(s);
        });
        const invoicesWithSibling = invoices.map(inv => {
            const orderKey = inv.order?.toString();
            const sibling = (salesByOrder[orderKey] || []).find(
                s => s._id.toString() !== inv._id.toString() && s.invoiceType !== inv.invoiceType
            );
            return {
                ...inv,
                siblingInvoice: sibling ? { _id: sibling._id, invoiceType: sibling.invoiceType, invoiceNumber: sibling.invoiceNumber } : null
            };
        });

        res.json({
            success: true,
            data: {
                invoices: invoicesWithSibling,
                pendingOrders,
                pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
                summary: {
                    totalInvoices: total,
                    totalRevenue: stats.totalAmount,
                    unpaidBalance: stats.unpaidAmount,
                    pendingOrdersCount: pendingOrders.length,
                },
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Next available invoice number for the current year (INV-{year}-{series}) —
// used to prefill the "New Invoice" form. Finds just the highest existing
// series via an indexed, sorted query instead of fetching every invoice the
// company has ever issued.
export const getNextInvoiceNumber = async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const prefix = `INV-${currentYear}-`;
        const lastInvoice = await Sale.findOne({
            companyId: req.user.companyId,
            invoiceNumber: { $regex: `^${prefix}` }
        }).sort({ invoiceNumber: -1 }).select('invoiceNumber').lean();

        let nextSeries = 1;
        if (lastInvoice?.invoiceNumber) {
            const parts = lastInvoice.invoiceNumber.split('-');
            const num = parseInt(parts[2]) || 0;
            nextSeries = num + 1;
        }

        res.json({ success: true, invoiceNumber: `${prefix}${String(nextSeries).padStart(2, '0')}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Fetch orders approved by Salesman (for Account Head approval and invoicing)
export const getPendingAccountOrders = async (req, res) => {
    try {
        const Order = (await import('../models/Order.js')).default;
        const Sale = (await import('../models/Sale.js')).default;
        const LeadPayment = (await import('../models/LeadPayment.js')).default;

        const { page = 1, limit = 20, search } = req.query;
        const skip = (page - 1) * limit;

        const query = {
            companyId: req.user.companyId,
            status: { $in: ['approved', 'completed'] }
        };
        if (search) {
            query.orderCode = { $regex: search, $options: 'i' };
        }

        const baseQuery = { companyId: req.user.companyId, status: { $in: ['approved', 'completed'] } };

        const [orders, total, statsAgg] = await Promise.all([
            Order.find(query)
                .populate('customer', 'name mobile email gstin address1 city state pin contactPerson customerCode')
                .populate('products.product', 'name price brand unit')
                .sort({ orderDate: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            Order.countDocuments(query),
            // Stat cards (Not Invoiced / Invoiced / Potential Revenue) reflect
            // ALL matching orders, not just the current page — computed via
            // aggregate instead of pulling every order + its Sale docs into memory.
            Order.aggregate([
                { $match: baseQuery },
                {
                    $lookup: {
                        from: 'sales',
                        let: { orderId: '$_id' },
                        pipeline: [
                            { $match: { $expr: { $and: [{ $eq: ['$order', '$$orderId'] }, { $ne: ['$isPlaceholder', true] }] } } },
                            { $limit: 1 },
                        ],
                        as: 'invoiceCheck',
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$totalAmount' },
                        invoicedCount: { $sum: { $cond: [{ $gt: [{ $size: '$invoiceCheck' }, 0] }, 1, 0] } },
                        notInvoicedCount: { $sum: { $cond: [{ $gt: [{ $size: '$invoiceCheck' }, 0] }, 0, 1] } },
                    }
                }
            ]),
        ]);

        const stats = statsAgg[0] || { totalAmount: 0, invoicedCount: 0, notInvoicedCount: 0 };

        // Enrich with invoicing status + advanced payment from linked lead —
        // only for the current page's rows, not every pending order the
        // company has ever had.
        const ordersWithInvoices = await Promise.all(orders.map(async (order) => {
            const invoices = await Sale.find({ order: order._id, isPlaceholder: { $ne: true } }).select('invoiceType');

            // Fetch verified advanced payments for the linked lead (if any)
            let advancedPaymentAmount = 0;
            let advancedPayments = [];
            if (order.leadId) {
                const leadPayments = await LeadPayment.find({
                    leadId: order.leadId,
                    status: 'Verified',
                    companyId: req.user.companyId
                }).select('amount paymentDate paymentMethod transactionId leadCode').lean();

                advancedPayments = leadPayments;
                advancedPaymentAmount = leadPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
            }

            return {
                ...order,
                generatedInvoices: invoices.map(inv => inv.invoiceType),
                advancedPaymentAmount,
                advancedPayments
            };
        }));

        res.json({
            success: true,
            data: ordersWithInvoices,
            pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
            summary: {
                notInvoicedCount: stats.notInvoicedCount,
                invoicedCount: stats.invoicedCount,
                potentialRevenue: stats.totalAmount,
            },
        });
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

        await generateStandardizedInvoicePDF(res, invoiceData);
    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Packed Orders for Accounts Module
 */
export const getPackedOrders = async (req, res) => {
    try {
        const PackagingJob = (await import('../models/PackagingJob.js')).default;
        const Order = (await import('../models/Order.js')).default;
        const Sale = (await import('../models/Sale.js')).default;
        const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
        const QCJob = (await import('../models/QCJob.js')).default;

        const companyId = req.user.companyId;

        // Find packaging jobs with status 'Packed' under user's company
        const packedJobs = await PackagingJob.find({
            status: 'Packed',
            company: companyId
        }).sort({ updatedAt: -1 });

        const LeadPayment = (await import('../models/LeadPayment.js')).default;

        // ── Batch pre-fetch the PRIMARY lookup (order by orderCode) for every
        // job in one query, instead of one Order.findOne per job (N+1). The
        // rare fallback chains (productionOrderId/qcJobId/prodByOrderId —
        // only hit when a job has no matching orderCode) stay per-job below
        // since they only run for a handful of edge-case jobs, not all of them.
        const orderCodes = [...new Set(packedJobs.map(j => j.orderId).filter(Boolean))];
        const ordersByCode = new Map();
        if (orderCodes.length) {
            const primaryOrders = await Order.find({ orderCode: { $in: orderCodes }, companyId })
                .select('-quotation').populate('customer').populate('products.product');
            primaryOrders.forEach(o => ordersByCode.set(o.orderCode, o));
        }

        // Batch-fetch every Sale for those primary-matched orders in one query
        // (same preference logic as getNOCRequests, just resolved from a map).
        const primaryOrderIds = [...ordersByCode.values()].map(o => o._id);
        const salesByOrderId = new Map();
        if (primaryOrderIds.length) {
            const primarySales = await Sale.find({ order: { $in: primaryOrderIds }, companyId }).sort({ createdAt: -1 });
            primarySales.forEach(s => {
                const key = s.order.toString();
                if (!salesByOrderId.has(key)) salesByOrderId.set(key, []);
                salesByOrderId.get(key).push(s);
            });
        }
        const pickPreferredSale = (orderSales) =>
            orderSales.find(s => !s.isPlaceholder && s.invoiceType === 'Pakka')
                || orderSales.find(s => !s.isPlaceholder)
                || orderSales[0]
                || null;

        // Resolve order+sale for every job (batched map for the common case,
        // original sequential fallback chain for the rare unmatched ones).
        const resolved = [];
        for (const job of packedJobs) {
            let order = ordersByCode.get(job.orderId) || null;
            let sale = null;

            if (order) {
                sale = pickPreferredSale(salesByOrderId.get(order._id.toString()) || []);
            } else {
                // Fallback: packaging job was created from a ProductionOrder or QCJob
                // Try to find the Sale directly via saleId on those source records
                if (job.productionOrderId) {
                    const prodOrder = await ProductionOrder.findById(job.productionOrderId).select('saleId').lean();
                    if (prodOrder?.saleId) {
                        sale = await Sale.findOne({ _id: prodOrder.saleId, companyId });
                        if (sale?.order) {
                            order = await Order.findById(sale.order).select('-quotation').populate('customer').populate('products.product');
                        }
                    }
                }
                if (!sale && job.qcJobId) {
                    const qcJob = await QCJob.findById(job.qcJobId).select('saleId').lean();
                    if (qcJob?.saleId) {
                        sale = await Sale.findOne({ _id: qcJob.saleId, companyId });
                        if (sale?.order) {
                            order = await Order.findById(sale.order).select('-quotation').populate('customer').populate('products.product');
                        }
                    }
                }
                // Extra fallback: job.orderId might be a ProductionOrder.orderId string (e.g. "PROD-2026-XXX")
                // Try finding the Production order by its orderId string field
                if (!sale) {
                    const prodByOrderId = await ProductionOrder.findOne({ orderId: job.orderId, company: companyId }).select('saleId').lean();
                    if (prodByOrderId?.saleId) {
                        sale = await Sale.findOne({ _id: prodByOrderId.saleId, companyId });
                        if (sale?.order) {
                            order = await Order.findById(sale.order).select('-quotation').populate('customer').populate('products.product');
                        }
                    }
                }
            }

            // If still no order found, skip this job (no associated sales order exists)
            if (!order) continue;
            resolved.push({ job, order, sale });
        }

        // Batch-fetch Customer master + LeadPayment + Order Form + order-linked
        // CustomerPayment data for every resolved job in one query each,
        // instead of one query per job.
        const OrderForm = (await import('../models/OrderForm.js')).default;
        const CustomerPayment = (await import('../models/CustomerPayment.js')).default;

        const custIds = [...new Set(resolved.map(r => r.order.customer?._id?.toString()).filter(Boolean))];
        const leadIds = [...new Set(resolved.map(r => r.order.leadId?.toString()).filter(Boolean))];
        const orderIds = resolved.map(r => r.order._id);
        const [custMasters, leadPays, forms, orderPays] = await Promise.all([
            custIds.length ? Customer.find({ _id: { $in: custIds } }).select('outstandingAmount advancePayment').lean() : [],
            leadIds.length ? LeadPayment.find({ leadId: { $in: leadIds }, status: 'Verified', companyId }).select('leadId amount').lean() : [],
            orderIds.length ? OrderForm.find({ orderId: { $in: orderIds }, status: 'Submitted' }).select('orderId items totals receivedAmount paymentType').lean() : [],
            orderIds.length ? CustomerPayment.find({ order: { $in: orderIds }, companyId }).select('order amount').lean() : []
        ]);
        const custMasterById = new Map(custMasters.map(c => [c._id.toString(), c]));
        const leadPaySumById = new Map();
        const leadPaysByLeadId = new Map();
        leadPays.forEach(p => {
            const key = p.leadId.toString();
            leadPaySumById.set(key, (leadPaySumById.get(key) || 0) + (p.amount || 0));
            if (!leadPaysByLeadId.has(key)) leadPaysByLeadId.set(key, []);
            leadPaysByLeadId.get(key).push(p);
        });
        const formByOrderId = new Map(forms.map(f => [f.orderId.toString(), f]));
        const orderPaysByOrderId = new Map();
        orderPays.forEach(p => {
            const key = p.order.toString();
            if (!orderPaysByOrderId.has(key)) orderPaysByOrderId.set(key, []);
            orderPaysByOrderId.get(key).push(p);
        });

        // One entity per ORDER, not per packaging job — an order with 8 packed
        // machines used to produce 8 near-identical rows here (same customer,
        // same financials, different machine/SN). Accounts only needs to act
        // on this once per order; the individual machines/serials are kept in
        // `packedJobs` for traceability, not as separate rows.
        const groupsByOrder = new Map();

        for (const { job, order, sale } of resolved) {
            const orderKey = order._id.toString();

            if (!groupsByOrder.has(orderKey)) {
                // `sale` above may have resolved to Store's internal placeholder
                // (isPlaceholder: true) — that's fine for locating `order` via
                // saleId indirection, but it must never be treated as a real
                // invoice for financial display/"already invoiced" purposes.
                const realSale = sale && !sale.isPlaceholder ? sale : null;
                const form = formByOrderId.get(orderKey) || null;

                let totalAmount, paidAmount, advancedPaymentAmount, balanceAmount, paymentStatus;

                if (form) {
                    // Order Form is authoritative — identical formula to Customer
                    // Master's order-financials breakdown, so the two never drift.
                    const orderPayments = orderPaysByOrderId.get(orderKey) || [];
                    const leadPayments = order.leadId ? (leadPaysByLeadId.get(order.leadId.toString()) || []) : [];
                    const fin = computeOrderFinancials({ form, sale: realSale, orderPayments, leadPayments });
                    totalAmount = fin.total;
                    advancedPaymentAmount = fin.advance;
                    paidAmount = fin.advance + fin.paid;
                    balanceAmount = fin.due;
                    paymentStatus = fin.paymentStatus;
                } else {
                    // No Order Form yet (legacy order) — fall back to invoice/order value.
                    advancedPaymentAmount = realSale?.advancedPaymentAmount || 0;
                    if (!advancedPaymentAmount && order.leadId) {
                        advancedPaymentAmount = leadPaySumById.get(order.leadId.toString()) || 0;
                    }
                    totalAmount = realSale
                      ? realSale.totalAmount
                      : Math.round((order.totalAmount || 0) * 1.18); // No invoice yet → add 18% GST to order value
                    paidAmount = realSale ? ((realSale.paidAmount || 0) + advancedPaymentAmount) : advancedPaymentAmount;
                    balanceAmount = realSale ? realSale.balanceAmount : Math.max(0, totalAmount - advancedPaymentAmount);
                    paymentStatus = realSale ? realSale.paymentStatus : (advancedPaymentAmount >= totalAmount ? 'Paid' : (advancedPaymentAmount > 0 ? 'Partially Paid' : 'Pending'));
                }

                const paymentProofUrl = realSale ? realSale.paymentProofUrl : '';
                const saleId = realSale ? realSale._id : null;

                // Fetch customer master fields for display
                const customerMaster = custMasterById.get(order.customer?._id?.toString());
                const customerOutstanding = customerMaster?.outstandingAmount || 0;
                const customerAdvance = customerMaster?.advancePayment || 0;

                groupsByOrder.set(orderKey, {
                    // Representative job — kept so endpoints that only need ANY
                    // one job of this order to resolve order-level data (due-bill,
                    // upload-proof) keep working unchanged. Full per-machine list
                    // is in `packedJobs` below.
                    jobId: job._id,
                    jobCode: job.jobId,
                    orderId: order._id,
                    orderCode: order.orderCode,
                    packedDate: job.packingCompleteTime || job.updatedAt,
                    machineName: job.machineName,
                    machineCode: job.machineCode,
                    serialNumber: job.serialNumber,
                    packedJobs: [],
                    customer: {
                        id: order.customer?._id,
                        name: order.customer?.name || 'N/A',
                        mobile: order.customer?.mobile || 'N/A',
                        email: order.customer?.email || 'N/A',
                        address: order.customer?.address1 || 'N/A',
                        city: order.customer?.city || 'N/A',
                        state: order.customer?.state || 'N/A'
                    },
                    itemsPacked: order.products.map(p => ({
                        productName: p.product?.name || 'Unknown Item',
                        quantity: p.quantity,
                        price: p.price,
                        total: p.total
                    })),
                    totalAmount,
                    paidAmount,
                    advancedPaymentAmount,
                    balanceAmount,
                    paymentStatus,
                    paymentProofUrl,
                    saleId,
                    // Customer master reference fields (kept for info display)
                    customerOutstanding,
                    customerAdvance,
                    // ORDER-WISE display values — this row belongs to ONE order,
                    // so Total/Paid/Due are that order's own figures:
                    // Total = order invoice total, Paid = advance + receipts
                    // against this order, Due = what's left on this order
                    displayTotal: totalAmount,
                    displayPaid: paidAmount,
                    displayDue: balanceAmount
                });
            }

            const group = groupsByOrder.get(orderKey);
            group.packedJobs.push({
                jobId: job._id,
                jobCode: job.jobId,
                machineName: job.machineName,
                machineCode: job.machineCode,
                serialNumber: job.serialNumber,
                quantity: job.quantity || 1,
                packingType: job.packingType || ''
            });
            // Order's displayed packedDate = the LATEST of its jobs — that's
            // when it actually became fully packed and payment-ready.
            const jobDate = job.packingCompleteTime || job.updatedAt;
            if (jobDate && (!group.packedDate || new Date(jobDate) > new Date(group.packedDate))) {
                group.packedDate = jobDate;
            }
        }

        let results = Array.from(groupsByOrder.values());

        // Same reasoning as getNOCRequests: the grouping above needs every
        // packed job to build correctly, so it can't be paginated at the DB
        // query level — but the final response is search-filtered +
        // paginated here instead of shipping every packed order at once.
        const { page = 1, limit = 20, search } = req.query;
        if (search) {
            const q = search.toLowerCase();
            results = results.filter(item =>
                (item.orderCode || '').toLowerCase().includes(q) ||
                (item.customer?.name || '').toLowerCase().includes(q) ||
                (item.customer?.mobile || '').toLowerCase().includes(q) ||
                (item.machineName || '').toLowerCase().includes(q) ||
                (item.serialNumber || '').toLowerCase().includes(q)
            );
        }

        const total = results.length;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const paginated = results.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            data: paginated,
            pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('Error in getPackedOrders:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};



/**
 * Upload Payment Proof for Sale
 */
/**
 * Get full Due Bill data for a specific packed order (for PDF generation)
 * GET /api/accounts/packed-orders/:jobId/due-bill
 */
export const getDueBillData = async (req, res) => {
    try {
        const { jobId } = req.params;
        const companyId = req.user.companyId;

        const PackagingJob = (await import('../models/PackagingJob.js')).default;
        const Order        = (await import('../models/Order.js')).default;
        const Sale         = (await import('../models/Sale.js')).default;
        const LeadPayment  = (await import('../models/LeadPayment.js')).default;
        const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
        const QCJob        = (await import('../models/QCJob.js')).default;
        const CustomerPayment = (await import('../models/CustomerPayment.js')).default;
        const OrderForm    = (await import('../models/OrderForm.js')).default;

        // 1. Find the packaging job
        const job = await PackagingJob.findOne({ _id: jobId, company: companyId });
        if (!job) return res.status(404).json({ success: false, message: 'Packaging job not found' });

        // 2. Resolve Order + Sale (same fallback chain as getPackedOrders)
        let order = null;
        let sale  = null;

        order = await Order.findOne({ orderCode: job.orderId, companyId })
            .select('-quotation')
            .populate('customer')
            .populate('products.product');

        if (order) {
            // An order can have multiple Sale docs (Store's placeholder, plus
            // a real Kachha and/or Pakka once Accounts generates them).
            // Prefer a real Pakka bill, then a real Kachha bill, then
            // anything — same preference order as getPackedOrders/getNOCRequests.
            const orderSales = await Sale.find({ order: order._id, companyId }).sort({ createdAt: -1 });
            sale = orderSales.find(s => !s.isPlaceholder && s.invoiceType === 'Pakka')
                || orderSales.find(s => !s.isPlaceholder)
                || orderSales[0]
                || null;
        } else {
            if (job.productionOrderId) {
                const po = await ProductionOrder.findById(job.productionOrderId).select('saleId').lean();
                if (po?.saleId) {
                    sale = await Sale.findOne({ _id: po.saleId, companyId });
                    if (sale?.order) order = await Order.findById(sale.order).select('-quotation').populate('customer').populate('products.product');
                }
            }
            if (!sale && job.qcJobId) {
                const qj = await QCJob.findById(job.qcJobId).select('saleId').lean();
                if (qj?.saleId) {
                    sale = await Sale.findOne({ _id: qj.saleId, companyId });
                    if (sale?.order) order = await Order.findById(sale.order).select('-quotation').populate('customer').populate('products.product');
                }
            }
            if (!sale) {
                const po2 = await ProductionOrder.findOne({ orderId: job.orderId, company: companyId }).select('saleId').lean();
                if (po2?.saleId) {
                    sale = await Sale.findOne({ _id: po2.saleId, companyId });
                    if (sale?.order) order = await Order.findById(sale.order).select('-quotation').populate('customer').populate('products.product');
                }
            }
        }

        if (!order) return res.status(404).json({ success: false, message: 'Order not found for this job' });

        // `sale` above may have resolved to Store's internal placeholder
        // (isPlaceholder: true) — fine for locating `order`, but it must
        // never be treated as a real invoice for the bill's amounts/GST.
        const realSale = sale && !sale.isPlaceholder ? sale : null;

        // 3. Order Form — authoritative for Total/Advance/Paid/Due, same
        // formula as Customer Master's order-financials breakdown, so the
        // Due Bill and Customer Master → Orders view never disagree.
        const form = await OrderForm.findOne({ orderId: order._id, status: 'Submitted' })
            .select('items totals receivedAmount paymentType').lean();

        // 4. Build advance payment history (with dates)
        let advancePayments = [];
        let leadPayments = [];
        if (order.leadId) {
            leadPayments = await LeadPayment.find({
                leadId: order.leadId,
                status: 'Verified',
                companyId
            }).sort({ paymentDate: 1 }).lean();

            advancePayments = leadPayments.map(p => ({
                date: p.paymentDate,
                amount: p.amount,
                mode: p.paymentMethod,
                transactionId: p.transactionId || '',
                remarks: p.remarks || ''
            }));
        }

        // 5. Post-invoice payments received (CustomerPayment records) —
        // order-wise: this order's receipts + legacy/general (unlinked) ones
        let postInvoicePayments = [];
        let orderPayments = [];
        if (order.customer?._id) {
            const custPays = await CustomerPayment.find({
                customer: order.customer._id,
                companyId,
                $or: [{ order: order._id }, { order: null }]
            }).sort({ paymentDate: 1 }).lean();

            postInvoicePayments = custPays.map(p => ({
                date: p.paymentDate,
                amount: p.amount,
                mode: p.paymentMode,
                referenceNo: p.referenceNo || '',
                notes: p.notes || '',
                orderCode: p.orderCode || ''
            }));
            orderPayments = custPays.filter(p => p.order && p.order.toString() === order._id.toString());
        }

        // 6. Amounts — Order Form is authoritative when submitted (never the
        // original quotation's Order.totalAmount); fall back to the
        // invoice/order value only for legacy orders with no form on file.
        let subtotal, taxAmount, totalAmount, advancedPaymentAmount, paidAmount, balanceAmount, paymentStatus, additionalCharges = 0;
        if (form) {
            const fin = computeOrderFinancials({ form, sale: realSale, orderPayments, leadPayments });
            subtotal = fin.subtotal;
            taxAmount = fin.gst;
            totalAmount = fin.total;
            advancedPaymentAmount = fin.advance;
            paidAmount = fin.paid;
            balanceAmount = fin.due;
            paymentStatus = fin.paymentStatus;
            additionalCharges = fin.additionalCharges;
        } else {
            advancedPaymentAmount = realSale?.advancedPaymentAmount || 0;
            if (!advancedPaymentAmount && leadPayments.length > 0) {
                advancedPaymentAmount = leadPayments.reduce((s, p) => s + (p.amount || 0), 0);
            }
            subtotal = realSale ? realSale.subtotal : (order.totalAmount || 0);
            taxAmount = realSale ? realSale.taxAmount : Math.round((order.totalAmount || 0) * 0.18);
            totalAmount = realSale ? realSale.totalAmount : (subtotal + taxAmount);
            paidAmount = realSale ? (realSale.paidAmount || 0) : 0;
            balanceAmount = realSale ? realSale.balanceAmount : Math.max(0, totalAmount - advancedPaymentAmount);
            paymentStatus = realSale?.paymentStatus || (advancedPaymentAmount >= totalAmount ? 'Paid' : advancedPaymentAmount > 0 ? 'Partially Paid' : 'Pending');
        }
        const gstType = realSale?.gstType || 'CGST_SGST';
        const invoiceNumber = realSale?.invoiceNumber || null;
        const saleDate = realSale?.saleDate || order.orderDate;
        const dueDate  = realSale?.dueDate || null;

        // 6b. Customer master reference fields (kept for info display)
        const customerMasterDoc = await Customer.findById(order.customer?._id)
            .select('outstandingAmount advancePayment')
            .lean();
        const customerOutstanding = customerMasterDoc?.outstandingAmount || 0;
        const customerAdvance     = customerMasterDoc?.advancePayment    || 0;
        // ORDER-WISE display values — the due bill belongs to ONE order:
        // Total = this order's invoice total, Paid = advance + receipts
        // against this order, Due = what's left on this order
        const displayTotal = totalAmount;
        const displayPaid  = advancedPaymentAmount + paidAmount;
        const displayDue   = balanceAmount;

        // 6. Fetch company info
        const { Company } = await import('../models/Company.js');
        const company = await Company.findById(companyId).lean();

        res.json({
            success: true,
            data: {
                // Identifiers
                jobId: job._id,
                jobCode: job.jobId,
                orderCode: order.orderCode,
                invoiceNumber,
                saleDate,
                dueDate,
                packedDate: job.packingCompleteTime || job.updatedAt,
                billDate: new Date(),

                // Machine/serial
                machineName: job.machineName || '',
                machineCode: job.machineCode || '',
                serialNumber: job.serialNumber || '',

                // Customer
                customer: {
                    id: order.customer?._id,
                    name: order.customer?.name || 'N/A',
                    mobile: order.customer?.mobile || '',
                    email: order.customer?.email || '',
                    address: order.customer?.address1 || '',
                    city: order.customer?.city || '',
                    state: order.customer?.state || '',
                    gstin: order.customer?.gstin || order.customer?.gst || ''
                },

                // Items — same source of truth as Customer Master's
                // order-financials breakdown: the live Order Form's items,
                // Amount = Bill Amount + its own GST share (already
                // GST-inclusive), so the rows here always add up to the
                // Taxable Amount / Total below. Includes additional-charge
                // rows (Installation, Freight, etc.) as their own line too.
                // The invoice's own item snapshot (realSale.items) is a
                // point-in-time copy taken when the invoice was generated —
                // it goes stale if the Order Form is revised afterward, so
                // it's only used as a fallback for legacy orders with no
                // Order Form on file.
                items: (form?.items?.length
                    ? form.items.map(it => ({
                        productName: it.itemName || 'Item',
                        quantity: it.qty || 0,
                        total: (it.billAmount || 0) + (it.gstAmount || 0)
                      }))
                    : null)
                    || (realSale?.items?.length ? realSale.items.map(it => ({
                        productName: it.productName || 'Item',
                        quantity: it.quantity,
                        total: it.totalPrice
                      })) : null)
                    || order.products.map(p => ({
                        productName: p.product?.name || 'Unknown Item',
                        quantity: p.quantity,
                        total: p.total
                      })),

                // Financials
                subtotal,
                taxAmount,
                gstType,
                totalAmount,
                advancedPaymentAmount,
                paidAmount,
                balanceAmount,
                paymentStatus,
                additionalCharges,

                // Customer master financial fields (for PDF display)
                customerOutstanding,
                customerAdvance,
                displayTotal,
                displayPaid,
                displayDue,

                // Payment history
                advancePayments,
                postInvoicePayments,

                // Company
                company: {
                    name: company?.name || company?.unitName || 'SAMTEK MACHINERY',
                    legalName: company?.legalName || '',
                    address: company?.address || '',
                    city: company?.city || '',
                    state: company?.state || '',
                    pin: company?.locationPin || '',
                    mobile: company?.mobile || '',
                    email: company?.email || '',
                    gst: company?.gst || '',
                    pan: company?.pan || '',
                    website: company?.website || '',
                    stampUrl: company?.stampUrl || ''
                }
            }
        });
    } catch (error) {
        console.error('Error in getDueBillData:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const uploadPaymentProof = async (req, res) => {
    try {
        const { saleId } = req.params;
        const Sale = (await import('../models/Sale.js')).default;

        const sale = await Sale.findOne({ _id: saleId, companyId: req.user.companyId });
        if (!sale) {
            return res.status(404).json({ success: false, message: 'Sale Invoice not found' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a payment proof file' });
        }

        sale.paymentProofUrl = `/uploads/payment-proofs/${req.file.filename}`;
        await sale.save();

        res.json({
            success: true,
            message: 'Payment proof uploaded successfully',
            paymentProofUrl: sale.paymentProofUrl
        });
    } catch (error) {
        console.error('Error in uploadPaymentProof:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
