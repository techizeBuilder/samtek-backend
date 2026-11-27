// Feature 25, slice 1 (client, 23 Nov 2026): KRAs — set by HR per role, personal changes,
// versions, routine duties with the "Track daily" switch. docs/client-features-2026-11/25-kra-tasks-logic.md
// Later slices reuse kraOf() (the KRA a person has on a date) to check every task is under it
// and to score it.
import mongoose from 'mongoose';
import StepCrewEntry from '../../models/StepCrewEntry.js';
import KraSet from '../../models/KraSet.js';
import User from '../../models/User.js';
import { ROLE_DEPARTMENTS, departmentNameForRole, companyDepartments, departmentOf } from '../departmentSeedService.js';
import { userHasPermission } from '../../middleware/permissions.js';

export class KraError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const IST_MS = 5.5 * 3600 * 1000;
export const todayIndia = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const ADMIN_ROLES = ['Company Admin', 'Super Admin'];
const NOT_KRA_ROLES = ['Company Admin', 'Super Admin', 'Superadmin', 'Admin'];
export const STEP_WORK_NAME = 'Step work (from Process Execution)';
const ROLE_ORDER = ROLE_DEPARTMENTS.flatMap((d) => d.roles);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function whoIs(user) {
  const u = user?._id ? await User.findById(user._id).select('fullName username').lean() : null;
  return u?.fullName || u?.username || user?.username || '';
}
const companyMatch = (companyId) => ({ $in: [oid(companyId), String(companyId)] });

// ── Who may do what ──
export const canViewKra = (user) => ADMIN_ROLES.includes(user?.role) || userHasPermission(user, 'hrms', 'kra', 'view');
export const canEditKra = (user) => ADMIN_ROLES.includes(user?.role) || userHasPermission(user, 'hrms', 'kra', 'edit');
const isHeadRole = (role) => /Head$/.test(String(role || '')) && !!departmentNameForRole(role);

/** HR / the Company Admin, or the head of the person's department (view only), or the person. */
async function mayViewPerson(user, person) {
  if (canViewKra(user) || String(user._id) === String(person._id)) return true;
  if (!isHeadRole(user.role)) return false;
  const dept = departmentOf(person, await companyDepartments(user.companyId));
  return !!dept && dept.name.toLowerCase() === String(departmentNameForRole(user.role)).toLowerCase();
}

// ── Reading versions ──
const latestQ = (q, date) => KraSet.findOne({ ...q, effectiveFrom: { $lte: date } }).sort({ effectiveFrom: -1, version: -1 }).lean();
const upcomingQ = (q, date) => KraSet.findOne({ ...q, effectiveFrom: { $gt: date } }).sort({ effectiveFrom: 1, version: -1 }).lean();
/** The items in force on a date: a temporary item whose end has passed is left out. */
const activeItems = (set, date) => (set?.items || []).filter((i) => !i.endsOn || i.endsOn >= date);
const summary = (s) => (s ? { _id: s._id, version: s.version, effectiveFrom: s.effectiveFrom, followsRole: !!s.followsRole, items: (s.items || []).length, note: s.note, savedByName: s.savedByName, savedAt: s.createdAt } : null);

/**
 * The KRA a person has on a date (default today): { source: 'own' | 'role', set, items } or null.
 * person: a user doc (with _id, role) or an id.
 */
export async function kraOf(companyId, person, date = todayIndia()) {
  const p = person?.role !== undefined ? person : await User.findOne({ _id: person, companyId: companyMatch(companyId) }).select('role').lean();
  if (!p) return null;
  const own = await latestQ({ company: oid(companyId), scope: 'person', person: oid(p._id) }, date);
  if (own && !own.followsRole) return { source: 'own', set: own, items: activeItems(own, date) };
  const roleSet = p.role ? await latestQ({ company: oid(companyId), scope: 'role', role: p.role }, date) : null;
  return roleSet ? { source: 'role', set: roleSet, items: activeItems(roleSet, date) } : null;
}

/**
 * kraOf for many people at once (slice 3's daily routine run): 2 queries, resolved in memory.
 * people: [{ _id, role }]. Returns Map(personId string → { source, set, items } | null).
 */
export async function kraOfMany(companyId, people, date = todayIndia()) {
  const C = oid(companyId);
  const ids = people.map((p) => oid(p._id));
  const roles = [...new Set(people.map((p) => p.role).filter(Boolean))];
  const latest = (match, key) => KraSet.aggregate([
    { $match: { company: C, effectiveFrom: { $lte: date }, ...match } },
    { $sort: { effectiveFrom: -1, version: -1 } },
    { $group: { _id: key, doc: { $first: '$$ROOT' } } },
  ]);
  const [own, roleSets] = await Promise.all([
    ids.length ? latest({ scope: 'person', person: { $in: ids } }, '$person') : [],
    roles.length ? latest({ scope: 'role', role: { $in: roles } }, '$role') : [],
  ]);
  const ownOf = new Map(own.map((r) => [String(r._id), r.doc]));
  const roleOf = new Map(roleSets.map((r) => [r._id, r.doc]));
  const out = new Map();
  for (const p of people) {
    const o = ownOf.get(String(p._id));
    if (o && !o.followsRole) { out.set(String(p._id), { source: 'own', set: o, items: activeItems(o, date) }); continue; }
    const r = p.role ? roleOf.get(p.role) : null;
    out.set(String(p._id), r ? { source: 'role', set: r, items: activeItems(r, date) } : null);
  }
  return out;
}

/** The next change for a person after today (their own, or their role's while they follow it). */
async function upcomingFor(companyId, p, today) {
  const ownNext = await upcomingQ({ company: oid(companyId), scope: 'person', person: oid(p._id) }, today);
  const ownNow = await latestQ({ company: oid(companyId), scope: 'person', person: oid(p._id) }, today);
  const followsRoleNow = !ownNow || ownNow.followsRole;
  const roleNext = followsRoleNow && p.role ? await upcomingQ({ company: oid(companyId), scope: 'role', role: p.role }, today) : null;
  const next = [ownNext, roleNext].filter(Boolean).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  return next ? { ...next, source: next.scope === 'person' ? (next.followsRole ? 'role' : 'own') : 'role' } : null;
}

// ── HR's overview ──
/** Departments → roles, each with people, its current / upcoming version and how many have their own KRA. */
export async function rolesOverview(companyId) {
  const today = todayIndia();
  const C = oid(companyId);
  const [byRole, roleSets, ownSets] = await Promise.all([
    User.aggregate([{ $match: { companyId: companyMatch(companyId), isActive: { $ne: false } } }, { $group: { _id: '$role', n: { $sum: 1 } } }]),
    KraSet.find({ company: C, scope: 'role' }).select('role version effectiveFrom items.itemId items.builtIn').sort({ effectiveFrom: -1, version: -1 }).lean(),
    KraSet.find({ company: C, scope: 'person', effectiveFrom: { $lte: today } }).select('person followsRole effectiveFrom version').sort({ effectiveFrom: -1, version: -1 }).lean(),
  ]);
  // A person's latest own version in force: own KRA unless it follows the role.
  const seen = new Set(), ownPeople = [];
  for (const s of ownSets) { const k = String(s.person); if (seen.has(k)) continue; seen.add(k); if (!s.followsRole) ownPeople.push(s.person); }
  // Slice 4: roles whose people worked on a step in the last 30 days (Step work should be in their KRA).
  const stepPeople = await StepCrewEntry.distinct('person', { company: C, joinedAt: { $gte: new Date(Date.now() - 30 * 86400000) } });
  const stepRoles = new Set(stepPeople.length ? (await User.find({ _id: { $in: stepPeople }, isActive: { $ne: false } }).select('role').lean()).map((u) => u.role) : []);
  const ownRoles = ownPeople.length ? await User.find({ _id: { $in: ownPeople }, isActive: { $ne: false } }).select('role').lean() : [];
  const ownCount = new Map();
  for (const u of ownRoles) ownCount.set(u.role, (ownCount.get(u.role) || 0) + 1);
  const peopleOf = new Map(byRole.map((r) => [r._id, r.n]));
  const setOf = (role) => {
    const sets = roleSets.filter((s) => s.role === role);
    const cur = sets.find((s) => s.effectiveFrom <= today);
    const next = sets.filter((s) => s.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
    return {
      current: cur ? { version: cur.version, effectiveFrom: cur.effectiveFrom, items: cur.items.length } : null,
      stepsNoStepWork: !!cur && stepRoles.has(role) && !cur.items.some((i) => i.builtIn === 'stepWork'),
      upcoming: next ? { version: next.version, effectiveFrom: next.effectiveFrom, items: next.items.length } : null,
    };
  };
  const row = (role) => ({ role, people: peopleOf.get(role) || 0, ownKra: ownCount.get(role) || 0, ...setOf(role) });
  const departments = ROLE_DEPARTMENTS.map((d) => ({ name: d.name, roles: d.roles.map(row) }));
  const others = [...peopleOf.keys()].filter((r) => r && !ROLE_ORDER.includes(r) && !NOT_KRA_ROLES.includes(r) && !departmentNameForRole(r)).sort();
  // Roles named under an older alias (Packing Head …) join their department.
  for (const r of [...peopleOf.keys()].filter((x) => x && !ROLE_ORDER.includes(x) && departmentNameForRole(x))) {
    departments.find((d) => d.name === departmentNameForRole(r))?.roles.push(row(r));
  }
  if (others.length) departments.push({ name: 'Other roles', roles: others.map(row) });
  return { departments, today };
}

/** One role: its current and upcoming version, its history, its people (paged) and who has their own KRA. */
export async function roleKra(companyId, role, { page = 1, search = '', limit = 20 } = {}) {
  const today = todayIndia();
  const C = oid(companyId);
  const q = { company: C, scope: 'role', role };
  const [current, upcoming, history] = await Promise.all([
    latestQ(q, today), upcomingQ(q, today),
    KraSet.find(q).select('version effectiveFrom note savedByName createdAt items.itemId').sort({ effectiveFrom: -1, version: -1 }).limit(50).lean(),
  ]);
  const lim = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const pg = Math.max(1, parseInt(page, 10) || 1);
  const pq = { companyId: companyMatch(companyId), role, isActive: { $ne: false } };
  if (String(search || '').trim()) pq.fullName = new RegExp(esc(String(search).trim()), 'i');
  const [people, total, allInRole] = await Promise.all([
    User.find(pq).select('fullName username employeeId').sort({ fullName: 1 }).skip((pg - 1) * lim).limit(lim).lean(),
    User.countDocuments(pq),
    User.find({ companyId: companyMatch(companyId), role, isActive: { $ne: false } }).select('_id fullName username').lean(),
  ]);
  const own = await ownNow(companyId, allInRole.map((u) => u._id), today);
  return {
    role, today, current, upcoming,
    history: history.map((h) => ({ _id: h._id, version: h.version, effectiveFrom: h.effectiveFrom, note: h.note, savedByName: h.savedByName, savedAt: h.createdAt, items: h.items.length })),
    people: people.map((u) => ({ _id: u._id, name: u.fullName || u.username, employeeId: u.employeeId || '', ownKra: own.has(String(u._id)) })),
    total, page: pg, limit: lim,
    // Everyone in the role with their own KRA (few), for "keep theirs / follow the role" on save.
    ownPeople: allInRole.filter((u) => own.has(String(u._id))).map((u) => ({ _id: u._id, name: u.fullName || u.username })),
  };
}

/** The people (of a list) whose own KRA is in force today (not "follows the role"). */
async function ownNow(companyId, ids, today) {
  if (!ids.length) return new Set();
  const sets = await KraSet.find({ company: oid(companyId), scope: 'person', person: { $in: ids }, effectiveFrom: { $lte: today } })
    .select('person followsRole effectiveFrom version').sort({ effectiveFrom: -1, version: -1 }).lean();
  const seen = new Set(), out = new Set();
  for (const s of sets) { const k = String(s.person); if (seen.has(k)) continue; seen.add(k); if (!s.followsRole) out.add(k); }
  return out;
}

// ── Saving ──
/** Validates items; keeps the ids of items / duties the role (or person) had before; returns clean items. */
function cleanItems(items, effectiveFrom, knownIds) {
  if (!Array.isArray(items) || items.length < 1) throw new KraError(400, 'Add at least one KRA item.');
  if (items.length > 10) throw new KraError(400, 'At most 10 KRA items (3 to 7 works best).');
  const names = new Set();
  let total = 0, stepWork = 0;
  const out = items.map((raw, i) => {
    const n = i + 1;
    const builtIn = raw?.builtIn === 'stepWork' ? 'stepWork' : null;
    if (builtIn) stepWork++;
    const name = builtIn ? STEP_WORK_NAME : String(raw?.name || '').trim();
    if (name.length < 2) throw new KraError(400, `Item ${n}: give it a name.`);
    if (name.length > 80) throw new KraError(400, `Item ${n}: the name is too long (80 characters at most).`);
    if (names.has(name.toLowerCase())) throw new KraError(400, `"${name}" is in the list twice.`);
    names.add(name.toLowerCase());
    const weight = Number(raw?.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) throw new KraError(400, `"${name}": the weight must be a whole number from 1 to 100.`);
    total += weight;
    const endsOn = raw?.endsOn ? String(raw.endsOn) : null;
    if (endsOn && (!DATE_RE.test(endsOn) || endsOn < effectiveFrom)) throw new KraError(400, `"${name}": the end date must be on or after the date it applies from.`);
    const duties = Array.isArray(raw?.routine) ? raw.routine : [];
    if (duties.length > 10) throw new KraError(400, `"${name}": at most 10 routine duties.`);
    const routine = duties.map((d, j) => {
      const title = String(d?.title || '').trim();
      const where = `"${name}", routine duty ${j + 1}`;
      if (title.length < 2) throw new KraError(400, `${where}: give it a title.`);
      if (!['daily', 'weekly', 'monthly'].includes(d?.frequency)) throw new KraError(400, `${where}: pick working days, weekly or monthly.`);
      const weekday = d.frequency === 'weekly' ? Number(d.weekday) : null;
      if (d.frequency === 'weekly' && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw new KraError(400, `${where}: pick the day of the week.`);
      const monthDay = d.frequency === 'monthly' ? Number(d.monthDay) : null;
      if (d.frequency === 'monthly' && !(Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 31)) throw new KraError(400, `${where}: pick the day of the month (1 to 31).`);
      const dueTime = String(d?.dueTime || '18:00');
      if (!TIME_RE.test(dueTime)) throw new KraError(400, `${where}: the due time must look like 18:00.`);
      const dutyId = d?.dutyId && knownIds.has(String(d.dutyId)) ? oid(d.dutyId) : new mongoose.Types.ObjectId();
      return { dutyId, title: title.slice(0, 120), frequency: d.frequency, weekday, monthDay, dueTime, track: !!d.track, needsFile: !!d.needsFile };
    });
    const itemId = raw?.itemId && knownIds.has(String(raw.itemId)) ? oid(raw.itemId) : new mongoose.Types.ObjectId();
    return {
      itemId, name, builtIn, weight, endsOn,
      description: String(raw?.description || '').trim().slice(0, 1000),
      kpi: String(raw?.kpi || '').trim().slice(0, 300),
      routine,
    };
  });
  if (stepWork > 1) throw new KraError(400, 'Step work can be in the list only once.');
  if (total !== 100) throw new KraError(400, `The weights add up to ${total}%: they must add up to 100%.`);
  return out;
}
function checkDate(effectiveFrom) {
  const d = String(effectiveFrom || todayIndia());
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(d))) throw new KraError(400, 'Pick the date it applies from.');
  if (d < todayIndia()) throw new KraError(400, "It can't apply from a past date: earlier months keep the KRA they had.");
  return d;
}
/** Every item / duty id this role (and, for a person, they themselves) ever had: kept on save. */
async function knownIdsFor(companyId, { role = null, person = null }) {
  const or = [];
  if (role) or.push({ scope: 'role', role });
  if (person) or.push({ scope: 'person', person: oid(person) });
  const sets = or.length ? await KraSet.find({ company: oid(companyId), $or: or }).select('items.itemId items.routine.dutyId').lean() : [];
  const ids = new Set();
  for (const s of sets) for (const i of s.items || []) { ids.add(String(i.itemId)); for (const d of i.routine || []) ids.add(String(d.dutyId)); }
  return ids;
}
const nextVersion = async (q) => ((await KraSet.findOne(q).sort({ version: -1 }).select('version').lean())?.version || 0) + 1;
async function knownRole(companyId, role) {
  const r = String(role || '').trim();
  if (!r || r.length > 80 || NOT_KRA_ROLES.includes(r)) throw new KraError(400, 'Pick a role.');
  if (ROLE_ORDER.includes(r) || departmentNameForRole(r)) return r;
  if (await User.exists({ companyId: companyMatch(companyId), role: r })) return r;
  throw new KraError(404, `Nobody in the company has the role "${r}".`);
}

/**
 * HR saves a role's KRA: a new version from a date. body: { items, effectiveFrom, note,
 * people: [{ person, action: 'keep' | 'follow' }] } — people with their own KRA in this role
 * who should follow the role's set from that date.
 */
export async function saveRoleKra(user, role, body = {}) {
  const r = await knownRole(user.companyId, role);
  const effectiveFrom = checkDate(body.effectiveFrom);
  const items = cleanItems(body.items, effectiveFrom, await knownIdsFor(user.companyId, { role: r }));
  const by = await whoIs(user);
  const C = oid(user.companyId);
  const doc = await KraSet.create({
    company: C, scope: 'role', role: r, version: await nextVersion({ company: C, scope: 'role', role: r }),
    effectiveFrom, items, note: String(body.note || '').trim().slice(0, 300), savedBy: user._id, savedByName: by,
  });
  const follow = (Array.isArray(body.people) ? body.people : []).filter((p) => p?.action === 'follow' && mongoose.isValidObjectId(p.person));
  let followed = 0;
  for (const p of follow) {
    const person = await User.findOne({ _id: p.person, companyId: companyMatch(user.companyId), role: r }).select('_id').lean();
    if (!person) continue;
    await KraSet.create({
      company: C, scope: 'person', person: person._id, version: await nextVersion({ company: C, scope: 'person', person: person._id }),
      effectiveFrom, followsRole: true, items: [], note: `Follows the ${r} KRA (v${doc.version})`, savedBy: user._id, savedByName: by,
    });
    followed++;
  }
  return { set: doc, followed };
}

/** One person's KRA: in force now (and from where), the next change, their own history and their role's. */
export async function personKra(user, personId) {
  if (!mongoose.isValidObjectId(personId)) throw new KraError(404, 'Person not found');
  const p = await User.findOne({ _id: personId, companyId: companyMatch(user.companyId) }).select('fullName username role departmentId employeeId').lean();
  if (!p) throw new KraError(404, 'Person not found');
  if (!(await mayViewPerson(user, p))) throw new KraError(403, "You can't see this person's KRA.");
  const today = todayIndia();
  const C = oid(user.companyId);
  const [now, upcoming, own, roleHistory] = await Promise.all([
    kraOf(user.companyId, p, today), upcomingFor(user.companyId, p, today),
    KraSet.find({ company: C, scope: 'person', person: p._id }).sort({ effectiveFrom: -1, version: -1 }).limit(50).lean(),
    p.role ? KraSet.find({ company: C, scope: 'role', role: p.role }).select('version effectiveFrom note savedByName createdAt items.itemId').sort({ effectiveFrom: -1, version: -1 }).limit(50).lean() : [],
  ]);
  return {
    person: { _id: p._id, name: p.fullName || p.username, role: p.role, employeeId: p.employeeId || '' },
    today, now, upcoming,
    ownHistory: own.map(summary),
    roleHistory: roleHistory.map((h) => ({ _id: h._id, version: h.version, effectiveFrom: h.effectiveFrom, note: h.note, savedByName: h.savedByName, savedAt: h.createdAt, items: h.items.length })),
    canEdit: canEditKra(user),
  };
}

/** HR gives a person their own KRA (a new version), or puts them back on their role's: { followsRole: true }. */
export async function savePersonKra(user, personId, body = {}) {
  if (!mongoose.isValidObjectId(personId)) throw new KraError(404, 'Person not found');
  const p = await User.findOne({ _id: personId, companyId: companyMatch(user.companyId) }).select('role').lean();
  if (!p) throw new KraError(404, 'Person not found');
  const effectiveFrom = checkDate(body.effectiveFrom);
  const C = oid(user.companyId);
  const base = { company: C, scope: 'person', person: p._id, version: await nextVersion({ company: C, scope: 'person', person: p._id }), effectiveFrom, note: String(body.note || '').trim().slice(0, 300), savedBy: user._id, savedByName: await whoIs(user) };
  if (body.followsRole) {
    if (!p.role) throw new KraError(400, 'This person has no role to follow.');
    return KraSet.create({ ...base, followsRole: true, items: [] });
  }
  // Their own copy keeps the role's item ids, so tasks stay linked whichever set they're on.
  const items = cleanItems(body.items, effectiveFrom, await knownIdsFor(user.companyId, { role: p.role, person: p._id }));
  return KraSet.create({ ...base, items });
}

/** The logged-in person's own KRA (My tasks). */
export async function myKra(user) {
  const today = todayIndia();
  const p = await User.findOne({ _id: user._id, companyId: companyMatch(user.companyId) }).select('fullName username role').lean();
  if (!p) throw new KraError(404, 'Not found');
  const [now, upcoming] = await Promise.all([kraOf(user.companyId, p, today), upcomingFor(user.companyId, p, today)]);
  return { today, now, upcoming };
}

/** A version in full (history). HR / the Company Admin, or the person it's about (or on their role). */
export async function versionOf(user, setId) {
  if (!mongoose.isValidObjectId(setId)) throw new KraError(404, 'Not found');
  const s = await KraSet.findOne({ _id: setId, company: oid(user.companyId) }).lean();
  if (!s) throw new KraError(404, 'Not found');
  if (canViewKra(user)) return s;
  if (s.scope === 'person') {
    const p = await User.findOne({ _id: s.person, companyId: companyMatch(user.companyId) }).select('role departmentId').lean();
    if (p && await mayViewPerson(user, p)) return s;
  } else if (s.role === user.role) return s;
  throw new KraError(403, "You can't see this KRA.");
}
