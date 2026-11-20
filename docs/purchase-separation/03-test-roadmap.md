# Purchase separated from Accounts (browser test)

*On test-1, 16 November 2026 onward. What changed: [02-changes.md](02-changes.md).*

**Who plays whom**
- **Head:** the test Accounts Head ("test account head"). Keeps everything; Purchase Head.
- **Purchaser:** Account Employee 1 (testaccountemployee@…). Purchase only, after step 1.
- **Accountant:** Account Employee 2 (testaccountemployee2@…). Accounts only, after step 1.
- **Company Admin** to trim permissions; **Store** to raise a request.

The day-one move already ran on the dev database. All three have both modules now, so step 0 checks the move and step 1 trims.

## 0. Day one: nobody lost anything
1. Log in as the **Head**.
   - Sidebar: the Accounts pages, a **Vendor Payments** group (Purchase Invoice, Vendor Payment, Payable Ageing) and a **Purchase** group (Dashboard, Vendor Master, Purchase & Outsource, Inventory, Purchase Expenses, Purchase Reports).
   - No old "Purchases" group.
2. **Purchase → Purchase Dashboard:** it has the **Team / My work** switch (the Purchase Head tick).
3. Type the old address `/accounts/purchases/vendors`. It opens **`/purchase/vendors`**.
4. Type `/accounts/purchases/payments`. It opens **`/accounts/vendor-payments`**.

## 1. Company Admin trims
1. Company Admin → **Roles & Permissions** → Account Employee 1.
   - A **Purchase** module with Purchases, Purchase Expenses, Purchase Settings, Purchase Audit Log and Purchase Head (unticked).
   - **Accounts** shows Vendor Payments and Tender Expenses, and **no Purchases**.
2. Employee 1 (purchaser): untick **every Accounts feature** and save.
3. Employee 2 (accountant): untick **every Purchase feature** and save.

## 2. The purchaser
1. Log in as **Employee 1**. It lands on the **Purchase Dashboard** (not the Accounts one).
2. Sidebar:
   - only the **Purchase** group (plus the usual self-service items)
   - no Sales, Bank, Ledger, Vendor Payments, Payment Verifications or Tender Expenses
3. Vendor Master, Purchase & Outsource and Purchase Expenses all open and work.
4. Dashboard money tiles (if the view shows them) **don't click through**.
5. Type `/accounts/vendor-payments`. The page loads but shows no data: the server refuses. That's expected for a purchaser.

## 3. The accountant
1. Log in as **Employee 2**. It lands on the **Accounts Dashboard**.
2. Sidebar:
   - the Accounts pages and the **Vendor Payments** group
   - **no Purchase group**
3. **Purchase Invoice**, **Vendor Payment** and **Payable Ageing** open and show their data.
4. On Vendor Payment, pick a vendor. **Refunds & credits** shows.

## 4. Who hears what
1. **Store** raises a purchase request.
   - **Purchaser:** bell "New Purchase Request from Store".
   - **Accountant:** no bell.
   - Click it as the purchaser. It opens Purchase & Outsource.
2. **Head** approves it, if approval is needed: the approval bell went to the **Head** only.
3. **Purchaser** places a PO with an **advance** (e.g. 30%).
   - **Accountant:** bell **"Advance to pay: PO-…"** with the amount and %.
   - Click it. It opens **Vendor Payment on that vendor**.
   - **Purchaser:** no such bell.
4. **Accountant** pays the advance on Vendor Payment.
5. *Optional (needs a cancellation):* **Purchaser** asks to cancel that PO and it goes through. The accountant gets **"Refund due from (vendor)"**, and clicking it opens Vendor Payment on the vendor, with the row under Refunds & credits.
6. **Sales** submits an order form.
   - **Accountant:** bell "Sales Order Form Submitted".
   - **Purchaser:** no bell.

## 5. Purchase Expenses and the Purchase Head
1. **Purchaser** adds an expense.
2. **Head** opens Purchase Expenses. They can **edit** the purchaser's entry.
3. Company Admin **unticks Purchase Head** for the Head.
   - The Head logs in again: the dashboard has **no Team view**.
   - They can no longer edit the purchaser's expense.
4. **Tick it back** afterwards.

## 6. Tender Expenses
1. **Accountant** opens Accounts → **Tender Expenses**. It opens.
2. **Purchaser** doesn't see it in the menu.

## Not by browser (covered by the `purchsep` tests)
- the old Accounts → Purchases key still opening both sides
- the move running once, and a removed tick staying removed
- another company hearing nothing
- the outsource-order advance notice (₹590 on a 25% advance of ₹2,360)
- "Credit with (vendor)"
- a written-off amount sending nothing
- "payment overdue" going to the accountant
- the exchange notices

## Log
| Step | Result | Notes |
|---|---|---|
| 0 | **Passed** 17 Nov | Head's sidebar has Vendor Payments + Purchase groups, no old Purchases group; Purchase Dashboard opens on Team (Purchase Head tick from day one); both old addresses redirect. |
| 1 | **Passed** 17 Nov | Purchase module listed with its five features; Employee 1 saved with Purchase only (no Head), Employee 2 with Accounts only (checked in the database). Fixed on the way: the Edit User dialog's Role box looked empty for employee roles (they weren't in its list; the role was still kept on save). It now always lists the person's own role. |
| 2 | **Passed** 17 Nov | Purchaser lands on Purchase Dashboard (My work view, no Team switch); sidebar = My Task, Purchase group, self-service only; Vendor Master / Purchase & Outsource / Purchase Expenses work; money tiles not shown in My work view; `/accounts/vendor-payments` shows **Access Denied** (better than the expected empty page). |
| 3 | **Passed** 17 Nov | Accountant lands on Accounts Dashboard; sidebar = Accounts pages + Vendor Payments group, no Purchase group; Purchase Invoice / Vendor Payment / Payable Ageing show data; Refunds & credits shows for a picked vendor; `/purchase/vendors` shows Access Denied. |
| 4.1 | **Passed** 17 Nov | Store's PR075 ("Tool-A"): bell for the purchaser and the Head (holds Purchase), Superadmin copy kept; **not** the accountant (database checked). Notices from before the separation (PR074, Low Stock) still sit on the accountant's bell, as sent then to the roles. |
| 4.3 | **Passed** 17 Nov | PO-1794895646151-J5VE7YHG5 (rahul vendor, ₹3,834.82, 30% advance, approved by the Company Admin): accountant's bell "Advance to pay … ₹1,150.45 (30%)" (= 30% of ₹3,834.82); click opened Vendor Payment on rahul vendor with the PO's "Advance due ₹1,150.45" row. Sent to the accountant and the Head (holds Vendor Payments), **not** the purchaser (database checked); the purchaser got the approval notice. |
| 4.4 | **Passed** 17 Nov | The accountant paid the ₹1,150.45 advance (the cancellation below found it with the vendor). |
| 4.5 | **Passed** 17 Nov | The purchaser asked to cancel the PO and the Company Admin approved. The accountant's bell showed "Refund due from rahul vendor: ₹1,150.45 on PO-1794895646151-J5VE7YHG5 after cancellation". Vendor Payment on rahul vendor showed it under Refunds & credits as **To decide** (Vendor refunds it / Keep as credit). It went to the accountant and the Head only (database checked). The purchaser got only the "PO cancelled" notice, as the PO's creator. |
| 4.6 | **Passed** 17 Nov | Order form for ORD-0132 submitted: "📝 Sales Order Form Submitted" went to the accountant and the Head, **not** the purchaser. The same order's outsource notices ("Outsource Work Requested" ORD-2026-119, "New Sub Child Job Work Order" SCJW-2026-008) went the other way: to the purchaser and the Head, **not** the accountant. "Payment Check Requested" went to the accountant and the Head only. All checked in the database. |
| 5 | **Passed** 17 Nov | The purchaser added a ₹400 expense and the Head edited it. With Purchase Head unticked, the Head's dashboard had no Team view and they could not edit the purchaser's expense. Purchase Head is ticked back on (database checked). Neither employee has it. |
| 6 | **Passed** 17 Nov | The accountant opens Accounts → Tender Expenses. The purchaser has no Tender Expenses in the menu, and `/accounts/tender-expenses` shows **Access Denied**. |

**Browser test complete, 17 Nov 2026.** Every step passed. Step 4.2 (the approval bell goes only to the Head) didn't come up, because the test PO didn't need the Head's approval. The `purchsep` suite covers it.
