# Feature 35: Codes made automatically in the R&D imports (what changed)

*Built 27 November 2026. Logic and decisions: [35-import-auto-codes-logic.md](35-import-auto-codes-logic.md). Browser test: [35-import-auto-codes-test-roadmap.md](35-import-auto-codes-test-roadmap.md).*

## In one line
**A code left blank in an R&D import is now made by the system on import,** and the import lists every code it saved, with a **Copy** button.

## Each import
| Import | A blank code becomes | Example |
|---|---|---|
| **Inventory** (normal item) | the name's first 3 letters + the next number, skipping every Inventory code, every Fabrication Master code of the company and every code in the file | Bearing 6205 → `BEA-001` |
| **Inventory** (fabrication item) | the Fabrication Master's code, as before | |
| **Product Master** | the **Generate** button's rule: the Name's initials + Metrology + the Variant's digits, `-2`, `-3` … when taken | Impact Pulverizer + MS + 6x12 → `IPMS612` |
| **Motor Master** | the next free `MTR` number | `MTR-001`, `MTR-002` |
| **Fabrication Master** | as before (the name's first 3 letters + the next number) | Angle → `ANG-013` |
| **Plant Master** | no code (unchanged) | |

- **A typed code still works** everywhere, and always wins: a made code is never one typed elsewhere in the file.
- **The check shows each made code first,** marked *made*. The import makes them again from fresh data, so a code someone saved in between is skipped.

## Product Master: the Product Ref
- **The Products sheet has a new column "Product Ref"** (P1, P2 …), optional, unique in the file, never the same as a code. It isn't saved, like Plant Ref.
- **The Specifications and Custom Fields sheets' first column is now "Product Ref or Code".** It matches a Ref first, then a code typed on the Products sheet. Old files with the "Product Code" header still read.
- **A made code can't be pointed at** (it isn't known when the file is written). So a product whose code is left blank needs a Ref to get Specifications or Custom Fields. Otherwise the row says *"… isn't a Product Ref or a code typed on the Products sheet. (A product whose code is left blank needs a Product Ref.)"*
- **A Ref that's also a code in the file is refused.**

## The screen (R&D's import windows)
- **The steps** say which codes are made and how.
- **The check's table** marks a made code *made*.
- **After the import,** a **Codes** box lists every code (row, name, code, made or typed) with **Copy**. Copy writes a table that pastes into Excel (where copying isn't allowed, the table is selected for Ctrl+C). Use it for the Plant Master import's "Machines & Motors" sheet.

## Not changed
- The Inventory, Product Master and Motor Master **add forms**: Inventory's still needs a typed code (the client's Point 8 rule); Product Master keeps its Generate button.
- The Plant import.
- All or nothing.
- Who may import.

## Files
- **Server:**
  - new `services/bulkImport/codes.js` (`codeKeeper`, `nextNumbered`, `freeFrom`, `productCodeBase`, `derivePrefix`)
  - `services/bulkImport/inventoryImport.js`, `productMasterImport.js`, `motorImport.js`, `fabricationImport.js` (each import returns `codes: [{ row, name, code, made }]`; the code columns' titles say "(blank = made)", with the old titles still read)
- **Screen:** `components/inventory/BulkImportDialog.jsx` (`ImportedCodes`, made markers, steps)

## Tested
**Through the real server, on made-up companies, nothing left:**
- **`bulkinv` 61:**
  - new: QZX-011 / -012 made, skipping a used item code, a Fabrication Master code and a typed code; the list returned; the next file goes on from QZX-013
  - "no code" is no longer a problem
- **`pmimport` 44:**
  - new: QIPMS612-2 / -3 made when the base is taken elsewhere; Specifications found by Ref and by a typed code; a Ref equal to a code refused; a detail row pointing at nothing refused
  - the template's new columns
- **`motorimport` 25** (new: the next MTR numbers after the highest one and a typed one).
- **`bulkfab` 30** (the codes list).
- **`plantimport` 28** (unchanged).
- **The suites' file builders** learnt the new "(blank = made)" titles.
- **The import window bundles.**
