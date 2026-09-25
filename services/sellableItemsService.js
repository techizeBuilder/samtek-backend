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

// A Product Master machine forwarded to Design & Prototype is only sellable
// once Prototype has released it for production (machineDetails.releaseStatus
// 'Released') — until then it's still a design in progress, not a product.
// A machine never forwarded (e.g. a bought-in Purchase Machine) never goes
// through that pipeline at all, so it stays sellable as before. Found
// 2026-09-25: this list had no release check at all, so a brand-new Draft /
// Not Released machine (M-311) showed up in Sales' Leads picker immediately.
// Mongo `$nor` form so it composes with any other query keys ($or search).
export const NOT_RELEASED_FOR_SALE = {
  productKind: 'Machine',
  'machineDetails.forwardToNextPhase': true,
  'machineDetails.releaseStatus': { $ne: 'Released' },
};

// In-memory twin of the query rules below (discontinued, and
// NOT_RELEASED_FOR_SALE) for one already-loaded Item — used where an item
// arrives populated inside something else (a Plant's machines/motors) rather
// than through getSellableItems' own query. Returns the reason it can't be
// sold right now, or null if it can.
export function unavailableForSaleReason(item) {
  if (!item) return null;
  if (item.isDiscontinued) return 'Discontinued';
  if (item.productKind === 'Machine' && item.machineDetails?.forwardToNextPhase && item.machineDetails?.releaseStatus !== 'Released') {
    return 'Not Released';
  }
  return null;
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
  // Discontinued = not being produced/sold for now (until reactivated) —
  // never offered to Sales either (confirmed with the user 2026-09-25).
  const itemQuery = { store: companyIdStr, type: 'Product', isDiscontinued: { $ne: true }, $nor: [NOT_RELEASED_FOR_SALE] };

  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    itemQuery.$or = [{ name: re }, { code: re }, { category: re }];
  }

  const items = await Item.find(itemQuery).sort({ category: 1, name: 1 }).lean();
  return items.map(buildItemEntry);
}
