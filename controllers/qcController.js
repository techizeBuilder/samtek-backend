import mongoose from 'mongoose';
import QCJob from '../models/QCJob.js';
import User from '../models/User.js';
import { Item } from '../models/Inventory.js';
import ProductionOrder from '../models/ProductionOrder.js';
import Sale from '../models/Sale.js';
import notificationService from '../services/notificationService.js';
import RDQualityParam from '../models/RDQualityParam.js';
import { resolveSalesOrderCodeForQCJob } from '../utils/resolveSalesOrderCode.js';
import { setSaleItemStatus, isMachineJobItem } from '../services/storeFlowService.js';
import { dimensionSignature } from '../services/fabricationDemandService.js';
import { readRejectLines, shareLines } from '../services/qcLineAllocation.js';
import { ensureFlatChecklist, ensurePartChecksStructure, attachPartReference, resolveItemForJob, waitsForProductionFinal as jobWaitsForProductionFinal } from '../services/qcChecklistPullService.js';
import { resolveStepProcessRows, resolveStepFinalRows, markJobApproved, getQcStepIndices } from '../services/qcStepService.js';
import { resolveMachineOrderProcesses } from '../services/machineReorderService.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import { allUnitsCompleted, completeMachineUnit } from './productionMfgController.js';
import { recalculateChildPartCost } from './childPartBOMController.js';
import { onOutsourceQcDecided } from '../services/outsourceBillService.js';
import { pushPartCost, pushJobWorkCost } from '../services/partCostService.js';
// Serial number work step 1 (2026-10-31): a finished cascade part goes to its parent order, else stock.
import { deliverFinishedParts } from '../services/cascadeDeliveryService.js';

const today = () => new Date().toISOString().split('T')[0];

// ── Who checked it (2026-10-30, client) ───────────────────────────────────
// The inspector and every "checked by" / "decided by" come from the login —
// never a name sent by the page (nobody can act in someone else's name).
const whoOf = (user) => user?.fullName || user?.username || 'QC';
const httpError = (status, message) => Object.assign(new Error(message), { status });

// The first QC person to start, save or decide becomes the job's inspector.
function ensureInspector(job, user) {
  if (!String(job.inspector || '').trim()) job.inspector = whoOf(user);
  if (job.status === 'Pending') {
    job.status = 'In Progress';
    job.inspectionStartDate = job.inspectionStartDate || today();
  }
}

// QC's results onto checklist rows: results = [{ _id | parameter, status,
// actualValue, remarks }]. match: '_id' (flat / part rows) or 'parameter'
// (step / batch rows). qcLayer: write qcStatus / qcRemarks (Production filled
// the row first) instead of status / remarks. A Fail needs a remark. A row is
// stamped checkedBy / checkedAt only when it actually changed, so saving again
// never takes over someone else's rows. Throws a 400 error.
export function applyRowResults(rows, results, user, { match = '_id', qcLayer = false } = {}) {
  if (!Array.isArray(results) || !rows) return 0;
  const key = (x) => String(match === '_id' ? x?._id : x?.parameter);
  const byKey = new Map(results.filter(Boolean).map(r => [key(r), r]));
  const statusF = qcLayer ? 'qcStatus' : 'status';
  const remF = qcLayer ? 'qcRemarks' : 'remarks';
  const now = new Date();
  // Check everything first — nothing changes when one row is refused.
  const plan = [];
  for (const row of rows) {
    const r = byKey.get(key(row));
    if (!r) continue;
    const status = ['Pending', 'Pass', 'Fail'].includes(r.status) ? r.status : row[statusF];
    const remarks = r.remarks !== undefined ? String(r.remarks || '').trim() : (row[remF] || '');
    const actual = !qcLayer && r.actualValue !== undefined ? String(r.actualValue || '') : (row.actualValue || '');
    if (status === 'Fail' && !remarks) throw httpError(400, `Add a remark for each failed check ("${row.parameter}").`);
    plan.push({ row, status, remarks, actual });
  }
  let changed = 0;
  for (const { row, status, remarks, actual } of plan) {
    if (status === row[statusF] && remarks === (row[remF] || '') && (qcLayer || actual === (row.actualValue || ''))) continue;
    row[statusF] = status;
    row[remF] = remarks;
    if (!qcLayer) row.actualValue = actual;
    row.checkedBy = whoOf(user);
    row.checkedAt = now;
    changed += 1;
  }
  return changed;
}

// The checks that failed in a decision (2026-10-30) — what a rejection carries
// to Purchase, Production and the vendor. qcLayer: QC's verdict is qcStatus /
// qcRemarks (Production filled the row first).
export function failedChecksOf(rows, { qcLayer = false } = {}) {
  return (rows || []).filter(r => (qcLayer ? r.qcStatus : r.status) === 'Fail').map(r => ({
    parameter: r.parameter || '',
    standardValue: r.standardValue || '',
    actualValue: qcLayer ? '' : (r.actualValue || ''),
    remarks: (qcLayer ? r.qcRemarks : r.remarks) || '',
    checkedBy: r.checkedBy || '',
    checkedAt: r.checkedAt || null,
  }));
}
const failedCheckLines = (checks) => checks.map(c => `${c.parameter}${c.remarks ? ` — ${c.remarks}` : ''}`);
const photoUrls = (photos) => (photos || []).map(p => p.url);
// Photos come from the upload (req.rejectionPhotos), never from the JSON.
const PHOTO_REQUIRED = 'Add at least one photo of the rejected material.';

// ── Reject breakdown (2026-10-30, docs/qc-reject-breakdown-2026-10.md) ──
// Purchase / store QC of more than one piece rejects as LINES; one REJ per line.
const LINE_SOURCES = ['Purchase', 'Store'];
const worstSeverity = (lines) => ['Critical', 'Major', 'Minor'].find(s => lines.some(l => l.severity === s)) || 'Major';
const linesSummary = (lines) => lines.map(l => `${l.qty} × ${l.parameter} — ${l.remark}`).join('; ');
const lineCheck = (line, checklist, user) => {
  const row = line.other ? null : (checklist || []).find(c => c.parameter === line.parameter);
  return { parameter: line.parameter, standardValue: row?.standardValue || '', actualValue: '', remarks: line.remark, checkedBy: whoOf(user), checkedAt: new Date() };
};
// The checklist as it stood at a decision — kept on every REJ it makes.
const checklistSnapshotOf = (job) => (job.checklist || []).map(c => ({
  parameter: c.parameter, standardValue: c.standardValue, actualValue: c.actualValue,
  status: job.finalCheckFilledBy ? c.qcStatus : c.status, remarks: (job.finalCheckFilledBy ? c.qcRemarks : c.remarks) || '',
  checkedBy: c.checkedBy || '', checkedAt: c.checkedAt || null,
}));
// Lines already read and shared out (a PO line) → their totals.
const linesTotals = (lines) => {
  const bySize = new Map();
  for (const l of lines) {
    if (!l.sizeValues) continue;
    const k = dimensionSignature(l.sizeValues);
    const cur = bySize.get(k) || { values: l.sizeValues, qty: 0 };
    cur.qty += l.qty;
    bySize.set(k, cur);
  }
  return { lines, total: lines.reduce((s, l) => s + l.qty, 0), bySize: [...bySize.values()], serials: lines.flatMap(l => l.serials || []) };
};
// A job's reject lines: {} (not a breakdown), { error }, or { lines, total, bySize, serials }.
async function readJobRejectLines(job, body) {
  if (body.decision !== 'Fail' || !LINE_SOURCES.includes(job.source)) return {};
  if (body.linesResolved) return linesTotals(body.rejectLines || []);
  const raw = body.rejectLines;
  if (!(Array.isArray(raw) && raw.length)) {
    return Number(job.quantity) > 1 ? { error: 'Add the reject lines — how many, what failed, and what was wrong.' } : {};
  }
  const { isCountableUnit } = await import('../services/purchasedUnitService.js');
  let serialIds = null;
  if (job.source === 'Purchase' && job.purchaseRequestId) {
    const PurchasedUnit = (await import('../models/PurchasedUnit.js')).default;
    const pieces = await PurchasedUnit.find({ purchaseRequest: job.purchaseRequestId, isLot: false, status: 'In QC' }).select('_id').lean();
    if (pieces.length) serialIds = pieces.map(p => String(p._id));
  }
  return readRejectLines(raw, {
    inQc: Number(job.quantity) || 0,
    whole: !!job.isFabrication || isCountableUnit(job.unit),
    isFabrication: !!job.isFabrication,
    sizes: job.isFabrication ? passedSizesOf(job, null) : [],
    serialIds,
    checklistParams: (job.checklist || []).map(c => c.parameter),
    photos: Array.isArray(body.photos) ? body.photos : [],
  });
}
// The Purchase rejection (REJ-…) of one decision — ONE, whatever the reasons:
// the vendor answers for the whole of it (2026-10-30, you); a breakdown's
// lines go inside it as the reasons (each with its own severity for the
// vendor score). A PO line's decision makes one per request (its share).
// wholeLot: everything in QC was rejected (on a PO line: the whole line).
async function recordPurchaseRejections(job, { lines, qty, unitIds, photos, failed, decisionId, user, req, wholeLot = false }) {
  const { onMaterialRejected } = await import('../services/purchaseRejectionService.js');
  const { markRejected } = await import('../services/purchasedUnitService.js');
  const checklistSnapshot = checklistSnapshotOf(job);
  // The checklist is about these pieces only with no lines, or the whole lot.
  const checklistApplies = !lines?.length || !!wholeLot;
  if (!lines) {
    const rejection = await onMaterialRejected(job, qty, user, req, { photos, failedChecks: failed, decisionId, checklistSnapshot, checklistApplies });
    await markRejected(job, { unitIds, qty, rejection });
    return;
  }
  const total = Math.round(lines.reduce((s, l) => s + l.qty, 0) * 1000) / 1000;
  const serials = lines.flatMap(l => l.serials || []);
  const rejection = await onMaterialRejected(job, total, user, req, {
    lines, photos: lines.flatMap(l => l.photos || []), failedChecks: lines.map(l => lineCheck(l, job.checklist, user)),
    severity: worstSeverity(lines), reason: linesSummary(lines), decisionId, checklistSnapshot, checklistApplies,
  });
  await markRejected(job, { unitIds: serials.length ? serials : null, qty: total, rejection });
}

// Part rows came as [{ _id, qcStatus, qcRemarks }] — same thing, older names.
const partResults = (list) => (Array.isArray(list) ? list.map(u => ({ _id: u._id, status: u.qcStatus ?? u.status, remarks: u.qcRemarks ?? u.remarks })) : list);

async function generateQCJobId() {
  const year = new Date().getFullYear();
  const lastJob = await QCJob.findOne({
    qcJobId: new RegExp(`^QC-${year}-`)
  }).sort({ qcJobId: -1 }).lean();

  let nextNumber = 1;
  if (lastJob && lastJob.qcJobId) {
    const parts = lastJob.qcJobId.split('-');
    if (parts.length === 3) {
      const lastNumber = parseInt(parts[2]);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }
  }

  return `QC-${year}-${String(nextNumber).padStart(4, '0')}`;
}

// QC by PO line (2026-10-15): a received line's card (its lead job) carries
// the line — its status, how many requests, how much is still in QC.
async function withLineSummaries(jobs) {
  const keys = [...new Set(jobs.filter(j => j.source === 'Purchase' && j.receiptKey).map(j => j.receiptKey))];
  if (!keys.length) return jobs;
  const all = await QCJob.find({ receiptKey: { $in: keys } }).select('receiptKey status quantity acceptedQty partialRejections isFabrication receivedSizes').lean();
  const byKey = new Map();
  for (const j of all) { if (!byKey.has(j.receiptKey)) byKey.set(j.receiptKey, []); byKey.get(j.receiptKey).push(j); }
  return jobs.map(j => {
    const group = j.receiptKey ? byKey.get(j.receiptKey) : null;
    if (!group) return j;
    const round = (n) => Math.round(n * 1000) / 1000;
    const rejectedOf = (g) => (g.partialRejections || []).reduce((s, r) => s + (Number(r.qty) || 0), 0) + (g.status === 'Rejected' ? Number(g.quantity) || 0 : 0);
    return {
      ...j,
      ownStatus: j.status,
      status: j.lineStatus || j.status,
      line: {
        requests: group.length,
        inQc: round(group.filter(g => OPEN.includes(g.status)).reduce((s, g) => s + (Number(g.quantity) || 0), 0)),
        received: round(group.reduce((s, g) => s + (g.status === 'Rejected' ? 0 : Number(g.acceptedQty ?? g.quantity) || 0) + rejectedOf(g), 0)),
        rejected: round(group.reduce((s, g) => s + rejectedOf(g), 0)),
        isFabrication: group.some(g => g.isFabrication),
        // The size(s) of this delivery, so cards of one item can be told apart.
        sizes: (() => {
          const m = new Map();
          for (const g of group) for (const s of g.receivedSizes || []) {
            const k = dimensionSignature(s.values);
            const cur = m.get(k) || { values: s.values, quantity: 0 };
            cur.quantity += Number(s.quantity) || 0;
            m.set(k, cur);
          }
          return [...m.values()];
        })(),
      },
    };
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboard = async (req, res) => {
  try {
    const cid = req.user.companyId;
    const todayStr = today();

    // One received PO line = one job here (2026-10-15): its other requests'
    // jobs aren't counted, and the line's status is the one that counts.
    const cards = { company: cid, groupMember: { $ne: true } };
    const byStatus = (s) => ({ ...cards, $or: [{ lineStatus: s }, { lineStatus: null, status: s }] });
    const [total, pending, inProgress, approved, rejected, todayCount] = await Promise.all([
      QCJob.countDocuments(cards),
      QCJob.countDocuments(byStatus('Pending')),
      QCJob.countDocuments(byStatus('In Progress')),
      QCJob.countDocuments(byStatus('Approved')),
      QCJob.countDocuments(byStatus('Rejected')),
      QCJob.countDocuments({ ...cards, receivedDate: todayStr }),
    ]);

    // Source-wise breakdown
    const sourceBreakdown = await QCJob.aggregate([
      { $match: cards },
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]);

    // Category breakdown
    const categoryBreakdown = await QCJob.aggregate([
      { $match: cards },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    // Top fail reasons (from rejected jobs)
    const failReasons = await QCJob.aggregate([
      { $match: { company: cid, status: 'Rejected', failReason: { $ne: '' } } },
      { $group: { _id: '$failReason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Recent 5 jobs
    const recentJobs = await QCJob.find(cards)
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({
      success: true,
      data: {
        summary: { total, pending, inProgress, approved, rejected, todayCount },
        sourceBreakdown,
        categoryBreakdown,
        failReasons,
        recentJobs,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── QC Jobs CRUD ──────────────────────────────────────────────────────────────
export const getQCJobs = async (req, res) => {
  try {
    const { status, source, excludeSource, category, search, page, limit, withStatusCounts } = req.query;
    // QC by PO line (2026-10-15): one card per received line — the line's
    // other jobs are hidden, and the card shows / filters by the LINE's status.
    const filter = { company: req.user.companyId, status: { $ne: 'Draft' }, groupMember: { $ne: true } };
    if (status) filter.$or = [{ lineStatus: status }, { lineStatus: null, status }];
    // Comma-separated (same convention as excludeSource below) so one pill
    // can cover more than one real `source` value at once — needed for
    // "Sub Child Part QC", which spans two structurally different routes to
    // the SAME tier: Purchase's own Job Work route (source:
    // 'SubChildPartJobWork') and Production's in-house route (source:
    // 'SubChildPartProduction') — which Item.subChildPartDetails.jobWork an
    // individual Sub Child Part is flagged with decides which one it uses,
    // but both are genuinely "Sub Child Part QC" (confirmed 2026-09-19: the
    // pill was only ever matching the Purchase half before this).
    if (source) filter.source = { $in: source.split(',').map(s => s.trim()).filter(Boolean) };
    // Comma-separated so the default "All" view can exclude more than one
    // structurally-different flow at once (Sub Child Part QC's partChecks[]
    // AND Child Part QC's unitChecks[] — both routed here from their own
    // dedicated filter pill instead, 2026-09-16).
    else if (excludeSource) filter.source = { $nin: excludeSource.split(',').map(s => s.trim()).filter(Boolean) };
    if (category) filter.category = category;

    const isPaginated = !!(page || limit);
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);

    let statusCounts;
    if (withStatusCounts === 'true') {
      const countsAgg = await QCJob.aggregate([
        { $match: { company: req.user.companyId, status: { $ne: 'Draft' }, groupMember: { $ne: true } } },
        { $group: { _id: { $ifNull: ['$lineStatus', '$status'] }, count: { $sum: 1 } } },
      ]);
      statusCounts = countsAgg.reduce((acc, c) => { acc[c._id] = c.count; return acc; }, {});
      statusCounts.all = countsAgg.reduce((sum, c) => sum + c.count, 0);
    }

    if (search) {
      // orderCode is resolved per-job (not a stored/indexed field), so
      // matching it requires enriching every job in the filtered set —
      // this path accepts that per-row lookup cost only while actively
      // searching, rather than paginating first and silently missing
      // order-code matches that fall outside the current page.
      const jobs = await QCJob.find(filter).sort({ createdAt: -1 }).lean();
      const jobsWithOrderCode = await Promise.all(jobs.map(async (job) => ({
        ...job,
        orderCode: await resolveSalesOrderCodeForQCJob(job, req.user.companyId),
      })));
      const s = search.toLowerCase();
      const matched = jobsWithOrderCode.filter(j =>
        (j.qcJobId || '').toLowerCase().includes(s) ||
        (j.itemName || '').toLowerCase().includes(s) ||
        (j.sourceRefId || '').toLowerCase().includes(s) ||
        (j.inspector || '').toLowerCase().includes(s) ||
        (j.orderCode || '').toLowerCase().includes(s)
      );

      if (isPaginated) {
        const total = matched.length;
        const data = await withLineSummaries(matched.slice((pageNum - 1) * limitNum, pageNum * limitNum));
        return res.json({
          success: true, data,
          pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
          ...(statusCounts ? { statusCounts } : {}),
        });
      }
      return res.json({ success: true, data: await withLineSummaries(matched), ...(statusCounts ? { statusCounts } : {}) });
    }

    if (isPaginated) {
      // Real DB-level pagination — resolveSalesOrderCodeForQCJob now only
      // runs for the current page's rows, not the entire company history.
      const [jobs, total] = await Promise.all([
        QCJob.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
        QCJob.countDocuments(filter),
      ]);
      const jobsWithOrderCode = await Promise.all(jobs.map(async (job) => ({
        ...job,
        orderCode: await resolveSalesOrderCodeForQCJob(job, req.user.companyId),
      })));
      return res.json({
        success: true, data: await withLineSummaries(jobsWithOrderCode),
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
        ...(statusCounts ? { statusCounts } : {}),
      });
    }

    // No page/limit sent — original unbounded behavior, unchanged.
    const jobs = await QCJob.find(filter).sort({ createdAt: -1 }).lean();
    const jobsWithOrderCode = await Promise.all(jobs.map(async (job) => ({
      ...job,
      orderCode: await resolveSalesOrderCodeForQCJob(job, req.user.companyId),
    })));
    res.json({ success: true, data: await withLineSummaries(jobsWithOrderCode), ...(statusCounts ? { statusCounts } : {}) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Lazy pull happens here, not at any of the 4 creation sites — computing a
// checklist for every job the moment it's created (or worse, for all ~145
// jobs the list view shows) would be wasted work for jobs nobody ever opens.
// Only the act of a real GET-by-id (someone actually opening this one job)
// triggers it, and only once — confirmed 2026-09-01. A no-op save is skipped
// (both helpers return false when there's nothing new to persist) so opening
// an already-populated job stays a pure read.
export const getQCJob = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });

    // For a manufactured Machine job, the QCJob exists — and is openable by
    // QC — from the moment Production first touches Fabrication, long before
    // the order ever reaches Final Testing. Pulling the Final checklist's
    // rows here unconditionally let QC "Start Inspection" and see/edit a
    // fully live Inspection Checklist while Production hadn't even submitted
    // it yet (real bug, caught 2026-09-02 — only 1 of 2 Sub Child Parts were
    // done). It only gets pulled once Production has actually filled it in
    // (saveFinalChecklist sets finalCheckFilledAt); a non-manufactured job
    // keeps the original immediate pull, unaffected.
    //
    // The manufactured/not distinction is the item's own productSourceType
    // (MANUFACTURING_SOURCE_TYPES) — NOT job.partChecks.length. A
    // MachineBOM-driven order is manufactured too, but legitimately has zero
    // partChecks (its Child Parts each pass their own QC before ever
    // reaching this order — see machineReorderService.js) — using
    // partChecks.length here would wrongly treat it as non-manufactured and
    // let QC fill the Final checklist before Production ever does (corrected
    // 2026-09-17, same bug class as the 2026-09-02 fix above, just missed
    // for the new hierarchy).
    //
    // 2026-11-05: only a job that came from a production order waits. A machine
    // sold from stock (source Store) or bought (source Purchase) has no
    // Production work behind it, so the 2026-09-17 version left its job waiting
    // for a checklist nobody would ever send.
    const item = await resolveItemForJob(job, req.user.companyId);
    const waitsForProductionFinal = jobWaitsForProductionFinal(job, item);
    const finalCheckReady = !waitsForProductionFinal || !!job.finalCheckFilledAt;
    const changedChecklist = finalCheckReady ? await ensureFlatChecklist(job, req.user.companyId) : false;
    // A job made with the request number as its item code (before 2026-10-30)
    // gets the item's real code once opened.
    let changedCode = false;
    if (item?.code && job.item && String(job.item) === String(item._id) && job.itemCode !== item.code) {
      job.itemCode = item.code;
      changedCode = true;
    }
    const changedParts = job.source === 'Production' ? await ensurePartChecksStructure(job, req.user.companyId) : false;

    // QC multi-checkpoint redesign (slice 2, 2026-09-26) — resolve this Sub
    // Child Part's per-step checklist rows into whichever batchStep attempt
    // is currently awaiting a decision. QC fills these, not Production —
    // there's nothing to resolve until an attempt actually exists, and once
    // resolved it's persisted, same lazy-pull convention every other
    // checklist resolution on this job already uses.
    let changedBatchSteps = false;
    if (job.batchSteps?.length && item) {
      for (const entry of job.batchSteps) {
        const attempt = entry.attempts[entry.attempts.length - 1];
        if (!attempt || attempt.decidedAt || attempt.rows.length > 0) continue;
        attempt.rows = await resolveStepProcessRows(req.user.companyId, 'subChildPart', 'default', item._id, entry.category, entry.stepName);
        changedBatchSteps = true;
      }
    }

    // Resolved once, up front — needed by both the unitSteps loop below and
    // unitStepsDynamic. unitChecks[] is only ever populated for Child Part or
    // per-unit Machine (ensureUnitChecksStructure's own scope), so this is a
    // no-op fetch for every other job kind. job.source doesn't reliably
    // distinguish Machine (qcJobSourceForOrder falls it through to the same
    // generic 'Production'/'Stock' as everything else) — orderKind, resolved
    // here, is the only reliable signal.
    const unitOrder = (job.unitChecks?.length && job.sourceRefId)
      ? await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company }).select('orderKind processes').lean()
      : null;

    // Stage B (2026-09-26), broadened for Stage C (2026-09-28) — same lazy-
    // pull convention as the batchSteps loop above, for a dynamic Child
    // Part/Machine unit's own steps[]. A no-op for a legacy order (either
    // kind) — unit.steps stays empty, so this loop just iterates zero times.
    // A Machine step can carry qcRequired, finalQc, or both — both checklists
    // resolve into the SAME attempt when both flags are set ("one review
    // with two sections" per the discussion doc), tagged by QCFilledRowSchema's
    // own source field so the frontend can still tell them apart if it wants to.
    let changedUnitSteps = false;
    if (unitOrder && item) {
      for (const unit of job.unitChecks) {
        for (const entry of unit.steps || []) {
          const attempt = entry.attempts[entry.attempts.length - 1];
          if (!attempt || attempt.decidedAt || attempt.rows.length > 0) continue;
          if (unitOrder.orderKind === 'Machine') {
            // qcRequired/finalQc flags are baked identically onto every
            // unit's processes[] at creation time (buildFreshUnitProcesses),
            // so the main unit's own array is a safe proxy for any unit's
            // flags here — only step STATUS ever diverges between units, not
            // the BOM-level flags themselves.
            const proc = unitOrder.processes.find(p => p.category === entry.category && p.step === entry.stepName);
            // proc could be missing if R&D renamed/removed the step after
            // this order was created (the doc's own "mismatch" case) — falls
            // back to "assume process rows apply unless we know for certain
            // this was a pure-finalQc entry", same spirit as every other
            // graceful-degrade in this checklist-resolution code.
            const needsProcess = proc ? proc.qcRequired : !entry.finalQc;
            const rows = [];
            if (entry.finalQc) rows.push(...await resolveStepFinalRows(req.user.companyId, item._id));
            if (needsProcess) {
              rows.push(...await resolveStepProcessRows(req.user.companyId, 'productMaster', 'process', item._id, entry.category, entry.stepName));
            }
            attempt.rows = rows;
          } else {
            attempt.rows = await resolveStepProcessRows(req.user.companyId, 'childPart', 'process', item._id, entry.category, entry.stepName);
          }
          changedUnitSteps = true;
        }
      }
    }

    if (changedChecklist || changedParts || changedBatchSteps || changedUnitSteps || changedCode) await job.save();

    // Stage B, renamed/broadened for Stage C (2026-09-28) — tells the
    // frontend whether this job's units decide per-step (new) or still use
    // the old flat per-unit fields (a legacy Child Part/Machine order with no
    // Process Definition at all) — a bare unit.steps.length check can't tell
    // those two apart, since both start out empty; this is computed once,
    // server-side, instead. Was Child-Part-only (childPartDynamic); Machine
    // now shares it too since both order kinds use the exact same steps[]
    // mechanism.
    const unitStepsDynamic = !!unitOrder && getQcStepIndices(unitOrder, unitOrder.processes).length > 0;

    const orderCode = await resolveSalesOrderCodeForQCJob(job.toObject(), req.user.companyId);

    // Same designFile/materials reference Production's own parts panel gets
    // (getPartsQC) — QC reviewing a part needs to see the real BOM spec too,
    // not just the checklist labels (confirmed 2026-09-02).
    let partChecks = job.partChecks;
    if (job.partChecks.length > 0 && item) {
      partChecks = await attachPartReference(job.partChecks, item._id, req.user.companyId);
    }

    // QC by PO line (2026-10-15): the line this card stands for — its
    // requests, what's in QC, sizes — and the LINE's status (the card stays
    // open while any request on it is still in QC).
    let receiptGroup = null;
    let lineStatusOverride = {};
    if (job.source === 'Purchase' && job.receiptKey) {
      receiptGroup = receiptSummary(await receiptContext(job));
      if (job.lineStatus) lineStatusOverride = { ownStatus: job.status, status: job.lineStatus };
    }

    res.json({ success: true, data: { ...job.toObject(), partChecks, orderCode, waitsForProductionFinal, unitStepsDynamic, receiptGroup, ...lineStatusOverride } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



export const createQCJob = async (req, res) => {
  try {
    const {
      source, sourceRefId, sourceDepartment, sentBy,
      itemName, itemCode, category, quantity, unit, receivedDate,
      checklist, notes,
    } = req.body;

    if (!source || !itemName || !category || !receivedDate) {
      return res.status(400).json({ success: false, message: 'source, itemName, category, receivedDate are required' });
    }

    // Assuming generateQCJobId is defined earlier in your file
    const qcJobId = await generateQCJobId();

    // 1. Start with the default checklist provided by the frontend request
    let finalChecklist = (checklist || []).map(c => ({
      parameter: c.parameter,
      standardValue: c.standardValue || '',
      actualValue: '',
      status: 'Pending',
      remarks: '',
    }));

    // 2. ⚡ THE R&D BRIDGE INTERCEPTOR ⚡
    try {
      // Directly search RDQualityParam using the itemName
      const rdParams = await RDQualityParam.findOne({
        machineName: itemName,
        company: req.user.companyId
      }).lean();

      if (rdParams) {
        console.log(`[QC Bridge] 🔗 Found R&D Parameters for: ${itemName}. Overwriting default checklist.`);

        // We found R&D data! Clear the default frontend checklist to overwrite it
        finalChecklist = [];

        // Map R&D 'parameters' (measurable limits)
        if (rdParams.parameters && rdParams.parameters.length > 0) {
          rdParams.parameters.forEach(p => {
            let stdValue = p.performanceStandard || '';
            if (p.tolerance) stdValue += ` (Tol: ${p.tolerance})`;

            finalChecklist.push({
              parameter: p.parameter,
              standardValue: stdValue.trim(),
              actualValue: '',
              status: 'Pending',
              remarks: ''
            });
          });
        }

        // Map R&D 'qcChecklist' (binary visual/functional checks)
        if (rdParams.qcChecklist && rdParams.qcChecklist.length > 0) {
          rdParams.qcChecklist.forEach(c => {
            finalChecklist.push({
              parameter: c.item,
              standardValue: 'Verified',
              actualValue: '',
              status: 'Pending',
              remarks: ''
            });
          });
        }
      } else {
        console.log(`[QC Bridge] ℹ️ No R&D Parameters found for: ${itemName}. Using default checklist.`);
      }
    } catch (bridgeError) {
      // If the bridge fails (e.g., DB error), log it but DO NOT crash the QC job creation
      console.warn(`⚠️ [QC Bridge] Failed to fetch R&D parameters for ${itemName}. Falling back to default.`, bridgeError);
    }

    // 3. Create the Job with the finalized checklist
    const job = await QCJob.create({
      qcJobId,
      source, sourceRefId, sourceDepartment, sentBy,
      itemName, itemCode, category,
      quantity: quantity || 1,
      unit: unit || 'pcs',
      receivedDate,
      checklist: finalChecklist, // Using our processed array
      notes: notes || '',
      company: req.user.companyId,
      createdBy: req.user._id,
    });

    // 🔔 Notify QC team about new job
    try {
      await notificationService.triggerQCNotification({
        action: 'qc_job_created',
        data: { qcJobId, itemName, jobId: job._id },
        targetCompanyId: req.user.companyId,
      });
    } catch (e) {
      console.error('QC job created notification error:', e);
    }

    res.status(201).json({ success: true, data: job });
  } catch (err) {
    console.error('❌ Error in createQCJob:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
export const updateQCJob = async (req, res) => {
  try {
    const job = await QCJob.findOneAndUpdate(
      { _id: req.params.id, company: req.user.companyId },
      { ...req.body },
      { new: true }
    );
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Inspection Workflow ───────────────────────────────────────────────────────
// Assigns the inspector on a job, transitioning Pending -> In Progress the
// same way it always has. Broadened (2026-09-26, found live: a batchSteps/
// unitChecks-per-step job — QC multi-checkpoint redesign — auto-advances to
// 'In Progress' via markJobStarted the moment Production/Purchase first
// submits a step, well before QC ever opens the job, so the old `status:
// 'Pending'` query filter silently 404'd and the "Start Inspection" panel
// never had a chance to show — inspector was never captured for these jobs
// at all). Now just requires the job to exist; only touches status/
// inspectionStartDate when still Pending, so a legacy flat/per-unit job's
// existing behavior is unchanged byte-for-byte.
export const startInspection = async (req, res) => {
  try {
    // The person starting is the inspector — from the login, not a name the
    // page sends (2026-10-30, client).
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    job.inspector = whoOf(req.user);
    if (job.status === 'Pending') {
      job.status = 'In Progress';
      job.inspectionStartDate = today();
    }
    await job.save();
    // QC by PO line (2026-10-15): starting the line's card starts every
    // request's job on it.
    if (job.source === 'Purchase' && job.receiptKey) {
      await QCJob.updateMany(
        { company: job.company, receiptKey: job.receiptKey, _id: { $ne: job._id }, status: 'Pending' },
        { $set: { status: 'In Progress', inspector: job.inspector, inspectionStartDate: job.inspectionStartDate || today() } }
      );
      await QCJob.updateMany({ company: job.company, receiptKey: job.receiptKey, _id: { $ne: job._id } }, { $set: { inspector: job.inspector } });
      await refreshLineStatus(job.company, job.receiptKey);
    }
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/qc/department-users — populates the Inspector picker with real QC
// staff instead of free text (client requirement, 2026-09-26). Mirrors
// leadController.js's getAssignableUsers: a small, module-scoped user list
// gated under this page's own permission rather than HRMS's employee-
// management one, so QC staff without HR access can still load it. Role-
// based, not departmentId-based — confirmed against real company data that
// QC staff are identified by role (QC Head/QC Employee); departmentId is
// unset for effectively every user in practice.
export const getQcDepartmentUsers = async (req, res) => {
  try {
    const users = await User.find({
      companyId: req.user.companyId,
      role: { $in: ['QC Head', 'QC Employee'] },
      isActive: true,
    }).select('fullName username role employeeId');
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateChecklistItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { actualValue, status, remarks, qcStatus, qcRemarks } = req.body;

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const item = job.checklist.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Checklist item not found' });

    // A manufactured job's Final Check was already filled in by Production
    // (saveFinalChecklist or saveSubChildPartChecklist) — actualValue/status/remarks
    // are THEIR record, so QC never touches them here, only its own separate
    // qcStatus/qcRemarks. Who checked it is stamped (2026-10-30).
    if (job.finalCheckFilledBy) {
      applyRowResults(job.checklist, [{ _id: item._id, status: qcStatus, remarks: qcRemarks }], req.user, { qcLayer: true });
    } else {
      applyRowResults(job.checklist, [{ _id: item._id, status, actualValue, remarks }], req.user);
    }

    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// "Save checks" (2026-10-30): QC saves the rows it checked without deciding —
// someone else can carry on. body.results = [{ _id, status, actualValue, remarks }].
// A PO line: the lead's checklist (its copy goes to the line's other requests
// when it's decided).
export const saveJobChecks = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.unitChecks?.length || job.batchSteps?.length) return res.status(400).json({ success: false, message: 'Save the checks on the step instead.' });
    let open = OPEN.includes(job.status);
    if (!open && job.source === 'Purchase' && job.receiptKey && !job.groupMember) {
      open = (await QCJob.countDocuments({ company: job.company, receiptKey: job.receiptKey, _id: { $ne: job._id }, status: { $in: OPEN } })) > 0;
    }
    if (!open) return res.status(409).json({ success: false, message: `This job is ${job.status} — its checks can't change.` });
    ensureInspector(job, req.user);
    const changed = applyRowResults(job.checklist, req.body.results, req.user, { qcLayer: !!job.finalCheckFilledBy });
    await job.save();
    if (job.receiptKey) await refreshLineStatus(job.company, job.receiptKey);
    res.json({ success: true, data: job, changed });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// The latest undecided attempt of a unit's / batch's step — or a 4xx message.
function openAttempt(entry) {
  if (!entry) return { error: [404, 'No step entry found for this category/step'] };
  const attempt = entry.attempts[entry.attempts.length - 1];
  if (!attempt || attempt.decidedAt) return { error: [400, 'Nothing awaiting a decision for this step.'] };
  return { attempt };
}

// "Save checks" on a unit's step. body: { category, step, results }.
export const saveUnitStepChecks = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    const unit = job.unitChecks.find(u => u.unitNumber === parseInt(req.params.unitNumber, 10));
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found on this job' });
    const { attempt, error } = openAttempt(unit.steps.find(s => s.category === req.body.category && s.stepName === req.body.step));
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    ensureInspector(job, req.user);
    const changed = applyRowResults(attempt.rows, req.body.results, req.user, { match: 'parameter' });
    job.markModified('unitChecks');
    await job.save();
    res.json({ success: true, changed });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// "Save checks" on a batch step. body: { category, step, results }.
export const saveBatchStepChecks = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    const { attempt, error } = openAttempt(job.batchSteps.find(b => b.category === req.body.category && b.stepName === req.body.step));
    if (error) return res.status(error[0]).json({ success: false, message: error[1] });
    ensureInspector(job, req.user);
    const changed = applyRowResults(attempt.rows, req.body.results, req.user, { match: 'parameter' });
    job.markModified('batchSteps');
    await job.save();
    res.json({ success: true, changed });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// "Save checks" on a machine's Sub Child Part. body: { initial, process } as
// [{ _id, qcStatus, qcRemarks }].
export const savePartChecks = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    const part = job.partChecks.id(req.params.partCheckId);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found on this job' });
    if (part.status !== 'QC Pending') return res.status(400).json({ success: false, message: `This part isn't awaiting QC review (currently ${part.status}).` });
    ensureInspector(job, req.user);
    const changed = applyRowResults(part.initial, partResults(req.body.initial), req.user, { qcLayer: true })
      + applyRowResults(part.process, partResults(req.body.process), req.user, { qcLayer: true });
    await job.save();
    res.json({ success: true, data: part, changed });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

export async function decideJob(job, body, user, req, { notify = true } = {}) {
  {
    // A reject breakdown (2026-10-30): the lines decide the qty, sizes,
    // serials, the overall reason and the worst severity.
    const pre = job.status === 'In Progress' ? await readJobRejectLines(job, body) : {};
    if (pre.error) return { status: 400, body: { success: false, message: pre.error } };
    const rejectLines = pre.lines || null;
    if (rejectLines) {
      body = {
        ...body,
        rejectQty: pre.total,
        rejectSerials: pre.serials?.length ? pre.serials : undefined,
        rejectSizes: pre.bySize?.length ? pre.bySize : undefined,
        failReason: body.failReason || linesSummary(rejectLines),
        severity: worstSeverity(rejectLines),
      };
    }
    const decisionId = body.decisionId || String(new mongoose.Types.ObjectId());
    const { decision, failReason, inspectorRemarks, rejectQty } = body;
    if (!decision || !['Pass', 'Fail'].includes(decision)) {
      return { status: 400, body: { success: false, message: 'decision must be Pass or Fail' } };
    }
    // How bad a failure is (2026-10-13, vendor score) — Minor / Major / Critical; Major if not given.
    const severity = ['Minor', 'Major', 'Critical'].includes(body.severity) ? body.severity : 'Major';
    if (decision === 'Fail' && !failReason) {
      return { status: 400, body: { success: false, message: 'failReason is required when decision is Fail' } };
    }

    if (job.status !== 'In Progress') return { status: 404, body: { success: false, message: 'Job not found or not In Progress' } };

    // The checks and the decision in one go (2026-10-30): QC's results first.
    if (Array.isArray(body.results)) {
      try { applyRowResults(job.checklist, body.results, user, { qcLayer: !!job.finalCheckFilledBy }); } catch (e) {
        return { status: e.status || 400, body: { success: false, message: e.message } };
      }
    }
    if (!String(job.inspector || '').trim()) job.inspector = whoOf(user);
    // A rejection's evidence (2026-10-30): the photos uploaded with it and the
    // checks that failed. Purchased material needs at least one photo — it's
    // what Purchase shows the vendor.
    const photos = Array.isArray(body.photos) ? body.photos : [];
    const failed = failedChecksOf(job.checklist, { qcLayer: !!job.finalCheckFilledBy });
    const anyPhoto = rejectLines ? rejectLines.some(l => l.photos?.length) : photos.length > 0;
    if (decision === 'Fail' && job.source === 'Purchase' && !body.photosChecked && !anyPhoto) {
      return { status: 400, body: { success: false, message: PHOTO_REQUIRED } };
    }
    // One piece (no breakdown): the checklist's Fail rows are the rejection —
    // at least one, or "what failed" typed when it isn't on the checklist.
    if (decision === 'Fail' && LINE_SOURCES.includes(job.source) && !rejectLines) {
      const other = String(body.otherFailed || '').trim();
      if (!failed.length && !other) {
        return { status: 400, body: { success: false, message: 'Mark the check that failed (Fail with a remark), or say what failed.' } };
      }
      if (other) failed.push({ parameter: other, standardValue: '', actualValue: '', remarks: failReason || '', checkedBy: whoOf(user), checkedAt: new Date() });
    }

    // A per-unit job (Child Part, or a dynamic-Process-Definition Machine
    // since 2026-09-24) is only ever decided unit by unit
    // (decideChildPartUnit) — one whole-job Pass here would approve every
    // unit's full quantity for dispatch at once, regardless of which units
    // were actually built and checked (the exact ORD-0120 bug).
    if (job.unitChecks?.length) {
      return { status: 400, body: { success: false, message: 'This job is decided per unit — review each unit in the Units panel instead.' } };
    }
    // Same reasoning, Sub Child Part's own whole-batch shape (QC multi-
    // checkpoint redesign, slice 2, 2026-09-26) — one whole-job Pass here
    // would credit the full quantity at once regardless of which steps
    // actually passed vs were reworked/scrapped.
    if (job.batchSteps?.length) {
      return { status: 400, body: { success: false, message: 'This job is decided per step — review each step in the Batch Steps panel instead.' } };
    }

    // Enforce: all checklist items must be inspected before a decision can be submitted.
    // A manufactured job's checklist is Production's own Final self-check —
    // the gate here is QC's own separate verdict (qcStatus), not theirs.
    // Except a reject WITH breakdown lines (2026-10-31, your browser test): the
    // lines are its evidence, and the pieces still in QC keep the checklist for
    // their own Pass — a Pass, and a one-piece reject, still need every row.
    const rejectByLines = decision === 'Fail' && (!!rejectLines?.length || !!body.linesResolved);
    if (job.checklist && job.checklist.length > 0 && !rejectByLines) {
      const statusField = job.finalCheckFilledBy ? 'qcStatus' : 'status';
      const pendingItems = job.checklist.filter(c => c[statusField] === 'Pending');
      if (pendingItems.length > 0) {
        return { status: 400, body: {
          success: false,
          message: `${pendingItems.length} checklist item${pendingItems.length > 1 ? 's' : ''} still pending. Complete all checklist items before submitting a decision.`
        } };
      }
    }

    // In-house/outsource manufactured product: this decision IS the Final
    // Check (the whole assembled machine) — see QCJob.js's own comment.
    // It can't be submitted until every Sub Child Part has cleared its own
    // Initial+Process review, same "one job holds the whole history, but
    // the final verdict only makes sense once every part is done" ordering
    // confirmed 2026-09-01.
    if (job.partChecks && job.partChecks.length > 0) {
      const unresolvedParts = job.partChecks.filter(p => p.status !== 'Approved');
      if (unresolvedParts.length > 0) {
        return { status: 400, body: {
          success: false,
          message: `${unresolvedParts.length} Sub Child Part${unresolvedParts.length > 1 ? 's' : ''} still not QC-approved. Approve every part before the Final Check.`
        } };
      }
    }

    // Serial number work step 2 (2026-10-31, §5.8): a sale from stock has no
    // Store handshake (Available → this QC job, automatically), so QC picks
    // which one it is checking — our machine's sticker, or a bought product's
    // vendor serial. job.itemCode is the inventory item's id here. Stock was
    // already deducted for this job, so it counts back in as untracked room.
    let salePick = null;
    let saleSkip = null;
    if (decision === 'Pass' && job.source === 'Store' && /^[a-f0-9]{24}$/i.test(String(job.itemCode || ''))) {
      const { stockTracked, pickRule, pickProblem, checkPicked, unlabelledInStock, unlabelledProblem, untrackedCount, noSerialCheck } = await import('../services/serialTrailService.js');
      const tracked = await stockTracked(job.company, job.itemCode);
      const given = body.salePick || {};
      const stockItem = await Item.findById(job.itemCode).select('qty name').lean();
      const stockForJob = (stockItem?.qty || 0) + (Number(job.quantity) || 0);
      const waitingSticker = await unlabelledInStock(job.company, job.itemCode);
      const stickerBlock = unlabelledProblem({ qty: job.quantity, stock: stockForJob, unlabelled: waitingSticker, name: stockItem?.name });
      if (stickerBlock) return { status: 400, body: { success: false, message: stickerBlock } };
      if (tracked.count > 0 || given.unitIds?.length || given.labelIds?.length) {
        const checked = checkPicked(given, tracked);
        if (checked.error) return { status: 400, body: { success: false, message: checked.error } };
        const rule = pickRule({ qty: job.quantity, tracked: tracked.count, untracked: untrackedCount(stockForJob, tracked.count, waitingSticker) });
        const problem = pickProblem(checked.unitIds.length + checked.labelIds.length, rule, 'sticker / serial number');
        if (problem) return { status: 400, body: { success: false, message: problem } };
        salePick = checked;
        saleSkip = noSerialCheck({ itemId: job.itemCode, name: stockItem?.name || job.itemName, picked: checked.unitIds.length + checked.labelIds.length, rule, tracked: tracked.count });
      }
    }

    // Partial reject: job.quantity > 1 and QC only wants to fail part of it.
    // The job stays 'In Progress' with a reduced `quantity` — the remaining
    // units are still awaiting their own Approve/Fail decision, so this same
    // job can be decided on again. Omitting rejectQty (or sending it equal to
    // the full remaining quantity) is a full reject and falls through to the
    // unchanged legacy branch below.
    // Purchased item with a serial per piece (2026-10-13): QC ticks the
    // serials it rejects — their count is the reject quantity.
    let rejectedUnitIds = null;
    let pickedRejectQty = rejectQty;
    if (decision === 'Fail' && job.source === 'Purchase') {
      const { readRejectedSerials } = await import('../services/purchasedUnitService.js');
      const picked = await readRejectedSerials(job, body.rejectSerials, rejectQty);
      if (picked.error) return { status: 400, body: { success: false, message: picked.error } };
      if (picked.unitIds) {
        rejectedUnitIds = picked.unitIds;
        pickedRejectQty = picked.qty;
      }
    }

    const parsedRejectQty = Number(pickedRejectQty);
    // A job-work reject scraps pieces: which serials were in them (2 Nov review).
    let jwScrap = null;
    if (decision === 'Fail' && job.source === 'SubChildPartJobWork' && job.subChildPartJobWorkOrderId) {
      const { checkPiecePick } = await import('../services/serialTrailService.js');
      const jw = await SubChildPartJobWorkOrder.findById(job.subChildPartJobWorkOrderId).select('orderId subChildPartItem').lean();
      if (jw) {
        const scrapN = parsedRejectQty > 0 && parsedRejectQty < job.quantity ? parsedRejectQty : job.quantity;
        const pick = await checkPiecePick({ companyId: job.company, orderRef: jw._id, itemId: jw.subChildPartItem, qty: scrapN, onHand: job.quantity, unitIds: body.scrapSerials?.unitIds });
        if (pick.error) return { status: 400, body: { success: false, message: pick.error } };
        jwScrap = { order: jw, picked: pick };
      }
    }
    // Fewer serials than pieces: QC reads the warning first (logic §12).
    const qcSkip = saleSkip || jwScrap?.picked.skip || null;
    if (qcSkip) {
      const { acknowledged, confirmBody } = await import('../services/serialTrailService.js');
      if (!acknowledged(body.acknowledgeWarnings)) return { status: 409, body: confirmBody([qcSkip]) };
    }
    const logQcSkip = async (screen) => {
      if (qcSkip) await (await import('../services/serialTrailService.js')).logSkippedSerials(job.company, [qcSkip], { screen, reference: job.orderCode || job.sourceRefId || job.qcJobId || '', by: whoOf(user) });
    };
    const isPartialReject = decision === 'Fail'
      && Number.isFinite(parsedRejectQty) && parsedRejectQty > 0
      && parsedRejectQty < job.quantity;

    if (isPartialReject) {
      job.quantity -= parsedRejectQty;
      // Fabrication (2026-10-15): one entry per size rejected, so a Pass
      // credits each size's stock less exactly what QC rejected of it.
      const sizeParts = Array.isArray(body.rejectSizes) ? body.rejectSizes.filter(s => Number(s?.qty) > 0) : [];
      if (rejectLines) {
        // One entry per breakdown line (2026-10-30) — its own qty, size,
        // what failed, remark, severity and photos.
        for (const l of rejectLines) {
          job.partialRejections.push({
            qty: l.qty, reason: l.remark, parameter: l.parameter, other: !!l.other, rejectedBy: user._id, rejectedByName: whoOf(user),
            severity: l.severity, sizeValues: l.sizeValues || null, photos: l.photos || [], failedChecks: [lineCheck(l, job.checklist, user)], decisionId,
          });
        }
      } else if (sizeParts.length) {
        for (const s of sizeParts) job.partialRejections.push({ qty: Number(s.qty), reason: failReason, rejectedBy: user._id, rejectedByName: whoOf(user), severity, sizeValues: s.values, photos, failedChecks: failed });
      } else {
        job.partialRejections.push({ qty: parsedRejectQty, reason: failReason, rejectedBy: user._id, rejectedByName: whoOf(user), severity, photos, failedChecks: failed });
      }
      job.failSeverity = severity;
      job.returnedToSource = true;
      // Downstream helpers (createRejectedProductionOrder / createQCRejectedPurchaseReturn
      // / createQCRejectedPurchaseExchange) read qcJob.failReason for their
      // "why was this rejected" record — the terminal (non-partial) path sets
      // this too, but that only runs when the job fully closes. Set it here
      // too so a partial reject's reason actually reaches Repair/Rework/Exchange.
      job.failReason = failReason;

      if (job.source === 'Purchase') {
        // Recorded after the save below as a PurchaseRejection waiting for
        // the vendor's answer (2026-10-12, purchaseRejectionService) — no
        // automatic return / exchange email any more.
      } else if (job.source === 'Store') {
        // Store sent this item straight to QC (e.g. a Purchase/Manufacturing
        // Machine already sitting in stock) — the rejected qty simply goes
        // back to Store's inventory. No Production rework order: there was
        // never a production run behind this item, and Store re-routes the
        // restored qty itself via Check Inventory (reactivated below since
        // storeQCStatus is left untouched on a partial reject anyway).
        await restoreStoreInventoryQty(job, parsedRejectQty);
        // Unlike a full reject, the linked Sale item's storeQCStatus is left
        // untouched here — the remaining quantity is still actively in QC.
      } else if (job.source === 'SubChildPartJobWork' && job.subChildPartJobWorkOrderId) {
        // No rework/return doc — explicitly deferred pending client sign-off
        // on what that flow should do. The rejected slice is just recorded
        // on the order for Purchase's own "QC Rejected" landing spot; the
        // remaining (non-rejected) quantity stays with this same QCJob,
        // awaiting its own Approve/Fail decision, same as every other source.
        try {
          const scOrder = await SubChildPartJobWorkOrder.findById(job.subChildPartJobWorkOrderId);
          if (scOrder) {
            scOrder.qc.rejectedQty = (scOrder.qc.rejectedQty || 0) + parsedRejectQty;
            scOrder.qc.rejectedReason = failReason;
            scOrder.qc.rejectedAt = new Date();
            const round = job.jobWorkRoundId ? scOrder.rounds.id(job.jobWorkRoundId) : null;
            if (round?.qc) round.qc.rejectedQty = (round.qc.rejectedQty || 0) + parsedRejectQty;
            await scOrder.save();
            if (jwScrap) await (await import('../services/serialTrailService.js')).applyScrappedPieces({ companyId: job.company, ...jwScrap, by: whoOf(user), note: failReason });
            await logQcSkip('QC reject');
            // Rejected pieces of a cascade order: a replacement order (2026-10-27).
            const { raiseReplacementFor } = await import('../services/subChildPartOrderService.js');
            await raiseReplacementFor(scOrder, parsedRejectQty, `Rejected at QC${failReason ? `: ${failReason}` : ''}`);
          }
        } catch (scErr) {
          console.error('❌ Error recording partial QC rejection on Sub Child Part Job Work order:', scErr);
        }
      } else {
        try {
          await createRejectedProductionOrder(job, user, parsedRejectQty);
          console.log(`✅ [QC Partial Rejection] Created production order for ${parsedRejectQty} of ${job.itemName}; ${job.quantity} remaining in QC`);
        } catch (prodError) {
          console.error('❌ Error creating production order for partially rejected item:', prodError);
        }
        // Unlike a full reject, the linked Sale item's storeQCStatus is left
        // untouched here — the remaining quantity is still actively in QC.
      }

      await job.save();

      if (job.source === 'Purchase') {
        await recordPurchaseRejections(job, { lines: rejectLines, qty: parsedRejectQty, unitIds: rejectedUnitIds, photos, failed, decisionId, user, req, wholeLot: false });
      }

      if (notify) try {
        await notificationService.triggerQCNotification({
          action: 'qc_failed',
          data: { qcJobId: job.qcJobId, itemName: job.itemName, failReason, jobId: job._id, partial: true, rejectedQty: parsedRejectQty, remainingQty: job.quantity },
          targetCompanyId: job.company,
        });
      } catch (e) { console.error('QC decision notification error:', e); }

      return { status: 200, body: { success: true, data: job, partial: true } };
    }

    job.decision = decision;
    job.status = decision === 'Pass' ? 'Approved' : 'Rejected';
    job.inspectionEndDate = today();
    job.decidedBy = whoOf(user);
    job.decidedAt = new Date();
    if (decision === 'Fail') {
      job.rejectionPhotos = rejectLines ? rejectLines.flatMap(l => l.photos || []) : photos;
      job.failedChecks = rejectLines ? rejectLines.map(l => lineCheck(l, job.checklist, user)) : failed;
      job.rejectLines = rejectLines ? rejectLines.map(l => ({ ...l, serials: l.serials || [], decisionId })) : [];
    }
    job.failReason = failReason || '';
    if (decision === 'Fail') job.failSeverity = severity;
    job.inspectorRemarks = inspectorRemarks || '';

    if (decision === 'Pass') {
      job.transferredToStore = true;
      // Purchase money (2026-10-12): what QC passed, recorded before the
      // machine path below trims job.quantity to the dispatch share.
      if (job.source === 'Purchase') job.acceptedQty = job.quantity;

      // Sub Child Part Job Work — a dedicated path, not threaded through the
      // generic shouldAddToInventory/itemCode-resolution logic below (that
      // fallback searches by a `store` string field this order type doesn't
      // populate). Resolve straight through the order's own real
      // subChildPartItem ObjectId instead, same as every other place this
      // order type already does (subChildPartJobWorkOrderController.js).
      // Credits exactly job.quantity — whatever survived any partial
      // rejections above — and closes out the order.
      if (job.source === 'SubChildPartJobWork' && job.subChildPartJobWorkOrderId) {
        const scOrder = await SubChildPartJobWorkOrder.findById(job.subChildPartJobWorkOrderId);
        if (scOrder) {
          // Per-step QC (2026-10-22): a check after a trip before the last only
          // lets the next step go out; the order's final check puts the pieces
          // into stock and completes it.
          const round = job.jobWorkRoundId ? scOrder.rounds.id(job.jobWorkRoundId) : null;
          if (round?.qc) Object.assign(round.qc, { status: 'Passed', passedQty: job.quantity, decidedAt: new Date() });
          const isFinal = !job.jobWorkRoundId || String(scOrder.qcJobId) === String(job._id);
          if (isFinal) {
            await deliverFinishedParts({ order: scOrder, model: 'SubChildPartJobWorkOrder', itemId: scOrder.subChildPartItem, qty: job.quantity, by: whoOf(user) });
            scOrder.status = 'Completed';
            scOrder.completedAt = new Date();
            scOrder.qc.approvedQty = job.quantity;
          }
          await scOrder.save();
          // Slice 4 (2026-10-24): the job-work order's cost (accepted money
          // on its Outsource Orders ÷ pieces into stock) — never typed now.
          if (isFinal) await pushJobWorkCost(scOrder._id);
        }
      }

      // Sub Child Part in-house Production — same dedicated-path reasoning
      // as the job-work block above, just resolved via ProductionOrder
      // (sourceRefId === order.orderId, the same key
      // subChildPartOrderMfgController.js's submit-to-QC action used to
      // create this job) instead of a SubChildPartJobWorkOrder. No partial
      // reject exists for this route (confirmed with the user — an in-house
      // build is one physical thing, not a batch to split), so this is
      // always the full order quantity. Only the Item.qty stock credit is
      // still genuinely kind-specific here — the checkpoint step's own
      // processes[] completion and order.status (Stage 3b, 2026-09-23: Sub
      // Child Part now has a real dynamic processes[] pipeline, not the old
      // bespoke single-stage flow) are owned by the generalized
      // "checkpoint is the last step" block further below, which now
      // includes this source too.
      if (job.source === 'SubChildPartProduction') {
        const prodOrder = await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company });
        if (prodOrder && prodOrder.subChildPartItem) {
          await deliverFinishedParts({ order: prodOrder, itemId: prodOrder.subChildPartItem, qty: job.quantity, by: whoOf(user) });
        }
      }

      // 1. Update Item Inventory
      // Rules:
      // - 'Purchase' source  → item received from vendor → ADD to inventory
      // - 'Stock' source     → company produced for own stock → ADD to inventory
      // - 'Store' source     → item was from store order (qty already deducted) → dispatch, no add
      // - 'QC_Rejected'      → item re-made for original order → dispatch, no add

      // Purchase-sourced jobs need the linked PurchaseRequest/Sale/sale-item
      // resolved before the inventory-vs-dispatch decision below (surplus
      // split) — resolved once here, reused in step 2 (Link QC Job back to
      // Sale) instead of querying it twice.
      let purchaseSaleCtx = null;

      let shouldAddToInventory = false;
      let inventoryAddQty = job.quantity || 1;
      if (job.source === 'Stock') {
        shouldAddToInventory = true;
      } else if (job.source === 'Purchase') {
        purchaseSaleCtx = await resolvePurchaseSaleContext(job);
        const isMachine = await isMachineJobItem(job, job.company);
        if (!isMachine) {
          shouldAddToInventory = true; // raw material — unchanged, always adds
        } else if (purchaseSaleCtx.saleItem) {
          // Machine/Motor purchase: Purchase can legitimately buy more than
          // the linked order needs (vendor MOQ, buying ahead). Only the
          // surplus beyond what the sale item still needs should land in
          // inventory (e.g. Motor Master stock) — the rest still dispatches.
          const remainingNeeded = Math.max(0, (purchaseSaleCtx.saleItem.quantity || 0) - (purchaseSaleCtx.saleItem.approvedQty || 0));
          const surplusQty = Math.max(0, (job.quantity || 0) - remainingNeeded);
          if (surplusQty > 0) {
            shouldAddToInventory = true;
            inventoryAddQty = surplusQty;
            // Shrink the job's own quantity to just the dispatch-bound
            // portion — the Sale approvedQty update below and the Packaging
            // queue's per-unit job count both read job.quantity fresh, so
            // this one change is enough to keep dispatch in sync too.
            job.quantity -= surplusQty;
          }
        }
        // No linked sale item found (e.g. a standalone purchase not tied to
        // any order) → fall back to the pre-fix behavior: nothing added,
        // whole qty treated as dispatch-bound.
      }

      if (shouldAddToInventory) {
        try {
          let inventoryItem = null;

          // Attempt 0 (2026-10-30): the job's own item link (a purchase job's
          // PO line item) — its itemCode may be a request number.
          if (job.item) inventoryItem = await Item.findOne({ _id: job.item, companyId: job.company });

          // Attempt 1: Search by ObjectId
          if (!inventoryItem && job.itemCode && /^[0-9a-fA-F]{24}$/.test(job.itemCode)) {
            inventoryItem = await Item.findById(job.itemCode);
          }

          // Attempt 2: Search by Code and Store
          if (!inventoryItem && job.itemCode) {
            inventoryItem = await Item.findOne({
              code: job.itemCode,
              store: job.company.toString()
            });
          }

          // Attempt 3: Search by Name and Store
          if (!inventoryItem && job.itemName) {
            inventoryItem = await Item.findOne({
              name: job.itemName,
              store: job.company.toString()
            });
          }

          // Fabrication Master items only — Store recorded a per-dimension
          // breakdown at receive time (PurchaseRequest.receivedFabricationLines,
          // see purchaseRequestController.js's receiveFabricationPurchase).
          // These items don't use flat Item.qty as their real stock measure —
          // dimensionVariants[].subStock already is — so credit each line
          // instead. A line matching an existing catalog/leftover variant
          // just increments it; a line the vendor shipped that isn't in the
          // catalog at all creates a new variant flagged isLeftover (usable
          // stock, never offered as a reorderable catalog size again).
          // What THIS job passed, per size (2026-10-15): its own received
          // pieces (job.receivedSizes; an old job falls back to the request's
          // lines) less what QC rejected of each size. It used to credit
          // every received piece — rejected ones too, and once per request
          // on a shared line.
          const receivedLines = job.source === 'Purchase' ? passedSizesOf(job, purchaseSaleCtx?.pr) : null;
          if (inventoryItem && receivedLines?.length > 0 && inventoryItem.fabricationRef) {
            for (const line of receivedLines) {
              const existingVariant = inventoryItem.dimensionVariants.find(
                dv => dimensionSignature(dv.values) === dimensionSignature(line.values)
              );
              if (existingVariant) {
                existingVariant.subStock = (existingVariant.subStock || 0) + line.quantity;
              } else {
                inventoryItem.dimensionVariants.push({
                  category: inventoryItem.dimensionVariants?.[0]?.category || '',
                  values: line.values,
                  designation: '',
                  densityValue: inventoryItem.dimensionVariants?.[0]?.densityValue ?? null,
                  densityUnit: inventoryItem.dimensionVariants?.[0]?.densityUnit || 'kg/m3',
                  weightPerMeterKg: null,
                  weightPerPieceKg: line.weightPerPieceKg ?? null,
                  subStock: line.quantity,
                  isLeftover: true,
                });
              }
            }
            await inventoryItem.save();
            console.log(`✅ [QC Approval - ${job.source}] Fabrication dimension stock credited for ${inventoryItem.name} (${receivedLines.length} line(s))`);
          } else if (inventoryItem) {
            const prevQty = inventoryItem.qty || 0;
            inventoryItem.qty = prevQty + inventoryAddQty;
            await inventoryItem.save();
            console.log(`✅ [QC Approval - ${job.source}] Inventory updated for ${inventoryItem.name}. Prev: ${prevQty}, New: ${inventoryItem.qty}`);
          } else {
            const newCode = job.itemCode || `ITEM-${Date.now()}`;
            inventoryItem = await Item.create({
              name: job.itemName,
              code: newCode,
              category: job.category || 'Raw Material',
              qty: inventoryAddQty,
              unit: job.unit || 'pcs',
              store: job.company.toString(),
              companyId: job.company,
              type: job.category === 'Finished Good' ? 'Product' : 'Material',
              stdCost: 0,
              purchaseCost: 0,
              salePrice: 0
            });
            console.log(`✅ [QC Approval - ${job.source}] Created new inventory item: ${job.itemName}`);
          }
        } catch (invError) {
          console.error('❌ Error updating inventory upon QC Approval:', invError);
        }
      } else {
        console.log(`[QC Approval - ${job.source}] No inventory add — item goes to dispatch/packing.`);
      }

      // 2. Link QC Job back to Sale / Order and update statuses
      //
      // Rules per source:
      // - 'Store'/'Production' → set storeQCStatus='Approved from QC' (goes to dispatch)
      // - 'QC_Rejected'        → same as Store — find linked Sale via ProductionOrder notes, mark available for dispatch
      // - 'Stock'              → inventory already updated above; no sale/dispatch update
      // - 'Purchase'           → set storeQCStatus='Approved from QC' (for machines) or 'Purchase Completed' (others)

      if (job.source === 'Store' || job.source === 'Production') {
        try {
          // Strategy 1: Use direct saleId reference (most reliable — set when QC job created)
          let saleByRef = null;
          if (job.saleId) {
            saleByRef = await Sale.findById(job.saleId);
          }

          // Strategy 2: Fall back to sourceRefId matching
          if (!saleByRef && job.sourceRefId) {
            saleByRef = await Sale.findOne({
              $or: [
                { invoiceNumber: job.sourceRefId },
                { _id: /^[0-9a-fA-F]{24}$/.test(job.sourceRefId) ? job.sourceRefId : null }
              ]
            });
          }

          // Strategy 3: Lookup via ProductionOrder (if Production source)
          if (!saleByRef && job.source === 'Production' && job.sourceRefId) {
            try {
              const prodOrder = await ProductionOrder.findOne({
                orderId: job.sourceRefId,
                company: job.company
              }).lean();
              if (prodOrder && prodOrder.saleId) {
                saleByRef = await Sale.findById(prodOrder.saleId);
              }
            } catch (err) {
              console.error('Error looking up production order for sale ref:', err);
            }
          }

          if (saleByRef) {
            // Multi-item: update only THIS item's status (falls back to the
            // whole-sale field for legacy jobs without saleItemId), then the
            // aggregate is recomputed inside setSaleItemStatus.
            let itemIdForUpdate = job.saleItemId;
            if (!itemIdForUpdate && job.source === 'Production' && job.sourceRefId) {
              // Production QC jobs may predate saleItemId — recover it from the ProductionOrder
              try {
                const srcProd = await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company })
                  .select('saleItemId').lean();
                itemIdForUpdate = srcProd?.saleItemId || null;
              } catch (_) { /* fall back to sale-level */ }
            }
            const perItem = await setSaleItemStatus(saleByRef, itemIdForUpdate, 'Approved from QC', { qty: job.quantity });
            console.log(`✅ [QC Approval - ${job.source}] 'Approved from QC' for Sale ${saleByRef._id}${perItem ? ` (item ${itemIdForUpdate})` : ' (sale-level)'}`);
          } else {
            console.warn(`⚠️ [QC Approval - ${job.source}] Could not find linked Sale for QC Job ${job.qcJobId}. saleId: ${job.saleId}, sourceRefId: ${job.sourceRefId}`);
          }
        } catch (e) { console.error(`❌ Error updating Sale on ${job.source} QC approval:`, e); }

      } else if (job.source === 'QC_Rejected') {
        // Re-made item for original order — mark that item ready for dispatch.
        try {
          const linkedProdOrder = await ProductionOrder.findOne({
            $or: [
              { orderId: job.sourceRefId },
              { _id: job.sourceRefId && /^[0-9a-fA-F]{24}$/.test(job.sourceRefId) ? job.sourceRefId : null }
            ],
            company: job.company
          }).lean();

          // Strategy 1 (multi-item): direct saleId + saleItemId carried on the
          // QC job / rejected ProductionOrder
          let linkedSale = null;
          let saleItemId = job.saleItemId || linkedProdOrder?.saleItemId || null;
          const directSaleId = job.saleId || linkedProdOrder?.saleId || null;
          if (directSaleId) {
            linkedSale = await Sale.findById(directSaleId);
          }

          // Strategy 2 (legacy): parse "Ref: <invoice/saleId>" from the notes
          if (!linkedSale && linkedProdOrder?.notes) {
            const notesRefMatch = linkedProdOrder.notes.match(/Ref:\s*(\S+)/);
            // Multi-item refs look like "INV#<saleItemId>" — split them apart
            const rawRef = notesRefMatch ? notesRefMatch[1] : null;
            const saleRef = rawRef ? rawRef.split('#')[0] : null;
            if (rawRef && rawRef.includes('#') && !saleItemId) {
              const parts = rawRef.split('#');
              if (/^[0-9a-fA-F]{24}$/.test(parts[1])) saleItemId = parts[1];
            }
            if (saleRef) {
              linkedSale = await Sale.findOne({
                $or: [
                  { invoiceNumber: saleRef },
                  { _id: /^[0-9a-fA-F]{24}$/.test(saleRef) ? saleRef : null }
                ]
              });
            }
          }

          if (linkedSale) {
            const perItem = await setSaleItemStatus(linkedSale, saleItemId, 'Approved from QC', { isAvailableInInventory: 'Available', qty: job.quantity });
            console.log(`[QC Approval - QC_Rejected] Sale ${linkedSale._id} → Approved from QC${perItem ? ` (item ${saleItemId})` : ' (sale-level)'}. Ready for dispatch.`);
          }
        } catch (e) { console.error('❌ Error updating Sale on QC_Rejected approval:', e); }

      } else if (job.source === 'Stock') {
        // Stock production — qty added to inventory above, no sale/dispatch update needed
        console.log(`[QC Approval - Stock] Inventory updated. No sale/dispatch update.`);

      } else if (job.source === 'Purchase') {
        // Purchase source — update storeQCStatus on linked sale. Context
        // (PurchaseRequest + Sale) was already resolved above in the
        // inventory-vs-dispatch split; re-resolve only if that branch was
        // skipped for some reason.
        try {
          const { pr, sale: salePurch } = purchaseSaleCtx || await resolvePurchaseSaleContext(job);

          console.log(`[QC Approval - Purchase] PR lookup result:`, pr ? `Found PR ${pr.requestId}, storeOrderId: ${pr.storeOrderId}` : 'Not found');

          if (pr && pr.storeOrderId) {
            if (salePurch) {
              const isMachine = await isMachineJobItem(job, job.company);
              const newStatus = isMachine ? 'Approved from QC' : 'Purchase Completed';
              // Multi-item: the Purchase Request carries the exact sale item
              const saleItemId = pr.saleItemId || job.saleItemId || null;
              // job.quantity was already shrunk above to just the
              // dispatch-bound portion when Purchase bought more than this
              // sale item needed, so approvedQty only accumulates that much.
              const perItem = await setSaleItemStatus(salePurch, saleItemId, newStatus, { qty: job.quantity });
              console.log(`✅ [QC Approval - Purchase ${isMachine ? 'Machine' : 'Material'}] '${newStatus}' for Sale ${salePurch._id}${perItem ? ` (item ${saleItemId})` : ' (sale-level)'}`);
            } else {
              console.warn(`⚠️ [QC Approval - Purchase] PR ${pr.requestId} found but could not locate linked Sale (storeOrderId: ${pr.storeOrderId})`);
            }
          } else if (!pr) {
            console.warn(`⚠️ [QC Approval - Purchase] Could not find PurchaseRequest for QC Job ${job.qcJobId}. sourceRefId: ${job.sourceRefId}, itemCode: ${job.itemCode}`);
          } else {
            console.warn(`⚠️ [QC Approval - Purchase] PR ${pr.requestId} has no storeOrderId — skipping Sale status update`);
          }
        } catch (e) { console.error('❌ Error updating purchase status on QC Approval:', e); }
      }

    }

    if (decision === 'Fail') {
      job.returnedToSource = true;

      if (job.source === 'Purchase') {
        // Recorded after the save below as a PurchaseRejection waiting for
        // the vendor's answer (2026-10-12, purchaseRejectionService) — no
        // automatic return / exchange email any more.
      } else if (job.source === 'SubChildPartJobWork' && job.subChildPartJobWorkOrderId) {
        // Full reject — the whole remaining quantity is rejected, nothing
        // left for QC to still decide on this order. Same "just a landing
        // spot" recording as the partial-reject branch above; no linked
        // Sale to update (this order type never has one), so this
        // deliberately skips the Sale-lookup step below entirely.
        try {
          const scOrder = await SubChildPartJobWorkOrder.findById(job.subChildPartJobWorkOrderId);
          if (scOrder) {
            scOrder.qc.rejectedQty = (scOrder.qc.rejectedQty || 0) + (job.quantity || 0);
            scOrder.qc.rejectedReason = failReason;
            scOrder.qc.rejectedAt = new Date();
            const round = job.jobWorkRoundId ? scOrder.rounds.id(job.jobWorkRoundId) : null;
            if (round?.qc) Object.assign(round.qc, { status: 'Rejected', passedQty: 0, rejectedQty: (round.qc.rejectedQty || 0) + (job.quantity || 0), decidedAt: new Date() });
            scOrder.status = 'Completed';
            scOrder.completedAt = new Date();
            await scOrder.save();
            if (jwScrap) await (await import('../services/serialTrailService.js')).applyScrappedPieces({ companyId: job.company, ...jwScrap, by: whoOf(user), note: failReason });
            await logQcSkip('QC reject');
            const { raiseReplacementFor } = await import('../services/subChildPartOrderService.js');
            await raiseReplacementFor(scOrder, job.quantity || 0, `Rejected at QC${failReason ? `: ${failReason}` : ''}`);
          }
        } catch (scErr) {
          console.error('❌ Error recording full QC rejection on Sub Child Part Job Work order:', scErr);
        }
      } else if (job.source === 'SubChildPartProduction') {
        // Reopen the order so Production can see exactly which checklist
        // row(s) failed and fix + resubmit. No quantity split (see the Pass
        // branch's own comment — an in-house build is one physical thing)
        // and no linked Sale to update (this order type never has one), so
        // — same as the job-work branch above — this deliberately skips the
        // Sale-lookup step below entirely. Stage 3b (2026-09-23): Sub Child
        // Part now has a real dynamic processes[] pipeline whose checkpoint
        // is always the last step (its fixed rule), so the SAME position-
        // based reopen Machine already uses applies unchanged here —
        // reopenFinalTestingForRejection resets whichever step sits at
        // procs.length-1 for every unit, not literally "Final Testing".
        try {
          await reopenFinalTestingForRejection(job, user);
        } catch (scErr) {
          console.error('❌ Error reopening Sub Child Part order for rejection:', scErr);
        }
      } else {
        if (job.source === 'Store') {
          // Store sent this item straight to QC (e.g. a Purchase/Manufacturing
          // Machine already sitting in stock) — restore the qty to inventory
          // and let Store re-route it via Check Inventory (reactivated below
          // since lastRejectionSource is recorded as 'Store'). No Production
          // rework order: there was never a production run behind this item.
          await restoreStoreInventoryQty(job, job.quantity || 1);
        } else {
          // A FULL reject of a Production-lineage job no longer spins up a
          // brand-new order and a separate Rework/Repair decision (that
          // whole system is retired, 2026-09-02) — Production can already
          // see exactly which checklist item failed right on the same
          // order's Final Testing step, so it just reopens that same order
          // for them to fix and resubmit. Partial rejects (job.quantity >
          // job's rejected slice, handled earlier in this function) are a
          // narrower, unaddressed case and still use the old
          // createRejectedProductionOrder path below them for now.
          try {
            await reopenFinalTestingForRejection(job, user);
            console.log(`✅ [QC Rejection] Reopened Final Testing on the original order for: ${job.itemName}`);
          } catch (prodError) {
            console.error('❌ Error reopening Final Testing for rejected item:', prodError);
          }
        }

        // Update linked Sale storeQCStatus to 'Rejected from QC' so Store knows
        try {
          // Strategy 1: Use direct saleId (set at QC job creation time)
          let saleRej = null;
          if (job.saleId) {
            saleRej = await Sale.findById(job.saleId);
          }

          // Strategy 2: Fall back to sourceRefId
          if (!saleRej && job.sourceRefId) {
            saleRej = await Sale.findOne({
              $or: [
                { invoiceNumber: job.sourceRefId },
                { _id: /^[0-9a-fA-F]{24}$/.test(job.sourceRefId) ? job.sourceRefId : null }
              ]
            });
          }

          if (saleRej) {
            // Multi-item: only the rejected item flips to 'Rejected from QC';
            // other items of the order keep their own progress.
            let itemIdForReject = job.saleItemId;
            if (!itemIdForReject && (job.source === 'Production' || job.source === 'QC_Rejected') && job.sourceRefId) {
              try {
                const srcProd = await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company })
                  .select('saleItemId').lean();
                itemIdForReject = srcProd?.saleItemId || null;
              } catch (_) { /* fall back to sale-level */ }
            }
            const perItem = await setSaleItemStatus(saleRej, itemIdForReject, 'Rejected from QC', { rejectionSource: job.source });
            console.log(`✅ [QC Rejection] 'Rejected from QC' for Sale ${saleRej._id}${perItem ? ` (item ${itemIdForReject})` : ' (sale-level)'}`);
          } else {
            console.warn(`⚠️ [QC Rejection] Could not find linked Sale for QC Job ${job.qcJobId}`);
          }
        } catch (saleRejErr) {
          console.error('❌ Error updating sale storeQCStatus on rejection:', saleRejErr);
        }
      }
    }

    await job.save();

    // Purchase money (2026-10-12, accounts Slice 2): passed material becomes
    // payable on the PO's bill (+ ledger); the last pass settles the PO.
    // The picked sticker / serial goes to the customer's Order (§5.8), with
    // everything fitted in it.
    if (saleSkip) await logQcSkip('Sale from stock');
    if (salePick && (salePick.unitIds.length || salePick.labelIds.length)) {
      const { move, IN_STOCK } = await import('../services/serialTrailService.js');
      await move({ unitIds: salePick.unitIds, labelIds: salePick.labelIds, place: { kind: 'Sold', customerOrderCode: job.orderCode || '' }, what: 'Sold from stock', by: whoOf(user), note: job.qcJobId || '', from: IN_STOCK });
    }
    if (decision === 'Pass' && job.source === 'Purchase') {
      const { onMaterialAccepted } = await import('../services/purchaseAcceptanceService.js');
      await onMaterialAccepted(job, user, req);
      const { markAccepted } = await import('../services/purchasedUnitService.js');
      await markAccepted(job);
    }
    // QC failed what was left: a PurchaseRejection, waiting for the vendor's
    // answer (2026-10-12, accounts Slice 3).
    if (decision === 'Fail' && job.source === 'Purchase') {
      // What was left all failed — unless this is one request's share of a PO
      // line that was only partly rejected (decideLine says).
      await recordPurchaseRejections(job, { lines: rejectLines, qty: job.quantity, unitIds: rejectedUnitIds, photos, failed, decisionId, user, req, wholeLot: body.wholeLine !== false });
    }

    // 🔔 Notify based on QC decision (one per line when decided as a line — decideLine)
    if (notify) try {
      if (decision === 'Pass') {
        await notificationService.triggerQCNotification({
          action: 'qc_passed',
          data: { qcJobId: job.qcJobId, itemName: job.itemName, jobId: job._id },
          targetCompanyId: job.company,
        });
      } else {
        await notificationService.triggerQCNotification({
          action: 'qc_failed',
          data: { qcJobId: job.qcJobId, itemName: job.itemName, failReason: job.failReason, jobId: job._id },
          targetCompanyId: job.company,
        });
      }
    } catch (e) { console.error('QC decision notification error:', e); }

    return { status: 200, body: { success: true, data: job } };
  }
}

// A fabrication purchase job's passed pieces per size: its own received
// sizes less the pieces QC rejected of each size. A rejection recorded with
// no size (an old job) comes off the job's only size when it has one.
export function passedSizesOf(job, pr) {
  const own = job.receivedSizes?.length ? job.receivedSizes : (pr?.receivedFabricationLines || []);
  const lines = own.map(l => ({ values: l.values, quantity: Number(l.quantity) || 0, weightPerPieceKg: l.weightPerPieceKg ?? null }));
  for (const r of job.partialRejections || []) {
    const qty = Number(r.qty) || 0;
    const target = r.sizeValues
      ? lines.find(l => dimensionSignature(l.values) === dimensionSignature(r.sizeValues))
      : (lines.length === 1 ? lines[0] : null);
    if (target) target.quantity = Math.max(0, target.quantity - qty);
  }
  return lines.filter(l => l.quantity > 0);
}

// ── QC by PO line (2026-10-15) ────────────────────────────────────────────
// Store receives one PO line; every request on it keeps its own job (stock,
// money, REJ, serials, Sales / Production hang off it), but QC sees and
// decides the LINE: one card (the lead job), one decision, applied to each
// request's job. A rejected quantity goes to the requests by the user's rule
// (services/qcLineAllocation.js).
const OPEN = ['Pending', 'In Progress'];

export function lineStatusOf(statuses) {
  if (statuses.some(s => s === 'In Progress')) return 'In Progress';
  if (statuses.some(s => s === 'Pending')) return statuses.every(s => s === 'Pending') ? 'Pending' : 'In Progress';
  return statuses.some(s => s === 'Approved') ? 'Approved' : 'Rejected';
}

async function refreshLineStatus(company, receiptKey) {
  if (!receiptKey) return;
  const jobs = await QCJob.find({ company, receiptKey }).select('status').lean();
  if (!jobs.length) return;
  await QCJob.updateMany({ company, receiptKey }, { $set: { lineStatus: lineStatusOf(jobs.map(j => j.status)) } });
}

// Everything about one received line, for the decision and the page.
export async function receiptContext(lead) {
  const jobs = await QCJob.find({ company: lead.company, receiptKey: lead.receiptKey }).sort({ _id: 1 });
  const PurchaseRequest = (await import('../models/PurchaseRequest.js')).default;
  const { classifyRaisedBy } = await import('./purchaseRequestController.js');
  const { kindOfRaisedBy } = await import('../services/qcLineAllocation.js');
  const prs = await PurchaseRequest.find({ _id: { $in: jobs.map(j => j.purchaseRequestId).filter(Boolean) } })
    .select('requestId source autoGenerated reorderItemId storeOrderId saleItemId createdAt receivedFabricationLines').lean();
  const prById = new Map(prs.map(p => [String(p._id), p]));
  const rows = jobs.map(j => {
    const pr = prById.get(String(j.purchaseRequestId)) || null;
    const rejected = (j.partialRejections || []).reduce((s, r) => s + (Number(r.qty) || 0), 0) + (j.status === 'Rejected' ? Number(j.quantity) || 0 : 0);
    const open = OPEN.includes(j.status);
    return {
      job: j, pr, jobId: String(j._id), qcJobId: j.qcJobId, requestId: pr?.requestId || '',
      kind: kindOfRaisedBy(pr ? classifyRaisedBy(pr) : 'manual'),
      createdAt: pr?.createdAt || j.createdAt,
      status: j.status, open,
      inQc: open ? Number(j.quantity) || 0 : 0,
      received: Math.round(((j.status === 'Rejected' ? 0 : Number(j.acceptedQty ?? j.quantity) || 0) + rejected) * 1000) / 1000,
      rejected: Math.round(rejected * 1000) / 1000,
      sizes: j.isFabrication && open ? passedSizesOf(j, pr) : [],
    };
  });
  return { jobs, rows, isFabrication: !!lead.isFabrication || jobs.some(j => j.isFabrication) };
}

// What the page shows about the line (no job documents).
export const receiptSummary = (ctx) => ({
  isFabrication: ctx.isFabrication,
  sizes: (() => {
    const m = new Map();
    for (const r of ctx.rows) for (const s of r.job.receivedSizes || []) {
      const k = dimensionSignature(s.values);
      const cur = m.get(k) || { values: s.values, quantity: 0 };
      cur.quantity += Number(s.quantity) || 0;
      m.set(k, cur);
    }
    return [...m.values()];
  })(),
  requests: ctx.rows.map(r => ({ jobId: r.jobId, qcJobId: r.qcJobId, requestId: r.requestId, kind: r.kind, status: r.status, inQc: r.inQc, received: r.received, rejected: r.rejected, sizes: r.sizes })),
  inQc: Math.round(ctx.rows.reduce((s, r) => s + r.inQc, 0) * 1000) / 1000,
  received: Math.round(ctx.rows.reduce((s, r) => s + r.received, 0) * 1000) / 1000,
  rejected: Math.round(ctx.rows.reduce((s, r) => s + r.rejected, 0) * 1000) / 1000,
});

// Decide every open job of the lead's receipt together. body: decision,
// failReason, severity, inspectorRemarks, rejectQty (line total) |
// rejectSizes [{ values, qty }] (fabrication) | rejectSerials [unit ids],
// dryRun (only say how a rejection would be shared out).
export async function decideLine(lead, body, user, req) {
  const { decision, failReason } = body;
  if (!['Pass', 'Fail'].includes(decision)) return { status: 400, body: { success: false, message: 'decision must be Pass or Fail' } };
  if (lead.status === 'Pending' && !body.dryRun) return { status: 400, body: { success: false, message: 'Start the inspection first.' } };
  // The checks and the decision in one go (2026-10-30): the lead's checklist
  // is the line's — saved first, so the line's jobs (loaded fresh below) see it.
  if (!body.dryRun && Array.isArray(body.results)) {
    try { applyRowResults(lead.checklist, body.results, user, { qcLayer: !!lead.finalCheckFilledBy }); } catch (e) {
      return { status: e.status || 400, body: { success: false, message: e.message } };
    }
    await lead.save();
  }
  const ctx = await receiptContext(lead);
  const openRows = ctx.rows.filter(r => r.open);
  if (!openRows.length) return { status: 409, body: { success: false, message: 'Nothing on this line is waiting for QC any more.' } };

  // Checklist: QC fills the lead's once — it's the line's. Not needed for a
  // reject with breakdown lines (2026-10-31) — the same rule as decideJob.
  const rejectByLines = decision === 'Fail' && Array.isArray(body.rejectLines) && body.rejectLines.length > 0;
  if (!body.dryRun && lead.checklist?.length && !rejectByLines) {
    const statusField = lead.finalCheckFilledBy ? 'qcStatus' : 'status';
    const pending = lead.checklist.filter(c => c[statusField] === 'Pending');
    if (pending.length) return { status: 400, body: { success: false, message: `${pending.length} checklist item${pending.length > 1 ? 's' : ''} still pending. Complete all checklist items before submitting a decision.` } };
  }
  // A reject breakdown (2026-10-30): read once for the whole line — the totals
  // drive today's share-out, then the lines follow it (shareLines).
  let lineLines = null;
  const decisionId = String(new mongoose.Types.ObjectId());
  const inQcTotal = openRows.reduce((s, r) => s + r.inQc, 0);
  const PurchasedUnitModel = (await import('../models/PurchasedUnit.js')).default;
  const linePieces = decision === 'Fail' ? await PurchasedUnitModel.find({ purchaseRequest: { $in: openRows.map(r => r.job.purchaseRequestId) }, isLot: false, status: 'In QC' }).select('purchaseRequest').lean() : [];
  if (decision === 'Fail' && !body.dryRun) {
    if (Array.isArray(body.rejectLines) && body.rejectLines.length) {
      const { isCountableUnit } = await import('../services/purchasedUnitService.js');
      const sizeMap = new Map();
      for (const r of openRows) for (const sz of r.sizes) {
        const k = dimensionSignature(sz.values);
        const cur = sizeMap.get(k) || { values: sz.values, quantity: 0 };
        cur.quantity += Number(sz.quantity) || 0;
        sizeMap.set(k, cur);
      }
      const read = readRejectLines(body.rejectLines, {
        inQc: inQcTotal, whole: ctx.isFabrication || isCountableUnit(lead.unit), isFabrication: ctx.isFabrication,
        sizes: [...sizeMap.values()], serialIds: linePieces.length ? linePieces.map(u => String(u._id)) : null,
        checklistParams: (lead.checklist || []).map(c => c.parameter), photos: Array.isArray(body.photos) ? body.photos : [],
      });
      if (read.error) return { status: 400, body: { success: false, message: read.error } };
      lineLines = read.lines;
      body = {
        ...body,
        rejectQty: read.total,
        rejectSizes: read.bySize.length ? read.bySize : undefined,
        rejectSerials: read.serials.length ? read.serials : undefined,
        failReason: body.failReason || linesSummary(read.lines),
        severity: worstSeverity(read.lines),
      };
    } else if (inQcTotal > 1) {
      return { status: 400, body: { success: false, message: 'Add the reject lines — how many, what failed, and what was wrong.' } };
    }
  }
  if (decision === 'Fail' && !body.failReason && !body.dryRun) return { status: 400, body: { success: false, message: 'failReason is required when decision is Fail' } };
  const anyLinePhoto = lineLines ? lineLines.some(l => l.photos?.length) : (Array.isArray(body.photos) && body.photos.length > 0);
  if (decision === 'Fail' && !body.dryRun && !anyLinePhoto) return { status: 400, body: { success: false, message: PHOTO_REQUIRED } };

  // How a Fail is shared out — worked out completely before anything is written.
  const plan = new Map(); // jobId → { qty, sizes, serials }
  let serialOwner = null;
  if (decision === 'Fail') {
    const serialPieces = linePieces;
    if (serialPieces.length) {
      const jobOfPr = new Map(openRows.map(r => [String(r.job.purchaseRequestId), r.jobId]));
      serialOwner = new Map(serialPieces.map(u => [String(u._id), jobOfPr.get(String(u.purchaseRequest))]));
      // Serial items: the ticked serials decide — each belongs to its request.
      let ids = body.rejectSerials;
      if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
      ids = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
      const unitPr = new Map(serialPieces.map(u => [String(u._id), String(u.purchaseRequest)]));
      if (!ids.length) {
        const all = !(Number(body.rejectQty) > 0) || Number(body.rejectQty) >= openRows.reduce((s, r) => s + r.inQc, 0);
        if (!all) return { status: 400, body: { success: false, message: 'Tick the serial numbers QC rejected.' } };
        ids = [...unitPr.keys()];
      }
      if (ids.some(id => !unitPr.has(id))) return { status: 400, body: { success: false, message: 'One of the ticked serial numbers isn\'t waiting for QC on this line — refresh the page.' } };
      for (const r of openRows) {
        const mine = ids.filter(id => unitPr.get(id) === String(r.job.purchaseRequestId));
        if (mine.length) plan.set(r.jobId, { qty: mine.length, sizes: [], serials: mine });
      }
    } else {
      const { allocateRejection } = await import('../services/qcLineAllocation.js');
      const { isCountableUnit } = await import('../services/purchasedUnitService.js');
      const alloc = allocateRejection({
        jobs: openRows.map(r => ({ id: r.jobId, qty: r.inQc, kind: r.kind, createdAt: r.createdAt, sizes: r.sizes.map(s => ({ values: s.values, quantity: s.quantity })) })),
        rejectQty: body.rejectQty, bySize: body.rejectSizes,
        whole: ctx.isFabrication || isCountableUnit(lead.unit), isFabrication: ctx.isFabrication,
      });
      if (alloc.error) return { status: 400, body: { success: false, message: alloc.error } };
      for (const [id, a] of alloc.perJob) plan.set(id, { qty: a.qty, sizes: a.sizes, serials: null });
    }
  }
  const preview = openRows.map(r => ({ requestId: r.requestId, kind: r.kind, inQc: r.inQc, reject: plan.get(r.jobId)?.qty || 0 }));
  if (body.dryRun) return { status: 200, body: { success: true, preview } };
  // Each request's own lines, in the order its share was taken.
  const linesByJob = lineLines
    ? shareLines(lineLines, serialOwner ? { serialOwner } : { plan, jobs: openRows.map(r => ({ id: r.jobId, kind: r.kind, createdAt: r.createdAt })) })
    : null;

  // The other jobs catch up with the lead (they're never opened themselves).
  const checklistCopy = (lead.checklist || []).map(c => { const o = c.toObject ? c.toObject() : { ...c }; delete o._id; return o; });
  for (const r of openRows) {
    if (r.jobId === String(lead._id)) continue;
    r.job.status = 'In Progress';
    r.job.inspector = lead.inspector;
    r.job.inspectionStartDate = r.job.inspectionStartDate || lead.inspectionStartDate || today();
    if (checklistCopy.length) r.job.checklist = checklistCopy;
    await r.job.save();
  }

  const results = [];
  // The whole line rejected? (The REJ's checklist applies only then, or with no lines.)
  const wholeLine = [...plan.values()].reduce((s, p) => s + (Number(p.qty) || 0), 0) >= inQcTotal - 1e-9;
  if (decision === 'Fail') {
    for (const r of openRows) {
      const p = plan.get(r.jobId);
      if (!p) continue;
      const out = await decideJob(r.job, {
        decision: 'Fail', failReason: body.failReason, severity: body.severity, inspectorRemarks: body.inspectorRemarks, photos: body.photos,
        rejectQty: p.qty, rejectSerials: p.serials || undefined, rejectSizes: p.sizes?.length ? p.sizes : undefined,
        ...(linesByJob ? { rejectLines: linesByJob.get(r.jobId) || [], linesResolved: true } : {}),
        photosChecked: true, decisionId, wholeLine,
      }, user, req, { notify: false });
      results.push({ requestId: r.requestId, kind: r.kind, rejected: p.qty, ok: out.status === 200, message: out.body?.message });
    }
  } else {
    for (const r of openRows) {
      const out = await decideJob(r.job, { decision: 'Pass', inspectorRemarks: body.inspectorRemarks }, user, req, { notify: false });
      results.push({ requestId: r.requestId, kind: r.kind, passed: r.inQc, ok: out.status === 200, message: out.body?.message });
    }
  }
  await refreshLineStatus(lead.company, lead.receiptKey);

  try {
    const rejectedTotal = results.reduce((s, x) => s + (x.rejected || 0), 0);
    await notificationService.triggerQCNotification({
      action: decision === 'Pass' ? 'qc_passed' : 'qc_failed',
      data: { qcJobId: lead.qcJobId, itemName: lead.itemName, jobId: lead._id, failReason: body.failReason, ...(decision === 'Fail' ? { partial: true, rejectedQty: rejectedTotal } : {}) },
      targetCompanyId: lead.company,
    });
  } catch (e) { console.error('QC line decision notification error:', e); }

  const failed = results.filter(x => !x.ok);
  const fresh = await QCJob.findById(lead._id);
  return {
    status: failed.length ? 500 : 200,
    body: { success: !failed.length, data: fresh, line: { results }, ...(failed.length ? { message: `Some requests weren't decided: ${failed.map(f => `${f.requestId} (${f.message})`).join('; ')}` } : {}) },
  };
}

// The HTTP decision. A purchase job that is part of a received PO line with
// other requests still in QC is decided as the LINE (decideLine, 2026-10-15).
export const submitDecision = async (req, res) => {
  try {
    req.body.photos = req.rejectionPhotos || []; // never from the JSON (2026-10-30)
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or not In Progress' });
    if (job.source === 'Purchase' && job.receiptKey) {
      const others = await QCJob.countDocuments({ company: job.company, receiptKey: job.receiptKey, _id: { $ne: job._id }, status: { $in: OPEN } });
      // The line: the lead's card stays the line's even after the lead's own
      // request was fully rejected while others are still in QC.
      if (others > 0 || req.body.dryRun) {
        if (!OPEN.includes(job.status) && job.groupMember) return res.status(404).json({ success: false, message: 'Job not found or not In Progress' });
        const out = await decideLine(job, req.body, req.user, req);
        return res.status(out.status).json(out.body);
      }
    }
    if (job.status !== 'In Progress') return res.status(404).json({ success: false, message: 'Job not found or not In Progress' });
    const out = await decideJob(job, req.body, req.user, req);
    // A job-work order (fully-outsourced Sub Child Part) decided: its trips on
    // Outsource Orders may now be payable (slice 3).
    if (job.source === 'SubChildPartJobWork' && job.subChildPartJobWorkOrderId) await onOutsourceQcDecided({ jobWorkOrderId: job.subChildPartJobWorkOrderId }, req.user);
    if (job.receiptKey) await refreshLineStatus(job.company, job.receiptKey);
    res.status(out.status).json(out.body);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reopens the SAME original order's Final Testing step for a full QC
// rejection of a Production-lineage job (source Production/Stock/
// QC_Rejected) — replaces the old "spin up a brand-new QC_Rejected order,
// Production decides Rework vs Repair" system for this case (retired
// 2026-09-02). Resets every unit's Final Testing (main + extraUnits — a
// reject means something about the assembled build failed, and nothing
// tracks which specific physical unit that was, so all of them go back to
// "needs re-testing" rather than guessing) back to 'In Progress' so
// FinalChecklistPanel/markProcessComplete's own gate picks the order back
// up exactly where Production left off — the checklist itself (job.checklist)
// isn't touched here at all, it already shows which row(s) failed.
async function reopenFinalTestingForRejection(qcJob, user) {
  if (!qcJob.sourceRefId) return;
  const order = await ProductionOrder.findOne({ orderId: qcJob.sourceRefId, company: qcJob.company });
  if (!order) return;

  const reopenUnit = (procs) => {
    if (!procs?.length) return;
    const finalStep = procs[procs.length - 1];
    finalStep.status = 'In Progress';
    finalStep.qcStatus = 'Rejected';
    finalStep.reworks.push({
      date: new Date().toISOString().split('T')[0],
      reason: qcJob.failReason || 'QC rejected the Final Check',
      rejectedBy: user.fullName || user.username || 'QC',
      photos: photoUrls(qcJob.rejectionPhotos),
      failedChecks: failedCheckLines(qcJob.failedChecks || []),
    });
  };
  reopenUnit(order.processes);
  (order.extraUnits || []).forEach(u => reopenUnit(u.processes));

  if (order.status === 'Completed') order.status = 'In Progress';
  await order.save();
}

// Helper function to create production order for rejected QC items
async function createRejectedProductionOrder(qcJob, user, qty) {
  try {
    // Generate unique order ID
    const year = new Date().getFullYear();
    const lastOrder = await ProductionOrder.findOne({
      orderId: new RegExp(`^REJ-${year}-`)
    }).sort({ orderId: -1 }).lean();

    let nextNumber = 1;
    if (lastOrder && lastOrder.orderId) {
      const parts = lastOrder.orderId.split('-');
      if (parts.length === 3) {
        const lastNumber = parseInt(parts[2]);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }
    }

    const rejectedOrderId = `REJ-${year}-${String(nextNumber).padStart(4, '0')}`;

    // Resolve the real sales Order this rejected item traces back to, via the
    // saleId carried forward from the original Production Order → QC Job chain.
    let orderCode = null;
    if (qcJob.saleId) {
      try {
        const sourceSale = await Sale.findById(qcJob.saleId).populate('order', 'orderCode');
        orderCode = sourceSale?.order?.orderCode || null;
      } catch (saleErr) {
        console.error('Error resolving orderCode for rejected production order:', saleErr);
      }
    }

    // If the failed job came from Production, recover the sale-item link from
    // the originating Production Order (older Production QC jobs may not
    // carry saleItemId themselves).
    let saleItemId = qcJob.saleItemId || null;
    if (!saleItemId && qcJob.sourceRefId) {
      try {
        const srcProd = await ProductionOrder.findOne({ orderId: qcJob.sourceRefId, company: qcJob.company })
          .select('saleItemId').lean();
        saleItemId = srcProd?.saleItemId || null;
      } catch (_) { /* optional */ }
    }

    // Explicit, never the schema's own bare default — qcJob.itemCode is
    // sometimes a real Item.code and sometimes the Item's own ObjectId
    // string (see resolveMachineOrderProcesses's own comment); it already
    // handles both shapes.
    const rejectedMachineCode = qcJob.itemCode || `REJ-${qcJob.qcJobId}`;
    const processes = await resolveMachineOrderProcesses(rejectedMachineCode, qcJob.company);

    // Create production order for rejected item
    const productionOrder = await ProductionOrder.create({
      orderId: rejectedOrderId,
      orderCode,
      machineCode: rejectedMachineCode,
      machineName: qcJob.itemName,
      priority: 'Urgent', // Rejected items get urgent priority
      source: 'QC_Rejected',
      purpose: 'Order',   // Rejected items are always re-made for the original order
      rejectionDetails: {
        originalOrderId: qcJob.sourceRefId,
        rejectionReason: qcJob.failReason,
        rejectedDate: today(),
        qcJobId: qcJob.qcJobId
      },
      status: 'Pending',
      receivedDate: today(),
      deliveryDate: getDeliveryDate(7), // 7 days from today for urgent rebuild
      bomVerified: false,
      designVerified: false,
      rdRequestRaised: false,
      materialIssued: false,
      // Multi-item linkage: the rework stays tied to the exact order item and
      // rebuilds the full rejected quantity
      saleId: qcJob.saleId || null,
      saleItemId,
      orderQuantity: qty || qcJob.quantity || 1,
      company: qcJob.company,
      createdBy: user._id,
      processes,
    });

    return productionOrder;
  } catch (error) {
    console.error('Error creating rejected production order:', error);
    throw error;
  }
}

// Restore `qty` units to inventory for a Store-sourced job (partial or full
// reject) — the item was deducted from stock when it was sent to QC.
// Resolves a Purchase-sourced QC job back to its originating PurchaseRequest,
// the Sale it belongs to, and the exact Sale.items[] subdocument it fulfils —
// the same 3-strategy PR lookup the "link back to Sale" step already used,
// pulled into one place so the inventory-vs-dispatch surplus split and that
// step can share one resolution instead of querying it twice.
async function resolvePurchaseSaleContext(job) {
  const PurchaseRequest = (await import('../models/PurchaseRequest.js')).default;
  const companyId = job.company;

  // Strategy 1: direct purchaseRequestId reference (most reliable)
  let pr = null;
  if (job.purchaseRequestId) {
    pr = await PurchaseRequest.findOne({ _id: job.purchaseRequestId, companyId });
  }

  // Strategy 2: fall back to searching by requestId / itemCode
  if (!pr) {
    pr = await PurchaseRequest.findOne({
      companyId,
      $or: [
        { requestId: job.sourceRefId },
        { requestId: job.itemCode },
        { itemId: job.sourceRefId },
        { itemId: job.itemCode }
      ]
    });
  }

  // Strategy 3: search by PO number
  if (!pr && job.sourceRefId) {
    const Purchase = (await import('../models/Purchase.js')).default;
    const po = await Purchase.findOne({ purchaseOrderNumber: job.sourceRefId, companyId });
    if (po) {
      pr = await PurchaseRequest.findOne({ purchaseOrder: po._id, companyId });
    }
  }

  let sale = null;
  if (pr && pr.storeOrderId) {
    // storeOrderId can be an Order _id OR a Sale _id — try both
    sale = await Sale.findOne({ $or: [{ order: pr.storeOrderId }, { _id: pr.storeOrderId }] });
    if (!sale && pr.itemId) {
      sale = await Sale.findOne({
        $or: [
          { invoiceNumber: pr.itemId },
          { _id: /^[0-9a-fA-F]{24}$/.test(pr.itemId) ? pr.itemId : null }
        ]
      });
    }
  }

  const saleItemId = pr?.saleItemId || job.saleItemId || null;
  const saleItem = (sale && saleItemId) ? sale.items.id(saleItemId) : null;

  return { pr, sale, saleItem };
}

async function restoreStoreInventoryQty(job, qty) {
  try {
    let inventoryItem = null;
    if (job.item) inventoryItem = await Item.findOne({ _id: job.item, companyId: job.company }); // 2026-10-30
    if (!inventoryItem && job.itemCode && /^[0-9a-fA-F]{24}$/.test(job.itemCode)) {
      inventoryItem = await Item.findById(job.itemCode);
    }
    if (!inventoryItem && job.itemCode) {
      inventoryItem = await Item.findOne({ code: job.itemCode, store: job.company.toString() });
    }
    if (!inventoryItem && job.itemName) {
      inventoryItem = await Item.findOne({ name: job.itemName, store: job.company.toString() });
    }
    if (inventoryItem) {
      const prevQty = inventoryItem.qty || 0;
      inventoryItem.qty = prevQty + (qty || 1);
      await inventoryItem.save();
      console.log(`↩️ [QC Rejection - Store] Restored ${qty || 1} qty to ${inventoryItem.name}. New qty: ${inventoryItem.qty}`);
    }
  } catch (restoreErr) {
    console.error('❌ Error restoring inventory on QC rejection:', restoreErr);
  }
}

// Helper function to get delivery date
function getDeliveryDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}


// PUT /api/qc/jobs/:id/parts/:partCheckId/decision — QC's own verdict on one
// Sub Child Part, reviewing the Initial+Process rows Production already
// filled in (optionally correcting them here first). A Reject automatically
// reopens the part for Production to rework and resave — no separate manual
// "send back" action (confirmed 2026-09-01); the part's own `status` stays
// 'Rejected' (not silently reset to 'Awaiting Production') so Production's
// panel can show it was bounced, and why.
export const decidePartCheck = async (req, res) => {
  try {
    // initial/process here are QC's OWN per-row verdicts only —
    // [{_id, qcStatus, qcRemarks}] — matched onto the part's existing rows
    // by _id. Production's own recorded fields (parameter/standardValue/
    // actualValue/status/remarks/type) are never touched by this endpoint,
    // by construction — QC reviews Production's self-check, it doesn't edit
    // it (confirmed 2026-09-02).
    const { decision, rejectReason, initial, process } = req.body;
    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'decision must be Approved or Rejected' });
    }
    if (decision === 'Rejected' && !rejectReason?.trim()) {
      return res.status(400).json({ success: false, message: 'rejectReason is required when rejecting a part' });
    }

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    const part = job.partChecks.id(req.params.partCheckId);
    if (!part) return res.status(404).json({ success: false, message: 'Part not found on this job' });
    if (part.status !== 'QC Pending') {
      return res.status(400).json({ success: false, message: `This part isn't awaiting QC review (currently ${part.status}).` });
    }

    // QC's verdicts, stamped with who checked each row (2026-10-30).
    ensureInspector(job, req.user);
    applyRowResults(part.initial, partResults(initial), req.user, { qcLayer: true });
    applyRowResults(part.process, partResults(process), req.user, { qcLayer: true });

    const stillPending = [...part.initial, ...part.process].some(c => c.qcStatus === 'Pending');
    if (stillPending) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before a decision.' });
    }

    part.status = decision;
    part.qcBy = req.user.fullName || req.user.username || 'QC';
    part.qcDate = today();
    part.rejectReason = decision === 'Rejected' ? rejectReason.trim() : '';
    if (decision === 'Rejected') { // its evidence (2026-10-30)
      part.photos = req.rejectionPhotos || [];
      part.failedChecks = failedChecksOf([...part.initial, ...part.process], { qcLayer: true });
    }

    await job.save();
    res.json({ success: true, data: part });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// Child Part's own per-UNIT QC decision — direct sibling of decidePartCheck
// above, same shape, just resolving job.unitChecks by unitNumber instead of
// job.partChecks by _id. Confirmed with the user 2026-09-16 as the exact
// pattern to mirror: no partial-quantity concept (never existed in the
// partChecks[] pattern either — each entry is its own atomic decision), and
// nothing outside this one unitChecks entry gets touched — no processes[]
// reopening logic needed here at all (a rejected entry just sits at
// 'Rejected'; Production re-edits and resaves via
// saveChildPartUnitChecklist, which flips it straight back to 'QC Pending'
// on its own). Painting's own Start gate (productionMfgController.js's
// startProcess) is what actually reads unitChecks[].status==='Approved'
// live — this endpoint doesn't need to notify anything else.
//
// Also decides a per-unit Machine order's units (2026-09-24 — the same
// model, see productionMfgController.js's isPerUnitMachineOrder): its entry
// only carries process[] (initial[] stays empty), and an approval that
// lands on the true last step makes the unit done via completeMachineUnit
// (Sale 'Approved from QC' +1, or machine stock +1) instead of Child Part's
// own stock credit. Name kept to avoid route churn.
//
// Stage B (2026-09-26) — thin dispatcher. A dynamic Child Part order (any
// qcRequired step flagged) now decides per-STEP, not the whole unit at once
// — see decideChildPartUnitStep below. Machine's per-unit QC shares this
// SAME route/function — broadened to Machine in Stage C (2026-09-28).
// Slice 4 cleanup (2026-09-28): every Child Part/Machine order reaching this
// endpoint is dynamic now (the old single-checkpoint fallback,
// decideChildPartUnitLegacy, was removed — no real order depends on it
// anymore, confirmed live at every level). If `procs`/`order` can't be
// resolved (bad job/unit), the 404s inside decideChildPartUnitStep itself
// handle it.
// 2026-10-25 (found in the outsource v2 R8 test) — a QC step can't be
// decided (1) before the job says who's checking it: a step job opens itself
// "In Progress" when a step is submitted, so the Start Inspection box was
// optional; (2) while an EARLIER QC step of the same unit / batch is still
// waiting — two steps that came back on one trip (pre painting [QC] ›
// post painting [final]) both reach QC at once, and post painting could pass
// first, leaving the step order broken. entryOf(proc) → that step's entry.
function stepDecisionBlocked(job, procs, category, step, entryOf, what = 'unit') {
  // (2026-10-30) No "choose an inspector" refusal any more — the first QC
  // person to save or decide becomes the inspector (ensureInspector).
  const idx = (procs || []).findIndex(p => p.category === category && p.step === step);
  for (let i = 0; i < idx; i++) {
    const p = procs[i];
    if (!(p.qcRequired || p.finalQc)) continue;
    const e = entryOf(p);
    const last = e?.attempts?.[e.attempts.length - 1];
    if (last && !last.decidedAt) return `Decide ${p.step} first — it comes before ${step} on this ${what}.`;
  }
  return null;
}

export const decideChildPartUnit = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    const unitNumber = parseInt(req.params.unitNumber, 10);
    const order = job.sourceRefId
      ? await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company })
      : null;
    const procs = order && Number.isFinite(unitNumber)
      ? (unitNumber <= 1 ? order.processes : order.extraUnits?.[unitNumber - 2]?.processes)
      : null;
    if (!order || !procs) return res.status(404).json({ success: false, message: 'Order or unit not found' });
    return decideChildPartUnitStep(req, res, { job, order, procs, unitNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// New per-step decision for a dynamic Child Part unit (Stage B, 2026-09-26)
// — direct sibling of submitBatchQcDecision, minus the quantity split: a
// unit's own step is Pass or Reject, one unit at a time, no partial concept
// (same "each unit reaches/leaves QC entirely independently" rule the old
// flat per-unit decision already followed). Body: {category, step,
// decision: 'Pass'|'Reject', results, rejectReason}.
async function decideChildPartUnitStep(req, res, { job, order, procs, unitNumber }) {
  try {
    const { category, step, decision, results, rejectReason } = req.body;
    if (!category || !step) return res.status(400).json({ success: false, message: 'category and step are required' });
    if (!['Pass', 'Reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be 'Pass' or 'Reject'" });
    }
    if (decision === 'Reject' && !String(rejectReason || '').trim()) {
      return res.status(400).json({ success: false, message: 'rejectReason is required when rejecting' });
    }

    const unit = job.unitChecks.find(u => u.unitNumber === unitNumber);
    if (!unit) return res.status(404).json({ success: false, message: 'Unit not found on this job' });
    const entry = unit.steps.find(s => s.category === category && s.stepName === step);
    if (!entry) return res.status(404).json({ success: false, message: 'No step entry found for this category/step' });
    const blocked = stepDecisionBlocked(job, procs, category, step, (p) => unit.steps.find(s => s.category === p.category && s.stepName === p.step));
    if (blocked) return res.status(400).json({ success: false, message: blocked });
    const attempt = entry.attempts[entry.attempts.length - 1];
    if (!attempt || attempt.decidedAt) {
      return res.status(400).json({ success: false, message: 'Nothing awaiting a decision for this step.' });
    }

    // QC's results, stamped with who checked each row (2026-10-30).
    applyRowResults(attempt.rows, results, req.user, { match: 'parameter' });
    if (attempt.rows.some(r => r.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before a decision.' });
    }
    ensureInspector(job, req.user);

    attempt.decidedAt = new Date();
    attempt.decidedBy = req.user.fullName || req.user.username || 'QC';
    attempt.decision = decision;
    attempt.rejectReason = decision === 'Reject' ? rejectReason.trim() : '';
    if (decision === 'Reject') { // its evidence (2026-10-30)
      attempt.photos = req.rejectionPhotos || [];
      attempt.failedChecks = failedChecksOf(attempt.rows);
    }

    const procIdx = procs.findIndex(p => p.category === category && p.step === step);
    const proc = procIdx !== -1 ? procs[procIdx] : null;
    if (proc) {
      const isTrueLastStep = procIdx === procs.length - 1;
      if (decision === 'Reject') {
        entry.status = 'Rejected';
        proc.status = 'In Progress';
        proc.reworks.push({ date: today(), reason: rejectReason.trim(), rejectedBy: req.user.fullName || req.user.username || 'QC', photos: photoUrls(attempt.photos), failedChecks: failedCheckLines(attempt.failedChecks) });
      } else {
        entry.status = 'Approved';
        proc.status = 'Completed';
        proc.endDate = today();
        proc.completedAt = new Date();
        if (isTrueLastStep) {
          if (order.subChildPartItem) {
            // Slice 4 (2026-10-24): the cost goes to the BOM by pushPartCost
            // after the order is saved (below) — Production's cost + the
            // outsourced money, for Child Part AND Machine.
            await deliverFinishedParts({ order, itemId: order.subChildPartItem, qty: 1, by: whoOf(req.user) });
            if (allUnitsCompleted(order)) {
              order.status = 'Completed';
              markJobApproved(job);
            }
          } else if (order.orderKind === 'Machine') {
            // completeMachineUnit already handles the Sale-vs-stock credit,
            // entry.readyAt, job-Approved-once-every-unit-ready, and
            // allUnitsCompleted/order.status/finalizeMachineOrderCompletion
            // internally — Stage C's own true-last-step trigger, mirroring
            // how completeFinalProcessStep's Machine branch already reuses
            // this exact function for the old Final Testing flow. No cost
            // capture here — Machine's build cost (applyManufacturedFinalCost)
            // is a separate, still-old-Final-Testing-only concept, untouched
            // by this stage, same as Child Part's own Stage B never needing
            // it either.
            await completeMachineUnit(order, job, unitNumber, {
              actorName: req.user.fullName || req.user.username, userId: req.user._id,
            });
          }
        }
      }
      await order.save();
      // Slice 4 (2026-10-24): the true last step passed → this unit's cost to
      // its BOM (a Machine's typed cost used to be dropped here). Never throws.
      if (decision !== 'Reject' && isTrueLastStep) await pushPartCost(order._id, unitNumber - 1);
    }

    await job.save();
    // Outsource bill (slice 3): the trips this decision covers may now be payable.
    await onOutsourceQcDecided({ productionOrderId: order._id }, req.user);
    // Units at Store whose next step is outsourced again → requested now (2026-10-22).
    await (await import('../services/dispatchTripService.js')).autoRequestAtStore(order.company, order._id, req.user);
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

// PUT /jobs/:id/batch-steps/decision — QC multi-checkpoint redesign (slice
// 2, 2026-09-26). QC's decision on a Sub Child Part's whole-batch QC step —
// a QUANTITY split (Passed/Rework/Scrap), not a plain Pass/Reject, since Sub
// Child Part is always handled as one physical batch, never per-unit. Body:
// { category, step, results, passedQty, reworkQty, scrapQty, reason }.
export const submitBatchQcDecision = async (req, res) => {
  try {
    const { category, step, results, reason } = req.body;
    const passedQty = Number(req.body.passedQty);
    const reworkQty = Number(req.body.reworkQty);
    const scrapQty = Number(req.body.scrapQty);
    if (!category || !step) return res.status(400).json({ success: false, message: 'category and step are required' });
    if (![passedQty, reworkQty, scrapQty].every(n => Number.isFinite(n) && n >= 0)) {
      return res.status(400).json({ success: false, message: 'passedQty, reworkQty and scrapQty must be non-negative numbers' });
    }
    if ((reworkQty > 0 || scrapQty > 0) && !String(reason || '').trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required when any quantity is Rework or Scrap' });
    }

    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    const entry = job.batchSteps.find(b => b.category === category && b.stepName === step);
    if (!entry) return res.status(404).json({ success: false, message: 'No batch step entry found for this category/step' });
    {
      const bOrder = job.sourceRefId ? await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company }).select('processes').lean() : null;
      const blocked = stepDecisionBlocked(job, bOrder?.processes || [], category, step, (p) => job.batchSteps.find(b => b.category === p.category && b.stepName === p.step), 'batch');
      if (blocked) return res.status(400).json({ success: false, message: blocked });
    }
    const attempt = entry.attempts[entry.attempts.length - 1];
    if (!attempt || attempt.decidedAt) {
      return res.status(400).json({ success: false, message: 'Nothing awaiting a decision for this step.' });
    }
    if (passedQty + reworkQty + scrapQty !== attempt.qtySubmitted) {
      return res.status(400).json({ success: false, message: `Passed + Rework + Scrap must add up to ${attempt.qtySubmitted}.` });
    }

    // Apply QC's fill-in verdicts (matched by parameter — same "one shared
    // checklist for the whole submitted quantity" pattern the old flat Sub
    // Child Part checklist already used, see submitDecision), stamped with
    // who checked each row (2026-10-30).
    applyRowResults(attempt.rows, results, req.user, { match: 'parameter' });
    if (attempt.rows.some(r => r.status === 'Pending')) {
      return res.status(400).json({ success: false, message: 'Every checklist item must be marked Pass or Fail before a decision.' });
    }
    // Scrapped pieces holding a serial: which ones (2 Nov review).
    let scrapPick = null;
    if (scrapQty > 0) {
      const scpOrder = job.sourceRefId ? await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company }).select('orderId subChildPartItem').lean() : null;
      if (scpOrder?.subChildPartItem) {
        const { checkPiecePick } = await import('../services/serialTrailService.js');
        const pick = await checkPiecePick({ companyId: job.company, orderRef: scpOrder._id, itemId: scpOrder.subChildPartItem, qty: scrapQty, onHand: attempt.qtySubmitted, unitIds: req.body.scrapSerials?.unitIds });
        if (pick.error) return res.status(400).json({ success: false, message: pick.error });
        if (pick.skip) {
          const { acknowledged, confirmBody } = await import('../services/serialTrailService.js');
          if (!acknowledged(req.body.acknowledgeWarnings)) return res.status(409).json(confirmBody([pick.skip]));
        }
        scrapPick = { order: scpOrder, picked: pick };
      }
    }
    ensureInspector(job, req.user);

    attempt.decidedAt = new Date();
    attempt.decidedBy = req.user.fullName || req.user.username || 'QC';
    attempt.passedQty = passedQty;
    attempt.reworkQty = reworkQty;
    attempt.scrapQty = scrapQty;
    attempt.reason = reason || '';
    if (reworkQty > 0 || scrapQty > 0) { // its evidence (2026-10-30)
      attempt.photos = req.rejectionPhotos || [];
      attempt.failedChecks = failedChecksOf(attempt.rows);
    }

    entry.passedQty += passedQty;
    entry.scrapQty += scrapQty;
    // Replaces, not adds — the previous pending amount was exactly what got
    // resubmitted as this attempt (see submitBatchQcStep).
    entry.reworkPendingQty = reworkQty;

    // The entire "wait for rework, don't wait for scrap-only" rule lives in
    // this one line: `resolved` reuses the exact same generic "previous
    // step must be Completed" gate every other step already goes through
    // (via proc.status below) — no separate blocking logic needed anywhere.
    const resolved = entry.reworkPendingQty === 0 && entry.passedQty + entry.scrapQty === entry.qtyEnteringStep;

    const order = job.sourceRefId
      ? await ProductionOrder.findOne({ orderId: job.sourceRefId, company: job.company })
      : null;
    if (order) {
      const procs = order.processes;
      const procIdx = procs.findIndex(p => p.category === category && p.step === step);
      const proc = procIdx !== -1 ? procs[procIdx] : null;
      if (proc) {
        const isTrueLastStep = procIdx === procs.length - 1;
        // Passed pieces are credited IMMEDIATELY, per decision, on the true
        // last step — not held back for the whole step to resolve (only a
        // real NEXT step, which doesn't exist here, would need to wait).
        if (isTrueLastStep && passedQty > 0) {
          if (order.saleId) {
            const sale = await Sale.findById(order.saleId);
            if (sale) await setSaleItemStatus(sale, order.saleItemId, 'Approved from QC', { qty: passedQty });
          } else if (order.subChildPartItem) {
            await deliverFinishedParts({ order, itemId: order.subChildPartItem, qty: passedQty, by: whoOf(req.user) });
          }
        }
        if (reworkQty > 0) {
          proc.reworks.push({ date: today(), reason: reason.trim(), rejectedBy: req.user.fullName || req.user.username || 'QC', photos: photoUrls(attempt.photos), failedChecks: failedCheckLines(attempt.failedChecks) });
        }
        if (resolved) {
          proc.status = 'Completed';
          proc.endDate = today();
          proc.completedAt = new Date();
          if (isTrueLastStep) {
            order.status = 'Completed';
            markJobApproved(job);
          }
        } else if (proc.type === 'Outsourcing') {
          // Slice 3 (2026-09-26) — an outsourced step's rework doesn't
          // resubmit through Production; it goes back to Purchase as a
          // brand-new hand-off (outsourceWorkController.js's
          // requestOutsourceHandoff, gated on outsourceStatus==='NotStarted').
          // Resetting both fields here is what makes that hand-off request
          // possible again for just this step.
          proc.status = 'Pending';
          proc.outsourceStatus = 'NotStarted';
        } else {
          proc.status = 'In Progress'; // Production resubmits directly
        }
        await order.save();
      }
    }

    await job.save();
    // Slice 4 (2026-10-24): the batch's true last step resolved → its cost
    // (÷ the pieces that finished) to the Sub Child Part (a typed cost used
    // to be dropped here). After the QC job is saved — its passed qty counts.
    if (order?.status === 'Completed') await pushPartCost(order._id, 0);
    // Outsource bill (slice 3): the trips this decision covers may now be payable.
    if (order) await onOutsourceQcDecided({ productionOrderId: order._id }, req.user);
    // Units at Store whose next step is outsourced again → requested now (2026-10-22).
    if (order) await (await import('../services/dispatchTripService.js')).autoRequestAtStore(order.company, order._id, req.user);
    if (scrapPick) await (await import('../services/serialTrailService.js')).applyScrappedPieces({ companyId: job.company, ...scrapPick, by: whoOf(req.user), note: reason || '' });
    if (scrapPick?.picked.skip) await (await import('../services/serialTrailService.js')).logSkippedSerials(job.company, [scrapPick.picked.skip], { screen: 'QC scrap', reference: scrapPick.order.orderId, by: whoOf(req.user) });
    // Scrapped pieces of a cascade order: the same need gets a replacement order (2026-10-27).
    let replacement = null;
    if (scrapQty > 0 && order?.orderKind === 'SubChildPart') {
      const { raiseReplacementFor } = await import('../services/subChildPartOrderService.js');
      replacement = await raiseReplacementFor(order, scrapQty, `Scrapped at QC (${step})${reason ? `: ${String(reason).trim()}` : ''}`);
    }
    res.json({ success: true, data: entry, ...(replacement ? { message: `Saved. Replacement order ${replacement.orderId} raised for the ${scrapQty} scrapped.` } : {}) });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

export const addChecklistItem = async (req, res) => {
  try {
    const { parameter, standardValue } = req.body;
    if (!parameter) return res.status(400).json({ success: false, message: 'parameter is required' });
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    job.checklist.push({ parameter, standardValue: standardValue || '', actualValue: '', status: 'Pending', remarks: '' });
    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const removeChecklistItem = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    job.checklist = job.checklist.filter(c => String(c._id) !== req.params.itemId);
    await job.save();
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};



// PUT /api/qc/jobs/:id/sync-rd — manual re-sync. getQCJob already pulls this
// automatically the first time a job is opened (lazy, see its own comment)
// so this button is no longer the primary mechanism — it's now for the one
// case that needs a manual trigger: R&D added/changed a master-checklist row
// AFTER this job's checklist was already pulled, and QC wants the refresh
// without waiting for a brand new job. `force: true` is what makes this
// actually overwrite an already-populated checklist instead of no-op'ing
// like the automatic pull does.
export const syncRDToQCJob = async (req, res) => {
  try {
    const qcJob = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId });
    if (!qcJob) return res.status(404).json({ success: false, message: 'QC job not found' });

    // Same rule as getQCJob above: a manufactured job's Final checklist
    // isn't QC's to pull (even manually) until Production has actually
    // submitted it.
    if (qcJob.partChecks.length > 0 && !qcJob.finalCheckFilledAt) {
      return res.status(400).json({ success: false, message: 'Production hasn\'t submitted the Final Testing checklist yet — nothing to pull.' });
    }

    const changed = await ensureFlatChecklist(qcJob, req.user.companyId, { force: true });
    if (!changed) {
      return res.status(404).json({ success: false, message: `No configured checklist found for "${qcJob.itemName}".` });
    }
    await qcJob.save();
    res.json({ success: true, message: 'Checklist synced.', data: qcJob });
  } catch (error) {
    console.error('❌ Error syncing checklist to QC job:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
