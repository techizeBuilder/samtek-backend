// Vendor Master v2 — approval lifecycle (procurement-v2, 2026-10-08).
// One place for: who counts as an eligible vendor, which fields need
// re-approval, a vendor's derived standing (Probationary / Active /
// Watchlist), what's required before submitting for approval, applying an
// approved request, and the daily document-expiry reminder.
//
// Every approval here belongs to the Company Admin (client decision: any
// approval the blueprint gives Purchase Head / Manager / Management goes to
// the Company Admin), on the "Purchase & Vendor Approval" page.
import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import notificationService from './notificationService.js';
import { computeVendorRating } from './vendorRatingService.js';

// Thresholds for the derived stages — constants for now, meant to move into
// a config master later (procurement-v2 workflow doc, Phase 0).
export const PROBATION_RECEIVED_PO_COUNT = 3;
export const WATCHLIST_RATING_BELOW = 3.0;
export const WATCHLIST_MIN_EVENTS = 5;
export const EXPIRY_REMINDER_DAYS = 30;
// A vendor who refused to replace or refund rejected material goes on
// Watchlist for this long (2026-10-12, client case 1).
export const DISPUTE_WATCHLIST_DAYS = 90;

// Only these vendors can be quoted or given a PO. Invoices, payments,
// returns and ratings are deliberately NOT gated — money already owed to a
// suspended vendor still has to be paid.
export const ELIGIBLE_VENDOR_FILTER = { approvalStatus: 'Approved', status: 'active' };

// On an already-approved vendor, a change to any of these goes to the
// Company Admin instead of saving straight away (client decision: bank
// details + legal identity).
export const SENSITIVE_FIELDS = ['supplierName', 'gstNumber', 'panNumber', 'bankDetails'];
const BANK_KEYS = ['accountName', 'accountNumber', 'bankName', 'branchName', 'ifscCode'];
export const SENSITIVE_LABELS = {
  supplierName: 'Legal Name',
  gstNumber: 'GSTIN',
  panNumber: 'PAN',
  bankDetails: 'Bank Details',
};

// Never accepted from a request body — only the approval flow sets these.
const SERVER_CONTROLLED_FIELDS = [
  'approvalStatus', 'approvedBy', 'approvedAt', 'rejectionReason', 'restriction',
  'verification', 'activity', 'documents', 'createdBy', 'updatedBy', 'companyId',
];

export function stripServerControlled(body) {
  for (const key of SERVER_CONTROLLED_FIELDS) delete body[key];
  return body;
}

export function eligibleVendorError(vendor) {
  if (!vendor) return 'Vendor not found';
  if (vendor.approvalStatus !== 'Approved') {
    return `${vendor.supplierName} is ${vendor.approvalStatus || 'not approved'} — only vendors approved by the Company Admin can be quoted or ordered from.`;
  }
  if (vendor.status !== 'active') return `${vendor.supplierName} is marked Inactive.`;
  return null;
}

const userName = (user) => user?.fullName || user?.username || user?.name || '';

export function activityEntry(action, user, remarks = '') {
  return { action, by: user?._id || null, byName: userName(user), at: new Date(), remarks };
}

const norm = (v) => String(v ?? '').trim();

// Which sensitive fields in `body` actually differ from the live vendor.
// Returns { changes, previous } — both keyed by field; empty when nothing
// sensitive changed. bankDetails is compared key by key but proposed/stored
// as a whole object.
export function diffSensitiveFields(vendor, body) {
  const changes = {};
  const previous = {};
  for (const field of SENSITIVE_FIELDS) {
    if (!(field in body)) continue;
    if (field === 'bankDetails') {
      const next = body.bankDetails || {};
      const cur = vendor.bankDetails || {};
      const differs = BANK_KEYS.some(k => k in next && norm(next[k]) !== norm(cur[k]));
      if (differs) {
        changes.bankDetails = Object.fromEntries(BANK_KEYS.map(k => [k, norm(k in next ? next[k] : cur[k])]));
        previous.bankDetails = Object.fromEntries(BANK_KEYS.map(k => [k, norm(cur[k])]));
      }
    } else if (norm(body[field]) !== norm(vendor[field])) {
      changes[field] = norm(body[field]);
      previous[field] = norm(vendor[field]);
    }
  }
  return { changes, previous };
}

// What's still missing before a vendor can be submitted for approval — a
// list of plain sentences shown to Purchase as-is. Empty = ready.
export function validateForSubmission(vendor) {
  const missing = [];
  const docs = vendor.documents || [];
  const hasDoc = (type) => docs.some(d => d.docType === type);

  if (!norm(vendor.panNumber)) missing.push('PAN number');
  if (!norm(vendor.phone)) missing.push('Phone');
  if (!norm(vendor.email)) missing.push('Email');
  if (!norm(vendor.address?.city) || !norm(vendor.address?.state) || !norm(vendor.address?.zipCode)) {
    missing.push('Registered address (city, state and pincode)');
  }
  const bank = vendor.bankDetails || {};
  if (BANK_KEYS.some(k => !norm(bank[k]))) missing.push('Complete bank details (account name, number, bank, branch, IFSC)');
  if (!vendor.riskClass) missing.push('Risk class');
  if (vendor.conflictOfInterest?.declared == null) missing.push('Conflict-of-interest declaration');
  if (!(vendor.suppliedItems || []).length && !(vendor.services || []).length) {
    missing.push('At least one Product or Service (the "Products & Services" button on the vendor card)');
  }
  if (!hasDoc('PAN Card')) missing.push('PAN Card document');
  if (norm(vendor.gstNumber) && !hasDoc('GST Certificate')) missing.push('GST Certificate document (a GSTIN is entered)');
  if (!hasDoc('Cancelled Cheque/Bank Proof')) missing.push('Cancelled cheque / bank proof document');
  return missing;
}

// Derived stage for each vendor — never stored. Non-approved vendors just
// echo their approvalStatus. An Approved vendor is:
//   Watchlist     — rating below WATCHLIST_RATING_BELOW with at least
//                   WATCHLIST_MIN_EVENTS rating events (checked first)
//   Probationary  — fewer than PROBATION_RECEIVED_PO_COUNT POs with a
//                   received line
//   Active        — otherwise
// Rating = the existing computeVendorRating (on-time delivery + QC).
export async function getVendorStanding(companyId, vendors) {
  const standing = new Map();
  const approved = vendors.filter(v => v.approvalStatus === 'Approved');
  for (const v of vendors) {
    if (v.approvalStatus !== 'Approved') standing.set(String(v._id), { stage: v.approvalStatus || 'Draft' });
  }
  if (!approved.length) return standing;

  const approvedIds = approved.map(v => v._id);
  const pos = await Purchase.find({ companyId, supplier: { $in: approvedIds } }).select('_id supplier').lean();
  const poToVendor = new Map(pos.map(p => [String(p._id), String(p.supplier)]));
  const receivedPoIds = pos.length
    ? await PurchaseRequest.distinct('purchaseOrder', { purchaseOrder: { $in: pos.map(p => p._id) }, status: 'Received' })
    : [];
  const receivedCount = new Map();
  for (const poId of receivedPoIds) {
    const vid = poToVendor.get(String(poId));
    if (vid) receivedCount.set(vid, (receivedCount.get(vid) || 0) + 1);
  }

  for (const v of approved) {
    const id = String(v._id);
    const ratingInfo = await computeVendorRating({ companyId, vendorId: v._id });
    const { rating, eventCount } = ratingInfo;
    const receivedPOCount = receivedCount.get(id) || 0;
    let stage = 'Active';
    let watchReason = null;
    const lastDispute = ratingInfo.disputes?.lastAt ? new Date(ratingInfo.disputes.lastAt) : null;
    if (lastDispute && Date.now() - lastDispute.getTime() <= DISPUTE_WATCHLIST_DAYS * 24 * 60 * 60 * 1000) {
      stage = 'Watchlist';
      watchReason = 'Refused to replace or refund QC-rejected material';
    } else if (rating != null && eventCount >= WATCHLIST_MIN_EVENTS && rating < WATCHLIST_RATING_BELOW) {
      stage = 'Watchlist';
      watchReason = `Rating below ${WATCHLIST_RATING_BELOW}`;
    } else if (receivedPOCount < PROBATION_RECEIVED_PO_COUNT) stage = 'Probationary';
    standing.set(id, { stage, watchReason, ...ratingInfo, receivedPOCount });
  }
  return standing;
}

// Applies an APPROVED request to its vendor and saves it. `extras` carries
// the reviewer's input for a NewVendor approval (verification checklist,
// optional risk class override).
export async function applyApprovedRequest(request, reviewer, extras = {}) {
  const vendor = await Supplier.findOne({ _id: request.vendor, companyId: request.companyId });
  if (!vendor) throw new Error('Vendor no longer exists');
  const remarks = request.reviewRemarks || '';

  switch (request.type) {
    case 'NewVendor': {
      vendor.approvalStatus = 'Approved';
      vendor.approvedBy = reviewer._id;
      vendor.approvedAt = new Date();
      vendor.rejectionReason = '';
      const v = extras.verification || {};
      vendor.verification = {
        gstVerified: !!v.gstVerified,
        panVerified: !!v.panVerified,
        bankVerified: !!v.bankVerified,
        documentsVerified: !!v.documentsVerified,
        remarks: v.remarks || remarks,
        verifiedBy: reviewer._id,
        verifiedAt: new Date(),
      };
      if (['Low', 'Medium', 'High'].includes(extras.riskClass)) vendor.riskClass = extras.riskClass;
      vendor.activity.push(activityEntry('Approved', reviewer, remarks));
      break;
    }
    case 'DetailsChange': {
      const changes = request.payload || {};
      for (const field of SENSITIVE_FIELDS) {
        if (field in changes) vendor[field] = changes[field];
      }
      const labels = Object.keys(changes).map(f => SENSITIVE_LABELS[f] || f).join(', ');
      vendor.activity.push(activityEntry(`Change approved: ${labels}`, reviewer, remarks));
      break;
    }
    case 'Suspend':
    case 'Blacklist': {
      vendor.approvalStatus = request.type === 'Suspend' ? 'Suspended' : 'Blacklisted';
      vendor.restriction = {
        reason: request.payload?.reason || '',
        effectiveDate: new Date(),
        reviewDate: request.payload?.reviewDate ? new Date(request.payload.reviewDate) : null,
      };
      vendor.activity.push(activityEntry(vendor.approvalStatus, reviewer, request.payload?.reason || remarks));
      break;
    }
    case 'Reinstate': {
      vendor.approvalStatus = 'Approved';
      vendor.restriction = { reason: '', effectiveDate: null, reviewDate: null };
      vendor.activity.push(activityEntry('Reinstated', reviewer, request.payload?.reason || remarks));
      break;
    }
    default:
      throw new Error(`Unknown request type ${request.type}`);
  }
  vendor.updatedBy = reviewer._id;
  await vendor.save();
  return vendor;
}

export const REQUEST_TYPE_LABELS = {
  NewVendor: 'New vendor approval',
  DetailsChange: 'Vendor detail change',
  Suspend: 'Vendor suspension',
  Blacklist: 'Vendor blacklisting',
  Reinstate: 'Vendor reinstatement',
};

export async function notifyCompanyAdminOfRequest(request, vendor, requester) {
  try {
    await notificationService.createNotification({
      title: `${REQUEST_TYPE_LABELS[request.type]} needs approval`,
      message: `${vendor.supplierName} — requested by ${userName(requester) || 'Purchase'}`,
      type: 'purchase',
      targetRole: 'Company Admin',
      targetCompanyId: request.companyId,
      data: { requestId: String(request._id), vendorId: String(vendor._id), type: request.type },
    });
  } catch (err) {
    console.error('Notify Company Admin of vendor approval request failed:', err);
  }
}

export async function notifyRequesterOfDecision(request, vendor) {
  try {
    await notificationService.createNotification({
      title: `${REQUEST_TYPE_LABELS[request.type]} ${request.status.toLowerCase()}`,
      message: `${vendor?.supplierName || 'Vendor'}${request.reviewRemarks ? ` — ${request.reviewRemarks}` : ''}`,
      type: 'purchase',
      targetUserId: request.requestedBy,
      targetCompanyId: request.companyId,
      data: { requestId: String(request._id), vendorId: String(request.vendor), type: request.type },
    });
  } catch (err) {
    console.error('Notify requester of vendor approval decision failed:', err);
  }
}

// Daily: remind Purchase (Accounts / Accounts Head) and the Company Admin
// about vendor documents expiring within EXPIRY_REMINDER_DAYS and on the
// day they expire. Each reminder fires once per document (reminded* flags).
// An expiry date is a calendar DAY (stored as that day's UTC midnight from a
// date input) — compared as 'YYYY-MM-DD' strings, never as timestamps, so a
// document is valid through its expiry date and not "expired" from 5:30 AM IST
// on that same day.
const pad2 = (n) => String(n).padStart(2, '0');
const localDayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const storedDayKey = (d) => new Date(d).toISOString().slice(0, 10);

export async function runVendorDocumentExpirySweep() {
  const now = new Date();
  const todayKey = localDayKey(now);
  const horizonKey = localDayKey(new Date(now.getTime() + EXPIRY_REMINDER_DAYS * 24 * 60 * 60 * 1000));
  // Coarse DB filter (one extra day of slack), exact day check below.
  const horizon = new Date(now.getTime() + (EXPIRY_REMINDER_DAYS + 1) * 24 * 60 * 60 * 1000);
  const vendors = await Supplier.find({ documents: { $elemMatch: { expiryDate: { $ne: null, $lte: horizon } } } });
  let sent = 0;
  for (const vendor of vendors) {
    let changed = false;
    for (const doc of vendor.documents) {
      if (!doc.expiryDate) continue;
      const dayKey = storedDayKey(doc.expiryDate);
      if (dayKey > horizonKey) continue;
      // "On the day" reminder covers the expiry day itself and anything
      // already past it; the earlier one covers the 30-day window before.
      const dueOrPast = dayKey <= todayKey;
      if (dueOrPast && doc.remindedOnExpiry) continue;
      if (!dueOrPast && doc.remindedBeforeExpiry) continue;
      const [y, m, d] = dayKey.split('-');
      const when = `${d}/${m}/${y}`;
      const phrase = dayKey < todayKey ? `expired on ${when}` : dayKey === todayKey ? `expires today (${when})` : `expires on ${when}`;
      try {
        await notificationService.notifyRoles(['Accounts', 'Accounts Head', 'Company Admin'], {
          title: dayKey < todayKey ? 'Vendor document expired' : 'Vendor document expiring',
          message: `${vendor.supplierName}: ${doc.docType} ${phrase}`,
          type: 'purchase',
          targetCompanyId: vendor.companyId,
          data: { vendorId: String(vendor._id), documentId: String(doc._id) },
        });
        sent++;
      } catch (err) {
        console.error('Vendor document expiry notification failed:', err);
        continue;
      }
      if (dueOrPast) { doc.remindedOnExpiry = true; doc.remindedBeforeExpiry = true; }
      else doc.remindedBeforeExpiry = true;
      changed = true;
    }
    if (changed) await vendor.save();
  }
  return sent;
}
