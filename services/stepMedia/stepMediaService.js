// Feature 23 (client, 23 Nov 2026): Production's photos / video at a step's finish, for QC.
// docs/client-features-2026-11/23-step-media-logic.md (decisions A–D; E changed: the Company
// Admin deletes media older than two calendar months, a note stays).
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import StepMedia from '../../models/StepMedia.js';
import QCJob from '../../models/QCJob.js';
import ProductionOrder from '../../models/ProductionOrder.js';
import User from '../../models/User.js';
import { STEP_MEDIA, discardStepMedia } from '../../middleware/stepMediaUpload.js';

export class StepMediaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// req.user carries the username only (middleware/auth.js), so the person's full name is read.
async function nameOf(user) {
  const u = user?._id ? await User.findById(user._id).select('fullName username').lean() : null;
  return u?.fullName || u?.username || user?.fullName || user?.username || '';
}
const LAST_STEP_HOURS = 24;

/** The process steps of one unit, read-only (unit 1 = the order's own; 2.. = extraUnits). */
export function unitProcs(order, unitNumber) {
  if (unitNumber <= 1) return order.processes || [];
  return order.extraUnits?.[unitNumber - 2]?.processes || null;
}

// The same rule as productionMfgController.qcJobSourceForOrder (kept here so this service
// doesn't import the controller, which imports crewService, which imports this).
function qcJobSource(order) {
  if (order.orderKind === 'SubChildPart') return 'SubChildPartProduction';
  if (order.orderKind === 'ChildPart') return 'ChildPartProduction';
  return order.source === 'QC_Rejected' ? 'QC_Rejected' : (order.source === 'Stock' ? 'Stock' : 'Production');
}
// A step R&D ticked for QC (the same rule as qcStepService.getQcStepIndices).
const isQcStep = (proc) => !!(proc?.qcRequired || proc?.finalQc);

/**
 * Decision C: can photos / video be added to (or removed from) this step's finish now?
 * - an outsourced step: never (Production doesn't finish it)
 * - a step waiting for QC (Submit to QC, or the legacy self-certify "QC Pending"): yes, until QC decides
 * - an ordinary step that's Completed: until the next step starts; the last step for 24 h
 * Returns { open, why, qcStep }.
 */
export function mediaWindow(procs, idx, now = new Date()) {
  const proc = procs?.[idx];
  if (!proc) return { open: false, why: 'No such step.', qcStep: false };
  const qcStep = isQcStep(proc);
  if (proc.type === 'Outsourcing') return { open: false, why: "Outsourced steps don't take photos from Production.", qcStep };
  if (proc.status === 'QC Pending') return { open: true, why: '', qcStep };
  if (proc.status !== 'Completed') {
    return { open: false, why: qcStep && proc.status === 'In Progress' && proc.completedAt ? 'Finish the redo first.' : 'Finish the step first.', qcStep };
  }
  if (qcStep) return { open: false, why: 'QC has already decided this submission.', qcStep };
  const next = procs[idx + 1];
  if (next) return next.status === 'Pending' ? { open: true, why: '', qcStep } : { open: false, why: 'The next step has started.', qcStep };
  const done = proc.completedAt ? new Date(proc.completedAt).getTime() : 0;
  return now.getTime() - done <= LAST_STEP_HOURS * 60 * 60 * 1000
    ? { open: true, why: '', qcStep }
    : { open: false, why: `More than ${LAST_STEP_HOURS} hours since the last step finished.`, qcStep };
}

/** The QC submission (attempt number) a step waiting for QC is on; null for an ordinary step. */
async function attemptOf(order, unitNumber, proc) {
  if (!isQcStep(proc)) return null;
  const job = await QCJob.findOne({ company: order.company, sourceRefId: order.orderId, source: qcJobSource(order) })
    .select('unitChecks.unitNumber unitChecks.steps.category unitChecks.steps.stepName unitChecks.steps.attempts.attemptNumber unitChecks.steps.attempts.decidedAt batchSteps.category batchSteps.stepName batchSteps.attempts.attemptNumber batchSteps.attempts.decidedAt')
    .lean();
  const steps = order.orderKind === 'SubChildPart' ? job?.batchSteps : job?.unitChecks?.find((u) => u.unitNumber === unitNumber)?.steps;
  const entry = (steps || []).find((s) => s.category === proc.category && s.stepName === proc.step);
  const last = entry?.attempts?.[entry.attempts.length - 1];
  return last && !last.decidedAt ? last.attemptNumber : null;
}

const fileOnDisk = (url) => path.join(process.cwd(), String(url || '').replace(/^\/+/, ''));
const unlinkFile = (url) => fs.promises.unlink(fileOnDisk(url)).catch(() => {});

/** Attaches the uploaded files to this step's finish. files: req.stepMedia. */
export async function addMedia(user, orderId, unitNumber, idx, files) {
  try {
    const order = await ProductionOrder.findOne({ _id: orderId, company: user.companyId });
    if (!order) throw new StepMediaError(404, 'Order not found.');
    const procs = unitProcs(order, unitNumber);
    if (!procs || !procs[idx]) throw new StepMediaError(400, 'No such step on this unit.');
    const proc = procs[idx];
    const w = mediaWindow(procs, idx);
    if (!w.open) throw new StepMediaError(400, `Photos can't be added to ${proc.step} now: ${w.why}`);
    // The QC submission waiting for a decision (null on an ordinary step, or if the QC entry
    // can't be found: the files still attach to the step).
    const attempt = await attemptOf(order, unitNumber, proc);
    const key = { order: order._id, unitIndex: unitNumber - 1, stepIndex: idx, attempt, deletedAt: null };
    const have = await StepMedia.aggregate([{ $match: key }, { $group: { _id: '$kind', n: { $sum: 1 } } }]);
    const count = (k) => have.find((h) => h._id === k)?.n || 0;
    const add = (k) => files.filter((f) => f.kind === k).length;
    if (count('photo') + add('photo') > STEP_MEDIA.maxPhotos) {
      throw new StepMediaError(400, `This finish already has ${count('photo')} photo${count('photo') === 1 ? '' : 's'}: up to ${STEP_MEDIA.maxPhotos} in all.`);
    }
    if (count('video') + add('video') > STEP_MEDIA.maxVideos) {
      throw new StepMediaError(400, `This finish already has a video: up to ${STEP_MEDIA.maxVideos}.`);
    }
    const by = await nameOf(user);
    const docs = files.map((f) => ({
      company: order.company, order: order._id, orderNo: order.orderId || '', orderKind: order.orderKind || '', itemName: order.machineName || '',
      unitIndex: unitNumber - 1, stepIndex: idx, category: proc.category || '', stepName: proc.step || '', attempt,
      kind: f.kind, url: f.url, fileName: f.fileName, mime: f.mime, size: f.size, uploadedBy: user._id, uploadedByName: by,
    }));
    return await StepMedia.insertMany(docs);
  } catch (err) {
    await discardStepMedia(files.map((f) => ({ path: f.path })));
    throw err;
  }
}

/** The uploader's own correction, while the window is open: the record and the file go. */
export async function removeOwn(user, orderId, unitNumber, idx, mediaId) {
  if (!mongoose.isValidObjectId(mediaId)) throw new StepMediaError(404, 'Not found.');
  const order = await ProductionOrder.findOne({ _id: orderId, company: user.companyId }).select('processes extraUnits orderId company orderKind source');
  if (!order) throw new StepMediaError(404, 'Order not found.');
  const m = await StepMedia.findOne({ _id: mediaId, order: order._id, unitIndex: unitNumber - 1, stepIndex: idx, deletedAt: null });
  if (!m) throw new StepMediaError(404, 'That photo or video is not on this step.');
  if (String(m.uploadedBy) !== String(user._id)) throw new StepMediaError(403, 'Only the person who attached it can remove it.');
  const procs = unitProcs(order, unitNumber);
  const w = mediaWindow(procs, idx);
  if (!w.open) throw new StepMediaError(400, `It can't be removed now: ${w.why}`);
  await StepMedia.deleteOne({ _id: m._id });
  await unlinkFile(m.url);
  return { removed: 1 };
}

const view = (m) => ({
  _id: m._id, stepIndex: m.stepIndex, category: m.category, stepName: m.stepName, attempt: m.attempt,
  kind: m.kind, url: m.deletedAt ? null : m.url, fileName: m.fileName, size: m.size,
  uploadedBy: m.uploadedBy, uploadedByName: m.uploadedByName, uploadedAt: m.createdAt,
  deletedAt: m.deletedAt, deletedByName: m.deletedByName,
});

/** One unit's photos / videos (removed notes included) and its steps, for QC and Production. */
export async function unitMedia(user, orderRef, unitNumber) {
  const ref = String(orderRef || '');
  const q = mongoose.isValidObjectId(ref) ? { _id: ref } : { orderId: ref };
  const order = await ProductionOrder.findOne({ ...q, company: user.companyId }).select('orderId processes.step processes.category processes.qcRequired processes.finalQc processes.status processes.type processes.completedAt extraUnits.processes.step extraUnits.processes.category extraUnits.processes.qcRequired extraUnits.processes.finalQc extraUnits.processes.status extraUnits.processes.type extraUnits.processes.completedAt').lean();
  if (!order) throw new StepMediaError(404, 'Order not found.');
  const procs = unitProcs(order, unitNumber) || [];
  const media = await StepMedia.find({ order: order._id, unitIndex: unitNumber - 1 }).sort({ stepIndex: 1, attempt: 1, createdAt: 1 }).lean();
  return {
    orderId: order._id, orderNo: order.orderId, unitNumber,
    steps: procs.map((p, i) => ({ stepIndex: i, category: p.category || '', stepName: p.step || '', qcStep: isQcStep(p), canAdd: mediaWindow(procs, i).open })),
    media: media.map(view),
  };
}

/** For a step card (stepCrewView): counts, a short list for its History, and whether more can be added. */
export async function stepSummary(order, unitIndex, idx) {
  const procs = unitProcs(order, unitIndex + 1) || [];
  const w = mediaWindow(procs, idx);
  const rows = await StepMedia.find({ order: order._id, unitIndex, stepIndex: idx })
    .select('kind attempt uploadedBy uploadedByName createdAt deletedAt deletedByName').sort({ createdAt: 1 }).lean();
  const live = rows.filter((r) => !r.deletedAt);
  return {
    photos: live.filter((r) => r.kind === 'photo').length,
    videos: live.filter((r) => r.kind === 'video').length,
    removed: rows.length - live.length,
    items: rows.map((r) => ({ kind: r.kind, attempt: r.attempt, uploadedBy: r.uploadedBy, uploadedByName: r.uploadedByName, uploadedAt: r.createdAt, deletedAt: r.deletedAt, deletedByName: r.deletedByName })),
    canAdd: w.open, why: w.open ? '' : w.why,
  };
}

// ── The Company Admin's clean-up (decision E) ──

/** The start of the India date `months` calendar months before now (23 Nov → 23 Sep, 00:00 IST). */
export function monthsBefore(months, now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth() - months, d = ist.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // that month's last day (30 Apr - 2 → 28/29 Feb)
  return new Date(Date.UTC(y, m, Math.min(d, last)) - 5.5 * 60 * 60 * 1000);
}
export const deletableBefore = (now = new Date()) => monthsBefore(2, now);
const AGES = [2, 6, 12];
const cutoffFor = (age, now = new Date()) => {
  const a = AGES.includes(Number(age)) ? Number(age) : 2;
  return new Date(Math.min(monthsBefore(a, now).getTime(), deletableBefore(now).getTime()));
};
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function adminMatch(companyId, { age, kind, q } = {}) {
  const match = { company: new mongoose.Types.ObjectId(String(companyId)), deletedAt: null, createdAt: { $lt: cutoffFor(age) } };
  if (kind === 'photo' || kind === 'video') match.kind = kind;
  if (q && String(q).trim()) match.orderNo = { $regex: escapeRe(String(q).trim()), $options: 'i' };
  return match;
}

export async function adminSummary(companyId) {
  const cid = new mongoose.Types.ObjectId(String(companyId));
  const before = deletableBefore();
  const [all, old] = await Promise.all([
    StepMedia.aggregate([{ $match: { company: cid, deletedAt: null } }, { $group: { _id: '$kind', count: { $sum: 1 }, bytes: { $sum: '$size' } } }]),
    StepMedia.aggregate([{ $match: { company: cid, deletedAt: null, createdAt: { $lt: before } } }, { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } }]),
  ]);
  const of = (k) => ({ count: all.find((a) => a._id === k)?.count || 0, bytes: all.find((a) => a._id === k)?.bytes || 0 });
  const photos = of('photo'), videos = of('video');
  return {
    photos, videos, total: { count: photos.count + videos.count, bytes: photos.bytes + videos.bytes },
    deletable: { count: old[0]?.count || 0, bytes: old[0]?.bytes || 0 }, deletableBefore: before,
  };
}

const PAGE = 20;
/** One row per finish (order, unit, step, attempt), oldest first, 20 per page. */
export async function adminList(companyId, { age, kind, q, page } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const [res] = await StepMedia.aggregate([
    { $match: adminMatch(companyId, { age, kind, q }) },
    { $group: {
      _id: { order: '$order', unitIndex: '$unitIndex', stepIndex: '$stepIndex', attempt: '$attempt' },
      orderNo: { $first: '$orderNo' }, itemName: { $first: '$itemName' }, stepName: { $first: '$stepName' }, category: { $first: '$category' },
      photos: { $sum: { $cond: [{ $eq: ['$kind', 'photo'] }, 1, 0] } }, videos: { $sum: { $cond: [{ $eq: ['$kind', 'video'] }, 1, 0] } },
      bytes: { $sum: '$size' }, from: { $min: '$createdAt' }, to: { $max: '$createdAt' }, by: { $addToSet: '$uploadedByName' },
    } },
    { $sort: { from: 1, '_id.order': 1, '_id.unitIndex': 1, '_id.stepIndex': 1 } },
    { $facet: {
      rows: [{ $skip: (p - 1) * PAGE }, { $limit: PAGE }],
      totals: [{ $group: { _id: null, finishes: { $sum: 1 }, files: { $sum: { $add: ['$photos', '$videos'] } }, bytes: { $sum: '$bytes' } } }],
    } },
  ]);
  const totals = res?.totals?.[0] || { finishes: 0, files: 0, bytes: 0 };
  return {
    rows: (res?.rows || []).map((r) => ({ key: { order: r._id.order, unitIndex: r._id.unitIndex, stepIndex: r._id.stepIndex, attempt: r._id.attempt }, orderNo: r.orderNo, itemName: r.itemName, unitNumber: r._id.unitIndex + 1, stepName: r.stepName, category: r.category, attempt: r._id.attempt, photos: r.photos, videos: r.videos, bytes: r.bytes, from: r.from, to: r.to, by: r.by.filter(Boolean) })),
    total: totals.finishes, files: totals.files, bytes: totals.bytes, page: p, pages: Math.max(1, Math.ceil(totals.finishes / PAGE)),
    cutoff: cutoffFor(age), deletableBefore: deletableBefore(),
  };
}

/**
 * Deletes the files (the records stay as "removed" notes). Only media older than the chosen age
 * AND older than two calendar months is ever touched, whatever is sent.
 * body: { groups: [{ order, unitIndex, stepIndex, attempt }] } | { ids: [...] } | { all: true, age, kind, q }
 */
export async function adminDelete(user, body = {}) {
  const base = adminMatch(user.companyId, body.all ? body : { age: body.age });
  let match;
  if (body.all) match = base;
  else if (Array.isArray(body.groups) && body.groups.length) {
    if (body.groups.length > 100) throw new StepMediaError(400, 'Up to 100 rows at a time.');
    const or = body.groups.filter((g) => mongoose.isValidObjectId(g?.order)).map((g) => ({
      order: new mongoose.Types.ObjectId(String(g.order)), unitIndex: Number(g.unitIndex) || 0, stepIndex: Number(g.stepIndex), attempt: g.attempt == null ? null : Number(g.attempt),
    }));
    if (!or.length) throw new StepMediaError(400, 'Nothing chosen to delete.');
    match = { ...base, $or: or };
  } else if (Array.isArray(body.ids) && body.ids.length) {
    if (body.ids.length > 200) throw new StepMediaError(400, 'Up to 200 files at a time.');
    const ids = body.ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(String(id)));
    if (!ids.length) throw new StepMediaError(400, 'Nothing chosen to delete.');
    match = { ...base, _id: { $in: ids } };
  } else throw new StepMediaError(400, 'Nothing chosen to delete.');

  let count = 0, bytes = 0;
  const at = new Date();
  const by = await nameOf(user);
  for (;;) {
    const batch = await StepMedia.find(match).select('url size').limit(200).lean();
    if (!batch.length) break;
    await Promise.all(batch.map((m) => unlinkFile(m.url)));
    const r = await StepMedia.updateMany({ _id: { $in: batch.map((m) => m._id) }, deletedAt: null }, { $set: { deletedAt: at, deletedBy: user._id, deletedByName: by } });
    count += r.modifiedCount;
    bytes += batch.reduce((s, m) => s + (m.size || 0), 0);
    if (batch.length < 200) break;
  }
  return { deleted: count, bytes };
}

export const STEP_MEDIA_LIMITS = STEP_MEDIA;
