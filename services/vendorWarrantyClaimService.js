// Vendor warranty claims (procurement-v2, serial numbers Part 2, 2026-10-13 —
// models/VendorWarrantyClaim.js). Raised by hand on Complaints → Support from
// the serial a customer gives: found in our serial records (PurchasedUnit,
// Part 1) the vendor / PO / warranty months come from there; not found, the
// vendor + item are picked and the months come from the item's own warranty.
//
// A claim is open until its outcome is recorded — closing it needs the
// resolved date and our satisfaction with how the vendor handled it (1–5).
// Everything is checked before anything is written (no transactions here).
import mongoose from 'mongoose';
import VendorWarrantyClaim, { DEFECT_TYPES, SEVERITIES, UNDER_WARRANTY, CLAIM_OUTCOMES } from '../models/VendorWarrantyClaim.js';
import PurchasedUnit from '../models/PurchasedUnit.js';
import notificationService from './notificationService.js';
import { serialKeyOf } from './purchasedUnitService.js';

export const MAX_EVIDENCE = 5;
export const RESOLVED_OUTCOMES = ['Repaired', 'Replaced', 'Credit note'];
const DAY = 24 * 60 * 60 * 1000;

// ── Pure helpers ───────────────────────────────────────────────────────────

const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

// 'YYYY-MM-DD' → that day at noon; '' → null; anything else → { error }.
export function parseDay(raw, label, now = new Date()) {
  const s = String(raw ?? '').trim();
  if (!s) return { date: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { error: `${label} isn't a real date.` };
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) return { error: `${label} isn't a real date.` };
  if (date.getTime() > now.getTime() + DAY) return { error: `${label} can't be in the future.` };
  return { date };
}

const has = (body, k) => Object.prototype.hasOwnProperty.call(body || {}, k);
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// The claim fields Store / Complaints sent — only the ones present. Returns
// { error } or { fields }.
export function readClaimInput(body, now = new Date()) {
  const f = {};
  for (const [k, max] of [['problem', 2000], ['customerName', 120], ['ticketRef', 60], ['vendorResponse', 2000], ['notes', 2000]]) {
    if (has(body, k)) f[k] = text(body[k], max);
  }
  const pick = (k, list, label) => {
    if (!has(body, k) || body[k] === '' || body[k] == null) return null;
    if (!list.includes(body[k])) return `${label} must be one of: ${list.join(', ')}.`;
    f[k] = body[k];
    return null;
  };
  const enumErr = pick('defectType', DEFECT_TYPES, 'Defect type') || pick('severity', SEVERITIES, 'Severity')
    || pick('underWarranty', UNDER_WARRANTY, 'Under vendor warranty') || pick('outcome', CLAIM_OUTCOMES, 'Outcome');
  if (enumErr) return { error: enumErr };
  for (const [k, label] of [['reportedToVendorAt', 'The date the vendor was told'], ['vendorRespondedAt', 'The vendor\'s response date'], ['resolvedAt', 'The resolved date']]) {
    if (!has(body, k)) continue;
    const d = parseDay(body[k], label, now);
    if (d.error) return { error: d.error };
    f[k] = d.date;
  }
  if (has(body, 'costToUs') && body.costToUs !== '') {
    const n = Number(body.costToUs);
    if (!Number.isFinite(n) || n < 0) return { error: 'Cost to us must be 0 or more.' };
    f.costToUs = Math.round(n * 100) / 100;
  }
  if (has(body, 'satisfactionRating') && body.satisfactionRating !== '') {
    const r = Number(body.satisfactionRating);
    if (!Number.isInteger(r) || r < 1 || r > 5) return { error: 'Satisfaction is 1 to 5 stars.' };
    f.satisfactionRating = r;
  }
  if (has(body, 'satisfactionComment')) f.satisfactionComment = text(body.satisfactionComment, 1000);
  return { fields: f };
}

export function claimStatus(c) {
  if (c.outcome) return 'Closed';
  if (c.vendorRespondedAt) return 'Vendor responded';
  return 'Waiting for vendor';
}

// The whole claim (as it would be saved) — returns an error message or null.
export function checkClaim(c) {
  if (!String(c.problem || '').trim()) return 'Describe the problem.';
  if (!c.reportedToVendorAt) return 'Enter the date the vendor was told.';
  const reported = new Date(c.reportedToVendorAt).getTime();
  if (c.vendorRespondedAt && new Date(c.vendorRespondedAt).getTime() < reported) return 'The vendor can\'t have responded before they were told.';
  if (c.resolvedAt && new Date(c.resolvedAt).getTime() < reported) return 'It can\'t be resolved before the vendor was told.';
  if (c.outcome) {
    if (!c.resolvedAt) return 'Enter the date it was resolved.';
    if (!(c.satisfaction?.rating >= 1)) return 'Rate how satisfied we are with the vendor\'s handling (1–5 stars) to close the claim.';
  } else if (c.resolvedAt || c.satisfaction?.rating) {
    return 'Pick the outcome to close the claim.';
  }
  return null;
}

const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY));

// Numbers for the vendor score (blueprint §11: response time, resolution).
export function claimStats(claims) {
  const s = { count: claims.length, open: 0, closed: 0, resolved: 0, refused: 0, avgResponseDays: null, resolvedPct: null, avgSatisfaction: null };
  const resp = [];
  const stars = [];
  for (const c of claims) {
    if (c.outcome) s.closed += 1; else s.open += 1;
    if (RESOLVED_OUTCOMES.includes(c.outcome)) s.resolved += 1;
    if (c.outcome === 'Refused' || c.outcome === 'Not covered') s.refused += 1;
    if (c.vendorRespondedAt && c.reportedToVendorAt) resp.push(daysBetween(c.reportedToVendorAt, c.vendorRespondedAt));
    if (c.satisfaction?.rating) stars.push(c.satisfaction.rating);
  }
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  s.avgResponseDays = avg(resp);
  s.avgSatisfaction = avg(stars);
  s.resolvedPct = s.closed ? Math.round((s.resolved / s.closed) * 100) : null;
  return s;
}

// ── DB ─────────────────────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const userName = (u) => u?.fullName || u?.username || '';
const evidenceOf = (files = []) => files.map(f => ({ url: `/uploads/warranty-claims/${f.filename}`, name: f.originalname || f.filename, at: new Date() }));

// The serial a customer gave → our received units with it (several items
// can share a serial), each with the claims already made on that serial.
export async function lookupSerial(companyId, serial) {
  const key = serialKeyOf(serial);
  if (!key) return [];
  const units = await PurchasedUnit.find({ companyId, serialKey: key }).sort({ receivedAt: -1 }).limit(20).lean();
  const claims = await VendorWarrantyClaim.find({ companyId, serialKey: key })
    .select('number itemName vendorName status outcome reportedToVendorAt satisfaction purchasedUnit').sort({ createdAt: -1 }).lean();
  return units.map(u => ({
    _id: u._id, serialNumber: u.serialNumber, isLot: u.isLot, lotQty: u.lotQty, qtyUnit: u.qtyUnit,
    item: u.item, itemName: u.itemName, vendor: u.vendor, vendorName: u.vendorName,
    purchaseOrder: u.purchaseOrder, poNumber: u.poNumber, receivedAt: u.receivedAt,
    vendorWarrantyMonths: u.vendorWarrantyMonths, warrantyCardUrl: u.warrantyCardUrl, status: u.status,
    claims: claims.filter(c => !c.purchasedUnit || String(c.purchasedUnit) === String(u._id)),
  }));
}

async function nextNumberCreate(doc) {
  for (let i = 0; i < 5; i++) {
    try {
      const n = await VendorWarrantyClaim.countDocuments({ companyId: doc.companyId });
      return await VendorWarrantyClaim.create({ ...doc, number: `VWC-${String(n + 1 + i).padStart(4, '0')}` });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  throw new Error('could not number the claim');
}

// Returns { status, message } on a refusal, or { claim }.
export async function createClaim({ companyId, user, body = {}, files = [], now = new Date() }) {
  const read = readClaimInput(body, now);
  if (read.error) return { status: 400, message: read.error };
  const f = read.fields;
  if (files.length > MAX_EVIDENCE) return { status: 400, message: `Up to ${MAX_EVIDENCE} evidence files.` };

  const Supplier = mongoose.model('Supplier');
  const doc = { companyId };
  if (body.purchasedUnit) {
    if (!mongoose.isValidObjectId(body.purchasedUnit)) return { status: 400, message: 'That unit wasn\'t found.' };
    const unit = await PurchasedUnit.findOne({ _id: body.purchasedUnit, companyId }).lean();
    if (!unit) return { status: 404, message: 'That unit wasn\'t found in our serial records.' };
    if (!unit.vendor) return { status: 400, message: 'This unit has no vendor on record — enter the claim by picking the vendor.' };
    Object.assign(doc, {
      purchasedUnit: unit._id, serialNumber: unit.serialNumber, serialKey: unit.serialKey,
      item: unit.item, itemName: unit.itemName, vendor: unit.vendor, vendorName: unit.vendorName,
      purchaseOrder: unit.purchaseOrder, poNumber: unit.poNumber, receivedAt: unit.receivedAt,
      vendorWarrantyMonths: unit.vendorWarrantyMonths || 0, monthsSource: 'serial',
    });
    if (!doc.vendorName) doc.vendorName = (await Supplier.findById(unit.vendor).select('supplierName').lean())?.supplierName || '';
  } else {
    const serial = text(body.serialNumber, 80);
    if (!serial) return { status: 400, message: 'Enter the serial number the customer gave.' };
    if (!mongoose.isValidObjectId(body.vendor)) return { status: 400, message: 'Pick the vendor.' };
    const vendor = await Supplier.findOne({ _id: body.vendor, companyId }).select('supplierName').lean();
    if (!vendor) return { status: 404, message: 'That vendor wasn\'t found.' };
    let item = null;
    if (body.item) {
      if (!mongoose.isValidObjectId(body.item)) return { status: 400, message: 'That item wasn\'t found.' };
      const { Item } = await import('../models/Inventory.js');
      item = await Item.findOne({ _id: body.item, companyId }).select('name warranty.period').lean();
      if (!item) return { status: 404, message: 'That item wasn\'t found.' };
    }
    const itemName = item?.name || text(body.itemName, 200);
    if (!itemName) return { status: 400, message: 'Pick the item.' };
    Object.assign(doc, {
      serialNumber: serial, serialKey: serialKeyOf(serial), item: item?._id || null, itemName,
      vendor: vendor._id, vendorName: vendor.supplierName, vendorWarrantyMonths: Number(item?.warranty?.period) || 0, monthsSource: 'item',
    });
  }

  const claim = {
    ...doc,
    problem: f.problem || '',
    defectType: f.defectType || 'Other',
    severity: f.severity || 'Major',
    underWarranty: f.underWarranty || 'Unsure',
    customerName: f.customerName || '',
    ticketRef: f.ticketRef || '',
    reportedToVendorAt: f.reportedToVendorAt || null,
    vendorRespondedAt: f.vendorRespondedAt || null,
    vendorResponse: f.vendorResponse || '',
    outcome: f.outcome || null,
    resolvedAt: f.resolvedAt || null,
    costToUs: f.costToUs || 0,
    notes: f.notes || '',
    satisfaction: { rating: f.satisfactionRating || null, comment: f.satisfactionComment || '' },
    evidence: evidenceOf(files),
    createdBy: user?._id || null,
    createdByName: userName(user),
  };
  const err = checkClaim(claim);
  if (err) return { status: 400, message: err };
  claim.status = claimStatus(claim);
  claim.history = [{ at: now, by: user?._id || null, byName: userName(user), text: `Claim raised — vendor told on ${fmtDay(claim.reportedToVendorAt)}.${claim.outcome ? ` Closed: ${claim.outcome}, ${claim.satisfaction.rating}★.` : claim.vendorRespondedAt ? ` Vendor responded on ${fmtDay(claim.vendorRespondedAt)}.` : ''}` }];

  const saved = await nextNumberCreate(claim);

  // Purchase deals with the vendor: tell whoever placed the PO (or Purchase).
  try {
    const message = `${saved.number}: warranty claim on ${saved.itemName}${saved.serialNumber ? ` (serial ${saved.serialNumber})` : ''} from ${saved.vendorName}${saved.poNumber ? `, ${saved.poNumber}` : ''} — ${saved.problem.slice(0, 120)}`;
    const po = saved.purchaseOrder ? await mongoose.model('Purchase').findById(saved.purchaseOrder).select('createdBy').lean() : null;
    const notif = { title: 'Vendor warranty claim raised', message, type: 'purchase', targetCompanyId: companyId, data: { claimId: String(saved._id), vendorId: String(saved.vendor) } };
    if (po?.createdBy) await notificationService.createNotification({ ...notif, targetUserId: po.createdBy });
    else await notificationService.notifyRoles(['Accounts Head', 'Account Employee'], notif);
  } catch (e) {
    console.error('Notify Purchase of a warranty claim failed:', e.message);
  }
  return { claim: saved };
}

// Records the vendor's response or closes the claim. Returns { status, message } or { claim }.
export async function updateClaim({ id, companyId, user, body = {}, files = [], now = new Date() }) {
  if (!mongoose.isValidObjectId(id)) return { status: 404, message: 'Claim not found.' };
  const claim = await VendorWarrantyClaim.findOne({ _id: id, companyId });
  if (!claim) return { status: 404, message: 'Claim not found.' };
  if (claim.status === 'Closed') return { status: 409, message: `${claim.number} is closed — it can't be changed.` };
  const read = readClaimInput(body, now);
  if (read.error) return { status: 400, message: read.error };
  if (claim.evidence.length + files.length > MAX_EVIDENCE) return { status: 400, message: `Up to ${MAX_EVIDENCE} evidence files per claim (${claim.evidence.length} already attached).` };
  const f = read.fields;

  const before = { responded: claim.vendorRespondedAt, outcome: claim.outcome };
  for (const k of ['problem', 'customerName', 'ticketRef', 'vendorResponse', 'notes', 'defectType', 'severity', 'underWarranty', 'reportedToVendorAt', 'vendorRespondedAt', 'resolvedAt', 'outcome', 'costToUs']) {
    if (k in f) claim[k] = f[k];
  }
  if ('satisfactionRating' in f) claim.satisfaction.rating = f.satisfactionRating;
  if ('satisfactionComment' in f) claim.satisfaction.comment = f.satisfactionComment;
  if (files.length) claim.evidence.push(...evidenceOf(files));

  const err = checkClaim(claim);
  if (err) return { status: 400, message: err };
  claim.status = claimStatus(claim);

  const parts = [];
  if (!before.responded && claim.vendorRespondedAt) parts.push(`Vendor responded on ${fmtDay(claim.vendorRespondedAt)}`);
  if (!before.outcome && claim.outcome) parts.push(`Closed: ${claim.outcome} on ${fmtDay(claim.resolvedAt)}, ${claim.satisfaction.rating}★${claim.costToUs ? `, cost ₹${claim.costToUs.toLocaleString('en-IN')}` : ''}`);
  if (files.length) parts.push(`${files.length} evidence file${files.length > 1 ? 's' : ''} added`);
  claim.history.push({ at: now, by: user?._id || null, byName: userName(user), text: (parts.join('. ') || 'Details updated') + '.' });
  await claim.save();
  return { claim };
}

export async function listClaims({ companyId, status = '', search = '', vendorId = '', page = 1, limit = 30 }) {
  const q = { companyId };
  if (status === 'open') q.status = { $ne: 'Closed' };
  else if (status && status !== 'all') q.status = status;
  if (vendorId && mongoose.isValidObjectId(vendorId)) q.vendor = vendorId;
  const s = String(search || '').trim();
  if (s) {
    const re = new RegExp(escapeRe(s), 'i');
    q.$or = [{ number: re }, { serialKey: new RegExp(escapeRe(s.toUpperCase())) }, { vendorName: re }, { itemName: re }, { customerName: re }, { ticketRef: re }];
  }
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const pg = Math.max(Number(page) || 1, 1);
  const [rows, total, open] = await Promise.all([
    VendorWarrantyClaim.find(q).sort({ status: 1, reportedToVendorAt: -1, _id: -1 }).skip((pg - 1) * lim).limit(lim).lean(),
    VendorWarrantyClaim.countDocuments(q),
    VendorWarrantyClaim.countDocuments({ companyId, status: { $ne: 'Closed' } }),
  ]);
  return { rows, total, open, page: pg, limit: lim };
}

// Per vendor: the claim numbers the vendor score will use.
export async function vendorClaimSummary(companyId, vendorIds = []) {
  const claims = await VendorWarrantyClaim.find({ companyId, vendor: { $in: vendorIds } })
    .select('vendor outcome reportedToVendorAt vendorRespondedAt satisfaction').lean();
  const byVendor = new Map();
  for (const c of claims) {
    const k = String(c.vendor);
    if (!byVendor.has(k)) byVendor.set(k, []);
    byVendor.get(k).push(c);
  }
  return new Map([...byVendor].map(([k, list]) => [k, claimStats(list)]));
}

// Claims per received unit, for the Serial Numbers tab.
export async function claimsByUnit(companyId, unitIds = []) {
  if (!unitIds.length) return new Map();
  const rows = await VendorWarrantyClaim.aggregate([
    { $match: { companyId: new mongoose.Types.ObjectId(String(companyId)), purchasedUnit: { $in: unitIds.map(id => new mongoose.Types.ObjectId(String(id))) } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$purchasedUnit', count: { $sum: 1 }, latestStatus: { $last: '$status' }, latestOutcome: { $last: '$outcome' }, latestNumber: { $last: '$number' } } },
  ]);
  return new Map(rows.map(r => [String(r._id), { count: r.count, latestStatus: r.latestStatus, latestOutcome: r.latestOutcome, latestNumber: r.latestNumber }]));
}
