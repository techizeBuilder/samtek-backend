# Procurement (Purchase / Vendor) Redesign — Discussion Notes

Date: 2026-09-25 (current-flow research, first decisions, Vendor Master built)

**Status (2026-09-25):**
- The overall redesign is **not green-lit**. The client meeting didn't cover Purchase in any
  detail.
- Only the **Vendor Master** was cleared to build, and it has been built (§"Built so far"
  below). Its plain-language change report is `procurement-vendor-master-changes-2026-09.md`,
  and later changes in this initiative go there too.
- The client-facing proposal is the artifact "Procurement Redesign"
  (https://claude.ai/artifact/QkzhyN6vBZaJdX198B2voZ, v3). **Several of its statements are
  wrong against the code**; see "Corrections to the proposal artifact" below. It has not been
  updated yet.

**Update (2026-10-03):** the client meeting never produced usable Purchase detail and the
client declined to even look at the static preview
(`/accounts/purchases/vendor-batching-preview`). Decided: stop waiting on the client, keep
building modularly off our own judgment, and get feedback once there's something real to
react to. Vendor Master round 2 built on this basis — see "Confirmed decisions" and "Built
so far" below.

Related earlier work:
- `process-inhouse-outsource-redesign-discussion-2026-09.md`, section "Logistics / vendor
  requirement". The vendor system and a Logistics department were explicitly deferred out of
  that phase.
- `bom-hierarchy-redesign-build-2026-09.md` §19 (material reservation ledger).

## Background / Motivation

The client (Saket) brought an AI-assisted brief (Hindi/Hinglish chat) describing the Purchase
department they want. In short:

- **Automatic requirement:** the ERP raises purchase requests on its own from minimum stock and
  MOQ. This covers Sub Child Part, Child Part, Assembly item, Purchase Machine, Manufacturing
  Machine and Consumables.
- **Vendors:**
  - Vendor Master with vendors mapped to items, minimum 3 vendors per product.
  - A vendor-wise view, so everything due from one vendor can be bought in one go.
  - A vendor track record, and ERP recommendations based on it.
  - Past purchase prices shown for negotiation.
- **PO:** product, quantity, rate, GST, warranty, delivery date, transport cost and payment
  terms, all confirmed with the vendor before the PO is generated. PO approval by value.
- **Credit:** a credit limit and credit days per vendor, and a record of vendor delivery delays.
- **Accounts:** the moment a PO is created, Accounts gets the payment schedule from the PO's
  terms, with a reminder 2 days before each payment is due.
- **Receiving:** material is received, QC'd and only then stocked. A QC fail goes back to
  Purchase as a return.
- **Job work (outsourcing):** same vendor process, but material has to be physically sent out
  and brought back, by Purchase or by the Packaging & Logistics department.
- **Beyond the core flow:** receiving with short/excess/damaged qty, batch, vehicle and photos;
  3-way match (PO ↔ GRN ↔ bill); job-work reconciliation (sent vs finished vs scrap vs process
  loss); a task-based Purchase dashboard with risk alerts.

**Added by the user after the meeting (2026-09-25):**
- Vendor quotes must come in by **email, WhatsApp, and manual entry (after a call)**. The
  details are still fuzzy.
- The client gave little detail on the vendors they work with today.

## Terminology / gotchas

- **Vendor = the `Supplier` model** (`models/Supplier.js`). There is no Vendor model. The
  Vendor Master page is `pages/accounts/VendorMaster.jsx`, backed by `/api/suppliers`.
- **PR = `PurchaseRequest`, PO = the `Purchase` model** (`models/Purchase.js`).
- **Store receives on the PR, not the PO.** `pages/accounts/PurchaseRequest.jsx` serves both
  `/accounts/purchases/requests` (Purchase) and `/store/purchases/requests` (Store), by role.
- **The Purchase department lives under Accounts → Purchases** in the sidebar
  (`config/moduleRoutes.js`).
- **"Logistics" in client-speak = Packaging & Dispatch** (`/packaging-dispatch/...`), which is
  outbound-only today.
- **Child Parts / Sub Child Parts are never Purchasable.** The BOM creates them in-house with
  both Purchasable and Internal Manufacturing off. Their vendor need is outsourced job work.
- **A Process Template step is a plain name** (`ProcessCategoryOption.internalProcesses:
  [String]`, no ids). BOM steps store their own copy of the name, and only a BOM step records
  In-House vs Out Source.

## Current architecture — the purchase flow today (confirmed by code, 2026-09-25)

### 1. Where Purchase Requests come from

**Stock trigger** (`jobs/lowStockReorderCron.js`, `runLowStockReorderSweep`):
- Runs every 30 min (`index.js`).
- Picks every `purchase:true`, non-discontinued item with a Material Flow set and
  `qty <= minStock`, and raises a PR for its `reorderQty`.
- Fabrication items are checked per catalog dimension variant (`subStock <= minStock`).
- Created pre-approved (`source:'Store'`, `storeApproved:true`, `autoGenerated:true`).
- Dedup: one open automatic PR per item.

**Sales order form** (Leads):
- On Order Form submit (`orderFormController.js` → `autoCheckAllOrderItems`), Store checks each
  line.
- An out-of-stock, bought-in line ("Purchased (Trading Product)", from the item's
  `internalManufacturing` flag) gets a PR (`storeFlowService.js`, `applyStoreDecisionToItem`
  CASE 3).
- In-house lines go to Production instead.
- `getPurchaseRequests` also back-fills a PR for any sale item sitting at "Goes to Purchase"
  without one.

**Production cascade** (`services/materialAvailabilityService.js`, `raisePlainPurchaseRequest`
/ `raiseFabricationPurchaseRequest`):
- A Machine, Child Part or Sub Child Part order short of raw material raises order-scoped,
  pre-approved PRs.
- This is reservation-aware; see "Reservations vs minimum stock" below.

**Store, manual** (`/store/material-issues`, `StoreMaterialIssues` → `PendingRequestsTab.jsx`):
- Production shortfalls from a bulk transfer are "staged" (`StagedPurchase`,
  `inventoryController.js` `bulkTransferOrderMaterials`).
- Store turns them into PRs (`createBulkPurchaseRequests`); single PRs via
  `createPurchaseRequest`.

**QC exchange** (`purchaseExchangeController.js`):
- When a vendor accepts an exchange for rejected goods, a replacement PR is created already
  `Ordered` and linked to the same PO.

**Not PRs:**
- Sub Child Parts and Child Parts reorder every 30 min as **production orders**
  (`runSubChildPartOrderSweep`, `runChildPartReorderSweep`, both on raw `qty <= minStock`).
- A Sub Child Part whose first step is Out Source goes straight to Purchase's Outsource Work
  page.
- Manufactured Machines have **no** stock trigger; they're built only from sales orders (or a
  manual stock order).

### 2. Store approval gate

- A PR raised by Production or QC starts `storeApproved:false`. Purchase doesn't see it until
  Store approves it (`storeApproveRequest`) or rejects it (`storeRejectRequest`).
- PRs raised by Store go straight through.
- `checkInventoryForPR` lets Store check stock against a PR before deciding.

### 3. Purchase: RFQ → vendor bids → PO

**RFQ** (`rfqController.js` `createRFQ`):
- One RFQ per PR.
- Vendors are auto-matched by keyword-scoring the PR's product name and category against each
  vendor's free-text `vendorCategories`, or picked by hand.
- Each vendor gets a `VendorBid` with a 7-day token and an **email** link (`/vendor-bid/:token`).
- The PR becomes `Approved` once at least one email actually sends.

**Bids:** the vendor fills unit price, delivery days, warranty months and remarks
(`submitBidByToken`).

**Award** (`selectVendor`):
- Purchase picks the winner by hand. Bids are only sorted cheapest-first for display.
- Award creates the **PO** (`Purchase.create`, `status:'Draft'`) and an auto **Purchase
  Invoice** (`createAutoPurchaseInvoice`), and moves the PR to `Ordered`.

**Structure:** always **1 PR = 1 RFQ = 1 PO = 1 line**.
- The backend's manual multi-line `createPurchase` exists, but no button calls it.
  `PurchaseRequest.jsx` states "no manual Create PO — PO auto-generates via RFQ/Vendor
  Bidding".
- **This bidding path is the only way a PO gets created today.**

**Minimum vendors:** none enforced. An RFQ can go to a single vendor.

### 4. The PO (`models/Purchase.js`)

**Has:**
- supplier, `items[]` (with `receivedQuantity`/`pendingQuantity` per line)
- totals
- `expectedDeliveryDate` (required; set from the winning bid's delivery days)
- `actualDeliveryDate`, `deliveryAddress`
- `terms` — **one free-text string**, e.g. "Delivery within N days. Warranty: N months."
- `isApproved` / `approvedBy`
- status: Draft / Sent / Acknowledged / Partially Received / Received / Cancelled

**Doesn't have:** structured payment terms, advance %, credit days, freight/transport or GST
per line.

**Approval:** the `isApproved` flag exists, but no Accounts → Purchases screen sets it. There is
no approval by value.

### 5. Store receive (`purchaseRequestController.js`)

**Endpoints:** `updatePurchaseRequestStatus` → `Received`, or `receiveFabricationPurchase`
(per-dimension lines).

**The form captures:**
- serial number, warranty period and warranty card — **mandatory on every receive**, which is
  worth checking for raw material
- received qty + conversion factor, only when the item has a purchase-unit conversion

**Not captured:** short / excess / damaged qty, batch, vehicle, challan, photos.

**One-shot:** there is no partial receipt. The PO's own per-line partial receive
(`purchaseController.js` `receivePurchase`) exists but **has no frontend caller**.

**On receive:**
- the PR becomes `Received`
- the item's serial / warranty is updated
- a lead-time sample is recorded
- a QC job is created for **every** purchased item
- the invoice is created if it doesn't exist yet
- pricing is re-resolved

**Stock is not touched until QC Pass.**

### 6. QC (`qcController.js` `submitDecision`)

**Pass:**
- Stock is credited: `Item.qty`, or `dimensionVariants[].subStock` for fabrication items.
- For a machine or motor bought against a sale, only the surplus goes to stock. The rest
  stays dispatch-bound and updates the Sale item.

**Fail / partial reject:**
- Rejected qty and reason are recorded (`failReason` is required).
- The system auto-files a **Purchase Return** (reducing the invoice balance).
- It also creates a **Purchase Exchange**, emailing the vendor a one-click accept link.
  Accepting creates the replacement PR in Store's receive queue.

**Manual intake:** `/qc/inward` is a general QC-job entry point, not Purchase-specific.

### 7. Accounts

**Auto-invoice:**
- Items are copied from the PO, **GST is always 0**, and the due date is **fixed at 30 days**.
- Manual invoices also exist.
- There is **no 3-way match** anywhere.

**Update (2026-10-05, Fifteenth pass — `procurement-purchase-restructure-changes-2026-10.md`):**
the auto-invoice is now created at **PO-creation time**, not receive, and GST is real (computed
once at PO creation from the vendor's rate + each quote's inclusive/exclusive flag, copied
verbatim into the invoice) — "GST is always 0" no longer holds. Due date is now the vendor's own
Credit Days (Vendor Master), falling back to 30 only when a vendor has none set. **No 3-way
match still holds** — not touched.

**Vendor Payment:** applied oldest-invoice-first, and posted to the ledger.

**Update (2026-10-05, Fifteenth/Sixteenth pass):** no longer oldest-first-only — a payment can
now target one specific invoice (paid partially or fully) or several at once (must cover their
full balance, no partial split across a multi-select — see the Sixteenth pass for why), with
any remainder still falling through to the old oldest-first behavior. Every payment now records
which invoice(s) it actually paid down (`VendorPayment.allocations[]`), which didn't exist
before even for plain oldest-first payments.

**Payable Ageing:** buckets by **invoice date**, not due date.

**Reminders:**
- No payment schedule is derived from PO or vendor terms.
- The daily reminder cron (`paymentReminderController.js`) covers **customer** invoices only.
  It's a reusable pattern.

**Other pages:**
- Purchase Expenses: manual expense entries.
- Purchase Reports: totals and trends from invoices and returns.
- Purchase Inventory: a read-only view of Purchasable items, where Purchase can edit
  `purchaseCost`.

### 8. Packaging & Dispatch ("Logistics")

- **Outbound to customers only.** It already has vehicle, driver, transporter and
  expected/actual delivery fields on `DispatchOrder`.
- **Nothing inbound:** no vendor pickup, no transport for incoming purchases, no job-work
  movement.

### 9. Outsource Work (job work)

- The page `/accounts/purchases/sub-child-job-work` lists `SubChildPartJobWorkOrder` rows plus
  `ProductionOrder.outsourceHandoffs[]`, each with Send / Receive rounds.
- **No vendor is recorded** on either (model comment: "no vendor selection in this first
  pass"). Only the total cost is.
- Material sent vs leftover is captured on the completing receive. There is **no scrap vs
  process-loss split**.
- QC applies on the final receive. A job-work reject records qty + reason but creates **no
  return/rework document** (explicitly deferred).

### 10. Price history and vendor performance

**Price history:**
- `Item.purchaseCost` = the latest invoice price only.
- `getVendorPurchasedItems` gives a vendor's last price per item.
- No average rate, and no "last vendor" on the item.

**Vendor performance:**
- Only `Supplier.rating`, a manual 1–5 number.
- Lead time is tracked **per item, not per vendor** (`ItemLeadTimeStats`).
- A per-vendor delay could be computed from `Purchase.expectedDeliveryDate` vs
  `PurchaseRequest.receivedAt`, but nothing does it.

## Reservations vs minimum stock (corrected 2026-09-25)

The first draft of this research said the trigger ignores reservations. That's only half right:

- **Order-driven demand is reservation-aware.**
  - Machine / Child Part / Sub Child Part orders reserve their full need in the
    `MaterialReservation` ledger (`bom-hierarchy-redesign-build-2026-09.md` §19,
    `materialReservationService.js` `checkAndReserve`).
  - Shortfalls are measured against **free** stock (`getFreeQty` = qty − active reservations),
    and the PR or cascade order is raised for the shortfall.
- **The three minimum-stock sweeps are not.** Raw material, Child Part and Sub Child Part all
  compare **raw** `qty` to `minStock`. Their only "incoming" awareness is one open automatic PR
  per item.
- **Effect:** qty 10, Min Stock 5, 8 reserved gives free stock 2, below minimum, but no reorder
  until Store actually issues the 8. Orders never go short; the safety stock is just refilled
  late.
- **Fix if wanted:** make the sweeps compare `getFreeQty` instead of raw `qty`. Small change.
  Open question for the client.

## Client brief vs the system today

| Client asked for | Status today |
|---|---|
| Auto-PR from minimum stock / reorder qty | **Have**: raw qty ≤ min; reservation-aware only for order-driven demand |
| Manual requests from departments | **Have**: Store directly; Production/QC via Store approval |
| Vendor ↔ item mapping | **Built 2026-09-25**: Vendor Master Products / Services |
| Minimum 3 vendors, vendor recommendation, performance score | Missing |
| Vendor-wise view; one PO covering many items | Missing: 1 PR = 1 PO = 1 line |
| Past purchase price for negotiation | **Partial**: last price only |
| Quotes by email / WhatsApp / manual (call) | **Partial**: email link only |
| Landed cost, negotiation history | Missing |
| Full PO fields (payment terms, advance %, credit days, freight, transport) | **Have most of it now (2026-10-05)**: structured Payment Terms/Credit Limit/GST Rate on Vendor Master, real GST computed at PO creation, PO-scoped Charges (freight etc.), `transportBy` (Vendor/Company). Still missing: per-PO override of vendor-level payment terms |
| PO approval by value | Missing: flag exists, unused |
| Payment schedule + reminders to Accounts | **Partial (2026-10-05)**: invoice due date now derives from vendor Credit Days, and a payment can target a specific invoice with Advance % shown as a reference. No automated reminder cron yet — customer-side one is reusable |
| Credit limit / credit days per vendor | **Built 2026-10-03**: Credit Limit, Credit Days, Advance/Balance % on Vendor Master |
| Delivery tracking, vendor delay record | **Partial**: promised date on PO + received date on PR, never compared |
| GRN with short / excess / damaged, batch, vehicle, photos | Missing |
| QC before stock; return on reject | **Have**, including vendor exchange + replacement PR |
| 3-way match | Missing |
| Logistics for vendor pickups / job-work transport | Missing: Dispatch is outbound-only |
| Job work with vendor, scrap / process-loss reconciliation | **Partial**: rounds + leftover capture; no vendor, no split |
| Purchase dashboard / risk alerts | Missing |

## Corrections to the proposal artifact (not yet applied to it)

- **§01:**
  - The trigger is raw `qty ≤ minStock`. Reservations apply to order-driven demand only (see
    above).
  - Only Purchasable items get PRs. Sub Child Parts and Child Parts become production orders,
    and manufactured Machines have no stock trigger.
- **§02:**
  - A PR has **no required date, no purpose, no current-stock snapshot**.
  - Statuses are Pending → Approved (set when RFQ emails send) → Ordered → Received, plus
    Rejected.
  - The Store-approval gate for Production/QC PRs is missing from the artifact.
- **§03:**
  - "Filtered to Purchasable" can never include Sub Child Parts / Child Parts; their vendor
    need is Services.
  - "Stays live on rename" is false, because template steps are plain names.
- **§04:**
  - "Client ruled out vendor self-quoting" is **wrong**. The client wants email, WhatsApp
    **and** manual entry.
  - The bidding flow is not "kept, unused". It is the **only** path to a PO today.
- **§05:**
  - The PO already has an expected delivery date, a delivery address and free-text terms.
  - The approval flag exists but is unwired.
  - One line per PO.
- **§06:** no schedule exists; the invoice due date is a fixed 30 days. — **Partially resolved
  2026-10-05 (Fifteenth pass):** due date is now the vendor's own Credit Days, falling back to
  30 only when unset. A real Payment Schedule + Accounts reminders (the rest of §06) still
  doesn't exist.
- **§07:** Dispatch already has the vehicle/driver/transporter fields a pickup flow would need.
- **§08:**
  - Receiving is on the PR, one-shot, with serial/warranty mandatory. The PO's partial-receive
    code is unused.
  - The artifact **understated** the reject side: the vendor exchange email and replacement PR
    already exist.
- **§09:** confirmed, no 3-way match (still true, not touched); auto-invoices carrying GST 0 —
  **resolved 2026-10-05, Fifteenth pass**, see §7's own update above.
- **§10:** nothing per vendor exists; lead time is per item.
- **§11:** confirmed as written.

## Confirmed decisions

**2026-09-25, Vendor Master:**
1. **Product tab:** Items with Purchasable set, from Inventory, Product Master and Motor Master.
   Never Child Part / Sub Child Part. If a finished part ever has to be bought outright, a plain
   Inventory item is created for it.
2. **Services tab:** Process Template step names, matched **by name across all BOM levels** to
   BOM steps typed Out Source.
   - Linking a vendor to item + step (instead of step only) was discussed. Recommended and built:
     link by step name, and show each step's BOM usage in the picker ("Out Source in: Fan Blade,
     Chamber frame…").
   - A per-part restriction can be layered on later if the client needs it.
3. The old free-text Categories tags and the manual 1–5 rating **stay visible for now**. RFQ
   still scores vendors against the tags.
4. Payment Terms vs Credit Days / credit limit: **parked**. The user said "it should be
   dynamic"; the meaning was never clarified. **Resolved 2026-10-03, see below.**

**2026-09-25, quotes:**

5. Vendor quotes come by **email** (exists), **WhatsApp** and **manual entry after a call**
   (both new). All three should feed the same quote record and the existing
   "pick winner → PO" path:
   - **WhatsApp:** can reuse `services/whatsappService.js` (Meta Cloud API, `wa.me` fallback)
     to send the same bid link. Free text only works inside the vendor's 24-hour window;
     otherwise it needs an approved template or a manual send.
   - **Manual entry:** Purchase fills the `VendorBid` on the vendor's behalf, marked as entered
     by Purchase.

**2026-10-03, Vendor Master round 2 — resolving what round 1 parked:**

6. **Payment Terms, unparked.** "It should be dynamic" = real structured fields, not a
   richer free-text string: Advance %, Balance %, Credit Days, Payment Notes. The old
   free-text `paymentTerms` is removed outright (confirmed it was never shown anywhere in
   `VendorMaster.jsx` in the first place, so nothing downstream broke).
7. **Credit Limit, built as its own field** — separate from Credit Days, confirmed as "max
   ₹ this vendor can be owed at once" vs. Credit Days' "payment window." Warning-vs-hard-block
   behavior is still open (§"Open questions" item 6) — only the field exists so far, no
   enforcement anywhere yet (there's nowhere to enforce it until a PO/Payment Schedule screen
   exists).
8. **GST — vendor-level rate now, inclusive/exclusive toggle later.** No single rule for
   whether a vendor's quoted price includes GST — depends on the vendor. Decided: store a
   **GST Rate** on the vendor (new field, separate from `gstNumber`); the actual
   inclusive/exclusive choice is a **per-quote toggle**, deferred to whenever the Quotation
   screen (§04 of the original proposal) gets built. Confirmed the same GST Rate applies to
   **both Products and Job Work** — job work is a taxable service under GST, not exempt, so
   there's no reason for a separate mechanism.
9. **Purchase Charges — Products only, confirmed explicitly.** Job Work gets GST only, no
   charges list. A dynamic "+"-addable list (name, Flat ₹ / % of order, value) stored per
   vendor as defaults, applied/edited per quote later.
10. **Opening Balance (Dr/Cr) — removed.** Audited against the actual code (not assumed):
    `Supplier.openingBalance` was written on every save but read by nothing, anywhere,
    including the Vendor Payments page's own Outstanding Summary
    (`getVendorOutstanding`, `purchaseInvoiceController.js`), which sums
    `PurchaseInvoice.balanceAmount` only. Confirmed dead by the user ("just remove it as is
    not wired up and we dont know the purpose"). If real pre-ERP vendor debt ever needs to
    count toward Outstanding, that's new work on `getVendorOutstanding` itself, not this
    field.
11. **Rating, PAN, Alternate Phone, Bank Details — surfaced, not new.** All four already
    existed on `Supplier.js` from before this redesign touched it, but were never wired into
    `VendorMaster.jsx` at all (confirmed by grep — zero occurrences in the form). Added as
    real inputs now; Bank Details in particular was a genuine operational gap (no way to
    actually pay a vendor by NEFT/RTGS without it).

## Built so far

**Vendor Master: Products / Services (2026-09-25, not yet live-tested).**
- `Supplier.suppliedItems` (Item ids) + `Supplier.services` (step names).
- `GET /api/suppliers/catalog`, which returns Purchasable items plus template steps with their
  Out Source usage.
- A tabbed picker in `VendorMaster.jsx` (Products / Services / Tags), with names shown on the
  cards.
- Details: `procurement-vendor-master-changes-2026-09.md`.

**Vendor Master round 2 (2026-10-03, not yet live-tested).**
- Structured Payment Terms, Credit Limit, GST Rate, Purchase-only Charges — all new fields
  on `Supplier.js`.
- Rating/PAN/Alternate Phone/Bank Details wired into `VendorMaster.jsx` (existed on the
  model, had no UI before).
- Dead `openingBalance` field removed from schema, form and card.
- Details: `procurement-vendor-master-changes-2026-09.md` §2.

**Purchase department restructure (2026-10, not yet live-tested) — PR → Quote → Batched PO.**
The big next phase: Purchase split from Job Work into tabs on one page (sidebar now "Purchase
& Outsource"), PRs/By Item/By Vendor built for real, RFQ+VendorBid's self-service bidding
flow superseded by direct Email/Manual quoting (WhatsApp has no inbound capture, so it's
covered by Manual), and `Purchase` genuinely batches several PRs into one PO now
(`purchaseRequests[]`, reusing the dormant `createPurchase`). RFQ Management/Vendor Bids/the
static preview are NOT removed yet — staying until this is live-verified. Since then (still not
live-tested): real Vendor Charges (Item/PO-scoped, transport-charge exclusion), Active POs/Order
History split with per-item receive tracking, the receive redesign (conditional warranty,
unit-conversion fix, batch context) wired into a computed Vendor Rating system, and — most
recently (2026-10-05) — the Purchase Invoice moved to PO-creation time with real GST, and
targeted (single or multi-invoice-full) payment allocation replacing oldest-first-only — and, most recently (2026-10-06, Eighteenth
pass), the item-wise PR consolidation described in the section below: By Item now combines by
ITEM (one card summing every open PR's need for it, explicit selection, a new `ItemQuoteGroup`
model), not by individual PR. Full plan and build report: `procurement-purchase-restructure-changes-2026-10.md`.

## Open questions for the client

1. **Quote fields:** is price / delivery days / warranty enough, or do they want freight, GST,
   payment terms and validity per quote (landed-cost comparison)? GST specifically now has a
   vendor-level rate to pull from (2026-10-03) — the open part is just the quote-level
   inclusive/exclusive toggle's exact UI, not built yet.
2. **Vendor-wise buying:** may one PO cover several items / PRs from the same vendor? Is a
   vendor-wise view of pending PRs wanted (their brief says yes)?
3. **PO approval:** needed, and at what ₹ thresholds?
4. **Payment terms at the PO level:** the vendor-level Advance %/Balance %/Credit Days built
   2026-10-03 are *defaults* — whether a PO can override them per order is still open and
   unbuilt. **Partially connected since 2026-10-05 (Fifteenth pass):** Credit Days now drives
   the auto-invoice's real due date, and Advance % now shows as a reference hint (not enforced)
   when recording a payment against a PO-linked invoice — first real uses of either field. The
   actual Payment Schedule + Accounts reminders (§06 of the original proposal) are still unbuilt.
5. **Minimum stock vs reservations:** protect Min Stock against reserved quantity, or keep
   today's raw-qty behaviour?
6. **Credit limit:** warning or hard block? The field exists (2026-10-03) and a **soft warning**
   already exists — By Vendor's own credit-exposure insight badge, shown while batching a PO,
   since that tab was first built. That exposure figure got more accurate on 2026-10-05 (it now
   includes in-flight, not-yet-received POs too, since invoices exist from PO-creation time, not
   just receive). Still open: whether to ever make it a hard block instead of just a warning.
7. **Vendor performance score:** advisory only, or ever restrictive?
8. **Logistics:** does Packaging & Dispatch take over vendor pickups and job-work movement?
   (Already raised and deferred in the in-house/outsource discussion.)
9. **Receiving:** keep receiving on the PR, or move it to PO lines? Moving it is needed for
   partial receipt, short/damaged tracking, 3-way match and vendor delay.

## Known issues found during this research (not fixed)

- **`supplierRoutes.js` route order:** `/suppliers/stats` and `/suppliers/export` are
  registered after `/suppliers/:id`, so they are likely handled as a vendor id and fail. The new
  `/suppliers/catalog` is registered before `:id` and is unaffected.
- **Process Templates typo:** "pre panting" (Child Part) vs "pre painting" (Machine). Services
  match by name, so these are two different services.
- **Serial number / warranty mandatory at receive** for every item, including raw material.
  Confirm this is intended. — **Resolved 2026-10-05 (Fourteenth pass):** warranty is now
  conditional on whether the vendor actually quoted one (`VendorBid.warrantyMonths`, carried
  through to the receive step); Serial Number stays mandatory (asset tracking, not a warranty
  concern).
- **Auto-created purchase invoices carry GST 0.** — **Resolved 2026-10-05 (Fifteenth pass):**
  GST is now computed for real at PO creation and copied verbatim into the invoice.
- **Unused code paths:** manual multi-line `createPurchase` (no button) and the PO-level
  partial `receivePurchase` (no caller). Both are candidates for reuse rather than rebuild.

## Suggested direction (not agreed, for discussion)

1. **Quote channels first:** add WhatsApp + manual entry onto the existing `VendorBid` / RFQ
   flow. It keeps the only working PO path and adds what the client asked for.
2. **Then the PO side:** structured terms (payment / advance / credit days / freight), optional
   multi-item / vendor-wise POs (reuse `createPurchase`), and approval by value if wanted.
3. **Then receiving on PO lines** (reuse `receivePurchase`), which unlocks partial receipt,
   short/damaged, 3-way match and vendor delay (`expectedDeliveryDate` vs actual).
4. **Accounts payment schedule + reminders**, modelled on the customer reminder cron.
5. **Logistics and job-work vendor / scrap reconciliation**: the largest piece, last, once the
   client confirms the department split.

## Item-wise consolidation — a real gap in By Item, clarified 2026-10-05

**This is a clarification of original intent, not something written down anywhere before now.**
The discussion doc above and the client brief only ever describe **vendor-wise** consolidation
("everything due from one vendor bought in one go," line 39/306 above) — which By Vendor tab
does correctly. The user's actual reasoning for this whole redesign also includes a second,
separate kind of consolidation that was never written down until this conversation:

> "a PR and PO are different things — this is the whole reason we're redesigning Purchase. In
> the old system we bought per-PR: 3 PRs for the same item meant 3 separate purchases. In real
> life, if your brother, mother and dad all ask you to buy the same thing, you don't go to the
> market three times — you combine the requests and go once." (paraphrased from the live
> conversation, 2026-10-05)

So **By Item is supposed to show one combined entry per item**, summing every open PR's need for
that item into one computed total, before Purchase ever quotes anyone — not one card per PR (what
got built). Purchase can then deliberately quote/order **less** than that combined total — this
is intentional, not a bug: Purchase has a budget across many items, not infinite money for one.

**Confirmed wrong in the current build, checked directly against the code (not assumed):**
1. `ByItemTab.jsx` groups nothing — `pageRequests.map(pr => <ItemComparisonCard pr={pr} />)` is
   one card per `PurchaseRequest._id`. Three PRs for "ms round bar" show as three separate
   cards, each quoted independently, with no combined total anywhere.
2. **The data model can't represent it even if grouping were fixed.** `VendorBid.purchaseRequest`
   and `Purchase.items[].purchaseRequest` are both singular refs — one quote/one PO line can only
   ever point at exactly one PR. There's nowhere to record "this one combined quote covers PR-A +
   PR-B + part of PR-C."
3. **No allocation rule exists for under-covering.** If three PRs need 2+1+3 = 6 combined and
   Purchase deliberately orders enough for only 4, something has to decide which PR(s) count as
   now covered (→ `Ordered`) and which stay open for a future round — nothing like this exists.
   Today a PR is a hard binary: `Ordered`/`Received` means "fully resolved," full stop. If a
   single PR's own quote quantity is under-typed today (already possible — the Order Quantity
   field has zero validation against the PR's own resolved need), the shortfall is **silently
   lost**: the PR still flips straight to `Ordered` then `Received`, nothing re-raises a request
   for the difference, and no future view (PRs tab, By Item, the auto-reorder sweep) ever shows
   that this item is still actually short.

**Not yet designed — three things that need solving together, not separately:**
- **Grouping:** how PRs get grouped into one combined item view (presumably the same
  name/code match `resolveMasterItemId` already uses elsewhere in this redesign).
- **Data model:** how a quote/order line references *several* PRs at once — `VendorBid`/
  `Purchase.items[]`'s `purchaseRequest` singular ref needs to become plural, or some other
  shape, and `Purchase.purchaseRequests[]` (the PO-level list, already plural) would need to stay
  consistent with whatever a single line now means.
- **Allocation rule for under-covering:** candidate directions discussed, none chosen yet —
  (a) FIFO-style, oldest/smallest PR first, cleanly closing whichever PRs the ordered quantity
  reaches and leaving the rest untouched; (b) explicit PR-selection checkboxes within the
  combined item view (same UI pattern By Vendor's own batching already uses), so Purchase
  directly picks which PRs this round covers rather than the system inferring it from a number;
  (c) a real "Partially Ordered"/"Partially Received" status added to `PurchaseRequest` with an
  explicit remaining-quantity field, instead of either (a) or (b) inferring coverage from
  PR boundaries.

**Built 2026-10-06 (Eighteenth pass).** Resolved by the user across several rounds of discussion
into the design actually built: explicit PR selection (option (b) from the three candidates
above) via a new `ItemQuoteGroup` model — one per item, holding the current selection and a
quantity that's always a free, manually-overridable sum, refreshed whenever the selection changes
and frozen only once a PO is created. Selection is a binary commitment (every selected PR counts
as processed the moment a PO is created, regardless of how much was actually ordered — the
candidate allocation rules (a) FIFO and (c) a new PR status were both superseded by this, not
combined with it). Full design and build detail: `procurement-purchase-restructure-changes-2026-10.md`'s
Eighteenth pass — this is the fullest write-up, read that first for anything touching By Item,
quoting, or batching going forward.

Full build history for everything else (Vendor Charges, By Vendor batching + Active POs/Order
History, the receive redesign + computed Vendor Rating system, Invoice-at-PO-creation + targeted
payment allocation, and now this item-wise consolidation) is in
`procurement-purchase-restructure-changes-2026-10.md` (eighteen dated passes as of 2026-10-06).
