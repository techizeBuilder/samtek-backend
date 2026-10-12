// Cancelling a PO (procurement-v2 gap 13, 2026-10-09). Client blueprint:
// "Purchase cancellation and PO amendment workflow with approval"; PO status
// "… Closed / Cancelled".
//
// User decisions:
//  - After a PO exists it is never edited — a change of price / quantity is
//    a cancel + a new order (before the PO, changes go through quotes and
//    All quotes).
//  - It can be cancelled once it is a real order (created directly, or
//    approved) until everything is received. Store receives a whole PO LINE
//    at a time, so: nothing received → Full cancel; some lines received →
//    ShortClose = cancel only the lines not received yet.
//  - Purchase asks (reason list + whose side + note), the Company Admin
//    approves. Store may keep receiving while it waits — approval re-checks.
//  - On approval: the requests reopen on RFQ/PO (unless marked "no longer
//    needed"); still-valid quotes come back; the invoice is cancelled /
//    reduced (never deleted) with a ledger reversal only if it was ever
//    posted; an advance already paid is recorded as a vendor credit; the
//    vendor is emailed.
import { PO_CANCEL_REASONS } from '../models/Purchase.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import ItemQuoteGroup from '../models/ItemQuoteGroup.js';
import VendorBid from '../models/VendorBid.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import Supplier from '../models/Supplier.js';
import { Company } from '../models/Company.js';
import { Item } from '../models/Inventory.js';
import { Transaction, Account } from '../models/Account.js';
import notificationService from './notificationService.js';
import { sendPurchaseOrderCancellationEmail } from './emailService.js';
import { isQuoteExpired, DEFAULT_QUOTE_VALIDITY_DAYS } from './quoteChecksService.js';
import { getOrCreateSettings } from '../controllers/purchaseSettingsController.js';
import { computeGroupQuantityFromPRs, sizeFieldsOf } from '../controllers/itemQuoteGroupController.js';
import { logPoEvent, inr } from './purchaseAuditService.js';

export const CANCELLABLE_STATUSES = ['Draft', 'Sent', 'Acknowledged', 'Partially Received'];
// Reasons that are the vendor's doing — the "whose side" default.
export const VENDOR_SIDE_REASONS = ['Vendor can\'t supply', 'Vendor changed price', 'Vendor delay'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const idsOfLine = (line) => {
  if (Array.isArray(line?.purchaseRequests) && line.purchaseRequests.length) return line.purchaseRequests.map(id => String(id?._id || id));
  if (line?.purchaseRequest) return [String(line.purchaseRequest?._id || line.purchaseRequest)];
  return [];
};

// ── Pure helpers ──────────────────────────────────────────────────────────

// A line is received when every request on it is Received (Store receives a
// whole line at once); a legacy line with no requests, by its own counter.
export function lineReceived(line, prsById) {
  const ids = idsOfLine(line);
  if (ids.length) return ids.every(id => prsById.get(id)?.status === 'Received');
  return Number(line.quantity) > 0 && Number(line.receivedQuantity) >= Number(line.quantity);
}

// Live (not yet cancelled) lines with nothing received — what a cancel takes.
// A line with part received (its QC-rejected material is being replaced,
// 2026-10-12) is never cut: what came was accepted and is owed; a
// replacement that never comes is settled on the rejection instead.
export function cancellableLines(po, prsById) {
  return (po.items || []).filter(l => !l.cancelled?.at && !lineReceived(l, prsById)
    && !idsOfLine(l).some(id => prsById.get(id)?.status === 'Received'));
}

// Full = every live line goes; otherwise a short close of the rest.
export function cancelKind(po, cancelLines) {
  const live = (po.items || []).filter(l => !l.cancelled?.at);
  return cancelLines.length && cancelLines.length === live.length ? 'Full' : 'ShortClose';
}

// What a quote on the cancelled line's item card becomes.
//  - this PO's own quote (Selected): usable again only when the cancel is on
//    OUR side and it hasn't expired; on the vendor's side it's Rejected.
//  - another vendor's quote that was rejected when the PO was made: back to
//    Submitted if they had really quoted (submittedAt) and it's still valid.
//    A request they never answered stays closed.
//  - anything else stays as it is.
export function bidAfterCancel(bid, { side, isThisPO, expired }) {
  if (isThisPO) return side === 'Ours' && !expired ? 'Submitted' : 'Rejected';
  if (bid.status === 'Rejected' && bid.submittedAt && !expired) return 'Submitted';
  return bid.status;
}

// The invoice after a cancel. Full → Cancelled, nothing owed, anything paid
// = vendor credit. ShortClose → amounts rebuilt from the lines still on the
// PO (same sums as createAutoPurchaseInvoice), whole-PO charges kept (the
// delivery happened); anything paid above the new total = vendor credit.
export function invoiceAfterCancel(invoice, { full, remainingLines = [], po = {} }) {
  const oldTotal = round2(invoice.totalAmount);
  const paid = round2(invoice.paidAmount);
  if (full) {
    return { status: 'Cancelled', totalChanged: false, cancelledAmount: oldTotal, vendorCredit: paid };
  }
  let subtotal = 0;
  let gstAmount = 0;
  const items = remainingLines.map(l => {
    const lineTotal = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) + (Number(l.itemChargesTotal) || 0);
    subtotal += lineTotal;
    gstAmount += Number(l.gstAmount) || 0;
    return {
      item: l.item?._id || l.item, itemName: l.itemName, quantity: l.quantity || 1, unitPrice: l.unitPrice || 0,
      gstPercent: l.gstRate || 0, gstAmount: l.gstAmount || 0, totalPrice: round2(lineTotal),
    };
  });
  subtotal += (Number(po.chargesTotal) || 0) + (Number(po.poChargesTotal) || 0);
  gstAmount += Number(po.chargesGstTotal) || 0;
  const totalAmount = round2(subtotal + gstAmount);
  return {
    totalChanged: true,
    items,
    subtotal: round2(subtotal),
    gstAmount: round2(gstAmount),
    totalAmount,
    cancelledAmount: round2(oldTotal - totalAmount),
    vendorCredit: round2(Math.max(0, paid - totalAmount)),
  };
}

// Checks Purchase's request body. Returns { error } or the cleaned fields.
export function readCancelRequest(body) {
  const reasons = [...new Set((Array.isArray(body?.reasons) ? body.reasons : []).map(String).filter(r => PO_CANCEL_REASONS.includes(r)))];
  const note = String(body?.note || '').trim();
  if (!reasons.length) return { error: 'Pick at least one reason for cancelling.' };
  if (reasons.includes('Other') && !note) return { error: 'Add a note explaining "Other".' };
  const side = body?.side === 'Vendor' || body?.side === 'Ours' ? body.side : null;
  if (!side) return { error: 'Say whose side the cancellation is on — the vendor\'s or ours.' };
  const closeRequests = [...new Set((Array.isArray(body?.closeRequests) ? body.closeRequests : []).map(String).filter(id => /^[a-f0-9]{24}$/i.test(id)))];
  return { reasons, note, side, closeRequests };
}

// ── DB ────────────────────────────────────────────────────────────────────

async function prsOfPurchase(po) {
  const ids = [...new Set((po.items || []).flatMap(idsOfLine))];
  const prs = ids.length ? await PurchaseRequest.find({ _id: { $in: ids } }) : [];
  return new Map(prs.map(pr => [String(pr._id), pr]));
}

export const openCancellation = (po) => (po.cancellations || []).find(c => c.status === 'Requested') || null;

// Purchase asks to cancel. Returns { status, message } on refusal.
export async function requestCancellation(po, body, user, req = null) {
  if (!CANCELLABLE_STATUSES.includes(po.status)) {
    const why = po.status === 'Pending Approval' ? 'it is still waiting for approval — the Company Admin can reject it instead'
      : po.status === 'Received' ? 'everything on it has been received — use a return'
        : `it is ${po.status}`;
    return { status: 400, message: `This PO can't be cancelled: ${why}.` };
  }
  if (openCancellation(po)) return { status: 409, message: 'A cancellation is already waiting for the Company Admin.' };
  const read = readCancelRequest(body);
  if (read.error) return { status: 400, message: read.error };

  const prsById = await prsOfPurchase(po);
  const lines = cancellableLines(po, prsById);
  if (!lines.length) return { status: 400, message: 'Everything on this PO has been received — nothing is left to cancel (use a return).' };
  const onLines = new Set(lines.flatMap(idsOfLine));
  if (read.closeRequests.some(id => !onLines.has(id))) return { status: 400, message: 'Some requests marked "no longer needed" aren\'t on the lines being cancelled — refresh the page.' };

  po.cancellations.push({
    status: 'Requested',
    reasons: read.reasons,
    side: read.side,
    note: read.note,
    closeRequests: read.closeRequests,
    requestedBy: user._id,
    requestedAt: new Date(),
  });
  await po.save();

  const kind = cancelKind(po, lines);
  // Audit log (gap 17).
  await logPoEvent({
    po, user, req, action: 'cancel_requested',
    summary: `${kind === 'Full' ? 'Cancellation' : 'Short close'} asked — ${read.reasons.join(', ')}${read.note ? ` (${read.note})` : ''}; ${read.side === 'Vendor' ? "vendor's side" : 'our side'}. Lines: ${lines.map(l => l.itemName).join(', ')}.`,
    details: { kind, reasons: read.reasons, side: read.side, note: read.note, lines: lines.map(l => l.itemName), closeRequests: read.closeRequests },
  });
  try {
    const vendor = await Supplier.findById(po.supplier).select('supplierName').lean();
    await notificationService.createNotification({
      title: kind === 'Full' ? 'PO cancellation needs your approval' : 'PO short close needs your approval',
      message: `${po.purchaseOrderNumber} — ${vendor?.supplierName || 'vendor'} — ${read.reasons.join(', ')}${read.note ? `: ${read.note}` : ''}`,
      type: 'purchase',
      targetRole: 'Company Admin',
      targetCompanyId: po.companyId,
      data: { purchaseId: String(po._id), poApproval: true },
    });
  } catch (err) {
    console.error('Notify Company Admin of PO cancellation request failed:', err);
  }
  return { kind, lines: lines.length };
}

// Reverses a ledger posting of this invoice, in proportion to the amount
// cancelled. Today the invoice is never posted (no unit has the accounts it
// looks for), so this normally finds nothing — but stays right if posting is
// switched on (ledger timing is tomorrow's Accounts work).
async function reverseInvoicePosting(invoice, cancelledAmount, { poNumber, user }) {
  if (!(cancelledAmount > 0)) return false;
  const originals = await Transaction.find({ relatedDocument: 'Purchase', relatedDocumentId: invoice._id, description: { $not: /^Reversal/ } });
  let reversed = false;
  for (const txn of originals) {
    const posted = (txn.entries || []).reduce((s, e) => s + (Number(e.credit) || 0), 0); // = the invoice total posted
    if (!(posted > 0)) continue;
    const factor = Math.min(1, cancelledAmount / posted);
    const entries = (txn.entries || []).map(e => ({ account: e.account, debit: round2((Number(e.credit) || 0) * factor), credit: round2((Number(e.debit) || 0) * factor) }));
    await new Transaction({
      transactionNumber: `TXN-REV-${Date.now()}-${Math.random().toString(36).slice(2, 11).toUpperCase()}`,
      description: `Reversal: PO ${poNumber} cancelled — ${txn.description}`,
      reference: txn.reference,
      totalAmount: round2((Number(txn.totalAmount) || 0) * factor),
      unit: txn.unit,
      relatedDocument: 'Purchase',
      relatedDocumentId: invoice._id,
      createdBy: user._id,
      companyId: txn.companyId,
      entries,
    }).save();
    // The posting added each entry's amount to its account's balance — take
    // the cancelled share back off.
    for (const e of txn.entries || []) {
      const amount = round2(((Number(e.debit) || 0) + (Number(e.credit) || 0)) * factor);
      if (amount) await Account.updateOne({ _id: e.account }, { $inc: { balance: -amount } });
    }
    reversed = true;
  }
  return reversed;
}

// The Company Admin approves. Returns { status, message } on refusal.
export async function applyCancellation(po, request, reviewer, remarks = '', req = null) {
  const prsById = await prsOfPurchase(po);
  const lines = cancellableLines(po, prsById);
  if (!lines.length) {
    return { status: 409, message: 'Everything on this PO was received while the cancellation waited — nothing is left to cancel. Reject this request.' };
  }
  const kind = cancelKind(po, lines);
  const full = kind === 'Full';
  const now = new Date();
  const settings = await getOrCreateSettings(po.companyId);
  const validityDays = settings.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
  const close = new Set((request.closeRequests || []).map(String));
  const reasonText = `${request.reasons.join(', ')}${request.note ? ` — ${request.note}` : ''}`;

  // 1. The lines.
  for (const l of lines) l.cancelled = { at: now, by: reviewer._id };

  // 2. Their requests: reopen on RFQ/PO, or close ("no longer needed").
  const reopenedByLine = new Map();
  for (const l of lines) {
    const reopened = [];
    for (const id of idsOfLine(l)) {
      const pr = prsById.get(id);
      if (!pr || pr.status === 'Received') continue;
      pr.purchaseOrder = null;
      if (close.has(id)) {
        pr.status = 'Rejected';
        pr.rejectedAt = now;
        pr.rejectionReason = `No longer needed — PO ${po.purchaseOrderNumber} cancelled: ${reasonText}`;
      } else {
        pr.status = 'Pending';
        reopened.push(pr);
      }
      await pr.save();
    }
    reopenedByLine.set(String(l._id), reopened);
  }

  // 3. The item cards — reopened (with the quotes still usable) or the
  //    requests join the card that's already open for that item + size.
  for (const l of lines) {
    const reopened = reopenedByLine.get(String(l._id)) || [];
    if (!l.itemQuoteGroup || !reopened.length) continue;
    const group = await ItemQuoteGroup.findById(l.itemQuoteGroup);
    if (!group) continue;
    const masterItem = await Item.findById(group.item).select('name purchaseUnit purchaseUnitType dimensionVariants fabricationRef').lean();
    const openCard = await ItemQuoteGroup.findOne({ companyId: group.companyId, unit: group.unit, item: group.item, sizeKey: group.sizeKey || '', status: 'Open' });
    if (openCard) {
      const ids = [...new Set([...openCard.purchaseRequests.map(String), ...reopened.map(pr => String(pr._id))])];
      const prs = await PurchaseRequest.find({ _id: { $in: ids } });
      const computed = await computeGroupQuantityFromPRs(prs, masterItem || {});
      openCard.purchaseRequests = ids;
      openCard.quantity = computed.quantity;
      Object.assign(openCard, sizeFieldsOf(computed));
      await openCard.save();
      continue;
    }
    const allBack = group.purchaseRequests.length === reopened.length
      && group.purchaseRequests.every(id => reopened.some(pr => String(pr._id) === String(id)));
    group.status = 'Open';
    if (!allBack) {
      const computed = await computeGroupQuantityFromPRs(reopened, masterItem || {});
      group.purchaseRequests = reopened.map(pr => pr._id);
      group.quantity = computed.quantity;
      Object.assign(group, sizeFieldsOf(computed));
    }
    try {
      await group.save();
    } catch (err) {
      if (err.code !== 11000) throw err; // another card opened at the same moment — the requests get picked up by RFQ/PO's auto-select
      continue;
    }
    const bids = await VendorBid.find({ group: group._id, status: { $in: ['Selected', 'Rejected'] } });
    for (const b of bids) {
      const next = bidAfterCancel(b, { side: request.side, isThisPO: String(b._id) === String(l.vendorBid), expired: isQuoteExpired(b, validityDays) });
      if (next !== b.status) await VendorBid.updateOne({ _id: b._id }, { status: next });
    }
  }

  // 4. The invoice — never deleted.
  // A PO bill (2026-10-12, purchaseBillService): the cancelled lines were
  // never received, so nothing of theirs was ever posted — no reversal. The
  // total keeps any QC-rejection removals; the advance follows the new total;
  // advance paid above what's still owed comes off the bill as money the
  // vendor holds, and Accounts decides: refund, or keep as credit.
  const invoice = await PurchaseInvoice.findOne({ purchaseOrder: po._id, companyId: po.companyId });
  let vendorCredit = 0;
  let invoiceNote = 'No invoice found for this PO.';
  const isBill = !!invoice && invoice.stage != null;
  if (invoice) {
    const remaining = (po.items || []).filter(it => !it.cancelled?.at);
    const after = invoiceAfterCancel(invoice, { full, remainingLines: remaining, po });
    if (isBill && !full) {
      const removed = (invoice.adjustments || []).filter(a => a.kind === 'Rejection').reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
      after.totalAmount = round2(after.totalAmount - removed);
      after.cancelledAmount = round2(round2(invoice.totalAmount) - after.totalAmount);
      after.vendorCredit = round2(Math.max(0, round2(invoice.paidAmount) - after.totalAmount));
    }
    vendorCredit = after.vendorCredit;
    if (full) {
      invoice.status = 'Cancelled';
    } else {
      invoice.items = after.items;
      invoice.subtotal = after.subtotal;
      invoice.gstAmount = after.gstAmount;
      invoice.totalAmount = after.totalAmount;
    }
    if (isBill) {
      invoice.adjustments.push({ kind: full ? 'Cancel' : 'ShortClose', amount: after.cancelledAmount, reason: reasonText, by: reviewer._id });
      if (!full) {
        const { advanceAmountOf } = await import('./purchaseBillService.js');
        invoice.advanceAmount = advanceAmountOf(invoice.totalAmount, invoice.advancePercent);
        if (vendorCredit > 0) {
          invoice.paidAmount = round2(invoice.paidAmount - vendorCredit);
          invoice.advancePaid = round2(Math.max(0, (Number(invoice.advancePaid) || 0) - vendorCredit));
        }
      }
    }
    invoice.notes = `${invoice.notes || ''}\n${full ? 'Cancelled' : `Reduced by ₹${after.cancelledAmount.toLocaleString('en-IN')} (short close)`} — PO ${po.purchaseOrderNumber}: ${reasonText}`.trim();
    await invoice.save();
    let reversed = false;
    if (!isBill) {
      try {
        reversed = await reverseInvoicePosting(invoice, after.cancelledAmount, { poNumber: po.purchaseOrderNumber, user: reviewer });
      } catch (err) {
        console.error('Ledger reversal for cancelled PO failed:', err);
      }
    }
    if (isBill && vendorCredit > 0) {
      const VendorMoneyBack = (await import('../models/VendorMoneyBack.js')).default;
      const vendor = await Supplier.findById(po.supplier).select('supplierName').lean();
      await VendorMoneyBack.create({
        companyId: po.companyId, unit: invoice.unit, vendor: po.supplier?._id || po.supplier, vendorName: vendor?.supplierName || '',
        purchaseOrder: po._id, poNumber: po.purchaseOrderNumber, source: 'Cancellation', amount: vendorCredit, status: 'To decide',
        note: reasonText,
      });
    }
    invoiceNote = `${invoice.invoiceNo} ${full ? 'cancelled' : `reduced by ₹${after.cancelledAmount.toLocaleString('en-IN')}`}${reversed ? '; ledger entry reversed' : ''}${vendorCredit > 0 ? (isBill ? `; ₹${vendorCredit.toLocaleString('en-IN')} of the advance is with the vendor — Accounts decides: refund or credit` : `; ₹${vendorCredit.toLocaleString('en-IN')} already paid is a vendor credit`) : ''}.`;
  }

  // 5. The PO.
  request.status = 'Approved';
  request.kind = kind;
  request.lines = lines.map(l => l._id);
  request.reviewedBy = reviewer._id;
  request.reviewedAt = now;
  request.remarks = remarks;
  request.vendorCredit = vendorCredit;
  request.invoiceNote = invoiceNote;
  if (full) {
    po.status = 'Cancelled';
  } else {
    const liveReceived = (po.items || []).filter(it => !it.cancelled?.at).every(it => lineReceived(it, prsById));
    if (liveReceived) po.status = 'Received';
  }
  await po.save();
  // A short close may leave only lines that are already in and QC-passed —
  // then the PO is fully accepted and its balance falls due.
  if (isBill && !full) {
    try {
      const { settleIfFullyAccepted } = await import('./purchaseAcceptanceService.js');
      await settleIfFullyAccepted(po, await PurchaseInvoice.findById(invoice._id), reviewer, req);
    } catch (err) {
      console.error('Full-acceptance check after a short close failed:', err.message);
    }
  }

  // 6. Tell the vendor (a failure never undoes the cancel).
  try {
    const vendor = await Supplier.findById(po.supplier).select('supplierName email').lean();
    if (vendor?.email) {
      const company = await Company.findById(po.companyId).select('name').lean();
      const sent = await sendPurchaseOrderCancellationEmail({
        to: vendor.email,
        vendorName: vendor.supplierName,
        companyName: company?.name || 'Samtek',
        poNumber: po.purchaseOrderNumber,
        full,
        lines: lines.map(l => ({ itemName: l.itemName, quantity: l.quantity, purchaseUnit: l.purchaseUnit })),
        reason: reasonText,
      });
      request.emailSent = !!sent.success;
      await po.save();
    }
  } catch (err) {
    console.error('PO cancellation email failed:', err);
  }

  try {
    await notificationService.createNotification({
      title: `PO ${po.purchaseOrderNumber} ${full ? 'cancelled' : 'short closed'}`,
      message: `The Company Admin approved the ${full ? 'cancellation' : 'short close'}${remarks ? ` — "${remarks}"` : ''}. ${invoiceNote}`,
      type: 'purchase',
      targetUserId: request.requestedBy,
      targetCompanyId: po.companyId,
      data: { purchaseId: String(po._id) },
    });
  } catch (err) {
    console.error('Notify requester of PO cancellation failed:', err);
  }
  await logPoEvent({
    po, user: reviewer, req,
    action: full ? 'cancelled' : 'short_closed',
    summary: `${full ? 'Cancelled' : `Short closed — ${lines.map(l => l.itemName).join(', ')} cancelled`} (approved by the Company Admin${remarks ? `: "${remarks}"` : ''}). ${invoiceNote}${request.emailSent ? ' Vendor emailed.' : ' Vendor NOT emailed.'}`,
    details: { kind, lines: lines.map(l => l.itemName), reasons: request.reasons, side: request.side, remarks, invoiceNote, vendorCredit, emailSent: !!request.emailSent, ...(vendorCredit > 0 ? { vendorCreditText: inr(vendorCredit) } : {}) },
  });
  return { kind, lines: lines.length, vendorCredit, invoiceNote, emailSent: request.emailSent };
}

export async function rejectCancellation(po, request, reviewer, remarks, req = null) {
  request.status = 'Rejected';
  request.reviewedBy = reviewer._id;
  request.reviewedAt = new Date();
  request.remarks = remarks;
  await po.save();
  await logPoEvent({
    po, user: reviewer, req, action: 'cancel_refused',
    summary: `Cancellation refused by the Company Admin — "${remarks}". The PO stays as it is.`,
    details: { remarks, reasons: request.reasons },
  });
  try {
    await notificationService.createNotification({
      title: `Cancellation of PO ${po.purchaseOrderNumber} refused`,
      message: `The Company Admin kept the PO: ${remarks}`,
      type: 'purchase',
      targetUserId: request.requestedBy,
      targetCompanyId: po.companyId,
      data: { purchaseId: String(po._id) },
    });
  } catch (err) {
    console.error('Notify requester of refused PO cancellation failed:', err);
  }
}

