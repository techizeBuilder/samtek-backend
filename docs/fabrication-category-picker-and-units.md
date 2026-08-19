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
   Density; MS/GI/SS202/SS304/SS316 table), Density value + kg/m³↔g/cm³ unit converter, a static "By Length"
   badge (no By Weight anywhere, per requirement), the shape's dimension fields (each with its own mm/cm/
   inch/m unit), Pieces, Price Per kg, a live weight preview, and Save/Calculate/Clear. **Save** appends the
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

## Category taxonomy: 11 tiles, 18 backend keys

`server/utils/fabricationCategories.js` still has its precise per-formula keys (now 18, up from 16 — see
below) — **existing saved items keep working unchanged**, nothing was renamed. Each entry now also carries a
`group` field mapping it onto one of the 11 tiles:

| Tile (group)     | Backend key(s)                                          | Sub-type picker shown in Modal 2? |
|-------------------|----------------------------------------------------------|------------------------------------|
| Round Bar         | `round_bar`                                               | no |
| Pipe              | `pipe_circular`, `hss_circular`                            | no (identical formula, merged) |
| Square Bar        | `square_bar`                                               | no |
| Hexagonal Bar     | `hex_bar` **(new)**                                        | no |
| Square Tubing     | `hss_square`, `hss_rectangular`                            | yes — "Tube Shape": Square/Rectangular |
| Beam              | `beam_ipn`, `beam_ipe`, `beam_hea`, `beam_heb`             | yes — "Beam Type" |
| T-Bar             | `t_bar` **(new)**                                          | no |
| Channel           | `channel_gost`, `channel_upn`                              | yes — "Channel Type" |
| Angle             | `equal_angle`, `unequal_angle`                             | yes — "Angle Type" |
| Flat Bar          | `flat_bar`                                                 | no |
| Sheet             | `sheet_plate`                                              | no |

`FABRICATION_CATEGORY_GROUPS` (same file) is the single source of truth for this table — it's what
`CategoryPickerModal` renders and what `GET /api/fabrication-master/categories` now also returns (`groups`
key, alongside the existing `data` and the new `materials` key for the Material dropdown table).

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
| Category/group/material definitions, weight formulas | `server/utils/fabricationCategories.js`, `server/utils/fabricationWeightCalc.js` |
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
