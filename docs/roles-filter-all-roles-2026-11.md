# Roles & Permissions: the role filter lists every role (what changed)

*14 November 2026, your ask. Company Admin → Roles & Permissions (`/hrms/CompanyAdmin/user-management`).*

## The problem
**The "Filter by Role" list had only admins and Heads**, e.g. HR Admin, Company Admin, Manager, Production Head, Store Head. A Company Admin can set permissions for anyone, but couldn't filter to a Production Employee, Store Employee, QC Employee and so on.

**Why:** the list was a fixed list written into the page, and it named only those 13 roles.

## What changes
- **The filter lists every role the people on this page actually have**, from the server.
  - test-1 now shows 25 roles, e.g. Account Employee, Auditor, Employee, Packing Employee, Production Employee, QC Employee, Research Development Employee, Sales Employee, Store Employee, as well as the admins and Heads.
  - A role nobody has isn't listed, so no choice leads to an empty page.
- **The list stays the same while a search, role or status filter is on.** It covers everyone the page can show: your company's people with a login.
- **The names are as before** where the page already had a nicer one, e.g. "Packing and Dispatch Head" for Dispatch Head. Other roles show as stored.
- **Superadmin** still never appears for a Company Admin.

## Not changed
- **The roles you can pick when creating or editing a user:** still the page's own list.
- **People with no login** (Manpower) aren't on this page, so their role isn't listed.
- **Other pages** that load people: they don't ask for the roles list and get exactly the same reply as before.

## Technical notes
- **Server, `getUsers` (`controllers/userController.js`):** with `withRoles=yes`, the reply adds `roles`.
  - It's the distinct roles in the list's own scope (company, manager, unit, login), taken before the search, role and status filters.
  - It's sorted A–Z, and only sent when asked for.
- **Screen, `pages/RolePermissionManagement.jsx`:**
  - the list call sends `withRoles: 'yes'`
  - the filter uses `filterRoleOptions` (server roles, labels from `ROLES`), and falls back to `ROLES` until the first reply

## Checked
On test-1, through the server, as its Company Admin:

| Check | Result |
|---|---|
| Roles listed | 25 (was 13 fixed ones) |
| Filter "Production Employee" | 2 people; the roles list unchanged |
| A search with no match | 0 people; the roles list unchanged |
| Without `withRoles` (other pages) | no `roles` field, as before |

The page compiles. Screen check next.

## Browser check
**Passed, checked by you on screen (14–16 Nov):** the role filter lists the employee roles, and picking one shows its people.
