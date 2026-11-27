# Feature 26: Super Admin pages per company (what changed)

*Built 24 November 2026. Logic and your decisions: [26-super-admin-logic.md](26-super-admin-logic.md). Browser test: [26-super-admin-test-roadmap.md](26-super-admin-test-roadmap.md).*

## In one line
**The Dashboard, Orders, Sales and Customers pages now have a company picker at the top.**
- **All companies:** every company side by side.
- **One company:** only its data.

**Order value** counts approved, in production and completed orders only. **Only a Super Admin** can use these pages' server routes.

## The company picker (every page)
- **The choices:** "All companies", then every company (inactive ones marked).
- **Under the title:** "Showing: test-1 company, Pune" (or "All companies").
- **It stays when you move between the four pages:** it's kept in the address (`?company=…`) and remembered for the next visit.

## Dashboard
- **All companies:**
  - **tiles:** companies, orders, order value, open orders, customers, leads (won)
  - **the company table:** one row per company with orders, **order value**, open, customers, leads (won), users, last order, and a **Total** row
  - **clicking a row** opens that company's dashboard; **Full report** opens the existing Company Report
- **One company:**
  - its tiles (orders, order value, open, customers, leads (won), users)
  - its **latest orders**, **latest customers** and **latest leads** (10 each)
  - **See all** goes to Orders / Customers with the company kept, or to the Company Report for leads; a **Full company report** link

## Orders
- **Tiles:** orders, order value, open orders (for the filter in use).
- **Filters:** the company; **status, with all 8**:
  - Pending, Waiting for service, Rejected by service, Approved
  - Rejected, In production, Completed, Cancelled
- **More filters:** from / to dates; a search on order code **or customer name**.
- **The table:** order, company, customer, salesperson, amount, status, date; 20 a page, paged on the server.
- **A row** opens the order: company, customer, items, total, notes.

## Sales
- **Who's listed:** the real sales roles, **Sales Head and Sales Employee**, plus the older "Sales". Before, only "Sales" was listed: 1 person on dev instead of 14.
- **Tiles:** sales people, orders, order value, leads (won).
- **The table:** person (role), company, orders, order value, open, leads (won), last order.
  - **sort by:** order value, orders, leads or name
  - **search:** name / email; paged
- **A row** opens the person: their numbers and their orders (paged).

## Customers
- **Tiles:** customers, active, inactive.
- **The table:** customer, **company**, contact, city, **orders, order value, last order**, status.
  - **filters:** active / inactive; search on name, contact, mobile or city
  - paged on the server
- **A row** opens the customer: numbers and the latest 50 orders.

## The rules
- **Order value** = approved + in production + completed. Pending, waiting for service, rejected (both kinds) and cancelled don't count. Every page says so under its table.
- **Open orders** = pending, waiting for service, approved, in production.
- **A won lead** = status "Won" or the stage "Deal Won".
  - **On dev:** test-1 has 80, Nexora 27.
  - **Fixed:** the existing Company Report looked for status "Deal Won", which no lead has, so it always showed 0. It now uses the same rule.
- **Who may:** every `/api/super-admin` route now needs the Super Admin role ("Super Admin" or the older "Superadmin"). Two keep their own checks, because other screens use them:
  - one company's details (the sidebar and the Company Admin layout show their own company's name and logo)
  - the company dropdown (Roles & Permissions)

  Before, the company, inventory and API-settings routes there were open to any logged-in user.
- **Speed:**
  - every list is paged on the server
  - the numbers come from grouped queries: one per kind (orders / customers / leads / users), bounded by the company or the rows on the page
  - the old per-person and per-customer queries are gone

## Files
- **Server, new:**
  - `services/superAdmin/superAdminStats.js`: the rules, the company check, the per-company rows
  - `controllers/superAdminPagesController.js`: dashboard, orders, sales, customers, picker companies
- **Server, changed:**
  - `routes/superAdminRoutes.js`: the Super Admin guard; the four pages' routes point to the new handlers; `GET /picker-companies`
  - `controllers/companyController.js`: the Company Report's won-lead count
- **Screens:**
  - new `components/superAdmin/saUi.jsx`: the company hook, picker, header, tiles, status chips, pager
  - **rewritten:** `pages/SuperAdminDashboard.jsx`, `pages/super-admin/SuperAdminOrders.jsx`, `SuperAdminSales.jsx`, `SuperAdminCustomers.jsx`
  - the paths and menu are the same

## Tested
- **The new suite `superadmin`: 31 of 31,** through the real server on two made-up companies:
  - **the guard:** a Sales Employee and a Company Admin are refused; the Company Admin still reads their own company; the Super Admin is allowed
  - **dashboard numbers per company,** hand-counted: Alpha 6 orders, value ₹900, 3 open, 2 won leads
  - **one company's view;** a bad company refused
  - **orders:** per company, all 8 statuses, filters, customer-name search, paging
  - **sales:** all three roles, per-person numbers, per company, the person's details
  - **customers:** per company, order stats, inactive filter
- **On dev (read-only):** the Super Admin sees every company's row; test-1 has 29 orders (₹12,39,689), 84 customers, 83 leads (80 won), 4 sales people; the Company Report shows 80 won.
- **The screens bundle.**
