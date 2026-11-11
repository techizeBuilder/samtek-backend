# Slice 2 plan — the Outsource Order (D1, D2, D4)

- **Date:** 2026-10-20
- **Status:** **built 2026-10-20** — change report §2; 56 tests; check in the browser.
- **Part of:** [outsource-workflow-2026-10.md](outsource-workflow-2026-10.md) §4, §5 and §8
  (slice 2).
- **Goal:** Purchase picks requests, then a vendor; enters a per-piece price, GST and charges;
  and makes an **Outsource Order** (OSO-…). Above a limit the Company Admin approves it. The
  trip out and back runs through the order.
- **Not in this slice:** bill / payment (slice 3), cost into the part (slice 4), Dispatch and
  Store (later).
- **The fixed rule:** how requests **arrive** doesn't change. This slice only works on requests
  that are already with Purchase.

---

## 1. The two kinds of request

| | **Job-work order** | **Hand-off** |
|---|---|---|
| Which parts | A Sub Child Part with every step Out Source (Purchase only) | A hybrid Sub Child Part (step 0); a Child Part / Machine (sent by Production) |
| Record | `SubChildPartJobWorkOrder` | `ProductionOrder.outsourceHandoffs[]` |
| Steps | `jobWorkTypes` (names, in order) | `stepNames` + `stepIndices` (per order) |
| Quantity | `orderQuantity` pieces | Sub Child Part: `subChildPartQty ?? orderQuantity` pieces; Child Part / Machine: `unitIndices.length` units |
| A trip = | a round (`jobWorkTypes` covered) | a round (`coveredSteps`) |
| QC | **once, at the final receive** (unchanged) | per QC step, on the receive |

The order code treats both the same way through a small adapter, `services/outsourceRequestService.js`:
- `listOpenRequests`, `stepsLeft`, `readyToOrder`
- `claimRound`, `releaseRound`, `sendRound`, `receiveRound`

Only the adapter knows which record it is writing to.

## 2. What a request shows on the list

- **Steps left:** the steps not yet on a non-cancelled round.
- **Ready to order:** steps are left, the request isn't waiting on anything, and the gate below
  passes.

**The gate before the next round:**
- **Job-work order:** the previous round is **Received**. Its QC only happens at the end, as
  today.
- **Hand-off:** every step already received is **Completed** for every unit on it (QC passed, or
  not a QC step). This is the hard gate from the QC design ("no next round before QC passes"),
  which the code doesn't check today.

**A request that's waiting shows why:** "Ordered — OSO-0007", "With vendor", "In QC",
"QC rework — Production to resend".

## 3. Making an order (D1)

- **Page:** Out Source Work becomes a list of requests with checkboxes.
  - **Filters:** a vendor filter, then status / type / search.
  - Pick some rows, then **Create Outsource Order**.
- **The vendor filter:** keeps only the requests whose next steps the vendor's **Services**
  cover (names compared ignoring case and spaces).
- **Lines merge on their own:** the same part (item) with the same step names in the same order
  is one line.
  - The quantities add up: 2 + 3 → 5.
  - Different parts on the same order make separate lines.
- **Steps per line (D2):** a line picks how many of the **next** steps it covers: the first one,
  the first two, and so on (never grinding without welding first). The default is all remaining
  steps.
  - **Every merged request must have those same next steps.**
  - **Each request keeps its own positions** (`stepIndices`). Nothing is matched by position
    across requests (workflow §4.4).
- **The vendor list:**
  - only approved + active vendors (`ELIGIBLE_VENDOR_FILTER`)
  - whose Services cover **every step on every line**
  - with watchlist / probationary badges
  - **"Show all vendors"** lifts the Services match, with a warning
  - if no vendor covers it all, the dialog says which line is missing which step
- **Price help per line:** from earlier non-cancelled orders for the same part and the same
  steps — the last price, the average, and this vendor's last price. "No earlier orders" until
  there are some.
- **On each line:**
  - the price per piece / unit (₹0 allowed)
  - the GST % (typed)
  - an expected back date (optional)
- **On the order:**
  - charges (the PO's charge names, values typed)
  - payment terms (advance %, credit days), used from slice 3
  - notes
  - the GST type, preset from the GSTINs (`gstSplitFor`, as on a PO) and changeable
- **Totals:** subtotal, line GST, charges + their GST, grand total. The same maths as a PO
  (`cleanPoCharges`, `cleanPaymentTerms`).
- **On Create, the server checks again:**
  - the vendor is eligible
  - every request is ready and has those next steps
  - nothing is already claimed
  - the totals
- **Then:**
  - **every request gets an `Ordered` round** for the line's steps, so the steps are claimed and
    no other order can take them
  - the order is **Open**, or **Pending Approval** if it's over the limit

## 4. Approval (D4)

- **Company Admin → Purchase Approvals → Settings:** a new **Outsource order limit (₹)**. Blank
  means no approval is needed.
- **Over the limit:** the order is **Pending Approval**.
  - It appears on a new **Outsource Orders** tab, with Pending / Approved / Rejected.
  - **Approve** → Open.
  - **Reject** needs a reason. The `Ordered` rounds are released, and the requests become
    orderable again.
  - The person who made the order can't approve it, same as for POs.
- **Purchase:** can **edit and send again** a Rejected order (the same requests, re-checked), or
  **cancel** it.
- **The Company Admin dashboard:** the "PO approvals" tile also counts waiting outsource orders.
- **Notifications:** Company Admin on Pending; the creator on Approve / Reject.

## 5. The trip, until Dispatch and Store exist

From the **Orders** view, on an Open order:

- **Mark sent** (per line = one trip out):
  - Every request on the line is sent together; each `Ordered` round becomes `Sent`.
  - **First trip of a Sub Child Part** (the job-work order's first round, or a hybrid hand-off's
    first send): **the material is chosen and taken out of Store**, one picker per request. Same
    picker and rules as today; skipped when it was already sent.
  - Child Part / Machine first sends stay the testing bridge.
- **Receive** (per request, or "Receive all" on the line):
  - **Job-work order:** today's receive. The final round asks for the total cost and the
    leftover (decision Q3: the cost is pre-filled from the order) and goes to QC.
  - **Hand-off:** **each receive now handles only that round's own steps** (§6). It completes
    them or sends them to QC, on **that order's own units**, and asks for the leftover after a
    whole-sheet send.
  - "Receive all" goes request by request and skips any already received, so it's safe to run
    again. It lists any request that failed.
- **Cancel:** only while nothing on the order has been sent. Every `Ordered` round is released.
- **Order status, worked out from its rounds:**
  - Pending Approval / Rejected / Open
  - With vendor (something sent)
  - Partly received
  - Received
  - Cancelled

**The old direct "Send Round"** without an order (decision Q1): removed from the request list.
Every new trip goes through an order. A round that was already sent before this slice can still
be received from the list.

## 6. Receive handles one round at a time (hand-off) — the fix

- **Today:** `receiveOutsourceHandoffRound` does nothing to the steps until **every** step of the
  hand-off is back. Then it does them all at once:
  - completes or submits to QC
  - records material use
  - runs the last-step finish
- **New:** for the round being received, take the hand-off's `stepIndices` whose names are in
  the round's `coveredSteps`, and run the same per-step code for each unit on the hand-off. The
  hand-off is Completed once every step is received.
- **Kept working:**
  - Sub Child Part: two QC steps in one round still chain their quantity (`submitBatchStepForQC`)
  - Child Part / Machine: each unit's own QC entry
  - the true-last-step finish (`completeMachineUnit`, the Child Part +1, the Sub Child Part stock)
  - material use per step
  - the leftover capture

## 7. Data

**New `models/OutsourceOrder.js`:**
- **Number:** `orderNo` OSO-0001, unique per company (from the highest in use; lesson B14).
- **Header:** `company`, `unit`, `vendor`, `status`, `createdBy`, `notes`, `activity[]`.
- **`lines[]`:** `{ item, itemCode, itemName, orderKind, stepNames[], qty, qtyUnit ('pcs' |
  'units'), ratePerPiece, gstPercent, gstAmount, lineTotal, expectedBy, requests[] }`
- **`requests[]`:** `{ kind ('jobWork' | 'handoff'), jobWorkOrder, productionOrder, handoffId,
  stepIndices, qty, roundId, status }`
- **Money:** `charges[]`, `gstType`, `subtotal`, `gstAmount`, `chargesTotal`, `chargesGst`,
  `grandTotal`.
- **Terms:** `paymentTerms`.
- **Approval:** the same shape as the PO's (`required`, `threshold`, `decision`, `requestedBy`,
  `reviewedBy`, `remarks`).

**Both round schemas get:**
- the status **`Ordered`** (before Sent)
- `outsourceOrder` and `lineId` (references)

**Every place that reads rounds** is checked:
- "first send" = no Sent / Received round yet (an `Ordered` round doesn't count)
- open round = Sent
- covered = Received
- the material-already-sent check counts only Sent / Received rounds

**`PurchaseSettings.outsourceApprovalThreshold`** (null = off).

## 8. Screens

- **Out Source Work** (`SubChildJobWork.jsx`): two views.
  - **Requests:** checkboxes, the vendor filter, "Steps left", the reason it's waiting, and
    Create Outsource Order.
  - **Orders:** a list with status, vendor and ₹; a detail view with lines, requests,
    Mark sent / Receive / Cancel and Edit (when Rejected).
- **The New Outsource Order dialog:** lines (step choice, qty, price + price help, GST %,
  expected date), the vendor picker, charges, terms, totals.
- **Purchase Approvals:**
  - a new **Outsource Orders** tab (`OutsourceApprovalsTab.jsx`)
  - the limit on the **Settings** tab
  - the dashboard tile
- **The send dialog:** one material picker per request that needs one (the existing
  `renderMaterialPicker`).
- **The receive dialog:** cost (job-work) and leftover where needed.

## 9. Decisions (user, 2026-10-20)

| # | Question | Decision |
|---|---|---|
| Q1 | Remove the direct "Send Round" (no order, no vendor) from Out Source Work? | **Yes.** Every new trip needs an Outsource Order; rounds already sent can still be received |
| Q2 | Are the steps claimed when the order is made, even while it waits for approval? | **Yes,** as a PO locks its items. Reject / cancel frees them |
| Q3 | The job-work order's final receive asks for the total cost. Pre-fill it from its Outsource Order lines (price × qty, no GST), still changeable? | **Yes.** Slice 4 then takes over the cost fully |
| Q4 | When can an order be changed? | **Only when Rejected** (edit and send again). An Open order can only be cancelled before anything is sent |
| Q5 | "Mark sent" = the whole line at once (one trip); receive per request? | **Yes** |

## 10. Tests

On a made-up company through the real handlers, with 0 left over afterwards:

1. **Requests:**
   - both kinds listed with steps left and qty
   - the vendor filter keeps only covered requests
2. **Merge:**
   - 2 + 3 units of the same Child Part → one line of 5
   - a job-work order and a hybrid hand-off of different parts → two lines
3. **Step choice:**
   - first step only → the rest stays open
   - grinding without welding → refused
4. **Vendor:**
   - not covering → refused
   - "show all" → allowed
   - suspended → refused
5. **Price help:** last / average / this vendor from earlier orders.
6. **Totals:** a hand-worked total (lines, GST, charges + GST, CGST + SGST vs IGST).
7. **Approval:**
   - under the limit → Open
   - over → Pending
   - creator can't approve
   - approve → Open
   - reject → the rounds are freed and the requests orderable again
   - edit + send again
8. **Claims:** a second order on the same steps → refused; cancel before send → freed.
9. **Trip, job-work order:**
   - Mark sent takes the material out (once)
   - final receive: cost pre-filled → QC, as today
10. **Trip, hand-off, two production orders on one line** (welding / grinding at different
    positions):
    - receive A → only A's steps and next step change, A's QC job
    - then B
    - "Receive all" run twice → no change the second time
11. **Round by round:**
    - round 1 = welding (a QC step) → it goes to QC on receive
    - grinding isn't ready until QC passes welding
    - then a second order for grinding (another vendor)
12. **Old data:** a round already Sent before this slice can still be received.
13. **Builds:** the frontend builds with no undefined names, and the backend imports.

## 11. Files

- **Backend:**
  - new `models/OutsourceOrder.js`
  - new `services/outsourceRequestService.js`
  - new `controllers/outsourceOrderController.js` + routes (in `outsourceWorkRoutes.js`)
  - new `controllers/outsourceApprovalController.js` + routes (with the PO approval ones)
  - `controllers/outsourceWorkController.js` (receive per round; list fields)
  - `controllers/subChildPartJobWorkOrderController.js` (`Ordered` rounds; cost pre-fill)
  - `models/ProductionOrder.js`, `models/SubChildPartJobWorkOrder.js` (round status + refs)
  - `models/PurchaseSettings.js`, `controllers/purchaseSettingsController.js`
  - `services/purchaseDashboardService.js` (tile)
- **Frontend:**
  - `pages/accounts/SubChildJobWork.jsx` (requests / orders, dialogs; may split into
    `pages/accounts/outsource/*`)
  - `pages/hrms/CompanyAdmin/PurchaseVendorApprovals.jsx` + new `purchaseApprovals/OutsourceApprovalsTab.jsx`
  - `PurchaseRulesSettingsTab.jsx`
  - the dashboard tile

**Build order (each step tested before the next):**
1. models + adapter + receive per round
2. order create / claim / approve / cancel
3. trip (send / receive)
4. screens
