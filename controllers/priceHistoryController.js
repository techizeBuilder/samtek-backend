// Price history (2026-10-12, client): what we paid for an item — from one
// vendor or all — over the last 7 days, 30 days, 1 year, all time or a custom
// range: average, last and lowest, per vendor, and the deliveries behind
// them. Same data and sums as "Bought before" on RFQ/PO, the PO review and the
// Company Admin's PO cards (services/quoteChecksService.js): delivered
// purchases only (each received request at its PO line's rate, dated when
// Store received it, QC-rejected included — the rate is what the vendor
// charged), before GST, one purchase unit at a time.
import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import { Item } from '../models/Inventory.js';
import { loadPriceSamples, summarizePrices } from '../services/quoteChecksService.js';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ymd = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (raw) => {
  if (!ymd.test(String(raw || ''))) return null;
  const d = new Date(`${raw}T12:00:00`);
  // A real calendar day only (2026-13-40 is refused, not rolled over).
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : d;
};

// GET /items?search= — items we've ordered (picker).
export const listPricedItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const ids = await Purchase.distinct('items.item', { companyId, status: { $nin: ['Pending Approval', 'Rejected', 'Cancelled'] } });
    const query = { _id: { $in: ids.filter(Boolean) } };
    const search = String(req.query.search || '').trim();
    if (search) query.$or = [{ name: new RegExp(escapeRe(search), 'i') }, { code: new RegExp(escapeRe(search), 'i') }];
    const items = await Item.find(query).select('name code purchaseUnit unit').sort({ name: 1 }).limit(30).lean();
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /?itemId= &vendorId= &from=YYYY-MM-DD &to=YYYY-MM-DD &unit=
export const getPriceHistory = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { itemId, vendorId } = req.query;
    if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ success: false, message: 'Pick an item.' });
    if (vendorId && !mongoose.isValidObjectId(vendorId)) return res.status(400).json({ success: false, message: 'Unknown vendor.' });
    const from = req.query.from ? dayOf(req.query.from) : null;
    const to = req.query.to ? dayOf(req.query.to) : null;
    if ((req.query.from && !from) || (req.query.to && !to)) return res.status(400).json({ success: false, message: 'Dates must be YYYY-MM-DD.' });
    if (from && to && from > to) return res.status(400).json({ success: false, message: 'The "from" date is after the "to" date.' });

    const item = await Item.findOne({ _id: itemId, companyId }).select('name code purchaseUnit unit').lean()
      || await Item.findById(itemId).select('name code purchaseUnit unit').lean();
    const samples = (await loadPriceSamples({ companyId, itemIds: [itemId] })).get(String(itemId)) || [];

    // Units this item was bought in (prices in different units are never mixed).
    const unitCounts = new Map();
    for (const s of samples) unitCounts.set(s.unit || '', (unitCounts.get(s.unit || '') || 0) + 1);
    const units = [...unitCounts.entries()].map(([unit, count]) => ({ unit, count }));
    const unit = req.query.unit != null && unitCounts.has(String(req.query.unit)) ? String(req.query.unit) : (samples[0]?.unit || '');

    // Vendors who ever delivered it (for the picker), in this unit.
    const vendorMap = new Map();
    for (const s of samples) if ((s.unit || '') === unit && !vendorMap.has(s.vendorId)) vendorMap.set(s.vendorId, s.vendorName);
    const vendors = [...vendorMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

    const summary = summarizePrices(samples, { unit, from, to, vendorId: vendorId || null, withSamples: false });
    // Every delivery in the range (newest first), for the table under the figures.
    const fromT = from ? new Date(from).setHours(0, 0, 0, 0) : null;
    const toT = to ? new Date(to).setHours(23, 59, 59, 999) : null;
    const deliveries = samples
      .filter(s => (s.unit || '') === unit
        && (fromT == null || new Date(s.date).getTime() >= fromT)
        && (toT == null || new Date(s.date).getTime() <= toT)
        && (!vendorId || s.vendorId === String(vendorId)))
      .slice(0, 500)
      .map(s => ({ date: s.date, vendorId: s.vendorId, vendorName: s.vendorName, poNumber: s.poNumber, price: s.price, quantity: s.quantity }));

    res.json({ success: true, data: { item, unit, units, vendors, summary, deliveries, from: req.query.from || null, to: req.query.to || null } });
  } catch (error) {
    console.error('getPriceHistory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
