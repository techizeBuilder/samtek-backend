// Company-wide purchase settings (procurement-v2, 2026-10-08) — see
// models/PurchaseSettings.js for what each field means and who owns it.
import PurchaseSettings from '../models/PurchaseSettings.js';
import Supplier from '../models/Supplier.js';
import { Item } from '../models/Inventory.js';
import { BUILT_IN_DOC_TYPES, DOC_RULES, effectiveDocumentTypes } from '../services/vendorDocumentRulesService.js';

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
    res.json({ settings, vendorDocumentTypes: effectiveDocumentTypes(settings) });
  } catch (error) {
    console.error('Error loading purchase settings:', error);
    res.status(500).json({ message: 'Error loading purchase settings' });
  }
};

// PUT /api/purchase-settings/approval-rules — Company Admin.
// body: { minVendorsPerItem, minQuotationsPerItem?, poApprovalThreshold, outsourceApprovalThreshold? }
// (a threshold '' / null = off)
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
    // Outsource order limit (outsource-v2 slice 2) — only touched when sent,
    // so an older page saving the PO rules never clears it.
    let outsourceThreshold;
    if ('outsourceApprovalThreshold' in req.body) {
      const v = req.body.outsourceApprovalThreshold;
      outsourceThreshold = null;
      if (v !== '' && v != null) {
        outsourceThreshold = Number(v);
        if (!Number.isFinite(outsourceThreshold) || outsourceThreshold < 0) {
          return res.status(400).json({ message: 'The outsource order limit must be an amount of 0 or more, or empty for no approval.' });
        }
      }
    }
    const settings = await getOrCreateSettings(req.user.companyId);
    // Minimum quotations received per item (2026-10-29) — only touched when
    // sent; never above the vendors asked.
    let q = settings.minQuotationsPerItem || 1;
    if ('minQuotationsPerItem' in req.body) {
      q = Number(req.body.minQuotationsPerItem);
      if (!Number.isInteger(q) || q < 1) return res.status(400).json({ message: 'Minimum quotations must be a whole number of 1 or more.' });
    }
    if (q > n) return res.status(400).json({ message: `Minimum quotations (${q}) can't be more than minimum vendors per item (${n}) — you can't receive more quotations than you ask for.` });
    settings.minQuotationsPerItem = q;
    settings.minVendorsPerItem = n;
    settings.poApprovalThreshold = threshold;
    if (outsourceThreshold !== undefined) settings.outsourceApprovalThreshold = outsourceThreshold;
    // Pricing types (2026-10-22) — only touched when sent.
    if ('approveTimeBasedOutsource' in req.body) settings.approveTimeBasedOutsource = req.body.approveTimeBasedOutsource === true;
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
      out.push({ name, defaultGstPercent: Number.isFinite(gst) && gst >= 0 && gst <= 100 ? gst : 0, isTransport: !!row?.isTransport });
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

// PUT /api/purchase-settings/vendor-documents — Company Admin (2026-10-28,
// docs/procurement-v2/vendor-documents-design-2026-10.md).
// body: { rules: { '<built-in name>': 'none'|'required'|'verified' },
//         custom: [{ _id?, name, rule }] }   — the full list of custom types
// A built-in type can't be renamed or deleted (only its rule changes). A
// custom entry with an _id is an edit (a rename also renames the documents
// already uploaded); without one it's new; one left out is deleted — refused
// while it's still Required.
export const updateVendorDocumentTypes = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const companyId = req.user.companyId;
    const settings = await getOrCreateSettings(companyId);
    const before = effectiveDocumentTypes(settings);
    const beforeCustom = before.filter(t => !t.builtIn);
    const rules = req.body.rules && typeof req.body.rules === 'object' ? req.body.rules : {};
    const custom = Array.isArray(req.body.custom) ? req.body.custom : [];
    const bad = (message) => res.status(400).json({ message });

    const next = [];
    const seen = new Set(BUILT_IN_DOC_TYPES.map(b => b.name.toLowerCase()));
    for (const b of BUILT_IN_DOC_TYPES) {
      // 'Other' is outside the setting — always optional.
      if (b.uploadOnly) { next.push({ name: b.name, builtIn: true, rule: 'none' }); continue; }
      const rule = rules[b.name] ?? before.find(t => t.name === b.name).rule;
      if (!DOC_RULES.includes(rule)) return bad(`Choose Not required, Required or Required and verified for ${b.name}.`);
      next.push({ name: b.name, builtIn: true, rule });
    }

    const renames = [];
    const kept = new Set();
    for (const c of custom) {
      const name = String(c?.name ?? '').trim();
      if (!name) continue; // a blank row is just dropped
      const rule = c.rule || 'none';
      if (!DOC_RULES.includes(rule)) return bad(`Choose Not required, Required or Required and verified for ${name}.`);
      if (seen.has(name.toLowerCase())) return bad(`"${name}" is already on the list.`);
      seen.add(name.toLowerCase());
      const old = c._id ? beforeCustom.find(t => String(t._id) === String(c._id)) : null;
      if (c._id && !old) return bad('A document type you edited no longer exists — reload the page.');
      if (old) {
        kept.add(String(old._id));
        if (old.name !== name) renames.push({ from: old.name, to: name });
        next.push({ _id: old._id, name, builtIn: false, rule });
      } else {
        next.push({ name, builtIn: false, rule });
      }
    }
    for (const t of beforeCustom) {
      if (!kept.has(String(t._id)) && t.rule !== 'none') {
        return bad(`"${t.name}" is ${t.rule === 'verified' ? 'Required and verified' : 'Required'} — make it Not required before deleting it.`);
      }
    }
    // A swap (A → B while B → A) would merge the two on existing documents.
    if (renames.some(r => renames.some(o => o !== r && o.from === r.to))) return bad('Rename one type at a time when the new name is the old name of another.');

    settings.vendorDocumentTypes = next;
    settings.updatedBy = req.user._id;
    await settings.save();
    for (const r of renames) {
      await Supplier.updateMany(
        { companyId, 'documents.docType': r.from },
        { $set: { 'documents.$[d].docType': r.to } },
        { arrayFilters: [{ 'd.docType': r.from }] },
      );
    }
    res.json({ message: 'Saved', settings, vendorDocumentTypes: effectiveDocumentTypes(settings) });
  } catch (error) {
    console.error('Error saving vendor document types:', error);
    res.status(500).json({ message: 'Error saving vendor document types' });
  }
};

// PUT /api/purchase-settings/entity-types — Purchase (accounts.purchaseSettings).
// body: { entityTypes: [{ name }] } — Vendor Master's Entity Type choices
// (2026-10-28). At least one; duplicates (any case) dropped. A vendor already
// saved with a type taken off the list keeps it.
export const updateEntityTypes = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const seen = new Set();
    const entityTypes = [];
    for (const t of Array.isArray(req.body.entityTypes) ? req.body.entityTypes : []) {
      const name = String(t?.name ?? t ?? '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      entityTypes.push({ name });
    }
    if (!entityTypes.length) return res.status(400).json({ message: 'Keep at least one entity type.' });
    const settings = await getOrCreateSettings(req.user.companyId);
    settings.entityTypes = entityTypes;
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ message: 'Saved', settings });
  } catch (error) {
    console.error('Error saving entity types:', error);
    res.status(500).json({ message: 'Error saving entity types' });
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

// PUT /api/purchase-settings/vendor-score — Company Admin (2026-10-13).
// body: { weights: { price, quality, delivery, credit, warranty, response }, watchlistBelow }
export const updateVendorScoreSettings = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const { readScoreSettings } = await import('../services/vendorScoreService.js');
    const read = readScoreSettings(req.body);
    if (read.error) return res.status(400).json({ message: read.error });
    const settings = await getOrCreateSettings(req.user.companyId);
    settings.vendorScore = { weights: read.weights, watchlistBelow: read.watchlistBelow };
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ message: 'Saved', settings });
  } catch (error) {
    console.error('Error saving vendor score settings:', error);
    res.status(500).json({ message: 'Error saving settings' });
  }
};

// PUT /api/purchase-settings/purchaser-score — Company Admin (2026-10-13).
// body: { weights: { coverage, completeness, savings, followUp, quality, documentation, poAccuracy, relationship, policy } }
export const updatePurchaserScoreSettings = async (req, res) => {
  try {
    if (!requireCompany(req, res)) return;
    const { readPurchaserWeights } = await import('../services/purchaserScoreService.js');
    const read = readPurchaserWeights(req.body);
    if (read.error) return res.status(400).json({ message: read.error });
    const settings = await getOrCreateSettings(req.user.companyId);
    settings.purchaserScore = { weights: read.weights };
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ message: 'Saved', settings });
  } catch (error) {
    console.error('Error saving purchaser score settings:', error);
    res.status(500).json({ message: 'Error saving settings' });
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
    const minQuotations = settings.minQuotationsPerItem || 1;

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
        const eligibleCount = linked.filter(v => v.approvalStatus === 'Approved').length;
        // Fewer approved vendors than the minimum quotations: a PO for it
        // will always need the exception (2026-10-29).
        return { _id: it._id, code: it.code, name: it.name, source: sourceOf(it), eligibleCount, belowQuotations: eligibleCount < minQuotations, vendors: linked };
      })
      .filter(r => r.eligibleCount < minVendors)
      .sort((a, b) => a.eligibleCount - b.eligibleCount || a.name.localeCompare(b.name));

    const total = rows.length;
    res.json({
      items: rows.slice((page - 1) * limit, page * limit),
      minVendorsPerItem: minVendors,
      minQuotationsPerItem: minQuotations,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error('Error loading low vendor coverage items:', error);
    res.status(500).json({ message: 'Error loading items' });
  }
};

