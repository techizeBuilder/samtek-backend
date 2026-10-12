# Purchase Workflow Changes — Discussion (2026-10, pending client approval)

**Status: Changes 1 and 2 are BUILT (2026-10-07) — the user authorized these two specifically
ahead of client sign-off on the rest ("that will get change anyway"). Changes 3 and 4 (the
merged By Item/By Vendor screen, and the "Quote"→"PO" label) are still NOT approved and NOT
built** — wait for the user to say the client has given a green light on those before starting.
This doc exists so that when they do, work can start directly from it without the user
re-explaining everything.

Client-facing version (Hindi explanation + an interactive dummy-data preview of the merged
screen): https://claude.ai/artifact/EdKqLHmALnrULMngxYdHFd

This builds **on top of** the existing item-wise PR consolidation design (Eighteenth pass,
`procurement-purchase-restructure-changes-2026-10.md`) — the `ItemQuoteGroup`/`VendorBid`/
`createPurchase` batching machinery described there is not being rebuilt. Everything below is an
interaction/UI redesign layered on it, confirmed explicitly by the user ("this all changes i told
you" — nothing structural underneath changes beyond what's listed here).

## Change 1 — Vendor Master: remove Charges — **BUILT 2026-10-07**

**Was**: `Supplier.charges` carried a per-vendor default Charges list (name, Flat ₹ / % of order,
value — built 2026-10-03, Vendor Master round 2), shown/edited on the Vendor Master form.

**Built**: the Charges UI (and its backing `formCharges` state/handlers) was removed from
`client/src/pages/accounts/VendorMaster.jsx` entirely — Purchase can no longer add or edit a
vendor's charges through Vendor Master.

**Deliberately NOT touched, and this matters**: `Supplier.charges` (the schema field),
`services/vendorChargesService.js`'s `computeVendorCharges`, and its 4 backend call sites
(`purchaseQuoteController.createQuote`, `itemQuoteGroupController.createQuoteForGroup`/
`syncBidToGroupQuantity`, `rfqController.submitBidByToken`, `purchaseController.createPurchase`)
are all untouched. The user explicitly deferred "charge in PO" (the replacement — manual charge
entry at PO/quote time, part of Change 3) until that bigger redesign is approved. Ripping out the
backend now, with no replacement built yet, would have meant every vendor with charges already
configured silently stops getting them applied. Leaving it alone means: any vendor that already
has `charges` data keeps having it applied exactly as before; the only change is nobody can add or
edit that data anymore via Vendor Master. When Change 3's "charge in PO" ships, this is the point
to revisit `Supplier.charges` and the 4 call sites for real removal/replacement.

## Change 2 — Vendor Master: decouple creation from Product/Service assignment — **BUILT 2026-10-07**

**Was**: creating a vendor included picking Products (from Inventory/Product Master/Motor Master)
and Services (Process Template steps marked Out Source) in the same create form — a tabbed picker
(Products/Services/Tags) built 2026-09-25, rendered unconditionally in both Add and Edit.

**Built**: `VendorMaster.jsx`'s single shared form already had a mode flag (`editingVendor` — null
on Add, the vendor doc on Edit) that just wasn't consulted by the JSX body. The whole
Products/Services picker block is now wrapped in `{!editingVendor ? <placeholder note> : <picker>}`
— Create shows a short note ("save this vendor first, you'll assign Products & Services right
after") instead of the picker; Edit is unchanged. **UX addition beyond the literal ask**: on a
successful Create, the same dialog now auto-reopens in Edit mode for the vendor that was just
created (`mutation`'s `onSuccess` calls `openEdit(data.supplier)` when `editingVendor` was null at
submit time) — Step 2 is one click away instead of requiring Purchase to go find the new vendor in
the list. Still two distinct requests (POST then a later PUT), matching the two-step design
literally.

**Backend hardening**: `server/controllers/supplierController.js`'s `createSupplier` had no field
whitelist at all (full `req.body` spread). Added explicit `delete supplierData.suppliedItems` /
`delete supplierData.services` before `cleanVendorCoverage` runs, so creation can never carry
product/service assignment regardless of what's sent — the frontend already won't send them from
Create mode, this is defense-in-depth. `updateSupplier` needed no change — `cleanVendorCoverage`
already treats an absent/non-array `suppliedItems`/`services` as "not being edited, leave alone,"
exactly Edit mode's correct behavior.

Verified with `node --check` on `supplierController.js` and an `esbuild` bundle-check on
`VendorMaster.jsx`. Not yet live-tested in the browser.

## Change 3 — Merge By Item + By Vendor into one screen

Working name: **"Purchase Orders"** (user's placeholder, pending the client naming it).

One screen, left/right split, replacing the current two separate tabs.

**Left (By Item)** — items needing purchase. The big behavior change from today:

- **Every open PR for an item is selected by default now, not zero.** Today a card starts with
  nothing selected until Purchase manually opens "Select requests" and checks boxes
  (`ItemQuoteGroup`'s current create flow). Going forward, the moment a card has 1+ pending PRs,
  all of them should already be selected — same "Select requests" modal stays as the entry point
  for removing a PR (hold it back) or re-adding one later.
- **Everything else about selection is unchanged**, confirmed explicitly by the user: the
  confirm-dialog before changing selection once any vendor has been quoted (Eighteenth pass, point
  5), the quantity refresh-then-adjust cycle on selection change, the binary-commitment rule
  (selected = processed the moment a PO is created, unselect *before* PO creation to defer a PR).
  This is a default-state flip, not new selection logic.
- The below-3-vendor-on-file warning stays exactly as it is today (already built, Second
  correction pass) — confirmed by the user as the right threshold ("yes 3").

**Right (By Vendor)** — vendor list, quoting, charges, PO creation.

- On fresh load (nothing selected on the left): every vendor capable of supplying *something*
  purchasable shows.
- The moment Purchase selects item(s) on the left (multi-select, confirmed — "we selected three
  item from the list"), the right side filters to vendors covering at least one selected item, and
  **tiers them by coverage count**: vendors covering all N selected items first (with a badge
  showing the count, e.g. "3/3"), then N-1, down to 1. Vendors covering none of the selected items
  drop out of view entirely.
- Within a tier (e.g. two vendors both covering 2 of 3), the user explicitly wants **a real
  filter/sort control on the right**, not a hardcoded tie-break rule — user-selectable sort (price,
  rating, delivery — exact option set not yet nailed down) reorders vendors inside each tier.
  Confirmed this is the resolution to the open tie-break question, not a fixed rule.
- Which vendors can even supply a given item is driven by **Vendor Master's own product/service
  assignment** (Change 2's Step 2), not an ad hoc per-quote resolution — i.e. the right side's
  vendor pool for an item is "vendors Vendor Master says supply this item," matching the client's
  own framing ("vendor with list of item in it which is listed in vendor master for that vendor").
- This is where quoting, charges (Change 1), and PO creation actually happen.

So: **left = information + filter, right = the actual transaction.**

**Likely touches**: `ByItemTab.jsx` and `ByVendorTab.jsx` likely merge into one new component
(exact file/route structure not decided); `itemQuoteGroupController.js` needs a way to
auto-populate a group's initial selection with every open PR for that item (today's `POST /` create
endpoint expects the caller to supply the selection); vendor-eligibility-per-item needs to read
Vendor Master's product/service mapping directly rather than (or in addition to) however it's
resolved today; the coverage-tiering/sort logic is new, frontend-side at minimum.

## Change 4 — Label: "Quote" → "PO"

Wherever a "Quote" button triggers the vendor quote-entry flow — the standalone PRs tab and what's
now the merged Purchase Orders screen — relabel it "PO". Confirmed both locations via screenshot;
no other renaming implied.

## Explicitly confirmed NOT changing

- The underlying `ItemQuoteGroup`/`VendorBid`/`Purchase` batching data model (Eighteenth pass) —
  this is UI/interaction redesign only.
- The below-3-vendor warning's threshold and placement (already correct as built).
- The confirm-dialog-on-selection-change-after-quote and quantity-refresh-then-adjust behavior
  (Eighteenth pass, points 4-5) — only the *default* starting selection changes.
- The Store receive flow (Twenty-fifth pass, one receive per PO line) — unrelated, not discussed in
  this conversation, not affected by anything above.

## Open questions for build time (not blocking on the client, can resolve during planning)

- Exact UI/route shape for the merged screen (new component vs. heavily modified existing ones).
- Where/how an `ItemQuoteGroup`'s initial "select everything" actually gets triggered — lazy-create
  on first read of the By Item section, or an explicit auto-select call from the frontend the
  moment a card with no Open group renders.
- The exact sort/filter option set for the right-side vendor tier ordering (price/rating/delivery
  confirmed as the general idea; the user hasn't picked a final set).
- Whether "Vendor Master's product/service mapping" is already a complete, queryable source for
  "which vendors supply item X" today, or needs its own lookup built — needs checking against the
  real `Supplier.suppliedItems`/`Supplier.services` fields before assuming either way.
