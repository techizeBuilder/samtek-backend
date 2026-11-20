# Purchase separated from Accounts (what changed)

*Built 16 November 2026. Logic and your decisions (option 2, Q1–Q4): [01-logic.md](01-logic.md). Browser test: [03-test-roadmap.md](03-test-roadmap.md).*

## In one line
**Purchase is now its own parent module** next to Accounts, on the same Accounts roles. Each person sees and hears only the module(s) the Company Admin gives them. Accounts is now told about money it used to learn about only by looking: advances to pay, and refunds or credits owed back.

## The menu
- **Accounts** keeps its pages, minus the old "Purchases" group. It gains a **Vendor Payments** group:
  - **Purchase Invoice:** `/accounts/purchase-invoices`
  - **Vendor Payment:** `/accounts/vendor-payments`. It now also opens on one vendor when a notification links to it.
  - **Payable Ageing:** `/accounts/payable-ageing`
- **Purchase** is a new group:
  - **Purchase Dashboard:** `/purchase/dashboard`
  - **Vendor Master:** `/purchase/vendors`
  - **Purchase & Outsource:** `/purchase/purchase-outsource`
  - **Inventory:** `/purchase/inventory`
  - **Purchase Expenses:** `/purchase/expenses`
  - **Purchase Reports:** `/purchase/reports`
- **Payment Verifications** now needs Accounts → Sales.
- **Tender Expenses** now needs Accounts → Tender Expenses.
- Because of those two changes, a purchaser-only user doesn't see either of them.
- **Old addresses still work.** Every `/accounts/purchases/...` page opens its new home, keeping anything after the `?`. So bookmarks and links in older notifications still land on the right PO or order.
- **Landing after login:** an Accounts-role user who has Purchase but no Accounts dashboard opens the **Purchase Dashboard**.
- **The Purchase Dashboard's money tiles** (Payments, Refunds due) open Vendor Payment only for someone who also holds Vendor Payments. For a purchaser they're for reading only.

## Permissions (Roles & Permissions)
- **New module "Purchase"** for the Accounts roles:
  - **Purchases:** the buying work
  - **Purchase Expenses**
  - **Purchase Settings**
  - **Purchase Audit Log**
  - **Purchase Head**
- **Accounts:**
  - gains **Vendor Payments** (bills, payments, ageing, refunds and credits) and **Tender Expenses**
  - loses Purchases, Purchase Settings and Purchase Audit Log
- **Purchase Head** gives a person:
  - the team view on the Purchase Dashboard
  - the right to edit or delete anyone's Purchase Expenses
  - the "purchase request for approval" bell
  - the "Purchase email not set up" bell

  It no longer comes from being an Accounts Head. A Company Admin is treated as Purchase Head, as before.
- **Defaults for new users:**
  - an **Accounts Head** gets everything in both modules
  - an **Account Employee** gets view + add in both, full rights on their own expenses, and no Purchase Head
- **Day one, once per person** (when the server starts):
  - Everyone who had Accounts → Purchases gets Purchase → Purchases and Purchase Expenses, plus Accounts → Vendor Payments and Tender Expenses, with the **same actions** they had.
  - Purchase Settings and Audit Log move with their holders.
  - Today's Accounts Heads get the Purchase Head tick.
  - The old keys are removed. **The Company Admin then trims** each person.
  - It never runs again for that person, so something the admin takes away stays away.
- **Safety net:** the old single key (Accounts → Purchases) still opens both sides, on the server and on the screens. This covers anyone the move hasn't reached yet.

## The server checks
- **Buying** (vendors, RFQs, quotations, purchase requests, POs, QC rejections, returns, outsource work, serial numbers, price history, dashboard, purchaser scores) needs **Purchase → Purchases**. Store's own "Purchase Orders" permission still works where it did.
- **Purchase Expenses**, **Purchase Settings** and **Purchase Audit Log** need their own Purchase permissions.
- **Money** (purchase invoices, vendor payments and slips, vendor outstanding, payment stats, refunds and credits) needs **Accounts → Vendor Payments**.
- **Shared look-ups** work with either module: the vendor list, a vendor's items, and reading a PO. An accountant paying a bill still needs to see the PO and vendor; a purchaser still needs the vendor list.
- **Tender Expenses** needs **Accounts → Tender Expenses**.
- The API addresses didn't change; only who may call them.

## Notifications
- **How they're aimed:** a purchase or money notification now goes **to each person who holds the permission**, as a personal bell entry. It no longer goes to "the Accounts roles", because purchasers and accountants share those roles. Anything aimed at Store, the Company Admin, Sales, a PO's creator or a requester is unchanged.
- **To Purchase holders:**
  - a new purchase request from Store
  - a vendor bid
  - outsource requests and hand-offs
  - outsource work back short
  - delivery due tomorrow / overdue (Store still hears too)
  - vendor documents expiring
  - vendor on the watchlist
  - warranty claims with no PO creator
  - make-or-buy price notices
  - the two exchange notices
  - **Low Stock alerts** (Accounts' copy; Store still hears). Added during the build: low stock is a buying matter.
- **To the Purchase Head:** a purchase request for approval, and "Purchase email not set up".
- **To Accounts → Vendor Payments:** a PO or outsource order ready for full payment, and payment overdue.
- **To Accounts → Sales:** the sales-side notices, e.g. order created, payment checks, NOC, packed order payment, order form submitted, dispatched / delivered, packing completed. A purchaser-only user no longer gets these.
- **New, to Accounts → Vendor Payments:**
  - **"Advance to pay: PO-…":** when a PO with an advance becomes a real order (placed directly, or approved). It gives the amount and %.
  - **"Advance to pay: OSO-…":** when an outsource order's bill has an advance.
  - **"Refund due from (vendor)" / "Credit with (vendor)":** whenever money comes back to us, i.e. a cancellation's leftover advance, a QC rejection, or a loss at an outsource vendor. A written-off amount sends nothing.
  - Clicking any of these, or "ready for full payment" / "payment overdue", opens **Vendor Payment on that vendor**.
- **Fixed on the way:** "Exchange needs a vendor" and "Vendor accepted the exchange" were sent but never arrived. The notification service had no handler for them. They now reach Purchase.
- **No double bells:** a PO's creator (usually a purchaser) gets the "delivery due tomorrow / overdue" bell once, not again as a Purchase holder. Caught by the regression run.
- **Unchanged:** a notification sent without a company still goes to the roles, as before, so nothing is lost. Emails are unchanged.

## Found while testing
- **A bug in this build, caught by the tests and fixed before you saw it:** the new "refund / credit" hook stopped every refund or credit record from saving.
- **Older records with the same problem: fixed the same day, at your go-ahead.** A full check found 11 steps in 10 records, including the **ledger entry** (lead payments → ledger). See [../mongoose9-pre-hooks-fix-2026-11.md](../mongoose9-pre-hooks-fix-2026-11.md); suite `prehooks` 14 of 14.

## Tests
- **New suite `purchsep`, 76 checks, all passing.** It covers:
  - who can call what (purchaser, accountant, Purchase Head, the old key)
  - the Purchase Head's dashboard view and expense editing
  - who hears each notification, including another company hearing nothing
  - the delivery and payment sweeps
  - the three new money notices with their amounts (30% of ₹1,180 = ₹354; 25% of ₹2,360 = ₹590)
  - the one-time move (runs once; a removed tick stays removed)
- **Updated for the new audience:** `mailbox` (the Purchase bell now goes to the Purchase Head) and `makebuy-s1` (the price notices now go to Purchase holders). Copies of the old versions were kept.
- **Also updated for the new audience:** `due` (Purchase holders replace the Accounts Head; the creator gets one bell) and `notif-data` (its made-up company needed a purchaser).
- **Regression, all passing:**
  - `mailbox` 17, `makebuy-s1` 17, `hrperms` 33 (menu and permission catalogue), `due` 7, `notif-data` 10
  - `slice2` 54, `slice3` 28 (acceptance and payment sweeps)
  - `alllost` 50 (outsource money back)
  - `partial-3c` 16, `paid-before` 4, `ga` 45
- **Skipped:** the remaining procurement and outsource suites. They don't touch who is notified or the permission checks; the gates they call honour the old key either way.
