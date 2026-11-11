// Keeps HR actions inside the user's own company (2026-11-11). Payroll, payslip and
// salary records have no company of their own, so they're scoped through the
// employee they belong to.
import User from '../models/User.js';

const PLATFORM_ROLES = ['Superadmin', 'Super Admin', 'super_user'];

export const isPlatformAdmin = (user) => PLATFORM_ROLES.includes(user?.role);

// For records that carry companyId. null, not undefined: Mongoose drops an
// undefined condition, which would match every company.
export const companyMatch = (user) => (isPlatformAdmin(user) ? {} : { companyId: user?.companyId ?? null });

// For records that point at an employee.
export async function employeeMatch(user, field = 'employee') {
  if (isPlatformAdmin(user)) return {};
  const ids = await User.find({ companyId: user?.companyId ?? null }).distinct('_id');
  return { [field]: { $in: ids } };
}

export async function isInMyCompany(user, employeeId) {
  if (isPlatformAdmin(user)) return true;
  if (!employeeId) return false;
  return !!(await User.exists({ _id: employeeId, companyId: user?.companyId ?? null }));
}

// Approving someone's request (2026-11-11): their reporting manager, HR in the same
// company, or a platform admin. Never their own. features: HR permissions that count
// (edit); hrRoles: HR-Admin or Company Admin by role, for screens with no permission.
const HR_ROLES = ['HR-Admin', 'Hr Admin', 'Company Admin'];
export async function canApprove(user, ownerId, { features = [], hrRoles = false } = {}) {
  if (!ownerId || String(ownerId) === String(user?._id)) return false;
  if (isPlatformAdmin(user)) return true;
  if (await User.exists({ _id: ownerId, reportingManager: user?._id })) return true;
  const { userHasPermission } = await import('../middleware/permissions.js');
  // A Manager holds the same permission names as HR, so the HR route is for HR
  // roles only: a Manager decides only for their own team (the check above).
  if (!HR_ROLES.includes(user?.role)) return false;
  const isHr = hrRoles || features.some((f) => userHasPermission(user, 'hrms', f, 'edit'));
  return isHr && isInMyCompany(user, ownerId);
}
