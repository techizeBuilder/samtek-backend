// Company-wide purchase settings (procurement-v2, 2026-10-08) — see
// models/PurchaseSettings.js for what each field means and who owns it.
import PurchaseSettings from '../models/PurchaseSettings.js';
import Supplier from '../models/Supplier.js';
import { Item } from '../models/Inventory.js';

export async function getOrCreateSettings(companyId) {
  let settings = await PurchaseSettings.findOne({ companyId });
  if (!settings) {
    try {
      settings = await PurchaseSettings.create({ companyId });
    } catch (err) {
      // Two first reads racing — the unique index lets one win; use it.
      if (err.code !== 11000) throw err;
      settings = await PurchaseSettings.findOne({ companyId });
    }
  }
  return settings;
}

const requireCompany = (req, res) => {
  if (!req.user.companyId) {
    res.status(400).json({ message: 'Your account is not linked to a company.' });
    return false;
  }
  return true;
};

// GET /api/purchase-settings
export const getSettings = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const settings = await getOrCreateSettings(req.user.companyId);
    res.json({ settings });
  } catch (error) {
    console.error('Error loading purchase settings:', error);
    res.status(500).json({ message: 'Error loading purchase settings' });
  }
};

// PUT /api/purchase-settings/approval-rules — Company Admin.
// body: { minVendorsPerItem, poApprovalThreshold } (threshold '' / null = off)
export const updateApprovalRules = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const { minVendorsPerItem, poApprovalThreshold } = req.body;
    const n = Number(minVendorsPerItem);
    if (!Number.isInteger(n) || n < 1) {
      return res.status(400).json({ message: 'Minimum vendors must be a whole number of 1 or more.' });
    }
    let threshold = null;
    if (poApprovalThreshold !== '' && poApprovalThreshold != null) {
      threshold = Number(poApprovalThreshold);
      if (!Number.isFinite(threshold) || threshold < 0) {
        return res.status(400).json({ message: 'The PO approval threshold must be an amount of 0 or more, or empty for no approval.' });
      }
    }
    const settings = await getOrCreateSettings(req.user.companyId);
    settings.minVendorsPerItem = n;
    settings.poApprovalThreshold = threshold;
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ message: 'Saved', settings });
  } catch (error) {
    console.error('Error saving approval rules:', error);
    res.status(500).json({ message: 'Error saving settings' });
  }
};

// Trim, drop blanks, de-duplicate names case-insensitively (first wins).
function cleanLabels(list, withGst) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const row of list) {
    const name = String(row?.name || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    if (withGst) {
      const gst = Number(row?.defaultGstPercent);
      out.push({ name, defaultGstPercent: Number.isFinite(gst) && gst >= 0 && gst <= 100 ? gst : 0 });
    } else {
      out.push({ name });
    }
  }
  return out;
}

// The two built-in payment terms the system itself acts on — a custom label
// with the same name would just be confusing.
const BUILT_IN_TERMS = ['advance %', 'advance', 'credit days'];

// PUT /api/purchase-settings/templates — Purchase (accounts.purchaseSettings).
// body: { chargeLabels: [{name, defaultGstPercent}], termLabels: [{name}] }
export const updateTemplates = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const chargeLabels = cleanLabels(req.body.chargeLabels, true);
    const termLabels = cleanLabels(req.body.termLabels, false)
      .filter(t => !BUILT_IN_TERMS.includes(t.name.toLowerCase()));
    const settings = await getOrCreateSettings(req.user.companyId);
    settings.chargeLabels = chargeLabels;
    settings.termLabels = termLabels;
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ message: 'Saved', settings });
  } catch (error) {
    console.error('Error saving purchase templates:', error);
    res.status(500).json({ message: 'Error saving templates' });
  }
};

// PUT /api/purchase-settings/quote-rules — Purchase (accounts.purchaseSettings).
// body: { quoteValidityDays, priceJumpWarnPercent }
export const updateQuoteRules = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const days = Number(req.body.quoteValidityDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ message: 'Quote validity must be a whole number of days, from 1 to 365.' });
    }
    const warn = Number(req.body.priceJumpWarnPercent);
    if (!Number.isFinite(warn) || warn < 0 || warn > 1000) {
      return res.status(400).json({ message: 'The price-rise warning must be a % of 0 or more.' });
    }
    const settings = await getOrCreateSettings(req.user.companyId);
    settings.quoteValidityDays = days;
    settings.priceJumpWarnPercent = Math.round(warn * 10) / 10;
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ message: 'Saved', settings });
  } catch (error) {
    console.error('Error saving quote rules:', error);
    res.status(500).json({ message: 'Error saving quote rules' });
  }
};

const sourceOf = (it) => it.productKind === 'Machine' ? 'Product Master' : it.productKind === 'Motor' ? 'Motor Master' : 'Inventory';

// GET /api/purchase-settings/low-coverage-items?page&limit&search —
// Company Admin. Every Purchasable item (same set Vendor Master's Products
// picker offers — getSupplierCatalog) with FEWER than minVendorsPerItem
// approved + active vendors linked to it. Each row lists ALL its linked
// vendors with their status, so "2 linked but 1 is still a Draft" is visible.
export const getLowCoverageItems = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const companyId = req.user.companyId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
    const search = String(req.query.search || '').trim();

    const settings = await getOrCreateSettings(companyId);
    const minVendors = settings.minVendorsPerItem || 3;

    const itemQuery = {
      companyId, purchase: true, isDiscontinued: { $ne: true },
      productKind: { $nin: ['SubChildPart', 'ChildPart'] },
    };
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      itemQuery.$or = [{ name: rx }, { code: rx }];
    }
    const items = await Item.find(itemQuery).select('code name productKind').sort({ name: 1 }).lean();
    const itemIds = items.map(it => it._id);

    const vendors = itemIds.length
      ? await Supplier.find({ companyId, suppliedItems: { $in: itemIds } })
        .select('supplierName supplierCode approvalStatus status suppliedItems').lean()
      : [];
    const vendorsByItem = new Map();
    for (const v of vendors) {
      for (const id of v.suppliedItems || []) {
        const key = String(id);
        if (!vendorsByItem.has(key)) vendorsByItem.set(key, []);
        vendorsByItem.get(key).push({
          _id: v._id,
          supplierName: v.supplierName,
          supplierCode: v.supplierCode,
          approvalStatus: v.approvalStatus,
          status: v.status,
        });
      }
    }

    const rows = items
      .map(it => {
        const linked = vendorsByItem.get(String(it._id)) || [];
        const eligibleCount = linked.filter(v => v.approvalStatus === 'Approved' && v.status === 'active').length;
        return { _id: it._id, code: it.code, name: it.name, source: sourceOf(it), eligibleCount, vendors: linked };
      })
      .filter(r => r.eligibleCount < minVendors)
      .sort((a, b) => a.eligibleCount - b.eligibleCount || a.name.localeCompare(b.name));

    const total = rows.length;
    res.json({
      items: rows.slice((page - 1) * limit, page * limit),
      minVendorsPerItem: minVendors,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error('Error loading low vendor coverage items:', error);
    res.status(500).json({ message: 'Error loading items' });
  }
};

