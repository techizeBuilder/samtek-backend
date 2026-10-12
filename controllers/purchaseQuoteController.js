import VendorBid from '../models/VendorBid.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import Supplier from '../models/Supplier.js';
import { Company } from '../models/Company.js';
import { Item } from '../models/Inventory.js';
import { sendRFQEmail } from '../services/emailService.js';
import { getDeptMailer, DEPARTMENTS } from '../config/mailAccounts.js';
import { ELIGIBLE_VENDOR_FILTER, eligibleVendorError } from '../services/vendorApprovalService.js';
import crypto from 'crypto';

// Same name/code match purchaseRequestController.js's getPurchaseRequests
// already uses to attach a PR's R&D specs — reused here so a batched PO's
// items[] always has a real Inventory Item id, which createPurchase
// requires (it does Item.findById(item.item) with no name-based fallback).
export async function resolveMasterItemId(pr, companyId) {
  const masterItem = await Item.findOne({
    companyId,
    $or: [
      { code: pr.itemId },
      { name: { $regex: new RegExp(`^${(pr.productName || '').trim()}$`, 'i') } }
    ]
  }).select('_id').lean();
  return masterItem?._id || null;
}

// Purchase redesign (2026-10) — quotes attach directly to a PurchaseRequest,
// no RFQ wrapper. Reuses VendorBid (now with a direct `purchaseRequest` ref
// and a `source` field — see models/VendorBid.js) and the same public
// token-link mechanism createRFQ already built (GET/POST
// /api/rfq/bid/:token, rfqController.js — those handle a null `rfq` fine).

// GET /api/purchase-requests/:id/quotes — quote history for one PR, newest
// first. Whichever quote was recorded most recently (any source — Email
// once the vendor submits, or Manual immediately) is the active one; this
// is computed live here, not tracked with its own stored flag.
export const getQuotesForPR = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const pr = await PurchaseRequest.findOne({ _id: id, companyId }).select('_id').lean();
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase request not found' });

    // Item-wise PR consolidation (2026-10) — this PR's quotes may now live
    // on an ItemQuoteGroup (the new combined-card flow) instead of
    // directly on it (the legacy/original single-PR flow). A PR is a
    // member of at most one group at a time, so this is a plain OR, not a
    // merge of two independent lists that could double-count anything.
    // Powers the PRs tab's "No Quotes/N Quotes/In Batch PO" stat cards,
    // which should look completely unchanged regardless of which flow
    // actually quoted this PR.
    const group = await ItemQuoteGroup.findOne({ purchaseRequests: id, companyId }).select('_id').lean();
    const quoteQuery = group
      ? { companyId, $or: [{ purchaseRequest: id }, { group: group._id }] }
      : { purchaseRequest: id, companyId };

    const quotes = await VendorBid.find(quoteQuery)
      .populate('vendor', 'supplierName email phone')
      .sort({ createdAt: -1 })
      .lean();

    const activeId = quotes.find(q => q.status === 'Submitted')?._id?.toString() || null;
    res.json({
      success: true,
      data: quotes.map(q => ({ ...q, isActive: activeId ? String(q._id) === activeId : false })),
    });
  } catch (error) {
    console.error('getQuotesForPR error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/purchase-requests/:id/quotes — create a quote against one PR.
// Superseded for By Item tab's own UI (2026-10, item-wise PR consolidation)
// by POST /api/item-quote-groups/:id/quotes — ByItemTab.jsx no longer calls
// this endpoint at all. Left in place, not removed: it's not risky (just
// creates a VendorBid row), and nothing proves no other caller depends on
// it existing.
// source:'Email' sends the existing token-link invite — the vendor
// self-submits later through the unchanged public routes, just with no RFQ
// parent this time. source:'Manual' takes the rate/days/warranty/remarks
// directly and is Received immediately — covers a phone call, WhatsApp, or
// anything else Purchase typed in themselves; there's no automated inbound
// capture for those, so this is the only path they ever go through
// (confirmed design: WhatsApp has no quote-entry path of its own).
export const createQuote = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const { vendor: vendorId, source, unitPrice, deliveryDays, warrantyMonths, remarks, quantity: quantityBody, gstInclusive } = req.body;

    if (!vendorId) return res.status(400).json({ success: false, message: 'Vendor is required' });
    if (!['Email', 'Manual'].includes(source)) return res.status(400).json({ success: false, message: 'source must be Email or Manual' });

    const pr = await PurchaseRequest.findOne({ _id: id, companyId });
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase request not found' });

    const vendor = await Supplier.findOne({ _id: vendorId, companyId, unit: { $in: [unit, 'Main'] } });
    const notEligible = eligibleVendorError(vendor);
    if (notEligible) return res.status(400).json({ success: false, message: notEligible });

    // Purchase Unit awareness (e.g. bought by the kg, stocked by the piece)
    // — mirrors PurchaseRequest.jsx's own itemPurchaseUnit/poQuantity logic
    // exactly: when the item has a Purchase Unit, `quantity` here MUST be
    // that purchase-unit quantity, entered explicitly by Purchase (NOT
    // pr.quantity, which is the base/storage quantity, and NOT
    // pr.purchaseQuantity, which doesn't exist until a PO is created — using
    // either here was the bug in the first version of this endpoint).
    const masterItemId = await resolveMasterItemId(pr, companyId);
    const masterItem = masterItemId ? await Item.findById(masterItemId).select('purchaseUnit purchaseUnitType').lean() : null;
    const purchaseUnit = masterItem?.purchaseUnit || null;
    const purchaseUnitType = masterItem?.purchaseUnitType || null;

    let quantity;
    if (purchaseUnit) {
      quantity = Number(quantityBody);
      if (!(quantity > 0)) {
        return res.status(400).json({ success: false, message: `Please enter the Purchase Quantity in ${purchaseUnit}` });
      }
    } else {
      quantity = Number(quantityBody) || pr.quantity;
    }

    if (source === 'Manual') {
      if (!unitPrice || unitPrice <= 0) return res.status(400).json({ success: false, message: 'Please enter a valid unit price' });
      if (!deliveryDays || deliveryDays <= 0) return res.status(400).json({ success: false, message: 'Please enter a valid delivery time in days' });

      // Charges are typed on the PO now (procurement-v2) — the old automatic
      // vendor charges are retired, so a quote carries none.
      const rawValue = Number(unitPrice) * quantity;
      const itemCharges = [];
      const itemChargesTotal = 0;

      const quote = await VendorBid.create({
        purchaseRequest: pr._id,
        source: 'Manual',
        vendor: vendor._id,
        vendorName: vendor.supplierName,
        productName: pr.productName,
        quantity,
        purchaseUnit,
        purchaseUnitType,
        gstInclusive: !!gstInclusive,
        fabricationDimensionLines: pr.fabricationDimensionLines || [],
        unitPrice: Number(unitPrice),
        totalPrice: rawValue,
        itemCharges,
        itemChargesTotal,
        deliveryDays: Number(deliveryDays),
        warrantyMonths: Number(warrantyMonths) || 0,
        remarks: remarks || '',
        status: 'Submitted',
        submittedAt: new Date(),
        companyId,
        unit,
      });
      return res.status(201).json({ success: true, data: quote });
    }

    // source: 'Email'
    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const quote = await VendorBid.create({
      purchaseRequest: pr._id,
      source: 'Email',
      vendor: vendor._id,
      vendorName: vendor.supplierName,
      productName: pr.productName,
      quantity,
      purchaseUnit,
      purchaseUnitType,
      fabricationDimensionLines: pr.fabricationDimensionLines || [],
      unitPrice: 0,
      totalPrice: 0,
      deliveryDays: 7,
      bidToken: token,
      tokenExpiry,
      status: 'Invited',
      companyId,
      unit,
    });

    const company = await Company.findById(companyId);
    const companyName = company?.name || 'Samtek';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const bidLink = `${frontendUrl}/vendor-bid/${token}`;

    try {
      const mailer = await getDeptMailer(DEPARTMENTS.PURCHASE);
      const emailResult = await sendRFQEmail({
        mailer,
        to: vendor.email,
        vendorName: vendor.supplierName,
        rfqNo: pr.requestId,
        productName: pr.productName,
        quantity,
        quantityUnit: purchaseUnit || unit,
        fabricationDimensionLines: pr.fabricationDimensionLines || [],
        requiredByDate: null,
        bidLink,
        companyName,
        notes: '',
      });
      quote.emailStatus = emailResult.success ? 'Sent' : 'Failed';
      quote.emailError = emailResult.success ? undefined : emailResult.error;
      await quote.save();
      if (!emailResult.success) {
        return res.status(201).json({ success: true, data: quote, warning: `Quote created, but the email failed to send: ${emailResult.error}` });
      }
    } catch (emailErr) {
      quote.emailStatus = 'Failed';
      quote.emailError = emailErr.message;
      await quote.save();
      return res.status(201).json({ success: true, data: quote, warning: `Quote created, but the email failed to send: ${emailErr.message}` });
    }

    res.status(201).json({ success: true, data: quote });
  } catch (error) {
    console.error('createQuote error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/purchase-requests/:id/eligible-vendors — vendors actually linked
// to this PR's item in Vendor Master (Supplier.suppliedItems), each
// annotated with their most recent quote for this PR if one exists.
// Superseded for By Item tab's own UI (2026-10, item-wise PR consolidation)
// by GET /api/item-quote-groups/:id/eligible-vendors — ByItemTab.jsx no
// longer calls this endpoint. Left in place, same reasoning as createQuote
// above (replaces an earlier version that let Purchase pick ANY vendor
// from a plain dropdown — a real bug, caught live: a PR's quote should
// only ever go to vendors Vendor Master actually says can supply that
// item).
export const getEligibleVendorsForPR = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const unit = req.user.unit;

    const pr = await PurchaseRequest.findOne({ _id: id, companyId }).lean();
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase request not found' });

    const itemId = await resolveMasterItemId(pr, companyId);
    if (!itemId) {
      // Honest, not a silent "show everyone" fallback — this PR's product
      // name/code doesn't match any real Inventory item, so there's no way
      // to know which vendors cover it. Confirm/fix the Inventory match (or
      // the item's name on the PR) before a vendor list can be shown here.
      return res.json({ success: true, data: { itemResolved: false, vendors: [] } });
    }

    // Only Company-Admin-approved, active vendors can be quoted (procurement-v2).
    const vendors = await Supplier.find({ companyId, unit: { $in: [unit, 'Main'] }, suppliedItems: itemId, ...ELIGIBLE_VENDOR_FILTER })
      .select('supplierName email phone suppliedItems')
      .lean();

    if (vendors.length === 0) {
      return res.json({ success: true, data: { itemResolved: true, vendors: [] } });
    }

    const quotes = await VendorBid.find({ purchaseRequest: id, companyId })
      .sort({ createdAt: -1 })
      .lean();
    const latestQuoteByVendor = new Map();
    for (const q of quotes) {
      const vId = String(q.vendor);
      if (!latestQuoteByVendor.has(vId)) latestQuoteByVendor.set(vId, q);
    }
    // "Active" = whichever quote was recorded most recently across ALL
    // vendors for this PR (recency-wins, confirmed design) — not just each
    // vendor's own latest, which is what latestQuoteByVendor gives per row.
    const activeId = quotes[0]?._id ? String(quotes[0]._id) : null;

    const data = vendors.map(v => {
      const quote = latestQuoteByVendor.get(String(v._id)) || null;
      return {
        _id: v._id,
        supplierName: v.supplierName,
        email: v.email,
        phone: v.phone,
        quote: quote ? { ...quote, isActive: activeId ? String(quote._id) === activeId : false } : null,
      };
    });

    res.json({ success: true, data: { itemResolved: true, vendors: data } });
  } catch (error) {
    console.error('getEligibleVendorsForPR error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/suppliers/:id/batchable-quotes — this vendor's most recent
// Submitted quote per PR (legacy single-PR quotes) or per ItemQuoteGroup
// (2026-10, item-wise PR consolidation — several PRs now share one line),
// for everything not already on a PO. Powers the By Vendor batching tab.
// Response shape is unified across both so the frontend doesn't need two
// code paths: `purchaseRequestIds` is always an array (one entry for a
// legacy quote, several for a group), `resolvedItemId`/`itemQuoteGroup`
// are always present (null where not applicable).
export const getBatchableQuotesForVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;

    const quotes = await VendorBid.find({ vendor: id, companyId, status: 'Submitted' })
      .populate('purchaseRequest', 'requestId productName quantity itemId status purchaseOrder requestDate priority')
      .populate({
        path: 'group',
        select: 'item quantity purchaseUnit purchaseUnitType status purchaseRequests',
        populate: [
          { path: 'item', select: 'name code' },
          { path: 'purchaseRequests', select: 'requestId productName status purchaseOrder priority' },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    const batchable = [];
    const lineFields = (q) => ({
      _id: q._id,
      source: q.source,
      unitPrice: q.unitPrice,
      quantity: q.quantity,
      purchaseUnit: q.purchaseUnit,
      purchaseUnitType: q.purchaseUnitType,
      gstInclusive: q.gstInclusive,
      itemCharges: q.itemCharges,
      itemChargesTotal: q.itemChargesTotal,
      deliveryDays: q.deliveryDays,
      warrantyMonths: q.warrantyMonths,
    });

    // Legacy path (bid.purchaseRequest set, bid.group null) — unchanged
    // behavior: keep only each PR's most recent quote, only PRs not
    // already on a PO.
    const seenPR = new Set();
    for (const q of quotes) {
      if (!q.purchaseRequest) continue;
      const pr = q.purchaseRequest;
      if (pr.purchaseOrder) continue;
      const prId = String(pr._id);
      if (seenPR.has(prId)) continue;
      seenPR.add(prId);
      const resolvedItemId = await resolveMasterItemId(pr, companyId);
      batchable.push({
        ...lineFields(q),
        resolvedItemId,
        purchaseRequestIds: [pr._id],
        itemQuoteGroup: null,
        isStale: false,
        requestLabel: pr.productName,
        requestIdLabel: pr.requestId,
      });
    }

    // Group-based path (2026-10) — dedup by GROUP, not PR, since several
    // PRs now share one line. Only a group still Open with a non-empty,
    // still-unordered selection counts — guards the "selected, quoted,
    // then unselected everything" case, where this bid has nothing left
    // to flip to Ordered and must not surface as batchable at all.
    const seenGroup = new Set();
    for (const q of quotes) {
      if (!q.group) continue;
      const group = q.group;
      if (group.status !== 'Open' || !group.purchaseRequests?.length) continue;
      const groupId = String(group._id);
      if (seenGroup.has(groupId)) continue;
      const openPRs = group.purchaseRequests.filter(pr => !pr.purchaseOrder);
      if (!openPRs.length) continue;
      seenGroup.add(groupId);
      batchable.push({
        ...lineFields(q),
        resolvedItemId: group.item?._id || null,
        purchaseRequestIds: openPRs.map(pr => pr._id),
        itemQuoteGroup: group._id,
        // Computed live, every read — this bid's own frozen quantity (what
        // it was priced/charged against) no longer matches the group's
        // current quantity. Must be synced (Manual) or re-quoted (Email)
        // before it can be batched — see itemQuoteGroupController.js's
        // syncBidToGroupQuantity and createPurchase's own stale re-check.
        isStale: Number(q.quantity) !== Number(group.quantity),
        requestLabel: group.item?.name || 'Item',
        requestIdLabel: `${openPRs.length} request${openPRs.length > 1 ? 's' : ''}`,
      });
    }

    res.json({ success: true, data: batchable });
  } catch (error) {
    console.error('getBatchableQuotesForVendor error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
