# Serial numbers and warranty — receive, vendor warranty, customer warranty, claims

- **Date:** 2026-10-12
- **Status:** §7 answered by the user on 2026-10-13.
  - **Part 1 built 2026-10-13** (change report §28): serial records at receive, QC ticks rejected
    serials, the Store "Serial Numbers" tab. Not yet clicked through in the browser.
  - **Part 2 built 2026-10-13** (change report §29): vendor warranty claims on Complaints →
    Support. Not yet clicked through in the browser.
  - **Next:** the vendor score (weighted) uses the claims (§8).
- **Why it matters:** the vendor score's **Warranty 10%** (blueprint §11: warranty duration, claim
  response time, claim resolution) can't be scored until claims exist. The vendor score itself is
  the next task (§8).

---

## 1. The problem (found 2026-10-12)

**Where:** Store → Purchases → To Receive (`/store/purchases/requests`) → Receive.

- **One serial number per PO line.** Store enters a single serial for the whole line, however many
  pieces arrived. 10 generators = 1 serial.
- **The serial is copied onto the item master.** At receive, `applyReceiveSideEffects`
  (`controllers/purchaseRequestController.js`):
  - sets `Item.serialNumber` and `Item.warranty.period` to what was just received
  - replaces `Item.warranty.cardUrl`, **deleting the previous warranty card file**

  Every new receipt wipes the last one from the item. The purchase requests keep their own copy
  (`PurchaseRequest.serialNumber / warrantyPeriod / warrantyCardUrl`), but it's still one per line.
- **The same field drives the customer warranty** (see §2). `Item.warranty.period` is also read for
  the customer's warranty months, so receiving a purchased item silently changes the warranty
  Samtek gives customers on that product.
- **No serial per unit.** We can't tell which physical unit came from which vendor / PO, when its
  warranty runs out, or which one QC rejected.
- **No warranty-claim record.** Nothing records "this unit failed under warranty, the vendor was
  told on X, answered on Y, and repaired / replaced / refused".

Background on how receive got this way: `docs/procurement-purchase-restructure-changes-2026-10.md`
(one receive per PO line; serial + warranty collected once per line) and
`docs/procurement-redesign-discussion-2026-09.md` (serial stays mandatory "for asset tracking";
warranty only asked when the vendor quoted one, from `VendorBid.warrantyMonths`).

## 2. How customer warranty works today (checked 2026-10-12)

- **Our serial:** every machine sent to a customer has a **DispatchOrder** (one per unit), with
  **our** serial number (generated at Packaging, `packagingDispatchController`).
- **When the clock starts:** when Dispatch marks it **"Reached Safely"** (Dispatch → Delivery
  Confirmation; the delivered list at `/dispatch/completed`),
  `controllers/ServiceDispatchController.js` sets:
  - `warrantyExpiryDate` = delivery date + **`Item.warranty.period`** months of that product (12
    if the item has none)
  - `amcExpiryDate` = warranty end + 12 months, when the order has an AMC charge
- **What Complaints shows:** Complaints → Support (`/complaints/support`,
  `controllers/ComplaintServiceController.js`) looks the customer up, lists their machines from
  those DispatchOrders, and shows "Active until …" / "Expired" per serial.
- **The user's point:** a machine can sit in our store for 6 months before a customer buys it, so
  warranty must start **when the customer gets it**, not when we received it. That's already how
  the customer warranty works.

## 3. Decisions so far (user, 2026-10-12)

1. **One serial per piece for items the vendor quoted a warranty on.** Each is unique per item.
   Items with no warranty keep **one serial / lot number per receipt**, as today.
2. **The serial / lot number stays mandatory** at receive.
3. **When QC rejects part of a serialised item, QC ticks which serials** failed.
4. **Store gets a new "Serial Numbers" tab.** Complaints → Support gets a **"Vendor Warranty
   Claim"** button.
5. **Part 1 first** (receive + serial records + Store tab + QC picking serials), Part 2 (claims)
   after.
6. **This is about items we buy and sell.** The warranty clock **starts as it does today**: when
   the customer gets the unit ("Reached Safely", §2), not at our receive date. *(Confirmed
   2026-10-13.)*
7. **Receive stops writing serial / warranty onto the item master.** The old item fields are left
   as they are for history.
8. **Where the warranty months come from (confirmed 2026-10-13):**
   - **A purchased item:** its serial record (the vendor's warranty months, §4.1), found by the
     serial in the claim pop-up (§5).
   - **Everything else** (anything with no serial record): the item's own warranty
     (`Item.warranty.period`), as today.
   - **The customer warranty at "Reached Safely" is not changed.** It reads the item's warranty,
     as today.
10. **No link to Packaging for now** (user, 2026-10-13). The goal is the vendor score, and the
    manual claim entry is enough for it. Linking "which vendor unit went to which customer" at
    Packaging is built only if the client asks for it (§4.3).
9. **The vendor warranty claim is a button beside "+ Create Ticket"** on Complaints → Support. It
   is entered by hand, takes the serial from the customer, and records how the vendor handled the
   claim, including our satisfaction with it (§5). *(Confirmed 2026-10-13.)*

## 4. Part 1 — serial records at receive (built 2026-10-13, change report §28)

**As built, differences from the proposal below:**
- **Warranty cards (user, 2026-10-13):** one card for all the pieces, **or** one for each piece.
  Uploading 2 or more means every piece needs its own.
- **"Counted in pieces"** means a stock unit of Pieces / pcs / nos / units / set.
- **Fabrication receive** is unchanged (no serial).
- **Record statuses:** In QC → Accepted / Part rejected (a lot) / QC rejected. There's no separate
  "Returned to vendor": the row shows its REJ and that rejection's status.

### 4.1 A record per physical unit
New collection, e.g. `PurchasedUnit` (working name), one document per unit received:

| Field | Meaning |
|---|---|
| `companyId`, `item`, `itemName` | what it is |
| `vendor`, `purchaseOrder`, `lineId`, `purchaseRequest`, `qcJob` | where it came from |
| `serialNumber` | the vendor's serial on the unit (or the lot no. for a no-warranty receipt) |
| `isLot`, `lotQty` | a lot / batch record (no warranty, or bought by weight / length) and how much it covers |
| `receivedAt` | Store's receive date |
| `vendorWarrantyMonths` | what the vendor quoted (`VendorBid.warrantyMonths` → PO line → request) |
| `warrantyCardUrl` | per unit, or one shared for the receipt |
| `status` | Received → Accepted (QC pass), or QC-rejected → Returned to vendor / Replaced |
| `qc` | Accepted / Rejected, and the rejection it belongs to (`PurchaseRejection`) |

*No dispatch / customer fields and no warranty start date: there's no Packaging link for now (§3.10, §4.3).*

Unique index: company + item + serial (lots exempt).

### 4.2 The receive step
Store → To Receive → Receive (`LineReceiveDialog`, `LineFabricationReceiveDialog`; backend
`receiveLineItems` / `receiveLineFabrication`):

| Item | What Store enters |
|---|---|
| **Vendor quoted a warranty, counted in pieces** | **One serial per piece.** The count = the received quantity in the stock unit. To avoid typing hundreds: paste a list (one per line), or "prefix + from–to" (e.g. GEN-0101 … 0110). Duplicates refused. Warranty card: one for all, or one per unit. |
| **No warranty** | **One serial / lot number for the receipt** (mandatory, as today) → one lot record. |
| **Warranty, but bought by weight / length** (kg, m) | One lot number (it can't be split into pieces) → one lot record. |

- **Lines with several requests:** units are shared out to each request by the same split the
  receive already uses (ordered share), so each request's QC job knows its own units.
- **Item master:** no longer written (§3.7). A purchased unit's vendor warranty months live on its
  own serial record (§3.8).
- **Old receipts:** the requests keep their single serial. No migration is needed unless wanted.

### 4.3 Linking a unit to the customer — NOT built now (user, 2026-10-13)
The goal is the vendor score, and the manual claim entry (§5) gives us that. The customer warranty
stays exactly as today: it starts at "Reached Safely", with the item's months. What follows is
kept as notes **in case the client asks** for "which vendor unit went to which customer".

- **How a bought machine reaches Packaging** (checked in the code 2026-10-13):
  1. **Bought for a customer's order:** PO → receive → QC pass → straight into the Packaging queue,
     never into stock. The packaging job already points to that purchase's QC job
     (`packagingDispatchController.getPackagingQueue`).
  2. **Sold from stock** (the "6 months in our store" case): Store marks the sale item "Available"
     → stock goes down → a Store QC job → Packaging (`storeFlowService`, CASE 1). Nothing records
     which physical unit left the shelf today.

- **If it's ever built:** at Packaging, each unit's job gets its vendor serial, picked from a short
  list (that QC job's units, or the item's in-stock units). That links unit ↔ PackagingJob ↔
  DispatchOrder. "Reached Safely" (`ServiceDispatchController.computeWarrantyAndAmc`) could then
  start the unit's warranty and take its months from the serial record.
- **Components inside our own machines** (e.g. a motor) would need a similar step at Production
  issue.

### 4.4 QC
- For a serialised item, QC's **reject quantity** becomes **tick the serials** that failed
  (`QCInspection.jsx` decision panel; `qcController.submitDecision`).
- Rejected units → status QC-rejected, linked to the `PurchaseRejection` (change report §24).
  - **A replacement** brings new units with new serials (on the same PO line).
  - **Refund / credit / refused:** the units become "Returned to vendor" (or stay with us for a
    refusal).

### 4.5 Store → "Serial Numbers" tab
- Search by serial / item / vendor / PO.
- Each row: item, vendor, PO, received date, status, **vendor warranty months**, the warranty card,
  and its claims (once Part 2 exists).

## 5. Part 2 — vendor warranty claims (built 2026-10-13, change report §29)

**As built:**
- **The button:** "Vendor Warranty Claims" opens one pop-up for both raising and resolving: the
  list, "New claim", and each claim's detail.
- **Status:** Waiting for vendor → Vendor responded → Closed.
- **Closing a claim** needs the outcome, the resolved date and our satisfaction (1–5 ★).
- **Finding the unit:** by the vendor serial on the unit. When it isn't in our records, the vendor
  + item are picked by hand.
- **Shown elsewhere:** the numbers appear on Vendor Ratings and Serial Numbers. They aren't in the
  rating number yet.

The proposal:
- **Where:** Complaints → Support (`/complaints/support`, `TicketWorkspace.tsx`), a **"Vendor
  Warranty Claim"** button **beside "+ Create Ticket"** → pop-up. It's a manual entry, not tied to a
  ticket.
- **Finding the unit:** type the **vendor serial** the customer reads off the unit, or the part.
  - **Found in the serial records** (§4.1): it shows the item, vendor, PO, received date and the
    vendor's warranty months.
  - **Not found** (an older receipt or an item without a serial record): pick the item and vendor
    by hand. The months fall back to the item's own warranty.
  - **Whether it's covered:** whoever enters the claim marks it, from the vendor's answer. With no
    Packaging link (§4.3), the system can't work it out on its own.
- **What the claim records** (blueprint §11, §18–19):
  - the problem, defect category and severity, evidence
  - date reported to the vendor, date they responded
  - outcome: **repaired / replaced / credit / refused / not covered**
  - date resolved, cost to us, notes
  - **our satisfaction with how the vendor handled it** (a rating + comment)
- **What it feeds:** the vendor score's warranty part:
  - duration: months quoted vs other vendors for the item
  - response time: days told → responded
  - resolution: share resolved, refusals counting against them
- **Optional:** a "Warranty Claims" list in Purchase for following up with vendors.

## 6. Related facts in the code
- **Warranty at receive is conditional** on the vendor having quoted one: `warrantyMonths` flows
  `VendorBid` → PO line → `PurchaseRequest.warrantyMonths` (fourteenth pass, 2026-10-05).
- **The vendor's invoice no. / date / scan** is already recorded at receive, per request
  (change report §25).
- **QC partial rejections** are recorded as quantities only (`QCJob.partialRejections`). There's no
  serial today.
- **Packaging generates our serials** with a prefix and checks they're unique per company
  (`PackagingJob`, unique index company + serialNumber).
- **Complaint tickets** store `machine.serialNumber`, `machine.warrantyStatus` and
  `machine.amcStatus` as text at ticket creation.

## 7. Answered (user, 2026-10-13)
1. **When the warranty starts:** as today, at customer delivery ("Reached Safely"), with the item's
   months. Unchanged. **No Packaging link for now**: the manual claim is enough for the vendor
   score (§3.10, §4.3).
2. **Where the months come from:**
   - **a purchased unit:** its serial record (the vendor's months)
   - **everything else:** the item's own warranty
3. **The claim button:** beside "+ Create Ticket", entered by hand, with the vendor's handling
   rated (§5).

## 8. Where this sits in the remaining work (updated 2026-10-13)
- **Built 2026-10-13:**
  - Part 1 (§28) and Part 2 (§29)
  - then the vendor score (§30): Warranty 10 uses the quoted months + these claims; technical
    pass / fail was dropped
  - the purchaser score (§31)
  - the Purchase Dashboard (§32)
- **The purchase flow is complete.** Next: browser testing (T1–T40), then the outsource flow.
- **Parked by the user ("keep them for now"):**
  - "due in 3 days / tomorrow" notifications
  - return freight (RT2)
  - return challan (RT4)
- **Not built (user):** QC quarantine stock, budgets, separation of duties.
- **Linking a unit to the customer** at Packaging / Production: only if the client asks (§4.3).
