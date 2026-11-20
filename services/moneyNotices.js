// Money notices to Accounts (Purchase separated from Accounts, 2026-11-16 —
// docs/purchase-separation/01-logic.md §5c). The same people used to buy and pay,
// so nobody was told when an advance was owed or money was owed back. Now Purchase
// and Accounts can be different people: these go to whoever holds Accounts →
// Vendor Payments. Never throws: a notice must not undo the work that caused it.
import notificationService, { HOLDERS } from './notificationService.js';

const inr = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN')}`;

/** A PO / outsource order with an advance became a real order: Accounts pays the advance. */
export async function notifyAdvanceToPay({ companyId, number, vendorName, amount, percent = null, data = {} }) {
  if (!(Number(amount) > 0) || !companyId) return;
  try {
    await notificationService.notifyHolders(companyId, HOLDERS.vendorPayments, {
      title: `Advance to pay: ${number}`,
      message: `${number} to ${vendorName || 'the vendor'} needs an advance of ${inr(amount)}${percent ? ` (${percent}%)` : ''} before the vendor's delivery time starts. Pay it on Vendor Payment.`,
      type: 'payment', icon: 'credit-card', priority: 'high',
      data: { ...data, advanceToPay: true },
    });
  } catch (err) { console.error('Advance-to-pay notice failed:', err.message); }
}

/** Money the vendor holds of ours (a cancellation, a QC rejection, a loss at a vendor). */
export async function notifyMoneyBack(mb) {
  if (!mb || !(Number(mb.amount) > 0) || mb.status === 'Written off' || mb.mode === 'WrittenOff') return;
  const why = { Cancellation: 'after a cancellation', Rejection: 'after a QC rejection', Outsource: 'on an outsource order' }[mb.source] || '';
  try {
    await notificationService.notifyHolders(mb.companyId, HOLDERS.vendorPayments, {
      title: mb.mode === 'Credit' ? `Credit with ${mb.vendorName || 'a vendor'}` : `Refund due from ${mb.vendorName || 'a vendor'}`,
      message: `${inr(mb.amount)} on ${mb.poNumber || 'an order'} ${why}. ${mb.status === 'To decide' ? 'Decide: refund or keep as credit.' : mb.mode === 'Credit' ? 'It is kept as credit for the next payment.' : 'Record the refund when it arrives.'} (Vendor Payment → Refunds & credits)`,
      type: 'payment', icon: 'credit-card', priority: 'high',
      data: { moneyBackId: String(mb._id), vendorId: String(mb.vendor), moneyBack: true },
    });
  } catch (err) { console.error('Money-back notice failed:', err.message); }
}
