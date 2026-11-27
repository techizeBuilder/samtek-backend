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
  'kra', // feature 25 (2026-11-23)
  // Security re-check M5 (27 Nov 2026): HR's pages that had no switch (any HR could change them).
  'holidays', 'hrPolicy', 'hrExpenses',
];

export const MANAGER_FEATURES = [
  'teamMembers', 'teamAttendance', 'leaveRequests', 'attendanceCorrections', 'overtimeRequests',
  'expenseRequests', 'travelRequests', 'profileRequests', 'interviewFeedback',
  'taskManagement', // feature 33 (2026-11-25): the Task Management switch
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

// Feature 27 (24 Nov 2026): a Company Admin created before this was saved with the hrms module and
// an EMPTY feature list, so their admin pages were hidden until someone fixed it by hand. Their 9
// pages now work by role anyway (services/access/companyAccess.js); this also fills the saved
// permissions so the Roles & Permissions screen shows them. Once per Company Admin.
export async function grantCompanyAdminPagesOnce() {
  const { CA_HRMS_FEATURES, COMPANY_ADMIN } = await import('./access/companyAccess.js');
  const users = mongoose.connection.collection('users');
  const pending = await users.find({ role: COMPANY_ADMIN, companyAdminPagesGrantedAt: { $exists: false } }).project({ role: 1, permissions: 1 }).toArray();
  let filled = 0;
  for (const user of pending) {
    const modules = [...(user.permissions?.modules || [])];
    let hrms = modules.find((m) => m.name === 'hrms');
    if (!hrms) { hrms = { name: 'hrms', dashboard: true, features: [] }; modules.push(hrms); }
    hrms.features = hrms.features || [];
    const missing = CA_HRMS_FEATURES.filter((key) => !hrms.features.some((f) => f.key === key));
    for (const key of missing) hrms.features.push(granted(key));
    if (missing.length) filled++;
    await users.updateOne({ _id: user._id }, { $set: { 'permissions.role': user.permissions?.role || COMPANY_ADMIN, 'permissions.modules': modules, companyAdminPagesGrantedAt: new Date() } });
  }
  if (filled) console.log(`[HrPermissions] Company Admin pages filled for ${filled} user(s).`);
  return { checked: pending.length, filled };
}

// Feature 29 (24 Nov 2026): HR sets designations and sees departments (the Company Admin sets
// those). An HR-Admin missing either page gets it: departments to view, designations in full.
// Once per HR-Admin. (Who may write is enforced by role at the routes either way.)
export async function grantHrOrgPagesOnce() {
  const users = mongoose.connection.collection('users');
  const pending = await users.find({ role: 'HR-Admin', hrOrgPagesGrantedAt: { $exists: false } }).project({ role: 1, permissions: 1 }).toArray();
  let filled = 0;
  for (const user of pending) {
    const modules = [...(user.permissions?.modules || [])];
    let hrms = modules.find((m) => m.name === 'hrms');
    if (!hrms) { hrms = { name: 'hrms', dashboard: true, features: [] }; modules.push(hrms); }
    hrms.features = hrms.features || [];
    let changed = false;
    if (!hrms.features.some((f) => f.key === 'departments')) { hrms.features.push({ key: 'departments', view: true, add: false, edit: false, delete: false, alter: false }); changed = true; }
    if (!hrms.features.some((f) => f.key === 'designations')) { hrms.features.push(granted('designations')); changed = true; }
    if (changed) filled++;
    await users.updateOne({ _id: user._id }, { $set: { 'permissions.role': user.permissions?.role || 'HR-Admin', 'permissions.modules': modules, hrOrgPagesGrantedAt: new Date() } });
  }
  if (filled) console.log(`[HrPermissions] Departments / Designations given to ${filled} HR-Admin(s).`);
  return { checked: pending.length, filled };
}

// Feature 30 (24 Nov 2026): the hidden permission role (permissions.role) is the real role. It used
// to be saved as each screen sent it (e.g. 'research_& development head'), and 'super_admin' there
// was read as Super Admin. Nothing else reads it. Idempotent, so it simply runs at every start;
// one update, bounded by headcount.
export async function syncPermissionRoleOnce() {
  const users = mongoose.connection.collection('users');
  const r = await users.updateMany(
    { role: { $type: 'string' }, $expr: { $ne: ['$permissions.role', '$role'] } },
    [{ $set: { 'permissions.role': '$role' } }],
  );
  if (r.modifiedCount) console.log(`[Permissions] Hidden permission role set to the real role for ${r.modifiedCount} user(s).`);
  return { fixed: r.modifiedCount };
}

// Feature 33 (25 Nov 2026): the Task Management switch decides the new Task Management (feature 25).
// Every module with that page gets a 'taskManagement' entry; so nobody loses access, each person who
// has one of those modules saved but no entry gets it fully on, once (stamp taskMgmtGrantedAt). An
// entry already saved (on or off) stays as it is.
export const TASK_MODULES = ['hrms', 'production', 'packing', 'dispatches', 'sales', 'accounts', 'rnd', 'store', 'quality-control'];
export async function grantTaskManagementOnce() {
  const users = mongoose.connection.collection('users');
  const pending = await users.find({ taskMgmtGrantedAt: { $exists: false } }).project({ permissions: 1 }).toArray();
  let filled = 0;
  for (const user of pending) {
    const modules = [...(user.permissions?.modules || [])].map((m) => ({ ...m, features: [...(m.features || [])] }));
    let changed = false;
    for (const m of modules) {
      if (!TASK_MODULES.includes(String(m.name || '').toLowerCase())) continue;
      if (m.features.some((f) => f.key === 'taskManagement')) continue;
      m.features.push(granted('taskManagement'));
      changed = true;
    }
    const set = { taskMgmtGrantedAt: new Date() };
    if (changed) { set['permissions.modules'] = modules; filled++; }
    await users.updateOne({ _id: user._id }, { $set: set });
  }
  if (filled) console.log(`[Permissions] Task Management switch given to ${filled} user(s).`);
  return { checked: pending.length, filled };
}
