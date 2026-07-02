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

        // 3a. Fetch advanced payment for linked lead (if order has leadId)
        let advancedPaymentAmount = 0;
        if (orderId) {
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

        // Net payable after deducting advanced payment
        const netPayable = Math.max(0, finalTotalAmount - advancedPaymentAmount);

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
            advancedPaymentAmount,
            paidAmount: advancedPaymentAmount, // advanced already paid
            balanceAmount: netPayable,
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

        // 6. Update Customer Outstanding Amount (net of advanced payment)
        await Customer.findByIdAndUpdate(customerId, {
            $inc: {
                outstandingAmount: netPayable,
                // Deduct from advancePayment balance if advanced was used
                advancePayment: -advancedPaymentAmount
            }
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
        const LeadPayment = (await import('../models/LeadPayment.js')).default;

        const query = {
            companyId: req.user.companyId,
            status: { $in: ['approved', 'completed'] }
        };

        const orders = await Order.find(query)
            .populate('customer', 'name mobile email gstin address1 city state pin contactPerson customerCode')
            .populate('products.product', 'name price brand unit')
            .sort({ orderDate: -1 })
            .lean();

        // Enrich with invoicing status + advanced payment from linked lead
        const ordersWithInvoices = await Promise.all(orders.map(async (order) => {
            const invoices = await Sale.find({ order: order._id }).select('invoiceType');

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

        const results = [];

        for (const job of packedJobs) {
            let order = null;
            let sale = null;

            // Primary lookup: find Order by orderCode matching job.orderId (standard sales flow)
            order = await Order.findOne({
                orderCode: job.orderId,
                companyId
            }).populate('customer').populate('products.product');

            if (order) {
                // Found order via orderCode — find the linked Sale
                sale = await Sale.findOne({ order: order._id, companyId });
            } else {
                // Fallback: packaging job was created from a ProductionOrder or QCJob
                // Try to find the Sale directly via saleId on those source records
                if (job.productionOrderId) {
                    const prodOrder = await ProductionOrder.findById(job.productionOrderId).select('saleId').lean();
                    if (prodOrder?.saleId) {
                        sale = await Sale.findOne({ _id: prodOrder.saleId, companyId });
                        if (sale?.order) {
                            order = await Order.findById(sale.order).populate('customer').populate('products.product');
                        }
                    }
                }
                if (!sale && job.qcJobId) {
                    const qcJob = await QCJob.findById(job.qcJobId).select('saleId').lean();
                    if (qcJob?.saleId) {
                        sale = await Sale.findOne({ _id: qcJob.saleId, companyId });
                        if (sale?.order) {
                            order = await Order.findById(sale.order).populate('customer').populate('products.product');
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
                            order = await Order.findById(sale.order).populate('customer').populate('products.product');
                        }
                    }
                }
            }

            // If still no order found, skip this job (no associated sales order exists)
            if (!order) continue;

            let advancedPaymentAmount = sale?.advancedPaymentAmount || 0;
            if (sale && !advancedPaymentAmount && order.leadId) {
                const LeadPayment = (await import('../models/LeadPayment.js')).default;
                const leadPayments = await LeadPayment.find({
                    leadId: order.leadId,
                    status: 'Verified',
                    companyId
                }).select('amount').lean();
                advancedPaymentAmount = leadPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
            }

            const totalAmount = sale
              ? sale.totalAmount
              : Math.round((order.totalAmount || 0) * 1.18); // No invoice yet → add 18% GST to order value
            const paidAmount = sale ? (sale.paidAmount || 0) : advancedPaymentAmount;
            const balanceAmount = sale ? sale.balanceAmount : Math.max(0, totalAmount - advancedPaymentAmount);
            const paymentStatus = sale ? sale.paymentStatus : (advancedPaymentAmount >= totalAmount ? 'Paid' : (advancedPaymentAmount > 0 ? 'Partially Paid' : 'Pending'));
            const paymentProofUrl = sale ? sale.paymentProofUrl : '';
            const saleId = sale ? sale._id : null;

            results.push({
                jobId: job._id,
                jobCode: job.jobId,
                orderId: order._id,
                orderCode: order.orderCode,
                packedDate: job.packingCompleteTime || job.updatedAt,
                machineName: job.machineName,
                machineCode: job.machineCode,
                serialNumber: job.serialNumber,
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
                saleId
            });
        }

        res.json({ success: true, data: results });
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

        // 1. Find the packaging job
        const job = await PackagingJob.findOne({ _id: jobId, company: companyId });
        if (!job) return res.status(404).json({ success: false, message: 'Packaging job not found' });

        // 2. Resolve Order + Sale (same fallback chain as getPackedOrders)
        let order = null;
        let sale  = null;

        order = await Order.findOne({ orderCode: job.orderId, companyId })
            .populate('customer')
            .populate('products.product');

        if (order) {
            sale = await Sale.findOne({ order: order._id, companyId });
        } else {
            if (job.productionOrderId) {
                const po = await ProductionOrder.findById(job.productionOrderId).select('saleId').lean();
                if (po?.saleId) {
                    sale = await Sale.findOne({ _id: po.saleId, companyId });
                    if (sale?.order) order = await Order.findById(sale.order).populate('customer').populate('products.product');
                }
            }
            if (!sale && job.qcJobId) {
                const qj = await QCJob.findById(job.qcJobId).select('saleId').lean();
                if (qj?.saleId) {
                    sale = await Sale.findOne({ _id: qj.saleId, companyId });
                    if (sale?.order) order = await Order.findById(sale.order).populate('customer').populate('products.product');
                }
            }
            if (!sale) {
                const po2 = await ProductionOrder.findOne({ orderId: job.orderId, company: companyId }).select('saleId').lean();
                if (po2?.saleId) {
                    sale = await Sale.findOne({ _id: po2.saleId, companyId });
                    if (sale?.order) order = await Order.findById(sale.order).populate('customer').populate('products.product');
                }
            }
        }

        if (!order) return res.status(404).json({ success: false, message: 'Order not found for this job' });

        // 3. Build advance payment history (with dates)
        let advancePayments = [];
        let advancedPaymentAmount = sale?.advancedPaymentAmount || 0;

        if (order.leadId) {
            const leadPays = await LeadPayment.find({
                leadId: order.leadId,
                status: 'Verified',
                companyId
            }).sort({ paymentDate: 1 }).lean();

            advancePayments = leadPays.map(p => ({
                date: p.paymentDate,
                amount: p.amount,
                mode: p.paymentMethod,
                transactionId: p.transactionId || '',
                remarks: p.remarks || ''
            }));

            if (!advancedPaymentAmount && leadPays.length > 0) {
                advancedPaymentAmount = leadPays.reduce((s, p) => s + (p.amount || 0), 0);
            }
        }

        // 4. Post-invoice payments received (CustomerPayment records)
        let postInvoicePayments = [];
        if (order.customer?._id) {
            const custPays = await CustomerPayment.find({
                customer: order.customer._id,
                companyId
            }).sort({ paymentDate: 1 }).lean();

            postInvoicePayments = custPays.map(p => ({
                date: p.paymentDate,
                amount: p.amount,
                mode: p.paymentMode,
                referenceNo: p.referenceNo || '',
                notes: p.notes || ''
            }));
        }

        // 5. Amounts
        const subtotal   = sale ? sale.subtotal   : (order.totalAmount || 0);
        const taxAmount  = sale ? sale.taxAmount  : Math.round((order.totalAmount || 0) * 0.18);
        const totalAmount = sale ? sale.totalAmount : (subtotal + taxAmount);
        const paidAmount = sale ? (sale.paidAmount || 0) : 0;
        const balanceAmount = sale ? sale.balanceAmount : Math.max(0, totalAmount - advancedPaymentAmount);
        const gstType = sale?.gstType || 'CGST_SGST';
        const invoiceNumber = sale?.invoiceNumber || null;
        const saleDate = sale?.saleDate || order.orderDate;
        const dueDate  = sale?.dueDate || null;

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

                // Items
                items: order.products.map(p => ({
                    productName: p.product?.name || 'Unknown Item',
                    quantity: p.quantity,
                    unitPrice: p.price,
                    total: p.total,
                    tax: 0
                })),

                // Financials
                subtotal,
                taxAmount,
                gstType,
                totalAmount,
                advancedPaymentAmount,
                paidAmount,
                balanceAmount,
                paymentStatus: sale?.paymentStatus || (advancedPaymentAmount >= totalAmount ? 'Paid' : advancedPaymentAmount > 0 ? 'Partially Paid' : 'Pending'),

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
