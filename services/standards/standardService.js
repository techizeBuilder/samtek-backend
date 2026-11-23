// Feature 19 (client, 20 Nov 2026): standard hours — R&D's figures, the Company Admin's
// approval, history's proposals and Production's flags.
// docs/client-features-2026-11/19-standard-hours-logic.md (decisions A–H, 21 Nov).
//
// Reads stay bounded: the BOM scan is bounded by the company's products (the same as
// Purchase's Job Work Time tab); runs are the last 10 per part-step ($topN); the
// approved list is paged in the database.
import mongoose from 'mongoose';
import StepStandard from '../../models/StepStandard.js';
import StepFlag from '../../models/StepFlag.js';
import StepRun from '../../models/StepRun.js';
import StepCrewEntry from '../../models/StepCrewEntry.js';
import MachineBOM from '../../models/MachineBOM.js';
import ChildPartBOM from '../../models/ChildPartBOM.js';
import { Item } from '../../models/Inventory.js';
import User from '../../models/User.js';
import notificationService from '../notificationService.js';
import { standardFrom, standardHours, proposal, crewFactor, sigmaOf } from './standardCalc.js';

export class StandardError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const stepKeyOf = (name) => String(name || '').trim().toLowerCase();
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const PROPOSE_AT = 0.05; // history is asked about once it differs by 5% or more
const nameOf = (u) => u?.fullName || u?.username || '';

/** Standard hours for 1 piece with 1…4 people: what a row shows. */
const examples = (std) => [1, 2, 3, 4].map((k) => ({ people: k, hours: r3(standardHours(std, 1, k)) }));

/** A decision row → what the screens show. */
const summary = (d) => d && ({
  _id: d._id, source: d.source, hoursPerPiece: d.hoursPerPiece, crew: d.crew, setupHours: d.setupHours || 0,
  splitAnswer: d.splitAnswer, sigma: d.sigma, p1: d.p1, basedOnRuns: d.basedOnRuns || 0,
  decidedAt: d.decidedAt, decidedByName: d.decidedByName, note: d.note || '',
  examples: examples({ p1: d.p1, setup: d.setupHours || 0, sigma: d.sigma }),
});

/** The working values of an approved standard (what Production and the estimate use). */
export const workingOf = (d) => (d ? { id: d._id, p1: d.p1, setup: d.setupHours || 0, sigma: d.sigma, crew: d.crew || 1, approvedAt: d.decidedAt } : null);

/**
 * The latest decisions per part-step: Map `${partCode}|${stepKey}` →
 * { approved, rejectedRd, rejectedHistory }. One aggregation for any number of parts.
 */
async function decisionsFor(companyId, partCodes = null) {
  const rows = await StepStandard.aggregate([
    { $match: { company: oid(companyId), ...(partCodes ? { partCode: { $in: partCodes } } : {}) } },
    { $sort: { decidedAt: -1, _id: -1 } },
    { $group: { _id: { p: '$partCode', k: '$stepKey', s: '$status', src: { $cond: [{ $eq: ['$status', 'Approved'] }, 'any', '$source'] } }, doc: { $first: '$$ROOT' } } },
  ]);
  const out = new Map();
  for (const r of rows) {
    const key = `${r._id.p}|${r._id.k}`;
    if (!out.has(key)) out.set(key, { approved: null, rejectedRd: null, rejectedHistory: null });
    const e = out.get(key);
    if (r._id.s === 'Approved') e.approved = r.doc;
    else if (r._id.src === 'R&D') e.rejectedRd = r.doc;
    else e.rejectedHistory = r.doc;
  }
  return out;
}

/** The approved standard in force for each part-step: Map `${partCode}|${stepKey}` → decision. */
export async function activeStandardsFor(companyId, partCodes = []) {
  const codes = [...new Set(partCodes.filter(Boolean))];
  if (!codes.length) return new Map();
  const rows = await StepStandard.aggregate([
    { $match: { company: oid(companyId), status: 'Approved', partCode: { $in: codes } } },
    { $sort: { decidedAt: -1, _id: -1 } },
    { $group: { _id: { p: '$partCode', k: '$stepKey' }, doc: { $first: '$$ROOT' } } },
  ]);
  return new Map(rows.map((r) => [`${r._id.p}|${r._id.k}`, r.doc]));
}

/** The approved standard in force for one part's step, or null. */
export async function activeStandard(companyId, partCode, stepName) {
  return StepStandard.findOne({ company: oid(companyId), partCode, stepKey: stepKeyOf(stepName), status: 'Approved' }).sort({ decidedAt: -1, _id: -1 }).lean();
}

/**
 * Every In-House BOM step where R&D typed hours: machines, Child Parts, Sub Child Parts.
 * [{ partCode, partName, partKind, stepName, stepKey, category, hoursPerPiece, crew, setupHours, splitAnswer, editedAt }]
 */
export async function bomSteps(companyId, { partCode = null } = {}) {
  const cid = oid(companyId);
  const pd = 'processDefinition.label processDefinition.internalProcesses';
  const [machineBoms, childBoms, subParts] = await Promise.all([
    MachineBOM.find({ company: cid }).select(`machine ${pd}`).lean(),
    ChildPartBOM.find({ company: cid }).select(`childPart ${pd}`).lean(),
    Item.find({ companyId: cid, productKind: 'SubChildPart', isDiscontinued: { $ne: true }, ...(partCode ? { code: partCode } : {}) })
      .select('name code subChildPartDetails.processDefinition').lean(),
  ]);
  const ownerIds = [...machineBoms.map((b) => b.machine), ...childBoms.map((b) => b.childPart)].filter(Boolean);
  const owners = new Map((await Item.find({ _id: { $in: ownerIds } }).select('name code isDiscontinued').lean()).map((i) => [String(i._id), i]));
  const out = [];
  const add = (defs, part, kind) => {
    if (!part || part.isDiscontinued || (partCode && part.code !== partCode)) return;
    for (const cat of defs || []) {
      for (const p of cat.internalProcesses || []) {
        if (p.type !== 'InHouse' || !(Number(p.usualHoursPerPiece) > 0)) continue;
        out.push({
          partCode: part.code, partName: part.name, partKind: kind, stepName: p.name, stepKey: stepKeyOf(p.name), category: cat.label,
          hoursPerPiece: p.usualHoursPerPiece, crew: p.standardCrew || 1, crewGiven: !!p.standardCrew,
          setupHours: p.setupHours || 0, splitAnswer: p.splitAnswer || null, editedAt: p.standardEditedAt || null,
        });
      }
    }
  };
  for (const b of machineBoms) add(b.processDefinition, owners.get(String(b.machine)), 'Machine');
  for (const b of childBoms) add(b.processDefinition, owners.get(String(b.childPart)), 'ChildPart');
  for (const s of subParts) add(s.subChildPartDetails?.processDefinition, s, 'SubChildPart');
  return out;
}

const sameValues = (step, d) => !!d && Number(d.hoursPerPiece) === Number(step.hoursPerPiece) && Number(d.crew || 1) === Number(step.crew || 1)
  && Number(d.setupHours || 0) === Number(step.setupHours || 0) && (d.splitAnswer || null) === (step.splitAnswer || null);

/** Is R&D's figure on this step waiting for the Company Admin? */
function rdWaiting(step, dec) {
  const { approved, rejectedRd } = dec || {};
  if (sameValues(step, approved)) return false;
  if (sameValues(step, rejectedRd) && !(step.editedAt && new Date(step.editedAt) > new Date(rejectedRd.decidedAt))) return false;
  const last = Math.max(approved ? new Date(approved.decidedAt).getTime() : 0, rejectedRd ? new Date(rejectedRd.decidedAt).getTime() : 0);
  if (!approved && !rejectedRd) return true; // typed, never decided
  return !!step.editedAt && new Date(step.editedAt).getTime() > last;
}

/** The last 10 non-rework runs per part-step: Map `${partCode}|${stepKey}` → runs (newest first). */
async function recentRuns(companyId, partCodes) {
  if (!partCodes.length) return new Map();
  const rows = await StepRun.aggregate([
    { $match: { company: oid(companyId), partCode: { $in: partCodes }, rework: { $ne: true } } },
    { $group: {
      _id: { p: '$partCode', k: { $toLower: { $trim: { input: '$stepName' } } } },
      runs: { $topN: { n: 10, sortBy: { completedAt: -1 }, output: { pieces: '$pieces', crewSize: '$crewSize', workingHours: '$workingHours', completedAt: '$completedAt', rework: '$rework' } } },
    } },
  ]);
  return new Map(rows.map((r) => [`${r._id.p}|${r._id.k}`, r.runs]));
}

/** History's proposal for an approved standard, or null when it isn't worth asking about. */
function historyProposal(approved, runs, rejectedHistory) {
  if (!approved || !runs?.length) return null;
  const std = { p1: approved.p1, setup: approved.setupHours || 0, sigma: approved.sigma };
  const prop = proposal(runs, std);
  if (!prop || Math.abs(prop.p1 - std.p1) / std.p1 < PROPOSE_AT) return null;
  const lastRunAt = new Date(Math.max(...runs.map((r) => new Date(r.completedAt).getTime())));
  if (rejectedHistory?.lastRunAt && new Date(rejectedHistory.lastRunAt) >= lastRunAt) return null; // turned down, nothing new since
  if (approved.source === 'History' && approved.lastRunAt && new Date(approved.lastRunAt) >= lastRunAt) return null;
  return { ...prop, lastRunAt, hoursPerPiece: prop.p1 * crewFactor(std.sigma, approved.crew || 1) };
}

/** The Company Admin's waiting list: R&D changes, history proposals, flagged steps. Open work, not paged. */
export async function waitingList(companyId) {
  const steps = await bomSteps(companyId);
  const codes = [...new Set(steps.map((s) => s.partCode))];
  const [decisions, flags] = await Promise.all([
    decisionsFor(companyId, codes),
    StepFlag.find({ company: oid(companyId), status: 'Pending' }).sort({ createdAt: 1 }).lean(),
  ]);
  const rd = [];
  for (const s of steps) {
    const dec = decisions.get(`${s.partCode}|${s.stepKey}`);
    if (!rdWaiting(s, dec)) continue;
    const std = standardFrom({ hoursPerPiece: s.hoursPerPiece, crew: s.crew, setupHours: s.setupHours, splitAnswer: s.splitAnswer });
    rd.push({
      kind: 'rd', partCode: s.partCode, partName: s.partName, partKind: s.partKind, stepName: s.stepName, category: s.category, editedAt: s.editedAt,
      proposed: { hoursPerPiece: s.hoursPerPiece, crew: s.crew, crewGiven: s.crewGiven, setupHours: s.setupHours, splitAnswer: s.splitAnswer, sigma: std.sigma, p1: r3(std.p1), examples: examples(std) },
      current: summary(dec?.approved || null),
    });
  }
  const approvedKeys = [...decisions.entries()].filter(([, d]) => d.approved).map(([k, d]) => ({ k, d }));
  const runsBy = await recentRuns(companyId, [...new Set(approvedKeys.map(({ d }) => d.approved.partCode))]);
  const history = [];
  for (const { k, d } of approvedKeys) {
    const prop = historyProposal(d.approved, runsBy.get(k), d.rejectedHistory);
    if (!prop) continue;
    const a = d.approved;
    history.push({
      kind: 'history', partCode: a.partCode, partName: a.partName, partKind: a.partKind, stepName: a.stepName,
      current: summary(a),
      proposed: { p1: r3(prop.p1), historyP1: r3(prop.historyP1), runs: prop.runs, hoursPerPiece: r3(prop.hoursPerPiece), crew: a.crew, lastRunAt: prop.lastRunAt,
        examples: examples({ p1: prop.p1, setup: a.setupHours || 0, sigma: a.sigma }) },
    });
  }
  return {
    rd: rd.sort((a, b) => a.partName.localeCompare(b.partName) || a.stepName.localeCompare(b.stepName)),
    history: history.sort((a, b) => a.partName.localeCompare(b.partName) || a.stepName.localeCompare(b.stepName)),
    flags: flags.map((f) => ({
      kind: 'flag', _id: f._id, orderNo: f.orderNo, partCode: f.partCode, partName: f.partName, unit: f.unitIndex + 1, stepName: f.stepName,
      standardHours: f.standardHours, requestedHours: f.requestedHours, reason: f.reason, flaggedByName: f.flaggedByName, flaggedAt: f.createdAt,
    })),
  };
}

const tell = (fn) => Promise.resolve().then(fn).catch((e) => console.error('[standards] notify failed:', e.message));

/** The Company Admin approves or rejects one waiting item. */
export async function decide(companyId, user, { action, kind, partCode, stepName, flagId, note = '' }) {
  if (!['approve', 'reject'].includes(action)) throw new StandardError(400, 'Approve or reject?');
  const approve = action === 'approve';
  // The login may carry only the username: the full name is what people read.
  const who = user.fullName ? user : (await User.findById(user._id).select('fullName username').lean()) || user;
  const by = { decidedBy: user._id, decidedByName: nameOf(who), decidedAt: new Date(), note: String(note || '').trim().slice(0, 500) };

  if (kind === 'flag') {
    const f = await StepFlag.findOne({ _id: mongoose.isValidObjectId(flagId) ? flagId : null, company: oid(companyId), status: 'Pending' });
    if (!f) throw new StandardError(404, 'That flag is not waiting any more.');
    Object.assign(f, { status: approve ? 'Approved' : 'Rejected', ...by });
    await f.save();
    if (f.flaggedBy) {
      tell(() => notificationService.createNotification({
        title: `Flag ${approve ? 'approved' : 'rejected'}: ${f.stepName}`,
        message: approve
          ? `${f.orderNo} ${f.stepName}: ${f.requestedHours} h counts for the score.`
          : `${f.orderNo} ${f.stepName}: the standard counts (${f.standardHours ?? '–'} h).${by.note ? ` ${by.note}` : ''}`,
        type: 'production', icon: 'clock', priority: 'medium', targetUserId: f.flaggedBy, targetCompanyId: f.company, data: { link: '/production/process-execution' },
      }));
    }
    return { kind, status: f.status };
  }

  const key = stepKeyOf(stepName);
  if (!partCode || !key) throw new StandardError(400, 'Which part and step?');
  if (kind === 'rd') {
    const step = (await bomSteps(companyId, { partCode })).find((s) => s.stepKey === key);
    if (!step) throw new StandardError(404, 'That step has no hours from R&D any more.');
    const std = standardFrom({ hoursPerPiece: step.hoursPerPiece, crew: step.crew, setupHours: step.setupHours, splitAnswer: step.splitAnswer });
    const doc = await StepStandard.create({
      company: companyId, partCode, partName: step.partName, partKind: step.partKind, stepName: step.stepName, stepKey: key,
      status: approve ? 'Approved' : 'Rejected', source: 'R&D',
      hoursPerPiece: step.hoursPerPiece, crew: step.crew, setupHours: step.setupHours, splitAnswer: step.splitAnswer, sigma: std.sigma, p1: std.p1, ...by,
    });
    tell(() => notificationService.notifyRoles(['Research & Development Head'], {
      title: `Standard ${approve ? 'approved' : 'rejected'}: ${step.partName} · ${step.stepName}`,
      message: approve ? `${step.hoursPerPiece} h per piece with ${step.crew} ${step.crew === 1 ? 'person' : 'people'}, from now.` : `Not approved.${by.note ? ` ${by.note}` : ''}`,
      type: 'rd', icon: 'clock', priority: 'medium', targetCompanyId: companyId,
    }));
    return { kind, status: doc.status, standard: summary(doc) };
  }
  if (kind === 'history') {
    const approved = await activeStandard(companyId, partCode, stepName);
    if (!approved) throw new StandardError(404, 'That step has no approved standard.');
    const runs = (await recentRuns(companyId, [partCode])).get(`${partCode}|${key}`) || [];
    const prop = historyProposal(approved, runs, null);
    if (!prop) throw new StandardError(409, 'History no longer differs enough to propose a change.');
    const doc = await StepStandard.create({
      company: companyId, partCode, partName: approved.partName, partKind: approved.partKind, stepName: approved.stepName, stepKey: key,
      status: approve ? 'Approved' : 'Rejected', source: 'History',
      hoursPerPiece: r3(prop.hoursPerPiece), crew: approved.crew, setupHours: approved.setupHours, splitAnswer: approved.splitAnswer, sigma: approved.sigma, p1: prop.p1,
      basedOnRuns: prop.runs, lastRunAt: prop.lastRunAt, ...by,
    });
    return { kind, status: doc.status, standard: summary(doc) };
  }
  throw new StandardError(400, 'Unknown kind.');
}

/** Approved standards in force, paged in the database, searchable. */
export async function approvedList(companyId, { search = '', page = 1, limit = 25 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 25));
  const pg = Math.max(1, Number(page) || 1);
  const q = String(search || '').trim();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const [res] = await StepStandard.aggregate([
    { $match: { company: oid(companyId), status: 'Approved' } },
    { $sort: { decidedAt: -1, _id: -1 } },
    { $group: { _id: { p: '$partCode', k: '$stepKey' }, doc: { $first: '$$ROOT' }, versions: { $sum: 1 } } },
    ...(rx ? [{ $match: { $or: [{ 'doc.partName': rx }, { 'doc.partCode': rx }, { 'doc.stepName': rx }] } }] : []),
    { $sort: { 'doc.partName': 1, 'doc.stepName': 1 } },
    { $facet: { rows: [{ $skip: (pg - 1) * lim }, { $limit: lim }], total: [{ $count: 'n' }] } },
  ]);
  const total = res?.total?.[0]?.n || 0;
  return {
    rows: (res?.rows || []).map((r) => ({ partCode: r.doc.partCode, partName: r.doc.partName, partKind: r.doc.partKind, stepName: r.doc.stepName, versions: r.versions, ...summary(r.doc) })),
    total, page: pg, pages: Math.max(1, Math.ceil(total / lim)), limit: lim,
  };
}

/** Every decision on one part's step, newest first. */
export async function versionsOf(companyId, partCode, stepName) {
  const rows = await StepStandard.find({ company: oid(companyId), partCode, stepKey: stepKeyOf(stepName) }).sort({ decidedAt: -1, _id: -1 }).limit(50).lean();
  return rows.map((d) => ({ status: d.status, ...summary(d) }));
}

/** For R&D's BOM editor: each In-House step of one part — approved, waiting, or nothing yet. */
export async function bomStatus(companyId, partCode) {
  if (!partCode) return [];
  const [steps, decisions] = await Promise.all([bomSteps(companyId, { partCode }), decisionsFor(companyId, [partCode])]);
  const typed = new Map(steps.map((s) => [s.stepKey, s]));
  const keys = new Set([...typed.keys(), ...[...decisions.keys()].filter((k) => k.startsWith(`${partCode}|`)).map((k) => k.slice(partCode.length + 1))]);
  return [...keys].map((k) => {
    const dec = decisions.get(`${partCode}|${k}`) || {};
    const s = typed.get(k);
    return {
      stepKey: k,
      approved: summary(dec.approved || null),
      waiting: s ? rdWaiting(s, dec) : false,
      rejected: dec.rejectedRd && s && sameValues(s, dec.rejectedRd) ? { decidedAt: dec.rejectedRd.decidedAt, decidedByName: dec.rejectedRd.decidedByName, note: dec.rejectedRd.note || '' } : null,
    };
  });
}


/* ── Slice 3: Production's side — the standard on a step, and flags (decision D) ── */

const procsOf = (order, unitIndex) => (unitIndex === 0 ? order.processes : order.extraUnits?.[unitIndex - 1]?.processes) || [];

/** Pieces a step's standard is for: a QC redo's pieces, a Sub Child Part batch, else 1. */
export function piecesFor(order, step) {
  const redo = (step?.reworks?.length || 0) > 0 && ['Pending', 'In Progress'].includes(step.status);
  const redoQty = redo ? Number(step.reworks[step.reworks.length - 1]?.qty) : 0;
  return redoQty || (order.orderKind === 'SubChildPart' ? Math.max(1, Number(order.orderQuantity) || 1) : 1);
}

/**
 * The standard a step goes by: the snapshot taken at its start, or — not started yet —
 * the approved one in force. { std, from: 'snapshot' | 'active' } or null (started with
 * typed hours, started before standards, or none approved).
 */
export async function standardOfStep(companyId, order, step) {
  if (!step || step.type === 'Outsourcing') return null;
  if (step.plannedSource === 'standard' && step.standard?.p1 > 0) return { std: step.standard, from: 'snapshot' };
  if (step.startedAt) return null;
  const d = await activeStandard(companyId, order.machineCode, step.step);
  return d ? { std: workingOf(d), from: 'active' } : null;
}

/** The latest flag per step of these orders: Map `${order}|${unit}|${step}` → flag. */
export async function flagsFor(orderIds = []) {
  const ids = [...new Set(orderIds.map(String))].filter((x) => mongoose.isValidObjectId(x));
  if (!ids.length) return new Map();
  const rows = await StepFlag.find({ order: { $in: ids.map(oid) } }).sort({ createdAt: 1 }).lean();
  const out = new Map();
  for (const f of rows) out.set(`${f.order}|${f.unitIndex}|${f.stepIndex}`, f); // later ones win
  return out;
}

/** What a step's panel shows about its flag. */
export const flagView = (f) => f && ({
  _id: f._id, status: f.status, requestedHours: f.requestedHours, standardHours: f.standardHours, reason: f.reason,
  flaggedByName: f.flaggedByName, flaggedAt: f.createdAt, decidedByName: f.decidedByName || '', decidedAt: f.decidedAt || null, note: f.note || '',
});

/**
 * Production flags a step as unusual: before, during or after the work. Never blocks
 * the work; only this step's score waits for the Company Admin.
 */
export async function raiseFlag(companyId, user, order, unitIndex, stepIndex, { hours, reason } = {}) {
  const step = procsOf(order, unitIndex)[stepIndex];
  if (!step) throw new StandardError(404, 'Step not found');
  const s = await standardOfStep(companyId, order, step);
  if (!s) {
    throw new StandardError(400, step.startedAt
      ? `${step.step} was started with typed hours, so it isn't scored against a standard: nothing to flag.`
      : `${step.step} has no approved standard yet, so there's nothing to flag.`);
  }
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 1000) throw new StandardError(400, 'The hours this job needs must be a number above 0 (up to 1000).');
  const why = String(reason || '').trim();
  if (why.length < 3) throw new StandardError(400, 'Say why this job is unusual.');
  if (await StepFlag.exists({ order: order._id, unitIndex, stepIndex, status: 'Pending' })) {
    throw new StandardError(409, 'This step is already flagged and waiting for the Company Admin.');
  }
  // What the standard says now: the run's earned hours once finished, else for the crew on it.
  let stdHours = null;
  if (step.completedAt) {
    const run = await StepRun.findOne({ order: order._id, unitIndex, stepIndex, rework: { $ne: true } }).sort({ completedAt: -1 }).select('plannedHours').lean();
    stdHours = run?.plannedHours ?? null;
  }
  if (stdHours == null) {
    const crewN = await StepCrewEntry.countDocuments({ order: order._id, unitIndex, stepIndex, leftAt: null });
    stdHours = standardHours(s.std, piecesFor(order, step), crewN || s.std.crew || 1);
  }
  const who = user.fullName ? user : (await User.findById(user._id).select('fullName username').lean()) || user;
  let f;
  try {
    f = await StepFlag.create({
      company: companyId, order: order._id, orderNo: order.orderId || '', partCode: order.machineCode || '', partName: order.machineName || '',
      unitIndex, stepIndex, stepName: step.step, standardHours: stdHours == null ? null : Math.round(stdHours * 100) / 100,
      requestedHours: Math.round(h * 100) / 100, reason: why.slice(0, 500), flaggedBy: user._id, flaggedByName: nameOf(who),
    });
  } catch (e) {
    if (e?.code === 11000) throw new StandardError(409, 'This step is already flagged and waiting for the Company Admin.');
    throw e;
  }
  tell(() => notificationService.notifyRoles(['Company Admin'], {
    title: `Step flagged: ${f.orderNo} · ${f.stepName}`,
    message: `${f.flaggedByName} says it needs ${f.requestedHours} h (standard ${f.standardHours ?? '–'} h): ${f.reason}`,
    type: 'production', icon: 'clock', priority: 'medium', targetCompanyId: companyId, data: { link: '/hrms/CompanyAdmin/standard-hours' },
  }));
  return flagView(f.toObject());
}

/** The latest flag on one step (or null). */
export async function flagOfStep(order, unitIndex, stepIndex) {
  const f = await StepFlag.findOne({ order: order._id, unitIndex, stepIndex }).sort({ createdAt: -1 }).lean();
  return flagView(f);
}

export { sigmaOf };

/**
 * R&D saved a BOM whose step standards changed (stampStandardEdits stamped them at
 * `stampAt`): one bell to the Company Admin, naming the steps. Never blocks the save.
 * part: the part's name, or its Item id.
 */
export function tellStandardEdits(companyId, part, cleaned, stampAt) {
  const at = new Date(stampAt).getTime();
  const steps = [];
  for (const cat of cleaned || []) {
    for (const p of cat?.internalProcesses || []) {
      if (p.standardEditedAt && new Date(p.standardEditedAt).getTime() === at && Number(p.usualHoursPerPiece) > 0) steps.push(p.name);
    }
  }
  if (!steps.length || !companyId) return;
  tell(async () => {
    const name = mongoose.isValidObjectId(part) && typeof part !== 'string'
      ? (await Item.findById(part).select('name').lean())?.name || 'a part'
      : String(part || 'a part');
    await notificationService.notifyRoles(['Company Admin'], {
      title: `Standard hours to approve: ${name}`,
      message: `R&D changed ${steps.join(', ')}. Production keeps the approved figure until you decide.`,
      type: 'rd', icon: 'clock', priority: 'medium', targetCompanyId: companyId, data: { link: '/hrms/CompanyAdmin/standard-hours' },
    });
  });
}
