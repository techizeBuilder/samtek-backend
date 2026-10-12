// Quote reminders (procurement-v2 point 16, 2026-10-10). User decision:
// nudge Purchase, and give them a "Send reminder" button — no automatic email
// to the vendor (it can feel pushy to vendors we know; Purchase may prefer to
// call).
//  - No reply: a quotation request emailed NO_REPLY_DAYS ago, still not
//    submitted, link still open → its sender is told, once.
//  - Link ran out: the request's link expired with items still unanswered →
//    its sender is told, once ("send a new request").
//  - Quote about to expire: a priced quote not yet ordered whose validity
//    ends within EXPIRY_WARN_DAYS → whoever asked for / entered it is told,
//    once per quote.
//  One notification per person per day, listing everything.
//  - "Send reminder": re-emails the vendor the same link, marked as a
//    reminder, with only the items still open — at most once a day.
import mongoose from 'mongoose';
import notificationService from './notificationService.js';
import { sendQuotationRequestEmail } from './emailService.js';
import { quoteValidUntil, DEFAULT_QUOTE_VALIDITY_DAYS } from './quoteChecksService.js';

export const NO_REPLY_DAYS = 3;
export const EXPIRY_WARN_DAYS = 2;
export const REMINDER_GAP_HOURS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '');

// ── Pure ──────────────────────────────────────────────────────────────────

// openCount = how many of its items still wait for this vendor's reply.
export function needsNoReplyNudge(qr, openCount, now = new Date()) {
  return qr.status === 'Sent' && qr.emailStatus !== 'Failed' && !qr.noReplyNotifiedAt && openCount > 0
    && new Date(qr.sentAt).getTime() <= now.getTime() - NO_REPLY_DAYS * DAY_MS
    && new Date(qr.tokenExpiry) > now;
}

// A link that ran out within the last week, with items still unanswered.
export function needsLinkExpiredNudge(qr, openCount, now = new Date()) {
  const expiry = new Date(qr.tokenExpiry);
  return ['Sent', 'Expired'].includes(qr.status) && !qr.linkExpiredNotifiedAt && openCount > 0
    && expiry <= now && expiry.getTime() > now.getTime() - 7 * DAY_MS;
}

// { until, daysLeft } for a priced quote expiring within EXPIRY_WARN_DAYS
// calendar days (today = 0), not yet warned — else null.
export function quoteExpiringSoon(bid, validityDays, now = new Date()) {
  if (bid.status !== 'Submitted' || bid.expiryNotifiedAt) return null;
  const until = quoteValidUntil(bid, validityDays);
  if (!until || until < now) return null;
  const daysLeft = Math.round((startOfDay(until) - startOfDay(now)) / DAY_MS);
  return daysLeft <= EXPIRY_WARN_DAYS ? { until, daysLeft } : null;
}

// Can Purchase send the vendor a reminder now? Returns an error message or null.
export function reminderBlocked(qr, openCount, now = new Date()) {
  if (qr.status === 'Submitted') return 'The vendor has already submitted this quotation.';
  if (new Date(qr.tokenExpiry) <= now) return 'This request\'s link has expired — send a new quotation request instead.';
  if (!openCount) return 'Every item on this request has been ordered or closed — nothing left to remind about.';
  const last = (qr.vendorReminders || []).filter(r => r.emailStatus !== 'Failed').slice(-1)[0];
  if (last && now.getTime() - new Date(last.at).getTime() < REMINDER_GAP_HOURS * DAY_MS / 24) {
    return `A reminder already went out ${fmt(last.at)} — you can send another tomorrow.`;
  }
  return null;
}

// ── DB ────────────────────────────────────────────────────────────────────

const models = () => ({
  QuotationRequest: mongoose.model('QuotationRequest'),
  VendorBid: mongoose.model('VendorBid'),
});

// Items on a request still waiting for this vendor (their quote row is Invited).
async function openItemsOf(qr) {
  const { VendorBid } = models();
  const open = await VendorBid.find({ quotationRequest: qr._id, status: 'Invited' }).select('_id').lean();
  const openIds = new Set(open.map(b => String(b._id)));
  return (qr.items || []).filter(it => openIds.has(String(it.vendorBid)));
}

// Purchase pressed "Send reminder". Returns { status, message } or { message, warning }.
export async function sendVendorReminder({ qr, user }) {
  const items = await openItemsOf(qr);
  const blocked = reminderBlocked(qr, items.length);
  if (blocked) return { status: 409, message: blocked };
  const vendor = await mongoose.model('Supplier').findById(qr.vendor).select('supplierName email').lean();
  if (!vendor?.email) return { status: 400, message: `${qr.vendorName || 'This vendor'} has no email address in Vendor Master.` };
  const company = await mongoose.model('Company').findById(qr.companyId).select('name').lean();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  let result;
  try {
    result = await sendQuotationRequestEmail({
      to: vendor.email,
      vendorName: vendor.supplierName,
      requestNo: qr.number,
      items,
      link: `${frontendUrl}/vendor-quotation/${qr.token}`,
      expiresAt: qr.tokenExpiry,
      companyName: company?.name || 'Samtek',
      reminder: true,
    });
  } catch (err) {
    result = { success: false, error: err.message };
  }
  qr.vendorReminders.push({ at: new Date(), by: user?._id || null, byName: user?.fullName || user?.username || '', emailStatus: result.success ? 'Sent' : 'Failed', emailError: result.success ? '' : (result.error || '') });
  await qr.save();
  if (!result.success) return { status: 502, message: `The reminder didn't go out: ${result.error}. Try again later, or call the vendor.` };
  return { message: `Reminder sent to ${vendor.supplierName} for ${qr.number} (${items.length} item${items.length === 1 ? '' : 's'} still open).` };
}

// Daily sweep. Returns { notified, noReply, linkExpired, expiring }.
export async function runQuoteReminderSweep(now = new Date(), { companyId = null } = {}) {
  const { QuotationRequest, VendorBid } = models();
  const scope = companyId ? { companyId } : {};
  const byPerson = new Map(); // `${company}|${user}` -> { companyId, userId, lines: [] }
  const add = (company, user, line) => {
    if (!user) return;
    const key = `${company}|${user}`;
    if (!byPerson.has(key)) byPerson.set(key, { companyId: company, userId: user, lines: [] });
    byPerson.get(key).lines.push(line);
  };
  const stats = { noReply: 0, linkExpired: 0, expiring: 0 };

  // 1 + 2. Requests with no reply / a link that ran out.
  const requests = await QuotationRequest.find({ ...scope, status: { $in: ['Sent', 'Expired'] }, $or: [{ noReplyNotifiedAt: null }, { linkExpiredNotifiedAt: null }] });
  for (const qr of requests) {
    const open = await openItemsOf(qr);
    if (needsNoReplyNudge(qr, open.length, now)) {
      const days = Math.floor((now - new Date(qr.sentAt)) / DAY_MS);
      add(String(qr.companyId), qr.createdBy && String(qr.createdBy), `${qr.number} to ${qr.vendorName}: no reply after ${days} days (${open.length} item${open.length === 1 ? '' : 's'}) — send a reminder or call them.`);
      qr.noReplyNotifiedAt = now;
      await QuotationRequest.updateOne({ _id: qr._id }, { noReplyNotifiedAt: now });
      stats.noReply += 1;
    } else if (needsLinkExpiredNudge(qr, open.length, now)) {
      add(String(qr.companyId), qr.createdBy && String(qr.createdBy), `${qr.number} to ${qr.vendorName}: the link expired ${fmt(qr.tokenExpiry)} with no reply — send a new quotation request if you still want their price.`);
      await QuotationRequest.updateOne({ _id: qr._id }, { linkExpiredNotifiedAt: now });
      stats.linkExpired += 1;
    }
  }

  // 3. Priced quotes about to expire, on items not yet ordered.
  const bids = await VendorBid.find({ ...scope, status: 'Submitted', expiryNotifiedAt: null, group: { $ne: null } })
    .populate('group', 'status')
    .populate('quotationRequest', 'createdBy number')
    .populate('manualQuotation', 'createdBy number')
    .lean();
  const validityByCompany = new Map();
  const { getOrCreateSettings } = await import('../controllers/purchaseSettingsController.js');
  for (const bid of bids) {
    if (bid.group?.status !== 'Open') continue;
    const cid = String(bid.companyId);
    if (!validityByCompany.has(cid)) {
      validityByCompany.set(cid, (await getOrCreateSettings(bid.companyId)).quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS);
    }
    const soon = quoteExpiringSoon(bid, validityByCompany.get(cid), now);
    if (!soon) continue;
    const owner = bid.quotationRequest?.createdBy || bid.manualQuotation?.createdBy || null;
    const when = soon.daysLeft === 0 ? 'today' : soon.daysLeft === 1 ? 'tomorrow' : `on ${fmt(soon.until)}`;
    add(cid, owner && String(owner), `${bid.vendorName}'s quote for ${bid.productName} (₹${bid.unitPrice}) expires ${when} — order it or ask for a fresh quote.`);
    await VendorBid.updateOne({ _id: bid._id }, { expiryNotifiedAt: now });
    stats.expiring += 1;
  }

  // One notification per person.
  let notified = 0;
  for (const { companyId: cid, userId, lines } of byPerson.values()) {
    try {
      await notificationService.createNotification({
        title: `Quotes to follow up (${lines.length})`,
        message: lines.join('\n'),
        type: 'purchase',
        targetUserId: userId,
        targetCompanyId: cid,
        data: { quoteReminder: true },
      });
      notified += 1;
    } catch (err) {
      console.error('Quote reminder notification failed:', err.message);
    }
  }
  return { notified, ...stats };
}
