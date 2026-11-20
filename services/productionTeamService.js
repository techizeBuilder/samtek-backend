// Teams from people (2026-11-11): Production builds a team only from people HR
// entered, in the Production department, never the Production Head; one person,
// one team; the supervisor is one of the team's people. The names are copied
// onto the team (supervisor, members) so every screen that shows them keeps
// working. Logic: docs/client-features-2026-11/02d-teams-from-people-logic.md
import mongoose from 'mongoose';
import ProductionTeam from '../models/ProductionTeam.js';
import ProductionOrder from '../models/ProductionOrder.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import ProcessCategoryOption from '../models/ProcessCategoryOption.js';
import { Item } from '../models/Inventory.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';

export class TeamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const HEAD_ROLE = 'Production Head';
const PRODUCTION_DEPT = /^production\b/i;
const nameOf = (u) => u?.fullName || u?.username || 'Unknown';
const idStr = (v) => String(v?._id || v || '');
const isId = (v) => mongoose.isValidObjectId(String(v || ''));
const skillKey = (s) => String(s || '').trim().toLowerCase();
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Skills (2026-11-12): a person's skills are Process Template step names ───

/** Every step in skills, once each (ignoring case), sorted by name. */
export function unionSkills(lists) {
  const seen = new Map();
  for (const list of lists) for (const s of list || []) {
    const k = skillKey(s);
    if (k && !seen.has(k)) seen.set(k, String(s).trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// The company's template step names, as lower-case keys.
async function templateStepKeys(companyId) {
  const keys = new Set();
  for (const t of await ProcessCategoryOption.find({ companyId }).select('internalProcesses').lean()) {
    for (const s of t.internalProcesses || []) if (skillKey(s)) keys.add(skillKey(s));
  }
  return keys;
}

/**
 * The skill list: every Process Template step (all three levels), each name once,
 * with where a BOM uses it In-House. A step used In-House by a BOM but no longer
 * in any template is listed too, marked inTemplates: false. Same idea as the
 * vendor Services list (supplierController getSupplierCatalog), for In-House.
 */
export async function skillCatalog(companyId) {
  const byKey = new Map();
  const entryFor = (name) => {
    const k = skillKey(name);
    if (!byKey.has(k)) byKey.set(k, { name: String(name).trim(), inTemplates: false, templates: [], inHouseIn: [] });
    return byKey.get(k);
  };
  for (const t of await ProcessCategoryOption.find({ companyId }).lean()) {
    for (const s of t.internalProcesses || []) {
      if (!skillKey(s)) continue;
      const e = entryFor(s);
      e.inTemplates = true;
      e.templates.push({ bomLevel: t.bomLevel, category: t.label });
    }
  }
  const addUsage = (bomLevel, part, definition) => {
    if (!part) return;
    for (const cat of definition || []) for (const step of cat.internalProcesses || []) {
      if (step.type !== 'InHouse' || !skillKey(step.name)) continue;
      const e = entryFor(step.name);
      if (!e.inHouseIn.some((u) => String(u._id) === String(part._id))) e.inHouseIn.push({ _id: part._id, code: part.code, name: part.name, bomLevel });
    }
  };
  const notDiscontinued = { isDiscontinued: { $ne: true } };
  const [subChildParts, childPartBoms, machineBoms] = await Promise.all([
    Item.find({ companyId, productKind: 'SubChildPart', ...notDiscontinued }).select('code name subChildPartDetails.processDefinition').lean(),
    ChildPartBOM.find({ company: companyId }).select('childPart processDefinition').populate('childPart', 'code name isDiscontinued').lean(),
    MachineBOM.find({ company: companyId }).select('machine processDefinition').populate('machine', 'code name isDiscontinued').lean(),
  ]);
  subChildParts.forEach((p) => addUsage('SubChildPart', p, p.subChildPartDetails?.processDefinition));
  childPartBoms.forEach((b) => { if (!b.childPart?.isDiscontinued) addUsage('ChildPart', b.childPart, b.processDefinition); });
  machineBoms.forEach((b) => { if (!b.machine?.isDiscontinued) addUsage('Machine', b.machine, b.processDefinition); });
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Re-works the copied skills of the active teams these people are in.
async function refreshTeamSkills(companyId, personIds) {
  const teams = await ProductionTeam.find({ company: companyId, isActive: true, people: { $in: personIds } }).select('people skills').lean();
  for (const t of teams) {
    const members = await User.find({ _id: { $in: t.people } }).select('productionSkills').lean();
    const skills = unionSkills(members.map((m) => m.productionSkills));
    if (skills.join('\u0000') !== (t.skills || []).join('\u0000')) await ProductionTeam.updateOne({ _id: t._id }, { $set: { skills } });
  }
}

/** Production sets one person's skills. Only Production people; names from the skill list. */
export async function setPersonSkills(companyId, userId, skills, { by = null } = {}) {
  if (!isId(userId)) throw new TeamError(404, 'Person not found');
  const person = await User.findOne({ _id: userId, companyId }).select('fullName username productionSkills').lean();
  if (!person) throw new TeamError(404, 'Person not found');
  if (!(await User.exists({ _id: userId, ...(await eligiblePeopleQuery(companyId)) }))) {
    throw new TeamError(400, `${nameOf(person)} isn't in the Production department, so can't be given production skills`);
  }
  const raw = (Array.isArray(skills) ? skills : []).map((s) => String(s || '').trim()).filter(Boolean);
  if (new Set(raw.map(skillKey)).size !== raw.length) throw new TeamError(400, 'The same skill is picked twice');
  const catalog = new Map((await skillCatalog(companyId)).map((e) => [skillKey(e.name), e.name]));
  const had = new Map((person.productionSkills || []).map((s) => [skillKey(s), s]));
  const saved = raw.map((s) => {
    if (catalog.has(skillKey(s))) return catalog.get(skillKey(s));
    if (had.has(skillKey(s))) return had.get(skillKey(s)); // kept although it left the templates
    throw new TeamError(400, `"${s}" isn't a step in the Process Templates`);
  });
  // Feature 13 (2026-11-17): when each new skill was added, for the scorecard's Learning.
  const added = saved.filter((s) => !had.has(skillKey(s))).map((skill) => ({ skill, at: new Date(), by }));
  await User.updateOne({ _id: userId }, { $set: { productionSkills: saved }, ...(added.length ? { $push: { productionSkillsAdded: { $each: added } } } : {}) });
  await refreshTeamSkills(companyId, [person._id]);
  return { skills: saved };
}

/**
 * R&D renamed a template step. If the old name is gone from every template, people
 * who had it get the new name; if another template still has it, it stays valid.
 */
export async function followTemplateRename(companyId, oldName, newName) {
  const exact = new RegExp(`^${escapeRe(String(oldName).trim())}$`, 'i');
  if (await ProcessCategoryOption.exists({ companyId, internalProcesses: exact })) return { renamed: 0 };
  const people = await User.find({ companyId, productionSkills: exact }).select('productionSkills').lean();
  for (const p of people) {
    const next = unionSkills([(p.productionSkills || []).map((s) => (skillKey(s) === skillKey(oldName) ? String(newName).trim() : s))]);
    await User.updateOne({ _id: p._id }, { $set: { productionSkills: next } });
  }
  if (people.length) await refreshTeamSkills(companyId, people.map((p) => p._id));
  return { renamed: people.length };
}

export async function productionDepartmentIds(companyId) {
  return Department.find({ companyId, name: PRODUCTION_DEPT }).distinct('_id');
}

export async function eligiblePeopleQuery(companyId) {
  return {
    companyId,
    departmentId: { $in: await productionDepartmentIds(companyId) },
    isActive: { $ne: false },
    role: { $ne: HEAD_ROLE },
  };
}

// The active team each of these people is in, if any.
async function teamsOfPeople(companyId, ids, exceptTeamId) {
  const teams = await ProductionTeam.find({
    company: companyId, isActive: true, people: { $in: ids },
    ...(exceptTeamId ? { _id: { $ne: exceptTeamId } } : {}),
  }).select('name people').lean();
  const of = new Map();
  for (const t of teams) for (const p of t.people || []) of.set(String(p), { _id: t._id, name: t.name });
  return of;
}

/** The picker: Production people, searched and paged on the server. Never contact details or pay. */
export async function searchTeamPeople(companyId, { search = '', page = 1, limit = 20 } = {}) {
  const q = await eligiblePeopleQuery(companyId);
  const s = String(search || '').trim();
  if (s) {
    const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ fullName: re }, { employeeId: re }, { deviceCode: re }, { username: re }];
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(20, Math.max(1, parseInt(limit, 10) || 20));
  const [rows, total] = await Promise.all([
    User.find(q).select('fullName username employeeId role canLogin designationId productionSkills').sort({ fullName: 1 })
      .skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    User.countDocuments(q),
  ]);
  const [designations, teamOf] = await Promise.all([
    Designation.find({ _id: { $in: rows.map((r) => r.designationId).filter(Boolean) } }).select('name').lean(),
    teamsOfPeople(companyId, rows.map((r) => r._id)),
  ]);
  const desig = new Map(designations.map((d) => [String(d._id), d.name]));
  return {
    people: rows.map((r) => ({
      _id: r._id, name: nameOf(r), employeeId: r.employeeId, role: r.role,
      designation: desig.get(String(r.designationId)) || null,
      canLogin: r.canLogin !== false,
      skills: r.productionSkills || [],
      team: teamOf.get(String(r._id)) || null,
    })),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 1 },
  };
}

/**
 * Checks a team's name, people and supervisor. Returns what to save, including
 * the names copied for the screens that show them.
 */
export async function validateTeamBody(companyId, body = {}, editingTeamId = null) {
  const name = String(body.name || '').trim();
  if (!name) throw new TeamError(400, 'The team needs a name');
  const raw = Array.isArray(body.people) ? body.people.map(idStr).filter(Boolean) : [];
  if (!raw.length) throw new TeamError(400, 'Pick at least one person');
  if (raw.some((id) => !isId(id))) throw new TeamError(400, 'Someone picked was not found');
  if (new Set(raw).size !== raw.length) throw new TeamError(400, 'The same person is picked twice');
  const supervisorId = idStr(body.supervisorPerson);
  if (!supervisorId) throw new TeamError(400, 'Tick one of the people as supervisor');
  if (!raw.includes(supervisorId)) throw new TeamError(400, "The supervisor must be one of the team's people");

  const people = await User.find({ _id: { $in: raw } }).select('fullName username companyId departmentId isActive role productionSkills').lean();
  const deptIds = new Set((await productionDepartmentIds(companyId)).map(String));
  const byId = new Map(people.map((p) => [String(p._id), p]));
  for (const id of raw) {
    const p = byId.get(id);
    if (!p || String(p.companyId) !== String(companyId)) throw new TeamError(400, 'Someone picked was not found');
    if (p.role === HEAD_ROLE) throw new TeamError(400, `${nameOf(p)} is the Production Head and can't be in a team`);
    if (p.isActive === false) throw new TeamError(400, `${nameOf(p)} is inactive`);
    if (!deptIds.has(String(p.departmentId))) throw new TeamError(400, `${nameOf(p)} isn't in the Production department`);
  }
  const taken = await teamsOfPeople(companyId, raw, editingTeamId);
  for (const id of raw) {
    const t = taken.get(id);
    if (t) throw new TeamError(400, `${nameOf(byId.get(id))} is already in ${t.name}. Take them out of that team first.`);
  }

  // A team's skills are worked out from its people (2026-11-12); any sent are ignored.
  const skills = unionSkills(raw.map((id) => byId.get(id)?.productionSkills));
  return {
    name,
    people: raw.map((id) => new mongoose.Types.ObjectId(id)),
    supervisorPerson: new mongoose.Types.ObjectId(supervisorId),
    supervisor: nameOf(byId.get(supervisorId)),
    members: raw.map((id) => nameOf(byId.get(id))),
    skills,
  };
}

/**
 * Adds each team's people (name, Employee ID, designation, login, and flags if they
 * left Production or were deactivated), and refreshes the copied names when HR
 * changed one. Old typed teams (no people) pass through unchanged.
 */
export async function decorateTeams(companyId, teams) {
  const ids = [...new Set(teams.flatMap((t) => (t.people || []).map(String)))];
  if (!ids.length) return teams.map((t) => ({ ...t, peopleInfo: [] }));
  const [users, deptIds, templateKeys] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('fullName username employeeId canLogin isActive departmentId designationId role productionSkills').lean(),
    productionDepartmentIds(companyId),
    templateStepKeys(companyId),
  ]);
  const desig = new Map((await Designation.find({ _id: { $in: users.map((u) => u.designationId).filter(Boolean) } }).select('name').lean()).map((d) => [String(d._id), d.name]));
  const inProd = new Set(deptIds.map(String));
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const out = [];
  for (const t of teams) {
    const peopleInfo = (t.people || []).map((p) => {
      const u = byId.get(String(p));
      return {
        _id: p, name: u ? nameOf(u) : 'Removed person', employeeId: u?.employeeId,
        designation: u ? desig.get(String(u.designationId)) || null : null,
        canLogin: u ? u.canLogin !== false : false,
        supervisor: String(p) === String(t.supervisorPerson),
        skills: u?.productionSkills || [],
        staleSkills: (u?.productionSkills || []).filter((s) => !templateKeys.has(skillKey(s))),
        inactive: !u || u.isActive === false,
        notInProduction: !!u && !inProd.has(String(u.departmentId)),
      };
    });
    if (peopleInfo.length) {
      const members = peopleInfo.map((p) => p.name);
      const supervisor = peopleInfo.find((p) => p.supervisor)?.name || t.supervisor;
      const skills = unionSkills(peopleInfo.map((p) => p.skills));
      if (supervisor !== t.supervisor || members.join('\u0000') !== (t.members || []).join('\u0000') || skills.join('\u0000') !== (t.skills || []).join('\u0000')) {
        await ProductionTeam.updateOne({ _id: t._id }, { $set: { supervisor, members, skills } });
        t.supervisor = supervisor; t.members = members; t.skills = skills;
      }
    }
    out.push({ ...t, peopleInfo });
  }
  return out;
}

// A step with this team still being worked or waiting for QC.
export async function teamIsBusy(teamId) {
  const busy = { assignedTeam: teamId, status: { $in: ['In Progress', 'QC Pending'] } };
  return !!(await ProductionOrder.exists({ $or: [{ processes: { $elemMatch: busy } }, { 'extraUnits.processes': { $elemMatch: busy } }] }));
}

/** Assigning: nothing (to unassign) or an active team of this company. */
export async function assertAssignableTeam(teamId, companyId) {
  if (!teamId) return;
  const ok = isId(teamId) && await ProductionTeam.exists({ _id: teamId, company: companyId, isActive: true });
  if (!ok) throw new TeamError(400, "That team isn't available. It may have been retired; pick another.");
}

/**
 * The Skill Matrix (2026-11-13): each member of an active team with their skills,
 * grouped by team (teams in the order they were made, people by name), searched
 * by name / Employee ID and paged here — it grows with headcount.
 */
export async function skillMatrixRows(companyId, { search = '', page = 1, limit = 25 } = {}) {
  const teams = await ProductionTeam.find({ company: companyId, isActive: true }).select('name people supervisorPerson').sort({ createdAt: 1 }).lean();
  const ids = [...new Set(teams.flatMap((t) => (t.people || []).map(String)))];
  const q = { _id: { $in: ids } };
  const s = String(search || '').trim();
  if (s) {
    const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ fullName: re }, { username: re }, { employeeId: re }];
  }
  const users = new Map((await User.find(q).select('fullName username employeeId productionSkills').lean()).map((u) => [String(u._id), u]));
  const all = [];
  for (const t of teams) {
    const mine = (t.people || []).map(String).filter((p) => users.has(p))
      .sort((a, b) => nameOf(users.get(a)).localeCompare(nameOf(users.get(b))));
    for (const p of mine) all.push({ t, u: users.get(p) });
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  return {
    total: all.length, page: pageNum, limit: limitNum,
    rows: all.slice((pageNum - 1) * limitNum, pageNum * limitNum).map(({ t, u }) => ({
      team: { _id: t._id, name: t.name },
      person: { _id: u._id, name: nameOf(u), employeeId: u.employeeId, supervisor: String(u._id) === String(t.supervisorPerson), skills: u.productionSkills || [] },
    })),
  };
}
