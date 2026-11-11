# What changed — Outsource v2

One section per change. The design and plan are in
[outsource-workflow-2026-10.md](outsource-workflow-2026-10.md).

---

## 1. A real first material send for every Sub Child Part (slice 1, 2026-10-20)

**Where:**
- Accounts → Purchases → Purchase & Outsource → **Out Source Work**
- Production → Process Execution (a Sub Child Part order's Material List)

### First, what did NOT change: how requests arrive

| Part | Who gets the outsource request |
|---|---|
| **Sub Child Part, every step Out Source** | **Purchase only**, as its own job-work order (SCJW-…). Production never sees it. |
| **Sub Child Part, first step Out Source, the rest in-house** | Straight to Purchase (step 0), on a production order. |
| **Child Part / Machine** | Only when Production clicks **Send for Outsourcing**. |

**A correction (built 2026-10-19, undone 2026-10-20):**
- **What I did on 19 Oct:** I turned the fully-outsourced Sub Child Part into a production order, which made it show up on Production's pages. That broke the rule above.
- **What you said:** this work only expands what happens **after** a request reaches Purchase.
- **Now:** the job-work order, its routes, its QC branches and its dialogs are back, exactly as before. The 7 test orders and their QC job were restored from the backup.

### How it worked before

- **A fully-outsourced Sub Child Part** (job-work order): its first send took the raw material out of Store (cut piece or whole sheet, catalog or leftover, the length rules).
- **A hybrid Sub Child Part** (first step Out Source): its first send was a **dummy**.
  - The material was shown, but **nothing came out of Store**. ORD-2026-078 finished that way.
  - Production could still press **Issue** for that same material, so it could have been taken twice.
- **Two leftover bugs in the job-work send:**
  - The "cut piece" leftover was sent as **"mm"**, which the server doesn't recognise, so the leftover was recorded at the **full sheet's size** (1250 × 2550 instead of what was measured).
  - The final receive said "enter 0 if there's no leftover", **but 0 was refused**.

### How it works now

- **A hybrid Sub Child Part's first send takes the material out of Store,** with the same choices as the job-work order. The proven code is shared, not copied.
  - The material leaves **once per order**. A QC rework resend of the first step sends the reworked pieces, not new raw material, and the dialog says so.
  - If material is short, the send is refused, as for the job-work order.
  - A whole-sheet send asks for the **measured leftover** when the work comes back.
- **Production's page:** for such an order, the Material List says Purchase sends the material, and there's **no Issue button**. The server refuses Issue too.
- **The leftover fixes** apply to both routes:
  - the right unit is sent, and a measurement that can't be read records nothing
  - **0 is accepted** as "nothing left over"
- **Child Part / Machine first sends** stay the testing bridge until Dispatch is built.

### Technical notes

- **New `services/subChildPartMaterialSendService.js`:**
  - holds `applyFirstRoundMaterial` and the whole / cut / length sends, `captureFinalLeftover`, `resolveCatalogVariant`, `wholeSheetTargets` and `HttpError`
  - moved out of `subChildPartJobWorkOrderController.js` unchanged in logic, plus the two fixes
  - works on a `holder` with `{ company, rawMaterial }`: the job-work order, or a production order hand-off
- **`subChildPartJobWorkOrderController`** imports these instead of its own copies (−300 lines). Everything else is unchanged.
- **`outsourceWorkController`:**
  - **send:** a Sub Child Part first send is real (`applyFirstRoundMaterial`, then `markOrderFullyIssued`); it's skipped when the order's material already went out (`subChildPartMaterialSent`)
  - **material-info:** returns `alreadySent`
  - **receive:** asks for the leftover after a whole-sheet send
  - **list:** row fields `leftoverRequired` and `leftoverIsSheet`
  - the job-work rows are in the list as before
- **`subChildPartOrderMfgController.requestSubChildPartOrderMaterial`:** refused when step 0 is Outsourcing.
- **Frontend:**
  - `SubChildJobWork.jsx`:
    - the job-work dialog sends "Millimeter"
    - the hand-off Send dialog makes the Sub Child Part choice required, warns when material is short, and says when it was already sent
    - a new leftover dialog on the hand-off receive
  - `ProcessExecution.jsx`: the note, and no Issue button.

### Checks

**27 tests** on a made-up company through the real handlers, with 0 left over afterwards:
- **Arrival unchanged:**
  - a fully-outsourced order is a job-work order, with no production order made
  - a hybrid order goes straight to Purchase for step 0
- **Job-work route unchanged:**
  - the send takes the stock out
  - the receive is refused without the cost, then goes to QC, and the part cost becomes ₹500 each
- **Hybrid:**
  - Issue refused
  - the send now takes the stock out
  - the receive goes to QC
  - QC rework → Production requests the resend → "already sent", no second deduction
- **Child Part:** the first send is still a dummy.
- **List:** both kinds of row.
- **Committed vs current send code** on identical copies of real stock: sheet whole, sheet cut, length whole and length cut give **identical stock**.
- **Fixes:**
  - "mm": the committed code adds a full-sheet leftover, now none
  - leftover 0 accepted on the final receive
  - hybrid whole sheet: leftover required, then 600 × 900 credited
- **Builds:** the frontend builds with no undefined names, and every touched backend file imports.

**Check in the browser:** the first send of a hybrid Sub Child Part, and that the job-work order still sends and receives as before.

---

## 2. The Outsource Order (slice 2, 2026-10-20)

**Where:**
- Accounts → Purchases → Purchase & Outsource → **Out Source Work**, with two views: **Requests**
  and **Orders**
- Company Admin → Purchase Approvals:
  - Purchase Orders → **Outsource Orders**
  - **Settings**
  - the dashboard tile

Plan: [slice-2-outsource-order-plan.md](slice-2-outsource-order-plan.md).

### How it worked before

- **What Purchase could do:** **Send Round** and **Receive Round** on each request. No vendor, no
  price, no approval, and no record of who did the work.
- **Rounds didn't work step by step:** a hand-off's steps did nothing until **every** step was
  back. A step received in round 1 never completed or reached QC.
- **No gate:** nothing stopped the next round from going out before QC had passed the last one.

### How it works now

**Requests view:**
- **Every outsource request with Purchase.** How they arrive is unchanged:
  - a fully-outsourced Sub Child Part's job-work order
  - a hybrid Sub Child Part's step 0
  - a Child Part / Machine that Production sent
- **Each row shows:** its steps (back / out / left), its quantity, and whether it's **ready to
  order** or why not:
  - ordered on OSO-…
  - with the vendor
  - in QC
  - QC rework (Production resends it)
- **Vendor filter:** "requests this vendor can do" keeps only the requests whose next step the
  vendor's Services cover.
- **Tick requests → Create Outsource Order.**

**New Outsource Order:**
- **Merging:** the same part with the same steps left merges into one line (e.g. 2 + 3 units →
  5).
  - Each line picks how many of the **next** steps it covers. The rest stays open for a later
    order, perhaps with another vendor.
  - Merged requests keep **their own step positions** on their own production orders.
- **The vendor list:**
  - approved, active vendors whose **Services** cover every step
  - watchlist / probationary badges
  - "Show all" lifts the Services match, with a warning
- **Per line:**
  - the price per piece / unit, with help: last price, average, this vendor's last price, from
    earlier orders for the same part + steps
  - GST %
  - expected back date
- **On the order:**
  - the GST type, set from the two GSTINs (CGST + SGST or IGST) and changeable
  - charges, from the PO charge names
  - advance % and credit days
  - notes
  - totals that work the same way as a PO's
- **Claiming:** making the order **claims** each request's next step(s). No second order can
  take them; a cancel or reject frees them.
- **Approval:**
  - above the Company Admin's new **Outsource order limit**, the order waits for approval
  - nobody approves their own order
  - a reject needs a reason; Purchase can then edit and send it again

**Orders view:**
- **The list:** status, vendor and total.
- **On each order:**
  - **Mark sent:** a whole line goes out as one trip. A Sub Child Part's first trip picks its
    material (one picker per request) and takes it out of Store.
  - **Receive:** per request; each updates **its own** production order or job-work order only.
    A job-work order's final receive has its cost **pre-filled from the order** (price × qty, no
    GST). "Receive all" receives every request that needs no input, and is safe to run twice.
  - **Cancel** only while nothing has gone out; **Edit** only when Rejected.
  - **History:** who did what.
- **The fix:** receiving a hand-off trip now handles **that trip's own steps**: completes them, or
  sends them to QC, on each unit. The next trip opens only once QC has passed them.
- **Direct Send Round is closed:** every trip needs an order. A trip sent before today can still
  be received from the Requests view.

### Technical notes

- **New files:**
  - `models/OutsourceOrder.js`
  - `services/outsourceRequestService.js`: the adapter over job-work orders and hand-offs —
    views, gate, claim / release / send / receive, `RecordSet` (each record loaded and saved
    once)
  - `controllers/outsourceOrderController.js`
  - `routes/outsourceApprovalRoutes.js` (`/api/outsource-approvals`)
- **New routes under `/api/outsource-work`:** `requests`, `vendors`, `price-history`,
  `outsource-orders` (create / list / get / edit / cancel / line send / line receive-all /
  request receive).
- **Both round schemas:** status `Ordered`, plus the `outsourceOrder` / `lineId` refs.
- **`outsourceWorkController`:**
  - `sendHandoffTrip` / `receiveHandoffTrip`; receive now handles only the round's own steps
  - the direct send returns 400
- **`subChildPartJobWorkOrderController`:**
  - `sendJobWorkTrip` / `receiveJobWorkTrip`; the direct send returns 400
  - **fixed on the way:** the final receive credited the leftover **before** checking the cost,
    so a refused receive that was retried credited it twice. The cost is now checked first.
- **Settings and dashboard:** `PurchaseSettings.outsourceApprovalThreshold` (Company Admin
  settings); `purchaseDashboardService` counts outsource orders waiting for approval.
- **Frontend:**
  - `SubChildJobWork.jsx`: Requests / Orders
  - new `pages/accounts/outsource/*` (Requests, Orders, the New Order dialog)
  - `components/accounts/outsource/FirstSendMaterial.jsx` (the material picker, moved)
  - `OutsourceApprovalsTab.jsx`
  - the Settings field and the dashboard tile

### Checks

**56 tests** on a made-up company through the real handlers, with 0 left over afterwards:
- **Requests:** both kinds, quantity and steps; the vendor filter.
- **Vendors:** covering only; "show all" with what's missing; a suspended vendor never offered;
  IGST for another state.
- **Refusals:**
  - a vendor not covering the steps
  - a suspended vendor
  - two different parts on one line
  - more steps than left
- **A hand-worked total:** 5 units × ₹100 + 18%, 10 pcs × ₹50 + 12%, ₹200 charges + 18% →
  **₹1,386**, CGST + SGST.
- **Claims:**
  - each request keeps its own position (welding at 1 on one order, at 0 on the other)
  - a second order refused
  - cancel frees them
- **Approval:**
  - over ₹1,000 → waiting
  - can't send while waiting
  - the creator can't approve
  - reject without a reason refused
  - reject frees the steps
  - edit (₹90, total ₹1,327) and send again
  - approve → Open
- **Price help:** last ₹90; cancelled and rejected orders don't count.
- **Job-work trip:**
  - material out once (100 → 80)
  - the cost pre-filled ₹500
  - refused without it, then Pending QC
  - part cost ₹50
- **Two Child Part orders on one line:**
  - receive A → only A's units go to A's QC, B untouched
  - "Receive all" gets B; run again → nothing
- **Step by step:**
  - grinding waits while welding is in QC (unit 1 passed, unit 2 not → still waiting)
  - both passed → ready
  - grinding ordered from another vendor (IGST, ₹94.40)
  - received → last step done, Fan stock +2
- **Old routes:**
  - direct sends refused
  - an order's trip can't be received the old way
  - an old trip (no order) still can
- **Hybrid Sub Child Part through an order:** the real first send (80 → 75); received → QC.
- **Builds:** the frontend builds with no undefined names, and the backend imports.

**Check in the browser:** the whole flow.
1. Settings: set the limit.
2. Requests: tick, then New Order.
3. Approve as the Company Admin.
4. Mark sent with material.
5. Receive.
6. Order the next step.

---

## 3. The outsource bill and its payment (slice 3, 2026-10-20)

**Where:**
- Accounts → **Vendor Payment** (outsource bills next to PO bills)
- Accounts → **Purchase Invoices** (a bill-type filter)
- Out Source Work → **Orders** (the bill on each order, a Payment column)

Plan: [slice-3-bill-payment-plan.md](slice-3-bill-payment-plan.md).

### How it worked before

- **No bill at all:** an Outsource Order had a price, GST and terms, but nothing to pay. The
  vendor's money never reached Accounts or the ledger.
- **The only trace of cost** was the job-work cost typed on a job-work order's final receive.

### How it works now

**The bill (D5: the order is the bill):**
- **Made when the order becomes Open:** at once if it's within the outsource limit, or when the
  Company Admin approves it. One bill per order: the same total, GST type, unit, credit days and
  advance %.
- **The advance** (advance % × total) is payable straight away.

**When work becomes payable: when QC passes it, like purchased material.**

| Request | What counts as accepted |
|---|---|
| A trip with **no QC step** | everything, when received |
| **Child Part / Machine** | each unit, as soon as **all** its QC steps on this trip pass |
| **Sub Child Part** (hybrid) | the pieces that passed this trip's last QC step |
| **Job-work order** (fully outsourced) | its one QC at the end: passed ÷ ordered |

- **Accepted work:** rate × qty + GST becomes payable, less its share of the advance.
- **Rejected / scrapped / rework:** **taken off the bill** (a "Rejection" adjustment). A redo is a
  new order (₹0 or a charge).
- **Fully accepted** (every request accepted or released):
  - the charges are posted and the advance is set off
  - the full balance is due in **credit days**
  - Accounts is notified
- **Overdue:** the daily sweep covers outsource bills ("Outsource payment overdue", once).

**Paying:** on **Vendor Payment**, the same way as a PO bill: the advance, then accepted work,
from a bank account or the vendor's credit. Paying more than is payable now is refused.

**Seeing it:**
- **Vendor Payment:**
  - an **Outsource** badge, "Order total" and "Work accepted so far"
  - the payment history shows the OSO number
- **Purchase Invoices:**
  - a filter: All bills / PO bills / Outsource bills / Without a PO
  - "Outsource bill — OSO-…" in the detail
  - due "after QC"
- **The order:**
  - a **Bill** panel: total, advance paid of due, work accepted, paid, what can be paid now, the
    due date and each Rejection
  - each received request shows its QC result (accepted / not / waiting)
  - the list has a **Payment** column (Advance due / Awaiting work / Payable / Paid, and what's
    left)

**Cancel:** with nothing paid, the order and its bill are cancelled. **Once the advance is paid,
cancel is refused** (record a refund first).

**Dashboards:**
- **Purchase value / Top 3 / trend:** outsource bills are **not** counted (job work, not
  purchases)
- **Payables and the vendor's balance:** they **are** counted

### Ledger

| When | Entry |
|---|---|
| Advance paid | Dr Advance to Vendors / Cr Bank |
| Work accepted | Dr **Job Work Charges** (new expense account) + Input GST / Cr Accounts Payable |
| Fully accepted | the charges the same way; the advance set off against Accounts Payable |
| Payment | Dr Accounts Payable / Cr Bank (or vendor credit) |

### Technical notes

- **New:** `services/outsourceBillService.js`:
  - `createOutsourceBill` / `cancelOutsourceBill`
  - `recordTripQc` (on receive, notes the QC attempts the trip sent)
  - `qcDecisionsOf`, `applyAcceptance` (part by part through `acceptance.appliedKeys`, so a unit
    is never applied twice)
  - `settleIfFullyAccepted`, `refreshAcceptance`
  - `onOutsourceQcDecided` (never throws)
  - `billSummary`
- **One rule changed everywhere:** a staged bill is one with a `purchaseOrder` **or** an
  `outsourceOrder` (`isStagedBill` in `models/PurchaseInvoice.js`). Used by:
  - the bill stage
  - `owedNow` / `payableNow`
  - the invoice list / outstanding
  - the overdue sweep
- **Models:**
  - `PurchaseInvoice.outsourceOrder`, `VendorPayment.outsourceOrder`
  - `OutsourceOrder` request: `receivedAt`, `qcAttempts[]`, `acceptance{}`
- **Ledger:** `purchaseLedgerService` gets the `job_work` system account.
- **`payBill`:** finds either kind of bill. For an outsource bill it logs to the order's history
  and skips the PO delivery clock. **The PO path is otherwise unchanged.**
- **QC hooks** (`qcController`): the job-work QC decision, a Child Part / Machine unit step, and a
  Sub Child Part batch step each call `onOutsourceQcDecided`.
- **`outsourceOrderController`:**
  - a bill on create / approve / edit-to-Open
  - cancel: cancels the bill first
  - receive: `recordTripQc` + `refreshAcceptance`
  - detail: `bill` + `payableNow`; list: `billStage` / `billBalance`
- **Other files:** `purchaseInvoiceController` (populate, type filter, outstanding lookup) and
  `purchaseDashboardService` (spend excludes outsource bills).
- **Frontend:** `VendorPayments.jsx`, `PurchaseInvoices.jsx`, `OutsourceOrdersView.jsx`.

### Checks

**29 tests** on a made-up company through the real handlers, with 0 left over afterwards. Every
figure was worked out by hand. Slice 2's 56 tests still pass.
- **The bill:**
  - over the ₹1,000 limit (₹1,032 = 236 + 560 + 236), there is **no bill while waiting**
  - approved → a bill for ₹1,032 with a 20% advance of ₹206.40, Advance due
  - one bill per order
- **Paying early:**
  - paying for work before QC → refused
  - the advance is paid (Dr Advance to Vendors / Cr Bank) → "Awaiting work"
  - cancel after that → refused
- **Child Part, 2 units, welding:**
  - received → nothing payable
  - unit 1 passes → **₹118** accepted (Dr Job Work 100 + CGST 9 + SGST 9 / Cr AP 118); payable now
    **₹94.40**
  - unit 2 rejected → **₹118 off**, the bill is now **₹914**
- **Job-work order on the same order:** received → waits for QC. QC passes → ₹560 accepted, then:
  - **fully accepted**: charges ₹236 posted, Job Work Charges **₹800**, input GST **₹114**
  - the advance is set off; due in 15 days
  - the order detail shows **₹707.60** payable
- **Paying the rest:**
  - over the amount → refused
  - ₹707.60 paid → **Paid**, Accounts Payable **0**, and the bank paid out **₹914** in all
- **IGST, Sub Child Part 10 pcs, QC 8 passed / 2 scrapped:** ₹94.40 accepted (8 × ₹10 + 18% IGST),
  ₹23.60 off.
- **Other:**
  - the overdue sweep flags it once
  - cancel with nothing paid → the bill is cancelled
  - purchase value excludes it
  - the order list shows Paid
- **Not covered by the tests:**
  - a job-work order split across two vendors' orders
  - paying from vendor credit
  - a **PO** bill payment after the `payBill` change
  - **Check these in the browser.**
- **Builds:** the frontend builds with no undefined names.

**Check in the browser:**
1. Create an order with an advance; it appears on Vendor Payment as an **Outsource** bill. Pay
   the advance.
2. Send and receive; pass / reject in QC. The order's Bill panel shows the accepted value and the
   Rejection.
3. Pay the accepted work, then the rest.
4. **Pay one ordinary PO bill** (`payBill` was changed).

---

## 4. The material plan (slice 5, 2026-10-20)

**Where:**
- the Outsource Order detail (Purchase)
- Production's Material List on Process Execution

Logic: [material-logic-2026-10.md](material-logic-2026-10.md). Plan:
[slice-5-material-plan.md](slice-5-material-plan.md).

### How it worked before

- **Nobody worked out where an outsource trip's material comes from.**
  - A Child Part / Machine first send was a dummy, so Production could also issue the same
    material, and it could be taken twice.
  - Each Sub Child Part order took its own whole sheets, even when two orders went to the same
    laser run.
- **The per-step material check never found sheet / length material:** it looked them up by the
  plain code, and Production keeps them under a combined key. It also ignored a step's own
  quantity split.

### How it works now

**When Purchase makes the Outsource Order,** each request gets a **material plan**, per
material line of the steps its trip covers:
- **From Production:** what Production holds for that order (received, or on its way from Store),
  less what other trips already set aside.
- **From Store:** the rest.
- **The units / pieces themselves:** when the step sends the assembled part, or on a later trip.

**Sheet and length material from Store on one line is combined:**
- whole sheets / lengths for the total (a Sub Child Part's Sheet Plan is used when it has one)
- each order is booked its share by area / length
- **Example:** 12 + 6 Brackets at 0.3 m² → **2** sheets instead of 3; booked 1.333 / 0.667

**Production:**
- The Material List shows **"… goes to the vendor (OSO-…)"** on those lines.
- **Issue is limited** to the order's need less that part.
- An open request Production already raised beyond that (not yet sent by Store) is
  **trimmed**, and the Outsource Order's history says so.

**The trip:**
- Production's planned part counts as **used when the trip goes out**.
- The Store part never touches Production's figures.
- Receiving no longer records the step's material use a second time.

**Purchase:** the order detail shows each request's plan and each line's combined sheets /
lengths.

**The step check (G2):** finds sheet / length material by its real key, counts in the list's
unit (sheets, cut pieces), and respects the step's quantity split.

**Not yet (slice 6):** the stock itself still moves as before. The Sub Child Part send is real;
the Child Part / Machine send is still the dummy. Slice 6 moves it through Store's handover to
Dispatch, using this plan.

### Technical notes

- **New services:**
  - `services/stepMaterialService.js`: one step's material per unit, keyed and counted like the
    Material List; `heldByProduction`
  - `services/outsourceEarmarkService.js`: what an order's material is set aside for, read from
    live Outsource Orders' plans; `issueLimit`
  - `services/outsourceMaterialPlanService.js`: `buildOrderPlans`, `combineLine`, and the
    trimming of Production's requests
- **Model:** `OutsourceOrder` request `materialPlan[]` and line `combinedMaterial[]`. Nothing new
  on `ProductionOrder`: the earmarks are read from the orders, and a cancelled / rejected order
  drops out on its own.
- **`outsourceOrderController`:** the plan is built on create / edit after the claims, and
  passed to send / receive.
- **`outsourceWorkController`:** `sendHandoffTrip` consumes the Production part;
  `receiveHandoffTrip` skips the step consumption for a planned trip.
- **Material List services:** `childPartReorderService` / `machineReorderService` return
  `toVendor` and `issueLimit`, and their request functions use the limit.
- **`productionMfgController.resolveStepMaterialLines`:** the G2 fix.
- **Frontend:** `ProcessExecution.jsx` (the vendor note, the Issue limit),
  `OutsourceOrdersView.jsx` (the plan).
- **Orders made before this slice have no plan** and keep the old behaviour.

### Checks

**26 tests** on a made-up company through the real handlers, with 0 left over afterwards. Every
figure was worked out by hand:
- **A. Bracket, 12 + 6 pcs at 0.3 m²:**
  - 5.4 m² → **2** sheets; shares **1.333 / 0.667**
  - with a Sheet Plan (3 sheets per 10 pcs) → **6** sheets; shares **4 / 2**
- **B. Pin, 20 + 10 pcs at 400 mm:** 12000 mm → **2** lengths; shares 1.333 / 0.667.
- **C. Frame, units 1–2 laser:** 1.0 m² → 1 sheet from Store; X's sheet Issue limit 0, so issuing
  it is refused.
- **D. Frame, 3 units painted at 2 L:**
  - the units come from Production
  - paint **4 L from Production** (4 L on its way from Store counts, M4) + **2 L from Store**
  - Production's 6 L request trimmed to 4 (in the history); Issue limit 4; 1 L more refused
- **Release:** cancel → the plan drops out, and the Issue limit is back to 1.
- **Send / receive:** Mark sent consumes Production's 4 L; receive doesn't consume again (still
  4); the 2 L stays the vendor's.
- **G2:** a sheet line is found as Issued, 0.16 sheet per unit, enough; the paint split of 1.5 L is
  respected.
- **Regression:** slice 2's 56 and slice 3's 29 still pass. The frontend builds with no
  undefined names.

**Check in the browser:**
1. Two Sub Child Part orders of one sheet part on one Outsource Order → the detail shows the
   combined sheets.
2. A Child Part with an outsourced first step → its Material List shows "goes to the vendor", and
   Issue is limited.

---

## 5. Dispatch sends — vehicles, trips, handovers (slice 6, 2026-10-20)

**Where:**
- Dispatch → **Vendor Pickups** (tabs Purchase / Outsource / Trips) and **Vehicles**
- Store → Material Transfers → **To Dispatch (Outsource)**
- Production → Process Execution: the "**To hand over to Dispatch**" card
- Purchase → the Outsource Order: "On Dispatch trip …"

Design: [dispatch-design-2026-10.md](dispatch-design-2026-10.md). Plan:
[slice-6-dispatch-sends.md](slice-6-dispatch-sends.md).

### How it worked before

- **Vendor Pickups was a read-only list** of "We pick up" POs.
- **Outsource material moved** only through Purchase's temporary Mark sent:
  - a Sub Child Part's stock came out there
  - a Child Part / Machine first send was a **dummy** (no stock moved)
- **No vehicles, no trips, no freight record.**

### How it works now

**Vehicles:** Dispatch keeps a list of regular vehicles: number, type, own / hired, driver,
transporter, capacity.

**A trip:** Dispatch ticks **one vendor's** waiting jobs and makes a trip:
- **the jobs:** "We pick up" POs, and Outsource Order lines (each line goes whole)
- **the vehicle:** a regular one (driver filled in), or a one-time one typed for this trip, with
  "save as regular"
- **the date**, and the challan / e-way bill numbers
- **a hired vehicle's freight** and how it's paid; it becomes a Dispatch **"Transporting Cost"**
  expense linked to the trip

**Each outsource line shows** what Store gives and what Production gives, from its material plan
(slice 5).

**Handover 1, Store** (new tab "To Dispatch (Outsource)"). This is the **real stock movement**:
- **Sheets / lengths for the line, combined:** Store picks catalog pieces and / or offcuts of the
  same thickness / section that cover the area / length. It can record an offcut it keeps, which
  becomes a leftover size.
- **Cut pieces:** the stock size and how many pieces Store cuts.
- **Items:** by quantity.
- **Each order is booked its own share** on its reservation. A Sub Child Part's material claim is
  then fully issued, and its record notes the material went out.

**Handover 1, Production:** a card on the order shows what goes to Dispatch (e.g. "3 units + 4 L
paint" for trip TRP-0001), with a **Hand over** button.

**Handover 2, "Delivered to the vendor"** (Dispatch). Only once Store and Production have handed
over. Then:
- the line's trips go **Sent**
- the Outsource Order is **With vendor**
- nothing is pulled from stock again
- a Child Part / Machine first send is **no longer a dummy**

**Handover 5, "Picked up"** for a PO. Store's PO receive is unchanged.

**A trip is Planned → Out → Done.** It can be cancelled only before any handover; that frees its
jobs and removes its freight expense.

**Purchase:**
- A line on a trip shows "On Dispatch trip TRP-…", and **Mark sent is refused** for it.
- **The Outsource Order can't be cancelled** while a line is on a trip.
- Mark sent stays for lines not on a trip until slice 8 (T11).

### Technical notes

- **New files:**
  - `models/Vehicle.js`
  - `models/DispatchTrip.js`: `stops[]`, exactly one for now, so several stops later is a screen
    change
  - `services/dispatchTripService.js`: waiting lists, `linePickList`, create / cancel,
    `storeHandover`, `productionHandover`, `markDelivered`, `markPickedUp`
  - `controllers/dispatchTripController.js`
  - `routes/dispatchTripRoutes.js` → `/api/dispatch-trips`. Guards per route: Dispatch =
    `dispatches › vendorPickups`; Store = Store Head / Employee; Production =
    `production › orders`.
- **Model changes:** `OutsourceOrder` line `dispatch{ trip, tripNo }`;
  `PackagingDispatchExpense.dispatchTrip`.
- **`outsourceOrderController`:**
  - `sendLineRequests` is extracted (shared by Mark sent and Delivered)
  - Mark sent / cancel are refused for a line on a trip
- **`materialHandled`** on `sendRound` → `sendJobWorkTrip` / `sendHandoffTrip`: no stock pull,
  and no dummy.
- **Plan rows:** a cut-piece row now carries its cut length (`pieceSize`), for Store's check.
  `pushOrMergeLeftover` is exported.
- **Frontend:**
  - `pages/dispatch/VendorPickups.jsx` (rebuilt), new `pages/dispatch/Vehicles.jsx`
  - `pages/store/MaterialHandshake/tabs/OutsourceToDispatchTab.jsx`
  - `ProcessExecution.jsx` (the card), `OutsourceOrdersView.jsx`
  - menu, permission key, route
- **Permission:** a new feature **Vendor Pickups** (`dispatches › vendorPickups`). It covers
  Vendor Pickups and Vehicles. **The Company Admin must grant it to the Dispatch roles.**

### Checks

**44 tests** on a made-up company through the real handlers, with 0 left over afterwards. Figures
worked out by hand:
- **Vehicles:** the number is normalised (UK07AB1234); a duplicate is refused.
- **Waiting:** one PO + 3 lines for the vendor.
  - **Bracket line:** "2 sheets" from Store.
  - **Frame paint line:** Store "2 L", Production "3 units + 4 L".
- **Refusals:**
  - two vendors on one trip
  - a hired vehicle without freight
  - Mark sent / cancel on a line that's on a trip
  - the same line on a second trip
- **Freight:** ₹1,200 hired → a ₹1,200 "Transporting Cost" expense, linked; "save as regular"
  adds the vehicle; cancelling the trip removes the expense and frees the PO.
- **Store, Bracket (5.4 m²):**
  - 1 sheet (3.125 m²) → refused
  - 1 sheet + a 2.5 m² offcut (5.625) → accepted: sheets 10 → 9, offcut 1 → 0
  - the kept 1250 × 300 offcut → a new leftover size
  - both job-work orders' claims are fully issued
- **Store, other jobs:** Frame laser takes the default 1 sheet → 8; paint 2 L → 50 → 48; a second
  handover is refused.
- **Production:**
  - "Delivered" is refused until Production hands over
  - Production sees "3 units + 4 L"
  - Frame laser has nothing from Production, so no Production handover is asked
  - cancelling the trip after a handover is refused
- **Delivered:**
  - Frame paint: trips Sent, 4 L used, no second paint pull
  - Bracket: both job-work trips Sent, sheets still 8
  - Frame laser: the first send is real (`dummy: false`)
  - the order is With vendor
  - challan CH-11 / e-way EWB-77 saved
- **PO picked up** → the trip is Done; nothing is left waiting.
- **Cut pieces (Rail, 2 × 1500 mm per unit × 2):**
  - plan 4 cuts
  - a 3000 mm offcut for 6000 mm → refused
  - one 6000 mm length → 5 → 4; delivered
- **Regression:** slices 2 (56), 3 (29) and 5 (26) still pass. The frontend builds with no
  undefined names.

**Check in the browser:**
1. **Grant Vendor Pickups** to the Dispatch role.
2. Add a vehicle.
3. Vendor Pickups → tick a PO + an outsource line of one vendor → New trip.
4. Store → Material Transfers → To Dispatch → hand over.
5. Production → the order → Hand over (if it gives units / material).
6. Dispatch → Delivered → the Outsource Order shows With vendor.
7. Picked up on the PO.

---

## 6. Returns — Dispatch collects, Store receives (slice 7, 2026-10-21)

**Where:**
- Dispatch → Vendor Pickups → Outsource → **To collect**, and the trip cards
- Store → Material Transfers → **From Outsource**
- Purchase → the Outsource Order
- Production → Process Execution (a note)

Plan and decisions R1–R4: [slice-7-returns-store-receive.md](slice-7-returns-store-receive.md).

### How it worked before

- **Purchase pressed a temporary "Receive"** for work coming back. Nobody recorded who
  collected it or how many came back.
- **Returned units went straight to Production's figures,** even when they were physically at
  Store.

### How it works now

**"Vendor says ready" (T9):** Purchase (on the order) or Dispatch (on Vendor Pickups) marks a
request once the vendor calls. Those come first in **To collect**.

**Collecting (handover 3):**
- Dispatch puts requests that are with the vendor on a trip (alone, or with sends / PO pickups for
  the same vendor).
- At the vendor Dispatch counts each one. **Collected** only when the count equals what was sent.
- **Fewer came back → Report short (R1):**
  - Purchase is notified
  - the request leaves the trip and waits for a later one, marked "short last time"

**Store receives (handover 4), new tab "From Outsource":**
- **Store's count must match Dispatch's;** otherwise Store reports it short too (Purchase is
  notified).
- **The receive itself runs as before:** QC, then the bill acceptance.
- **A job-work order's cost** is taken from the Outsource Order (rate × qty), so Store never types
  a cost (T10).
- **Optional (R3):** offcuts and unused material back from the vendor go into stock (offcuts
  become leftover sizes), noted on the order line.
- **Purchase's temporary Receive is refused** for a request Dispatch is bringing back.

**Work waiting at Store (R2):** a hybrid order's returned units stay **at Store**.
- **Next step in-house:** once a unit's QC passes, Store presses **Hand to Production**, per unit
  (R4, T8). Until then **Production can't give that unit's next step to a team**, and Process
  Execution says so.
- **Next step outsourced, or a rework:** it stays at Store. The next order's material plan takes
  the units **from Store**, and Store's handover to Dispatch releases them.
- **The order's last step:** goes into stock as before.

### Technical notes

- **Models:**
  - `OutsourceOrder`: request `vendorReady`, `returnDispatch`, `collected`, `short`; line
    `returnedMaterial[]`
  - `DispatchTrip`: job kind `outsourceReturn` with `returns[]` (collected / short / received)
  - `ProductionOrder`: `workAtStore[]` (unit, hand-off, round) and `workHandovers[]` (to
    Production / Dispatch)
- **`dispatchTripService`:**
  - return jobs in create / cancel / the waiting list
  - `markCollected`, `reportShort` (from Dispatch or Store)
  - `pendingStoreReceive`, `storeReceive` (custody in the same save, returned material)
  - `pendingAtStore` / `workState`, `handToProduction`
  - Store's handover to Dispatch releases units waiting at Store
- **`outsourceOrderController`:**
  - `receiveRequestCore` (shared receive), `markVendorReady` + route
  - `jobWorkCostPrefill` / `requestNeeds` exported
  - temporary Receive / Receive all skip requests Dispatch is bringing back
- **`outsourceMaterialPlanService`:** units at Store → the `wip` row comes from Store (even when
  the step doesn't say it sends the assembled part, so nothing gets stuck).
- **`productionMfgController.assignTeam`:** refuses a unit whose work is at Store.
- **New routes:**
  - Dispatch: `/vendor-ready`, `/:id/jobs/:jobId/collected`, `/short`
  - Store: `/store/receive`, `/store/at-store`, `/store/hand-to-production`,
    `/:id/jobs/:jobId/store-receive`, `/store-short`
- **Frontend:**
  - `VendorPickups.jsx`: To collect, return jobs, Collected / Report short
  - new `tabs/OutsourceFromVendorTab.jsx`
  - `OutsourceOrdersView.jsx`: ready / collected / short, Receive hidden
  - `ProcessExecution.jsx`: the note

### Checks

**26 tests** on a made-up company through the real handlers, with 0 left over afterwards:
- **Vendor ready:** X marked → listed first.
- **Purchase's temporary Receive on X** → refused.
- **Bracket order B (6 pcs):**
  - 5 counted → Collected refused
  - Report short → B shows "5 back", leaves the trip, Purchase notified, waits again
- **A (12), X (2), Z (2) collected** → the trip is Done.
- **Store:**
  - A's cost shown **₹120** (12 × ₹10)
  - count 11 → refused
  - 12 → QC, cost ₹120 saved
  - a 1250 × 400 offcut → leftover +1, noted on the line
- **X received:**
  - laser → QC; both units at Store
  - unit 1's assembly can't be given to a team
  - unit 1 passes QC → unit 2 hand refused (In QC), unit 1 handed → the assembly can be given to a
    team
- **Z (laser → bend, both outsourced):**
  - after QC both units stay at Store, and hand to Production is refused
  - the bend order's plan takes the 2 units **from Store**
  - Store's handover releases them; bend delivered
- **Regression:** slices 2 (56), 3 (29), 5 (26) and 6 (44) still pass. The frontend builds with no
  undefined names.

**Check in the browser:**
1. Mark a request "vendor says ready", then put it on a trip.
2. Collect it, or report short.
3. Store → From Outsource → receive (→ QC), with an offcut.
4. After QC, hand the units to Production.
5. Production can now give the next step to a team.

---

## 7. Cleanup — Purchase's temporary send / receive removed (slice 8, 2026-10-21)

Plan: [slice-8-cleanup.md](slice-8-cleanup.md). T11 in
[dispatch-design-2026-10.md](dispatch-design-2026-10.md).

### How it worked before

Until Dispatch and Store were built, Purchase moved outsource work from the Outsource Order:
- **Mark sent:** with a Sub Child Part material picker
- **Receive** and **Receive all**

Slices 6 and 7 built the real way, but these buttons were kept so nothing would stop while it was
being built.

### How it works now

**One way only: Dispatch sends, Store receives.**
- **The Outsource Order no longer has Mark sent / Receive / Receive all.** A line not yet on a
  trip says "Waiting for Dispatch to plan a trip (Vendor Pickups)". Purchase still sees the plan,
  the trip, the bill, and marks "vendor says ready".
- **The send itself moves no stock.** Store's handover to Dispatch does. Behind the scenes, the
  old first-trip Store pull and the Child Part / Machine **dummy** send are gone.
- **The material-picker endpoints and the old Vendor Pickups stub endpoint are gone.**
- **Still there:** receiving a trip that was sent **before** Outsource Orders existed (the
  Requests view).
  - The dev database has none; the client's might at deploy time.
  - Remove it once the client is migrated and none are left.

### Technical notes

- **Removed:**
  - `outsourceOrderController`: `sendOutsourceLine`, `receiveOutsourceRequest`,
    `receiveOutsourceLine` and their routes
  - `outsourceWorkController.getHandoffMaterialInfo` (`…/material-info`)
  - `subChildPartJobWorkOrderController.getSubChildPartJobWorkMaterialOptions`
    (`…/material-options`)
  - `purchaseController.getVendorPickupsForDispatch` (`/api/dispatches/vendor-pickups`)
  - in `subChildPartMaterialSendService`: `applyFirstRoundMaterial` and its whole / cut / length
    helpers
  - the frontend `FirstSendMaterial.jsx`
- **`sendHandoffTrip` / `sendJobWorkTrip`:** only an Ordered round from Dispatch. No stock moves;
  the first send just records that the material went out.
- **`sendRound` / `sendLineRequests`:** no material arguments.
- **`requestNeeds`:** now only the receive's cost / leftover.
- **`rawMaterial.dummy`:** never written; still read for old records.
- **Message change:** the old receive route's message now points to Store.

### Checks

**Every earlier suite now runs through Dispatch → Store only,** with a shared test helper (send =
trip → Store / Production handover → Delivered; receive = return trip → Collected → Store
receive):

| Suite | Result | Changed checks |
|---|---|---|
| Slice 2 | **54** | "receive without cost → refused" became "cost ₹500 taken from the order"; "Receive all" became separate Store receives |
| Slice 3 | **29** | bill / ledger figures unchanged (₹1,032, ₹914, ₹94.40…) |
| Slice 5 | **26** | — |
| Slice 6 | **44** | — |
| Slice 7 | **26** | — |

- **Total 179,** 0 records left.
- **Builds:** the frontend builds with no undefined names, and every touched backend file imports.

**Check in the browser:** the whole outsource flow end to end through Vendor Pickups and Store's
two tabs. The Outsource Order should show no Mark sent / Receive.

---

## 8. A price per step on an Outsource Order line (2026-10-21)

**Found in the flow test (R1, O1.4), your request.**

**Before:** a line covering two steps (e.g. Fan Bush cutting › drilling) had **one** price per
piece for both. You couldn't price the steps differently or see what each step cost.

**Now:**
- **Each step on a line has its own price per piece / unit,** with its own price help (last /
  average / this vendor, for that step, including from earlier lines that had several steps).
- **The line's price per piece is the sum.** One GST % per line still applies to all its steps.
- **The bill shows one row per step** (e.g. "Fan Bush · cutting ₹25 × 2", "Fan Bush · drilling
  ₹20 × 2"). The rows always add up to the line.
- **The order detail and the Company Admin's approval** show the step prices ("cutting ₹25 +
  drilling ₹20").
- **Unchanged:** bill acceptance, payments and the job-work cost all keep working off the line's
  price per piece (the sum).

**Technical notes:**
- `OutsourceOrder` line `stepRates[{ step, rate }]`; `ratePerPiece` = the sum.
- `readOrderBody` accepts `stepRates` (one per step, in order; a missing / empty price is refused)
  and still accepts a single `ratePerPiece`.
- `priceHistory` returns `byStep`.
- `createOutsourceBill` makes one row per step.
- **Frontend:** `NewOutsourceOrderDialog.jsx` (a price row per step), `OutsourceOrdersView.jsx`,
  `OutsourceApprovalsTab.jsx`.

**Checks: 7 tests,** 0 left:
- one price for two steps → refused
- an empty step price → refused
- ₹25 + ₹20 = ₹45 per piece; 2 pcs → ₹90 + 18% = ₹106.20
- the bill has two rows: 50 + 9 and 40 + 7.20
- price help for drilling alone: ₹20; together ₹45
- **Regression:** slices 2 (54) and 3 (29) still pass; the frontend builds with no undefined names

**Also fixed:** Production's note and refusal for a Sub Child Part's first-step material said
"Purchase sends it". They now say Store hands it to Dispatch.

---

## 9. No transport charge on an Outsource Order (2026-10-21)

**Your point during R1:** transport on outsource work is always ours (T1). Dispatch arranges every
trip, and a hired vehicle's freight is recorded on the trip as a Dispatch expense. A "Transport"
charge on the vendor's Outsource Order would put transport in the wrong department and count it
twice.

**Now:**
- **Purchase → Settings → Charges:** each charge name has a **Transport** tick (Freight,
  Cartage…).
- **The New Outsource Order dialog doesn't offer** ticked names, or names that plainly mean
  transport (transport / freight / cartage / carriage / shipping / delivery).
  - A note says: only what the vendor bills (setup, packing, testing…); transport is arranged by
    Dispatch.
- **The server refuses such a charge** on create and on edit.
- **Other charges stay.** POs are unchanged: Freight is still fine there when the vendor
  delivers.

**Technical notes:**
- `PurchaseSettings.chargeLabels[].isTransport`; `cleanLabels` keeps it
- `outsourceOrderController.assertNoTransportCharge` (the tick or the words)
- **Frontend:** `PurchaseSettingsTab.jsx` (the tick), `NewOutsourceOrderDialog.jsx` (filter +
  note)

**Checks:**
- "Transport" refused
- a name ticked Transport refused
- the test suites' charge renamed to "Packing" (same figures); slices 2, 3, 5, 6, 7 all pass
- **Roadmap:** R1's charge is now **Packing ₹100** (totals unchanged: ₹354), with new checks
  O0.5b and O1.4c

---

## 10. Store's own Outsource Receive page (2026-10-21)

**Your point during R2:** Material Transfers is for transfers. Receiving outsourced work back
belongs on its own page, as Purchase Orders has its own receive page. Store also needs to see what
it has received and where it entered a leftover.

**Now: Store → Outsource Receive** (new menu item, after Material Transfers), three tabs:
- **To receive:** what Dispatch collected, one card per Outsource Order on a return trip (like To
  Dispatch).
  - **Each request:** Store counts it, then **Receive → QC** or **Report short**.
  - **"Leftover back from the vendor"** (optional) is always open: the size of sheet / length
    left, plus any unused items. It goes into stock.
  - Same rules as slice 7. Dispatch's collect isn't a receive (your call: "let it be").
- **At Store:** returned units waiting, with **Hand to Production** (moved from the old tab).
- **Received (new):** every receive, newest first. Columns: when / who, part · steps, order,
  vendor · trip, Dispatch's count, Store's count, and **the leftover entered with it** ("None" if
  none). It has a search box.

**Material Transfers** keeps Pending Transfers, Pending Returns, **To Dispatch (Outsource)** (that
one is a transfer: Store gives material to Dispatch) and Logs. Its From Outsource tab is gone.

**Leftover, both ways (your question):**
- **At the send:** Store cuts and keeps the offcut (To Dispatch).
- **At the end:** Store sends the whole sheet / length, and enters what the vendor sends back
  here.
- A hint on To Dispatch says this.

**Permission:** a new Store feature **"Outsource Receive"**, on by default for a new Store Head
role. **Existing roles: the Company Admin ticks it** (Store → Outsource Receive). The API is Store
Head / Store Employee, as before.

**Technical notes:**
- `DispatchTrip` return entry: `received.returned[]` (what was entered at that receive)
- `OutsourceOrder` line `returnedMaterial[]`: `orderCode`, `tripNo`
- `applyReturnedMaterial` returns its records; `storeReceive` saves them (+ a pre-order trip's
  whole-sheet leftover)
- **New:** `receivedAtStore` → `GET /api/dispatch-trips/store/received?search=` (Store only).
  It uses `$type: 'date'`, not `$ne: null`, over the returns array.
- **Frontend:**
  - new `pages/store/OutsourceReceive.jsx`
  - `OutsourceFromVendorTab.jsx` deleted
  - `MaterialHandshake/index.jsx` is down to 4 tabs
  - menu `moduleRoutes.js`, feature `roleModulesConfig.js`, route `App.jsx`
  - wording in `ProcessExecution.jsx` and `OutsourceToDispatchTab.jsx`

**Checks:**
- slice 7 test **30/30** (4 new):
  - the Received list shows A (12 collected, 12 counted, by whom, which trip) with its
    1250 × 400 offcut, and X with none
  - the line's note says which receive
  - search
- slices 2 (54), 3 (29), 6 (44) still pass, 0 left
- builds, with no undefined names

---

## 11. The vehicle waits & brings it back — one trip out and back (2026-10-21)

**Your point during R3:** when a vendor finishes in hours, our vehicle drops the material, waits,
and brings the work back. That was impossible: bringing work back always needed a separate return
trip, and a hired vehicle would have been asked for freight twice.

**Agreed:** plan it when the trip is made, plus two on-the-spot fallbacks
(`vehicle-waits-bring-back-2026-10.md`).

**Now (Dispatch → Vendor Pickups):**
- **New trip:** each outsource send line has a tick, **"the vehicle waits & brings it back"**.
  - It's pre-ticked when the order line's *Expected back* date is on or before the trip date, and
    Dispatch can change it.
  - The Outsource Order line says "…; the vehicle waits and brings it back".
- **Delivered** (one line or Delivered all): a ticked line also goes on **this trip** as "Collect
  … · the vehicle waited".
  - The trip stays **Out**. Dispatch counts Collected / Report short as usual, and Store receives
    on Outsource Receive.
  - It doesn't show in To collect, and there's no second trip or freight.
- **Vendor not ready:** **"Not ready — collect later"** on a collect job, while it's uncounted.
  - The requests go back to **To collect** and the trip can finish.
  - It works on any return trip, but it can't remove a trip's only job (cancel the trip instead).
- **Not planned, but ready:** **"Bring back on this trip"** on a delivered line, within 24 hours.
  - A Done trip goes back to Out.
  - After 24 h, plan a return trip.
- **Work that takes days:** unchanged, a return trip from To collect.

**Technical notes:**
- `DispatchTrip` job: `bringBack` (send), `sameTrip` (return)
- `OutsourceOrder` line: `dispatch.bringBack`
- `dispatchTripService`: `createTrip` takes `bringBack`; `markDelivered` → `addReturnJob`; new
  `bringBackOnTrip`, `collectLater`
- **Routes:** `POST /api/dispatch-trips/:id/jobs/:jobId/bring-back` and `/collect-later`
  (Dispatch, Vendor Pickups edit)
- **Frontend:** `VendorPickups.jsx` (dialog tick, trip card labels and buttons),
  `OutsourceOrdersView.jsx` (line note)

**Checks:** new test **23/23**, 0 left:
- planned: delivered → same-trip collect, trip Out → Done, **one** ₹500 freight
- an unticked line gets no collect, and stays in To collect
- bring back, and again → refused; collect later → back in To collect
- the trip's only job can't be left for later
- bring back reopens a Done trip
- refused: before delivery, after 24 h, and on a collect job
- Store receives from the same trip

**Regression:** slices 2 (54), 3 (29), 5 (26), 6 (44), 7 (30) pass. Builds, with no undefined
names. **Roadmap:** O4.4 / O4.4b test it on Order B.

**Bug found in R3 (O3.3), fixed the same day:**
- **What you saw:** TRP-0001 (Done) offered **"Bring back on this trip"** on all 3 lines, although
  they were already on the collect trip TRP-0002.
- **Cause:** the browser decided only from "delivered, not ticked, < 24 h". It couldn't see that the
  requests were on another trip. It wasn't about the trip being older than the change. The server
  would have refused the click ("already comes back on TRP-0002"), so no data was wrong.
- **Fix:**
  - The trip list / trip view now carry `canBringBack` per send line, worked out by the server
    (`annotateBringBack`: requests still with the vendor and on no trip, < 24 h). The button
    follows it.
  - Also: **"Not ready — collect later"** on a same-trip collect now clears the line's "the
    vehicle waits" flag (trip card and order line), so Bring back can be offered again.
- **Checks:** the bring-back test is now **30/30** (7 new: offered only when possible; hidden once
  on another trip, collected, or after 24 h; offered again after that trip is cancelled). Slices
  2, 3, 5, 6, 7 still pass.

---

## 12. Server-side pages for trips and Store's receives (2026-10-21)

**Your question during R3:** does Vendor Pickups page on the server? It didn't:
- **Trips:** one call, capped at 100. Older trips would silently drop off.
- **Store → Outsource Receive → Received:** capped at 200.

**Now:**
- **Vendor Pickups → Trips:**
  - 20 a page, newest first, "Page x of y (n trips)"
  - Live / Done / All as before
  - a **search** box: trip no., vehicle (with or without spaces), vendor, OSO no., PO no.
  - a **from / to** trip date, and Clear
- **Outsource Receive → Received:**
  - 20 a page, newest first
  - the same search plus order code
  - **received from / to** dates
- **The waiting lists (Purchase / To send / To collect) stay unpaged** on purpose. They hold only
  open work, which shrinks as trips finish, and paging would split one vendor's jobs while building
  a trip.

**Technical notes:**
- `listTripsPaged` (find + count, `skip` / `limit`). Search uses an escaped regex, so odd
  characters are literal.
- `receivedAtStore` is now one aggregation: unwind the returns, match, sort, then `$facet` rows +
  total, so it's paged in the database.
- Both return `{ data, pagination: { page, limit, total, pages } }`, limit ≤ 100.
- **Frontend:** `VendorPickups.jsx`, `OutsourceReceive.jsx` (`placeholderData: keepPreviousData`).

**Checks:** new paging test **18/18** on 25 made-up trips and 21 receives, 0 left:
- pages and totals; Live / Done
- search by vendor, trip, OSO, vehicle with spaces, PO
- date ranges; odd characters; a page past the end
- Received: pages, part search, order-code search, a date with its offcut, page size

**Regression:** bring-back (30), slices 6 (44) and 7 (30) pass. Builds, with no undefined names.

---

## 13. Per-step QC for fully outsourced Sub Child Parts (job-work) — bug fix (2026-10-22)

**Your find (R3 / R4, Fan Bush SCJW-2026-002, cutting ✓QC › drilling ✓QC):**
1. Cutting came back and **no QC job** was made.
2. **Drilling** showed in Purchase straight away.
3. The pieces weren't in Store → Outsource Receive → **At Store**, yet To Dispatch offered them.
4. Rahul's **cutting** line (OSO-0001) could only be paid after **drilling's** QC, even with
   drilling at another vendor.

**Cause:** a job-work order made **one QC job only after its last step returned**. It ignored each
step's own "QC required". The bill took every trip's acceptance from that one final check, and
At Store only listed production orders.

**Now (same rules as the hybrid Sub Child Parts):**
- **A trip comes back:**
  - its steps with **QC required** get a QC check for the pieces (QC → the job-work check)
  - a trip with no QC step passes at once
- **The next step** shows in Purchase → New requests only after that check passes. Until then:
  "In QC — cutting". An order for it is refused on the server too.
- **The bill:** each Outsource Order line is accepted from **its own trip's** check, so the cutting
  vendor is payable whoever does drilling. Pieces QC rejects come off that line.
- **Pieces rejected** on an earlier step don't go on: the next request is for the good pieces only.
- **The last trip:**
  - with QC → the order's **final** check (Pass = stock in, order Completed; job-work cost
    captured as before)
  - **no QC** on the last step → stock in straight away, no QC job
- **At Store** now lists job-work pieces between trips: "2 pcs · In QC (cutting)" or "2 pcs · next
  drilling is outsourced — stays at Store for the next trip" (with the Outsource Order no.).

**Existing data:** not fixed (your call: the data goes with the client's coming change). A trip
received before this carries no check and doesn't block.

**Technical notes:**
- `SubChildPartJobWorkOrder.rounds[].qc` (`needed`, `stepNames`, `qcJobId`, `status`,
  `sentQty`, `passedQty`, `rejectedQty`, `decidedAt`); `QCJob.jobWorkRoundId`
- `subChildPartJobWorkOrderController`: `jobWorkQcSteps`, `jobWorkPiecesLeft`,
  `createJobWorkQcJob`; `receiveJobWorkTrip` checks each trip; `sendToQCAndCaptureCost` handles a
  final step without QC
- `qcController.decideJob` (job-work branches):
  - Pass on a trip's check marks the trip passed only; the final check credits stock
  - rejects are recorded on the trip
- `outsourceRequestService.jobWorkGate` (+ qty = pieces left); `outsourceBillService.qcDecisionsOf`
  per trip; `dispatchTripService.jobWorkAtStore`

**Checks:** new test (job-work QC) **22/22**, 0 left:
- cutting held "In QC"; drilling order refused
- cutting Pass → no stock, drilling ready, Vendor A paid 2
- drilling at Vendor B → final check → stock 2, cost ₹90
- reject 1 of 4 → 3 accepted / 1 off, next request for 3
- all-no-QC part: passed at once, stock 3 without a QC job, cost ₹36
- At Store labels

**Regression:** slices 2 (54), 3 (29), 5 (26), 6 (44), 7 (30), bring-back (30), per-step price (9),
paging (18) all pass.

---

## 14. Client changes: automatic requests, and pricing types (2026-10-22 → 23)

### Change 1 — automatic outsource requests
Full write-up: `auto-outsource-requests-2026-10.md`.
- **A first Out Source step goes to Purchase when the order is made**, now for Child Part and
  Machine too: all units, one request. This replaces the 2026-09-22 "Production clicks first"
  rule and the outsource-v2 "arrival never changes" rule; the client changed both.
- **The request covers the whole run** of consecutive Out Source steps at every level. Sub Child
  Part used to send step 1 only.
- **Units back at Store**, QC passed, next step Out Source → that request is made automatically
  too.
- **A fully outsourced Child Part / Machine** needs no Production click at all.
- **In-house → Out Source is unchanged:** Production sends it.

### Change 2 — pricing types
Logic: `pricing-types-logic-2026-10.md`. Plan: `pricing-types-plan-2026-10.md`.

| Type | Purchase types | Amount |
|---|---|---|
| Per piece | ₹ / piece (unit) | rate × qty |
| Whole line | ₹ for the line | the lump sum |
| Per job work | ₹ / operation | rate × operations per piece (BOM) × qty |
| Per minute / Per hour | the rate only | rate × time, entered later on the order |

- **Each step picks its own type.** Per job work is only offered when the BOM step has an
  "Operations per piece" count. That count is set in the BOM process editor on Out Source steps
  only for now, and copied onto orders when they're made.
- **Time-based steps:** Purchase presses **Enter time** on the order (Orders tab → order → the
  step), any time after approval, even while the work is still at the vendor.
  - The step amount, the line, the order total and the bill row follow; the advance stays as it
    was.
  - The Company Admin is **notified**.
  - The time can be edited until that line's work is accepted (it's locked then).
- **Approval** (once, when the order is made):
  - the known total above the limit → amount approval
  - a time-based step with the new admin setting **"Approve time-based outsource orders"** on →
    approval to check the rate
  - the card shows the reason(s)
- **Advance:** % of the known amount, or a flat amount. Only flat when every step is time-based.
- **Paying:**
  - work QC accepts is valued at the line's average per piece (whole line ₹500 for 6, 5 accepted
    = ₹416.67)
  - a line with time not entered yet isn't payable; its QC result applies the moment the time is
    entered
- **Job-work cost:** uses the actual step amounts. A job-work order's last receive is refused
  while a time is missing: "Enter the time on OSO-… first".
- **Price help** compares only prices of the same type.

**Technical notes:**
- `services/outsourcePricingService.js` (`stepAmount`, `priceBasis`, `computeLine`,
  `computeOrderTotals`, `advanceOf`)
- **Models:**
  - `OutsourceOrder` `stepRates[]` (type, rate, operationsPerPiece / name, time, amount),
    line / order `timePending`, `hasTimeBased`
  - `paymentTerms.advanceType` / `advanceFlat`; `approval.reasons`
  - `PurchaseSettings.approveTimeBasedOutsource`
  - `PurchaseInvoice` row `basis` / `outsourceLineId` / `stepName`
  - `ProcessDefinitionSchema` `operation` (+ on order steps)
- **Controllers / services:**
  - `outsourceOrderController`: `readOrderBody`, `cleanOutsourceTerms`, `approvalFor`,
    `priceHistory` (`byStepType`), `postStepTime`, `jobWorkTimePending`
  - `outsourceBillService`: `billRowsForLine`, `applyAcceptance`
  - `RecordSet.stepOperation`; request views `stepOperations`
- **Route:** `POST /api/outsource-work/outsource-orders/:id/lines/:lineId/time`.
- **Frontend:**
  - `ProcessDefinitionEditor.jsx`, `NewOutsourceOrderDialog.jsx`
  - `OutsourceOrdersView.jsx` (step rows, Enter time, badges)
  - `OutsourceApprovalsTab.jsx`, `PurchaseRulesSettingsTab.jsx`

**Checks:**
- **New suites:** auto-request 9, P1 12, P2 23, P3 17. They cover:
  - logic-doc examples A–E: ₹590; ₹50 + ₹40 = ₹106.20; ₹118 → time 1 h 30 → ₹649, advance
    ₹23.60; flat ₹200
  - all four approval cases
  - acceptance waiting for the time
  - job-work cost waiting for the time
  - ₹416.67 pro-rata
- **Regression:** all earlier suites pass. One older shape (one price for a two-step line) was
  kept as one bill row.

---

## 15. Material not ready: warn Purchase, stop Dispatch (2026-10-23)

**Your point (roadmap v2, O1.1):** a Child Part's first step now reaches Purchase automatically
(§14), often while its Sub Child Parts are still being made. Before this, Purchase could order it
and Dispatch could even plan a trip (and book a hired vehicle's freight). Only Store's handover
stopped it, with "only 0 in stock".

**Agreed: Purchase gets a warning and decides; Dispatch is the hard stop.**
- **Purchase → New requests:** a ready request whose Store material isn't all in stock shows
  ⚠ "Material not ready: Fan Blade 0 / 6 (being made, ORD-2026-084) · Fan Bush 0 / 2 (being
  made, SCJW-2026-002)".
  - It names the order making each part, or says "short" when nothing is making it.
  - It covers everything Store would hand over for the steps left.
- **New Outsource Order:** a yellow box lists it, and **"I understand — order anyway"** must be
  ticked before Save (the server refuses without it). The order's history notes "Ordered while
  material isn't ready — …". An order whose material is in stock needs no tick.
- **Dispatch → To send:** such a line shows "Waiting for material — …" with **no tick box**, and a
  trip with it is refused on the server. Once Store has it all, it becomes sendable by itself.

**Technical notes:**
- New `services/outsourceMaterialReadyService.js` (`storeShortfall`, `shortText`): plan rows →
  what Store lacks (items by qty; sheets / lengths by area / length across catalog + same-section
  offcuts; cut pieces by length) + the open production / job-work orders making a part.
- `outsourceMaterialPlanService.previewRequestStoreRows`: a dry-run plan for a request.
- **`outsourceOrderController`:**
  - `getRequests` adds `materialWarning` to ready requests
  - `materialReadyCheck` on create / edit, body `acknowledgeMaterialNotReady`
- **`dispatchTripService`:** `waitingForDispatch` gives `sendable` / `materialWarning`;
  `createTrip` refuses.
- **Frontend:** `OutsourceRequestsView.jsx`, `NewOutsourceOrderDialog.jsx` (box + tick; also shown
  if the server finds a shortage the list didn't), `VendorPickups.jsx`.

**Checks:** new test **13/13**, 0 left:
- a Child Part whose first step needs 4 Sub Child Parts the cascade is making
- the warning names that order
- without the tick → refused and nothing saved; with it → made + history note
- To send not tickable; trip refused at 0 / 4 and 3 / 4; sendable at 4 / 4
- a part with its material in stock: no warning, no tick

---

## 16. Pagination check of every outsource list (2026-10-23)

**Your request:** check that the lists we use have server-side pages. From now on I add them to
any list that grows, without being asked (saved as a standing rule).

| Where | List | Pages |
|---|---|---|
| Purchase → Outsource Work | New requests, In progress (open) | not paged, on purpose: open work that empties |
| | In progress → **Show done** | **fixed:** its own section, 20 a page from the server |
| | Orders | was already paged |
| Company Admin → Approvals → Outsource | Pending | open work |
| | **Approved / Rejected** | **fixed:** only the newest 50 ever showed; now 20 a page + a search |
| Dispatch → Vendor Pickups | To send / To collect | open work, on purpose |
| | Trips | was already paged (§12) |
| Dispatch → Vehicles | all vehicles | short list |
| Store → To Dispatch; Outsource Receive → To receive / At Store | | open work |
| Store → Outsource Receive → Received | | was already paged (§12) |

**Technical notes:**
- `outsourceRequestService.listDoneRequests`: one aggregation over completed hand-offs, plus
  `$unionWith` completed job-work orders, sorted by when they finished, `$facet` page + total;
  views built for that page only.
- `GET /api/outsource-work/requests/done?search=&orderKind=&page=&limit=`.
- `listOutsourceApprovals` takes `search` (order no., vendor, part).
- **Frontend:** `OutsourceRequestsView.jsx` (`DoneRequests`, the main list no longer asks for done
  ones), `OutsourceApprovalsTab.jsx` (search + pages).

**Checks:** paging test 2 **13/13**:
- 23 finished requests over two pages, newest first; the type filter; search
- the open hand-off on the same order not listed
- Approved 25 over two pages; search by vendor and by part; Rejected

---

## 17. Notifications open the right page — every outsource notice checked (2026-10-23)

**Your bug (O4.19):** the Company Admin got "Outsource time entered", but clicking it opened the
Accounts page → Access Denied.

**Your request:** check every notification the outsource work sends. I listed each one, who gets
it, and where its click went:

| Notice | Who gets it | Click went to | Now |
|---|---|---|---|
| Outsource order waiting for your approval / created | Company Admin | Accounts page — **Access Denied** | Purchase Approvals → **Outsource Orders**, Pending (created: Approved), **searched to that order** |
| Outsource time entered | Company Admin | Accounts — **Access Denied** | Approvals → Outsource Orders → Approved, searched to the order |
| Order approved / rejected | the Purchase person who sent it | Purchase & Outsource → **Purchase tab** (wrong tab) | **Out Source Work → Orders, the order opens** |
| Outsource work short | Accounts | Purchase tab | the order opens |
| Ready for full payment | Accounts | Purchase tab | the order opens |
| **Outsource Work Requested** (automatic / hand-off) | Accounts | **Sales → Orders** (wrong module) | **Out Source Work → New requests** |
| New Sub Child Job Work Order (SCJW-…) | Accounts | Purchase tab | Out Source Work → New requests |
| The same, a hybrid part's first step (ORD-… code) | Accounts | **Sales → Orders** | Out Source Work → New requests |
| New QC Inspection Job (job-work check) | QC | QC Jobs | unchanged (was right) |

- **An approval notice clicked after the order was decided:** Pending would be empty, so the tab
  moves on to Approved, then Rejected, by itself (once).
- **Notices already sent** still route correctly: they're recognised by what they carry. Older
  admin notices have no order number, so they open the tab without the search.

**Also fixed today (your screenshots):**
- **Trip card (O4.16):** it said "Production ORD-2026-086: 2 pcs · Handed over — waiting". That
  didn't say where Dispatch collects it, didn't name the part, and sounded handed over.
  - Now: "**Collect from Production** (ORD-2026-086): 2 pcs Chamber frame · *not handed over yet
    — Production hands it over*". The same for Store.
  - The To send list says "From Store / From Production (ORD-…)".
  - Trips already planned keep their old text ("2 pcs").
- **Enter time (O4.10):** the hours / minutes boxes were too small to read. They're now wider,
  with "hours" / "minutes" hints.
- **Order history (found while checking):** the history said "above the ₹… limit" even when the
  real reason was a per hour / per minute rate. It now names the real reason, or both; the same
  on "Edited and sent again".
- **Bill stage (your O4.25 screenshot):** OSO-0003 was fully accepted (₹767 due now) but its bill
  still said **"Advance due"**, because the ₹100 advance was never paid.
  - That also meant the overdue check (which looks at "Payable" bills only) would never flag it.
  - **Now:** once everything is accepted, the bill is **Payable** (or Paid), advance or not.
  - The rule is shared, so PO bills get the same fix.
  - OSO-0003's badge updates at its next save (the payment in R7).
  - **Checks:** 7 stage cases; slice 3, P3, bring-back and job-work QC suites pass.
- **Fan's send asked Production for a Fan (your O5.2a screenshot):** OSO-0004 (Fan welding ›
  grinding) listed "From Production: 1 units Fan", next to Fan Blade / Fan Bush / Tool-A from
  Store.
  - **Cause:** in the BOM, grinding is "send the assembled part". The plan read that from grinding
    too, but on this trip the vendor makes the Fan in welding and grinds it on the spot.
  - **Effect:** Dispatch couldn't mark it Delivered until Production handed over a Fan that
    doesn't exist.
  - **Now:** only the **first** step of a trip decides whether the part itself goes. Later steps'
    own materials still go.
  - **OSO-0004** was planned before the fix: cancel it (nothing has gone out) and make it again.
  - **Checks:** slice 5 + a Fan-like case (weld › grind → no unit from Production, weld's
    material still goes; grind alone → the unit from Production), **29/29**; slices 6, 7,
    auto-request and material-ready pass.
- **New Outsource Order:** the price box per step was too narrow ("₹ for the lin…"); widened.
- **"Overdue" the same day (2026-10-24, your R7 screenshot):** a bill with no credit days read
  "full payment overdue since 24 Oct" on 24 Oct, the day its work was accepted. The overdue check
  would also have notified Accounts the same day.
  - **Cause:** the due date is the exact time of acceptance (+ credit days), and "overdue" compared
  the time, so a second later counted.
  - **Now:** a bill is overdue only once its due **day** has ended, the same way delivery dates
    count. With no credit days it reads "**due today (24 Oct)**", and is overdue from 25 Oct.
  - **Only how the date is read changed.** How the due date is set (acceptance + credit days,
    procurement v2) is the same, and PO delivery dates aren't touched.
  - **Shared rule:** PO bills follow it too: Vendor Payment, Purchase Invoices, the PO's payment
    status, the dashboard's overdue amount, and the overdue notification.
  - **Technical:** `isBillOverdue` / `startOfDay` in `purchaseBillService.js` (`owedNow`,
    `poPaymentStatus`); `runPaymentOverdueSweep` takes `dueDate < start of today`;
    `VendorPayments.jsx` (`dueState`), `PurchaseInvoices.jsx` (`pastDueDay`).
  - **Checks:** 10 date cases (today / later today / yesterday / just after midnight / 15 credit
    days / none; owed and PO status); slice 3, P3, bring-back, job-work QC pass.
- **Store receive asked for "unused" parts and tools (your O5.2c point):** Fan's receive offered
  "Fan Blade unused / Fan Bush unused / Tool-A unused" boxes.
  - In our design only fabrication material (sheet / length offcuts) comes back into stock.
  - **Now:** only the offcut boxes show. The server refuses unused items before anything is saved.
  - **Dev database checked:** no unused items were ever entered.
  - **Checks:** slice 7 + 2 new checks **32/32**; bring-back, slices 2 and 6 pass.

**Technical notes:**
- **Backend:** every Outsource Order notice carries `data.orderNo`. Outsource Work Requested and
  New Sub Child Job Work Order carry `data.outsourceRequest: true`
  (`notificationService.triggerAccountsNotification`). `approvalWhy()` in
  `outsourceOrderController.js` is used by the notice and both history lines. `prodSummary` in
  `dispatchTripService.js` names the part (`unitName` from the wip row).
- **Frontend:**
  - `getNavigationUrl` (`NotificationBell.jsx`, also used by the Notifications page) has the new
    rules, before the generic `orderId` → Sales rule
  - `PurchaseOutsourceHub.jsx` reads `?work=requests|progress|orders&order=<id>`
  - `PurchaseVendorApprovals.jsx` reads `?tab=…&status=…&search=…`, which goes on to
    `OutsourceApprovalsTab.jsx`
  - `VendorPickups.jsx` (`HandOver`); `OutsourceOrdersView.jsx` (`StepTime` boxes)

**Checks:**
- **Routing test 18/18:** the real `getNavigationUrl`, every notice above per role, older notices
  without the new fields, and the unchanged ones (vendor / PO approvals, sales orders, plain
  purchase).
- **Notice data + history test 10/10:**
  - time-only reason → "a per minute / per hour rate to check"
  - over the limit → "above the ₹100 limit"
  - resubmit names its reason
  - orderNo on the admin, rejection and time notices; the job-work notice is flagged

---

## 18. Slice 4: the outsource cost into the part, and fresh prices for Sales (2026-10-24)

**Why:** Sales quotes and bills a Machine from its stored price (cost × profit %). That price
was missing the outsourced work, sometimes Production's own cost, and only refreshed when someone
opened the Machine's BOM page. Logic: `slice-4-cost-logic-2026-10.md` (agreed with you, Q1–Q7).

**What changes for people:**
- **Nobody types the outsource cost.** It's read from the Outsource Orders: what QC accepted,
  without GST, plus a share of the order's charges (packing, testing). Freight isn't in it.
- **Production types its cost + expense at its last in-house step.**
  - **Last step in-house:** the same dialog as before.
  - **Last steps outsourced:** Mark Complete / Submit to QC on the in-house step before them now
    asks: "your cost for this unit; the outsourced steps are added automatically".
  - **Sub Child Part:** asked once, for the whole batch.
  - **Fully outsourced:** never asked (₹0).
- **The three numbers go to the BOM once, when the true last step finishes**, whoever finishes
  it: Production, QC, or Store's receive. The BOM shows a new **"Job work (outsource)"** row,
  with the build it came from.
- **A per minute / per hour time not entered yet:** the order still finishes. The BOM says
  "waiting for the time on OSO-…" and updates when Purchase enters it.
- **A Sub Child Part** now has Production cost + expense too (per piece = ÷ the pieces that
  finished; scrap spreads over the rest).
- **Store's receive of a job-work order** no longer shows a cost, and no longer waits for the
  time.
- **The price push:** a cost change anywhere climbs to the Machine's price at once:
  - a raw material's price, from a PO receive / the bill, Accounts' manual price or ₹/kg
  - a Sub Child Part, Child Part or Machine build
  - R&D editing a BOM

  Sales sees it without anyone opening a page. Child Parts get their cost stored (they aren't
  sold, so no MRP).

**Bugs fixed on the way (found reading the code):**
- **Production's typed cost was dropped** in four places:
  - a Machine with QC on its last step
  - a Sub Child Part with QC on its last step
  - a Sub Child Part with a non-QC last step after a QC step
  - an order with no QC step at all, at the last step's Approve

  All now reach the BOM.
- **A finished Child Part re-priced its fabrication material lines at the purchase cost per
  piece**, not weight × ₹/kg. Fixed (2 kg × ₹80 = ₹160, not ₹999 in the test).

**Technical notes:**
- **New services:**
  - `services/partCostService.js`: money from the Outsource Orders, the push, "the latest build
    wins" (`costFrom`)
  - `services/priceCascadeService.js`: the price push
  - `utils/bomMaterialPrice.js`
- **Fields:**
  - `Item.subChildPartDetails.productionCost / productionExpense / costFrom`
  - BOM `jobWorkCost / jobWorkWaitingFor / costFrom`
  - `ProductionOrder.unitCosts[]`
  - `SubChildPartJobWorkOrder.costPushedAt / costWaitingFor`
- **Hooks:**
  - `completeFinalProcessStep`, `approveQC`, `markProcessComplete`, `submitUnitQcStep`,
    `submitBatchQcStep`
  - `decideChildPartUnit`, `submitBatchQcDecision`, the job-work final check
  - `refreshAcceptance`
  - `cascadeRecalculateToConsumers` (was a no-op stub), `updateWeightUnitPrice`
  - the Child Part BOM edits, the Sub Child Part save, Sheet Plan save
- **Screens:**
  - `ProcessExecution.jsx`: the last in-house cost dialog, the unit's build-cost line
  - `ChildPartMasterTab.jsx` / `MachineBOMTab.jsx`: the job-work row
  - `SubChildPartMasterTab.jsx`: Production cost + expense
  - `OutsourceReceive.jsx`
- **Not changed:** the legacy fixed-step flows; older job-work trips not on an Outsource Order
  still type their total.

**Checks:** `slice4-cost-test.mjs` **29/29**, hand-worked:
- Machine job work ₹100 + ₹300 ÷ 2 = ₹250, MRP × 1.2
- Child Part ₹120 + ₹30 packing
- waiting for the time → ₹150
- hybrid Sub Child Part (₹200 + ₹160 + ₹40) ÷ 8 = ₹50/pc
- job-work ₹70 ÷ 2 = ₹35/pc with no typed cost
- the latest build wins
- the four dropped costs
- steel +₹10/kg → Machine +₹40, MRP +₹48 without opening a page

**Regression:** all 19 earlier suites pass. Four were updated to the new rule: a job-work order's
cost is no longer at the receive, but when it completes; no "enter the time first" block.
- slice 2 (54), slice 7 (32)
- job-work QC (23, + a check: ₹90 ÷ 2 = ₹45/pc on the final Pass)
- P3 (18: the cost is now ₹450 + ₹100 packing = ₹550, Q1)

---

## 19. Change a trip's vehicle / driver / date (2026-10-24)

**Your question (R8):** once Store had handed over, a trip couldn't be changed. Cancel is refused
then, and there was no other button. A breakdown or a new date had no answer.

**Now:** Vendor Pickups → Trips → **"Change vehicle / date"** on a **Planned** trip (nothing
delivered, picked up or collected yet), even after Store / Production handed over.
- **What can change:**
  - the vehicle (regular, or one-time with "save as regular")
  - driver and phone
  - the date (today or later)
  - a **reason** is required
- **The material stays handed over to Dispatch**: stock and reservations don't move.
- **Freight**, same rule as a new trip (hired only):
  - own → hired: asked, and the Transporting Cost expense is made
  - hired → hired: the same expense is updated
  - hired → own: the expense is removed
- **History:** the trip records what changed and why, e.g. "Changed: vehicle UK07AB… →
  UK07CD…, date 24/10 → 25/10, freight ₹0 → ₹800 — breakdown". Each Outsource Order on the
  trip records it too.
- **Unchanged:**
  - **cancel** is still refused after a handover (that would need Store to take the material
    back)
  - **an Out / Done trip** can't be changed

**Two more, from your first try:**
- **The trip card shows its history** ("History (n)"; changes in violet). It was saved but never
  shown. No permission is involved.
- **"The vehicle waits & brings it back" can be changed** in the same dialog, per send not delivered
  yet: a hired vehicle may refuse to wait. Unticked → collect later from "To collect". Once it's
  delivered, the collect job's existing **"Not ready — collect later"** does the same.

**Technical notes:**
- **Backend:** `readTripVehicle` / `saveAsRegular` pulled out of `createTrip` (shared);
  `updateTripDetails` in `dispatchTripService.js`; `PUT /api/dispatch-trips/:id` (Dispatch edit).
- **Frontend:** `ChangeTripDialog` in `VendorPickups.jsx`.

**Checks:** trip change test **17/17** (+ the vehicle-waits tick on / off, kept in step on the order line):
- after Store's handover the change is allowed and stock stays 94
- refused with no reason, a past date, hired with no freight, and after Delivered
- the four freight cases: expense made / updated / removed; save-as-regular
- history on the trip and on the order

Creating a trip still works the same (it shares the vehicle code now): slice 6 (44), bring-back
(30), paging (18) pass.

**Also (your point, O8.8):** New Outsource Order → Charges → **Add** starts on "Choose…" (it used
to pre-pick the first charge). A row with an amount but no name blocks Create order.

---

## 20. QC hands returned work to Production; QC step decisions in order and with an inspector (2026-10-25)

**Your call (after the R8 test):** Store's "Hand to Production" was an extra step. In real life QC
passes the work on to Production.

**Now, for work back from a vendor:**

| Case | What happens |
|---|---|
| QC passes it, next step in-house | goes to **Production by itself** (recorded as a handover) |
| No QC on those steps, next step in-house | goes to Production **at Store's receive** |
| Next step outsourced again | stays **At Store**, requested automatically (unchanged) |
| True last step | into stock / the sale (unchanged) |
| QC rejects (rework) | stays At Store (unchanged) |
| Fully outsourced Sub Child Part between trips | At Store (unchanged) |

- **Store → Outsource Receive → At Store** lists only work in QC, in rework, or waiting for its
  next trip. The "Hand to Production" button is gone.
- **Anything already QC-passed** and still listed is sent on when the page loads, **and when Production assigns a team** to that unit (2026-10-26: Production was blocked until Store opened At Store).
- **Replaces** slice 7 R4 and dispatch-design T8.

**QC step decisions (your R8 screenshot):**
- **An inspector first:** a step QC job opens itself "In Progress" when a step is sent, so steps
  could be passed with no inspector. Now, per unit and per batch, Review waits for "Start
  inspection". The server refuses too.
- **In order:** two steps back on one trip both reach QC. A later step can't be decided while an
  earlier QC step on the same unit / batch is waiting (before, BP816 unit 2's post painting was
  passed before pre painting).

**Also (your points):** Store's receive button says **Receive**; the message says "goes to QC"
only when it does.

**Technical notes:**
- `releaseReadyToProduction` in `dispatchTripService.js`, run inside `autoRequestAtStore` (after
  Store's receive and every QC decision; it now takes the user) and in `pendingAtStore`.
- `stepDecisionBlocked` in `qcController.js` (`decideChildPartUnit`, `submitBatchQcDecision`).
- **Screens:** `OutsourceReceive.jsx` (At Store without the button), `ChildPartUnitQCReview.jsx` /
  `SubChildPartBatchQCReview.jsx` / `QCInspection.jsx` (the Review rules), Production's "at
  Store" note.

**Checks:**
- QC order test **8/8**
- no-QC handover test **4/4**
- slice 7 **31/31**, updated: QC pass → Production by itself; At Store lists only the unit in QC
- also pass: auto-request (9), bring-back (30), job-work QC (23), slice 2 (54), slice 4 cost (29),
  slice 6 (44), material-ready (13)

---

## 21. Store and Dispatch don't wait on each other — Part 1: purchase pickups by line (2026-10-26)

**Why (your test, TRP-0014):** Store received the "We pick up" ss sheet PO, but the trip stayed
Planned with "Picked up" still to press. Store could also receive a "We pick up" PO with no trip
at all.

**The rule (you, 2026-10-26; both purchase and outsource):**
- **Store receives only what is on a Dispatch trip.**
- **Whoever records first:**
  - Dispatch first → as before.
  - Store first → Store's receive also records Dispatch's step, marked "at Store's receive", and
    the trip closes by its normal rule.
- **The send side is unchanged:** "Delivered to vendor" stays Dispatch's step.
- **Part 2 (outsource returns) and Part 3 (partial returns) follow.**

**Part 1, purchase pickups by PO line:**
- **Dispatch → Vendor Pickups → Purchase** lists each PO's **open lines**: not received, not
  cancelled, not on a trip. Dispatch ticks the lines a trip picks up (sheet + pipe), and the rest
  (bolts) stay for another trip.
- **Store → To Receive:** a "We pick up" line not on a trip shows "Waiting for Dispatch to plan
  the pickup" and has no Receive button. The server refuses it too, on every receive path. A line
  on a trip shows "TRP-… · planned / picked up".
- **Store receives before Dispatch pressed Picked up:** that line is recorded as picked up "at
  Store's receive", and the trip goes Out / Done by its normal rule.
- **On the trip card:**
  - each line with its state
  - **"Not ready — later"** per line: it leaves the trip and is back on the list
  - "Picked up" marks every remaining line
- **A cancelled trip frees its lines.**
- **Correction (your browser test):** if Dispatch pressed "Picked up" but a line wasn't on the
  vehicle, **"Wasn't on the vehicle — later"** on that line (even on a Done trip, until Store
  receives it) puts it back on the list, and the history says "Correction". Store presses
  Receive only when the goods are really at Store.
- **Old whole-PO pickups** (before this) still work as before. Store's receive closes them.
  TRP-0014 was closed that way on test-1.
- **"Vendor delivers" POs:** unchanged.

**Code:**
- `DispatchTrip` `poLines[]` on a pickup (+ `viaStore` on recorded stamps)
- `dispatchTripService`: `poPickupClaims`, `pickupForPoLine`, `recordPoLineReceived`,
  `poLineLater`, `pickupStateForPos`; `createTrip` takes `lineIds`; trip status counts a part
  picked-up pickup as Out
- `purchaseRequestController`: `pickupGate` on the 4 receive paths; Store's PO list gets
  `items[].pickup`
- route `POST /api/dispatch-trips/:id/jobs/:jobId/po-line-later`
- `VendorPickups.jsx` (ticks per line, line states, Not ready — later), `PurchaseRequest.jsx`
  (Store's Receive button)

**Checked:**
- Part 1 test **24/24** (incl. the correction), 0 left
- slice 6 44 (fixture PO lines given ids, as real POs have)
- slice 7 31, trip-change 17, bring-back 30, no-QC handover 4, stale at-Store 2, purchase cost 13

---

## 22. Store and Dispatch don't wait on each other — Part 2: outsource returns (2026-10-26)

**Before:** Store couldn't receive returned work until Dispatch pressed **Collected**. Store's
list showed only collected requests, and the receive refused anything else.

**Now** (the same "whoever records first" rule as §21):
- **Store → Outsource Receive → To receive** lists every request on a return trip, collected or
  not. A not-yet-collected row says "on TRP-… · Dispatch hasn't entered the collection — your
  count is checked against what was sent (6 pcs)".
- **Store receives before Dispatch:**
  - the count must equal **what was sent**
  - the receive records Dispatch's collection "at Store's receive" on the trip, the Outsource
    Order and its history
  - the trip goes Done by its normal rule
  - the receive itself is unchanged (QC, bill, cost, offcuts, at Store / straight to Production)
- **Dispatch collected first:** as before (Store's count must match Dispatch's). Dispatch pressing
  Collected after Store received is refused ("already collected").
- **Store's "Report short" before Dispatch collected** works like Dispatch's short:
  - the request leaves the trip and goes back to Dispatch's "To collect"
  - Purchase is told
  - Store can't receive it on that trip

  After Dispatch collected, a Store short stays on Store's list, as before.
- **Screens:** the trip card shows "Collected N (at Store's receive)" and "Short (Store)". Store's
  Received list shows "at Store's receive" in the Collected column.
- **Still a limit (Part 3, next):** a request comes back whole or is reported short. Part of a
  request (5 of 6) can't be received yet.

**Code:**
- `dispatchTripService`: `pendingStoreReceive` (all on a trip, `expectedCount`); `storeReceive`
  (no collection needed, records it `viaStore`, then derives the trip status); `reportShort`
  (`leaves` = Dispatch's, or Store's before collection); `receivedAtStore` `collectedViaStore`
- `postStoreShort`: the message
- `OutsourceReceive.jsx`, `VendorPickups.jsx` `ReturnJob`

**Checked:** Part 2 test **19/19**, 0 left (setup from slice 7).

---

## 23. Part 3: partial returns — fewer back than sent (2026-10-26)

**Why (found in testing):** a request of 6 that came back as 5 could only be "reported short". The
5 weren't recorded anywhere, and the next trip asked for all 6 again.

**Now** (logic doc `partial-returns-2026-10.md`, your five decisions):
- **Sub Child Part pieces come back in parts.**
  - Store (or Dispatch) takes what came; it **waits at Store** (At Store → "Back in part —
    waiting for the rest").
  - Dispatch's "To collect" shows only what's still with the vendor.
  - When everything is back, the request is received once (QC, bill, next step) as one batch.
- **"Not coming"** (lost, or kept / scrapped by the vendor):
  - **Purchase or Store**, with a reason
  - QC, stock, the bill and cost per piece all use **order qty − lost**; the bill shows
    "**lost at vendor**"
  - a **replacement order** for the lost pieces when the order came from a sales order / Child
    Part build (MachineCascade / ChildPartCascade); none for a low-stock order
  - if the rest is already back, the batch goes on now
- **Child Part / Machine units:** Store ticks the units that came. The hand-off **splits by unit**:
  those units go on now, and the rest are their own request, still with the vendor.
- **Damaged pieces aren't a short:** they come back and QC rejects them, as before.

**Code:**
- **Models:**
  - `OutsourceOrder` request `arrivals[]` / `lostQty` / `lost[]`
  - `ProductionOrder` + `SubChildPartJobWorkOrder`: `lostAtVendor[]` / `replacesLostOf`
  - `DispatchTrip` received `partial`
  - `PurchaseInvoice` adjustment `LostAtVendor`
- **New:** `utils/lostAtVendor.js`
- **`dispatchTripService`:**
  - part collect / receive (`withVendorQty` / `allBack` from `outsourceRequestService`)
  - `completeRequestReceive`, `partlyBackAtStore`, `markNotComing`
  - the units split at Store's receive
- **`outsourceWorkController.splitHandoffByUnits`**
- **Quantities:** `qcStepService.submitBatchStepForQC`, the no-QC credit paths,
  `partCostService.scpFinishedQty`, `jobWorkPiecesLeft`, the request lists, `qcDecisionsOf`,
  `takeLostOffBill`
- **`createSubChildPartOrderForItem({ replacesLostOf })`**
- **Routes:**
  - `POST /outsource-work/outsource-orders/:id/requests/:requestId/not-coming`
  - `POST /dispatch-trips/store/not-coming`
  - `GET /dispatch-trips/store/partly-back`
- **Screens:** Store's Outsource Receive (part counts, unit ticks, the waiting list, Not coming),
  Vendor Pickups (part counts), Purchase's Outsource Order (back in part, Not coming), the
  Accounts bill label

**Checked:**
- tests 3a **21**, 3b **19**, 3c **16**, 0 left
- every earlier suite re-run (see the daily report)

---

## 24. QC scrap / reject raises a replacement order too (2026-10-27)

**Why (you):** scrap already took pieces out of the batch (stock, cost and the bill were right),
but nothing re-ordered them. A sales order / Child Part build would come up short.

**Now** it works the same as "not coming" (§23):
- A hybrid batch's **Scrap** at QC, or a job-work order's QC **reject** (partial or full), on a
  **MachineCascade / ChildPartCascade** order raises a **replacement order** for that qty, with the
  reason.
- A low-stock order gets none.
- The QC reply says "Replacement order … raised".
- Production's pages show "N scrapped → ORD-…" and "replaces scrap on ORD-…".

**Also today:**
- **BOM cost, "the last complete build" (your pick):** a newer build still waiting for a per minute
  / per hour time no longer replaces a complete cost (slice-4 doc).
- **Store counts fewer than Dispatch collected:** the receive stays blocked; Dispatch and Store
  are told (not Purchase); the trip card shows "find the missing N".
- **Lost pieces show in QC and Production:** the QC header and Production's order pages show the
  lost pieces.

- **A rework resend carries only the reworked step** (found in your test): adding a later
  outsourced step is refused; Production's Send dialog shows "Rework of X: N pcs" and offers only
  that step (`GET /outsource-work/orders/:id/rework`).

**Checked:** `scrap-replacement-test` 7/7; `rework-lost-test` 10/10 ("not coming" on a rework
trip + the refusal); slice 4 cost 30/30 (case C: last complete build).

---

## Quick summary

| # | Change | Status |
|---|--------|--------|
| 1 | Real first material send for a hybrid Sub Child Part (once per order; leftover on return); Production can't issue that material; shared send code; two leftover bugs fixed. Request arrival unchanged (the 19 Oct merge undone) | Done; 27 tests; check in the browser |
| 2 | The Outsource Order: requests → vendor (Services) → price per piece, GST, charges, terms → Company Admin approval above the outsource limit; claims; Mark sent / Receive per request through the order; receive handles one round at a time + the QC gate before the next round; direct Send Round closed | Done; 56 tests; check in the browser |
| 3 | The outsource bill: made when the order is Open; advance; work payable as QC passes it (per unit / pieces passed / job-work QC), rejected work taken off; fully accepted → charges, advance set off, due in credit days; paid on Vendor Payment; ledger Job Work Charges; overdue sweep; cancel refused once paid; not in purchase value | Done; 29 tests; check in the browser (incl. a PO bill payment) |
| 4 | The material plan (slice 5): per request, Production first (what it holds, incl. in transit) then Store; sheet / length from Store combined per line and shared by area; Production Issue limited + open requests trimmed; Production part used when the trip goes out; per-step material check fixed (G2) | Done; 26 tests; check in the browser |
| 5 | Dispatch sends (slice 6): vehicles; trips (one vendor; POs + outsource lines; freight → expense; challan / e-way numbers); Store hands over the real stock (combined sheets / lengths from catalog or offcuts, cut pieces, items; each order booked its share); Production hands over; Delivered → trips Sent (CP first send no longer a dummy); PO picked up; Mark sent / cancel refused on a trip | Done; 44 tests; grant "Vendor Pickups"; check in the browser |
| 6 | Returns (slice 7): "vendor says ready"; Dispatch collects (count = sent, else Report short → Purchase); Store receives (count = collected; → QC; job-work cost from the order; offcuts / unused back into stock); hybrid units wait at Store — Store hands them to Production per unit after QC (Production blocked till then), or to the next trip | Done; 26 tests; check in the browser |
| 7 | Cleanup (slice 8): Purchase's temporary Mark sent / Receive / Receive all and the material picker removed — Dispatch sends, Store receives, the send moves no stock; dummy first send gone; old picker + Vendor Pickups stub endpoints gone; pre-order trips still receivable | Done; all suites through Dispatch → Store (179); check in the browser |
| 8 | A price per step on an Outsource Order line (sum = price per piece; price help per step; one bill row per step) — found in the flow test | Done; 7 tests; check in R1 (O1.4b) |
| 9 | No transport charge on an Outsource Order (Transport tick on charge names; transport-type names not offered and refused) — transport is ours, via Dispatch | Done; tests pass; check in R1 (O1.4c) |
| 10 | Store's own **Outsource Receive** page (To receive by order · At Store · **Received** list with the leftover entered at each receive); From Outsource tab removed from Material Transfers; new Store feature "Outsource Receive" | Done; slice 7 30/30 + 2, 3, 6 pass; Company Admin ticks the feature; check in R3 |
| 11 | The vehicle waits & brings it back: a tick per send line at trip creation (pre-ticked by Expected back) → delivered puts the collect on the same trip (no second trip / freight); fallbacks "Not ready — collect later" and "Bring back on this trip" (24 h) | Done; 23 tests + 2, 3, 5, 6, 7 pass; check in R4 (O4.4 / O4.4b) |
| 12 | Server-side pages: Vendor Pickups → Trips (20 a page, search trip / vehicle / vendor / OSO / PO, date range) and Outsource Receive → Received (20 a page in the database, search, receive dates); waiting lists stay unpaged | Done; 18 tests + bring-back, 6, 7 pass |
| 13 | Per-step QC for fully outsourced Sub Child Parts (job-work): a check per trip; next step after it passes; each order line paid from its own check; At Store lists the pieces | Done; 22 tests; all suites pass |
| 14 | Client changes: automatic outsource requests at all levels (whole first run; next run at Store), and pricing types per step (piece / whole line / per job work from BOM operations / per minute / per hour; enter time later; approval + flat advance; average per piece on QC) | Done; 61 tests; all suites pass; fresh browser test next |
| 15 | Material not ready: Purchase sees which parts are short / being made and ticks "order anyway"; Dispatch can't plan a trip until Store has it all | Done; 13 tests; check in roadmap v2 R5 (Fan) |
| 16 | Pagination check of every outsource list: In progress "Show done" and Approvals Approved / Rejected now paged on the server (+ search); open-work lists stay unpaged on purpose | Done; 13 tests |
| 17 | Notifications open the right page: Company Admin → Approvals · Outsource Orders searched to the order (was Access Denied); Purchase → Out Source Work (the order, or New requests — "Outsource Work Requested" went to Sales Orders). Also: trip card "Collect from Production / Store", wider Enter time boxes, history names the real approval reason | Done; 18 + 10 tests |
| 18 | Slice 4: outsource cost read from the Outsource Orders (never typed); Production's cost at its last in-house step; all three to the BOM at the true last step (whoever finishes it), waiting for any time not entered; Sub Child Part gets Production cost too; the price push climbs every cost change to the Machine's price at once. Fixed: 4 places Production's cost was dropped, fabrication lines priced at purchase cost | Done; 29 tests + all 19 suites; browser check next |
| 21 | Store and Dispatch don't wait on each other, Part 1: "We pick up" PO lines go on trips by line; Store receives only a line on a trip; Store's receive records the pickup if Dispatch hadn't (trip closes); "Not ready — later" per line (+ "Wasn't on the vehicle" correction) | Done; 24 tests + 7 suites; browser-checked |
| 22 | Part 2: Store receives returned work before Dispatch presses Collected (count vs what was sent; the collection recorded at Store's receive; trip closes); Store's short before collection = Dispatch's short (back to To collect) | Done; 19 tests + suites; browser-checked 2026-10-26 (TRP-0018, Fan Blade OSO-0013) |
| 24 | QC scrap / reject of a sales-order / Child Part order → a replacement order (same rule as "not coming"); BOM keeps the last complete build; Dispatch-vs-Store count mismatch goes to Dispatch + Store | Done; 7 + 30 tests |
| 23 | Part 3, partial returns: pieces back in parts wait at Store (Dispatch collects the rest); "not coming" (Purchase / Store, reason) → QC / stock / bill / cost use qty − lost, bill "lost at vendor", replacement order for sales-order / Child Part demand; units split by unit | Done; 21 + 19 + 16 tests; check in the browser |
