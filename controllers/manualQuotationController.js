// Manual quotation with evidence (procurement-v2, 2026-10-09) — see
// models/ManualQuotation.js. One request = the evidence (files + channel +
// quote date) AND every ticked item's price, saved together: a manual price
// never exists without its proof, and there's no half-done "unlocked" state.
// A price that replaces this vendor's earlier priced quote for an item needs
// a reason (blueprint §10 negotiation history / QT3).
import ManualQuotation, { MANUAL_QUOTE_CHANNELS } from '../models/ManualQuotation.js';
import VendorBid from '../models/VendorBid.js';
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import Supplier from '../models/Supplier.js';
import { eligibleVendorError } from '../services/vendorApprovalService.js';
import { groupsHeldByPendingPO, cleanPoCharges, cleanPaymentTerms } from './purchaseController.js';
import { markCustom } from './quotationRequestController.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import { groupFabricationLines } from './itemQuoteGroupController.js';
import { DEFAULT_QUOTE_VALIDITY_DAYS, isQuoteExpired } from '../services/quoteChecksService.js';
import { discardQuoteEvidenceUploads, quoteEvidenceUrl } from '../middleware/quoteEvidenceUpload.js';
import { vendorCarryOver } from '../services/quotationCarryOverService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The date on the evidence ('YYYY-MM-DD'): not in the future, and not so old
// that the quote would already be past the company's quote validity.
// Today → now; an earlier day → that day at noon (no timezone slip).
export function parseQuoteDate(value, validityDays, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return { error: 'Enter the date on the evidence (the day the vendor gave the quote).' };
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (Number.isNaN(date.getTime()) || dayKey(date) !== value) return { error: 'The quote date is not a valid date.' };
  const today = dayKey(now);
  if (value > today) return { error: 'The quote date can\'t be in the future.' };
  if (value === today) return { date: now };
  const oldest = new Date(now.getTime() - validityDays * DAY_MS);
  if (value < dayKey(oldest)) return { error: `A quote from ${value} is already past the ${validityDays}-day quote validity — get a fresh quote from the vendor.` };
  return { date };
}

// Pure check of the typed prices. `existingByGroup`: groupId -> this
// vendor's current priced quote (if any) — replacing one needs a reason.
export function readManualItems(bodyItems, existingByGroup = new Map()) {
  const list = Array.isArray(bodyItems) ? bodyItems : [];
  if (!list.length) return { error: 'Tick at least one item.' };
  const seen = new Set();
  const items = [];
  for (const raw of list) {
    const group = String(raw?.group || '');
    const label = raw?.itemName ? `"${raw.itemName}"` : 'an item';
    if (!/^[a-f0-9]{24}$/i.test(group)) return { error: 'One of the items is not valid — refresh the page.' };
    if (seen.has(group)) return { error: `${label} is listed twice.` };
    seen.add(group);
    const unitPrice = Number(raw.unitPrice);
    if (!(unitPrice > 0)) return { error: `Enter the rate for ${label}.` };
    const deliveryDays = Number(raw.deliveryDays);
    if (!(deliveryDays >= 1)) return { error: `Enter the delivery time (days) for ${label}.` };
    // GST is required, as on the vendor's email page (2026-10-14): the PO
    // takes it from the quote and can't change it.
    let gstPercent = null;
    if (!raw.gstInclusive) {
      if (raw.gstPercent === '' || raw.gstPercent == null) return { error: `Enter the GST % for ${label} (0 if none), or tick "Rate already includes GST".` };
      gstPercent = Number(raw.gstPercent);
      if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) return { error: `GST % for ${label} must be between 0 and 100.` };
    }
    const revisionReason = String(raw.revisionReason || '').trim();
    const replaces = existingByGroup.get(group) || null;
    if (replaces && !revisionReason) return { error: `${label} already has a quote from this vendor — give the reason for the new price.` };
    items.push({
      group,
      unitPrice,
      deliveryDays: Math.round(deliveryDays),
      warrantyMonths: Math.max(0, parseInt(raw.warrantyMonths) || 0),
      gstInclusive: !!raw.gstInclusive,
      gstPercent,
      remarks: String(raw.remarks || '').trim(),
      revisionReason: replaces ? revisionReason : '',
      replaces,
    });
  }
  return { items };
}

async function nextNumber(companyId) {
  const count = await ManualQuotation.countDocuments({ companyId });
  return `MQ-${String(count + 1).padStart(4, '0')}`;
}

// GET /api/manual-quotations/carry-over?vendor= — the vendor's charges +
// payment terms from their last quotation, to pre-fill a new one (2026-10-14,
// services/quotationCarryOverService.js). data: null when nothing carries.
export const getCarryOver = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const vendorId = String(req.query.vendor || '');
    if (!/^[a-f0-9]{24}$/i.test(vendorId)) return res.status(400).json({ success: false, message: 'Pick a vendor.' });
    const vendor = await Supplier.findOne({ _id: vendorId, companyId }).select('_id').lean();
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found.' });
    const settings = await getOrCreateSettings(companyId);
    const data = await vendorCarryOver({ companyId, vendorId: vendor._id, validityDays: settings.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS });
    res.json({ success: true, data });
  } catch (error) {
    console.error('getCarryOver error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/manual-quotations (multipart: files[] + fields; `items` is JSON)
export const createManualQuotation = async (req, res) => {
  const refuse = async (status, message) => {
    await discardQuoteEvidenceUploads(req);
    return res.status(status).json({ success: false, message });
  };
  const created = { record: null, bids: [] };
  try {
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return refuse(400, 'Attach the evidence — the vendor\'s WhatsApp message, PDF quotation, email or written quote.');

    const { vendor: vendorId, channel, contactPerson, notes } = req.body;
    const channelOther = String(req.body.channelOther || '').trim();
    if (!MANUAL_QUOTE_CHANNELS.includes(channel)) return refuse(400, 'Pick how the vendor gave the quote.');
    if (channel === 'Other' && !channelOther) return refuse(400, 'Type how the vendor gave the quote.');

    const vendor = await Supplier.findOne({ _id: vendorId, companyId, unit: { $in: [unit, 'Main'] } });
    const notEligible = eligibleVendorError(vendor);
    if (notEligible) return refuse(400, notEligible);

    const settings = await getOrCreateSettings(companyId);
    const validityDays = settings.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
    const qd = parseQuoteDate(req.body.quoteDate, validityDays);
    if (qd.error) return refuse(400, qd.error);

    let bodyItems;
    try { bodyItems = JSON.parse(req.body.items || '[]'); } catch { return refuse(400, 'The item list could not be read — refresh the page.'); }
    // The vendor's charges + payment terms (2026-10-09) — names from the
    // Purchase template or the vendor's own (marked custom).
    let chargesBody;
    let termsBody;
    try {
      chargesBody = JSON.parse(req.body.charges || '[]');
      termsBody = JSON.parse(req.body.paymentTerms || '{}');
    } catch { return refuse(400, 'The charges / payment terms could not be read — refresh the page.'); }
    const cleanTerms = cleanPaymentTerms(termsBody);
    const quotedCharges = markCustom(cleanPoCharges(chargesBody), (settings.chargeLabels || []).map(c => c.name));
    const quotedTerms = { ...cleanTerms, others: markCustom(cleanTerms.others, (settings.termLabels || []).map(t => t.name)) };

    const groupIds = [...new Set((Array.isArray(bodyItems) ? bodyItems : []).map(i => String(i?.group || '')).filter(id => /^[a-f0-9]{24}$/i.test(id)))];
    const groups = groupIds.length
      ? await ItemQuoteGroup.find({ _id: { $in: groupIds }, companyId }).populate('item', 'name code').populate('purchaseRequests', 'fabricationDimensionLines')
      : [];
    const groupById = new Map(groups.map(g => [String(g._id), g]));
    const supplied = new Set((vendor.suppliedItems || []).map(String));
    for (const id of groupIds) {
      const g = groupById.get(id);
      if (!g) return refuse(404, 'One or more items could not be found — refresh the page.');
      if (g.status !== 'Open') return refuse(400, `"${g.item?.name}" has already been ordered.`);
      if (!(g.quantity > 0)) return refuse(400, `Set a quantity for "${g.item?.name}" first.`);
      if (!supplied.has(String(g.item?._id))) return refuse(400, `${vendor.supplierName} isn't linked to "${g.item?.name}" in Vendor Master.`);
    }
    const held = await groupsHeldByPendingPO(companyId, groupIds);
    if (held.size) return refuse(409, `Some items are on ${[...new Set(held.values())].join(', ')}, waiting for Company Admin approval.`);

    // This vendor's current priced quote per item. A new price over a still
    // VALID quote for the same quantity is a renegotiation and needs a reason;
    // over an expired quote, or one for an old quantity, it's simply a fresh
    // quote — still linked as replacing it, with the reason noted for them
    // (user, 2026-10-10).
    const current = await VendorBid.find({ group: { $in: groupIds }, vendor: vendor._id, companyId, status: 'Submitted' }).select('group quantity submittedAt createdAt status').sort({ createdAt: -1 }).lean();
    const existingByGroup = new Map();
    const autoReplace = new Map(); // groupId -> { bid, note }
    for (const b of current) {
      const gid = String(b.group);
      if (existingByGroup.has(gid) || autoReplace.has(gid)) continue;
      const g = groupById.get(gid);
      if (isQuoteExpired(b, validityDays)) autoReplace.set(gid, { bid: b._id, note: 'Previous quote had expired' });
      else if (g && Number(b.quantity) !== Number(g.quantity)) autoReplace.set(gid, { bid: b._id, note: 'Quantity changed since the previous quote' });
      else existingByGroup.set(gid, b._id);
    }
    const read = readManualItems(bodyItems.map(i => ({ ...i, itemName: groupById.get(String(i?.group))?.item?.name })), existingByGroup);
    if (read.error) return refuse(400, read.error);
    for (const it of read.items) {
      const auto = !it.replaces && autoReplace.get(it.group);
      if (auto) { it.replaces = auto.bid; it.revisionReason = auto.note; }
    }

    // ── Save: the evidence record, then one quote per item ───────────────
    created.record = await ManualQuotation.create({
      companyId, unit,
      number: await nextNumber(companyId),
      vendor: vendor._id,
      vendorName: vendor.supplierName,
      channel,
      channelOther: channel === 'Other' ? channelOther : '',
      quoteDate: qd.date,
      contactPerson: String(contactPerson || '').trim(),
      notes: String(notes || '').trim(),
      charges: quotedCharges,
      paymentTerms: quotedTerms,
      files: files.map(f => ({ fileUrl: quoteEvidenceUrl(f), fileName: f.originalname, mimeType: f.mimetype, size: f.size })),
      items: [],
      createdBy: req.user._id,
    });
    for (const it of read.items) {
      const g = groupById.get(it.group);
      const bid = await VendorBid.create({
        group: g._id,
        source: 'Manual',
        vendor: vendor._id,
        vendorName: vendor.supplierName,
        productName: g.item?.name || 'Item',
        quantity: g.quantity,
        purchaseUnit: g.purchaseUnit,
        purchaseUnitType: g.purchaseUnitType,
        fabricationDimensionLines: groupFabricationLines(g),
        unitPrice: it.unitPrice,
        totalPrice: it.unitPrice * g.quantity,
        itemCharges: [],
        itemChargesTotal: 0,
        gstInclusive: it.gstInclusive,
        gstPercent: it.gstPercent,
        deliveryDays: it.deliveryDays,
        warrantyMonths: it.warrantyMonths,
        remarks: it.remarks,
        status: 'Submitted',
        // The date on the evidence — quote validity counts from here.
        submittedAt: qd.date,
        manualQuotation: created.record._id,
        revisionReason: it.revisionReason,
        replacesBid: it.replaces,
        companyId,
        unit,
      });
      created.bids.push(bid._id);
      created.record.items.push({
        group: g._id, vendorBid: bid._id, itemName: g.item?.name || 'Item', itemCode: g.item?.code || '',
        quantity: g.quantity, purchaseUnit: g.purchaseUnit || '', unitPrice: it.unitPrice,
      });
    }
    await created.record.save();
    // This vendor's earlier quote / open email request for these items is now
    // replaced — kept as 'Superseded' so All quotes still shows it.
    await VendorBid.updateMany(
      { group: { $in: groupIds }, vendor: vendor._id, companyId, _id: { $nin: created.bids }, status: { $in: ['Submitted', 'Invited'] } },
      { status: 'Superseded' }
    );

    res.status(201).json({
      success: true,
      message: `${created.record.number} saved — ${read.items.length} item${read.items.length === 1 ? '' : 's'} quoted by ${vendor.supplierName}.`,
      data: { _id: created.record._id, number: created.record.number },
    });
  } catch (error) {
    console.error('createManualQuotation error:', error);
    // Never leave half a save: remove what was created, and the files.
    try {
      if (created.bids.length) await VendorBid.deleteMany({ _id: { $in: created.bids } });
      if (created.record) await ManualQuotation.deleteOne({ _id: created.record._id });
    } catch (cleanupErr) {
      console.error('createManualQuotation cleanup error:', cleanupErr);
    }
    await discardQuoteEvidenceUploads(req);
    res.status(500).json({ success: false, message: 'Could not save the manual quotation. Nothing was saved — please try again.' });
  }
};
