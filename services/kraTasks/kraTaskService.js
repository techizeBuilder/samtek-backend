// Feature 25, slice 2 (client, 23 Nov 2026): the new Task Management, on KRAs.
// docs/client-features-2026-11/25-kra-tasks-logic.md (decisions F, G, I, J, K, L).
// Every task is under one of the person's current KRA items (kraOf, checked here, not only on
// the screen). A department head gives tasks to their department's people; the top admins to
// anyone; nobody to themselves.
import mongoose from 'mongoose';
import KraTask from '../../models/KraTask.js';
import KraTaskSettings from '../../models/KraTaskSettings.js';
import User from '../../models/User.js';
import Task from '../../models/taskManagement.js';
import notificationService from '../notificationService.js';
import { kraOf, canEditKra } from '../kra/kraService.js';
import { companyDepartments, departmentOf, departmentNameForRole } from '../departmentSeedService.js';
import Leave from '../../models/Leave.js';
import { calendarFor, todayIndia, addDays, dayStart, dayEnd } from './kraCalendar.js';

export class TaskError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const TOP_ADMINS = ['HR-Admin', 'MIS Admin', 'Company Admin', 'Super Admin', 'Admin'];
// Heads by role (as the old module), plus any "… Head" role that names a department.
const HEAD_ROLES = ['Manager', 'Finance Manager', 'Unit Head', 'Unit Manager'];
const RATINGS = { Excellent: 100, Good: 80, Average: 60, Poor: 30 }; // decision J
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const companyMatch = (companyId) => ({ $in: [oid(companyId), String(companyId)] });
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notify = async (fn) => { try { await fn(); } catch (e) { console.error('[KraTask] notify failed:', e.message); } };
async function whoIs(user) {
  const u = user?._id ? await User.findById(user._id).select('fullName username').lean() : null;
  return u?.fullName || u?.username || user?.username || '';
}

// ── Who's who ──
export const isTopAdmin = (user) => TOP_ADMINS.includes(user?.role);
export const isHead = (user) => HEAD_ROLES.includes(user?.role) || (/Head$/.test(String(user?.role || '')) && !!departmentNameForRole(user.role));
/** The giver's own department ({ _id, name }) or null; heads only. */
async function headDepartment(user, depts) {
  if (!isHead(user)) return null;
  const me = await User.findById(user._id).select('role departmentId').lean();
  return departmentOf(me, depts);
}
/** Is this person in the head's department? */
const sameDept = (person, dept, depts) => !!dept && String(departmentOf(person, depts)?._id || '') === String(dept._id);
const canGive = (user) => isTopAdmin(user) || isHead(user);

// ── Settings (sizes) ──
const DEFAULTS = { shortMaxHours: 4, mediumMaxDays: 5, hoursPerDay: 8, stepMaxDays: 2, graceShortMinutes: 30, graceMediumHours: 2, graceLongDays: 1 };
export async function getSettings(companyId) {
  const s = await KraTaskSettings.findOne({ company: oid(companyId) }).lean();
  return { ...DEFAULTS, ...(s ? { shortMaxHours: s.shortMaxHours, mediumMaxDays: s.mediumMaxDays, hoursPerDay: s.hoursPerDay, stepMaxDays: s.stepMaxDays, graceShortMinutes: s.graceShortMinutes ?? 30, graceMediumHours: s.graceMediumHours ?? 2, graceLongDays: s.graceLongDays ?? 1 } : {}), savedByName: s?.savedByName || '' };
}
export async function saveSettings(user, body = {}) {
  if (!canEditKra(user)) throw new TaskError(403, "You can't change the task sizes.");
  const n = (k, min, max) => {
    const v = Number(body[k]);
    if (!Number.isFinite(v) || v < min || v > max) throw new TaskError(400, `${k}: from ${min} to ${max}.`);
    return v;
  };
  const cur = await getSettings(user.companyId);
  const opt = (k, min, max) => (body[k] === undefined || body[k] === '' ? cur[k] : n(k, min, max));
  const doc = { shortMaxHours: n('shortMaxHours', 0.5, 24), mediumMaxDays: n('mediumMaxDays', 1, 60), hoursPerDay: n('hoursPerDay', 1, 24), stepMaxDays: n('stepMaxDays', 0.5, 10),
    graceShortMinutes: opt('graceShortMinutes', 0, 480), graceMediumHours: opt('graceMediumHours', 0, 48), graceLongDays: opt('graceLongDays', 0, 7) };
  if (doc.shortMaxHours >= doc.mediumMaxDays * doc.hoursPerDay) throw new TaskError(400, 'Short must be less than medium.');
  await KraTaskSettings.findOneAndUpdate({ company: oid(user.companyId) }, { $set: { ...doc, savedByName: await whoIs(user) } }, { upsert: true });
  return getSettings(user.companyId);
}
export const sizeOf = (hours, s) => (hours <= s.shortMaxHours ? 'short' : hours <= s.mediumMaxDays * s.hoursPerDay ? 'medium' : 'long');

// ── People a giver may give tasks to ──
export async function givablePeople(user, { search = '', page = 1, limit = 20 } = {}) {
  if (!canGive(user)) throw new TaskError(403, "You can't give tasks.");
  const depts = await companyDepartments(user.companyId);
  const q = { companyId: companyMatch(user.companyId), isActive: { $ne: false }, _id: { $ne: oid(user._id) }, role: { $nin: ['Super Admin', 'Superadmin'] } };
  if (String(search || '').trim()) q.fullName = new RegExp(esc(String(search).trim()), 'i');
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  if (isTopAdmin(user)) {
    const [rows, total] = await Promise.all([
      User.find(q).select('fullName username role departmentId').sort({ fullName: 1 }).skip((pg - 1) * lim).limit(lim).lean(),
      User.countDocuments(q),
    ]);
    return { people: rows.map((u) => ({ _id: u._id, name: u.fullName || u.username, role: u.role, department: departmentOf(u, depts)?.name || '' })), total, page: pg, limit: lim };
  }
  // A head: their department's people (worked out per person: a set department, else the role's).
  const dept = await headDepartment(user, depts);
  if (!dept) return { people: [], total: 0, page: pg, limit: lim };
  const roles = new Set((await User.distinct('role', q)).filter((r) => departmentNameForRole(r)?.toLowerCase() === dept.name.toLowerCase()));
  const dq = { ...q, $or: [{ departmentId: oid(dept._id) }, { departmentId: { $in: [null] }, role: { $in: [...roles] } }, { departmentId: { $exists: false }, role: { $in: [...roles] } }] };
  const [rows, total] = await Promise.all([
    User.find(dq).select('fullName username role departmentId').sort({ fullName: 1 }).skip((pg - 1) * lim).limit(lim).lean(),
    User.countDocuments(dq),
  ]);
  return { people: rows.map((u) => ({ _id: u._id, name: u.fullName || u.username, role: u.role, department: dept.name })), total, page: pg, limit: lim };
}

// ── Steps ──
function cleanSteps(raw, dueAt, s, { required }) {
  const steps = Array.isArray(raw) ? raw : [];
  if (required && steps.length < 2) throw new TaskError(400, `Long work must be split into steps (at least 2), each up to ${s.stepMaxDays} working days, so it can be followed day by day.`);
  if (steps.length > 30) throw new TaskError(400, 'At most 30 steps.');
  const maxH = s.stepMaxDays * s.hoursPerDay;
  return steps.map((st, i) => {
    const title = String(st?.title || '').trim();
    if (title.length < 2) throw new TaskError(400, `Step ${i + 1}: give it a title.`);
    const effortHours = Number(st?.effortHours);
    if (!(effortHours > 0)) throw new TaskError(400, `Step ${i + 1}: give its planned hours.`);
    if (effortHours > maxH) throw new TaskError(400, `Step ${i + 1} is ${effortHours} h: a step can be up to ${s.stepMaxDays} working days (${maxH} h). Split it.`);
    const due = new Date(st?.dueAt);
    if (Number.isNaN(due.getTime())) throw new TaskError(400, `Step ${i + 1}: give its due date.`);
    if (due > dueAt) throw new TaskError(400, `Step ${i + 1} is due after the task.`);
    return { stepId: st?.stepId && mongoose.isValidObjectId(st.stepId) ? oid(st.stepId) : new mongoose.Types.ObjectId(), title: title.slice(0, 200), effortHours, dueAt: due, done: !!st?.done, doneAt: st?.doneAt || null, doneByName: st?.doneByName || '' };
  });
}

// ── Creating ──
/**
 * body: { assignments: [{ person, kraItemId }], type: 'oneTime' | 'surprise', surpriseReason, title,
 *   description, priority, effortHours, dueAt, startDate, steps: [{ title, effortHours, dueAt }] }
 */
export async function createTasks(user, body = {}, brief = null) {
  if (!canGive(user)) throw new TaskError(403, "You can't give tasks.");
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  if (!assignments.length) throw new TaskError(400, 'Pick who the task is for.');
  if (assignments.length > 50) throw new TaskError(400, 'Up to 50 people at a time.');
  const type = body.type === 'surprise' ? 'surprise' : body.type === 'oneTime' ? 'oneTime' : null;
  if (!type) throw new TaskError(400, 'Pick the type: one-time or surprise work.');
  const surpriseReason = String(body.surpriseReason || '').trim();
  if (type === 'surprise' && surpriseReason.length < 5) throw new TaskError(400, 'Surprise work needs a reason: why it came up unplanned.');
  const title = String(body.title || '').trim();
  if (title.length < 3) throw new TaskError(400, 'Give the task a title.');
  const dueAt = new Date(body.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new TaskError(400, 'Give the due date and time.');
  if (dueAt < new Date(Date.now() - 60000)) throw new TaskError(400, "The due date can't be in the past.");
  const s = await getSettings(user.companyId);
  let effortHours = Number(body.effortHours);
  const rawSteps = Array.isArray(body.steps) ? body.steps.filter((x) => x && (x.title || x.effortHours)) : [];
  const stepsSum = rawSteps.reduce((a, x) => a + (Number(x.effortHours) || 0), 0);
  if (rawSteps.length) effortHours = stepsSum; // with steps, the task's effort is their sum
  if (!(effortHours > 0)) throw new TaskError(400, 'Give the planned hours.');
  const size = sizeOf(effortHours, s);
  const steps = cleanSteps(rawSteps, dueAt, s, { required: size === 'long' });
  const priority = ['Low', 'Medium', 'High', 'Critical'].includes(body.priority) ? body.priority : 'Medium';

  const depts = await companyDepartments(user.companyId);
  const myDept = isTopAdmin(user) ? null : await headDepartment(user, depts);
  const byName = await whoIs(user);
  const batchId = new mongoose.Types.ObjectId();
  const docs = [];
  for (const a of assignments) {
    if (!mongoose.isValidObjectId(a?.person)) throw new TaskError(404, 'Person not found.');
    if (String(a.person) === String(user._id)) throw new TaskError(400, "You can't give yourself a task.");
    const person = await User.findOne({ _id: a.person, companyId: companyMatch(user.companyId), isActive: { $ne: false } }).select('fullName username role departmentId').lean();
    if (!person) throw new TaskError(404, 'Person not found.');
    const who = person.fullName || person.username;
    if (!isTopAdmin(user) && !sameDept(person, myDept, depts)) throw new TaskError(403, `${who} isn't in your department.`);
    // The rule: the task falls under one of their KRA items in force today.
    const kra = await kraOf(user.companyId, person);
    if (!kra || !kra.items.length) throw new TaskError(400, `${who} has no KRA yet: ask HR to set one first.`);
    const item = kra.items.find((i) => String(i.itemId) === String(a.kraItemId));
    if (!item) throw new TaskError(400, `That isn't one of ${who}'s KRAs. Pick one of: ${kra.items.filter((i) => i.builtIn !== 'stepWork').map((i) => i.name).join(', ')}.`);
    if (item.builtIn === 'stepWork') throw new TaskError(400, 'Step work is measured from Process Execution: pick another KRA for a task.');
    docs.push({
      company: oid(user.companyId), person: person._id, personName: who, department: departmentOf(person, depts) || { _id: null, name: '' },
      assignedBy: user._id, assignedByName: byName, batchId, givenDay: todayIndia(),
      kra: { setId: kra.set._id, version: kra.set.version, itemId: item.itemId, name: item.name },
      type, surpriseReason: type === 'surprise' ? surpriseReason : '', title: title.slice(0, 200), description: String(body.description || '').trim().slice(0, 5000),
      priority, effortHours, size, startDate: body.startDate ? new Date(body.startDate) : new Date(), dueAt,
      steps: steps.map((x) => ({ ...x, stepId: new mongoose.Types.ObjectId() })), brief: brief ? { ...brief, at: new Date(), byName } : null,
      activity: [{ at: new Date(), byName, text: `Given (${type === 'surprise' ? 'surprise work' : 'one-time'}, ${size}, ${effortHours} h)` }],
    });
  }
  const saved = await KraTask.insertMany(docs);
  for (const t of saved) {
    await notify(() => notificationService.createNotification({
      title: `New task — ${t.title}`, message: `${byName} gave you a ${t.size} task under "${t.kra.name}", due ${t.dueAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.`,
      type: 'hrms', icon: 'clipboard', priority: t.priority === 'Critical' || t.priority === 'High' ? 'high' : 'medium', targetUserId: t.person, targetCompanyId: t.company, data: { kraTaskId: t._id },
    }));
  }
  const ctx = await dayCtx(user.companyId);
  return { tasks: saved.map((t) => view(t, null, ctx)), batchId };
}

// ── Seeing ──
async function roleOf(user, task, depts = null) {
  const r = { person: String(task.person) === String(user._id), giver: String(task.assignedBy) === String(user._id), admin: isTopAdmin(user), head: false };
  if (!r.person && !r.giver && !r.admin && isHead(user)) {
    const d = await headDepartment(user, depts || await companyDepartments(user.companyId));
    r.head = !!d && String(task.department?._id || '') === String(d._id);
  }
  r.see = r.person || r.giver || r.admin || r.head;
  r.review = !r.person && (r.giver || r.admin || r.head);
  r.manage = !r.person && task.type !== 'routine' && (r.giver || r.admin); // edit, due date, cancel (not routine items)
  return r;
}

// ── Today, for daily updates (slice 3) ──
const OPEN = ['Assigned', 'InProgress', 'Rework'];
const UPDATE_SIZES = ['medium', 'long'];
/** People on approved leave today (a short list), across the company's people. */
async function leaveIdsOn(day) {
  return Leave.distinct('employee', { status: 'APPROVED', fromDate: { $lte: dayEnd(day) }, toDate: { $gte: dayStart(day) } });
}
/** { today, working, leave: Set } — is a daily update due today at all, and who is away. */
export async function dayCtx(companyId, day = todayIndia()) {
  const [cal, leave] = await Promise.all([calendarFor(companyId, day, 0), leaveIdsOn(day)]);
  return { today: day, working: cal.isWorking(day), leave: new Set(leave.map(String)), leaveIds: leave };
}
/** Is today's daily update still to write on this task? */
const needsUpdate = (o, ctx) => !!ctx && ctx.working && o.type !== 'routine' && UPDATE_SIZES.includes(o.size) && OPEN.includes(o.status)
  && (o.givenDay || '') < ctx.today && o.lastUpdateDay !== ctx.today && !ctx.leave.has(String(o.person));
const SEND_BACK_DAYS = 7;
async function load(user, id) {
  if (!mongoose.isValidObjectId(id)) throw new TaskError(404, 'Task not found.');
  const t = await KraTask.findOne({ _id: id, company: oid(user.companyId) });
  if (!t) throw new TaskError(404, 'Task not found.');
  const r = await roleOf(user, t);
  if (!r.see) throw new TaskError(403, "You can't see this task.");
  return { t, r };
}
const view = (t, r, ctx = null) => {
  const o = t.toObject ? t.toObject() : t;
  const steps = o.steps || [];
  const doneH = steps.filter((x) => x.done).reduce((a, x) => a + x.effortHours, 0);
  const routine = o.type === 'routine';
  const today = ctx?.today || todayIndia();
  const tickable = routine && (o.status === 'Assigned' ? (o.routine?.day || '') >= today : o.status === 'Rework' && (o.routine?.redoBy || '') >= today);
  return {
    ...o,
    progress: steps.length ? Math.round((doneH / o.effortHours) * 100) : (['Accepted', 'Submitted'].includes(o.status) ? 100 : o.lastPercent ?? 0),
    overdue: OPEN.includes(o.status) && new Date(o.dueAt) < new Date(),
    late: routine && !!o.doneAt && new Date(o.doneAt) > new Date(o.dueAt),
    needsUpdate: needsUpdate(o, ctx),
    can: r ? {
      review: r.review && o.status === 'Submitted',
      manage: r.manage && !['Accepted', 'Cancelled'].includes(o.status),
      edit: r.manage && OPEN.includes(o.status),
      work: r.person && !routine && OPEN.includes(o.status),
      update: r.person && !routine && UPDATE_SIZES.includes(o.size) && OPEN.includes(o.status),
      block: r.person && OPEN.includes(o.status) && !o.blocker?.open,
      unblock: !!o.blocker?.open && (r.person || r.giver || r.admin || r.head),
      tick: r.person && tickable,
      sendBack: r.review && routine && o.status === 'Accepted' && !!o.doneAt && Date.now() - new Date(o.doneAt).getTime() <= SEND_BACK_DAYS * 86400000,
    } : undefined,
  };
};
export async function getTask(user, id) {
  const { t, r } = await load(user, id);
  return view(t, r, await dayCtx(user.companyId));
}

/** scope: mine | given | team | all. tab: open | review | overdue | noUpdate | blocked | routine (day) | done | all. */
export async function listTasks(user, { scope = 'mine', tab = 'open', type = '', kraItemId = '', person = '', search = '', day = '', page = 1, limit = 20 } = {}) {
  const C = oid(user.companyId);
  const base = { company: C };
  if (scope === 'mine') base.person = oid(user._id);
  else if (scope === 'given') base.assignedBy = oid(user._id);
  else if (scope === 'team') {
    const d = await headDepartment(user, await companyDepartments(user.companyId));
    if (!d && !isTopAdmin(user)) throw new TaskError(403, 'You have no department to see.');
    if (d) base['department._id'] = oid(d._id);
  } else if (scope === 'all') {
    if (!isTopAdmin(user)) throw new TaskError(403, 'Only HR and the top admins see every task.');
  } else throw new TaskError(400, 'Unknown list.');
  if (kraItemId && mongoose.isValidObjectId(kraItemId)) base['kra.itemId'] = oid(kraItemId);
  if (person && mongoose.isValidObjectId(person)) base.person = scope === 'mine' ? base.person : oid(person);
  if (String(search || '').trim()) base.$or = [{ title: new RegExp(esc(String(search).trim()), 'i') }, { personName: new RegExp(esc(String(search).trim()), 'i') }];
  // Routine items (slice 3) are many and daily: kept out of the other tabs unless picked by type.
  const typed = ['oneTime', 'surprise', 'routine'].includes(type) ? type : null;
  const ctx = await dayCtx(user.companyId);
  const routineDay = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : ctx.today;
  if (tab === 'routine') base.type = 'routine';
  else base.type = typed || { $ne: 'routine' };
  const now = new Date();
  // A daily update is due on this task today (slice 3): open medium / long work given before today,
  // nothing written today, not on a day off, the person not on leave.
  const noUpdate = ctx.working
    ? { status: { $in: OPEN }, size: { $in: UPDATE_SIZES }, givenDay: { $lt: ctx.today }, lastUpdateDay: { $ne: ctx.today }, person: base.person ? base.person : { $nin: ctx.leaveIds } }
    : { _id: null };
  if (base.person && ctx.leave.has(String(base.person))) Object.assign(noUpdate, { _id: null });
  const tabs = {
    open: { status: { $in: [...OPEN, 'Submitted'] } },
    review: { status: 'Submitted' },
    overdue: { status: { $in: OPEN }, dueAt: { $lt: now } },
    noUpdate,
    blocked: { status: { $in: OPEN }, 'blocker.open': true },
    routine: { 'routine.day': routineDay },
    done: { status: { $in: ['Accepted', 'Cancelled', 'Missed'] } },
    all: {},
  };
  const q = { ...base, ...(tabs[tab] || tabs.open) };
  const lim = Math.min(tab === 'routine' ? 100 : 50, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const sort = tab === 'routine' ? { personName: 1, dueAt: 1 } : tab === 'done' || tab === 'all' ? { dueAt: -1 } : { dueAt: 1 };
  const countBase = { ...base, type: typed && typed !== 'routine' ? typed : { $ne: 'routine' } };
  const leaveIds = ctx.leaveIds.map((x) => oid(x));
  const [rows, total, counts] = await Promise.all([
    KraTask.find(q).select('-comments -activity -submissions -reviews -dueChanges -updates -blockers').sort(sort).skip((pg - 1) * lim).limit(lim).lean(),
    KraTask.countDocuments(q),
    KraTask.aggregate([{ $match: { ...countBase, status: { $in: [...OPEN, 'Submitted'] } } }, { $group: {
      _id: null, open: { $sum: 1 },
      review: { $sum: { $cond: [{ $eq: ['$status', 'Submitted'] }, 1, 0] } },
      overdue: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN] }, { $lt: ['$dueAt', now] }] }, 1, 0] } },
      blocked: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN] }, { $eq: ['$blocker.open', true] }] }, 1, 0] } },
      noUpdate: { $sum: { $cond: [{ $and: [
        ctx.working, { $in: ['$status', OPEN] }, { $in: ['$size', UPDATE_SIZES] }, { $lt: [{ $ifNull: ['$givenDay', ''] }, ctx.today] },
        { $ne: ['$lastUpdateDay', ctx.today] }, { $not: [{ $in: ['$person', leaveIds] }] },
      ] }, 1, 0] } },
    } }]),
  ]);
  const c = counts[0] || {};
  return {
    items: rows.map((t) => view(t, null, ctx)), total, page: pg, limit: lim, day: routineDay,
    counts: { open: c.open || 0, review: c.review || 0, overdue: c.overdue || 0, blocked: c.blocked || 0, noUpdate: c.noUpdate || 0 },
  };
}

// ── The task's life ──
const log = (t, byName, text) => { t.activity.push({ at: new Date(), byName, text }); if (t.activity.length > 200) t.activity.splice(0, t.activity.length - 200); };
const tell = (t, userId, title, message) => (!userId ? null : notify(() => notificationService.createNotification({ title, message, type: 'hrms', icon: 'clipboard', priority: 'medium', targetUserId: userId, targetCompanyId: t.company, data: { kraTaskId: t._id } })));

export async function startTask(user, id) {
  const { t, r } = await load(user, id);
  if (!r.person) throw new TaskError(403, 'Only the person it is for can start it.');
  if (t.type === 'routine') throw new TaskError(400, 'A routine item is ticked done, not started.');
  if (t.status !== 'Assigned') throw new TaskError(400, 'It has already started.');
  const by = await whoIs(user);
  t.status = 'InProgress'; t.startedAt = new Date(); log(t, by, 'Started');
  await t.save();
  return view(t, r);
}

export async function toggleStep(user, id, stepId, done) {
  const { t, r } = await load(user, id);
  if (!r.person) throw new TaskError(403, 'Only the person it is for ticks its steps.');
  if (!['Assigned', 'InProgress', 'Rework'].includes(t.status)) throw new TaskError(400, `It is ${t.status === 'Submitted' ? 'waiting for review' : t.status.toLowerCase()}.`);
  const st = t.steps.find((x) => String(x.stepId) === String(stepId));
  if (!st) throw new TaskError(404, 'Step not found.');
  const by = await whoIs(user);
  st.done = !!done; st.doneAt = done ? new Date() : null; st.doneByName = done ? by : '';
  if (t.status === 'Assigned') { t.status = 'InProgress'; t.startedAt = new Date(); }
  log(t, by, `${done ? 'Done' : 'Re-opened'}: ${st.title}`);
  await t.save();
  return view(t, r);
}

export async function submitTask(user, id, { note = '' } = {}, file = null) {
  const { t, r } = await load(user, id);
  if (!r.person) throw new TaskError(403, 'Only the person it is for submits it.');
  if (t.type === 'routine') throw new TaskError(400, 'A routine item is ticked done, not submitted.');
  if (!['Assigned', 'InProgress', 'Rework'].includes(t.status)) throw new TaskError(400, `It is ${t.status === 'Submitted' ? 'already waiting for review' : t.status.toLowerCase()}.`);
  const open = t.steps.filter((x) => !x.done);
  if (open.length) throw new TaskError(400, `Finish every step first: ${open.map((x) => x.title).join(', ')}.`);
  const by = await whoIs(user);
  const now = new Date();
  t.status = 'Submitted'; t.submittedAt = now; if (!t.firstSubmittedAt) t.firstSubmittedAt = now; if (!t.startedAt) t.startedAt = now;
  t.submissions.push({ at: now, note: String(note || '').trim().slice(0, 2000), file: file ? { ...file, at: now, byName: by } : null });
  log(t, by, `Submitted${t.reviews.some((x) => x.decision === 'Rework') ? ' again after rework' : ''}`);
  await t.save();
  await tell(t, t.assignedBy, `Task to review — ${t.title}`, `${t.personName} submitted "${t.title}" (${t.kra.name})${now > t.dueAt ? ', after its due date' : ''}.`);
  return view(t, r);
}

/** body: { decision: 'Accepted' | 'Rework', rating, severity, note } */
export async function reviewTask(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (!r.review) throw new TaskError(403, r.person ? "You can't review your own task." : "You can't review this task.");
  if (t.status !== 'Submitted') throw new TaskError(400, 'It is not waiting for review.');
  const by = await whoIs(user);
  const note = String(body.note || '').trim().slice(0, 2000);
  if (body.decision === 'Accepted') {
    if (!RATINGS[body.rating]) throw new TaskError(400, 'Rate it: Excellent, Good, Average or Poor.');
    t.status = 'Accepted'; t.acceptedAt = new Date();
    t.reviews.push({ at: new Date(), byName: by, decision: 'Accepted', rating: body.rating, severity: '', note });
    log(t, by, `Accepted (${body.rating})`);
    await t.save();
    await tell(t, t.person, `Task accepted — ${t.title}`, `${by} accepted "${t.title}": ${body.rating}${note ? `. ${note}` : ''}`);
  } else if (body.decision === 'Rework') {
    if (!['Minor', 'Major'].includes(body.severity)) throw new TaskError(400, 'Say how much rework: Minor or Major.');
    if (note.length < 5) throw new TaskError(400, 'Say what needs reworking.');
    t.status = 'Rework';
    t.reviews.push({ at: new Date(), byName: by, decision: 'Rework', rating: '', severity: body.severity, note });
    log(t, by, `Sent back for rework (${body.severity}): ${note}`);
    await t.save();
    await tell(t, t.person, `Rework — ${t.title}`, `${by} sent "${t.title}" back (${body.severity}): ${note}`);
  } else throw new TaskError(400, 'Accept it or send it back for rework.');
  return view(t, r);
}

export async function changeDue(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (!r.manage) throw new TaskError(403, 'Only the one who gave the task can move its due date.');
  if (['Accepted', 'Cancelled'].includes(t.status)) throw new TaskError(400, `It is ${t.status.toLowerCase()}.`);
  const to = new Date(body.dueAt);
  if (Number.isNaN(to.getTime())) throw new TaskError(400, 'Give the new due date and time.');
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) throw new TaskError(400, 'Say why the due date moves (it is kept on the task).');
  if (t.steps.some((x) => !x.done && x.dueAt > to)) throw new TaskError(400, 'A step is due after the new date: move or edit the steps first.');
  const by = await whoIs(user);
  t.dueChanges.push({ from: t.dueAt, to, reason, byName: by, at: new Date() });
  log(t, by, `Due date moved: ${reason}`);
  t.dueAt = to;
  await t.save();
  await tell(t, t.person, `Due date moved — ${t.title}`, `${by} moved "${t.title}" to ${to.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}: ${reason}`);
  return view(t, r);
}

/** The giver edits the details and steps until it's submitted (the due date only through changeDue). */
export async function editTask(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (!r.manage) throw new TaskError(403, 'Only the one who gave the task can edit it.');
  if (!['Assigned', 'InProgress', 'Rework'].includes(t.status)) throw new TaskError(400, `It can't be edited now: it is ${t.status === 'Submitted' ? 'waiting for review' : t.status.toLowerCase()}.`);
  const by = await whoIs(user);
  const s = await getSettings(user.companyId);
  if (body.title !== undefined) { const v = String(body.title).trim(); if (v.length < 3) throw new TaskError(400, 'Give the task a title.'); t.title = v.slice(0, 200); }
  if (body.description !== undefined) t.description = String(body.description).trim().slice(0, 5000);
  if (body.priority !== undefined && ['Low', 'Medium', 'High', 'Critical'].includes(body.priority)) t.priority = body.priority;
  if (body.steps !== undefined) {
    const rawSteps = (Array.isArray(body.steps) ? body.steps : []).filter((x) => x && (x.title || x.effortHours));
    const sum = rawSteps.reduce((a, x) => a + (Number(x.effortHours) || 0), 0);
    const effort = rawSteps.length ? sum : Number(body.effortHours ?? t.effortHours);
    const size = sizeOf(effort, s);
    const kept = new Map(t.steps.map((x) => [String(x.stepId), x]));
    t.steps = cleanSteps(rawSteps.map((x) => ({ ...x, ...(kept.get(String(x.stepId)) ? { done: kept.get(String(x.stepId)).done, doneAt: kept.get(String(x.stepId)).doneAt, doneByName: kept.get(String(x.stepId)).doneByName } : {}) })), t.dueAt, s, { required: size === 'long' });
    t.effortHours = effort; t.size = size;
  } else if (body.effortHours !== undefined && !t.steps.length) {
    const effort = Number(body.effortHours);
    if (!(effort > 0)) throw new TaskError(400, 'Give the planned hours.');
    const size = sizeOf(effort, s);
    if (size === 'long') throw new TaskError(400, `${effort} h is long work: split it into steps.`);
    t.effortHours = effort; t.size = size;
  }
  log(t, by, 'Edited');
  await t.save();
  return view(t, r);
}

export async function cancelTask(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (!r.manage) throw new TaskError(403, 'Only the one who gave the task can cancel it.');
  if (['Accepted', 'Cancelled'].includes(t.status)) throw new TaskError(400, `It is already ${t.status.toLowerCase()}.`);
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) throw new TaskError(400, 'Say why it is cancelled.');
  const by = await whoIs(user);
  t.status = 'Cancelled'; t.cancelledAt = new Date(); t.cancelReason = reason; log(t, by, `Cancelled: ${reason}`);
  await t.save();
  await tell(t, t.person, `Task cancelled — ${t.title}`, `${by} cancelled "${t.title}": ${reason}`);
  return view(t, r);
}

export async function commentTask(user, id, body = {}) {
  const { t, r } = await load(user, id);
  const text = String(body.text || '').trim();
  if (!text) throw new TaskError(400, 'Write the comment.');
  const by = await whoIs(user);
  t.comments.push({ at: new Date(), byName: by, by: user._id, text: text.slice(0, 2000) });
  if (t.comments.length > 300) t.comments.splice(0, t.comments.length - 300);
  await t.save();
  const other = String(user._id) === String(t.person) ? t.assignedBy : t.person;
  await tell(t, other, `Comment — ${t.title}`, `${by}: ${text.slice(0, 200)}`);
  return view(t, r);
}

// ── Slice 3: daily updates, blockers, routine items, Today ──
/** The department head(s) of a task's person (for routine items, which have no giver). */
async function headsOf(t) {
  if (!t.department?._id) return [];
  const depts = await companyDepartments(t.company);
  const heads = await User.find({ companyId: companyMatch(t.company), isActive: { $ne: false }, $or: [{ role: { $in: HEAD_ROLES } }, { role: /Head$/ }] }).select('role departmentId').lean();
  return heads.filter((h) => isHead(h) && String(departmentOf(h, depts)?._id || '') === String(t.department._id)).map((h) => h._id);
}
const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

function openBlocker(t, by, reason) {
  t.blocker = { open: true, reason, at: new Date(), byName: by };
  t.blockers.push({ reason, at: new Date(), byName: by });
  if (t.blockers.length > 50) t.blockers.splice(0, t.blockers.length - 50);
  log(t, by, `Blocked: ${reason}`);
}
async function tellBlocked(t) {
  const to = t.assignedBy ? [t.assignedBy] : await headsOf(t);
  for (const u of to) await tell(t, u, `Blocked — ${t.title}`, `${t.personName} is blocked on "${t.title}": ${t.blocker.reason}`);
}

/** The person's daily update on medium / long work: { text, percent, blocker }. Writing again the same day replaces it. */
export async function writeUpdate(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (!r.person) throw new TaskError(403, 'Only the person it is for writes its daily update.');
  if (t.type === 'routine' || !UPDATE_SIZES.includes(t.size)) throw new TaskError(400, 'Daily updates are for medium and long work.');
  if (!OPEN.includes(t.status)) throw new TaskError(400, `It is ${t.status === 'Submitted' ? 'waiting for review' : t.status.toLowerCase()}.`);
  const text = String(body.text || '').trim();
  if (text.length < 3) throw new TaskError(400, 'Write what you did today.');
  let percent = null;
  if (body.percent !== undefined && body.percent !== null && body.percent !== '') {
    if (t.steps.length) throw new TaskError(400, 'This task has steps: tick them instead of giving a %.');
    percent = Number(body.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new TaskError(400, 'The % done is from 0 to 100.');
    percent = Math.round(percent);
  }
  const by = await whoIs(user);
  const day = todayIndia();
  const kept = t.updates.filter((u) => u.day !== day);
  kept.push({ day, at: new Date(), text: text.slice(0, 2000), percent, byName: by });
  t.updates = kept.slice(-300);
  t.lastUpdateDay = day;
  if (percent !== null) t.lastPercent = percent;
  if (t.status === 'Assigned') { t.status = 'InProgress'; t.startedAt = new Date(); }
  log(t, by, 'Daily update');
  const blocker = String(body.blocker || '').trim();
  const newBlock = blocker.length >= 5 && !t.blocker?.open;
  if (blocker && blocker.length < 5) throw new TaskError(400, 'Say what blocks you (a few words).');
  if (newBlock) openBlocker(t, by, blocker.slice(0, 1000));
  await t.save();
  if (newBlock) await tellBlocked(t);
  return view(t, r, await dayCtx(user.companyId));
}

export async function raiseBlocker(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (!r.person) throw new TaskError(403, 'Only the person it is for says it is blocked.');
  if (!OPEN.includes(t.status)) throw new TaskError(400, `It is ${t.status === 'Submitted' ? 'waiting for review' : t.status.toLowerCase()}.`);
  if (t.blocker?.open) throw new TaskError(400, 'It is already marked blocked.');
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) throw new TaskError(400, 'Say what blocks you.');
  openBlocker(t, await whoIs(user), reason.slice(0, 1000));
  await t.save();
  await tellBlocked(t);
  return view(t, r, await dayCtx(user.companyId));
}

export async function clearBlocker(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (!t.blocker?.open) throw new TaskError(400, 'It is not blocked.');
  if (!(r.person || r.giver || r.admin || r.head)) throw new TaskError(403, "You can't clear this blocker.");
  const by = await whoIs(user);
  const note = String(body.note || '').trim().slice(0, 1000);
  t.blocker = { open: false, reason: '', at: null, byName: '' };
  const last = t.blockers[t.blockers.length - 1];
  if (last && !last.clearedAt) { last.clearedAt = new Date(); last.clearedByName = by; last.clearNote = note; }
  log(t, by, `Blocker cleared${note ? `: ${note}` : ''}`);
  await t.save();
  if (!r.person) await tell(t, t.person, `Unblocked — ${t.title}`, `${by} cleared the blocker on "${t.title}"${note ? `: ${note}` : ''}.`);
  return view(t, r, await dayCtx(user.companyId));
}

/** The person ticks a routine item done (a file when the duty needs one); late after its due time. */
export async function tickRoutine(user, id, file = null) {
  const { t, r } = await load(user, id);
  if (!r.person) throw new TaskError(403, 'Only the person it is for ticks it.');
  if (t.type !== 'routine') throw new TaskError(400, 'Only routine items are ticked done.');
  const today = todayIndia();
  if (t.status === 'Missed') throw new TaskError(400, 'Its day has passed: it was missed.');
  if (t.status === 'Assigned' && (t.routine?.day || '') < today) throw new TaskError(400, 'Its day has passed: it was missed.');
  if (t.status === 'Rework' && (t.routine?.redoBy || '') < today) throw new TaskError(400, 'The time to redo it has passed.');
  if (!['Assigned', 'Rework'].includes(t.status)) throw new TaskError(400, 'It is already done.');
  if (t.routine?.needsFile && !file) throw new TaskError(400, 'This duty needs a file: attach it.');
  const by = await whoIs(user);
  const now = new Date();
  const again = t.status === 'Rework';
  t.status = 'Accepted'; t.doneAt = now; if (!t.firstDoneAt) t.firstDoneAt = now; if (!t.startedAt) t.startedAt = now;
  if (file) t.doneFile = { ...file, at: now, byName: by };
  log(t, by, `${again ? 'Done again after it was sent back' : 'Done'}${now > t.dueAt ? ' (late)' : ''}`);
  await t.save();
  return view(t, r, await dayCtx(user.companyId));
}

/** The head (or a top admin) sends a done routine item back within 7 days: { severity, note }. */
export async function sendBackRoutine(user, id, body = {}) {
  const { t, r } = await load(user, id);
  if (t.type !== 'routine') throw new TaskError(400, 'Only routine items are sent back this way.');
  if (!r.review) throw new TaskError(403, r.person ? "You can't send back your own item." : "You can't send this back.");
  if (t.status !== 'Accepted' || !t.doneAt) throw new TaskError(400, 'Only a done item can be sent back.');
  if (Date.now() - t.doneAt.getTime() > SEND_BACK_DAYS * 86400000) throw new TaskError(400, `It can be sent back within ${SEND_BACK_DAYS} days of being done.`);
  if (!['Minor', 'Major'].includes(body.severity)) throw new TaskError(400, 'Say how much rework: Minor or Major.');
  const note = String(body.note || '').trim();
  if (note.length < 5) throw new TaskError(400, 'Say what needs redoing.');
  const by = await whoIs(user);
  t.status = 'Rework';
  t.routine.redoBy = addDays(todayIndia(), 1);
  t.reviews.push({ at: new Date(), byName: by, decision: 'Rework', rating: '', severity: body.severity, note: note.slice(0, 2000) });
  log(t, by, `Sent back (${body.severity}): ${note}`);
  await t.save();
  await tell(t, t.person, `Sent back — ${t.title}`, `${by} sent "${t.title}" (${t.routine.day}) back (${body.severity}): ${note}. Redo it by tomorrow.`);
  return view(t, r, await dayCtx(user.companyId));
}

/** My tasks → Today: routine items, updates to write, due today / overdue, sent back, blocked. Bounded to open work. */
export async function todayFor(user) {
  const ctx = await dayCtx(user.companyId);
  const me = oid(user._id), C = oid(user.companyId);
  const light = '-comments -activity -submissions -dueChanges -updates -blockers';
  const [routine, open] = await Promise.all([
    KraTask.find({ company: C, person: me, type: 'routine', $or: [{ 'routine.day': ctx.today }, { status: 'Rework', 'routine.redoBy': { $gte: ctx.today } }] }).select(light).sort({ dueAt: 1 }).limit(100).lean(),
    KraTask.find({ company: C, person: me, type: { $ne: 'routine' }, status: { $in: OPEN } }).select(light).sort({ dueAt: 1 }).limit(300).lean(),
  ]);
  const r = { person: true, giver: false, admin: false, head: false, review: false, manage: false };
  const v = (t) => view(t, r, ctx);
  const endToday = dayEnd(ctx.today);
  return {
    today: ctx.today, working: ctx.working, onLeave: ctx.leave.has(String(user._id)),
    routine: routine.map(v),
    updates: open.filter((t) => needsUpdate(t, ctx)).map(v),
    due: open.filter((t) => new Date(t.dueAt) <= endToday).map(v),
    sentBack: open.filter((t) => t.status === 'Rework').map(v),
    blocked: open.filter((t) => t.blocker?.open).map(v),
  };
}

// ── Before KRA (decision M): the old tasks, read-only ──
const OLD_HEADS = ['Production Head', 'Packing Head', 'Dispatch Head', 'Accounts Head', 'Sales Head', 'Manager', 'Finance Manager', 'Unit Head', 'Unit Manager', 'Research & Development Head', 'Store Head', 'QC Head'];
const oldDept = (role) => {
  if (!role) return 'General';
  if (role.includes('Production')) return 'Production';
  if (role.includes('Packing')) return 'Packing';
  if (role.includes('Dispatch')) return 'Dispatch';
  if (role.includes('Account') || role.includes('Finance')) return 'Accounts';
  if (role.includes('Sales')) return 'Sales';
  if (role.includes('Research') || role.includes('R&D')) return 'R&D';
  if (role.includes('Store')) return 'Store';
  if (role.includes('QC')) return 'QC';
  return role.replace(/(Head|Manager|Employee)/gi, '').trim() || 'General';
};
export async function legacyTasks(user, { page = 1, limit = 20 } = {}) {
  const q = { companyId: oid(user.companyId) };
  if (!isTopAdmin(user)) {
    if (OLD_HEADS.includes(user.role)) q.department = oldDept(user.role);
    else q.assignedTo = oid(user._id);
  }
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const [rows, total] = await Promise.all([
    Task.find(q).select('title description assignedTo department priority status taskType dueDate createdAt').populate('assignedTo', 'fullName username').sort({ createdAt: -1 }).skip((pg - 1) * lim).limit(lim).lean(),
    Task.countDocuments(q),
  ]);
  return { items: rows.map((t) => ({ ...t, people: (t.assignedTo || []).map((u) => u?.fullName || u?.username).filter(Boolean) })), total, page: pg, limit: lim };
}
