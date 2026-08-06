# Inventory, Product Master, Motor Master & Plant Master

## What it does

Four modules that used to be (or could easily have been) separate collections are unified into **one shared `Item` collection** — plain Inventory stock, Product Master machines, and Motor Master motors are all `Item` documents, distinguished only by a couple of discriminator fields. Plant Master is the one exception: it's a lightweight, separate collection that just references `Item` documents by id.

This design exists because the client's requirement was explicit: *"we are not adding anything twice — when we add something in inventory it will give the new inventory requirement form, and when Product Master we get Product Master's form, same for Motor — just think we are creating from start... but store them in same place."* Every module gets its own form, its own field set, its own list page — but under the hood it's one collection, so an item never has to be entered twice, and shared attributes (pricing, stock, purchase unit) never drift out of sync between a "Product Master copy" and an "Inventory copy" of the same real-world thing.

**Where:**
- Inventory: `/r&d/inventory` (also used by Store/Sales/Unit Head roles under their own paths)
- Product Master: `/r&d/product-master`
- Motor Master: `/r&d/motor-master`
- Plant Master: `/r&d/plant-master`

All four sit under the sidebar's **Product Management** parent group (Product/Motor/Plant Master) plus the separate top-level **Inventory** item.

---

## Code locations

**Backend** (`Samtek-Backend/Samtek-Backend/server/`):

| File | What's in it |
|---|---|
| `models/Inventory.js` | The shared `Item` schema (exported as `Item`), plus `Category`, `CustomerCategory`, `Group`, `UnitType`. |
| `models/InventoryMasterOption.js` | Inventory's own dynamic ("+"-addable) dropdown values: `ItemCategory` (multi-select), `SourceType`, `ItemSourceType`. |
| `models/RDMasterOption.js` | R&D's dynamic dropdown values, shared/scoped across Product Master, Motor Master, Plant Master: `P-Type`, `Category`, `P-SourceType`, `Metrology`, `MaterialGrade`, `PowerSource`, `MotorCategory`, `MotorSubCategory`, `MotorType`, `PlantCategory`, `PlantSubCategory`, `MaterialType`. |
| `models/RDPlant.js` | Plant Master's own collection — not an `Item`. |
| `controllers/inventoryController.js` | `getItems`/`createItem`/`updateItem`/`getInventoryStats`/`getLowStockItems`/`exportItemsToExcel` (plain Inventory CRUD + the shared item list every module ultimately reads from) and the `InventoryMasterOption` CRUD (`getInventoryDropdownOptions` etc.). |
| `controllers/rdController.js` | Product Master's machine CRUD (`getMachines`/`createMachine`/`updateMachine`/...) via the `toMachineResponse`/`toMachineItemFields` translation layer, the `RDMasterOption` CRUD (`getDropdownOptions`/`addDropdownOption`/`updateDropdownOption`/`deleteDropdownOption`), and Plant Master's CRUD (`getPlants`/`createPlant`/`updatePlant`/`setPlantStatus`). Motor Master has **no dedicated controller** — it talks to `inventoryController.js`'s `getItems`/`createItem`/`updateItem` directly, same as plain Inventory. |
| `routes/inventoryRoutes.js` | `/api/items`, `/api/inventory/*` (categories, groups, unit types, master-options). |
| `routes/rdRoutes.js` | `/api/rd/machines`, `/api/rd/master-options`, `/api/rd/plants`, `/api/rd/custom-field-templates`. |

**Frontend** (`Samtek-Frontend/Samtek-Frontend/client/src/`):

| File | What's in it |
|---|---|
| `components/inventory/ModernInventoryUI.jsx` | Inventory's list/filter/actions page. |
| `components/inventory/SimpleInventoryForm.jsx` | Inventory's Add/Edit item form. |
| `components/inventory/ViewItemModal.jsx` | Inventory's View item modal. |
| `pages/ResearchDevelopment/ProductMaster.jsx` | Product Master's list + Add/Edit/View, classification hierarchy manager, custom field template manager. |
| `pages/ResearchDevelopment/MotorMaster.jsx` | Motor Master's list + Add/Edit/View — self-contained, calls `/api/items` directly. |
| `pages/ResearchDevelopment/PlantMaster.jsx` | Plant Master's list + Add/Edit/View, with machine/motor multi-selectors. |

---

## The shared `Item` collection

### Discriminators

Every `Item` carries two fields that decide which module "owns" it and how it behaves:

| Field | Values | Meaning |
|---|---|---|
| `type` | `'Product'`, `'Material'`, `'Spares'`, `'Assemblies'` | Internal/system classification. Product Master and Motor Master **always** hardcode `type: 'Product'` themselves, server-side — plain Inventory items pick from the same fixed list, but that dropdown is hidden from Inventory's own form (see below) and silently defaults to `'Material'`. |
| `productKind` | `'Machine'`, `'Motor'`, `null` | Only meaningful when `type: 'Product'`. `'Machine'` = a Product Master item, `'Motor'` = a Motor Master item, `null` = everything else (plain Inventory, including Inventory items that happen to have `type: 'Product'`). |

A plain Inventory item and a Product Master machine can both have `type: 'Product'` — the thing that actually keeps them apart everywhere in the codebase is `productKind`, not `type`.

### Common fields (shared by all three)

Pricing (`stdCost`, `purchaseCost`, `salePrice`, `mrp`, `gst`, `costSource`, `costResolvedAt`, `costResolutionIssue`, `profitPercent`, `discountPercent`), stock (`qty`, `minStock`), unit type/unit (`unitType`/`unit` for storage, `purchaseUnitType`/`purchaseUnit` for purchasing), `purchase`/`internalManufacturing` (drives `itemPricingService.js`'s auto-pricing), `isDiscontinued`, `image`, `description`, `specifications`, `applications`, `brand`, `metrology`, `materialGrade`, `modelNumber`, `size`, `unitWeightValue`/`unitWeightUnitType`/`unitWeightUnit`.

`metrology` and `materialGrade` are deliberately **shared/unscoped** vocabularies (their `RDMasterOption` entries have `productKind: null`) — a rename of "SS304" updates it everywhere, whether it's on an Inventory raw material or a Product Master machine, because it's the same real-world spec either way. Everything else that looks similar across modules (Category-like fields, Motor Type, etc.) is deliberately **kept separate per module** — see "Classification systems" below for why.

### Module-specific fields

| Nested object | Used by | Notable fields |
|---|---|---|
| `machineDetails` | Product Master (`productKind: 'Machine'`) | `variant`, `productionRate`, `powerSource`, `powerRequiredHP/KWH/RPM`, `accessories[]`, `machineType`, `forwardToNextPhase`, `designStatus`, `releaseStatus`, `rejectionNote`, `firstBuiltAt` |
| `motorDetails` | Motor Master (`productKind: 'Motor'`) | `motorType`, `version`, `hp`, `kwh` (auto-calc from `hp × 0.746`), `rpm`, `pole`, `phase`, `modelNumber` |
| `dimensions` | Inventory only | `length`/`height`/`width`/`diaOD`/`diaID`/`thickness`, each `{value, unit}` |

`productSourceType` also exists as its own top-level field, used only by Product Master (kept as an explicit named field per the client's requirement, even though it drives the same `purchase`/`internalManufacturing` booleans everything else uses — never silently collapsed away).

---

## Product Master — the translation layer

Product Master used to be its own `RDMachine` collection, entirely separate from `Item`. It was migrated into `Item` (`productKind: 'Machine'`, preserving every document's original `_id` so every existing reference — `RDBOM.machine`, `RDPrototype.machine`, etc. — kept working with just a `ref` change from `'RDMachine'` to `'Item'`).

To avoid rewriting every frontend page that already spoke the old `RDMachine`-shaped API (`ProductMaster.jsx`, `BOMManagement.jsx`, `Prototype.jsx`, `DesignApproval.jsx`, `ChangeManagement.jsx`, `ToolProcess.jsx`, `QualityParameters.jsx`), `rdController.js` has two translation helpers:

- **`toMachineResponse(item)`** — takes a real `Item` document and flattens it back into the old `RDMachine`-shaped object (`pType`, `category`, `pSourceType`, `designStatus`, `releaseStatus`, etc. all present as top-level flat fields, even though they actually live at `item.category`/`item.subCategory`/`item.productSourceType`/`item.machineDetails.designStatus`/...).
- **`toMachineItemFields(body)`** — the reverse: takes a flat request body from the old API contract and produces a partial `Item` update object (including `machineDetails.*` dot-paths for the nested fields).

Every machine CRUD endpoint (`getMachines`, `createMachine`, `updateMachine`, `updateDesignStatus`, `updateReleaseStatus`, `discontinueMachine`, `reactivateMachine`) goes through these two functions, so the frontend never had to change — it still sends/receives the old flat shape.

**Field name mapping** (old flat name → real `Item` field):

| Flat (API) | Real (`Item`) |
|---|---|
| `pType` | `category` |
| `category` | `subCategory` |
| `pSourceType` | `productSourceType` |
| `inputUnitType` / `inputUnit` | `purchaseUnitType` / `purchaseUnit` |
| `outputUnitType` / `outputUnit` | `unitType` / `unit` |
| `designStatus`, `releaseStatus`, `forwardToNextPhase`, `machineType`, `rejectionNote`, `firstBuiltAt` | `machineDetails.*` |
| `materialGrade` | `materialGrade` (top-level, shared — not under `machineDetails`) |

---

## Motor Master

Built clean from the start directly on `Item` (`productKind: 'Motor'`) — no translation layer needed, no legacy API shape to preserve. `MotorMaster.jsx` talks straight to `/api/items` (`GET ?type=Product&productKind=Motor`, `POST`, `PUT`).

Its own classification is **Motor Type only** (a single dynamic dropdown, `motorDetails.motorType`, backed by `RDMasterOption` field `'MotorType'`). Motor Master originally also had Category/Sub Category (`MotorCategory`/`MotorSubCategory`, cascading), but those were removed from the UI — `Item.category` is `required: true` at the schema level and independently required by `inventoryController.js`'s `validateItemData`, so `buildPayload()` in `MotorMaster.jsx` still silently sends a fixed `category: 'Motor', subCategory: ''` on every save; nothing in the UI shows or edits it.

`RDMasterOption`'s `MotorCategory`/`MotorSubCategory` enum values and their rename/delete cascade logic are still in the backend (harmless, unused) in case they're ever needed again.

HP → KWH auto-calculates (`kwh = round(hp × 0.746, 2)`) on entry, still manually editable afterward.

---

## Plant Master

The one module that is **not** an `Item`. Per the client's requirement — *"this is a separate db collection which will used to fetch all items from inventory of a plant"* — a Plant is just a named grouping that references existing Product Master machines and Motor Master motors by id + quantity; it isn't itself a stock-carrying, purchasable, sellable thing.

### `RDPlant` schema

```js
{
  category, subCategory,        // own dynamic cascade — PlantCategory/PlantSubCategory
  name, productionRate,
  machines: [{ item: ObjectId (ref Item), quantity }],
  motors:   [{ item: ObjectId (ref Item), quantity }],
  isDiscontinued,
  company, createdBy,
}
```

`PlantMaster.jsx`'s machine selector reads from `/api/rd/machines` (the same translated list Product Master's own page uses); its motor selector reads from `/api/items?productKind=Motor` (same as Motor Master's own list). Both are plain search-and-checkbox pickers with a per-selection quantity field — no live stock/pricing math happens here, that's deferred to whatever eventually builds a quotation off a Plant (not yet built — see "Deferred / not yet built" below).

---

## Classification systems — what maps to what, and why they're kept separate

The client's requirement document listed several classification-sounding fields per module. Rather than inventing one universal "category" mechanism, each module's classification is **deliberately scoped and kept from mixing with the others** — the same reasoning applied throughout: *"a rename in one module's list should never silently affect another module's items that happen to share the same text."*

| Module | Field(s) | Backing | Notes |
|---|---|---|---|
| Inventory | `category` / `subCategory` | `Category` model (pre-existing, `CategoryManagement.jsx`) | The **original** classification system. `storeFlowService.js` and `orderController.js` key Purchase-vs-Production routing off the literal string `"Purchase Machine"` in `category` — a known, still-live dependency, deliberately left untouched (flagged, not fixed, per explicit instruction). |
| Inventory | Item Type (`type`) | Fixed enum, hidden from the form | See "Discriminators" above — no longer user-facing, silently defaults to `'Material'`. |
| Inventory | Item Category (multi-select) | `InventoryMasterOption` field `'ItemCategory'` | The client's literal "Item Category — Dynamic & Multiple Item Selector" requirement. Stored as `Item.itemCategories: [String]`. |
| Inventory | Source Type / Item Source Type | `InventoryMasterOption` fields `'SourceType'` / `'ItemSourceType'` | `Item.sourceType` / `Item.itemSourceType`. Coexist with the `purchase`/`internalManufacturing` booleans that actually drive pricing logic — never collapsed into just the boolean, per the client's insistence on keeping explicit named fields. |
| Product Master | Category → Sub Category → Product Source Type | `RDMasterOption` fields `'P-Type'` → `'Category'` → `'P-SourceType'` (3-level cascade) | Labeled "Category"/"Sub Category" in the UI (renamed from the original "P-Type"/"Category" naming to match Inventory's terminology), but stored on `Item.category`/`Item.subCategory`/`Item.productSourceType`, scoped `productKind: 'Machine'`. |
| Motor Master | Motor Type | `RDMasterOption` field `'MotorType'` | Single dropdown, `Item.motorDetails.motorType`, scoped `productKind: 'Motor'`. Category/Sub Category were removed (see "Motor Master" above). |
| Plant Master | Category → Sub Category | `RDMasterOption` fields `'PlantCategory'` → `'PlantSubCategory'` | Its own 2-level cascade, on `RDPlant.category`/`RDPlant.subCategory` (not an `Item` field at all, since `RDPlant` is a separate collection). |

### Dynamic ("+"-addable) dropdown systems

Two parallel systems, intentionally not merged:

- **`RDMasterOption`** (`/api/rd/master-options`) — R&D-scoped, used by Product Master, Motor Master, Plant Master, and (for the shared `Metrology`/`MaterialGrade` fields) Inventory too. No route-level role restriction beyond authentication, so Inventory's form can safely call it.
- **`InventoryMasterOption`** (`/api/inventory/master-options`) — Inventory-scoped, only `ItemCategory`/`SourceType`/`ItemSourceType`.

Both follow the same rename/delete-cascade convention: renaming a value updates every `Item` (or `RDPlant`, or `RDBOM` material snapshot) currently using it; deleting is blocked while anything still references it, with a count in the error message telling you how many.

---

## Visibility — who sees what

Because everything lives in one `Item` collection, every list query has to actively **scope itself** to avoid showing items that belong to a different module. This was a real bug, found and fixed:

- **Product Master** (`getMachines`): `{ type: 'Product', productKind: 'Machine' }` — always was correctly scoped.
- **Motor Master**: sends `productKind=Motor` explicitly on every request — always was correctly scoped.
- **Plant Master**: inherently isolated, separate collection.
- **Inventory** (`getItems`, `getInventoryStats`, `getLowStockItems`, `exportItemsToExcel`): **was unscoped** — the plain Inventory list, dashboard stats, low-stock list, and Excel export were all silently including Product Master machines and Motor Master motors until this was audited and fixed.

The fix couldn't just default `getItems` to always exclude `productKind` globally, though — `getItems` is also reused (directly, and via the `/api/super-admin/inventory/items` and `/api/unit-head/inventory/items` route aliases) by `ProductSelector.jsx`, the Sales product picker used when creating/editing a sales order, which genuinely needs machines and motors to appear as pickable sellable products. So:

- `getItems` accepts `productKind=none` as an explicit opt-in sentinel — only `ModernInventoryUI.jsx` sends it. Every other caller (including the Sales picker) keeps today's unfiltered behavior unless it explicitly asks to exclude.
- `getInventoryStats`, `getLowStockItems`, `exportItemsToExcel` had no competing consumer that needed machines/motors included, so those three were scoped to exclude `productKind` **by default**, unconditionally.

### Discontinued items

`isDiscontinued` (Continue/Discontinue) works the same way across all four modules now: `getItems` accepts `discontinued=true/false`, defaulting to `false` (hidden) when not specified at all — matching Product/Motor/Plant Master's own list convention. Each module's list page has a "Show Discontinued"/"Show Active" toggle, and a Ban (discontinue) / RefreshCw (reactivate) action button pair next to Edit/Delete.

---

## Deferred / not yet built

Tracked, not forgotten — explicitly flagged and left alone per instruction, not fixed silently:

- **`storeFlowService.js` / `orderController.js:2098`** — Purchase-vs-Production order routing keys off the literal string `item.category === 'Purchase Machine'` (case-insensitive). Still live, still depends on Inventory's `Category` values exactly matching that string. Flag it, fix later.
- **`salesAccountController.js`'s `getSalesItems`** — "sellable to customers" filters `type: {$in: ['Product', 'Assemblies']}`. Since Inventory's `type` field is now hidden and silently defaults to `'Material'`, a plain Inventory item classified (via Item Category) as e.g. "Readymade Material" won't show up as sellable here unless its `type` also happens to be `'Product'`/`'Assemblies'`. Not fixed.
- **`CM-009` duplicate code** — a pre-existing data issue from the original `RDMachine` → `Item` migration (two machines, different companies, same code) — one was skipped during migration and needs manual reassignment. Flagged, not resolved.
- **Plant Master → Sales Quotation** — the client's stated end use for Plant Master ("these plants will be used for creating sales quotations") is not built yet. Plants can be created and machines/motors mapped to them, but nothing downstream reads a Plant to build a quotation.
- **`RDMasterOption`'s dormant `MotorCategory`/`MotorSubCategory` entries** — no longer reachable from any UI (Motor Master's Category/Sub Category fields were removed), but the enum values and cascade logic are still present in the backend, unused.
