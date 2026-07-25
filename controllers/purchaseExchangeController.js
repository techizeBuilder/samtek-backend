import crypto from 'crypto';
import mongoose from 'mongoose';
import PurchaseExchange from '../models/PurchaseExchange.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import Supplier from '../models/Supplier.js';
import { Company } from '../models/Company.js';
import { Item } from '../models/Inventory.js';
import { resolveVendorAndPOForQCRejectedPurchase } from './purchaseInvoiceController.js';
import { sendPurchaseExchangeEmail } from '../services/emailService.js';
import notificationService from '../services/notificationService.js';

const TOKEN_VALID_DAYS = 7;

async function generatePRRequestId() {
    let attempts = 0;
    while (attempts < 20) {
        const count = await PurchaseRequest.countDocuments({});
        const candidate = `PR${String(count + 1 + attempts).padStart(3, '0')}`;
        const exists = await PurchaseRequest.findOne({ requestId: candidate }).lean();
        if (!exists) return candidate;
        attempts++;
    }
    return `PR-${Date.now().toString().slice(-6)}`;
}

async function sendExchangeEmailFor(exchange, po) {
    const vendor = await Supplier.findById(exchange.vendor).lean();
    if (!vendor || !vendor.email) {
        console.error(`❌ [Purchase Exchange] Vendor ${exchange.vendor} has no email on file — cannot send exchange request.`);
        return { success: false, error: 'Vendor has no email on file' };
    }

    const company = await Company.findById(exchange.companyId).lean();
    const companyName = company?.name || 'Samtek';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + TOKEN_VALID_DAYS * 24 * 60 * 60 * 1000);
    exchange.vendorToken = token;
    exchange.vendorTokenExpiry = tokenExpiry;
    await exchange.save();

    const acceptLink = `${frontendUrl}/purchase-exchange/${token}`;

    const result = await sendPurchaseExchangeEmail({
        to: vendor.email,
        vendorName: vendor.supplierName,
        itemName: exchange.itemName,
        exchangeQty: exchange.exchangeQtyPurchaseUnit,
        purchaseUnit: exchange.purchaseUnit,
        reason: exchange.reason,
        poNumber: po?.purchaseOrderNumber,
        acceptLink,
        companyName,
    });

    if (!result.success) {
        console.error(`❌ [Purchase Exchange] Email failed for ${vendor.email}:`, result.error);
    }
    return result;
}

/**
 * Called from qcController.submitDecision whenever a Purchase-sourced QC job
 * is rejected (fully or partially). Reverse-converts the rejected base-unit
 * qty back into the vendor's Purchase Unit using the same conversionFactor
 * Store used on the way in, resolves the vendor from the real PO chain (no
 * guessing), and — if resolved — emails the vendor a one-click accept link.
 */
export const createQCRejectedPurchaseExchange = async (qcJob, user, qty) => {
    try {
        const rejectedQty = qty || qcJob.quantity || 1;
        const { po, pr, supplierId } = await resolveVendorAndPOForQCRejectedPurchase(qcJob);

        // Reverse conversion: conversionFactor = "how many purchaseUnit make 1
        // base unit" (see PurchaseRequest.js) — same factor Store used to go
        // from purchaseUnit -> base unit, applied in reverse here.
        const conversionFactor = pr?.conversionFactor || null;
        const purchaseUnit = pr?.purchaseUnit || null;
        const exchangeQtyPurchaseUnit = conversionFactor ? Math.round(rejectedQty * conversionFactor * 1000) / 1000 : rejectedQty;

        let inventoryItem = null;
        if (qcJob.itemCode && /^[0-9a-fA-F]{24}$/.test(qcJob.itemCode)) {
            inventoryItem = await Item.findById(qcJob.itemCode);
        }
        if (!inventoryItem && qcJob.itemName) {
            inventoryItem = await Item.findOne({ name: qcJob.itemName, companyId: qcJob.company });
        }

        const exchange = await PurchaseExchange.create({
            originalPurchaseOrder: po?._id || null,
            originalPurchaseRequest: pr?._id || qcJob.purchaseRequestId || null,
            qcJobId: qcJob._id,
            vendor: supplierId || null,
            item: inventoryItem?._id || null,
            itemName: qcJob.itemName,
            rejectedQtyBaseUnit: rejectedQty,
            baseUnit: qcJob.unit || 'pcs',
            exchangeQtyPurchaseUnit,
            purchaseUnit: purchaseUnit || qcJob.unit || 'pcs',
            conversionFactorUsed: conversionFactor,
            reason: qcJob.failReason || '',
            status: supplierId ? 'Pending Vendor Response' : 'Needs Manual Vendor Selection',
            companyId: qcJob.company,
            createdBy: user._id,
        });

        if (supplierId) {
            await sendExchangeEmailFor(exchange, po);
            console.log(`✅ [Purchase Exchange] Created and emailed vendor for ${rejectedQty} ${exchange.baseUnit} of ${qcJob.itemName} (= ${exchangeQtyPurchaseUnit} ${exchange.purchaseUnit})`);
        } else {
            console.warn(`⚠️ [Purchase Exchange] Vendor could not be resolved for QC Job ${qcJob.qcJobId} — flagged for manual vendor selection.`);
            try {
                await notificationService.triggerAccountsNotification({
                    action: 'purchase_exchange_needs_vendor',
                    data: { itemName: qcJob.itemName, exchangeId: exchange._id, qty: rejectedQty },
                    targetCompanyId: qcJob.company,
                });
            } catch (e) { console.error('Purchase Exchange notification error:', e); }
        }

        return exchange;
    } catch (error) {
        console.error('❌ Error creating QC-rejected purchase exchange:', error);
        throw error;
    }
};

// ── Authenticated: Purchase/Accounts dashboard ──────────────────────────────

export const getPurchaseExchanges = async (req, res) => {
    try {
        const { status } = req.query;
        const query = { companyId: req.user.companyId };
        if (status) query.status = status;
        const exchanges = await PurchaseExchange.find(query)
            .populate('vendor', 'supplierName email')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: exchanges });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Manual vendor resolution for the 'Needs Manual Vendor Selection' case —
// Purchase/Accounts picks the correct vendor by hand, we email them.
export const assignExchangeVendor = async (req, res) => {
    try {
        const { vendorId } = req.body;
        if (!vendorId) return res.status(400).json({ success: false, message: 'vendorId is required' });

        const exchange = await PurchaseExchange.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!exchange) return res.status(404).json({ success: false, message: 'Purchase Exchange not found' });
        if (exchange.status !== 'Needs Manual Vendor Selection') {
            return res.status(400).json({ success: false, message: `Cannot assign vendor — status is ${exchange.status}` });
        }

        const vendor = await Supplier.findOne({ _id: vendorId, status: 'active' });
        if (!vendor) return res.status(404).json({ success: false, message: 'Active vendor not found' });

        exchange.vendor = vendor._id;
        exchange.status = 'Pending Vendor Response';
        await exchange.save();

        const po = exchange.originalPurchaseOrder ? await mongoose.model('Purchase').findById(exchange.originalPurchaseOrder) : null;
        await sendExchangeEmailFor(exchange, po);

        res.json({ success: true, data: exchange });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Public (no auth): vendor accept link from the email ────────────────────

export const getExchangeByToken = async (req, res) => {
    try {
        const exchange = await PurchaseExchange.findOne({ vendorToken: req.params.token })
            .populate('vendor', 'supplierName email');
        if (!exchange) return res.status(404).json({ success: false, message: 'Invalid or expired link' });

        if (exchange.vendorTokenExpiry && new Date() > exchange.vendorTokenExpiry) {
            return res.status(410).json({ success: false, message: 'This link has expired' });
        }
        if (exchange.status !== 'Pending Vendor Response') {
            return res.status(400).json({
                success: false,
                message: exchange.status === 'Accepted' ? 'You have already confirmed this replacement.' : `This request is no longer active (${exchange.status}).`
            });
        }

        res.json({
            success: true,
            data: {
                vendorName: exchange.vendor?.supplierName,
                itemName: exchange.itemName,
                exchangeQty: exchange.exchangeQtyPurchaseUnit,
                purchaseUnit: exchange.purchaseUnit,
                reason: exchange.reason,
                status: exchange.status,
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

export const acceptExchangeByToken = async (req, res) => {
    try {
        const exchange = await PurchaseExchange.findOne({ vendorToken: req.params.token });
        if (!exchange) return res.status(404).json({ success: false, message: 'Invalid link' });

        if (exchange.vendorTokenExpiry && new Date() > exchange.vendorTokenExpiry) {
            return res.status(410).json({ success: false, message: 'This link has expired' });
        }
        if (exchange.status !== 'Pending Vendor Response') {
            return res.status(400).json({ success: false, message: `This request is no longer active (${exchange.status}).` });
        }

        // Auto-seed the replacement-goods PurchaseRequest, pre-filled and
        // already "Ordered" (the vendor just confirmed it via email) — it
        // lands directly in Store's Mark Received queue, same pipeline as
        // any normal purchase from here on.
        const originalPR = exchange.originalPurchaseRequest ? await PurchaseRequest.findById(exchange.originalPurchaseRequest).lean() : null;

        const newPR = await PurchaseRequest.create({
            requestId: await generatePRRequestId(),
            productName: exchange.itemName,
            quantity: exchange.rejectedQtyBaseUnit,
            requestFromDepartment: 'QC',
            source: 'QC',
            storeApproved: true,
            status: 'Ordered',
            companyId: exchange.companyId,
            storeOrderId: originalPR?.storeOrderId || null,
            saleItemId: originalPR?.saleItemId || null,
            itemId: originalPR?.itemId || null,
            purchaseOrder: exchange.originalPurchaseOrder || null,
            purchaseUnitType: originalPR?.purchaseUnitType || null,
            purchaseUnit: exchange.purchaseUnit,
            purchaseQuantity: exchange.exchangeQtyPurchaseUnit,
            conversionFactor: exchange.conversionFactorUsed,
        });

        exchange.status = 'Accepted';
        exchange.acceptedAt = new Date();
        exchange.newPurchaseRequestId = newPR._id;
        await exchange.save();

        try {
            await notificationService.triggerAccountsNotification({
                action: 'purchase_exchange_accepted',
                data: { itemName: exchange.itemName, exchangeId: exchange._id, newRequestId: newPR.requestId },
                targetCompanyId: exchange.companyId,
            });
        } catch (e) { console.error('Purchase Exchange accepted notification error:', e); }

        res.json({
            success: true,
            message: 'Thank you — the replacement has been confirmed. Our Store team will follow up on receipt.',
            data: { itemName: exchange.itemName, exchangeQty: exchange.exchangeQtyPurchaseUnit, purchaseUnit: exchange.purchaseUnit }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
