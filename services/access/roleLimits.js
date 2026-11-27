// 26 Nov 2026 (asked during feature 34): what a role may hold of ANOTHER department's module.
// Store reads R&D's machines (Product Master) and sub child parts (BOM Management), view only. The R&D
// routes check only the switch (routes/rdRoutes.js checkPermission('rnd', ...)), so any more R&D
// switches would be real R&D powers for a Store person. The client holds the same list
// (lib/roleModulesConfig.js ROLE_LIMITS); suite hrperms checks they match.
import User from '../../models/User.js';

export const ROLE_LIMITS = {
  'Store Head': { rnd: { productMaster: ['view'], bomManagement: ['view'] } },
  'Store Employee': { rnd: { productMaster: ['view'], bomManagement: ['view'] } },
};
const ACTIONS = ['view', 'add', 'edit', 'delete'];
const plain = (x) => (x?.toObject ? x.toObject() : x);

/** Permissions with the role's limited modules cut to their pages and actions (others untouched). */
export function applyRoleLimits(role, permissions) {
  const limits = ROLE_LIMITS[role];
  if (!limits || !permissions || typeof permissions !== 'object' || !Array.isArray(permissions.modules)) return permissions;
  const modules = permissions.modules.map((m0) => {
    const m = plain(m0);
    const limit = limits[m?.name];
    if (!limit) return m;
    const features = (m.features || []).map(plain).filter((f) => limit[f?.key])
      .map((f) => ({ ...f, ...Object.fromEntries(ACTIONS.map((a) => [a, f[a] === true && limit[f.key].includes(a)])), ...(f.alter !== undefined ? { alter: false } : {}) }));
    return { ...m, features };
  });
  return { ...plain(permissions), modules };
}

/** Does this person hold more of a limited module than the role allows? */
export function exceedsRoleLimits(role, permissions) {
  const limits = ROLE_LIMITS[role];
  if (!limits) return false;
  return (permissions?.modules || []).map(plain).some((m) => limits[m?.name] && (m.features || []).map(plain).some((f) => {
    const allowed = limits[m.name][f?.key];
    // A page outside the limit is removed even when nothing is ticked on it.
    return !allowed || ACTIONS.some((a) => f[a] === true && !allowed.includes(a));
  }));
}

/** At server start (after the one-time grants): every limited-role person cut to the limit. */
export async function applyRoleLimitsAtStart() {
  const people = await User.find({ role: { $in: Object.keys(ROLE_LIMITS) } }).select('role permissions').lean();
  const ops = people.filter((u) => exceedsRoleLimits(u.role, u.permissions))
    .map((u) => ({ updateOne: { filter: { _id: u._id }, update: { $set: { permissions: applyRoleLimits(u.role, u.permissions) } } } }));
  if (ops.length) await User.bulkWrite(ops);
  return ops.length;
}
