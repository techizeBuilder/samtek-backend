# Fabrication BOM Weight/Price

## What it does

Client requirement (BOM Management): a BOM material line needs Unit Dimension fields (Length, Height, Width, Dia OD/ID, Thickness...) and its Weight and Price calculated from those dimensions × quantity, not a flat per-piece value. Real-world driver: a BOM might only consume part of a sheet (e.g. a 500×300mm cut off a full sheet), so the dimensions actually used have to be entered per BOM line, not just inherited from the Inventory item's own stock dimensions.

**Scoped to Fabrication Master items only** (`Item.fabricationRef` set) — a plain bought part (motor, bolt) has no density/shape to compute a real weight from. Everything else on a BOM (materials without a `fabricationRef`) works exactly as before: flat `purchaseCost × quantity`, no dimension inputs shown.

Two things had to be built together:
1. **`weightUnitPrice`** — a new ₹/kg pricing field on `Item`, since `purchaseCost` (₹ per *piece*) can't represent a weight-based rate — see "Why not reuse purchaseCost" below.
2. **BOM material dimensions** — an editable per-line dimension input + server-computed weight, reusing Fabrication Master's own category formulas.

---

## Code locations

**Backend** (`Samtek-Backend/Samtek-Backend/server/`):

| File | What's in it |
|---|---|
| `models/Inventory.js` | `weightUnitPrice` field on `Item` (₹/kg, fabrication items only, hidden from the Inventory form like `purchaseCost`/`stdCost`). |
| `services/itemPricingService.js` | `resolvePurchaseItemCost()` — now also returns the raw pre-conversion PurchaseInvoice unit price. `applyPricingToItem()` — writes it into `weightUnitPrice` (converted to ₹/kg) when `item.fabricationRef` is set. `resolveManufacturingItemCost()` — the machine-cost BOM roll-up, now reads a fabrication material line's `computedWeightPerPieceKg × weightUnitPrice` instead of `purchaseCost`. |
| `controllers/purchaseController.js` | `updateWeightUnitPrice()` — Accounts' manual "first purchase" entry point, mirrors `updatePurchaseItemCost()`. `getPurchaseInventoryItems()` — select list extended with `fabricationRef`/`weightUnitPrice`/`dimensionVariants`. |
| `routes/accountsRoutes.js` | `PUT /api/accounts/purchases/inventory/:id/weight-unit-price`. |
| `models/RDBOM.js` | `MaterialSchema` — `fabricationCategory`, `bomDimensions`, `computedWeightPerPieceKg`. |
| `controllers/rdController.js` | `resolveFabricationWeight()` — shared helper, calls `calculateFabricationWeight()`. `addMaterial()`/`updateMaterial()` — branch on `sourceItem.fabricationRef` for pricing. |
| `utils/fabricationWeightCalc.js` | `calculateFabricationWeight()` — the actual shape/density math (unchanged, reused as-is; already built for Fabrication Master's own Add-Item form). |
| `utils/fabricationCategories.js` | `FABRICATION_CATEGORIES` — the 16 shape categories and their field sets (unchanged, reused as-is). |

**Frontend** (`Samtek-Frontend/Samtek-Frontend/client/src/`):

| File | What's in it |
|---|---|
| `pages/accounts/PurchaseInventory.jsx` | Tools & Raw Material tab — fabrication rows show a "Price per kg" input (bound to `weightUnitPrice`) instead of "Purchase Cost" (column header stays "Purchase Cost" for everyone; the `/kg` distinction is only on the input itself, per row). Total Stock Value branches per row: fabrication items contribute `weightUnitPrice × stock weight`, everyone else `purchaseCost × qty`. |
| `pages/ResearchDevelopment/BOMManagement/BOMCreationTab.jsx` | `FabricationDimensionFields` component — renders the matched item's category-specific dimension inputs with a 400ms-debounced live weight+price preview (calls the same `calculate-weight` endpoint Fabrication Master's own form uses). Wired into both the Add Material rows and the Edit Material dialog. |

---

## Why not reuse `purchaseCost`

`purchaseCost` is structurally ₹-per-*piece* (the item's base/storage unit) — confirmed by `itemPricingService.js`'s own comment: *"invoice unitPrice is per PURCHASE unit... but stdCost/purchaseCost... are in the item's base/storage unit"*, and the conversion-factor multiply inside `resolvePurchaseItemCost`. It's also already load-bearing everywhere (Total Stock Value, MRP/Sale Price auto-pricing) for every item type — repurposing its meaning for a subset of items would silently corrupt those.

It's also incoherent for a fabrication item specifically: one `Item` can carry multiple `dimensionVariants` (different sizes/thicknesses), each with a different piece weight — there's no single "₹ per piece" that's correct across a small offcut and a full sheet of the same item. Only ₹/kg stays constant. Hence a dedicated field, fully replacing `purchaseCost`'s role for fabrication items rather than coexisting with it.

---

## How `weightUnitPrice` gets populated

Same two-path pattern `purchaseCost` already uses:

1. **Automated** — `resolvePurchaseItemCost()` already reads a `PurchaseInvoice` line's raw `unitPrice` (₹ per *purchase* unit, e.g. ₹/kg) before multiplying by the purchase→base conversion factor to get `purchaseCost`. For fabrication items, that pre-conversion figure is also persisted into `weightUnitPrice` (normalized to ₹/kg if the purchase unit was Gram or Tonne instead of Kilogram — `MASS_UNIT_TO_KG_MULTIPLIER` in `itemPricingService.js`).
2. **Manual fallback** (first purchase, no invoice history yet) — Accounts sets it directly on `/accounts/purchases/inventory`'s Tools & Raw Material tab, same inline-edit-and-Save UX as `purchaseCost`, via `PUT .../weight-unit-price`.

`purchaseCost` itself is untouched either way — it keeps getting set normally for every item (fabrication or not); `weightUnitPrice` is purely additive.

---

## How a fabrication BOM material is priced

1. Sales/R&D picks a material by code in BOM Management. If the matched Inventory item has `fabricationRef` set, `FabricationDimensionFields` renders that item's category's own dimension fields (same fields/labels as its Fabrication Master entry).
2. As dimensions are entered, a debounced call to `POST /api/fabrication-master/calculate-weight` (category + density, both known from the item's `dimensionVariants[0]`) returns `weightPerPieceKg` — same formula Fabrication Master's own Add-Item form uses, live-previewed in the UI.
3. On save, the server (`addMaterial`/`updateMaterial` → `resolveFabricationWeight`) recomputes this authoritatively — the client-side preview is never trusted — and stores:
   - `bomDimensions` — this BOM line's own entered values (independent of the Item's stock dimensions — "how much is consumed here," not "what size is in stock").
   - `computedWeightPerPieceKg` — the resolved weight.
   - `unitPrice = computedWeightPerPieceKg × Item.weightUnitPrice`, `totalPrice = unitPrice × quantity` (unchanged fields, just a different source for fabrication lines).
4. The machine-cost roll-up (`resolveManufacturingItemCost`, which feeds the parent machine's auto-computed `stdCost`/MRP/Sale Price) reads that same stored `computedWeightPerPieceKg × weightUnitPrice` for fabrication lines instead of `purchaseCost` — so a change here also flows through to the machine's price, same as any other BOM material change already does.

Non-fabrication materials never touch any of this — `unitPrice = sourceItem.purchaseCost`, `totalPrice = unitPrice × quantity`, exactly as before this feature existed.

---

## API

- `PUT /api/accounts/purchases/inventory/:id/weight-unit-price` — body `{ weightUnitPrice }`. Server-side gated to `fabricationRef: { $ne: null }` (404s otherwise) — not just a frontend-only restriction.
- `POST /api/fabrication-master/calculate-weight` — pre-existing, reused as-is for the BOM live preview. `{ category, values, densityValue, densityUnit, designation? }` → `{ weightPerMeterKg, weightPerPieceKg }`.

Both require authentication, same as the rest of these modules.

---

## Design decisions worth knowing about

- **Column header on Purchase Inventory stays "Purchase Cost" for every row** — the ₹/kg vs ₹/piece distinction is shown only on the input itself (a small `/kg` suffix), per row, not in the shared header, since the table mixes fabrication and non-fabrication rows on the same tab.
- **`bomDimensions` is deliberately separate from `Item.dimensions`/`dimensionVariants`.** The Item's own dimensions describe what's in stock; `bomDimensions` describes what one specific BOM line consumes — they're allowed to differ (a full sheet in stock, a smaller cut used in a build), by design.
- **Density/category are read from the Item, not re-entered per BOM line.** Every `dimensionVariant` of one fabrication Item shares the same category/density (they're all cuts of the same real-world material), so `dimensionVariants[0]` is always a safe source — with a `FabricationMaster` lookup as a fallback if that array is ever empty.
- **`resolveManufacturingItemCost` trusts the BOM line's own stored `computedWeightPerPieceKg`**, not a live re-derivation from the Item's current stock dimensions — the entered `bomDimensions` are that line's committed input, same treatment as its `quantity`.
