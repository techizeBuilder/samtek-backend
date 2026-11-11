# Step 2 built — serial tracking into production and to the customer (2026-10-31)

> **Updated 2026-11-02:** a review found gaps in the 31 Oct build. The fixes are in "2 Nov fixes" below.

Logic: [serial-tracking-logic-2026-10.md](serial-tracking-logic-2026-10.md) (D1–D16). Builds on step 1
([cascade-to-parent-changes-2026-10.md](cascade-to-parent-changes-2026-10.md)).

## Why
The client wants each vendor serial number tracked: **which production order used it** and **which
customer's order got it**, and (your addition) a warranty claim from Complaints **both ways**. Until now
a serial stopped at "Accepted" in stock.

## What changed, by place

**R&D → Inventory**
- A required choice on every item counted in pieces: **"How is this item used in production?" —
  Built into the product / Used to make the product**, with the explanation and "Not sure? Ask…". No
  default. Not shown for kg / litre / m items, Machines / Child / Sub Child Parts.
- **"Needs usage type (n)"** button on the list for older items still empty, and a daily bell to R&D
  (9:55) while any are.

**Store → Material Transfers**
- Transferring an item that has serial numbers in stock asks Store to **tick the serials** handed over
  (search, "Pick the oldest n"). The rule: at least *quantity − pieces in stock without a serial*, at
  most what's tracked; it says why when it doesn't fit.
- **Built into the product** → the serial is "Issued to <order>"; **Used to make the product** → "Used
  in <order>" (its trail ends). Empty usage type → issued, with a note that R&D hasn't set it.
- **Bulk Transfer** skips lines with serials ("use the Transfer button on that row").
- A part / machine holding serials that hasn't got its sticker yet **can't be transferred** ("label it
  first").

**Store → Outsource to Dispatch** — the same pick per item; the serials go to each request's
production order, its share first.

**Production → Return** — Production ticks which serials come back (only those issued to that order,
not already on a pending return). When Store accepts: **Excess** → back in stock (can be issued again);
**Defect** → **Defective** (not issued again; a vendor claim can be raised on it).

**Store → Label carriers** (new page, sidebar next to Reservations)
- When a **stock** build goes into stock holding serials — a low-stock Child Part / Sub Child Part order,
  or a stock Machine order — each unit appears here **waiting for a sticker**, with a bell to Store
  (and a daily one at 9:50 while any wait).
- Store enters the **sticker number** and ticks **what's inside** (the serials issued to that order or
  delivered into it by its cascades; "about n" is shown as a hint). Same number twice for the same part
  → refused. Then the serials read "Fitted in Panel S-101", and the stickered part is picked by its
  number when Store issues it.
- **Sub Child Part:** one source unit per piece → a sticker per piece; a fraction of a unit per piece →
  no stickers, the source serial is noted "Cut into batch".
- Cascade parts (step 1) never come here — they go straight to their parent order.

**The customer**
- A sales-order machine: everything in it (issued directly, delivered by its cascades, stickered parts
  issued to it) traces to its **customer Order**.
- **A sale from stock:** QC's Pass on the automatic Store QC job asks **which one** — our machine's
  sticker, or a bought product's vendor serial — and that goes to the customer Order with everything
  in it.
- **Bought for a customer's order:** QC's pass sends its serials straight to that customer Order.

**Complaints → Support**
- The customer's history shows **"Vendor parts in these orders"** — every vendor serial traced into each
  of their orders (vendor, warranty months, which part it's in) with **Claim**, which opens a Vendor
  Warranty Claim with the serial, customer and order filled in.
- Finding a serial in a claim shows **where it went**: e.g. *In Panel sticker S-102 → Machine order
  MO-7 → Customer order ORD-0081*.

**Store → Serial Numbers** — a **"Where it is"** column, and a **Stickers (our parts)** filter.

## Not changed
Receive, QC checks / REJ, vendor score, Packaging / Dispatch, the customer warranty, lots, stock
quantities, costs, reservations.

## Not built (open, if the client needs them)
- **A serial lost / scrapped with its part:** today a cascade order's serials are tracked at order level,
  and no current flow scraps a stickered stock part (a defective return covers it). A lost / scrapped
  unit's serials stay "Issued to <order>".
- **Units already issued before today** have no trail (units still in stock are pickable from day one).

## Technical notes
- **Models:** `PurchasedUnit.place` + `trail[]`; new `PartLabel` (sticker number unique per company +
  part, retired never reused); `Item.productionUse`; `MaterialReturnLog.unitIds / labelIds`.
- **New `services/serialTrailService.js`:** `pickRule`, `pickProblem`, `checkPicked`, `stockTracked`,
  `move` (place + trail, guarded by the current place), `orderTree`, `carrierCandidates`,
  `registerStockCarriers`, `holdsHint`, `labelCarrier`, `trailOf`, `unitsInCustomerOrder`, and the two
  daily reminders.
- **Touched:** `inventoryController` (item save rule + filter + count, transfer pick, Bulk skip, confirm
  return), `productionMfgController` (return pick, stock machine → label), `dispatchTripService` (store
  handover pick), `cascadeDeliveryService` (stock entry → label), `qcController.decideJob` (sale pick),
  `purchasedUnitService` (accepted → stock / sold; list "where", stickers), `ComplaintServiceController`
  (vendor parts), `vendorWarrantyClaimService.lookupSerial` (trail), `notificationService` (3 bells),
  new `partLabelController` + routes `/api/part-labels`, `/api/serial-numbers/stock` + `/issued`,
  `index.js` (2 crons + routes).
- **Frontend:** new `components/serials/SerialPicker.jsx`, new `pages/store/LabelCarriers.jsx` (+ route,
  sidebar), `SimpleInventoryForm.jsx`, `ModernInventoryUI.jsx`, `PendingRequestsTab.jsx`,
  `OutsourceToDispatchTab.jsx`, `ProcessExecution.jsx` (return), `QCInspection.jsx` (sale pick),
  `SerialNumbersTab.jsx`, `CustomerHistoryDashboard.tsx`, `VendorWarrantyClaims.jsx`.

## Checked (made-up company, real handlers, 0 left each)
- **A** 17/17 — pick rule, R&D save rule (create / update / one-field update not blocked), the filter +
  count, the bell, QC accept → stock, older units count as stock, a move can't repeat.
- **B** 17/17 — transfer pick (too few / foreign / exact), stock untouched on refusal, Used to make,
  Bulk skip, return pick (not on this order / twice), Excess → stock, Defect → Defective (not pickable).
- **C** 17/17 — low-stock Panel order → 2 waiting + bell; unlabelled blocks the transfer; label S-101 /
  S-102 with pairing; duplicate refused; a fitted motor can't be paired twice; issue by sticker; no
  serials → no sticker; Sub Child Part fraction / whole; a stock machine through the real
  `completeMachineUnit`; the daily reminder.
- **D** 11/11 — the three worked examples (sales order with a cascade, a stock Panel, a stock machine
  sold through a real Store QC decision), bought for an order, Complaints' vendor parts, the claim
  lookup's trail, Serial Numbers "where it is" + stickers.
- **Regression:** step 1 25/25; Dispatch store handover 24/24 + 19/19; one-REJ 21/21; reject-with-lines
  15/15. The old §67 photo suite (`s2`) fails 4 checks because it still rejects 3 pieces without lines —
  refused since §68 (30 Oct), not by this; its checks are covered by the newer suites.
- Backend loads; every changed page builds. **Not yet clicked through in the browser.**

## 2 Nov fixes (logic doc §11)

**Store**
- **A part waiting for a sticker blocks only when the handover needs it.** Stock 3, 1 waiting: 2 can go. It counts as
  neither tracked nor untracked. Store's transfer, Bulk Transfer, Dispatch's handover, QC's sale pick, the picker.
- **The picker's text** no longer says "R&D hasn't said" for a part or product (always built in).
- **Label carriers: "Nothing tracked inside".** A carrier with nothing to pair could never be saved and blocked issue.
  It now closes with no sticker, keeps its history (own tab) and counts as a plain piece. When every unit of the order
  is done, serials nobody paired show as a warning. The count stays a hint.
- **Defective Inventory Repair / Scrap ask which serial** when the row has tracked units; a part may say "Nothing tracked inside".
  - **Repair:** a plain unit → stock. A sticker → stock with its contents. A serial from a stickerless part → back with
    its part, and the piece waits for a sticker with it ticked.
  - **Scrap:** the unit → Scrapped. A sticker → **Retired** (number never reused) and **everything inside** → Scrapped.

**Production**
- **Returning a cascade part with no sticker:** say which serials are inside, or "Nothing tracked inside". Excess → stock
  + Label carriers, ticked. Defect → Defective Inventory, linked.

**QC and vendors**
- **QC scraps a Sub Child Part piece holding a whole source unit:** QC ticks the serial(s); the **whole piece** goes on
  Defective Inventory. A job-work reject (part or all) the same. A fraction per piece stays "Cut into batch". Child Part
  / Machine QC has no scrap (checked on screen on dev).
- **A piece lost at a vendor:** its serial → Lost, from Purchase's or Store's write-off. It skips Defective Inventory.

**Complaints**
- **Spare parts on a visit:** the technician says which serial / sticker. It goes to that customer + ticket, and the
  customer's history lists it under **"Fitted on service visits"**, with Claim.
- **Vendor warranty facts:** *12 months vendor warranty · received 1 Jan 2026 · delivered to customer 1 Jul 2026* (the
  order's earliest "Reached Safely"), or "not delivered yet". **No calculated end date**: it depends on the vendor's
  terms, so "Under warranty" stays by hand.

**Corrected from the 31 Oct report:** "A serial lost / scrapped with its part" under *Not built* is now built, as above.

**Decided not to build:** back unused from a vendor (only offcuts return), the old Repair Production page (nothing reaches
it), a strict count at pairing, a calculated vendor warranty date. **Still open with the client:** Accounts' New Invoice and
the manual Purchase Return ([open doc](../production/new-invoice-and-purchase-return-open-2026-11.md)); stock going out
through either leaves its serial saying "In stock".

**One addition to the agreed list:** Defective Inventory also offers "Nothing tracked inside" on a part's row. Without it, a
row with 5 pieces and 1 serial would force Store to tick that serial for a piece that doesn't hold it.

**Technical:** `serialTrailService` (`untrackedCount`, `unlabelledProblem`, `addCarrierEntry`, `insideCandidates`,
`defectiveTracked`, `checkDefectivePick`, `repairDefective`, `scrapDefective`, `scpPieceSerials`, `checkPiecePick`,
`applyScrappedPieces`, `unitsFittedOnVisits`, `orderDeliveredOn`); `place.defectiveOf / ticketNo / customerMobile`;
`PartLabel` status `Not needed`; `MaterialReturnLog.insideUnitIds / insideLabelIds`; `/api/serial-numbers/inside`,
`/defective`, `/scp-pieces`. Frontend: `SerialPicker` modes `inside`, `defective`, `scpPieces`; `LabelCarriers`,
`DefectiveInventory`, `ProcessExecution`, `SubChildPartBatchQCReview`, `QCInspection`, `OutsourceReceive`,
`OutsourceOrdersView`, `TechnicianActionModal`, `CustomerHistoryDashboard`, `VendorWarrantyClaims`.

**Checked** (made-up company, real handlers, 0 left each): `gb-test` 45/45 (includes Dispatch's handover with real serials
shared across 2 requests), `gc-test` 39/39 (includes a bought part + serial + cascade through to the customer's order).

**Regression after these fixes, all pass:** step 1 25, step 2 A–D 17 / 17 / 17 / 11, one-REJ 21, reject-with-lines 15, slice 4 cost 30, scrap replacement 7, partial returns 19 + 16, rework lost 10, job-work QC 23, bring back 30, Dispatch store 24 + 19, make-or-buy 17 / 19 / 9 / 10 + gate 18, material ready 13. `material-ready-test` was changed: it faked parts arriving by adding them to stock, which the agreed rule replaced. **Skipped:** the other outsource suites from slices 2–8 and the old §67 photo suite (it rejects 3 pieces without lines, refused since §68). Backend loads; every changed page builds. **Not yet clicked through in the browser.**

## Browser check (for you, with step 1)
1. R&D → Inventory: open a piece item → the usage choice is required; "Needs usage type" lists older ones.
2. Receive a warranty item with serials (§28) → QC pass → Store transfers some to a production order:
   the picker asks for the serials; Bulk Transfer skips that line.
3. Production returns one (Excess) and one (Defect) → Store accepts → Serial Numbers shows "In stock" /
   "Defective".
4. Raise a low-stock Child Part order that uses the serialised item → issue it → finish a unit →
   Store → Label carriers shows it + a bell → enter a sticker and pair → transfer that part to a Machine
   order by its sticker.
5. Sell a stock machine (sticker on it) → the Store QC job's Pass asks which → Complaints → the
   customer → "Vendor parts" → Claim.

### Added 2 Nov
6. Stock has 3 of a part, 1 waiting for a sticker: transfer 2 goes through; transfer 3 says "Only 2 can go now".
7. Label carriers: "Nothing tracked inside" on one; it leaves the waiting list. Finish an order's units leaving a serial
   unpaired: the amber warning names it.
8. Store → Defective Inventory: a returned serial asks which on Repair (back in stock) and Scrap (Scrapped). A stickered
   part: Scrap retires the sticker and the serials inside read Scrapped; that sticker number is refused afterwards.
9. Production returns a cascade part: "What's inside this part" asks. Excess: it waits on Label carriers with the serial ticked.
   Defect: it's on Defective Inventory, and Repair puts it back on Label carriers.
10. QC, a Sub Child Part batch whose source is one serialised piece per part: Scrap asks for the serial; the piece is on
    Defective Inventory. A job-work reject asks the same.
11. Write off a piece as not coming (Store's or Purchase's button): it asks for the serial; Serial Numbers says Lost.
12. A technician uses a serialised spare on a visit: "Which one did you fit?". Complaints → the customer → "Fitted on service
    visits", with Claim.
13. Complaints' Vendor parts and a claim's lookup show the months, received date and delivered date, or "not delivered yet".

### Added 3 Nov
14. On any screen with a serial pick and mixed stock, pick fewer than you could: a box, and **Go ahead** waits 3 seconds. **Serial Numbers → Went without a serial** records it. See [no-serial-warning-2026-11.md](no-serial-warning-2026-11.md).
