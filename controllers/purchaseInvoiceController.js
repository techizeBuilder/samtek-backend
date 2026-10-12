import PurchaseInvoice from '../models/PurchaseInvoice.js';
import VendorPayment from '../models/VendorPayment.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import Supplier from '../models/Supplier.js';
import { Item } from '../models/Inventory.js';
import { Transaction, Account } from '../models/Account.js';
import mongoose from 'mongoose';
import { recalculateItemPricing } from '../services/itemPricingService.js';
import { postEntry, gstLines } from '../services/purchaseLedgerService.js';
import { payBill, payableNow } from '../services/purchaseBillService.js';

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
 * Record a manual bill ("Record New Bill") — for a purchase with no PO
 * (bills with no PO are revisited with the outsource flow). Posted to the
 * company + unit's own purchase accounts (2026-10-12): before, it looked
 * for accounts that existed nowhere and never posted. No TDS on the
 * purchase side (client, 2026-10-12).
 */
export const createPurchaseInvoice = async (req, res) => {
    try {
        const { vendorId, invoiceNo, invoiceDate, dueDate, items, notes } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;
        const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

        if (!companyId || !unit) {
            throw new Error('Your account is missing mandatory Company or Unit assignment. Please contact admin.');
        }
        if (!String(invoiceNo || '').trim()) throw new Error('Enter the vendor\'s invoice number.');
        if (!Array.isArray(items) || !items.length) throw new Error('Add at least one item.');

        // 1. Check for duplicate invoice
        const existing = await PurchaseInvoice.findOne({ vendor: vendorId, invoiceNo, companyId });
        if (existing) {
            throw new Error(`Duplicate invoice number "${invoiceNo}" already exists for this vendor.`);
        }

        // 2. Check if vendor is active
        const vendor = await Supplier.findOne({ _id: vendorId, companyId });
        if (!vendor || vendor.status === 'inactive') {
            throw new Error('Vendor is inactive or not found');
        }

        // 3. The figures — worked out here from the lines, not trusted.
        const lines = items.map(it => {
            const qty = Number(it.quantity) || 0;
            const price = Number(it.unitPrice) || 0;
            const pct = Math.min(100, Math.max(0, Number(it.gstPercent) || 0));
            const net = r2(qty * price);
            const gst = r2(net * pct / 100);
            return { item: it.item, itemName: it.itemName, quantity: qty, unitPrice: price, gstPercent: pct, gstAmount: gst, totalPrice: r2(net + gst) };
        });
        const subtotal = r2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
        const gstAmount = r2(lines.reduce((s, l) => s + l.gstAmount, 0));
        const totalAmount = r2(subtotal + gstAmount);
        const gstType = req.body.gstType === 'IGST' ? 'IGST' : 'CGST_SGST';

        const invoice = new PurchaseInvoice({
            vendor: vendorId,
            invoiceNo,
            invoiceDate,
            dueDate,
            items: lines,
            subtotal,
            gstAmount,
            totalAmount,
            gstType,
            balanceAmount: totalAmount,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        await invoice.save();
        recalcPricingForInvoiceItems(invoice).catch(e => console.error('❌ Pricing recalc error (createPurchaseInvoice):', e));

        // 4. Ledger: Dr Purchase + Input GST / Cr Accounts Payable.
        try {
            await postEntry({
                companyId, unit,
                lines: [
                    { key: 'purchase', debit: subtotal },
                    ...gstLines(gstAmount, gstType),
                    { key: 'accounts_payable', credit: totalAmount },
                ],
                description: `Purchase bill ${invoiceNo} from ${vendor.supplierName}`,
                reference: invoiceNo,
                relatedDocument: 'Purchase',
                relatedDocumentId: invoice._id,
                user: req.user,
            });
        } catch (postErr) {
            console.error('❌ Ledger posting for a manual bill failed:', postErr.message);
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
        const { page = 1, limit = 20, status, search, stage } = req.query;
        const query = { companyId: req.user.companyId };

        if (status && status !== 'All') query.status = status;
        // A PO bill's stage (2026-10-12): Advance due / Awaiting material / Payable / Paid / Cancelled.
        if (stage && stage !== 'All') query.stage = stage;
        if (search) {
            query.$or = [
                { invoiceNo: { $regex: search, $options: 'i' } },
                { notes: { $regex: search, $options: 'i' } }
            ];
        }

        const invoices = await PurchaseInvoice.find(query)
            .populate('vendor', 'supplierName gstNumber')
            // Lets the Billed Items table show each line's real purchase
            // unit next to its qty (2026-10) — previously a bare number,
            // ambiguous (20 what? pieces, kg, sheets?).
            .populate('items.item', 'purchaseUnit unit')
            .populate('purchaseOrder', 'purchaseOrderNumber status paymentTerms deliveryClock')
            .sort({ invoiceDate: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await PurchaseInvoice.countDocuments(query);

        res.json({
            success: true,
            data: {
                invoices: invoices.map(inv => ({ ...inv.toObject(), payableNow: inv.purchaseOrder ? payableNow(inv) : null })),
                pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Record Vendor Payment.
 *  - A PO bill (billId + kind 'Advance' | 'Payment'): services/purchaseBillService.js
 *    — the advance, or material that has passed QC (2026-10-12).
 *  - A manual bill (no PO): as before — one bill paid partly or fully,
 *    several paid in full, anything left oldest-first across the vendor's
 *    other manual bills. PO bills are never touched by this path.
 */
export const createVendorPayment = async (req, res) => {
    try {
        if (req.body.billId) {
            const result = await payBill({ billId: req.body.billId, body: req.body, user: req.user, req });
            if (result.status) return res.status(result.status).json({ success: false, message: result.message });
            return res.json({ success: true, data: result.payment, bill: result.bill, clockStarted: result.clockStarted });
        }

        const { vendorId, paymentDate, amount, paymentMode, referenceNo, notes } = req.body;
        const companyId = req.user.companyId;
        const unit = req.user.unit;
        const manualOnly = { companyId, purchaseOrder: null };
        const invoiceIds = Array.isArray(req.body.invoiceIds)
            ? req.body.invoiceIds.filter(Boolean)
            : (req.body.invoiceIds ? [req.body.invoiceIds] : []);

        if (!amount || amount <= 0) {
            throw new Error('Payment amount must be greater than zero.');
        }

        // Multiple bills targeted at once must be paid in FULL — splitting a
        // part amount across several is ambiguous.
        let targetedInvoices = [];
        if (invoiceIds.length > 1) {
            targetedInvoices = await PurchaseInvoice.find({ ...manualOnly, _id: { $in: invoiceIds }, vendor: vendorId, status: { $nin: ['Paid', 'Cancelled'] } });
            const targetedTotal = targetedInvoices.reduce((sum, inv) => sum + inv.balanceAmount, 0);
            if (amount < targetedTotal) {
                throw new Error(`Paying ${invoiceIds.length} bills at once requires the full balance of all of them: ₹${targetedTotal.toLocaleString('en-IN')}. Enter that amount, or select just one bill to pay it partially.`);
            }
        }

        // Never more than this vendor's manual bills still owe (2026-10-12) —
        // money with nothing to settle used to push Accounts Payable negative.
        const owedRows = await PurchaseInvoice.find({ ...manualOnly, vendor: vendorId, status: { $nin: ['Paid', 'Cancelled'] } }).select('balanceAmount').lean();
        const owed = Math.round(owedRows.reduce((sum, inv) => sum + (Number(inv.balanceAmount) || 0), 0) * 100) / 100;
        if (amount > owed + 0.005) {
            throw new Error(owed > 0
                ? `Only ₹${owed.toLocaleString('en-IN')} is owed on this vendor's bills without a PO. A PO's advance or payment is paid against that PO's bill.`
                : 'This vendor has no unpaid bills without a PO. A PO\'s advance or payment is paid against that PO\'s bill.');
        }

        // The bank / cash account, checked BEFORE anything is written.
        const bankAccount = req.body.accountId
            ? await Account.findOne({ _id: req.body.accountId, isBankOrCash: true })
            : await Account.findOne({ isBankOrCash: true, unit });
        if (!bankAccount) {
            throw new Error('Bank or Cash account not found for payment. Please create one in Bank & Cash module.');
        }
        if (bankAccount.balance < amount) {
            throw new Error(`Insufficient funds in ${bankAccount.accountName}. Available: ₹${bankAccount.balance}`);
        }

        let remainingAmount = amount;
        const allocations = [];

        if (invoiceIds.length === 1) {
            const targeted = await PurchaseInvoice.findOne({ ...manualOnly, _id: invoiceIds[0], vendor: vendorId, status: { $nin: ['Paid', 'Cancelled'] } });
            if (targeted) {
                const payToThis = Math.min(targeted.balanceAmount, remainingAmount);
                if (payToThis > 0) {
                    targeted.paidAmount += payToThis;
                    remainingAmount -= payToThis;
                    await targeted.save();
                    allocations.push({ invoice: targeted._id, amount: payToThis });
                }
            }
        } else if (invoiceIds.length > 1) {
            for (const targeted of targetedInvoices) {
                const payToThis = targeted.balanceAmount;
                if (payToThis <= 0) continue;
                targeted.paidAmount += payToThis;
                remainingAmount -= payToThis;
                await targeted.save();
                allocations.push({ invoice: targeted._id, amount: payToThis });
            }
        }

        if (remainingAmount > 0) {
            const unpaidInvoices = await PurchaseInvoice.find({
                ...manualOnly,
                vendor: vendorId,
                status: { $nin: ['Paid', 'Cancelled'] },
                ...(invoiceIds.length ? { _id: { $nin: invoiceIds } } : {}),
            }).sort({ invoiceDate: 1 });

            for (const inv of unpaidInvoices) {
                if (remainingAmount <= 0) break;
                const payToThis = Math.min(inv.balanceAmount, remainingAmount);
                if (payToThis <= 0) continue;
                inv.paidAmount += payToThis;
                remainingAmount -= payToThis;
                await inv.save();
                allocations.push({ invoice: inv._id, amount: payToThis });
            }
        }

        const payment = new VendorPayment({
            vendor: vendorId,
            paymentDate,
            amount,
            paymentMode,
            referenceNo,
            bankAccount: bankAccount._id,
            allocations,
            unit,
            companyId,
            createdBy: req.user._id,
            notes
        });
        await payment.save();

        // Ledger: Dr Accounts Payable / Cr Bank, on the company + unit's own
        // Payable account (the bill posted the other side).
        try {
            await postEntry({
                companyId, unit,
                lines: [
                    { key: 'accounts_payable', debit: amount },
                    { account: bankAccount, credit: amount },
                ],
                description: `Payment to Vendor - Ref: ${referenceNo || 'N/A'}`,
                reference: referenceNo || '',
                relatedDocument: 'Payment',
                relatedDocumentId: payment._id,
                mode: paymentMode,
                date: paymentDate ? new Date(paymentDate) : new Date(),
                user: req.user,
                prefix: 'PAY',
            });
        } catch (postErr) {
            console.error('❌ Ledger posting for a vendor payment failed:', postErr.message);
        }

        res.json({ success: true, data: payment });
    } catch (error) {
        console.error('❌ Error in createVendorPayment:', error);
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Payment history (2026-10-12 — there was no list before).
 */
export const getVendorPayments = async (req, res) => {
    try {
        const { page = 1, limit = 20, vendorId, kind } = req.query;
        const query = { companyId: req.user.companyId };
        if (vendorId) query.vendor = vendorId;
        if (kind && kind !== 'All') query.kind = kind;
        const [payments, total] = await Promise.all([
            VendorPayment.find(query)
                .populate('vendor', 'supplierName supplierCode')
                .populate('purchaseOrder', 'purchaseOrderNumber')
                .populate('bankAccount', 'accountName')
                .populate('allocations.invoice', 'invoiceNo')
                .populate('createdBy', 'fullName')
                .sort({ paymentDate: -1, createdAt: -1 })
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                .lean(),
            VendorPayment.countDocuments(query),
        ]);
        res.json({ success: true, data: { payments, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
            balanceAmount: { $gt: 0 },
            status: { $ne: 'Cancelled' }
        };

        if (vendorId) {
            matchQuery.vendor = new mongoose.Types.ObjectId(vendorId);
        }

        const outstandingData = await PurchaseInvoice.aggregate([
            { $match: matchQuery },
            // Each invoice's own PO, for that PO's Advance % (payment terms
            // are set per PO now, procurement-v2 — not a vendor default).
            {
                $lookup: {
                    from: 'purchases',
                    localField: 'purchaseOrder',
                    foreignField: '_id',
                    as: 'poInfo'
                }
            },
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
                            dueDate: '$dueDate',
                            // Lets the payment UI target this specific
                            // invoice and show it's a PO advance/settlement
                            // (2026-10) — see createVendorPayment's invoiceIds.
                            purchaseOrder: '$purchaseOrder',
                            poNumber: { $arrayElemAt: ['$poInfo.purchaseOrderNumber', 0] },
                            // The PO bill (2026-10-12): where it stands and
                            // what can be paid now (filled in below).
                            advancePercent: '$advancePercent',
                            advanceAmount: '$advanceAmount',
                            advancePaid: '$advancePaid',
                            acceptedValue: '$acceptedValue',
                            fullyAcceptedAt: '$fullyAcceptedAt',
                            creditDays: '$creditDays',
                            paidAmount: '$paidAmount',
                            status: '$status',
                            stage: '$stage',
                            deliveryClock: { $arrayElemAt: ['$poInfo.deliveryClock', 0] }
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
        for (const v of outstandingData) {
            v.invoices = v.invoices
                .map(inv => ({ ...inv, payableNow: inv.purchaseOrder ? payableNow({ ...inv, totalAmount: inv.totalAmount }) : null }))
                .sort((a, b) => new Date(a.date) - new Date(b.date));
        }

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
            companyId: req.user.companyId,
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
    const companyId = qcJob.company;

    // Strategy 1 (most reliable): direct reference set when the QC job was created.
    if (qcJob.purchaseRequestId) {
        pr = await PurchaseRequest.findOne({ _id: qcJob.purchaseRequestId, companyId }).populate({
            path: 'purchaseOrder',
            populate: { path: 'supplier' }
        });
        if (pr && pr.purchaseOrder) po = pr.purchaseOrder;
    }

    // Strategy 2: match the PO number against sourceRefId.
    if (!po && qcJob.sourceRefId) {
        po = await Purchase.findOne({ purchaseOrderNumber: qcJob.sourceRefId, companyId }).populate('supplier');
    }

    // Strategy 3: match requestId/itemCode against PurchaseRequest.
    if (!po) {
        pr = await PurchaseRequest.findOne({
            companyId,
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
 * Auto-creates a Purchase Invoice for a Purchase Order (PO) — once per PO,
 * covering every line in `purchase.items[]`. Re-keyed from "once per PR" to
 * "once per PO" (2026-10): a PO can now batch several independently-raised
 * PurchaseRequests (`Purchase.purchaseRequests[]`), and the old PR-keyed
 * version, called once per PR in a batch, would have copied the WHOLE PO's
 * items into every one of those PRs' own invoices — duplicating every line
 * N times for an N-PR batch. Callers now pass the Purchase (PO) document
 * (or its id) instead of a PurchaseRequest.
 */
export const createAutoPurchaseInvoice = async (purchaseOrder, user) => {
    try {
        const PurchaseModel = mongoose.model('Purchase');
        // Defensive scoping on the id-only branch — confirmed dead today (every
        // current caller passes an already-fetched/populated PO), but cheap and
        // correct to fix alongside everything else found in this audit.
        let po = purchaseOrder?.items
            ? purchaseOrder
            : await PurchaseModel.findOne({ _id: purchaseOrder?._id || purchaseOrder, companyId: user.companyId });

        if (!po) {
            console.error('❌ [Auto Invoice] Purchase Order not found.');
            return null;
        }
        if (!po.populated('purchaseRequests')) {
            po = await po.populate('purchaseRequests');
        }

        const companyId = po.companyId || user.companyId;
        // The PO's own unit (2026-10-12) — before, whoever finalized or
        // approved the PO (e.g. a Company Admin in another unit) decided it.
        const unit = po.unit || user.unit || 'Main';

        // 1. Determine vendor/supplier
        let vendorId = po.supplier?._id || po.supplier || null;
        if (!vendorId) {
            // Fallback: search for an active supplier — scoped to this PO's own
            // company (2026-10-06 fix). Previously unscoped ("any active
            // supplier in the whole database"), a real cross-tenant exposure
            // found while auditing the item-wise PR consolidation rework.
            const Supplier = mongoose.model('Supplier');
            const fallbackSupplier = await Supplier.findOne({ status: 'active', companyId });
            if (fallbackSupplier) {
                vendorId = fallbackSupplier._id;
            }
        }

        if (!vendorId) {
            console.error('❌ [Auto Invoice] Could not identify vendor/supplier for invoice.');
            return null;
        }

        // 2. Generate invoice number
        const poNumber = po.purchaseOrderNumber;
        const invoiceNo = `INV-PO-${poNumber}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;

        // 3. Duplicate invoice check — by invoiceNo (existing) AND by PO
        // number in notes (new guard). One invoice per PO regardless of how
        // many PRs it batches or how many receive events fire across them.
        const existingByPO = await PurchaseInvoice.findOne({ purchaseOrder: po._id, companyId });
        if (existingByPO) return existingByPO;
        const existingByNotes = await PurchaseInvoice.findOne({
            vendor: vendorId,
            companyId,
            notes: { $regex: poNumber, $options: 'i' }
        });
        if (existingByNotes) {
            console.log(`ℹ️ [Auto Invoice] Invoice already exists for PO ${poNumber} — returning existing, no duplicate.`);
            return existingByNotes;
        }

        const existing = await PurchaseInvoice.findOne({ vendor: vendorId, invoiceNo });
        if (existing) {
            console.log(`⚠️ [Auto Invoice] Invoice ${invoiceNo} already exists.`);
            return existing;
        }

        // 4. Copy the PO's own already-computed figures verbatim (2026-10)
        // — this invoice does NOT recalculate anything (confirmed design):
        // GST, item charges and PO-scoped charges were all decided once,
        // at PO creation (createPurchase), including the gstInclusive
        // double-count guard. Each line's own gstAmount/gstRate come
        // straight from Purchase.items[], and its totalPrice folds in that
        // line's own itemChargesTotal (loading/packing/etc. specific to
        // this item), same as the By Vendor tab already displays it.
        let subtotal = 0;
        let gstAmount = 0;
        const items = (po.items || []).map(item => {
            const lineGross = (item.quantity || 1) * (item.unitPrice || 0);
            const lineTotal = lineGross + (item.itemChargesTotal || 0);
            subtotal += lineTotal;
            gstAmount += item.gstAmount || 0;
            return {
                item: item.item,
                itemName: item.itemName,
                quantity: item.quantity || 1,
                unitPrice: item.unitPrice || 0,
                gstPercent: item.gstRate || 0,
                gstAmount: item.gstAmount || 0,
                totalPrice: lineTotal
            };
        });
        // Whole-PO charges (freight, packing… typed on the PO, procurement-v2)
        // folded into the subtotal, since the invoice has no separate charges
        // field; their own GST joins the lines' GST. Old POs may instead carry
        // the retired automatic vendor charges (poChargesTotal) — still counted.
        subtotal += (po.chargesTotal || 0) + (po.poChargesTotal || 0);
        gstAmount += po.chargesGstTotal || 0;
        const totalAmount = po.grandTotal != null ? po.grandTotal : (subtotal + gstAmount);

        const prList = (po.purchaseRequests || []).map(pr => pr.requestId || pr).join(', ') || 'N/A';

        // The PO bill (client, 2026-10-12): the advance is fixed now from the
        // PO's Advance %; the due date is only known once everything is
        // received and QC-passed (that day + the PO's Credit Days) — see
        // services/purchaseBillService.js.
        const advancePercent = Math.min(100, Math.max(0, Number(po.paymentTerms?.advancePercent) || 0));
        const creditDays = po.paymentTerms?.creditDays != null ? Number(po.paymentTerms.creditDays) : null;
        const { advanceAmountOf } = await import('../services/purchaseBillService.js');

        // 5. Create Invoice
        const invoice = new PurchaseInvoice({
            vendor: vendorId,
            purchaseOrder: po._id,
            invoiceNo,
            invoiceDate: new Date(),
            dueDate: null,
            items,
            subtotal,
            gstAmount,
            // The PO's own CGST + SGST / IGST (point 15, 2026-10-10).
            gstType: po.gstSplit?.type === 'IGST' ? 'IGST' : 'CGST_SGST',
            totalAmount,
            balanceAmount: totalAmount,
            advancePercent,
            advanceAmount: advanceAmountOf(totalAmount, advancePercent),
            creditDays,
            unit,
            companyId,
            createdBy: user._id,
            notes: `Auto-generated for PO: ${poNumber}. Purchase Request(s): ${prList}`
        });

        await invoice.save();
        console.log(`✅ [Auto Invoice] Purchase Invoice ${invoiceNo} recorded successfully.`);
        recalcPricingForInvoiceItems(invoice).catch(e => console.error('❌ Pricing recalc error (createAutoPurchaseInvoice):', e));

        // No ledger entry here (2026-10-12): a PO is a promise to buy, not
        // money owed. The material is posted when it passes QC, the advance
        // when it's paid (services/purchaseLedgerService.js).

        return invoice;
    } catch (error) {
        console.error('❌ Error creating auto purchase invoice:', error);
        throw error;
    }
};


