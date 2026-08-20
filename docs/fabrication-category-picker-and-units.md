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
