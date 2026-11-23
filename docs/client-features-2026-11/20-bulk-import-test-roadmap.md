# Feature 20: Bulk import for R&D (browser test)

*On test-1. What changed: [20-bulk-import-changes.md](20-bulk-import-changes.md). The suites `bulkinv` (47) and `bulkfab` (29) already check every rule; this is about the screens and real files.*

**Logins:** R&D Head (imports) and Store Head (stock audit). Use codes nobody has, e.g. starting `BT-` plus today's date.

## 1. Fabrication Master first
1. R&D → Inventory → **Fabrication Master** → **Bulk Import** → **Download template**. Open it:
   - Sizes, How to fill, Categories, Designations, Lists
   - Lists shows the materials (including any you added) and your unit types
2. On *Sizes*, fill 3 rows:
   - two rows of one sheet entry: name "BT Sheet 2mm", code blank, Category `sheet_plate`, Material MS (Mild Steel), Thickness 2, Width 1250 / 1000, Length 2500, all 3 unit pairs
   - one IPE row: name "BT IPE 200", code `BT-IPE-1`, Category `beam_ipe`, Designation IPE 200, Length 6000, the units
3. **Put a mistake in on purpose:** leave the IPE row's Designation blank. **Check file.**
   - *"1 problem … Nothing was imported"*, with the row number, "Designation" and the reason.
4. Fix it and **Check file** again.
   - *"Ready: 2 entries, 3 sizes"*
   - the sheet's code is marked *generated* (BTS-…)
   - weights: **49.06** and **39.25 kg**; the IPE **134.4 kg**
5. **Import:** the list on the page shows both entries with their sizes.
6. **Check the same file again:** refused (the code and the name exist), with no second copies.

## 2. Inventory
1. R&D → Inventory → **Bulk Import** → **Download template**. *Lists* shows your Item Types, categories, unit types, and "Fabrication Item". On *Items*, two headers say when they apply: **Job Work Type (only for Job Work)** and **How is it used in production? (piece items)**.
2. Fill 4 rows:
   - a bought piece item: Purchase, Count unit / Pieces both, "How is it used in production?" = Built into the product, Medium Flow, Min Stock blank, Order 50
   - a made item: Make, Mass Unit / Kilogram, Unit Weight 2.5
   - a length item: Purchase, Length unit, Unit Weight 0.2 per Meter, Low Flow
   - a fabrication row: Item Process Type "Fabrication Item", Fabrication Master Code `BT-IPE-1`, Purchase, High Flow, Min Stock 2, Order 4. Leave name and code blank.
     - **The columns marked "(not for fabrication)" (22 Nov):** leave them blank, except type **Used Unit "Millimeter"** on purpose.
   - **New list values (22 Nov):** on the made item, give an Item Type that isn't in your list yet (e.g. "BT Spares") and an Item Category that is, typed in small letters.
3. **Check file:** *"Ready: 4 items (1 fabrication; 3 will wait for Store's first stock count)"*.
   - Above it, a yellow box: *"New list values to add (1): Item Type "BT Spares" (row 3)"*. The category in small letters isn't listed: it matched the existing one.
   - A blue box: *"Taken from the Fabrication Master instead (1 row)": Row 5 (BT-IPE-1): Used Unit "Millimeter" → Meter*. It's not a problem; the item gets Meter.
   - Then **Import**. The result says *"1 new value added to the dropdown lists"*, and the Add Item form's Item Type dropdown now offers "BT Spares".
4. **The list:**
   - the 3 bought items carry the **"count stock first"** badge
   - the chip **"Waiting for first stock count (3)"** lists them
   - open the bought piece item: Min Stock **10**, Medium Flow, Pieces, "Built into the product"
   - open the fabrication item: name and code from the master, the IPE size with 134.4 kg, High Flow / min 2 / order 4
5. **A file with mistakes:**
   - a used code
   - a unit that isn't of its type
   - a missing Material Flow on a Purchase row
   - a fabrication row whose code doesn't exist

   → every problem is listed, and nothing is imported.

## 3. Store
1. Store Head: a bell, *"R&D imported 4 items: 3 wait for a first stock count…"*.
2. Store → Inventory: the same chip. **Stock audit** the bought piece item with a count of 20:
   - the badge goes, and the chip shows 2
3. **After the next sweep (30 minutes):**
   - no purchase request for the 2 still waiting
   - none for the counted item (20 is above its minimum of 10)

## Log
| Step | Result | Notes |
|---|---|---|
| 1. Fabrication Master import | PASSED 23 Nov | 3 BT entries, 4 sizes; BTS-001 generated; weights 49.06 / 39.25 / 134.4 / 17.66 kg |
| 2. Inventory import (60 rows) | PASSED 23 Nov | 5 new list values shown and added; blue box for BT23-ANG; 60 imported, 3 fabrication, 51 waiting; items opened: Hex Bolt (NOS, Built into, Length 40 MM), Armoured Cable (1.1 kg per Meter), BT Angle (Meter + MS from the master) |
| 2.5 Mistakes file | PASSED 23 Nov | 17 problems in 18 rows, no Import button |
| 3. Store | PASSED 23 Nov | one bell; Verify Stock on BT23-056 (10) cleared its hold, 50 left |
| Cleanup | DONE 23 Nov | the 60 items, 3 entries, 5 list values, 2 bells and 1 stock audit deleted; test-1 back to 39 items / 7 Fabrication Master entries |
