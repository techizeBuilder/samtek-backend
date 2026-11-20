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
  'interviewPipeline', 'trainees', 'trainingModules', 'questionBank', 'manpowerScore',
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

// A new HR permission added after the one-off backfill above (feature 10, 2026-11-13:
// manpowerScore): granted once to existing HR-Admins, marked with its own field, so
// one a Company Admin removes afterwards stays removed. New HR-Admins get it from the
// backfill above, which now lists it.
export async function grantHrFeatureOnce(key, stampField, { roles = ['HR-Admin'], companyId = null } = {}) {
  const users = mongoose.connection.collection('users');
  const pending = await users.find({ role: { $in: roles }, [stampField]: { $exists: false }, ...(companyId ? { companyId } : {}) }).project({ role: 1, permissions: 1 }).toArray();
  for (const user of pending) {
    const modules = [...(user.permissions?.modules || [])];
    let hrms = modules.find((m) => m.name === 'hrms');
    if (!hrms) { hrms = { name: 'hrms', dashboard: true, features: [] }; modules.push(hrms); }
    hrms.features = hrms.features || [];
    if (!hrms.features.some((f) => f.key === key)) hrms.features.push(granted(key));
    await users.updateOne({ _id: user._id }, { $set: { 'permissions.role': user.permissions?.role || user.role, 'permissions.modules': modules, [stampField]: new Date() } });
  }
  if (pending.length) console.log(`[HrPermissions] Granted ${key} to ${pending.length} user(s).`);
  return { updated: pending.length };
}

// A new feature in any module, granted once to existing users of the given roles
// (feature 12, 2026-11-14: orderTracking in 'complaints' and 'sales'). Marked with
// its own field per user, so one a Company Admin removes afterwards stays removed.
// grants: [{ roles, module, actions: { view, add, edit, delete } }]. New users get it
// from the client's role defaults (lib/roleModulesConfig.js).
export async function grantModuleFeatureOnce(key, stampField, grants, { companyId = null } = {}) {
  const users = mongoose.connection.collection('users');
  const roles = [...new Set(grants.flatMap((g) => g.roles))];
  const pending = await users.find({ role: { $in: roles }, [stampField]: { $exists: false }, ...(companyId ? { companyId } : {}) }).project({ role: 1, permissions: 1 }).toArray();
  for (const user of pending) {
    const modules = [...(user.permissions?.modules || [])];
    for (const g of grants.filter((x) => x.roles.includes(user.role))) {
      let mod = modules.find((m) => (m.name || '').toLowerCase() === g.module.toLowerCase());
      if (!mod) { mod = { name: g.module, dashboard: true, features: [] }; modules.push(mod); }
      mod.features = mod.features || [];
      if (!mod.features.some((f) => f.key === key)) {
        mod.features.push({ key, view: !!g.actions.view, add: !!g.actions.add, edit: !!g.actions.edit, delete: !!g.actions.delete, alter: false });
      }
    }
    await users.updateOne({ _id: user._id }, { $set: { 'permissions.role': user.permissions?.role || user.role, 'permissions.modules': modules, [stampField]: new Date() } });
  }
  if (pending.length) console.log(`[Permissions] Granted ${key} to ${pending.length} user(s).`);
  return { updated: pending.length };
}

// Feature 12's grant, kept here so the suite can call exactly what the server runs.
export const ORDER_TRACKING_GRANTS = [
  { roles: ['Complaint Management Head'], module: 'complaints', actions: { view: true, add: true, edit: true, delete: true } },
  { roles: ['Complaint Management Employee'], module: 'complaints', actions: { view: true, add: true } },
  { roles: ['Sales Head'], module: 'sales', actions: { view: true } },
];

// Purchase separated from Accounts (2026-11-16, docs/purchase-separation/01-logic.md),
// once per user (stamp purchaseSeparatedAt), so nobody loses access the morning after
// and the Company Admin then trims. For each user holding accounts.purchases:
//   purchase.purchases + purchase.purchaseExpenses  ← copies of accounts.purchases
//   purchase.purchaseSettings / purchaseAuditLog    ← moved from accounts as they are
//   purchase.purchaseHead (view + edit)             ← only for the Accounts Head role
//   accounts.vendorPayments + accounts.tenderExpenses ← copies of accounts.purchases
// and the three old accounts keys are removed. Users without accounts.purchases are
// only stamped. A permission the Company Admin removes later stays removed.
const OLD_PURCHASE_KEYS = ['purchases', 'purchaseSettings', 'purchaseAuditLog'];
const actionsOf = (f) => ({ view: !!f?.view, add: !!f?.add, edit: !!f?.edit, delete: !!f?.delete, alter: !!f?.alter });

export async function separatePurchaseOnce({ companyId = null } = {}) {
  const users = mongoose.connection.collection('users');
  const pending = await users.find({ purchaseSeparatedAt: { $exists: false }, ...(companyId ? { companyId } : {}) })
    .project({ role: 1, permissions: 1 }).toArray();
  let moved = 0;
  for (const user of pending) {
    const modules = [...(user.permissions?.modules || [])].map((m) => ({ ...m, features: [...(m.features || [])] }));
    const acc = modules.find((m) => (m.name || '').toLowerCase() === 'accounts');
    const oldBuy = acc?.features.find((f) => f.key === 'purchases');
    const set = { purchaseSeparatedAt: new Date() };
    if (acc && acc.features.some((f) => OLD_PURCHASE_KEYS.includes(f.key))) {
      const oldSettings = acc.features.find((f) => f.key === 'purchaseSettings');
      const oldAudit = acc.features.find((f) => f.key === 'purchaseAuditLog');
      let pur = modules.find((m) => (m.name || '').toLowerCase() === 'purchase');
      if (!pur) { pur = { name: 'purchase', dashboard: true, features: [] }; modules.push(pur); }
      const addTo = (mod, key, actions) => { if (actions && !mod.features.some((f) => f.key === key)) mod.features.push({ key, ...actions }); };
      if (oldBuy) {
        addTo(pur, 'purchases', actionsOf(oldBuy));
        addTo(pur, 'purchaseExpenses', actionsOf(oldBuy));
        addTo(acc, 'vendorPayments', actionsOf(oldBuy));
        addTo(acc, 'tenderExpenses', actionsOf(oldBuy));
      }
      if (oldSettings) addTo(pur, 'purchaseSettings', actionsOf(oldSettings));
      if (oldAudit) addTo(pur, 'purchaseAuditLog', actionsOf(oldAudit));
      if (oldBuy?.view && user.role === 'Accounts Head') addTo(pur, 'purchaseHead', { view: true, add: false, edit: true, delete: false, alter: false });
      acc.features = acc.features.filter((f) => !OLD_PURCHASE_KEYS.includes(f.key));
      set['permissions.modules'] = modules;
      moved++;
    }
    await users.updateOne({ _id: user._id }, { $set: set });
  }
  if (moved) console.log(`[Permissions] Purchase separated from Accounts for ${moved} user(s).`);
  return { stamped: pending.length, moved };
}
