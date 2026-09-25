# Resolved: `unitWeightValue` reference unit for non-fabrication Length/Area/Volume Unit items

**Status: resolved 2026-09-07.** Client confirmed non-fabrication items in these 3 Used Unit categories are
never purchased in Length/Area/Volume units in practice, and asked to build explicit per-unit weight support
rather than leave the display gap below. Existing dev-only records were NOT migrated (not production data) —
they simply keep showing "—" for Total Weight until re-saved through the new form, same as any other legacy
record with a blank field.

## The fix

`Item.unitWeightUnit` (and `unitWeightUnitType`) now mean something different for a Length/Area/Volume Used
Unit item than for a Mass/Count one:

- **Mass/Count Used Unit (unchanged)** — `unitWeightUnit` is still the WEIGHT's own unit, hardcoded
  `'Kilogram'` (`SimpleInventoryForm.jsx`) — no ambiguity, as established below.
- **Length/Area/Volume Used Unit (new)** — `unitWeightUnit` is now the REFERENCE unit `unitWeightValue` (kg) is
  defined per, chosen independently of the item's own Used Unit via a new "per [unit]" dropdown next to Unit
  Weight, scoped to the same UnitType (so a thin wire can be "1 kg per Meter" instead of an awkward "0.0002 kg
  per Millimeter" if Used Unit happens to be Millimeter).

BOM Total Weight (`rdController.js`'s `bomMaterialTotalWeight`, used by the BOM PDF's `writeBOMPdf`) now
converts the BOM line's own resolved amount (`mat.quantity`, already in `mat.amountUnit` = the item's Used
Unit) into `mat.unitWeightUnit`'s scale via the new `convertBetweenUnits` helper
(`server/utils/unitConversion.js`, backed by `LENGTH_UNIT_TO_MM`/`AREA_UNIT_TO_MM2`/new `VOLUME_UNIT_TO_ML`)
before multiplying — e.g. Item's Used Unit Millimeter with a BOM line of 100mm, weight rate "1 kg per Meter" →
100mm converts to 0.1m → 0.1 kg, not the wrong 100 kg a naive same-unit multiplication would give. Returns null
(still renders "—", never a guessed number) when the material has no recorded reference unit (legacy dev data)
or the two units aren't in the same category.

`formatUnitWeight` (`client/src/utils/bomFieldFormat.js`, BOM Management's Unit Weight column) and
`ViewItemModal.jsx`'s own Unit Weight row both display the new "X kg / Y" phrasing for this category instead of
the old bare "X Y".

## Original problem (superseded, kept for context)

## The problem

`Item.unitWeightValue`/`unitWeightUnit` (`server/models/Inventory.js`, manually typed on `SimpleInventoryForm.jsx`, snapshotted onto `RDBOM.MaterialSchema.unitWeightValue`/`unitWeightUnit` when a BOM material is added — see `rdController.js`'s `addMaterial`/`updateMaterial`) is a single flat number with **no enforced "per how much" convention**. The form just asks for a value and a unit (e.g. "0.005 Kilogram") with no field indicating what quantity of the item that weight corresponds to.

This is fine for two of the four Used Unit categories, genuinely ambiguous for a third, and moot for the fourth:

- **Count Unit (Pieces)** — unambiguous. "Weight of one piece" has exactly one natural reading. `unitWeightValue` × piece count is always correct.
- **Mass Unit (Kilogram/Gram/Tonne)** — moot, not actually needed. When the item's own Used Unit is already a mass unit, its quantity *is* its weight (after a Mass Unit → kg conversion, e.g. `itemPricingService.js`'s `MASS_UNIT_TO_KG_MULTIPLIER`). No separate weight-per-unit concept is even required here.
- **Length / Area / Volume Unit (Centimeter, Meter, Meter Square, Liter, etc.) — the actual problem.** There's nothing stopping — or even discouraging — someone from entering `unitWeightValue` as "weight per 100cm" or "weight per roll" or some other reference scale, since the form never asks. A thin wire's true "weight per 1cm" would often be an awkwardly tiny decimal (e.g. 0.0002 kg) that's error-prone to type precisely, so in practice a user is plausibly more likely to have entered it against a larger, more natural reference quantity than "exactly 1 [Used Unit]" — with nothing recorded anywhere to say which scale they actually used. `unitWeightValue × quantity` for these items could silently be off by whatever factor the original entry assumed, with no way for the system (or a downstream reader) to tell.

## Where this surfaces

- **BOM Management's materials table and the BOM PDF** (`BOMCreationTab.jsx`, `rdController.js`'s `writeBOMPdf`) — "Unit Weight" column. Decision made 2026-08-20: keep showing the raw `unitWeightValue`/`unitWeightUnit` as-is for every material (unaltered, literal data — not a new assumption), but do **not** compute/show a derived "Total Weight" (`unitWeightValue × quantity`) for a non-fabrication material whose Used Unit is Length/Area/Volume — render "—" there instead, rather than presenting a number that might be silently wrong. Total Weight *is* computed normally for fabrication materials (weight is server-computed from geometry × density, no ambiguity), non-fabrication Pieces materials, and non-fabrication Mass Unit materials (= quantity itself, converted to kg).
- Any other future feature that might want to sum/report material weight (e.g. total machine weight, shipping weight) inherits the exact same gap for this item category — worth checking before trusting `unitWeightValue`-derived totals anywhere else.

## What needs clarifying with the client

1. Is `unitWeightValue` even *meant* to represent "weight per 1 Used Unit" for a Length/Area/Volume item, or is it meant as something else entirely (e.g. a packaging/shipping weight, unrelated to per-unit rate)?
2. If it is meant as a per-unit rate: should the form be changed to make the reference scale explicit (e.g. "weight per ___ [Used Unit]" as two fields instead of one implicit "per 1"), so existing and future entries are unambiguous?
3. Is there appetite to re-audit/re-enter existing `unitWeightValue` data for already-created Length/Area/Volume items once the convention is settled, since today's values can't be trusted to follow any single scale?

## Resolution tracking

Resolved 2026-09-07 — see "The fix" at the top of this doc.
