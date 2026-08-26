# Store Orders — BOM material availability + auto purchase requests

Written 2026-08-25. Implements the plan agreed in a planning session (see chat history) covering: computing, at
Order Form submission, whether an In-house Manufactured item's BOM raw materials are actually in stock, auto-
raising pre-approved Purchase Requests for any shortfall, and surfacing both as hover tooltips on Store Orders.

## Why

Store Orders (`/store/orders`) only ever checked the *finished product's* own stock (`Item.qty` vs needed qty)
— nothing looked at an in-house item's BOM. Now that BOM data is trustworthy (Raw Material/Tool/Sheet Metal
split + Sheet Metal Plans, built earlier this session), the client wanted Store to see, per in-house line item,
which BOM materials are available vs. which need purchasing — computed automatically, never something Store has
to trigger themselves ("Store should only ever view pre-computed data and act when needed").

## Purchase-quantity math — three tiers

1. **Plain (non-fabrication) raw materials + tools** — flat `Σ(quantity) × buildQty` vs `Item.qty`.
2. **Sheet Metal groups** — already solved by the Sheet Metal Plan feature: `SheetMetalPlan.sheetsNeededPerUnit
   × buildQty` vs that dimensionVariant's `subStock`.
3. **Non-sheet-metal, length-based fabrication groups (new)** — bars/pipes/tubes/angles/channels/beams
   (`calcType: 'perMeter'`, and defensively the legacy `'lookup'` beam/channel keys). Confirmed via direct
   research that neither `resolveFabricationLines` nor `processRDRequest`'s WORKFLOW 2 merge ever combine
   different cut lengths of the same catalog dimension — both key on the *full* dimension signature (length
   included) deliberately, so two different lengths always stay separate demand/purchase lines today. This
   feature adds the missing combining step: BOM lines sharing `{code, dimensionVariantId}` have their lengths
   summed (`Σ(bomDimensions.length × quantity) × buildQty`), then `piecesNeeded =
   Math.ceil(totalLengthNeededMm / catalogPieceLengthMm)` — same shape as the Sheet Metal area-combining math,
   for length instead of area. See `lengthFabricationGroupsFromBOM` in the new service file.

## Architectural decision: awaited, not fire-and-forget (for now)

`upsertOrderForm` (`orderFormController.js`) was already a long, fully-synchronous endpoint before this change
— confirmed by direct read that everything through the existing `autoCheckAllOrderItems` step (a sequential
per-item loop with up to 6-10 DB round-trips per item) is `await`ed before the response goes out. There was a
real question of whether adding more synchronous work here is safe.

**Decided: ship this round as a plain `await`ed step** (same shape as the `autoCheckAllOrderItems` try/catch
right next to it — log-and-continue on error, never fails the whole submission), and **measure real added
latency in actual use** before reaching for async complexity. If it turns out to meaningfully slow the endpoint,
switching to fire-and-forget is a one-line change at the single call site in `upsertOrderForm` — the service
function itself (`computeMaterialAvailabilityForOrder`) doesn't change either way. The fire-and-forget idiom to
use if/when that happens is already established elsewhere in this codebase:
`purchaseInvoiceController.js`'s `recalcPricingForInvoiceItems(invoice).catch(e => console.error(...))`, called
without `await`.

By the time the new call point is reached, `Sale.items[]` is guaranteed to exist — `autoCheckAllOrderItems` →
`ensureSaleForOrder` already creates it synchronously as of this session's own auto-check-on-submit feature
(this corrects an earlier assumption in this codebase's history that `Sale` is only lazily created on Store's
manual "Check" click).

## Concurrency safety — no load-then-save race

A real concern raised directly: in a multi-user app, could this feature lose data if another request touches
the same `Sale` document concurrently (e.g. Store clicking "Check" on the same order while this computation is
still running)? The naive approach — `Sale.findOne()` → mutate the JS object → whole-document `.save()` — is a
genuine lost-update risk: a later `.save()` from either side can silently overwrite the other's changes.

**Fixed by never doing that.** Every write in `computeMaterialAvailabilityForOrder`
(`server/services/materialAvailabilityService.js`) is a single, targeted, atomic operation:
```js
await Sale.updateOne(
  { _id: sale._id, 'items._id': saleItem._id },
  { $set: { 'items.$.materialAvailability': { computedAt: new Date(), available, needsPurchase } } }
);
```
Matched by the sale item's own stable `_id` (never an array index), touching only that one field — immune to
whatever else concurrently touches the rest of the `Sale` document, regardless of how many users are active.

`PurchaseRequest` creation is a plain insert (no shared-document race), but the dedup check (is there already an
open auto-raised request for this order+material?) is inherently check-then-create — the same narrow
double-submission race the existing Material Flow low-stock cron (`lowStockReorderCron.js`) already accepts.
Hardened here with a real DB constraint rather than just hoping the check-then-create window stays narrow:
```js
// PurchaseRequest.js
purchaseRequestSchema.index(
  { storeOrderId: 1, materialCode: 1 },
  { unique: true, partialFilterExpression: { autoGenerated: true, storeOrderId: { $exists: true } } }
);
```
**Important scoping detail**: the partial filter requires `storeOrderId: {$exists: true}` in addition to
`autoGenerated: true` — this was deliberate, to avoid silently breaking the *existing*, unrelated
`lowStockReorderCron.js` feature. That cron's own auto-generated requests are Item-scoped (`reorderItemId`, no
`storeOrderId` at all) and a single fabrication Item can legitimately have several open auto-PRs sharing the
same `materialCode` (one per flagged dimension variant) — without the `storeOrderId` qualifier, this new index
would have collided with that already-working behavior the very first time a fabrication item had two low-stock
dimensions flagged at once.

On a genuine duplicate-key conflict (two near-simultaneous runs for the same order+material), `create()` throws
error code `11000`; the catch block looks up and reuses the already-created request's id rather than erroring
the whole computation.

## Data model

**`server/models/Sale.js`'s `saleItemSchema`** — new `materialAvailability` field, sibling to the existing
`isAvailableInInventory` (which is untouched — that's the finished-product check; this is the BOM-material
check):
```js
materialAvailability: {
  computedAt: { type: Date, default: null },
  available: [{ code, name, neededQty, availableQty, unit }],
  needsPurchase: [{ code, name, neededQty, availableQty, shortfallQty, unit, purchaseRequestId }],
}
```
`code` is the plain Item code for Tier 1 (plain materials/tools), or the composite `${itemCode}#${dimensionVariantId}`
key for Tiers 2/3 (Sheet Metal / length fabrication) — same trick `rdController.js`'s sheet-metal WORKFLOW 2
already uses to let string-equality matching work unchanged downstream, applied here to `PurchaseRequest.materialCode`
too so each distinct catalog dimension gets its own dedup-able request. `computedAt: null` (the default, and what
every pre-existing sale item has) means "not computed yet" — the frontend simply omits the tooltip in that case,
no loading state.

## Backend

**New `server/services/materialAvailabilityService.js`**, exporting `computeMaterialAvailabilityForOrder(order)`
— the full three-tier check + auto-PR-raising + atomic-write logic described above. Reuses, never reimplements:
- `sheetMetalGroupsFromBOM` (`sheetMetalPlanController.js`) for Tier 2's grouping.
- `resolveFabricationLines` (`purchaseRequestController.js`) for both Tiers 2 and 3's Purchase Request weight/
  price resolution — it's category-agnostic (just `{values, quantity}` in, weight/price out), so the exact same
  call works for a sheet or a length-based shape.
- `generatePurchaseRequestId` (`storeFlowService.js`) for request IDs — same generator every other creation
  path already uses.

**`server/controllers/orderFormController.js`'s `upsertOrderForm`** — one addition, right after the existing
`autoCheckAllOrderItems` try/catch block, in the same shape:
```js
try {
  const materialAvailabilityResult = await computeMaterialAvailabilityForOrder(order);
  console.log(`📦 [OrderForm] Material availability for ${order.orderCode}:`, materialAvailabilityResult);
} catch (materialAvailabilityErr) {
  console.error('❌ Error computing material availability for Order Form items:', materialAvailabilityErr);
}
```
No other change to this function — request/response shape, validation, and every existing step are untouched.

**`server/controllers/orderController.js`'s `getOrderTracking`** (backs Store Orders' list fetch) — confirmed
its `Sale.find(query)...lean()` call has no `.select()` projection excluding fields, so the new
`materialAvailability` field flows through to the frontend automatically; no change needed there.

## Frontend

**`client/src/pages/store/StoreOrders.jsx`**:
- `getRowItems` threads `si.materialAvailability` through onto each row alongside the existing per-item fields.
- Two new hover-popover badges per In-house row item (only rendered once `materialAvailability.computedAt` is
  set): "📦 Available (N)" and "🛒 Needs Purchase (N)" — reusing the exact `group`/`group-hover` Tailwind
  popover pattern already established in `PackedOrders.jsx`'s "Packed Machines" tooltip (hand-rolled, not
  Radix — confirmed this is the house convention for this specific visual). Each needs its own `group` wrapper
  since Tailwind's `group-hover` scoping is per nearest ancestor.

## Explicitly out of scope / untouched

The existing Material Handshake purchase mechanism (`/store/material-issues` — `PendingRequestsTab.jsx`'s
Purchase tab, `RFQManagement.jsx`, the `PurchaseRequest` model/flow) was confirmed working before this change
and is completely untouched — new auto-raised requests are built to match its existing field shape exactly (same
convention `lowStockReorderCron.js` already established), so they appear and function identically to a manually-
raised one with zero changes to that screen.

## Known gap / follow-up

- Real end-to-end latency has not yet been measured against a live database — this is the explicit next step
  before deciding whether the awaited call site needs to move to fire-and-forget (see the architectural
  decision above).
- No UI surfaces the auto-created `PurchaseRequest`s as a summary anywhere on Store Orders itself — Store finds
  them exactly where they'd find any other Purchase Request, on `/store/material-issues`.
