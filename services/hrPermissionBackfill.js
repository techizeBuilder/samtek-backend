// One-off grant of the HR permissions that used to be impossible to give (2026-11-11,
// docs/client-features-2026-11/04-hr-permission-gap-changes.md). The menus and page
// guards required them, but Roles & Permissions didn't list them, so nobody could
// hold them. Without this, every HR-Admin and Manager would stay locked out until
// someone ticked each one by hand.
//
// Each user is done once and marked, so a permission or module a Company Admin
// removes afterwards stays removed. Keep these lists the same as the client's
// lib/roleModulesConfig.js (HRMS_ROLE_FEATURES); suite hrperms checks that they are.
import mongoose from 'mongoose';

export const HR_ADMIN_FEATURES = [
  'companies', 'branches', 'leaveRequests', 'leaveTypes', 'attendanceRecord', 'attendanceRequests',
  'salaryStructure', 'payrollRun', 'payslips', 'statutoryReport', 'jobOpenings', 'candidates',
  'interviewPipeline', 'trainees', 'trainingModules', 'questionBank',
];

export const MANAGER_FEATURES = [
  'teamMembers', 'teamAttendance', 'leaveRequests', 'attendanceCorrections', 'overtimeRequests',
  'expenseRequests', 'travelRequests', 'profileRequests', 'interviewFeedback',
];

const FEATURES_FOR = { 'HR-Admin': HR_ADMIN_FEATURES, Manager: MANAGER_FEATURES };
const granted = (key) => ({ key, view: true, add: true, edit: true, delete: true, alter: false });

export async function backfillHrPermissions({ companyId = null } = {}) {
  const users = mongoose.connection.collection('users');
  const pending = await users.find({
    role: { $in: Object.keys(FEATURES_FOR) },
    hrPermissionsBackfilledAt: { $exists: false },
    ...(companyId ? { companyId } : {}),
  }).project({ role: 1, permissions: 1 }).toArray();

  for (const user of pending) {
    const modules = [...(user.permissions?.modules || [])];
    let hrms = modules.find((m) => m.name === 'hrms');
    if (!hrms) {
      hrms = { name: 'hrms', dashboard: true, features: [] };
      modules.push(hrms);
    }
    hrms.features = hrms.features || [];
    const have = new Set(hrms.features.map((f) => f.key));
    for (const key of FEATURES_FOR[user.role]) if (!have.has(key)) hrms.features.push(granted(key));
    await users.updateOne({ _id: user._id }, {
      $set: {
        'permissions.role': user.permissions?.role || user.role,
        'permissions.modules': modules,
        hrPermissionsBackfilledAt: new Date(),
      },
    });
  }
  if (pending.length) console.log(`[HrPermissions] Granted the missing HR permissions to ${pending.length} user(s).`);
  return { updated: pending.length };
}
