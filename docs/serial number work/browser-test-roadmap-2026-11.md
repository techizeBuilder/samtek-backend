# Browser test: serial number work + make or buy, together

*Written 2026-11-02. Replaces running the two lists one after the other: both need production orders, so they run along
the same orders. "MB 1.2" means step 1.2 of [make-or-buy-test-roadmap-2026-10.md](../make-or-buy-test-roadmap-2026-10.md).*

**How to use it:** go in order, each part sets up the next. When something doesn't match, tell me the step and what you saw.
Write the order numbers in the table at the end.

## Why these two machines

Dev data as of 2 Nov. Between them they cover every row of the delivery table with no change to their process steps.

| Row | Part's last step | Parent's step using it | On dev | Expected |
|---|---|---|---|---|
| 1 | In-house | Out Source | **Fan Blade** (drilling) → Fan welding | Production hands to Dispatch |
| 2 | In-house | In-house | **Chamber** (post painting) → PRO001 assemble | Production uses it |
| 3 | Outsourced | Out Source | **Fan Bush** (job work) → Fan welding | Waits at Store, Store hands to Dispatch |
| 4 | Outsourced | In-house | **Fan** (post painting) → BP816 assemble | Production, by itself |

**Dev data to expect:**
- **BA-009 Bairing** shows 6 serials though stock is 4: two left stock before tracking started. Dev only. The picker lists them; pick any.
- **Tool-A** has 12 serials in 21 pieces, so it's a good mixed case: a pick isn't forced while plain pieces cover the quantity.
- Fan's 1 in stock and BA-009's 4 are reserved by older Pending orders, so a new BP816 order builds its Fan and raises a purchase request for Bearings.

---

## Part 0: Set-up (R&D)

**New items, R&D → Inventory**
- [ ] 0.1 **Test Motor**, Pieces, warranty 12 months. The form requires "How is this item used in production?" with no default; choose **Built into the product**. Link it to a vendor.
- [x] 0.2 *(6 Nov, seen on the new item form: the question shows with Pieces, gone with Kilogram. Machine, Child and Sub Child Part forms not looked at.)* Kg / litre / m items, Machines, Child and Sub Child Parts don't show that question.
- [ ] 0.3 The list's **Needs usage type (n)** shows older items. Set **BA-009 = Built into the product**, **Tool-A = Used to make the product**. The count drops.

**New parts, R&D → BOM Management**
- [ ] 0.4 **Motor Mount** (Sub Child Part, made): source **Test Motor**, **1 per piece**, steps *paint (Out Source) → fit (In-house, QC)*. It's what lets us test a serial on a vendor trip, QC scrap and lost at a vendor.
- [ ] 0.5 **Test Sensor** (Sub Child Part): **Purchasable** from day one, warranty 12 months. Covers MB 2.1, 2.3, 2.4, 2.5. Also try MB 2.2 with a new bought Child Part (not used further).

**BOM changes**
- [ ] 0.6 **PRO001**: add **Test Motor × 1** to the *assemble* step.
- [ ] 0.7 **CP-002 Chamber**: add **Motor Mount × 1** and **Test Sensor × 1**, both to the *coating* step.
- [ ] 0.8 **MB 6.1, 6.2:** give Test Sensor an **Incoming** checklist. Give Motor Mount its fit checklist.
- [ ] 0.9 **R&D → Approval:** approve and Release Motor Mount, Test Sensor (MB 7.2–7.5 logic: only its Incoming list), then Chamber and PRO001 again if the BOM edit pulled them back. **MB 7.6:** Chamber can't be released while Test Sensor isn't.

**New on 2 Nov** ([bom-edit-pulls-approval-2026-11.md](../bom-edit-pulls-approval-2026-11.md))
- [x] 0.10 *(6 Nov, on Fan Bush, seen: the edit pulled BOM approval and Release, kept Design and QC List, banner "BOM changed… by test". Re-approved and released with the new BOM. On data: flag cleared; the new source quantity moved Fan Bush ₹58.13 → ₹61.76, BP816 ₹2,167.42 → ₹2,174.68, MRP ₹2,609.62. Saving with nothing changed not tried.)* **Editing an approved BOM pulls its approval back.** PRO001 and Chamber were edited before this, so they stayed Released. A further edit to either now un-releases it, so finish their BOM edits first and re-approve if asked. Run the short check on a Child Part you don't need, such as CP-001's line edited and put back at the end of the test.
- [x] 0.11 *(6 Nov, seen on the Sub Child Part tab: All 9, Not approved yet 3, Needs re-approval 1.)* **R&D → Approval filter:** All / Not approved yet / Needs re-approval, with counts on each tab.

## Part 1: Buy serials (`/store/purchases/requests`)
**Serials come from the quotation, not the item.** Store asks for one serial per piece only when the PO line's quote has warranty months and the item is counted in pieces. The item's own warranty field doesn't do it. A quote with no warranty → one lot number, no serials. Enter the warranty on every quote in this test.

- [x] 1.1 Link **Test Motor** to a vendor (Vendor Master → Products & Services), or it shows "0 approved vendors". Purchase request for **Test Motor × 10**. RFQ with **warranty 12 months on the quote** → PO → receive: Store types **10 serial numbers** and warranty cards.
- [x] 1.2 QC passes all 10. Serial Numbers shows them **"In stock"** with the **Where it is** column.
- [x] 1.3 **MB 5.1, 5.2:** Test Sensor is listed on the vendor's Products & Services; a made part isn't.

## Part 2: BP816, from a sales order (rows 1, 3, 4, through to the customer)

**The order** (quantity 1, through Leads → Order Form → Store)
- [ ] 2.1 Machine's Material List: Fan row **"Built for this order (ORD-…): 0 of 1 delivered"**; Issue refused for it.
- [ ] 2.2 The Fan order says **"built for ORD-…"**. Under it: a **Fan Blade order for 6**, a **Fan Bush job-work order for 2**, a **purchase request for 2 Bearings**.

**Fan welding, ordered before its parts exist**
- [ ] 2.3 Purchase's request warns: *Fan Blade 0 / 6 (being made, ORD-…) · Fan Bush 0 / 2 (being made, SCJW-…)*.
- [ ] 2.4 Without "order anyway" it's refused. With it, the order shows **"Fan Blade: 6 from Production (6 still being made, ORD-…)"** and **"Fan Bush: 2 from Store"**.
- [ ] 2.5 Dispatch: **not sendable**, with the same text. A trip can't be planned.

**Fan Blade (row 1)**
- [ ] 2.6 Laser (vendor) → drilling → QC pass of the batch. Fan's Material List: **6 of 6 delivered**. **FB-01 stock doesn't change.**
- [ ] 2.7 Dispatch now waits only for Fan Bush.

**Fan Bush (row 3)**
- [ ] 2.8 Cutting → QC → drilling → final QC pass. **SCP-002 stock goes up by 2**, Store → Reservations shows them held for the Fan order, and they are **not** on Production's list. No Label carriers entry.
- [ ] 2.9 Dispatch: **sendable**. Trip: **Store** hands over the Bush, **Production** hands over the Blades, Delivered.

**Bearings and Tool-A**
- [ ] 2.10 Buy the Bearings from a quote **with a warranty**. Receive them (serials) → QC. Store transfers them to the Fan order: the **picker** asks. Bulk Transfer is checked separately, later: [bulk-transfer-open-2026-11.md](bulk-transfer-open-2026-11.md).
- [ ] 2.11 Fan grinding (vendor) uses Tool-A: at Store's handover to Dispatch the picker offers its serials. Picking none now shows the warning box (**Go back** keeps the form; **Go ahead** counts down 3 seconds). Pick 1: no box, and it reads **"Used in ORD-…"**.
- [ ] 2.11a Receive OSO-0022 back from the vendor (welding + grinding), so the Fan can go on to *coating*.

**Fan finishes (row 4)**
- [ ] 2.11b **Material List on the Fan order** ([material-list-used-and-return-2026-11.md](material-list-used-and-return-2026-11.md)): Fan Blade **Used** with no Return, Fan Bush **Used 2/2**, Tool-A **Used 1/1**. Issue, transfer and receive Bearings and NUT Bolts: Return offers both types. Start coating: **Defect only** (don't submit one). Finish coating: Return is gone.
- [ ] 2.12 Post painting comes back through Store. The Fan lands on **BP816's line (1 of 1 delivered)**, not in Fan stock.

**To the customer**
- [ ] 2.13 Finish BP816 → Packaging → Dispatch. **Before "Reached Safely":** Complaints → **Customer Records** (`/complaints/customer-records`) → the customer → **Vendor parts in these orders** lists both Bearings: *in Fan order, 6 months (sujeet's quote; TEST-01, TEST-02) · received … · not delivered yet*.
- [ ] 2.14 **After "Reached Safely":** *delivered to customer <date>*.
- [ ] 2.15 **Claim, both ways** ([one-place-for-claims-2026-11.md](one-place-for-claims-2026-11.md)). Support Management → Vendor Warranty Claims → New claim → **By customer or order:** the mobile number and the order number each list TEST-01 and TEST-02. Pick one: it's already looked up, with the customer and order filled, *Where it went: Child Part order → Machine order → Customer order*, the delivered date, and no end date. **By serial:** TEST-02 + Find fills the customer and order. **Customer Records → Claim:** the same form, with no Find to click.

## Part 3: PRO001, stock order for 2 (row 2, serials in pieces, stickers)

**Stock first, build only the shortfall**
- [x] 3.0 Before raising the order, lower **SCP-003 Chamber frame** to **1 free** by hand. PRO001 for 2 needs 4: the Chamber order reserves **1** and a Chamber frame order is raised for **3**.

**Test Sensor shortfall**
- [x] 3.1 **MB 8.2:** Chamber is short of Test Sensor → a **purchase request**, no build order.
- [x] 3.2 **MB 5.3, 6.3:** receive it with a serial → its QC uses the **Incoming** list → stock. Store transfers it by serial to the Chamber order.

**Motor Mount: a serial on a vendor trip**
- [x] 3.3 Its first outsourced step's trip (on dev: *welding*, then in-house *grinding*, not paint → fit) carries Test Motors from Store: on Store's handover **tick 2 serials**. They read "Issued to" the Mount order.
- [x] 3.3a *(5 Nov, on Motor Mount ORD-2026-105, OSO-0038, TRP-0047: box seen naming ORD-2026-104; Go back moved nothing on data; Go ahead: MTEST-09 Issued, Test Motor 1 / 3 / 1 / 2 / -1, Short 1 until PR065 arrives, and the trip's history reads "Store went ahead after the warning". The countdown itself was seen at 2.9, on the same box.)* **Held stock warning** ([store-handover-held-stock-warning-2026-11.md](store-handover-held-stock-warning-2026-11.md)): a handover that takes stock reserved for an earlier order shows the box. **Go ahead** counts down 3 seconds, **Go back** moves nothing, and going ahead shows in the trip's history. OSO-0022 at 2.9 shouldn't show it. The stock to set by hand is decided from dev data when we reach this step.
- [x] 3.3b **Too few serials picked** ([no-serial-warning-2026-11.md](no-serial-warning-2026-11.md)): on a Test Motor transfer with both serial and plain pieces in stock, pick fewer than you could. Box, 3 seconds, **Go back** moves nothing. Go ahead, then **Serial Numbers → Went without a serial** shows the row with who and when. The same box guards the steps below (3.4, 3.5, 3.6, 3.10, 3.15, 4.1), only when the stock is mixed. When every piece has a serial you're refused instead, as those steps say.
- [x] 3.4 *(Do it after 3.5, on the replacement order's trip, before receiving: OSO-0027 was already received in full. A trip of 1 was refused; fixed 4 Nov, see [the report](../outsource-v2/all-lost-at-vendor-changes-2026-11.md). On OSO-0028.)* **Lost at a vendor:** write off 1 as not coming. It asks for the serial → **Lost**, not on Defective Inventory. A replacement order appears; its trip needs one more serial.
- [x] 3.5 **QC scrap:** at the *fit* batch QC, scrap 1. It asks for the serial → that piece is on **Store → Defective Inventory** with the serial linked. Another replacement order appears.
- [x] 3.6 **Defective Inventory:** Repair asks which serial → stock + 1, and the piece waits on **Label carriers** with the serial ticked.
- [x] 3.7 Finish the Mounts: they land on the Chamber order's line, not in stock.

**Chamber (row 2) and the return**
- [x] 3.8 Chamber finishes → on PRO001's line, Chamber stock unchanged.
- [x] 3.9 **Return a Chamber (Excess), before the step using it starts,** since used material can't go back as Excess: "What's inside this part" asks. Tick its serials → Store accepts → stock + 1, on Label carriers with them ticked, and the row's delivered count goes down so the line asks Store for one.

**Test Motor on the machine**
- [x] 3.10 Transfer 2 to PRO001: picker asks. Before the step using it finishes, return 1 as **Defect** → Store accepts → **Defective**. Scrap on Defective Inventory asks which → **Scrapped**.

**Stickers**
- [x] 3.11 *(5 Nov, on data, on stock order ORD-2026-104, OSO-0039, QC-2026-0280: PRO001 stock 2, 2 waiting, each offering MTEST-10, MTEST-11, C-102, C-103; bell sent per unit; 7 items, 0 short. MTEST-02 reads M-101 → C-102 → ORD-2026-104.)* Finish PRO001's 2 units → stock + 2, **2 waiting on Label carriers**, bell to Store.
- [x] 3.12 *(5 Nov: covered at 3B.4 on Motor Mount, seen on screen: same check, per part. Not seen on screen for a machine, where it sits on the Store QC job.)* **A part of stock only:** transferring all of a part while some wait for a sticker says *"Only n can go now"*; a smaller quantity goes.
- [x] 3.13 *(5 Nov, on the new screen: S-101 on both rows refused, nothing saved, seen. S-101 holds MTEST-10 + C-102. On data, MTEST-02 reads M-101 → C-102 → S-101 → in stock. The chain on Serial Numbers wasn't seen in a screenshot.)* Label one **S-101**, tick what's inside. The same number on another PRO001 is refused.
- [x] 3.14 *(5 Nov: row 2 Nothing inside; amber warning seen naming MTEST-11, C-103. Those two stay on ORD-2026-104 with no customer, by design of this test.)* **"Nothing tracked inside"** on the other: it moves to its own tab. If serials are left unpaired, the **amber warning** names them.

**Sold from stock**
- [x] 3.15 *(5 Nov: ORD-0131, QC-2026-0281. Stopped on a bug: the job waited for Production's Final checklist forever; [fixed](../qc-store-purchase-final-checklist-2026-11.md). Then seen on screen: 3 rows, Review, picker offering S-101, the warning box with countdown when none was picked. On data: job Approved, S-101 Sold to ORD-0131, MTEST-02 reads M-101 → C-102 → S-101 → ORD-0131; the customer's parts are MTEST-02, MTEST-10, STEST03; PRO001 stock 1. Customer Records seen: those 3 serials with their stickers, not delivered yet.)* A sales order for PRO001 → Available → the Store QC job's Pass asks **which one**. Pick S-101. Complaints → that customer → Vendor parts shows what's inside it.
- [x] 3.16 *(5 Nov, on the extra Mount, through Chamber ORD-2026-106: picker offered C-104 on screen. On data: C-104 Retired, MTEST-09 Scrapped, Defective row 0. The refusal afterwards is from the code: the duplicate check covers every sticker on a part, retired ones included; not tried on screen, as no Mount is waiting. ORD-2026-106, frame ORD-2026-107 and PR067 stay open, unbought, Short 3 on Reservations: dev only.)* **Scrap a sticker:** before the step using it finishes, return a stickered part as Defect, then Scrap: sticker **Retired**, everything inside **Scrapped**, and that number is refused afterwards.

## Part 3B: a stock part with a sticker, used on a new order (logic §7 case B)
*Added 4 Nov: the steps above never put a sticker on a part and then pick it for an order. Run after Part 3. The new order only has to reach the transfer; it doesn't need finishing.*

*5 Nov, your order of work: finish PROD-2026-449370 first (done; it belonged to ORD-0130, so its units went to the customer, not stock), then run Part 3B from the bottom up. A machine order raised first would make the Chamber a cascade order with no sticker, so each level is built for stock in turn:*

1. *Motor Mount, low-stock × 1 (Min Stock 2, Order Qty left at 0, which builds 1). With the repaired Mount that makes 2 to sticker. Min Stock back to 0 before the next level. This is 3B.1–3B.5.*
2. *Chamber, low-stock × 2 (Min Stock 2, Order Qty 2). Reserves the 2 Mounts from stock with no new Mount order, and Store picks their stickers (3B.6, 3B.7). Each Chamber sticker holds a Mount sticker and a sensor serial. Frames stay a cascade under the Chamber: they hold no serial, so they get no sticker. Min Stock back to 0 after it is raised.*
   - *[x] Passed 5 Nov: one entry, range and Fill what's inside seen on screen, C-101 refused (your report). C-102 holds STEST03 + M-101, C-103 holds STEST04 + M-102. On data, MTEST-02 reads M-101 → C-102 → in stock, MTEST-08 reads M-102 → C-103 → in stock. Step 9, added 5 Nov: on the new Label carriers screen ([report](label-carriers-one-entry-2026-11.md)), the 2 Chambers are one entry. A used number is refused with nothing saved. Generate C-102, C-103; Fill what's inside gives M-101 + STEST03 and M-102 + STEST04; Save. Serial Numbers reads MTEST-02 through M-101 and C-102, and MTEST-08 through M-102 and C-103.*
   - *[x] Passed 5 Nov: ORD-2026-104, PRO001 × 2, Stock, no customer, 3 real steps. Reservations on data as listed below, no part order or purchase request. Form and old-order note seen on screen; the Machine list seen only for PRO001. Step 10, added 5 Nov: the New Order form was old code (no quantity, no reservations, typed machine), rebuilt: [report](../production/stock-order-form-2026-11.md). New Stock Order now makes all three types, on every tab. Machine offers PRO001, BP816, IHT, PRO-0014, and not IP612, M-311, PMT, PRo-009. PRO001 × 2: 9 items, 0 short, Chamber 2 / 2 / 0 / 2 / 0, Test Motor 2 / 2 / 0 / 2 / 0, Tool-A 13 / 5 / 2 / 3 / 10, NUT Bolts 1,310 / 32 / 0 / 32 / 1,278. No Chamber or Mount order.*
3. *PRO001 stock order × 2 (New Order). Reserves the 2 Chambers from stock, Store picks their stickers. This is 3.11–3.16.*
4. *3.3a, the held stock warning: after step 3 is raised, and before Store transfers its Test Motors, raise Motor Mount × 1 on New Stock Order (changed 5 Nov: no minimum or sweep needed). Its handover wants a motor the machine order holds, so the box should appear. Go back, then Go ahead. That leaves the machine 1 motor short: PR061 or 1 added by hand, decide then.*

*Test stock added directly on 5 Nov, not through a purchase: Test Sensor × 2 (STEST03, STEST04, on sujeet's PR063 PO, 12 months, Accepted, In stock) and 1 full 6,000 mm length of 5 mm C channel; both have a stock audit entry. Test Motors: exactly 3 left for this (MTEST-08, -09, -10). PR061 and PR062 stay Pending.*
- [x] 3B.1 *(5 Nov: ORD-2026-101 for 1, LowStock, no parent; Test Motor 3 / 1 / 0 / 1 / 2 on data; minimum back to 0.)* Set **Motor Mount** minimum stock to 2 → the sweep (every 30 minutes) raises a low-stock order, not "built for" anything.
- [x] 3B.2 *(5 Nov: OSO-0034, rahul vendor, MTEST-08 on Store's handover, no box; Test Motor 2 / 1 / 1 / 0 / 2 on data.)* Build it: Test Motors by serial → welding → grinding → QC. **Set the minimum back to 0 before it finishes,** or the next sweep may raise another.
- [x] 3B.3 *(5 Nov: seen on screen: stock 2, 2 waiting. Bell in dev data. ORD-2026-101 Completed, Test Motor row gone, 7 items, 0 short.)* Motor Mount stock goes up, and the pieces wait on **Label carriers** with a bell to Store.
- [x] 3B.4 *(5 Nov: seen on screen on ORD-2026-102: quantity 2 "Only 1 can go now", Confirm disabled; quantity 1 offered and picked M-101. Motor Mount 1 / 2 / 1 / 1 / 0 on data.)* A transfer that needs an unlabelled Mount is refused: *"Only n can go now"*.
- [x] 3B.5 *(5 Nov: M-101 holds MTEST-02 on the repaired Mount; M-101 again on the new Mount refused on screen; M-102 holds MTEST-08.)* Sticker **M-101**, tick the motor inside. Same for the next piece.
- [x] 3B.6 *(5 Nov: Chamber ORD-2026-102 for 2, raised before the stickers: reserved both Mounts, no new Mount order; picked M-101 then M-102 on screen. Motor Mount 0 / 2 / 2 / 0 / 0 on data.)* A new order needing Motor Mount reserves it from stock, with no new Mount order. On Material Transfers, Store **picks the sticker**.
- [x] 3B.7 *(5 Nov: seen on Serial Numbers: "In Motor Mount sticker M-101 → Child Part order ORD-2026-102".)* The motor's serial reads through M-101 to that order.

## Part 4: Service visit
- [x] 4.1 *(5 Nov, TKT-MW3L4N6Y-CFA3: picker seen with MTEST-12. On data: Fitted on service visit, Sold place carries the ticket and 9012761010, Test Motor stock 0, no reservation change.)* A technician uses a Test Motor on a visit: **"Which one did you fit?"**. Stock goes down.
- [x] 4.2 *(5 Nov, seen on Customer Records for 9012761010: MTEST-12, fitted 5 Nov on TKT-MW3L4N6Y-CFA3, with Claim; the ticket under Recent Service Requests, Resolved.)* The customer's history: **"Fitted on service visits"**, with the ticket and Claim.

## Part 5: Make or buy, the switch (BP816 + Fan + Fan Bush)
M = BP816, CP-A = CP-001 Fan, SCP-A = **SCP-002 Fan Bush**.
- [x] 5.1 *(5 Nov: Fan Bush switched to Bought; warning and Manage box seen; bells on data; BP816 ₹2,167.42 unchanged. Starting prices: BP816 MRP ₹2,600.90, Fan ₹1,418.84, Fan Bush ₹58.13 each.)* **MB 0.2, then Part 1:** the switch, its warning, the bells.
- [x] 5.2 *(5 Nov: warnings seen on Product Master, quotation, and the new lead form (added). Order form hint and "sent quotation" history not seen: MB 4.3, 4.4. Estimate ₹100 on Fan Bush on data: Fan ₹1,502.58, BP816 ₹2,251.16, MRP ₹2,701.39, all marks cleared, as worked out. A real purchase setting a part's price (MB 3.5) was broken, fixed: [report](../make-or-buy-bought-part-price-fix-2026-11.md); Test Sensor ₹500 on data. MB 3.6, 3.7 still to see.)* **MB Part 3 and Part 4:** the price and "Price provisional".
- [x] 5.3 *(6 Nov. MB 3.6, 3.7 on data: back to Made BP816 ₹2,167.42, Bought again ₹2,251.16 on the kept ₹100 with no pending; bells named the change. MB 7.8 seen: build checklists asked, Design and BOM kept; on data Fan Bush Made, Released, BP816 ₹2,167.42, as it started. PR069 stays Pending after the switch to Made: the docs only cover open POs and build orders; dev only. Approval page seen: count, bar, Fan Bush row and banner, n/a chips, Approve disabled with the reason (MB 7.1–7.4 first half). Before Release, Fan × 1 ORD-2026-108: "No order raised for: Fan Bush short 2", no Fan Bush request on data, Fan Blade ORD-2026-109 built for it, PR068 is Bearings only (MB 8.1). After Incoming list, approve and Release: on data, flag cleared; Fan × 1 ORD-2026-110 raised PR069 Fan Bush × 2, no build order (MB 7.4, 7.5, 8.2). MB 7.7, 7.8, 8.3–8.5 not seen. An order raised before Release doesn't get a request afterwards: ORD-2026-108 stays short of 2 Fan Bush.)* **MB Part 7, Part 8:** re-approval and automatic orders.
- [x] 5.4 *(Counted from the test, your call on 6 Nov. Can't show on dev's open orders: SCJW-2026-003 and -004 aren't marked as delivering to a parent, and `coverNotReplaced` skips those. Suite `ga`, Gap 1 covers the rule, re-run passing: bought part → parent's count down, purchase request, held for the parent. Not seen in the browser.)* **A refused replacement:** with a Fan Bush order open, switch it to Bought, then reject pieces at its QC. No replacement order; the parent's Issue opens for those pieces and a purchase request appears.

---

## Test data used

| What | Number |
|---|---|
| BP816 sales order | ORD-0129 (PROD-2026-747791) |
| Fan order | ORD-2026-094 |
| Fan Blade order | ORD-2026-095 |
| Fan Bush job-work order | SCJW-2026-005 |
| PRO001 stock order | PROD-2026-449370 |
| Chamber order | ORD-2026-096 |
| Chamber frame order | ORD-2026-097 |
| Motor Mount order | ORD-2026-098 |
| Test Motor | PR058, MTEST-01 to MTEST-10 (sujeet, 12 months) |
| Test Sensor | PR063 |
| C channel | PR062 |

## Results log

| Date | Steps done | Issues found → fix |
|---|---|---|
| 2026-11-02 | Part 0 (0.2, 0.10, 0.11 still to tick); 2.1–2.5 pass | Change request didn't unlock a Machine BOM → fixed. Approved BOM edits kept approval → now pulled back. Child Part tab said "Stock Production" → fixed. Asked for: Approval filter, Incoming master list button moved, Vendor Master filters. |
| 2026-11-03 | 2.6, 2.7 pass | Dispatch's wait message named job-work orders not built for this order (SCJW-2026-003, -004 beside -005) → fixed. Don't finish -003 or -004 before 2.9: Dispatch's check counts total Fan Bush stock. Store's handover now warns, with a 3-second wait, when it takes stock held for an earlier order (your ask). 2.8 data right (Label carriers not yet looked at). 2.9 handover reset on request, to look again. Tool-A could go with no serial picked and nothing asked → warning on all 8 screens (your ask; steps 2.11, 3.3b). 2.9 and 2.11 pass: the box and countdown seen working, TLA0112 reads Used in ORD-2026-094, delivered on TRP-0033. Receiving back had no step, so 2.11a is added. 2.10 received and QC passed (TEST-01, TEST-02), transfer still to do. 2.11a pass. Bulk Transfer found out of date → parked ([doc](bulk-transfer-open-2026-11.md)), use the Transfer button. Material List offered Return on used material and showed the wrong label → fixed (your choice; step 2.11b). 2.10 and 2.12 pass: Fan on BP816's line 1 of 1, Fan stock unchanged, Fan order Completed, its reservations cleared as predicted. 2.11b passes: labels, both types before the step, Defect only during it (BP816's Fan row), Return gone after. 2.13 passes: TEST-01 and TEST-02 under ORD-0129, 6 months, not delivered yet, no Tool-A. Tool-A's warning box on Material Transfers seen (part of 3.3b). 2.14 passes: delivered 3 Nov, Registered Machines filled. Before 2.15: claims split across two pages → one place with both ways, tickets left alone (your call). 2.15 pass: VWC-0002 (TEST-01, Replaced 3★) and VWC-0003 (TEST-02, Repaired 4★), both carrying ORD-0129. Sujeet's score checked: claims half 85, Warranty 49.9 → 67.5, total 77 → 78, other parts unchanged. |
| 2026-11-04 | 1.1, 1.2, 1.3 pass | No issues. PR058: sujeet, PO-1793767518315-ANXGLNGMN, 12 months, MTEST-01 to MTEST-10 with cards, QC-2026-0269 passed all 10, Test Motor stock 10, Serial Numbers shows In stock. Test Sensor is on sujeet's and rahul's Products & Services; made parts aren't offered (checked in the list's rule, not on screen). 3.0 passes on data: PROD-2026-449370 for 2 → Chamber ORD-2026-096 reserves 1 frame, frame ORD-2026-097 for 3, Motor Mount ORD-2026-098 for 2. Reservations match the BOM. Low-stock PR061 (Test Motor × 10) came from its minimum stock of 10, not from this order. 3.1 passes (PR063, no build order). 3.2 passes: STEST01/STEST02 from sujeet, 12 months, QC approved (two rows Pass), both Issued to ORD-2026-096; the hard block and the ticked picker seen in screenshots. 3.3 passes on data: OSO-0027 (rahul vendor, welding), MTEST-01 and MTEST-02 Issued to ORD-2026-098, Test Motor stock 8. OSO-0027 received in full, so 3.4 moves to the replacement order's trip after 3.5. 3.5 passes: 1 passed, 1 scrapped; MTEST-02 Defective under SCP-008 and on Defective Inventory; replacement ORD-2026-099 for 1; Chamber's Mount line 1 of 2 delivered; Mount stock 0. 3.4 on OSO-0028: writing off the only piece was refused, with no way out → built: everything can be written off, the order closes with 0 made, and money above the bill goes to refund or credit (also for QC rejection and cancel, your ask). Browser check next. Found: PRO001 PROD-2026-449370 belongs to customer order ORD-0130, so it is not a stock order; steps 3.11–3.16 need a separate stock order (decide after 3.10). 3.4 passes: MTEST-03 Lost at rahul vendor (OSO-0028), ORD-2026-099 Completed with 0 made, replacement ORD-2026-100, bill ₹0, Test Motor 7 / 3 / 0 / 3 / free 4, TRP-0037 Done with its return job gone. 3.6 passes: Repair asked for the serial, MTEST-02 reads Repaired, Motor Mount stock 1, 1 waiting on Label carriers holding MTEST-02 (the ticked box itself is seen when Label it is opened). Your decision: Repair is internal work, meaning the part is repaired and its remaining steps are done, so no step check, only text on the dialog. 3.7 passes: ORD-2026-100 with MTEST-04 Completed, Chamber Mount line 2 of 2, Mount stock stays 1 (the repaired one), still 1 waiting on Label carriers, Test Motor 6 / 2 / 0 / 2 / free 4. Part 3B to run later (your call). Chamber frame ORD-2026-097 finished (OSO-0030, OSO-0031): 3 delivered, frame stock 4 all held for the Chamber. Store sent the 2,000 mm C channel leftover, so PR062 wasn't needed; no offcut was entered at receive (optional). 3.3b passes on Tool-A, as Test Motor has no plain pieces: box, Go ahead, row on Went without a serial (Tool-A, Material Transfers, 2 pieces, 0 picked, ORD-2026-096, test store head). 3.8 passes: mixed trip TRP-0041 (3 from Store, 1 from Production), ORD-2026-096 Completed, PRO001 Chamber line 2 of 2, Chamber stock 0, all reservation rows as predicted. Found before 3.9: repaired MTEST-02 is in the stocked Mount but still reads as inside the Chamber and customer order ORD-0130 → fixed ([report](serial-in-waiting-piece-2026-11.md)). 3.9 passes on screen: What's inside listed MTEST-01, MTEST-04, STEST01, STEST02 (no MTEST-02); Chamber row 1 of 1 delivered, from stock 1, 1/2 Requested (the return re-opens the request by itself, so no Issue button); 2 waiting on Label carriers, the Chamber with MTEST-01 and STEST01 ticked; Where it is reads in stock in the Chamber, STEST02 and MTEST-04 still reach ORD-0130. Sticker on stock, then an order (logic §7 case B, the core of Part 3B) passes on the returned Chamber: transfer refused ("Only 0 can go now"), labelled C-101, picker offered C-101, PRO001 row 2/2, MTEST-01 and STEST01 trace through C-101 to ORD-0130, MTEST-02 still in stock in the Mount. Still open in 3B: a low-stock build placing pieces on Label carriers, and a new order reserving a stickered part from stock. Also built: an Excess return of a part stays reserved for its order ([report](excess-return-held-for-order-2026-11.md)). |
| 2026-11-05 | 3.10 passes | No issues. Assemble still Pending throughout, so all 2 could go back as Defect. Return of MTEST-06: picker seen, row 2/2 "1 return pending", reservations unchanged at 4 / 2 / 2 / 0 / 4. Store accepted: Test Motor 4 / 2 / 1 / 1 / 3 seen on screen, MTEST-06 Defective, MTEST-05 still Issued, row 1/2 Requested by itself (dev data). Scrap: picker offered only MTEST-06, reads Scrapped on screen, Defective quantity 0, reservations unchanged. Replacement MTEST-07 issued to PROD-2026-449370: 3 / 2 / 2 / 0 / 3, row 2/2 Issued, checked on dev data only, no screenshot. Blank customer on a Defective serial read from the code, not seen on screen. Later on 5 Nov and on 6 Nov: Parts 3, 3B, 4 and 5 finished; see each step's note above. Found and fixed: Label carriers one entry per part, New Stock Order, QC for a machine sold from stock, a bought part's price. **Not seen on screen, counted from tests or code:** 3.12 on a machine, 3.16's refused number, 5.4, MB 7.6, MB 7.7, MB 8.3–8.5, the order form hint MB 4.4, the sent quotation MB 4.3, and 0.2 on the Machine and part forms. **Browser test finished 6 Nov.** PROD-2026-449370 finished for customer order ORD-0130 (pre painting on OSO-0033, sujeet), delivered 5 Nov. Customer Records seen: 2 Aata machines; Vendor parts lists MTEST-01 and STEST01 (in Chamber, sticker C-101), MTEST-04, MTEST-05, MTEST-07, STEST02, each with a Claim; no MTEST-02 (in stock in the Mount), MTEST-03 (Lost), MTEST-06 (Scrapped). Reservations on dev data as worked out: 7 items, 0 short, Test Motor row gone, Tool-A 15 / 3 / 2 / 1 / 14, NUT Bolts 1,320 / 22 / 0 / 22 / 1,298. 3.11–3.16 stay open: this order went to the customer, not stock. |

## Accepted, no change (6 November 2026)
**An order raised before a bought part is released gets no purchase request after Release** (ORD-2026-108, short of 2 Fan Bush). You accepted this because the order isn't blocked: it can be sent to outsource, do its in-house work and finish. The part can still be bought through Store's Purchase button on Material Transfers or the low-stock sweep, or built through New Stock Order if it's made.
