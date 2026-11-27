# Re-check of days 2–3 the full way (26 November 2026): Company Admin and HR

*Why: days 2–3 read the guards and probed only the weak-looking spots. Day 1's method calls **every** address live for every role and checks the permission ticks. This redoes days 2–3 that way. **Findings are OPEN** (reported first; fixed only once the user decides).*

## How
**Probe `sec-matrix-probe` (kit).**
- **Routes:** every route in the Company Admin's and HR's route files (35 route files, plus `/api/users*`), read from the route definitions themselves: **289 routes**.
- **Each called as:** no login · a plain Sales Employee · HR View-only · HR View+Add · HR with all four · the Company Admin · a Manager, all in a made-up company.
- **Writes** sent `{}` and ids that don't exist.
- **23 routes acting widely were not called** (cash password, device sync / login / test, payroll run / reset / recalculate, payslip generate / send / cleanup, statutory generate, punch / break, give login, passwords). Their guards were read instead, and the cash password was probed on day 2.
- **Afterwards:** 18 records were made during the run, **all in the made-up company**, all removed; **none outside it**.

## What held
- **No login:** refused everywhere except one address (M3).
- **Managers** reach none of the HR / Company Admin pages.
- **Permission ticks:** wherever a route uses the View / Add / Edit / Delete switches, View-only HR passed no write and View+Add passed no edit or delete (0 leaks).
- **The day-2 and day-3 fixes** all hold.

## Findings (OPEN)
| # | How serious | What |
|---|---|---|
| M1 | **High (app-wide)** | **`authorizeRoles` widens a Head role to the whole department** (`middleware/auth.js`). A route that allows "Sales Head" also lets **Sales Employees** in; the same for Accounts, Production, Packing and Dispatch. Seen here: training administration, the old task module's create / delete, and creating lead-setting requests all passed for a plain Sales Employee. This is **in every department's routes**, not only HR. The refusal also sends back the required roles and the path (low). |
| M2 | **High** | **The training switches fail open** (`checkAnyModuleFeature` in `middleware/permissions.js`). Someone with **no `lms` entry** is let through, and HR's training pages use other switches (Trainees, Training Modules, Question Bank). So View-only HR, a Manager and (with M1) a Sales Employee can **create, edit and delete training modules, questions, media and trainees** in their company. |
| M3 | Medium | **`/api/companies/simple` needs no login** and lists **every active company** on the platform (name, city, state, unit, type). No screen uses it; its `limit` has no cap; the search text goes straight into a pattern match. |
| M4 | Medium (privacy) | **`/api/users` and `/api/users/:id` give any employee every colleague's full record** in their company: mobile, address, date of birth, device code, permissions, probation notes and termination reasons (no password). |
| M5 | Low (design) | **HR pages with no switch** (Holidays, HR Policy, HR Expenses, attendance policy, device link) are gated by role only, so a View-only HR can still change them. Those menu items have no switch, so this may be as intended. |
| M6 | Low | **The old Task Management API** (`/api/hrms/tasks`, replaced by feature 25) is still live, and, through M1, a Sales Employee passes its create / delete guards. |

## Proposed fixes (waiting for the user)
- **M1:**
  - "X Head" means only the Head; the old department names ("Sales", "Accounts", ...) keep meaning the whole department.
  - Then go through every route that lists only a Head, to find any that employees really need, and add those employees there by name.
  - Run all suites; drop the debug details from the refusal.
  - This is the largest change: it touches every department.
- **M2:** the training actions check HR's own switches (Trainees / Training Modules / Question Bank) for HR, and fail **closed** when no switch is found. The Heads keep their `lms` switch.
- **M3:** remove it (nothing uses it), or require the Super Admin.
- **M4:**
  - HR / the Company Admin / Managers (their team) keep the full record
  - everyone else gets a short card: name, employee ID, role, department, designation
  - first check which screens call `/api/users` as an employee
- **M5:** decide whether those pages need switches; otherwise leave as is.
- **M6:** remove the old routes if no screen uses them (check first), or limit them to the roles that may use them by name.

## Fixed (27 Nov, the user: "fix all")
| # | Fix | Where |
|---|---|---|
| M1 | **A Head role means only the Head.** A department name ("Sales", "Accounts", ...) still means the whole department, and an Employee role also lets that department's Head in. The refusal no longer sends back the required roles and the path. **The audit** (kit `m1-audit.mjs`, resolving nested role lists) found only 4 route files that relied on the old widening: training (now guarded by M2), the old task API (removed, M6), lead-setting requests (the button is the Sales Head's, so employees are now refused like the screen) and expense requests (the Accounts Expenses page is the whole department's, so **Account Employee** is now named there to keep it working). | `middleware/auth.js`, `routes/expenseRequest.routes.js` |
| M2 | **Training fails closed.** HR / the Company Admin need HR's own switches (Trainees / Training Modules / Question Bank) with the action; a Head needs their module's training (`lms`) switch; anyone else (Managers, employees) is refused; the Super Admin always. `checkAnyModuleFeature` (now unused) also fails closed. | `routes/trainingManagementRoutes.js`, `middleware/permissions.js` |
| M3 | **The public company list removed** (no screen used it). | `routes/companyRoutes.js` |
| M4 | **Colleagues see a short card** (name, employee ID, role, department, designation, photo, active) in the list and by id. Full records: yourself, HR, the Company Admin, the Super Admin, and a Manager for their own team. Every screen that calls these was checked: HR / Company Admin / Manager pages, and employees only open their own record. | `controllers/userController.js` (`USER_CARD_FIELDS`, `userCard`) |
| M5 | **Switches for HR's Holidays, HR Policy (and the attendance policy) and HR Expenses** (`holidays`, `hrPolicy`, `hrExpenses`). HR needs the switch with the action (`hrRoleSwitch`); the Company Admin and the Super Admin keep them by role (holidays stay HR's only, as the holiday code already said). **A one-time grant** gave every existing HR all four (5 on dev); the menu items now need the switch. | `middleware/permissions.js`, the four route files, `services/hrPermissionBackfill.js`, `index.js`; client `lib/roleModulesConfig.js`, `config/moduleRoutes.js` |
| M6 | **The old Task Management API is no longer mounted** (no screen used it; old tasks show under "Before KRA" through `/api/kra-tasks/legacy`). `caadduser` now checks it's gone. | `index.js` |

**Check: `sec-recheck-fixes-test` (kit), 40 of 40.** **Regression:** `hrperms` 36, `caadduser` 19 (now checks the old task API is gone), `sec-hr-fixes` 22 (its HR given M5's switches), `approvals` 38, `people` 123, `companyaccess` 42, `headapprove` 34, `peopleimport` 21, `customroles` 48, `taskperm` 23, all passing.
