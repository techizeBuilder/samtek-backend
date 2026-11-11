# HR permission gap (what changed)

*Fixed 11 November 2026, found by you during the device sync browser test.*

## The problem
Attendance, Payroll and Recruitment showed in the sidebar but opened to "access denied", and Company Admin's Roles & Permissions page couldn't grant them.

**The cause:** each menu item names a permission, and the page guard requires it. But Roles & Permissions only listed 9 HR permissions, and these weren't among them, so nobody could ever hold them. It was wider than those three pages:

| Who | Was blocked |
|---|---|
| HR-Admin | Attendance, Payroll, Recruitment, Leave, Companies, Branches, parts of Training |
| Manager | Their whole HR menu |
| Employee roles and Heads | My Profile, Attendance, Leave, Payroll, Requests |

**A correction:** the Heads' self-service menu built on 6 Nov would have shown but been refused. It had only been compiled, not opened.

## What changed

### Self-service needs no permission
A person's own attendance, leave, payslips and documents (`/hrms/Employee/...`) now open for anyone whose role has that menu. The server already limits these to the person's own records.

### Company Admin can grant the rest
Roles & Permissions now lists, per role:
- **HR-Admin:** the 9 from before, plus Companies, Branches, Leave Requests, Leave Types, Attendance Record & Device, Attendance Requests, Salary Structure, Payroll Run, Payslips, Statutory Reports, Job Openings, Candidates, Interview Pipeline, Trainees, Training Modules, Question Bank.
- **Manager (new on the page):** Team Members, Team Attendance, Leave Requests, Attendance Corrections, Overtime, Expense, Travel, Profile Update Requests, Interview Feedback.
- **Company Admin:** the same 9.

Add Employee also gives a new Manager these by default, with the same grid.

### Existing users
At server start, each HR-Admin and Manager gets the new permissions switched on, **once.** Anything a Company Admin removes afterwards stays removed. There's no script to run on live.

### The sidebar matches
An unticked item now leaves the menu for HR-Admin and Manager, instead of showing and opening to "access denied".

## Still open
**Payroll's server routes have no permission check.** Run, reset, recalculate and status only need a login, so any logged-in user could call them directly; the screen guard doesn't stop that. Attendance, salary and recruitment routes need checking for the same thing. Not fixed here.

## Tests
- **New suite `hrperms`: 27 of 27.** Its main check reads the real menus and confirms every permission they need can be granted for that role, which would have caught this.
- **Regression:** `devicesync` 80, `people` 123. Other suites skipped, because none uses this code.
- **On dev:** all 5 HR-Admins and 4 Managers received their permissions.
- **Browser:** all checks passed 11 Nov.

## Browser check
Log out and back in first, because permissions load at login.
- [x] **HR-Admin:** Attendance Record and Attendance Device opened (11 Nov). Payroll and Recruitment reported done.
- [x] **Check A, Company Admin can grant and take away an HR permission:** passed 11 Nov. With Payroll Run unticked, rahul's Payroll menu showed Salary Structure, Payslips and Statutory Reports only; ticked again, Payroll Run came back.
- [x] **Check B, a Manager's menu opens:** passed 11 Nov (test manager).

### Check A: Company Admin grants and takes away Payroll Run
1. Log in as Company Admin **Rahul Pramanik**. In the left menu, click **Roles & Permissions**.
2. In the search box, type `rahul`. On the row for **rahul (HR-Admin)**, click the pencil icon (**Edit User**) on the right.
3. A box titled **Edit User: rahul** opens. Scroll down to **Module Permissions**, to the HR card.
   - **Expect:** the usual 9 rows (Dashboard, Employee Management and so on), then 16 new ones: Companies, Branches, Leave Requests, Leave Types & Rules, Attendance Record & Device, Attendance Requests, Salary Structure, **Payroll Run**, Payslips, Statutory Reports, Job Openings, Candidates, Interview Pipeline, Trainees, Training Modules, Question Bank. All are ticked already.
4. On the **Payroll Run** row, untick **View**. Click **Update User** at the bottom.
5. Log out. Log in as HR-Admin **rahul**. Open **Payroll** in the left menu.
   - **Expect:** Salary Structure, Payslips and Statutory Reports are there. **Payroll Run is gone.**
6. **Put it back:** log in as Rahul Pramanik again, edit rahul, tick **View** on Payroll Run, click **Update User**. Log in as rahul: Payroll Run is back.

### Check B: a Manager's menu opens
1. Log in as **test manager**.
   - **Expect** in the left menu: Dashboard, Task Management, My Task, **Team** (Team Members, Team Attendance), Holiday Calendar, Leaves - Employee, Performance Metrics, **Approvals** (6 items), **Recruitment** (Interview Feedback).
2. Click each of these. Each should open its page, **not** an "access denied" page:
   - Team → Team Members
   - Team → Team Attendance
   - Approvals → Leave Requests, Attendance Corrections, Overtime Requests, Expense / Reimbursement, Travel Requests, Profile Update Requests
   - Recruitment → Interview Feedback
3. **Team Members** should list **test employee** and **test packing employee**, the two people who report to test manager. It should not list test qc employee, who reports to test manager 2.
- [x] **A Head and an Employee:** reported working by you, 11 Nov (Production Head; test production employee).

## Files
**Backend:** `services/hrPermissionBackfill.js` (new), `index.js`.

**Frontend:** `lib/roleModulesConfig.js`, `config/moduleRoutes.js`, `components/layout/Sidebar.jsx`, `pages/RolePermissionManagement.jsx`, `pages/hrms/AddUser.tsx`, `pages/hrms/loginRoles.ts`.
