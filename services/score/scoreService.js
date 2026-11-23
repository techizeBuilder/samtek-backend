// The employee scorecard (feature 13, 2026-11-17; replaces feature 10's score):
// docs/client-features-2026-11/13-employee-scorecard-logic.md. The maths is in
// scoreCalc.js; this loads a month's data for a company's people.
//
// Every employee gets a score (Company Admin / Superadmin excluded), from:
//   attendance + punctuality — payroll's day rules and the device's lateness
//   the five step parts      — Production's finished steps and the QC checks that
//                              judge them, plus steps left open past their plan.
//                              Each department's work is a "source"; today only
//                              Production has one (SOURCES). Without one, those
//                              parts are "not measured" and scaled out.
//   conduct (5 parameters)   — verified conduct notes (ConductNote)
//   learning                 — a skill added or a training test passed (3 months)
// Monthly only: the settings and attendance are per month.
import mongoose from 'mongoose';
import StepRun from '../../models/StepRun.js';
import ProductionOrder from '../../models/ProductionOrder.js';
import ProductionTeam from '../../models/ProductionTeam.js';
import QCJob from '../../models/QCJob.js';
import StepCrewEntry from '../../models/StepCrewEntry.js';
import User from '../../models/User.js';
import Department from '../../models/Department.js';
import ConductNote from '../../models/ConductNote.js';
import { AttendancePolicy } from '../../models/AttendancePolicy.js';
import { TestAttempt } from '../../models/TrainingmanagementModel.js';
import { loadCompanyInputs } from '../payroll/payrollService.js';
import { dayKinds, monthDates } from '../payroll/payrollCalc.js';
import { stepHoursUntil } from '../crew/crewService.js';
import { flagsFor } from '../standards/standardService.js';
import { scoredPlan, crewSegments, earnedHours } from '../standards/standardCalc.js';
import {
  timingPoints, timingBand, unitAccuracy, batchAccuracy, judgingCheck, ftrError,
  attendancePart, punctualityPart, stepParts, conductPart, learningPart, scorecard, teamScore, PARAMS,
} from './scoreCalc.js';
import { settingsFor, thisMonthIndia } from './scorecardSettings.js';
import { companyDepartments, departmentOf } from '../departmentSeedService.js';

const nameOf = (u) => u?.fullName || u?.username || 'Unknown';
// The pieces a step's standard is for: a QC redo's pieces, a Sub Child Part batch, else 1.
const piecesOfStep = (order, p) => ((p.reworks?.length && Number(p.reworks[p.reworks.length - 1]?.qty)) || (order.orderKind === 'SubChildPart' ? Math.max(1, Number(order.orderQuantity) || 1) : 1));
const unitProcs = (order, unitIndex) => (unitIndex === 0 ? order.processes : order.extraUnits?.[unitIndex - 1]?.processes) || [];
const IST_MS = 5.5 * 3600 * 1000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const NOT_SCORED_ROLES = ['Superadmin', 'Super Admin', 'Company Admin'];
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const r1 = (v) => Math.round(v * 10) / 10;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 366;

/**
 * The period asked for (feature 10's decision E, kept 17 Nov): a month ('YYYY-MM',
 * this month by default) or any from / to dates (India days, up to a year).
 * `month` is the month of the last day: its settings version scores the period.
 */
export function periodOf({ month, from, to } = {}) {
  if (DATE_RE.test(String(from || '')) && DATE_RE.test(String(to || '')) && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))
    && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= MAX_SPAN_DAYS) {
    return { fromDate: from, toDate: to, month: to.slice(0, 7), dates: true };
  }
  const m = MONTH_RE.test(String(month || '')) ? month : thisMonthIndia();
  return { fromDate: `${m}-01`, toDate: monthDates(m).at(-1), month: m, dates: false };
}

/** The month whose settings apply ('YYYY-MM'). */
export const monthOf = (q = {}) => periodOf(q).month;

/** A period → [from, to] as Dates (India days). */
export function rangeOf(q = {}) {
  const p = periodOf(q);
  return [new Date(`${p.fromDate}T00:00:00+05:30`), new Date(`${p.toDate}T23:59:59.999+05:30`)];
}

const addMonths = (month, k) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};
const monthsIn = (p) => {
  const out = [];
  for (let m = p.fromDate.slice(0, 7); m <= p.toDate.slice(0, 7) && out.length < 14; m = addMonths(m, 1)) out.push(m);
  return out;
};

// ── Production's work ────────────────────────────────────────────────────────

// The QC entry that holds the check for step `p` on this unit / batch.
function qcEntry(job, order, unitIndex, p) {
  if (!job || !p) return null;
  if (order.orderKind === 'SubChildPart') return (job.batchSteps || []).find((b) => b.category === p.category && b.stepName === p.step) || null;
  const unit = (job.unitChecks || []).find((u) => u.unitNumber === unitIndex + 1);
  return (unit?.steps || []).find((s) => s.category === p.category && s.stepName === p.step) || null;
}

const decided = (a) => (a?.decision === 'Pass' || a?.decision === 'Reject' || a?.passedQty != null);
const isBatch = (order) => order.orderKind === 'SubChildPart';
const accuracyOf = (order, a) => (isBatch(order) ? batchAccuracy(a.passedQty, a.qtySubmitted) : unitAccuracy(a.decision));
const errorOf = (order, a) => ftrError(isBatch(order)
  ? { batch: true, passed: a.passedQty, submitted: a.qtySubmitted, severity: a.severity }
  : { decision: a.decision, severity: a.severity });
const resultLabel = (order, a) => {
  const grade = a.severity ? ` (${a.severity})` : '';
  if (isBatch(order)) return `${a.passedQty} of ${a.qtySubmitted} passed${a.passedQty < a.qtySubmitted ? grade : ''}`;
  return a.decision === 'Pass' ? 'Passed' : `Rejected${grade}`;
};

/**
 * Production's finished steps in the range: one item per person per step run,
 * with timing, band, QC pass rate (quality), first-time-right error (accuracy)
 * and the team they worked for.
 */
async function productionSource(companyId, from, to, { persons = null } = {}) {
  const q = { company: oid(companyId), completedAt: { $gte: from, $lte: to } };
  if (persons) q['byPerson.person'] = { $in: persons.map(oid) };
  const runs = await StepRun.find(q).select('order orderNo partName stepName unitIndex stepIndex rework plannedHours plannedSource workingHours personHours pieces completedAt byPerson.person byPerson.team byPerson.personHours byTeam').lean();
  if (!runs.length) return [];
  const orderIds = [...new Set(runs.map((r) => String(r.order)))];
  const orders = new Map((await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderId orderKind source processes extraUnits').lean()).map((o) => [String(o._id), o]));
  const { qcJobSourceForOrder } = await import('../../controllers/productionMfgController.js');
  const jobsList = await QCJob.find({ company: q.company, sourceRefId: { $in: [...orders.values()].map((o) => o.orderId) } }).select('source sourceRefId unitChecks batchSteps').lean();
  const jobOf = (o) => jobsList.find((j) => j.sourceRefId === o.orderId && j.source === qcJobSourceForOrder(o)) || null;
  const wanted = persons ? new Set(persons.map(String)) : null;
  // Feature 19 (2026-11-21): what each run is scored against — the standard it earned,
  // a flag's hours, or nothing (typed hours; a flag still waiting). scoredPlan, decisions D/G/H.
  const flags = await flagsFor(orderIds);

  // A run saved before 17 Nov 2026 with more than one team on it doesn't say which
  // team each person worked for. The step's crew list does, as it was then (a cover:
  // the team covered), so a later team edit never moves past hours (17 Nov, browser test).
  const mixed = runs.filter((r) => (r.byTeam || []).length > 1 && (r.byPerson || []).some((p) => !p.team));
  const crewTeam = new Map();
  if (mixed.length) {
    const entries = await StepCrewEntry.find({ order: { $in: [...new Set(mixed.map((r) => String(r.order)))].map(oid) } })
      .select('order unitIndex stepIndex person team forTeam joinedAt').sort({ joinedAt: 1 }).lean();
    for (const r of mixed) {
      for (const p of r.byPerson || []) {
        const e = entries.filter((x) => String(x.order) === String(r.order) && x.unitIndex === r.unitIndex && x.stepIndex === r.stepIndex
          && String(x.person) === String(p.person) && new Date(x.joinedAt) <= new Date(r.completedAt)).at(-1);
        const t = e && (e.forTeam || e.team);
        if (t) crewTeam.set(`${r._id}|${p.person}`, String(t));
      }
    }
  }

  const items = [];
  for (const r of runs) {
    const order = orders.get(String(r.order));
    if (!order) continue;
    const procs = unitProcs(order, r.unitIndex);
    const plan = scoredPlan({ plannedSource: r.plannedSource || null, plannedHours: r.plannedHours, flag: r.rework ? null : flags.get(`${r.order}|${r.unitIndex}|${r.stepIndex}`) });
    const planned = plan.counted ? plan.planned : null;
    const timing = !r.rework ? timingPoints(planned, r.workingHours) : null;
    let accuracy = null, error = null, qc = null;
    const j = judgingCheck(procs, r.stepIndex);
    if (j != null) {
      const entry = qcEntry(jobOf(order), order, r.unitIndex, procs[j]);
      const attempts = [...(entry?.attempts || [])].sort((a, b) => (a.attemptNumber || 0) - (b.attemptNumber || 0)).filter(decided);
      // A redo of the step with the check: its own result. Everyone else in the
      // stretch it judges: the first result.
      const attempt = (r.rework && r.stepIndex === j)
        ? attempts.find((a) => a.submittedAt && new Date(a.submittedAt).getTime() >= new Date(r.completedAt).getTime() - 60000)
        : attempts[0];
      if (attempt) {
        accuracy = accuracyOf(order, attempt);
        error = errorOf(order, attempt);
        qc = { step: procs[j].step, result: resultLabel(order, attempt), ownStep: j === r.stepIndex, severity: attempt.severity || null };
      }
    }
    if (timing == null && accuracy == null) continue;
    const band = !r.rework ? timingBand(planned, r.workingHours) : null;
    const run = {
      order: r.order, orderNo: r.orderNo, partName: r.partName, stepName: r.stepName, unit: r.unitIndex + 1,
      planned: planned ?? (plan.why === 'typed' || plan.why === 'flagWaiting' ? null : r.plannedHours ?? null), took: r.workingHours ?? null, rework: !!r.rework,
      planWhy: plan.why, // 'standard' | 'flagApproved' | 'flagWaiting' | 'typed' | 'legacy'
      band, timing, accuracy, qc, completedAt: r.completedAt,
    };
    // A run before 17 Nov 2026 has no team per person: its one team, or (several
    // teams) the crew list's team for that person.
    const onlyTeam = (r.byTeam || []).length === 1 ? String(r.byTeam[0].team) : null;
    for (const p of r.byPerson || []) {
      if (wanted && !wanted.has(String(p.person))) continue;
      if (p.personHours > 0) {
        const team = p.team ? String(p.team) : onlyTeam || crewTeam.get(`${r._id}|${p.person}`) || null;
        // How much this step counts for them: its planned size × their share of the crew's hours,
        // never the hours it took (that's what is being judged). A redo, or a step with no plan: their hours.
        const share = r.personHours > 0 ? p.personHours / r.personHours : 1;
        // A flag still waiting weighs by the standard (Production can't move it); typed hours by their hours.
        const sizeBy = plan.why === 'flagWaiting' ? r.plannedHours : planned;
        const weight = !r.rework && sizeBy > 0 ? sizeBy * share : p.personHours;
        items.push({ person: String(p.person), team, weight, hours: p.personHours, timing, band, accuracy, error, severity: qc?.severity || null, rework: !!r.rework, run });
      }
    }
  }
  return items;
}

/**
 * Steps open at the month's end (or now) past their planned hours: one item per
 * person on the crew, weighted by their hours so far. A step not started, still
 * within its plan, outsourced, or a redo round after QC isn't counted.
 */
async function productionUnfinished(companyId, from, to, { persons = null } = {}) {
  const until = new Date(Math.min(to.getTime(), Date.now()));
  if (until < from) return [];
  // Only orders with a step that was open at that moment: started by then, not
  // finished by then. Never every order ever started (that grows with history).
  const openThen = { $elemMatch: { startedAt: { $lte: until }, plannedHours: { $gt: 0 }, type: { $ne: 'Outsourcing' }, $or: [{ completedAt: null }, { completedAt: { $gt: until } }] } };
  // An order with a step open at that moment is either still open now, or was
  // changed after the period began (finished or cancelled since): never older ones.
  const orders = await ProductionOrder.find({
    company: oid(companyId),
    $and: [
      { $or: [{ status: { $nin: ['Completed', 'Cancelled'] } }, { updatedAt: { $gte: from } }] },
      { $or: [{ processes: openThen }, { 'extraUnits.processes': openThen }] },
    ],
  }).select('orderId orderKind orderQuantity processes extraUnits').lean();
  if (!orders.length) return [];
  const wanted = persons ? new Set(persons.map(String)) : null;
  const flags = await flagsFor(orders.map((o) => o._id)); // feature 19
  // When only some people are asked for (one person's view, Production's tab), skip
  // the steps none of them was ever on, so their hours aren't worked out for nothing.
  let onStep = null;
  if (wanted) {
    const entries = await StepCrewEntry.find({ order: { $in: orders.map((o) => o._id) }, person: { $in: persons.map(oid) }, joinedAt: { $lte: until } })
      .select('order unitIndex stepIndex').lean();
    onStep = new Set(entries.map((e) => `${e.order}|${e.unitIndex}|${e.stepIndex}`));
    if (!onStep.size) return [];
  }
  const out = [];
  for (const order of orders) {
    const units = 1 + (order.extraUnits?.length || 0);
    for (let u = 0; u < units; u++) {
      const procs = unitProcs(order, u);
      for (let s = 0; s < procs.length; s++) {
        const p = procs[s];
        if (p.type === 'Outsourcing' || !(p.plannedHours > 0) || !p.startedAt || new Date(p.startedAt) > until) continue;
        if (p.completedAt && new Date(p.completedAt) <= until) continue;
        if (onStep && !onStep.has(`${order._id}|${u}|${s}`)) continue;
        // Feature 19: typed hours (no standard) and a step flagged and waiting aren't scored.
        const pre = scoredPlan({ plannedSource: p.plannedSource || null, plannedHours: p.plannedHours, flag: flags.get(`${order._id}|${u}|${s}`) });
        if (!pre.counted) continue;
        const h = await stepHoursUntil(companyId, order, u, s, until);
        if (!h || h.rework) continue;
        // With a standard: what it has earned for the crew so far (stretch by stretch);
        // an approved flag: its hours; before standards: the typed hours.
        const planned = pre.why === 'standard' && p.standard?.p1 > 0
          ? (earnedHours(crewSegments(h.perPerson), p.standard, piecesOfStep(order, p)) || p.plannedHours)
          : pre.planned;
        if (!(h.totals.workingHours > planned)) continue;
        for (const pp of h.perPerson) {
          if (!(pp.hours > 0) || (wanted && !wanted.has(String(pp.person)))) continue;
          const share = h.totals.personHours > 0 ? pp.hours / h.totals.personHours : 1;
          out.push({ person: String(pp.person), team: pp.team ? String(pp.team) : null, weight: planned * share, hours: pp.hours, step: { orderNo: order.orderId, stepName: p.step, unit: u + 1, planned: r1(planned), soFar: r1(h.totals.workingHours) } });
        }
      }
    }
  }
  return out;
}

const SOURCES = [{ finished: productionSource, unfinished: productionUnfinished }];

async function workOf(companyId, from, to, opts) {
  const [finished, unfinished] = await Promise.all([
    Promise.all(SOURCES.map((s) => s.finished(companyId, from, to, opts))).then((x) => x.flat()),
    Promise.all(SOURCES.map((s) => s.unfinished(companyId, from, to, opts))).then((x) => x.flat()),
  ]);
  return { finished, unfinished };
}

// ── A month for a set of people ──────────────────────────────────────────────

const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const k = String(r[key]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};

/**
 * The scorecard of each person for a period (a month, or any dates). userQuery
 * picks the people (default: everyone in the company but the admins). Returns
 * { month, from, to, fromDate, toDate, dates, settings,
 *   cards: [{ user, card, presentDays, recorded, hours, items, unfinished, notes, evidence }] }.
 */
async function monthCards(companyId, q, { userQuery = {}, withDetail = false } = {}) {
  const period = typeof q === 'string' ? periodOf({ month: q }) : periodOf(q);
  const { fromDate, toDate, month } = period;
  const [from, to] = rangeOf(period.dates ? { from: fromDate, to: toDate } : { month });
  const base = { month, from, to, fromDate, toDate, dates: period.dates };
  const settings = await settingsFor(companyId, month);
  // Active people, and anyone deactivated during or after the period (a record is
  // updated when it's deactivated); never everyone who ever worked here (17 Nov 2026).
  let users = await User.find({ companyId, role: { $nin: NOT_SCORED_ROLES }, ...userQuery, $or: [{ isActive: { $ne: false } }, { updatedAt: { $gte: from } }] })
    .select('fullName username employeeId departmentId isActive joiningDate deviceCode role productionSkillsAdded').lean();
  users = users.filter((u) => !u.joiningDate || new Date(u.joiningDate).getTime() + IST_MS <= Date.parse(`${toDate}T23:59:59Z`));
  if (!users.length) return { ...base, settings, cards: [] };
  const ids = users.map((u) => u._id);

  const months = monthsIn(period);
  const winFrom = rangeOf({ month: addMonths(month, -2) })[0]; // learning: the 3 months to the period's end
  const [inputsList, policy, work, notes, tests] = await Promise.all([
    Promise.all(months.map((m) => loadCompanyInputs(companyId, m, { userIds: ids }))),
    AttendancePolicy.findOne({ companyId }).select('graceTime').lean(),
    workOf(companyId, from, to, { persons: ids }),
    ConductNote.find({ company: oid(companyId), person: { $in: ids }, date: { $gte: fromDate, $lte: toDate }, status: withDetail ? { $in: ['Pending', 'Verified', 'Rejected', 'Cancelled'] } : 'Verified' })
      .sort({ date: -1, createdAt: -1 }).lean(),
    TestAttempt.find({ user: { $in: ids }, isPassed: true, finishedAt: { $gte: winFrom, $lte: to } }).select('user finishedAt').lean(),
  ]);
  const graceSeconds = (Number(policy?.graceTime ?? 10) || 0) * 60;
  const finishedOf = group(work.finished, 'person'), unfinishedOf = group(work.unfinished, 'person');
  const notesOf = group(notes, 'person'), testsOf = group(tests, 'user');
  const inPeriod = (d) => d >= fromDate && d <= toDate;

  const cards = [];
  for (const u of users) {
    const id = String(u._id);
    // Payroll's day rules, month by month, kept to the period's days.
    const days = [], rows = [];
    months.forEach((m, i) => {
      const inputs = inputsList[i];
      const mine = inputs.attendanceOf.get(id) || [];
      days.push(...dayKinds({
        month: m, person: { joiningDate: u.joiningDate, deviceCode: u.deviceCode },
        attendance: mine, leaves: inputs.leavesOf.get(id) || [],
        leavePaid: inputs.leavePaid, holidays: inputs.holidays, weeklyOffDays: inputs.weeklyOffDays,
      }).filter((d) => inPeriod(d.date)));
      rows.push(...mine.filter((a) => inPeriod(a.date)));
    });
    // No attendance record at all in the period (not on the device yet, or never
    // marked on screen): attendance can't be told from absence, so it isn't measured (17 Nov).
    const recorded = rows.length > 0;
    const att = attendancePart(days, { recorded });
    const attRows = new Map(rows.map((a) => [a.date, a]));
    const presentRows = days.filter((d) => d.kind === 'present' || d.kind === 'halfDay').map((d) => attRows.get(d.date)).filter(Boolean);
    const punct = punctualityPart(presentRows, graceSeconds);
    const mine = finishedOf.get(id) || [], open = unfinishedOf.get(id) || [];
    const steps = stepParts(mine, open);
    const myNotes = notesOf.get(id) || [];
    const evidence = [
      ...(u.productionSkillsAdded || []).filter((s) => s.at && new Date(s.at) >= winFrom && new Date(s.at) <= to).map((s) => ({ kind: 'skill', label: `New skill: ${s.skill}`, at: s.at })),
      ...(testsOf.get(id) || []).map((t) => ({ kind: 'training', label: 'Training test passed', at: t.finishedAt })),
    ];
    const parts = {
      attendance: { share: att.share, present: att.present, eligible: att.eligible, ...(att.why ? { why: att.why } : {}) },
      punctuality: punct,
      ...Object.fromEntries(['noDelay', 'accuracy', 'quality', 'productivity', 'taskCompletion'].map((k) => [k, steps[k]])),
      learning: learningPart(evidence),
    };
    for (const p of PARAMS.filter((x) => x.conduct)) {
      parts[p.key] = conductPart(settings.points[p.key], myNotes.filter((n) => n.type === p.conduct), settings.deductions);
    }
    const card = scorecard(parts, settings, { eligibleDays: att.eligible });
    const hadWork = mine.length || open.length || att.present > 0;
    if (u.isActive === false && !hadWork) continue; // left, nothing this month
    cards.push({
      user: u, card, presentDays: att.present, recorded, measuredSteps: steps.measuredSteps,
      hours: r1(mine.reduce((s, x) => s + x.hours, 0)), items: mine,
      ...(withDetail ? { unfinished: open, notes: myNotes, evidence } : {}),
    });
  }
  return { ...base, settings, cards };
}

// A person's department: the one set on them, else their role's (18 Nov 2026).
const NO_DEPT = 'none';
const deptOf = (u, depts) => { const d = departmentOf(u, depts); return d ? { _id: d._id, name: d.name } : null; };

const row = (c, depts) => ({
  person: c.user._id, name: nameOf(c.user), employeeId: c.user.employeeId, active: c.user.isActive !== false,
  department: deptOf(c.user, depts),
  score: c.card.score, grade: c.card.grade, reason: c.card.reason, earned: c.card.earned, possible: c.card.possible,
  groups: c.card.groups.map((g) => ({ key: g.key, points: g.points, max: g.max, possible: g.possible })),
  presentDays: c.presentDays, noAttendance: !c.recorded, measuredSteps: c.measuredSteps, hours: c.hours,
});

/**
 * Everyone's score for a month, filtered by department / search, sorted lowest
 * or highest first, paged here (the score must be worked out to sort by it).
 * userQuery narrows the people (Production's tab passes its own people).
 */
export async function scores(companyId, { month, from: fromQ, to: toQ, department = '', search = '', page = 1, limit = 20, sort = 'low' } = {}, { userQuery = {} } = {}) {
  const { month: m, from, to, fromDate, toDate, dates, settings, cards } = await monthCards(companyId, { month, from: fromQ, to: toQ }, { userQuery });
  const depts = await companyDepartments(companyId);
  let rows = cards.map((c) => row(c, depts));
  const departments = [...new Map(rows.filter((r) => r.department).map((r) => [String(r.department._id), r.department])).values()]
    .map((d) => ({ ...d, people: rows.filter((r) => String(r.department?._id) === String(d._id)).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const noDept = rows.filter((r) => !r.department).length;
  if (noDept) departments.push({ _id: NO_DEPT, name: 'No department', people: noDept });
  if (department === NO_DEPT) rows = rows.filter((r) => !r.department);
  else if (department) rows = rows.filter((r) => String(r.department?._id) === String(department));
  const s = String(search || '').trim().toLowerCase();
  if (s) rows = rows.filter((r) => r.name.toLowerCase().includes(s) || String(r.employeeId || '').toLowerCase().includes(s));
  // Scored people first (lowest or highest first), then not enough days yet.
  rows.sort((a, b) => {
    if ((a.score == null) !== (b.score == null)) return a.score == null ? 1 : -1;
    if (a.score == null) return a.name.localeCompare(b.name);
    return sort === 'high' ? b.score - a.score : a.score - b.score;
  });
  const total = rows.length;
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  return { month: m, from, to, fromDate, toDate, dates, settings, total, page: pg, limit: lim, people: rows.slice((pg - 1) * lim, pg * lim), departments };
}

/** Each person's team weights for the month: { teamId: [{ person, weight }] }, from their finished steps. */
async function teamWeights(companyId, cards) {
  const items = cards.flatMap((c) => c.items || []);
  const current = new Map();
  for (const t of await ProductionTeam.find({ company: companyId, isActive: true }).select('people').lean()) {
    for (const p of t.people || []) if (!current.has(String(p))) current.set(String(p), String(t._id));
  }
  const w = new Map();
  for (const it of items) {
    const team = it.team || current.get(it.person);
    if (!team) continue;
    if (!w.has(team)) w.set(team, new Map());
    w.get(team).set(it.person, (w.get(team).get(it.person) || 0) + it.hours);
  }
  return w;
}

/** Production's teams: the hours-weighted average of their people's scores (a cover counts for the team covered). */
export async function teamScores(companyId, { month, from: fromQ, to: toQ } = {}, { userQuery = {} } = {}) {
  const { month: m, from, to, cards } = await monthCards(companyId, { month, from: fromQ, to: toQ }, { userQuery });
  return { month: m, from, to, teams: await teamsFrom(companyId, cards, from, to) };
}

async function teamsFrom(companyId, cards, from, to) {
  const scoreOf = new Map(cards.map((c) => [String(c.user._id), c.card.score]));
  const weights = await teamWeights(companyId, cards);
  const teams = await ProductionTeam.find({ _id: { $in: [...weights.keys()] }, company: companyId }).select('name isActive').lean();
  return teams.map((tm) => {
    const members = [...weights.get(String(tm._id))].map(([person, weight]) => ({ person, weight, score: scoreOf.get(person) ?? null }));
    return { team: tm._id, name: tm.name, active: tm.isActive !== false, ...teamScore(members), hours: r1(members.reduce((s, x) => s + x.weight, 0)) };
  });
}

/** Scores keyed by person id and team id, for Manpower's cards (this month). */
export async function scoreMaps(companyId, { month, from: fromQ, to: toQ } = {}, { userQuery = {} } = {}) {
  const { from, to, cards } = await monthCards(companyId, { month, from: fromQ, to: toQ }, { userQuery });
  const people = Object.fromEntries(cards.map((c) => [String(c.user._id), { score: c.card.score, grade: c.card.grade, reason: c.card.reason }]));
  const teams = Object.fromEntries((await teamsFrom(companyId, cards, from, to)).map((t) => [String(t.team), { score: t.score, grade: t.grade, people: t.people }]));
  return { people, teams };
}

/**
 * One person: all 13 parts, the steps behind them (paged), the conduct notes of
 * the month, the learning evidence, and the last 6 months' scores.
 */
export async function personScore(companyId, personId, { month, from: fromQ, to: toQ, stepsPage = 1, stepsLimit = 20 } = {}, { userQuery = {} } = {}) {
  if (!mongoose.isValidObjectId(personId)) return null;
  const exists = await User.exists({ _id: personId, companyId, ...userQuery });
  if (!exists) return null;
  const { month: m, from, to, fromDate, toDate, dates, settings, cards } = await monthCards(companyId, { month, from: fromQ, to: toQ }, { userQuery: { ...userQuery, _id: oid(personId) }, withDetail: true });
  const u = await User.findOne({ _id: personId, companyId }).select('fullName username employeeId departmentId role').lean();
  const dept = deptOf(u, await companyDepartments(companyId));
  const c = cards[0] || null;
  const history = [];
  for (let k = 5; k >= 0; k--) {
    const hm = addMonths(m, -k);
    // History is always whole months, ending with the period's month.
    if (k === 0 && !dates) { history.push({ month: hm, score: c?.card.score ?? null, grade: c?.card.grade ?? null }); continue; }
    const h = (await monthCards(companyId, hm, { userQuery: { ...userQuery, _id: oid(personId) } })).cards[0];
    history.push({ month: hm, score: h?.card.score ?? null, grade: h?.card.grade ?? null });
  }
  return {
    person: u._id, name: nameOf(u), employeeId: u.employeeId, role: u.role, department: dept ? { _id: dept._id, name: dept.name } : null,
    month: m, from, to, fromDate, toDate, dates, settings, noAttendance: c ? !c.recorded : true,
    score: c?.card.score ?? null, grade: c?.card.grade ?? null, reason: c ? c.card.reason : 'days',
    earned: c?.card.earned ?? 0, possible: c?.card.possible ?? 0, groups: c?.card.groups || [], parts: c?.card.parts || [],
    presentDays: c?.presentDays ?? 0, measuredSteps: c?.measuredSteps ?? 0, hours: c?.hours ?? 0,
    notes: (c?.notes || []).map((n) => ({ ...n, attachment: n.attachment ? { name: n.attachment.name } : null })),
    evidence: c?.evidence || [],
    unfinished: (c?.unfinished || []).map((x) => ({ ...x.step, hours: r1(x.hours) })),
    history,
    ...pagedSteps(c?.items || [], stepsPage, stepsLimit),
  };
}

// The steps behind a score, newest first, one page at a time.
function pagedSteps(items, page, limit) {
  const all = items.map((i) => ({ ...i.run, hours: r1(i.hours) })).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { steps: all.slice((pg - 1) * lim, pg * lim), stepsTotal: all.length, stepsPage: pg, stepsLimit: lim };
}
