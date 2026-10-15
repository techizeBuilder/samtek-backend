import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import { Item } from '../models/Inventory.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import VendorBid from '../models/VendorBid.js';
import '../models/QuotationRequest.js'; // registered for populate (createPurchase)
import '../models/ManualQuotation.js';
import { Company } from '../models/Company.js';
import { sendPurchaseOrderEmail } from '../services/emailService.js';
import { USER_ROLES } from '../shared/schema.js';
import { applyPricingToItem, cascadeRecalculateToConsumers } from '../services/itemPricingService.js';
import notificationService from '../services/notificationService.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import { eligibleVendorError } from '../services/vendorApprovalService.js';
import { isQuoteExpired, quoteValidUntil, DEFAULT_QUOTE_VALIDITY_DAYS } from '../services/quoteChecksService.js';
import { checkVendorSelection, readSelectionException } from '../services/vendorSelectionCheckService.js';
import { logPoEvent } from '../services/purchaseAuditService.js';
import { notifyStoreOfIncomingPO, reviseLineDate, poDueSummary, clockDates } from '../services/deliveryFollowUpService.js';
import { gstSplitFor } from '../services/gstStateService.js';
import { newestQuotation, compareWithQuotation, readTermsChangeReason } from '../services/poQuoteTermsService.js';

// Normalize-to-array helper (2026-10, item-wise PR consolidation) — a line
// can now carry EITHER the original singular `purchaseRequest` (still
// written by the legacy RFQ-to-PO path and the single-item "Create PO"
// modal, both permanently one-PR-per-line) OR the new plural
// `purchaseRequests` (a line built from an ItemQuoteGroup, covering
// whichever PRs that group's selection combined). Every reader of either
// field should go through this instead of reimplementing the fallback —
// used by computeHealedStatus below, createPurchase/updatePurchase's PR-
// sync loops, and (Slice E) getBatchSiblings/vendorRatingService.js.
// Accepts either raw ObjectIds or populated PR docs in the array.
export function prIdsOf(line) {
  if (Array.isArray(line?.purchaseRequests) && line.purchaseRequests.length) return line.purchaseRequests;
  if (line?.purchaseRequest) return [line.purchaseRequest];
  return [];
}

// Self-healing status sync (2026-10) — same pattern getPurchaseRequests
// already uses for its own stale-status drift. Purchase.status never
// actually transitions for the new quote->batch flow: only the old
// RFQ-era receivePurchase endpoint ever wrote 'Received'/'Partially
// Received', so every PO made through By Vendor batching would otherwise
// sit at its creation-time default ('Draft') forever — permanently stuck
// in the Active POs tab, never reaching Order History no matter how much
// of it actually gets received. Recomputes from every PR linked across
// every line (prIdsOf, flattened — NOT one count per line, since a line
// can now carry several PRs at once and "all PRs Received" has to be
// counted at the PR level to stay accurate). Leaves `status` alone when
// there's no new-flow signal to go on (no linked PRs at all — a legacy/
// non-PR-based PO) or it's already Cancelled (a manual terminal state
// this sync never overrides).
function computeHealedStatus(purchase) {
  // A PO that is waiting for / was refused Company Admin approval never
  // became a real order — its lines still reference PRs that may later be
  // received on a DIFFERENT PO, which must not flip this one to Received.
  if (['Cancelled', 'Pending Approval', 'Rejected'].includes(purchase.status)) return purchase.status;
  const allPRs = [];
  for (const it of purchase.items || []) {
    // A short-closed (cancelled) line's requests went back to RFQ/PO — they
    // no longer say anything about this PO (gap 13, 2026-10-09).
    if (it.cancelled?.at) continue;
    for (const prRef of prIdsOf(it)) {
      // Only a populated doc (has .status) counts — a raw ObjectId with no
      // populate means this call site didn't ask for PR status, not that
      // the PR doesn't exist.
      if (prRef && typeof prRef === 'object' && prRef.status) allPRs.push(prRef);
    }
  }
  if (!allPRs.length) return purchase.status;
  const receivedCount = allPRs.filter(pr => pr.status === 'Received').length;
  if (receivedCount === allPRs.length) return 'Received';
  if (receivedCount > 0) return 'Partially Received';
  return purchase.status;
}

export const getPurchases = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, paymentStatus, unit, search, transportBy } = req.query;

    let query = {};

    // companyId added 2026-10-06 — real cross-tenant isolation fix (Purchase
    // had no company scoping at all before this, only the unit string,
    // which two different companies in this DB were confirmed to share).
    // SUPER_USER keeps its existing cross-company visibility, unchanged.
    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.companyId = req.user.companyId;
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    // Unlike status (see computeHealedStatus below), transportBy is a
    // plain stored field — never stale — so it can be filtered at the
    // query level directly. Powers the Dispatch stub page's "pickups this
    // department needs to arrange" list (?transportBy=Company).
    if (transportBy === 'Vendor' || transportBy === 'Company') {
      query.transportBy = transportBy;
    }

    if (search) {
      query.$or = [
        { purchaseOrderNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Status itself can't be filtered at the query level here — it may be
    // stale (see computeHealedStatus above) until self-healed below, so
    // every matching Purchase is fetched first, same tradeoff
    // getPurchaseRequests already makes for its own self-healing sync.
    const allMatching = await Purchase.find(query)
      .populate('supplier', 'supplierName contactPerson email phone')
      .populate('createdBy', 'fullName')
      .populate('approvedBy', 'fullName')
      // Real per-line receive status for the By Vendor tab's Active POs
      // view (the old receivedQuantity on the line itself is dead for any
      // PO created through the new quote->batch flow — see Purchase.js).
      // Both the original singular ref and the new plural one (2026-10,
      // item-wise PR consolidation) are populated — a line only ever has
      // one of the two meaningfully set (see prIdsOf above).
      // purchaseUnit also included — a line itself has no purchase-unit
      // field of its own (only quantity/unitPrice), so the By Vendor tab
      // reads it off the linked PR(s), which do (synced back onto the PR
      // at batch time — see createPurchase's own PR-sync loop).
      // purchaseQuantity/warrantyMonths/fabricationDimensionLines/quantity
      // added (2026-10) — Store's line-level receive dialogs (PurchaseRequest.jsx)
      // read this same endpoint (via getPurchaseOrdersForStore) and need
      // these to pre-fill a combined receive form per line; the By Vendor
      // tab's Active POs view (the original consumer) just ignores them.
      .populate('items.purchaseRequest', 'requestId status receivedAt purchaseUnit purchaseQuantity warrantyMonths fabricationDimensionLines quantity vendorInvoice replacementFor')
      .populate('items.purchaseRequests', 'requestId status receivedAt purchaseUnit purchaseQuantity warrantyMonths fabricationDimensionLines quantity vendorInvoice replacementFor')
      // A PO line's own item ref (unlike PurchaseRequest, which has no real
      // `item` field) — lets the combined-receive dialog compare this
      // item's real stock unit against the line's purchaseUnit to decide
      // whether to show the unit-conversion fields at all, same UX the old
      // per-PR dialog had via getPurchaseRequests' own item enrichment.
      .populate('items.item', 'name code unit receiveUnit purchaseUnit purchaseUnitType')
      .sort({ createdAt: -1 });

    for (const purchase of allMatching) {
      const healed = computeHealedStatus(purchase);
      if (healed !== purchase.status) {
        purchase.status = healed;
        await purchase.save();
      }
    }

    let filtered = allMatching;
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length) filtered = filtered.filter(p => statuses.includes(p.status));
    }

    // Expected receipts (2026-10-10): how many POs have a late / due-today /
    // due-soon line (counted before this filter, for the chips), then the
    // optional ?due= filter. Uses the requests' real receive status.
    const now = new Date();
    const dueCounts = { overdue: 0, today: 0, soon: 0 };
    const worstById = new Map();
    for (const p of filtered) {
      const { counts, worst } = poDueSummary(p, undefined, now);
      worstById.set(String(p._id), { worst, counts });
      for (const k of Object.keys(dueCounts)) if (counts[k] > 0) dueCounts[k] += 1;
    }
    const { due } = req.query;
    if (['overdue', 'today', 'soon'].includes(due)) {
      filtered = filtered.filter(p => (worstById.get(String(p._id))?.counts?.[due] || 0) > 0);
    }

    const total = filtered.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const purchases = filtered.slice(skip, skip + parseInt(limit));

    res.json({
      purchases,
      dueCounts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get purchases error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// PATCH /api/accounts/purchases/orders/:id/lines/:lineId/expected-date
// body: { date: 'YYYY-MM-DD', reason } — Purchase records the vendor's new
// date for one line (blueprint §17 step 13; services/deliveryFollowUpService.js).
export const reviseLineExpectedDate = async (req, res) => {
  try {
    const po = await Purchase.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!po) return res.status(404).json({ message: 'Purchase order not found' });
    const result = await reviseLineDate({ po, lineId: req.params.lineId, body: req.body, user: req.user, req });
    if (result.status) return res.status(result.status).json({ message: result.message });
    res.json({ message: `${result.line.itemName} is now expected on ${result.to.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Store has been told.` });
  } catch (error) {
    console.error('reviseLineExpectedDate error:', error);
    res.status(500).json({ message: 'Could not change the date.' });
  }
};

export const getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findById(id)
      .populate('supplier')
      .populate('items.item', 'itemName itemCode')
      .populate('createdBy', 'fullName')
      .populate('approvedBy', 'fullName');

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && (purchase.unit !== req.user.unit || String(purchase.companyId) !== String(req.user.companyId))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ purchase });
  } catch (error) {
    console.error('Get purchase by ID error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ── PO creation (procurement-v2, 2026-10-08) ──────────────────────────────
// GST, charges and payment terms are typed at PO time (they left Vendor
// Master): GST is a % per item line (one PO can mix rates), charges and
// payment terms are whole-PO, named from the Purchase master template
// (PurchaseSettings). If the final total is ABOVE the Company Admin's
// poApprovalThreshold, the PO is saved as 'Pending Approval' with NO side
// effects at all, and only finalizePurchase (on approval) turns it into a
// real order. Otherwise it's finalized straight away, as before.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pctOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
};

// Whole-PO charges typed on the PO: label + flat ₹ + that charge's own GST %.
export function cleanPoCharges(list) {
  return (Array.isArray(list) ? list : [])
    .map(c => ({
      label: String(c?.label || '').trim(),
      amount: Math.max(0, Number(c?.amount) || 0),
      gstPercent: pctOrZero(c?.gstPercent),
    }))
    .filter(c => c.label && c.amount > 0)
    .map(c => ({ ...c, amount: round2(c.amount), gstAmount: round2(c.amount * c.gstPercent / 100) }));
}

// Built-in Advance % / Credit Days (the system uses them) + the template's
// free-text terms (printed on the PO). Blank built-ins stay null.
export function cleanPaymentTerms(t) {
  const adv = t?.advancePercent;
  const days = t?.creditDays;
  return {
    advancePercent: adv === '' || adv == null || !Number.isFinite(Number(adv)) ? null : Math.min(100, Math.max(0, Number(adv))),
    creditDays: days === '' || days == null || !Number.isFinite(Number(days)) ? null : Math.max(0, Math.round(Number(days))),
    others: (Array.isArray(t?.others) ? t.others : [])
      .map(o => ({ label: String(o?.label || '').trim(), value: String(o?.value || '').trim() }))
      .filter(o => o.label && o.value),
  };
}

// ItemQuoteGroups that are on a PO still waiting for Company Admin approval
// — locked: no selection/quantity/quote changes, and no second PO, until the
// pending one is approved or rejected. Map groupId -> PO number.
export async function groupsHeldByPendingPO(companyId, groupIds, excludePurchaseId = null) {
  const ids = (groupIds || []).filter(Boolean).map(String);
  if (!ids.length) return new Map();
  const query = { companyId, status: 'Pending Approval', 'items.itemQuoteGroup': { $in: ids } };
  if (excludePurchaseId) query._id = { $ne: excludePurchaseId };
  const pending = await Purchase.find(query).select('purchaseOrderNumber items.itemQuoteGroup').lean();
  const held = new Map();
  for (const po of pending) {
    for (const line of po.items || []) {
      const gid = line.itemQuoteGroup ? String(line.itemQuoteGroup) : null;
      if (gid && ids.includes(gid)) held.set(gid, po.purchaseOrderNumber);
    }
  }
  return held;
}

// A PO line's quantity (in its purchase unit) shared across the requests on
// it, in proportion to what each asked for — fabrication by its pieces,
// anything else by its own quantity when that's in the line's purchase unit
// (the same rule the item card sums by). Ordering more than requested shares
// the extra the same way. A request whose quantity can't be compared counts
// equally. The last request takes the rounding remainder, so the shares add
// up to the line exactly. Pure — exported for tests. Returns Map prId → qty.
export function splitLineQuantity(line, prs) {
  const total = Number(line?.quantity) || 0;
  const list = prs || [];
  const unit = String(line?.purchaseUnit || '').trim().toLowerCase();
  const weightOf = (pr) => {
    const pieces = (pr?.fabricationDimensionLines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    if (pieces > 0) return pieces;
    const sameUnit = !unit || String(pr?.unit || '').trim().toLowerCase() === unit;
    return sameUnit ? Number(pr?.quantity) || 0 : 0;
  };
  let weights = list.map(weightOf);
  if (!weights.every(w => w > 0)) weights = list.map(() => 1);
  const sum = weights.reduce((s, w) => s + w, 0);
  const out = new Map();
  let used = 0;
  list.forEach((pr, i) => {
    const qty = i === list.length - 1
      ? Math.round((total - used) * 1000) / 1000
      : Math.round((total * weights[i] / sum) * 1000) / 1000;
    used += qty;
    out.set(String(pr._id), qty);
  });
  return out;
}

// Everything that makes a saved PO a REAL order — runs straight away for a
// PO that needs no approval, or when the Company Admin approves a pending
// one. Driven entirely by the stored PO (not the original request body), so
// it works the same either way:
//   - each PR the PO covers → linked + 'Ordered', with that line's purchase
//     quantity/unit and quoted warranty (read at receive time)
//   - each ItemQuoteGroup it came from → 'Batched' (frees the item for a new
//     Open group) and every OTHER still-Submitted bid on it → 'Rejected'
//   - the Purchase Invoice is created now (advance payments need something
//     to pay against from the moment the PO exists)
export async function finalizePurchase(purchase, user, req = null) {
  const companyId = purchase.companyId;

  // Each request's OWN share of its line (2026-10-14): a line can carry
  // several requests, and every one of them used to get the WHOLE line's
  // quantity — Store's receive then summed them (3 requests → 3× the line:
  // stock and QC tripled) and the QC-pass money split went equal.
  const shareOf = new Map();
  for (const line of purchase.items || []) {
    const ids = prIdsOf(line).map(String);
    if (!ids.length) continue;
    const linePrs = await PurchaseRequest.find({ _id: { $in: ids } }).select('quantity unit fabricationDimensionLines').lean();
    for (const [id, qty] of splitLineQuantity(line, linePrs)) shareOf.set(id, qty);
  }

  for (const prId of purchase.purchaseRequests || []) {
    const prUpdate = { purchaseOrder: purchase._id, status: 'Ordered' };
    // Each PR is matched to its OWN line — no `|| items[0]` guessing (a
    // line can carry several PRs; matching an unrelated line would be wrong).
    const line = (purchase.items || []).find(it => prIdsOf(it).some(id => String(id) === String(prId)));
    if (line) {
      if (line.purchaseUnit && Number(line.quantity) > 0) {
        prUpdate.purchaseQuantity = shareOf.get(String(prId)) ?? Number(line.quantity);
        prUpdate.purchaseUnit = line.purchaseUnit;
        const unitType = line.purchaseUnitType
          || (line.item ? (await Item.findById(line.item).select('purchaseUnitType').lean())?.purchaseUnitType : null);
        if (unitType) prUpdate.purchaseUnitType = unitType;
      }
      prUpdate.warrantyMonths = Number(line.warrantyMonths) || 0;
    }
    await PurchaseRequest.findOneAndUpdate({ _id: prId, companyId }, prUpdate);
  }

  const groupIds = [...new Set((purchase.items || []).map(it => it.itemQuoteGroup).filter(Boolean).map(String))];
  if (groupIds.length) {
    await ItemQuoteGroup.updateMany({ _id: { $in: groupIds }, companyId }, { status: 'Batched' });
    const winningBidIds = (purchase.items || []).map(it => it.vendorBid).filter(Boolean).map(String);
    // Losing quotes — and requests still waiting for a reply, which close
    // (the vendor's link shows the item as no longer needed).
    await VendorBid.updateMany(
      { group: { $in: groupIds }, status: { $in: ['Submitted', 'Invited'] }, _id: { $nin: winningBidIds } },
      { status: 'Rejected' }
    );
    // The quotes this PO was made from — "Chosen" in the quote history.
    if (winningBidIds.length) {
      await VendorBid.updateMany({ _id: { $in: winningBidIds } }, { status: 'Selected' });
    }
  }

  if (purchase.status === 'Pending Approval') {
    purchase.status = 'Draft';
    // No advance: the vendor's days count from when the order is really
    // placed — approval day, not the day it was sent for approval.
    if (purchase.deliveryClock?.startsOn === 'order') {
      const now = new Date();
      for (const { line, date } of clockDates(purchase, now)) line.expectedDeliveryDate = date;
      const live = (purchase.items || []).filter(l => !l.cancelled?.at).map(l => l.expectedDeliveryDate).filter(Boolean).map(d => new Date(d).getTime());
      if (live.length) purchase.expectedDeliveryDate = new Date(Math.max(...live));
      purchase.deliveryClock = { startsOn: 'order', startedAt: now };
    }
    await purchase.save();
  }

  // Wrapped so an invoice failure never undoes the PO — the receive-time
  // createAutoPurchaseInvoice calls remain a harmless dedup fallback.
  try {
    const { createAutoPurchaseInvoice } = await import('./purchaseInvoiceController.js');
    await createAutoPurchaseInvoice(purchase, user);
  } catch (invoiceError) {
    console.error('❌ Error creating purchase invoice for PO:', invoiceError);
  }

  // The PO is a real order now — email it to the vendor (procurement-v2).
  // A failed / unconfigured email leaves it as Draft; Purchase can resend.
  let sent;
  try {
    sent = await sendPurchaseOrderToVendor(purchase);
    if (sent.success) purchase.status = sent.status;
    else console.warn(`PO ${purchase.purchaseOrderNumber} not emailed to the vendor: ${sent.error}`);
  } catch (emailError) {
    console.error('❌ Error emailing PO to the vendor:', emailError);
    sent = { success: false, error: emailError.message };
  }
  // Audit log (gap 17): the automatic email, sent or not.
  await logPoEvent({
    po: purchase, user: null, req,
    action: sent?.success ? 'emailed' : 'email_failed',
    summary: sent?.success ? 'Emailed to the vendor automatically.' : `Not emailed to the vendor: ${sent?.error || 'unknown error'}`,
    details: { manual: false, error: sent?.success ? null : (sent?.error || null) },
  });
  // Store expected receipts (2026-10-10): Store hears about it now.
  await notifyStoreOfIncomingPO(purchase);
}

// Emails the full PO to its vendor (procurement-v2, 2026-10-08) — items with
// GST and due dates, charges, payment terms, totals, delivery address. Used
// automatically by finalizePurchase (a PO created directly, or approved by
// the Company Admin) and by the "Send / Resend PO email" button. Only a real
// send moves a Draft PO to 'Sent'; nothing else about the PO changes, and a
// failure never undoes the PO — Purchase can resend from Purchase Orders.
export async function sendPurchaseOrderToVendor(purchase) {
  const po = await Purchase.findById(purchase._id)
    .populate('supplier', 'supplierName email')
    .populate('items.item', 'code name');
  if (!po) return { success: false, error: 'Purchase order not found' };
  if (!po.supplier?.email) return { success: false, error: 'The vendor has no email address in Vendor Master.' };
  const company = await Company.findById(po.companyId).select('name').lean();
  const result = await sendPurchaseOrderEmail({
    to: po.supplier.email,
    vendorName: po.supplier.supplierName || 'Vendor',
    companyName: company?.name || 'Samtek',
    purchase: po,
  });
  if (result.success && po.status === 'Draft') {
    po.status = 'Sent';
    await po.save();
  }
  return { ...result, status: po.status };
}

// Checks a (pending) PO can still become a real order — used on approval,
// since things may have moved while it waited.
export async function checkPurchaseStillValid(purchase) {
  const companyId = purchase.companyId;
  const vendor = await Supplier.findOne({ _id: purchase.supplier, companyId });
  const notEligible = eligibleVendorError(vendor);
  if (notEligible) return notEligible;

  const groupIds = [...new Set((purchase.items || []).map(it => it.itemQuoteGroup).filter(Boolean).map(String))];
  if (groupIds.length) {
    const groups = await ItemQuoteGroup.find({ _id: { $in: groupIds }, companyId }).select('status quantity').lean();
    const byId = new Map(groups.map(g => [String(g._id), g]));
    for (const line of purchase.items || []) {
      if (!line.itemQuoteGroup) continue;
      const g = byId.get(String(line.itemQuoteGroup));
      if (!g || g.status !== 'Open') return `"${line.itemName}" is no longer open for ordering.`;
      if (Number(g.quantity) !== Number(line.quantity)) return `"${line.itemName}"'s quantity changed since this PO was made.`;
    }
  }
  const prIds = purchase.purchaseRequests || [];
  if (prIds.length) {
    const alreadyOrdered = await PurchaseRequest.find({ _id: { $in: prIds }, companyId, purchaseOrder: { $ne: null } }).select('requestId').lean();
    if (alreadyOrdered.length) return `${alreadyOrdered.map(p => p.requestId).join(', ')} already on another PO.`;
  }
  return null;
}

export const createPurchase = async (req, res) => {
  try {
    const {
      supplier,
      items,
      expectedDeliveryDate,
      deliveryAddress,
      terms,
      notes,
      // Plural — a PO batches several independently-raised PRs for the same
      // vendor. `purchaseRequest` (singular) still accepted for any caller
      // that only ever sends one.
      purchaseRequests: purchaseRequestsBody,
      purchaseRequest,
      // Who physically brings the goods — 'Company' puts the PO on
      // Dispatch's pickup list. No automatic charge rule any more: charges
      // are typed on the PO, so a company pickup simply has no freight line.
      transportBy,
      // PO-time terms (procurement-v2)
      charges: chargesBody,
      paymentTerms: paymentTermsBody,
    } = req.body;
    const companyId = req.user.role === USER_ROLES.SUPER_USER ? (req.body.companyId || req.user.companyId) : req.user.companyId;
    const finalTransportBy = transportBy === 'Company' ? 'Company' : 'Vendor';

    if (!supplier || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Supplier and items are required' });
    }

    // A group-based line's bid was priced against a frozen snapshot of the
    // group's quantity. If the group's quantity has since changed without
    // the bid being re-synced, it can't be ordered — re-checked here, not
    // trusted from what the page last loaded.
    const groupLineChecks = items.filter(it => it.itemQuoteGroup && it.vendorBidId);
    // Live groups by id — also gives each fabrication line its size × pieces (2026-10-09).
    let liveGroupById = new Map();
    // The quotes behind the lines — also each line's quoted delivery days.
    let bidById = new Map();
    if (groupLineChecks.length) {
      const groupIds = [...new Set(groupLineChecks.map(it => String(it.itemQuoteGroup)))];
      const liveGroups = await ItemQuoteGroup.find({ _id: { $in: groupIds }, companyId }).select('quantity status sizeKey sizeValues pieces requestedPieces').lean();
      liveGroupById = new Map(liveGroups.map(g => [String(g._id), g]));
      for (const it of groupLineChecks) {
        const liveGroup = liveGroupById.get(String(it.itemQuoteGroup));
        if (!liveGroup || liveGroup.status !== 'Open' || Number(liveGroup.quantity) !== Number(it.quantity)) {
          return res.status(409).json({
            message: `"${it.itemName || 'This item'}"'s quote no longer matches its item group's current quantity — refresh and sync it before creating this PO.`,
          });
        }
      }
      // An item already on a PO that's waiting for Company Admin approval is
      // locked until that one is approved or rejected.
      const held = await groupsHeldByPendingPO(companyId, groupIds);
      if (held.size) {
        return res.status(409).json({ message: `Already on ${[...new Set(held.values())].join(', ')}, waiting for Company Admin approval.` });
      }

      // The quote itself must still be this vendor's current, valid quote —
      // not replaced / declined since the page loaded, and not past the
      // company's quote validity (Purchase Settings, 2026-10-09).
      // The line's rate, GST and warranty are read from here too — never
      // from the page (2026-10-14) — and the quotations behind the lines give
      // the charges / terms the PO is compared with.
      const bids = await VendorBid.find({ _id: { $in: groupLineChecks.map(it => it.vendorBidId) }, companyId })
        .select('status vendor submittedAt createdAt deliveryDays unitPrice gstPercent gstInclusive warrantyMonths quotationRequest manualQuotation')
        .populate('quotationRequest', 'number charges paymentTerms submittedAt')
        .populate('manualQuotation', 'number charges paymentTerms createdAt quoteDate')
        .lean();
      bidById = new Map(bids.map(b => [String(b._id), b]));
      const validityDays = (await getOrCreateSettings(companyId)).quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
      for (const it of groupLineChecks) {
        const bid = bidById.get(String(it.vendorBidId));
        if (!bid || bid.status !== 'Submitted' || String(bid.vendor) !== String(supplier)) {
          return res.status(409).json({ message: `"${it.itemName || 'This item'}"'s quote isn't current any more — refresh the page.` });
        }
        if (isQuoteExpired(bid, validityDays)) {
          const until = quoteValidUntil(bid, validityDays);
          return res.status(409).json({
            message: `"${it.itemName || 'This item'}"'s quote expired on ${until.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} (quotes are valid for ${validityDays} days) — get a fresh quote first.`,
          });
        }
      }
    }

    // Resolve delivery address from company profile if not supplied
    let finalDeliveryAddress = deliveryAddress;
    if (!finalDeliveryAddress && companyId) {
      const company = await Company.findById(companyId);
      if (company) {
        finalDeliveryAddress = `${company.address || ''}, ${company.city || ''}, ${company.state || ''} - ${company.locationPin || ''}`
          .trim()
          .replace(/^,\s*/, '')
          .replace(/,\s*,/g, ',');
      }
    }
    if (!finalDeliveryAddress) {
      finalDeliveryAddress = 'Main Warehouse, Samtek Factory';
    }

    const supplierDoc = await Supplier.findOne({ _id: supplier, companyId });
    if (!supplierDoc) {
      return res.status(400).json({ message: 'Supplier not found' });
    }
    // Only a Company-Admin-approved, active vendor can get a PO.
    const notEligible = eligibleVendorError(supplierDoc);
    if (notEligible) {
      return res.status(400).json({ message: notEligible });
    }

    // CGST + SGST vs IGST (point 15, 2026-10-10): fixed now, from the
    // company's and the vendor's GSTIN (or state), so a later address change
    // never rewrites an order's tax.
    const ourCompany = await Company.findById(companyId).select('gst state').lean();
    const gstSplit = gstSplitFor({
      ourGstin: ourCompany?.gst, ourState: ourCompany?.state,
      theirGstin: supplierDoc.gstNumber, theirState: supplierDoc.address?.state,
    });

    // Vendor selection check (gap 12, 2026-10-09) — re-run here, never
    // trusted from the page. Enough vendors asked per item, and no other
    // vendor quoted this whole PO for less (landed: price + GST + charges).
    // A failed check needs Purchase's reason, and the PO goes to the Company
    // Admin whatever its value (approval reasons below).
    const settings = await getOrCreateSettings(companyId);
    let selectionCheck = null;
    if (groupLineChecks.length) {
      const check = await checkVendorSelection({
        companyId, vendorId: supplier, settings,
        groupIds: groupLineChecks.map(it => String(it.itemQuoteGroup)),
      });
      if (check) {
        let exception = null;
        if (!check.passed) {
          exception = readSelectionException(req.body.selectionException);
          if (exception.error) {
            return res.status(400).json({ message: `This vendor choice didn't pass the selection check — ${exception.error}`, selectionCheck: check });
          }
        }
        selectionCheck = {
          ...check,
          exceptionReasons: exception?.reasons || [],
          exceptionNote: exception?.note || '',
          checkedAt: new Date(),
        };
      }
    }

    // Lines — a line made from a quote takes its rate, GST % / "includes
    // GST" and warranty FROM THE QUOTE (2026-10-14): the PO can't price or tax
    // a line differently from what the vendor quoted; a wrong quote is
    // re-quoted. Other lines (no quote) use what was sent. An inclusive line
    // (the rate already contains GST) adds nothing on top, so it's never
    // counted twice in grandTotal.
    let totalAmount = 0;
    let lineGstTotal = 0;
    const purchaseItems = [];
    const orderDate = new Date();
    // With an advance, the vendor's delivery days count from the day the
    // advance is paid (client, 2026-10-12) — the lines get no date yet.
    // Without one, they count from the order, as before.
    const poPaymentTerms = cleanPaymentTerms(paymentTermsBody);
    const clockOnAdvance = Number(poPaymentTerms.advancePercent) > 0;

    for (const item of items) {
      const inventoryItem = await Item.findById(item.item);
      if (!inventoryItem) {
        return res.status(400).json({ message: `Inventory item ${item.item} not found` });
      }

      const quote = item.itemQuoteGroup && item.vendorBidId ? bidById.get(String(item.vendorBidId)) : null;
      const unitPrice = quote ? Number(quote.unitPrice) : Number(item.unitPrice);
      const itemTotal = round2(Number(item.quantity) * unitPrice);
      totalAmount += itemTotal;

      const gstInclusive = quote ? !!quote.gstInclusive : !!item.gstInclusive;
      const gstRate = quote ? pctOrZero(quote.gstPercent) : pctOrZero(item.gstPercent ?? item.gstRate);
      const gstAmount = gstInclusive ? 0 : round2(itemTotal * gstRate / 100);
      lineGstTotal += gstAmount;

      // This line's quoted delivery days — from its quote when there is one
      // (not trusted from the page), else what was sent — and its date: the
      // order date + those days, or none yet when the PO has an advance.
      const quotedDays = Number(bidById.get(String(item.vendorBidId || ''))?.deliveryDays ?? item.deliveryDays);
      const itemDeliveryDays = quotedDays > 0 ? Math.round(quotedDays) : null;
      const itemExpectedDeliveryDate = itemDeliveryDays && !clockOnAdvance
        ? new Date(orderDate.getTime() + itemDeliveryDays * 24 * 60 * 60 * 1000)
        : null;

      purchaseItems.push({
        item: item.item,
        itemName: inventoryItem.name || inventoryItem.itemName,
        quantity: item.quantity,
        unitPrice,
        totalPrice: itemTotal,
        purchaseRequest: item.purchaseRequest || null,
        purchaseRequests: Array.isArray(item.purchaseRequests) ? item.purchaseRequests : [],
        itemQuoteGroup: item.itemQuoteGroup || null,
        vendorBid: item.vendorBidId || null,
        purchaseUnit: item.purchaseUnit || null,
        purchaseUnitType: item.purchaseUnitType || null,
        expectedDeliveryDate: itemExpectedDeliveryDate,
        deliveryDays: itemDeliveryDays,
        warrantyMonths: quote ? Number(quote.warrantyMonths) || 0 : Number(item.warrantyMonths) || 0,
        // From the item master, once (2026-10-15) — receive and QC read this.
        isFabrication: !!inventoryItem.fabricationRef,
        gstInclusive,
        gstRate,
        gstAmount,
        receivedQuantity: 0,
        pendingQuantity: item.quantity,
        // A fabrication size card: the ordered size × pieces (can be more
        // than the requests asked for) — the PO email and Store's receive
        // form read this (2026-10-09).
        fabricationDimensionLines: (() => {
          const g = item.itemQuoteGroup ? liveGroupById.get(String(item.itemQuoteGroup)) : null;
          return g?.sizeKey ? [{ values: g.sizeValues, quantity: g.pieces ?? g.requestedPieces ?? 0, lineWeightKg: null }] : [];
        })(),
      });
    }

    const charges = cleanPoCharges(chargesBody);
    const chargesTotal = round2(charges.reduce((s, c) => s + c.amount, 0));
    const chargesGstTotal = round2(charges.reduce((s, c) => s + c.gstAmount, 0));
    totalAmount = round2(totalAmount);
    const taxAmount = round2(lineGstTotal);
    const grandTotal = round2(totalAmount + taxAmount + chargesTotal + chargesGstTotal);

    // The PO's own single expectedDeliveryDate — the latest of its lines'
    // own dates (the order is only complete once everything arrives).
    const itemDates = purchaseItems.map(it => it.expectedDeliveryDate).filter(Boolean);
    const latestItemDate = itemDates.length ? new Date(Math.max(...itemDates.map(d => d.getTime()))) : null;

    // The batch's whole PR list — flattened across every line's own PRs.
    const purchaseRequests = Array.isArray(purchaseRequestsBody) && purchaseRequestsBody.length
      ? purchaseRequestsBody.filter(Boolean)
      : (purchaseRequest ? [purchaseRequest] : [...new Set(purchaseItems.flatMap(it => prIdsOf(it).map(String)))]);

    // Charges + payment terms vs the vendor's quotation (2026-10-14,
    // services/poQuoteTermsService.js): the newest quotation behind the
    // lines, the same one PO review pre-fills from. Any difference needs
    // Purchase's reason; charges above the quotation need the Company Admin.
    let quoteTermsCheck = null;
    const quotations = [...bidById.values()].map(b => (
      b.manualQuotation?._id ? { q: b.manualQuotation, manual: true } : b.quotationRequest?._id ? { q: b.quotationRequest, manual: false } : null
    )).filter(Boolean);
    const quotedFrom = newestQuotation(quotations);
    if (quotedFrom) {
      const cmp = compareWithQuotation(quotedFrom.q, { charges, paymentTerms: poPaymentTerms });
      let why = null;
      if (cmp.changes.length) {
        why = readTermsChangeReason(req.body.termsChange);
        if (why.error) {
          return res.status(400).json({ message: `The charges / payment terms differ from ${quotedFrom.q.number} — ${why.error}`, quoteTermsCheck: { from: quotedFrom.q.number, ...cmp } });
        }
      }
      quoteTermsCheck = {
        from: quotedFrom.q.number,
        changes: cmp.changes,
        quotedChargesTotal: cmp.quotedChargesTotal,
        poChargesTotal: cmp.poChargesTotal,
        chargesAbove: cmp.chargesAbove,
        reasons: why?.reasons || [],
        note: why?.note || '',
      };
    }

    // Company Admin approval — over the ₹ threshold (on the final total),
    // a failed vendor selection check (gap 12), and/or charges above the
    // vendor's quotation (2026-10-14).
    const threshold = settings.poApprovalThreshold;
    const overThreshold = threshold != null && grandTotal > Number(threshold);
    const selectionFailed = !!selectionCheck && !selectionCheck.passed;
    const chargesAbove = !!quoteTermsCheck?.chargesAbove;
    const approvalReasons = [...(overThreshold ? ['threshold'] : []), ...(selectionFailed ? ['selection'] : []), ...(chargesAbove ? ['charges'] : [])];
    const needsApproval = approvalReasons.length > 0;
    const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
    const approvalWhy = [
      overThreshold ? `above the ${inr(threshold)} limit` : null,
      selectionFailed ? 'vendor selection exception' : null,
      chargesAbove ? `charges above ${quoteTermsCheck.from}` : null,
    ].filter(Boolean).join(' + ');

    const purchase = await Purchase.create({
      supplier,
      items: purchaseItems,
      totalAmount,
      taxAmount,
      charges,
      chargesTotal,
      chargesGstTotal,
      paymentTerms: poPaymentTerms,
      grandTotal,
      transportBy: finalTransportBy,
      expectedDeliveryDate: clockOnAdvance ? null
        : expectedDeliveryDate ? new Date(expectedDeliveryDate)
          : (latestItemDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      deliveryClock: clockOnAdvance ? { startsOn: 'advance', startedAt: null } : { startsOn: 'order', startedAt: orderDate },
      unit: req.user.role === USER_ROLES.SUPER_USER ? req.body.unit : req.user.unit,
      companyId,
      createdBy: req.user._id,
      deliveryAddress: finalDeliveryAddress,
      terms,
      notes,
      purchaseRequests,
      selectionCheck,
      quoteTermsCheck,
      gstSplit,
      status: needsApproval ? 'Pending Approval' : 'Draft',
      approval: needsApproval
        ? { required: true, threshold: threshold != null ? Number(threshold) : null, decision: 'Pending', requestedBy: req.user._id, requestedAt: new Date(), reasons: approvalReasons }
        // Records the limit that applied (null = none set) so the Company
        // Admin's Approved list can say "within the ₹X limit".
        : { required: false, threshold: threshold != null ? Number(threshold) : null },
    });

    // Audit log (gap 17) — the PO's first line, written before anything it
    // triggers (the automatic email is logged inside finalizePurchase).
    await logPoEvent({
      po: purchase, user: req.user, req,
      action: needsApproval ? 'sent_for_approval' : 'created',
      summary: needsApproval
        ? `Sent for Company Admin approval — ${inr(grandTotal)} (${approvalWhy}).`
        : `Created directly — ${inr(grandTotal)}, ${threshold != null ? `within the ${inr(threshold)} limit` : 'no approval limit set'}.`,
      details: {
        grandTotal,
        lines: purchaseItems.length,
        approvalReasons,
        threshold: threshold != null ? Number(threshold) : null,
        selectionPassed: selectionCheck ? !!selectionCheck.passed : null,
        selectionException: selectionCheck && !selectionCheck.passed ? { reasons: selectionCheck.exceptionReasons, note: selectionCheck.exceptionNote } : null,
        // Charges / terms changed from the vendor's quotation, with the reason.
        quoteTermsChange: quoteTermsCheck?.changes?.length ? quoteTermsCheck : null,
      },
    });

    if (needsApproval) {
      try {
        await notificationService.createNotification({
          title: 'Purchase order needs your approval',
          message: `${purchase.purchaseOrderNumber} — ${supplierDoc.supplierName} — ${inr(grandTotal)} (${approvalWhy})`,
          type: 'purchase',
          targetRole: 'Company Admin',
          targetCompanyId: companyId,
          data: { purchaseId: String(purchase._id), poApproval: true },
        });
      } catch (notifyErr) {
        console.error('Notify Company Admin of PO approval failed:', notifyErr);
      }
    } else {
      await finalizePurchase(purchase, req.user, req);
      // The Company Admin hears about EVERY PO (procurement-v2): this one
      // needed no approval, so it lands straight in their Approved list.
      try {
        await notificationService.createNotification({
          title: 'Purchase order created',
          message: `${purchase.purchaseOrderNumber} — ${supplierDoc.supplierName} — ₹${grandTotal.toLocaleString('en-IN')} (${threshold != null ? `within the ₹${Number(threshold).toLocaleString('en-IN')} limit` : 'no approval limit set'})`,
          type: 'purchase',
          targetRole: 'Company Admin',
          targetCompanyId: companyId,
          data: { purchaseId: String(purchase._id), poApproval: true },
        });
      } catch (notifyErr) {
        console.error('Notify Company Admin of direct PO failed:', notifyErr);
      }
    }

    await purchase.populate([
      { path: 'supplier', select: 'supplierName contactPerson email phone' },
      { path: 'createdBy', select: 'fullName' }
    ]);

    res.status(201).json({
      message: needsApproval
        ? `Sent to the Company Admin for approval — ${approvalWhy}.`
        : purchase.status === 'Sent'
          ? 'Purchase order created and emailed to the vendor.'
          : 'Purchase order created — but the email to the vendor didn\'t go out. Use "Send PO email" on the Purchase Orders tab.',
      pendingApproval: needsApproval,
      purchase
    });
  } catch (error) {
    console.error('Create purchase error:', error);
    // A rule on the PO itself (e.g. a line's quantity) — say which, instead
    // of a bare 500 (2026-10-14: a 0.125 kg line showed only "Internal
    // server error").
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: `The PO couldn't be saved — ${Object.values(error.errors || {}).map(e => e.message).join('; ') || error.message}` });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const updatePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      paymentStatus,
      expectedDeliveryDate,
      actualDeliveryDate,
      deliveryAddress,
      terms,
      notes,
      approvedBy,
      supplier,
      items,
      taxAmount,
      purchaseQuantity,
      purchaseUnit
    } = req.body;

    const purchase = await Purchase.findById(id);

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && (purchase.unit !== req.user.unit || String(purchase.companyId) !== String(req.user.companyId))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Company Admin approval (procurement-v2): a PO waiting for approval must
    // stay exactly what the Company Admin is looking at, and a rejected one
    // never became an order — neither can be edited.
    if (['Pending Approval', 'Rejected'].includes(purchase.status)) {
      return res.status(409).json({ message: `This PO is ${purchase.status} and can't be changed.` });
    }

    const updateData = {};

    // Disabled 2026-10-05 — setting status here (e.g. to 'Cancelled') never
    // cleans up the PurchaseInvoice that's now auto-created at PO-creation
    // time (Fifteenth pass), which would leave a permanent, uncollectible
    // balance inflating that vendor's credit exposure forever. Confirmed
    // this endpoint's one live caller (PurchaseRequest.jsx's "Modify PO")
    // never actually sends `status` — it's only used to edit
    // vendor/items/price/delivery/terms, all of which still work below.
    // `status` itself is now silently ignored until a real Cancel/Delete PO
    // flow is built that also voids the invoice — uncomment and fix then.
    // if (status) {
    //   updateData.status = status;
    //   if (status === 'Received') {
    //     updateData.actualDeliveryDate = actualDeliveryDate ? new Date(actualDeliveryDate) : new Date();
    //   }
    // }

    // paymentStatus is no longer set by hand — it follows the PO's bill
    // (services/purchaseBillService.js, 2026-10-12).
    if (expectedDeliveryDate) updateData.expectedDeliveryDate = new Date(expectedDeliveryDate);
    if (deliveryAddress) updateData.deliveryAddress = deliveryAddress;
    if (terms) updateData.terms = terms;
    if (notes) updateData.notes = notes;

    if (supplier) {
      const supplierDoc = await Supplier.findOne({ _id: supplier, companyId: req.user.companyId });
      if (supplierDoc) {
        updateData.supplier = supplier;
      }
    }

    if (items && Array.isArray(items)) {
      let totalAmt = 0;
      const purchaseItems = [];
      const existingItems = purchase.items || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const inventoryItem = await Item.findById(item.item);
        const itemName = inventoryItem ? (inventoryItem.name || inventoryItem.itemName) : item.itemName;
        const itemTotal = item.quantity * item.unitPrice;
        totalAmt += itemTotal;
        // Preserve every field this endpoint doesn't actually let Purchase
        // edit — PR link(s)/group, item charges, GST, expected delivery
        // date, warranty, fabrication breakdown — from the existing line
        // it corresponds to. Pre-existing bug, found while building this
        // pass: rebuilding items[] from only the fields this flow's one
        // live caller (PurchaseRequest.jsx's "Modify PO") actually sends
        // (item/itemName/quantity/unitPrice/totalPrice) was silently
        // wiping all of these on every save — which would have broken
        // computeHealedStatus, the By Vendor receive badges, and group-
        // staleness detection on any PO ever modified here, the moment the
        // new purchaseRequests/itemQuoteGroup fields started being relied
        // on. Matched by Inventory item id first (stable across an edit
        // that only changes quantity/price), falling back to position when
        // that's not given.
        const existing = (item.item && existingItems.find(ex => String(ex.item) === String(item.item)))
          || existingItems[i]
          || {};
        purchaseItems.push({
          item: item.item,
          itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: itemTotal,
          receivedQuantity: item.receivedQuantity ?? existing.receivedQuantity ?? 0,
          pendingQuantity: item.quantity - (item.receivedQuantity ?? existing.receivedQuantity ?? 0),
          purchaseRequest: existing.purchaseRequest || null,
          purchaseRequests: existing.purchaseRequests || [],
          itemQuoteGroup: existing.itemQuoteGroup || null,
          itemCharges: existing.itemCharges || [],
          itemChargesTotal: existing.itemChargesTotal || 0,
          gstInclusive: existing.gstInclusive || false,
          gstRate: existing.gstRate || 0,
          gstAmount: existing.gstAmount || 0,
          vendorBid: existing.vendorBid || null,
          purchaseUnit: existing.purchaseUnit || null,
          purchaseUnitType: existing.purchaseUnitType || null,
          expectedDeliveryDate: existing.expectedDeliveryDate || null,
          deliveryDays: existing.deliveryDays ?? null,
          warrantyMonths: existing.warrantyMonths || 0,
          fabricationDimensionLines: existing.fabricationDimensionLines || [],
          // Also never edited here (2026-10-12 — these were being dropped).
          deliveryDateHistory: existing.deliveryDateHistory || [],
          overdueNotifiedFor: existing.overdueNotifiedFor || null,
          cancelled: existing.cancelled || null,
        });
      }
      updateData.items = purchaseItems;
      updateData.totalAmount = totalAmt;
      const taxAmt = taxAmount !== undefined ? taxAmount : (purchase.taxAmount || 0);
      updateData.taxAmount = taxAmt;
      // Same formula as createPurchase: goods + tax + the PO's own charges
      // and their GST (procurement-v2), plus any OLD automatic vendor
      // charges a legacy PO still carries (poCharges / itemCharges).
      const itemChargesSum = purchaseItems.reduce((sum, it) => sum + (it.itemChargesTotal || 0), 0);
      updateData.grandTotal = totalAmt + taxAmt + (purchase.chargesTotal || 0) + (purchase.chargesGstTotal || 0)
        + (purchase.poChargesTotal || 0) + itemChargesSum;
    } else if (taxAmount !== undefined) {
      updateData.taxAmount = taxAmount;
      updateData.grandTotal = (purchase.totalAmount || 0) + taxAmount + (purchase.chargesTotal || 0) + (purchase.chargesGstTotal || 0);
    }

    // Handle approval
    if (approvedBy && !purchase.isApproved) {
      updateData.isApproved = true;
      updateData.approvedBy = req.user._id;
      updateData.status = 'Sent';
    }

    // Keep every linked PurchaseRequest's purchase-unit quantity in sync when
    // the PO is modified (e.g. accounts corrects "2 kg" to "3 kg" before
    // sending) — same fields set at creation time, see createPurchase above.
    // Each PR matched to its own line the same way createPurchase does.
    if (purchase.purchaseRequests?.length && Number(purchaseQuantity) > 0 && purchaseUnit) {
      for (const prId of purchase.purchaseRequests) {
        const prUpdate = { purchaseQuantity: Number(purchaseQuantity), purchaseUnit };
        // No `|| items[0]` fallback (2026-10) — same reasoning as
        // createPurchase's own PR-sync loop above: better to skip the
        // purchaseUnitType lookup than guess it from an unrelated line.
        const matchedItemId = items?.find(it =>
          String(it.purchaseRequest || '') === String(prId)
          || (Array.isArray(it.purchaseRequests) && it.purchaseRequests.some(id => String(id) === String(prId)))
        )?.item || null;
        if (matchedItemId) {
          const matchedInventoryItem = await Item.findById(matchedItemId).select('purchaseUnitType').lean();
          if (matchedInventoryItem?.purchaseUnitType) prUpdate.purchaseUnitType = matchedInventoryItem.purchaseUnitType;
        }
        await PurchaseRequest.findByIdAndUpdate(prId, prUpdate);
      }
    }

    const updatedPurchase = await Purchase.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate([
      { path: 'supplier', select: 'supplierName contactPerson email phone' },
      { path: 'createdBy', select: 'fullName' },
      { path: 'approvedBy', select: 'fullName' }
    ]);

    res.json({
      message: 'Purchase order updated successfully',
      purchase: updatedPurchase
    });
  } catch (error) {
    console.error('Update purchase error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Route disabled 2026-10-05 (accountsRoutes.js) — this never cleans up the
// PurchaseInvoice auto-created at PO-creation time (Fifteenth pass), so
// deleting a PO would orphan its invoice's balance forever. Had zero
// frontend callers anyway (confirmed by grep). Fix the invoice cleanup and
// re-enable the route before wiring this up to any UI.
export const deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;

    const purchase = await Purchase.findById(id);

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && (purchase.unit !== req.user.unit || String(purchase.companyId) !== String(req.user.companyId))) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (['Sent', 'Acknowledged', 'Partially Received', 'Received'].includes(purchase.status)) {
      return res.status(400).json({ message: 'Cannot delete purchase order that has been sent or received' });
    }

    await Purchase.findByIdAndDelete(id);

    res.json({ message: 'Purchase order deleted successfully' });
  } catch (error) {
    console.error('Delete purchase error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const receivePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const { receivedItems } = req.body;

    if (!receivedItems || !Array.isArray(receivedItems)) {
      return res.status(400).json({ message: 'Received items data is required' });
    }

    const purchase = await Purchase.findById(id).populate('items.item');

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    if (req.user.role !== USER_ROLES.SUPER_USER && (purchase.unit !== req.user.unit || String(purchase.companyId) !== String(req.user.companyId))) {
      return res.status(403).json({ message: 'Access denied' });
    }
    // Cancelled (gap 13, 2026-10-09) — nothing can be received on it.
    if (purchase.status === 'Cancelled') {
      return res.status(409).json({ message: 'This PO is cancelled — nothing can be received on it.' });
    }

    // Update received quantities and inventory
    for (const receivedItem of receivedItems) {
      const purchaseItem = purchase.items.find(item =>
        !item.cancelled?.at && item.item._id.toString() === receivedItem.itemId
      );

      if (purchaseItem && receivedItem.receivedQuantity > 0) {
        purchaseItem.receivedQuantity += receivedItem.receivedQuantity;
        purchaseItem.pendingQuantity = purchaseItem.quantity - purchaseItem.receivedQuantity;

        // Update inventory stock
        const inventoryItem = await Item.findById(purchaseItem.item._id);
        if (inventoryItem) {
          const previousStock = inventoryItem.qty || 0;
          inventoryItem.qty = previousStock + receivedItem.receivedQuantity;
          await inventoryItem.save();

          console.log(`✅ Stock updated for item ${inventoryItem.name}. Previous: ${previousStock}, New: ${inventoryItem.qty}`);

          // Create stock movement record safely
          try {
            const { StockMovement } = await import('../models/Inventory.js');
            if (StockMovement && typeof StockMovement.create === 'function') {
              await StockMovement.create({
                item: inventoryItem._id,
                movementType: 'IN',
                quantity: receivedItem.receivedQuantity,
                previousStock,
                newStock: inventoryItem.qty,
                reference: `Purchase Order: ${purchase.purchaseOrderNumber}`,
                referenceId: purchase._id,
                unit: purchase.unit,
                createdBy: req.user._id,
                notes: `Received from ${purchase.supplier?.supplierName || 'Supplier'}`
              });
            } else {
              console.log('[STOCK MOVEMENT] Model not registered, skipping DB log.');
            }
          } catch (e) {
            console.log('[STOCK MOVEMENT] Skipped creation:', e.message);
          }
        }
      }
    }

    // Update purchase status
    const allReceived = purchase.items.every(item => item.pendingQuantity === 0);
    const partiallyReceived = purchase.items.some(item => item.receivedQuantity > 0);

    if (allReceived) {
      purchase.status = 'Received';
      purchase.actualDeliveryDate = new Date();
    } else if (partiallyReceived) {
      purchase.status = 'Partially Received';
    }

    await purchase.save();

    // Audit log (gap 17) — the old whole-PO receive screen.
    const receivedNow = receivedItems.filter(r => Number(r.receivedQuantity) > 0)
      .map(r => {
        const line = purchase.items.find(it => !it.cancelled?.at && String(it.item?._id || it.item) === String(r.itemId));
        return line ? `${line.itemName} ${r.receivedQuantity} ${line.purchaseUnit || ''}`.trim() : null;
      }).filter(Boolean);
    if (receivedNow.length) {
      await logPoEvent({ po: purchase, user: req.user, req, action: 'line_received', summary: `Received: ${receivedNow.join(', ')}.`, details: { items: receivedNow } });
    }
    if (allReceived) {
      await logPoEvent({ po: purchase, user: req.user, req, action: 'fully_received', summary: 'Everything on this PO has been received.' });
    }

    await purchase.populate([
      { path: 'supplier', select: 'supplierName contactPerson' },
      { path: 'items.item', select: 'itemName itemCode' }
    ]);

    res.json({
      message: 'Purchase received successfully',
      purchase
    });
  } catch (error) {
    console.error('Receive purchase error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const getPurchaseStats = async (req, res) => {
  try {
    const { unit, period = 'month' } = req.query;
    let query = {};

    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.companyId = req.user.companyId;
      query.unit = req.user.unit;
    } else if (unit) {
      query.unit = unit;
    }

    const now = new Date();
    let startDate;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStart, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const periodQuery = { ...query, createdAt: { $gte: startDate } };

    const [statusStats, totalAmount, pendingAmount] = await Promise.all([
      Purchase.aggregate([
        { $match: periodQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$grandTotal' }
          }
        }
      ]),
      Purchase.aggregate([
        { $match: periodQuery },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } }
      ]),
      Purchase.aggregate([
        { $match: { ...periodQuery, paymentStatus: 'Pending' } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } }
      ])
    ]);

    res.json({
      period,
      statusStats,
      totalAmount: totalAmount.length > 0 ? totalAmount[0].total : 0,
      pendingAmount: pendingAmount.length > 0 ? pendingAmount[0].total : 0
    });
  } catch (error) {
    console.error('Get purchase stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get inventory items for purchase (excluding Product Master/Motor Master items, unless directly purchasable)
export const getPurchaseItems = async (req, res) => {
  try {
    const { search = '', type = '', skip = 0, limit = 20 } = req.query;

    // Get user's company ID from request - it's the company/store filter
    const userCompanyId = req.user.companyId;
    const userCompanyIdString = userCompanyId ? userCompanyId.toString() : null;

    console.log('🔍 User company ID:', userCompanyId);
    console.log('🔍 User company ID (string):', userCompanyIdString);
    console.log('📊 Search:', search, 'Type:', type);

    // Build filter query:
    // 1. Company filter (store matches user's companyId)
    // 2. Not a Product Master machine / Motor Master item (productKind unset)
    //    OR purchase: true (Trading Goods) — keyed off productKind rather than
    //    the old fixed type list (Material/Spares/Assemblies) since Inventory
    //    Item Type is now a dynamic, "+"-addable list (see InventoryMasterOption),
    //    not a closed enum.
    let filter = {
      store: userCompanyIdString,
      $or: [
        { productKind: null },
        { purchase: true }
      ]
    };

    // Add search filter if provided
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    // Debug: count before and after filters - get breakdown by type
    const typeBreakdown = await Item.aggregate([
      {
        $match: {
          $or: [
            { store: userCompanyIdString },
            { store: userCompanyId }
          ]
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    console.log(`📊 Items breakdown by type:`, typeBreakdown);

    const allCompanyItems = await Item.countDocuments({
      $or: [
        { store: userCompanyIdString },
        { store: userCompanyId }
      ]
    });

    console.log(`📈 Total items in company: ${allCompanyItems}`);

    // Get items with pagination
    const [items, total] = await Promise.all([
      Item.find(filter)
        .select('_id name code category type qty unit purchaseCost stdCost gst minStock store purchaseUnit purchaseUnitType')
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .sort({ name: 1 })
        .lean(),
      Item.countDocuments(filter)
    ]);

    console.log(`✅ Returning ${items.length} items (Total matching: ${total})`);

    res.json({
      success: true,
      data: {
        items: items.map(item => ({
          _id: item._id,
          name: item.name,
          code: item.code,
          category: item.category,
          type: item.type,
          currentQty: item.qty,
          unit: item.unit,
          purchaseCost: item.purchaseCost,
          stdCost: item.stdCost,
          gst: item.gst,
          minStock: item.minStock,
          store: item.store
        })),
        pagination: {
          skip: parseInt(skip),
          limit: parseInt(limit),
          total,
          hasMore: parseInt(skip) + parseInt(limit) < total
        }
      }
    });
  } catch (error) {
    console.error('❌ Get purchase items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch purchase items',
      error: error.message
    });
  }
};

// ==================== PURCHASE > INVENTORY (cost-setting) ====================
// Powers the "Inventory" tab set under Accounts > Purchases: three read
// views (Tools & Raw Material / Product Master / Motor Master) over the
// same Item collection R&D uses, bucketed by productKind, restricted to
// items flagged purchase:true. Purpose here is narrow — list + let
// Purchase set/update purchaseCost per item — not full item CRUD.
const PURCHASE_INVENTORY_KIND_PARAMS = ['none', 'Machine', 'Motor'];

const purchaseInventoryProductKindFilter = (productKind) => {
  const kind = PURCHASE_INVENTORY_KIND_PARAMS.includes(productKind) ? productKind : 'none';
  return kind === 'none' ? null : kind;
};

// Company scoping helper — same "$or over store/companyId, string and
// ObjectId form" pattern getItems already uses for Store/R&D roles
// (inventoryController.js), because Item.store has documented legacy rows
// that are missing/non-ObjectId while companyId is set, and vice versa.
// Returns null when the user has no companyId at all, so callers can fail
// closed (never leak un-scoped items) instead of querying store: null,
// which would match every legacy item with no store backfilled.
const companyScopeFilter = (req) => {
  const companyId = req.user.companyId;
  if (!companyId) return null;
  const companyIdStr = companyId.toString();
  return {
    $or: [
      { store: companyIdStr },
      { store: companyId },
      { companyId: companyIdStr },
      { companyId }
    ]
  };
};

// GET /api/accounts/purchases/inventory?productKind=none|Machine|Motor&search=
export const getPurchaseInventoryItems = async (req, res) => {
  try {
    const { productKind, search = '' } = req.query;
    const scope = companyScopeFilter(req);

    // No company on this user => no items, never leak un-scoped data.
    if (!scope) {
      return res.json({ success: true, items: [] });
    }

    const filter = {
      ...scope,
      purchase: true,
      productKind: purchaseInventoryProductKindFilter(productKind)
    };

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$and = [
        { $or: scope.$or },
        { $or: [{ name: { $regex: escapedSearch, $options: 'i' } }, { code: { $regex: escapedSearch, $options: 'i' } }] }
      ];
      delete filter.$or;
    }

    const items = await Item.find(filter)
      .select('_id name code category subCategory unit qty purchaseCost weightUnitPrice fabricationRef dimensionVariants mrp salePrice profitPercent discountPercent productKind updatedAt')
      .sort({ name: 1 })
      .lean();

    res.json({ success: true, items });
  } catch (error) {
    console.error('❌ Get purchase inventory items error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch inventory items', error: error.message });
  }
};

// PUT /api/accounts/purchases/inventory/:id/purchase-cost
export const updatePurchaseItemCost = async (req, res) => {
  try {
    const { id } = req.params;
    const { purchaseCost } = req.body;

    if (purchaseCost === undefined || purchaseCost === null || purchaseCost === '' || isNaN(purchaseCost) || Number(purchaseCost) < 0) {
      return res.status(400).json({ success: false, message: 'A valid, non-negative purchase cost is required' });
    }

    const scope = companyScopeFilter(req);
    if (!scope) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const item = await Item.findOne({ _id: id, purchase: true, ...scope });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    // Sets purchaseCost and recalculates mrp/salePrice from the item's own
    // profitPercent/discountPercent (Company Admin > Pricing Value) in one
    // step — same formula every other purchase-cost-driven recalculation
    // uses (see itemPricingService.js).
    const updated = await applyPricingToItem(item, Number(purchaseCost), 'Purchase');
    // This bypasses recalculateItemPricing (which would re-derive cost from
    // the latest invoice, overriding Accounts' manually-typed value), so the
    // upward cascade to every machine/sub-assembly that uses this item as a
    // BOM material has to be triggered explicitly here too.
    if (updated) await cascadeRecalculateToConsumers(item);

    res.json({
      success: true,
      message: 'Purchase cost updated successfully',
      item: {
        _id: item._id,
        name: item.name,
        code: item.code,
        category: item.category,
        subCategory: item.subCategory,
        unit: item.unit,
        qty: item.qty,
        purchaseCost: item.purchaseCost,
        mrp: item.mrp,
        salePrice: item.salePrice,
        productKind: item.productKind,
        updatedAt: item.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Update purchase item cost error:', error);
    res.status(500).json({ success: false, message: 'Failed to update purchase cost', error: error.message });
  }
};

// PUT /api/accounts/purchases/inventory/:id/weight-unit-price
// Fabrication items (Item.fabricationRef set) only — see Inventory.js's
// weightUnitPrice field comment for why purchaseCost can't represent this.
// Manual fallback for the same automated path itemPricingService.js's
// resolvePurchaseItemCost/applyPricingToItem already covers once a real
// PurchaseInvoice exists; this is what Accounts sets on a first purchase,
// mirroring updatePurchaseItemCost above field-for-field.
export const updateWeightUnitPrice = async (req, res) => {
  try {
    const { id } = req.params;
    const { weightUnitPrice } = req.body;

    if (weightUnitPrice === undefined || weightUnitPrice === null || weightUnitPrice === '' || isNaN(weightUnitPrice) || Number(weightUnitPrice) < 0) {
      return res.status(400).json({ success: false, message: 'A valid, non-negative price per kg is required' });
    }

    const scope = companyScopeFilter(req);
    if (!scope) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    const item = await Item.findOne({ _id: id, purchase: true, fabricationRef: { $ne: null }, ...scope });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Fabrication item not found' });
    }

    item.weightUnitPrice = Math.round(Number(weightUnitPrice) * 100) / 100;
    await item.save();

    res.json({
      success: true,
      message: 'Price per kg updated successfully',
      item: {
        _id: item._id,
        name: item.name,
        code: item.code,
        weightUnitPrice: item.weightUnitPrice,
        updatedAt: item.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Update weight unit price error:', error);
    res.status(500).json({ success: false, message: 'Failed to update price per kg', error: error.message });
  }
};

export const sendPOToVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const purchase = await Purchase.findById(id).populate('supplier').populate('purchaseRequests');
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    }

    // This handler had NO ownership check of any kind before 2026-10-06 —
    // any authenticated user who knew/guessed a PO id could email it to the
    // vendor and flip its status, regardless of which company it belonged
    // to. Same fetch-then-403 pattern every other handler in this file uses.
    if (req.user.role !== USER_ROLES.SUPER_USER && (purchase.unit !== req.user.unit || String(purchase.companyId) !== String(req.user.companyId))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Not a real order yet / never became one / called off (procurement-v2).
    if (['Pending Approval', 'Rejected', 'Cancelled'].includes(purchase.status)) {
      return res.status(409).json({ success: false, message: `This PO is ${purchase.status} — it can't be sent to the vendor.` });
    }

    if (!purchase.supplier || !purchase.supplier.email) {
      return res.status(400).json({ success: false, message: 'Supplier has no valid email address configured.' });
    }

    // The "Send / Resend PO email" button (procurement-v2) — same full email
    // a PO gets automatically when it becomes a real order.
    const emailResult = await sendPurchaseOrderToVendor(purchase);
    // Audit log (gap 17): who pressed Send / Resend, and whether it went.
    await logPoEvent({
      po: purchase, user: req.user, req,
      action: emailResult.success ? 'emailed' : 'email_failed',
      summary: emailResult.success ? `Emailed to the vendor (${purchase.supplier.email}) — sent by hand.` : `Email to the vendor failed when sent by hand: ${emailResult.error}`,
      details: { manual: true, to: purchase.supplier.email, error: emailResult.success ? null : emailResult.error },
    });
    if (emailResult.success) {
      return res.json({ success: true, message: 'Purchase order emailed to the vendor.' });
    }
    return res.status(emailResult.notConfigured ? 400 : 500).json({ success: false, message: `Couldn't email the vendor: ${emailResult.error}` });
  } catch (error) {
    console.error('Error sending PO to Vendor:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  }
};

// GET /api/dispatches/vendor-pickups — Dispatch stub (2026-10). Transport
// decision (Purchase.transportBy) is made by Purchase at batch time (By
// Vendor tab); when it's 'Company', Logistics/Dispatch needs to arrange
// the pickup themselves instead of the vendor delivering. "Just show the
// request" — purely read-only visibility (PO, vendor, items, expected
// date) for now, no assign-vehicle/driver/status workflow yet; that's
// explicitly deferred to a later pass once this proves out.
export const getVendorPickupsForDispatch = async (req, res) => {
  try {
    // Real orders only — a PO waiting for / refused Company Admin approval
    // (procurement-v2) isn't something Dispatch should go and collect.
    const query = { transportBy: 'Company', status: { $nin: ['Pending Approval', 'Rejected', 'Cancelled'] } };
    if (req.user.role !== USER_ROLES.SUPER_USER) {
      query.companyId = req.user.companyId;
      query.unit = req.user.unit;
    }
    const purchases = await Purchase.find(query)
      .populate('supplier', 'supplierName contactPerson email phone address')
      .select('purchaseOrderNumber supplier items orderDate expectedDeliveryDate deliveryClock status grandTotal')
      .sort({ expectedDeliveryDate: 1 });
    res.json({ success: true, data: purchases });
  } catch (error) {
    console.error('getVendorPickupsForDispatch error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
