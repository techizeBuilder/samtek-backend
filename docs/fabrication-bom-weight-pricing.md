# Fabrication Master — Weight-Based Pricing & Purchase Flow

Everything built around Fabrication Master items (`Item.fabricationRef` set — raw shapes: sheets, pipes, angles, beams) across BOM pricing, Production's material handshake, and the full Purchase Request → RFQ → PO → Receiving cycle. Scoped to fabrication items only throughout — every part below leaves non-fabrication items' behavior untouched; that's called out per section, not just once here.

**Parts, roughly in the order they were built:**
1. [BOM weight/price](#part-1--bom-weightprice) — `weightUnitPrice`, BOM material dimensions
2. [Material Demand handshake](#part-2--material-demand-rd--production-handshake) — R&D → Production, dimension-aware demand lines
3. [Store transfer & return](#part-3--store-transfer--return-production--store) — cutting decisions, leftover tracking
4. [Production Order Management](#part-4--production-order-management-polish) — display/audit fixes
5. [Purchase Requests](#part-5--purchase-requests-consolidated-multi-dimension) — consolidated multi-dimension requests
6. [RFQ / vendor flow](#part-6--rfq--vendor-flow) — combined edit+send form, vendor-facing breakdown
7. [Store receiving](#part-7--store-receiving) — dimension-aware stock + pricing on receipt

**Core recurring concepts**, referenced throughout:
- **`dimensionSignature(values)`** — deterministic `key:value,key:value` string (sorted keys) used everywhere to compare/match a set of dimension values regardless of object key order. Server: `services/fabricationDemandService.js`. Client: `client/src/lib/fabricationDims.js`.
- **`Item.dimensionVariants[]`** — the per-Item stock-by-size array: `category, values, designation, densityValue, densityUnit, weightPerMeterKg, weightPerPieceKg, subStock, isLeftover`.
- **`isLeftover`** — `true` on a variant that isn't an original catalog size (a Store-cut offcut, or an off-catalog size a vendor actually shipped). Valid stock for Production transfers; **never** offered as a reorderable size when raising a Purchase Request or an RFQ. Every dimension-picker in this codebase filters `!isLeftover` for that reason.

---

## Part 1 — BOM Weight/Price

### What it does

Client requirement (BOM Management): a BOM material line needs Unit Dimension fields (Length, Height, Width, Dia OD/ID, Thickness...) and its Weight and Price calculated from those dimensions × quantity, not a flat per-piece value. Real-world driver: a BOM might only consume part of a sheet (e.g. a 500×300mm cut off a full sheet), so the dimensions actually used have to be entered per BOM line, not just inherited from the Inventory item's own stock dimensions.

Two things had to be built together:
1. **`weightUnitPrice`** — a new ₹/kg pricing field on `Item`, since `purchaseCost` (₹ per *piece*) can't represent a weight-based rate — see "Why not reuse purchaseCost" below.
2. **BOM material dimensions** — an editable per-line dimension input + server-computed weight, reusing Fabrication Master's own category formulas.

### Code locations

**Backend** (`Samtek-Backend/Samtek-Backend/server/`):

| File | What's in it |
|---|---|
| `models/Inventory.js` | `weightUnitPrice` field on `Item` (₹/kg, fabrication items only, hidden from the Inventory form like `purchaseCost`/`stdCost`). |
| `services/itemPricingService.js` | `resolvePurchaseItemCost()` — also returns the raw pre-conversion PurchaseInvoice unit price. `applyPricingToItem()` — writes it into `weightUnitPrice` (converted to ₹/kg) when `item.fabricationRef` is set. `resolveManufacturingItemCost()` — the machine-cost BOM roll-up, reads a fabrication material line's `computedWeightPerPieceKg × weightUnitPrice` instead of `purchaseCost`. `MASS_UNIT_TO_KG_MULTIPLIER` — exported constant (`{Gram:1000, Kilogram:1, Tonne:1/1000}`), reused by several later parts. |
| `controllers/purchaseController.js` | `updateWeightUnitPrice()` — Accounts' manual "first purchase" entry point. `getPurchaseInventoryItems()` — select list extended with `fabricationRef`/`weightUnitPrice`/`dimensionVariants`. |
| `routes/accountsRoutes.js` | `PUT /api/accounts/purchases/inventory/:id/weight-unit-price`. |
| `models/RDBOM.js` | `MaterialSchema` — `fabricationCategory`, `bomDimensions`, `computedWeightPerPieceKg`. |
| `controllers/rdController.js` | `addMaterial()`/`updateMaterial()` — branch on `sourceItem.fabricationRef` for pricing. |
| `utils/fabricationWeightCalc.js` | `calculateFabricationWeight()` — the shape/density math (pre-existing, reused as-is; already built for Fabrication Master's own Add-Item form). |
| `utils/fabricationCategories.js` | `FABRICATION_CATEGORIES` — the 16 shape categories and their field sets (pre-existing, reused as-is). |

**Frontend** (`Samtek-Frontend/Samtek-Frontend/client/src/`):

| File | What's in it |
|---|---|
| `pages/accounts/PurchaseInventory.jsx` | Tools & Raw Material tab — fabrication rows show a "Price per kg" input (bound to `weightUnitPrice`) instead of "Purchase Cost". Total Stock Value branches per row: fabrication items contribute `weightUnitPrice × stock weight`. |
| `components/inventory/FabricationDimensionFields.jsx` | Shared category-specific dimension inputs + 400ms-debounced live weight+price preview (`POST /api/fabrication-master/calculate-weight`). Originally built for `BOMCreationTab.jsx`; later reused twice more — Production's Add-Demand dialog (Part 2) and Store's receive dialog (Part 7). |

### Why not reuse `purchaseCost`

`purchaseCost` is structurally ₹-per-*piece* (the item's base/storage unit) — confirmed by `itemPricingService.js`'s own comment: *"invoice unitPrice is per PURCHASE unit... but stdCost/purchaseCost... are in the item's base/storage unit"*. It's also already load-bearing everywhere (Total Stock Value, MRP/Sale Price auto-pricing) for every item type — repurposing its meaning for a subset of items would silently corrupt those.

It's also incoherent for a fabrication item specifically: one `Item` can carry multiple `dimensionVariants` (different sizes/thicknesses), each with a different piece weight — there's no single "₹ per piece" that's correct across a small offcut and a full sheet of the same item. Only ₹/kg stays constant. Hence a dedicated field, fully replacing `purchaseCost`'s role for fabrication items rather than coexisting with it — **until Part 7**, where `purchaseCost` gets a real, correct meaning again (weighted-average ₹/piece across what was actually received).

### How `weightUnitPrice` gets populated

1. **Automated** — `resolvePurchaseItemCost()` reads a `PurchaseInvoice` line's raw `unitPrice` (₹ per *purchase* unit, e.g. ₹/kg) before multiplying by the purchase→base conversion factor to get `purchaseCost`. For fabrication items, that pre-conversion figure is also persisted into `weightUnitPrice` (normalized via `MASS_UNIT_TO_KG_MULTIPLIER` if the purchase unit was Gram/Tonne instead of Kilogram).
2. **Manual fallback** (first purchase, no invoice history yet) — Accounts sets it directly on `/accounts/purchases/inventory`'s Tools & Raw Material tab via `PUT .../weight-unit-price`.

### How a fabrication BOM material is priced

1. R&D picks a material by code in BOM Management. If the matched Item has `fabricationRef` set, `FabricationDimensionFields` renders that item's category's own dimension fields.
2. Live debounced preview via `POST /api/fabrication-master/calculate-weight`.
3. On save, the server (`addMaterial`/`updateMaterial` → `resolveFabricationWeight`, see Part 2) recomputes authoritatively and stores `bomDimensions`, `computedWeightPerPieceKg`, `unitPrice = computedWeightPerPieceKg × Item.weightUnitPrice`, `totalPrice = unitPrice × quantity`.
4. The machine-cost roll-up (`resolveManufacturingItemCost`) reads that same stored `computedWeightPerPieceKg × weightUnitPrice` for fabrication lines instead of `purchaseCost`.

Non-fabrication materials: `unitPrice = sourceItem.purchaseCost`, `totalPrice = unitPrice × quantity`, unchanged.

### Design decisions worth knowing about

- **Purchase Inventory's column header stays "Purchase Cost" for every row** — the ₹/kg vs ₹/piece distinction is shown only on the input itself, since the table mixes fabrication and non-fabrication rows.
- **`bomDimensions` is deliberately separate from `Item.dimensions`/`dimensionVariants`.** The Item's own dimensions describe what's in stock; `bomDimensions` describes what one specific BOM line consumes.
- **Density/category are read from the Item, not re-entered per line.** Every `dimensionVariant` of one fabrication Item shares the same category/density — `dimensionVariants[0]` is always a safe source, with a `FabricationMaster` lookup as fallback.

---

## Part 2 — Material Demand (R&D ↔ Production handshake)

### Problem

`processRDRequest`'s Initial BOM Approval (`rdController.js`) merges a BOM's materials into `ProductionOrder.materialDemands` **by `code` alone** (built for a different reason — same bolt reused across Child Parts). With fabrication materials, the same raw Item code can legitimately appear in multiple BOM lines with **different `bomDimensions`** (one Child Part needs a 500×300mm cut, another needs 200×150mm, off the same sheet). Merged by code alone, that collapses into one flat "need 5 pieces" — which sizes are actually needed is lost.

### Fix

Fabrication materials merge by `code + dimension signature` instead of `code` alone; everything non-fabrication keeps merging by `code` exactly as before.

**The real risk found while building this**: `materialCode` is used as *the* unique lookup key for a demand line in 9+ places across Store issue/transfer/return, Add Demand, and Material Change approval (`order.materialDemands.find(m => m.materialCode === X)`). If two demand lines shared the same raw Item code, those lookups would silently grab whichever comes first.

**Solution — synthetic per-cut `materialCode`**: fabrication demand lines get `materialCode = \`${itemCode}#${dimensionSignature(dims)}\`` — a unique tracking key, never a real Inventory code. Every existing lookup keeps working unchanged (pure string equality). A new **`sourceItemCode`** field carries the *real* Item code wherever it actually needs resolving. This pattern is reused for every downstream demand/log record built afterward (Store transfer logs, return logs, issue logs, Purchase Requests).

### Code locations

| File | What's in it |
|---|---|
| `services/fabricationDemandService.js` (new) | `resolveFabricationWeight(sourceItem, bomDimensions)` — resolves category+density from the Item (or a `FabricationMaster` fallback), calls `calculateFabricationWeight`. `dimensionSignature(dims)`. Shared by `rdController.js`, `productionMfgController.js`, `inventoryController.js`, and later `purchaseRequestController.js`/`qcController.js`. |
| `models/ProductionOrder.js` | `MaterialDemandSchema` gained `sourceItemCode`, `bomDimensions`, `fabricationCategory`, `computedWeightPerPieceKg`, `unitPrice`. |
| `controllers/rdController.js` | `processRDRequest` WORKFLOW 2 — merge key is `mat.fabricationCategory ? \`${mat.code}#${dimensionSignature(mat.bomDimensions)}\` : mat.code`. `refreshBOMMaterialPrices` (keeps a BOM's displayed Price column live) made fabrication-aware — recomputes from `bomDimensions × Item.weightUnitPrice` instead of reverting to `purchaseCost`/0. |
| `controllers/productionMfgController.js` | `addMaterialDemand` — Production's own "Add Demand" (extra/reduced qty beyond the BOM), same fabrication branching; resolves fabrication fields via `resolveFabricationWeight`. |

**Frontend**:

| File | What's in it |
|---|---|
| `pages/ResearchDevelopment/RDProductionQueue.jsx` | Approve-requests review modal — BOM preview table gained a Dimensions column for fabrication lines. |
| `pages/production/OrderManagement.jsx` | Material Demand table shows `sourceItemCode`/cut size under the material name. "Add Demand" dialog: `openAdjustDemand` locks to one existing fabrication row (adjust qty only) vs. a fresh add (pick a new dimension) — two distinct entry points to avoid re-typing-dimension-match ambiguity. |

---

## Part 3 — Store Transfer & Return (Production ↔ Store)

### Design

Store fulfilling a fabrication demand line: pick a stock `dimensionVariant` to cut from. If it isn't already the exact BOM size, the leftover is recorded as a **new variant**, entered by Store themselves — not geometrically auto-derived (a rectangle cut from a rectangle isn't generally another clean rectangle; only the person physically cutting it knows the remaining shape).

**Manual leftover entry, constrained**: cutting can only change `length` (and, for `sheet_plate` specifically, `width` too) — every other field (thickness, wall thickness, OD, leg length...) is a fixed property of the stock, shown locked and pre-filled from the source variant. Leftover entry is **optional** — blank means the offcut is scrap (deduct source stock, create nothing); only an entered size creates/increments an `isLeftover: true` variant.

### Code locations

| File | What's in it |
|---|---|
| `models/Inventory.js` | `dimensionVariants[].isLeftover: Boolean`. |
| `controllers/inventoryController.js` | `transferMaterialToProduction`/`bulkTransferOrderMaterials`/`confirmReturn` — resolve the real Item via `demand.sourceItemCode \|\| demand.materialCode`, not `materialCode` directly (a fabrication demand's `materialCode` is the synthetic tracking key, see Part 2). New `transferFabricationMaterialToProduction` (`POST /api/inventory/transfer-fabrication-material/:id`) — the actual cutting-decision endpoint: deducts the chosen variant's `subStock`, optionally creates/increments a leftover variant server-side (never trusting client input for the locked fields). `bulkTransferOrderMaterials` skips fabrication demands entirely (no auto-transfer — a human has to pick which stock to cut), reporting `skippedFabricationCount`. `confirmReturn`'s Excess branch credits fabrication returns into the matching `dimensionVariant` (flagged `isLeftover: true` if newly created) instead of a meaningless `Item.qty` increment. |
| `models/StoreTransferLog.js` / `MaterialReturnLog.js` / `MaterialIssueLog.js` | Gained `sourceItemCode`, `fabricationCategory`, `bomDimensions` (transfer log also: `fromDimensions`/`toDimensions`/`leftoverDimensions`) — for display, populated at creation in the controllers above. |

**Frontend**:

| File | What's in it |
|---|---|
| `pages/store/MaterialHandshake/tabs/PendingRequestsTab.jsx` | `FabricationTransferDialog` — stock-variant picker + optional leftover entry (locked/editable field split as above). `FabricationPurchaseDialog` — see Part 5 (reworked again later). |
| `pages/store/MaterialHandshake/tabs/{StoreTransferLogsTab,PendingReturnsTab,ReturnedMaterialsTab,MaterialIssueLogsTab}.jsx` | All four show `sourceItemCode`/cut-dimension sub-lines instead of the raw synthetic code. |

---

## Part 4 — Production Order Management polish

A full pass over `/production/orders` after the transfer/return work above, fixing regressions and gaps it introduced:

| Fix | Detail |
|---|---|
| **"Bill of Materials by Part" showing "No BOM found"** | Root cause: the fetch effect was keyed only on machine code and cached forever — the first time a machine's order was opened, whatever came back (including `bom: null` if the BOM didn't exist *yet*) was cached permanently for that machine, never refetching even after R&D later created/approved a BOM. Fixed by refetching on every detail-dialog open (keyed on the `detailOrder` object itself), not once per machine code. |
| **"View" (eye icon) showing the wrong cut** | When a BOM reuses one raw Item across multiple distinct cuts, matching by code alone always resolved to the first one in the array. Now disambiguates by `dimensionSignature` when the row is fabrication. |
| **Download PDF** | Was printing the internal synthetic `materialCode` and no cut size. Now prints `sourceItemCode` + a "Cut: ..." line. |
| **Log polish** | Extended the `sourceItemCode`/dimension display (already on `StoreTransferLogsTab`/`PendingReturnsTab`) to `MaterialIssueLogsTab`/`ReturnedMaterialsTab` too. |

**Return feature, worked example** (Defect vs Excess — same lock/unlock mechanics either way, only *where accepted material lands* differs):

| | Excess | Defect |
|---|---|---|
| Accept → material goes to | Live usable stock (`Item.qty`, or the matching `dimensionVariant` for fabrication) | `DefectiveInventory` quarantine — never sellable/usable stock |
| Reject | Nothing credited; `issuedQuantity`/`transferredQuantity` untouched, as if it never happened | Same |

---

## Part 5 — Purchase Requests: consolidated multi-dimension

### Design

Store raising a Purchase Request for a fabrication shortage can select **multiple** catalog dimensions in **one** consolidated request (not one request per size) — e.g. 20kg worth of one sheet size + 10kg of another, one document, one eventual RFQ, one vendor bill: *"20kg + 10kg = 30kg total."*

### Code locations

| File | What's in it |
|---|---|
| `models/PurchaseRequest.js` | `fabricationDimensionLines: [{values, quantity, weightPerPieceKg, lineWeightKg}]` — replaced the old singular `fabricationDimensions` field (nothing downstream depended on the old shape yet, so this was a clean rename, not a migration). |
| `controllers/purchaseRequestController.js` | `resolveFabricationLines(masterItem, rawLines, {requireCatalogMatch})` — shared validation+weight-resolution helper (catalog-only by default; Part 7 adds the non-catalog-allowed mode). Predicts the aggregate order quantity in the item's Purchase Unit when it's a Mass Unit (`MASS_UNIT_TO_KG_MULTIPLIER`, from Part 1); otherwise Purchase must set the amount manually (see Part 6). `createPurchaseRequest` uses it at creation time. `previewFabricationTotal` (`POST /api/purchase-requests/preview-fabrication-total`) — no-persist preview, reused live by both Store's dialog and Purchase's RFQ form. |

**Frontend**: `PendingRequestsTab.jsx`'s `FabricationPurchaseDialog` — checkboxes (not radio) over catalog sizes, one qty input per checked size, live running total via the preview endpoint, submits one `POST /api/purchase-requests` with the full `fabricationDimensionLines` array.

---

## Part 6 — RFQ / vendor flow

### Design

Purchase reviews/edits the same dimension breakdown Store submitted, from the **same form** that sends the RFQ — not a separate edit-then-send flow. The vendor only ever sees the breakdown as **read-only context** with each line's sub-weight; they bid one price against the single aggregate total, never per dimension.

### Code locations

| File | What's in it |
|---|---|
| `controllers/purchaseRequestController.js` | `editFabricationLines` (`PATCH /api/purchase-requests/:id/fabrication-lines`) — Purchase-only (403 for Store), locked to `status: 'Pending'` with no existing RFQ (`RFQ.findOne({purchaseRequest: id})`, same check `createRFQ` itself runs). Re-validates via `resolveFabricationLines`, lets Purchase override the resolved total. |
| `models/RFQ.js` / `VendorBid.js` / `Purchase.js` | All three gained a read-only `fabricationDimensionLines` snapshot — copied at RFQ-creation time (`createRFQ`) and PO-creation time (`selectVendor`) respectively. Bid math (`quantity`/`unitPrice`/`totalPrice`) is untouched everywhere — always the single aggregate. |
| `services/emailService.js` | `sendRFQEmail`/`sendVendorBidConfirmationEmail` — render a "This order covers..." read-only breakdown block above the existing single-quantity row. `resendVendorBidEmail` passes it through too. |
| `controllers/rfqController.js` | `getBidByToken` includes the breakdown in its public response. `selectVendor` copies `rfq.fabricationDimensionLines` onto the PO's line item. |

**Frontend**:

| File | What's in it |
|---|---|
| `components/accounts/FabricationRFQDialog.jsx` (new) | The combined edit+send form — add/remove/adjust dimension lines (reusing the catalog-variant-picker pattern), live weight preview, an **Order Quantity** field pre-filled from the weight prediction (editable) when the Purchase Unit is a Mass Unit, or required manual entry otherwise. Submit both PATCHes `fabrication-lines` and immediately calls the existing `sendRFQ()` — one action, not two. |
| `pages/accounts/RFQManagement.jsx` | `handleSendRFQ` opens `FabricationRFQDialog` instead of the plain Purchase-Unit quantity modal when the row has `fabricationDimensionLines`. |
| `pages/accounts/PurchaseRequest.jsx`, `pages/accounts/VendorBids.jsx`, `pages/VendorBidForm.jsx` | Read-only breakdown display (list rows, comparison modal, and the public vendor quote form respectively). |

---

## Part 7 — Store receiving

### Design

Store receiving a fabrication purchase records how many pieces of each dimension actually arrived — including a size that wasn't in the original catalog/quote, if that's what the vendor shipped.

**Two different gates, matching how the rest of this system already separates them for every item type:**
- **Stock** (`dimensionVariants[].subStock`) stays gated behind QC, exactly like every other material — Store's receive step only records the breakdown and creates a QC Job; the credit happens on a QC **Pass**.
- **Pricing** (`weightUnitPrice`/`purchaseCost`) updates immediately at Store's receive step, same timing as every other item — not gated behind QC.

**Pricing mechanism — reuses the existing conversion pipeline rather than inventing new math.** `itemPricingService.js` already resolves `purchaseCost = rawPurchaseUnitPrice(₹/purchase-unit) × PurchaseRequest.conversionFactor` for any item with a defined Purchase Unit (`findPurchaseToBaseFactor`) — that field was simply never populated for fabrication items before (there's no single fixed factor across multiple dimensions). Fixed by feeding it the **weighted-average kg-per-piece across everything actually received** — once that's set, the existing formula (already fabrication-aware for `weightUnitPrice`, see Part 1) produces the correct `purchaseCost` with zero new pricing logic.

**Off-catalog dimension → `isLeftover: true`.** Store can record a size that isn't an existing catalog `dimensionVariant` at all; it's still weight-computable (only needs the item's category+density, not catalog membership) and becomes real usable stock at QC Pass — but flagged `isLeftover`, same as a Store-cut leftover: never offered back as a reorderable size in a future Purchase Request/RFQ.

### Code locations

| File | What's in it |
|---|---|
| `models/PurchaseRequest.js` | `receivedFabricationLines` — same shape as `fabricationDimensionLines`, but "what was actually received" (may differ from what was ordered/quoted). |
| `controllers/purchaseRequestController.js` | `resolveFabricationLines` gained `{requireCatalogMatch}` (default `true`; `false` here only). `createPurchaseQCJob(request, req, quantityOverride)` — extracted shared helper (pure refactor, `updatePurchaseRequestStatus` calls it identically to before). `receiveFabricationPurchase` (`PATCH /api/purchase-requests/:id/receive-fabrication`, Store-only) — validates `status === 'Ordered'`, resolves+stores `receivedFabricationLines`, sets `conversionFactor`/`receivedQuantity` from the weighted-average weight-per-piece, creates the QC Job, creates the Purchase Invoice, calls the existing `recalculateItemPricing`. **No Serial Number/Warranty fields at all** — separate endpoint from the generic `updatePurchaseRequestStatus`, so that endpoint's mandatory-fields gate is untouched for every other item type. |
| `controllers/qcController.js` | `submitDecision`'s Pass branch — when the resolved `PurchaseRequest` has `receivedFabricationLines`, credits each line into the matching `dimensionVariant` (`subStock +=`) instead of the flat `Item.qty` increment; a line with no existing match creates a new variant flagged `isLeftover: true`. |

**Frontend**: `components/accounts/FabricationReceiveDialog.jsx` (new) — pre-fills lines from what was ordered, editable quantities, two ways to add a line (pick another catalog size, or "Received a different size" via `FabricationDimensionFields` from Part 1 for a genuinely new dimension). `PurchaseRequest.jsx`'s `handleOpenReceiveModal` opens this instead of the generic Serial Number/Warranty receive modal for fabrication rows.

### Known limitation

QC's `partialRejections` mechanism (rejecting only part of a job's quantity) has no concept of *which* dimension was rejected — a partial reject on a fabrication job still credits the full `receivedFabricationLines` breakdown at eventual Pass, not reduced proportionally. Not fixed — would need QC to pick dimensions too.

---

## What's still deferred

Nothing currently pending from this arc. Purchase-side work for fabrication items (multi-dimension requests → RFQ → PO → receiving) is complete end-to-end, symmetric with the Production-side handshake (Parts 2–4).
