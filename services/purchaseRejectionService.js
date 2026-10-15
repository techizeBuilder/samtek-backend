// QC rejections of purchased material and what the vendor agreed to
// (procurement-v2, accounts Slice 3, 2026-10-12 — client's five cases;
// docs/procurement-v2/accounts-bill-ledger-payments-2026-10.md §3.5).
//
//   QC fails a purchase job (part or all)  → a PurchaseRejection, "Awaiting
//   vendor answer"; the PO's creator is told. Nothing goes to the vendor.
//   Purchase records the answer:
//     replace — bill unchanged; a replacement request on the same PO line,
//               expected on the vendor's date; Store receives it, QC again
//     refused — off the bill; the advance paid on it → Purchase Loss; the
//               vendor's rating gets a dispute and they go on Watchlist
//     refund  — off the bill; the advance paid on it is owed back
//     credit  — off the bill; the advance paid on it stays with the vendor
//               as credit for a later payment
//   A cancellation's leftover advance ("To decide") is settled the same way
//   by Accounts: refund or credit.
import mongoose from 'mongoose';
import PurchaseRejection from '../models/PurchaseRejection.js';
import VendorMoneyBack from '../models/VendorMoneyBack.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import { Account } from '../models/Account.js';
import { postEntry } from './purchaseLedgerService.js';
import { advanceAmountOf, poPaymentStatus } from './purchaseBillService.js';
import { jobContext, partMoney, jobTotalQty, settleIfFullyAccepted, prIdsOfLine } from './purchaseAcceptanceService.js';
import { logPoEvent, inr } from './purchaseAuditService.js';
import { readRevisedDate, fmtDay } from './deliveryFollowUpService.js';
import notificationService from './notificationService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const OPEN_REJECTION_STATUSES = ['Awaiting vendor answer', 'Replacement expected'];
export const OUTCOME_LABELS = {
  replace: 'Vendor will replace it',
  refused: 'Vendor refused to replace or refund',
  refund: 'Vendor takes it back and refunds',
  credit: 'Vendor takes it back and gives credit',
};

// ── Pure ──────────────────────────────────────────────────────────────────

// Purchase's answer. Returns { error } or { outcome, note, expectedDate }.
export function readAnswer(body, now = new Date()) {
  const outcome = ['replace', 'refused', 'refund', 'credit'].includes(body?.outcome) ? body.outcome : null;
  if (!outcome) return { error: 'Choose what the vendor agreed to.' };
  const note = String(body?.note || '').trim();
  if (outcome === 'replace') {
    const d = readRevisedDate({ date: body?.expectedDate, reason: 'replacement' }, now);
    if (d.error) return { error: d.error === 'Pick the new expected date.' ? 'Enter the date the vendor will send the replacement.' : d.error };
    return { outcome, note, expectedDate: d.date };
  }
  if (outcome === 'refused' && !note) return { error: 'Add a note on what the vendor said — it counts against their score.' };
  return { outcome, note, expectedDate: null };
}

// The advance already paid on a part of the bill worth `value`: the
// advance % of it, scaled by how much of the advance has been paid.
export function advanceShareOf(bill, value) {
  const pct = Math.min(100, Math.max(0, Number(bill?.advancePercent) || 0));
  const amount = Number(bill?.advanceAmount) || 0;
  if (!(pct > 0) || !(amount > 0)) return 0;
  const paidRatio = Math.min(1, Math.max(0, (Number(bill.advancePaid) || 0) / amount));
  return round2((Number(value) || 0) * pct / 100 * paidRatio);
}

// The bill after `value` comes off it, with `share` of its advance moving
// to a refund / credit / write-off.
export function billAfterRemoval(bill, value, share) {
  const totalAmount = round2(Math.max(0, (Number(bill.totalAmount) || 0) - value));
  return {
    totalAmount,
    advanceAmount: advanceAmountOf(totalAmount, bill.advancePercent),
    advancePaid: round2(Math.max(0, (Number(bill.advancePaid) || 0) - share)),
    paidAmount: round2(Math.max(0, (Number(bill.paidAmount) || 0) - share)),
  };
}

// ── DB ────────────────────────────────────────────────────────────────────

async function nextRequestId() {
  const PurchaseRequest = mongoose.model('PurchaseRequest');
  const count = await PurchaseRequest.countDocuments({});
  for (let i = 0; i < 20; i++) {
    const id = `PR${String(count + 1 + i).padStart(3, '0')}`;
    if (!(await PurchaseRequest.exists({ requestId: id }))) return id;
  }
  return `PR-${Date.now().toString().slice(-6)}`;
}

// QC just failed `qty` of a purchase job (job already saved). Never throws.
export async function onMaterialRejected(job, qty, user = null, req = null) {
  try {
    if (!job || job.source !== 'Purchase') return null;
    const ctx = await jobContext(job);
    if (!ctx) return null; // not on a PO (e.g. a manual QC inward) — nothing to settle
    const { po, line, pr, parent } = ctx;
    const rejectedQty = Number(qty) || 0;
    if (!(rejectedQty > 0)) return null;
    // The job as saved: what's still in it (all of it on a full fail) +
    // every slice rejected so far (a partial one included).
    const total = jobTotalQty(job, job.quantity);
    const money = partMoney(ctx, rejectedQty, total || rejectedQty);

    const doc = {
      companyId: po.companyId,
      unit: po.unit || null,
      purchaseOrder: po._id,
      poNumber: po.purchaseOrderNumber,
      lineId: line._id,
      purchaseRequest: pr._id,
      qcJob: job._id,
      qcJobRef: job.qcJobId || '',
      vendor: po.supplier?._id || po.supplier,
      vendorName: po.supplier?.supplierName || '',
      itemName: line.itemName,
      rejectedQty,
      qtyUnit: job.unit || '',
      reason: job.failReason || '',
      severity: ['Minor', 'Major', 'Critical'].includes(job.failSeverity) ? job.failSeverity : 'Major',
      value: money.value,
      net: money.net,
      gst: money.gst,
      replacementOf: parent?._id || null,
    };
    // Numbered REJ-0001…; two rejections at the same moment can pick the
    // same number — the unique index refuses the second, so it takes the next.
    let rejection = null;
    for (let i = 0; i < 5 && !rejection; i++) {
      try {
        const n = await PurchaseRejection.countDocuments({ companyId: po.companyId });
        rejection = await PurchaseRejection.create({ ...doc, number: `REJ-${String(n + 1 + i).padStart(4, '0')}` });
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }
    if (!rejection) throw new Error('could not number the rejection');
    // A replacement that failed: the rejection it answered is closed; this
    // new one carries on.
    if (parent && parent.status === 'Replacement expected') {
      parent.status = 'Replaced';
      await parent.save();
    }

    await logPoEvent({
      po, user, req, action: 'qc_rejected',
      summary: `QC rejected ${rejectedQty} ${job.unit || ''} of ${line.itemName}${parent ? ' (the replacement)' : ''} — ${job.failReason || 'no reason given'} (${inr(money.value)}). Waiting for the vendor's answer (${rejection.number}).`.replace(/\s+/g, ' '),
      details: { rejection: String(rejection._id), number: rejection.number, qty: rejectedQty, value: money.value, reason: job.failReason },
    });
    try {
      if (po.createdBy) {
        await notificationService.createNotification({
          title: 'QC rejected purchased material',
          message: `${po.purchaseOrderNumber} (${rejection.vendorName}): ${rejectedQty} ${job.unit || ''} of ${line.itemName} rejected — ${job.failReason || 'no reason given'}. Ask the vendor and record their answer (${rejection.number}).`.replace(/\s+/g, ' '),
          type: 'purchase',
          targetUserId: po.createdBy,
          targetCompanyId: po.companyId,
          data: { purchaseId: String(po._id), rejectionId: String(rejection._id) },
        });
      }
    } catch (err) {
      console.error('Notify Purchase of a QC rejection failed:', err.message);
    }
    return rejection;
  } catch (err) {
    console.error('Recording a QC rejection of purchased material failed:', err.message);
    return null;
  }
}

// Purchase records what the vendor agreed to. Returns { status, message } on
// a refusal, or { rejection }.
export async function recordAnswer({ rejectionId, body, user, req = null }) {
  const rejection = await PurchaseRejection.findOne({ _id: rejectionId, companyId: user.companyId });
  if (!rejection) return { status: 404, message: 'Rejection not found.' };
  const read = readAnswer(body);
  if (read.error) return { status: 400, message: read.error };
  const Purchase = mongoose.model('Purchase');
  const PurchaseRequest = mongoose.model('PurchaseRequest');

  // The vendor said they'd replace it but never sent it: the answer can
  // change (not to "replace" again) while the replacement hasn't arrived.
  let changedFromReplace = false;
  if (rejection.status === 'Replacement expected') {
    const rep = rejection.replacement?.purchaseRequest ? await PurchaseRequest.findById(rejection.replacement.purchaseRequest) : null;
    if (read.outcome === 'replace') return { status: 409, message: 'A replacement is already expected — change the date on the PO line if the vendor gave a new one.' };
    if (rep && rep.status === 'Received') return { status: 409, message: 'The replacement has arrived — it goes through QC like any delivery.' };
    changedFromReplace = true;
  } else if (rejection.status !== 'Awaiting vendor answer') {
    return { status: 409, message: `The vendor's answer is already recorded (${rejection.status}).` };
  }

  const po = await Purchase.findOne({ _id: rejection.purchaseOrder, companyId: user.companyId }).populate('supplier', 'supplierName');
  if (!po) return { status: 404, message: 'The PO behind this rejection wasn\'t found.' };
  if (po.status === 'Cancelled') return { status: 409, message: 'This PO was cancelled.' };
  if (changedFromReplace) {
    // Withdraw the replacement request from the line (kept, marked).
    const repId = String(rejection.replacement.purchaseRequest);
    const line = po.items.id(rejection.lineId);
    if (line) line.purchaseRequests = prIdsOfLine(line).filter(id => id !== repId);
    po.purchaseRequests = (po.purchaseRequests || []).map(String).filter(id => id !== repId);
    await po.save();
    await PurchaseRequest.updateOne({ _id: repId }, { status: 'Rejected', rejectedAt: new Date(), rejectionReason: `Replacement not sent — ${rejection.number}: ${read.outcome}` });
  }
  const bill = await PurchaseInvoice.findOne({ purchaseOrder: po._id, companyId: po.companyId });
  const byName = user?.fullName || user?.username || '';
  let text = '';

  if (read.outcome === 'replace') {
    const line = po.items.id(rejection.lineId);
    if (!line || line.cancelled?.at) return { status: 409, message: 'That PO line was cancelled — a replacement can\'t come on it.' };
    const orig = await PurchaseRequest.findById(rejection.purchaseRequest).lean();
    if (!orig) return { status: 404, message: 'The original request wasn\'t found.' };
    // The replacement, in the original request's own units: the rejected
    // part of it (QC counts in the stock unit; the request also carries the
    // purchase unit).
    const fab = (orig.fabricationDimensionLines || []).length > 0;
    const factor = Number(orig.conversionFactor) > 0 ? Number(orig.conversionFactor) : null;
    const replacement = await PurchaseRequest.create({
      requestId: await nextRequestId(),
      productName: orig.productName,
      itemId: orig.itemId,
      materialCode: orig.materialCode,
      quantity: rejection.rejectedQty,
      unit: orig.unit,
      requestFromDepartment: 'QC',
      source: 'QC',
      storeApproved: true,
      status: 'Ordered',
      companyId: orig.companyId,
      storeOrderId: orig.storeOrderId || null,
      saleItemId: orig.saleItemId || null,
      purchaseOrder: po._id,
      purchaseUnit: orig.purchaseUnit || null,
      purchaseUnitType: orig.purchaseUnitType || null,
      purchaseQuantity: orig.purchaseUnit && factor ? round2(rejection.rejectedQty * factor) : (orig.purchaseUnit ? rejection.rejectedQty : null),
      conversionFactor: orig.conversionFactor || null,
      warrantyMonths: orig.warrantyMonths || 0,
      fabricationDimensionLines: fab ? [{ ...orig.fabricationDimensionLines[0], quantity: rejection.rejectedQty }] : [],
      replacementFor: rejection._id,
      notes: `Replacement for ${rejection.number} (${rejection.reason || 'QC rejected'}) — ${po.purchaseOrderNumber}`,
    });
    // On the same line, so Store receives it there; the line's date moves to
    // the vendor's date (kept in its history — the vendor's score still uses
    // the original promise).
    line.purchaseRequests = [...prIdsOfLine(line), String(replacement._id)];
    po.purchaseRequests = [...(po.purchaseRequests || []).map(String), String(replacement._id)];
    const from = line.expectedDeliveryDate || po.expectedDeliveryDate || null;
    line.deliveryDateHistory.push({ from, to: read.expectedDate, reason: `Replacement for ${rejection.number}`, by: user?._id || null, byName, at: new Date() });
    line.expectedDeliveryDate = read.expectedDate;
    line.overdueNotifiedFor = null;
    const live = po.items.filter(l => !l.cancelled?.at).map(l => l.expectedDeliveryDate).filter(Boolean).map(d => new Date(d).getTime());
    if (live.length) po.expectedDeliveryDate = new Date(Math.max(...live));
    if (po.status === 'Received') po.status = 'Partially Received';
    await po.save();
    rejection.status = 'Replacement expected';
    rejection.replacement = { purchaseRequest: replacement._id, expectedDate: read.expectedDate };
    text = `${OUTCOME_LABELS.replace} by ${fmtDay(read.expectedDate)} (${replacement.requestId}).`;
    try {
      await notificationService.notifyRoles(['Store Head', 'Store Employee'], {
        title: 'Replacement expected',
        message: `${po.purchaseOrderNumber} (${po.supplier?.supplierName || 'vendor'}): ${rejection.rejectedQty} ${rejection.qtyUnit} of ${rejection.itemName} replacing QC-rejected material — expected ${fmtDay(read.expectedDate)}. Receive it on the same PO line.`.replace(/\s+/g, ' '),
        type: 'purchase',
        targetCompanyId: po.companyId,
        data: { purchaseId: String(po._id), rejectionId: String(rejection._id) },
      });
    } catch (err) {
      console.error('Notify Store of a replacement failed:', err.message);
    }
  } else {
    // Off the bill.
    let share = 0;
    if (bill && bill.status !== 'Cancelled') {
      share = advanceShareOf(bill, rejection.value);
      const after = billAfterRemoval(bill, rejection.value, share);
      Object.assign(bill, after);
      bill.adjustments.push({ kind: 'Rejection', amount: rejection.value, reason: `${rejection.number}: ${rejection.rejectedQty} ${rejection.qtyUnit} ${rejection.itemName} — ${OUTCOME_LABELS[read.outcome]}`, ref: rejection._id, by: user?._id || null });
      await bill.save();
      await mongoose.model('Purchase').updateOne({ _id: po._id }, { paymentStatus: poPaymentStatus(bill) });
    }
    rejection.advanceShare = share;
    if (share > 0) {
      const mode = read.outcome === 'refused' ? 'WrittenOff' : read.outcome === 'refund' ? 'Refund' : 'Credit';
      const mb = await VendorMoneyBack.create({
        companyId: po.companyId,
        unit: bill.unit,
        vendor: rejection.vendor,
        vendorName: rejection.vendorName,
        purchaseOrder: po._id,
        poNumber: po.purchaseOrderNumber,
        source: 'Rejection',
        rejection: rejection._id,
        amount: share,
        mode,
        status: mode === 'WrittenOff' ? 'Written off' : mode === 'Refund' ? 'Refund due' : 'Credit available',
        decidedBy: user?._id || null,
        decidedAt: new Date(),
        note: read.note,
      });
      rejection.moneyBack = mb._id;
      if (mode !== 'Credit') {
        try {
          await postEntry({
            companyId: po.companyId, unit: bill.unit,
            lines: [{ key: mode === 'WrittenOff' ? 'purchase_loss' : 'vendor_refund_due', debit: share }, { key: 'advance_to_vendors', credit: share }],
            description: `${rejection.number} (${po.purchaseOrderNumber}): advance paid on rejected ${rejection.itemName} ${mode === 'WrittenOff' ? 'written off — vendor refused' : 'to be refunded by the vendor'}`,
            reference: po.purchaseOrderNumber, relatedDocument: 'PurchaseReturn', relatedDocumentId: rejection._id,
            user, prefix: mode === 'WrittenOff' ? 'LOSS' : 'RFD',
          });
        } catch (err) {
          console.error('Ledger posting for a rejection answer failed:', err.message);
        }
      }
    }
    rejection.status = read.outcome === 'refused' ? (share > 0 ? 'Written off' : 'Taken off the bill')
      : read.outcome === 'refund' ? (share > 0 ? 'Refund due' : 'Taken off the bill')
        : (share > 0 ? 'Credited' : 'Taken off the bill');
    text = `${OUTCOME_LABELS[read.outcome]} — ${inr(rejection.value)} taken off the bill${share > 0 ? `; ${inr(share)} of the advance ${read.outcome === 'refused' ? 'written off' : read.outcome === 'refund' ? 'to be refunded' : 'kept as vendor credit'}` : ''}.`;
  }

  rejection.outcome = read.outcome;
  rejection.note = changedFromReplace ? `Replacement not sent. ${read.note}`.trim() : read.note;
  rejection.recordedBy = user?._id || null;
  rejection.recordedByName = byName;
  rejection.recordedAt = new Date();
  await rejection.save();

  await logPoEvent({
    po, user, req, action: 'rejection_recorded',
    summary: `${rejection.number} — ${rejection.rejectedQty} ${rejection.qtyUnit} ${rejection.itemName}: ${text}${read.note ? ` Note: ${read.note}` : ''}`.replace(/\s+/g, ' '),
    details: { rejection: String(rejection._id), outcome: read.outcome, value: rejection.value, advanceShare: rejection.advanceShare, expectedDate: read.expectedDate },
  });

  // An answered rejection may be the last thing the PO was waiting for.
  if (bill && read.outcome !== 'replace') {
    const fresh = await PurchaseInvoice.findById(bill._id);
    await settleIfFullyAccepted(po, fresh, user, req);
  }
  return { rejection };
}

// Accounts: the vendor's refund arrived. Returns { status, message } or { moneyBack }.
export async function recordRefundReceived({ id, body, user, req = null }) {
  const mb = await VendorMoneyBack.findOne({ _id: id, companyId: user.companyId });
  if (!mb) return { status: 404, message: 'Not found.' };
  if (mb.status !== 'Refund due') return { status: 409, message: `This isn't waiting for a refund (${mb.status}).` };
  const account = await Account.findOne({ _id: body?.accountId, isBankOrCash: true });
  if (!account) return { status: 400, message: 'Choose the bank or cash account the refund came into.' };
  const receivedAt = body?.receivedAt ? new Date(body.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime()) || receivedAt > new Date(Date.now() + 86400000)) return { status: 400, message: 'Enter a valid date, not in the future.' };
  const reference = String(body?.reference || '').trim();

  mb.status = 'Refunded';
  mb.refund = { receivedAt, account: account._id, reference, by: user._id };
  await mb.save();
  try {
    await postEntry({
      companyId: mb.companyId, unit: mb.unit || account.unit,
      lines: [{ account, debit: mb.amount }, { key: 'vendor_refund_due', credit: mb.amount }],
      description: `Refund received from ${mb.vendorName} — ${mb.poNumber}${reference ? ` (Ref: ${reference})` : ''}`,
      reference: mb.poNumber, relatedDocument: 'Receipt', relatedDocumentId: mb._id,
      mode: 'Bank Transfer', date: receivedAt, user, prefix: 'RFR',
    });
  } catch (err) {
    console.error('Ledger posting for a vendor refund failed:', err.message);
  }
  if (mb.rejection) await PurchaseRejection.updateOne({ _id: mb.rejection, status: 'Refund due' }, { status: 'Refunded' });
  if (mb.purchaseOrder) {
    const po = await mongoose.model('Purchase').findById(mb.purchaseOrder).populate('supplier', 'supplierName');
    if (po) await logPoEvent({ po, user, req, action: 'refund_received', summary: `Refund of ${inr(mb.amount)} received from the vendor${reference ? ` (${reference})` : ''} into ${account.accountName}.`, details: { moneyBack: String(mb._id), amount: mb.amount } });
  }
  return { moneyBack: mb };
}

// Accounts: a cancellation's leftover advance — refund or keep as credit.
export async function decideMoneyBack({ id, body, user, req = null }) {
  const mb = await VendorMoneyBack.findOne({ _id: id, companyId: user.companyId });
  if (!mb) return { status: 404, message: 'Not found.' };
  if (mb.status !== 'To decide') return { status: 409, message: `Already decided (${mb.status}).` };
  const mode = body?.mode === 'Refund' ? 'Refund' : body?.mode === 'Credit' ? 'Credit' : null;
  if (!mode) return { status: 400, message: 'Choose: the vendor refunds it, or keeps it as credit.' };
  mb.mode = mode;
  mb.status = mode === 'Refund' ? 'Refund due' : 'Credit available';
  mb.decidedBy = user._id;
  mb.decidedAt = new Date();
  mb.note = String(body?.note || '').trim();
  await mb.save();
  if (mode === 'Refund') {
    try {
      await postEntry({
        companyId: mb.companyId, unit: mb.unit,
        lines: [{ key: 'vendor_refund_due', debit: mb.amount }, { key: 'advance_to_vendors', credit: mb.amount }],
        description: `${mb.poNumber} cancelled: ${mb.vendorName} to refund the advance ${inr(mb.amount)}`,
        reference: mb.poNumber, relatedDocument: 'PurchaseReturn', relatedDocumentId: mb._id, user, prefix: 'RFD',
      });
    } catch (err) {
      console.error('Ledger posting for a refund decision failed:', err.message);
    }
  }
  return { moneyBack: mb };
}

// Credit a vendor holds of ours that can still be taken off a payment.
export async function vendorCreditAvailable(companyId, vendorId) {
  const rows = await VendorMoneyBack.find({ companyId, vendor: vendorId, status: 'Credit available' }).select('amount used').lean();
  return round2(rows.reduce((s, r) => s + Math.max(0, (Number(r.amount) || 0) - (Number(r.used) || 0)), 0));
}

// Takes `amount` of a vendor's credit, oldest first (for payBill). Returns the uses.
export async function consumeVendorCredit({ companyId, vendorId, amount, payment, purchaseOrder }) {
  let left = round2(amount);
  const rows = await VendorMoneyBack.find({ companyId, vendor: vendorId, status: 'Credit available' }).sort({ createdAt: 1 });
  for (const r of rows) {
    if (left <= 0) break;
    const free = round2((Number(r.amount) || 0) - (Number(r.used) || 0));
    if (!(free > 0)) continue;
    const take = Math.min(free, left);
    r.used = round2((Number(r.used) || 0) + take);
    r.uses.push({ payment, purchaseOrder, amount: take, at: new Date() });
    if (r.used + 0.005 >= r.amount) r.status = 'Credit used';
    await r.save();
    left = round2(left - take);
  }
  return round2(amount - left);
}
