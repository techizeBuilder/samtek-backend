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

// A Machine is only sellable once R&D has Released it through the Product
// Approval Gate (machineDetails.releaseStatus 'Released') — see
// docs/product-approval-gate-redesign-discussion-2026-09.md. Machines forwarded
// to Design & Prototype need Design + BOM + QC List + a passed Prototype first;
// a Purchase Machine needs only its QC List approved — but BOTH must be
// Released, so this no longer depends on forwardToNextPhase. (Found
// 2026-09-25: this list once had no release check at all, so a brand-new
// Draft machine showed up in Sales' Leads picker immediately.) Motors aren't
// gated. Mongo `$nor` form so it composes with any other query keys ($or
// search).
export const NOT_RELEASED_FOR_SALE = {
  productKind: 'Machine',
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
  if (item.productKind === 'Machine' && item.machineDetails?.releaseStatus !== 'Released') {
    return 'Not Released';
  }
  return null;
}

// Server-side enforcement for write paths (Order create/update). The pickers
// already hide these items, but a direct API call used to slip straight
// through. Returns [{ _id, code, name, reason }] for every given item id
// that can't be sold right now (empty array = all fine).
export async function findUnsellableItems(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean).map(String))];
  if (ids.length === 0) return [];
  const items = await Item.find({ _id: { $in: ids } })
    .select('code name isDiscontinued productKind machineDetails.releaseStatus').lean();
  return items
    .map(i => ({ _id: String(i._id), code: i.code, name: i.name, reason: unavailableForSaleReason(i) }))
    .filter(i => i.reason);
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
