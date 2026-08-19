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
