// Store expected receipts + delivery follow-up (procurement-v2, 2026-10-10;
// client blueprint §17, steps 11–13). The user chose this over a formal
// vendor PO acknowledgement: the vendor's promise is the delivery days in
// its quote, which already became each PO line's expectedDeliveryDate.
//  - Store hears about a PO the moment it becomes a real order, and sees
//    what's overdue / due today / due soon.
//  - Purchase gets one alert per late line per date, and records a revised
//    date (with the vendor's reason) — kept in the line's delivery history.
import mongoose from 'mongoose';
import notificationService from './notificationService.js';
import { logPoEvent } from './purchaseAuditService.js';

export const OPEN_PO_STATUSES = ['Draft', 'Sent', 'Acknowledged', 'Partially Received'];
export const SOON_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const prIdsOfLine = (line) => (line?.purchaseRequests?.length ? line.purchaseRequests : (line?.purchaseRequest ? [line.purchaseRequest] : []));

// A line is received when every request on it is Received (Store receives a
// whole line at once); works on populated requests.
export function lineIsReceived(line) {
  const refs = prIdsOfLine(line);
  if (refs.length) return refs.every(pr => pr && typeof pr === 'object' && pr.status === 'Received');
  return Number(line.quantity) > 0 && Number(line.receivedQuantity) >= Number(line.quantity);
}

// ── Pure ──────────────────────────────────────────────────────────────────

// A PO with an advance has no dates until the full advance is paid — the
// vendor's delivery days count from that day (client, 2026-10-12).
export function awaitingAdvance(po) {
  return po?.deliveryClock?.startsOn === 'advance' && !po.deliveryClock.startedAt;
}

export function lineDueDate(line, po) {
  if (awaitingAdvance(po)) return null;
  return line?.expectedDeliveryDate || po?.expectedDeliveryDate || null;
}

// The line dates once the clock starts: start + each line's quoted days
// (lines without quoted days keep what they have). Returns [{ line, date }].
export function clockDates(po, start) {
  const base = new Date(start);
  return (po?.items || [])
    .filter(l => !l.cancelled?.at && Number(l.deliveryDays) > 0)
    .map(l => ({ line: l, date: new Date(base.getTime() + Number(l.deliveryDays) * DAY_MS) }));
}

// { bucket: 'overdue'|'today'|'soon'|'later', date, daysLate } — or null for a
// line that's received, cancelled or has no date. `received(line)` decides
// whether it has arrived.
export function lineDueBucket(line, po, received = lineIsReceived, now = new Date()) {
  if (!line || line.cancelled?.at || received(line)) return null;
  const date = lineDueDate(line, po);
  if (!date) return null;
  const today = startOfDay(now);
  const due = startOfDay(date);
  const diffDays = Math.round((due - today) / DAY_MS);
  if (diffDays < 0) return { bucket: 'overdue', date: new Date(date), daysLate: -diffDays };
  if (diffDays === 0) return { bucket: 'today', date: new Date(date), daysLate: 0 };
  if (diffDays <= SOON_DAYS) return { bucket: 'soon', date: new Date(date), daysLate: 0 };
  return { bucket: 'later', date: new Date(date), daysLate: 0 };
}

const RANK = { overdue: 0, today: 1, soon: 2, later: 3 };
export function poDueSummary(po, received = lineIsReceived, now = new Date()) {
  const counts = { overdue: 0, today: 0, soon: 0, later: 0 };
  let worst = null;
  // Only a real, open order has deliveries due — not one waiting for the
  // Company Admin, rejected or cancelled (2026-10-14).
  if (po?.status && !OPEN_PO_STATUSES.includes(po.status)) return { counts, worst };
  for (const line of po?.items || []) {
    const b = lineDueBucket(line, po, received, now);
    if (!b) continue;
    counts[b.bucket] += 1;
    if (!worst || RANK[b.bucket] < RANK[worst]) worst = b.bucket;
  }
  return { counts, worst };
}

// Purchase's revised date: 'YYYY-MM-DD', today or later, and the vendor's reason.
export function readRevisedDate(body, now = new Date()) {
  const raw = String(body?.date || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return { error: 'Pick the new expected date.' };
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (Number.isNaN(date.getTime()) || dayKey(date) !== raw) return { error: 'That isn\'t a valid date.' };
  if (raw < dayKey(now)) return { error: 'The new date can\'t be in the past.' };
  const reason = String(body?.reason || '').trim();
  if (!reason) return { error: 'Give the reason for the new date (what the vendor said).' };
  return { date, reason };
}

// ── DB ────────────────────────────────────────────────────────────────────

const storeAudience = (po) => ({ targetCompanyId: po.companyId });

// The PO just became a real order (direct, or approved) — tell Store. Also
// called with { advancePaid: true } when the advance starts the clock.
export async function notifyStoreOfIncomingPO(po, { advancePaid = false } = {}) {
  try {
    const live = (po.items || []).filter(l => !l.cancelled?.at);
    const vendorName = po.supplier?.supplierName
      || (await mongoose.model('Supplier').findById(po.supplier).select('supplierName').lean())?.supplierName || 'the vendor';
    const dates = live.map(l => lineDueDate(l, po)).filter(Boolean).map(d => new Date(d).getTime());
    const first = dates.length ? fmtDay(Math.min(...dates)) : '';
    const last = dates.length ? fmtDay(Math.max(...dates)) : '';
    const when = awaitingAdvance(po) ? 'dates are set when the advance is paid'
      : dates.length ? `expected ${first === last ? first : `${first} – ${last}`}` : 'no expected date';
    await notificationService.notifyRoles(['Store Head', 'Store Employee'], {
      title: advancePaid ? 'Advance paid — delivery dates set' : 'Incoming purchase order',
      message: `${po.purchaseOrderNumber} from ${vendorName}: ${live.map(l => l.itemName).join(', ')} — ${when}.`,
      type: 'purchase',
      ...storeAudience(po),
      data: { purchaseId: String(po._id), incomingPO: true },
    });
  } catch (err) {
    console.error('Notify Store of incoming PO failed:', err.message);
  }
}

// Purchase records the vendor's new date for one line. Returns { status,
// message } on refusal, or { line, from, to }.
export async function reviseLineDate({ po, lineId, body, user, req = null }) {
  if (!OPEN_PO_STATUSES.includes(po.status)) return { status: 409, message: `This PO is ${po.status} — its dates can't change.` };
  const line = po.items.id(lineId);
  if (!line) return { status: 404, message: 'Line not found on this PO.' };
  if (line.cancelled?.at) return { status: 409, message: 'This line was cancelled.' };
  if (awaitingAdvance(po)) return { status: 409, message: 'The delivery days start when the advance is paid — there\'s no date to change yet.' };
  const PurchaseRequest = mongoose.model('PurchaseRequest');
  const prs = await PurchaseRequest.find({ _id: { $in: prIdsOfLine(line).map(id => id?._id || id) } }).select('status').lean();
  if (prs.length && prs.every(pr => pr.status === 'Received')) return { status: 409, message: 'This line has already been received.' };
  const read = readRevisedDate(body);
  if (read.error) return { status: 400, message: read.error };

  const from = lineDueDate(line, po);
  line.deliveryDateHistory.push({ from, to: read.date, reason: read.reason, by: user?._id || null, byName: user?.fullName || user?.username || '', at: new Date() });
  line.expectedDeliveryDate = read.date;
  line.overdueNotifiedFor = null;
  // The PO's own date stays "the latest of its live lines".
  const liveDates = po.items.filter(l => !l.cancelled?.at).map(l => l.expectedDeliveryDate).filter(Boolean).map(d => new Date(d).getTime());
  if (liveDates.length) po.expectedDeliveryDate = new Date(Math.max(...liveDates));
  await po.save();

  await logPoEvent({
    po, user, req, action: 'date_revised',
    summary: `${line.itemName}: expected date changed from ${fmtDay(from) || 'none'} to ${fmtDay(read.date)} — ${read.reason}.`,
    details: { line: String(line._id), item: line.itemName, from, to: read.date, reason: read.reason },
  });
  try {
    await notificationService.notifyRoles(['Store Head', 'Store Employee'], {
      title: 'Delivery date changed',
      message: `${po.purchaseOrderNumber}: ${line.itemName} is now expected on ${fmtDay(read.date)} (was ${fmtDay(from) || 'not set'}). ${read.reason}`,
      type: 'purchase',
      ...storeAudience(po),
      data: { purchaseId: String(po._id) },
    });
  } catch (err) {
    console.error('Notify Store of a revised date failed:', err.message);
  }
  return { line, from, to: read.date };
}

// Daily: every late line not yet alerted for its current date → one alert per
// PO to whoever created it, an audit entry, and the line stamped.
export async function runOverdueDeliverySweep(now = new Date(), { companyId = null } = {}) {
  const Purchase = mongoose.model('Purchase');
  const query = { status: { $in: OPEN_PO_STATUSES } };
  if (companyId) query.companyId = companyId;
  const pos = await Purchase.find(query)
    .populate('supplier', 'supplierName')
    .populate('items.purchaseRequest', 'status')
    .populate('items.purchaseRequests', 'status');
  let alerted = 0;
  for (const po of pos) {
    const late = [];
    for (const line of po.items) {
      const b = lineDueBucket(line, po, lineIsReceived, now);
      if (!b || b.bucket !== 'overdue') continue;
      if (line.overdueNotifiedFor && dayKey(line.overdueNotifiedFor) === dayKey(b.date)) continue;
      late.push({ line, ...b });
    }
    if (!late.length) continue;
    const text = late.map(x => `${x.line.itemName} (due ${fmtDay(x.date)}, ${x.daysLate} day${x.daysLate === 1 ? '' : 's'} late)`).join(', ');
    try {
      if (po.createdBy) {
        await notificationService.createNotification({
          title: 'Delivery overdue',
          message: `${po.purchaseOrderNumber} from ${po.supplier?.supplierName || 'the vendor'} is late: ${text}. Follow up with the vendor and record the new date on Purchase Orders.`,
          type: 'purchase',
          targetUserId: po.createdBy,
          targetCompanyId: po.companyId,
          data: { purchaseId: String(po._id), overdue: true },
        });
      }
    } catch (err) {
      console.error('Overdue delivery notification failed:', err.message);
    }
    await logPoEvent({
      po, user: null, action: 'delivery_overdue',
      summary: `Delivery overdue: ${text}.`,
      details: { lines: late.map(x => ({ line: String(x.line._id), item: x.line.itemName, due: x.date, daysLate: x.daysLate })) },
    });
    for (const x of late) x.line.overdueNotifiedFor = x.date;
    // Stamp only — keep the populated refs out of the save.
    await Purchase.updateOne(
      { _id: po._id },
      { $set: Object.fromEntries(late.map(x => [`items.${po.items.indexOf(x.line)}.overdueNotifiedFor`, x.date])) }
    );
    alerted += 1;
  }
  return { checked: pos.length, alerted };
}
