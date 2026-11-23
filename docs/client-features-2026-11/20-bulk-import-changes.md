# Feature 20: Bulk import for R&D (what changed)

*Built 21 November 2026, from the client's request the same day. Logic and your decisions (1–3, K, and the defaults E–J): [20-bulk-import-logic.md](20-bulk-import-logic.md). Browser test: [20-bulk-import-test-roadmap.md](20-bulk-import-test-roadmap.md).*

## In one line
R&D can add many items at once. They download an Excel template, fill it in and upload it. The system checks every row against the form's own rules, and imports either all the rows or none, listing every problem by row and column. It works on **R&D → Inventory** and on **R&D → Fabrication Master**.

## What R&D sees
**R&D → Inventory (the Inventory tab): a Bulk Import button** next to "Add Item". It opens:
1. **Download template:** an Excel file with three sheets.
   - **Items:** 38 columns in the Add Item form's order.
   - **How to fill:** each column's rule, with an example.
   - **Lists:** your company's own dropdown values and unit types, as at the download.
2. **Choose the file → Check file.** Nothing is saved yet. It shows one of:
   - ***"Ready: 120 items (4 fabrication; 95 will wait for Store's first stock count)"*** with a preview and an **Import 120 items** button, or
   - ***"7 problems in 120 rows. Nothing was imported."*** with a table of row, column and problem. For example:
     - *Row 14 · Used Unit: "Kgs" isn't a unit of Mass Unit (use: Kilogram, Gram).*
     - *Row 31 · Fabrication Master Code: Fabrication Master "ANG-012" not found: add it in Fabrication Master first (or import it there).*
3. **Import.** The file is checked once more, then every item is saved together: *"Imported 120 items."*

**R&D → Fabrication Master: a Bulk Import button** next to "Add Fabrication Item".
- Its template has one row per size, with sheets that list each shape's size fields, the standard designations (IPE 200 …), the materials and the unit types.
- The preview shows each entry's code (*"generated"* when it was left blank) and every size with its weight per piece.

## The rules the check applies
**The Inventory file:**
- **Codes:** the Item Code is required (R&D's own). It must be unused anywhere in the database in any letter case, and not repeated in the file.
- **The same item twice:** the same name and Item Type in the company, or in the file, is refused.
- **Lists:** a value in your list is matched ignoring letter case, and the list's own spelling is saved. Item Category can hold several, separated by commas.
  - **A value not in its list yet** (changed 22 Nov, your call): added to the list when you import.
  - The check shows the new values first in a yellow box, *"New list values to add (3)"*, with each value and its rows, so a typo can be fixed in the file.
  - They're added only after the items are saved. The result says *"3 new values added to the dropdown lists"*.
  - Unit types and units must still exist already.
- **Units:** each unit must belong to its type.
- **The form's rules:**
  - Purchase items need a Purchase Unit and a Material Flow.
  - Min Stock left blank takes the flow's 20 / 10 / 5.
  - "How is it used in production?" is required for items counted in pieces.
  - Job Work Type only with Item Type "Job Work".
  - Unit Weight "per" only for Length / Area / Volume units.
- **A fabrication row** (Item Process Type "Fabrication Item") gives the **Fabrication Master Code**.
  - Name, code, units, Material Grade, Sheet Metal, and every size with its weight are copied from the entry, as the form's picker does. A retired size stays retired, and each size starts at 0 pieces.
  - **Refused when:** the entry is missing, discontinued, or already linked to an item, or two rows point at the same entry (decision 1).
  - **The columns that come from the master** (changed 22 Nov, see below) are marked "(not for fabrication)". A value typed there is not used, and is not a problem.
- **Up to 1,000 rows,** 5 MB.

**The Fabrication Master file:**
- **Grouping:** rows group into an entry by Item Code (or by Item Name when the code is blank). Name, category, material, units and Sheet Metal must match across an entry's rows.
- **Sizes:** only the size fields its category uses, each above 0. Standard-table shapes need a designation from the table, and the same size twice in one entry is refused.
- **Weight:** worked out by the server with the page's own calculator. The material sets the density, and a Density column can override it.
- **Units:** all 3 unit pairs are required, since the linked inventory item needs them.
- **Codes:**
  - a blank code takes the next code from the name, in order within the file (e.g. ZZM-007, ZZM-008)
  - a typed code must be unused as a Fabrication Master code and as any Inventory code
- **New entries only:** an existing code is refused, and so is a blank-code entry whose name already exists, so uploading the same file twice can't create second copies.

## Two headers say when they apply (22 Nov, your ask)
- **Why:** the form shows two of its fields only sometimes, so the template's columns for them looked like fields the form doesn't have.
- **The headers now:**

  | Was | Now | The form shows it |
  |---|---|---|
  | Job Work Type | **Job Work Type (only for Job Work)** | under Item Type, only when Item Type is "Job Work" |
  | Used in production | **How is it used in production? (piece items)** | between Used Unit and Receive Unit, only when the Used Unit counts pieces; it asks the same question |
- **How to fill** explains both as the form does, with examples:
  - Job Work Type is the outside service, e.g. Powder Coating
  - "Built into the product" goes inside what the customer receives, e.g. a motor or bearing
  - "Used to make the product" is used while building but not delivered, e.g. a grinding wheel or jig
- **On *Lists*,** the column is now "How is it used in production?".
- **Problems and the yellow box** use the short names: "Job Work Type" and "How is it used in production?".
- **A file made from the older template still reads:** the old headers are accepted, through a new `aliases` option in `common.js` `readSheet`.

## Fabrication rows: the master's columns are marked, and a typed value is not used (22 Nov, your call)
- **Why:** you filled a fabrication row (ROU-001) the natural way: name and code blank, but grade and units typed. It got 5 *"Leave blank on a fabrication row"* problems, and nothing in the template said those columns come from the master.
- **What you chose:** option 3, both together:
  - **the header marks them:** the 19 columns a fabrication row takes from its master end in **"(not for fabrication)"**. They are Material Grade, Unit Weight (kg), Unit Weight per, Purchase Unit Type, Purchase Unit, Used Unit Type, Used Unit, and the 12 size columns.
  - **a value typed there anyway is not used:** it's no longer a problem, and the master's value is saved.
- **Added, on my suggestion: a note when the typed value differs from the master.** A blue box, ***"Taken from the Fabrication Master instead (1 row)"***, lists each such row, e.g. *Row 2 (ROU-001): Material Grade "MS" → MS (Mild Steel); Purchase Unit "Kilogarm" → Kilogram*.
  - A value that matches the master (any letter case) isn't listed.
  - Sizes and weights typed on a fabrication row are listed as *→ the master's sizes*.
  - So nobody is surprised. For example, someone who typed Used Unit "Millimeter" sees the item will be in Meter, as the master says. If the master is wrong, fix it on the Fabrication Master page.
- **The other headers:**
  - "Fabrication Master Code (fabrication only)"
  - "Item Name * (fabrication: blank = from master)" and "Item Code * (fabrication: blank = from master)"
- **How to fill and the dialog's steps** say the marked columns come from the master.
- **Files made from an older template still read** (aliases). Problems keep the short names ("Used Unit", "Item Code").
- **Your file:** it now checks *"Ready: 1 item (1 fabrication; 1 will wait for Store's first stock count)"*, with the blue box showing Material Grade and Purchase Unit.

## The exact spelling wins (23 Nov, found checking your "Bulk import test.xlsx")
- **What happened:** test-1's Item Process Type list has both "Assembly Item" and "assembly item". You typed "Assembly Item", but the check picked "assembly item", the first match ignoring letter case.
- **Now:** an exact match is taken first, and letter case is ignored only when there isn't one. This applies to every import, since `common.js` `matchIn` is shared.
- **Also on 23 Nov:** a row with "Purchase or Make" blank (or misspelled) shows only that problem. Before, its flow and purchase unit also got *"Only for a Purchase item"*, which wasn't a separate mistake.

## Hold until first count (decision K)
- **Imported purchasable items** with a Material Flow are marked to wait for Store's first count. The low-stock sweep doesn't reorder them until Store records their stock once, with a **stock audit** or a stock adjustment on the item.
  - Without this, importing existing items (which start at 0 stock) would raise a purchase request per item within 30 minutes.
  - A genuinely new item: Store audits it at 0, and reordering starts.
- **Inventory (R&D's and Store's)** shows a chip ***"Waiting for first stock count (N)"*** to list them. Each one has a small **"count stock first"** badge.
- **Store gets one bell per import,** not one per item: *"R&D imported 120 items: 95 wait for a first stock count before they reorder"*.

## Found on the way (not changed)
- **New items haven't got a "production summary" since August.** `initializeProductSummary` calls a `calculateFormulas()` that the `ProductDailySummary` model doesn't have, so the call fails silently for every item added on the form. The import does the same as the form and creates none. Fixing it is a separate change, if that summary is still wanted.
- **The old "Import Excel"** (`/inventory/items/import`, on Category Management and Suppliers) is untouched:
  - it uses old fields, doesn't require the R&D code, and imports row by row
  - it isn't on R&D's page

## Technical notes
**Server, new:**
- **`services/bulkImport/common.js`:** reading a sheet by header title (ignoring case, spaces and punctuation), building workbooks, list matching, the 1,000-row limit.
- **`services/bulkImport/inventoryImport.js`:**
  - `buildTemplate`
  - `check`: batched reads: one index-only read of all item codes (`hint({ code: 1 })`), the file's names in the company, the Fabrication Master entries named and their links
  - `importFile`: re-checks, then `Item.insertMany` with pre-assigned ids, deleting them all if anything fails (all-or-nothing without a replica-set transaction); one Store bell
  - every doc goes through the controller's own `validateItemData`, `productionUseProblem` and `sanitizeItemData`
- **`services/bulkImport/fabricationImport.js`:** `buildTemplate`, `check` (weights from `calculateFabricationWeight`, designations from `getSectionTable`, sizes compared by `dimensionSignature`), `importFile`.
- **`routes/bulkImport.routes.js`** at `/api/bulk-import`:
  - `GET /{inventory|fabrication}/template`, `POST /{…}/check`, `POST /{…}/import`
  - multer in memory, 5 MB, .xlsx
  - R&D only: `rnd → inventory → add`
  - the import re-sends the file, so nothing is kept on the server in between

**Server, changed:**
- **`models/Inventory.js`:** `awaitingFirstCount`, `awaitingFirstCountSince`, plus a partial index on `{ companyId, awaitingFirstCount }`.
- **`jobs/lowStockReorderCron.js`:** the sweep skips `awaitingFirstCount` items.
- **`controllers/inventoryController.js`:**
  - `adjustStock` and `auditStock` clear the flag
  - `getItems` has an `awaitingCount` filter and `awaitingCountCount`
  - `validateItemData`, `sanitizeItemData` and `productionUseProblem` are exported (no behaviour change)
- **`index.js`:** mounts the routes.

**Screens:**
- new `components/inventory/BulkImportDialog.jsx`, one dialog for both imports: template download, check, problems table (paged), preview, import
- `ModernInventoryUI.jsx`: the Bulk Import button (R&D), the "Waiting for first stock count" chip, the row badge
- `pages/ResearchDevelopment/FabricationMaster.jsx`: the Bulk Import button

## Tests
**New suites, through the real server on made-up companies with `.invalid` emails:**
- **`bulkinv`, 57 of 57** (47, plus 6 on 22 Nov for new list values, plus 4 for the headers):
  - **Fabrication columns (22 Nov):**
    - the template has 19 "(not for fabrication)" headers
    - a fabrication row with Length 5 and Used Unit "Meter" (the master's own) has no problem; only Length is listed
    - the clean file's fabrication row types Purchase Unit Type / Unit the master's way (other case), plus Used Unit "Millimeter" and Material Grade "EN8". Only the last two are listed, against Meter and MS (Mild Steel), and the item is saved with the master's Meter and grade
  - **The headers (22 Nov):**
    - the template has the 2 new headers, and *Lists* has the new column name
    - the problem file uses the old headers, and its production-use and Job Work Type problems still show, so old files read
    - the clean file uses the downloaded template's own header row, and it reads a Job Work Type "plating" as "Plating", plus both production-use answers
  - **New list values (22 Nov):**
    - a value not in its list shows as a new value, not a problem; checking adds nothing
    - "bearings" on a later row counts once with "Bearings"; "steel" matches the existing "Steel"
    - import adds Item Type "Spares", Item Category "Bearings" and R&D's Metrology "Imperial", and the items carry them
    - the same file again shows no new values
    - an unknown unit type is still a problem
  - **The template:** 3 sheets; 38 columns in order; Lists hold the company's own values and not another company's; Store gets 403.
  - **A file with 17 problem rows:** each listed with the right row and column, and nothing saved. The rows cover:
    - no code; the same code twice in other letter case; a code in the database in other letter case; the same item twice
    - an unknown list value; a unit outside its type
    - production use missing; flow missing for Purchase; a flow on a Make item; Job Work Type without Job Work
    - fabrication: no entry, a discontinued entry, a linked entry, two rows on one entry (and since 22 Nov, size and unit columns filled are a note, not a problem)

    Import refuses the same file with the same list. A file that isn't the template, and one with more than 1,000 rows, are refused.
  - **A clean file of 5 items:** Ready 5 (1 fabrication, 3 held). Checking saved nothing. Import saved all 5 with:
    - list spellings kept; Medium Flow giving Min Stock 10; a size in MM
    - Make never held; kg per Meter on a Millimeter item
    - the fabrication item copying name, code, link, grade, units and both sizes with weights (a retired size stays retired), with flow / min / order on each size
    - a Discontinued item not held
    - one Store bell (2 role copies) and no per-item low-stock bells

    The same file again is refused, with every code already used.
  - **A code taken between check and import:** refused, and the other row isn't saved either. Store can't import.
  - **The hold:**
    - the sweep leaves the 3 held items alone (scanned 0, created 0)
    - the filter lists the 3
    - Store's stock audit (100) and a stock adjustment (50) clear two holds
    - the sweep then sees those 2, above their minimum, and creates no request
    - the list shows the last one
- **`bulkfab`, 29 of 29:**
  - **The template:** 5 sheets, 30 columns; built-in and company materials; designations; the 20 categories.
  - **15 problem rows**, each listed: no name, unknown category, an unused field, a missing field, missing and unknown designations, one entry with two categories, the same size twice, no material or density, missing units, a code an item has, an existing entry's code, and an existing name with a blank code. Nothing saved.
  - **A clean file of 3 entries and 4 sizes:**
    - blank codes become the next two ZZM codes in order
    - sheet 2 × 1250 × 2500 = **49.0625 kg**, 2 × 1000 × 2500 = **39.25 kg**; IPE 200 × 6 m = **134.4 kg** (table spelling kept); sheet 3 mm at a typed 8000 = **75 kg**
    - imported with materials, density, units, Sheet Metal and created-by
    - the same file again is refused (codes and names exist)
  - **End to end:** an Inventory row with the new IPE code links it, copying its size, weight and units. Store gets 403.
- **Regression:**
  - **Passing:** `fabsync` 32 and `makebuy-s3` 9 (the sweep), `paging` 18 and `paging2` 13 (item lists), `ba` 23 (BOM saves).
  - **`machinestock` didn't run:** it imports `createOrder` and `getStockOrderItems`, which feature 17's removal of "New Stock Order" deleted. It's out of date, like `stockorder`, and unrelated to this change.
- **The screens compile** (esbuild).
