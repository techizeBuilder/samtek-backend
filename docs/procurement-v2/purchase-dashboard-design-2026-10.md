# Purchase Dashboard — what each role sees, and how every number is worked out

- **Date:** 2026-10-13
- **Status:** **built 2026-10-13** (change report §32). **Not yet clicked through in the browser**
  (test plan T40).
- **Code:**
  - `server/services/purchaseDashboardService.js`
  - `server/routes/purchaseDashboardRoutes.js` (`GET /api/purchase-dashboard`)
  - frontend `pages/accounts/purchase/PurchaseDashboard.jsx`
- **Blueprint:** §21 Dashboards (Purchase / Vendor / Purchaser / Store / Management) and §17 (the
  Store dashboard list).

The dashboard is **the last build of the purchase flow**. After it come browser testing (T18–T40)
and then the outsource flow.

---

## 1. Who sees what

The user's decision: **three people, three views**.

| Person | System role | View | Where |
|---|---|---|---|
| **Purchase employee** | Account Employee (with Purchases access) | **My work** | Accounts → Purchases → **Purchase Dashboard** |
| **Purchase head** | Accounts Head | **Team**, with a switch to **My work** (heads buy too) | Accounts → Purchases → **Purchase Dashboard** |
| **Company Admin** | Company Admin / Super Admin | **Management** | Company Admin → Purchase & Vendor Approval → **Dashboard** (first tab) |

- **Who decides the view:** the server, from the person's role.
- **Asking for a view above your role** (an employee asking for Team, say) is refused.
- **No separate pages for** the blueprint's Store, Vendor and Management dashboards: their contents
  are folded into these three views.

**Not built** (user, 2026-10-13):
- budgets / cost centres (X1, X2)
- separation-of-duties rules (X3)
- fraud alerts (X5)

## 2. Common rules

- **Live:** worked out fresh every time the page opens, from records we already keep. **Nothing
  new is stored.**
- **Every tile links** to the page where you act on it.
- **"Mine"** means records **I created**:
  - POs, quotation requests and manual quotations: their creator
  - QC rejections, replacements and deliveries: whoever created **the PO**

  It's the same rule as the purchaser score.
- **Open PO:** Draft / Sent / Acknowledged / Partially Received.
- **Period picker** (Management numbers): **This month · Last 3 months · Last 12 months**. A PO
  falls in a period by its order date.

## 3. My work (purchase employee; the head can switch to it)

| Tile | What it counts | Links to |
|---|---|---|
| **Items to buy** | Open RFQ/PO item cards with selected requests. Team-wide: requests aren't assigned to one person. | Purchase & Outsource → RFQ/PO |
| **My quote requests waiting** | My emailed requests still waiting for the vendor, link valid. Of them: **no reply after 3 days**. | RFQ/PO |
| **My requests — link ran out** | My requests whose 7-day link expired with no reply, in the last 30 days (send again or call) | RFQ/PO |
| **Quotes expiring soon** | Priced quotes on my requests / manual quotations, not yet ordered, ending today, tomorrow or the day after | RFQ/PO |
| **My POs waiting for approval** | My POs at Pending Approval | Purchase Orders |
| **My POs rejected (30 days)** | My POs the Company Admin rejected in the last 30 days | Purchase Orders |
| **My POs not emailed** | My open POs still Draft (the email didn't go out) | Purchase Orders |
| **My deliveries** | Lines of my open POs: **Overdue** · **Due today** · **Due in 3 days**. Lines waiting for the advance have no date and aren't counted. | Purchase Orders (due filter) |
| **QC rejections to settle** | Rejections on my POs **waiting for the vendor's answer**; of them, over 3 days old | QC Rejections |
| **Replacements expected** | Rejections on my POs where the vendor will replace | QC Rejections |
| **My score** | My purchaser score this month and over 12 months, and my weakest part | My Score |

## 4. Team (purchase head)

Everything in §3, **for the whole team**, plus:

| Tile | What it counts | Links to |
|---|---|---|
| **Waiting for the Company Admin** | POs at Pending Approval; cancellation / short-close requests waiting | Purchase Orders |
| **3-vendor compliance (this month)** | Share of PO items this month where enough vendors were asked (the vendor selection check) | — |
| **Payments** | From the PO bills: **advance due ₹**, **payable now ₹** (QC-passed material + fully accepted balances), **overdue ₹** (and how many bills) | Vendor Payment / Payable Ageing |
| **Refunds due from vendors** | Money vendors owe us back ("Refund due") ₹ | Vendor Payment |
| **Store pipeline** | Lines due today / overdue across open POs; deliveries received and **waiting for QC** | Store / QC |
| **Vendors to watch** | Approved vendors on the **Watchlist** and **Probationary**; the 3 lowest vendor scores | Vendor Ratings |
| **Open warranty claims** | Vendor warranty claims not closed; of them, waiting more than 7 days | Vendor Ratings |
| **Team scores** | Each purchaser's score this month and over 12 months | — |

## 5. Management (Company Admin)

| Tile | What it counts | Links to |
|---|---|---|
| **Waiting for you** | POs at Pending Approval, split by why (over the ₹ limit / vendor selection exception); cancellation requests; vendor requests (new vendor, vendor change, suspend / blacklist / reinstate) | the tabs on this page |
| **Purchase value** | Σ PO totals (real orders: not pending, rejected or cancelled) in the period, and a 6-month bar trend | — |
| **Savings** | POs whose selection check compared 2+ full quotes. **Saved:** where the cheapest was chosen, Σ (next-cheapest − chosen). **Paid above the cheapest:** where it wasn't, Σ (chosen − cheapest). | PO Approvals |
| **Price rises** | PO lines in the period priced **above that vendor's last delivered price** by the price-rise warning % (Purchase Settings, default 10%): how many lines, and the ₹ extra (difference × quantity). Same rule as "Bought before". | — |
| **Supplier concentration** | The top 3 vendors' share of purchase value in the period, with names and % | — |
| **3-vendor compliance** | As in §4, for the period | — |
| **Exceptions / urgent** | POs in the period that needed a vendor selection exception, counted per reason. "Urgent need" = the blueprint's emergency purchases. | PO Approvals |
| **Vendor risk** | Approved vendors on Watchlist / Probationary; High-risk class; Suspended + Blacklisted | Vendors tabs |
| **Payables** | Owed now ₹ (what's due and unpaid across PO bills and no-PO bills), overdue ₹, refunds due ₹ | — |
| **Purchaser scores** | Every purchaser's score this month and over 12 months | Purchasers |

## 6. Left out on purpose

- **Fraud / anomaly alerts** (X5): not built. Price rises and concentration are the nearest
  signals.
- **Stock-out events:** nothing records them.
- **"PO pending acknowledgement":** there's no acknowledgement step; the PO email is the
  commitment ("not emailed" is shown instead).
- **Budgets, cost centres, separation of duties:** not built (user).

## 7. Defaults

| What | Default | Where |
|---|---|---|
| "No reply" nudge | 3 days after sending | code (`NO_REPLY_DAYS`, shared with the reminders) |
| Quote expiring soon | within 2 days | code (`EXPIRY_WARN_DAYS`, shared) |
| Due soon | the next 3 days | code (`SOON_DAYS`, shared) |
| Rejection "waiting long" | over 3 days | code |
| Claim "waiting long" | over 7 days | code |
| Rejected / expired-link window | last 30 days | code |
| Price-rise line | the price-rise warning % | Purchase Settings |
| Concentration | top 3 vendors | code |
