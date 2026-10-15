// A PO's charges and payment terms vs the vendor's quotation (procurement-v2,
// user decision 2026-10-14). Charges and terms are the vendor's offer: PO
// review pre-fills them from the NEWEST quotation behind the PO's lines (the
// same one the vendor selection check prices the charges from). Purchase may
// still change them on the PO — "we pick up, so no freight", "negotiated the
// advance down" — but:
//   - ANY difference needs a reason (chips + note), saved on the PO and shown
//     to the Company Admin, in History and the audit log;
//   - charges ABOVE the quotation (landed: amount + GST) send the PO to the
//     Company Admin for approval, whatever its value — the selection check
//     compared vendors on the quotation's charges, so adding charges after
//     passing it must not be silent.
// Lower charges or changed terms need only the reason.
// The frontend keeps a copy of the pure part (client/src/lib/poQuoteTerms.js)
// for the live preview — keep the two in step. The server decides.
import { quotationMadeAt } from './quotationCarryOverService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const key = (s) => String(s || '').trim().toLowerCase();
const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const inr = (n) => `₹${round2(n).toLocaleString('en-IN')}`;

export const TERMS_CHANGE_REASONS = [
  'We pick up (no freight)',
  'Negotiated at order time',
  'Vendor confirmed new terms',
  'Smaller order than quoted',
  'Other',
];

// The newest quotation among those behind the PO's lines. `quotations`:
// [{ q, manual }] with q = { number, charges, paymentTerms, submittedAt |
// createdAt / quoteDate }.
export function newestQuotation(quotations) {
  let best = null;
  for (const { q, manual } of quotations || []) {
    if (!q) continue;
    const at = quotationMadeAt(q, manual);
    if (!best || new Date(at || 0) > new Date(best.at || 0)) best = { q, manual, at };
  }
  return best;
}

const cleanCharges = (list) => (list || [])
  .filter(c => String(c?.label || '').trim() && Number(c.amount) > 0)
  .map(c => ({ label: String(c.label).trim(), amount: round2(c.amount), gstPercent: Number(c.gstPercent) || 0 }));
const landed = (list) => round2(list.reduce((s, c) => s + c.amount + c.amount * c.gstPercent / 100, 0));
const cleanOthers = (list) => (list || [])
  .filter(o => String(o?.label || '').trim() && String(o?.value || '').trim())
  .map(o => ({ label: String(o.label).trim(), value: String(o.value).trim() }));

// Pure. quoted / po = { charges, paymentTerms }. Returns the differences in
// words, and whether the PO's charges cost more than the quotation's.
export function compareWithQuotation(quoted, po) {
  const qc = cleanCharges(quoted?.charges);
  const pc = cleanCharges(po?.charges);
  const changes = [];
  const qByKey = new Map(qc.map(c => [key(c.label), c]));
  const pByKey = new Map(pc.map(c => [key(c.label), c]));
  const chargeText = (c) => `${c.label} ${inr(c.amount)}${c.gstPercent ? ` + ${c.gstPercent}% GST` : ''}`;
  for (const c of pc) {
    const was = qByKey.get(key(c.label));
    if (!was) changes.push(`Charge added: ${chargeText(c)}`);
    else if (was.amount !== c.amount || was.gstPercent !== c.gstPercent) changes.push(`Charge changed: ${chargeText(was)} → ${chargeText(c)}`);
  }
  for (const c of qc) if (!pByKey.has(key(c.label))) changes.push(`Charge removed: ${chargeText(c)}`);

  const qt = quoted?.paymentTerms || {};
  const pt = po?.paymentTerms || {};
  const termText = (v, unit) => (v == null ? 'none' : `${v}${unit}`);
  const qa = numOrNull(qt.advancePercent); const pa = numOrNull(pt.advancePercent);
  if (qa !== pa) changes.push(`Advance: ${termText(qa, '%')} → ${termText(pa, '%')}`);
  const qd = numOrNull(qt.creditDays); const pd = numOrNull(pt.creditDays);
  if (qd !== pd) changes.push(`Credit days: ${termText(qd, ' days')} → ${termText(pd, ' days')}`);
  const qo = cleanOthers(qt.others); const po2 = cleanOthers(pt.others);
  const qoByKey = new Map(qo.map(o => [key(o.label), o]));
  const poByKey = new Map(po2.map(o => [key(o.label), o]));
  for (const o of po2) {
    const was = qoByKey.get(key(o.label));
    if (!was) changes.push(`Term added: ${o.label} — ${o.value}`);
    else if (was.value !== o.value) changes.push(`Term changed: ${o.label} — "${was.value}" → "${o.value}"`);
  }
  for (const o of qo) if (!poByKey.has(key(o.label))) changes.push(`Term removed: ${o.label} — ${o.value}`);

  const quotedChargesTotal = landed(qc);
  const poChargesTotal = landed(pc);
  return { changes, quotedChargesTotal, poChargesTotal, chargesAbove: poChargesTotal > quotedChargesTotal + 0.005 };
}

// Purchase's reason for the changes: chip(s) + note ("Other" needs the note).
export function readTermsChangeReason(body) {
  const reasons = [...new Set((Array.isArray(body?.reasons) ? body.reasons : []).map(r => String(r || '').trim()).filter(r => TERMS_CHANGE_REASONS.includes(r)))];
  const note = String(body?.note || '').trim();
  if (!reasons.length) return { error: 'pick at least one reason for the change.' };
  if (reasons.includes('Other') && !note) return { error: 'add a note explaining "Other".' };
  return { reasons, note };
}
