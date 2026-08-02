import PurchaseInvoice from '../models/PurchaseInvoice.js';
import VendorPayment from '../models/VendorPayment.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import Supplier from '../models/Supplier.js';
import { Item } from '../models/Inventory.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';
import { recalculateItemPricing } from '../services/itemPricingService.js';

// Recalculates purchase-derived cost/MRP/Sale Price for every Item referenced
// on a newly recorded Purchase Invoice — the most reliable "price actually
// paid" data point (its item ref is required, unlike Purchase.items.item).
async function recalcPricingForInvoiceItems(invoice) {
    for (const line of invoice.items || []) {
        if (!line.item) continue;
        try {
            const item = await Item.findById(line.item);
            if (item && item.purchase && !item.internalManufacturing) {
                await recalculateItemPricing(item);
            }
        } catch (e) {
            console.error('❌ Error recalculating item pricing from purchase invoice:', e);
        }
    }
}

/**
 * Create a new Purchase Invoice and auto-post to ledger
 */
export const createPurchaseInvoice = async (req, res) => {
    try {
        const {
            vendorId, invoiceNo, invoiceDate, dueDate, items,
            subtotal, gstAmount, totalAmount, tdsAmount, tdsPercent, notes
        } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;

        if (!companyId || !unit) {
            throw new Error('Your account is missing mandatory Company or Unit assignment. Please contact admin.');
        }

        // 1. Check for duplicate invoice
        const existing = await PurchaseInvoice.findOne({ vendor: vendorId, invoiceNo });
        if (existing) {
            throw new Error(`Duplicate invoice number "${invoiceNo}" already exists for this vendor.`);
        }

        // 2. Check if vendor is active
        const vendor = await Supplier.findById(vendorId);
        if (!vendor || vendor.status === 'inactive') {
            throw new Error('Vendor is inactive or not found');
        }

        // 3. Create Invoice
        const invoice = new PurchaseInvoice({
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
        await invoice.save();
        recalcPricingForInvoiceItems(invoice).catch(e => console.error('❌ Pricing recalc error (createPurchaseInvoice):', e));

        // 4. Auto Journal Posting
        const purchaseAccount = await Account.findOne({ accountName: 'Purchase Account', unit });
        const gstAccount = await Account.findOne({ accountName: 'Input GST', unit });
        const payableAccount = await Account.findOne({ accountName: 'Accounts Payable', unit });
        const tdsPayableAccount = await Account.findOne({ accountName: 'TDS Payable', unit });

        if (purchaseAccount && gstAccount && payableAccount) {
            const entries = [
                { account: purchaseAccount._id, debit: subtotal, credit: 0 },
                { account: gstAccount._id, debit: gstAmount, credit: 0 },
                { account: payableAccount._id, debit: 0, credit: totalAmount }
            ];

            if (tdsAmount > 0 && tdsPayableAccount) {
                entries.push({ account: tdsPayableAccount._id, debit: 0, credit: tdsAmount });
            }

            const txn = new Transaction({
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
            await txn.save();

            // Update account balances
            purchaseAccount.balance += subtotal;
            gstAccount.balance += gstAmount;
            payableAccount.balance += totalAmount;
            
            if (tdsAmount > 0 && tdsPayableAccount) {
                tdsPayableAccount.balance += tdsAmount;
                await tdsPayableAccount.save();
            }

            await purchaseAccount.save();
            await gstAccount.save();
            await payableAccount.save();
        }

        res.status(201).json({ success: true, data: invoice });
    } catch (error) {
        console.error('❌ Error in createPurchaseInvoice:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Get Purchase Invoices for the company
 */
export const getPurchaseInvoices = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        const query = { companyId: req.user.companyId };

        if (status && status !== 'All') query.status = status;
        if (search) {
            query.$or = [
                { invoiceNo: { $regex: search, $options: 'i' } }
            ];
        }

        const invoices = await PurchaseInvoice.find(query)
            .populate('vendor', 'supplierName gstNumber')
            .sort({ invoiceDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await PurchaseInvoice.countDocuments(query);

        res.json({
            success: true,
            data: {
                invoices,
                pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Record Vendor Payment
 */
export const createVendorPayment = async (req, res) => {
    try {
        const { vendorId, paymentDate, amount, paymentMode, referenceNo, notes } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;

        if (!amount || amount <= 0) {
            throw new Error('Payment amount must be greater than zero.');
        }

        // 0. Resolve bank/cash account and verify sufficient balance BEFORE
        // creating any payment/invoice records, so an insufficient-balance
        // rejection never leaves a partial payment behind.
        const bankAccount = req.body.accountId
            ? await Account.findById(req.body.accountId)
            : await Account.findOne({ isBankOrCash: true, unit });

        if (!bankAccount) {
            throw new Error('Bank or Cash account not found for payment. Please create one in Bank & Cash module.');
        }

        if (bankAccount.balance < amount) {
            throw new Error(`Insufficient funds in ${bankAccount.accountName}. Available: ₹${bankAccount.balance}`);
        }

        // 1. Create Payment record
        const payment = new VendorPayment({
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
        await payment.save();

        // 2. Update Invoices (FIFO logic)
        let remainingAmount = amount;
        const unpaidInvoices = await PurchaseInvoice.find({
            vendor: vendorId,
            status: { $ne: 'Paid' }
        }).sort({ invoiceDate: 1 });

        for (const inv of unpaidInvoices) {
            if (remainingAmount <= 0) break;
            const payToThis = Math.min(inv.balanceAmount, remainingAmount);
            inv.paidAmount += payToThis;
            inv.balanceAmount -= payToThis;
            remainingAmount -= payToThis;
            await inv.save();
        }

        // 3. Ledger Posting
        let payableAccount = await Account.findOne({ accountName: 'Accounts Payable', unit });
        if (!payableAccount) {
            payableAccount = new Account({
                accountNumber: `AP-${unit.replace(/\s+/g, '-')}-${Date.now()}`,
                accountName: 'Accounts Payable',
                accountType: 'Liability',
                balance: 0,
                unit,
                companyId,
                description: 'Auto-generated account for vendor payables'
            });
            await payableAccount.save();
        }

        if (payableAccount && bankAccount) {
            const txn = new Transaction({
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
            await txn.save();

            payableAccount.balance -= amount;
            bankAccount.balance -= amount;

            await payableAccount.save();
            await bankAccount.save();
        }

        res.json({ success: true, data: payment });
    } catch (error) {
        console.error('❌ Error in createVendorPayment:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Get Vendor Outstanding / Payable Ageing
 */
export const getVendorOutstanding = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { vendorId } = req.query;

        let matchQuery = {
            companyId: new mongoose.Types.ObjectId(companyId),
            balanceAmount: { $gt: 0 }
        };

        if (vendorId) {
            matchQuery.vendor = new mongoose.Types.ObjectId(vendorId);
        }

        const outstandingData = await PurchaseInvoice.aggregate([
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
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Create Purchase Return
 */
export const createPurchaseReturn = async (req, res) => {
    try {
        const { vendorId, invoiceId, returnDate, items, totalAmount, reason, bankAccountId } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;

        // 1. Create Return Record
        const pReturn = new PurchaseReturn({
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
        await pReturn.save();

        // 2. Update Inventory
        for (const item of items) {
            if (item.item) {
                await Item.findByIdAndUpdate(item.item, {
                    $inc: { qty: -item.quantity }
                });
            }
        }

        // 3. Update Invoice Balance
        if (invoiceId) {
            const invoice = await PurchaseInvoice.findById(invoiceId);
            if (invoice) {
                invoice.balanceAmount -= totalAmount;
                await invoice.save();
            }
        }

        // 4. Ledger Posting
        let payableAccount = await Account.findOne({ accountName: 'Accounts Payable', unit });
        let purchaseReturnAccount = await Account.findOne({ accountName: 'Purchase Return', unit });

        if (!payableAccount) {
            payableAccount = new Account({
                accountName: 'Accounts Payable',
                accountNumber: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Liability',
                unit,
                balance: 0
            });
            await payableAccount.save();
        }

        if (!purchaseReturnAccount) {
            purchaseReturnAccount = new Account({
                accountName: 'Purchase Return',
                accountNumber: `PRT-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Revenue',
                unit,
                balance: 0
            });
            await purchaseReturnAccount.save();
        }

        if (payableAccount && purchaseReturnAccount) {
            const txn = new Transaction({
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
            await txn.save();

            if (bankAccountId && bankAccountId !== 'none') {
                const bankAccount = await Account.findById(bankAccountId);
                if (bankAccount) {
                    const refundTxn = new Transaction({
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
                    await refundTxn.save();
                    bankAccount.balance += totalAmount;
                    payableAccount.balance += totalAmount;
                    await bankAccount.save();
                }
            }

            payableAccount.balance -= totalAmount;
            purchaseReturnAccount.balance += totalAmount;

            await payableAccount.save();
            await purchaseReturnAccount.save();
        }

        res.status(201).json({ success: true, data: pReturn });
    } catch (error) {
        console.error('❌ Error in createPurchaseReturn:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Get Purchase Returns
 */
export const getPurchaseReturns = async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const query = { companyId: req.user.companyId };

        if (search) {
            query.$or = [
                { reason: { $regex: search, $options: 'i' } }
            ];
        }

        const returns = await PurchaseReturn.find(query)
            .populate('vendor', 'supplierName')
            .populate('items.item', 'name code')
            .sort({ returnDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await PurchaseReturn.countDocuments(query);

        res.json({
            success: true,
            data: {
                returns,
                pagination: { total, page: parseInt(page), limit: parseInt(limit) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get single Purchase Return by ID
 */
export const getPurchaseReturnById = async (req, res) => {
    try {
        const ret = await PurchaseReturn.findOne({
            _id: req.params.id,
            companyId: req.user.companyId
        })
            .populate('vendor', 'supplierName email phone gstNumber')
            .populate('items.item', 'name code');

        if (!ret) return res.status(404).json({ success: false, message: 'Return not found' });
        res.json({ success: true, data: ret });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Update Purchase Return (reason, items, totalAmount, returnDate)
 */
export const updatePurchaseReturn = async (req, res) => {
    try {
        const { reason, returnDate, totalAmount, items } = req.body;
        const ret = await PurchaseReturn.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!ret) return res.status(404).json({ success: false, message: 'Return not found' });

        if (reason !== undefined) ret.reason = reason;
        if (returnDate !== undefined) ret.returnDate = returnDate;
        if (totalAmount !== undefined) ret.totalAmount = totalAmount;
        if (items !== undefined) ret.items = items;

        await ret.save();
        res.json({ success: true, data: ret, message: 'Return updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Purchase Summary for Reports
 */
export const getPurchaseSummary = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // 1. Total Purchases (Lifetime) & Month Purchases
        const totalPurchasesPromise = PurchaseInvoice.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
            { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
        ]);

        const monthPurchasesPromise = PurchaseInvoice.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId), invoiceDate: { $gte: firstDayOfMonth } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        const totalReturnsPromise = PurchaseReturn.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        // 2. Vendor-wise spending (Top 5)
        const vendorSpendingPromise = PurchaseInvoice.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
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
        const categorySpendingPromise = PurchaseInvoice.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
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

        const monthlyTrendPromise = PurchaseInvoice.aggregate([
            { $match: { companyId: new mongoose.Types.ObjectId(companyId), invoiceDate: { $gte: sixMonthsAgo } } },
            {
                $group: {
                    _id: { month: { $month: '$invoiceDate' }, year: { $year: '$invoiceDate' } },
                    amount: { $sum: '$totalAmount' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        const [
            totalPurchases,
            monthPurchases,
            totalReturns,
            vendorSpending,
            categorySpending,
            monthlyTrend
        ] = await Promise.all([
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
                totalPurchases: totalPurchases[0]?.total || 0,
                purchaseCount: totalPurchases[0]?.count || 0,
                monthPurchases: monthPurchases[0]?.total || 0,
                totalReturns: totalReturns[0]?.total || 0,
                vendorSpending,
                categorySpending,
                monthlyTrend
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Vendor Payment Statistics (Monthly Total & Modes Breakdown)
 */
export const getPaymentStats = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const stats = await VendorPayment.aggregate([
            {
                $match: {
                    companyId: new mongoose.Types.ObjectId(companyId),
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

        const totalPaid = stats[0]?.totalPaid[0]?.total || 0;
        const modes = stats[0]?.modesBreakdown || [];

        // Calculate percentages
        const modesWithPercentage = modes.map(m => ({
            ...m,
            percentage: totalPaid > 0 ? Math.round((m.total / totalPaid) * 100) : 0
        }));

        res.json({
            success: true,
            data: {
                totalPaid,
                modes: modesWithPercentage
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get items purchased from a specific vendor
 */
export const getVendorPurchasedItems = async (req, res) => {
    try {
        const { vendorId } = req.query;
        const unit = req.user.unit;
        const companyId = req.user.companyId;

        if (!vendorId) {
            return res.status(400).json({ success: false, message: 'Vendor ID is required' });
        }

        const items = await PurchaseInvoice.aggregate([
            {
                $match: {
                    vendor: new mongoose.Types.ObjectId(vendorId),
                    unit: unit,
                    companyId: new mongoose.Types.ObjectId(companyId)
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
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * For Dropdown: Get all active suppliers for the unit
 */
export const getSuppliersForAccounts = async (req, res) => {
    try {
        const unit = req.user.unit;

        // Allow suppliers from specific unit OR 'Main' unit (common suppliers)
        const suppliers = await Supplier.find({
            unit: { $in: [unit, 'Main'] },
            status: 'active'
        }).sort({ supplierName: 1 });

        res.json({ success: true, data: suppliers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Auto-creates a Purchase Return when a purchased product fails QC inspection.
 */

// Resolves the vendor (Supplier) and originating Purchase PO for a
// Purchase-sourced QC job that got rejected — shared by the accounting
// Purchase Return (below) and the Purchase Exchange workflow
// (purchaseExchangeController.js). Follows the real DB reference chain
// (QCJob → PurchaseRequest → Purchase → Supplier) instead of guessing, and
// returns null values if it can't be resolved with confidence — callers
// must NOT fabricate a fallback vendor (a wrong vendor is worse than none).
export const resolveVendorAndPOForQCRejectedPurchase = async (qcJob) => {
    const Purchase = mongoose.model('Purchase');
    const PurchaseRequest = mongoose.model('PurchaseRequest');

    let po = null;
    let pr = null;

    // Strategy 1 (most reliable): direct reference set when the QC job was created.
    if (qcJob.purchaseRequestId) {
        pr = await PurchaseRequest.findById(qcJob.purchaseRequestId).populate({
            path: 'purchaseOrder',
            populate: { path: 'supplier' }
        });
        if (pr && pr.purchaseOrder) po = pr.purchaseOrder;
    }

    // Strategy 2: match the PO number against sourceRefId.
    if (!po && qcJob.sourceRefId) {
        po = await Purchase.findOne({ purchaseOrderNumber: qcJob.sourceRefId }).populate('supplier');
    }

    // Strategy 3: match requestId/itemCode against PurchaseRequest.
    if (!po) {
        pr = await PurchaseRequest.findOne({
            $or: [
                { requestId: qcJob.sourceRefId },
                { requestId: qcJob.itemCode }
            ]
        }).populate({
            path: 'purchaseOrder',
            populate: { path: 'supplier' }
        });
        if (pr && pr.purchaseOrder) po = pr.purchaseOrder;
    }

    const supplierId = (po && po.supplier) ? (po.supplier._id || po.supplier) : null;
    return { po, pr, supplierId };
};

export const createQCRejectedPurchaseReturn = async (qcJob, user, qty) => {
    try {
        const companyId = qcJob.company;
        const unit = user.unit || 'Main';

        // 1. Find Supplier/Vendor
        const { po, supplierId } = await resolveVendorAndPOForQCRejectedPurchase(qcJob);

        if (!supplierId) {
            console.error(`❌ [QC Rejection Return] Could not confidently resolve vendor for QC Job ${qcJob.qcJobId} — skipping auto Purchase Return. File it manually against the correct vendor.`);
            return null;
        }

        // 2. Find Item from inventory
        let inventoryItem = null;
        // Attempt 1: Search by ObjectId
        if (qcJob.itemCode && /^[0-9a-fA-F]{24}$/.test(qcJob.itemCode)) {
            inventoryItem = await Item.findById(qcJob.itemCode);
        }
        
        // Attempt 2: Search by Code
        if (!inventoryItem && qcJob.itemCode) {
            inventoryItem = await Item.findOne({
                code: qcJob.itemCode,
                companyId: companyId
            });
        }
        
        // Attempt 3: Search by Name
        if (!inventoryItem && qcJob.itemName) {
            inventoryItem = await Item.findOne({
                name: qcJob.itemName,
                companyId: companyId
            });
        }

        // 3. Price calculation
        let unitPrice = 0;
        if (po && po.items) {
            const poItem = po.items.find(i => 
                i.itemName.toLowerCase() === qcJob.itemName.toLowerCase() || 
                (inventoryItem && String(i.item) === String(inventoryItem._id))
            );
            if (poItem) {
                unitPrice = poItem.unitPrice;
            }
        }
        
        if (unitPrice === 0 && inventoryItem) {
            unitPrice = inventoryItem.purchaseCost || inventoryItem.stdCost || 100;
        } else if (unitPrice === 0) {
            unitPrice = 100;
        }

        const returnQty = qty || qcJob.quantity || 1;
        const totalPrice = unitPrice * returnQty;

        // 4. Find linked PurchaseInvoice if exists
        let invoiceId = undefined;
        const PurchaseInvoiceModel = mongoose.model('PurchaseInvoice');
        if (supplierId) {
            const invoice = await PurchaseInvoiceModel.findOne({
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
                await invoice.save();
            }
        }

        // 5. Create Return record
        const items = [{
            item: inventoryItem ? inventoryItem._id : new mongoose.Types.ObjectId(),
            itemName: qcJob.itemName,
            quantity: returnQty,
            unitPrice: unitPrice,
            gstPercent: 18,
            gstAmount: Math.round(totalPrice * 0.18),
            totalPrice: totalPrice
        }];

        const pReturn = new PurchaseReturn({
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

        await pReturn.save();
        console.log(`✅ [QC Rejection Return] Recorded Purchase Return successfully for ${qcJob.itemName}`);

        // 6. Ledger Posting
        let payableAccount = await Account.findOne({ accountName: 'Accounts Payable', unit });
        let purchaseReturnAccount = await Account.findOne({ accountName: 'Purchase Return', unit });

        if (!payableAccount) {
            payableAccount = new Account({
                accountName: 'Accounts Payable',
                accountNumber: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Liability',
                unit,
                companyId,
                balance: 0
            });
            await payableAccount.save();
        }

        if (!purchaseReturnAccount) {
            purchaseReturnAccount = new Account({
                accountName: 'Purchase Return',
                accountNumber: `PRT-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
                accountType: 'Revenue',
                unit,
                companyId,
                balance: 0
            });
            await purchaseReturnAccount.save();
        }

        if (payableAccount && purchaseReturnAccount) {
            const txn = new Transaction({
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
            await txn.save();

            payableAccount.balance -= totalPrice;
            purchaseReturnAccount.balance += totalPrice;

            await payableAccount.save();
            await purchaseReturnAccount.save();
            console.log(`✅ [QC Rejection Return] Posted transaction to ledger successfully`);
        }

        return pReturn;
    } catch (error) {
        console.error('❌ Error creating QC-rejected purchase return:', error);
        throw error;
    }
};

/**
 * Auto-creates a Purchase Invoice when a purchase request is received.
 */
export const createAutoPurchaseInvoice = async (purchaseRequest, user) => {
    try {
        const companyId = purchaseRequest.companyId;
        const unit = user.unit || 'Main';

        // 1. Populate purchase order if not populated
        const PurchaseRequestModel = mongoose.model('PurchaseRequest');
        let request = purchaseRequest;
        
        request = await PurchaseRequestModel.findById(purchaseRequest._id).populate({
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
        } else {
            // Fallback: search for active supplier
            const Supplier = mongoose.model('Supplier');
            const fallbackSupplier = await Supplier.findOne({ status: 'active' });
            if (fallbackSupplier) {
                vendorId = fallbackSupplier._id;
            }
        }

        if (!vendorId) {
            console.error('❌ [Auto Invoice] Could not identify vendor/supplier for invoice.');
            return null;
        }

        // 3. Generate invoice number
        const poNumber = request.purchaseOrder?.purchaseOrderNumber || request.requestId;
        const invoiceNo = `INV-PO-${poNumber}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        // 4. Duplicate invoice check — by invoiceNo (existing) AND by requestId in notes (new guard)
        // This prevents double-invoice when PO creates it AND Received also tries to create it
        const existingByNotes = await PurchaseInvoice.findOne({
            vendor: vendorId,
            companyId,
            notes: { $regex: request.requestId, $options: 'i' }
        });
        if (existingByNotes) {
            console.log(`ℹ️ [Auto Invoice] Invoice already exists for PR ${request.requestId} — returning existing, no duplicate.`);
            return existingByNotes;
        }

        const existing = await PurchaseInvoice.findOne({ vendor: vendorId, invoiceNo });
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
        } else {
            // Build single item from request
            const itemTotal = (request.quantity || 1) * 100;
            subtotal += itemTotal;
            items = [{
                item: request.itemId && /^[0-9a-fA-F]{24}$/.test(request.itemId) 
                    ? new mongoose.Types.ObjectId(request.itemId) 
                    : new mongoose.Types.ObjectId(),
                itemName: request.productName,
                quantity: request.quantity || 1,
                unitPrice: 100,
                totalPrice: itemTotal
            }];
        }

        // Vendor's bid price (copied verbatim from the PO items above) is used
        // as-is — GST is never added on top of it internally.
        const gstAmount = 0;
        const totalAmount = subtotal;

        // 6. Create Invoice
        const invoice = new PurchaseInvoice({
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
            notes: `Auto-generated on PO creation. Purchase Request: ${request.requestId}. PO: ${request.purchaseOrder?.purchaseOrderNumber || 'N/A'}`
        });

        await invoice.save();
        console.log(`✅ [Auto Invoice] Purchase Invoice ${invoiceNo} recorded successfully.`);
        recalcPricingForInvoiceItems(invoice).catch(e => console.error('❌ Pricing recalc error (createAutoPurchaseInvoice):', e));

        // 7. Auto Journal Posting to General Ledger
        const purchaseAccount = await Account.findOne({ accountName: 'Purchase Account', unit });
        const gstAccount = await Account.findOne({ accountName: 'Input GST', unit });
        const payableAccount = await Account.findOne({ accountName: 'Accounts Payable', unit });

        if (purchaseAccount && gstAccount && payableAccount) {
            const entries = [
                { account: purchaseAccount._id, debit: subtotal, credit: 0 },
                { account: gstAccount._id, debit: gstAmount, credit: 0 },
                { account: payableAccount._id, debit: 0, credit: totalAmount }
            ];

            const txn = new Transaction({
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
            await txn.save();

            // Update account balances
            purchaseAccount.balance += subtotal;
            gstAccount.balance += gstAmount;
            payableAccount.balance += totalAmount;

            await purchaseAccount.save();
            await gstAccount.save();
            await payableAccount.save();
            console.log(`✅ [Auto Invoice] Posted transaction to ledger successfully`);
        }

        return invoice;
    } catch (error) {
        console.error('❌ Error creating auto purchase invoice:', error);
        throw error;
    }
};


