// Outsource pricing types (client change 2, 2026-10-22 —
// docs/outsource-v2/pricing-types-logic-2026-10.md, plan pricing-types-plan-2026-10.md).
// Each step on an Outsource Order line is priced its own way (R1):
//   piece      ₹ per piece / unit          amount = rate × qty
//   line       ₹ for the whole line        amount = rate
//   operation  ₹ per operation (BOM count) amount = rate × operations per piece × qty
//   minute     ₹ per minute                amount = rate × minutes   (time entered later)
//   hour       ₹ per hour                  amount = rate × minutes ÷ 60
// A time-based step's amount is null until its time is in; the line then
// shows "time pending" and its known amount leaves that step out. Pure
// functions — no DB access.
export const PRICE_TYPES = ['piece', 'line', 'operation', 'minute', 'hour'];
export const TIME_TYPES = ['minute', 'hour'];
export const isTimeType = (t) => TIME_TYPES.includes(t);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const inr = (n) => `₹${fmt(n)}`;

// A step price as stored (an old one has no type — it's per piece).
export const priceTypeOf = (sr) => (PRICE_TYPES.includes(sr?.type) ? sr.type : 'piece');

export function stepAmount(sr, qty) {
  const rate = Number(sr?.rate) || 0;
  const q = Number(qty) || 0;
  switch (priceTypeOf(sr)) {
    case 'line': return round2(rate);
    case 'operation': return round2(rate * (Number(sr.operationsPerPiece) || 0) * q);
    case 'minute': return sr.time?.minutes != null ? round2(rate * Number(sr.time.minutes)) : null;
    case 'hour': return sr.time?.minutes != null ? round2(rate * Number(sr.time.minutes) / 60) : null;
    default: return round2(rate * q);
  }
}

export const timeText = (minutes) => {
  const m = Math.round(Number(minutes) || 0);
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};

// The basis shown on the order and the bill, e.g. "2 pcs × 4 holes × ₹5 = ₹40".
export function priceBasis(sr, qty, qtyUnit = 'pcs') {
  const q = `${fmt(qty)} ${qtyUnit}`;
  const amt = stepAmount(sr, qty);
  switch (priceTypeOf(sr)) {
    case 'line': return `whole line (${q}) ${inr(sr.rate)}`;
    case 'operation': return `${q} × ${fmt(sr.operationsPerPiece)} ${sr.operationName || 'operations'} × ${inr(sr.rate)} = ${inr(amt)}`;
    case 'minute':
    case 'hour': {
      const per = sr.type === 'minute' ? '/min' : '/h';
      return amt == null ? `${inr(sr.rate)}${per} — time not entered yet` : `${timeText(sr.time.minutes)} × ${inr(sr.rate)}${per} = ${inr(amt)}`;
    }
    default: return `${q} × ${inr(sr.rate)} = ${inr(amt)}`;
  }
}

// Recomputes a line from its step prices: each step's amount, the line's
// known amount (time-based steps without time left out), GST, and its
// average per piece (R6 — what QC acceptance values pieces at). Mutates.
export function computeLine(line) {
  const qty = Number(line.qty) || 0;
  let amount = 0; let pending = false;
  for (const sr of line.stepRates || []) {
    if (!sr.type) sr.type = 'piece';
    const a = stepAmount(sr, qty);
    sr.amount = a;
    if (a == null) pending = true; else amount += a;
  }
  line.amount = round2(amount);
  line.timePending = pending;
  line.gstAmount = round2(line.amount * (Number(line.gstPercent) || 0) / 100);
  line.lineTotal = round2(line.amount + line.gstAmount);
  // The average per piece / unit (old readers use ratePerPiece).
  line.ratePerPiece = qty > 0 ? round2(line.amount / qty) : 0;
  return line;
}

// Order totals from its lines and charges. Mutates.
export function computeOrderTotals(order) {
  order.subtotal = round2((order.lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0));
  order.lineGst = round2((order.lines || []).reduce((s, l) => s + (Number(l.gstAmount) || 0), 0));
  order.chargesTotal = round2((order.charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0));
  order.chargesGst = round2((order.charges || []).reduce((s, c) => s + (Number(c.gstAmount) || 0), 0));
  order.grandTotal = round2(order.subtotal + order.lineGst + order.chargesTotal + order.chargesGst);
  order.hasTimeBased = (order.lines || []).some(l => (l.stepRates || []).some(sr => isTimeType(priceTypeOf(sr))));
  order.timePending = (order.lines || []).some(l => l.timePending);
  return order;
}

// The advance (R7): a % of the known total, or a flat amount (capped at the
// known total when the order has one).
export function advanceOf(order) {
  const t = order.paymentTerms || {};
  if (t.advanceType === 'flat') {
    const flat = round2(Math.max(0, Number(t.advanceFlat) || 0));
    const known = Number(order.grandTotal) || 0;
    return known > 0 ? Math.min(flat, known) : flat;
  }
  const pct = Math.min(100, Math.max(0, Number(t.advancePercent) || 0));
  return round2((Number(order.grandTotal) || 0) * pct / 100);
}
