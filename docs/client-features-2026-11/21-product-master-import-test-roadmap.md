# Feature 21: Product Master bulk import (browser test)

*On test-1, as R&D Head. What changed: [21-product-master-import-changes.md](21-product-master-import-changes.md). The suite `pmimport` (38) already checks the rules; this is about the screens and a real file. Use codes nobody has, e.g. starting `BT-` plus today's date.*

## 0. Product Weight (the small fix)
1. Product Master → **Add Item** → Sourcing **Purchasable (Vendor)**.
   - Product Weight Unit Type shows **Mass Unit**, greyed out.
   - The unit list offers Gram, Kilogram, Tonne only.
2. Edit an existing purchasable product: the same.

## 1. The template
1. Product Master → **Bulk Import** → **Download template**. Open it:
   - **Products** (33 columns), **Specifications**, **Custom Fields**. The weight columns read **"Product Weight (Purchasable only)"** and **"Product Weight Unit (Purchasable only)"**.
   - **Tree** lists your current paths (e.g. the Aata machine's Category › Sub Category › Name › Variant) and each Sub Category's Source Types
   - **Templates** lists your custom-field combinations
   - **Lists** has Metrology, Material Grade, Power Source and the Mass Unit units

## 2. A file with three products
On **Products**:
1. **Under an existing path:** an existing Category, Sub Category and Product Name, with a **new Variant**, and its existing Source Type. Purchasable, weight 120 Kilogram, Power 1 Source "Motor", HP 5, KWH blank.
2. **A new Sub Category and Name** under an existing Category, and a new Source Type. Internal Manufacturing.
3. **Under a combination that has a custom-field template:** fill it in. Give the Category in small letters.

On **Specifications:** two rows for product 2 (e.g. Power / 5 kW, Capacity / 200 kg/hr).

On **Custom Fields:** for product 3, one existing group + field with a value, and one **new** field in that group.

**Check file:**
- *"Ready: 3 products (… new tree values, 1 new template field)"*
- **The yellow box:**
  - the new Variant *under* its Category › Sub Category › Name
  - the new Sub Category, Name and Source Type with their paths
  - *"Custom field 'Group › New field' under …"*
- product 3's Category in small letters isn't listed: it matched

**Import:** *"Imported 3 products. Added …"*

## 3. Where it landed
1. **Manage Classifications:**
   - click the Category, then the Sub Category: the new Name and Source Type are there, under the right parents
   - click the Name: the new Variant
   - pick product 3's combination: the template shows the new field
2. **The products:**
   - **Product 1:** View shows the variant, 120 Kilogram, Motor 5 HP with KWH **3.73**. Edit shows the dropdowns filled.
   - **Product 2:** Internal Manufacturing, its 2 specifications.
   - **Product 3:** its custom fields with the values (the template's other fields blank).
   - All three: Draft / Not Released.

## 4. Mistakes
Upload a file with:
- a code that exists
- the same product as an existing one (same Category / Sub Category / Name / Variant)
- no Sourcing
- a weight in "Pieces"
- a specification for a code not in Products

→ every problem is listed with its **sheet**, row and column, and nothing is imported. Manage Classifications shows nothing new.

## Log
| Step | Result | Notes |
|---|---|---|
| 1. The template | PASSED 23 Nov | sheets explained (Templates = names to copy for Custom Fields); weight headers now "(Purchasable only)" (your ask) |
| 2. A file with 5 machines | PASSED 23 Nov | my file "4 Product Master - 5 machines.xlsx": 18 new values with their paths (12 tree, 4 template fields, 2 list values); "Ready: 5 products"; imported |
| 4. Mistakes | PASSED 23 Nov | "5 Product Master - mistakes": 14 problems in 13 rows across the 3 sheets; no Import button |
| Cleanup | DONE 23 Nov | 5 machines, 14 tree / list values and 1 new template deleted; the edited template put back to empty; test-1 back to 39 items / 63 values / 8 templates |
