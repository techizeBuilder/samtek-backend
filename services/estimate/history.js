// Delivery estimate (18 Nov 2026), slice 2: the usual numbers, from history first,
// then what R&D typed. docs/delivery-estimate/01-logic.md §7 and 02-plan.md.
// Every read is batched ($in over all codes at once) and bounded (the last 10
// runs / orders / purchases, or 3 months) — never a query per item.
import mongoose from 'mongoose';
import StepRun from '../../models/StepRun.js';
import StepCrewEntry from '../../models/StepCrewEntry.js';
import PurchaseRequest from '../../models/PurchaseRequest.js';
import Purchase from '../../models/Purchase.js';
import QCJob from '../../models/QCJob.js';
import VendorBid from '../../models/VendorBid.js';
import ProductionOrder from '../../models/ProductionOrder.js';
import ProcessCategoryOption from '../../models/ProcessCategoryOption.js';
import Holiday from '../../models/Holiday.js';
import Leave from '../../models/Leave.js';
import ProductionTeam from '../../models/ProductionTeam.js';
import User from '../../models/User.js';
import { averageFor } from '../crew/crewHoursCalc.js';
import { shiftsOf } from '../crew/crewService.js';
import { loadCompanyInputs, weeklyOffDaysFor } from '../payroll/payrollService.js';
import { dayKinds } from '../payroll/payrollCalc.js';
import { attendancePart } from '../score/scoreCalc.js';
import { productionUserQuery } from '../../controllers/scorecardController.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const DAY_MS = 864e5;
const IST_MS = 5.5 * 3600 * 1000;
export const indiaToday = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 10);
const indiaDateOf = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const norm = (s) => String(s || '').trim().toLowerCase();
/** History replaces a typed number only from this many records (step runs, receipts, trips, QC waits). */
export const MIN_HISTORY = 3;
/** Attendance is measured only from this many recorded working days (deep test, 19 Nov); before that, 100%. */
export const MIN_ATTENDANCE_DAYS = 20;

/** The middle one (decision U). */
export function median(values = []) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ── Step hours (decision D) ─────────────────────────────────────────────────
/** Last 10 non-rework runs per (partCode, stepName), for every pair asked at once. */
export async function stepRunsFor(companyId, partCodes = []) {
  if (!partCodes.length) return new Map();
  const rows = await StepRun.aggregate([
    { $match: { company: oid(companyId), partCode: { $in: [...new Set(partCodes)] }, rework: { $ne: true }, pieces: { $gt: 0 }, personHours: { $gt: 0 } } },
    { $group: {
      _id: { p: '$partCode', s: '$stepName' },
      runs: { $topN: { n: 10, sortBy: { completedAt: -1 }, output: { personHours: '$personHours', pieces: '$pieces', crewSize: '$crewSize', completedAt: '$completedAt' } } },
    } },
  ]);
  return new Map(rows.map((r) => [`${r._id.p}|${norm(r._id.s)}`, r.runs]));
}

/**
 * One step's work for `pieces` pieces: from history (3+ runs, stage 5's average
 * by crew size), else R&D's usual hours per piece, else unknown.
 * Returns { personHours, crew, basis: 'history' | 'typed' | null }.
 */
export function stepWork(runsMap, partCode, stepName, pieces, usualHoursPerPiece) {
  const runs = runsMap.get(`${partCode}|${norm(stepName)}`) || [];
  if (runs.length >= 3) {
    const crew = Math.max(1, Math.round(median(runs.map((r) => r.crewSize || 1)) || 1));
    const a = averageFor(runs.map((r) => ({ ...r, rework: false })), crew, pieces);
    if (a.hours != null) return { personHours: a.hours * crew, crew, basis: 'history', runs: runs.length };
  }
  if (Number(usualHoursPerPiece) > 0) return { personHours: Number(usualHoursPerPiece) * pieces, crew: 1, basis: 'typed' };
  return { personHours: null, crew: 1, basis: null };
}

/** The step's usual crew from history (3+ runs: the middle crew size), else null. */
export function usualCrew(runsMap, partCode, stepName) {
  const runs = runsMap.get(`${partCode}|${norm(stepName)}`) || [];
  return runs.length >= 3 ? Math.max(1, Math.round(median(runs.map((r) => r.crewSize || 1)) || 1)) : null;
}

/**
 * Revision 19 Nov (01-logic.md §11 changes 1–2): a step's hours for 1…maxCrew people.
 * History (3+ runs): stage 5's own average for that many people — real runs with
 * exactly k people first, else the overall work split evenly (02e decision 5).
 * Else R&D's usual hours per piece, split evenly. Else unknown.
 * Returns { hoursFor: { 1: h, 2: h, … } | null, basis: 'history' | 'typed' | null }.
 */
export function stepTimes(runsMap, partCode, stepName, pieces, usualHoursPerPiece, maxCrew = 1) {
  const runs = runsMap.get(`${partCode}|${norm(stepName)}`) || [];
  const top = Math.max(1, Math.round(maxCrew) || 1);
  const out = {};
  if (runs.length >= 3) {
    const list = runs.map((r) => ({ ...r, rework: false }));
    for (let k = 1; k <= top; k++) out[k] = averageFor(list, k, pieces).hours;
    if (out[1] != null) return { hoursFor: out, basis: 'history', runs: runs.length };
  }
  if (Number(usualHoursPerPiece) > 0) {
    for (let k = 1; k <= top; k++) out[k] = (Number(usualHoursPerPiece) * pieces) / k;
    return { hoursFor: out, basis: 'typed' };
  }
  return { hoursFor: null, basis: null };
}

// ── People at once on a part (decision M) ──────────────────────────────────
/** The most people working at once in a set of [from, to] intervals. */
export function mostAtOnce(intervals = []) {
  const ev = [];
  for (const [a, b] of intervals) { ev.push([a, 1]); ev.push([b, -1]); }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // a leave before a join at the same moment
  let cur = 0, best = 0;
  for (const [, d] of ev) { cur += d; best = Math.max(best, cur); }
  return best;
}

/** Per partCode: { usual, most, orders } over its last 10 orders, when 3+ orders have crews. */
export async function peopleCapsFor(companyId, partCodes = [], now = Date.now()) {
  if (!partCodes.length) return new Map();
  const lastOrders = await StepCrewEntry.aggregate([
    { $match: { company: oid(companyId), partCode: { $in: [...new Set(partCodes)] } } },
    { $group: { _id: { p: '$partCode', o: '$order' }, last: { $max: '$joinedAt' } } },
    { $group: { _id: '$_id.p', orders: { $topN: { n: 10, sortBy: { last: -1 }, output: '$_id.o' } } } },
  ]);
  const orderIds = lastOrders.flatMap((r) => r.orders);
  if (!orderIds.length) return new Map();
  const entries = await StepCrewEntry.find({ order: { $in: orderIds } }).select('order partCode person joinedAt leftAt').lean();
  const byOrder = new Map();
  for (const e of entries) {
    const k = String(e.order);
    if (!byOrder.has(k)) byOrder.set(k, []);
    byOrder.get(k).push([new Date(e.joinedAt).getTime(), new Date(e.leftAt || now).getTime()]);
  }
  const out = new Map();
  for (const r of lastOrders) {
    const counts = r.orders.map((o) => mostAtOnce(byOrder.get(String(o)) || [])).filter((n) => n > 0);
    if (counts.length >= 3) {
      out.set(r._id, { usual: Math.max(1, Math.round(counts.reduce((s, n) => s + n, 0) / counts.length)), most: Math.max(...counts), orders: counts.length });
    }
  }
  return out;
}

/** The cap for a part: history, else R&D's usual people, else its biggest step crew, else 1. */
export function capFor(capsMap, partCode, typedPeople, steps = []) {
  const h = capsMap.get(partCode);
  if (h) return { cap: h.usual, most: h.most, basis: 'history' };
  if (Number(typedPeople) >= 1) return { cap: Number(typedPeople), most: Number(typedPeople), basis: 'typed' };
  const biggest = Math.max(1, ...steps.filter((s) => s.kind === 'work').map((s) => s.crew || 1));
  return { cap: biggest, most: biggest, basis: 'steps' };
}

// ── Purchase days (decisions S, U, V) ──────────────────────────────────────
/**
 * Usual days from raising a request to the item passing QC, per item code (and
 * per size when 3+ of that size), the middle one of the last 10. Also the usual
 * buying time (raise → PO), company-wide, for items bought by quote only.
 */
export async function purchaseDaysFor(companyId, itemCodes = []) {
  // receiptsByCode: how many receipts each code has (up to 10), even under 3 — for
  // Purchase → Inventory's "2 receipts so far" (19 Nov, §13).
  const out = { byCode: new Map(), bySize: new Map(), buyingDays: null, receiptsByCode: new Map() };
  const codes = [...new Set(itemCodes.filter(Boolean))];
  const recent = codes.length ? await PurchaseRequest.find({
    companyId: oid(companyId), materialCode: { $in: codes }, receivedAt: { $ne: null }, status: 'Received',
  }).sort({ receivedAt: -1 }).limit(codes.length * 15).select('materialCode requestDate receivedAt purchaseOrder fabricationDimensionLines createdAt').lean() : [];
  // QC passed (the matching Purchase QC job), else received.
  const poIds = [...new Set(recent.map((r) => String(r.purchaseOrder || '')).filter(Boolean))];
  const pos = poIds.length ? await Purchase.find({ _id: { $in: poIds } }).select('purchaseOrderNumber orderDate').lean() : [];
  const poNo = new Map(pos.map((p) => [String(p._id), p.purchaseOrderNumber]));
  const qcs = pos.length ? await QCJob.find({ source: 'Purchase', sourceRefId: { $in: pos.map((p) => p.purchaseOrderNumber).filter(Boolean) }, decision: 'Pass' })
    .select('sourceRefId itemCode decidedAt').lean() : [];
  const passed = new Map(qcs.map((q) => [`${q.sourceRefId}|${q.itemCode}`, q.decidedAt]));
  const samples = new Map(); // code → [{ days, size }]
  for (const r of recent) {
    const start = r.requestDate || r.createdAt;
    const end = passed.get(`${poNo.get(String(r.purchaseOrder))}|${r.materialCode}`) || r.receivedAt;
    if (!start || !end) continue;
    const days = (new Date(end) - new Date(start)) / DAY_MS;
    if (!(days >= 0)) continue;
    const size = r.fabricationDimensionLines?.length ? JSON.stringify(r.fabricationDimensionLines[0].values || {}) : null;
    if (!samples.has(r.materialCode)) samples.set(r.materialCode, []);
    samples.get(r.materialCode).push({ days, size });
  }
  for (const [code, list] of samples) {
    const ten = list.slice(0, 10);
    out.receiptsByCode.set(code, ten.length);
    // 3+ receipts before history replaces Purchase's typed lead time (deep test, 19 Nov:
    // dev tests received in minutes, and one receipt said "usually 0 days").
    if (ten.length >= MIN_HISTORY) out.byCode.set(code, { days: Math.ceil(median(ten.map((x) => x.days)) - 1e-9), samples: ten.length });
    const sizes = new Map();
    for (const x of list) if (x.size) { if (!sizes.has(x.size)) sizes.set(x.size, []); sizes.get(x.size).push(x.days); }
    for (const [size, d] of sizes) if (d.length >= MIN_HISTORY) out.bySize.set(`${code}|${size}`, { days: Math.ceil(median(d.slice(0, 10)) - 1e-9), samples: Math.min(10, d.length) });
  }
  // Buying time: raise → PO, company-wide, the last 10 ordered.
  const ordered = await PurchaseRequest.find({ companyId: oid(companyId), purchaseOrder: { $ne: null } }).sort({ updatedAt: -1 }).limit(10).select('requestDate createdAt purchaseOrder').lean();
  const oPos = ordered.length ? await Purchase.find({ _id: { $in: ordered.map((o) => o.purchaseOrder) } }).select('orderDate createdAt').lean() : [];
  const oDate = new Map(oPos.map((p) => [String(p._id), p.orderDate || p.createdAt]));
  out.buyingDays = (() => {
    const d = ordered.map((o) => (new Date(oDate.get(String(o.purchaseOrder))) - new Date(o.requestDate || o.createdAt)) / DAY_MS).filter((x) => x >= 0);
    const m = d.length >= MIN_HISTORY ? median(d) : null;
    return m == null ? null : Math.ceil(m - 1e-9);
  })();
  return out;
}

/** The vendors' latest quoted delivery days, per item code (the purchase request's material). */
export async function quotedDaysFor(companyId, itemCodes = []) {
  const codes = [...new Set(itemCodes.filter(Boolean))];
  if (!codes.length) return new Map();
  const prs = await PurchaseRequest.find({ companyId: oid(companyId), materialCode: { $in: codes } }).sort({ createdAt: -1 }).limit(codes.length * 5).select('_id materialCode').lean();
  if (!prs.length) return new Map();
  const bids = await VendorBid.find({ purchaseRequest: { $in: prs.map((p) => p._id) }, deliveryDays: { $gt: 0 } }).sort({ createdAt: -1 }).select('purchaseRequest deliveryDays').lean();
  const codeOf = new Map(prs.map((p) => [String(p._id), p.materialCode]));
  const out = new Map();
  for (const b of bids) {
    const code = codeOf.get(String(b.purchaseRequest));
    if (code && !out.has(code)) out.set(code, b.deliveryDays);
  }
  return out;
}

// ── Job-work days (decision H) ─────────────────────────────────────────────
/**
 * Per process name (lower case): the trips so far (up to the last 10, ready to send →
 * back) and, from MIN_HISTORY of them, their middle one. Map name → { days|null, samples }.
 */
export async function jobworkHistory(companyId, stepNames = []) {
  const names = [...new Set(stepNames.map(norm).filter(Boolean))];
  const out = new Map();
  if (!names.length) return out;
  const orders = await ProductionOrder.find({ company: oid(companyId), 'outsourceHandoffs.status': 'Completed' })
    .sort({ updatedAt: -1 }).limit(60).select('outsourceHandoffs').lean();
  const samples = new Map();
  for (const o of orders) {
    for (const h of o.outsourceHandoffs || []) {
      if (h.status !== 'Completed' || !h.requestedAt) continue;
      const back = (h.rounds || []).filter((r) => r.receivedAt).map((r) => new Date(r.receivedAt).getTime());
      if (!back.length) continue;
      const days = (Math.max(...back) - new Date(h.requestedAt).getTime()) / DAY_MS;
      if (!(days >= 0)) continue;
      for (const s of h.stepNames || []) {
        const k = norm(s);
        if (!names.includes(k)) continue;
        if (!samples.has(k)) samples.set(k, []);
        if (samples.get(k).length < 10) samples.get(k).push(days);
      }
    }
  }
  for (const [k, d] of samples) out.set(k, { days: d.length >= MIN_HISTORY ? Math.round(median(d)) : null, samples: d.length });
  return out;
}

/** Per step name: the middle one of the last 10 trips (3+), else Purchase's usual days (Job Work Time). */
export async function jobworkDaysFor(companyId, stepNames = []) {
  const names = [...new Set(stepNames.map(norm).filter(Boolean))];
  const out = new Map();
  if (!names.length) return out;
  for (const [k, h] of await jobworkHistory(companyId, names)) if (h.days != null) out.set(k, { days: h.days, basis: 'history', samples: h.samples });
  const typed = await ProcessCategoryOption.find({ companyId: oid(companyId), 'usualDays.0': { $exists: true } }).select('usualDays').lean();
  for (const opt of typed) {
    for (const u of opt.usualDays || []) {
      const k = norm(u.process);
      if (names.includes(k) && !out.has(k)) out.set(k, { days: u.days, basis: 'typed' });
    }
  }
  return out;
}

// ── QC wait (decision W) ───────────────────────────────────────────────────
/**
 * The usual production QC wait: the middle one of the last 10 decided checkpoints.
 * A decision on the same India day counts its hours; a later day counts as
 * "by the end of the day" (null). Returns hours, or null (= the end of the same working day).
 */
export async function qcWaitHours(companyId) {
  const jobs = await QCJob.find({ company: oid(companyId), source: { $in: ['Production', 'ChildPartProduction', 'SubChildPartProduction'] }, decidedAt: { $ne: null } })
    .sort({ decidedAt: -1 }).limit(15).select('unitChecks batchSteps').lean();
  const waits = [];
  for (const j of jobs) {
    const attempts = [
      ...(j.unitChecks || []).flatMap((u) => (u.steps || []).flatMap((s) => s.attempts || [])),
      ...(j.batchSteps || []).flatMap((s) => s.attempts || []),
    ];
    for (const a of attempts) {
      if (!a.submittedAt || !a.decidedAt) continue;
      const same = indiaDateOf(a.submittedAt) === indiaDateOf(a.decidedAt);
      waits.push({ at: new Date(a.decidedAt).getTime(), hours: same ? (new Date(a.decidedAt) - new Date(a.submittedAt)) / 3600000 : Infinity });
    }
  }
  const ten = waits.sort((a, b) => b.at - a.at).slice(0, 10);
  if (ten.length < 3) return { hours: null, basis: 'none' };
  const m = median(ten.map((w) => w.hours));
  return m === Infinity || m == null ? { hours: null, basis: 'history' } : { hours: Math.round(m * 100) / 100, basis: 'history' };
}

// ── People, their days and attendance (decisions F, G) ─────────────────────
const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** A shift's working hours (end − start − lunch), crossing midnight if need be. No shift → 8. */
export function rawShiftHours(shift) {
  if (!shift) return 8;
  const a = toMin(shift.start), b = toMin(shift.end);
  if (a == null || b == null) return 8;
  const len = (b - a + 1440) % 1440 || 1440;
  const la = toMin(shift.lunchFrom), lb = toMin(shift.lunchTo);
  const lunch = la != null && lb != null ? ((lb - la + 1440) % 1440) : 0;
  const h = (len - lunch) / 60;
  return h > 0 ? h : 8;
}

const monthOf = (date) => date.slice(0, 7);
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };

/**
 * Production's people for the plan: team, skills, hours a day, attendance rate
 * over the last 3 months (100% and flagged when they have no records), and the
 * days they're off ahead (approved leave). Also the company calendar.
 */
export async function peopleAndCalendar(companyId, today = indiaToday(), horizonDays = 366) {
  const userQuery = await productionUserQuery(companyId);
  const users = await User.find({ companyId, isActive: { $ne: false }, ...userQuery }).select('fullName username productionSkills joiningDate deviceCode role').lean();
  const ids = users.map((u) => u._id);
  const [teams, shifts, weeklyOffDays] = await Promise.all([
    ProductionTeam.find({ company: companyId, isActive: { $ne: false }, people: { $in: ids } }).select('name people').lean(),
    shiftsOf(companyId),
    weeklyOffDaysFor(companyId),
  ]);
  const teamOf = new Map();
  for (const t of teams) for (const p of t.people || []) if (!teamOf.has(String(p))) teamOf.set(String(p), { id: String(t._id), name: t.name });
  const general = shifts.find((s) => norm(s.name) === 'general') || shifts[0] || null;
  const hoursPerDay = rawShiftHours(general);

  // Attendance: the last 3 months (this one up to yesterday), payroll's day rules.
  const months = [monthOf(today), prevMonth(monthOf(today)), prevMonth(prevMonth(monthOf(today)))];
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const present = new Map(), eligible = new Map(), recorded = new Map();
  // The three months load side by side (each is one batched read per collection).
  const monthInputs = await Promise.all(months.map((m) => loadCompanyInputs(companyId, m, { userIds: ids })));
  for (let mi = 0; mi < months.length; mi++) {
    const m = months[mi];
    const inputs = monthInputs[mi];
    for (const u of inputs.users) {
      const att = inputs.attendanceOf.get(String(u._id)) || [];
      if (att.length) recorded.set(String(u._id), true);
      const days = dayKinds({ month: m, today: yesterday, person: u, attendance: att, leaves: inputs.leavesOf.get(String(u._id)) || [], leavePaid: inputs.leavePaid, holidays: inputs.holidays, weeklyOffDays: inputs.weeklyOffDays });
      // Only days that have an attendance record count (deep test, 19 Nov): a day with
      // no record isn't "absent" for the estimate — the device writes its own Absent.
      const withRecord = new Set(att.map((a) => a.date));
      const part = attendancePart(days.filter((d) => withRecord.has(d.date)), { recorded: true });
      present.set(String(u._id), (present.get(String(u._id)) || 0) + part.present);
      eligible.set(String(u._id), (eligible.get(String(u._id)) || 0) + part.eligible);
    }
  }
  // Ahead: holidays and approved leave inside the horizon.
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + horizonDays * DAY_MS);
  const [hols, leaves] = await Promise.all([
    Holiday.find({ companyId, isActive: { $ne: false }, date: { $gte: new Date(`${today}T00:00:00+05:30`), $lte: end } }).select('date').lean(),
    Leave.find({ employee: { $in: ids }, status: 'APPROVED', toDate: { $gte: new Date(`${today}T00:00:00+05:30`) } }).select('employee fromDate toDate').lean(),
  ]);
  const offOf = new Map();
  for (const l of leaves) {
    const k = String(l.employee);
    if (!offOf.has(k)) offOf.set(k, []);
    for (let d = indiaDateOf(l.fromDate); d <= indiaDateOf(l.toDate); d = new Date(Date.parse(`${d}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)) {
      if (d >= today) offOf.get(k).push(d);
    }
  }
  const people = users.map((u) => {
    const k = String(u._id);
    const el = eligible.get(k) || 0;
    // Measured only from MIN_ATTENDANCE_DAYS recorded working days; before that, 100%.
    const measured = recorded.get(k) === true && el >= MIN_ATTENDANCE_DAYS;
    const rate = measured ? Math.min(1, (present.get(k) || 0) / el) : 1;
    const team = teamOf.get(k);
    return {
      id: k, name: u.fullName || u.username || '', team: team?.id || null, teamName: team?.name || 'No team',
      skills: u.productionSkills || [], hoursPerDay, rate, noAttendance: !measured, recordedDays: el, offDates: offOf.get(k) || [],
    };
  });
  return {
    people,
    calendar: { weeklyOffDays, holidays: hols.map((h) => indiaDateOf(h.date)) },
    hoursPerDay,
    attendanceMeasured: people.some((p) => !p.noAttendance),
    attendanceMeasuredCount: people.filter((p) => !p.noAttendance).length,
  };
}

/** Who has been on each open order lately (decision P): the last 3 working days. */
export async function recentCrews(companyId, orderIds = [], since) {
  if (!orderIds.length) return new Map();
  const rows = await StepCrewEntry.find({ order: { $in: orderIds }, $or: [{ leftAt: null }, { leftAt: { $gte: since } }] }).select('order person').lean();
  const out = new Map();
  for (const r of rows) {
    const k = String(r.order);
    if (!out.has(k)) out.set(k, new Set());
    out.get(k).add(String(r.person));
  }
  return out;
}
