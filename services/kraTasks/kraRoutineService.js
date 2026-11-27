// Feature 25, slice 3 (23 Nov 2026): routine items from the KRA duties HR tracks, and reminders.
// docs/client-features-2026-11/25-kra-slice3-changes.md
//
// Each day, just after midnight (India), runRoutineDay:
//   1. earlier days' routine items still not done become Missed (a sent-back one: after its redo day);
//   2. today's items are made for everyone who can log in, from their KRA in force today, for each
//      duty with "Track daily in My tasks" on — daily on working days, weekly on its day, monthly on
//      its date (a short month: its last day); a weekly / monthly date on a day off moves to the next
//      working day; nothing on the person's leave day (and nothing carried);
//   3. the run is recorded per company and day, so a catch-up after a restart never adds a duty
//      switched on later that day (the switch applies from the next day).
// A unique index (company, person, duty, day) means a re-run never makes a duplicate.
import mongoose from 'mongoose';
import KraTask from '../../models/KraTask.js';
import KraSet from '../../models/KraSet.js';
import User from '../../models/User.js';
import notificationService from '../notificationService.js';
import { kraOfMany } from '../kra/kraService.js';
import { companyDepartments, departmentOf } from '../departmentSeedService.js';
import { calendarFor, previousWorkingDay, onLeave, todayIndia, addDays, weekdayOf, atTime, dayStart, dayEnd } from './kraCalendar.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const runs = () => mongoose.connection.collection('kraroutineruns');
const OPEN = ['Assigned', 'InProgress', 'Rework'];
export const ROUTINE_HOURS = 0.5; // a routine item's weight for slice 4
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const lastDayOfMonth = (day) => { const [y, m] = day.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
/** Is the duty due on `day` (a working day)? Weekly / monthly dates since the previous working day count. */
export function dueOn(duty, day, prevWorking) {
  if (duty.frequency === 'daily') return true;
  const from = prevWorking ? addDays(prevWorking, 1) : day;
  for (let d = from; d <= day; d = addDays(d, 1)) {
    if (duty.frequency === 'weekly' && weekdayOf(d) === Number(duty.weekday)) return true;
    if (duty.frequency === 'monthly' && Number(d.slice(8)) === Math.min(Number(duty.monthDay) || 1, lastDayOfMonth(d))) return true;
  }
  return false;
}
const scheduleText = (duty) => (duty.frequency === 'daily' ? 'every working day'
  : duty.frequency === 'weekly' ? `every ${WEEKDAYS[Number(duty.weekday)] || 'week'}` : `monthly on the ${duty.monthDay}`);

/** Insert, skipping any that already exist (the unique index). Returns how many were made. */
async function insertQuietly(docs) {
  if (!docs.length) return 0;
  try {
    const r = await KraTask.insertMany(docs, { ordered: false });
    return r.length;
  } catch (e) {
    const errs = e?.writeErrors || e?.result?.result?.writeErrors || [];
    const dupOnly = e?.code === 11000 || (errs.length && errs.every((w) => (w.code ?? w.err?.code) === 11000));
    if (!dupOnly) throw e;
    return Math.max(0, docs.length - (errs.length || 0));
  }
}

async function markMissed(C, day) {
  const r = await KraTask.updateMany(
    { company: C, type: 'routine', $or: [{ status: 'Assigned', 'routine.day': { $lt: day } }, { status: 'Rework', 'routine.redoBy': { $lt: day } }] },
    { $set: { status: 'Missed' }, $push: { activity: { at: new Date(), byName: 'System', text: 'Missed: not done by the end of its day' } } },
  );
  return r.modifiedCount || 0;
}

/**
 * The day's run. { companyId } limits it to one company (tests); { force } ignores the run record.
 * Returns [{ company, skipped } | { company, working, created, missed }].
 */
export async function runRoutineDay(day = todayIndia(), { companyId = null, force = false } = {}) {
  const companies = companyId ? [oid(companyId)] : [...new Map([
    ...(await KraSet.distinct('company', { 'items.routine.track': true })),
    ...(await KraTask.distinct('company', { type: 'routine', status: { $in: ['Assigned', 'Rework'] } })),
  ].map((c) => [String(c), oid(c)])).values()];
  const out = [];
  for (const C of companies) {
    const key = `${day}:${C}`;
    if (!force && await runs().findOne({ _id: key })) { out.push({ company: C, skipped: true }); continue; }
    const missed = await markMissed(C, day);
    const cal = await calendarFor(C, day, 35);
    const working = cal.isWorking(day);
    let created = 0;
    if (working) {
      const people = await User.find({ companyId: { $in: [C, String(C)] }, isActive: { $ne: false }, canLogin: { $ne: false } }).select('fullName username role departmentId').lean();
      const [kras, away, depts] = await Promise.all([kraOfMany(C, people, day), onLeave(people.map((p) => p._id), day), companyDepartments(C)]);
      const prev = previousWorkingDay(cal, day);
      const docs = [];
      for (const p of people) {
        if (away.has(String(p._id))) continue;
        const k = kras.get(String(p._id));
        if (!k) continue;
        for (const item of k.items) {
          if (item.builtIn === 'stepWork') continue;
          for (const duty of item.routine || []) {
            if (!duty.track || !dueOn(duty, day, prev)) continue;
            docs.push({
              company: C, person: p._id, personName: p.fullName || p.username, department: departmentOf(p, depts) || { _id: null, name: '' },
              assignedBy: null, assignedByName: 'Routine (from KRA)',
              kra: { setId: k.set._id, version: k.set.version, itemId: item.itemId, name: item.name },
              type: 'routine', title: duty.title, description: `Routine duty, ${scheduleText(duty)}.`, priority: 'Medium',
              effortHours: ROUTINE_HOURS, size: 'short', startDate: dayStart(day), dueAt: atTime(day, duty.dueTime), givenDay: day,
              routine: { dutyId: duty.dutyId, day, needsFile: !!duty.needsFile, redoBy: null },
              activity: [{ at: new Date(), byName: 'System', text: `Made from the KRA duty (${scheduleText(duty)})` }],
            });
          }
        }
      }
      created = await insertQuietly(docs);
    }
    await runs().updateOne({ _id: key }, { $set: { day, company: C, at: new Date(), created, missed, working } }, { upsert: true });
    out.push({ company: C, working, created, missed });
  }
  if (!companyId) await runs().updateOne({ _id: `${day}:all` }, { $set: { day, at: new Date(), companies: out.length } }, { upsert: true });
  return out;
}

/** After a server start: today's run, only if the midnight run never happened today. */
export async function catchUpOnStart() {
  const day = todayIndia();
  if (await runs().findOne({ _id: `${day}:all` })) return { skipped: true };
  return runRoutineDay(day);
}

// ── Reminders: one bell per person per run, working days only, not on their leave day ──
const bell = (userId, companyId, title, message) => notificationService.createNotification({
  title, message, type: 'hrms', icon: 'clipboard', priority: 'medium', targetUserId: userId, targetCompanyId: companyId, data: { kraTasks: true },
}).catch((e) => console.error('[KraTask] reminder failed:', e.message));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * kind 'morning' (9:30): the person — due today, overdue, routine items today; the giver — waiting for
 * review, overdue, blocked. kind 'evening' (17:30): the person — daily updates not written, routine
 * items not done. Returns { bells: [{ userId, title, message }] }.
 */
export async function runReminders(kind, day = todayIndia(), { companyId = null, send = true } = {}) {
  const companies = companyId ? [oid(companyId)] : (await KraTask.distinct('company', { status: { $in: [...OPEN, 'Submitted'] } })).map(oid);
  const bells = [];
  for (const C of companies) {
    const cal = await calendarFor(C, day, 0);
    if (!cal.isWorking(day)) continue;
    const start = dayStart(day), end = dayEnd(day);
    const lines = new Map(); // userId → [text]
    const add = (u, text) => { const k = String(u); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(text); };
    if (kind === 'morning') {
      const [mine, given] = await Promise.all([
        KraTask.aggregate([
          { $match: { company: C, status: { $in: OPEN }, $or: [{ type: { $ne: 'routine' }, dueAt: { $lte: end } }, { type: 'routine', 'routine.day': day }] } },
          { $group: {
            _id: '$person',
            due: { $sum: { $cond: [{ $and: [{ $ne: ['$type', 'routine'] }, { $gte: ['$dueAt', start] }] }, 1, 0] } },
            overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$type', 'routine'] }, { $lt: ['$dueAt', start] }] }, 1, 0] } },
            routine: { $sum: { $cond: [{ $eq: ['$type', 'routine'] }, 1, 0] } },
          } },
        ]),
        KraTask.aggregate([
          { $match: { company: C, assignedBy: { $ne: null }, type: { $ne: 'routine' }, status: { $in: [...OPEN, 'Submitted'] } } },
          { $group: {
            _id: '$assignedBy',
            review: { $sum: { $cond: [{ $eq: ['$status', 'Submitted'] }, 1, 0] } },
            overdue: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN] }, { $lt: ['$dueAt', start] }] }, 1, 0] } },
            blocked: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN] }, { $eq: ['$blocker.open', true] }] }, 1, 0] } },
          } },
        ]),
      ]);
      for (const m of mine) {
        const p = [m.due && `${m.due} due today`, m.overdue && `${m.overdue} overdue`, m.routine && plural(m.routine, 'routine item')].filter(Boolean);
        if (p.length) add(m._id, `Today: ${p.join(', ')}.`);
      }
      for (const g of given) {
        const p = [g.review && `Waiting for your review: ${g.review}`, g.overdue && `Overdue: ${g.overdue}`, g.blocked && `Blocked: ${g.blocked}`].filter(Boolean);
        if (p.length) add(g._id, `Tasks you gave — ${p.join(' · ')}.`);
      }
    } else {
      const [upd, rout] = await Promise.all([
        KraTask.aggregate([
          { $match: { company: C, status: { $in: OPEN }, type: { $ne: 'routine' }, size: { $in: ['medium', 'long'] }, givenDay: { $lt: day }, lastUpdateDay: { $ne: day } } },
          { $sort: { dueAt: 1 } },
          { $group: { _id: '$person', n: { $sum: 1 }, titles: { $push: '$title' } } },
          { $project: { n: 1, titles: { $slice: ['$titles', 3] } } },
        ]),
        KraTask.aggregate([
          { $match: { company: C, type: 'routine', $or: [{ status: 'Assigned', 'routine.day': day }, { status: 'Rework', 'routine.redoBy': day }] } },
          { $group: { _id: '$person', n: { $sum: 1 } } },
        ]),
      ]);
      for (const u of upd) add(u._id, `Write today's update on: ${u.titles.map((x) => `"${x}"`).join(', ')}${u.n > 3 ? ` and ${u.n - 3} more` : ''}.`);
      for (const r of rout) add(r._id, `${plural(r.n, 'routine item')} not done yet.`);
    }
    if (!lines.size) continue;
    const away = await onLeave([...lines.keys()], day);
    const title = kind === 'morning' ? "Today's tasks" : 'Before you finish today';
    for (const [u, texts] of lines) {
      if (away.has(u)) continue;
      const message = texts.join(' ');
      bells.push({ userId: u, company: String(C), title, message });
      if (send) await bell(u, C, title, message);
    }
  }
  return { bells };
}
