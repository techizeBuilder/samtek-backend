# What changed — Purchase department restructure (PR → Quote → Batched PO)

Plain-language change report for the plan in `procurement-redesign-discussion-2026-09.md`'s
2026-10 section. Built, checked with `node --check`/`esbuild`, **not yet tried live in the
browser** — same convention as every other pass in this initiative.

---

## 1. One page, Purchase split from Job Work

**Where:** Accounts → Purchases → **"Purchase & Outsource"** (was "Outsource Work",
`/accounts/purchases/sub-child-job-work`, same URL).

**How it works now:** Two tabs. **Out Source Work** is the exact same screen as before,
untouched — Job Work is deferred, not redesigned, just moved under a tab. **Purchase** is new,
with its own three tabs: **PRs**, **By Item**, **By Vendor**.

The old standalone **Purchase Request** sidebar entry is gone — PRs now live inside the PRs
tab. Store's own "Purchase Orders" page (`/store/purchases/requests`) is the exact same
underlying screen and is completely untouched; only Purchase's sidebar link to it was removed.

**RFQ Management, Vendor Bids and Vendor Batching (Preview) are still in the sidebar** —
deliberately not removed yet. They get retired once the new flow below is proven to fully
replace them, not before.

---

## 2. PRs tab

**Where:** Purchase & Outsource → Purchase → PRs.

Lists every purchase request with a live **quote status** — No Quotes / N Quotes / In Batch
PO — computed from the real quote data below, not a new stored field. Clicking the info icon
next to a product shows its **R&D Specifications** (technical requirements, warranty) — the
same information RFQ Management used to show, moved here since RFQ Management is on its way
out.

---

## 3. By Item tab — quoting

**Where:** Purchase & Outsource → Purchase → By Item.

Every purchase request not yet on a PO, expandable to show its quote history and add a new
one. Two channels:
- **Email** — sends the same token-link invite the old RFQ flow used (vendor fills a public
  form, no login). Reused as-is, just pointed directly at the PR instead of through an RFQ.
- **Manual** — Purchase types the rate/delivery days/warranty/remarks in directly. This is
  also what WhatsApp quotes go through: WhatsApp has no automated way to read a reply out of a
  chat, so sending the ask can use WhatsApp, but the vendor's actual price always gets typed in
  by hand — functionally identical to a phone call, just a different label on the record.

Whichever quote was entered most recently (by either channel) is marked **Active** — not the
cheapest, not whichever channel, just the latest, since that's what actually reflects the most
recent conversation with the vendor. Cheapest-price and fastest-delivery among a PR's quotes
are also highlighted (carried forward from the old Vendor Bids screen).

---

## 4. By Vendor tab — real batching

**Where:** Purchase & Outsource → Purchase → By Vendor.

This is the piece the static preview (`vendor-batching-preview`) only ever mocked — its own
"Consolidate into one PO" button had no click handler at all. Now it's real: expand a vendor,
see every quote marked active for them across all their un-ordered PRs, tick which ones to
combine, and **Consolidate** creates one real multi-line Purchase Order covering all of them.

Every included PR gets linked to that one PO and flips to Ordered — same as before, just N
times instead of once. Insight badges shown while picking: **free-freight threshold** (new
Vendor Master field, see §5) and **credit exposure** (this vendor's current outstanding, from
the existing Vendor Payments calculation, plus this batch, against their Credit Limit).
**Not built**: a delivery-date-clustering badge — `PurchaseRequest` has no required-by-date
field to cluster on at all, confirmed absent, not a thinner version of something real.

---

## 5. Vendor Master — one more field

**Free Freight Above (₹)** — same pattern as last round's Credit Limit/GST Rate. Powers §4's
insight badge; optional, no behavior changes if left blank.

---

## 6. Backend — what actually changed underneath

- **`Purchase.purchaseRequest` (one) → `purchaseRequests[]` (many)** — a PO can now be a real
  batch. `createPurchase`, `updatePurchase`, `sendPOToVendor`, and the legacy `selectVendor`
  all updated to loop. Found and fixed along the way: the old code resolved a PR's
  purchase-unit type off `items[0]` for every PR in a request — harmless when there was only
  ever one PR, a real bug for a batch where each PR can be a different line. Now each PR is
  matched to its own line.
- **`createAutoPurchaseInvoice` re-keyed from "once per PR" to "once per PO"** — the old
  version, called once per PR, would have copied an entire batched PO's line items into every
  one of those PRs' own invoices once batching existed — N duplicates of every line for an
  N-PR batch. Found before it ever shipped, not after.
- **Quotes reuse `VendorBid`**, extended with a direct `purchaseRequest` link and a
  `source: Email|Manual` field, rather than a new model — it already had every field a quote
  needs (rate, delivery days, warranty, remarks, the working token-link mechanism). The old
  `rfq` link is now optional; existing RFQ-flow records are untouched.
- **Two places that queried `RFQ` directly, fixed to not need it**: Production's own
  material-shortage ETA lookup, and the lock that stops editing a fabrication PR's dimensions
  once it's been quoted (now checks for any quote, old RFQ-path or new, not just an RFQ).
- New endpoints: `GET/POST /api/purchase-requests/:id/quotes`, `GET
  /api/suppliers/:id/batchable-quotes`. Batch PO creation itself reuses the existing `POST
  /api/accounts/purchases/orders` — no new endpoint needed, it already accepted multi-line
  `items[]`, just never had a frontend caller before.

---

## Known gaps, honestly

- **Not live-tested against the real database or in a browser** — verified by `node --check`
  (backend) and `esbuild` (frontend) only, consistent with every other pass in this project
  when no browser automation is available.
- **By Item's vendor picker filters to vendors whose Vendor Master "Products" list includes
  the item** (reusing last round's `suppliedItems[]`), falling back to showing every vendor if
  none match — so a vendor not yet mapped in Vendor Master won't silently disappear from the
  picker, just won't be filtered smartly yet.
- **A quote can only be batched if its PR's product name/code resolves to a real Inventory
  item** (same resolution `getPurchaseRequests` already does for R&D specs) — if it doesn't,
  the By Vendor tab refuses to batch that line with a clear message rather than sending bad
  data to the backend.
- Old `RFQ`/legacy-shaped `VendorBid` records are untouched and still readable — nothing here
  deletes history, only stops the old flow from being the only path forward.

## Not done yet — Slice 6 (deliberately deferred)

Retiring RFQ Management, Vendor Bids, and the Vendor Batching Preview page — waiting until PRs/
By Item/By Vendor are live-verified end to end, per the plan.

---

## Correction pass (2026-10, same day) — a real quantity-unit bug, caught before live testing

The user compared the build against the actual static preview UI and caught a real bug: the
first version of quote creation used `pr.purchaseQuantity || pr.quantity` as the quote's
quantity. Both were wrong. `purchaseQuantity` doesn't exist on a PR until a PO is created — it's
written *at* that point, not before, so it was always null at quote time. `pr.quantity` is the
base/storage-unit quantity, not what the vendor is actually quoted on when an item has a
separate **Purchase Unit** (`Item.purchaseUnit` — e.g. bought by the kg, stocked by the piece;
confirmed against `PurchaseRequest.jsx`'s own `itemPurchaseUnit`/`poQuantity` logic, the exact
pattern this should have copied from the start).

**Fixed properly, not reverted:**
- `VendorBid` (the quote record) now stores its own `purchaseUnit`/`purchaseUnitType` alongside
  `quantity` — a quote is self-describing about what unit its quantity/rate are in, so later
  steps never have to re-resolve the source Item again.
- `createQuote` now resolves the PR's real Inventory Item (same name/code match
  `getPurchaseRequests` already does) and, when it has a Purchase Unit, **requires** Purchase to
  enter the purchase-unit quantity explicitly — for both Email and Manual, since even sending a
  vendor an email invite needs to say how much is being asked for, in their unit.
- `createPurchase`'s PR-sync (`purchaseQuantity`/`purchaseUnit`/`purchaseUnitType` written back
  onto each PR) now reads these **per line item**, not from one shared top-level value — a
  batch's PRs can each use a different Purchase Unit, so a single shared value was never going
  to be correct once batching was real.
- By Item's quote form shows the Purchase Qty input (labelled with the real unit) exactly when
  `PurchaseRequest.jsx`'s own form would; By Vendor's batch payload carries each line's own
  purchase-unit fields through from its quote.

**Also from this pass:**
- By Item's expand-to-quote UI reworked to match the static preview's actual two-step flow
  (click a channel button, then a small inline form) instead of the first version's
  all-in-one dropdown form.
- Dropped the "Open Draft PO" insight badge from By Vendor, and confirmed no below-N-vendors
  warning exists anywhere in this build — both per explicit instruction, matching what the
  original static proposal's §04 actually says should NOT be built.
## Fourth pass (2026-10, same day) — a 4th tab, "Vendor Ratings"

Closes the "Price history" gap flagged in the very first procurement research pass (§04 of the
original proposal: "last purchase rate, average rate... shown alongside quotes" — never built)
and adds a real vendor rating, replacing the old manual 1–5 field with something computed.

**Vendor rating — computed, not typed.** Two signals, confirmed with the user to keep simple (a
plain average, no weighting — data volumes don't call for more yet):
- On-time delivery: `PurchaseRequest.receivedAt` vs. its PO's `expectedDeliveryDate` (not
  `Purchase.actualDeliveryDate`/`Purchase.status` — traced those and confirmed they're dead,
  never set by the real receive flow; the real timestamps live on the PR).
- QC outcome: `QCJob.decision` (`Pass`/`Fail`), linked back to its vendor via
  `purchaseRequestId → purchaseOrder → supplier`.

Each on-time delivery or QC Pass scores 5, each late delivery or Fail scores 1; the rating is
the plain average of every such event. Computed two ways: **item-wise** (scoped to one
vendor+item) and **overall** (every item pooled together for that vendor) — both live, not
cached, in a new `services/vendorRatingService.js`.

**Deliberately NOT a replacement of the old manual `Supplier.rating` field everywhere it's
used** (RFQ vendor-matching, the legacy Suppliers page, Vendor Bids comparison all keep reading
it unchanged) — this is a parallel, new system. The one place it visibly changes: **Vendor
Master no longer shows or edits rating at all** — removed from both the card and the form,
per explicit instruction, since it now lives in its own place.

**New tab: "Vendor Ratings"** (4th, alongside PRs/By Item/By Vendor). Top level lists every
vendor with their computed overall rating; expanding one shows every item they supply with its
own item-wise rating plus **Avg Price / Last Price / Lowest Price** — all three computed from
real `PurchaseInvoice` history for that specific vendor+item, not the quote system (which is
forward-looking estimates, not what was actually paid).

**Also added**: the below-3-vendor-on-file warning on By Item (§04 of the original proposal) —
this was wrongly dropped in an earlier pass by conflating it with the unrelated "Open Draft PO"
badge removal from By Vendor; they're two different features in two different places.

New endpoints: `GET /api/suppliers/vendor-ratings` (overview list), `GET
/api/suppliers/:id/item-breakdown` (one vendor's item-wise rating + pricing).

---

## Second correction pass (2026-10, same day) — vendor-picker bug, GST toggle, UI rework

Live screenshots caught a real bug: By Item's "Add Quote" let Purchase pick **any** vendor from
a flat dropdown, not just vendors Vendor Master actually links to that item (e.g. a PR for "MS
Round Bar" showed every vendor in the company, not just the 2 Vendor Master actually has it
linked to). Root cause was the client-side filter silently falling back to "show everyone"
whenever it found zero matches — exactly the kind of fallback that hides a real problem instead
of surfacing it.

**Fixed at the root, not patched over:**
- New `GET /api/purchase-requests/:id/eligible-vendors` — resolves the PR's real Inventory item
  server-side and returns **only** vendors with that item on their Vendor Master Products list
  (`Supplier.suppliedItems`), each already carrying their own latest quote for this PR if one
  exists. No more client-side array matching, no silent "show everyone" fallback — if the item
  can't be matched, or zero vendors are linked, the UI says exactly that instead of guessing.
- By Item's card now shows a **plain vendor list** (one "Quote" button per vendor, like the
  static preview's own vendor-list shape) instead of a vendor-picker dropdown — clicking Quote
  opens a small inline form already scoped to that vendor, no re-selecting who it's for.

**GST toggle, added where rates actually get entered:**
- `VendorBid` now has `gstInclusive` — whether the stored rate already includes GST. This isn't
  a single company-wide setting; it's decided by whoever actually types the rate in.
- **Manual entry** (Purchase's own form): a "Rate already includes GST" checkbox right next to
  the rate field.
- **Email** (the vendor's own public bid-submission page, `/vendor-bid/:token` —
  `VendorBidForm.jsx`): same checkbox, since for an email-sourced quote it's the *vendor*, not
  Purchase, who knows whether their number includes GST. Purchase's own "send request" step
  has nothing to toggle — no rate exists yet at that point.
- Not touched: invoice-level GST math. `createAutoPurchaseInvoice` still hardcodes
  `gstAmount: 0` — a pre-existing gap flagged in the very first procurement research doc
  ("Auto-created purchase invoices carry GST 0"), not something this pass's scope extended to.
  The toggle captures intent at the quote; applying it through to real invoice tax math is
  separate, bigger work for whenever that's wanted.

## Third correction pass (2026-10, same day) — quantity/unit labeling, traced against all 4 real PR-creation paths

Live screenshots caught a second real bug: a PR for 2×8mm×254mm round bar showed "Need 0.2
Centimeter" in By Item, but the real RFQ page showed "2 Pieces" for the same request. Both
numbers were real — I was just reading the wrong fields.

**Root cause**: for a fabrication item, `PurchaseRequest.quantity` is not a piece count — it's
the already-**resolved weight** (0.2 kg checks out exactly for 2 pieces of that round bar at
steel density), computed by whichever flow created the PR. I was labeling it with
`Item.unit` (the Used Unit, "Centimeter") instead of `PurchaseRequest.unit` (the field the
creating flow actually set — "Kilogram" here) — two completely different fields.

**Traced all 4 real PR-creation paths** (low-stock cron, the Machine/Child Part/Sub Child Part
shortfall cascade, Order Form submit, Store's bulk material-transfer page) to confirm what
`quantity`/`unit` actually mean in each, rather than assume one rule covers all of them:

| Creation path | `unit` stores |
|---|---|
| Low-stock reorder cron (plain + fabrication) | Purchase Unit (or resolved Mass Unit) |
| Cascade from a Machine/Child Part/Sub Child Part shortfall | Purchase Unit (or resolved Mass Unit) |
| Order Form submit (trading product) | **Nothing — `unit` is never set, stays null** |
| Store's bulk material-transfer page | The BOM line's **Used/storage Unit**, not Purchase Unit |

**Fixed per your rule — two screens, two different jobs:**
- **PRs tab**: shows `pr.quantity pr.unit`, exactly as the request was created — no
  reinterpretation, no fabrication-piece-count substitution. Honest about the two paths above
  that don't store a Purchase Unit (shows whatever's actually there, including nothing for
  Order Form PRs).
- **By Item tab**: needs the Purchase Unit specifically, since that's what a vendor quotes
  against. For a fabrication PR, pre-fills by calling `previewFabricationTotal` — the exact
  same side-effect-free endpoint `FabricationRFQDialog.jsx` already uses for this, so the
  number is computed from live geometry, not guessed or re-typed from memory. For a PR whose
  stored `unit` already *is* the item's Purchase Unit (the two cron/cascade paths), pre-fills
  directly from `pr.quantity`. For the two paths with no reliable stored Purchase-Unit quantity
  (Order Form, Store transfer), leaves it blank with the required unit clearly labeled —
  Purchase enters it, same as `PurchaseRequest.jsx`'s own PO form already requires in that
  situation. Every pre-fill stays editable regardless of source.
- Card header also now shows the real piece-count + dimension breakdown for fabrication PRs
  (matching RFQManagement.jsx's own proven display), instead of the bare resolved-weight number
  with a meaningless unit label.

**Correction to the correction (same day)**: got PRs vs. By Item backwards on the first pass.
"The unit the request was created with" means the natural, human quantity — piece-count for a
fabrication PR, exactly matching `RFQManagement.jsx`'s own Qty column
(`fabricationPieceCount(...)` when dimension lines exist, `pr.quantity`/`pr.unit` otherwise) —
not the raw stored `quantity`/`unit` fields, which for a fabrication PR hold the *resolved
weight*, not a piece count. PRs tab fixed to match. Also added a persistent "Order Quantity
(Kilogram)" label above By Item's quantity input (it only had a placeholder before, which
disappears the moment a value is pre-filled — leaving no unit visible at all), matching the
real Finalize & Send RFQ dialog's own labeling.

- **Pagination, added to all three, two different ways:** PRs uses real server-side pagination
  (`getPurchaseRequests` already supports `page`/`limit` — just wired up). By Item and By Vendor
  use client-side pagination instead (fetch up to 500/200, then page through in the browser) —
  both are "batchable" views the backend computes freshly from live quote/PR state rather than a
  flat list, so there's no natural `page`/`limit` to push down to a query without more backend
  work; client-side paging was the pragmatic call for now given how large either list is likely
  to get in practice (By Vendor is bounded by vendor count; By Item by open PRs, both modest).
  Worth moving to real server-side paging later if either list grows large enough to matter.

---

## Fifth pass (2026-10, same day) — colorful UI pass

The new Purchase pages were visually flat (plain slate/grey text and `variant="outline"`
buttons everywhere) compared to both the old app's pages and the static preview mockup. No
functional change in this pass — purely visual, reusing color patterns already established
elsewhere in this codebase (stat-card icon chips, gradient primary buttons, colored badges)
rather than inventing a new style.

- **`PurchaseOutsourceHub.jsx`:** page now has a light slate gradient background
  (`from-slate-50 to-slate-100`) and a real header — a blue `ShoppingCart` icon, "Purchase &
  Outsource" title, and a one-line subtitle — instead of starting straight into the tab bar.
- **`PurchaseRequestsTab.jsx`:** added a 3-card stat row above the table (No Quotes Yet / Quoted
  / In Batch PO), each a colored icon chip + count, computed live from the same quote-count data
  the table itself already loads — no new endpoint. The per-row "Quote" button is now the
  standard blue-to-purple gradient primary button instead of a plain outline button.
- **`ByItemTab.jsx`:** the Email/Manual channel-picker buttons are now tinted (blue for Email,
  violet for Manual) instead of identical plain outlines, so the two channels read as distinct
  choices at a glance. The quote-submit button and each row's "Quote" button are now the same
  gradient primary style. Each item card's header now has a small blue `Package` icon chip
  next to the product name, matching the icon-chip pattern used throughout the rest of the app.
- **`ByVendorTab.jsx`:** each vendor card now has an indigo `Store` icon chip next to the vendor
  name. The "Consolidate ... into one PO" button is now the gradient primary style.
- **`VendorRatingsTab.jsx`:** each vendor row now has an amber `Award` icon chip next to the
  vendor name (stars were already amber — this just extends the same accent to the row itself).

Verified with `esbuild` on each touched file individually, then a full bundle of
`PurchaseOutsourceHub.jsx` (pulling in the whole Purchase tab tree) to confirm nothing broke
across files. Not yet tried live in the browser — same standing caveat as every other pass.

---

## Sixth pass (2026-10-05) — "Vendor not found" quote bug, and real Vendor Charges

**Bug fix — every quote (Email and Manual) was failing with "Vendor not found".** Caught live
by the user: the By Item quote form's `createQuote` (`purchaseQuoteController.js`) looked the
vendor up with `Supplier.findOne({ _id: vendorId, companyId })`. `Supplier` has no `companyId`
field at all anywhere in this codebase — it's scoped by `unit`, confirmed by grepping every
other `Supplier.find`/`findOne` call in the project (`supplierController.js`,
`rfqController.js`, even this same file's own `getEligibleVendorsForPR` a few lines below).
So that query always returned null. Fixed to `Supplier.findOne({ _id: vendorId, unit: { $in:
[unit, 'Main'] } })`, matching the pattern used everywhere else.

**Vendor Charges — real design, replacing the placeholder from the second pass.** The Charges
list on Vendor Master (built in the Vendor Master round-2 pass) existed as fields on the vendor
but was never actually applied anywhere — no quote or PO used it. Design worked out with the
user:

- Each charge now declares its own **scope**: `Item` (decided per quote, e.g. a small per-line
  handling fee) or `PO` (decided per batch, e.g. freight billed on the whole consolidated
  shipment) — a property of the charge itself, not a vendor-wide rule, since the same vendor
  could bill one charge per item and another per shipment.
- Each charge can optionally have a **`freeAboveAmount`** — the charge is waived once the
  relevant **raw goods value** (that quote's own qty × rate for an Item charge, the whole
  batch's summed qty × rate for a PO charge — always *before* any charges or tax, confirmed
  explicitly by the user) reaches that amount. This replaces the old standalone
  `Supplier.freightFreeThreshold` field entirely — there's no reason only a charge literally
  named "Freight" can have a waiver, and matching by name was fragile (a vendor might call it
  "Shipping" or "Transport"). The old field, and its unused "Free Freight Above" input on
  Vendor Master, are both gone.
- **Decided once, never recalculated.** An Item-scoped charge is computed the moment a quote's
  rate is actually known — immediately for a Manual quote (`purchaseQuoteController.js
  createQuote`), or once the vendor submits a rate for an Email quote
  (`rfqController.js submitBidByToken`, which previously didn't touch charges at all). A
  PO-scoped charge is computed once, at batch-PO creation (`purchaseController.js
  createPurchase`), against that batch's raw total. Confirmed explicitly: once a quote is
  created, later batching it into a PO never revisits or re-prices it — the quote's own charges
  (and the new PO-scoped charges found at batch time) just get carried forward and summed into
  the PO's `grandTotal`.
- One shared implementation (`services/vendorChargesService.js`, `computeVendorCharges(vendor,
  scope, rawValue)`) used by all three call sites, so the actual math only exists once.
  `ByVendorTab.jsx` also has its own client-side mirror of the same logic
  (`previewCharges`) purely so Purchase can see the PO-scoped charges *before* committing to a
  batch — the server's own computation at creation time is what's actually stored, the preview
  is never authoritative.

**Where it shows up:**
- `Supplier.js` — `charges[]` rows gained `scope` and `freeAboveAmount`; `freightFreeThreshold`
  removed.
- `VendorBid.js` — gained `itemCharges[]` + `itemChargesTotal`.
- `Purchase.js` — each `items[]` line gained `itemCharges[]`/`itemChargesTotal` (carried
  verbatim from its quote); the PO itself gained `poCharges[]`/`poChargesTotal` (computed
  fresh); `grandTotal` is now `totalAmount + taxAmount + poChargesTotal +
  sum(items[].itemChargesTotal)`.
- `VendorMaster.jsx` — each charge row now has a "Applies per Item (each quote) / PO (whole
  batch)" selector and an optional "Free above ₹" input.
- `ByItemTab.jsx` — a quote with charges now shows `+₹X charges` in its line.
- `ByVendorTab.jsx` — the old (always-empty-in-practice) free-freight badge is replaced with a
  real per-charge insight badge (applied amount, or "waived — free above ₹X"); credit exposure
  now uses the real grand total (goods + item charges + PO charges) instead of raw goods value;
  each line shows its own item-charges total; the Consolidate button's total is the real grand
  total.

**Known gap, not fixed in this pass:** `createAutoPurchaseInvoice`
(`purchaseInvoiceController.js`) still derives its own invoice subtotal from `po.items[]`
qty × rate only — it already ignored `Purchase.taxAmount`/`grandTotal` before this pass (GST is
hardcoded to 0 there, a pre-existing gap, not something this pass introduced), so it now also
doesn't reflect `itemCharges`/`poCharges`. The PO itself has the correct, complete `grandTotal`;
the auto-generated invoice just doesn't inherit it yet. Flagging for whenever invoicing is next
touched — out of scope for this charges pass.

Verified with `node --check` (backend, all touched files) and `esbuild` (frontend, all touched
files + a full bundle of `PurchaseOutsourceHub.jsx`). Not yet tried live in the browser.

---

## Seventh pass (2026-10-05) — search and filters across all four Purchase tabs

None of the four tabs had anything beyond PRs' own single free-text search box (and even that
only matched product name / PR id). User's ask: search PRs by item code too, and look for
whatever else search/filtering is actually missing across the tabs.

- **PRs tab (`PurchaseRequestsTab.jsx`):**
  - Search now also matches **item code** — `materialCode` (the real item-code field on a PR)
    and `itemId` (also code-like on several creation paths; this same controller's own
    master-item lookup already matched `{ code: pr.itemId }`, so it was clearly intended as a
    code field, just never exposed to search). Backend change, `purchaseRequestController.js`.
  - Added **Status, Department, Priority** dropdown filters — real stored fields, filtered
    server-side via new `?department=`/`?priority=` query params (same pattern the existing
    `?status=` already used), so pagination/totals stay correct rather than only reflecting
    whatever's on the current page.
  - The existing No Quotes Yet / Quoted / In Batch PO stat cards are now **clickable quick
    filters** on quote status. Caveat, called out in a code comment: quote status is computed,
    not stored, so this can only filter what's already loaded on the current page — same
    "pragmatic for now" tradeoff already made for By Item/By Vendor's client-side pagination,
    not a new one.
  - "Clear filters" appears once anything is active.
- **By Item tab (`ByItemTab.jsx`):** search (product / PR id / item code) plus Priority and
  Department filters, plus a "Fabrication only" toggle — all client-side, since this tab already
  loads up to 500 PRs into memory before its own client-side pagination (unchanged from the
  pagination pass).
- **By Vendor tab (`ByVendorTab.jsx`):** search by vendor name/code, plus a coverage filter
  (Supplies Products / Does Services) — same client-side pattern, this tab already loads up to
  200 vendors into memory.
  - **Correction, same day:** the filter first shipped against `Supplier.supplierType` (Raw
    Material/Services/Equipment/Consumables). Caught by the user: that field is never actually
    exposed anywhere in the Vendor Master form (confirmed by grep — zero occurrences), only
    ever set by seed data, so every real vendor just sits at its schema default and the filter
    would have been meaningless on live data. Vendor Master's real distinction is coverage —
    `Supplier.suppliedItems[]` (Products tab) and `Supplier.services[]` (Services tab) — so the
    filter now checks those arrays directly instead (inclusive, not exclusive: a vendor who does
    both shows under either option).
- **Vendor Ratings tab (`VendorRatingsTab.jsx`):** search by vendor name, a "Rated vendors only"
  toggle (hides vendors with no delivery/QC history yet — `rating: null`), and a sort control
  (Rating High→Low, default; Low→High; Name A→Z) — the first real way to surface best/worst
  performing vendors on this page, not just an alphabetical or creation-order list. Unrated
  vendors always sort to the bottom regardless of rating-sort direction, since there's nothing
  to rank them by.

Not added, deliberately: a "has batchable quotes" filter on By Vendor and a quote-status filter
on By Item — both would need an extra fetch per row (batchable-quotes / eligible-vendors) just
to power a filter, which doesn't exist today and wasn't asked for; flagging as a possible later
addition if it turns out to matter in practice, not building it speculatively now.

Verified with `node --check` (backend) and `esbuild` (frontend, each touched file plus a full
bundle of `PurchaseOutsourceHub.jsx`). Not yet tried live in the browser.

**Correction, same day:** search could already match item code, but the code itself was never
actually shown anywhere — caught by the user. Added a **Code** column to the PRs table
(`PurchaseRequestsTab.jsx`) and the same code shown inline next to the product name on each By
Item card (`ByItemTab.jsx`) — both read `pr.item?.code` (the resolved real Inventory item's
code, already attached to every PR by `getPurchaseRequests`) first, falling back to
`pr.materialCode` (the PR's own stored code) when the item couldn't be resolved against
Inventory. `pr.itemId` deliberately isn't used for display, only for search — it's a free-text
field that holds a real code on some creation paths but something else entirely (e.g. a sale's
invoice number) on others, confirmed earlier in this project, so it's reliable enough to search
against but not to show as "the code."

---

## Eighth pass (2026-10-05) — Purchase Order history (a created PO had nowhere to be seen)

Caught by the user, working through the tabs: By Vendor's "Consolidate into one PO" button
created a real `Purchase` document, but there was genuinely nowhere in the new Purchase pages to
ever see it afterward — not the PO just created, not any PO ever created. PRs/By Item/By Vendor
all deliberately drop a request the moment it's ordered (see the Sixth/Seventh pass notes on
that), which is correct for "what's still actionable," but left a real gap: nothing showed what
happened *after*.

**`ByVendorTab.jsx` is now two sub-tabs**, not one flat page:
- **Batch Vendors** — the existing vendor-card batching UI, unchanged, just renamed from the
  page's sole content into `BatchVendors()`.
- **Order History** (new, `PurchaseOrderHistory()`) — every PO ever created, Draft through
  Received/Cancelled, with search (by PO number) and a Status filter. Reuses the existing `GET
  /api/accounts/purchases/orders` (`getPurchases`, already paginated, already used by Accounts'
  own Purchase Orders screens) — no new backend endpoint needed. Each row expands to show its
  line items, PO-scoped charges (waived/applied, from the Sixth pass), and a goods + tax +
  charges = grand total breakdown.
- **Handoff between the two:** `VendorCard`'s `createBatchPO` now returns the created PO from
  the API response and calls a new `onPOCreated` prop. `ByVendorTab` (now just a thin Tabs
  wrapper holding which sub-tab is active) uses that to switch to Order History and
  auto-expand the just-created PO, so Purchase actually sees it land instead of having to go
  find it.

No backend changes were needed — `getPurchases` and its route already existed and were already
reachable from this exact tab (confirmed: `VendorCard`'s own credit-exposure lookup already
calls the sibling `/api/accounts/purchases/outstanding` endpoint under the identical role gate,
so the same gate on `/purchases/orders` was already proven to work here).

Verified with `esbuild` on `ByVendorTab.jsx` and a full bundle of `PurchaseOutsourceHub.jsx`.
Not yet tried live in the browser.

---

## Ninth pass (2026-10-05) — Department filter was never going to work; replaced with "Raised By"

Caught by the user before it shipped anywhere real: the Department filter added to PRs and By
Item in the Seventh pass (`requestFromDepartment`) was built against a field that's useless on
real data. Grepped every `PurchaseRequest.create()` call in the codebase to confirm: the
low-stock sweep cron, the BOM-shortfall cascade (Machine/Child Part/Sub Child Part), Order
Form's direct-purchase routing, and Store's own Material Transfer bulk submit — the four real
paths the user named — **all hardcode `requestFromDepartment: 'Store'`**. The only exception is
the QC vendor-exchange replacement flow (`'QC'`). So the filter (and the Department column
showing it) would have shown "Store" for nearly every request regardless of what actually
raised it — not a bug in the filter logic, a dead field.

**Replaced with a real classification, `raisedBy`** (`classifyRaisedBy` in
`purchaseRequestController.js`), computed from the fields each path actually sets distinctly —
not from any field meant to describe this, just the honest fingerprint of what each creator
leaves behind:
- **Auto Reorder (Low Stock)** — `autoGenerated: true` + `reorderItemId` set (the cron).
- **Production Shortfall** — `autoGenerated: true` + `storeOrderId` set, no `reorderItemId`
  (the cascade).
- **Sales Order** — `saleItemId` set (Order Form's direct-purchase routing).
- **Manual (Store Transfer)** — none of the above (Material Transfer's bulk submit sets neither
  flag).
- **QC Exchange/Return** — `source === 'QC'`, checked *first*, since the vendor-exchange
  replacement PR copies `storeOrderId`/`saleItemId` from the original PR it's replacing and
  would otherwise be misclassified as whatever that original PR was.

`getPurchaseRequests` now attaches `pr.raisedBy` to every row it returns (cheap — pure field
reads, no extra query) and accepts `?raisedBy=` (comma list, same pattern as `?status=`) as a
real server-side filter, applied before pagination — same spot the search filter already lived,
replacing the dead `?department=` filter added last pass. `PurchaseRequestsTab.jsx`'s
Department column and filter are now **Raised By**, driving off a shared `RAISED_BY_META`
label/color map (exported from that file). `ByItemTab.jsx`'s Department filter is now the same
Raised By filter (client-side, reading the same `pr.raisedBy` the backend already attaches to
every row it loads) and each item card now shows the badge inline next to the product name,
imported from `PurchaseRequestsTab.jsx` rather than duplicated.

Verified with `node --check` (backend) and `esbuild` (frontend, both touched files plus a full
bundle of `PurchaseOutsourceHub.jsx`). Not yet tried live in the browser.

---

## Tenth pass (2026-10-05) — page URL renamed

`/accounts/purchases/sub-child-job-work` was flagged by the user as misleading — a leftover from
when this page was only the old single "Outsource Work" screen, from before the Purchase
restructure gave it two real tabs (Purchase, Out Source Work). Renamed to
**`/accounts/purchases/purchase-outsource`** in `App.jsx` (route) and `config/moduleRoutes.js`
(sidebar link).

While in `NotificationBell.jsx` updating its one deep-link to this page, found and fixed an
adjacent, already-broken link: its generic `type === 'purchase'` fallback pointed at
`/accounts/purchases/requests`, a route that no longer exists — removed in an earlier Purchase
restructure pass (Slice 2) when the standalone Purchase-side PR page was retired in favor of the
PRs tab inside this same hub. Both now point at the new `/accounts/purchases/purchase-outsource`
URL, which lands on the Purchase tab's PRs sub-tab (its default view).

The backend API routes under `/api/purchase/sub-child-job-work/...`
(`SubChildJobWork.jsx`'s own data calls) are untouched — only the page's own URL changed, not
its API.

Verified with `esbuild` on all four touched files. Not yet tried live in the browser.

---

## Eleventh pass (2026-10-05) — per-line totals, and item charges applying to the wrong items

**Per-line totals, shown from a screenshot.** By Item's vendor row and By Vendor's batch line
both showed rate/qty/charges separately but never the actual line total — only the batch's
grand total appeared, at the very end, in By Vendor. Both now show a computed `= ₹X` (qty ×
rate + item charges) inline, same math `PurchaseOrderHistory`'s expanded row already used.

**Item-scoped charges were applying to every product a vendor sells, not just the one being
quoted — a real design gap, not a bug in the charges math itself.**
`computeVendorCharges(vendor, 'Item', rawValue)` pulled every Item-scope charge on the vendor
unconditionally; a "Loading charge" meant for bulky sheet metal was being applied the same way
to a quote for small bolts from the same vendor. Two fixes were discussed — scope it in Vendor
Master (a real default, matching how GST/Charges already work: vendor-level default, not
something re-decided from scratch every quote) vs. let Purchase pick which charges apply at
quote time. Went with Vendor Master scoping, since the quote-time option doesn't fix the actual
defect — the default would still be wrong every time, just with an extra manual step layered on
top.

- **`Supplier.js`**: each charge row gains `appliesToItems: [ObjectId]` (ref `Item`) —
  meaningful for Item-scope charges only (ignored for PO-scope, which bills the whole batch, not
  one item). Empty/absent = applies to every product this vendor supplies, the original
  behavior, so nothing already set up silently narrows.
- **`vendorChargesService.js`**: `computeVendorCharges` gains a 4th argument, `itemObjectId` —
  an Item-scope charge with `appliesToItems` set only counts when `itemObjectId` is in that
  list. If the charge IS item-scoped but the item couldn't be resolved, it's excluded rather
  than guessed — same "honest absence over a wrong default" rule as `getEligibleVendorsForPR`'s
  unresolved-item handling.
- Both quote-creation paths now pass the real Item id through: `createQuote` (Manual) already
  had `masterItemId` resolved for the Purchase Unit check, just wired through one more argument.
  `submitBidByToken` (Email) didn't have it at all — now populates `purchaseRequest` on the bid
  and resolves it the same way (`resolveMasterItemId`, newly exported from
  `purchaseQuoteController.js` so it's one implementation, not two). A legacy RFQ-linked bid
  (`bid.purchaseRequest` null) gets no item-scoped charges at all, rather than a guess — this
  item-scoping only applies to the new direct-quote system going forward, consistent with how
  `itemCharges`/GST-inclusive already work.
- **`supplierController.js`**: `cleanVendorCoverage` sanitizes `appliesToItems` the same
  defensive way as `suppliedItems` (valid ObjectIds only, deduped), and drops it entirely for a
  PO-scope charge rather than storing a field that'd be silently ignored.
- **`VendorMaster.jsx`**: an Item-scope charge row now shows "Applies to: every product this
  vendor supplies" by default, with a checklist of the vendor's own currently-selected products
  (reusing the Products tab's own selection, not a new picker) to narrow it. A PO-scope charge
  row doesn't get this control at all.

Verified with `node --check` (backend, all 5 touched files) and `esbuild` (frontend,
`VendorMaster.jsx` plus a full bundle of `PurchaseOutsourceHub.jsx`). Not yet tried live in the
browser.

**Known follow-up, not built in this pass:** Purchase still can't see or override which charges
apply *before* submitting a Manual quote — they only show up after the quote already exists.
Flagged earlier as a separate gap from this one; still open.

---

## Twelfth pass (2026-10-05) — By Vendor split into Batch / Active / Order History

Design discussion: a vendor can have several items quoted but Purchase only pulls some of them
into a PO at a time — the rest stay in the quote state, batchable later. The old flat "Order
History" (Eleventh... Eighth pass) listed every PO regardless of status, with no way to tell
"still has items outstanding" from "fully done." Confirmed design: **Active POs** = still has at
least one item outstanding; **Order History** = every linked PurchaseRequest is Received (or the
PO was Cancelled) — a PO moves itself from one to the other automatically as receiving happens,
nothing manual.

**Confirmed along the way: the credit-limit warning the client's static preview page has is
already present** in `ByVendorTab.jsx`, byte-for-byte the same logic (≥70% warn, ≥100% bad, same
wording) — built in the original slice, nothing was missing.

**A real blocker found while building this, not a design nicety:** `Purchase.status` never
actually transitions for the new quote→batch flow. The only code that ever wrote
`'Received'`/`'Partially Received'` was the old RFQ-era `receivePurchase` endpoint
(`POST /purchases/orders/:id/receive`) — the new flow receives entirely on the
PurchaseRequest itself and never touches the PO's own `status` at all. Left as-is, every PO made
through By Vendor batching would sit at its creation-time default (`'Draft'`) forever — stuck in
Active POs permanently, never reaching Order History no matter how much actually got received.
User's call: this is legacy/dev-data territory, don't preserve backward compatibility with it,
just fix the new flow properly.

- **`Purchase.js`**: each `items[]` line gains `purchaseRequest` (ObjectId ref) — which PR this
  line came from. Not previously stored (only sent in the batch-creation payload and discarded);
  `createPurchase` now saves it.
- **`purchaseController.js`**: `getPurchases` gained a self-healing status sync — same pattern
  `getPurchaseRequests` already uses for its own stale-status drift (confirmed precedent, not a
  new idea). `computeHealedStatus` recomputes a PO's `status` from its linked PRs' real statuses
  (all Received → `Received`; some → `Partially Received`; none → left alone) and writes it back
  when it's changed. Status can no longer be filtered at the Mongo query level as a result
  (it may be stale until healed) — every matching PO is fetched first, healed, then filtered/
  paginated in memory, the exact tradeoff `getPurchaseRequests` already makes for the same
  reason. Also gained comma-list `?status=` (was single exact-match only), matching PRs' own
  filter shape, so Active/History can each request their whole bucket in one query param.
- **`ByVendorTab.jsx`**: `PurchaseOrderHistory` generalized into `PurchaseOrderList({
  scopeStatuses, emptyMessage, expandPONumber })`, used twice — Active POs
  (`Draft`/`Sent`/`Acknowledged`/`Partially Received`) and Order History (`Received`/
  `Cancelled`) — each with its own status dropdown scoped to just its bucket. A freshly-created
  PO now lands in **Active POs**, not History (it's never "done" the moment it's created).
  Each PO's expanded row now shows a real per-line receive badge (Received / Awaiting receipt),
  sourced from `items[].purchaseRequest.status` — **not** `items[].receivedQuantity`, which is
  dead for the new flow (same reason as `Purchase.status` above). This is **binary**, not a
  quantity count: checked for a "receive this PR across several separate rounds" mechanism and
  found none — a PurchaseRequest resolves in one status transition, not incrementally.

Verified with `node --check` (backend) and `esbuild` (frontend, `ByVendorTab.jsx` plus a full
bundle of `PurchaseOutsourceHub.jsx`). Not yet tried live in the browser — this pass touches
real status-mutation logic (`getPurchases` now writes on every call it heals), so a live
click-through matters more than usual here before trusting it on real data.

**Not built in this pass — still open, discussed but deferred:**
1. **Per-item delivery dates.** Confirmed as a real gap: `VendorBid.deliveryDays` is captured
   per quote but `createBatchPO` never sends `expectedDeliveryDate` to `createPurchase` at all,
   so every batched PO silently falls back to the generic +7-day default regardless of what was
   quoted. User's call: keep it simple — show each item's own date, Store marks received
   per-item as things arrive (which the per-line receive badge above already supports the data
   shape for).
2. **Transport decision (`Purchase.transportBy: 'Vendor'|'Company'`) + a minimal Dispatch stub
   page** (`/dispatch/vendor-pickups`, module-gated only, no new feature-permission key) to list
   Company-transport POs — "just show the request," no workflow yet.
3. **`isTransportCharge` flag, PO-scope only** (confirmed by the user) — so a transport-related
   PO charge (Freight) can be excluded when transport is Company's responsibility, not the
   vendor's. Item-scope charges are excluded from this by design: they're already locked in at
   quote time, before the transport decision (made at batch time) even exists.

---

## Thirteenth pass (2026-10-05) — the three items deferred from the Twelfth pass, all built

**1. Per-item delivery dates — the real gap confirmed in the Twelfth pass is fixed.**
`createBatchPO` now sends each line's own `deliveryDays` (from its quote, `VendorBid.deliveryDays`)
to `createPurchase`, which computes that line's own `expectedDeliveryDate` server-side
(`orderDate + deliveryDays`, never trusted from the client) and stores it on
`Purchase.items[].expectedDeliveryDate` — a new field. The PO's own single
`expectedDeliveryDate` is now the **latest** of its lines' own dates (the whole order is only
complete once everything has arrived), falling back to the old +7-day guess only when no line
had a usable `deliveryDays` at all. Shown per-item in By Vendor's Active POs / Order History
expanded rows and in the new Dispatch stub page. Receiving stays exactly as confirmed by the
user — simple, per-item, no new "rounds" concept (matches what the Twelfth pass already
established: a PurchaseRequest resolves in one status transition, not several).

**2. Transport decision + Dispatch stub page.**
- `Purchase.transportBy: 'Vendor' | 'Company'` (default `'Vendor'`), chosen via a radio toggle
  in By Vendor's batching card ("Vendor delivers" / "We pick up (Company)"), sent to
  `createPurchase`. Shown as a badge on every PO row (Active POs and Order History both).
- New minimal page, `client/src/pages/dispatch/VendorPickups.jsx`
  (`/dispatch/vendor-pickups`) — lists every PO where `transportBy` is `'Company'`: vendor,
  address, items with their own expected dates, grand total, status. Purely read-only, exactly
  "just show the request" — no vehicle/driver assignment or status workflow, deferred.
- **Permission note, a real decision not a formality:** the obvious endpoint to reuse
  (`GET /api/accounts/purchases/orders`) is gated to Accounts-ish roles only
  (`authorizeRoles('Accounts', 'Accounts Head', 'Superadmin', 'Unit Head')` +
  `checkPermission('accounts', 'purchases', 'view')`), and Dispatch roles have neither. Rather
  than widen an Accounts endpoint for an unrelated department, built a small dedicated one —
  `getVendorPickupsForDispatch` (`purchaseController.js`), routed at
  `GET /api/dispatches/vendor-pickups` (`dispatchRoutes.js`, placed before its `/:id` catch-all
  — same route-ordering gotcha already documented elsewhere in this codebase). Gated with
  `dashboardView` (the one `dispatches`-module permission every Dispatch-role user already has)
  rather than inventing a new feature-permission key that would need separately registering
  somewhere before any Dispatch user could actually see the page — a deliberate shortcut for a
  stub, called out so it's not mistaken for the real permission this feature should eventually
  get once it's more than "just show the request." Sidebar entry added the same way (module-only,
  no `feature` key, same treatment as Dashboard/Task Management above it).

**3. `isTransportCharge`, PO-scope only (confirmed design from the Twelfth pass).**
- `Supplier.charges[]` rows gain `isTransportCharge` (boolean), sanitized to always `false` for
  an Item-scope charge (meaningless there — the transport decision doesn't exist yet when an
  Item charge is locked in). Vendor Master shows the checkbox only for a PO-scope charge row.
- `vendorChargesService.js`'s `computeVendorCharges` signature changed from a positional
  `itemObjectId` 4th argument to an options object (`{ itemObjectId, excludeTransportCharges }`)
  — cleaner now that there are two independent toggles, not one. All three call sites
  (`createQuote`, `submitBidByToken`, `createPurchase`) updated.
- `createPurchase` passes `excludeTransportCharges: transportBy === 'Company'` when computing
  PO-scoped charges. `ByVendorTab.jsx`'s client-side `previewCharges` mirror does the same for
  the live preview before committing.

Verified with `node --check` (backend, all 8 touched files) and `esbuild` (frontend, every
touched file individually plus a full bundle of `PurchaseOutsourceHub.jsx`). Not yet tried live
in the browser — this pass is purely additive (new fields/endpoints, no further status-mutation
changes beyond the Twelfth pass's self-healing sync), lower risk than that pass, but still
unverified against real data.

**Next up, per the user:** invoice and payment work — out of scope for this pass.

---

## Fourteenth pass (2026-10-05) — Receive redesign: batch context, conditional warranty,
## unit-conversion fix, Vendor Rating hookup

Planned via `EnterPlanMode`/`ExitPlanMode` at the user's explicit request before building
("i think you should make plan and then build") — three Explore agents researched the current
receive flow, Purchase Invoice flow, and Vendor Payment flow first (the user wanted "full vision"
before committing to any of them); a fourth confirmed QC's own logic is purely PR-scoped with no
batch-PO awareness anywhere, so a batch-aware receive UI built on top of the *existing* per-PR
receive calls (rather than a new bulk endpoint) cannot break QC. Invoice/payment work stayed
parked — "one thing at a time... for now the receive" — this pass is receive + its Vendor Rating
hookup only.

**1. Unit-conversion skip when Purchase Unit already equals the stock unit.** The gate was
`purchaseUnit && purchaseQuantity` truthy (`purchaseRequestController.js`,
`PurchaseRequest.jsx`) — never an actual equality check. Store was typing a conversion factor of
"1" for items that never needed converting. Now resolves the real master Item (reusing
`resolveMasterItemId`, exported from `purchaseQuoteController.js` — one implementation, not a
second copy) and compares its `unit` against `purchaseUnit` case-insensitively; when equal, the
whole conversion step is skipped server- and client-side, 1:1 automatically. Backend and frontend
checks updated in lockstep so the frontend never shows a step the backend wouldn't require anyway.

**2. Warranty — conditional, sourced from the quote, not re-typed from scratch every time.**
`VendorBid.warrantyMonths` (already captured at quote time) is now carried all the way through:
`createBatchPO` sends it per line → `createPurchase` stores it on `Purchase.items[].warrantyMonths`
(new field) → synced onto the originating `PurchaseRequest.warrantyMonths` (new field) the same
way `purchaseQuantity`/`purchaseUnit` already are. Store's receive modal now only shows the
Warranty Period/Card fields when the item was actually quoted with one (pre-filled, still
editable — what a vendor honors isn't always exactly what they quoted); zero-warranty material
skips the section entirely instead of demanding an entry. Backend validation
(`updatePurchaseRequestStatus`) updated to match — Serial Number stays mandatory regardless
(asset tracking, not a warranty concern).

**3. Batch-context panel — visibility only, not a new receive mechanism.** New endpoint
`GET /api/purchase-requests/:id/batch-siblings` (`getBatchSiblings`) lists a PO's other items
(status, expected date) when the PR being received is part of a multi-item batch.
`PurchaseRequest.jsx`'s receive modal shows this as a read-only panel above the existing form.
**Each item is still received individually through the exact same per-PR call as before** — this
is a context panel, not a bulk-submit form, which is what keeps QC (confirmed purely PR-scoped)
and every other per-PR assumption in the codebase untouched.

**4-6. Vendor Rating hookup (`vendorRatingService.js`), three changes together:**
- `computeVendorItemPricing` **no longer reads `PurchaseInvoice` at all** — it was going to
  conflict with the separately-planned invoice-at-PO-creation redesign (an invoice would then
  exist before anything is received, polluting price history with un-received/cancelled orders).
  Rewritten to read `Purchase.items[]` directly, joined through each line's `purchaseRequest` ref
  to that PR's real `status`, counting only `Received` lines. Price is **raw `unitPrice` only** —
  explicitly not `itemChargesTotal` — confirmed by the user ("raw price no gst or other
  charges"). This fully decouples rating pricing from whenever the invoice redesign actually
  happens.
- `computeVendorRating`'s on-time check now compares each PR's `receivedAt` against **that
  specific line's own** `expectedDeliveryDate` (`Purchase.items[].expectedDeliveryDate`, added in
  the Thirteenth pass) instead of the PO's one shared date — which, since that same pass, is just
  the *latest* across a batch's items and would wrongly call an earlier-due item "on time."
  Falls back to the PO-level date only for older POs with no per-item dates.
- **Partial QC rejections now count against rating.** Found live: a partial reject
  (`QCJob.partialRejections[]`, real schema field, written by `qcController.js`'s existing
  handling) never set the job's `decision` at all — a vendor whose shipment needed a partial
  reject got the exact same rating credit as one with zero rejects, the moment whatever remained
  eventually passed. Each `partialRejections[]` entry now contributes its own negative score,
  independent of the job's eventual terminal decision. No changes to `qcController.js` itself —
  this only reads data QC already records.

**7. "How rating is calculated" panel, `VendorRatingsTab.jsx`.** A collapsible info block stating
the formula in plain language (on-time/QC/partial-rejection scoring, raw-price-only pricing) —
purely documentation, the formula itself lives in `vendorRatingService.js`.

Verified with `node --check` (backend, 6 touched files) and `esbuild` (frontend, every touched
file plus a full bundle of `PurchaseOutsourceHub.jsx`). Not yet tried live in the browser, and no
scratch-script DB verification run this pass (would need the real DB URI first, per this
project's own standing note) — flagged for a live click-through before trusting this on real
receive data, same as every other pass.

---

## Fifteenth pass (2026-10-05) — Invoice + Payment redesign: invoice at PO creation, real GST,
## targeted payment allocation

Planned via `EnterPlanMode`/`ExitPlanMode` again, same as the Fourteenth pass. Confirmed
direction from earlier discussion: the invoice moves to PO-creation time (reviving what the old
RFQ flow already did before it started being retired), which makes "advance payment" fall out
naturally — no new payment type needed, just whether a payment lands on the invoice before or
after anything is received. Direct code reading found GST wasn't actually being computed at PO
creation at all (the user believed it was) — `createPurchase` just took whatever `taxAmount` the
request sent, which was always nothing. Both had to be built for real this time, not just
wired together.

**1. Real GST, computed once at PO creation (`Purchase.js`, `purchaseController.js`).**
`Purchase.items[]` gains `gstInclusive` (carried from `VendorBid.gstInclusive` — `ByVendorTab.jsx`
wasn't sending this at all before), `gstRate` (the vendor's rate actually used), and `gstAmount`
(this line's own computed tax). An inclusive line contributes `0` to `Purchase.taxAmount` — its
tax is already embedded in the quoted price, so taxing it again would double-count against
`grandTotal`; an exclusive line adds `quantity × unitPrice × vendor.gstRate / 100`. `totalAmount`
and the Charges system's own `rawValue` basis (Eleventh pass) are deliberately left untouched —
still gross quoted price, not reworked into a separate pre-tax concept, to avoid rippling into
code that's already built and working. **Known simplification, not silently decided:** `gstType`
(CGST+SGST vs IGST) stays at its schema default — real inter-state detection would need
comparing vendor vs company addresses, flagged as out of scope for this pass.

**2. Invoice created at PO-creation time, a pure copy of the PO's own numbers.**
`createPurchase` now calls `createAutoPurchaseInvoice(purchase, req.user)` right after the PO is
created (wrapped so an invoice failure never blocks the PO itself). `PurchaseInvoice.js` gains a
real `purchaseOrder` ref (previously only a free-text mention buried in `notes`).
`createAutoPurchaseInvoice` rewritten to stop computing anything itself — `subtotal` =
`po.totalAmount + po.poChargesTotal + sum(itemChargesTotal)`, `gstAmount` = `po.taxAmount`,
`totalAmount` = `po.grandTotal`, each line's `gstAmount`/`gstPercent`/`totalPrice` copied
straight from the matching `Purchase.items[]` line — confirmed the ledger-posting math still
balances (`subtotal + gstAmount === totalAmount` algebraically, same identity as `grandTotal`'s
own formula, just reordered). `dueDate` now computed from `Supplier.creditDays` — the first real
read of that Vendor Master Payment Terms field anywhere in the codebase — falling back to the
old Net 30 default when a vendor has none set. The receive-time calls to
`createAutoPurchaseInvoice` (`purchaseRequestController.js`, plain + fabrication) are **left in
place, not removed** — they already dedupe by PO number, so they're now harmless no-ops; lower
risk than removing a path with no proof nothing else depends on it. The old RFQ-flow's own
invoice-at-PO-creation call (`rfqController.js`) and the independent manual "Record New Bill"
path (`PurchaseInvoices.jsx` → `createPurchaseInvoice`) are both untouched.

**3. Targeted payment allocation (`VendorPayment.js`, `createVendorPayment`,
`VendorPayments.jsx`).** `VendorPayment` gains `allocations: [{ invoice, amount }]` — there was
no record anywhere of which invoice(s) a payment actually settled, even under the existing FIFO
behavior; now every payment records it, not just new targeted ones. `createVendorPayment`
accepts an optional `invoiceId`: when given, that invoice is paid first (capped at its own
balance), any remainder still spills into the existing FIFO loop across the vendor's other
unpaid invoices rather than erroring on a slightly-oversized payment; when absent, behavior is
unchanged. `VendorPayments.jsx`'s "Outstanding Summary" list (previously just informational) is
now clickable per invoice to target it — each row shows a "PO-linked" tag when it has a
`purchaseOrder`, and selecting one shows a reference-only "recommended advance" hint computed
from `Supplier.paymentAdvancePercent` (first real use of that field too) when the vendor has one
set. `getVendorOutstanding`'s aggregation updated to surface `purchaseOrder` per invoice and
`paymentAdvancePercent`/`creditDays` per vendor for this.

Verified with `node --check` (backend, 5 touched files) and `esbuild` (frontend,
`ByVendorTab.jsx` + `VendorPayments.jsx` + a full bundle of `PurchaseOutsourceHub.jsx`). Not yet
tried live in the browser — this pass touches real ledger-posting code (`Transaction`/`Account`
balances) in both `createAutoPurchaseInvoice` and `createVendorPayment`, so per the plan's own
verification section, the full flow (quote → PO → invoice → payment) should be tried live before
trusting it on real data more than any other pass so far.

**Next up, per the user:** test the full flow end-to-end, then build the Dispatch department's
real vendor-pickups page (beyond the "just show the request" stub from the Thirteenth pass).

---

## Sixteenth pass (2026-10-05) — multi-invoice payment must be full, not partial

Caught by the user from a question about advance-vs-full-payment semantics: the Fifteenth pass's
targeted payment only ever let Purchase target **one** invoice. There was no way to clear
several particular invoices in one payment the way the old pure-FIFO behavior sort of did
(automatically, not as a deliberate selection) — a real regression for anyone wanting to settle
more than one bill at once.

The fix isn't just "allow selecting several" — splitting one partial amount across multiple
*specific* invoices is genuinely ambiguous (proportional? oldest of just the selected ones?
something else?), so instead of guessing: **one invoice selected can be paid partially, same as
before; several invoices selected must be paid in full.**

- `createVendorPayment` (`purchaseInvoiceController.js`) now takes `invoiceIds` (array, replacing
  the single `invoiceId` from the Fifteenth pass — nothing else depended on that field yet) and
  branches three ways: **one** id → same targeted-partial-with-FIFO-spillover behavior as
  before; **several** ids → validated up front (before touching any record) that `amount` covers
  the sum of their balances, rejected with a clear error otherwise, then each is paid in full and
  any amount beyond their total still spills into FIFO across the rest; **none** → unchanged pure
  FIFO. `allocations[]` records the real breakdown in every case.
- `VendorPayments.jsx`'s invoice list is now a real multi-select (checkboxes, not a single
  toggle) — selecting 2+ shows an amber hint stating the exact full amount required and that a
  single-invoice selection is the way to pay partially; the PO-advance reference hint is now
  shown only when exactly one invoice is selected (it only makes sense against one at a time).
  Client-side validation mirrors the backend's so a doomed submission is caught before the
  round-trip, with the same wording the server would otherwise reject it with.

Verified with `node --check` (`purchaseInvoiceController.js`) and `esbuild`
(`VendorPayments.jsx`). Not yet tried live in the browser.

---

## Seventeenth pass (2026-10-05) — orphaned-invoice risk disabled at the source

Follow-up from reviewing the Fifteenth pass for other fallout: moving invoice creation to
PO-creation time means a PO that gets cancelled or deleted now leaves behind a real invoice with
nothing to cancel it — permanently inflating that vendor's credit exposure (`getVendorOutstanding`)
with an uncollectible balance. Before the Fifteenth pass this was harmless (an unreceived Draft
PO had no invoice yet to orphan).

Checked how reachable this actually is before touching anything: `deletePurchase`
(`DELETE /purchases/orders/:id`) has **zero** frontend callers anywhere (confirmed by grep) —
fully dead code today. `updatePurchase` (`PUT /purchases/orders/:id`) **is** live — it's
`PurchaseRequest.jsx`'s "Modify PO" flow — but read its exact payload: it only ever sends
`supplier`/`items`/`taxAmount`/`expectedDeliveryDate`/`deliveryAddress`/`terms`/`notes`, never
`status`. So neither path can actually be hit through the app today; this was a landmine for
whenever a Cancel/Delete PO feature gets built, not a live bug.

User's call: disable both at the source now rather than leave a correctness trap sitting live in
the backend, re-enable once invoice cleanup is built.

- **`deletePurchase` route commented out** (`accountsRoutes.js`) — the controller function
  itself is untouched, just unreachable, with a comment at both the route and the function
  explaining why and what's needed before re-enabling.
- **`updatePurchase`'s `status` handling commented out** (`purchaseController.js`) — everything
  else in that endpoint (vendor/items/price/delivery/terms edits, i.e. the actual "Modify PO"
  feature) is untouched and still works exactly as before; only the specific risky path (setting
  `status`, e.g. to `Cancelled`, with no invoice cleanup) is neutralized. `status` sent in a
  request body is now silently ignored rather than applied.

Verified with `node --check` on both touched files.

---

## Eighteenth pass (2026-10-06) — Item-wise PR consolidation: By Item now combines by ITEM, not by PR

The real original intent behind this whole redesign, only articulated clearly by the user on
2026-10-05 (see `procurement-redesign-discussion-2026-09.md`'s "Item-wise consolidation" section)
and never built in any of the first 17 passes: By Item was always one card per individual
`PurchaseRequest` — three PRs for "MS Round Bar" showed as three separate cards, each quoted
independently. The actual intent is one combined card per ITEM, summing every open PR's need for
it, with Purchase able to deliberately order less than the combined total for budget reasons
(intentional, not a bug). Planned via `EnterPlanMode`/`ExitPlanMode` (the user's standing
preference for work this size), backed by three parallel Explore passes over the real code plus
an independent Plan-agent design review that caught several real gaps before anything was built
(see below) — not just accepted the first draft.

Confirmed design, resolved across several rounds of discussion with the user:
1. Purchase explicitly **selects** which pending PRs a round covers via a "Select PRs" button/
   modal — not automatic grouping.
2. Default combined quantity = sum of selected PRs' own quantities, always a free, manually-
   overridable number.
3. Multiple vendors can quote against that ONE shared selection+quantity — one card, several bids
   compared, not several independent quote sessions.
4. **Selection is a binary commitment, independent of the quantity actually bought.** Select 3 PRs
   summing to 6, order 4 — all 3 still count as fully processed the moment a PO is created. No
   partial/remainder tracking per PR; to keep a PR alive for a future round, unselect it *before*
   the PO is created, not after.
5. Adding/removing a PR once any vendor has been quoted (including a still-outstanding Email
   invite, not just a priced Submitted bid) shows a confirm dialog first. The selection change
   always refreshes the quantity field to the new sum; Purchase can retype it again afterward.
   This refresh-then-adjust cycle repeats freely until the PO is created, which is the only point
   everything freezes.
6. Fabrication items (requested at specific dimensions, but whose `quantity` is already resolved
   to a total weight): grouping combines **every dimension of the same base item into one card**,
   confirmed explicitly — a round bar ordered at 8mm and at 10mm both count toward one combined kg
   total.
7. All VendorBid/Purchase data from the first 17 (never-live-tested) passes was confirmed
   disposable — no migration built for the schema changes below.

### Core design: a new `ItemQuoteGroup` model, every other schema change additive

**Why not just make the existing singular refs plural?** `VendorBid.purchaseRequest` and
`Purchase.items[].purchaseRequest` are both singular. The legacy RFQ flow
(`rfqController.js`'s `createRFQ`/`selectVendor`) stays completely untouched this pass and is
structurally, permanently 1-PR:1-bid:1-line — forcing it to become array-aware for zero benefit
would be pure risk. Every schema change here is additive instead: new fields alongside the old
ones, old ones untouched and still used by the legacy path.

- **`server/models/ItemQuoteGroup.js` (new).** `{item, unit, companyId, status: 'Open'|'Batched'|
  'Cancelled', purchaseRequests: [PR ids], quantity, purchaseUnit, purchaseUnitType, createdBy}`.
  A partial unique index on `{item, unit}` filtered to `status:'Open'` enforces at most one Open
  group per item per branch — this is what keeps the whole design simple, since there's never a
  competing second selection for the same item to reconcile against. `unit` here means branch
  scoping (same as `VendorBid.unit`/`Purchase.unit`), **not** a measurement unit — flagged loudly
  in the model's own comment since this exact feature already overloads "unit" the other way too
  (`PurchaseRequest.unit`/`purchaseUnit` are kg/pieces).
- **`VendorBid.js`** gains `group` (ref `ItemQuoteGroup`, optional, new) alongside the existing
  `purchaseRequest` (kept, still used by the legacy RFQ path and the original single-PR direct-
  quote endpoints, both left in place — superseded for By Item's own UI, not removed, since
  nothing proves no other caller depends on them existing).
- **`Purchase.js`'s `items[]`** gains `purchaseRequests` (plural, new) and `itemQuoteGroup`
  (traceability, new) alongside the existing singular `purchaseRequest`. **Naming hazard flagged
  in the model comment**: `Purchase` already has a *top-level* `purchaseRequests` (the whole
  batch's PR list, since the first restructure pass) — the new field is a *different, per-line*
  array with the *same name* one level down. Every reader of either field now goes through one
  shared normalize-to-array helper, `prIdsOf` (exported from `purchaseController.js`), instead of
  reimplementing the fallback per call site.
- **Staleness, not recalculation.** `VendorBid.quantity` stays a frozen snapshot, copied from
  `group.quantity` at quote-creation/last-edit time — it does **not** silently track later group
  quantity changes (preserves this project's existing "charges decided once, never silently
  recalculated" rule). If the group's quantity changes after a bid exists, that bid is "stale" —
  computed live by comparing `bid.quantity` to the group's current `quantity`, no new stored flag,
  same idiom `computeHealedStatus`/`getQuotesForPR`'s `isActive` already use. A stale Manual bid
  can be explicitly synced (re-priced at the new quantity, same unit rate); a stale Email bid
  can't (the vendor priced the old quantity) and must be re-quoted instead. Batching a stale bid
  is blocked, re-checked server-side at PO-creation time, not just trusted from the client.

### Slice A — `ItemQuoteGroup` CRUD (`itemQuoteGroupController.js`, `itemQuoteGroupRoutes.js`, new)

`POST /` (create-or-reuse the Open group for a set of PRs), `PUT /:id/selection` (replace the
selection, always refreshes `quantity` to the new sum), `PATCH /:id` (adjust `quantity` only, no
selection change — qty is always a free number), `GET /` (list Open groups for By Item's cards),
`GET /:id/eligible-vendors` (vendors linked to the group's item in Vendor Master, keyed by the
already-resolved `group.item` — no fresh per-request resolution needed, unlike the per-PR version
this supersedes).

The initial/refreshed `quantity` sum reuses each selected PR's existing per-PR resolution rules —
fabrication → `resolveFabricationLines`'s mass-unit total; non-fabrication where the PR's own unit
already equals the item's Purchase Unit → its `quantity` directly; anything else → unresolvable —
ported server-side (`computeGroupQuantityFromPRs`) instead of re-derived per vendor-quote attempt
the way the old per-PR flow did. **Confirmed decisions, not left ambiguous**: if some selected PRs
resolve and others don't, sum only the resolvable ones and report which PR(s) didn't (surfaced to
the user as a toast, not silently absorbed); a fabrication PR that hits the catalog-drift guard is
caught individually so it doesn't block its siblings' resolution.

### Slice B — Quoting against a group, plus its read/guard-side counterparts, bundled together

Bundled deliberately per the design review: shipping quote-creation without its read-side and
guard-side fixes in the same pass would leave a live data-integrity gap — PRs tab showing "0
Quotes" for PRs actively being quoted via the new flow, and fabrication PRs mid-quote via a group
left unprotected from edits.

- `POST /api/item-quote-groups/:id/quotes` (Email or Manual) — no `quantity` body param any more,
  read from `group.quantity` instead (the group is the single source of truth for qty now, not
  re-entered per vendor-quote attempt).
- `rfqController.js`'s `submitBidByToken`/`getBidByToken` — when a bid has `group` set, resolves
  `itemObjectId` from the already-stored `group.item` instead of re-resolving from a PR.
- **`getQuotesForPR` rewritten to be group-aware** (`purchaseQuoteController.js`) — backs the PRs
  tab's "No Quotes/N Quotes/In Batch PO" stat cards, which look completely unchanged in the UI
  regardless of which flow actually quoted a given PR (resolves the PR's group if any, queries
  both `{group}` and the legacy `{purchaseRequest}` shape).
- **`editFabricationLines`'s "already quoted" lock widened**, not just extended — now also blocks
  the moment a PR is merely *selected* into an Open-or-Batched group, even before any bid exists
  (previously only a PR with an actual quote was locked; a selected-but-not-yet-quoted PR passed
  every guard and could have its dimensions silently changed out from under the group's already-
  computed sum, with no refresh-prompt at all).

### Slice C — By Item tab, full rewrite (`ByItemTab.jsx`)

One card per resolved item (grouped client-side from the same PR fetch as before, using `pr.item`
— already attached server-side by `getPurchaseRequests`'s existing fuzzy match), merged with any
matching Open group fetched from `GET /api/item-quote-groups`. A PR whose item can't be resolved
gets its own singleton card with the same "doesn't match a real Inventory item" messaging the old
per-PR version showed (honest-absence, not hidden). Search/priority/raisedBy/fabrication filters
now decide which *cards* show (a card shows if any of its PRs matches), not which PRs within a
card — a card always shows its full pending-PR breakdown regardless of the active filter, since a
partial view could misrepresent the item's real combined need.

"Select requests" modal, qty input with onBlur-save, vendor rows retargeted to the group
(`GroupVendorRow`/`GroupVendorQuoteForm`, simpler than the old per-PR `VendorRow`/`VendorQuoteForm`
— no more fabrication-preview effect needed client-side, since quantity resolution now happens
once, server-side, at group create/update time), a staleness badge + "Sync" action on a Manual
bid whose frozen quantity no longer matches the group's live one.

### Slice D — By Vendor batching + `createPurchase`/`updatePurchase`, fixed together

This is the pass that actually introduces multi-PR-per-line batches for real, so every fix below
shipped together, not deferred:

- **Removed the silent `|| items[0]` fallback** in both `createPurchase`'s and `updatePurchase`'s
  PR-sync loops (`purchaseController.js`) — harmless only while every caller was single-line; once
  a line can carry a plural PR list, silently matching an unrelated line's unit/quantity/warranty
  to a PR that matched nothing would be actively wrong, not harmless. Now skips that PR's sync
  instead of guessing.
- **Fixed a real pre-existing bug in `updatePurchase`'s items-rebuild, found while auditing this
  exact blast radius**: whenever `items` is sent (which `PurchaseRequest.jsx`'s live "Modify PO"
  flow always does), the rebuild only ever copied
  `item/itemName/quantity/unitPrice/totalPrice/receivedQuantity/pendingQuantity` — silently
  dropping `purchaseRequest(s)`, `itemQuoteGroup`, `itemCharges`, GST fields, expected delivery
  date, warranty, and fabrication breakdown on **every single save**, unconditionally, since
  before this pass even existed. Shipping the new `purchaseRequests`/`itemQuoteGroup` fields
  without fixing this would mean the first "Modify PO" on any batch-created PO wipes the new link
  too. Now preserves every one of these fields from the matching existing line (matched by
  Inventory item id, falling back to array position) — and, fixed in passing since the data was
  already back in hand, `grandTotal` on update now actually includes `poChargesTotal` and every
  line's `itemChargesTotal`, which it silently never did before.
- `ByVendorTab.jsx`'s `createBatchPO` — payload per line now sends `purchaseRequests` (plural,
  from the group) + `itemQuoteGroup` + `vendorBidId` instead of a singular `purchaseRequest`; the
  **separate top-level** `purchaseRequests` (the whole batch's list) is now a flatten across every
  selected line's own PR list, not one id per line, so `computeHealedStatus`/`sendPOToVendor` see
  every PR a group-based line actually covers.
- A stale bid can't be batched — blocked client-side (Consolidate button disabled) and re-checked
  server-side at `createPurchase` time against the group's live quantity, not just trusted from
  whatever the tab last loaded.
- After a successful `createPurchase`, every referenced `ItemQuoteGroup` flips to `'Batched'`
  (frees the item for a brand-new, empty Open group next time — confirmed "fresh card, no PRs
  selected, no quote price" behavior) and every other still-`Submitted` bid on that group is
  rejected, mirroring the legacy `selectVendor`'s own reject-the-losers step — otherwise a losing
  vendor's bid would sit forever as a dangling "Submitted" quote in their own history.
- `getBatchableQuotesForVendor` rewritten with a unified response shape covering both legacy
  single-PR quotes and group-based ones (`purchaseRequestIds` always an array, `resolvedItemId`/
  `itemQuoteGroup`/`isStale` always present, null where not applicable) — dedup by GROUP for the
  new path, not by PR, and guards the "selected, quoted, then unselected everything" case (an
  emptied-but-still-Open group's bid must not surface as batchable; it has nothing left to flip to
  Ordered).
- `computeHealedStatus` rewritten to aggregate by **flattened PR across all lines** (`prIdsOf`,
  unioned), not by line — accurate even when one line now carries several PRs.
- By Vendor's per-item receive badge (`PurchaseOrderList`) — "Received" now means every PR on a
  line is Received, not just one; shows "N/M received" for a multi-PR line instead of a flat
  binary when it's partial.

### Slice E — Downstream consumers that only matter once a group-based PO is received

- `vendorRatingService.js`: `computeVendorRating`'s own-line match widened to `prIdsOf`;
  `computeVendorItemPricing` now loops every PR on a line (not just one), pushing one price sample
  per individually-Received PR at that line's shared `unitPrice` — a line with 3 received PRs
  really did deliver at that price 3 separate times, which matters for an accurate average.
- `getBatchSiblings` — flattened to one entry per PR (not per line), so it now also shows PRs
  sharing the *current* PR's own line (previously only showed PRs on *other* lines in the batch);
  each entry's `quantity` is flagged `combinedQuantity: true` whenever more than one PR shares it,
  so a consumer doesn't attribute a shared line total to one PR.

### Known gaps, honestly

- **Not live-tested against the real database or in a browser** — verified by `node --check`
  (backend, every touched file) and `esbuild` (frontend, both touched tabs plus a full bundle of
  `PurchaseOutsourceHub.jsx`) only, same convention as every other pass in this project. This pass
  introduces a new model with a partial unique index and changes the actual PO-creation path real
  POs get made through — recommend testing Slices A+B in isolation first (create a group, quote
  it, confirm staleness/sync behaves) before trusting C/D's batching path on real data.
- The single-PR `createQuote`/`getEligibleVendorsForPR` endpoints (`purchaseQuoteController.js`)
  are now superseded for By Item's own UI and have zero live callers left — left in place rather
  than removed, since neither is risky and nothing proves no other caller depends on them.
- `ItemGroupCard`'s "Quote" action doesn't pre-empt a `group.quantity` of 0 (every selected PR
  unresolvable) with a disabled state — it fails loud server-side instead ("Set a quantity before
  requesting a quote"), not silently, just not as polished as disabling the button up front.

---

## Nineteenth pass (2026-10-06) — live-testing fixes, and a review-before-create dialog

The first real browser testing of the Eighteenth pass, by the user. Found and fixed four real
bugs plus one design gap they asked for directly.

**1. `ItemQuoteGroup.item`'s `ref` was wrong — crashed the moment any PR got selected.** Written
as `ref: 'Inventory'`, copied from the exact same (also wrong) pattern already sitting in
`Purchase.js`/`Manufacturing.js`/`Packing.js`/`ProductionGroup.js`/`PurchaseInvoice.js`. The
actual registered Mongoose model name is `'Item'` (`models/Inventory.js`:
`mongoose.model('Item', itemSchema)`) — easy to get wrong since the file is named `Inventory.js`.
Those five pre-existing models never actually `.populate()` the field so it never surfaced; mine
does (`listOpenGroups`, `createQuoteForGroup`), so it broke immediately with "Schema hasn't been
registered for model 'Inventory'." Fixed to `ref: 'Item'`. The other five pre-existing instances
are left alone — out of scope, not something this pass touched or broke.

**2. A fabrication item's combined quantity always computed to 0 — a real bug in this pass's own
code, not a data/catalog problem.** `computeGroupQuantityFromPRs`'s two callers fetched the
master Item with `.select('name purchaseUnit purchaseUnitType')` — too narrow. `dimensionVariants`
and `fabricationRef` weren't selected, so `resolveFabricationLines`'s own catalog-match check
(`masterItem.dimensionVariants || []`) always saw an empty array and rejected every fabrication
dimension as "not a known catalog size," even an exact match — confirmed against a real DB dump
the user pulled: the dimension in question (`{thickness:1.5, width:1250, length:2550}`) *was* in
the item's `dimensionVariants` with `isLeftover: false`, it just never got fetched. Fixed by
adding `dimensionVariants fabricationRef` to both `.select()` calls. The leftover-exclusion rule
itself (`!v.isLeftover` — "we don't buy leftover") was already correct and untouched; it just had
no data to check against.

**3. Card UX, two fixes from live feedback:**
- `ItemGroupCard`'s inline PR breakdown showed every pending PR (up to 19 seen live) with a
  "Selected"/"Not selected" badge on each — noisy, and arguably backwards: the card is supposed to
  summarize the combined ask, not browse the full candidate pool inline. Now shows only the
  selected PRs (with a placeholder when none are selected yet); the full pending pool with
  checkboxes lives only in the "Select requests" modal, which also gained a "Select all" toggle
  with a live `N of M selected` count.
- Selecting PRs, adjusting quantity, quoting a vendor, or syncing a stale bid each triggered a
  full-page `load()` — refetching all 500 PRs and every group, dropping the whole page into a
  loading state that collapsed every other expanded card and lost scroll position, for a change
  that only ever affects one card's own group. Replaced with a scoped `upsertGroup` that merges
  just the one updated/created group (returned directly by the POST/PUT/PATCH response) into
  state; quoting/syncing a vendor now only refreshes that card's own vendor list and never bubbles
  to the page at all. Required also fixing those three group endpoints to `.populate('item', ...)`
  on their response (they didn't before — fine when the only consumer was a full reload via
  `listOpenGroups`, which already populates it, but the frontend's merge needs `group.item._id` to
  know which card a response belongs to, and a bare save/create response only has a raw ObjectId).

**4. Review-before-create dialog for By Vendor's batching, requested directly by the user.**
GST *was* already being computed for real at PO creation (confirmed by the user checking Active
POs) — it just was never shown before committing, so the pre-PO total looked lower than what the
PO actually landed at, with no way to review the final price first. Added:
- `previewGst(lines, vendor)` (`ByVendorTab.jsx`) — mirrors `createPurchase`'s own per-line GST
  formula exactly, same "client preview only, server is authoritative" pattern `previewCharges`
  already established for PO charges. `grandTotal` now includes it.
- Clicking "Review & create PO" (renamed from "Consolidate... into one PO") no longer creates the
  PO directly — it runs the same unresolved/stale pre-checks as before (`canReview()`, factored out
  of `createBatchPO`) and, if they pass, opens a dialog: per-line goods/charges/GST breakdown, PO
  charges, a Goods/Item charges/PO charges/GST/**Grand Total** summary, and the same credit-
  exposure/waiver insights — then "Confirm & create PO" actually calls `createBatchPO`.

Verified with `node --check` (`itemQuoteGroupController.js`, `ItemQuoteGroup.js`) and `esbuild`
(`ByItemTab.jsx`, `ByVendorTab.jsx`, plus a full bundle of `PurchaseOutsourceHub.jsx`).

---

## Twentieth pass (2026-10-06) — one real "View PO" bug exposed by multi-line batches, two display clarifications

More live-testing feedback, same day. One genuine latent bug, confirmed not caused by this
redesign but only now actively wrong because of it; two display clarifications the user flagged
as ambiguous (explicitly left to this pass's judgment on whether/how to fix).

**Confirmed NOT a bug, investigated directly rather than assumed:** the user suspected Store's
"Receive Fabrication Purchase" dialog defaulting to "1 piece" for a PR that's part of a 12-PR,
400kg combined group was reading the wrong number (maybe the PO's own line count). Traced
`FabricationReceiveDialog.jsx`'s pre-fill (`useEffect` keyed on `pr?._id`) — it reads directly
from `pr.fabricationDimensionLines`, that one PR's own original ask, never touching the PO or the
group at all. "1" is correct: that PR really was raised for 1 piece. This is the design working as
intended — Store receives each PR individually, on its own original terms, same as always; the
combined 400kg only ever existed as the ordering/pricing unit, never the receiving one.

**1. Real bug: `PurchaseRequest.jsx`'s "View PO" modal (`handleOpenViewPO`) always read
`po.items?.[0]`** — "just take the first line," harmless back when a PO only ever had one line.
Item-wise PR consolidation made multi-line POs (one line per distinct item) a normal case, so this
now silently shows whichever line happens to be first, not the one that actually covers the
request being viewed — invisible in a single-line PO (this pass's own screenshot happened to have
only one line, so it looked right by coincidence), real the moment a PO batches more than one
distinct item. Fixed to match the line the same way the rest of this redesign does: the plural
`purchaseRequests` or singular `purchaseRequest` containing this request's own id, falling back to
`items[0]` only if nothing matches at all.

**2. Real bug, same modal: "Supplier/Vendor" showed "Not selected" for a PO that has a real
vendor.** The view-mode render looked the vendor up in a local `vendors` list (fetched for the
create/edit dropdown, not guaranteed to include every vendor) instead of using
`selectedRequest.purchaseOrder.supplier`, which is already populated from the same fetch that
loaded the request (`getPurchaseRequests` populates `purchaseOrder.supplier`). Added that as a
fallback before giving up and showing "Not selected."

**3. Display clarifications, both explicitly left to this pass's discretion by the user:**
- By Vendor's per-line receive badge said "0/12 received" for a 12-PR line — read naturally as
  "0 of 12 pieces," not "0 of 12 requests." Relabeled to "0/12 PRs received."
- The same line's quantity (`400 × ₹100`) never showed its unit at all. `Purchase.items[]` has no
  purchase-unit field of its own (only `quantity`/`unitPrice`) — added `purchaseUnit` to
  `getPurchases`'s existing populate of `items.purchaseRequest(s)` (it's synced back onto the PR
  at batch time) and read it off whichever linked PR has one, so the line now reads
  "400 Kilogram × ₹100."

Verified with `node --check` (`purchaseController.js`) and `esbuild` (`PurchaseRequest.jsx`,
`ByVendorTab.jsx`, plus a full bundle of `PurchaseOutsourceHub.jsx`).

---

## Twenty-first pass (2026-10-06) — audited the automatic Item price update, found one pre-existing bug

User asked directly: does the automatic `Item.purchaseCost`/`mrp`/`salePrice` update (triggered on
receive — `itemPricingService.js`'s `recalculateItemPricing`) still work correctly now that a PO
line can cover several PRs for different items? Traced the full chain rather than assume, since
this touches real ledger/inventory numbers.

**Verdict: still working for the realistic flow, but on a lucky coincidence, not by design — and
one real bug found along the way, pre-existing, not introduced by item-wise consolidation.**

- `resolvePurchaseItemCost` finds the item's cost from the most recent `PurchaseInvoice` line
  referencing it — unaffected by item-wise consolidation, since `createAutoPurchaseInvoice` always
  copies the real Inventory item id onto each invoice line regardless of how many PRs that PO line
  covers. Confirmed fine, not touched.
- The unit-conversion factor that cost gets multiplied through, though, was being "rediscovered"
  via `findPurchaseToBaseFactor` reverse-parsing the invoice's own `notes` text for
  `"Purchase Request: {id}"` — **except the real notes string has always said
  `"Purchase Request(s): {id, id, ...}"`** (`createAutoPurchaseInvoice`, `prList` joined with
  commas) — the `"(s)"` means the regex never actually matched, not once, for any PO, going back to
  before this whole redesign (any PO could already batch several different items' PRs for one
  vendor). It silently fell through to a second fallback (`Item.receivedFromPurchaseRequest`,
  overwritten to the just-received PR's own id moments earlier in the very same request/response
  cycle by the exact same receive handler) — which happens to resolve correctly for the realistic
  case (Store actually receiving something) purely because of that same-function execution order,
  not because the mechanism is actually sound. It would NOT have been reliable for a multi-item
  batch's *early* recalc (right after PO/invoice creation, before anything is received) — that path
  has no "just-received PR" fallback to lean on, and would use whichever item was *last* received
  for something unrelated, or no factor at all.
- **Fixed properly, not just patched:** `resolvePurchaseItemCost`/`recalculateItemPricing` gain an
  optional `knownConversionFactor` — both receive-time call sites
  (`purchaseRequestController.js`'s `updatePurchaseRequestStatus` and
  `receiveFabricationPurchase`) now pass their own already-known `request.conversionFactor`
  directly, since they set and save that exact value onto the request/item moments earlier in the
  same call — no more rediscovering it via text-mining at all for the case that actually matters.
  `recalculateItemPricing`'s signature changed from positional `(item, visiting, depth)` to
  `(item, { visiting, depth, knownConversionFactor })` — backward compatible, every one of its
  other 2 call sites (`purchaseInvoiceController.js`'s `recalcPricingForInvoiceItems`,
  `productionMfgController.js`'s BOM-cost path) already only ever passed `item` alone.
- Also relaxed the regex itself (`Purchase Request\(?s?\)?:`) as a defense-in-depth fix for the one
  remaining caller of the notes-based fallback — the early recalc right after PO/invoice creation,
  which still has no known factor to pass explicitly and has to guess.

Verified with `node --check` (`itemPricingService.js`, `purchaseRequestController.js`,
`purchaseInvoiceController.js`, `productionMfgController.js`).

---

## Twenty-second pass (2026-10-06) — legacy pages retired, dev data wiped, 10 fresh test PRs seeded

Planned via `EnterPlanMode`/`ExitPlanMode` (two Explore passes first — page-removal scope, and the
exact ledger-posting shape for invoices/payments — before touching anything destructive).

**Legacy pages removed**, now that PRs/By Item/By Vendor have been live-tested enough: the three
pages (`/accounts/purchases/vendor-batching-preview`, `/accounts/purchases/rfq`,
`/accounts/purchases/vendor-bids`) and their component files
(`VendorBatchingPreview.jsx`/`RFQManagement.jsx`/`VendorBids.jsx`, plus the now-orphaned
`FabricationRFQDialog.jsx`, only ever imported by `RFQManagement.jsx`) are gone from `App.jsx` and
`config/moduleRoutes.js`'s sidebar. Confirmed via Explore first that nothing else imports any of
them. `VendorBidForm.jsx` (the public `/vendor-bid/:token` page the new Email-quote flow still
depends on) and all backend RFQ infra (`rfqController.js`'s public bid endpoints, the `RFQ`/
`VendorBid` models) are untouched — explicitly out of scope, still shared with the live flow.

**Dev data wiped**, scoped to the user's actual company — this DB turned out to be shared across 6
companies, and `Purchase` has no `companyId` field at all (only a branch `unit` string), so the
scope had to be derived carefully: cross-verified via `createdBy` user lookups that `unit:'test
unit'` belongs exclusively to this company before trusting it as the Purchase-level filter.
Deleted (company/branch-scoped, not system-wide): 74 PurchaseRequest, 86 Purchase, 92
PurchaseInvoice, 11 VendorPayment, 9 PurchaseReturn, 7 PurchaseExchange, 3 ItemQuoteGroup, 13
VendorBid, 7 RFQ, 85 Purchase-sourced QCJob. Other companies' data in the same shared DB confirmed
untouched (system-wide counts dropped by exactly the scoped amounts, no more).

**A real mistake, caught and fixed before it mattered:** the ledger-reversal script applied a
single generic `balance += (debit − credit)` formula to every `Transaction` entry being undone —
but the actual posting code (`purchaseInvoiceController.js`) doesn't follow a uniform convention;
`createVendorPayment`/`createPurchaseReturn` apply ad-hoc, per-controller `+=`/`-=` to each account
regardless of the entry's debit/credit label. The generic formula happened to reverse the
bank/cash side of payments correctly (coincidence of which label landed on which side) but got
`Accounts Payable` and `Purchase Return` backwards — doubling both away from zero instead of
toward it. Caught by the resulting numbers looking suspicious (exact doublings), traced by reading
the actual posting code directly rather than trusting the earlier research summary's paraphrase,
confirmed both accounts had zero other transaction history under this branch (so their correct
post-wipe balance is provably exactly 0, not an estimate), and corrected directly. Cash in
Hand/SBI/HDFC (the bank-side half of the same payments) were confirmed correct and left alone.
Checked for orphaned refund (`relatedDocument:'Receipt'`) transactions from the 9 deleted returns
too — none existed (no deleted return had a bank refund attached), so no further correction needed
there.

**Seeded 10 fresh PurchaseRequests** across the 4 real items named for testing (SSS-001 "ss
sheet", NB-012 "NUT Bolts", Tool-01 "Tool-A", BA-009 "Bairing-ucp208") — deliberately uneven (4 /
3 / 2 / 1) so the fresh data actually exercises combining several PRs into one item-group, not a
token one-each case. Kept deliberately simple and self-contained (plain Store-raised, not faked as
auto-reorder/cascade, which would need real `Order`/`ProductionOrder` wiring to be honest data).
`ss sheet`'s 4 PRs use the item's real non-leftover catalog dimension
(`{thickness:1.5,width:1250,length:2550}`, `weightPerPieceKg:38.25`, confirmed from the item's own
DB record) at 1-3 pieces each. Caught and fixed one thing before the insert: `requestId` turned
out to be a **globally** unique sequence across every company in the shared DB (matching the real
`generateUniqueRequestId()`'s own `PurchaseRequest.countDocuments({})` — company-unscoped), not a
per-company one — the first attempt collided on `PR002` (another company's existing PR); fixed by
finding the true system-wide highest existing number first. Also cleared 7 PurchaseRequests that
the live low-stock reorder cron created for this company mid-cleanup (confirmed via
`autoGenerated:true` + identical-second timestamps, not a bug) so the final state is exactly the
10 seeded PRs, nothing left over.

No code changes in this pass beyond the page removal — everything else was direct, scoped
database operations via a throwaway script (deleted after use, per this project's convention).

---

## Twenty-third pass (2026-10-06) — real cross-tenant data isolation fix: Supplier and Purchase

User asked directly, after the Twenty-second pass's cleanup surfaced a multi-tenant DB: "can a
company see different company's data in our rework because we might have missed it?" Answer was
yes — a real, confirmed gap, planned via `EnterPlanMode`/`ExitPlanMode` (three parallel Explore
passes mapping every single query site for both affected models before touching anything).

**Root cause**: `Supplier` and `Purchase` (the PO model) had **no `companyId` field at all** —
scoped only by a `unit` branch-name string. Confirmed empirically, not theoretically: two real
companies in this live DB ("Nexora Technologies" and "Test Compnay") both use the branch name
`"Test Unit"`. This predates the item-wise consolidation redesign entirely — this doc's own
Second correction pass even documents someone hitting the exact wrong assumption once before
(`Supplier.findOne({_id, companyId})` silently returning null, "fixed" by reverting to
`unit`-only, never realizing the field just didn't exist).

**Two things changed the fix's shape, checked against live data before committing to anything**:
`req.user.companyId` isn't schema-guaranteed (`User.companyId` is `required: false`), but zero
users in any Purchase/Accounts/Store/Superadmin role are actually missing it today — real but
dormant, not blocking. And `unit: 'Main'` is a deliberate cross-company shared-supplier sentinel,
not an oversight — but zero suppliers actually use it today, so narrowing it to per-company
sharing breaks nothing currently live.

**Schema**: added `companyId` (ObjectId ref `Company`, required) to both `Supplier.js` and
`Purchase.js`, additive — `unit` unchanged, still means "which branch within this company."

**Migration**: `server/scripts/backfillSupplierPurchaseCompanyId.js` (new, permanent, follows this
project's own established script convention). Purchase backfills via `createdBy` → `User.companyId`,
falling back to linked `purchaseRequests[]` → `PurchaseRequest.companyId`. Supplier backfills via
cross-referencing its own transactional history (`VendorBid`/`PurchaseInvoice`/`PurchaseReturn`/
`PurchaseExchange`/`VendorPayment`/`RFQ`, all of which already carried `companyId`) for an
unambiguous single company, falling back to an unambiguous `unit`-to-company match when a supplier
has no transactional history at all — never guesses; leaves `companyId` unset and reports it
rather than assigning a wrong company. Run against the real DB: **10/10 Purchases and 4/4
Suppliers backfilled with zero ambiguous or unresolved cases** — confirmed by checking the live
data before writing the script that this would be clean, not assumed.

**Code — every query site found across the whole backend, not just the new redesign's own files**,
scoped by `companyId` alongside the existing `unit` logic (additive, `SUPER_USER` keeps its
existing cross-company visibility unchanged):
- `supplierController.js` — all 10 handlers (`getSuppliers`, `getSupplierById`, `createSupplier`,
  `updateSupplier`/`deleteSupplier` — both were **id-only filters before this, a real cross-company
  edit/delete exposure, not just a read leak**, `getSupplierStats`, `exportSuppliersToExcel`,
  `importSuppliersFromExcel` — its email-dedup check was globally unscoped, could have silently
  overwritten a different company's vendor with the same email, `getVendorRatingsOverview`,
  `getVendorItemBreakdown`).
- `itemQuoteGroupController.js`, `purchaseQuoteController.js`, `rfqController.js` — every vendor
  lookup across the quote/RFQ flow. `rfqController.js`'s `selectVendor` also sets `companyId` on
  the PO it auto-creates. `submitBidByToken` is the one genuinely public, unauthenticated route in
  this whole sweep — scopes via `bid.companyId` (`VendorBid` already carried this), not a request
  user, since there isn't one.
- `purchaseExchangeController.js` — `assignExchangeVendor` and the `sendExchangeEmailFor` helper
  (scopes via `exchange.companyId`); also scoped an adjacent unscoped `Purchase.findById` found in
  the same function while here.
- `purchaseInvoiceController.js` — `createPurchaseInvoice`, `getSuppliersForAccounts`,
  `createAutoPurchaseInvoice`. Found a second, genuinely scary gap in the same file while fixing
  the planned one: `createAutoPurchaseInvoice`'s own "PO has no vendor" fallback was
  `Supplier.findOne({status:'active'})` — **pick literally any active supplier in the entire
  database, zero scoping of any kind** — not the function the original research flagged by that
  description (a mislabeled line number pointed at `resolveVendorAndPOForQCRejectedPurchase`
  instead, which turned out to already be well-designed and just needed its own `Purchase`/
  `PurchaseRequest` lookups scoped, a smaller fix caught by re-reading the actual code directly
  rather than trusting the summary).
- `purchaseController.js` — the PO model's own full scoping: `getPurchases`, `getPurchaseById`,
  `createPurchase` (sets `companyId` on the new PO; `SUPER_USER` can still override it via
  `req.body.companyId`, mirroring the existing `unit` override pattern), `updatePurchase`,
  `deletePurchase`, `receivePurchase`, `getPurchaseStats`, `getVendorPickupsForDispatch`, plus both
  Supplier lookups in this file. **`sendPOToVendor` had no ownership check of any kind before this
  — any authenticated user who knew/guessed a PO id could email it to the vendor and flip its
  status, regardless of company** — now has the same fetch-then-403 pattern every other handler in
  this file already uses.
- `productionMfgController.js`, `qcController.js` — one unscoped `Purchase`/`PurchaseRequest`
  lookup each, found during the sweep (`resolvePurchaseSaleContext`'s own 3-strategy resolution,
  unrelated to the `createAutoPurchaseInvoice` gap above despite similar names).
- `services/vendorRatingService.js` — `computeVendorItemPricing` already accepted `companyId` as a
  parameter but never applied it to its own `Purchase.find` query.

**Verified against the real DB, not just syntax**: ran the migration, then confirmed zero
documents anywhere are left without `companyId`, and directly tested the exact collision scenario
that surfaced this whole gap (querying "test-1 company"'s own `companyId` combined with the
literal colliding `"Test Unit"` branch string returns zero suppliers — correctly isolated, since
test-1 company's own branch is the differently-cased `"test unit"`).

Verified with `node --check` on every touched backend file (`Supplier.js`, `Purchase.js`,
`supplierController.js`, `itemQuoteGroupController.js`, `purchaseQuoteController.js`,
`rfqController.js`, `purchaseExchangeController.js`, `purchaseInvoiceController.js`,
`purchaseController.js`, `productionMfgController.js`, `qcController.js`,
`vendorRatingService.js`, and the new migration script).

## Twenty-fourth pass (2026-10-06) — the "generator"/"Motor A" PRs kept coming back: root cause, not symptom

User reported the backlog PRs from the Twenty-second pass's cleanup were "still present even
after restarting the server" — and worse, re-checking showed the backlog had actually **grown**,
10 -> 25 PRs, with clear duplicate pairs (e.g. two different PRs both pointing at the identical
`saleItemId`).

**Root cause**: `getPurchaseRequests`' own Sale-item back-fill logic (not cron, not cached —
re-runs on every single PRs-tab page load) creates a PurchaseRequest for any `Sale` item still
sitting at `storeQCStatus: 'Goes to Purchase'` (or, for older sales predating the per-item flow,
the sale-level `isAvailableInInventory: 'Not Available'` + `productType: 'Purchased (Trading
Product)'` equivalent) with no PR linked yet. The Twenty-second pass's cleanup only deleted the
*resulting* PurchaseRequest documents — the symptom — and never touched the underlying `Sale`
documents, so the very next page load recreated them from scratch. Traced 11 real Sale documents
(June-August 2026 test data) still matching this condition for the test company.

**Compounding bug, found in the same trace**: the back-fill's dedup check is a plain `findOne`
followed by a separate `create()` — not atomic. Two near-simultaneous PRs-tab loads (e.g. two
browser tabs, or just ordinary React re-render timing) can both pass the "no existing PR for this
saleItemId" check before either one's `create()` is visible to the other, so each one of those 11
stale Sales got a *second* PR created for the same `saleItemId` on a later page load — this is
exactly why the backlog grew instead of just staying at its original size.

**Fix, in two parts**:
1. **Root cause** — neutralized the 11 stale Sale documents so they stop matching the trigger at
   all: per-item flow sales had that item's `storeQCStatus` flipped from `'Goes to Purchase'` to
   `'Purchase Completed'` (a real, pre-existing status in the schema); legacy whole-sale-flow sales
   had `isAvailableInInventory` flipped from `'Not Available'` to `'Available'`. Both are
   semantically correct terminal states, not placeholder hacks. Run via a scratch script against
   the real DB (the user ran it directly — the auto-mode permission classifier blocked an agent-run
   mutation against the live DB at this scale, same as the Twenty-second pass's cleanup). Then
   deleted the resulting 25 backlog PRs one final time, confirmed via re-query that the company's
   PR list is back to exactly the 10 seeded ones (PR160-169) and zero Sales still match the
   trigger. One Sale (`6a6db3ad...`) still matches the *sale-level* condition but its own item's
   `storeQCStatus` isn't `'Goes to Purchase'`, so the back-fill's per-item loop correctly skips it
   and creates nothing — confirmed harmless (it wasn't among the 25 deleted, and the final count is
   clean), left as-is.
2. **The race condition itself** (`server/models/PurchaseRequest.js`, `server/controllers/
   purchaseRequestController.js`) — added a partial unique index on `{companyId, saleItemId}`
   (filtered to `saleItemId: {$ne: null}`, so it only constrains real per-item-flow PRs and can't
   collide with any other PR-creation path that leaves `saleItemId` null), mirroring the exact
   `{storeOrderId, materialCode}` partial-unique-index pattern this file already uses for the same
   reason. Converted the per-item branch's find-then-create into a single atomic
   `findOneAndUpdate(..., {upsert:true})` using `$setOnInsert`, with a duplicate-key error (code
   11000) swallowed as a no-op — the expected outcome when two concurrent calls race, now resolved
   at the DB level instead of producing two documents. The legacy whole-sale branch was left as
   find-then-create (not fully race-proof) — adding an equivalent unique index there would need to
   be scoped to `itemId`, which several *other*, unrelated PR-creation paths
   (`lowStockReorderCron.js`, `materialAvailabilityService.js`, `storeFlowService.js`) also write
   to with different semantics, so blanket-indexing it needs its own separate investigation; not
   done here since the actual observed duplicates were all on the per-item path, and this pass's
   root-cause fix already prevents these specific 11 Sales from ever hitting either branch again.

Verified with `node --check` on `PurchaseRequest.js` and `purchaseRequestController.js`.

## Twenty-fifth pass (2026-10-07) — Store receives per PO line now, not per PurchaseRequest

User flagged a real design gap via screenshots: Store's receive queue (`/store/purchases/requests`)
was the one piece of this whole redesign that never caught up to item-wise PR consolidation —
still a flat, unfiltered table of every PR with a standalone "Mark Received" per PR, while
Purchase's own side had already moved onto the PO-grouped Active POs/Order History view. Two
problems: un-ordered PRs cluttered the queue with nothing to act on, and PRs sharing one PO line
(one vendor shipment) showed as disconnected rows each independently "receivable" — the literal
pre-consolidation model, no longer matching reality once several PRs can share one line.

User's own correction to the first draft of this fix, and the actual design built: a vendor
shipment arrives as one physical chunk — there's no way to attribute part of a combined delivery to
one PR vs another. **The receive action itself is now one per PO line** (one item within one PO),
not one per PR. Submitting it loops every PR still open on that line through the exact same per-PR
side effects the old single-PR flow already used, fed a proportionally attributed share of the
combined quantity (by each PR's own ordered quantity as a fraction of the line's total) instead of
a number typed in separately for each. Serial number and warranty card are collected once per line
and stamped onto every PR in the loop. Pricing recalculation runs once after the loop, not once per
PR — confirmed via direct code reading that `recalculateItemPricing` is an Item-keyed computation
(full `PurchaseInvoice` collection aggregation + a document save + a cascade walk) that gives the
identical answer regardless of which PR in the loop triggers it, so running it N times for one
physical receipt was pure redundant work.

**Deliberately NOT changed**: `QCJob` stays 1:1 per `PurchaseRequest`, exactly as before. Widening
that to one combined job per line would have meant touching `qcController.js`'s Pass/Fail decision
logic — already complete and live-tested (QC multi-checkpoint redesign) and shared by every QC
source type, not just Purchase. Instead, each PR in the loop still gets its own QCJob, just with
its own proportionally attributed share of the combined quantity — so QC Pass can't double-credit
stock for one physical receipt, and the already-stable QC machinery needed zero changes.

**Backend** (`purchaseRequestController.js`):
- Extracted the post-save side effects of the old single-PR receive flow into two shared helpers —
  `applyReceiveSideEffects` (inventory item serial/warranty update, lead-time sample, QC job,
  auto-invoice, and — gated by a new `skipPricingRecalc` option — the pricing recalc) and
  `applyFabricationReceiveSideEffects` (the fabrication equivalent). `updatePurchaseRequestStatus`
  and `receiveFabricationPurchase` (the old per-PR routes) now just call these once each —
  unchanged external behavior, but only one implementation of "receive this PR" to maintain. Also
  closed a real pre-existing gap while extracting the fabrication helper: the single-PR fabrication
  path never called `recordLeadTimeSample` at all (only the plain-item path did), so fabrication
  PRs had been contributing zero samples to the vendor lead-time estimator — fixed, since the
  helper is now shared by both.
- Three new endpoints: `GET /api/purchase-requests/orders` (`getPurchaseOrdersForStore`, a thin
  pass-through to the already-exported `getPurchases` — Store can't reach
  `GET /api/accounts/purchases/orders`, which is gated to Accounts-only roles, so this mounts the
  same controller under Store's own existing permission domain instead of widening an
  Accounts-specific router's role list); `PATCH .../orders/:purchaseId/lines/:lineId/receive`
  (`receiveLineItems`, plain items, multipart for the shared warranty card); `PATCH
  .../orders/:purchaseId/lines/:lineId/receive-fabrication` (`receiveLineFabrication`, fabrication
  items, pre-filled dimension lines). Both resolve the line's PRs via `prIdsOf` (duplicated locally
  from `purchaseController.js`'s own helper — same reasoning `vendorRatingService.js` already
  documents for why it isn't imported across controllers), loop the shared per-PR helper with
  `skipPricingRecalc:true`, then recalculate pricing once at the end.
- `getPurchases` (`purchaseController.js`) — populate widened: `items.purchaseRequest`/
  `items.purchaseRequests` now also select `purchaseQuantity warrantyMonths
  fabricationDimensionLines quantity` (the new Store receive dialogs read this same endpoint and
  need these to pre-fill a combined form per line; By Vendor's Active POs view, the original
  consumer, just ignores the extra fields), and a new `.populate('items.item', 'name code unit
  purchaseUnit purchaseUnitType')` — lets the plain-item receive dialog compare the line's real
  stock unit against its `purchaseUnit` to decide whether to show conversion fields at all.
- **Found and fixed the same `ref:'Inventory'` typo bug as the Twenty-fourth/earlier passes**, this
  time on `Purchase.js`'s own `items[].item` — the real registered model name is `'Item'`. Never
  populated before (the field comment even said "added when goods are received into inventory,"
  stale relative to the new batch-creation flow that sets it immediately), so it never crashed —
  would have crashed the moment the new `items.item` populate above ran. Fixed before it could.

**Frontend**:
- `ByVendorTab.jsx`'s own `PurchaseOrderList` (the "group by PO, expand to lines" component
  powering Active POs/Order History) extracted into a new shared
  `components/accounts/purchase/PurchaseOrderList.jsx`, with two new optional props —
  `apiBase` (defaults to the original `/api/accounts/purchases/orders`, so `ByVendorTab.jsx`'s own
  usage is byte-for-byte unchanged behavior) and `renderLineAction` (an optional per-line render
  prop, unused by `ByVendorTab.jsx`, which stays read-only exactly as before).
- `pages/accounts/PurchaseRequest.jsx` (Store's route — confirmed via `App.jsx` that Accounts no
  longer reaches this component at all, retired when Purchase moved onto `PurchaseOutsourceHub`'s
  tabs back in the Twenty-second pass) rebuilt around three tabs: **Approvals Needed** (unchanged
  Check Inventory/Approve/Reject logic for Production/QC-sourced PRs, just filtered into its own
  view instead of mixed into a flat table — the only PR subset still shown as a flat list, since
  it's genuinely pre-PO); **To Receive** / **Received** (the shared `PurchaseOrderList`, pointed at
  the new `apiBase="/api/purchase-requests/orders"`, with `renderLineAction` opening one of two new
  combined-receive dialogs). Dropped entirely: the old single-PR "View PO" modal (confirmed it
  showed zero batch/multi-line context — redundant now that expanding a PO row already shows
  everything), and the dead Accounts-only PO create/edit form/handlers (`handleOpenCreatePO`,
  `handleSavePO`, vendor/inventory-item fetching for that form) — all unreachable now that this
  route is Store-only.
- Two new dialogs: `components/accounts/purchase/LineReceiveDialog.jsx` (adapted from the old
  single-PR Receive Item Modal — same serial/warranty/conversion fields, now collected once for
  the whole line, with a read-only list of every PR being marked Received) and
  `LineFabricationReceiveDialog.jsx` (adapted from the old single-PR `FabricationReceiveDialog.jsx`
  — pre-fills the dimension-line form as the union of every bundled PR's own ordered breakdown,
  summing quantities where two PRs request the identical dimensions via the existing
  `dimensionSignature` helper; the existing "+ Received a different size" flow needed no changes,
  it already supported adding arbitrary extra lines). The old single-PR dialogs
  (`FabricationReceiveDialog.jsx`, the inline Receive Item Modal, the old `/:id/status` and
  `/:id/receive-fabrication` routes) are left in place, now unreferenced by Store's UI — same
  "confirm live, then clean up legacy" pattern as RFQ Management/Vendor Bids' own removal in the
  Twenty-second pass, not deleted in this same pass.

Verified with `node --check` on every touched backend file (`purchaseRequestController.js`,
`purchaseController.js`, `Purchase.js`, `purchaseRequestRoutes.js`) and an `esbuild` bundle-check
on every touched/new frontend file (`PurchaseOrderList.jsx`, `ByVendorTab.jsx`,
`LineReceiveDialog.jsx`, `LineFabricationReceiveDialog.jsx`, `PurchaseRequest.jsx`). Not yet
live-tested in the browser — next step before this can be considered done.

**Follow-up, same day**: the "Approvals Needed" tab built above (for Production/QC-sourced PRs
awaiting Store's approve/reject) was removed again almost immediately — user confirmed none of the
three real PurchaseRequest creation paths (Sales/Order Form via `storeFlowService.js`, the Material
Flow low-stock cron, Store's own Material Transfer page) ever actually set `source` to
`'Production'`/`'QC'` in their real usage; confirmed directly in `storeFlowService.js`'s own
`PurchaseRequest.create` call (`requestFromDepartment: 'Store'`, no explicit `source`, defaulting
to `'Store'` per the schema). The gate exists in the data model (and the backend endpoints it
calls — `store-approve`/`store-reject`/`check-inventory` — are untouched) but nothing in this
company's actual workflow ever populates a PR that would need it. `PurchaseRequest.jsx` simplified
down to just the two PO-grouped tabs (To Receive / Received) — 4.0kb bundled, down from 23.8kb.
