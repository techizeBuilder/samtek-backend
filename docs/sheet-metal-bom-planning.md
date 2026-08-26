# BOM Management — Raw Material / Tool / Sheet Metal split + Sheet Metal planning

Written 2026-08-25. Implements the plan at a prior planning session (see chat history) covering: renaming
"Add Material" to "Add Raw Material", adding "Add Tool" and "Add Sheet Metal" buttons/tables to BOM Management,
and a whole new Sheet Metal planning + fulfillment + return + costing flow that replaces per-child-part sheet
cutting with a BOM-wide plan.

## Why

Today, every Child Part that needs a differently-cut piece from the same sheet metal item becomes its own
separate Store transfer, cut from its own separate stock piece — confirmed by reading `processRDRequest`'s
merge-by-`dimensionSignature` logic and `transferFabricationMaterialToProduction`: there is no nesting/sharing
logic anywhere. That's real, avoidable waste and doesn't match how sheet metal is actually cut in practice
(one sheet, laser-nested with several parts on it, not one sheet per part). The client's fix: R&D plans sheet
usage **once per (item + catalog dimension) across the whole BOM** — how much total area is really needed, how
many whole sheets that requires (their own real-world nesting estimate, which can exceed the raw theoretical
sum — kerf/margins are real) — and Store just ships whole sheets instead of making per-child-part cutting
decisions. What's left over after Production actually cuts is measured by Production (not guessed by Store
beforehand) and returned to stock. Scrap (bought-but-unused area) then feeds into the product's real cost.

## Decisions made with the client this round

- **The "required area can't be fulfilled" check is advisory, not blocking** — R&D can save a plan that falls
  short of the raw theoretical need; it's a warning, not a hard stop.
- **The required area is never shown to R&D before they enter their own planned area** — showing it first would
  anchor R&D into typing it back as if it were the real cutting target, when the real cutting area (kerf,
  margins, non-tiling shapes) is always somewhat more than the pure part-area sum. The warning only appears
  *after* R&D commits their own number and saves.
- **A Sheet Metal plan is required, not optional** — a BOM containing sheet-metal raw material lines cannot be
  locked until every distinct (item, catalog dimension) group used in it has a plan. No permanent fallback to
  per-child-part cutting is kept around for sheet metal items.
- **Store's fulfillment of a planned sheet-metal demand is a simple flat transfer of N whole sheets** — no
  per-cut dialog, no stock-variant cutting decision; the plan already decided everything.
- **The laser file upload is a laser-cutter file (for the physical cutting machine), not a documentation
  reference** — distinct in purpose from Child Part's "Design File" upload, even though the upload mechanics
  (`POST /api/rd/child-parts/upload-file`) are reused as-is.
- **No "which child parts does this sheet cover" selector** — unnecessary once you notice a plan is already
  scoped to one exact (item, catalog dimension) group; every BOM line sharing that exact signature is
  automatically covered, and leftover material can only ever be reused for the same item + same dimension
  anyway.
- **Leftover ownership**: Store no longer guesses a leftover at send time for a plan-driven demand. Production
  measures the REAL leftover after cutting and returns it — reusing the existing Return pipeline
  (`returnMaterialToStore` → `MaterialReturnLog` → Store's Pending Returns tab → `confirmReturn`), extended with
  a genuine dimension-entry step Production fills in (that pipeline already worked end-to-end for whole known
  sizes; it just never had a way to capture a newly-measured leftover shape before).
- **Auto-generated sheet-metal purchase requests are unaffected by this feature** — out of scope; this only
  covers R&D's planning + Store's fulfillment + Production's return + BOM costing.

## Data model

**`server/models/RDBOM.js`'s `MaterialSchema`** — two new fields, both server-derived (never trusted from the
client), set in `addMaterial`/`updateMaterial` (`rdController.js`) from the matched `sourceItem`:
```js
materialKind: { type: String, enum: ['raw', 'tool'], default: 'raw' }, // /tool/i.test(sourceItem.itemType)
isSheetMetal: { type: Boolean, default: false }, // sourceItem.isSheetMetal
```
Sheet Metal is **not** a third `materialKind` — a sheet metal item is still added via "Add Raw Material"
(`materialKind` stays `'raw'`); `isSheetMetal` is what routes it into its own tab/planning flow instead. Tool
items reach the BOM only via "Add Tool", whose `MaterialCodePicker` filters to `itemType` containing "tool"
(case-insensitive) — "Add Raw Material"'s picker filters the opposite way, so the two buttons can never create
ambiguity about which table a row belongs in.

**New `server/models/SheetMetalPlan.js`** — one plan per `{bom, itemCode, dimensionVariantId}` (unique index).
Values are all **per one unit of the finished machine**, same convention as every other `RDBOM.materials[]`
quantity; a Production Order's own `orderQuantity` is applied when a demand is actually pushed (WORKFLOW 2), so
one plan serves orders of any build size — the plan itself never caches a final sheet count for a specific
order. Key fields: `requiredAreaMm2` (server-computed sum of `bomDimensions.area` across matching BOM lines,
recomputed on every save — never trusted from the client), `plannedLengthValue`/`plannedLengthUnit`/
`plannedWidthValue`/`plannedWidthUnit` (R&D's own entry — actual Length x Width of the laser-cutting layout,
each independently unit-picked; **area is never entered directly**, only ever derived server-side as
`plannedAreaMm2 = plannedLength(mm) x plannedWidth(mm)` — this was corrected after an initial implementation
mistakenly collected a single pre-computed area figure instead of real dimensions), `sheetAreaMm2` (one catalog
sheet's own area, snapshotted from the Item's dimensionVariant at save time), `sheetsNeededPerUnit =
Math.ceil(plannedAreaMm2 / sheetAreaMm2)`, `warningBelowRequired` (advisory flag), `laserFileUrl`/`laserFileName`.

**`server/models/MaterialReturnLog.js`** — added `leftoverValues` (Mixed, Production's actually-measured
leftover — kept separate from the existing `bomDimensions`, which stays "what was originally
planned/demanded" and is untouched for every non-plan fabrication return) and `isSheetMetalPlanReturn` (Boolean).

**`server/models/ProductionOrder.js`'s `MaterialDemandSchema`** — added `sheetMetalPlanId` (ref
`SheetMetalPlan`, null for every non-plan demand) so Store's transfer screen and Production's demand list can
both tell a plan-driven sheet demand apart from a normal per-cut fabrication demand without re-deriving it.

## Backend flow

**`server/controllers/sheetMetalPlanController.js`** (new) — `getSheetMetalGroups` (every distinct sheet-metal
group on a BOM, each with server-computed `requiredAreaMm2`/`sheetAreaMm2` and whether a plan already exists —
powers both the picker and the Sheet Metal tab's summary list), `getSheetMetalPlans`, `saveSheetMetalPlan`
(upsert, recomputes everything server-side), `deleteSheetMetalPlan`. Routes mounted under
`/api/rd/boms/:bomId/sheet-metal-*` in `rdRoutes.js`, gated behind the existing `bomManagement*` permissions.

**`lockBOM`** (`rdController.js`) — before allowing lock, for every distinct sheet-metal group on the BOM,
verifies a `SheetMetalPlan` exists; rejects with a clear message listing which groups are still unplanned
otherwise.

**`processRDRequest` WORKFLOW 2** (`rdController.js`) — sheet-metal lines (`mat.isSheetMetal`) are excluded from
the normal per-line `mergedByCode` merge entirely and handled in a separate pass: grouped by
`{code, dimensionVariantId}`, looked up against the BOM's `SheetMetalPlan`s, and pushed as **one**
`materialDemands` entry per group — `quantity: plan.sheetsNeededPerUnit × buildQty`, `unit: 'Pieces'`,
`sheetMetalPlanId` set, `bomDimensions: {}` (no per-cut sizing left to track). Missing a plan here should be
unreachable in normal use (lockBOM's gate prevents it) — defensively logs and skips rather than crashing the
whole approval if it somehow happens.

**`transferSheetMetalPlanToProduction`** (new, `inventoryController.js`, sibling to
`transferMaterialToProduction`) — `POST /api/inventory/transfer-sheet-metal/:id`. Same atomic
"only deduct if enough stock" pattern as the existing flat transfer, just targeting one
`dimensionVariants[]` subdocument's `subStock` (`$inc: {'dimensionVariants.$.subStock': -transferQty}`) instead
of flat `Item.qty` — fabrication stock never lives in `Item.qty`.

**Store's Pending Requests tab** (`PendingRequestsTab.jsx`) — a demand with `sheetMetalPlanId` set reuses the
existing plain (non-fabrication) Transfer dialog instead of `FabricationTransferDialog` — same "how many"
input, just posts to the new endpoint. Distinctly simpler than the per-cut dialog, matching the "no cutting
decision left for Store" resolution.

**Production's Return flow** (`OrderManagement.jsx` + `returnMaterialToStore` + `confirmReturn`) — when the
demand being returned has `sheetMetalPlanId` set, the Return dialog gains a "Measured Leftover Area" field
(value + Area Unit, mirroring the shape Store's own outbound leftover entry already uses). `returnMaterialToStore`
converts that into `{thickness, width, length}` (thickness/width inherited from the original catalog variant —
never trusted from the client, same rule the outbound leftover entry already follows — only length is derived
from the entered area), stored as `MaterialReturnLog.leftoverValues`. `confirmReturn`'s fabrication-Excess
branch credits the `dimensionVariants[]` entry off `dimensionSignature(log.leftoverValues)` instead of
`dimensionSignature(demand.bomDimensions)` when present (a plan-driven demand's `bomDimensions` is empty, so it
would be a meaningless signature for this case) — every other (non-plan) fabrication return is byte-for-byte
unchanged.

**Scrap costing** (`itemPricingService.js`'s `resolveManufacturingItemCost`, the function that feeds
`Item.stdCost`/`mrp`/`salePrice`) — sheet-metal BOM lines are excluded from the normal per-line cost sum
entirely; instead, once per `{code, dimensionVariantId}` group, `computeSheetMetalPlanCost` adds
`sheetsNeededPerUnit × oneSheetWeightKg × weightUnitPrice` — the REAL cost of every whole sheet actually bought
(rounded up), not just the theoretical per-child-part area sum. This already includes scrap inherently
(`sheetsNeededPerUnit × one sheet's full weight` is always ≥ the sum of what the individual BOM lines in that
group need) — no separate "scrap cost" figure is computed or stored; using the real sheet cost in place of the
theoretical sum *is* the scrap-costing feature. **Not** extended to `computeBOMMaterialsMrpCost` (the simpler
MRP-based formula behind the Sales Order Form's BOM floor check) — that function has no fabrication-weight
awareness at all today (unlike this one), and giving it sheet-metal-plan awareness would be a separate,
non-trivial change to a function that gates real order submissions; left as a known gap, not silently expanded.

## Frontend

**`BOMCreationTab.jsx`** — "Add Material" renamed to "Add Raw Material"; new "Add Tool" button (same dialog,
different `MaterialCodePicker` item filter); new "Add Sheet Metal" button (opens `SheetMetalPlanModal`, does
**not** add a material row — sheet metal items are still added via "Add Raw Material"). The materials table is
now 3 tabs (Raw Material / Tool / Sheet Metal) sharing one `renderMaterialsTable` helper fed a different
filtered slice of `bom.materials` each — the client's explicit choice over one combined table with a type
column. The Sheet Metal tab also shows a plan summary (sheets/unit, warning badge, laser file link, Plan/Edit
button) sourced from `GET /api/rd/boms/:id/sheet-metal-groups`.

**`SheetMetalPlanModal.jsx`** (new) — group picker (when opened with no preset group) or pre-filled edit (when
opened from the Sheet Metal tab's "Plan Usage"/"Edit Plan"), Planned Length + Width inputs (each own unit, mm
base) + laser file upload/view, and a post-save-only warning banner (never shown before save, per the client's
anchoring concern).

## Follow-on (2026-08-25): two corrections from client review

**1. Planned dimensions, not a raw area figure.** The initial build had R&D enter a single "Planned Area" number
+ Area Unit directly. Wrong — the client's actual ask was for R&D to enter the real **Length × Width** of their
laser-cutting layout (each independently unit-picked, mm base — same convention as every other fabrication
dimension in this app), with the area always **derived** server-side (`plannedAreaMm2 = lengthMm × widthMm`),
never accepted directly from the client. Fixed in `SheetMetalPlan.js` (`plannedLengthValue`/`plannedLengthUnit`/
`plannedWidthValue`/`plannedWidthUnit` replace `plannedAreaValue`/`plannedAreaUnit`), `saveSheetMetalPlan`
(now uses `toMm` on each dimension instead of `toMm2` on one value), and `SheetMetalPlanModal.jsx` (two
dimension inputs instead of one area input, reusing `LENGTH_UNITS`/`toMm` from `client/src/lib/fabricationDims.js`).

Also added `formatAreaMm2` (same file) — displaying a small area like 110mm×110mm=12,100mm² as "0.012 m²" reads
like a rounding error even though it's correct; the helper auto-scales mm²/m² at the 1m² crossover.

**2. Scrap ≠ everything beyond the required area — that conflates it with the leftover-return feature.** The
initial scrap formula was `scrapAreaMm2 = (sheetsNeededPerUnit × sheetAreaMm2) − requiredAreaMm2` — this treats
*all* material beyond what the child parts strictly need as lost waste. Wrong: when rounding up to whole sheets
leaves a large, clean, **uncut** remainder (never touched by the laser at all), that's not scrap — it's exactly
the material the Production Return flow (see above) is built to hand back to Store whole. The client's own
diagram: a planned cutting layout splits into a **red** zone (the actual nested-parts area, where kerf/margins
around the parts are genuine unrecoverable scrap) and a **green** zone (the clean rounding remainder, returned
as usable leftover stock) — collapsing both into "scrap" overstates it dramatically whenever the planned area is
much smaller than one catalog sheet (in one test case, a 110×110mm layout against a 3.19m² sheet had ~99.9% of
the sheet wrongly counted as scrap).

Corrected in `computeSheetMetalPlanCostBreakdown` (`itemPricingService.js`) to compute two separate quantities:
```js
const scrapAreaMm2 = Math.max(0, plannedAreaMm2 - requiredAreaMm2);       // red zone: real waste
const leftoverAreaMm2 = Math.max(0, totalBoughtAreaMm2 - plannedAreaMm2); // green zone: returnable remainder
```
`sheetCost` (what `resolveManufacturingItemCost` folds into `Item.stdCost`) is unaffected by this split — it's
still every whole sheet actually bought, unchanged — the identity `sheetCost = requiredCost + scrapCost +
leftoverValue` holds exactly (verified numerically), so the leftover's value is still counted as spent (it was
purchased, even though it's not lost) rather than silently dropped from the BOM's total cost. `getSheetMetalGroups`
now returns `leftoverAreaMm2`/`leftoverValue` alongside `scrapAreaMm2`/`scrapCost`; `BOMCreationTab.jsx`'s Sheet
Metal tab shows both as separate stat tiles (5 area figures per group: catalog / required / planned / scrap /
leftover), and the Production Cost card shows both a Scrap Cost and a Leftover Value tile, both folded into
Total BOM Cost.

## Known gap / not built this round

- `computeBOMMaterialsMrpCost` (Sales Order Form BOM floor check) doesn't account for sheet-metal scrap cost —
  see the Scrap costing section above.
- No UI to delete a `SheetMetalPlan` yet (`deleteSheetMetalPlan` exists server-side, unused client-side) —
  low-risk to add later if R&D needs to redo a group from scratch instead of just re-saving over it.
- The leftover split assumes Production actually returns the full clean remainder via the Return flow — nothing
  enforces that happens; `leftoverValue` is a planning-time estimate of what *should* come back, not a
  reconciliation against what actually did.
