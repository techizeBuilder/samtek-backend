// Feature 25, slice 4 (23 Nov 2026): Task Management → Reports. Per person for a month or dates:
// tasks finished, on time %, first time right %, average rating, open past due, routine items
// done / missed, blocked now. Heads see their department; HR and the top admins everyone.
// Uses the same loader and rules as the scorecard (kraScoreSource / kraScore).
import mongoose from 'mongoose';
import User from '../../models/User.js';
import KraTask from '../../models/KraTask.js';
import { companyDepartments, departmentOf } from '../departmentSeedService.js';
import { periodOf, rangeOf, kraBreakdown } from '../score/scoreService.js';
import { kraTasksFor } from './kraScoreSource.js';
import { taskFacts } from './kraScore.js';
import { kraOfMany } from '../kra/kraService.js';
import { TaskError, isTopAdmin, isHead, getSettings } from './kraTaskService.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const NOT_SCORED = ['Superadmin', 'Super Admin', 'Company Admin'];
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

async function scopeOf(user) {
  const depts = await companyDepartments(user.companyId);
  if (isTopAdmin(user)) return { all: true, depts };
  if (isHead(user)) {
    const me = await User.findById(user._id).select('role departmentId').lean();
    const d = departmentOf(me, depts);
    if (d) return { all: false, dept: d, depts };
  }
  throw new TaskError(403, 'Only heads, HR and the top admins see task reports.');
}

function periodDates(q) {
  const p = periodOf(q);
  const [from, to] = rangeOf(p.dates ? { from: p.fromDate, to: p.toDate } : { month: p.month });
  return { ...p, from, to };
}

export async function taskReport(user, q = {}) {
  const sc = await scopeOf(user);
  const P = periodDates(q);
  let people = await User.find({ companyId: { $in: [oid(user.companyId), String(user.companyId)] }, role: { $nin: NOT_SCORED }, $or: [{ isActive: { $ne: false } }, { updatedAt: { $gte: P.from } }] })
    .select('fullName username role departmentId employeeId isActive').lean();
  people = people.map((u) => ({ ...u, dept: departmentOf(u, sc.depts) }));
  if (!sc.all) people = people.filter((u) => String(u.dept?._id || '') === String(sc.dept._id));
  else if (q.department) people = people.filter((u) => String(u.dept?._id || '') === String(q.department));
  const s = String(q.search || '').trim().toLowerCase();
  if (s) people = people.filter((u) => (u.fullName || u.username || '').toLowerCase().includes(s));
  const ids = people.map((u) => u._id);
  const [tasks, settings, kras, blocked] = await Promise.all([
    kraTasksFor(user.companyId, ids, P),
    getSettings(user.companyId),
    kraOfMany(user.companyId, people, P.toDate),
    ids.length ? KraTask.aggregate([{ $match: { company: oid(user.companyId), person: { $in: ids }, 'blocker.open': true, status: { $in: ['Assigned', 'InProgress', 'Rework'] } } }, { $group: { _id: '$person', n: { $sum: 1 } } }]) : [],
  ]);
  const until = new Date(Math.min(P.to.getTime(), Date.now()));
  const blockedOf = new Map(blocked.map((b) => [String(b._id), b.n]));
  const byPerson = new Map();
  for (const t of tasks) { const k = String(t.person); if (!byPerson.has(k)) byPerson.set(k, []); byPerson.get(k).push(t); }
  let rows = people.map((u) => {
    const mine = byPerson.get(String(u._id)) || [];
    const facts = mine.map((t) => ({ t, f: taskFacts(t, { from: P.from, until, settings }) }));
    const fin = facts.filter((x) => x.f.state === 'finished');
    const finTasks = fin.filter((x) => x.t.type !== 'routine'), finRoutine = fin.filter((x) => x.t.type === 'routine');
    const rated = finTasks.filter((x) => x.f.rating != null);
    return {
      person: u._id, name: u.fullName || u.username, employeeId: u.employeeId || '', role: u.role, department: u.dept ? { _id: u.dept._id, name: u.dept.name } : null,
      hasKra: !!kras.get(String(u._id)),
      finished: finTasks.length,
      onTimePct: pct(finTasks.filter((x) => x.f.onTime).length, finTasks.length),
      firstTimeRightPct: pct(fin.filter((x) => x.f.error === 0).length, fin.length),
      avgRating: rated.length ? Math.round(rated.reduce((a, x) => a + x.f.rating, 0) / rated.length) : null,
      openPastDue: facts.filter((x) => x.f.state === 'open' && x.t.type !== 'routine').length,
      waiting: facts.filter((x) => x.f.state === 'waiting').length,
      routineDone: finRoutine.length, routineLate: finRoutine.filter((x) => !x.f.onTime).length,
      routineMissed: facts.filter((x) => x.f.state === 'open' && x.t.type === 'routine').length,
      blockedNow: blockedOf.get(String(u._id)) || 0,
    };
  });
  // People with a KRA or anything in the period; the rest have nothing to report.
  rows = rows.filter((r) => r.hasKra || r.finished || r.openPastDue || r.routineDone || r.routineMissed || r.waiting || r.blockedNow)
    .sort((a, b) => a.name.localeCompare(b.name));
  const lim = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
  const pg = Math.max(1, parseInt(q.page, 10) || 1);
  const departments = sc.all ? sc.depts.map((d) => ({ _id: d._id, name: d.name })) : [{ _id: sc.dept._id, name: sc.dept.name }];
  return {
    month: P.month, fromDate: P.fromDate, toDate: P.toDate, dates: P.dates, total: rows.length, page: pg, limit: lim,
    people: rows.slice((pg - 1) * lim, pg * lim), departments, scope: sc.all ? 'all' : 'department',
  };
}

/** One person's KRA box for the period (the scorecard's numbers). Heads: their department; top admins: anyone. */
export async function personReport(user, personId, q = {}) {
  const sc = await scopeOf(user);
  if (!mongoose.isValidObjectId(personId)) throw new TaskError(404, 'Person not found.');
  const p = await User.findOne({ _id: personId, companyId: { $in: [oid(user.companyId), String(user.companyId)] } }).select('fullName username role departmentId').lean();
  if (!p) throw new TaskError(404, 'Person not found.');
  if (!sc.all && String(departmentOf(p, sc.depts)?._id || '') !== String(sc.dept._id)) throw new TaskError(403, "This person isn't in your department.");
  const b = await kraBreakdown(user.companyId, personId, q);
  return { person: p._id, name: p.fullName || p.username, role: p.role, ...b };
}
