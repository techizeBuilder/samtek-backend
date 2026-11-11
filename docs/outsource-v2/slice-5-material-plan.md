# Slice 5 — the material plan

- **Date:** 2026-10-20
- **Status:** **built** 2026-10-20 (26 tests) — change report §4. Browser check pending.
- **Logic:** [material-logic-2026-10.md](material-logic-2026-10.md) (M1–M4).
- **Next:** slice 6 (Dispatch trips and the real handovers) uses this plan to move the stock.

## What this slice does

1. **When Purchase makes an Outsource Order,** each request gets a **material plan**: for every
   material line of the steps it covers, how much comes from **Production** (what Production
   holds for that order) and how much from **Store**. Sheet and length material from Store on a
   line is **combined** into whole sheets / lengths and shared out by area / length.
2. **Production can't issue the Store part.** Its Issue limit drops by it. A request Production
   already raised but Store hasn't sent yet is trimmed back.
3. **Production's Material List shows** "goes to the vendor (OSO-…)" on those lines.
   **Purchase's order detail shows** the plan.
4. **The Production part is used when the trip goes out.** The Store part never counts against
   Production's floor. Receiving the trip no longer records the step's material use again.
5. **Fix G2:** the per-step material check (`resolveStepMaterialLines`):
   - finds sheet / length material by its real list key (it used the plain code, so it never
     matched)
   - counts in the list's own unit (sheets, cut pieces)
   - respects a step's quantity split

## Refinements found while reading the code

- **The earmarks are read from the Outsource Orders themselves** (`lines.requests.materialPlan`
  of active orders), not copied onto the production order. One source of truth: a cancelled or
  rejected order drops out on its own (its requests become *Released*).
- **The Production part counts only while its request is still *Ordered*.** Once it goes out,
  it's in the order's own "used" figure.
- **Orders made before this slice have no plan** and keep the old behaviour.
- **Until slice 6,** Mark sent moves stock as before: the Sub Child Part picker is real; Child
  Part / Machine is still the dummy. Slice 6 moves all of it to Store's handover through the
  plan.

## Plan rows

| Kind | For | Need in | Production part counted in |
|---|---|---|---|
| `plain` | raw / assembly / consumable | the line's unit | the same unit |
| `parts` | Sub Child Part / Child Part references | pieces | pieces |
| `cutPieces` | length material (Child Part / Machine) | BOM cut pieces | cut pieces |
| `sheetArea` | sheet metal | mm² | sheets (area ÷ sheet area) |
| `length` | a Sub Child Part's source length | mm | — (always Store) |
| `wip` | the units / pieces themselves | units / pcs | — |

**Combined** (per line, per item + size, for the Store part of `sheetArea` / `length`):
- **Sheets / lengths:** total ÷ piece size, rounded up. A Sub Child Part with a Sheet Plan uses
  the plan's sheets per piece × pieces, rounded up.
- **Each row's `storeShare`** = sheets × its area ÷ the total.

## Tests (hand-worked)

| Case | Setup | Expected |
|---|---|---|
| A | Bracket, 12 + 6 pcs, 0.3 m², sheet 3.125 m² | 2 sheets; shares 1.333 / 0.667 |
| B | Rod, 20 + 10 pcs, 400 mm, length 6000 mm | 2 lengths; shares 1.333 / 0.667 |
| C | Frame, units 1–2, 0.5 m² per unit | 1.0 m² → 1 sheet |
| D | Paint 2 L per unit × 3; Production holds 4 L | 4 from Production, 2 from Store; Issue limit 6 − 2 = 4 |
| In transit | Store sent 4 L, Production hasn't received | counts as Production's |
| Release | the order is rejected / cancelled | the plan drops out, the Issue limit is back |
| G2 | — | a sheet line's step check finds the issued sheets; the quantity split is respected |
| Regression | — | slices 2 and 3 still pass |
