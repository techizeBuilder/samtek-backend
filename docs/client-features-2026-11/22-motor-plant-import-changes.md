# Feature 22: Bulk import for R&D Motor Master and Plant Master (what changed)

*Built 22 November 2026. Logic and your decisions (1–4): [22-motor-plant-import-logic.md](22-motor-plant-import-logic.md). Browser test: [22-motor-plant-import-test-roadmap.md](22-motor-plant-import-test-roadmap.md).*

## In one line
Motor Master and Plant Master each have a **Bulk Import** button, with the same flow as the Inventory and Product Master imports: download the template, fill it, check (nothing saved), then import all or nothing.

## Motor Master
**R&D → Motor Master → Bulk Import** (beside Add Motor; needs Motor Master "add").
- **The template:**
  - *Motors*: 16 columns, the form's fields: Code, Name, Model Number, Serial Number, Brand, Motor Type, HSN, Version, HP, KWH, RPM, Pole, Phase, Description, Status, Sourcing
  - *How to fill*
  - *Lists*: your Motor Types, Sourcing, Status
- **The check:**
  - **Refused:**
    - a code used anywhere (any letter case), or repeated
    - the same motor name as an active motor, or twice in the file
    - a non-number HP / KWH / RPM
    - an unknown sourcing word or status
  - **A Motor Type not in your list** is shown in the yellow box (*"Motor Type 'Gear Motor' (rows 3, 4)"*) and added on import. "ac motor" uses your "AC Motor".
- **Saved as the form saves:**
  - Product / Motor, Category and Sub Category "Motor", Pieces
  - **KWH** left blank is worked out from HP
  - **Sourcing** left blank means Purchasable (decision 4)
  - the specifications list (Version, HP, KWH, RPM, Pole, Phase) is filled in for Quotation's price list
- **Not in the file:** the image is uploaded on each motor afterwards.

## Plant Master
**R&D → Plant Master → Bulk Import** (beside Add Plant; needs Plant Master "add").
- **The template:**
  - *Plants*: Plant Ref (your own P1, P2 …), Category, Sub Category, Plant Name, Production, Status
  - *Machines & Motors*: Plant Ref, Item Code, Quantity; one row per part
  - *How to fill*
  - *Tree*: your current plant paths
  - *Items*: your active machines and motors, with their codes, to copy from
- **The check:**
  - **Tree values:** Category / Sub Category / Plant Name / Production values the tree doesn't have are added **under that row's own path** and shown first (*"Plant Name 'Spice Line' under Spice › Mill"*). A name under the Spice's "Mill" never lands under the Flour's "Mill".
  - **Refused:**
    - the same plant (Category + Sub Category + Plant Name + Production) as an active plant, or twice in the file (decision 1)
    - a part that isn't a machine or motor of your company (an unknown code, a raw material, another company's), or a discontinued one (decision 2)
    - the same item twice in one plant (decision 3)
    - a quantity that isn't a whole number ≥ 1
    - a part row whose Plant Ref isn't in *Plants*; a repeated Plant Ref
  - A plant with no parts is allowed, as on the form.
- **Saved as the form saves:** the tree's own spelling; machines and motors split by kind, each with its quantity (blank = 1); created by you.
- **All or nothing:** new tree values first (parents first, each linked to its parent), then the plants. If anything fails, both are taken back.
- **A part discontinued between check and import** is caught by the second check, and nothing is added.

## Fixed with it (22 Nov, your ask): Motor Master saves behind its own permission
- **Before:**
  - The page's **Add Motor** button (and the bulk import) needed Motor Master "add".
  - But the form saved through the general item route, which checks the **Inventory** permission. Inside, it also checks a short role list or an old-style Inventory flag.
  - So someone with only Motor Master "add" saw the button and got "Access denied" on save. The image upload had the same mismatch.
- **Now Motor Master has its own routes:**
  - `POST /api/rd/motors` (Motor Master "add")
  - `PUT /api/rd/motors/:id` (Motor Master "edit"; also the status toggle)
  - `POST /api/rd/motors/upload-image` (Motor Master "add" or "edit")
- **What the save does:** the same item save as before, with all its checks (code taken, the same item twice, validation). These routes only ever make or change a **motor**:
  - a new one is always saved as Product / Motor
  - an edit is refused (not found) for anything that isn't a motor of your company
  - a motor can't be turned into something else
- **Unchanged:** the general item route still needs the Inventory permission for everything else. The motor list still reads it, open to any logged-in user, as before.
- **Files:**
  - `controllers/motorMasterController.js` (new)
  - `routes/rdRoutes.js`
  - `controllers/inventoryController.js`: `createItem` / `updateItem` skip their own role check only when a route already checked its permission (`req.permissionChecked`)
  - `MotorMaster.jsx`: uses the new routes
- **Test `motorsave`, 11 of 11** through the real server, as a user with only Motor Master permission:
  - the general route refuses them (403); Motor Master's route saves, always as a motor; a taken code is still refused
  - edit and status work, and it stays a motor; a raw material or another company's motor can't be changed (404)
  - view-only can't add, edit or upload (403); the image uploads with Motor Master permission

## Technical notes
**Server:**
- **New `services/bulkImport/tree.js`:** `makeTree` (path resolution with planned values, as `classificationTree.js`), `insertPlanned` (parents first, linked), `plannedValues`. It was moved out of the Product Master import, which now uses it too.
- **New `services/bulkImport/motorImport.js`:**
  - the doc is built as `MotorMaster.jsx` `buildPayload` does, then the controller's `validateItemData` / `sanitizeItemData`
  - twins by createItem's rule for a motor
  - one index-only read of item codes
- **New `services/bulkImport/plantImport.js`:**
  - the plant tree (`PlantCategory` → `PlantSubCategory` → `PlantName` → `PlantProduction`)
  - batched reads: active plants named in the file; the parts by code (index-only read, then one find in the company)
- **`routes/bulkImport.routes.js`:** `motor-master` and `plant-master`, each gated by its page's own "add" permission.

**Screens:**
- `BulkImportDialog.jsx`: `motorMaster` and `plantMaster` kinds (steps, previews, done messages)
- `MotorMaster.jsx` and `PlantMaster.jsx`: the Bulk Import buttons; they refresh their lists and the dropdown options

## Tests
**New suites, through the real server on made-up companies with `.invalid` emails:**
- **`motorimport`, 23 of 23:**
  - **The template:** 16 columns; Lists has the company's Motor Types, not another company's. No "add" means 403.
  - **Problems, each listed with its row and column, nothing saved:** no code; a code taken (other case); a repeated code; the same name as an active motor (any case) and twice in the file; HP not a number; a bad sourcing word; a bad status.
  - **A clean file of 3:**
    - one new Motor Type shown first ("gear motor" counted once; "ac motor" matched)
    - imported as the form saves: Product / Motor / "Motor" / Pieces
    - blank sourcing gives Purchasable; 5 HP gives 3.73 KWH; the specifications are mirrored
    - Internal Manufacturing has no purchase unit; Discontinue
    - the new type is in the list once
  - **The same file again:** refused, with no new values.
- **`plantimport`, 28 of 28:**
  - **The template:** 5 sheets; Tree and Items hold the company's own data (active machines and motors only). No "add" means 403.
  - **11 kinds of problem, each with its sheet, row and column, nothing saved:**
    - Plant Ref missing or repeated
    - the same plant as an active one (any case, Production included) and twice in the file
    - a ref not in Plants; an unknown code; a raw material; a discontinued machine; a bad quantity; the same item twice in a plant; another company's machine
  - **A clean file of 4:**
    - 6 tree values under the right parents, shown first
    - machines and motors split by kind with their quantities, blank quantity = 1, a plant with no parts, Discontinue
    - the same file again: the 3 active plants refused
  - **A part discontinued between check and import:** refused, and its 3 tree values not added.
- **Regression:** `pmimport` 38 (the tree helper moved), `bulkinv` 53, `bulkfab` 29.
- **The screens compile** (esbuild). The server files pass the strict ES-module syntax check, and the routes load.
