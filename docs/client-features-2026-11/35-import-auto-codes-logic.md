# Feature 35: Codes made automatically in the R&D imports (logic and decisions)

*27 November 2026. From the client meeting where the R&D bulk imports (features 20–22) were shown: a code left blank should be made by the system on import, in every import that has codes. Where a sheet needs to point at a row whose code doesn't exist yet, it uses a reference that lives only in the file, as the Plant Master import already does.*

## Today
| Import | Code today | The page's own add form |
|---|---|---|
| **Fabrication Master** (feature 20) | Blank = made: the name's first 3 letters + the next number (`ANG-013`), counted across all Fabrication Master and Inventory codes. Size rows of one entry are linked by code, or by name when the code is blank. | the same rule |
| **Inventory** (feature 20) | **Required** on a normal row. A **fabrication row** may leave it blank and takes the Fabrication Master's code. | required: *"R&D must explicitly define the universal ERP Item Code"* (the client's earlier rule, "Point 8") |
| **Product Master** (feature 21) | **Required.** The Specifications and Custom Fields sheets find their product **by this code.** | **Generate** button: name initials + Metrology + the Variant's digits (`IPMS612`), with `-2`, `-3` added when taken (`/api/rd/machines/free-code`) |
| **Motor Master** (feature 22) | **Required.** One sheet. | typed (example `MTR-001`); no generator |
| **Plant Master** (feature 22) | **No code.** Its sheets link by a **Plant Ref** (P1, P2 …), used only in the file; the parts sheet uses existing machine / motor codes. | no code |

## Decided (27 Nov, the user)
1. **Product Master:** a blank Product Code is made with **the Generate button's rule** (name initials + Metrology + Variant digits, `-2`, `-3` when taken), so imported and hand-added products look alike. A typed code still works.
2. **Motor Master:** a blank Motor Code is the **next free `MTR-###`** (`MTR-001`, `MTR-002` …). A typed code still works.
3. **Inventory:**
   - a **normal** item with a blank Item Code gets one made
   - a **fabrication** item still takes the Fabrication Master's code
   - a code is made **only** for a blank normal item, and **never twice**: never one that exists, never one a fabrication row brings, never one typed elsewhere in the file
4. **References:** where a sheet must point at a row that has no code yet, it uses a **Ref** that lives only in the file and isn't saved, like Plant Ref.
5. **After an import,** the codes are listed (row, name, code) with a **Copy** button, so R&D can use them, for example in the Plant import.

## The details (decided 27 Nov: A–I as recommended, the first option each time)
**A. The Inventory code rule:**
- (a) **the Fabrication rule:** the name's first 3 letters + the next number (`Bearing 6205` → `BEA-001`), counted across **all Inventory codes, all Fabrication Master codes and every code in the file** (recommended). The same rule the Fabrication import uses, so the two families can't clash.
- (b) by Item Type (e.g. `RM-001` for raw material)

**B. Several blank Product rows that make the same code** (two "Impact Pulverizer MS 6x12"): `IPMS612`, then `IPMS612-2`, `IPMS612-3` in row order, also skipping codes already saved (recommended). The Product Master import already refuses a product that exists (same Category + Sub Category + Name + Variant), so this mostly affects different products with the same initials.

**C. The Product Ref:**
- a new **"Product Ref"** column on the Products sheet, optional, unique in the file
- the Specifications and Custom Fields sheets' first column becomes **"Product Ref or Code"**, which matches a Ref first, then a code typed on the Products sheet
- a Ref may not be the same as any code in the file (no mix-ups)
- needed only when the product's code is left blank **and** it has Specifications or Custom Fields rows
- old files that use codes keep working

(recommended)

**D. Motor and Inventory need no Ref:** each is one sheet and nothing in the file points at them. Fabrication already links a blank-code entry's size rows by its name. (recommended)

**E. When the codes are made:**
- in the **check**, so R&D sees them before saving (marked "made")
- made **again at import**, which re-checks everything anyway; if someone saved one of those codes in between, the next free one is taken
- the result list shows the final codes

(recommended)

**F. The result list** (row, name, code, made or typed, Copy as a table that pastes into Excel) for the four imports that can make codes: Fabrication, Inventory, Product, Motor (recommended).

**G. The templates and "How to fill":** the code columns lose their `*` and say *"Blank: made on import (rule …)"* (recommended).

**H. Point 8 (R&D types Inventory codes):** the **Inventory page's own add form stays as it is** (a code must be typed). Only the import makes codes, as the client asked (recommended). The Product Master form keeps its Generate button; the Motor Master form could get one later if wanted.

**I. Plant Master:** no change (it has no code). Its parts sheet still needs codes that exist: import products and motors first, then copy their codes from the result (recommended).

## Not changed
- The checks each import already does (names, the tree, units, duplicates, and so on).
- All or nothing.
- Who may import.
- The add forms (point H).
