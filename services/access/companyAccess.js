// Feature 27 (24 Nov 2026): who may touch which company's users and companies, who may give which
// role, and the Company Admin's own admin pages by role.
// docs/client-features-2026-11/27-company-setup-and-access-logic.md
import mongoose from 'mongoose';

export const SA_ROLES = ['Super Admin', 'Superadmin'];
export const ADMIN_TIER = ['Super Admin', 'Superadmin', 'HR-Admin', 'Company Admin'];
export const COMPANY_ADMIN = 'Company Admin';
export const isSuperAdmin = (user) => SA_ROLES.includes(user?.role);
export const isAdminTier = (user) => ADMIN_TIER.includes(user?.role);

// The Company Admin's own admin pages (the Company Admin menu): theirs by role, every action.
export const CA_HRMS_FEATURES = ['dashboard', 'employeeManagement', 'myCompany', 'pricingValue', 'operatingUnits', 'departments', 'designations', 'rolePermissions', 'taskManagement'];
// Feature 29 (24 Nov 2026): Designations are HR's to set; the Company Admin sees the list (view only).
// The fallback for a company with no HR-Admin is decided at the route (canManageDesignations).
const CA_VIEW_ONLY = ['designations'];
export const companyAdminGrants = (user, module, feature, action = 'view') => user?.role === COMPANY_ADMIN
  && String(module || '').toLowerCase() === 'hrms' && CA_HRMS_FEATURES.includes(feature)
  && (!CA_VIEW_ONLY.includes(feature) || action === 'view');
/** The permissions a new Company Admin is saved with: the hrms module with the 9 pages (designations: view only). */
export const seedCompanyAdminPermissions = () => ({
  role: COMPANY_ADMIN, canAccessAllUnits: false,
  modules: [{ name: 'hrms', dashboard: true, features: CA_HRMS_FEATURES.map((key) => {
    const write = !CA_VIEW_ONLY.includes(key);
    return { key, view: true, add: write, edit: write, delete: write };
  }) }],
});

// Feature 29 (24 Nov 2026): who creates, edits and deletes departments and designations.
export const canManageDepartments = (user) => isSuperAdmin(user) || user?.role === COMPANY_ADMIN;
/** Designations: HR-Admin (or a Super Admin); a Company Admin only while their company has no active HR-Admin. */
export async function canManageDesignations(user) {
  if (isSuperAdmin(user) || user?.role === 'HR-Admin') return { ok: true, reason: null };
  if (user?.role === COMPANY_ADMIN && user.companyId) {
    const cid = idOf(user.companyId);
    const hr = await mongoose.connection.collection('users').countDocuments({
      role: 'HR-Admin', isActive: { $ne: false }, companyId: { $in: [new mongoose.Types.ObjectId(cid), cid] },
    });
    return hr ? { ok: false, reason: 'Designations are set by HR. You can see the list here.' }
      : { ok: true, reason: 'Your company has no HR-Admin yet, so you can set designations until one is added.' };
  }
  return { ok: false, reason: 'Designations are set by HR.' };
}

const idOf = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : v ? String(v) : '');
/** Is the target (a user or a company id holder) in the caller's company? A Super Admin: always. */
export const sameCompany = (user, targetCompanyId) => isSuperAdmin(user) || (!!idOf(user?.companyId) && idOf(user.companyId) === idOf(targetCompanyId));

/** May `actor` give `role` to someone in `companyId`? Returns null, or the reason it may not. */
// Roles nobody may give (26 Nov 2026): 'super_user' was removed but acted like a Super Admin.
export const RETIRED_ROLES = ['super_user'];

export function roleRefusal(actor, role, companyId) {
  if (RETIRED_ROLES.includes(String(role || '').trim().toLowerCase())) return 'This role no longer exists.';
  if (SA_ROLES.includes(role) && !isSuperAdmin(actor)) return 'Only a Super Admin can give the Super Admin role.';
  if (role === COMPANY_ADMIN && !isSuperAdmin(actor) && !(actor?.role === COMPANY_ADMIN && sameCompany(actor, companyId))) {
    return "Only a Super Admin or this company's Company Admin can give the Company Admin role.";
  }
  return null;
}

/** Is this user the last active Company Admin of their company? */
export async function isLastCompanyAdmin(target) {
  if (target?.role !== COMPANY_ADMIN || target?.isActive === false || !target?.companyId) return false;
  const cid = idOf(target.companyId);
  const n = await mongoose.connection.collection('users').countDocuments({
    role: COMPANY_ADMIN, isActive: { $ne: false },
    companyId: { $in: [new mongoose.Types.ObjectId(cid), cid] },
  });
  return n <= 1;
}
export const LAST_CA_MESSAGE = 'This is the company\'s only Company Admin: make someone else Company Admin first.';
