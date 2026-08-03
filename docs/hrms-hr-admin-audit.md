# HRMS — HR-Admin (`hrAdminMenuItems`) audit

Documentation-only pass, per instruction — **nothing in this module was changed**.
Covers all 19 HR-Admin-specific pages (routes under `/hrms/SuperAdmin/*`). A few of
these components are also reached from Manager's menu (Attendance Record, Holidays,
Job Openings, Candidates) — they were deferred during the earlier Manager audit
specifically because they're shared with HR-Admin, and are now covered here.

Already documented elsewhere, not repeated here:
- Employee Management (`HRMSEmployees`), Branches (`HRMSBranches`) — see
  `hrms-manager-employee-companyadmin-bugs.md` (items 4 and 5).
- Departments (`HRMSDepartments`), Designations (`HRMSDesignation`) — audited during
  the Company Admin pass, small config lists, no issues.

---

## 1. Real pagination gaps — growing, company-wide datasets with zero pagination

All of these: no page state on the frontend, no rendered Previous/Next, and the
backend does an unbounded `.find()` with no `.skip()/.limit()`. Same shape of gap
found throughout this whole audit.

| Page | File | Route | Backend controller |
|---|---|---|---|
| Attendance Requests | `pages/hrms/Attendance/HRAdminAttendanceRequest.jsx` | `/hrms/SuperAdmin/attendance-requests` | `attendanceRequestController.getAllAttendanceRequests` |
| Leave Requests | `pages/hrms/LeaveManagement/HRAdminLeaveRequest.jsx` | `/hrms/SuperAdmin/leave-requests` | `leaveController.getAllEmployeesLeaveRequests` |
| Salary Structure | `pages/hrms/Payroll/SalaryStructure.tsx` | `/hrms/SuperAdmin/payroll/salary-structure` | `salaryStructureController.getAllSalaryStructures` |
| Payroll Run | `pages/hrms/Payroll/PayrollRun.jsx` | `/hrms/SuperAdmin/payroll/run` | `payrollController.getPayrollByMonth` |
| Payslips (company-wide) | `pages/hrms/Payroll/Payslips.jsx` | `/hrms/SuperAdmin/payroll/payslips` | `payslipController.getAllPayslips` |
| Statutory Reports | `pages/hrms/Payroll/StatutoryReport.jsx` | `/hrms/SuperAdmin/payroll/statutory-report` | `statutoryReportController.getStatutoryReports` |
| Job Openings | `pages/hrms/Recruitment/JobOpenings.jsx` | `/hrms/SuperAdmin/recruitment/job-openings` (also Manager) | `jobOpeningController.getAllJobOpenings` |
| Candidates | `pages/hrms/Recruitment/Candidates.jsx` | `/hrms/SuperAdmin/recruitment/candidates` (also Manager) | `candidateController.getAllCandidates` |
| Interview Pipeline | `pages/hrms/Recruitment/InterviewPipeline.jsx` | `/hrms/SuperAdmin/recruitment/pipeline` | same `candidateController.getAllCandidates` (no dedicated pipeline endpoint) |
| Companies | `pages/hrms/SystemConfigration/Company.tsx` | `/hrms/SuperAdmin/companies` | `companyController.getCompanies` |
| Document Verification | `pages/hrms/DocumentVerification.tsx` | `/hrms/SuperAdmin/document-verification` | `documentController.getAllDocuments` |

Two of these are worth calling out specifically because the backend is *already*
pagination-ready and the frontend just isn't using it — the easiest class of fix if
this list is ever picked up:

- **Companies (`Company.tsx`)** — `getCompanies` already does real `.skip()/.limit()` +
  `countDocuments`. The frontend calls `GET /companies` with no params and discards the
  returned `pagination` object entirely. With >10 companies, the table silently shows
  only the first 10, with no way to reach the rest.
- **Document Verification** — the employee-picker side of this page fetches
  `GET /users?limit=1000` (a hardcoded cap, not real pagination) even though `getUsers`
  fully supports `page`/`search`/real backend filtering (confirmed elsewhere in this
  audit as the reference-correct implementation). The doc list itself
  (`getAllDocuments`) has no pagination on either side — a company-wide, ever-growing
  fetch.

## 2. Small/bounded lists — no pagination needed, no issues

- **Leave Types & Rules** (`pages/hrms/LeaveManagement/LeaveType.jsx`) — small
  per-company config list, correctly companyId-scoped.
- **Holidays** (`pages/hrms/Holidays/Holiday.jsx`) — small per-company yearly list,
  correctly companyId-scoped (backend enforces scoping server-side regardless of what
  the frontend sends).
- **HR Policy** (`pages/hrms/SystemConfigration/Policies.jsx`) — small, self-seeding to
  ~15 rows per company, correctly companyId-scoped.

## 3. Already correct — reference examples

- **Attendance Record** (`pages/hrms/AttendanceReport.tsx`, shared with Manager) — real
  end-to-end pagination (paginates on `User`, then bulk-fetches that page's attendance
  via one `$in` query — not N+1), real backend search, correctly scoped.
- **Expenses** (`pages/hrms/Expenses.jsx`, `HrExpenses`) — real end-to-end pagination,
  real backend category/month filters, correctly scoped, efficient aggregate queries.
  Best implementation found in this entire HR-Admin pass.
- **Dashboard** (`pages/hrms/HRMSDashboard.tsx`) — pure aggregate/summary page, capped
  "recent" lists (`.limit(5)`), correctly scoped. No changes needed by design.

## 4. Not a pagination issue — genuine companyId scoping gap (flagging for security review)

**Statutory Reports** (`pages/hrms/Payroll/StatutoryReport.jsx` →
`statutoryReportController.getStatutoryReports`): queries `Payslip.find({ month })` with
**no company restriction at all**. This is different from every other "legacy model, no
companyId field" case in this audit — the sibling endpoint `getAllPayslips` scopes the
exact same `Payslip` model correctly via a `User`-lookup-by-companyId pattern; this
endpoint simply doesn't apply it. As written, one company's HR-Admin could see
statutory report data drawn from every company's payslips for a given month. Worth
prioritizing over the pagination items above.

## 5. Dead route — a feature that will 404 in production

**Add User → Bulk Import** (`pages/hrms/AddUser.tsx`, `BulkImportModal`): posts to
`/api/bulk-upload/employees/parse` and `/api/bulk-upload/employees/save`. Grepped the
entire backend — **no matching route or controller exists for `bulk-upload`
anywhere**. The "Bulk Import" button is fully wired up in the UI but will fail with a
404 the moment someone uses it.

## 6. Other anti-patterns worth knowing about (not blocking, not fixed)

- **Payslips.jsx** filters by month entirely client-side (`res.data.filter(p => p.month
  === month)`) over the full unbounded fetch described in §1 — the backend doesn't
  accept a month param at all, unlike `PayrollRun`/`StatutoryReport`'s siblings which do.
- **Profile.tsx**'s Reporting Manager dropdown calls plain `GET /users` (default
  page-1/limit-15, no `role=Manager` filter) and filters client-side — managers outside
  the first page of the default sort are invisible in this dropdown. (`AddUser.tsx`
  does this correctly elsewhere in the same file, via `?role=Manager`.)
- **PayrollRun.jsx**'s "generate payroll" path fetches five full unbounded lists
  (`/users`, `/salary-structures`, `/leave-types`, `/leaves/all`, `/attendance/all`) and
  does the payroll math client-side with nested per-user/per-day loops — a real
  performance concern as company size grows, though it's a frontend compute cost, not a
  backend N+1.
- **Company.tsx** — `checkCompanyPermission`'s row-restriction check (`filter._id =
  req.user.companyId`) does not include `HR-Admin` in its bypass list alongside
  Superadmin/Super Admin/super_user, meaning an HR-Admin with a `companyId` set would
  actually be restricted to viewing only their own company — which seems to contradict
  this page's apparent "multi-company list" design. Flagging as a discrepancy to
  resolve with whoever owns the intended permission model, not a confirmed bug.

No other dead routes were found — every other API path called across these 19 files
has a matching registered Express route.
