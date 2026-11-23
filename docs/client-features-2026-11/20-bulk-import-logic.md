# Feature 20: Bulk import for R&D (logic)

*Client request, 21 November 2026: entering items one by one takes too long, so R&D gets a bulk import. It starts on **R&D → Inventory** (`/r&d/inventory`), followed by **R&D → Fabrication Master**. Your decisions are in §7.*

## 1. What R&D does
1. **Download the template** (an Excel file) from the page.
2. **Fill it in.** One row per item. A sheet called *Lists* shows the allowed values, taken live from your company's own dropdown lists.
3. **Upload it.** The system checks **every row** against the same rules the Add Item form and the server use, and changes nothing yet.
   - **All clean:** *"Ready: 120 items"* with a short preview, and an **Import** button.
   - **Any problem:** a list by row and column, e.g. *"Row 14 · Used Unit: 'Kgs' isn't a unit of Mass Unit (use: Kilogram, Gram, …)"*. Nothing is imported. R&D fixes the file and uploads it again.
4. **Import.**
   - The rows are checked once more (something may have changed in between), then all of them are saved together.
   - If even one fails at that moment (say someone took a code in the meantime), **none** are kept, and the problem is listed.
   - **It never half-imports** (decision 3).

## 2. What is imported where
- **R&D → Inventory, the *Inventory* tab:** plain items, meaning raw materials, bought parts, tools and fabrication items. That's the Add Item form (`SimpleInventoryForm`).
- **Not now:** Child Parts, Sub Child Parts and Machines. Each carries a BOM and process steps, which a single-row template can't hold.
- **Then R&D → Fabrication Master:** its own template (§5), built right after (decision 2).
- **The old "Import Excel"** (`/inventory/items/import`, reached from Category Management and Suppliers) is left as it is:
  - it uses old fields, doesn't require the R&D code, and imports row by row
  - it isn't on R&D's page
  - retiring it is a separate change

## 3. The Inventory template (sheet *Items*, one row per item)
The columns follow the Add Item form's numbering. **\*** = required.

| Column | Rule |
|---|---|
| 1. Item Type | From the list (optional). |
| Job Work Type | From the list. Only when Item Type is "Job Work"; otherwise leave blank. |
| 2. Item Process Type | From the list (optional). **"Fabrication Item"** makes this a fabrication row (§4). |
| Fabrication Master Code | **Fabrication rows only, and required there.** Blank for every other row. |
| 3. Item Name \* | At least 2 characters. Fabrication row: blank takes the master's name. |
| 4. Item Code \* | **R&D's code** (the system never makes one up). It must be unused anywhere in the database, in any letter case, and not repeated in the file. Fabrication row: blank takes the master's code. |
| 5. Model Number, 6. Brand Name | Free text. |
| 7. Item Category | One or more from the list, separated by commas. |
| 8. Source Type, 9. Item Source Type | From the lists. |
| 10. Metrology, 11. Material Grade | From R&D's lists. Fabrication row: Material Grade comes from the master. |
| 12. Unit Weight (kg), Unit Weight per | A number, 0 or more. "per" only for a Length / Area / Volume Used Unit (e.g. 1.5 kg per Meter). Not for fabrication rows. |
| 13. Purchase or Make \* | **Purchase** (the form's "Purchasable (Vendor)") or **Make** ("Internal Manufacturing"). The form's own words are accepted too. |
| Purchase Unit Type, Purchase Unit | Required for Purchase. The unit must belong to its type. Fabrication row: from the master. |
| 14. Used Unit Type \*, Used Unit \* | The unit must belong to its type. Fabrication row: from the master. |
| How is it used in production? | **Built into the product** or **Used to make the product**. Required when the Used Unit counts pieces, the same as the form. |
| 16. Size: Length, Height, Width, Dia (OD), Dia (ID), Thickness | Each is a number plus its unit (Inch, MM, Feet, Meter), all optional. Not for fabrication rows: their sizes come from the master. |
| 17. Material Flow | **Required for Purchase:** High Flow, Medium Flow or Low Flow. |
| Min Stock | Blank takes the flow's usual figure (20 / 10 / 5), as the form does. Fabrication row: whole pieces, applied to every size. |
| Order Quantity | 0 or more. Fabrication row: whole pieces. |
| 18. Item Status | **Continue** (default) or **Discontinue**, the form's words. |
| 19. Description | Free text. |

**Not in the template** (owned by someone else, or one at a time):
- **stock:** Store; new items start at 0, as with the form
- **prices:** Purchase and Accounts
- **days to buy:** Purchase
- **the image:** uploaded on the item

**The template's other sheets:**
- **How to fill**, with an example row.
- **Lists:** each list's allowed values, and the unit types with their units, read from your company when you download.

## 4. Fabrication items in the Inventory import (decision 1)
**A fabrication row links to an existing Fabrication Master entry.** It never creates one.
- **Copied from the master,** exactly like picking it in the form:
  - name and code (unless typed)
  - Material Grade, Sheet Metal / Non Sheet Metal
  - Purchase / Used / Receive units
  - every size with its weight
- **Each size starts at 0 pieces in stock.** The row's Material Flow, Min Stock and Order Quantity go on every size.
- **The row fails when:**
  - **No match:** *"Fabrication Master 'ANG-012' not found: add it in Fabrication Master first (or import it there)."*
  - **Discontinued:** the master entry is discontinued.
  - **Already used:** the master entry is already linked to another item. It's one item per master entry, the same rule as the form's picker. Two rows in the same file pointing at the same master count too.
  - **Size or unit columns filled in:** they come from the master.

## 5. The Fabrication Master template (decision 2, built right after)
**One row per size.** The rows of one entry share its Item Code, or its Item Name when the code is blank.

| Column | Rule |
|---|---|
| Item Name \* | Same on every row of the entry. |
| Item Code | Blank gives the next code from the name, as the page does (e.g. ANG-013). If typed, it must be unused as a Fabrication Master code **and** as any Inventory code. |
| Category \* | One of the 20 shapes (the *Lists* sheet shows each one's size fields). |
| Material \* | From the material list (built-in plus your company's). It sets the density. A Density column can override it, as the page allows. |
| Sheet Metal | Yes / No. |
| Purchase / Used / Receive Unit Type and Unit | The same pairs the page has. **Required in the file:** the inventory item linked to the entry needs them. |
| The size columns (mm) | Only the fields this category needs, e.g. thickness, width, length for a sheet; outside diameter, wall thickness, length for a pipe. A field this category doesn't use must be blank. |
| Designation | For the 6 standard-table shapes (beams, channels…): must be a size in that table, e.g. "IPE 200". |

- **The server works out each size's weight,** with the same calculator the page uses. The check shows them in the preview.
- **New entries only.**
  - An existing code is refused: *"add sizes to it on the page"*.
  - So is a blank-code entry whose name the company already has, so uploading the same file twice can't make second copies under new codes.
- **The same check, then all-or-nothing.**

## 6. The same for both imports
- **Who can import:** whoever can **add** an item there. That's the Inventory "add" permission, or the Fabrication Master permission for that page.
- **New items only.** A code that already exists is a problem, not an update; editing stays on the form.
- **List values (changed 22 Nov, your call):** a value already in its list is matched ignoring letter case, and the list's own spelling is saved. A value that isn't in its list yet is **added to that list when the file is imported**.
  - The check shows every new value first, e.g. *"New list values to add: Item Type 'Spares' (rows 4, 9); Item Category 'Bearings' (row 7)"*, so a typo can be fixed in the file before it becomes a dropdown value for everyone.
  - The first spelling in the file is the one added; "bearings" on a later row uses it.
  - They're added only after the items are saved, so a failed import leaves no new values.
  - This covers the 8 lists: Item Type, Job Work Type, Item Process Type, Item Category, Source Type, Item Source Type, Metrology, Material Grade.
  - **Unit types and units stay strict.** They drive purchase, receiving, BOM weight and stock conversions, so they must already exist (Unit Type Management).
- **Up to 1,000 rows per file** (5 MB).
- **One bell,** *"R&D imported 120 items"*, instead of a bell per item. The usual per-item records (the production summary) are still made.
- **Duplicates inside the file count too:** the same code twice, or the same name and Item Type twice.

## 7. Your decisions (21 Nov)
1. **Fabrication rows: fail without a Fabrication Master entry.** The inventory file doesn't create master entries.
2. **Fabrication Master gets its own bulk import, built right after the Inventory one.** Order of use: Fabrication Master first, then Inventory.
3. **A file with any bad row imports nothing:** every problem is listed by row; fix and upload again.

**K. Imported items wait for Store's first stock count before they reorder** (your choice, 21 Nov, during planning):
- **The problem:** new items start at 0 stock, and the form requires a Material Flow for purchasable items. The low-stock sweep (every 30 minutes) raises a purchase request for any purchasable item with a flow and no stock. Importing existing catalog items, whose real stock is on the shelf, would raise one request per item.
- **So:** an imported purchasable item keeps its Material Flow, Min Stock and Order Quantity, but the sweep leaves it alone until Store records its stock once (a stock audit, or a stock adjustment, on that item). After that it reorders as normal.
  - A genuinely new item: Store audits it at 0, and reordering starts.
  - Store and R&D see these items under **"Waiting for first stock count (N)"** on Inventory, and each one has a "count stock first" badge.

**I've set these the safe way (say if you want any different):**
- E: only the Inventory tab (§2)
- F: new items only (§6)
- G: ~~list values must already exist~~. **Changed 22 Nov:** new list values are added on import, shown in the check first; units stay strict (§6)
- H: no stock, prices or image in the file (§3)
- I: 1,000 rows
- J: one bell
