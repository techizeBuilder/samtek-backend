// Material accepted → money payable (procurement-v2, accounts Slice 2,
// 2026-10-12; docs/procurement-v2/accounts-bill-ledger-payments-2026-10.md).
//
// Every received purchase request goes to QC, and stock only goes up on a
// QC Pass — so "accepted" means QC passed. Each pass makes that material
// payable on the PO's bill:
//   value = the request's share of its PO line × the part of it QC passed
// (the same share Store's receive used to split the line — pieces for
// fabrication, else the ordered quantity), posted
//   Dr Purchase + Input GST / Cr Accounts Payable.
// When every live line is received and QC-passed, the PO is fully accepted:
// the full payment falls due (that day + the PO's credit days; blank / 0 =
// straight away), the PO's charges are posted, and the advance is set off
//   Dr Accounts Payable / Cr Advance to Vendors.
import mongoose from 'mongoose';
import '../models/PurchaseRejection.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import { postEntry, gstLines } from './purchaseLedgerService.js';
import { fullDueDate, poPaymentStatus } from './purchaseBillService.js';
import { logPoEvent, inr } from './purchaseAuditService.js';
import { fmtDay } from './deliveryFollowUpService.js';
import notificationService from './notificationService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const prIdsOfLine = (line) => (line?.purchaseRequests?.length ? line.purchaseRequests : (line?.purchaseRequest ? [line.purchaseRequest] : [])).map(id => String(id?._id || id));

// ── Pure ──────────────────────────────────────────────────────────────────

// How much of its line a request stands for — the same weight Store's
// receive splits the line by (receiveLineItems / receiveLineFabrication).
export function prShareWeight(pr) {
  const pieces = (pr?.fabricationDimensionLines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  if (pieces > 0) return pieces;
  return Number(pr?.purchaseQuantity) || Number(pr?.quantity) || 0;
}

// A line's money: before GST (goods + any old item charges) and its GST.
// A line whose rate already includes GST has no separate GST.
export function lineMoney(line) {
  const goods = Number(line?.totalPrice) || round2((Number(line?.quantity) || 0) * (Number(line?.unitPrice) || 0));
  const net = round2(goods + (Number(line?.itemChargesTotal) || 0));
  const gst = round2(Number(line?.gstAmount) || 0);
  return { net, gst, total: round2(net + gst) };
}

// What one QC pass is worth. `prs` = every request on the line; `pr` = the
// one whose job passed; `acceptedQty` of `jobTotalQty` (passed + anything
// QC rejected earlier on that job).
export function acceptedMoney({ line, prs, pr, acceptedQty, jobTotalQty }) {
  const weights = (prs || []).map(prShareWeight);
  const sum = weights.reduce((s, w) => s + w, 0);
  const share = sum > 0 ? prShareWeight(pr) / sum : 1 / Math.max(1, (prs || []).length);
  const fraction = Number(jobTotalQty) > 0 ? Math.min(1, Math.max(0, Number(acceptedQty) / Number(jobTotalQty))) : 0;
  const { net, gst } = lineMoney(line);
  const n = round2(net * share * fraction);
  const g = round2(gst * share * fraction);
  return { net: n, gst: g, value: round2(n + g), share, fraction };
}

// The whole PO is accepted when every request on every live line has been
// received and QC has decided it, and no QC rejection on the PO is still
// waiting for the vendor's answer or for its replacement (Slice 3). A
// replacement request sits on the same line, so it has to arrive and pass
// QC too.
export function isFullyAccepted({ lines, prsById, jobsByPr, openRejections = 0 }) {
  if (openRejections > 0) return false;
  const live = (lines || []).filter(l => !l.cancelled?.at);
  if (!live.length) return false;
  for (const line of live) {
    const ids = prIdsOfLine(line);
    if (!ids.length) return false;
    for (const id of ids) {
      const pr = prsById.get(id);
      if (!pr || pr.status !== 'Received') return false;
      const job = jobsByPr.get(id);
      if (!job || !['Approved', 'Rejected'].includes(job.status)) return false;
    }
  }
  return true;
}

// ── DB ────────────────────────────────────────────────────────────────────

const accountsAudience = (po) => ({ targetCompanyId: po.companyId });

// Everything needed to price part of a purchase QC job: its request, PO,
// line, the line's own requests (replacements left out of the shares), the
// bill, and — for a replacement request — the rejection it replaces (whose
// value it carries). null when the job isn't on a PO.
export async function jobContext(job) {
  if (!job?.purchaseRequestId) return null;
  const PurchaseRequest = mongoose.model('PurchaseRequest');
  const Purchase = mongoose.model('Purchase');
  const pr = await PurchaseRequest.findById(job.purchaseRequestId).lean();
  if (!pr?.purchaseOrder) return null;
  const po = await Purchase.findOne({ _id: pr.purchaseOrder, companyId: job.company }).populate('supplier', 'supplierName');
  if (!po) return null;
  const line = (po.items || []).find(l => prIdsOfLine(l).includes(String(pr._id)));
  if (!line) return null;
  const linePrs = await PurchaseRequest.find({ _id: { $in: prIdsOfLine(line) } }).lean();
  const basePrs = linePrs.filter(p => !p.replacementFor);
  const parent = pr.replacementFor ? await mongoose.model('PurchaseRejection').findById(pr.replacementFor) : null;
  const bill = await PurchaseInvoice.findOne({ purchaseOrder: po._id, companyId: po.companyId });
  return { pr, po, line, basePrs, parent, bill };
}

// The money for `qty` out of `jobTotal` of a job's request.
export function partMoney(ctx, qty, jobTotal) {
  const fraction = Number(jobTotal) > 0 ? Math.min(1, Math.max(0, Number(qty) / Number(jobTotal))) : 0;
  if (ctx.parent) {
    const net = round2((Number(ctx.parent.net) || 0) * fraction);
    const gst = round2((Number(ctx.parent.gst) || 0) * fraction);
    return { net, gst, value: round2(net + gst), share: 1, fraction };
  }
  return acceptedMoney({ line: ctx.line, prs: ctx.basePrs, pr: ctx.pr, acceptedQty: qty, jobTotalQty: jobTotal });
}

// Total quantity a job started with (what's left + anything rejected along the way).
export const jobTotalQty = (job, remaining) => (Number(remaining) || 0) + (job.partialRejections || []).reduce((s, r) => s + (Number(r.qty) || 0), 0);

// Called once QC has passed a Purchase job (qcController.submitDecision,
// after the job is saved). Never throws — a money hiccup must not undo a QC
// decision; it's logged.
export async function onMaterialAccepted(job, user = null, req = null) {
  try {
    if (!job || job.source !== 'Purchase' || !job.purchaseRequestId) return null;
    const QCJob = mongoose.model('QCJob');
    const fresh = await QCJob.findById(job._id).select('acceptance acceptedQty quantity partialRejections status').lean();
    if (!fresh || fresh.status !== 'Approved' || fresh.acceptance?.postedAt) return null; // posted already

    const ctx = await jobContext(job);
    if (!ctx) return null;
    const { po, line, bill, parent } = ctx;

    const acceptedQty = Number(fresh.acceptedQty ?? fresh.quantity) || 0;
    const money = partMoney(ctx, acceptedQty, jobTotalQty(fresh, acceptedQty));

    // A replacement that came in: the rejection it answered is settled.
    if (parent && parent.status === 'Replacement expected') {
      parent.status = 'Replaced';
      await parent.save();
    }
    // Mark the job first, so a retry can never post twice.
    const marked = await QCJob.updateOne(
      { _id: job._id, 'acceptance.postedAt': null },
      { $set: { 'acceptance.value': bill && bill.status !== 'Cancelled' ? money.value : 0, 'acceptance.postedAt': new Date() } }
    );
    if (!marked.modifiedCount) return null;
    if (!bill || bill.status === 'Cancelled' || !(money.value > 0)) return { money, bill: null };

    bill.acceptedValue = round2((Number(bill.acceptedValue) || 0) + money.value);
    await bill.save();
    await postEntry({
      companyId: po.companyId,
      unit: bill.unit,
      lines: [
        { key: 'purchase', debit: money.net },
        ...gstLines(money.gst, po.gstSplit?.type),
        { key: 'accounts_payable', credit: money.value },
      ],
      description: `QC passed${parent ? ' (replacement)' : ''}: ${line.itemName}${acceptedQty ? ` × ${acceptedQty}` : ''} — ${po.purchaseOrderNumber} (${po.supplier?.supplierName || 'vendor'})`,
      reference: po.purchaseOrderNumber,
      relatedDocument: 'Purchase',
      relatedDocumentId: bill._id,
      user: user || po.createdBy,
      prefix: 'ACC',
    });

    const full = await settleIfFullyAccepted(po, bill, user, req);
    return { money, bill, fullyAccepted: !!full };
  } catch (err) {
    console.error('Purchase acceptance (QC pass → bill) failed:', err.message);
    return null;
  }
}

// If every live line is now received and QC-passed: the full payment falls
// due, the charges are posted, the advance is set off. Returns the bill, or
// null when not (yet) fully accepted. Safe to call again.
export async function settleIfFullyAccepted(po, bill, user = null, req = null) {
  if (!bill || bill.fullyAcceptedAt || bill.status === 'Cancelled') return null;
  const PurchaseRequest = mongoose.model('PurchaseRequest');
  const QCJob = mongoose.model('QCJob');
  const live = (po.items || []).filter(l => !l.cancelled?.at);
  const ids = [...new Set(live.flatMap(prIdsOfLine))];
  const prs = await PurchaseRequest.find({ _id: { $in: ids } }).select('status').lean();
  const jobs = await QCJob.find({ source: 'Purchase', purchaseRequestId: { $in: ids }, company: po.companyId })
    .select('purchaseRequestId status partialRejections').lean();
  const prsById = new Map(prs.map(p => [String(p._id), p]));
  const jobsByPr = new Map(jobs.map(j => [String(j.purchaseRequestId), j]));
  const openRejections = await mongoose.model('PurchaseRejection').countDocuments({ purchaseOrder: po._id, status: { $in: ['Awaiting vendor answer', 'Replacement expected'] } });
  if (!isFullyAccepted({ lines: po.items, prsById, jobsByPr, openRejections })) return null;

  // Claim it (one caller wins if two passes land together).
  const now = new Date();
  const claimed = await PurchaseInvoice.updateOne({ _id: bill._id, fullyAcceptedAt: null }, { $set: { fullyAcceptedAt: now } });
  if (!claimed.modifiedCount) return null;
  const doc = await PurchaseInvoice.findById(bill._id);

  // What's left of the bill after the passes posted so far: the PO's
  // charges (+ their GST), plus any rounding — so Payable ends up exactly
  // the bill's total.
  const rest = round2((Number(doc.totalAmount) || 0) - (Number(doc.acceptedValue) || 0));
  const restGst = Math.min(Math.max(0, rest), round2(po.chargesGstTotal || 0));
  const restNet = round2(rest - restGst);
  doc.acceptedValue = round2(doc.totalAmount);
  doc.dueDate = fullDueDate(now, doc.creditDays);
  await doc.save();

  const vendorName = po.supplier?.supplierName || 'vendor';
  try {
    if (Math.abs(rest) >= 0.01) {
      await postEntry({
        companyId: po.companyId, unit: doc.unit,
        lines: rest > 0
          ? [{ key: 'purchase', debit: restNet }, ...gstLines(restGst, po.gstSplit?.type), { key: 'accounts_payable', credit: rest }]
          : [{ key: 'accounts_payable', debit: -rest }, { key: 'purchase', credit: -rest }],
        description: `${po.purchaseOrderNumber} fully accepted — charges${Math.abs(rest - (Number(po.chargesTotal || 0) + Number(po.poChargesTotal || 0) + Number(po.chargesGstTotal || 0))) >= 0.01 ? ' and rounding' : ''} (${vendorName})`,
        reference: po.purchaseOrderNumber, relatedDocument: 'Purchase', relatedDocumentId: doc._id,
        user: user || po.createdBy, prefix: 'ACC',
      });
    }
    const setOff = round2(doc.advancePaid);
    if (setOff > 0) {
      await postEntry({
        companyId: po.companyId, unit: doc.unit,
        lines: [{ key: 'accounts_payable', debit: setOff }, { key: 'advance_to_vendors', credit: setOff }],
        description: `${po.purchaseOrderNumber}: advance ${inr(setOff)} set off against the bill (${vendorName})`,
        reference: po.purchaseOrderNumber, relatedDocument: 'Purchase', relatedDocumentId: doc._id,
        user: user || po.createdBy, prefix: 'SET',
      });
    }
  } catch (err) {
    console.error('Ledger posting at full acceptance failed:', err.message);
  }

  const balance = round2(doc.totalAmount - doc.paidAmount);
  await mongoose.model('Purchase').updateOne({ _id: po._id }, { paymentStatus: poPaymentStatus(doc) });
  await logPoEvent({
    po, user, req, action: 'fully_accepted',
    summary: balance > 0
      ? `Everything received and QC-passed — full payment of ${inr(balance)} due ${doc.creditDays ? fmtDay(doc.dueDate) : 'now'}${doc.creditDays ? ` (${doc.creditDays} credit days)` : ''}.`
      : 'Everything received and QC-passed — nothing left to pay.',
    details: { balance, dueDate: doc.dueDate, creditDays: doc.creditDays },
  });
  if (balance > 0) {
    try {
      await notificationService.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Purchase ready for full payment',
        message: `${po.purchaseOrderNumber} from ${vendorName}: everything is received and QC-passed — ${inr(balance)} due ${doc.creditDays ? fmtDay(doc.dueDate) : 'now'}.`,
        type: 'purchase',
        ...accountsAudience(po),
        data: { purchaseId: String(po._id), billId: String(doc._id), fullyAccepted: true },
      });
    } catch (err) {
      console.error('Notify Accounts of a fully accepted PO failed:', err.message);
    }
  }
  return doc;
}

// Daily: PO bills past their full-payment date and not paid → the PO shows
// Overdue, and Accounts hears once per bill.
export async function runPaymentOverdueSweep(now = new Date(), { companyId = null, unit = null } = {}) {
  const query = { purchaseOrder: { $ne: null }, stage: 'Payable', dueDate: { $lt: now }, overdueNotifiedAt: null };
  if (companyId) query.companyId = companyId;
  if (unit) query.unit = unit;
  const bills = await PurchaseInvoice.find(query).populate({ path: 'purchaseOrder', select: 'purchaseOrderNumber companyId supplier', populate: { path: 'supplier', select: 'supplierName' } });
  let flagged = 0;
  for (const b of bills) {
    const po = b.purchaseOrder;
    if (!po) continue;
    await mongoose.model('Purchase').updateOne({ _id: po._id }, { paymentStatus: 'Overdue' });
    await PurchaseInvoice.updateOne({ _id: b._id }, { overdueNotifiedAt: now });
    try {
      await notificationService.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Purchase payment overdue',
        message: `${po.purchaseOrderNumber} from ${po.supplier?.supplierName || 'the vendor'}: ${inr(b.totalAmount - b.paidAmount)} was due ${fmtDay(b.dueDate)}.`,
        type: 'purchase',
        targetCompanyId: b.companyId,
        data: { purchaseId: String(po._id), billId: String(b._id), paymentOverdue: true },
      });
    } catch (err) {
      console.error('Payment overdue notification failed:', err.message);
    }
    flagged += 1;
  }
  return { checked: bills.length, flagged };
}
