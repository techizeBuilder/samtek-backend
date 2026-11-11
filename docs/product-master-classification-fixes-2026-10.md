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

## 6. A Sub Category with the same name under another Category had the other's lists (client bug, 2026-10-19)

**Where:** Product Master → Manage Classifications & Custom Fields, the product form's dropdowns,
and the same lists on Plant Master, Product Master QC and Store's Product Master tab.

**What the client saw:** they created a new Category, then a Sub Category called "Chakki" (a name
already used under another Category). The new "Chakki" already showed the other one's Product
Names and Variants, and adding the same Product Name was refused as "already exists".

**How it worked before:** each value remembered its parent by **name** only.
- **Shared lists:** every "Chakki", under any Category, showed one shared list of Product Names,
  Source Types and (through the Product Name) Variants.
- **Duplicate check:** done by name too, so the second "Chakki" couldn't have a Product Name the
  first already had.
- **Seen on our test data:** "Chakki" under Atta Chakki and Cleaning Machine shared "aata chakki
  5kg" and 3 Source Types; "Blower Pulverizer" under two Categories shared a Source Type.

**How it works now:** each value is linked to its **exact parent** (by its id, not its name).
- **Separate lists:** a Sub Category under a different Category is a different Sub Category, with
  its own Product Names, Variants and Source Types. The same goes for Plant Master: Sub Category →
  Plant Name → Production.
- **The same name is allowed under each parent;** only a repeat under the *same* parent is refused.
- **Renames are matched by the full path:** Category → Sub Category → Product Name → Variant. So
  renaming one "Chakki" (or a Variant under it) changes only the products, custom-field templates
  and lists of that branch; the other "Chakki" is untouched.
- **A delete is blocked only by that branch's own products or values.**

**Existing data (a one-time step):** a script links every existing value to its parent.
- **A shared name:** the first parent keeps the values, and every other same-named parent gets
  its **own copy**. Each one shows exactly what it showed before, but they're independent from now
  on.
- **Our test data:** 41 changes (6 copies: Cleaning Machine's "Chakki" got its own 3 Source Types,
  "aata chakki 5kg" and its "5kg" Variant; milling machine's "Blower Pulverizer" got its own
  Source Type). A second run changes nothing.

**Technical notes:**
- **`RDMasterOption.parentId`:** the unique index is now company + field + value + parentId +
  parentValue.
- **`rdController`:**
  - adding takes `parentId`. An older caller sending only a parent name is linked when that name
    is unique, and refused when several parents share it.
  - rename / delete check use `ancestorsOf` (the full path); the 17 Oct copy-on-rename logic is
    gone, because children never move.
- **New `scripts/linkClassificationParents.js`** (dry run by default; `--apply`; `--company`).
- **Frontend:** new `lib/classificationTree.js` (`childOptions`, `resolvePath`), used by
  `ProductMaster.jsx`, `PlantMaster.jsx`, `ProductMasterQC.jsx`, `ProductMasterTab.jsx`.

**Checks:** 20 tests through the real handlers and the real migration script on a made-up company,
0 left:
- **The bug shown first;** then the migration (9 links, 5 copies, index swapped, a re-run changes
  nothing).
- **Each "Chakki" has its own lists.**
- **The client's steps:** a new Category → "Chakki" has empty lists → the same Product Name can be
  added, not twice.
- **Old-style callers:** refused when ambiguous, linked when unique.
- **Variant, Sub Category, Source Type and Plant Name renames** touch only their branch; templates
  follow by path.
- **Delete checks:** only their branch.
- The frontend builds; no undefined names.

## 7. Power Source options can be deleted (client request, 2026-10-19)

**Where:** Product Master → Add / Edit product → Power Requirements → Power Source.

**Before:** a Power Source could be added (+) but not removed.

**Now:** each option in the list has a delete icon, the same as Metrology and Material Grade.
- It asks to confirm first.
- It's refused while a product still uses that Power Source.
- A row that had it selected is cleared.

**Checks:** the frontend builds; no undefined names. The server's existing delete check is used.

## 8. The Material Grade filter follows the Category / Sub Category (client request, 2026-10-19)

**Where:** Product Master's list, the Material Grade filter (added in §5).

**Before:** it always listed every Material Grade.

**Now:**
- **No Category chosen:** every grade, as before.
- **A Category (and Sub Category / Source Type) chosen:** only the grades its products actually
  use, in the same active or discontinued view as the list.
- **A grade picked earlier that isn't used there** is cleared.

**Technical notes:** new `GET /api/rd/machines/material-grades?pType=&category=&pSourceType=&discontinued=`
(`rdController.getMachineMaterialGrades`, the distinct grades of the matching products).

**Checks:** 13/13 on test-1's products (read-only): no Category → all grades in use; each
Category and each of its Sub Categories → exactly its products' grades; empty where the products
have none. The routes import; the frontend builds.

### Steps for the client's server (this change)
1. Deploy the backend and frontend together.
2. On the server, from the `server` folder:
   `node scripts/linkClassificationParents.js` — a dry run. It lists, per company, how many
   values it will link and which shared names get copies.
3. If the list looks right: `node scripts/linkClassificationParents.js --apply`.
4. Run step 2 again. It must say **"0 change(s) planned"**.

Until step 3, the lists behave as before. The script uses `MONGODB_URI` from `server/.env`.

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
| 7 | Power Source options can be deleted (confirm; refused while a product uses it) | Done; builds; check in the browser |
| 8 | Material Grade filter lists only the grades used in the chosen Category / Sub Category (all grades when none is chosen) | Done; 13 checks; builds; check in the browser |
| 6 | Same-named Sub Category under another Category has its own Product Names / Variants / Source Types (values linked to their exact parent; same for Plant Master); renames / delete checks by the full path; one-time script for existing data | Done; 20 tests; test data migrated (41 changes); **client server migrated 2026-10-19** (496 changes, 0 orphans; final dry run and browser checks done ✓) |
