# Security, 26 November 2026: `super_user` and the old dashboard

*Found during feature 28's browser test (custom roles). Not the planned department of the day; logged here so the daily sweep knows. Both fixed on the user's call.*

## 1. `super_user`: a role that acted like a Super Admin, and HR could give it
**What it was:**
- `super_user` is a role left over from the first version. Only the old startup data file (`seed/seedUsers.js`, switched off at `index.js:145`) ever set it, and on dev no user has it.
- The server still treated it **like a Super Admin**:
  - `utils/companyScope.js` and `services/documentAccessService.js` (platform roles: every company's data)
  - the user list, company, document and statutory-report controllers
  - about 55 old `role !== USER_ROLES.SUPER_USER` checks (accounts, dispatch, expenses, finance, manufacturing, purchases, sales, the dashboard), which skip the unit or company limit for it
- **Nothing stopped HR or a Company Admin from giving it.** `roleRefusal` blocked only "Super Admin" and "Superadmin", and the user record accepts any role name. No form offers it, but one request to the server would have made someone `super_user`, and that person could then read across companies.
- It also showed in the built-in roles list on Company Settings.

**Fixed (removed, the user's choice):**
- `USER_ROLES.SUPER_USER` is deleted (`shared/schema.js`), so every old check takes the **restricted** path.
- `super_user` is out of the 6 places that spelled it out (`companyScope`, `documentAccessService`, `companyController`, `userController` ×2, `statutoryReportController` ×2, `documentController` ×2).
- `roleRefusal` refuses it for everyone, the Super Admin included: *"This role no longer exists."* (`RETIRED_ROLES` in `services/access/companyAccess.js`). This covers Add User, edit and Give Login.
- The built-in roles list leaves it out (`rolesFor`). It was also removed from the stored platform list (35 → 34 built-in roles). Backup: `D:\cs\db-backups\super-user-removal-2026-11-26\`.

## 2. The old dashboard: other companies' orders, revenue and stock
**What it was:**
- `/api/dashboard/metrics`, `production-chart`, `sales-chart`, `recent-orders` and `alerts` needed only a login.
- They were scoped by the person's **unit name only, never by company**. With no unit, the filter dropped out: **25 of the 84 active users on dev** would have seen every company's orders (70; dev has Nexora and test-1).
- `recent-orders` took any `limit`, so one request listed orders with **customer names and amounts**.
- Who lands on this page: any role without a dashboard of its own, which means custom roles (the user's test "Store manager" saw test-1's 29 orders and revenue with no permissions at all) and leftover roles such as Auditor or Admin. Anyone can also type `/dashboard`.

**Fixed (`controllers/dashboardController.js`, `pages/Dashboard.jsx`):**
- **Always the person's own company,** plus their unit when they have one. The Super Admin still sees all.
- **Only for someone who holds at least one page** (or the Company Admin). Otherwise: 403, *"The dashboard isn't available for you…"*. On screen, a plain welcome: *"No pages are switched on for you yet…"*
- **Limits:** recent orders at most 20, charts at most 90 days.

## Checked
**`sec-su-dash-test` (kit), 20 of 20.** The dashboard checks run on the real dev data.
- **`super_user`:**
  - refused for HR, the Company Admin and the Super Admin, in any spelling; HR can still give Sales Employee
  - no longer a platform admin, held to its company
  - gone from the role constants, every stored list and every user
- **Dashboard:**
  - no pages → refused (metrics and recent orders)
  - a page but no unit → only own company (29 of 70)
  - recent orders capped at 20, none from another company; no company → refused
  - `super_user` + `?unit=` of another company → still own company only
  - the Super Admin still sees all 70; the charts and alerts work, with the period capped

**Regression:** see the daily report.

## Left for later (noted, not changed)
- **`Admin`, `Auditor`, `Finance Manager`, `Production`, `Packing`, `Dispatch`, `Accounts` and `Sales`** are old built-in roles no form offers.
  - `Admin` counts as a top admin for tasks and training, the same level as HR, inside its own company.
  - Worth a pass on the Company Admin / HR security day: whether HR should be able to give them at all.
- **Custom roles** are being redesigned (feature 34). Until then, a custom-role user has no pages and gets the welcome page.
