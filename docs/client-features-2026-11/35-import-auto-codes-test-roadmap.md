# Feature 35: Codes made in the R&D imports (browser test)

*On test-1, as R&D. What changed: [35-import-auto-codes-changes.md](35-import-auto-codes-changes.md). The suites `bulkinv`, `pmimport`, `motorimport` and `bulkfab` check the server; this is about the screens.*

**Before:** download each template fresh (the code columns now say "(blank = made)"). **After:** I delete the test items, products, motors and plant (backup first).

## 1. Inventory
1. **A file with three normal items:** two with the Item Code blank (e.g. "Zz Bearing 6205", "Zz Bearing 6206") and one typed.
2. **Check:** the blank ones show codes like `ZZB-001`, `ZZB-002`, marked *made*; the typed one is unchanged.
3. **Import:** the **Codes** box lists all three; **Copy** and paste into Excel: Row, Name, Code, Made.
4. **A fabrication item** (with its Fabrication Master Code, Item Code blank) still takes the master's code.

## 2. Product Master
1. **Products:**
   - two products with the code blank and Product Ref P1 / P2 (e.g. "Zz Impact Pulverizer", Metrology MS, Variant 6x12)
   - one with a typed code
2. **Specifications:** a row for P1 and a row for the typed code.
3. **Check:**
   - the blank ones get the Generate button's code (`ZIPMS612`, then `-2` if a second one makes the same)
   - the specifications count shows on each
4. **Import:** the Codes box. On Product Master, the products have those codes and P1's specification.
5. **Mistake checks:** a Ref that's also a typed code is refused; a Specifications row with an unknown Ref says a blank-code product needs a Ref.

## 3. Motor Master
1. **Two motors with the code blank, one typed.**
2. **Check:** the next `MTR` numbers, marked *made*.
3. **Import:** the Codes box.

## 4. Plant Master with the copied codes
1. **A plant file** whose "Machines & Motors" rows use the codes copied from steps 2 and 3. It imports.

## 5. Fabrication Master
1. **A file with one entry's code blank:** the check shows the made code (*made*), and the import lists it in the Codes box.

## 6. Clean up
I delete the test items, products, motors, Fabrication Master entries and plant (backup first).
