import { Item } from '../models/Inventory.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Preserves every original Item field (mrp, dealerPrice, description, hsn,
// gst, machineDetails/motorDetails, ...) — existing consumers (Quotation's
// Price List, Returns, Damages, etc.) already read fields beyond the ones
// this module cares about, so only `price` is added on top.
function buildItemEntry(item) {
  return {
    ...item,
    price: item.salePrice || 0,
  };
}

/**
 * The single source of truth for "what can this company sell": Product
 * Master machines + Motor Master motors (both live in the Item collection,
 * type:'Product'). Used by every Sales-facing product picker (Leads,
 * Quotation, Order creation/editing) so they all see the same items.
 *
 * Plant Master (RDPlant) is NOT part of this list — a plant has no Item of
 * its own to sell. Pickers that want to shop "within a plant" filter this
 * same item list down to a plant's mapped machine/motor ids themselves
 * (see Quotation.jsx's Plant filter), rather than the plant appearing here
 * as a selectable row.
 */
export async function getSellableItems({ companyId, search }) {
  if (!companyId) return [];

  const companyIdStr = companyId.toString();
  const itemQuery = { store: companyIdStr, type: 'Product' };

  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    itemQuery.$or = [{ name: re }, { code: re }, { category: re }];
  }

  const items = await Item.find(itemQuery).sort({ category: 1, name: 1 }).lean();
  return items.map(buildItemEntry);
}
