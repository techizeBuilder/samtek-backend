// The Outsource Order's bill (outsource-v2 slice 3, 2026-10-20 —
// server/docs/outsource-v2/slice-3-bill-payment-plan.md). An outsource order
// is a bill the same way a PO is (docs/procurement-v2/accounts-bill-ledger-
// payments-2026-10.md): the advance is due when the order is Open, work
// becomes payable as it passes QC, and the full payment falls due credit days
// after everything is accepted. Payments go through purchaseBillService.payBill.
//
// When work is accepted (decisions Q1/Q2 — pay for what passes QC):
//   - a trip with no QC step: all of it, when received
//   - a Child Part / Machine hand-off: the units whose QC steps on this trip
//     ALL passed
//   - a Sub Child Part hand-off: the pieces that passed this trip's LAST QC
//     step (the attempt this trip sent)
//   - a job-work order (QC once, at its end): its QC result — passed ÷ order
//     quantity — applied to every trip of that job-work order
// What QC rejects / scraps / sends for rework is taken off the bill (an
// adjustment "Rejection"); a redo is a new order (₹0 or a charge).
//
// Ledger: accepted work  Dr Job Work Charges + Input GST / Cr Accounts Payable;
// fully accepted         charges posted the same way, the advance set off
//                        Dr Accounts Payable / Cr Advance to Vendors.
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import VendorMoneyBack from '../models/VendorMoneyBack.js';
import OutsourceOrder from '../models/OutsourceOrder.js';
import QCJob from '../models/QCJob.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { postEntry, gstLines } from './purchaseLedgerService.js';
import { fullDueDate } from './purchaseBillService.js';
import { advanceOf, priceTypeOf, stepAmount, priceBasis } from './outsourcePricingService.js';
import { getQcStepIndices } from './qcStepService.js';
import notificationService from './notificationService.js';
import { HttpError } from './subChildPartMaterialSendService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n) => `₹${round2(n).toLocaleString('en-IN')}`;
const userName = (u) => u?.fullName || u?.username || '';

function logActivity(order, user, action, summary) {
  order.activity.push({ at: new Date(), by: user?._id || null, byName: userName(user), action, summary });
}

// The order's bill, if it has one.
export const billOf = (order) => PurchaseInvoice.findOne({ outsourceOrder: order._id, companyId: order.company });

// The bill rows for one order line: one per step whenever the line has more
// than one step or isn't plain per piece (2026-10-21 / pricing types
// 2026-10-22), each with its basis; a time-based step without its time is a
// ₹0 "time not entered yet" row until Purchase enters it. GST is worked per
// row; the last priced row takes any paisa left over, so the rows always add
// up to the line.
export function billRowsForLine(l) {
  const qty = Number(l.qty) || 0;
  const rates = l.stepRates?.length ? l.stepRates : [{ step: l.stepNames.join(' › '), type: 'piece', rate: l.ratePerPiece, amount: l.amount }];
  const single = rates.length === 1 && priceTypeOf(rates[0]) === 'piece';
  const rows = rates.map(sr => {
    const amount = sr.amount == null ? (priceTypeOf(sr) === 'piece' && !l.stepRates?.length ? l.amount : stepAmount(sr, qty)) : sr.amount;
    return {
      item: l.item,
      itemName: single ? `${l.itemName} · ${l.stepNames.join(' › ')}` : `${l.itemName} · ${sr.step}`,
      quantity: qty || 1,
      amount, basis: priceBasis(sr, qty, l.qtyUnit), outsourceLineId: l._id || null, stepName: sr.step,
    };
  });
  let gstLeft = round2(l.gstAmount);
  const priced = rows.filter(r => r.amount != null);
  return rows.map(r => {
    const amount = r.amount == null ? 0 : round2(r.amount);
    const isLast = r.amount != null && r === priced[priced.length - 1];
    const gst = r.amount == null ? 0 : isLast ? round2(gstLeft) : round2(amount * (l.gstPercent || 0) / 100);
    if (r.amount != null) gstLeft = round2(gstLeft - gst);
    return {
      item: r.item, itemName: r.itemName, quantity: r.quantity,
      unitPrice: qty > 0 ? round2(amount / qty) : amount, gstPercent: l.gstPercent, gstAmount: Math.max(0, gst), totalPrice: amount,
      basis: r.basis, outsourceLineId: r.outsourceLineId, stepName: r.stepName,
    };
  });
}

// Makes the bill when the order becomes Open (created within the limit, or
// approved). One per order — a second call returns the existing one.
// No item price update: job work isn't the part's purchase price.
export async function createOutsourceBill(order, user) {
  const existing = await billOf(order);
  if (existing) return existing;
  const items = order.lines.flatMap(l => billRowsForLine(l));
  const advancePercent = order.paymentTerms?.advanceType === 'flat' ? 0 : Math.min(100, Math.max(0, Number(order.paymentTerms?.advancePercent) || 0));
  const bill = new PurchaseInvoice({
    vendor: order.vendor,
    outsourceOrder: order._id,
    invoiceNo: `INV-${order.orderNo}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    invoiceDate: new Date(),
    dueDate: null,
    items,
    // Charges in the subtotal, their GST with the lines' — as on a PO bill.
    subtotal: round2(order.subtotal + order.chargesTotal),
    gstAmount: round2(order.lineGst + order.chargesGst),
    gstType: order.gstType === 'IGST' ? 'IGST' : 'CGST_SGST',
    totalAmount: order.grandTotal,
    balanceAmount: order.grandTotal,
    advancePercent,
    // A % of the known total, or a flat amount (2026-10-22, R7).
    advanceAmount: advanceOf(order),
    creditDays: order.paymentTerms?.creditDays != null ? Number(order.paymentTerms.creditDays) : null,
    unit: order.unit || user?.unit || 'Main',
    companyId: order.company,
    createdBy: user?._id || order.createdBy,
    notes: `Outsource order ${order.orderNo} — ${order.vendorName}`,
  });
  await bill.save();
  return bill;
}

// Money the vendor holds of ours, for Accounts to decide on Vendor Payment →
// Refunds & credits: they refund it, or it stays as credit. It stays in Advance
// to Vendors until then, so no ledger entry here (as a PO cancel, 2026-11-04).
function outsourceMoneyBack(order, bill, amount, note) {
  return VendorMoneyBack.create({
    companyId: order.company, unit: bill.unit, vendor: order.vendor, vendorName: order.vendorName || '',
    outsourceOrder: order._id, poNumber: order.orderNo, source: 'Outsource', amount, status: 'To decide', note,
  });
}

// The bill just dropped (lost at the vendor, or QC rejected work): the advance
// can't be more than the bill, and anything paid above it goes to Accounts.
// Mutates the bill (the caller saves it). Returns the amount moved.
async function moveExcessToMoneyBack(order, bill, why) {
  const total = Number(bill.totalAmount) || 0;
  if ((Number(bill.advanceAmount) || 0) > total) bill.advanceAmount = round2(total);
  const excess = round2((Number(bill.paidAmount) || 0) - total);
  if (!(excess > 0)) return 0;
  bill.paidAmount = round2(bill.paidAmount - excess);
  bill.advancePaid = round2(Math.max(0, (Number(bill.advancePaid) || 0) - excess));
  await outsourceMoneyBack(order, bill, excess, why);
  logActivity(order, null, 'money-back', `${inr(excess)} paid above the bill: Accounts decides, refund or credit (${why}).`);
  return excess;
}

// The order is cancelled: its bill too. Anything already paid (only an advance:
// nothing has gone out) goes to Accounts: refund or credit. The bill keeps its
// figures as the record, as on a PO's full cancel (2026-11-04, replaces Q3).
export async function cancelOutsourceBill(order, reason = '') {
  const bill = await billOf(order);
  if (!bill) return null;
  const paid = round2(Number(bill.paidAmount) || 0);
  if (paid > 0) {
    await outsourceMoneyBack(order, bill, paid, `${order.orderNo} cancelled${reason ? `: ${reason}` : ''}`);
    logActivity(order, null, 'money-back', `${inr(paid)} already paid: Accounts decides, refund or credit.`);
  }
  bill.status = 'Cancelled';
  await bill.save();
  return bill;
}

// ── Recording what a trip sent to QC ──────────────────────────────────────

const unitProcs = (order, unitIndex) => (unitIndex ? order.extraUnits?.[unitIndex - 1]?.processes : order.processes);

// Right after a hand-off trip is received: which QC attempts it sent (one
// per QC step on the trip; per unit for Child Part / Machine). A job-work
// trip records none — its QC is the job-work order's own, at the end.
export async function recordTripQc(request) {
  request.receivedAt = new Date();
  request.qcAttempts = [];
  if (request.kind !== 'handoff') return;
  const po = await ProductionOrder.findById(request.productionOrder);
  const handoff = po?.outsourceHandoffs.id(request.handoffId);
  if (!po || !handoff) return;
  const { qcJobSourceForOrder } = await import('../controllers/productionMfgController.js');
  const job = await QCJob.findOne({ source: qcJobSourceForOrder(po), sourceRefId: po.orderId, company: po.company }).lean();
  if (!job) return;
  const isScp = po.orderKind === 'SubChildPart';
  for (const unitIndex of isScp ? [0] : handoff.unitIndices) {
    const procs = unitProcs(po, unitIndex);
    if (!procs) continue;
    const qcIdx = getQcStepIndices(po, procs);
    for (const idx of request.stepIndices) {
      if (!qcIdx.includes(idx)) continue;
      const proc = procs[idx];
      const entry = isScp
        ? (job.batchSteps || []).find(b => b.category === proc.category && b.stepName === proc.step)
        : (job.unitChecks || []).find(u => u.unitNumber === unitIndex + 1)?.steps?.find(s => s.category === proc.category && s.stepName === proc.step);
      const last = entry?.attempts?.[entry.attempts.length - 1];
      if (last) request.qcAttempts.push({ unitNumber: isScp ? null : unitIndex + 1, category: proc.category, stepName: proc.step, attemptNumber: last.attemptNumber });
    }
  }
}

// ── Deciding what was accepted ────────────────────────────────────────────

// What QC has decided on a received request so far, as parts that can be
// applied to the bill one at a time:
//   { done, parts: [{ key, accepted, rejected }] }
// 'all' for a whole trip (no QC step, a Sub Child Part batch, a job-work
// order); 'u1', 'u2'… for a Child Part / Machine trip — each unit is payable
// as soon as its own QC steps on this trip are decided. Pure reads.
export async function qcDecisionsOf(request) {
  // Pieces lost at the vendor are taken off the bill on their own when written
  // off ("lost at vendor", 2026-10-26) — QC decides the rest.
  const qty = Math.max(0, (Number(request.qty) || 0) - (Number(request.lostQty) || 0));
  if (request.kind === 'jobWork') {
    // Per-step QC (2026-10-22): a trip is accepted from ITS OWN check (or at
    // once when it had no QC step) — not from the order's last check, so a
    // vendor's earlier step is payable whoever does the next one. A trip
    // received before that falls back to the order's final check.
    const jw = await SubChildPartJobWorkOrder.findById(request.jobWorkOrder).select('orderQuantity qcJobId rounds').lean();
    const round = request.roundId ? (jw?.rounds || []).find(x => String(x._id) === String(request.roundId)) : null;
    if (round?.qc?.needed === false && round.qc.status === 'Passed') {
      return { done: true, parts: [{ key: 'all', accepted: qty, rejected: 0 }] };
    }
    const qcJobId = round?.qc?.qcJobId || jw?.qcJobId;
    const sentQty = round?.qc?.sentQty || jw?.orderQuantity;
    const qc = qcJobId ? await QCJob.findById(qcJobId).select('status quantity').lean() : null;
    if (!qc || !['Approved', 'Rejected'].includes(qc.status)) return { done: false, parts: [] };
    const fraction = qc.status === 'Rejected' || !(sentQty > 0) ? 0 : Math.min(1, (Number(qc.quantity) || 0) / sentQty);
    const accepted = Math.round(qty * fraction * 1000) / 1000;
    return { done: true, parts: [{ key: 'all', accepted, rejected: round2(qty - accepted) }] };
  }
  if (!request.qcAttempts?.length) return { done: true, parts: [{ key: 'all', accepted: qty, rejected: 0 }] }; // no QC step on this trip

  const po = await ProductionOrder.findById(request.productionOrder).select('orderId orderKind company').lean();
  const { qcJobSourceForOrder } = await import('../controllers/productionMfgController.js');
  const job = po ? await QCJob.findOne({ source: qcJobSourceForOrder(po), sourceRefId: po.orderId, company: po.company }).lean() : null;
  if (!job) return { done: false, parts: [] };
  const find = (a) => {
    const entry = a.unitNumber == null
      ? (job.batchSteps || []).find(b => b.category === a.category && b.stepName === a.stepName)
      : (job.unitChecks || []).find(u => u.unitNumber === a.unitNumber)?.steps?.find(s => s.category === a.category && s.stepName === a.stepName);
    return entry?.attempts?.find(x => x.attemptNumber === a.attemptNumber) || null;
  };
  const attempts = request.qcAttempts.map(a => ({ ref: a, at: find(a) }));

  if (po.orderKind === 'SubChildPart') {
    // The pieces that passed this trip's LAST QC step, once every QC step
    // this trip sent is decided.
    if (attempts.some(x => !x.at?.decidedAt)) return { done: false, parts: [] };
    const accepted = Math.max(0, Math.min(qty, Number(attempts[attempts.length - 1].at.passedQty) || 0));
    return { done: true, parts: [{ key: 'all', accepted, rejected: round2(qty - accepted) }] };
  }

  // Child Part / Machine: per unit. A unit is decided once all its QC steps
  // on this trip are; accepted only if every one passed.
  const byUnit = new Map();
  for (const x of attempts) {
    const u = byUnit.get(x.ref.unitNumber) || { decided: true, pass: true };
    if (!x.at?.decidedAt) u.decided = false;
    else if (x.at.decision !== 'Pass') u.pass = false;
    byUnit.set(x.ref.unitNumber, u);
  }
  const parts = [...byUnit.entries()].filter(([, u]) => u.decided)
    .map(([n, u]) => ({ key: `u${n}`, accepted: u.pass ? 1 : 0, rejected: u.pass ? 0 : 1 }));
  return { done: parts.length === byUnit.size, parts };
}

// Applies whatever QC has newly decided on a request to the bill: accepted
// work is payable (posted to the ledger), the rest is taken off the bill.
// Each part is applied once (acceptance.appliedKeys). Mutates the order
// (the caller saves it). Returns true when something changed.
async function applyAcceptance(order, line, request, bill, user) {
  if (request.acceptance?.decidedAt || request.status !== 'Received') return false;
  // Pricing types (2026-10-22): a per minute / per hour step without its
  // time has no value yet — QC's decision waits and is applied the moment
  // Purchase enters the time (postStepTime → refreshAcceptance). Pieces are
  // then valued at the line's average per piece (ratePerPiece, R6).
  if (line.timePending) return false;
  const { done, parts } = await qcDecisionsOf(request);
  const applied = new Set(request.acceptance?.appliedKeys || []);
  const fresh = parts.filter(p => !applied.has(p.key));
  if (!fresh.length && !done) return false;

  const acceptedQty = round2(fresh.reduce((s, p) => s + p.accepted, 0));
  const rejectedQty = round2(fresh.reduce((s, p) => s + p.rejected, 0));
  // Valued from the line's own amount (R6: a whole line ₹500 for 6, 5 accepted
  // = ₹416.67 — not 5 × a rounded ₹83.33).
  const perPiece = Number(line.qty) > 0 && line.amount != null ? Number(line.amount) / Number(line.qty) : Number(line.ratePerPiece) || 0;
  const net = round2(acceptedQty * perPiece);
  const gst = round2(net * (line.gstPercent || 0) / 100);
  const rejectedNet = round2(rejectedQty * perPiece);
  const rejectedValue = round2(rejectedNet + rejectedNet * (line.gstPercent || 0) / 100);
  const a = request.acceptance || {};
  request.acceptance = {
    decidedAt: done ? new Date() : null,
    acceptedQty: round2((a.acceptedQty || 0) + acceptedQty),
    net: round2((a.net || 0) + net),
    gst: round2((a.gst || 0) + gst),
    rejectedQty: round2((a.rejectedQty || 0) + rejectedQty),
    rejectedValue: round2((a.rejectedValue || 0) + rejectedValue),
    appliedKeys: [...applied, ...fresh.map(p => p.key)],
  };
  if (!fresh.length) return true; // only "done" changed

  if (bill && bill.status !== 'Cancelled') {
    bill.acceptedValue = round2((Number(bill.acceptedValue) || 0) + net + gst);
    if (rejectedValue > 0) {
      bill.totalAmount = round2(bill.totalAmount - rejectedValue);
      bill.adjustments.push({ kind: 'Rejection', amount: rejectedValue, reason: `${request.orderCode}: ${rejectedQty} ${line.qtyUnit} not accepted by QC (${line.itemName})`, ref: request._id, by: user?._id || null });
      await moveExcessToMoneyBack(order, bill, `${request.orderCode}: ${rejectedQty} ${line.qtyUnit} not accepted by QC`);
    }
    await bill.save();
    if (net + gst > 0) {
      try {
        await postEntry({
          companyId: order.company, unit: bill.unit,
          lines: [{ key: 'job_work', debit: net }, ...gstLines(gst, order.gstType), { key: 'accounts_payable', credit: round2(net + gst) }],
          description: `Job work accepted: ${line.itemName} · ${line.stepNames.join(' › ')} × ${acceptedQty} — ${order.orderNo} (${order.vendorName}) for ${request.orderCode}`,
          reference: order.orderNo, relatedDocument: 'Purchase', relatedDocumentId: bill._id,
          user: user || order.createdBy, prefix: 'JWA',
        });
      } catch (err) {
        console.error('[OutsourceBill] ledger (accepted work) failed:', err.message);
      }
    }
  }
  const unitsNote = fresh.some(p => p.key !== 'all') ? ` (unit${fresh.length === 1 ? '' : 's'} ${fresh.map(p => p.key.slice(1)).join(', ')})` : '';
  logActivity(order, user, 'accepted', `${request.orderCode} — ${line.itemName} · ${line.stepNames.join(' › ')}${unitsNote}: ${acceptedQty} ${line.qtyUnit} accepted (${inr(net + gst)} payable)${rejectedQty ? `; ${rejectedQty} not accepted by QC — ${inr(rejectedValue)} taken off the bill` : ''}.`);
  return true;
}

// Pieces written off at the vendor (2026-10-26 — partial returns): their value
// (+ GST) comes off the bill as "lost at vendor" — never "not accepted by QC".
// Mutates nothing on the order (the caller records it there).
export async function takeLostOffBill(order, line, request, qty, user) {
  const bill = await PurchaseInvoice.findOne({ outsourceOrder: order._id, companyId: order.company });
  if (!bill || bill.status === 'Cancelled' || !(qty > 0)) return 0;
  const perPiece = Number(line.qty) > 0 && line.amount != null ? Number(line.amount) / Number(line.qty) : Number(line.ratePerPiece) || 0;
  const net = round2(qty * perPiece);
  const value = round2(net + net * (line.gstPercent || 0) / 100);
  if (!(value > 0)) return 0;
  bill.totalAmount = round2(bill.totalAmount - value);
  bill.adjustments.push({ kind: 'LostAtVendor', amount: value, reason: `${request.orderCode}: ${qty} ${line.qtyUnit} lost at the vendor (${line.itemName})`, ref: request._id, by: user?._id || null });
  await moveExcessToMoneyBack(order, bill, `${request.orderCode}: ${qty} ${line.qtyUnit} lost at the vendor`);
  await bill.save();
  return value;
}

// Every request decided (or released) → the full payment falls due: the
// charges are posted, the advance is set off. Returns the bill, or null.
async function settleIfFullyAccepted(order, bill, user) {
  if (!bill || bill.fullyAcceptedAt || bill.status === 'Cancelled') return null;
  const reqs = order.lines.flatMap(l => l.requests).filter(r => r.status !== 'Released');
  if (!reqs.length || reqs.some(r => !r.acceptance?.decidedAt)) return null;
  const now = new Date();
  const claimed = await PurchaseInvoice.updateOne({ _id: bill._id, fullyAcceptedAt: null }, { $set: { fullyAcceptedAt: now } });
  if (!claimed.modifiedCount) return null;
  const doc = await PurchaseInvoice.findById(bill._id);
  // What's left: the charges (+ their GST) and any rounding.
  const rest = round2((Number(doc.totalAmount) || 0) - (Number(doc.acceptedValue) || 0));
  const restGst = Math.min(Math.max(0, rest), round2(order.chargesGst || 0));
  const restNet = round2(rest - restGst);
  doc.acceptedValue = round2(doc.totalAmount);
  doc.dueDate = fullDueDate(now, doc.creditDays);
  await doc.save();
  try {
    if (Math.abs(rest) >= 0.01) {
      await postEntry({
        companyId: order.company, unit: doc.unit,
        lines: rest > 0
          ? [{ key: 'job_work', debit: restNet }, ...gstLines(restGst, order.gstType), { key: 'accounts_payable', credit: rest }]
          : [{ key: 'accounts_payable', debit: -rest }, { key: 'job_work', credit: -rest }],
        description: `${order.orderNo} fully accepted — charges (${order.vendorName})`,
        reference: order.orderNo, relatedDocument: 'Purchase', relatedDocumentId: doc._id,
        user: user || order.createdBy, prefix: 'JWA',
      });
    }
    const setOff = round2(doc.advancePaid);
    if (setOff > 0) {
      await postEntry({
        companyId: order.company, unit: doc.unit,
        lines: [{ key: 'accounts_payable', debit: setOff }, { key: 'advance_to_vendors', credit: setOff }],
        description: `${order.orderNo}: advance ${inr(setOff)} set off against the bill (${order.vendorName})`,
        reference: order.orderNo, relatedDocument: 'Purchase', relatedDocumentId: doc._id,
        user: user || order.createdBy, prefix: 'SET',
      });
    }
  } catch (err) {
    console.error('[OutsourceBill] ledger (full acceptance) failed:', err.message);
  }
  const balance = round2(doc.totalAmount - doc.paidAmount);
  const due = doc.creditDays ? doc.dueDate.toLocaleDateString('en-IN') : 'now';
  logActivity(order, user, 'fully_accepted', balance > 0
    ? `Every trip accepted — full payment of ${inr(balance)} due ${due}${doc.creditDays ? ` (${doc.creditDays} credit days)` : ''}.`
    : 'Every trip accepted — nothing left to pay.');
  if (balance > 0) {
    try {
      await notificationService.notifyRoles(['Accounts Head', 'Account Employee'], {
        title: 'Outsource order ready for full payment',
        message: `${order.orderNo} from ${order.vendorName}: every trip is accepted — ${inr(balance)} due ${due}.`,
        type: 'purchase', targetCompanyId: order.company,
        data: { outsourceOrderId: String(order._id), orderNo: order.orderNo, billId: String(doc._id), fullyAccepted: true },
      });
    } catch (err) {
      console.error('[OutsourceBill] notify Accounts failed:', err.message);
    }
  }
  return doc;
}

// Re-checks every received, undecided request on the order; then full
// acceptance. Mutates + saves nothing on the order itself (the caller does).
export async function refreshAcceptance(order, user) {
  const bill = await billOf(order);
  let changed = false;
  for (const line of order.lines) {
    for (const r of line.requests) {
      if (await applyAcceptance(order, line, r, bill, user)) changed = true;
    }
  }
  if (changed && bill) await settleIfFullyAccepted(order, await PurchaseInvoice.findById(bill._id), user);
  // Slice 4 (2026-10-24): accepted money is the part's job-work cost — every
  // finished build this order touches pushes its cost again (a receive of an
  // outsourced last step, a QC pass, a late time entry). The order is still
  // unsaved here, so it's passed through. Run even when nothing changed: a
  // receive still waiting for its time finishes the build too, and the BOM
  // should say what it waits for. Only finished builds push. Never throws.
  const { refreshCostsAfterAcceptance } = await import('./partCostService.js');
  await refreshCostsAfterAcceptance(order);
  return changed;
}

// After any QC decision on a production order or a job-work order: the
// outsource orders holding its trips re-check what's accepted. Never throws —
// a money hiccup must not undo a QC decision.
export async function onOutsourceQcDecided({ productionOrderId = null, jobWorkOrderId = null }, user = null) {
  try {
    const q = productionOrderId
      ? { 'lines.requests.productionOrder': productionOrderId }
      : jobWorkOrderId ? { 'lines.requests.jobWorkOrder': jobWorkOrderId } : null;
    if (!q) return;
    const orders = await OutsourceOrder.find({ ...q, status: { $in: ['With vendor', 'Partly received', 'Received'] } });
    for (const order of orders) {
      if (await refreshAcceptance(order, user)) await order.save();
    }
  } catch (err) {
    console.error('[OutsourceBill] QC decision → acceptance failed:', err.message);
  }
}

// The bill's figures for the order's own page.
export function billSummary(bill) {
  if (!bill) return null;
  return {
    _id: bill._id, invoiceNo: bill.invoiceNo, stage: bill.stage, status: bill.status,
    totalAmount: bill.totalAmount, advanceAmount: bill.advanceAmount, advancePaid: bill.advancePaid,
    acceptedValue: bill.acceptedValue, paidAmount: bill.paidAmount, balance: round2(bill.totalAmount - bill.paidAmount),
    dueDate: bill.dueDate, fullyAcceptedAt: bill.fullyAcceptedAt, adjustments: bill.adjustments || [],
  };
}

export const _test = { round2 };
