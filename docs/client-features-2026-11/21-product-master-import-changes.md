# Feature 21: Bulk import for R&D Product Master (what changed)

*Built 22 November 2026. Logic and your decisions (1–4): [21-product-master-import-logic.md](21-product-master-import-logic.md). Browser test: [21-product-master-import-test-roadmap.md](21-product-master-import-test-roadmap.md).*

## In one line
Product Master has a **Bulk Import** button. One Excel file builds what Manage Classifications holds (the Category → Sub Category → Product Name → Variant tree with its Source Types, and the custom field templates) and the products themselves. Every row of every sheet is checked first; then it imports all of it or none.

## What R&D sees
**R&D → Product Master → Bulk Import** (beside Add Item; anyone who can add products):
1. **Download template.** The file has seven sheets:
   - **Products:** one row per product, 33 columns in the Add form's order. Up to 3 power requirements per product (Power 1–3: Source, HP, KWH, RPM).
   - **Specifications:** Product Code, Key, Value; one row each.
   - **Custom Fields:** Product Code, Group, Field, Value; one row each.
   - **How to fill:** every column's rule.
   - **Tree:** your current paths, e.g. *Atta Chakki › Chakki › Aata 5kg › 6x12*, and each Sub Category's Source Types.
   - **Templates:** each combination with its groups and fields.
   - **Lists:** Metrology, Material Grade, Power Source, your Mass Unit units, and the fixed choices.
2. **Check file.** Nothing is saved. It shows one of:
   - ***"Ready: 4 products (8 new tree values, 2 new template fields)"*** with a preview (code, path, source type, sourcing, specs, custom fields). Above it, the yellow ***"New list values to add"*** box lists every new value **with where it goes**, e.g.:
     - *Variant "8x16" under Atta Chakki › Chakki › Aata 5kg*
     - *Product Name "Pulvo 10" under Pulverizer › Chakki*
     - *Custom field "Motor › Phase" under Atta Chakki / Chakki / In House*
     - *Custom field "Heater › Watts" under Dryer / Tray / Out Source (new template)*
     - *Power Source "Engine"*
   - every problem by **sheet**, row and column, and *"Nothing was imported"*.
3. **Import:** *"Imported 4 products. Added 8 tree values, 2 template fields, 2 list values."* The page, Manage Classifications and the dropdowns refresh.

## How a row is read
**The tree, by path, ignoring letter case:**
- "chakki" under "Atta Chakki" uses the existing "Chakki" there, and the product is saved with the tree's own spelling.
- A value the tree doesn't have is added under that row's own parent. A Product Name under the Pulverizer's "Chakki" never lands under the Atta Chakki's "Chakki".
- Two rows adding the same new value under the same parent make one value.

**Custom fields:**
- Rows are matched against the template of that product's Category + Sub Category + Source Type. A missing group or field is added to the template; a combination with no template gets a new one.
- **Each product gets every field of its template** (blank where the file gives no value), the same as the form seeds them.

**The other columns:**
- **Sourcing:** "Purchasable (Vendor)" / "Internal Manufacturing", the form's words (Purchase / Make read the same).
- **Weight:** Purchasable only, with a Mass Unit unit; the type is stored as Mass Unit.
- **KWH:** left blank, worked out from HP × 0.746, as the form does.
- **Applications / Accessories:** comma-separated; the same tag twice is kept once.
- **Forward to Design & Prototype:** Yes / No.

**Refused:**
- a code used anywhere, or twice in the file
- the same Category + Sub Category + Name + Variant as an active product, or twice in the file
- no sourcing; a weight on an Internal Manufacturing product, or one not in a mass unit
- a non-number HP / KWH / RPM
- a specification or custom field for a code that isn't in Products, or the same field twice for one product

**Saved as:** Draft / Not Released, Pieces, with no prices or stock, as with the form.

## All or nothing
- After the check passes, the import adds the tree values (parents first, each linked to its parent), the new list values and the template changes, then saves the products.
- **If anything fails,** it takes everything back: the products, the tree and list values, a new template, and an existing template's previous groups. Then it says nothing was imported.
- A code taken by someone between check and import is caught by the second check, and nothing is added.

## Also fixed (22 Nov): Product Weight is always a mass
- **Before:** the Add / Edit form let you choose the weight's unit type.
- **Now:** it shows **Mass Unit**, locked, and you pick only the unit (Gram, Kilogram, Tonne). The server stores Mass Unit whenever a weight unit is given, on create and edit.
- One dev product had its weight in "NOS". Its form shows *"NOS (not a mass unit: pick one)"*.

## The weight headers say when they apply (23 Nov, your ask)
- **Why:** the form shows Product Weight only once Sourcing is **Purchasable (Vendor)**, but the template's headers didn't say so.
- **The headers now:**
  - **"Product Weight (Purchasable only)"**
  - **"Product Weight Unit (Purchasable only)"**
- **How to fill** says the same: leave both blank for Internal Manufacturing.
- **The rule is unchanged:** a weight on an Internal Manufacturing row is still refused (*"Only for a Purchasable product, as on the form. Leave blank."*). That way a wrong Sourcing is caught rather than the weight quietly dropped.
- **A file made from the older template still reads:** the old headers are accepted (aliases). Problems keep the short names "Product Weight" / "Product Weight Unit".

## Technical notes
**Server:**
- **New `services/bulkImport/productMasterImport.js`:**
  - `buildTemplate`
  - `check`: batched reads only:
    - the company's classification options, templates and Mass Unit units, once each
    - one index-only read of all item codes
    - the company's active machines named in the file
  - tree resolution follows `classificationTree.js` (by `parentId`, or a legacy parent text); planned nodes can parent planned nodes
  - `importFile`: classifications first, then the products, with full rollback
- **`services/bulkImport/common.js`:**
  - `openWorkbook`
  - `readSheet` takes a buffer or an opened workbook, with `optional` (a missing or empty sheet is fine, never the first sheet in its place) and `maxRows`
  - feature 20's imports behave as before
- **`routes/bulkImport.routes.js`:** `mount(kind, svc, file, gate)`; `/api/bulk-import/product-master/{template,check,import}` gated by `rnd → productMaster → add` (the same gate as saving classifications and templates).
- **`controllers/rdController.js`:** Product Weight stored as Mass Unit on create and update.

**Screens:**
- **`BulkImportDialog.jsx`:**
  - the `productMaster` kind, with API paths per kind
  - a Sheet column in the problem table
  - "under …" in the new-values box
  - the Product Master preview and done message
- **`ProductMaster.jsx`:**
  - the Bulk Import button
  - invalidation of `rd-machines`, `rd-master-options` and `rd-custom-field-templates`
  - `renderMassUnitPick` for the weight unit

## Tests
**`pmimport`, 40 of 40**, through the real server on made-up companies with `.invalid` emails. The last 2, on 23 Nov: the weight headers say "(Purchasable only)", and a file with the older headers still reads its weight.
- **The template:** 7 sheets, 33 product columns; Tree, Templates and Lists show the company's own data (not another company's). No Product Master "add" means 403.
- **Problems, 12 kinds, each with its sheet, row and column, and nothing saved:**
  - no Category / code; a code an active product has (other letter case); a repeated code
  - the same product as an active one (any letter case), and twice in the file
  - no sourcing; a weight on Internal Manufacturing; a non-mass weight unit; HP not a number
  - a specification for an unknown code; the same custom field twice
- **A clean file of 4 products:**
  - 8 tree values, 2 template fields and 2 list values shown first with their paths; checking saved nothing
  - **Imported:**
    - a Variant under the existing name; a name and source type under the Pulverizer's Chakki only
    - a new path Dryer › Tray (once) › two names, with its source type, each linked to its parent
    - Phase added to the existing Motor group (Voltage keeps its id); a new template for Dryer / Tray / Out Source
    - EN8 and Engine added
  - **The products:**
    - the tree's own spelling; variant
    - 120 kg as Mass Unit; Motor 5 HP → 3.73 KWH worked out
    - deduplicated applications, accessories, forwarded, HSN; Draft / Not Released
    - custom fields in the template's spelling; specifications (a code in other letter case)
    - a product with no custom-field rows getting its template's field blank
  - the same file again: every code taken, and no new values
- **A code taken between check and import:** refused, and none of its 4 tree values added.
- **Not covered by a test:** the rollback when saving the products fails *after* the classifications went in. No file can make that happen, so it's left to the code. The second check catches the realistic case, a code taken meanwhile.
- **Product Weight: `pmweight` 3 of 3.**
- **Regression:** `bulkinv` 53 and `bulkfab` 29 (the shared reader changed).
- **The screens compile** (esbuild). The server files pass the strict ES-module syntax check.
