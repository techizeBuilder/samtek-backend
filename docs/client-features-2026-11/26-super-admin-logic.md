# Feature 26: Super Admin pages per company (logic and decisions)

*24 November 2026. The client: the Super Admin pages (Dashboard, Orders, Sales, Customers) "are not organised properly, and we can't see data for an individual company".*

## What I found
| Page | Today |
|---|---|
| **All four** | **No company picker.** Every number and list mixes all companies (on dev: test-1 and Nexora each have their own orders, customers, leads). |
| **Dashboard** | All-company totals, then the latest 5 orders / customers / salespeople / companies. Nothing per company, nothing to compare companies. "Total Revenue" adds every order ever, whatever its status (pending, rejected, cancelled too). |
| **Orders** | The status filter offers 3 of the 8 order statuses (pending / approved / rejected): in production, completed, cancelled, the two service-approval ones can't be picked. |
| **Sales** | Looks for the role **"Sales"** (1 user on dev). The real roles are **Sales Head (3) and Sales Employee (10)**, so they're missing. One database query per person. |
| **Customers** | No company column or filter; order stats worked out with one query per customer. |
| **Server** | `/api/super-admin/*` only checks someone is logged in. The dashboard / orders / sales / customers handlers check the role themselves, but the company, inventory and API-settings routes don't, so any logged-in user could call them. |

**Already there:** a per-company **Company Report** page (Companies → Report).

## Decisions (24 Nov, as recommended)
1. **One company picker** at the top of every Super Admin page: **All companies** or one company.
   - It stays in the address (`?company=…`) and is remembered, so moving between the pages keeps it.
2. **Dashboard:**
   - **All companies:** a table with one row per company, plus a total row.
     - **columns:** orders, **order value**, open orders, customers, leads (Deal Won), users
     - **clicking a row** picks that company; a **Full report** link opens the existing Company Report
   - **One company:** that company's numbers, its latest 10 orders, customers and leads.
3. **Order value = approved and later only** (approved, in production, completed). Pending, waiting for service approval, rejected (either kind) and cancelled don't count. The same rule is used on the Dashboard, Orders and Sales, labelled "Order value".
4. **Orders:** a company filter (the picker) and column; the status filter lists all 8 statuses.
5. **Sales:**
   - **Who's counted:** the real roles (Sales Head, Sales Employee, and the old "Sales").
   - **Columns:** company, orders, order value, open orders, leads, Deal Won, last order.
   - **One query** for everyone's numbers, not one per person; paged and searched.
   - **A person's details:** their latest orders (paged) and their numbers.
6. **Customers:** a company filter (the picker) and column; order count / value / last order for the page in one query.
7. **Server:** a **Super Admin role check on every `/api/super-admin` route** ("Super Admin" or the older "Superadmin").
   - **Two routes keep their own checks,** because other screens use them:
     - one company's details: the sidebar and the Company Admin layout read their own company's name and logo
     - the company dropdown: Roles & Permissions
8. **Speed:** every list is paged on the server; numbers come from grouped queries bounded by the company and the people or customers on the page. No per-row queries.

## Not changing
- The Companies page, the Company Report and Settings / API settings, apart from the role check.
- What any other role sees.
