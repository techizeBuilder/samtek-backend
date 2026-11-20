# Purchase separated from Accounts (logic)

*Written 16 November 2026. Your decisions: option 2 (two parent modules on the existing Accounts roles, no new department); Purchase Expenses goes to Purchase; Vendor Payment stays in Accounts, and the notifications follow the money; Q1–Q4 in section 9. Built the same day: [02-changes.md](02-changes.md). Two more notices were moved during the build: Low Stock (Accounts' copy → Purchase) and "Purchase email not set up" (→ Purchase Head).*

## 1. Today
- **Purchase is one menu group inside Accounts:** "Purchases", with 11 pages.
- **One permission covers all of it:** the Accounts feature "Purchases", plus two small ones, Purchase Settings and Purchase Audit Log. About 30 server checks across 15 route files use it, including the vendor bills and payments.
- **Purchasers and accountants have the same roles** (Accounts Head / Account Employee), and **every notification is sent to roles**. So today a notification can't go to "the purchase team" without also reaching every accountant, and the other way round.
- **The same people bought and paid,** so nothing ever told Accounts "an advance is owed" or "a refund is due". They saw it themselves.

## 2. After: two parent modules
- A user's sidebar shows **Accounts**, **Purchase**, or both, depending on what the Company Admin gives them in Roles & Permissions.
- **A purchaser gets Purchase only** and sees no Sales, Bank, Ledger or vendor payments. **An accountant gets Accounts only** and sees no POs or vendors. Someone doing both gets both.
- **No roles change and no data moves.** Only menus, permissions, server checks and who is notified.
- **Old addresses keep working:** `/accounts/purchases/...` redirects to the new `/purchase/...` pages, so bookmarks and the links inside older notifications still open.

## 3. Which page goes where
| Purchase (buying) | Accounts (money) |
|---|---|
| Purchase Dashboard | **Purchase Invoice** (vendor bills) |
| Vendor Master | **Vendor Payment** |
| Purchase & Outsource (requests, quotations, RFQ, POs, outsource orders, QC rejections, replacements, returns) | **Payable Ageing** |
| Inventory (Purchase view, estimated prices) | **Money back** (vendor refunds and credits after a cancellation, short close or loss at a vendor) |
| **Purchase Expenses** (your decision) | Sales, GST & TDS, Bank & Cash, Ledger, Reports, Payment Reminders, Settings |
| Purchase Settings (PO templates, quote rules), Purchase Audit Log | Tender Expenses (see §9 Q3) |
| Purchase Reports | |

**The rule of thumb:** everything up to "the goods arrived and QC took them" is Purchase. Everything about paying, owing or getting money back is Accounts.

## 4. Permissions
- **A new module, "Purchase",** in Roles & Permissions, for the Accounts roles:
  - **Purchases:** the buying work, i.e. every page in the left column above except the three below
  - **Purchase Expenses**
  - **Purchase Settings:** moves here from Accounts
  - **Purchase Audit Log:** moves here from Accounts
  - **Purchase Head** (Q4, your decision): the head's powers in purchase. Today these come from the Accounts Head role:
    - the whole team's work, money and vendors on the Purchase Dashboard (others see only their own)
    - editing or deleting anyone's Purchase Expenses (others only their own)
    - the "purchase request for approval" bell

    The Company Admin ticks it for whoever leads purchase, whatever their role. **Day one:** ticked for today's Accounts Heads, so nothing changes until the client moves it.
- **The Accounts module gets two new features:**
  - **Vendor Payments:** Purchase Invoice, Vendor Payment, Payable Ageing, Money back
  - **Tender Expenses:** gated by "Purchases" today, which wouldn't make sense any more; see §9 Q3
- **Accounts' old "Purchases" feature goes away.**
- **Store keeps its own "Purchase Orders" permission** to the request page, as now.
- **Day one, nobody loses access:**
  - everyone who has Accounts → Purchases today gets **both** Purchase → Purchases **and** Accounts → Vendor Payments, with the same actions (view / add / edit / delete)
  - Purchase Settings and Purchase Audit Log move with their holders
  - the Company Admin then removes what each person shouldn't have
  - This runs once per user, the same pattern as the Order Tracking grant, and a permission removed later stays removed.

## 5. Notifications: the main work
**How they're aimed (new):** a notification about purchase work goes **to each user who holds Purchase** (a personal bell entry each). A notification about money goes to each user who holds **Accounts → Vendor Payments**. Notifications already aimed at one person (the PO's creator, the requester) or at Company Admin / Store stay as they are.

### 5a. Moving from "the Accounts roles" to Purchase holders
| Notification | Today goes to | After |
|---|---|---|
| New purchase request from Store | Accounts roles + Superadmin | **Purchase** |
| Purchase request for approval | Accounts Head | **Purchase Head** holders (§4) |
| Vendor bid / quotation received | Accounts roles | **Purchase** |
| Sub Child Part job work order (outsource request) | Accounts roles | **Purchase** |
| Outsource work requested (hand-off) | Accounts roles | **Purchase** |
| Outsource work back in part / short ("sort it out with the vendor") | Accounts roles | **Purchase** |
| Delivery due tomorrow / delivery overdue | PO creator + Accounts Head + Store | PO creator + **Purchase** + Store |
| Vendor document expiring / expired | Accounts + Accounts Head + Company Admin | **Purchase** + Company Admin |
| Vendor score below the Watchlist line | Company Admin + Accounts Head | Company Admin + **Purchase** |
| Vendor warranty claim (when the PO has no creator) | Accounts roles | **Purchase** |
| Make or buy: "estimated price needed", "now bought / made", "prices still pending" | Accounts roles | **Purchase** (the estimate is typed on Purchase → Inventory) |

### 5b. Staying with Accounts: money (Vendor Payments holders)
| Notification | Today goes to | After |
|---|---|---|
| Purchase ready for full payment | Accounts roles | **Accounts → Vendor Payments** |
| Purchase payment overdue | Accounts roles | **Accounts → Vendor Payments** |
| Outsource order ready for full payment | Accounts roles | **Accounts → Vendor Payments** |
| Outsource payment overdue | Accounts roles | **Accounts → Vendor Payments** |

### 5c. New wires: things Accounts never needed to be told
| When | New notification to Accounts → Vendor Payments |
|---|---|
| A PO with an advance becomes a real order (direct, or approved) | "Advance to pay: PO-… to (vendor), ₹… (…%)" |
| An outsource order with an advance is approved | "Advance to pay: OSO-…, ₹…" |
| A PO is cancelled or short closed and money is owed back (an advance or payment above what's now due) | "Refund due from (vendor): ₹… on PO-…" |
| Pieces written off at an outsource vendor leave money owed back | "Credit due from (vendor): ₹… on OSO-…" |

The dashboard already counts these ("advance due", "refunds due"). Nobody was told when one appeared.

### 5d. Accounts' own (sales) notifications
- **Order created, deal won, payment check requested, payment pending verification, NOC, packed order payment, order form submitted, order dispatched / delivered, packing completed.** These go to the Accounts roles today.
- **Why they move:** a purchaser also has an Accounts role, so without a change they'd keep getting all of these.
- **After:** to holders of **Accounts → Sales** (the sales and receipts side). Same people as today, minus anyone given only Purchase.

### 5e. Found while checking
- **"Purchase exchange needs a vendor" and "exchange accepted" are sent but never arrive.** The notification service has no branch for these two names. They'll go to **Purchase**.
- **Emails don't change.** Vendor emails (quotation requests, POs, cancellations, QC results) already go from the **Purchase** mailbox, and Accounts emails from Accounts.

## 6. The sidebar
- **The Accounts roles' sidebar gets two groups:** Accounts (as now, minus the Purchases group) and **Purchase** (its own pages, at `/purchase/...`). Each group shows only if the user holds its module.
- **Store's "Purchase Orders"** link keeps opening the request page.

## 7. Code that names the Accounts roles
About 20 server files check "is this user an Accounts Head / Account Employee" for purchase work. Examples: the Purchase Dashboard's "my work / my team", vendor approval routing, purchase and outsource bills, vendor scores, warranty claims, Purchase Expenses. Each switches to **holds Purchase** (or **holds Vendor Payments** for money). The plan lists them one by one. Sales-side role checks stay as they are.

## 8. Not in this version
- A separate Purchase department or Purchase roles. They can come later: the module is the hard part, and roles would then just point at it.
- Moving data or changing addresses inside saved records.

## 9. Decisions (yours, 16 Nov)
| # | Question | Decided |
|---|---|---|
| Q1 | New addresses? | **New `/purchase/...` pages; every old `/accounts/purchases/...` address redirects there.** |
| Q2 | Day one? | **Everyone with Purchases today gets both Purchase and Accounts → Vendor Payments, with the same actions. The Company Admin trims.** |
| Q3 | Tender Expenses? | **Accounts, under its own new "Tender Expenses" feature**, given on day one to the same people. |
| Q4 | Who has the head's powers in purchase (team view, others' expenses, approval bell)? | **A new "Purchase Head" tick in the Purchase module**, given by the Company Admin whatever the role. Day one: today's Accounts Heads. |
