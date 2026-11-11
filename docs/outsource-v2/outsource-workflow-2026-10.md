# Outsource flow — design and build plan

- **Started:** 2026-10-19
- **Status:** design agreed with the user (D1–D8); **plan written, not built yet.**
- **Scope of this plan:** the **Outsource tab in Purchase**, plus the bill, the payment and the
  part's cost that follow from it. Dispatch and Store get their own design later (§6).
- **Page:** Accounts → Purchases → Purchase & Outsource → **Out Source Work**
  (`/accounts/purchases/purchase-outsource`).

---

## 1. Why this exists

Today Purchase only moves outsourced work: **Send Round** and **Receive Round**. Nothing records
*who* did the work or *what it cost*:
- **No vendor** on any outsourced job.
- **No order, bill or payment.** Job work never reaches the vendor's ledger.
- **No cost.** The hand-off's `costTotal` field exists, but nothing ever writes it. Only the old
  fully-outsourced Sub Child Part flow asks for a cost.
- **Two kinds of request** reach Purchase. Both stay, because how requests arrive doesn't change
  (D3):
  - fully-outsourced Sub Child Parts are a `SubChildPartJobWorkOrder`, visible to Purchase only
  - everything else is a hand-off on the production order (`outsourceHandoffs[]`)
- **The first material send is a dummy** on the hand-off path: the material is shown, but no
  stock moves.

The purchase flow is finished (`../procurement-v2/`), so job work can now use real vendors and
reuse the bill and payment machinery.

## 2. The whole flow (the user's view, 2026-10-19)

```
Production / auto-raise        Purchase · Outsource tab          Dispatch · Vendor Pickups       Store              QC      Accounts
──────────────────────         ─────────────────────────         ─────────────────────────       ──────────────     ────    ────────
Out Source request        →    pick requests, then the      →    "Outsource" tab: transport, →   receive the    →   QC  →   bill, payment
(part, steps, qty / units)     vendor; price per piece, GST,     get material from Store or      processed work
                               charges → Outsource Order         Production, send to vendor
                               (→ Company Admin if over limit)
```

- **Purchase (this plan).**
  - **No quotes.** Purchase picks the vendor and makes the order directly.
  - **Prices are manual.** Earlier prices are shown to help.
  - **No material questions here.** The material moves through Dispatch.
- **Dispatch (later, §6).** Vendor Pickups gets two tabs, **Purchase** (today's list) and
  **Outsource**. Dispatch arranges transport and gets the material from **Store** or
  **Production**.
- **Store (later, §6).** A new page to receive the processed work and send it to QC.
- **Accounts.** The bill and the payment.

**What this changes in Production:**
- **The material list** (§6, with Dispatch).
- **Cost and expense** (slice 4).

## 3. Decisions (agreed 2026-10-19)

| # | Question | Decision |
|---|---|---|
| **D1** | How does Purchase make an order? | **Requests first, then the vendor.** Tick the requests, then pick from the vendors who can do those steps. A **vendor filter** at the top covers the "vendor first" case (§4.1) |
| **D2** | Can one request's steps go to different vendors? | **Yes.** An order line covers the **next** steps of a request, in order. The rest stays open for another order (§4.3) |
| **D3** | The fully-outsourced Sub Child Part job-work orders | **Kept as they are** (corrected 2026-10-20). We don't change how requests arrive; we only expand what happens after a request reaches Purchase. A fully-outsourced Sub Child Part stays its own job-work order, **visible to Purchase only**. The Outsource Order (slice 2) takes **two kinds of request**: a job-work order, or a hand-off. *(On 19 Oct I merged them into hand-offs, which put them on Production's pages. Undone.)* |
| **D4** | Approval | **A new ₹ limit** for outsource orders, set by the Company Admin, separate from the PO limit. Above it, the order waits for the Company Admin, like a PO |
| **D5** | Bill and payment | **The order is the bill,** as for a PO: advance, payable once the work is accepted, credit days. Paid on Vendor Payment; posted to the ledger (slice 3) |
| **D6** | QC rejects outsourced work | Still open with the client. **For now:** Rework comes back as a request, as today, and Purchase can send it to the same vendor at **₹0** or at a charge |
| **D7** | Cost into the part | Price per piece becomes the job-work cost, added to Production's own cost (slice 4). **Postponed (user, 2026-10-20):** built last, once Dispatch / Store are done and the flow has settled. Order lines keep the rate and each request its accepted qty, so past orders can be costed then (a back-fill) |
| **D8** | Vendor score | **Later.** Not in this plan |

**Earlier decisions this replaces or confirms:**
- **G3** (procurement workflow): job work does **not** go through PR → quote → PO. It has its own
  order with no quotes.
- **Charges:** the September note said "Job Work gets GST only, no charges". **Now replaced:**
  GST **and** charges are entered on the order.
- **V7:** vendors still match steps **by name** (the vendor's Services = step names). It stays
  open.

## 4. The Outsource tab

### 4.1 Making an order (D1)

```
Out Source Work
┌──────────────────────────────────────────────────────────────────┐
│ Vendor: [ All ▾ ]     Status · Type · Search                      │
│ ☑ CP-001 Fan     welding › grinding   2 units   PROD-…079         │
│ ☑ CP-001 Fan     welding › grinding   3 units   PROD-…081         │
│ ☐ FB-01  Blade   laser cutting        20 pcs                      │
│                                     [ Create Outsource Order (2) ]│
└──────────────────────────────────────────────────────────────────┘
        ↓
New Outsource Order
  Line 1  CP-001 Fan · steps [welding ▾ › grinding]  · 5 pcs (2 requests)
          ₹ per piece [____]   GST % [__]          last ₹450 · avg ₹430 · this vendor ₹440
  Vendor  [ ▾ approved vendors whose Services cover every line's steps ]   ☐ show all vendors
  Charges [ + from the charge names in Purchase Settings ]
  Terms   advance % · credit days · expected back by
  Totals  subtotal · GST (CGST+SGST or IGST from the GSTINs) · charges · grand total
                                                                  [ Create ]
```

- **The list** shows every open request: one hand-off, or what's left of it.
  - A Child Part / Machine request counts **units**.
  - A Sub Child Part request counts **pieces**: the batch, or the rework quantity.
- **The vendor filter** (the vendor-first case, e.g. a vendor calls): the list keeps only the
  requests whose **next** steps that vendor's Services cover.
- **Lines merge automatically:** the same part with the same steps becomes one line, e.g. 2 + 3 →
  5 pcs. Different parts make separate lines on the same order.
- **The vendor list:**
  - Approved + active vendors only, the same rule as POs.
  - Their **Services** must cover every step on every line (matched by name, ignoring case and
    spaces).
  - Watchlist / probationary badges are shown, as on RFQ/PO.
  - "Show all vendors" lifts the Services match, with a warning; approval is still required.
  - **If no vendor covers everything,** the dialog says which line is the problem. You can untick
    that request, or send fewer steps on it (§4.3).
- **The price:**
  - **One full price per piece per line** (user: how the client prices job work isn't known
    yet — by hour, by kg or by job — so a per-piece price is used, easy to change later).
  - A price of **₹0** is allowed (a free redo, D6).
- **Price help:** for the same part + the same steps, from earlier outsource orders:
  - the last price, the average price, and this vendor's last price
  - "no earlier orders" until history builds up
- **GST:**
  - **The rate is typed per line.** The service's rate isn't fixed in the system.
  - **The GST type** (CGST + SGST vs IGST) is preset from the two GSTINs, the same rule as POs
    (`gstStateService`), and can be changed.
- **Charges:** the same charge names as POs (Purchase Settings), with values typed per order.

### 4.2 Approval (D4)

- **Company Admin → Purchase Approvals → Settings:** a new **Outsource order limit (₹)**. Blank =
  no approval needed.
- **An order above the limit** is saved as **Pending Approval**:
  - it shows on a new **Outsource Orders** tab in Purchase Approvals, and on the Admin dashboard's
    "Waiting for you"
  - the Company Admin approves it, or rejects it with a reason
  - a rejected order can be edited and sent again
- **An order at or under the limit** is **Open** straight away.
- Nothing moves to the vendor until the order is Open.

### 4.3 Rounds: one step out, back, then the next (D2)

A request with **welding › grinding**:
1. **Order 1, vendor A, welding only.** Each line picks how many of the **next** steps it covers:
   welding, or welding + grinding, never grinding alone.
2. The work goes out and comes back. If welding is a QC step, QC checks it.
3. **The request stays open with grinding left.** It shows as "ready to order" again **once QC has
   passed welding** (the hard gate: no next round before QC passes the last one).
4. **Order 2, vendor A or B, grinding.**

**One order line = one trip out and one trip back.** Today's "rounds inside a hand-off" become
successive orders on the same request. Each trip gets its own approval and its own bill.

**Between rounds the work comes back to us** (Store receives it, QC checks it if flagged).
**Vendor A → vendor B directly** (a "chain order") stays an open question (§7, OQ1).

### 4.4 Batching several production orders on one line (user, 2026-10-19)

Production's next step unlocks only when the step before it is **Completed**
(`ProcessExecution.jsx` `canStart`). A QC step is Completed only when QC passes it. A line that
carries requests from **different production orders** must therefore update **each order's own
steps**, never "the line's" steps.

**Rules:**
1. **Each request stays its own record.** On a line, each request is one round on **its own**
   order's hand-off. Every write lands on that order's own units and steps. The line only adds up
   quantities and money.
2. **Merge by step identity, not by index.** Requests merge only when their next steps match
   exactly by **category + step name**, in the same sequence.
   - Two orders of the same part can hold the steps at **different indices**, if they were built
     from different BOM versions or diverged through rework.
   - Each request keeps **its own `stepIndices`**. Send, receive and QC use those, never an index
     from another request.
3. **QC stays per production order.** Each order has its own QC job, so work that travelled
   together is still decided per order and per unit. A reject on one order doesn't touch the
   other order on the same line.
4. **Receive per request.** The vendor may return one order's units before the other's.
   - Receive is per request, or "receive all" loops over the requests.
   - A request is received **whole**: all its units together, as today (the hand-off rule). Never
     part of one request.
5. **No transactions** (standalone MongoDB). "Receive all" saves the production orders one by
   one.
   - Each request is skipped if it's already received, so a retry is safe.
   - The result lists any request that failed, and the line shows **Partly received** until it's
     done.
6. **Cancelling a line** (only before sending) removes **each** request's round. Each request
   goes back to "Waiting for order" with its steps open.
7. **Unlocking the next step is per order.** Receiving request A completes A's steps, or submits
   them to A's QC. Only A's next step unlocks, and only when A's QC passes. Request B on the same
   line is unaffected until B is received.

**Example:** line "CP-001 Fan · welding › grinding · 5 pcs".

| Request | Order | Units | Steps (its own indices) |
|---|---|---|---|
| A | PROD-…079 | 1, 2 | welding = 3, grinding = 4 |
| B | PROD-…081 | 1, 2, 3 | welding = 2, grinding = 3 (an older BOM without one step) |

- The vendor returns A first. A's units 1–2 get indices 3–4. Welding (a QC step) goes to 079's QC
  job; grinding completes; 079's step 5 unlocks once QC passes welding.
- B is still With vendor. B's later receive does the same on 081, with indices 2–3.

### 4.5 Statuses

| On the request (the list) | On the order |
|---|---|
| **Waiting for order** — nothing ordered yet, or steps left | **Pending Approval** / **Rejected** |
| **Ordered** — OSO-0007, the vendor, the price | **Open** — approved or under the limit; waiting to go out |
| **With vendor** — sent | **With vendor** — at least one line sent |
| **In QC** — received, a QC step waiting | **Partly received** / **Received** |
| **QC Rejected** — rework waiting (D6) | **Completed** — every line received and accepted |
| **Done** | **Cancelled** — only before anything is sent (for now) |

### 4.6 Until Dispatch and Store are built

> **Done (2026-10-21):** Dispatch (slice 6) and Store's receive (slice 7) are built, and these temporary buttons were removed in slice 8. See [slice-8-cleanup.md](slice-8-cleanup.md).

Purchase keeps today's buttons, **moved onto the order** and marked as temporary:
- **Mark sent:** today's Send dialog, including the Sub Child Part material picker on a first
  send.
- **Receive:** today's Receive. QC follows exactly as today.

Once Dispatch (send) and Store (receive) exist, these two buttons go. The order, the bill and the
cost don't change.

## 5. Behind the scenes (technical)

### 5.1 New model: `OutsourceOrder`

- **Number:** OSO-0001, unique per company.
- **Who and where:** `company`, `unit`, `vendor`.
- **`lines[]`** — one per part + steps:
  - the part: `item`, `itemCode`, `itemName`, `orderKind`
  - the steps: `steps[]` (category + step name), copied when the order is made
  - quantity and money: `qty`, `ratePerPiece`, `gstPercent`, `gstAmount`, `lineTotal`
  - **`requests[]`**: `{ productionOrder, handoffId, unitIndices, qty, stepIndices, roundId }`.
    These are the requests merged into this line.
  - progress: `sentQty`, `receivedQty`, `acceptedQty`
- **Money:** `charges[]` (name, amount, GST %), `gstType`, `subtotal`, `gstAmount`, `grandTotal`.
- **Terms:** `advancePercent`, `creditDays`, `expectedBy`.
- **`approval`** has the same shape as the PO's. It also has `status`, `notes` and an activity
  log (`purchaseAuditService`).

### 5.2 The link to the hand-off

- **Each request on a line becomes a round on its hand-off.**
  - The round gets a new status, **Ordered**, before Sent. The round's `coveredSteps` are the
    line's steps.
  - New round fields: `outsourceOrder`, `lineId`.
- So the existing Send / Receive / QC code keeps working on that round. Only *who* presses Send /
  Receive moves later (§4.6).
- **Receive has to change: process each round's own steps** (found 2026-10-19).
  - **Today:** `receiveOutsourceHandoffRound` does nothing to the steps until **every** step on
    the hand-off is back (`nowComplete`). Only then does it complete them, submit QC steps,
    record material use and run the last-step finishing, all at once.
  - **So today:** welding received in round 1 (grinding still to go) is never completed and
    never reaches QC. That breaks rounds (§4.3).
  - **New:** each receive processes **only that round's `coveredSteps`**, mapped to that order's
    own `stepIndices`, for every unit on the request. The hand-off is Completed when every step is
    received.
  - **Sub Child Part:** the second QC step in a round reads the quantity that survived the first
    (fixed 2026-09-26). Keep that working when rounds are processed one at a time.
- **Batching across orders (§4.4):** one round per request on its own hand-off. A line never
  writes to an order through another request's indices.
- **"Steps left on a request"** = the hand-off's steps minus the steps on rounds that are not
  cancelled.
- **"Ready to order"** = steps are left, and every QC step already received has passed. **This
  gate is new:** today `sendOutsourceHandoffRound` doesn't check QC.
- **`listOutsourceWork`** returns the request-level rows above. The vendor filter and Services
  matching are worked out on the server.

### 5.3 Settings and approval

- **New field:** `PurchaseSettings.outsourceApprovalThreshold`.
- **Approval routes** use the same pattern as `poApprovalController` (list, review).

### 5.4 The bill (slice 3)

- **The order is the bill.** When the order becomes Open, a `PurchaseInvoice` is made with a new
  `outsourceOrder` reference.
  - Its line `item` is the part (a Child Part / Sub Child Part / Machine is an `Item`), at the
    price per piece.
- **Reused from the PO bill** (`purchaseBillService`):
  - the advance (due when Open)
  - payable on acceptance (minus the advance share)
  - the full payment due on full acceptance + credit days
  - `payableNow`, `owedNow`, `payBill`
- **Accepted** = the work on a request is received **and** its QC steps on that trip passed. If no
  step on the trip is QC-flagged, it's accepted on receipt.
- **Ledger:** see OQ5.

### 5.5 Cost into the part (slice 4)

This uses `../outsource-cost-jobwork-design-2026-09.md` §3, with the order's price as the vendor
cost.

**Job-work cost added per trip:**
- **Child Part / Machine:** each unit on the request gets the price per piece plus its share of
  the order's charges.
- **Sub Child Part:** the line's money for those pieces, added to the batch.

**Then:**
- **GST isn't a cost** (it's input credit).
- **Added together at the true last step:**
  - in-house last step: Production's cost dialog adds the job-work cost so far
  - outsourced last step: the receive / QC pass adds Production's stored own cost, if any
- Both go through the existing `recalculateChildPartCost` / `applyManufacturedFinalCost`, or the
  Sub Child Part `jobWorkCost`.
- **Rework (D6):** the first cost stays. A paid redo adds its own trip's cost; a ₹0 redo adds
  nothing.

## 6. Later phases (not in this plan)

- **Dispatch · Vendor Pickups → Outsource tab:**
  - transport
  - material from **Store** (a step that picks its own materials, `ExplicitMaterials`) or from
    **Production** (a step that sends the assembled part, `AssembledPart`). That's the field we
    already have.
  - **The real first-send stock movement** replaces the dummy (`rawMaterial.dummy`).
  - Details from the user when we get there. ST6 belongs here.
- **Production material list:**
  - lines going to a vendor through Dispatch show as **"goes to the vendor via Dispatch"**, not
    "issue to the floor"
  - material set aside for an outsource trip can't also be claimed by Production
- **Store:** a page to receive the processed work back and send it to QC. It replaces Purchase's
  temporary Receive.
- **Vendor score for job-work vendors** (D8).
- **Chain orders** (OQ1), if the client asks.

## 7. Open questions

| # | Question | For now |
|---|---|---|
| OQ1 | Can work go from vendor A straight to vendor B (a chain order), skipping the trip back and QC between? | No. Work always comes back between rounds. Build a chain order only if the client asks |
| OQ2 | How does the client price job work: per piece, per hour, per kg, per job? | Full price per piece |
| OQ3 | QC rejects outsourced work: return to the vendor, free redo, charged redo, credit? | D6's interim. Revisit with the client; the PO's five vendor answers (refuse / replace / refund / credit / cancel) are the likely model |
| OQ4 | Cancel an order after it's sent? | Not allowed for now. Cancel only before anything is sent |
| OQ5 | Ledger account for job work: "Purchase" or a separate "Job Work Charges"? | A separate **Job Work Charges** expense account, so job work and material purchases are told apart |
| OQ6 | Does job work count in the Purchase Dashboard's purchase value / top vendors? | No. It gets its own figure later |
| OQ7 | Expected-back date: does it count from the advance, as on a PO? | A plain expected date on the order for now. Follow-up and overdue come with Store |

## 8. Build plan

Each slice ends in something testable. Tests: real handlers on a made-up company, with 0 left
over afterwards. The frontend must build with no undefined names. Write a change report section
per slice in `outsource-v2-changes-2026-10.md`.

### Slice 1 — A real first send for every Sub Child Part (built 2026-10-20)

*Revised 2026-10-20: the original slice 1 merged the job-work order into hand-offs. That changed
how requests arrive and was undone (D3). See the
[slice 1 plan](slice-1-one-outsource-system-plan.md) note.*

- **Hybrid Sub Child Part** (first step Out Source):
  - the first send takes the raw material out of Store, using the proven job-work send code,
    now shared in `subChildPartMaterialSendService`
  - once per order
  - leftover measured on return
- **Production can't Issue** material that goes to the vendor.
- **Two leftover bugs fixed:** the "mm" unit, and "0 leftover" being refused.
- **The job-work order and how requests arrive are unchanged.**
- **Done:** 27 tests; change report §1.

### Slice 2 — The Outsource Order (D1, D2, D4)

- **Backend:**
  - the `OutsourceOrder` model (§5.1)
  - round status **Ordered** and the round's order / line fields (§5.2)
  - "steps left" and the "ready to order" QC gate
  - **receive per round** (§5.2): process only that round's steps
  - **merging by category + step name**, with each request keeping its own `stepIndices` (§4.4)
- **New routes** under `/api/outsource-work/`:
  - `GET requests`: open requests, with a vendor filter
  - `GET vendors?requests=…`: the vendors that match, with badges
  - `GET price-history?item=&steps=&vendor=`
  - `POST orders`: validates eligibility, the step order, merging and totals; then Open or
    Pending Approval
  - `GET orders`, `GET orders/:id`, `PUT orders/:id` (only while Rejected), `POST orders/:id/cancel`
    (only before sending)
  - **Interim:** `POST orders/:id/lines/:lineId/send` (wraps today's send) and
    `.../receive` (wraps today's receive)
- **Approval:**
  - `outsourceApprovalThreshold` in Purchase Settings (Company Admin side)
  - the list and review routes
  - a new **Outsource Orders** tab in Purchase Approvals, plus its count on the Admin dashboard
- **Frontend:**
  - the Out Source Work tab becomes the request list with checkboxes and the vendor filter
  - the New Outsource Order dialog (§4.1)
  - an **Orders** sub-view (list + order detail with Mark sent / Receive)
  - the Settings field
- **Test:**
  - merge 2 + 3 into one line
  - the vendor match, and refusal of an ineligible vendor
  - a step-prefix order with the rest left open
  - the next round blocked until QC passes
  - over / under the limit, approve / reject / edit and resend
  - cancel before sending
  - send / receive through the order equals today's result
  - **two production orders on one line, with welding / grinding at different indices:**
    - receive A only → only A's steps and next step change, and A's QC job gets welding; B is
      untouched
    - then receive B → the same on B
    - QC rejects A's unit → B is unaffected
    - "receive all" run twice changes nothing the second time
  - **round 1 = welding only:** welding is completed or sent to QC on receive (it used to wait
    for grinding); grinding stays open until QC passes welding

### Slice 3 — Bill and payment (D5)

- `PurchaseInvoice.outsourceOrder`. The bill is made when the order is Open.
- **Acceptance:** on receive with no QC step, or on a QC pass of that trip's QC steps (hooks in
  `receiveOutsourceHandoffRound` and the QC decision paths).
- **Reuse `purchaseBillService`:**
  - the advance, payable and full-due logic
  - Vendor Payment shows the order bill like a PO bill
- **Ledger:**
  - advance: Advance to Vendors / Bank
  - accepted: **Job Work Charges** + Input GST / Accounts Payable, with the advance set off
    (OQ5)
- **Purchase Invoices list:** an "Outsource" type filter. The vendor balance includes it.
- **Test:** a hand-worked example (advance 20%, two trips, one with QC) checked against the
  ledger and the vendor balance.

### Slice 4 — Cost into the part (D7, D6 rework)

> **Postponed (user, 2026-10-20):** built after Dispatch / Store, when the whole flow exists and has settled (transport and material source may change the cost). Until then part cost is as before v2: a job-work order's cost at its final receive (pre-filled from the order); hand-off work not in the part cost. Include a back-fill for orders made in between.

- **Per-unit / per-batch job-work cost**, added up per trip (§5.5).
- **Production's cost dialog** at an in-house true last step adds the job-work cost so far. The
  outsourced true-last-step receive / QC pass adds Production's stored cost.
- **Sub Child Part:** `jobWorkCost` (`jobWorkCostSource: 'Actual'`) from the real trips.
- **Rework:** ₹0 adds nothing, and a charged redo adds its trip.
- **Test:** hand-worked totals for:
  - a hybrid Child Part (2 units, batched differently per step)
  - a fully-outsourced Sub Child Part
  - a Machine with an outsourced last step
  - a rework redo

### Order and dependencies

```
Slice 1 (real first send) → Slice 2 (order + approval) → Slice 3 (bill + payment)   [built 2026-10-20]
then: Dispatch Outsource tab → Store receive page → material list
      → Slice 4 (cost into the part, postponed to here) → vendor score
```

**Two kinds of request, from slice 2 on:**
- **A job-work order** (a fully-outsourced Sub Child Part, Purchase only): an order line becomes a
  round on the job-work order (`SubChildPartJobWorkOrder.rounds`).
- **A hand-off** (a hybrid Sub Child Part, Child Part, Machine): an order line becomes a round on
  the hand-off.

The Out Source Work list already merges both.

## 9. Critical files

- **Backend:**
  - `models/ProductionOrder.js` (hand-off rounds)
  - new `models/OutsourceOrder.js`
  - `models/PurchaseSettings.js`
  - `models/PurchaseInvoice.js`
  - `controllers/outsourceWorkController.js`
  - `services/subChildPartOrderService.js`
  - `controllers/subChildPartJobWorkOrderController.js` (fully-outsourced Sub Child Part requests; kept)
  - `services/purchaseBillService.js`, `services/purchaseLedgerService.js`
  - `controllers/qcController.js` (acceptance hooks)
  - `controllers/productionMfgController.js` (cost combine)
  - `services/vendorApprovalService.js` (`ELIGIBLE_VENDOR_FILTER`)
  - `services/gstStateService.js`
- **Frontend:**
  - `pages/accounts/SubChildJobWork.jsx` (becomes the request list + orders)
  - `pages/accounts/purchase/PurchaseOutsourceHub.jsx`
  - `pages/hrms/CompanyAdmin/PurchaseVendorApprovals.jsx` and `purchaseApprovals/*`
  - `pages/production/ProcessExecution.jsx`
