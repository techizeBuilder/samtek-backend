// Feature 33 (25 Nov 2026): the Task Management switch decides the Task Management page (giving,
// reviewing, the board, the reports). docs/client-features-2026-11/33-task-management-permission-logic.md
//   view   the board (other than one's own tasks), reports, tasks from before KRA
//   add    give tasks
//   edit   review, change a due date, edit, send a routine item back
//   delete cancel a task
// A person's own tasks (My tasks) never need it. The role rules in kraTaskService still apply
// underneath: the switch can only take Task Management away, never widen it.
import { isSuperAdmin, companyAdminGrants, COMPANY_ADMIN } from '../access/companyAccess.js';
import { TASK_MODULES } from '../hrPermissionBackfill.js';

export const NO_TASK_ACCESS = "Task Management isn't switched on for you. Ask HR or the Company Admin.";

export function hasTaskAccess(user, action = 'view') {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (user.role === COMPANY_ADMIN) return companyAdminGrants(user, 'hrms', 'taskManagement', action);
  return (user.permissions?.modules || []).some((m) => TASK_MODULES.includes(String(m.name || '').toLowerCase())
    && (m.features || []).some((f) => f.key === 'taskManagement' && f[action] === true));
}

/** Route guard. `when(req)` limits it to some requests (e.g. the board but not one's own list). */
export const requireTaskAccess = (action, when = () => true) => (req, res, next) => (
  !when(req) || hasTaskAccess(req.user, action)
    ? next()
    : res.status(403).json({ success: false, message: NO_TASK_ACCESS })
);
