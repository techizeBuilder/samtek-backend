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

export class TeamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const HEAD_ROLE = 'Production Head';
const PRODUCTION_DEPT = /^production\b/i;
const nameOf = (u) => u?.fullName || u?.username || 'Unknown';
const idStr = (v) => String(v?._id || v || '');
const isId = (v) => mongoose.isValidObjectId(String(v || ''));

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
    User.find(q).select('fullName username employeeId role canLogin designationId').sort({ fullName: 1 })
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

  const people = await User.find({ _id: { $in: raw } }).select('fullName username companyId departmentId isActive role').lean();
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

  const skills = Array.isArray(body.skills) ? body.skills.map(String) : [];
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
  const [users, deptIds] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('fullName username employeeId canLogin isActive departmentId designationId role').lean(),
    productionDepartmentIds(companyId),
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
        inactive: !u || u.isActive === false,
        notInProduction: !!u && !inProd.has(String(u.departmentId)),
      };
    });
    if (peopleInfo.length) {
      const members = peopleInfo.map((p) => p.name);
      const supervisor = peopleInfo.find((p) => p.supervisor)?.name || t.supervisor;
      if (supervisor !== t.supervisor || members.join('\u0000') !== (t.members || []).join('\u0000')) {
        await ProductionTeam.updateOne({ _id: t._id }, { $set: { supervisor, members } });
        t.supervisor = supervisor; t.members = members;
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
