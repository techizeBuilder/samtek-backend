// Single source of truth for "how much does this order owe" — used by
// Customer Master's order-financials breakdown, Packed Orders list, and the
// Due Bill PDF. Order Form is authoritative for the order's Total (its Bill
// Amount + GST is what Accounts actually billed the customer for), never the
// original quotation's Order.totalAmount and never a Sale/invoice total.
export function computeOrderFinancials({ form, sale, orderPayments = [], leadPayments = [] }) {
  const formItems = (form?.items || []).filter(it => !it.hiddenCharge);
  const subtotal = form?.totals?.billAmount ?? formItems.reduce((s, it) => s + (it.billAmount || 0), 0);
  const gst = form?.totals?.gstAmount ?? formItems.reduce((s, it) => s + (it.gstAmount || 0), 0);
  const total = subtotal + gst;

  // Advance = Order Form's own Payment Details section; fall back to the
  // invoice's recorded advance, then to verified lead payments, for orders
  // whose form predates this field being filled in.
  let advance = form?.paymentType === 'Advance Payment' ? (form?.receivedAmount || 0) : 0;
  if (!advance) advance = sale?.advancedPaymentAmount || 0;
  if (!advance && leadPayments.length) {
    advance = leadPayments.reduce((s, p) => s + (p.amount || 0), 0);
  }

  // Paid (receipts, not counting the advance) — invoice allocation is
  // authoritative once an invoice exists; otherwise use receipts recorded
  // directly against this order.
  const receiptsSum = orderPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const paid = sale ? (sale.paidAmount || 0) : receiptsSum;

  const due = Math.max(0, total - advance - paid);
  const paymentStatus = due <= 0 ? 'Paid' : (advance + paid) > 0 ? 'Partially Paid' : 'Pending';

  // Additional Charges — folded silently into the Order Form's Quotation
  // Amount as hiddenCharge rows (see OrderFormModal). Purely informational:
  // never added into subtotal/total/due above.
  const additionalCharges = (form?.items || [])
    .filter(it => it.hiddenCharge)
    .reduce((s, it) => s + (it.quotationAmount || 0), 0);

  return { total, subtotal, gst, advance, paid, due, paymentStatus, additionalCharges };
}
