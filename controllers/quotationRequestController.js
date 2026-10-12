// One quotation email per vendor for several items (procurement-v2,
// 2026-10-08) — see models/QuotationRequest.js. Purchase ticks items on a
// vendor's card on RFQ/PO → ONE email → the vendor prices every item on one
// public page (/vendor-quotation/:token) and adds their charges and payment
// terms. Each item keeps its own VendorBid (one quote per item group per
// vendor, as before), so everything downstream (board, batching, PO) works
// unchanged. One submission only (client decision).
import crypto from 'crypto';
import QuotationRequest from '../models/QuotationRequest.js';
import VendorBid from '../models/VendorBid.js';
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import Supplier from '../models/Supplier.js';
import { Company } from '../models/Company.js';
import { eligibleVendorError } from '../services/vendorApprovalService.js';
import { sendQuotationRequestEmail } from '../services/emailService.js';
import { groupsHeldByPendingPO, cleanPoCharges, cleanPaymentTerms } from './purchaseController.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import { groupFabricationLines } from './itemQuoteGroupController.js';
import { DEFAULT_QUOTE_VALIDITY_DAYS } from '../services/quoteChecksService.js';

const LINK_VALID_DAYS = 7;
const pctOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

async function nextRequestNumber(companyId) {
  const count = await QuotationRequest.countDocuments({ companyId });
  return `QR-${String(count + 1).padStart(4, '0')}`;
}

const isExpired = (qr) => qr.status === 'Sent' && qr.tokenExpiry && new Date() > new Date(qr.tokenExpiry);

// POST /api/quotation-requests   body: { vendor, groups: [itemQuoteGroupId] }
export const createQuotationRequest = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const { vendor: vendorId } = req.body;
    const groupIds = [...new Set((Array.isArray(req.body.groups) ? req.body.groups : []).map(String))];
    if (!vendorId) return res.status(400).json({ success: false, message: 'Vendor is required' });
    if (!groupIds.length) return res.status(400).json({ success: false, message: 'Pick at least one item' });

    const vendor = await Supplier.findOne({ _id: vendorId, companyId, unit: { $in: [unit, 'Main'] } });
    const notEligible = eligibleVendorError(vendor);
    if (notEligible) return res.status(400).json({ success: false, message: notEligible });
    if (!vendor.email) return res.status(400).json({ success: false, message: `${vendor.supplierName} has no email address in Vendor Master.` });

    const groups = await ItemQuoteGroup.find({ _id: { $in: groupIds }, companyId })
      .populate('item', 'name code')
      .populate('purchaseRequests', 'fabricationDimensionLines');
    if (groups.length !== groupIds.length) return res.status(404).json({ success: false, message: 'One or more items could not be found — refresh the page.' });
    const supplied = new Set((vendor.suppliedItems || []).map(String));
    for (const g of groups) {
      if (g.status !== 'Open') return res.status(400).json({ success: false, message: `"${g.item?.name}" has already been ordered.` });
      if (!(g.quantity > 0)) return res.status(400).json({ success: false, message: `Set a quantity for "${g.item?.name}" first.` });
      if (!supplied.has(String(g.item?._id))) return res.status(400).json({ success: false, message: `${vendor.supplierName} isn't linked to "${g.item?.name}" in Vendor Master.` });
    }
    const held = await groupsHeldByPendingPO(companyId, groupIds);
    if (held.size) return res.status(409).json({ success: false, message: `Some items are on ${[...new Set(held.values())].join(', ')}, waiting for Company Admin approval.` });

    const settings = await getOrCreateSettings(companyId);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + LINK_VALID_DAYS * 24 * 60 * 60 * 1000);
    const request = new QuotationRequest({
      companyId, unit,
      number: await nextRequestNumber(companyId),
      vendor: vendor._id,
      vendorName: vendor.supplierName,
      token, tokenExpiry,
      createdBy: req.user._id,
      offeredChargeLabels: (settings.chargeLabels || []).map(c => ({ name: c.name, defaultGstPercent: c.defaultGstPercent || 0 })),
      offeredTermLabels: (settings.termLabels || []).map(t => ({ name: t.name })),
      items: [],
    });

    for (const g of groups) {
      // One open request per vendor per item — an older unanswered one is replaced.
      await VendorBid.updateMany(
        { group: g._id, vendor: vendor._id, companyId, status: 'Invited' },
        { status: 'Superseded' }
      );
      // One size × the pieces wanted for a fabrication card (2026-10-09).
      const fabricationDimensionLines = groupFabricationLines(g);
      const bid = await VendorBid.create({
        group: g._id,
        source: 'Email',
        vendor: vendor._id,
        vendorName: vendor.supplierName,
        productName: g.item?.name || 'Item',
        quantity: g.quantity,
        purchaseUnit: g.purchaseUnit,
        purchaseUnitType: g.purchaseUnitType,
        fabricationDimensionLines,
        unitPrice: 0,
        totalPrice: 0,
        deliveryDays: 1, // placeholder until the vendor answers
        status: 'Invited',
        quotationRequest: request._id,
        companyId,
        unit,
      });
      request.items.push({
        group: g._id,
        vendorBid: bid._id,
        itemName: g.item?.name || 'Item',
        itemCode: g.item?.code || '',
        quantity: g.quantity,
        purchaseUnit: g.purchaseUnit,
        purchaseUnitType: g.purchaseUnitType,
        fabricationDimensionLines,
      });
    }

    const company = await Company.findById(companyId).select('name').lean();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/vendor-quotation/${token}`;
    let warning = null;
    try {
      const result = await sendQuotationRequestEmail({
        to: vendor.email,
        vendorName: vendor.supplierName,
        requestNo: request.number,
        items: request.items,
        link,
        expiresAt: tokenExpiry,
        companyName: company?.name || 'Samtek',
        validityDays: settings.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS,
      });
      if (!result.success) {
        request.emailStatus = 'Failed';
        request.emailError = result.error || 'Unknown error';
        warning = `Request ${request.number} saved, but the email didn't go out: ${request.emailError}. Send the request again, or enter the vendor's quote as a Manual quotation (with evidence).`;
      }
    } catch (err) {
      request.emailStatus = 'Failed';
      request.emailError = err.message;
      warning = `Request ${request.number} saved, but the email didn't go out: ${err.message}. Send the request again, or enter the vendor's quote as a Manual quotation (with evidence).`;
    }
    await request.save();
    if (request.emailStatus === 'Failed') {
      await VendorBid.updateMany({ quotationRequest: request._id }, { emailStatus: 'Failed', emailError: request.emailError });
    }

    res.status(201).json({
      success: true,
      message: warning ? undefined : `${request.number} emailed to ${vendor.supplierName} for ${request.items.length} item${request.items.length === 1 ? '' : 's'}.`,
      warning,
      // The vendor's link is NEVER sent back to the page (2026-10-10, user
      // decision): anyone holding it can submit prices as the vendor — even a
      // staff member who logs out and opens it. It only ever goes to the
      // vendor's own email. If the email fails: send again, or record the
      // quote as a Manual quotation with evidence.
      data: { _id: request._id, number: request.number, emailStatus: request.emailStatus, tokenExpiry },
    });
  } catch (error) {
    console.error('createQuotationRequest error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUBLIC  GET /api/vendor-quotation/:token — what the vendor's page shows.
export const getQuotationByToken = async (req, res) => {
  try {
    const qr = await QuotationRequest.findOne({ token: req.params.token });
    if (!qr) return res.status(404).json({ success: false, message: 'This quotation link is not valid.' });
    if (isExpired(qr)) {
      qr.status = 'Expired';
      await qr.save();
    }
    if (qr.status === 'Expired') {
      return res.status(410).json({ success: false, message: 'This quotation link has expired. Please contact us for a new one.' });
    }

    const company = await Company.findById(qr.companyId).select('name').lean();
    const settings = await getOrCreateSettings(qr.companyId);
    const bids = await VendorBid.find({ _id: { $in: qr.items.map(i => i.vendorBid) } }).lean();
    const bidById = new Map(bids.map(b => [String(b._id), b]));
    const submitted = qr.status === 'Submitted';

    res.json({
      success: true,
      data: {
        requestNo: qr.number,
        companyName: company?.name || 'Samtek',
        vendorName: qr.vendorName,
        status: qr.status,
        tokenExpiry: qr.tokenExpiry,
        // How long we treat their prices as valid (Purchase Settings).
        quoteValidityDays: settings.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS,
        offeredChargeLabels: qr.offeredChargeLabels,
        offeredTermLabels: qr.offeredTermLabels,
        items: qr.items.map(it => {
          const bid = bidById.get(String(it.vendorBid));
          return {
            vendorBidId: it.vendorBid,
            itemName: it.itemName,
            itemCode: it.itemCode,
            quantity: it.quantity,
            purchaseUnit: it.purchaseUnit,
            fabricationDimensionLines: it.fabricationDimensionLines || [],
            // Not open any more — shown but not editable. 'replaced': Purchase
            // sent a newer request for this item; 'closed': already ordered.
            replaced: !submitted && bid?.status !== 'Invited',
            closedReason: !submitted && bid?.status !== 'Invited' ? (bid?.status === 'Superseded' ? 'replaced' : 'closed') : null,
            answer: submitted && bid ? {
              declined: bid.status === 'Declined',
              unitPrice: bid.unitPrice,
              gstPercent: bid.gstPercent,
              gstInclusive: bid.gstInclusive,
              deliveryDays: bid.deliveryDays,
              warrantyMonths: bid.warrantyMonths,
              remarks: bid.remarks,
            } : null,
          };
        }),
        submission: submitted ? {
          charges: qr.charges,
          paymentTerms: qr.paymentTerms,
          remarks: qr.vendorRemarks,
          submittedAt: qr.submittedAt,
        } : null,
      },
    });
  } catch (error) {
    console.error('getQuotationByToken error:', error);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

// Pure check of what the vendor sent — which items are priced, which are left
// blank (declined), and any problem to show them. Exported for testing.
export function readVendorSubmission(requestItems, bidById, bodyItems) {
  const byBid = new Map((Array.isArray(bodyItems) ? bodyItems : []).map(e => [String(e?.vendorBidId), e]));
  const priced = [];
  const declined = [];
  for (const it of requestItems) {
    const bid = bidById.get(String(it.vendorBid));
    if (!bid || bid.status !== 'Invited') continue; // replaced by a newer request
    const entry = byBid.get(String(it.vendorBid));
    const price = Number(entry?.unitPrice);
    if (!entry || !(price > 0)) {
      declined.push(bid);
      continue;
    }
    const days = Number(entry.deliveryDays);
    if (!(days >= 1)) return { error: `Enter the delivery time (days) for "${it.itemName}".` };
    priced.push({ bid, entry, price, days: Math.round(days) });
  }
  if (!priced.length) return { error: 'Enter a price for at least one item (leave an item blank only if you can\'t supply it).' };
  return { priced, declined };
}

// A charge / term the vendor typed themselves (not one of the offered
// template names) is marked custom — it stays on this quotation only.
export function markCustom(lines, offeredNames) {
  const offered = new Set((offeredNames || []).map(n => String(n).trim().toLowerCase()));
  return lines.map(l => ({ ...l, custom: !offered.has(String(l.label).trim().toLowerCase()) }));
}

// PUBLIC  POST /api/vendor-quotation/:token — the vendor's one submission.
export const submitQuotationByToken = async (req, res) => {
  try {
    const qr = await QuotationRequest.findOne({ token: req.params.token });
    if (!qr) return res.status(404).json({ success: false, message: 'This quotation link is not valid.' });
    if (qr.status === 'Submitted') return res.status(409).json({ success: false, message: 'This quotation has already been submitted.' });
    if (qr.status === 'Expired' || isExpired(qr)) {
      if (qr.status !== 'Expired') { qr.status = 'Expired'; await qr.save(); }
      return res.status(410).json({ success: false, message: 'This quotation link has expired. Please contact us for a new one.' });
    }

    const bids = await VendorBid.find({ _id: { $in: qr.items.map(i => i.vendorBid) }, quotationRequest: qr._id });
    const bidById = new Map(bids.map(b => [String(b._id), b]));
    const result = readVendorSubmission(qr.items, bidById, req.body.items);
    if (result.error) return res.status(400).json({ success: false, message: result.error });

    const now = new Date();
    for (const { bid, entry, price, days } of result.priced) {
      bid.unitPrice = price;
      bid.totalPrice = price * bid.quantity;
      bid.gstPercent = pctOrNull(entry.gstPercent);
      bid.gstInclusive = !!entry.gstInclusive;
      bid.deliveryDays = days;
      bid.warrantyMonths = Math.max(0, parseInt(entry.warrantyMonths) || 0);
      bid.remarks = String(entry.remarks || '').trim();
      bid.status = 'Submitted';
      bid.submittedAt = now;
      await bid.save();
      // This vendor's older quote for the same item is now replaced.
      await VendorBid.updateMany(
        { group: bid.group, vendor: bid.vendor, _id: { $ne: bid._id }, status: 'Submitted' },
        { status: 'Superseded' }
      );
    }
    for (const bid of result.declined) {
      bid.status = 'Declined';
      bid.remarks = 'Not quoted by the vendor';
      await bid.save();
    }

    const terms = cleanPaymentTerms(req.body.paymentTerms);
    qr.charges = markCustom(cleanPoCharges(req.body.charges), qr.offeredChargeLabels.map(c => c.name));
    qr.paymentTerms = { ...terms, others: markCustom(terms.others, qr.offeredTermLabels.map(t => t.name)) };
    qr.vendorRemarks = String(req.body.remarks || '').trim();
    qr.status = 'Submitted';
    qr.submittedAt = now;
    await qr.save();

    res.json({ success: true, message: 'Thank you — your quotation has been submitted.' });
  } catch (error) {
    console.error('submitQuotationByToken error:', error);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

// POST /api/quotation-requests/:id/remind — Purchase's "Send reminder" (point
// 16, 2026-10-10): the same link re-emailed to the vendor, marked as a
// reminder, with only the items still open. At most once a day
// (services/quoteReminderService.js).
export const remindQuotationRequest = async (req, res) => {
  try {
    const qr = await QuotationRequest.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!qr) return res.status(404).json({ success: false, message: 'Quotation request not found' });
    const { sendVendorReminder } = await import('../services/quoteReminderService.js');
    const result = await sendVendorReminder({ qr, user: req.user });
    if (result.status) return res.status(result.status).json({ success: false, message: result.message });
    res.json({ success: true, message: result.message });
  } catch (error) {
    console.error('remindQuotationRequest error:', error);
    res.status(500).json({ success: false, message: 'Could not send the reminder.' });
  }
};
