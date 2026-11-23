# Feature 21: Bulk import for R&D Product Master (logic)

*Client request (21 Nov 2026, the bulk-import series after [feature 20](20-bulk-import-logic.md)): R&D → Product Master (`/r&d/product-master`) gets a bulk import. Your decisions are in §6 (22 Nov).*

## 1. Why it's tricky: two places, one product
Product Master has two places that together make a product:
- **Manage Classifications & Custom Fields** holds:
  - **The tree:** Category → Sub Category → Product Name → Variant, with Product Source Type under the Sub Category. Each value belongs to its own parent, so two "Chakki" Sub Categories under two Categories are separate, each with its own names and variants.
  - **Custom field templates:** for each Category + Sub Category + Source Type, groups of extra fields (e.g. *Motor Specifications: Voltage, Phase*).
- **Add** only *picks* from that tree; it has no "+" for those five. The product's **name is itself a tree value**. The custom fields shown are the template of the combination picked.

**So the import does both from one file.** Each product row gives its full path, and whatever part of the tree is missing is added under that path. A custom field the combination's template doesn't have yet is added to the template. Both are shown in the check first (decisions 1–2), the same rule as the Inventory import's new list values.

## 2. What R&D does
The same flow as the Inventory import:
1. **Download the template** from Product Master (a Bulk Import button beside Add and Manage Classifications).
2. **Fill it in.**
3. **Upload it.** Every row is checked and nothing is saved yet. The check shows either:
   - **"Ready"**, with a preview and the **new tree values, template fields and list values that will be added**, or
   - every problem by row and column, and nothing is imported.
4. **Import:** checked again, then all or nothing.

## 3. The template
**Sheet *Products*, one row per product.** **\*** = required.

| Column | Rule |
|---|---|
| Category \* | The top of the tree. A new one is added. |
| Sub Category \* | Under that Category. A new one is added there. |
| Product Name \* | Under that Sub Category. A new one is added there; this is the product's name. |
| Variant | Under that Product Name (optional). A new one is added there. |
| Product Source Type \* | Under that Sub Category. A new one is added there. |
| Product Code \* | Unused anywhere in the database (any letter case), not repeated in the file. |
| Production | Free text (e.g. 200 Kg/hr). |
| Product Size | Free text (e.g. 500x300x200mm). |
| Metrology, Material Grade | From R&D's lists, or a new value (added, shown first). |
| Sourcing \* | **Purchasable (Vendor)** or **Internal Manufacturing**, the form's words. Purchase / Make are read the same. |
| Product Weight, Product Weight Unit | **Purchasable only**, as on the form. The unit is a Mass Unit unit (Gram, Kilogram, Tonne); the type is always Mass Unit (see §5). A weight needs its unit. |
| Model Number, Brand, HSN Code | Free text. |
| Power 1 Source, HP, KWH, RPM … Power 3 | Up to **3** power requirements (decision 3). The Source is from the Power Source list, or a new value. KWH blank is worked out from HP (× 0.746), as the form does. A 4th motor is added on the form. |
| Applications, Accessories | Several, separated by commas. |
| Description | Free text. |
| Product Status | Continue (default) or Discontinue. |
| Forward to Design & Prototype | Yes / No (default No), the form's tick box. |

**Sheet *Specifications*, one row per key and value:**
- Product Code, Key, Value
- The code is a product in the *Products* sheet; a product can have many rows.

**Sheet *Custom Fields*, one row per field value:**
- Product Code, Group, Field, Value
- Matched against the template of that product's Category + Sub Category + Source Type.
- A group or field the template doesn't have is added to it (decision 2), and shown first.

**Other sheets:**
- **How to fill**
- **Tree:** your current Category → Sub Category → Product Name → Variant and Source Types, as paths
- **Templates:** each combination with its groups and fields
- **Lists:** Metrology, Material Grade, Power Source, the Mass Unit units

**Not in the file** (not on the form, or set later):
- prices and stock
- design status and release: a new product starts **Draft / Not Released**, as with the form
- the Output Unit: Pieces, as the form defaults it
- documents and images

## 4. The checks
**The product:**
- **Code:** required, global and case-insensitive, unique within the file.
- **The same product twice:** the same Category + Sub Category + Name + Variant as an active product, or another row, is refused. That's the server's existing rule.
- **Sourcing:** exactly one choice.
- **Weight:** only with Purchasable, and the unit must be a Mass Unit unit.
- **Numbers:** HP, KWH and RPM are numbers, 0 or more.

**The tree, by path, ignoring letter case:**
- "chakki" under "Atta Chakki" uses the existing "Chakki" there.
- A new value is added under its own parent. Two rows adding the same new value under the same parent count once, and the first spelling in the file is the one added.
- A Variant needs a Product Name; a Source Type needs a Sub Category.

**The other sheets:**
- A *Specifications* or *Custom Fields* row must name a product code in *Products*.
- Two values for the same group and field of one product are refused.

**What gets added, and when:**
- **Lists:** Metrology, Material Grade and Power Source new values are added, shown first.
- **Units:** strict.
- **Order of saving:** after the check passes, the tree values, template fields and list values are added first, because products are saved with the tree's text. If saving the products then fails, the values added by this import are taken back again.
- **Limits:** up to 1,000 product rows; who can import: Product Master "add".

## 5. Fixed with it (22 Nov): Product Weight is always a mass
- **Your ask:** on the form, the Product Weight Unit Type was a free choice of unit type.
- **Now:** it's fixed to **Mass Unit** (shown, locked), and R&D picks only the unit: Gram, Kilogram, Tonne.
- The server stores Mass Unit whenever a weight unit is given, on create and edit, so another caller can't save a wrong type either.
- One dev product had its weight in "NOS". Its edit form shows *"NOS (not a mass unit: pick one)"* until a real unit is picked.

## 6. Your decisions (22 Nov)
1. **Tree values:** missing Category / Sub Category / Product Name / Variant / Source Type values are added from the file, under the row's own path, shown in the check first.
2. **Custom fields:** a group or field not in the combination's template is added to the template, shown first.
3. **Power Requirements:** up to 3 per product in the file; more on the form.
4. **Metrology, Material Grade, Power Source:** new values are added, shown first, as in the Inventory import.

**Carried over from feature 20:** check first, all or nothing, new products only, units strict, 1,000 rows, the Bulk Import button.
