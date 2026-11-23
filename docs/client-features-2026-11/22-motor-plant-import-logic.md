# Feature 22: Bulk import for R&D Motor Master and Plant Master (logic)

*Client request (the bulk-import series, after [feature 20](20-bulk-import-logic.md) and [feature 21](21-product-master-import-logic.md)): R&D → Motor Master (`/r&d/motor-master`) and R&D → Plant Master (`/r&d/plant-master`). Your decisions are in §5 (22 Nov).*

## 1. The same flow as the other imports
1. **Download the template** (a Bulk Import button beside Add on each page).
2. **Fill it in.**
3. **Upload it:** everything is checked and nothing is saved yet. The check shows:
   - **"Ready"**, with a preview and the new list or tree values that will be added, or
   - every problem by sheet, row and column, and nothing is imported.
4. **Import:** checked again, then all or nothing.

## 2. Motor Master
**What the form has:**
- Motor Code, Motor Name, Model Number, Serial Number, Brand Name, Motor Type, HSN Code
- Motor Specifications: Version, HP, KWH (worked out from HP), RPM, Pole, Phase
- Description, Image, Motor Status, Sourcing

A motor is saved as an item (productKind Motor), counted in Pieces.

**Sheet *Motors*, one row per motor.** **\*** = required.

| Column | Rule |
|---|---|
| Motor Code \* | Unused anywhere in the database (any letter case), not repeated in the file. |
| Motor Name \* | At least 2 characters. The same name as an active motor, or another row, is refused (the form's rule). |
| Model Number, Serial Number, Brand Name, HSN Code | Free text. |
| Motor Type | From the Motor Type list, or a new value (added, shown in the check first). |
| Version, Pole, Phase | Free text (e.g. 4 Pole, 3-Phase). |
| HP, KWH, RPM | Numbers, 0 or more. KWH blank is worked out from HP (× 0.746), as the form does. |
| Description | Free text. |
| Motor Status | Continue (default) or Discontinue. |
| Sourcing | Purchasable (Vendor) or Internal Manufacturing. **Blank means Purchasable**, the form's pre-selected choice (decision 4). |

**What's saved, as the form saves it:**
- type Product, productKind Motor, Category / Sub Category "Motor", Pieces
- the specifications list filled from Version / HP / KWH / RPM / Pole / Phase, which Quotation's price list reads

**Not in the file:** the image (uploaded on the motor), prices and stock.

## 3. Plant Master
**What the page has:**
- **Its own tree** in its Manage Classifications: Category → Sub Category → Plant Name → Production (Production optional).
- **A plant:** a path in that tree, the **machines (Product Master)** and **motors (Motor Master)** it's made of, each with a quantity, and a Status.
- **No code:** a plant has none.

**Sheet *Plants*, one row per plant:**

| Column | Rule |
|---|---|
| Plant Ref \* | Your own label for this plant in the file (P1, P2 …), unique in the file. It links the plant's rows on the next sheet; it isn't saved. |
| Category \*, Sub Category \*, Plant Name \* | The plant's place in the tree. A value the tree doesn't have yet is added under that row's own path (shown first), as in the Product Master import. |
| Production | Under that Plant Name (optional). A new one is added there. |
| Plant Status | Continue (default) or Discontinue. |

**Sheet *Machines & Motors*, one row per part of a plant:**

| Column | Rule |
|---|---|
| Plant Ref \* | A ref from the Plants sheet. |
| Item Code \* | A **Product Master machine** or a **Motor Master motor** of your company, not discontinued. The code says which one it is. |
| Quantity | A whole number, 1 or more (default 1). |

**Other sheets:**
- **How to fill**
- **Tree:** your current Category › Sub Category › Plant Name › Production paths
- **Items:** your machines and motors with their codes, to copy from

## 4. The checks (Plant Master)
- **The same plant twice:** the same Category + Sub Category + Plant Name + Production as an active plant, or another row, is refused (decision 1).
- **Parts must exist:**
  - a machine or motor must already exist; the plant file never creates one (decision 2), so import Product Master and Motor Master first
  - a discontinued one is refused (decision 2)
  - a code that is neither a machine nor a motor (e.g. a raw material) is refused
- **The same item twice in one plant** is refused (decision 3).
- **A plant with no parts is allowed,** as on the form.
- **Order of saving:** after the check passes, the new tree values are added (parents first, each linked to its parent), then the plants. If anything fails, everything this import added is taken back.

## 5. Your decisions (22 Nov)
1. **The same plant twice** (same Category / Sub Category / Plant Name / Production, active or in the file) is refused.
2. **Machines and motors in a plant must already exist,** by code. A discontinued one is refused.
3. **The same item twice in one plant** is refused.
4. **Motor sourcing left blank** means Purchasable (Vendor).

**Carried over from features 20–21:** check first, all or nothing, new records only, new list and tree values added and shown first, up to 1,000 rows per main sheet.

**Permissions:**
- Motor Master's import needs Motor Master "add", the page's own Add button permission.
- Plant Master's needs Plant Master "add", the same as saving a plant.
