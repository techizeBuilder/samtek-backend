# Feature 30: The Company Admin adds users with HR's form, plus two security fixes (what changed)

*Built 24 November 2026. Logic and decisions: [30-company-admin-add-user-logic.md](30-company-admin-add-user-logic.md). Browser test: [30-company-admin-add-user-test-roadmap.md](30-company-admin-add-user-test-roadmap.md).*

## In one line
**The Company Admin's Create New User now opens HR's Add User form.** The same fields, the same checks, admin and Head roles only. Two holes that let an account reach other companies' data are closed.

## The Company Admin's Create New User
- **Roles & Permissions → Create New User** opens the Add User page (`/hrms/CompanyAdmin/add-user`), the same form HR uses.
  - The old small dialog is gone.
- **What's different from HR's:**
  - **No "Gets a login" choice:** always Yes. People without a login stay HR's to add.
  - **No Bulk Import** (HR's).
  - **The role list:** Admins (HR Admin, Company Admin, Manager, MIS Admin) and the Department Heads. No employee or custom roles.
  - **The company** is picked for them: their own.
  - **Reporting manager** is optional for HR Admin, Company Admin and Manager; required for the Heads and MIS Admin, as in HR's form.
  - **Permissions:**
    - **HR Admin:** the permissions grid, with HR's pages ticked
    - **Company Admin:** no grid, *"A Company Admin's pages come with the role."* (the server gives the 9 pages)
    - **Heads, Manager, MIS Admin:** the same grid and defaults as HR's form
  - **After saving:** back to Roles & Permissions.
- **Everything else is HR's form,** with its checks:
  - photo, name, email, mobile (10 digits), gender, date of birth, joining date, password
  - company / unit, department, designation, reporting manager, employee type
  - device code, address
- **The edit dialog on Roles & Permissions stays** (role, permissions, active, password).
  - **Give All Permissions** no longer turns on "can access all units".
  - Superadmin is gone from its role list.

## HR's Add User
Unchanged for HR.

## Security
1. **No back-door Super Admin.**
   - Before, a user's hidden permission role saying `super_admin` made them a Super Admin, whatever their real role. A Company Admin or HR could set it when creating or editing someone. Proved: such a "Production Head" could read another company's department.
   - **Now only the real role counts.**
   - **The hidden role is always saved as the real role**, on create and on edit, whatever the screen sends.
   - **A fix at every server start** sets it to the real role for anyone where it differs. On dev this tidied about 30 mangled ones, e.g. `research_& development head`.
2. **"Can access all units" stays inside the user's own company.**
   - Before, the tick showed every company's tasks on the old task API and its reports.
   - Now only a Super Admin sees every company's.
3. **A department or designation must be the user's own company's** when creating or editing someone. Otherwise: *"That department isn't in this company."*

## Files
- **Server:**
  - `services/access/companyAccess.js` and `middleware/permissions.js`: Super Admin by the real role only
  - `controllers/userController.js`: hidden role = real role; the department / designation check
  - `services/hrPermissionBackfill.js` (`syncPermissionRoleOnce`) + `index.js`
  - `controllers/hrmsTaskManagement.js`, `controllers/TaskReportController.js`: own company unless Super Admin
- **Screens:**
  - `pages/hrms/AddUser.tsx` (`forCompanyAdmin`)
  - `pages/hrms/loginRoles.ts` (`COMPANY_ADMIN_ROLES`, `MANAGER_OPTIONAL_ROLES`)
  - `App.jsx` (the route)
  - `pages/RolePermissionManagement.jsx` (the old dialog removed; Create New User opens the form)

## Tested
- **The new suite `caadduser`: 19 of 19,** through the real server on made-up companies:
  - **The back door:**
    - a create or edit sending `super_admin` saves the real role
    - such users, and even one saved like that before the fix, are refused another company's department
  - **The hidden role** follows role changes.
  - **The start-up fix** corrects mangled values; a second run changes nothing.
  - **The old task API:** HR with the tick sees only their company's task; the Super Admin sees both; the overdue report doesn't show the other company's.
  - **Another company's department / designation** is refused on create, edit and the form's path.
  - **Through the form's own (multipart) path, the Company Admin creates:**
    - an HR Admin with HR's pages
    - a Company Admin with the 9 pages
    - a Sales Head with every detail saved (department, designation, mobile, dates, manager, employee id)
- **Regression:** `companyaccess` 42, `hrperms` 33, `people` 123, `orgsplit` 30, `kratasks` 43, all passing.
- **On dev after the restart,** every user's hidden role equals their real role.
- **The three screens bundle.**
