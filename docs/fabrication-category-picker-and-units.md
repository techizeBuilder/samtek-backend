# Fabrication Master — Category Picker, Dimension Calculator, Purchase/Used/Receive Unit

Handoff notes for whoever picks up work on Fabrication Master next. Written 2026-08-19 alongside the change
that replaced the plain Category `<select>` with a two-step visual picker and added Purchase/Used/Receive
Unit fields end-to-end (Fabrication Master → Inventory Add Item autofill).

## What changed and why

R&D asked for the "Add Fabrication Item" Category field to work like a standard steel-shape weight
calculator app: pick a shape from an icon grid, then fill in a dimension calculator (material → density,
shape-specific fields, live weight preview) instead of a plain dropdown + inline number fields. They also
asked for Purchase Unit / Used Unit / Receive Unit on the Fabrication Master catalog item, auto-filling into
Inventory's "Add Item" the same way dimensions already do when a Fabrication Item is picked there.

## The two-modal flow

1. **`CategoryPickerModal`** (`client/src/components/fabrication/CategoryPickerModal.jsx`) — 11-tile grid:
   Round Bar, Pipe, Square Bar, Hexagonal Bar, Square Tubing, Beam, T-Bar, Channel, Angle, Flat Bar, Sheet.
   Renders from `FABRICATION_CATEGORY_GROUPS` (see below).
2. **`DimensionCalculatorModal`** (`client/src/components/fabrication/DimensionCalculatorModal.jsx`) — opens
   after a tile is picked. Shows a cross-section line diagram (`ShapeDiagram`), Material dropdown (drives
   Density; MS/GI/SS202/SS304/SS316 built-in + any company-added materials, see below), Density value +
   kg/m³↔g/cm³ unit converter, a static "By Length" badge (no By Weight anywhere, per requirement), the
   shape's dimension fields (each with its own mm/cm/inch/m unit), Pieces, Price Per kg, a live weight
   preview, and Save/Calculate/Clear. **No shape ever shows a separate "type" dropdown** — see "No type
   pickers" below for how Pipe/Square Tubing/Angle/Beam/Channel each resolve without one. **Save** appends the
   row to the parent form's `dimensions[]` and returns to the Add Fabrication Item modal — same as the old
   inline "Add Dimension" button did.

Both live in `client/src/pages/ResearchDevelopment/FabricationMaster.jsx`, which now:
- Shows the chosen category as a read-only chip (icon + label) with a "Change" button once set, instead of a
  `<select>`. **Changing category after dimensions exist now clears them** — the old code silently left stale
  rows behind when you changed category, which was already an existing inconsistency; this rework fixes it.
- An item's category is chosen once (via `CategoryPickerModal`); "Add Another Dimension" reopens
  `DimensionCalculatorModal` directly with the category locked (`lockedCategoryKey`), for additional sizes
  under the same shape — the data model still only supports one category per catalog item, many dimension
  rows (unchanged).

## Category taxonomy: 11 tiles, 18 backend keys, zero type pickers

`server/utils/fabricationCategories.js` still has its precise per-formula keys (now 18, up from 16 — see
below) — **existing saved items keep working unchanged**, nothing was renamed. Each entry also carries a
`group` field mapping it onto one of the 11 tiles. Earlier in this change, tiles covering more than one
backend key showed a "type" sub-dropdown in the Dimension Calculator (e.g. Channel → GOST/UPN) — **that was
removed**, per direct feedback, in favor of each tile resolving straight to fields with no extra picker:

| Tile (group)   | Backend key(s) reachable from the tile                | How it resolves without a type picker |
|----------------|----------------------------------------------------------|------------------------------------|
| Round Bar      | `round_bar`                                               | only ever had one key |
| Pipe           | `pipe_circular`                                            | `hss_circular` was already identical in fields *and* formula — just dropped from the picker (still valid for old items) |
| Square Bar     | `square_bar`                                               | only ever had one key |
| Hexagonal Bar  | `hex_bar` **(new)**                                        | only one key |
| Square Tubing  | `hss_rectangular`                                          | always uses the rectangular field set (Width, Height, Wall Thickness) — reduces to the exact `hss_square` formula when Width = Height, so a square tube is just "enter the same value twice," no picker needed |
| Beam           | `beam_ipn`, `beam_ipe`, `beam_hea`, `beam_heb`             | still 4 keys, but the Designation dropdown is now one flat list merging all 4 families' tables (see below) |
| T-Bar          | `t_bar` **(new)**                                          | only one key |
| Channel        | `channel_gost`, `channel_upn`                              | same merged-Designation-dropdown treatment as Beam |
| Angle          | `unequal_angle`                                            | always uses the two-leg field set (Long Leg, Short Leg, Thickness) — reduces to the exact `equal_angle` formula when the two legs are equal |
| Flat Bar       | `flat_bar`                                                 | only one key |
| Sheet          | `sheet_plate`                                              | only one key |

The reductions above are exact, not approximations — `hss_square(side, t)` and `hss_rectangular(width=height=side, t)`
give bit-for-bit the same `weightPerMeterKg`, and likewise `equal_angle(legLength, t)` vs
`unequal_angle(legA=legB=legLength, t)` (verified numerically while making this change). `hss_square` and
`equal_angle` are still fully defined in `FABRICATION_CATEGORIES` and still work for viewing/editing
pre-existing items saved under them — they're just not reachable from the tile picker for *new* items anymore.

For Beam/Channel (lookup categories — weight comes from a standardized designation table, not raw dimensions,
so there's no shared field set to generalize), `DimensionCalculatorModal` instead fetches all of the group's
families' section tables in parallel and merges them into one flat Designation `<select>` (option values are
encoded `categoryKey::designation`; picking one sets both the resolved category key and the designation in
one step). GOST channel designations are bare numbers (`'5'`, `'6.5'`...) with no family prefix, unlike
UPN/IPN/IPE/HEA/HEB which already embed one — the merged dropdown prefixes them `"GOST 5"` etc. for display
only, the raw stored `designation` value sent to the backend is unprefixed. If the item's category is already
locked (adding another size to an existing catalog item), the merge narrows to just that one locked family,
since one catalog item can't mix e.g. an IPE row with an HEA row.

`FABRICATION_CATEGORY_GROUPS` (same file) is the single source of truth for the tile list — it's what
`CategoryPickerModal` renders and what `GET /api/fabrication-master/categories` returns (`groups` key,
alongside the existing `data`).

## Two new categories: Hexagonal Bar, T-Bar

Neither existed before. Added to `fabricationCategories.js` + `fabricationWeightCalc.js`
(`calcWeightPerMeterKg`), same `perMeter` style as the existing shapes (`k = densityKgM3 / 1e6`):

- **Hex bar** (`hex_bar`, formula `hexBar`) — field `af` = across-flats width (mm). Regular hexagon area =
  `(√3/2)·af²` → `weightPerMeterKg = af² · (√3/2) · k`.
- **T-bar** (`t_bar`, formula `tBar`) — fields `width` (flange), `height` (overall), `thickness` (uniform).
  Area = flange + web − the t×t corner counted twice = `(width + height − thickness) · thickness` →
  `weightPerMeterKg = (width + height − thickness) · thickness · k`. Same shape of formula as the existing
  `unequalAngle` case (two overlapping rectangles); kept as its own `tBar` switch case for clear field names.

If these formulas need engineering sign-off before being trusted for real costing, treat that the same way
`steelSectionTables.js`'s own comment already flags its lookup tables ("spot-check before relying on for real
costing").

## Wall Thickness from OD/ID (Pipe, Square Tubing)

Pipe and Square Tubing both have a `wallThickness` field that, by default, is just typed directly (unchanged
behavior). Both now also offer an optional checkbox — off by default — to derive it instead from an outer +
inner measurement: `t = (outer − inner) / 2`. Toggling it on swaps the Wall Thickness input for an "Inside
Diameter (ID)" (Pipe) or "Inner Width (A₁)" (Square Tubing) input; `wallThickness` is then computed
automatically (see `THICKNESS_DERIVATION` config + the effect that watches it in
`DimensionCalculatorModal.jsx`) and flows into the weight calculation exactly like a manually-typed value
would. Nothing is sent to the backend differently — this is purely a frontend input-method convenience.

## Material dropdown: built-in table + company-added materials

The Material dropdown no longer has a "Custom" escape hatch for typing an unnamed density. Instead there's a
"+" button beside it that opens a small inline form (name + density value + kg/m³/g/cm³ unit) — submitting it
calls `POST /api/fabrication-master/materials`, which persists a new **company-scoped** material
(`server/models/FabricationMaterial.js`: `name`, `densityKgM3`, unique per company) and immediately selects
it. `GET /api/fabrication-master/materials` (auth-only, like `/categories`) returns the 5 built-ins from
`MATERIAL_DENSITY_TABLE` plus this company's custom ones, uniformly shaped (`{key, label, densityKgM3}` —
built-in `key`s are short codes like `'MS'`, custom ones are the Mongo `_id` string) so the frontend doesn't
need to special-case either kind. Once a material is added it's available on every future Fabrication Item
for that company, not just the one being created.

## Icons

No icon/image assets existed anywhere in the repo before this change — the screenshots handed over weren't
files that could be extracted and reused. `client/src/components/fabrication/FabricationShapeIcons.jsx` has
two hand-drawn inline-SVG exports:
- `ShapeTileIcon` — small metallic-gradient tile icon per group, used in `CategoryPickerModal`.
- `ShapeDiagram` — black line-art cross-section diagram with lettered dimension arrows (D, AF, W, H, t...),
  used in `DimensionCalculatorModal`, driven generically off `category.fields` (excludes the `length` field,
  which is always a plain number entry, not part of the cross-section).

**Known gap**: these are original recreations styled to match the screenshots' layout/colors, not pixel
copies — if the business wants brand-exact icon art, that's follow-up design work, not a code change.

## Pieces / Price Per kg

Added to each `FabricationMaster.dimensions[]` row (`pieces` default 1, `pricePerKg` optional, both plain
pass-through fields in `fabricationMasterController.js`). They only drive the calculator's own Total
Weight/Total Price preview and are stored for reference — **they are not wired into `Item.weightUnitPrice`**
(the existing Accounts-owned ₹/kg pricing field, resolved via `itemPricingService.js` from real purchase
invoices). Whether Price Per kg entered here should ever seed `weightUnitPrice` automatically is an open
product question, not answered by this change.

## Purchase Unit / Used Unit / Receive Unit

- **FabricationMaster model** (`server/models/FabricationMaster.js`) gained 6 top-level string fields:
  `purchaseUnitType`/`purchaseUnit`, `usedUnitType`/`usedUnit`, `receiveUnitType`/`receiveUnit`. All optional,
  all the same Type→Unit pairing Inventory's Add Item form already uses (`UnitType` collection, per-company,
  `GET/POST/PUT/DELETE /api/inventory/unit-types`).
- **Fabrication Master's Add/Edit form** (`FabricationMaster.jsx`) gained three matching field groups
  (`UnitFieldGroup` helper in the same file), fetching `unitTypes` from the same endpoint
  `ModernInventoryUI.jsx` already uses for Inventory's own Purchase/Used Unit dropdowns.
- **Item model** (`server/models/Inventory.js`) gained `receiveUnitType`/`receiveUnit` (Purchase Unit/Used
  Unit already existed as `purchaseUnitType`/`purchaseUnit` and `unitType`/`unit` respectively — note the
  naming mismatch is pre-existing: Inventory's "Used Unit" label maps to the `unit`/`unitType` fields, not
  `usedUnit`; kept as-is rather than a risky rename of a widely-referenced field).
- **`SimpleInventoryForm.jsx`** (Inventory's Add Item) gained a new "Receive Unit" field group (section 15,
  everything below it renumbered +1) and `handleFabricationSelect` now also copies
  `purchaseUnitType/purchaseUnit`, `unitType/unit`, and `receiveUnitType/receiveUnit` from the picked
  Fabrication Master item onto the form — same auto-filled-but-still-editable behavior the dimension variants
  already had. Falls back to whatever was already in the form for any unit the catalog entry didn't set.

## Where to look for each piece

| Concern | File |
|---|---|
| Category/group/built-in-material definitions, weight formulas | `server/utils/fabricationCategories.js`, `server/utils/fabricationWeightCalc.js` |
| Company-added materials | `server/models/FabricationMaterial.js` |
| FabricationMaster schema | `server/models/FabricationMaster.js` |
| FabricationMaster API | `server/controllers/fabricationMasterController.js`, `server/routes/fabricationMasterRoutes.js` |
| Item schema | `server/models/Inventory.js` |
| Shape icons/diagrams | `client/src/components/fabrication/FabricationShapeIcons.jsx` |
| Category picker (Modal 1) | `client/src/components/fabrication/CategoryPickerModal.jsx` |
| Dimension calculator (Modal 2) | `client/src/components/fabrication/DimensionCalculatorModal.jsx` |
| Add Fabrication Item page | `client/src/pages/ResearchDevelopment/FabricationMaster.jsx` |
| Inventory Add Item + autofill | `client/src/components/inventory/SimpleInventoryForm.jsx`, `client/src/components/inventory/FabricationItemPicker.jsx` |

## Suggested next steps

1. Get engineering sign-off on the Hex Bar / T-Bar formulas above before relying on them for real costing.
2. Decide whether Price Per kg entered in the calculator should ever auto-populate `Item.weightUnitPrice`.
3. If brand-exact icon art is wanted, replace `FabricationShapeIcons.jsx`'s hand-drawn SVGs with real assets —
   the two exported components (`ShapeTileIcon`, `ShapeDiagram`) are the only integration points, so this is
   a drop-in swap.

---

## Follow-on (2026-08-19, same day): BOM consumption redesign — uses the Used Unit field above

Built right after this change, directly on top of it — the client's next requirement was how a BOM material
line actually *consumes* a fabrication item, given it now has a real Used Unit (Length Unit or Area Unit,
depending on shape). **Not yet tested end-to-end by the client** — pending a full pass tomorrow.

### What changed and why

Client material-handling model, two types going forward: **Fabrication** (weight auto-computed from geometry ×
density) and **Assembly** (weight entered manually at receiving). Both get a Purchase → Receive → Use unit
triple (Receive/Use are exactly the fields this doc's main change added). The actual behavior change: a BOM
material line stopped re-entering a fabrication item's full dimension set (`legLength`+`thickness`+`length`,
etc.) and instead:
1. Picks **which catalog `Item.dimensionVariants[]` entry** it draws from (the item's Used Unit/shape is
   fixed per item, but stock still comes in multiple sizes — same multi-dimension-per-item support this app
   already had, kept even though the client didn't explicitly ask for it).
2. Enters **one consumed amount** — a length for every shape except sheets, an area for sheets — instead of
   the full cross-section. `weight = length × weightPerMeterKg` (already precomputed per variant) or
   `weight = area × thickness × density` — client's own framing: *"weight = volume × density."*

### Code locations

| File | What's in it |
|---|---|
| `server/utils/unitConversion.js` (new) | `LENGTH_UNIT_TO_MM`/`AREA_UNIT_TO_MM2` conversion tables + `toMm()`/`toMm2()` — mirrors `itemPricingService.js`'s `MASS_UNIT_TO_KG_MULTIPLIER` precedent. Unit name strings match the Length Unit/Area Unit `UnitType` seed data exactly (`inventoryController.js`'s default seeding) — no new `UnitType` entries needed. |
| `server/services/fabricationDemandService.js` | `resolveFabricationWeight()` gained an optional 3rd `designation` param (needed for `calcType: 'lookup'` categories — beam/channel — which were previously unreachable through this function; a latent gap, fixed as part of this). New `buildFabricationBomDimensions(sourceItem, dimensionVariantId, amountValue, amountUnit)` — synthesizes the *same* full `bomDimensions` shape `resolveFabricationWeight` already expects, from a chosen variant + the new amount input, so that function's signature and every existing caller stay untouched. |
| `server/utils/fabricationWeightCalc.js` | `calcSheetWeightKg` now checks `values.area` first, falling back to `width*length` for old data — a pure alternate input, same formula. |
| `server/models/RDBOM.js`, `MaterialSchema` | Gained `dimensionVariantId`, `amountValue`, `amountUnit`. `bomDimensions`/`fabricationCategory`/`computedWeightPerPieceKg`/`unitPrice` all stay — still server-computed, same shape everything downstream already reads. |
| `server/models/ProductionOrder.js`, `MaterialDemandSchema` | Same 3 fields mirrored, so Production/Store can show "Amount × Quantity" without reverse-engineering it out of `bomDimensions`. |
| `server/controllers/rdController.js` | `addMaterial`/`updateMaterial` accept `dimensionVariantId`/`amountValue`/`amountUnit` instead of raw `bomDimensions`, call `buildFabricationBomDimensions` server-side (never trusts a client-sent `bomDimensions`, same "server is authoritative" principle `computedWeightPerPieceKg` already followed). `refreshBOMMaterialPrices` (the "keep it live" recompute on every BOM read) now threads `mat.bomDimensions.designation` through for lookup categories. `processRDRequest` WORKFLOW 2 copies the 3 new fields onto pushed Production demands — merge-by-dimension-signature logic itself needed no change, since `bomDimensions` still fully encodes "variant + amount." |
| `server/controllers/productionMfgController.js` | `addMaterialDemand` (Production's own out-of-BOM "Add Demand") got the identical variant+amount treatment. |
| `client/src/components/inventory/FabricationVariantAmountFields.jsx` (new) | Replaces `FabricationDimensionFields.jsx` on the BOM/demand-entry path (that component is still used as-is for Fabrication Master's own Add Item form and Store's "received a different size" receiving flow — genuinely different use cases, entering a *new* catalog size from scratch). Variant picker (skipped when the item only has one size) + Amount number input + a Length Unit/Area Unit `<select>` (scoped to the category's `calcType`) + a client-computed live weight preview (straight from the chosen variant's own `weightPerMeterKg`/`thickness`+density — no extra API round-trip). |
| `client/src/pages/ResearchDevelopment/BOMManagement/BOMCreationTab.jsx`, `client/src/pages/production/OrderManagement.jsx` | Both material-entry dialogs swapped to the new component. Both also **lock the Used Unit fields read-only** for a fabrication row (auto-fetched from the item, not a BOM-line choice) — the client's explicit ask. |
| `client/src/pages/ResearchDevelopment/RDProductionQueue.jsx`, `client/src/utils/bomFieldFormat.js` | Display-only: show `${amountValue} ${amountUnit}` instead of the raw dimension list when present, falling back to the old raw-dims summary for BOM lines saved before this change. |

### Store transfer — the real bug this redesign made fixable

Found via the user's own testing (not previously reported, because there was no clean way to fix it until
demand lines had a real "amount per piece" instead of just a full dimension set): the old
`transferFabricationMaterialToProduction` used the demand's own piece `quantity` as *both* "how many stock
pieces to deduct" *and* "how many leftover pieces to record" — as if 1 stock piece always covers exactly 1
demanded piece. It also never checked the chosen stock piece was even physically big enough for the cut.

**`server/controllers/inventoryController.js`, `transferFabricationMaterialToProduction`** — request shape
changed from `{sourceVariantId, quantity, leftoverDimensions}` to:
```js
{ materialCode, sourceVariantId, stockPiecesConsumed, quantityFulfilled, leftover: { amountValue, amountUnit, pieceCount } }
```
`stockPiecesConsumed` (physical stock pieces cut from) and `quantityFulfilled` (how many of the demand's
needed pieces this transfer covers) are now tracked independently — `Item.dimensionVariants[].subStock`
deducts by `stockPiecesConsumed`, `demand.transferredQuantity` increments by `quantityFulfilled`. A new
size-sufficiency check (`stockPiecesConsumed × the chosen variant's own length/area capacity` must cover
`quantityFulfilled × demand.amountValue`) rejects a transfer that doesn't have enough material — there was no
such check before. The leftover's piece count is now Store's own explicit entry (`leftover.pieceCount`), not
assumed equal to the transfer quantity — reproduces and fixes the user's exact reported case (consumed 1 stock
piece, but the old code recorded a leftover of quantity 2).

**`client/src/pages/store/MaterialHandshake/tabs/PendingRequestsTab.jsx`, `FabricationTransferDialog`** —
gained **Stock Pieces Consumed** and **Quantity Fulfilled** as two separate inputs (Stock Pieces Consumed
auto-suggests a default via `Math.ceil(totalNeeded / variantCapacity)`, editable), and the leftover section
became Amount + Unit + Pieces instead of raw locked/editable dimension fields.

### Explicitly unchanged by this redesign

- **Purchase Requests** (fabrication ordering) and **Store Receiving** — both operate on whole catalog stock
  sizes (ordering/receiving full pieces), which this redesign never touches; only BOM *consumption* changed.
  The `Item.weightUnitPrice` (₹/kg) pricing chain they feed is exactly what the new BOM formula still
  multiplies against.
- Backward compatibility: every new field is additive (`default: null`), and every display that reads the new
  `amountValue`/`amountUnit` falls back to the old raw-dimension summary when they're absent, so BOM lines and
  demands saved before this change keep displaying/working exactly as they did.

### Deferred (next phase, not started)

Client's material table also covers **Assembly** (non-fabrication) materials with a non-Pieces Used Unit
(area/length/volume) — the same Amount+Unit+Quantity split applies there too (today's `RDBOM.MaterialSchema`
only has a bare `quantity`, no way to say "2 sq.m × 2 pieces" for a non-fabrication material), just with
manually-entered weight instead of computed. Deliberately not built in this pass — the fabrication side needs
to be confirmed working end-to-end first.

## Follow-on (2026-08-20): Receive Unit enforced as the real stock-counting unit for non-fabrication items

A stock-display bug fix earlier the same day (Inventory's Stock column mislabeling a fabrication item's piece
count with its Used Unit instead of Receive Unit — see `itemDisplayUnit` in `client/src/lib/fabricationDims.js`)
was initially scoped as fabrication-only. Client corrected that framing: the old system had 2 units (Purchase +
Used, with Used doing double duty for both stock-counting and BOM consumption); the new system's 3rd unit,
Receive Unit, is supposed to be the stock-counting unit for *every* item type, not just fabrication.

**What was actually found**: `receiveUnit`/`receiveUnitType` existed on every `Item` and were freely,
independently editable on `SimpleInventoryForm.jsx` for any item — but were only ever *read* by fabrication-only
code (`createPurchaseQCJob`'s `fabricationRef` branch, `itemDisplayUnit`'s fabrication branch). Every
non-fabrication code path — the generic Store receive flow (`updatePurchaseRequestStatus`), the generic QC
Pass-credit branch (`qcController.js`), and the generic production-consumption debit
(`transferMaterialToProduction`) — operated purely on `purchaseUnit` → a Store-typed `conversionFactor` →
`Item.qty`/`Item.unit` (Used Unit). Receive Unit was dead data for every non-fabrication item.

This isn't fixable by adding a general unit-conversion step, though — unlike fabrication (geometry × density
bridges a Pieces-received stock to a Length/Area-used consumption), there's no formula to convert between two
arbitrary unrelated units for a plain item. That's exactly why the client's own reference table shows
Receive Unit = Used Unit on *every* non-fabrication row (kg/pcs/pcs, kg/kg/kg, volume/volume/volume,
area/area/area, length/length/length, pcs/pcs/pcs) — a hard constraint, not an example choice.

**The fix**: enforce Receive Unit = Used Unit for every non-fabrication item (mirrored, not independently
editable), then read `receiveUnit` (falling back to `unit`) wherever stock is labeled — matching how
`dimensionVariants[].subStock` already works for fabrication items.

| File | What's in it |
|---|---|
| `server/controllers/inventoryController.js`, `sanitizeItemData` | For any item without `fabricationRef`, forces `receiveUnitType = unitType` / `receiveUnit = unit` — the single choke point both `createItem` and `updateItem` call, guarded on `unitType`/`unit` actually being present in the payload (so a partial update like the discontinue/reactivate toggle, which sends only `{isDiscontinued}`, doesn't touch Receive Unit). |
| `client/src/components/inventory/SimpleInventoryForm.jsx` | Section 15 (Receive Unit) now branches on `itemProcessType === FABRICATION_PROCESS_TYPE` — fabrication items keep the independent editable Type+Unit selects; every other item shows a disabled mirror of Used Unit instead. `handleSubmit` also submits the mirrored value for non-fabrication items, same pattern as the existing kg-locked Unit Weight field. |
| `server/controllers/purchaseRequestController.js`, `createPurchaseQCJob` | Non-fabrication branch now reads `inventoryItem.receiveUnit \|\| inventoryItem.unit` instead of `inventoryItem.unit` alone. |
| `client/src/lib/fabricationDims.js`, `itemDisplayUnit` | Non-fabrication fallback changed from `item.unit` to `item.receiveUnit \|\| item.unit`. |
| `server/models/Inventory.js` | Added comments on `qty` and `unit` documenting `qty`'s unit is Receive Unit (enforced equal to Used Unit for non-fabrication items) — previously undocumented anywhere in the schema. |
| `server/controllers/rdController.js`, `createMachine`/`toMachineItemFields` | Product Master (machines, `productKind:'Machine'`) never calls `sanitizeItemData` — it builds its own `Item` payload. Mirrored the same Receive Unit = Used Unit enforcement here directly so Product Master items get the same treatment. Motor Master needed no equivalent change — it already goes through `createItem`/`updateItem`, same as plain Inventory. |

**Data migration**: one-off backfill (dry-run confirmed, then applied) set `receiveUnit`/`receiveUnitType` to
match `unit`/`unitType` for the 96 non-fabrication items that had it blank (2 already matched, 0 diverged) —
covered Product Master and Motor Master items in the same pass, since the query only keyed on
`fabricationRef: null`.

**Confirmed unaffected**: `unit`, `purchaseUnit`, and `Item.qty` semantics for Product Master and Motor Master —
both still default Used Unit/Purchase Unit to Pieces/Count Unit exactly as before; this change only ever
populates the previously-unused `receiveUnit` field to match.

## Follow-on (2026-08-20): Beam/Channel switched from designation lookup to computed dimensions; Price Per kg hidden for them

Client provided reference screenshots of a 3rd-party steel weight calculator for I-Beam and Channel shapes —
both show a Dimension section with exactly **Side (A), Side (B), Thickness (T), Thickness (S), Length** (each
with its own unit dropdown), no designation/standard picker. Client wants Fabrication Master's Beam and
Channel categories to match that field set, and wants their Price Per kg field removed — Accounts sets the
real price for these items separately.

**Categories**: `beam` and `channel` (`server/utils/fabricationCategories.js`) replace the old 6
standardized-designation `lookup` keys (`beam_ipn`/`beam_ipe`/`beam_hea`/`beam_heb`/`channel_gost`/`channel_upn`)
as the picker-reachable entries for the Beam/Channel tiles — now `calcType: 'perMeter'` with fields
`sideA`/`sideB`/`thicknessT`/`thicknessS`/`length`, computed instead of looked up from a table. The old 6 keys
stay defined (unreachable from `FABRICATION_CATEGORY_GROUPS`), same backward-compatibility pattern already used
for `hss_square`/`equal_angle`/`hss_circular` — confirmed zero live items used any of the 6 keys, so this is
precautionary, not a real migration.

**Formula**: an I/H-beam and a C/U-channel share the identical cross-section shape for area purposes — two
flanges (`Side B x Thickness S` each) plus a web connecting them (`(Side A - 2 x Thickness S) x Thickness T`) —
so both categories share one new `'iBeamChannel'` case in `fabricationWeightCalc.js`'s `calcWeightPerMeterKg`,
same "two overlapping rectangles" pattern as the existing `unequalAngle`/`tBar` cases. Verified numerically
against real standard-section references (ISMB 200 ≈ 25.4 kg/m real vs. 24.9 kg/m computed; ISMC 200 ≈ 22.3 kg/m
real vs. 22.0 kg/m computed) — within the same few-percent tolerance the existing angle/T-bar approximations
already carry (fillet radii ignored).

**No changes needed** in `DimensionCalculatorModal.jsx`'s core mechanics (`renderFields`, `draftReady`,
`isLookupGroup`) — all of it already branches purely on `calcType`, so once Beam/Channel became `perMeter` they
automatically fell into the same generic `activeCategory.fields.map(...)` rendering every other formula-based
shape already uses. The old Designation-dropdown branch stays in the file only to serve a locked pre-existing
item still saved under one of the 6 old lookup keys.

**Price Per kg removed for Beam/Channel**: `DimensionCalculatorModal.jsx` gained `hidePriceField = group?.key
=== 'beam' || group?.key === 'channel'`, hiding just that one input (Pieces stays). This field was always a
reference-only convenience number (`FabricationMaster.dimensions[].pricePerKg`, never fed into real costing —
see its schema comment) and is the only "price" field anywhere on this form; `Item.weightUnitPrice`, the real
Accounts-resolved ₹/kg, is untouched and already lives entirely outside this modal.

**Shape diagrams**: `FabricationShapeIcons.jsx`'s `beam`/`channel` cases in `renderDiagram` gained A/B/S/T
dimension-line annotations (previously just a static outline, since there were no computable fields to label) —
same `HDim`/`VDim`/inline-text pattern already used for T-Bar/Square Tubing/Pipe.

**Incidental fix**: `FabricationDimensionFields.jsx` (Store's "received a different size" flow for Purchase
Request receiving) drives its fields off the same `activeCategory.fields` — it had no Designation-dropdown
special case, so Beam/Channel receiving of an off-catalog size was already silently broken there (only a bare
Length field, no way to pick a size). The new field set fixes this as a side effect, no separate change needed.

### Correction, same day: Price Per kg removed for every category, not just Beam/Channel

Client clarified the price-field removal was meant for the whole Fabrication Master form — "surface level"
only, i.e. stop collecting a manual price on this form entirely, while leaving the real Accounts-set price
(`Item.weightUnitPrice`) completely untouched elsewhere. `hidePriceField`/`isLookupGroup`-style gating was
removed from `DimensionCalculatorModal.jsx` in favor of deleting the field outright: `pricePerKg` state,
`totalPrice` computation, and the input + "Total Price" preview line are all gone. `handleSave` now always
sends `pricePerKg: null` for a newly-added dimension row (explicit `null`, not omitted, so it correctly
overwrites if a row is ever re-saved) — pre-existing rows that already had a value keep it untouched, since
dimension rows are only ever appended or removed here, never edited in place. The schema field
(`FabricationMaster.dimensions[].pricePerKg`) stays defined for that reason.

### Correction, same day: BOM Amount field no longer has its own unit picker

Client flagged that the amount+quantity BOM redesign (see the main "Follow-on" section above) left a confusing
UI: a fabrication BOM/demand line already shows a locked, read-only "Used Unit" (auto-fetched from the item,
e.g. "Centimeter") right above the Amount fields, but the Amount ("Length Used"/"Area Used") still had its own
*separate*, independently-pickable Unit dropdown — two unit choices for one line, one of them fixed and the
other free, with no relationship enforced between them.

`client/src/components/inventory/FabricationVariantAmountFields.jsx` — removed the Unit `<select>` entirely;
the amount is now always understood to be in the row's own locked Used Unit (`row.unit`). A new effect keeps
`row.amountUnit` in sync with `row.unit` automatically (same reactive pattern already used to auto-select a
single dimension variant just above it), so the field the server/save logic reads
(`amountValue`/`amountUnit`, unchanged schema/API contract) is populated correctly with no user action needed.
The label now shows the locked unit inline (e.g. "Length Used (Centimeter) *") instead of a second control.
This is a shared component (`BOMCreationTab.jsx` and `OrderManagement.jsx`'s own "Add Material Demand" dialog
both render it), so the fix applies in both places from one change.

### Correction, same day: Qty column mislabeled with Used Unit instead of a piece count, across every BOM/material-demand display

Client flagged R&D's `/r&d/approve-requests` Review Request Details modal: for a fabrication material, the
Dimensions column correctly shows the per-piece amount (`"15 Centimeter · 0.06 kg/pc"`), but the Qty column
showed `"2 Centimeter"` — reusing `mat.unit` (Used Unit) to label `mat.quantity`, which for a fabrication line
is a piece count, not another length/area. Non-fabrication rows were already correct (`mat.unit` genuinely is
their counting unit there, e.g. `"5 Pieces"`).

Same root cause as the Receive Unit mislabeling fixed earlier — a piece count paired with the wrong unit
field — but recurring across every screen that renders a `MaterialDemand`/BOM-material row's `quantity`+`unit`
pair verbatim. Fixed everywhere the pattern was confirmed to touch fabrication-capable rows (`.fabricationCategory`
present on the same object): `RDProductionQueue.jsx` (the reported screen), `OrderManagement.jsx` (Material
Demand table, both BOM/Out-of-BOM branches, and the View BOM Entry modal), `RepairProduction.jsx` (same Material
Demand table), `PendingRequestsTab.jsx` (Store's pending-transfer list), `JobCards.jsx` (printable Job Card),
`BOMCreationTab.jsx` (View Material modal) — same one-line fix everywhere: `{m.quantity} {m.fabricationCategory
? 'pcs' : m.unit}`. Checked and deliberately left alone: `PendingRequestsTab.jsx`'s "Consolidated Accounts
Dispatch Summary" cart (fabrication materials are routed to their own dedicated purchase dialog,
`handlePurchaseClick`, and never staged into this generic cart, so `combinedItem.unit` there is always a real
non-fabrication Used Unit) and `DamageAndExpiry.jsx` (a different schema entirely — Damage/Expiry line items,
no `fabricationCategory` field, unrelated to the BOM/material-demand data model).

## Follow-on (2026-08-20): Amount + Quantity for non-fabrication materials — display-only, not a new stock unit

The original amount+quantity BOM redesign (further up this doc) deliberately deferred one piece: a
non-fabrication material whose Used Unit is Length/Area/Volume has the exact same *entry* problem fabrication
did — a flat Quantity field can say "5 kg" or "3 pieces" (Mass/Count units) but can't say "2 pieces of 1m length
each". `RDBOM.js`'s `dimensionVariantId`/`amountValue`/`amountUnit` fields even carried a comment anticipating
this ("Part 8: assembly materials with a non-Pieces use-unit reuse amountValue/amountUnit too").

**First pass got the semantics wrong — corrected same day.** The first implementation made `mat.quantity` mean
"piece count" for these materials (mirroring fabrication exactly) and pushed an `amountValue × quantity`
multiplication into `transferMaterialToProduction`'s stock deduction to compensate. Client caught it: a
fabrication item's stock (`dimensionVariants[].subStock`) really is piece-based, so "quantity = pieces" is
correct there — but a non-fabrication Length/Area/Volume item's stock (`Item.qty`) is a *continuous* amount
(Receive Unit = Used Unit, established earlier this session), never piece-based. Store doesn't count "2 pieces
of rod in stock," they have "12.5 meters." Making `quantity` mean pieces for these materials meant every
downstream consumer — the Store transfer dialog's label and remaining-quantity check
(`PendingRequestsTab.jsx:857`, never updated), any future availability check, Purchase Request auto-suggestions
— would need to independently know to multiply by `amountValue`, and most of them didn't. The
`transferMaterialToProduction` fix alone wasn't enough; the design needed the multiplication to happen once, at
the source, not scattered across every consumer.

**Corrected design**: `mat.quantity` (and everything it flows into — `MaterialDemand.quantity`, Store transfer,
stock deduction) is *always* the total amount needed, in the item's real Used Unit — exactly what it has always
meant for every material type, fabrication included in spirit (fabrication's piece count already matches its
piece-based stock). "Amount × Pieces" is a data-entry convenience and a **display-only annotation** — R&D still
types Amount (per piece) and Pieces separately, because that's the natural way to describe "2 separate 1m
segments," but the form resolves this into one total (`pieces × amountValue`) before it ever reaches the API,
and `amountValue` travels alongside purely so R&D/Store/Production can see the breakdown. Store and Production
never transact in pieces for these materials — they request, transfer, and receive the total, unchanged from
how every other material already worked.

**`client/src/components/inventory/UnitAmountField.jsx`** — the Amount input itself is unchanged from the first
pass (locked to the row's own Used Unit, auto-synced, no separate unit picker). What changed is what happens to
its value at the boundary:
- **Submit**: `resolveSubmitQuantity(row)` (`BOMCreationTab.jsx`, `OrderManagement.jsx`) — `rowNeedsAmount(row)
  ? Number(row.quantity) * Number(row.amountValue) : Number(row.quantity)`. The "Quantity" input stays exactly
  where it was, and the user still types pieces into it — this only changes what's sent to the API.
- **Edit-load**: `openEdit` (`BOMCreationTab.jsx`) reverses it — `mat.amountValue != null && !mat.fabricationCategory
  ? String(mat.quantity / mat.amountValue) : String(mat.quantity)` — so re-opening a saved material shows pieces
  in the Quantity input again, not the total that only happens to look like a piece count when `amountValue`
  is 1.
- The "Price (auto)" preview needed no change — it already reads `row.quantity`(pieces) × `row.unitPrice`
  (`purchaseCostPerUnit × amountValue`, still computed live by `UnitAmountField`'s effect), which equals the
  same total the backend independently computes as `purchaseCost × totalQuantity`.

**Backend, `server/controllers/rdController.js`** — `itemNeedsAmount(sourceItem)` still gates a server-side
requirement that `amountValue > 0` was provided (never trusting the client's `amountValue` presence alone), and
`amountUnit` is still always re-derived as `sourceItem.unit`, never trusted from the client. But pricing is back
to the same flat formula every material already used: `unitPrice = sourceItem.purchaseCost || 0`,
`totalPrice = unitPrice × quantity` — no `× amountValue` branch, because `quantity` sent by the client is
already the total. Same reversion in `updateMaterial`, `refreshBOMMaterialPrices` (the live-resync job), and
`server/controllers/productionMfgController.js`'s `addMaterialDemand` (Production's own ad-hoc demand endpoint).

**Store transfer, `transferMaterialToProduction`** — back to the original, unconditional
`Item.qty -= transferQty` — no `amountValue` multiplication. `demand.quantity` already *is* the physical amount
to deduct, exactly like every other material.

**Qty-column "pcs" display** — reverted to fabrication-only (`m.fabricationCategory ? 'pcs' : m.unit`,
un-broadened) across all the files touched in the previous Follow-on section — a non-fabrication row's
`quantity` is genuinely back to being denominated in `m.unit`, so that label is correct again, not "pcs".

**Dimensions column now shows the piece breakdown for non-fabrication amount materials too** —
`bomFieldFormat.js`'s `formatBomDimensions`/`formatCatalogFieldValue`, `RDProductionQueue.jsx`'s
`summarizeBomDimensions` (now just a thin wrapper reusing the shared formatter instead of a parallel copy), and
`OrderManagement.jsx`'s Material Demand subtitle and "Bill of Materials by Part" row all gained: for a
non-fabrication material with `amountValue` set, show `${amountValue} ${amountUnit} × ${quantity / amountValue}
pcs` — the piece count only exists as this *derived* display (`quantity ÷ amountValue`), since `quantity` itself
carries the total, not a stored piece count. Fabrication rows are unaffected (their `quantity` already is the
piece count, shown directly, no division needed). The "Bill of Materials by Part" row also picked up the same
`fabricationCategory ? 'pcs' : mat.unit` Qty-label fix, since it reads straight from the RDBOM material and had
never been touched by the original mislabeling fix.

**Merge key** (`processRDRequest` WORKFLOW 2, `addMaterialDemand`'s existing-demand lookup) — kept the
amount-aware branch (merge by `code#amountValue+amountUnit`, not just `code`) from the first pass. Purely
additive now: since `quantity` is fully additive regardless of the per-piece breakdown, merging two "1m×2" and
"2m×1" lines into one 4m demand would still be numerically correct — but keeping them separate preserves the
distinct breakdowns as useful display information, so there was no reason to revert this part.

**Backward compatible**: every field involved (`amountValue`/`amountUnit`/`purchaseCostPerUnit`) is additive/
optional, same as the first pass. No live data existed under the brief incorrect design (caught and corrected
same session, before any real use).

## Follow-on (2026-08-20): BOM materials table restructured — Unit Weight is its own column, Hierarchy split, and the BOM PDF redesigned to match

Client wanted two columns in `BOMCreationTab.jsx`'s materials table separated out rather than combined:
**"Hierarchy (Child > Sub-Child)"** split into two real columns (Child Part, Sub Child Part), and **"Unit
Weight"** pulled out of the "Dimensions" column (which used to show a fabrication material's amount *and* its
computed weight combined into one string, e.g. `"15 Centimeter · 0.06 kg/pc"`) into its own dedicated column.

**Unit Weight stopped being a "BOM Format & Modification" toggle.** It used to be one of the optional
`BOM_FIELD_CATALOG` entries (`server/models/RDBOMFieldConfig.js`) a company could enable/disable per their
preference, sourced only from the generic Inventory-snapshot `unitWeightValue`/`unitWeightUnit` — meaning a
Fabrication Master material's *real* weight (`computedWeightPerPieceKg`) had nowhere proper to show except
crammed into Dimensions. Removed `unitWeightValue` from `BOM_FIELD_CATALOG` entirely; it's now always shown as
a native column, sourced via `bomFieldFormat.js`'s new `formatUnitWeight(mat)` — `computedWeightPerPieceKg` for
a fabrication material, `unitWeightValue`/`unitWeightUnit` for everything else. `BOMFieldConfigModal.jsx`
needed no change — it already self-heals a stale `enabledFields` entry that's since been dropped from the
catalog (confirmed before removing anything).

`bomFieldFormat.js`'s dimensions formatter split into two: `formatBomAmountOnly(mat)` (just the amount, no
weight — used for the table's "Dimensions" BOM Format column and the Edit/Add forms) and the pre-existing
`formatBomDimensions(mat)` (amount + weight combined, kept as-is for the compact one-line summaries elsewhere —
`RDProductionQueue.jsx`'s approval review, `OrderManagement.jsx`'s Material Demand subtitle — where there's no
separate Unit Weight column to defer to).

**Qty column self-labels "pcs" for fabrication rows now too.** This exact table's Qty/Used Unit pair was the
one spot left over from the earlier "pcs" mislabeling fix (see the Follow-on section above) — it used two
*separate* table cells rather than one combined string, which seemed less misleading at the time, but in
practice reading "2" next to "Centimeter" across two adjacent columns is just as easy to misread as "2
Centimeter" as the combined-string cases were. Fixed to render `2 pcs` in the Qty cell itself for a fabrication
row, so it's unambiguous regardless of what unit sits in the next column.

### BOM PDF (`rdController.js`'s `writeBOMPdf`) — redesigned from 5 thin columns to match the table

The PDF (shared by the on-demand `GET /boms/:id/download` and `lockBOM`'s auto-upload-to-Documentation flow —
same function, so both always match) previously had only Code/Item/Child+Sub-Child(combined)/Qty/Unit — no
Price, no weight, no amount breakdown, no Status. Redesigned to a "main row + muted detail sub-line" layout per
material (same pattern `productionMfgController.js`'s Material Ledger PDF already established for its own
"Cut: ..." line — packing everything into flat columns wouldn't fit a LETTER page legibly):

- **Main row** (8 columns): Code, Item, Child Part, Sub Child Part, Qty (piece count, "pcs"-suffixed for
  fabrication/amount-based materials), Used Unit, Price (total + unit price), Status (Active/Discontinued).
- **Detail line** (smaller, grey, only rendered when non-empty): Amount + Total Amount (fabrication and
  non-fabrication amount-based materials only), Unit Weight, Total Weight.

New helpers in `rdController.js` (module-level, alongside `writeBOMPdf`): `bomMaterialPieceCount(mat)` — the
same fabrication-direct-vs-non-fabrication-derived (`quantity ÷ amountValue`) split established for the
amount+quantity redesign, kept server-side since PDF generation has no access to the client bundle;
`bomMaterialTotalAmount(mat)`; `bomMaterialTotalWeight(mat)`; `bomMaterialDetailLine(mat)` (assembles the
` · `-joined line, matching `formatBomDimensions`'s combining style).

**Total Weight is deliberately left unresolved for a non-fabrication material whose Used Unit is
Length/Area/Volume** (i.e. `mat.amountValue` set, `mat.fabricationCategory` not) — renders `"Total Weight: —
(unit clarification pending)"` instead of a computed number. See
`server/docs/non-fabrication-unit-weight-ambiguity.md` for the full reasoning: `unitWeightValue` has no enforced
"per how much" convention, so multiplying it by quantity for these items specifically could silently be wrong by
whatever reference scale the original entry actually meant. Total Weight *is* computed normally for fabrication
materials (weight is server-computed from geometry × density, no ambiguity), non-fabrication Pieces materials
(weight-per-piece is unambiguous), and non-fabrication Mass Unit materials (`unitWeightValue × quantity`,
trusted per the client's own confirmation that Mass Unit is clear, unlike Length/Area/Volume).

Currency renders as `Rs.` rather than `₹` — matches the established convention in `server/utils/invoicePdf.js`
(pdfkit's standard Helvetica font has no ₹ glyph).

Smoke-tested with synthetic materials covering all four cases (fabrication, non-fabrication amount-based,
non-fabrication Pieces, non-fabrication Mass Unit) before shipping — confirmed the math and the "pending"
placeholder both render correctly.

## Follow-on (2026-08-21): Inventory's 3 units locked for fabrication items; Material Grade auto-filled from Fabrication Master

**Purchase Unit, Used Unit, and Receive Unit locked in `SimpleInventoryForm.jsx` when a Fabrication Master item
is picked.** All three were already auto-filled from the catalog entry (`handleFabricationSelect`), but stayed
freely editable afterward — meaning an Inventory item's units could silently drift from what its Fabrication
Master catalog entry actually specifies. Now, whenever `formData.fabricationRef` is set, all three render as
disabled `<Input>`s (same visual pattern already used for the non-fabrication Receive Unit lock) instead of
editable `<Select>`s — locked only once a real catalog entry has actually been picked, so the transient state
right after choosing "Fabrication Item" as the process type (before clicking "Select Fabrication Item") still
shows normal editable fields with nothing to lock against yet.

**Material Grade auto-filled from the Fabrication Master catalog entry's own Material.** Client wanted the
Dimension Calculator's "Material" dropdown (MS/GI/SS 202/SS 304/SS 316 — the one that sets density) to flow
into Inventory's Metrology/Material Grade fields. Investigation found a real blocker: **the Material dropdown's
label was never persisted anywhere** — `FabricationMaster.density` only ever kept the resulting number
(`{value, unit}`), so there was nothing to autofill in the first place.

Also confirmed the label can't be reliably split into Metrology + Material Grade — the client's own rule
("alphabet part is Metrology, number part is Grade") breaks for materials with no numeric part at all (e.g.
"MS", "GI" — visible in the client's own reference screenshot). Resolved by keeping the whole label as one
combined value in a single field, per direct client confirmation.

- **`server/models/FabricationMaster.js`**: new top-level `material` field (`String`, e.g. `"SS 304"`) alongside
  the existing `density` — the only place the actual material designation now survives.
- **`client/src/components/fabrication/DimensionCalculatorModal.jsx`**: `handleSave`'s `onSave(...)` payload
  gained `materialLabel` (looked up from the already-fetched `materials` list by the selected `material` key).
- **`client/src/pages/ResearchDevelopment/FabricationMaster.jsx`**: `emptyForm`/`handleCalculatorSave`/`openEdit`
  all thread `material` through, same as every other form-state field — `handleAdd`/`handleEditSave` already
  submit the whole `form` object, so no separate wiring needed there.
- **`server/controllers/fabricationMasterController.js`**: `createFabricationItem`/`updateFabricationItem`
  persist `material` from the request body, same pattern as every other field.
- **Inventory side**: `handleFabricationSelect` autofills `materialGrade` (not `metrology` — see the field-choice
  reasoning below) from `fabItem.material`, and the Material Grade field locks (disabled `<Input>`) whenever
  `formData.fabricationRef` is set, same treatment as the 3 units above. Metrology is untouched — stays
  independently editable, unrelated to fabrication.

**Why Material Grade, not Metrology**: a designation like "SS 304" reads naturally as a grade, not a metrology/
measurement concept — confirmed with the client before implementing.

**Why the BOM view needs no changes at all**: `bomFieldFormat.js`'s Metrology/Material Grade columns already
handle sparse data gracefully (render "—" when a field is empty) — since only Material Grade gets populated for
a fabrication material and Metrology is simply never touched for these items, the existing two-column table
already shows the combined value in the right column and an honest blank in the other, with zero special-casing
needed. This is the same reasoning that made the earlier Unit Weight/Dimensions split low-risk.

**Backward compatible, with one real limitation**: existing Fabrication Master entries created before this
change have no stored `material` (the field didn't exist yet) — Inventory items created from them won't
backfill retroactively. Only Fabrication Master entries created or re-saved after this change populate it.

## Follow-on (2026-08-22): Edit/Delete for company-added custom materials

Client noticed the Dimension Calculator's Material dropdown lets a company add its own materials (beyond the
5 built-ins MS/GI/SS 202/SS 304/SS 316) but never offers a way to fix a typo or remove one afterward.

**Built-ins are still permanently fixed** — `MATERIAL_DENSITY_TABLE` stays a hardcoded constant, never a DB
row, so it was never a candidate for Edit/Delete. Only `FabricationMaterial` documents (`custom: true` in
`getMaterials`' merged response) are ever editable/deletable.

- **`server/controllers/fabricationMasterController.js`**: new `updateMaterial`/`deleteMaterial`, sitting right
  after `createMaterial` and reusing its same validation (name required, positive density, can't collide with a
  built-in's label/key, can't collide with another custom material's name — case-insensitive, `$ne` self-excluded
  on update). Both scope every query to `{ _id: req.params.id, company: req.user.companyId }`, so one company can
  never edit or delete another's custom material even by guessing an id.
- **`server/routes/fabricationMasterRoutes.js`**: `PUT /materials/:id` and `DELETE /materials/:id`, gated behind
  the same `fabricationMasterEdit` (`checkPermission('rnd', 'inventory', 'edit')`) already used for every other
  Fabrication Master write — there's no separate delete permission in this module, edit's is reused.
- **Deleting is safe with no orphaned-reference risk**: nothing stores a `FabricationMaterial._id` anywhere.
  `FabricationMaster.material` and `Item.materialGrade` (see the Material Grade follow-on above) only ever copy
  the material's *name* as a plain string at save time — never the id — so a deleted custom material simply stops
  being pickable going forward; anything that already used it keeps its already-saved label/density untouched.
- **`client/src/components/fabrication/DimensionCalculatorModal.jsx`**: the native `<select>` used for Material
  can't host a button inside an `<option>` (unlike the Radix `<Select>`/`SelectItem` pattern used elsewhere, e.g.
  `SimpleInventoryForm.jsx`'s Receive Unit picker), so Edit (pencil) and Delete (trash) icon buttons sit in the
  same row as the dropdown instead, next to the existing "+" Add button — shown only when
  `materials.find(m => m.key === material)?.custom` is true, i.e. only when a company-added material is currently
  selected. The existing inline Add-Material panel is reused for editing too: `openEditMaterial()` pre-fills
  `newMatName`/`newMatDensity` from the selected material and sets `editingMaterialId`; `handleAddMaterial` then
  branches `PUT /materials/:id` vs the original `POST /materials` on save depending on whether that id is set.
  Delete goes through a `window.confirm` guard, then falls back to MS (or blank if MS is somehow unavailable)
  if the just-deleted material was the one currently selected.

## Follow-on (2026-08-24): Material Flow — low-stock auto-purchase requests

Client wants every purchasable Inventory item classified High/Medium/Low Flow, driving an automatic Purchase
Request once stock runs low. Full design reasoning (why cron-only over hooking Transfer-to-Production, why the
label is a preset rather than a fixed constant, why fabrication dimension variants can't use an ObjectId
reference for dedup) is captured in the plan this was built from — the short version:

- **`server/models/Inventory.js`**: new top-level `materialFlow` (`'High Flow'|'Medium Flow'|'Low Flow'|''`) +
  `reorderQty` (Number, denominated in `purchaseUnit`) alongside the pre-existing `minStock` (now actually
  surfaced in a form for the first time — previously carried silently with no input control anywhere). Same
  three fields added to `dimensionVariants[]` (`minStock` didn't exist there before) — every fabrication
  dimension size is its own independent flow, since Store cuts/tracks/reorders each size separately.
- **Material Flow is a *preset*, not a lock**: picking a label auto-fills Min Stock (20/10/5) but it stays a
  plain editable number right next to it — resolves the client's own "fixed value vs custom per item"
  contradiction. Order Quantity is a *separate* field, not label-driven, and must be `>= minStock` (validated
  both client- and server-side) — ordering less would leave stock at/below the trigger and immediately
  re-fire the same request.
- **`server/jobs/lowStockReorderCron.js`** (new), registered in `server/index.js` alongside the 3 pre-existing
  `node-cron` jobs, every 30 minutes. Deliberately **not** also hooked into Transfer-to-Production or any other
  single stock-decreasing action — research for this feature found 9+ places `Item.qty`/`dimensionVariants[]
  .subStock` can decrease (transfer-to-production, bulk transfer, fabrication cutting, Store's own QC-routing
  deduction, Dispatch, Sales Invoice, Service-visit parts, Purchase Returns, manual adjustment); a sweep that
  re-checks everything catches all of them uniformly instead of only whichever ones got an explicit hook, and
  is simpler to reason about than "cron + instant hook" once a dedup check is in place anyway (see below) — the
  "instant" response isn't operationally meaningful when Purchase lead times are measured in days.
- **Every auto-created request is pre-approved** (`source: 'Store'`, `storeApproved: true`, `autoGenerated:
  true`) — goes straight to Purchase exactly like Store's own manual "Not Available" requests already do
  (`storeFlowService.js` CASE 3), per direct client confirmation that adding an approval step would partly
  defeat the point of automating this.
- **Dedup**: `PurchaseRequest.reorderItemId` (new field, ref `Item`) plus `autoGenerated: true` and an open
  status (`Pending`/`Approved`/`Ordered`) is enough for non-fabrication items. For a fabrication dimension,
  there's deliberately **no** `reorderDimensionVariantId`-style ObjectId reference — investigation found
  `Item.dimensionVariants[]._id` is NOT stable across item edits (`sanitizeItemData`'s `dimensionVariants` map
  in `inventoryController.js` rebuilds each variant as a fresh plain object without carrying over `_id`, so
  Mongoose mints a new one on every save that touches this array — which is every save from
  `SimpleInventoryForm.jsx`, since it always round-trips the whole array). Dedup instead matches on
  `fabricationDimensionLines[0].values` via `dimensionSignature()` (`fabricationDemandService.js`) — the same
  content-based identity `fabricationDimensionLines` already uses everywhere else, for the same reason.
- **Fabrication order quantity resolution reuses `resolveFabricationLines`** (exported from
  `purchaseRequestController.js`, previously module-private) rather than re-deriving the weight/mass-unit math
  a fourth time — same function `createPurchaseRequest`/`previewFabricationTotal`/`receiveFabricationPurchase`
  already share. A fabrication dimension's own `reorderQty` is a **piece count** (e.g. "8 pieces of this
  size"), not a purchase-unit number directly — `resolveFabricationLines` converts that into the actual
  purchase-unit quantity (typically kg) the same way Store's own multi-dimension request flow already does.
  Non-fabrication `reorderQty` stays a direct purchase-unit number, per the client's own description.
- **Scope**: only `purchase: true` items (and their dimension variants) get Material Flow fields shown/swept —
  an Internal-Manufacturing item has no purchase-based reorder concept.
- **`client/src/pages/accounts/PurchaseRequest.jsx`**: a small teal "Auto (Low Stock)" badge next to the
  existing source badge, keyed off `autoGenerated`, so Purchase/Store can tell an auto-raised request apart
  from one a person clicked — no other change needed on the Purchase-side UI, since an auto-generated request
  has the exact same shape as a manual Store one.
- Verified end-to-end against the real dev DB with disposable scratch items (created, swept twice to confirm
  no duplicate on the second pass, then deleted) — non-fabrication path and fabrication path (including
  confirming an unflagged sibling dimension variant is correctly left untouched) both behaved as designed.

### Follow-on (2026-08-24): clarified units + integer enforcement on fabrication dimension quantities

The client raised the exact edge case the design above was already built to avoid — ordering fabrication stock
by weight (kg) can't guarantee it divides into whole pieces (a vendor only ever sells whole pieces). Two things
came out of checking this:

1. The design was already correct (`dimensionVariants[].reorderQty`/`minStock` are piece counts, converted to
   the purchase-unit weight only in one direction, pieces → kg, via `resolveFabricationLines` — never kg → pieces,
   so there's no fractional-piece risk), but **this was never visible in the UI** (the per-dimension inputs had
   no unit label at all) and, worse, **the schema comment on `reorderQty` was wrong** — it said "denominated in
   the item's purchaseUnit," copy-pasted from the top-level field's comment, contradicting the actual cron logic.
   Fixed the comment in `Inventory.js` and added a small "pcs" suffix on both per-dimension inputs in
   `SimpleInventoryForm.jsx` (and a purchaseUnit suffix on the top-level Order Quantity input, replacing the
   long "(in X)" label text with the same small-inline-text pattern) so this is now visible, not just documented.
2. Nothing had stopped R&D from typing a non-integer piece count (e.g. "8.5") in either per-dimension field —
   added `Number.isInteger()` validation for `dimensionVariants[].minStock`/`.reorderQty` both client-side
   (`SimpleInventoryForm.jsx`'s `handleSubmit`) and server-side (`inventoryController.js`'s `validateItemData`),
   mirroring the existing minStock/reorderQty-relationship validation already there. Top-level `reorderQty`
   deliberately stays un-restricted to whole numbers — it's a direct purchaseUnit amount (e.g. "10.5 kg" is a
   perfectly valid mass), unlike the per-dimension piece counts.
