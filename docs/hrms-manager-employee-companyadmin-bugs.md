# HRMS — Manager / Employee / Company Admin: non-pagination bugs found

Found during the pagination/fetching audit of the Manager, Employee, and Company Admin
HRMS menu groups. These are **not** pagination gaps — they're separate bugs, left
untouched per instruction to only fix pagination/search/filter fetching issues in that
pass. Forwarding here so a teammate can pick them up.

## 1. ManagerDashboard.jsx — stat tiles computed company-wide, not team-scoped

`client/src/pages/hrms/Manager/ManagerDashboard.jsx` — backend: `hrmsDashboardController.getHrmsDashboardStats`.

The dashboard shows 4 tiles under a "my team" framing, but only one is actually scoped
to the manager's direct reports:

- **Team Members** (`totalEmployees`) — computed via `User.find({companyId})`, i.e. every
  employee in the company, not the manager's team.
- **Present Today** (`presentToday`) — same company-wide scoping.
- **Open Jobs** (`openJobs`) — company-wide `JobOpening` count.
- **Pending Approvals** — correctly scoped via `reportingManager`. This one is fine.

Fix would be scoping the first three the same way pendingApprovals already is (resolve
the manager's team via `User.find({reportingManager: managerId})`, then count/filter
against that id list).

## 2. EmployeeDashboard.jsx — two dead API calls, always silently empty

`client/src/pages/hrms/Employee/Dashboard/EmployeeDashboard.jsx`

- Calls `GET /leaves/me` — no such route exists (the real endpoint is `GET /leaves`
  with an implicit self-scope via the auth token). Always 404s, caught by a
  `fetchWithFallback` wrapper that silently returns `[]`.
- Calls `GET /goals/my-assigned` — no route by this name is registered anywhere in the
  backend. Always falls back to `[]`, so the "Goals" widget permanently shows 0/empty
  for every employee.

## 3. LeaveBalance.jsx — dead route breaks the whole page, not just one widget

`client/src/pages/hrms/Employee/Leave/LeaveBalance.jsx`

Calls `GET /employee/leaves` — this route does not exist (correct path is `GET
/leaves`). Because this call sits inside the same `Promise.all` as the leave-balances
fetch, the 404 causes the **entire** `Promise.all` to reject — so both the leave
balances panel and the "Recent Leave Summary" table are always empty for every
employee, every time this page loads. Only an outer `console.error` catches it; there's
no user-visible error state.

## 4. Company Admin's Employee Management — pagination/profile links hardcoded to the wrong role path

`client/src/pages/hrms/Employee/index.jsx` (imported as `HRMSEmployees`; reused at
`/hrms/CompanyAdmin/employees` and `/hrms/Manager/employees`)

Pagination itself works correctly (real backend `.skip()/.limit()`, search, filters —
this page is otherwise a good example). But `handlePageChange` and the "View
Profile"/"Add User" navigation are hardcoded to `/hrms/SuperAdmin/employees/...`
regardless of which route actually mounted the component. A Company Admin (or Manager)
clicking a page number or "View Profile" gets sent to a SuperAdmin-only path they don't
have access to — effectively broken pagination/navigation for these two roles even
though the underlying data-fetching is correct.

## 5. Branches.tsx ("Operating Units") — doesn't use the real Branch data at all

`client/src/pages/hrms/SystemConfigration/Branches.tsx` (route
`/hrms/CompanyAdmin/branches`)

This page never calls the actual branches endpoint (`GET /branches`, backed by the
`Branch` model). Instead it fetches `GET /companies` (twice) and fabricates pseudo-branch
rows by relabeling each Company document client-side. The only real-branch-endpoint call
in the file is `DELETE /branches/:id`, which would 404 or silently no-op since the `_id`
on a fabricated row is actually a Company id, not a Branch id.

Separately, the real branches endpoint (`branchController.getAllBranches`) has no
role/companyId scoping at all — just an optional `companyId` query filter and no
pagination — not currently exploitable since this page never calls it, but worth fixing
together if this page gets rebuilt to use real branch data.

## 6. Expense model has a `companyId` field that two team/self-service queries don't use

- `expenseRequestController.getTeamExpenseRequests` (Manager's Expense approvals)
- Already scoped correctly by employee-id list (derived from `reportingManager`), so
  this is not currently exploitable as a cross-tenant leak — just flagging that the
  `Expense` model *does* have a `companyId` field (required, indexed) that isn't applied
  in this query, unlike most other HRMS request models in this section (Leave,
  AttendanceRequest, Overtime, TravelRequest, ProfileUpdate), which genuinely have no
  companyId-equivalent field at all.
