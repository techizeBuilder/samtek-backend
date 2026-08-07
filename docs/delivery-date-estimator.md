# Delivery Date Estimator

## What it does

Lets Sales give a customer a realistic delivery date estimate *before* an order is placed, based on current stock, current production/purchase backlog, and historical average lead times — instead of guessing.

**Where:** Leads page (`/sales/leads`) → "Estimate Delivery Date" button, next to "Add Leads". Opens a dialog that searches items, lets Sales pick one or more (an order can have several different items), enter quantities, and get back one combined delivery date for the whole order plus a full breakdown per item.

The item list only loads once the dialog is opened — nothing is fetched on the Leads page itself.

---

## Code locations

**Backend** (`Samtek-Backend/Samtek-Backend/server/`):

| File | What's in it |
|---|---|
| `models/ItemLeadTimeStats.js` | The collection schema — one doc per `(company, itemCode, pathType)`. |
| `utils/leadTimeStats.js` | `recordLeadTimeSample()` — the averaging update logic (warm-up running mean, then EMA). Everything about "how the average changes" lives here, and only here. |
| `controllers/productionMfgController.js` | `approveQC()` — fires `recordLeadTimeSample()` per physical unit when a `ProductionOrder` completes. |
| `controllers/purchaseController.js` | `receivePurchase()` — fires `recordLeadTimeSample()` per item when a PO is fully received. |
| `controllers/deliveryEstimateController.js` | `listEstimableItems()` (search list) and `predictOneItem()` / `predictItems()` (the actual date calculation — stock check, BOM traversal, queue sum, breakdown). This is where the calculation logic in the next section lives. |
| `routes/deliveryEstimateRoutes.js` | The two API routes, wired to the controller above. |
| `index.js` | Where those routes get mounted, at `/api/delivery-estimate`. |

**Frontend** (`Samtek-Frontend/Samtek-Frontend/client/src/`):

| File | What's in it |
|---|---|
| `components/sales/DeliveryEstimatorModal.jsx` | The whole search → select items → predict → breakdown UI. |
| `pages/sales/Leads.jsx` | Just the "Estimate Delivery Date" button and the `isEstimatorOpen` state that opens the modal above. |

---

## The calculation, per item

Checked in this order, stopping as soon as an answer is found:

1. **Enough finished stock already?** If `Item.qty >= quantity requested`, the item is ready almost immediately — just add Store's flat processing buffer. Nothing else is checked.

2. **Not enough stock, and the item is bought from a vendor and resold as-is** (`Item.internalManufacturing === false`): date = today + Store buffer + this item's average purchase lead time (Purchase path).

3. **Not enough stock, and the item is manufactured in-house** (`Item.internalManufacturing === true`): two things can delay the *start* of production, and only the worse of the two counts — they happen at the same time, not back-to-back:
   - **Production queue** — production capacity is shared across machine types, not siloed per machine, so this counts *every* `ProductionOrder` company-wide that isn't yet `Completed` (`Pending`, `BOM Pending`, `In Progress`, and `On Hold` all count — anything not finished is still real unfinished workload standing ahead of a new order), regardless of what machine it's for. Each one ahead contributes **its own item's** average production time (not the new item's, and not prorated for partial progress on in-progress orders — treated flat), summed into a total workload-ahead figure. No attempt is made to model parallel teams — this deliberately treats production as working through that total sequentially (see "Design decisions" below).
   - **Raw material shortage** — pull the machine's BOM (`RDBOM`, matched via `RDMachine.code === Item.code`). For each material, check if there's enough in stock for the shortfall quantity (`material.quantity × shortfall units`). Any material short needs to be purchased first; combine multiple short materials with **max, not sum** (Purchase can request several materials in parallel — see "Design decisions" below).

   `startDelay = max(queueWaitDays, materialDelayDays)`, then add this machine's own production time on top: `date = today + Store buffer + startDelay + (avgProductionDaysPerUnit × shortfall)`. `avgLeadDays` for the Production path is a genuine **per physical unit** figure (see "Update triggers" below), so both the queue and the final build time scale with how many units are actually needed — a 2-unit shortfall isn't charged the same time as a 1-unit one.

   Example: queue has 2 pending Generator orders (avg 4 days/unit, 1 unit each) and 1 Aata Machine order (avg 6 days/unit, 2 units) → queue delay = 4×1 + 4×1 + 6×2 = 20 days. A new Spice Machine quote needing 2 units, with no stock, avg 5 days/unit → production time = 5×2 = 10 days. `startDelay = max(20, materialDelayDays)`, total = Store buffer + startDelay + 10.

**Order-level date** = the *latest* of every selected item's own date (the whole order ships together, same rule used throughout Dispatch Planning/Execution).

Every prediction returns a full breakdown (each contributing step + days), not just a final date — shown to Sales in the UI along with a disclaimer that this is an estimate, not a guarantee.

---

## Data model

### `ItemLeadTimeStats` (new collection)

One record per `(company, itemCode, pathType)`. `pathType` is `'Production'` or `'Purchase'` — mirrors `Item.internalManufacturing`, kept explicit rather than inferred so history stays correct even if that flag changes later.

```js
{
  company, itemCode, itemName,
  pathType: 'Production' | 'Purchase',
  avgLeadDays,     // self-updating average — see below
  sampleCount,
  lastUpdatedAt,
}
```

Never recomputed from raw order/purchase history — it's a running number, updated incrementally:

- **First 10 samples**: plain running mean (`avg += (newValue - avg) / count`) — avoids one noisy early data point swinging the average wildly.
- **After 10 samples**: exponential moving average (`avg += 0.25 × (newValue - avg)`) — so the number tracks *current* throughput (new machine, vendor change, staff turnover) instead of being dragged down by years of old data.

Both updates are O(1) — no raw history is ever stored or scanned, which is what keeps predictions fast even as the company's order history grows.

### Update triggers

| Event | Where | What gets recorded |
|---|---|---|
| `ProductionOrder` reaches `Completed` | `controllers/productionMfgController.js`, in `approveQC` (the step-completion handler), guarded on the transition into `Completed` | **One sample per physical unit**, not one for the whole order: for each unit (`order.processes` + each `order.extraUnits[].processes`), duration = that unit's own *first step's `startedAt` → last step's `completedAt`* (falls back to the date-only `startDate`/`endDate` strings for any step started before these fields existed). A 3-unit order completing contributes 3 separate samples, each reflecting that unit's own real build span — so a staggered build (unit 2 finishing weeks after unit 1) doesn't inflate the average, and `avgLeadDays` stays a genuine per-unit figure the estimator can multiply by however many units a new quote needs. |
| `PurchaseRequest` reaches `Received` | `controllers/purchaseRequestController.js`, `updatePurchaseRequestStatus`, inside the existing `status === 'Received' && oldStatus !== 'Received'` block (reuses the `inventoryItem` that block already resolves) | `request.receivedAt - request.requestDate`, one sample for `pathType: 'Purchase'`, keyed by `request.materialCode` (falling back to the resolved Inventory item's own `code` if `materialCode` wasn't set on the request) |

Both are wrapped in try/catch and never block the underlying action (production completion / purchase receipt still succeeds even if the stats update fails).

**Note on the Purchase hook's location**: the hook originally lived in `controllers/purchaseController.js`'s `receivePurchase` (`POST /purchases/orders/:id/receive`) — that endpoint has **zero frontend callers**, it's dead code, so the hook there never fired. The real flow Store uses to mark a purchase request Received is `PATCH /purchase-requests/:id/status` → `updatePurchaseRequestStatus`, called from `PurchaseRequest.jsx`. If you're hunting for why an item still shows "no history yet" after a real receive, confirm the fix is still in `purchaseRequestController.js`, not `purchaseController.js`.

### What's calculated live, never stored

- **Production queue depth** — fetched fresh on every prediction request (`ProductionOrder.find({ status: { $ne: 'Completed' } })`), since it changes constantly.
- **Purchase queue** — deliberately *not* modeled at all. Vendors can be sent multiple requests in parallel, so there's no serialized bottleneck to count the way there is for a production line.
- **Store's own processing time** — a flat constant (currently 1 day), not tracked or averaged. Store triage is a quick administrative step, not treated as a real bottleneck worth its own timing pipeline.

---

## API

- `GET /api/delivery-estimate/items?search=&page=` — lightweight, paginated list for the search panel (item code/name/stock/path/avg lead time only, no BOM traversal). 50 items per page; fetches 51 and slices to detect `hasMore` instead of a separate count query. Search is server-side and always covers the full catalog, independent of how many pages have been loaded. The frontend uses `useInfiniteQuery` with a "Load more items" button that appends pages until `hasMore` is false.
- `POST /api/delivery-estimate/predict` — body `{ items: [{ itemCode, quantity }] }`, returns per-item breakdowns + combined order date + disclaimer text.

Both require authentication (`authenticateToken`); no additional role restriction.

---

## Design decisions worth knowing about

- **Production is per-unit normalized; Purchase is deliberately flat, not per-unit.** Production records one sample per physical unit (see above), and the estimator multiplies by shortfall quantity when predicting. Purchase is different by design: the vendor ships the whole ordered quantity in one shipment, so however many units are short (1 or 50), it's still one purchase request and one delivery — `avgLeadDays` (Purchase) is recorded as the PO's raw duration regardless of quantity, and the estimator adds it flat, never multiplied by shortfall. This is a confirmed design decision, not an approximation.
- **`DEFAULT_LEAD_DAYS_FALLBACK = 7`** is used whenever an item has no completed history yet (`hasHistory: false` in the response). The UI must show this as a rough default, not a measured number — it does.
- **Production queue deliberately doesn't model parallel teams.** Even though `ProductionTeam` / `assignedTeam` exists on process steps, the queue-wait calculation treats the whole pending-orders backlog as one sequential total, not divided by however many teams could theoretically work in parallel. Explicitly chosen over the parallel-capacity alternative (divide the total by active team count) to keep the estimator simple and easy to reason about — if production genuinely runs many orders simultaneously in practice, this will overestimate the wait, and the divisor approach would need to be revisited.
- **Material shortage combination uses `max`, not `sum`**, on the assumption that Purchase can request several different materials in parallel rather than one at a time. If that assumption is wrong (e.g. one buyer handling requests sequentially), this would need to change to something closer to a sum.
- **The displayed `totalDays` uses `Math.ceil`, matching `addDays`, not `round1`.** A delivery date can't be fractional — `addDays` always rounds a raw total (e.g. `5.004`) UP to the next whole day (`6`) before adding it to today. The displayed total has to use that same `Math.ceil`, not `round1`'s round-to-nearest-0.1 — otherwise the UI could show "~5 days" right next to a date that's actually 6 days out, which is exactly what happened before this was caught during manual verification. Per-step breakdown lines (queue wait, material delay, etc.) still use `round1` for readability — only the final total/date pair needs to agree exactly.
- **Production's `ProcessStepSchema.startDate`/`endDate` are date-only strings** (`today()` = `YYYY-MM-DD`), kept for existing UI display — they were originally also used for the lead-time duration calc above, which meant same-calendar-day production (e.g. fast dev/test cycles) always measured as exactly 0 days, and anything straddling midnight measured as exactly 1 day, regardless of real elapsed time. Fixed by adding separate precise `startedAt`/`completedAt` `Date` fields to the same schema, stamped alongside `startDate`/`endDate` at the same two call sites (`startProcess`, `markProcessComplete`); the lead-time calc now reads those instead (falling back to the string fields only for steps started before this fix shipped). Purchase's `requestDate`/`receivedAt` were already real `Date` fields and never had this problem.
- **The BOM material join key is `material.code` → `Item.code`.** `RDBOM.materials[].item` is just a display name snapshot, not a live reference — `code` is the reliable join, confirmed against the schema's own comment describing it as captured "when the material code matched" the Product Master.
