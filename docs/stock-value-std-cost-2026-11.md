# Stock value: Standard Cost now holds the item's real cost (price gap 5)

*Built 24 November 2026. From [price-cascade-open-gaps-2026-10.md](price-cascade-open-gaps-2026-10.md), gap 5.*

## The problem
Stock value is **quantity × Standard Cost** in three places: the Inventory dashboard total, the inventory stats, and the MIS stock-value report. But nobody can type a Standard Cost (no form has a box for it), and the system filled it only for Machines and made Child Parts. So **raw materials, anything bought, bought parts and made Sub Child Parts counted as ₹0**, even though the system knew their cost in other fields.

## What changed
**The system now copies the cost it already has into Standard Cost.** It's only a copy:
- no price is worked out from Standard Cost
- BOM prices, MRP, Sale Price and the purchase cost maths are exactly as before

| Item | Standard Cost now |
|---|---|
| Raw material / anything bought (incl. a bought Motor or Machine) | **= Purchase Cost**, copied whenever a purchase price is set: Store's receive (from the PO line), a manual bill, Accounts' manual price, switching a part to bought |
| Made Sub Child Part | **= its unit cost** (material + job work + labour + expense + scrap), the same number the Child Part BOM uses, copied every time its cost changes |
| Bought Sub Child Part | **= its purchase cost** |
| Made Child Part | its BOM total (as before) |
| Bought Child Part | **= its purchase cost** (before, the price push wrote its made cost) |
| Made Machine | its BOM cost (as before) |

**One rule kept from make-or-buy:** a part that's made here but receives an old purchase order only updates its bought cost. Its Standard Cost stays its made cost.

## What looks different
1. **Stock values** (Inventory dashboard, inventory stats, MIS report) now count these items at their cost instead of ₹0.
2. **Item details that show Standard Cost** (Product Master's "Std / Purchase Cost", the item card on Accounts' Purchases screen) show the cost instead of ₹0.
3. **Sales Invoice, Damages and Returns** take MRP, then Sale Price, then Standard Cost. Only an item with neither MRP nor Sale Price would now show its cost instead of ₹0. Bought items already get MRP and Sale Price at purchase, and Sub Child Parts aren't sold.

## What didn't change
- **BOM line prices** still come from Purchase Cost or the ₹/kg rate.
- **A Machine's Child Part lines** still use the Child Part's worked-out cost.
- **MRP / Sale Price** are worked out as before, from the same cost.
- **The item's cost source** (which decides how MRP is built) is never touched by the copy.
- **There's still no box to type Standard Cost.** An item with no cost yet still shows in the MIS "no cost" count.

## The dev server
- **A one-time fill** for items that already had a cost before the copy existed: 24 items (23 on test-1, 1 on another dev company).
  - It was run with a dry run first.
  - Each item's previous value is saved for undo in `D:\cs\db-backups\stdcost-fill-2026-11-24\changed.json`.
- **The live server needs nothing:** it has only product master data, with no purchases or BOM costs, so the copy fills Standard Cost as the costs come in.

## Files
- `services/itemPricingService.js` → `applyPricingToItem`: a purchase price is also written to Standard Cost.
- `services/priceCascadeService.js`:
  - `onSubChildPartChanged` writes the Sub Child Part's Standard Cost first (`syncSubChildPartStdCost`)
  - `recomputeChildPart` writes a bought Child Part's purchase cost
- `controllers/childPartBOMController.js`: `subChildPartLineCostFrom` exported (the shared unit-cost formula).

## Tested
- **The new suite `stdcostcopy`: 10 of 10**, with the real services on a made-up company:
  - **a purchase:** Purchase Cost = Standard Cost; MRP ₹60 / Sale Price ₹54 as before
  - **a made Sub Child Part:** ₹138 = 100 + 20 + 5 + 10 + 3, cost source unchanged, nothing rewritten for the same cost
  - **a bought Sub Child Part:** ₹75
  - **a made Child Part:** its BOM ₹276; **a bought Child Part:** ₹500; the Machine prices its lines as before (₹776)
  - **a made part receiving an old PO:** keeps ₹138
  - **stock value:** ₹2,857 with no ₹0 rows
- **Regression** (the price push and purchase pricing): `fabsync` 32, `makebuy-s2` 19, `makebuy-s3` 9, `makebuy-gate` 18, `labour` 34, `ba` 23, `purchdays` 36, all passing.
