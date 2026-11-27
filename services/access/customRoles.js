// Feature 34 (26 Nov 2026): custom roles that work. docs/client-features-2026-11/34-custom-roles-logic.md
//
// A custom role is a named, cut-down version of ONE built-in role (its base role). The person's real
// `role` is the base role, so every page and route check works unchanged; `customRoleId` /
// `customRoleName` say which custom role they're on. Their permissions can never go beyond the custom
// role's `allowed` list: every save is trimmed here, whoever sends it, and again at each server start
// (after the one-time grants, which give pages by role).
import mongoose from 'mongoose';
import User from '../../models/User.js';
import AdminSettings from '../../models/AdminSettings.js';
import { isSuperAdmin, COMPANY_ADMIN } from './companyAccess.js';
import { HEAD_ROLES } from './headApproval.js';
import { applyRoleLimits } from './roleLimits.js';

// Decision A: the department roles (Heads and Employees), Manager and Employee. Not the admin roles:
// their powers come with the name and no switch limits them.
export const CUSTOM_BASE_ROLES = [
  'Sales Head', 'Production Head', 'Dispatch Head', 'Accounts Head', 'Research & Development Head',
  'Complaint Management Head', 'Store Head', 'QC Head', 'Marketing Head',
  'Sales Employee', 'Production Employee', 'Dispatch Employee', 'Account Employee', 'Research Development Employee',
  'Complaint Management Employee', 'Store Employee', 'QC Employee', 'Marketing Employee',
  'Manager', 'Employee',
];

// The modules each base role's permissions can hold: the client's ROLE_MODULE_MAP
// (lib/roleModulesConfig.js) for these roles. Suite hrperms checks the two match.
export const ROLE_MODULES = {
  'Sales Head': ['sales'], 'Sales Employee': ['sales'],
  'Production Head': ['production'], 'Production Employee': ['production'],
  'Dispatch Head': ['dispatches'], 'Dispatch Employee': ['dispatches'],
  'Accounts Head': ['accounts', 'purchase'], 'Account Employee': ['accounts', 'purchase'],
  'Research & Development Head': ['rnd'], 'Research Development Employee': ['rnd'],
  'Complaint Management Head': ['complaints'], 'Complaint Management Employee': ['complaints'],
  'Store Head': ['Store', 'rnd'], 'Store Employee': ['Store', 'rnd'],
  'QC Head': ['quality-control'], 'QC Employee': ['quality-control'],
  'Marketing Head': ['marketing'], 'Marketing Employee': ['marketing'],
  Manager: ['hrms'],
  Employee: [],
};

export const isHeadBase = (baseRole) => HEAD_ROLES.includes(baseRole);
const ACTIONS = ['view', 'add', 'edit', 'delete'];
// Added by the system, not a switch anyone ticks (createUser's trainee LMS page): never trimmed.
const ALWAYS_KEEP = ['traineeDashboard'];
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
const oid = (v) => (v && mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);
const plain = (x) => (x?.toObject ? x.toObject() : x);

/**
 * The Company Admin's list for a custom role, cleaned: only the base role's modules, keys that look
 * like keys, actions as booleans, nothing empty. Returns { allowed } or { error }.
 */
export function validateAllowed(baseRole, allowed) {
  if (!CUSTOM_BASE_ROLES.includes(baseRole)) return { error: 'Pick the role it is based on (a department role, Manager or Employee).' };
  if (allowed !== undefined && !Array.isArray(allowed)) return { error: 'The pages must be a list.' };
  const modules = new Set(ROLE_MODULES[baseRole] || []);
  const out = [];
  let count = 0;
  for (const m of allowed || []) {
    if (!m || typeof m !== 'object') continue;
    if (!modules.has(m.name)) return { error: `"${m.name}" isn't one of ${baseRole}'s modules.` };
    const seen = new Set();
    const features = [];
    for (const f of Array.isArray(m.features) ? m.features : []) {
      if (!f || !KEY_RE.test(String(f.key || '')) || seen.has(f.key)) continue;
      seen.add(f.key);
      const acts = Object.fromEntries(ACTIONS.map((a) => [a, f[a] === true]));
      if (ACTIONS.some((a) => acts[a])) features.push({ key: f.key, ...acts });
    }
    count += features.length;
    if (features.length) {
      const prev = out.find((x) => x.name === m.name);
      if (prev) prev.features.push(...features.filter((f) => !prev.features.some((p) => p.key === f.key)));
      else out.push({ name: m.name, features });
    }
  }
  if (count > 300) return { error: 'Too many pages in one role.' };
  // The base role's own limits apply too (e.g. Store: R&D Product Master / BOM Management, view only).
  const limited = applyRoleLimits(baseRole, { modules: out }).modules
    .map((m) => ({ name: m.name, features: (m.features || []).filter((f) => ACTIONS.some((a) => f[a])) }))
    .filter((m) => m.features.length);
  return { allowed: limited };
}

/** A person's permissions cut down to the custom role's list. `role` is always the base role. */
export function trimToAllowed(perms, allowed, baseRole) {
  const allow = new Map((allowed || []).map((m) => [m.name, new Map((m.features || []).map((f) => [f.key, f]))]));
  const modules = [];
  for (const m0 of Array.isArray(perms?.modules) ? perms.modules : []) {
    const m = plain(m0);
    const fa = allow.get(m?.name);
    if (!fa) continue;
    const features = [];
    for (const f0 of Array.isArray(m.features) ? m.features : []) {
      const f = plain(f0);
      if (ALWAYS_KEEP.includes(f?.key)) { features.push(f); continue; }
      const a = fa.get(f?.key);
      if (!a) continue;
      features.push({ key: f.key, ...(f.label ? { label: f.label } : {}), ...Object.fromEntries(ACTIONS.map((x) => [x, !!(f[x] === true && a[x] === true)])) });
    }
    modules.push({ name: m.name, dashboard: m.dashboard !== false, features });
  }
  return applyRoleLimits(baseRole, { canAccessAllUnits: perms?.canAccessAllUnits === true, modules, role: baseRole });
}

/** Decision D: a new person on the role starts with everything it allows. */
export const defaultsFor = (customRole) => ({
  canAccessAllUnits: false,
  role: customRole.baseRole,
  modules: (customRole.allowed || []).map((m) => ({ name: m.name, dashboard: true, features: (m.features || []).map((f) => ({ ...plain(f) })) })),
});

/**
 * Decisions 3 and B: HR's assignment of a custom role waits for the Company Admin when its flag is on,
 * or when it's based on a Head (as a Head role does, feature 31), also when only the custom role changes.
 */
export const needsCustomApproval = (actor, customRole) => !!customRole
  && (customRole.needsApproval === true || isHeadBase(customRole.baseRole))
  && !isSuperAdmin(actor) && actor?.role !== COMPANY_ADMIN;

/** The company's custom roles (plain objects). */
export async function customRolesOf(companyId) {
  const cid = oid(companyId?._id || companyId);
  if (!cid) return [];
  const s = await AdminSettings.findOne({ companyId: cid }).select('roles').lean();
  return (s?.roles || []).filter((r) => !r.isBuiltIn);
}

/**
 * What role is being given. A `customRoleId`, or a role written as a custom role's name (bulk import),
 * becomes { role: base role, customRole }. A built-in role comes back as it is, with customRole null.
 * Returns { error } when a custom role can't be used.
 */
export async function resolveRole(companyId, { role, customRoleId } = {}) {
  const wantsCustom = customRoleId !== undefined && customRoleId !== null && customRoleId !== '';
  if (!wantsCustom && !role) return { role, customRole: null };
  const roles = await customRolesOf(companyId);
  let cr = null;
  if (wantsCustom) {
    cr = roles.find((r) => String(r._id) === String(customRoleId));
    if (!cr) return { error: "That custom role isn't in this company." };
  } else {
    const name = String(role).trim().toLowerCase();
    if (CUSTOM_BASE_ROLES.some((b) => b.toLowerCase() === name)) return { role, customRole: null };
    cr = roles.find((r) => String(r.name || '').trim().toLowerCase() === name) || null;
    if (!cr) return { role, customRole: null };
  }
  if (!cr.baseRole) return { error: `Pick the role "${cr.name}" is based on first (Company Settings → Custom roles).` };
  return { role: cr.baseRole, customRole: cr };
}

/** The fields a user record gets for this custom role (or loses, for none). */
export const customRoleFields = (customRole) => (customRole
  ? { set: { customRoleId: customRole._id, customRoleName: customRole.name }, unset: {} }
  : { set: {}, unset: { customRoleId: '', customRoleName: '' } });

/** Decision F: after the Company Admin takes something away, everyone on the role (and waiting for it) is trimmed. */
export async function trimEveryoneOn(companyId, customRole) {
  const cid = oid(companyId?._id || companyId);
  const rid = oid(customRole?._id);
  if (!cid || !rid) return 0;
  const people = await User.find({ companyId: cid, $or: [{ customRoleId: rid }, { 'headApproval.customRoleId': rid, 'headApproval.status': 'pending' }] })
    .select('permissions customRoleId headApproval.status headApproval.customRoleId headApproval.permissions').lean();
  const ops = people.map((u) => {
    const set = {};
    if (String(u.customRoleId || '') === String(rid)) set.permissions = trimToAllowed(u.permissions, customRole.allowed, customRole.baseRole);
    if (u.headApproval?.status === 'pending' && String(u.headApproval.customRoleId || '') === String(rid)) {
      set['headApproval.permissions'] = trimToAllowed(u.headApproval.permissions, customRole.allowed, customRole.baseRole);
    }
    return { updateOne: { filter: { _id: u._id }, update: { $set: set } } };
  });
  if (ops.length) await User.bulkWrite(ops);
  return ops.length;
}

/** At server start, after the grants: nobody on a custom role holds more than it allows. */
export async function trimAllCustomRoleUsersAtStart() {
  const companies = await User.distinct('companyId', { customRoleId: { $type: 'objectId' } });
  let n = 0;
  for (const cid of companies) {
    for (const r of await customRolesOf(cid)) {
      if (r.baseRole) n += await trimEveryoneOn(cid, r);
    }
  }
  return n;
}

/** How many people are on each of the company's custom roles (one grouped count). */
export async function peopleOnCustomRoles(companyId) {
  const cid = oid(companyId?._id || companyId);
  if (!cid) return {};
  const rows = await User.aggregate([
    { $match: { companyId: cid, customRoleId: { $type: 'objectId' } } },
    { $group: { _id: '$customRoleId', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}
