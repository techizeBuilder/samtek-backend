# HR server routes locked down (what changed)

*Fixed 11 November 2026, right after the [permission gap](04-hr-permission-gap-changes.md).*

## The problem
The screens were guarded, but the server routes behind them only checked that someone was logged in. Any logged-in user could call them directly: an employee could run payroll, read everyone's salary, or approve their own attendance correction.

**Two were worse:**
- **Deleting every payslip** in every company needed **no login at all.**
- **Payroll reset** for a month deleted that month's payroll for **every company**, not just yours. Generating payslips also picked up every company's payroll.

## What changed
Each route now needs the same permission as its screen, from Roles & Permissions:

| Area | Read | Change |
|---|---|---|
| Payroll | Payroll Run, view | Run: add. Status, reject, recalculate: edit. Reset: delete |
| Payslips | Payslips, view | Generate: add. Send: edit |
| Salary structures | Salary Structure or Payroll Run, view | Salary Structure: add, edit, delete |
| Statutory reports | Statutory Reports, view | Generate: add |
| Job openings | Job Openings, Candidates or Interview Pipeline, view | Job Openings: add, edit, delete |
| Candidates | Candidates or Interview Pipeline, view | Candidates: add, edit, delete. Status and feedback also for Interview Pipeline, and feedback for a Manager's Interview Feedback |
| Attendance of others | Attendance Record, Team Attendance or Payroll Run, view | — |
| Attendance requests | Attendance Requests (HR) or Attendance Corrections (Manager) | Approve: same, edit |
| Attendance policy | Anyone can read it | HR-Admin or Company Admin only |
| Delete all payslips | — | Platform admin only |

**Everything stays inside your own company:**
- **Payroll:** run, reset, status, reject and recalculate.
- **Payslips:** generate, download and send.
- **Salary:** add, read, edit and delete.
- **Recruitment:** job openings and candidates.
- **Attendance:** approvals. A Manager can approve only their own team's requests.

**Unchanged:** a person's own attendance, payslips, salary, attendance requests and the policy page. A payslip can be downloaded by its owner, or by HR in the same company.

## Worth knowing: the old server on the same database
Another server still running older code shares the dev database. When it starts, it puts back the old rule that every email must be unique, including blank ones. While that rule is there, a second person with no email is refused. This server removes it again when it next starts.

Once that server runs this code, the problem stops. Until then, if adding a no-email worker fails with a duplicate error, restart this server.

## Still not checked
Leave approval, leave balance override, overtime, expense, travel, profile-update and resignation approvals had the same gap. They were fixed next: see [approval routes](06-approval-routes-changes.md).

## Tests
- **New suite `hrroutes`: 92 of 92,** through the real running server. It covers each route refused for an employee and with no login, view-only against change, company scope, a Manager's team, and people's own records still working.
- **Regression:** `devicesync` 80 and `people` 123. Both were adjusted to give their made-up HR users the permissions the routes now require.

## Files
**Backend:**
- **New:** `utils/companyScope.js`
- **Routes:** `payroll`, `payslip`, `salaryStrctureRoute`, `statutoryReport`, `jobOpening`, `candidate`, `attendance`, `attendanceRequest`, `attendancePolicy`
- **Controllers:** `payroll`, `payslip`, `salaryStructure`, `jobOpening`, `candidate`, `attendanceRequest`
