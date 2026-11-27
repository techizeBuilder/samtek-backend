# Feature 26: Super Admin pages per company (browser test)

*On dev, read-only: nothing is created, so nothing needs cleaning. What changed: [26-super-admin-changes.md](26-super-admin-changes.md). The suite `superadmin` (31) checks the numbers on made-up companies; this is about the screens.*

**Logins:** the Super Admin (`admin`), and any normal user (e.g. a Sales Employee).

## 1. Dashboard, all companies
1. **Super Admin → Dashboard:** "Showing: All companies".
   - The tiles show the totals.
   - The company table has a row per company and a Total row.
2. **Check two rows against what you know:**
   - **test-1 company:** 29 orders, order value ₹12,39,689, 0 open, 84 customers, 83 leads (80 won), 35 users
   - **Nexora:** 41 orders, ₹1,49,34,656, 29 open, 43 leads (27 won)
3. **Full report** on test-1 opens the Company Report, whose leads part now shows 80 won (it showed 0 before).

## 2. One company
1. **Click the test-1 row** (or pick it in the picker):
   - "Showing: test-1 company"
   - its tiles and the latest orders, customers and leads
2. **Latest orders → See all:** Orders opens with test-1 already picked.

## 3. Orders
1. **With test-1 picked:** 29 orders, all from test-1.
   - The status list has 8 statuses.
   - Pick **Completed**: 29. Pick **Pending**: 0.
2. **Switch the picker to Nexora:**
   - **Approved:** 22
   - **Waiting for service:** 5
3. **Search a customer's name:** only their orders. Clear it.
4. **Open an order:** company, customer, items, total.

## 4. Sales
1. **test-1:** 4 sales people, e.g. rahul (Sales Head) 20 orders, testsales employee2 6, testsales employee 3. Each row has leads (won).
2. **All companies:** Sales Heads and Sales Employees from every company. Before, only one person with the old "Sales" role was listed.
3. **Open a person:** their numbers and orders.

## 5. Customers
1. **test-1:** 84 customers with their company, orders, order value and last order.
2. **Inactive:** only inactive ones.
3. **Open a customer:** their orders.

## 6. The picker stays
1. **Pick Nexora on Customers,** then go to Orders from the menu: still Nexora.
2. **Refresh:** still Nexora.
3. **Pick "All companies":** everything again.

## 7. Only the Super Admin
1. **Log in as a Sales Employee** and open `http://localhost:5173/super-admin-dashboard`: the page is refused, as before.
2. **Their sidebar** still shows their company's name and logo, so nothing else broke.
