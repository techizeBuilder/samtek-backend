// Stage 5 (2026-11-12): crews on production steps, their hours and average time
// (efficiency was replaced by the score, services/score/, on 2026-11-13). The rules are in docs/client-features-2026-11/02e-assign-and-hours-logic.md;
// the arithmetic is in crewHoursCalc.js (pure, tested on its own).
//
// A step's crew closes by itself when the step finishes: every completion route
// sets the step's completedAt, and closeFinishedCrews() runs before any crew read
// or change, so none of those routes needed changing.
import mongoose from 'mongoose';
import StepCrewEntry from '../../models/StepCrewEntry.js';
import StepRun from '../../models/StepRun.js';
import LunchOverride from '../../models/LunchOverride.js';
import ProductionOrder from '../../models/ProductionOrder.js';
import ProductionTeam from '../../models/ProductionTeam.js';
import User from '../../models/User.js';
import Attendance from '../../models/Attendance.js';
import { AttendancePolicy } from '../../models/AttendancePolicy.js';
import { TeamError, eligiblePeopleQuery } from '../productionTeamService.js';
import { personStepHours, stepTotals, averageFor, lunchLines, indiaDateOf } from './crewHoursCalc.js';
import SalaryStructure from '../../models/SalaryStructure.js';
import { weeklyOffDaysFor } from '../payroll/payrollService.js';
import { personLabour, grossOf } from './labourCalc.js';
import { actionTime, fmtIndia } from '../../utils/actionTime.js';

/** A refusal with extra data for the screen (e.g. who would be moved). */
export class CrewError extends TeamError {
  constructor(status, message, details = {}) { super(status, message); this.details = details; }
}

const H = 3600 * 1000;
const DONE = ['QC Pending', 'Completed'];
const skillKey = (s) => String(s || '').trim().toLowerCase();
const nameOf = (u) => u?.fullName || u?.username || 'Unknown';
const idStr = (v) => String(v?._id || v || '');
const unitProcs = (order, unitIndex) => (unitIndex === 0 ? order.processes : order.extraUnits?.[unitIndex - 1]?.processes) || [];
const piecesOf = (order) => (order.orderKind === 'SubChildPart' ? Math.max(1, Number(order.orderQuantity) || 1) : 1);
const nextDate = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const prevDate = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
// A step can be worked on only when it's In-House and not finished.
const stepIsOpen = (step) => step && step.type === 'In-House' && ['Pending', 'In Progress'].includes(step.status);

export async function shiftsOf(companyId) {
  const p = await AttendancePolicy.findOne({ companyId }).select('shifts').lean();
  return Array.isArray(p?.shifts) ? p.shifts : [];
}

// Attendance rows per person between two India dates (a night shift's punch-in can
// fall on the day before, so one extra day is read on each side).
async function attendanceByPerson(personIds, fromDate, toDate) {
  const rows = await Attendance.find({ user: { $in: personIds }, date: { $gte: prevDate(fromDate), $lte: nextDate(toDate) } })
    .select('user date punchIn punchOut status').lean();
  const map = new Map();
  for (const r of rows) {
    const k = String(r.user);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ date: r.date, punchIn: r.punchIn, punchOut: r.punchOut, status: r.status });
  }
  return map;
}

async function overridesByPerson(companyId, personIds, fromDate, toDate) {
  const rows = await LunchOverride.find({ company: companyId, person: { $in: personIds }, date: { $gte: prevDate(fromDate), $lte: nextDate(toDate) } }).lean();
  const map = new Map();
  for (const r of rows) {
    const k = String(r.person);
    if (!map.has(k)) map.set(k, {});
    map.get(k)[r.date] = { kind: r.kind, from: r.from, to: r.to };
  }
  return map;
}

/** Hours for one step's crew over a window, per person and in total. */
async function crewHours(companyId, entries, window, now = Date.now()) {
  if (!entries.length || !window[0]) return { perPerson: [], totals: { personHours: 0, workingHours: 0, crewSize: 0 } };
  const persons = [...new Set(entries.map((e) => String(e.person?._id || e.person)))];
  const from = indiaDateOf(window[0]), to = indiaDateOf(window[1] ?? now);
  const [days, overrides, shifts] = await Promise.all([
    attendanceByPerson(persons, from, to), overridesByPerson(companyId, persons, from, to), shiftsOf(companyId),
  ]);
  const perPerson = persons.map((p) => {
    const stints = entries.filter((e) => String(e.person?._id || e.person) === p).map((e) => ({ joinedAt: e.joinedAt, leftAt: e.leftAt }));
    // Feature 8: someone covering an absent member works for that member's team.
    const teams = entries.filter((e) => String(e.person?._id || e.person) === p).map((e) => e.forTeam?._id || e.forTeam || e.team?._id || e.team).filter(Boolean);
    const r = personStepHours({ stints, window, days: days.get(p) || [], shifts, overrides: overrides.get(p) || {}, now });
    return { person: p, team: teams.at(-1) || null, ...r };
  });
  return { perPerson, totals: stepTotals(perPerson) };
}

// Stage 6 (2026-11-12): each person's labour on a run — hours per day × their
// rate that day (docs/client-features-2026-11/02f-labour-cost-logic.md §4–§5).
async function priceRun(companyId, perPerson) {
  const ids = perPerson.map((p) => p.person);
  const [salaries, weeklyOff] = await Promise.all([
    SalaryStructure.find({ employee: { $in: ids } }).select('employee basic hra otherAllowance').lean(),
    weeklyOffDaysFor(companyId),
  ]);
  const salaryOf = new Map(salaries.map((s) => [String(s.employee), s]));
  let labour = 0;
  const byPerson = perPerson.map((p) => {
    const days = (p.days || []).filter((d) => d.hours > 0).map((d) => ({ date: d.date, hours: d.hours, shiftHours: d.shiftHours ?? 8 }));
    const r = personLabour(days, salaryOf.get(String(p.person)) || null, weeklyOff);
    labour += r.labour;
    return { person: p.person, team: p.team || null, personHours: p.hours, days, labour: r.labour, missing: r.missing };
  });
  return { byPerson, labour: Math.round(labour * 100) / 100 };
}

// The window a run covers: from the step's start, or from the previous run's end
// when this is a QC rework round.
async function runWindowStart(order, unitIndex, stepIndex, step, before) {
  const prev = await StepRun.findOne({ order: order._id, unitIndex, stepIndex, completedAt: { $lt: before } }).sort({ completedAt: -1 }).lean();
  return { start: prev ? prev.completedAt : step.startedAt, rework: !!prev || (step.reworks?.length || 0) > 0 };
}

/** Saves the run for a step that just finished (once per completion). */
async function recordRun(companyId, order, unitIndex, stepIndex) {
  const step = unitProcs(order, unitIndex)[stepIndex];
  if (!step?.completedAt) return null;
  const completedAt = new Date(step.completedAt);
  if (await StepRun.exists({ order: order._id, unitIndex, stepIndex, completedAt })) return null;
  const { start, rework } = await runWindowStart(order, unitIndex, stepIndex, step, completedAt);
  if (!start) return null;
  const entries = await StepCrewEntry.find({
    order: order._id, unitIndex, stepIndex, joinedAt: { $lt: completedAt },
    $or: [{ leftAt: null }, { leftAt: { $gt: start } }],
  }).lean();
  if (!entries.length) return null;
  const { perPerson, totals } = await crewHours(companyId, entries, [start, completedAt]);
  if (!(totals.personHours > 0)) return null;
  const byTeam = new Map();
  for (const p of perPerson) if (p.team) byTeam.set(String(p.team), (byTeam.get(String(p.team)) || 0) + p.hours);
  // Stage 6 (2026-11-12): priced now, once, with the salary in force.
  const priced = await priceRun(companyId, perPerson);
  try {
    return await StepRun.create({
      company: companyId, partCode: order.machineCode, partName: order.machineName, stepName: step.step, orderKind: order.orderKind,
      // A batch redo is for the pieces QC sent back (13 Nov 2026), not the whole batch.
      order: order._id, orderNo: order.orderId, unitIndex, stepIndex, pieces: (rework && Number(step.reworks?.[step.reworks.length - 1]?.qty)) || piecesOf(order),
      personHours: totals.personHours, workingHours: totals.workingHours, crewSize: totals.crewSize,
      clockHours: (completedAt - new Date(start)) / H, plannedHours: step.plannedHours ?? null, rework,
      startedAt: start, completedAt,
      byTeam: [...byTeam].map(([team, personHours]) => ({ team, personHours })),
      byPerson: priced.byPerson,
      labour: priced.labour,
    });
  } catch (e) {
    if (e?.code === 11000) return null; // saved by a request running at the same moment
    throw e;
  }
}

/**
 * Closes the crew of every step that has finished since it was put on, and saves
 * those runs. Runs before every crew read or change.
 */
export async function closeFinishedCrews(companyId, { orderId } = {}) {
  const open = await StepCrewEntry.find({ company: companyId, leftAt: null, ...(orderId ? { order: orderId } : {}) }).lean();
  if (!open.length) return 0;
  const orders = new Map((await ProductionOrder.find({ _id: { $in: [...new Set(open.map((e) => String(e.order)))] } })
    .select('orderId orderKind machineCode machineName orderQuantity processes extraUnits').lean()).map((o) => [String(o._id), o]));
  const finished = new Map();
  for (const e of open) {
    const order = orders.get(String(e.order));
    const step = order && unitProcs(order, e.unitIndex)[e.stepIndex];
    if (!order || !step) {
      await StepCrewEntry.updateOne({ _id: e._id }, { $set: { leftAt: new Date() } }); // its order or step is gone
      continue;
    }
    if (DONE.includes(step.status) && step.completedAt) {
      // Joined after the finish (a back-dated finish, feature 7): closed with no hours,
      // never left open on a finished step.
      const left = new Date(step.completedAt) >= new Date(e.joinedAt) ? step.completedAt : e.joinedAt;
      await StepCrewEntry.updateOne({ _id: e._id, leftAt: null }, { $set: { leftAt: left } });
      finished.set(`${e.order}|${e.unitIndex}|${e.stepIndex}`, { order, unitIndex: e.unitIndex, stepIndex: e.stepIndex });
    }
  }
  for (const f of finished.values()) await recordRun(companyId, f.order, f.unitIndex, f.stepIndex);
  return finished.size;
}

// Each person's active team.
async function activeTeamsOf(companyId, personIds) {
  const teams = await ProductionTeam.find({ company: companyId, isActive: true, people: { $in: personIds } }).select('name people').lean();
  const map = new Map();
  for (const t of teams) for (const p of t.people || []) map.set(String(p), { _id: t._id, name: t.name });
  return map;
}

// Today's attendance for these people: 'present', 'absent' or 'not-in'.
async function todayAttendance(personIds) {
  const today = indiaDateOf(new Date());
  const rows = await Attendance.find({ user: { $in: personIds }, date: today }).select('user status punchIn punchOut').lean();
  const map = new Map(rows.map((r) => [String(r.user), r]));
  return (id) => {
    const r = map.get(String(id));
    if (!r) return { state: 'not-in', label: 'Not punched in' };
    if (r.punchIn && !['ABSENT', 'WEEKLY_OFF'].includes(r.status)) return { state: 'present', label: 'Present', since: r.punchIn, out: r.punchOut || null };
    return { state: 'absent', label: r.status === 'WEEKLY_OFF' ? 'Weekly off' : 'Absent' };
  };
}

/**
 * Puts a whole team, or chosen people, on a step. The controller has already run
 * the step's material / at-Store gates. Anyone still on another open step is
 * refused (409, with where they are) unless confirmMove, which moves them.
 * legacy: the old "assign team" route — skills aren't checked.
 */
export async function addToCrew(user, order, unitIndex, stepIndex, { teamId, people, teams = null, include = null, covers = null, confirmMove = false, legacy = false, since = null } = {}) {
  const companyId = user.companyId;
  await closeFinishedCrews(companyId, {});
  const procs = unitProcs(order, unitIndex);
  const step = procs[stepIndex];
  if (!stepIsOpen(step)) {
    if (legacy) return { added: [], alreadyOn: [], moved: [], skipped: [], absentWarnings: [], laterThanAsked: [] }; // the old route only set the team
    throw new CrewError(400, `${step?.step || 'This step'} isn't open for work (it must be an In-House step that isn't finished).`);
  }
  // Feature 7 (2026-11-12): "working since" — someone added late to a running step.
  let sinceT = null;
  if (since != null && since !== '') {
    if (step.status !== 'In Progress') throw new CrewError(400, `Working since is only for a step that has started. ${step.step} hasn't: Start sets the time for everyone on it.`);
    sinceT = actionTime(since, { notBefore: roundStartOf(step), notBeforeWhy: `${step.step} started`, what: 'Working since' });
  }
  const checkSkill = !legacy && !!step.category; // old fixed-pipeline steps have no template step to match

  let ids = [];
  let team = null;
  // Feature 8 (2026-11-12): whole teams, with the members ticked to work and a
  // replacement for absent ones — a temporary team for this step only.
  let picked = null;
  const coverOf = new Map(); // replacement id → { for: absent member id, forTeam }
  if (Array.isArray(teams) && teams.length) {
    const tIds = [...new Set(teams.map(idStr).filter(Boolean))];
    if (tIds.length > 5 || tIds.some((t) => !mongoose.isValidObjectId(t))) throw new CrewError(400, 'Pick up to 5 teams.');
    picked = await ProductionTeam.find({ _id: { $in: tIds }, company: companyId, isActive: true }).lean();
    if (picked.length !== tIds.length) throw new CrewError(400, "A team picked isn't available. It may have been retired; pick another.");
    const memberTeam = new Map();
    for (const t of picked) for (const p of t.people || []) memberTeam.set(String(p), t);
    const inc = [...new Set((Array.isArray(include) ? include : []).map(idStr).filter(Boolean))];
    if (inc.some((id) => !memberTeam.has(id))) throw new CrewError(400, "Someone ticked isn't in the teams picked.");
    const seen = new Set(inc), forSeen = new Set();
    for (const c of Array.isArray(covers) ? covers : []) {
      const f = idStr(c?.for), p = idStr(c?.person);
      if (!mongoose.isValidObjectId(f) || !mongoose.isValidObjectId(p)) throw new CrewError(400, 'Each replacement needs the member they cover and the person covering.');
      if (!memberTeam.has(f)) throw new CrewError(400, 'A replacement can only cover a member of the teams picked.');
      if (inc.includes(f)) throw new CrewError(400, "That member is ticked to work, so they don't need a replacement.");
      if (forSeen.has(f)) throw new CrewError(400, 'Each member can have one replacement.');
      if (memberTeam.has(p)) throw new CrewError(400, 'A replacement must come from outside the teams picked. Tick that member instead.');
      if (seen.has(p)) throw new CrewError(400, 'The same person is picked twice.');
      forSeen.add(f); seen.add(p);
      coverOf.set(p, { for: f, forTeam: memberTeam.get(f) });
    }
    ids = [...inc, ...coverOf.keys()];
    if (!ids.length) throw new CrewError(400, 'Tick at least one member, or pick a replacement.');
  } else if (teamId) {
    team = mongoose.isValidObjectId(teamId) && await ProductionTeam.findOne({ _id: teamId, company: companyId, isActive: true }).lean();
    if (!team) throw new CrewError(400, "That team isn't available. It may have been retired; pick another.");
    ids = (team.people || []).map(String);
    if (!ids.length && !legacy) throw new CrewError(400, `${team.name} has no people yet.`);
  } else {
    ids = [...new Set((Array.isArray(people) ? people : []).map(idStr).filter(Boolean))];
    if (!ids.length) throw new CrewError(400, 'Pick a team or at least one person.');
  }
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new CrewError(400, 'Someone picked was not found');

  const eligibleQ = await eligiblePeopleQuery(companyId);
  const coveredIds = [...coverOf.values()].map((c) => c.for);
  const persons = await User.find({ _id: { $in: [...ids, ...coveredIds] }, companyId }).select('fullName username productionSkills').lean();
  const eligible = new Set((await User.find({ _id: { $in: ids }, ...eligibleQ }).distinct('_id')).map(String));
  const byId = new Map(persons.map((p) => [String(p._id), p]));
  const hasSkill = (p) => (p?.productionSkills || []).some((s) => skillKey(s) === skillKey(step.step));
  const teamOf = await activeTeamsOf(companyId, ids);

  let addIds;
  if (picked) {
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) throw new CrewError(400, 'Someone picked was not found');
      if (!eligible.has(id)) throw new CrewError(400, `${nameOf(p)} isn't in the Production department, or is inactive.`);
      if (coverOf.has(id)) { // a replacement: the same rules as adding one person
        if (!teamOf.has(id)) throw new CrewError(400, `${nameOf(p)} isn't in a team yet. Add them to a team on Manpower first.`);
        if (checkSkill && !hasSkill(p)) throw new CrewError(400, `${nameOf(p)} doesn't have the "${step.step}" skill, so can't replace ${nameOf(byId.get(coverOf.get(id).for))}.`);
      }
    }
    if (checkSkill && !ids.some((id) => hasSkill(byId.get(id)))) {
      throw new CrewError(400, `No one on this crew has the "${step.step}" skill. Tick someone who has it, or pick a replacement who does.`);
    }
    addIds = ids;
  } else if (team) {
    addIds = ids.filter((id) => eligible.has(id)); // someone moved out of Production or deactivated is skipped
    if (!addIds.length && !legacy) throw new CrewError(400, `No one in ${team.name} can be put on a step right now (moved out of Production or inactive).`);
    if (checkSkill && !addIds.some((id) => hasSkill(byId.get(id)))) {
      throw new CrewError(400, `No one in ${team.name} has the "${step.step}" skill. Give someone the skill on Manpower, or pick people who have it.`);
    }
  } else {
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) throw new CrewError(400, 'Someone picked was not found');
      if (!eligible.has(id)) throw new CrewError(400, `${nameOf(p)} isn't in the Production department, or is inactive.`);
      if (!teamOf.has(id)) throw new CrewError(400, `${nameOf(p)} isn't in a team yet. Add them to a team on Manpower first.`);
      if (checkSkill && !hasSkill(p)) throw new CrewError(400, `${nameOf(p)} doesn't have the "${step.step}" skill.`);
    }
    addIds = ids;
  }

  // Already on this step: nothing to do. On another open step: move, after a confirm.
  const openRows = await StepCrewEntry.find({ company: companyId, person: { $in: addIds }, leftAt: null }).lean();
  const here = (e) => String(e.order) === String(order._id) && e.unitIndex === unitIndex && e.stepIndex === stepIndex;
  const already = new Set(openRows.filter(here).map((e) => String(e.person)));
  // Feature 9 (2026-11-12): planning is free — a person can be planned on many
  // steps. Only putting them on a RUNNING step moves them, and only off another
  // running step (they work one running step at a time).
  const elsewhere = step.status === 'In Progress' ? await onRunningSteps(openRows.filter((e) => !here(e))) : [];
  if (elsewhere.length && !confirmMove) {
    const where = elsewhere.map((e) => `${nameOf(byId.get(String(e.person)))} is on ${e.orderNo} · ${e.stepName}${e.unitIndex > 0 ? ` (unit ${e.unitIndex + 1})` : ''}`).join('; ');
    throw new CrewError(409, `${where}. Move them here?`, {
      moves: elsewhere.map((e) => ({ person: e.person, name: nameOf(byId.get(String(e.person))), orderNo: e.orderNo, partName: e.partName, unit: e.unitIndex + 1, stepName: e.stepName, since: e.joinedAt })),
    });
  }
  const now = new Date();
  const at = sinceT?.at || now;
  if (elsewhere.length) {
    // A move with "working since": they left the old step at that same time.
    for (const e of elsewhere) {
      if (new Date(e.joinedAt) > at) {
        throw new CrewError(400, `${nameOf(byId.get(String(e.person)))} joined ${e.orderNo} · ${e.stepName} at ${fmtIndia(e.joinedAt)}, after that time. Pick a later "working since".`);
      }
    }
    await StepCrewEntry.updateMany({ _id: { $in: elsewhere.map((e) => e._id) }, leftAt: null },
      { $set: { leftAt: at, removedBy: user._id, leftEnteredAt: sinceT?.backdated ? now : null } });
  }

  // The step's own team: the one it already has, else the team picked, else the first person's.
  const stepTeam = step.assignedTeam ? String(step.assignedTeam)
    : team ? String(team._id) : picked ? String(picked[0]._id) : String(teamOf.get(addIds[0])?._id || '');
  const toAdd = addIds.filter((id) => !already.has(id));
  // Back-dated: no one is counted twice — from when they left their last step, if later.
  const joinOf = new Map();
  const laterThanAsked = [];
  for (const id of toAdd) {
    const j = sinceT?.backdated ? await notOverlapping(companyId, id, at, null, now) : at;
    joinOf.set(id, j);
    if (j > at) laterThanAsked.push({ person: id, name: nameOf(byId.get(id)), from: j });
  }
  if (toAdd.length) {
    await StepCrewEntry.insertMany(toAdd.map((id) => {
      const t = teamOf.get(id);
      const cover = coverOf.get(id); // feature 8: filling an absent member's place
      return {
        company: companyId, order: order._id, orderNo: order.orderId, orderKind: order.orderKind,
        partCode: order.machineCode, partName: order.machineName, unitIndex, stepIndex, stepName: step.step,
        person: id, team: t?._id || null, borrowed: cover ? true : !!(t && stepTeam && String(t._id) !== stepTeam),
        joinedAt: joinOf.get(id), joinedEnteredAt: sinceT?.backdated ? now : null, addedBy: user._id, rework: (step.reworks?.length || 0) > 0,
        ...(cover ? { coveringFor: cover.for, coveringForName: nameOf(byId.get(cover.for)), forTeam: cover.forTeam._id } : {}),
      };
    }));
  }
  if (!step.assignedTeam && stepTeam) {
    await ProductionOrder.updateOne({ _id: order._id }, { $set: { [unitIndex === 0 ? `processes.${stepIndex}.assignedTeam` : `extraUnits.${unitIndex - 1}.processes.${stepIndex}.assignedTeam`]: stepTeam } });
  }

  const att = await todayAttendance(toAdd);
  return {
    added: toAdd.map((id) => ({ person: id, name: nameOf(byId.get(id)) })),
    alreadyOn: [...already].map((id) => ({ person: id, name: nameOf(byId.get(id)) })),
    moved: elsewhere.map((e) => ({ person: e.person, name: nameOf(byId.get(String(e.person))), from: `${e.orderNo} · ${e.stepName}` })),
    skipped: team ? ids.filter((id) => !eligible.has(id)).map((id) => ({ person: id, name: nameOf(byId.get(id)) })) : [],
    absentWarnings: toAdd.filter((id) => att(id).state !== 'present').map((id) => ({ person: id, name: nameOf(byId.get(id)), today: att(id).label })),
    laterThanAsked,
    covered: [...coverOf].map(([p, c]) => ({ person: p, name: nameOf(byId.get(p)), for: nameOf(byId.get(c.for)), team: c.forTeam.name })),
  };
}

// Feature 7: the time a step's current round began — its start, or the last
// QC submission when this is a rework round after a rejection.
function roundStartOf(step) {
  const s = step?.startedAt ? new Date(step.startedAt) : null;
  const c = step?.reworks?.length && step.completedAt ? new Date(step.completedAt) : null;
  if (s && c) return c > s ? c : s;
  return s || c || null;
}

// The earliest time from `at` on that a person can be counted without paying the
// same hour twice: after the end of any other stint of theirs that overlaps
// [at, until) — open entries (planned, feature 9) never count.
async function notOverlapping(companyId, personId, at, excludeId = null, until = null) {
  const last = await StepCrewEntry.findOne({
    company: companyId, person: personId, leftAt: { $gt: at },
    ...(until ? { joinedAt: { $lt: until } } : {}),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).sort({ leftAt: -1 }).select('leftAt').lean();
  return last && new Date(last.leftAt) > at ? new Date(last.leftAt) : at;
}

// Feature 9: which of these open entries are on a step that is running now.
async function onRunningSteps(entries) {
  if (!entries.length) return [];
  const orders = new Map((await ProductionOrder.find({ _id: { $in: [...new Set(entries.map((e) => String(e.order)))] } })
    .select('processes extraUnits').lean()).map((o) => [String(o._id), o]));
  return entries.filter((e) => {
    const o = orders.get(String(e.order));
    return o && unitProcs(o, e.unitIndex)[e.stepIndex]?.status === 'In Progress';
  });
}

/**
 * Start (features 7 and 9): everyone on the crew counts from the start time.
 * - Planned before it: moved forward to the start (they worked from then).
 * - Put on after a back-dated start: moved back to it, or to when they left
 *   another step, if later; joinedEnteredAt keeps when they were really put on.
 */
export async function alignCrewToStart(order, unitIndex, stepIndex, at) {
  const companyId = order.company;
  const open = await StepCrewEntry.find({ order: order._id, unitIndex, stepIndex, leftAt: null }).lean();
  await creditCurrentTeams(order, unitIndex, stepIndex, open);
  let moved = 0;
  for (const e of open) {
    const joined = new Date(e.joinedAt);
    if (joined < at) {
      await StepCrewEntry.updateOne({ _id: e._id }, { $set: { joinedAt: at } });
      continue;
    }
    if (joined > at) {
      const j = await notOverlapping(companyId, e.person, at, e._id, joined);
      if (j >= joined) continue;
      await StepCrewEntry.updateOne({ _id: e._id }, { $set: { joinedAt: j, joinedEnteredAt: e.joinedEnteredAt || e.joinedAt } });
      moved += 1;
    }
  }
  return moved;
}

/**
 * At Start (2026-11-14): everyone planned on the step counts under the team they
 * are in NOW. A team retired, or a person moved to another team, after the step
 * was planned would otherwise keep the hours (and the team score). A cover keeps
 * counting for the team it covers (forTeam is untouched). If the step's own team
 * label is a retired team, it becomes the crew's current team.
 */
async function creditCurrentTeams(order, unitIndex, stepIndex, open) {
  if (!open.length) return;
  const current = await activeTeamsOf(order.company, open.map((e) => e.person));
  const step = unitProcs(order, unitIndex)[stepIndex];
  let stepTeam = step?.assignedTeam ? String(step.assignedTeam?._id || step.assignedTeam) : null;
  if (stepTeam && !(await ProductionTeam.exists({ _id: stepTeam, isActive: true }))) {
    const first = open.filter((e) => !e.coveringFor).map((e) => current.get(String(e.person))).find(Boolean);
    if (first) {
      stepTeam = String(first._id);
      const path = unitIndex === 0 ? `processes.${stepIndex}.assignedTeam` : `extraUnits.${unitIndex - 1}.processes.${stepIndex}.assignedTeam`;
      await ProductionOrder.updateOne({ _id: order._id }, { $set: { [path]: first._id } });
      if (step) step.assignedTeam = first._id; // the reply shows it too
    }
  }
  for (const e of open) {
    if (e.coveringFor) continue;
    const now = current.get(String(e.person));
    const team = now ? String(now._id) : null;
    const borrowed = !!(team && stepTeam && team !== stepTeam);
    if (String(e.team || '') !== String(team || '') || !!e.borrowed !== borrowed) {
      await StepCrewEntry.updateOne({ _id: e._id }, { $set: { team: team || null, borrowed } });
    }
  }
}

/**
 * Feature 9: people planned on this step who are still working on another
 * running step — Start asks to move them.
 */
export async function crewStartConflicts(order, unitIndex, stepIndex) {
  const here = await StepCrewEntry.find({ order: order._id, unitIndex, stepIndex, leftAt: null }).populate('person', 'fullName username').lean();
  if (!here.length) return [];
  const nameBy = new Map(here.map((e) => [String(e.person?._id), nameOf(e.person)]));
  const others = await StepCrewEntry.find({
    company: order.company, person: { $in: here.map((e) => e.person?._id).filter(Boolean) }, leftAt: null, _id: { $nin: here.map((e) => e._id) },
  }).lean();
  return (await onRunningSteps(others)).map((e) => ({
    entryId: e._id, person: e.person, name: nameBy.get(String(e.person)), orderNo: e.orderNo, partName: e.partName,
    unit: e.unitIndex + 1, stepName: e.stepName, joinedAt: e.joinedAt,
  }));
}

/** Feature 9: the confirmed moves at Start — their other running step ends at the start time. */
export async function closeStartConflicts(conflicts, at, user) {
  for (const c of conflicts) {
    const left = new Date(c.joinedAt) > at ? new Date(c.joinedAt) : at;
    await StepCrewEntry.updateOne({ _id: c.entryId, leftAt: null }, { $set: { leftAt: left, removedBy: user._id } });
  }
}

/** Feature 9: who on the crew isn't present today — a warning after Start. */
export async function crewAbsentToday(order, unitIndex, stepIndex) {
  const here = await StepCrewEntry.find({ order: order._id, unitIndex, stepIndex, leftAt: null }).populate('person', 'fullName username').lean();
  const att = await todayAttendance(here.map((e) => e.person?._id).filter(Boolean));
  return here.filter((e) => e.person && att(e.person._id).state !== 'present').map((e) => ({ person: e.person._id, name: nameOf(e.person), today: att(e.person._id).label }));
}

/**
 * People who could be put on this step: Production people in a team, searched on
 * the server, each with their team, skills (and whether they have this step's),
 * today's attendance and the step they're on now.
 */
export async function crewCandidates(companyId, order, unitIndex, stepIndex, { search = '', limit = 20 } = {}) {
  await closeFinishedCrews(companyId, {});
  const step = unitProcs(order, unitIndex)[stepIndex];
  if (!step) throw new CrewError(404, 'Step not found');
  const q = await eligiblePeopleQuery(companyId);
  const s = String(search || '').trim();
  if (s) {
    const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ fullName: re }, { employeeId: re }, { deviceCode: re }, { username: re }];
  }
  const people = await User.find(q).select('fullName username employeeId canLogin productionSkills').sort({ fullName: 1 })
    .limit(Math.min(50, Math.max(1, parseInt(limit, 10) || 20))).lean();
  return describePeople(companyId, order, unitIndex, stepIndex, people);
}

// Each person as the crew pickers show them: team, skill for this step, today's
// attendance, and whether they're on this step or another one.
async function describePeople(companyId, order, unitIndex, stepIndex, people) {
  const step = unitProcs(order, unitIndex)[stepIndex];
  const ids = people.map((p) => p._id);
  const eligibleQ = await eligiblePeopleQuery(companyId);
  const [teamOf, att, open, eligibleIds] = await Promise.all([
    activeTeamsOf(companyId, ids), todayAttendance(ids),
    StepCrewEntry.find({ company: companyId, person: { $in: ids }, leftAt: null }).lean(),
    User.find({ _id: { $in: ids }, ...eligibleQ }).distinct('_id'),
  ]);
  const eligible = new Set(eligibleIds.map(String));
  // Feature 9: a person can be planned on many steps; "working" is the running one.
  const isHere = (x) => String(x.order) === String(order._id) && x.unitIndex === unitIndex && x.stepIndex === stepIndex;
  const running = new Set((await onRunningSteps(open)).map((x) => String(x._id)));
  const byPerson = new Map();
  for (const x of open) { const k = String(x.person); if (!byPerson.has(k)) byPerson.set(k, []); byPerson.get(k).push(x); }
  const stepTeam = step?.assignedTeam ? String(step.assignedTeam) : null;
  return people.map((p) => {
    const mine = byPerson.get(String(p._id)) || [];
    const here = mine.some(isHere);
    const e = mine.find((x) => !isHere(x) && running.has(String(x._id))) || null;
    const plannedElsewhere = mine.filter((x) => !isHere(x) && !running.has(String(x._id))).length;
    const t = teamOf.get(String(p._id)) || null;
    return {
      _id: p._id, name: nameOf(p), employeeId: p.employeeId, canLogin: p.canLogin !== false,
      team: t, borrowed: !!(t && stepTeam && String(t._id) !== stepTeam),
      skills: p.productionSkills || [],
      hasSkill: !step?.category || (p.productionSkills || []).some((x) => skillKey(x) === skillKey(step.step)),
      today: att(p._id),
      eligible: eligible.has(String(p._id)),
      onThisStep: !!here,
      working: e ? { orderNo: e.orderNo, partName: e.partName, unit: e.unitIndex + 1, stepName: e.stepName } : null,
      plannedElsewhere,
    };
  });
}

/**
 * Feature 8 (2026-11-12): the members of the teams picked in "Whole team", each
 * described, so Production sees who's absent today and can replace them.
 */
export async function teamMembersView(companyId, order, unitIndex, stepIndex, teamIds) {
  await closeFinishedCrews(companyId, {});
  if (!unitProcs(order, unitIndex)[stepIndex]) throw new CrewError(404, 'Step not found');
  const ids = [...new Set(String(teamIds || '').split(',').map((s) => s.trim()).filter((s) => mongoose.isValidObjectId(s)))].slice(0, 5);
  const teams = await ProductionTeam.find({ _id: { $in: ids }, company: companyId, isActive: true }).select('name people supervisorPerson').lean();
  const users = await User.find({ _id: { $in: teams.flatMap((t) => t.people || []) }, companyId }).select('fullName username employeeId canLogin productionSkills').lean();
  const described = new Map((await describePeople(companyId, order, unitIndex, stepIndex, users)).map((d) => [String(d._id), d]));
  return teams.map((t) => ({
    _id: t._id, name: t.name,
    members: (t.people || []).map((id) => described.get(String(id))).filter(Boolean)
      .map((m) => ({ ...m, supervisor: String(m._id) === String(t.supervisorPerson) })),
  }));
}

/**
 * Takes one person off a step (or everyone, when personId is null). leftAt
 * (feature 7): when they really left — now, or an earlier time for one person.
 */
export async function takeOffCrew(user, order, unitIndex, stepIndex, personId = null, { leftAt = null } = {}) {
  await closeFinishedCrews(user.companyId, { orderId: order._id });
  const q = { order: order._id, unitIndex, stepIndex, leftAt: null, ...(personId ? { person: personId } : {}) };
  const entry = personId ? await StepCrewEntry.findOne(q).populate('person', 'fullName username').lean() : null;
  if (personId && !entry) throw new CrewError(404, "That person isn't on this step.");
  // Feature 9: on a step that hasn't started they were only planned — nothing
  // worked, so the plan is simply removed.
  const step = unitProcs(order, unitIndex)[stepIndex];
  if (step && step.status === 'Pending' && !step.startedAt) {
    const d = await StepCrewEntry.deleteMany(q);
    return { takenOff: d.deletedCount, planned: true };
  }
  let t = { at: new Date(), backdated: false };
  if (entry && leftAt != null && leftAt !== '') {
    t = actionTime(leftAt, { notBefore: entry.joinedAt, notBeforeWhy: `${nameOf(entry.person)} joined`, what: 'Left at' });
  }
  const r = await StepCrewEntry.updateMany(q, { $set: { leftAt: t.at, removedBy: user._id, leftEnteredAt: t.backdated ? new Date() : null } });
  return { takenOff: r.modifiedCount };
}

export async function setPlannedHours(order, unitIndex, stepIndex, hours) {
  const step = unitProcs(order, unitIndex)[stepIndex];
  if (!step) throw new CrewError(404, 'Step not found');
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 1000) throw new CrewError(400, 'Planned hours must be a number above 0 (up to 1000).');
  if (step.status === 'Completed') throw new CrewError(400, 'This step is already completed.');
  const path = unitIndex === 0 ? `processes.${stepIndex}.plannedHours` : `extraUnits.${unitIndex - 1}.processes.${stepIndex}.plannedHours`;
  await ProductionOrder.updateOne({ _id: order._id }, { $set: { [path]: Math.round(h * 100) / 100 } });
  return { plannedHours: Math.round(h * 100) / 100 };
}

/** Everything the step's crew panel shows. */
export async function stepCrewView(user, order, unitIndex, stepIndex, { people, until = null } = {}) {
  const companyId = user.companyId;
  await closeFinishedCrews(companyId, { orderId: order._id });
  const fresh = await ProductionOrder.findById(order._id).select('orderId orderKind machineCode machineName orderQuantity processes extraUnits').lean();
  const step = unitProcs(fresh, unitIndex)[stepIndex];
  if (!step) throw new CrewError(404, 'Step not found');
  const entries = await StepCrewEntry.find({ order: order._id, unitIndex, stepIndex })
    .populate('person', 'fullName username employeeId canLogin productionSkills').populate('team', 'name').populate('forTeam', 'name').sort({ joinedAt: 1 }).lean();
  const att = await todayAttendance(entries.map((e) => e.person?._id).filter(Boolean));

  const done = DONE.includes(step.status) && step.completedAt;
  // Feature 7: about to complete with an earlier "finished at" — the hours and the
  // lunch list end there, not now.
  const untilT = !done && until ? new Date(until) : null;
  const useUntil = untilT && !Number.isNaN(untilT.getTime()) && untilT < new Date() && (!step.startedAt || untilT >= new Date(step.startedAt));
  const end = done ? new Date(step.completedAt) : useUntil ? untilT : new Date();
  // A finished step: from the previous run's end (or its start), up to this completion.
  const { start } = step.startedAt ? await runWindowStart(fresh, unitIndex, stepIndex, step, end) : { start: null };
  const windowEntries = start ? entries.filter((e) => new Date(e.joinedAt) < end && (!e.leftAt || new Date(e.leftAt) > new Date(start))) : [];
  const hours = start ? await crewHours(companyId, windowEntries, [start, end]) : { perPerson: [], totals: { personHours: 0, workingHours: 0, crewSize: 0 } };

  const runs = await StepRun.find({ company: companyId, partCode: fresh.machineCode, stepName: step.step }).select('personHours pieces crewSize rework completedAt').lean();
  const open = entries.filter((e) => !e.leftAt);
  // A QC redo round (2026-11-13): the estimate is for the pieces sent back, not the batch.
  const redo = (step.reworks?.length || 0) > 0 && ['Pending', 'In Progress'].includes(step.status);
  const pieces = (redo && Number(step.reworks[step.reworks.length - 1]?.qty)) || piecesOf(fresh);
  const maxN = Math.max(4, open.length, Number(people) || 0);
  const averages = Array.from({ length: maxN }, (_, i) => ({ people: i + 1, ...averageFor(runs, i + 1, pieces) }));

  let lunch = [];
  if (start && !done && open.length) {
    const persons = [...new Set(open.map((e) => String(e.person._id)))];
    const from = indiaDateOf(start), to = indiaDateOf(end);
    const [days, overrides, shifts] = await Promise.all([attendanceByPerson(persons, from, to), overridesByPerson(companyId, persons, from, to), shiftsOf(companyId)]);
    for (const p of persons) {
      const stints = windowEntries.filter((e) => String(e.person._id) === p).map((e) => ({ joinedAt: e.joinedAt, leftAt: e.leftAt }));
      const person = open.find((e) => String(e.person._id) === p).person;
      for (const l of lunchLines({ stints, window: [start, end], days: days.get(p) || [], shifts, overrides: overrides.get(p) || {} })) {
        lunch.push({ person: p, name: nameOf(person), ...l });
      }
    }
    // Someone who left the step earlier is listed for the days they worked on it.
    for (const e of windowEntries.filter((x) => x.leftAt && !persons.includes(String(x.person._id)))) {
      const p = String(e.person._id);
      if (lunch.some((l) => l.person === p)) continue;
      const days = await attendanceByPerson([p], indiaDateOf(start), indiaDateOf(end));
      const overrides = await overridesByPerson(companyId, [p], indiaDateOf(start), indiaDateOf(end));
      const stints = windowEntries.filter((x) => String(x.person._id) === p).map((x) => ({ joinedAt: x.joinedAt, leftAt: x.leftAt }));
      for (const l of lunchLines({ stints, window: [start, end], days: days.get(p) || [], shifts: await shiftsOf(companyId), overrides: overrides.get(p) || {} })) {
        lunch.push({ person: p, name: nameOf(e.person), ...l });
      }
    }
  }

  const hoursOf = new Map(hours.perPerson.map((p) => [p.person, p.hours]));
  const row = (e) => ({
    _id: e._id, person: e.person?._id, name: nameOf(e.person), employeeId: e.person?.employeeId,
    canLogin: e.person?.canLogin !== false, team: e.team ? { _id: e.team._id, name: e.team.name } : null,
    borrowed: e.borrowed, joinedAt: e.joinedAt, leftAt: e.leftAt, rework: e.rework,
    covering: e.coveringFor ? { name: e.coveringForName, team: e.forTeam?.name || '' } : null,
    joinedEnteredAt: e.joinedEnteredAt || null, leftEnteredAt: e.leftEnteredAt || null,
    hasSkill: (e.person?.productionSkills || []).some((s) => skillKey(s) === skillKey(step.step)),
    today: att(e.person?._id),
  });
  return {
    step: {
      name: step.step, category: step.category, type: step.type, status: step.status, plannedHours: step.plannedHours ?? null,
      startedAt: step.startedAt, completedAt: step.completedAt, lunchConfirmedAt: step.lunchConfirmedAt || null,
      startedEnteredAt: step.startedEnteredAt || null, startedEnteredBy: step.startedEnteredBy || '',
      completedEnteredAt: step.completedEnteredAt || null, completedEnteredBy: step.completedEnteredBy || '',
      roundStart: roundStartOf(step),
      lunchConfirmedByName: step.lunchConfirmedByName || '', pieces, redo, open: stepIsOpen(step),
    },
    crew: open.map(row),
    history: entries.filter((e) => e.leftAt).map(row),
    hours: {
      personHours: hours.totals.personHours, workingHours: hours.totals.workingHours, crewSize: hours.totals.crewSize,
      perPerson: [...hoursOf].map(([person, h]) => ({ person, hours: h })),
    },
    averages,
    runCount: runs.filter((r) => !r.rework).length,
    lunch,
  };
}

/**
 * Production confirms the lunches inside a step before completing it: usual
 * time (nothing stored), later (with the real times) or none.
 */
export async function saveLunchAnswers(user, order, unitIndex, stepIndex, answers = []) {
  const companyId = user.companyId;
  const step = unitProcs(order, unitIndex)[stepIndex];
  if (!step) throw new CrewError(404, 'Step not found');
  const onStep = new Set((await StepCrewEntry.find({ order: order._id, unitIndex, stepIndex }).distinct('person')).map(String));
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const a of Array.isArray(answers) ? answers : []) {
    const person = idStr(a.person);
    if (!onStep.has(person)) throw new CrewError(400, 'Lunch can only be confirmed for people who worked on this step.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || ''))) throw new CrewError(400, 'Each lunch needs its date.');
    if (!['usual', 'later', 'none'].includes(a.kind)) throw new CrewError(400, 'Lunch must be usual, later or none.');
    if (a.kind === 'later' && (!HHMM.test(a.from || '') || !HHMM.test(a.to || '') || a.from === a.to)) {
      throw new CrewError(400, 'A later lunch needs its from and to times, like 14:00 to 14:30.');
    }
  }
  const byName = user.fullName || user.username || '';
  for (const a of answers || []) {
    const key = { company: companyId, person: idStr(a.person), date: a.date };
    if (a.kind === 'usual') await LunchOverride.deleteOne(key);
    else await LunchOverride.updateOne(key, { $set: { kind: a.kind, from: a.kind === 'later' ? a.from : null, to: a.kind === 'later' ? a.to : null, confirmedBy: user._id, confirmedByName: byName, order: order._id, stepName: step.step } }, { upsert: true });
  }
  const base = unitIndex === 0 ? `processes.${stepIndex}` : `extraUnits.${unitIndex - 1}.processes.${stepIndex}`;
  await ProductionOrder.updateOne({ _id: order._id }, { $set: { [`${base}.lunchConfirmedBy`]: user._id, [`${base}.lunchConfirmedByName`]: byName, [`${base}.lunchConfirmedAt`]: new Date() } });
  return { saved: (answers || []).length };
}

/** Manpower's "Today" tab: every Production person, today's attendance, and what they're on. */
// Paged and searched on the server (2026-11-13): the list grows with headcount.
export async function todayBoard(companyId, { search = '', page = 1, limit = 25 } = {}) {
  await closeFinishedCrews(companyId, {});
  const q = await eligiblePeopleQuery(companyId);
  const s = String(search || '').trim();
  if (s) {
    const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ fullName: re }, { username: re }, { employeeId: re }];
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const [people, total] = await Promise.all([
    User.find(q).select('fullName username employeeId canLogin').sort({ fullName: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    User.countDocuments(q),
  ]);
  const ids = people.map((p) => p._id);
  const [teamOf, att, open] = await Promise.all([
    activeTeamsOf(companyId, ids), todayAttendance(ids),
    StepCrewEntry.find({ company: companyId, person: { $in: ids }, leftAt: null }).populate('forTeam', 'name').lean(),
  ]);
  // Feature 9: "working" is the running step; the rest are planned.
  const running = new Set((await onRunningSteps(open)).map((x) => String(x._id)));
  const byPerson = new Map();
  for (const x of open) { const k = String(x.person); if (!byPerson.has(k)) byPerson.set(k, []); byPerson.get(k).push(x); }
  const rows = people.map((p) => {
    const mine = byPerson.get(String(p._id)) || [];
    const e = mine.find((x) => running.has(String(x._id))) || null;
    return {
      person: p._id, name: nameOf(p), employeeId: p.employeeId, canLogin: p.canLogin !== false,
      team: teamOf.get(String(p._id)) || null, today: att(p._id),
      working: e ? { order: e.order, orderNo: e.orderNo, partName: e.partName, partCode: e.partCode, unit: e.unitIndex + 1, unitIndex: e.unitIndex, stepIndex: e.stepIndex, stepName: e.stepName, since: e.joinedAt, borrowed: e.borrowed, covering: e.coveringFor ? { name: e.coveringForName, team: e.forTeam?.name || '' } : null } : null,
      planned: mine.filter((x) => !running.has(String(x._id))).map((x) => ({ order: x.order, orderNo: x.orderNo, partName: x.partName, unit: x.unitIndex + 1, stepIndex: x.stepIndex, stepName: x.stepName, covering: x.coveringFor ? { name: x.coveringForName, team: x.forTeam?.name || '' } : null })),
    };
  });
  return { people: rows, total, page: pageNum, limit: limitNum };
}

// Efficiency (stage 5) was replaced by the performance score on 2026-11-13:
// services/score/scoreService.js.

/**
 * Work Planning's people strip (2026-11-14,
 * docs/client-features-2026-11/11-work-planning-board-logic.md §3): every
 * Production person today — counts, and the free, present people to plan next.
 * Not paged: it's headcount, like the board's open work.
 */
export async function peopleToday(companyId) {
  await closeFinishedCrews(companyId, {});
  const people = await User.find(await eligiblePeopleQuery(companyId)).select('fullName username employeeId productionSkills').sort({ fullName: 1 }).lean();
  const ids = people.map((p) => p._id);
  const [teamOf, att, open] = await Promise.all([
    activeTeamsOf(companyId, ids), todayAttendance(ids),
    StepCrewEntry.find({ company: companyId, person: { $in: ids }, leftAt: null }).select('person order unitIndex stepIndex').lean(),
  ]);
  const running = new Set((await onRunningSteps(open)).map((x) => String(x._id)));
  const counts = { total: people.length, present: 0, absent: 0, notIn: 0, working: 0, plannedOnly: 0, free: 0 };
  const free = [];
  for (const p of people) {
    const a = att(p._id);
    if (a.state === 'present') counts.present += 1; else if (a.state === 'absent') counts.absent += 1; else counts.notIn += 1;
    const mine = open.filter((e) => String(e.person) === String(p._id));
    if (mine.some((e) => running.has(String(e._id)))) counts.working += 1;
    else if (mine.length) counts.plannedOnly += 1;
    else if (a.state === 'present') {
      counts.free += 1;
      free.push({ person: p._id, name: nameOf(p), employeeId: p.employeeId, team: teamOf.get(String(p._id)) || null, skills: p.productionSkills || [] });
    }
  }
  return { counts, free };
}

/** Hours so far on a running step's current round: { personHours, workingHours, start } (Work Planning). */
export async function stepHoursSoFar(companyId, order, unitIndex, stepIndex) {
  const step = unitProcs(order, unitIndex)[stepIndex];
  if (!step?.startedAt) return { personHours: 0, workingHours: 0, start: null };
  const now = new Date();
  const { start } = await runWindowStart(order, unitIndex, stepIndex, step, now);
  if (!start) return { personHours: 0, workingHours: 0, start: null };
  const entries = await StepCrewEntry.find({ order: order._id, unitIndex, stepIndex, joinedAt: { $lt: now }, $or: [{ leftAt: null }, { leftAt: { $gt: start } }] }).lean();
  const { totals } = await crewHours(companyId, entries, [start, now]);
  return { personHours: totals.personHours, workingHours: totals.workingHours, start };
}

/**
 * Feature 13 (2026-11-17): a step's hours up to a moment (a month's end), for the
 * scorecard's Task completion: { start, rework, perPerson: [{ person, team, hours }], totals }.
 * null when the step hadn't started by then.
 */
export async function stepHoursUntil(companyId, order, unitIndex, stepIndex, until) {
  const step = unitProcs(order, unitIndex)[stepIndex];
  const at = new Date(until);
  if (!step?.startedAt || new Date(step.startedAt) > at) return null;
  const { start, rework } = await runWindowStart(order, unitIndex, stepIndex, step, at);
  if (!start) return null;
  const entries = await StepCrewEntry.find({ order: order._id, unitIndex, stepIndex, joinedAt: { $lt: at }, $or: [{ leftAt: null }, { leftAt: { $gt: start } }] }).lean();
  const { perPerson, totals } = await crewHours(companyId, entries, [start, at], at.getTime());
  return { start, rework, perPerson, totals };
}

/**
 * Stage 6 (2026-11-12): a unit's (a Sub Child Part: the batch's) labour — the sum
 * of its finished runs. Closes finished crews and records any run still missing
 * first (one whose crew was all taken off before it completed has no open entry,
 * so closeFinishedCrews alone wouldn't save it). Returns names only for the
 * people counted ₹0 (no salary): never anyone's own cost.
 */
export async function unitLabour(companyId, orderRef, unitIndex) {
  const orderId = orderRef?._id || orderRef;
  await closeFinishedCrews(companyId, { orderId });
  const order = await ProductionOrder.findOne({ _id: orderId, company: companyId })
    .select('orderId orderKind machineCode machineName orderQuantity processes extraUnits').lean();
  if (!order) return { labour: 0, missing: [], runs: 0 };
  const procs = unitProcs(order, unitIndex);
  for (let i = 0; i < procs.length; i++) {
    const s = procs[i];
    if (s.type === 'In-House' && DONE.includes(s.status) && s.completedAt) await recordRun(companyId, order, unitIndex, i);
  }
  const runs = await StepRun.find({ company: companyId, order: order._id, unitIndex }).select('labour byPerson.person byPerson.missing').lean();
  const labour = Math.round(runs.reduce((t, r) => t + (r.labour || 0), 0) * 100) / 100;
  const missingIds = [...new Set(runs.flatMap((r) => (r.byPerson || []).filter((p) => p.missing).map((p) => String(p.person))))];
  const people = missingIds.length ? await User.find({ _id: { $in: missingIds } }).select('fullName username').lean() : [];
  return { labour, missing: people.map(nameOf).sort(), runs: runs.length };
}

/**
 * Stage 6: HR entered a salary for someone counted ₹0 → price their saved hours
 * on those runs now. Returns the builds touched ({ order, unitIndex }); the
 * caller re-pushes them, and the latest-build rule leaves a replaced build alone.
 */
export async function refillMissingLabour(companyId, personId) {
  const salary = await SalaryStructure.findOne({ employee: personId }).select('basic hra otherAllowance').lean();
  if (!(grossOf(salary) > 0)) return [];
  const weeklyOff = await weeklyOffDaysFor(companyId);
  const runs = await StepRun.find({ company: companyId, byPerson: { $elemMatch: { person: personId, missing: true } } });
  const builds = new Map();
  for (const run of runs) {
    for (const p of run.byPerson) {
      if (String(p.person) !== String(personId) || !p.missing) continue;
      const r = personLabour(p.days || [], salary, weeklyOff);
      p.labour = r.labour;
      p.missing = r.missing;
    }
    run.labour = Math.round(run.byPerson.reduce((t, p) => t + (p.labour || 0), 0) * 100) / 100;
    await run.save();
    builds.set(`${run.order}|${run.unitIndex}`, { order: run.order, unitIndex: run.unitIndex });
  }
  return [...builds.values()];
}
