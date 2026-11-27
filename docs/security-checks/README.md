# Daily security checks

*Started 25 November 2026, at your manager's request: a little every day, one department at a time.*

## How a department is checked
1. **Its pages.** From the department's menu in the client's `config/moduleRoutes.js`: the page files and which server addresses each page calls.
2. **The guard on each address:**
   - is the login checked?
   - is the role or the permission tick checked, on the route or inside the code?
3. **Live tries through the real server,** on a made-up company, with fake people:
   - **no login, and other roles** (the Company Admin, HR, an employee, another department) → must be refused
   - **another company's records** → must be "not found" or refused
   - **the permission ticks:** someone with only **View** can't add, edit or delete; only **Add** can't edit or delete; and so on
   - **the department's own role** → must work (a control)
4. **The data is checked afterwards,** so a "refused" reply that still changed something is caught.
5. **A log per day:** what was checked, what held, the findings (with how serious they are) and what was fixed.

## Departments (from the client's menus)
| # | Department (menu) | Status |
|---|---|---|
| 1 | Super Admin | **Checked 25 Nov:** guards hold; 5 findings, **all fixed** the same day |
| 2 | Company Admin | **Checked 26 Nov, re-checked the full way (all 289 CA + HR routes) and M1–M6 fixed 27 Nov:** 11 pages read (9 already covered by suites); 1 finding (Operating Units had no company check, **fixed**), 1 low note left
| 3 | HR Admin | **Checked 26 Nov (re-checked with row 2):** 6 findings (leave types and HR policy documents high, HR expenses medium, holidays, documents, dashboard low), **all fixed** the same day at the user's call
| 4 | Manager | |
| 5 | Employee (self-service) | |
| 6 | Sales | |
| 7 | Accounts (and Purchase) | |
| 8 | Production | |
| 9 | Packing | |
| 10 | Packing and Dispatch | |
| 11 | Store | |
| 12 | QC | |
| 13 | R&D | |
| 14 | Complaint Head | |
| 15 | Complaint Agent | |
| 16 | Marketing | |
| 17 | Marketing Employee | |
| 18 | MIS Admin | |
| 19 | Trainee | |

## Logs
- [2026-11-25: Super Admin](2026-11-25-super-admin.md)
- [2026-11-26: super_user and the old dashboard](2026-11-26-super-user-and-dashboard.md) (found in a browser test)
- [2026-11-26: Company Admin](2026-11-26-company-admin.md)
- [2026-11-26: HR Admin](2026-11-26-hr-admin.md)
- [2026-11-26: re-check of Company Admin and HR the full way](2026-11-26-recheck-company-admin-hr.md) (M1–M6 fixed 27 Nov)

## Notes
- **The probes live in the scratchpad test kit,** e.g. `sec-superadmin-probe.mjs`. They clean up after themselves.
- **Your separate security chat** may cover the same ground. These logs say what was checked here.
