// The PO bill and its payments (procurement-v2, 2026-10-12 — client's answers;
// docs/procurement-v2/accounts-bill-ledger-payments-2026-10.md).
//
//  - The PO's own invoice is the bill. Nothing is retyped.
//  - Advance: Advance % × the PO total, due when the PO becomes a real order.
//    When it's fully paid, the vendor's delivery days start counting
//    (each line's date = that day + its quoted days).
//  - Full payment: everything left, due Credit Days after every line is
//    received and QC-passed (blank / 0 = straight away).
//  - Optional part payment in between, for material already QC-passed:
//    up to its value minus its share of the advance.
import mongoose from 'mongoose';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import VendorPayment from '../models/VendorPayment.js';
import { Account } from '../models/Account.js';
import { postEntry } from './purchaseLedgerService.js';
import { logPoEvent, inr } from './purchaseAuditService.js';
import { clockDates, notifyStoreOfIncomingPO, fmtDay } from './deliveryFollowUpService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pctOf = (p) => Math.min(100, Math.max(0, Number(p) || 0));
export const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Other'];

// ── Pure ──────────────────────────────────────────────────────────────────

export const advanceAmountOf = (total, pct) => round2((Number(total) || 0) * pctOf(pct) / 100);

// Full payment due date: the day everything was accepted + credit days.
export function fullDueDate(fullyAcceptedAt, creditDays) {
  if (!fullyAcceptedAt) return null;
  const days = Number(creditDays) > 0 ? Math.round(Number(creditDays)) : 0;
  return new Date(new Date(fullyAcceptedAt).getTime() + days * DAY_MS);
}

// What can be paid on a bill right now:
//   advance  — the advance still unpaid (only before everything's accepted)
//   material — for QC-passed material: before full acceptance, its value
//              minus its share of the advance, less what was already paid
//              for material; after full acceptance, the whole balance.
export function payableNow(bill) {
  if (!bill || bill.status === 'Cancelled') return { advance: 0, material: 0 };
  const paid = Number(bill.paidAmount) || 0;
  const advancePaid = Number(bill.advancePaid) || 0;
  if (bill.fullyAcceptedAt) return { advance: 0, material: Math.max(0, round2((Number(bill.totalAmount) || 0) - paid)) };
  const advance = Math.max(0, round2((Number(bill.advanceAmount) || 0) - advancePaid));
  const materialPaid = paid - advancePaid;
  const material = Math.max(0, round2((Number(bill.acceptedValue) || 0) * (1 - pctOf(bill.advancePercent) / 100) - materialPaid));
  return { advance, material };
}

// What we owe on a bill RIGHT NOW and haven't paid (2026-10-12 — the credit
// warning at PO time, user): a PO bill counts only what's actually due — an
// advance not yet paid, and material received + QC-passed but not paid for
// (the whole balance once everything is accepted). Material still on order
// isn't owed yet. A bill without a PO: its balance.
//   { owed, advance, material, overdue }
export function owedNow(bill, now = new Date()) {
  if (!bill || bill.status === 'Cancelled') return { owed: 0, advance: 0, material: 0, overdue: 0 };
  const paid = Number(bill.paidAmount) || 0;
  if (!bill.purchaseOrder) {
    const owed = Math.max(0, round2((Number(bill.totalAmount) || 0) - paid));
    const overdue = bill.dueDate && new Date(bill.dueDate) < now ? owed : 0;
    return { owed, advance: 0, material: owed, overdue };
  }
  if (bill.fullyAcceptedAt) {
    const owed = Math.max(0, round2((Number(bill.totalAmount) || 0) - paid));
    const overdue = bill.dueDate && new Date(bill.dueDate) < now ? owed : 0;
    return { owed, advance: 0, material: owed, overdue };
  }
  const advance = Math.max(0, round2((Number(bill.advanceAmount) || 0) - (Number(bill.advancePaid) || 0)));
  const owed = Math.max(0, round2(Math.max(Number(bill.acceptedValue) || 0, Number(bill.advanceAmount) || 0) - paid));
  return { owed, advance: Math.min(advance, owed), material: Math.max(0, round2(owed - Math.min(advance, owed))), overdue: 0 };
}

// The PO's own payment status, from its bill.
export function poPaymentStatus(bill, now = new Date()) {
  if (!bill) return 'Pending';
  if (bill.status === 'Cancelled') return 'Cancelled';
  const paid = Number(bill.paidAmount) || 0;
  const balance = round2((Number(bill.totalAmount) || 0) - paid);
  if (bill.fullyAcceptedAt && balance <= 0) return 'Paid';
  if (bill.fullyAcceptedAt && bill.dueDate && new Date(bill.dueDate) < now && balance > 0) return 'Overdue';
  return paid > 0 ? 'Partially Paid' : 'Pending';
}

// Reads a payment request. Returns { error } or the clean values.
export function readPayment(body, now = new Date()) {
  const kind = body?.kind === 'Advance' ? 'Advance' : body?.kind === 'Payment' ? 'Payment' : null;
  if (!kind) return { error: 'Choose what this payment is for: the advance, or material received.' };
  const amount = round2(body?.amount);
  if (!(amount > 0)) return { error: 'Enter the amount paid.' };
  const paymentMode = PAYMENT_MODES.includes(body?.paymentMode) ? body.paymentMode : null;
  if (!paymentMode) return { error: 'Choose how it was paid.' };
  const paymentDate = body?.paymentDate ? new Date(body.paymentDate) : now;
  if (Number.isNaN(paymentDate.getTime())) return { error: 'That isn\'t a valid payment date.' };
  if (paymentDate.getTime() > now.getTime() + DAY_MS) return { error: 'The payment date can\'t be in the future.' };
  return { kind, amount, paymentMode, paymentDate, referenceNo: String(body?.referenceNo || '').trim(), notes: String(body?.notes || '').trim() };
}

// ── DB ────────────────────────────────────────────────────────────────────

// The advance is fully paid: the vendor's delivery days start today.
export async function startDeliveryClock(po, start) {
  const set = clockDates(po, start);
  for (const { line, date } of set) {
    line.expectedDeliveryDate = date;
    line.overdueNotifiedFor = null;
  }
  const live = (po.items || []).filter(l => !l.cancelled?.at).map(l => l.expectedDeliveryDate).filter(Boolean).map(d => new Date(d).getTime());
  if (live.length) po.expectedDeliveryDate = new Date(Math.max(...live));
  po.deliveryClock = { startsOn: 'advance', startedAt: new Date(start) };
  await po.save();
  await notifyStoreOfIncomingPO(po, { advancePaid: true });
  return set;
}

// Records a payment against a PO bill. Returns { status, message } on a
// refusal, or { payment, bill, clockStarted }.
// body.useCredit: paid out of credit the vendor already holds of ours
// (Slice 3 — the advance on rejected / cancelled material they kept), no bank.
export async function payBill({ billId, body, user, req = null }) {
  const useCredit = !!body?.useCredit;
  const read = readPayment(useCredit ? { ...body, paymentMode: 'Other' } : body);
  if (read.error) return { status: 400, message: read.error };
  const bill = await PurchaseInvoice.findOne({ _id: billId, companyId: user.companyId, purchaseOrder: { $ne: null } });
  if (!bill) return { status: 404, message: 'This PO bill wasn\'t found.' };
  if (bill.status === 'Cancelled') return { status: 409, message: 'This PO was cancelled — nothing is payable on it.' };
  const Purchase = mongoose.model('Purchase');
  const po = await Purchase.findOne({ _id: bill.purchaseOrder, companyId: user.companyId }).populate('supplier', 'supplierName');
  if (!po) return { status: 404, message: 'The PO behind this bill wasn\'t found.' };

  const can = payableNow(bill);
  if (read.kind === 'Advance') {
    if (!(can.advance > 0)) return { status: 409, message: bill.fullyAcceptedAt ? 'Everything is accepted — pay the full balance as a payment for material.' : 'There\'s no advance left to pay on this PO.' };
    if (read.amount > can.advance + 0.005) return { status: 400, message: `The advance left to pay is ${inr(can.advance)}.` };
  } else {
    if (!(can.material > 0)) {
      return { status: 409, message: bill.fullyAcceptedAt ? 'This bill is fully paid.' : 'Nothing on this PO has passed QC yet — only the advance can be paid now.' };
    }
    if (read.amount > can.material + 0.005) return { status: 400, message: `You can pay up to ${inr(can.material)} now${bill.fullyAcceptedAt ? '' : ' — the value of the material QC has passed, less its share of the advance'}.` };
  }

  // The bank / cash account it's paid from: the one chosen, else the
  // unit's first. Kept as before: refused if its balance is too low.
  // Or the vendor's own credit with us.
  let bank = null;
  const credit = useCredit ? await import('./purchaseRejectionService.js') : null;
  if (useCredit) {
    const available = await credit.vendorCreditAvailable(bill.companyId, bill.vendor);
    if (!(available > 0)) return { status: 409, message: 'This vendor has no credit with us.' };
    if (read.amount > available + 0.005) return { status: 400, message: `The vendor's credit is ${inr(available)}.` };
  } else {
    bank = body?.accountId
      ? await Account.findOne({ _id: body.accountId, isBankOrCash: true })
      : await Account.findOne({ isBankOrCash: true, unit: user.unit });
    if (!bank) return { status: 400, message: 'Choose the bank or cash account it was paid from.' };
    if ((Number(bank.balance) || 0) < read.amount) return { status: 400, message: `Not enough balance in ${bank.accountName}: ${inr(bank.balance)} available.` };
  }

  // Everything checked — write.
  const payment = await VendorPayment.create({
    vendor: bill.vendor,
    paymentDate: read.paymentDate,
    amount: read.amount,
    paymentMode: read.paymentMode,
    referenceNo: useCredit ? (read.referenceNo || 'Vendor credit') : read.referenceNo,
    bankAccount: bank?._id || null,
    fromCredit: useCredit,
    allocations: [{ invoice: bill._id, amount: read.amount }],
    kind: read.kind,
    purchaseOrder: po._id,
    unit: bill.unit,
    companyId: bill.companyId,
    createdBy: user._id,
    notes: read.notes,
  });
  if (useCredit) await credit.consumeVendorCredit({ companyId: bill.companyId, vendorId: bill.vendor, amount: read.amount, payment: payment._id, purchaseOrder: po._id });
  bill.paidAmount = round2((Number(bill.paidAmount) || 0) + read.amount);
  if (read.kind === 'Advance') bill.advancePaid = round2((Number(bill.advancePaid) || 0) + read.amount);
  await bill.save();

  try {
    // From credit: the money already sits in Advance to Vendors — an advance
    // paid from it moves nothing; a payment for material takes it off Payable.
    if (!(useCredit && read.kind === 'Advance')) await postEntry({
      companyId: bill.companyId,
      unit: bill.unit,
      lines: [
        { key: read.kind === 'Advance' ? 'advance_to_vendors' : 'accounts_payable', debit: read.amount },
        useCredit ? { key: 'advance_to_vendors', credit: read.amount } : { account: bank, credit: read.amount },
      ],
      description: `${read.kind === 'Advance' ? 'Advance' : 'Payment'} to ${po.supplier?.supplierName || 'vendor'} — ${po.purchaseOrderNumber}${useCredit ? ' (from their credit with us)' : read.referenceNo ? ` (Ref: ${read.referenceNo})` : ''}`,
      reference: po.purchaseOrderNumber,
      relatedDocument: 'Payment',
      relatedDocumentId: payment._id,
      mode: read.paymentMode,
      date: read.paymentDate,
      user,
      prefix: read.kind === 'Advance' ? 'ADV' : 'PAY',
    });
  } catch (err) {
    // The payment is recorded either way; a ledger hiccup is reported, not
    // allowed to undo a payment that was actually made.
    console.error('Ledger posting for a vendor payment failed:', err.message);
  }

  // The advance is now fully paid → the delivery days start (D3).
  let clockStarted = false;
  if (read.kind === 'Advance' && po.deliveryClock?.startsOn === 'advance' && !po.deliveryClock.startedAt
      && round2(bill.advancePaid) + 0.005 >= round2(bill.advanceAmount)) {
    await startDeliveryClock(po, read.paymentDate);
    clockStarted = true;
  }
  po.paymentStatus = poPaymentStatus(bill);
  await mongoose.model('Purchase').updateOne({ _id: po._id }, { paymentStatus: po.paymentStatus });

  const dates = clockStarted
    ? (po.items || []).filter(l => !l.cancelled?.at && l.expectedDeliveryDate).map(l => `${l.itemName} by ${fmtDay(l.expectedDeliveryDate)}`).join(', ')
    : '';
  await logPoEvent({
    po, user, req,
    action: read.kind === 'Advance' ? 'advance_paid' : 'payment_made',
    summary: read.kind === 'Advance'
      ? `Advance of ${inr(read.amount)} paid (${useCredit ? 'from vendor credit' : read.paymentMode}${read.referenceNo ? `, ${read.referenceNo}` : ''})${clockStarted ? ` — delivery days start now: ${dates || 'no quoted days on the lines'}` : bill.advancePaid < bill.advanceAmount ? ` — ${inr(bill.advanceAmount - bill.advancePaid)} of the advance still to pay` : ''}.`
      : `Payment of ${inr(read.amount)} for material (${useCredit ? 'from vendor credit' : read.paymentMode}${read.referenceNo ? `, ${read.referenceNo}` : ''}) — ${inr(Math.max(0, bill.totalAmount - bill.paidAmount))} left on the bill.`,
    details: { payment: String(payment._id), amount: read.amount, kind: read.kind, clockStarted },
  });

  return { payment, bill, clockStarted };
}
