# What changed — Product Master classifications (client bug, 2026-10-17)

The client found this on their server: a product's Variant was changed in **Manage
Classifications & Custom Fields**, the product was then saved, but its view kept showing the old
Variant. Checking every field in that dialog found 4 problems. All are fixed and tested; they still
need checking in the browser. Also added: a Material Grade filter on the product list (client
request, §5).

---

## 1. Renaming a Variant didn't reach the products

**Where:** R&D → Product Master → Manage Classifications & Custom Fields → Variant column.

**How it worked before:** renaming a value in the dialog is meant to rename it on every product
that uses it, and it does for Category, Sub Category, Product Name, Product Source Type,
Metrology, Material Grade and Power Source. For **Variant** it wrote to the wrong place in the
product record, so **no product changed**. Example: PRO-0014 kept "3 in 1" after the Variant was
renamed to "3 in 2".

**How it works now:** renaming a Variant renames it on the products under that Product Name.

---

## 2. The edit form showed a value the product didn't have

**Where:** Product Master → Edit product (Category, Sub Category, Product Name, Variant, Product
Source Type), and Plant Master → Edit plant.

**How it worked before:** when a product's saved value was no longer in the dropdown list (renamed
or removed), the dropdown **silently showed the first value of the list instead**. On PRO-0014 it
showed "3 in 2" while the product still held "3 in 1":
- Saving sent "3 in 1" back unchanged, so the view still said "3 in 1".
- Picking "3 in 2" again did nothing, because the dropdown already showed it as picked.

That's why hard refreshes and re-selecting didn't help.

**How it works now:** the dropdown shows the real saved value, marked **"3 in 1 (no longer in the
list)"**. Pick the right value and save, and the product changes.

---

## 3. A rename could change products in other branches

**Where:** the same dialog, for every value that sits under a parent: Sub Category, Product Source
Type, Product Name, Variant. Also Plant Master's Sub Category, Plant Name and Production, and
Motor Master's Sub Category.

**How it worked before:** the same text often appears under several parents. In our data "In House
Manufacturing" is a Source Type under 6 Sub Categories, and "Purchase Machine" under 3. A rename
under one parent changed **every product with that text**, under every parent. Those products
then held a value their own list didn't have, which is problem 2 again.

The same mix-up affected two other places:
- **Delete:** deleting a value was refused when a product under a **different** parent used the
  same text.
- **Sub Category rename:** its Source Types and Product Names were **moved** to the new name,
  taking them away from a Sub Category of the same name under another Category.

**How it works now:**
- A rename changes only the products under that value's own parent.
- A delete is refused only when a product under that parent uses it.
- When the old name still exists under another parent, its child values are **copied** to the
  new name instead of moved.

---

## 4. Renaming a custom field lost or hid product values

**Where:** the same dialog → Field Groups (the extra fields for a Category / Sub Category /
Source Type combination).

**How it worked before:** a product stores each custom value under the group and field **name**.
After renaming a field (e.g. "HP" → "Power (HP)") or a group:
- the product's view still showed the old name
- the next edit of the product **blanked the value**, because it was looked up under the new name

**How it works now:** renaming a group or field renames it on that combination's products too, and
the values stay. Removing a field and adding a new one is still a new, empty field.

---

## 5. Material Grade filter on the product list (client request)

**Where:** R&D → Product Master, the filter row under the search box.

**Before:** the list could be filtered by Category → Sub Category → Product Source Type, but not by
Material Grade, although every product has one on its form.

**Now:** a **Material Grade** dropdown sits beside the classification filters:
- It lists the same grades as the product form.
- It works on its own or together with the Category filters and the search.
- **Clear** resets it too, and the list goes back to page 1 when it changes.

**Checks:** 5 tests on the real list endpoint (all, one grade, another grade, grade + Category, a
grade nobody has); the frontend builds.

---

## For the client's server

The fixes stop this happening again. **Products already affected keep their old values** until
edited once: open the product, and any value shown as "(no longer in the list)" can be picked
again and saved. That covers PRO-0014's Variant and any product hit by a cross-branch rename
(problem 3).

**Technical notes:**
- **Backend `controllers/rdController.js`:**
  - the Variant rename writes `machineDetails.variant`
  - renames and delete checks are scoped by the parent column (`itemQueryForOption`,
    `plantQueryForOption`)
  - shared child options are copied, not moved (`valueUsedUnderAnotherParent`)
  - templates are scoped by parent
  - the legacy single Power Source field is renamed too
  - template save keeps group / field ids and carries renames to products (`customFieldRenames`)
- **Frontend:**
  - `ProductMaster.jsx`: the stale value is shown; template ids are kept
  - `PlantMaster.jsx`: the stale value is shown; the plant list refetches after a rename
  - `RDContext.jsx`: products refetch after a template save

**Checks:** 26 tests through the real rename / delete / template-save handlers on a made-up company
(0 left), including:
- the Variant rename
- a Source Type renamed under one Sub Category only
- a Sub Category of the same name under two Categories
- delete checks
- Power Source
- a field and group rename, two names swapped, and a save from an older page
- Plant Master

The frontend builds, with no undefined names.

---

## Quick summary

| # | Change | Status |
|---|--------|--------|
| 1 | Renaming a Variant now renames it on the products (it changed none) | Done; tested; check in the browser |
| 2 | Edit forms show a saved value that's no longer in the list as "… (no longer in the list)" instead of silently showing another value (Product Master, Plant Master) | Done; builds; check in the browser |
| 3 | Renames and delete checks only touch products under the value's own parent; shared child values are copied, not moved (Product, Plant and Motor Master) | Done; tested |
| 4 | Renaming a custom field or group carries over to products; values no longer blanked on the next edit | Done; tested; check in the browser |
| 5 | Material Grade filter on the Product Master list (client request) | Done; 5 tests; builds; check in the browser |
