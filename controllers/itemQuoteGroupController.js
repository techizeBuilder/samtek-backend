import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import Supplier from '../models/Supplier.js';
import VendorBid from '../models/VendorBid.js';
import { Item } from '../models/Inventory.js';
import { resolveMasterItemId } from './purchaseQuoteController.js';
import { resolveFabricationLines } from './purchaseRequestController.js';
import { dimensionSignature } from '../services/fabricationDemandService.js';
import { ELIGIBLE_VENDOR_FILTER, eligibleVendorError } from '../services/vendorApprovalService.js';
import { groupsHeldByPendingPO } from './purchaseController.js';
import Purchase from '../models/Purchase.js';
import { Company } from '../models/Company.js';
import '../models/ManualQuotation.js'; // registers the model for populate
import { stockSummariesForGroups, stockDetailForGroup } from '../services/stockContextService.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import {
  quoteValidUntil, isQuoteExpired, loadPriceSamples, summarizePrices, DEFAULT_QUOTE_VALIDITY_DAYS,
} from '../services/quoteChecksService.js';
import { checkVendorSelection, SELECTION_EXCEPTION_REASONS } from '../services/vendorSelectionCheckService.js';

// procurement-v2: an item group on a PO that's waiting for Company Admin
// approval is locked — no selection / quantity / quote changes until that PO
// is approved or rejected. Sends the 409 itself; returns true when blocked.
async function rejectIfHeldByPendingPO(res, companyId, groupId) {
  const held = await groupsHeldByPendingPO(companyId, [groupId]);
  if (!held.size) return false;
  res.status(409).json({ success: false, message: `This item is on ${[...held.values()][0]}, waiting for Company Admin approval — it can't change until that's decided.` });
  return true;
}

// Item-wise PR consolidation (2026-10) — see models/ItemQuoteGroup.js for
// the full design rationale. This controller is the group's own CRUD plus
// the group-based quote-creation endpoint, replacing (for this new flow
// only) what purchaseQuoteController.js's createQuote/getEligibleVendorsForPR
// did per-PR. The legacy per-PR endpoints stay untouched for the RFQ flow
// and any caller still using them.

// Sums each selected PR's own purchase-unit quantity contribution, reusing
// the exact same per-PR rules ByItemTab.jsx's VendorQuoteForm pre-fill
// effect already implements (fabrication → resolveFabricationLines' mass-
// unit total; non-fabrication where pr.unit already equals the item's
// Purchase Unit → pr.quantity directly; anything else → unresolvable, needs
// manual entry) — ported server-side so the group is the single source of
// truth instead of re-deriving this per vendor-quote attempt.
//
// Confirmed decision: if some selected PRs resolve and others don't, sum
// only the resolvable ones and report which PR(s) couldn't be auto-resolved
// — never silently guess, never block the whole group over one bad PR.
// A fabrication PR that hits the catalog-drift guard is caught individually
// for the same reason (one stale dimension shouldn't block its siblings).
// Exported 2026-10-09 — also used when a cancelled PO reopens its item card
// (services/poCancellationService.js).
export async function computeGroupQuantityFromPRs(selectedPRs, masterItem) {
  const purchaseUnit = masterItem.purchaseUnit || null;
  const purchaseUnitType = masterItem.purchaseUnitType || null;
  let quantitySum = 0;
  const unresolvedPurchaseRequests = [];

  for (const pr of selectedPRs) {
    if (pr.fabricationDimensionLines?.length) {
      try {
        const resolved = await resolveFabricationLines(masterItem, pr.fabricationDimensionLines, { requireCatalogMatch: true });
        if (resolved.isMassUnit && resolved.resolvedQuantity != null) {
          quantitySum += resolved.resolvedQuantity;
        } else {
          unresolvedPurchaseRequests.push({
            id: pr._id, requestId: pr.requestId,
            reason: 'Could not auto-compute a weight for this item — needs a manual Purchase Quantity.',
          });
        }
      } catch (err) {
        unresolvedPurchaseRequests.push({ id: pr._id, requestId: pr.requestId, reason: err.message });
      }
    } else if (purchaseUnit) {
      // Mirrors VendorQuoteForm's own check exactly: the request was
      // already raised in the Purchase Unit (true for most auto-reorder/
      // cascade PRs) — use it directly, nothing to recompute. Anything
      // else (Order Form PRs store no unit at all; Store material-transfer
      // PRs store the BOM's Used Unit, not Purchase Unit) is unresolvable.
      if (pr.unit && pr.unit === purchaseUnit) {
        quantitySum += Number(pr.quantity) || 0;
      } else {
        unresolvedPurchaseRequests.push({
          id: pr._id, requestId: pr.requestId,
          reason: `Needs a manual Purchase Quantity (${purchaseUnit}).`,
        });
      }
    } else {
      // No Purchase Unit configured for this item at all — the plain
      // quantity/unit on the request is all there is, same as
      // VendorQuoteForm's "no Purchase Unit configured" fallback.
      quantitySum += Number(pr.quantity) || 0;
    }
  }

  // One card per fabrication size (2026-10-09): every selected request has
  // the same size (see resolveCommonSize), so the pieces are simply summed;
  // the group starts at what the requests ask for.
  const sizeKey = selectedPRs.length ? prSizeKey(selectedPRs[0]) : '';
  const requestedPieces = sizeKey
    ? selectedPRs.reduce((sum, pr) => sum + (pr.fabricationDimensionLines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0), 0)
    : null;

  return {
    quantity: Math.round(quantitySum * 1000) / 1000,
    purchaseUnit,
    purchaseUnitType,
    unresolvedPurchaseRequests,
    sizeKey,
    sizeValues: sizeKey ? selectedPRs[0].fabricationDimensionLines[0].values : null,
    requestedPieces,
    pieces: requestedPieces,
  };
}

// ── One card per fabrication size (procurement-v2, 2026-10-09) ────────────
// A request's size: the dimensionSignature of its (single) size line; '' for
// a non-fabrication request. Requests are one size each since 2026-10-09
// (purchaseRequestController.splitFabricationLinesPerSize).
export function prSizeKey(pr) {
  const lines = pr?.fabricationDimensionLines || [];
  if (!lines.length) return '';
  return dimensionSignature(lines[0].values);
}

// Every request in one group must be the same size (or all non-fabrication).
// Returns the common sizeKey, or throws a message for the user.
export function resolveCommonSize(prs, expectedKey = null) {
  let key = expectedKey;
  for (const pr of prs) {
    const lines = pr.fabricationDimensionLines || [];
    const sizes = new Set(lines.map(l => dimensionSignature(l.values)));
    if (sizes.size > 1) {
      throw new Error(`${pr.requestId} still has several sizes in one request — run the size split (one request per size) first.`);
    }
    const k = prSizeKey(pr);
    if (key !== null && key !== k) {
      throw new Error(`${pr.requestId} is a different size — each card covers one size of an item.`);
    }
    key = k;
  }
  return key ?? '';
}

// Pieces typed for a fabrication card: a whole number, not below what the
// requests ask for. Pure — exported for tests.
export function checkPieces(value, requestedPieces) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return { error: 'Enter the number of pieces (a whole number).' };
  if (requestedPieces != null && n < Number(requestedPieces)) {
    return { error: `The requests ask for ${requestedPieces} pieces — you can order more, but not fewer.` };
  }
  return { pieces: n };
}

// The group quantity for N pieces of one size — the same calculation a
// request's own quantity uses (resolveFabricationLines): kg (or the item's
// Mass Unit) when the item is bought by weight, else the pieces themselves.
export async function kgForPieces(masterItem, sizeValues, pieces) {
  const resolved = await resolveFabricationLines(masterItem, [{ values: sizeValues, quantity: pieces }], { requireCatalogMatch: false });
  return {
    quantity: resolved.isMassUnit && resolved.resolvedQuantity != null ? resolved.resolvedQuantity : pieces,
    line: resolved.lines[0],
  };
}

// The size breakdown a quote / PO line carries for a group: a fabrication
// card is ONE size × the pieces actually wanted (which can be more than the
// requests ask for); any other group keeps its requests' own lines (none).
export function groupFabricationLines(group) {
  if (group?.sizeKey) return [{ values: group.sizeValues, quantity: group.pieces ?? group.requestedPieces ?? 0 }];
  return (group?.purchaseRequests || []).flatMap(pr => pr?.fabricationDimensionLines || []);
}

// The size fields a group carries, from computeGroupQuantityFromPRs' result.
export const sizeFieldsOf = (q) => ({
  sizeKey: q.sizeKey || '',
  sizeValues: q.sizeValues || null,
  requestedPieces: q.requestedPieces ?? null,
  pieces: q.pieces ?? null,
});

// A PR already in another group's current selection (Open, still being
// quoted) or already consumed by a Batched group can't be (re)selected
// here — at most one group may ever claim a given PR at a time. `excludeId`
// lets updateGroupSelection check this without tripping over the very
// group it's updating.
async function findAlreadyClaimedPRs(prIds, companyId, excludeId = null) {
  const query = { purchaseRequests: { $in: prIds }, companyId, status: { $in: ['Open', 'Batched'] } };
  if (excludeId) query._id = { $ne: excludeId };
  const groups = await ItemQuoteGroup.find(query).select('purchaseRequests').lean();
  return new Set(groups.flatMap(g => g.purchaseRequests.map(String)));
}

// Every PR going into (or already in) a group must resolve, via the same
// fuzzy code/name match used throughout this redesign, to one single real
// Inventory item — that's the whole basis of "grouping by item." A PR that
// can't be matched at all can't be grouped by anything (same "honest
// absence" rule getEligibleVendorsForPR already uses).
async function resolveCommonItemId(prs, companyId, expectedItemId = null) {
  let itemId = expectedItemId;
  for (const pr of prs) {
    const resolved = await resolveMasterItemId(pr, companyId);
    if (!resolved) {
      throw new Error(`"${pr.productName}" (${pr.requestId}) doesn't match a real Inventory item — fix the Inventory record or this request's product name first.`);
    }
    if (itemId && String(itemId) !== String(resolved)) {
      throw new Error(`${pr.requestId} doesn't resolve to the same item as the others — a group can only combine PRs for one item.`);
    }
    itemId = resolved;
  }
  return itemId;
}

// POST /api/item-quote-groups — create, or replace the selection on, the
// Open group for the item these PRs resolve to. Idempotent by design: if
// the frontend's own GET /item-quote-groups (used to decide whether to
// call this or PUT .../selection) is stale and an Open group already
// exists, this just updates it rather than erroring on the partial unique
// index — a duplicate-key race here would be a worse experience than
// silently doing the right thing.
export const createItemQuoteGroup = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const { purchaseRequests: prIds } = req.body;

    if (!Array.isArray(prIds) || prIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one purchase request' });
    }

    const prs = await PurchaseRequest.find({ _id: { $in: prIds }, companyId });
    if (prs.length !== prIds.length) {
      return res.status(404).json({ success: false, message: 'One or more purchase requests could not be found' });
    }
    const alreadyBatched = prs.filter(pr => pr.purchaseOrder);
    if (alreadyBatched.length) {
      return res.status(400).json({ success: false, message: `${alreadyBatched.map(pr => pr.requestId).join(', ')} already on a Purchase Order — cannot select.` });
    }
    const claimedIds = await findAlreadyClaimedPRs(prIds, companyId);
    const alreadyClaimed = prs.filter(pr => claimedIds.has(String(pr._id)));
    if (alreadyClaimed.length) {
      return res.status(400).json({ success: false, message: `${alreadyClaimed.map(pr => pr.requestId).join(', ')} already selected into another item group.` });
    }

    let itemId;
    let sizeKey;
    try {
      itemId = await resolveCommonItemId(prs, companyId);
      sizeKey = resolveCommonSize(prs);
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    // Real bug, caught live: a narrower select() here (name/purchaseUnit/
    // purchaseUnitType only) silently dropped dimensionVariants and
    // fabricationRef — resolveFabricationLines' own catalog-match check
    // (`masterItem.dimensionVariants || []`) then always saw an empty
    // array and rejected every fabrication PR as "not a known catalog
    // size," even an exact match, and resolveFabricationWeight would have
    // bailed out immediately too (`if (!sourceItem.fabricationRef) return
    // null`). Both need to be on the doc for a fabrication item's quantity
    // to ever resolve at all.
    const masterItem = await Item.findById(itemId).select('name purchaseUnit purchaseUnitType dimensionVariants fabricationRef').lean();
    const computed = await computeGroupQuantityFromPRs(prs, masterItem);
    const { quantity, purchaseUnit, purchaseUnitType, unresolvedPurchaseRequests } = computed;

    let group = await ItemQuoteGroup.findOne({ item: itemId, unit, companyId, status: 'Open', sizeKey });
    if (group) {
      group.purchaseRequests = prIds;
      group.quantity = quantity;
      group.purchaseUnit = purchaseUnit;
      group.purchaseUnitType = purchaseUnitType;
      Object.assign(group, sizeFieldsOf(computed));
      await group.save();
    } else {
      group = await ItemQuoteGroup.create({
        item: itemId, unit, companyId, purchaseRequests: prIds,
        quantity, purchaseUnit, purchaseUnitType, ...sizeFieldsOf(computed), createdBy: req.user._id,
      });
    }
    // Populated the same way listOpenGroups returns it — the frontend
    // merges whichever group response it has in hand (this one, or a
    // listOpenGroups row) into the same client-side state by matching
    // `group.item._id` to a PR's own resolved item, which needs a real
    // populated doc here, not a raw ObjectId.
    await group.populate('item', 'name code purchaseUnit purchaseUnitType');

    res.status(201).json({ success: true, data: group, unresolvedPurchaseRequests });
  } catch (error) {
    console.error('createItemQuoteGroup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/item-quote-groups/:id/selection — add/remove PRs on an existing
// Open group. Always replaces the full selection and always refreshes
// quantity to the new sum (the "refresh" step confirmed with the user) —
// Purchase can retype the number again afterward via PATCH below. The
// confirm-warning before calling this when the card already has a vendor
// quote is a frontend concern (Slice C); this endpoint just always applies
// the change once called.
export const updateGroupSelection = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const { purchaseRequests: prIds } = req.body;

    if (!Array.isArray(prIds)) {
      return res.status(400).json({ success: false, message: 'purchaseRequests must be an array' });
    }

    const group = await ItemQuoteGroup.findOne({ _id: id, companyId });
    if (!group) return res.status(404).json({ success: false, message: 'Item quote group not found' });
    if (group.status !== 'Open') {
      return res.status(400).json({ success: false, message: 'This group has already been batched — its selection can no longer change.' });
    }
    if (await rejectIfHeldByPendingPO(res, companyId, group._id)) return;

    if (prIds.length === 0) {
      group.purchaseRequests = [];
      group.quantity = 0;
      if (group.sizeKey) { group.pieces = 0; group.requestedPieces = 0; }
      await group.save();
      await group.populate('item', 'name code purchaseUnit purchaseUnitType');
      return res.json({ success: true, data: group, unresolvedPurchaseRequests: [] });
    }

    const prs = await PurchaseRequest.find({ _id: { $in: prIds }, companyId });
    if (prs.length !== prIds.length) {
      return res.status(404).json({ success: false, message: 'One or more purchase requests could not be found' });
    }
    const alreadyBatched = prs.filter(pr => pr.purchaseOrder);
    if (alreadyBatched.length) {
      return res.status(400).json({ success: false, message: `${alreadyBatched.map(pr => pr.requestId).join(', ')} already on a Purchase Order — cannot select.` });
    }
    const claimedIds = await findAlreadyClaimedPRs(prIds, companyId, group._id);
    const alreadyClaimed = prs.filter(pr => claimedIds.has(String(pr._id)));
    if (alreadyClaimed.length) {
      return res.status(400).json({ success: false, message: `${alreadyClaimed.map(pr => pr.requestId).join(', ')} already selected into another item group.` });
    }

    try {
      await resolveCommonItemId(prs, companyId, group.item);
      resolveCommonSize(prs, group.sizeKey || '');
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    const masterItem = await Item.findById(group.item).select('name purchaseUnit purchaseUnitType dimensionVariants fabricationRef').lean();
    const computed = await computeGroupQuantityFromPRs(prs, masterItem);
    const { quantity, purchaseUnit, purchaseUnitType, unresolvedPurchaseRequests } = computed;

    group.purchaseRequests = prIds;
    group.quantity = quantity;
    group.purchaseUnit = purchaseUnit;
    group.purchaseUnitType = purchaseUnitType;
    // A selection change resets the pieces to what the requests ask for,
    // the same "refresh" rule as the quantity.
    Object.assign(group, sizeFieldsOf(computed));
    await group.save();
    await group.populate('item', 'name code purchaseUnit purchaseUnitType');

    res.json({ success: true, data: group, unresolvedPurchaseRequests });
  } catch (error) {
    console.error('updateGroupSelection error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/item-quote-groups/:id — adjust quantity only, no selection
// change (the "manual override after refresh" step — qty is always a
// free number, never locked to the selection's sum).
export const updateGroupQuantity = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const { quantity, pieces } = req.body;

    const group = await ItemQuoteGroup.findOne({ _id: id, companyId });
    if (!group) return res.status(404).json({ success: false, message: 'Item quote group not found' });
    if (group.status !== 'Open') {
      return res.status(400).json({ success: false, message: 'This group has already been batched — its quantity can no longer change.' });
    }
    if (await rejectIfHeldByPendingPO(res, companyId, group._id)) return;

    if (group.sizeKey) {
      // Fabrication size card (2026-10-09): ordered in PIECES; the kg is
      // calculated, never typed. Pieces can go up (a big total goes to the
      // Company Admin through the approval limit) but not below what the
      // requests ask for.
      const check = checkPieces(pieces, group.requestedPieces);
      if (check.error) return res.status(400).json({ success: false, message: check.error });
      const masterItem = await Item.findById(group.item).select('name unit purchaseUnit purchaseUnitType dimensionVariants fabricationRef').lean();
      const calc = await kgForPieces(masterItem, group.sizeValues, check.pieces);
      group.pieces = check.pieces;
      group.quantity = calc.quantity;
    } else {
      if (!(Number(quantity) > 0)) {
        return res.status(400).json({ success: false, message: 'Enter a quantity greater than 0' });
      }
      group.quantity = Number(quantity);
    }
    await group.save();
    await group.populate('item', 'name code purchaseUnit purchaseUnitType');
    res.json({ success: true, data: group });
  } catch (error) {
    console.error('updateGroupQuantity error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/item-quote-groups — every Open group for this branch, for By
// Item tab to merge onto its item cards.
export const listOpenGroups = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const groups = await ItemQuoteGroup.find({ companyId, unit, status: 'Open' })
      .populate('item', 'name code purchaseUnit purchaseUnitType')
      .populate('purchaseRequests', 'requestId productName quantity unit priority status')
      .lean();
    res.json({ success: true, data: groups });
  } catch (error) {
    console.error('listOpenGroups error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── RFQ/PO page (procurement-v2, 2026-10-08) ───────────────────────────────

// POST /api/item-quote-groups/auto-select  body: { items: [{ purchaseRequests: [ids] }] }
// Client design (D3): on the RFQ/PO page every pending request of an item is
// selected by default. For each item entry (the page groups PRs by item the
// same way it displays them), this creates an Open group with ALL its still-
// unclaimed PRs selected — but ONLY when that item has no Open group yet. An
// existing group is never touched, so a request Purchase deliberately held
// back stays out (the page shows later arrivals as "N new — not selected").
export const autoSelectGroups = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const entries = Array.isArray(req.body.items) ? req.body.items : [];
    let created = 0;
    const skipped = [];

    for (const entry of entries) {
      const prIds = (entry?.purchaseRequests || []).map(String).filter(id => /^[a-f0-9]{24}$/i.test(id));
      if (!prIds.length) continue;
      // Only requests still waiting to be bought — a Rejected one (Store refused
      // it, or 'no longer needed' when a PO was cancelled) never joins a card.
      const prs = await PurchaseRequest.find({ _id: { $in: prIds }, companyId, purchaseOrder: null, status: { $in: ['Pending', 'Approved'] } });
      const claimed = await findAlreadyClaimedPRs(prs.map(p => p._id), companyId);
      const free = prs.filter(p => !claimed.has(String(p._id)));
      if (!free.length) continue;

      let itemId;
      let sizeKey;
      try {
        itemId = await resolveCommonItemId(free, companyId);
        sizeKey = resolveCommonSize(free);
      } catch (err) {
        skipped.push(err.message);
        continue;
      }
      const existing = await ItemQuoteGroup.findOne({ item: itemId, unit, companyId, status: 'Open', sizeKey }).select('_id').lean();
      if (existing) continue;

      const masterItem = await Item.findById(itemId).select('name purchaseUnit purchaseUnitType dimensionVariants fabricationRef').lean();
      const computed = await computeGroupQuantityFromPRs(free, masterItem);
      const { quantity, purchaseUnit, purchaseUnitType } = computed;
      try {
        await ItemQuoteGroup.create({
          item: itemId, unit, companyId, purchaseRequests: free.map(p => p._id),
          quantity, purchaseUnit, purchaseUnitType, ...sizeFieldsOf(computed), createdBy: req.user._id,
        });
        created++;
      } catch (err) {
        // Another user's page created it at the same moment — theirs wins.
        if (err.code !== 11000) throw err;
      }
    }
    res.json({ success: true, created, skipped });
  } catch (error) {
    console.error('autoSelectGroups error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/item-quote-groups/board — everything the RFQ/PO page needs about
// groups and quotes in ONE call (instead of one eligible-vendors call per
// card): every Open group of this branch, every vendor's LATEST quote per
// group (isStale / isActive computed live, same rules as
// getEligibleVendorsForGroup), and which groups are locked on a PO waiting
// for Company Admin approval (heldByPO = its PO number).
export const getRfqBoard = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const groups = await ItemQuoteGroup.find({ companyId, unit, status: 'Open' })
      .populate('item', 'name code purchaseUnit purchaseUnitType')
      .populate('purchaseRequests', 'requestId productName quantity unit priority status fabricationDimensionLines')
      .lean();
    const groupById = new Map(groups.map(g => [String(g._id), g]));
    const groupIds = groups.map(g => g._id);

    // Never send the vendors' email-link tokens to the page (the field is
    // `bidToken`). Superseded quotes (replaced by a newer one from the same
    // vendor) are history only — they're never the vendor's "latest".
    // Each quote carries its quotation request's summary (procurement-v2):
    // the vendor's whole-quote charges / payment terms pre-fill the PO review.
    const bids = groupIds.length
      ? await VendorBid.find({ group: { $in: groupIds }, companyId, status: { $ne: 'Superseded' } })
        .select('-bidToken')
        .populate('quotationRequest', 'number status sentAt submittedAt tokenExpiry emailStatus emailError charges paymentTerms vendorRemarks vendorReminders')
        .populate('manualQuotation', 'number channel channelOther quoteDate charges paymentTerms createdAt')
        .sort({ createdAt: -1 })
        .lean()
      : [];
    // Quote validity (Purchase Settings, 2026-10-09): an expired quote can't
    // go on a PO — the page shows "Expired" and won't let it be ticked.
    const settings = await getOrCreateSettings(companyId);
    const validityDays = settings.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
    const activeByGroup = new Map();
    const seen = new Set();
    const quotes = [];
    for (const q of bids) {
      const gid = String(q.group);
      if (!activeByGroup.has(gid)) activeByGroup.set(gid, String(q._id));
      const key = `${gid}|${q.vendor}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = groupById.get(gid);
      quotes.push({
        ...q,
        isActive: activeByGroup.get(gid) === String(q._id),
        isStale: group ? Number(q.quantity) !== Number(group.quantity) : false,
        validUntil: q.status === 'Submitted' ? quoteValidUntil(q, validityDays) : null,
        isExpired: isQuoteExpired(q, validityDays),
      });
    }

    // "Bought before": what each item cost on earlier DELIVERED purchases, in
    // the group's unit (every vendor, plus per vendor — the page compares a
    // quote with that vendor's own last price).
    const samples = await loadPriceSamples({ companyId, itemIds: groups.map(g => g.item?._id) });
    const held = await groupsHeldByPendingPO(companyId, groupIds);
    // Gap 9: Stock · Reserved · Free · Incoming · Min per card (item / size).
    const stockByGroup = await stockSummariesForGroups(companyId, groups);
    res.json({
      success: true,
      data: {
        groups: groups.map(g => ({
          ...g,
          heldByPO: held.get(String(g._id)) || null,
          stock: stockByGroup.get(String(g._id)) || null,
          priceHistory: g.item?._id ? summarizePrices(samples.get(String(g.item._id)) || [], { unit: g.purchaseUnit }) : null,
        })),
        quotes,
        quoteRules: { quoteValidityDays: validityDays, priceJumpWarnPercent: settings.priceJumpWarnPercent ?? 10 },
        // Point 15 (2026-10-10): our GSTIN / state, so the PO review can show
        // CGST + SGST vs IGST before the PO exists (the server fixes it on create).
        company: await Company.findById(companyId).select('gst state').lean(),
      },
    });
  } catch (error) {
    console.error('getRfqBoard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Quote history (procurement-v2, 2026-10-08) ─────────────────────────────
// Every quotation ever taken for some items — all vendors, all channels,
// oldest first, including replaced ("Superseded"), declined and rejected
// ones, with each emailed request's charges / payment terms. Used by the
// "Quote history" buttons on the RFQ/PO vendor card (before the PO), the
// Purchase Orders tab and the Company Admin's PO approval card (after).
// Input: groupIds, or a purchaseId (its lines' groups; the quotes it was
// made from are marked chosen). Old POs whose lines have no group fall back
// to the quotes on their purchase requests.
export async function buildQuoteHistory({ companyId, groupIds = [], purchaseId = null }) {
  let groupIdList = groupIds.map(String);
  const chosen = new Set();
  const groupsWithoutBid = new Set();
  let legacyPrIds = [];
  let po = null;
  if (purchaseId) {
    po = await Purchase.findOne({ _id: purchaseId, companyId }).select('purchaseOrderNumber status supplier items').lean();
    if (!po) return null;
    groupIdList = [...new Set((po.items || []).map(l => l.itemQuoteGroup).filter(Boolean).map(String))];
    (po.items || []).forEach(l => { if (l.vendorBid) chosen.add(String(l.vendorBid)); });
    // Lines saved before the PO recorded its quote (vendorBid): the chosen one
    // is this PO's vendor's latest live quote on that group (marked below).
    (po.items || []).forEach(l => { if (l.itemQuoteGroup && !l.vendorBid) groupsWithoutBid.add(String(l.itemQuoteGroup)); });
    legacyPrIds = (po.items || [])
      .filter(l => !l.itemQuoteGroup)
      .flatMap(l => (l.purchaseRequests?.length ? l.purchaseRequests : (l.purchaseRequest ? [l.purchaseRequest] : [])));
  }

  const groups = groupIdList.length
    ? await ItemQuoteGroup.find({ _id: { $in: groupIdList }, companyId }).populate('item', 'name code').lean()
    : [];
  const or = [];
  if (groupIdList.length) or.push({ group: { $in: groupIdList } });
  if (legacyPrIds.length) or.push({ purchaseRequest: { $in: legacyPrIds } });
  const bids = or.length
    ? await VendorBid.find({ companyId, $or: or })
      .select('-bidToken')
      .populate('quotationRequest', 'number status sentAt submittedAt charges paymentTerms vendorRemarks emailStatus')
      .populate({ path: 'manualQuotation', select: 'number channel channelOther quoteDate contactPerson notes files charges paymentTerms createdBy createdAt', populate: { path: 'createdBy', select: 'fullName username' } })
      .sort({ createdAt: 1 })
      .lean()
    : [];
  if (po?.supplier && groupsWithoutBid.size) {
    const latest = new Map();
    for (const b of bids) {
      if (b.group && groupsWithoutBid.has(String(b.group)) && String(b.vendor) === String(po.supplier)
        && ['Submitted', 'Selected'].includes(b.status)) latest.set(String(b.group), String(b._id));
    }
    latest.forEach(id => chosen.add(id));
  }
  const validityDays = (await getOrCreateSettings(companyId)).quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;

  const shape = (b) => ({
    _id: b._id,
    vendor: b.vendor,
    vendorName: b.vendorName,
    source: b.source,
    status: b.status,
    chosen: chosen.has(String(b._id)) || b.status === 'Selected',
    unitPrice: b.unitPrice,
    quantity: b.quantity,
    purchaseUnit: b.purchaseUnit,
    gstPercent: b.gstPercent,
    gstInclusive: b.gstInclusive,
    deliveryDays: b.deliveryDays,
    warrantyMonths: b.warrantyMonths,
    remarks: b.remarks,
    createdAt: b.createdAt,
    submittedAt: b.submittedAt,
    validUntil: b.status === 'Submitted' ? quoteValidUntil(b, validityDays) : null,
    expired: isQuoteExpired(b, validityDays),
    quotationRequest: b.quotationRequest || null,
    // Manual quotes: the evidence they were entered with (2026-10-09), and the
    // reason when the price replaced this vendor's earlier one.
    manualQuotation: b.manualQuotation || null,
    revisionReason: b.revisionReason || '',
  });

  const sections = groups.map(g => ({
    key: String(g._id),
    itemName: g.item?.name || 'Item',
    itemCode: g.item?.code || '',
    quantity: g.quantity,
    purchaseUnit: g.purchaseUnit,
    quotes: bids.filter(b => b.group && String(b.group) === String(g._id)).map(shape),
  }));
  if (legacyPrIds.length) {
    const legacy = bids.filter(b => !b.group && b.purchaseRequest);
    const byPr = new Map();
    for (const b of legacy) {
      const k = String(b.purchaseRequest);
      if (!byPr.has(k)) byPr.set(k, { key: `pr:${k}`, itemName: b.productName || 'Item', itemCode: '', quantity: b.quantity, purchaseUnit: b.purchaseUnit, quotes: [] });
      byPr.get(k).quotes.push(shape(b));
    }
    sections.push(...byPr.values());
  }
  return { purchase: po ? { _id: po._id, purchaseOrderNumber: po.purchaseOrderNumber, status: po.status } : null, sections, quoteValidityDays: validityDays };
}

// GET /api/item-quote-groups/:id/stock-detail — the RFQ/PO card's stock
// pop-up (gap 9): summary, reserving orders, which order each request is
// for, open POs bringing it in.
export const getGroupStockDetail = async (req, res) => {
  try {
    const group = await ItemQuoteGroup.findOne({ _id: req.params.id, companyId: req.user.companyId })
      .populate('purchaseRequests', 'requestId quantity unit priority storeOrderId reorderItemId fabricationDimensionLines')
      .lean();
    if (!group) return res.status(404).json({ success: false, message: 'Item card not found' });
    const data = await stockDetailForGroup(req.user.companyId, group);
    if (!data) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, data });
  } catch (error) {
    console.error('getGroupStockDetail error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/item-quote-groups/selection-check { vendor, groups[] } — the PO
// review's "Vendor selection check" preview (gap 12). createPurchase runs
// the same check again on save; this is only what the page shows first.
export const getSelectionCheck = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const vendorId = String(req.body?.vendor || '');
    const groupIds = (Array.isArray(req.body?.groups) ? req.body.groups : []).map(String).filter(id => /^[a-f0-9]{24}$/i.test(id));
    if (!/^[a-f0-9]{24}$/i.test(vendorId) || !groupIds.length) return res.status(400).json({ success: false, message: 'Pass vendor and groups' });
    const settings = await getOrCreateSettings(companyId);
    const check = await checkVendorSelection({ companyId, vendorId, groupIds, settings });
    res.json({ success: true, data: { ...check, exceptionReasons: SELECTION_EXCEPTION_REASONS } });
  } catch (error) {
    console.error('getSelectionCheck error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/item-quote-groups/quote-history?groups=a,b  |  ?purchase=<poId>
export const getQuoteHistory = async (req, res) => {
  try {
    const groupIds = String(req.query.groups || '').split(',').map(s => s.trim()).filter(s => /^[a-f0-9]{24}$/i.test(s));
    const purchaseId = /^[a-f0-9]{24}$/i.test(String(req.query.purchase || '')) ? req.query.purchase : null;
    if (!groupIds.length && !purchaseId) return res.status(400).json({ success: false, message: 'Pass groups or purchase' });
    const data = await buildQuoteHistory({ companyId: req.user.companyId, groupIds, purchaseId });
    if (!data) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    res.json({ success: true, data });
  } catch (error) {
    console.error('getQuoteHistory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/item-quote-groups/:id/eligible-vendors — replaces
// getEligibleVendorsForPR's role for the new flow: vendors actually linked
// to this group's item in Vendor Master, each with their latest quote
// against THIS group if one exists. Keyed by group.item (already resolved
// and stored) — no fresh per-request resolution needed, unlike the per-PR
// version this supersedes for group-based quoting.
export const getEligibleVendorsForGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const unit = req.user.unit;

    const group = await ItemQuoteGroup.findOne({ _id: id, companyId }).lean();
    if (!group) return res.status(404).json({ success: false, message: 'Item quote group not found' });

    // Only Company-Admin-approved, active vendors can be quoted (procurement-v2).
    const vendors = await Supplier.find({ companyId, unit: { $in: [unit, 'Main'] }, suppliedItems: group.item, ...ELIGIBLE_VENDOR_FILTER })
      .select('supplierName email phone suppliedItems')
      .lean();

    if (vendors.length === 0) {
      return res.json({ success: true, data: { vendors: [] } });
    }

    const quotes = await VendorBid.find({ group: group._id, companyId, status: { $ne: 'Superseded' } })
      .select('-bidToken')
      .sort({ createdAt: -1 })
      .lean();
    const latestQuoteByVendor = new Map();
    for (const q of quotes) {
      const vId = String(q.vendor);
      if (!latestQuoteByVendor.has(vId)) latestQuoteByVendor.set(vId, q);
    }
    // "Active" = whichever quote was recorded most recently across ALL
    // vendors for this group (recency-wins, same confirmed design
    // getEligibleVendorsForPR already uses) — not just each vendor's own
    // latest, which is what latestQuoteByVendor gives per row.
    const activeId = quotes[0]?._id ? String(quotes[0]._id) : null;

    const data = vendors.map(v => {
      const quote = latestQuoteByVendor.get(String(v._id)) || null;
      // Stale = this bid's own frozen quantity (what it was priced/charged
      // against) no longer matches the group's current live quantity —
      // computed here, live, every read; never a stored flag (same idiom
      // computeHealedStatus/getQuotesForPR's isActive already use). Must
      // be synced (re-quoted at the new quantity) before it can be batched.
      const isStale = quote ? Number(quote.quantity) !== Number(group.quantity) : false;
      return {
        _id: v._id,
        supplierName: v.supplierName,
        email: v.email,
        phone: v.phone,
        quote: quote ? { ...quote, isActive: activeId ? String(quote._id) === activeId : false, isStale } : null,
      };
    });

    res.json({ success: true, data: { vendors: data } });
  } catch (error) {
    console.error('getEligibleVendorsForGroup error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/item-quote-groups/:id/quotes — RETIRED for new quotes (2026-10-09).
// Email quotes go from the vendor card, several items in one email
// (quotationRequestController.js); MANUAL quotes too, several items at once
// and only with uploaded evidence (manualQuotationController.js, client
// blueprint §10: "quotation evidence should be uploaded"). A typed price
// without evidence is no longer accepted anywhere.
export const createQuoteForGroup = async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Manual quotes are entered from the vendor card with evidence: tick the items, then "Manual quotation".',
  });
};

// "Sync to current quantity" action for a stale bid (Slice C/D) — re-saves
// a Manual bid's quantity/totalPrice/itemCharges at the group's current
// live quantity, same unitPrice. An Email-sourced bid can't be synced this
// way (its price came from the vendor, who quoted against the OLD
// quantity) — it must be re-sent instead, surfaced as a normal error here
// rather than silently reusing a vendor's price against a different qty.
export const syncBidToGroupQuantity = async (req, res) => {
  try {
    const { id } = req.params; // VendorBid id
    const companyId = req.user.companyId;

    const bid = await VendorBid.findOne({ _id: id, companyId, group: { $ne: null } }).populate('group');
    if (!bid) return res.status(404).json({ success: false, message: 'Group-based quote not found' });
    if (bid.source !== 'Manual') {
      return res.status(400).json({ success: false, message: 'An Email quote was priced by the vendor against the old quantity — send a new request instead of syncing.' });
    }
    if (!bid.group || bid.group.status !== 'Open') {
      return res.status(400).json({ success: false, message: 'This group has already been batched.' });
    }

    const held = await groupsHeldByPendingPO(companyId, [bid.group._id]);
    if (held.size) {
      return res.status(409).json({ success: false, message: `This item is on ${[...held.values()][0]}, waiting for Company Admin approval.` });
    }

    // Charges are typed on the PO now (procurement-v2) — a quote carries none.
    const rawValue = bid.unitPrice * bid.group.quantity;
    bid.quantity = bid.group.quantity;
    bid.purchaseUnit = bid.group.purchaseUnit;
    bid.purchaseUnitType = bid.group.purchaseUnitType;
    bid.totalPrice = rawValue;
    bid.itemCharges = [];
    bid.itemChargesTotal = 0;
    await bid.save();

    res.json({ success: true, data: bid });
  } catch (error) {
    console.error('syncBidToGroupQuantity error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
