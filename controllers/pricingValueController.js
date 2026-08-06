/** @format */

import { Item } from '../models/Inventory.js';
import { reapplyItemPricingFormula } from '../services/itemPricingService.js';

const PRICING_FIELDS = 'code name category subCategory unit costSource stdCost purchaseCost mrp salePrice profitPercent discountPercent';

// Same pool as the "Product / Service Required" dropdown in Add Lead (step 2)
// — see salesController.js's getSalespersonItems, which forces type:'Product'
// regardless of any query param. Kept in sync here since that's the definitive
// "items this company sells" list elsewhere in the app.
const sellableItemFilter = () => ({ type: 'Product' });

const canManagePricing = (user) => {
  const role = (user?.role || '').trim();
  return ['Superadmin', 'Super Admin', 'HR-Admin', 'Company Admin', 'Unit Head'].includes(role);
};

/**
 * List items this company actually sells — the same Item.type:'Product' pool
 * shown in Add Lead's "Product / Service Required" dropdown — with their
 * per-item Pricing Value fields.
 */
export const getPricingItems = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) return res.status(400).json({ success: false, message: 'Company not assigned' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    // Scoped by 'store' (not 'companyId') to match getSalespersonItems exactly —
    // some items only ever had 'store' set (companyId missing on them), so
    // filtering by companyId silently dropped them from this list.
    const query = { store: companyId, ...sellableItemFilter() };
    const search = (req.query.search || '').trim();
    if (search) {
      query.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      Item.find(query).select(PRICING_FIELDS).sort({ code: 1 }).skip(skip).limit(limit).lean(),
      Item.countDocuments(query),
    ]);

    res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Set/update one item's Profit%/Discount% and recompute its MRP/Sale Price
 * from whatever real cost is already known (no-op if cost isn't resolved yet).
 */
export const updatePricingItem = async (req, res) => {
  try {
    if (!canManagePricing(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
    }

    const { id } = req.params;
    const { profitPercent, discountPercent } = req.body;

    const item = await Item.findOne({ _id: id, store: req.user.companyId, ...sellableItemFilter() });
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const toPercent = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    if (profitPercent !== undefined) item.profitPercent = toPercent(profitPercent);
    if (discountPercent !== undefined) item.discountPercent = toPercent(discountPercent);
    await item.save();

    await reapplyItemPricingFormula(item._id);

    const fresh = await Item.findById(item._id).select(PRICING_FIELDS).lean();
    res.json({ success: true, item: fresh });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
