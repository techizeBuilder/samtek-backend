# R&D item codes: the other forms checked and fixed

*16 November 2026, after the Product Master code bug ([product-master-code-bug-2026-11.md](product-master-code-bug-2026-11.md)). Your ask: check Inventory, the product forms and BOM for the same kind of problem, and make sure no form can save the same item twice.*

## What I found
| Form | Its code | Duplicate check on the server | Error shown? | Problem |
|---|---|---|---|---|
| Product Master | first letters of the name | fixed earlier | fixed earlier | fixed earlier |
| **Inventory** (and **Motor Master**, same save) | Generate = first letter of each word + the name's digits | this company only, exact case | yes | Generate gives the same code to many items: on dev, "BOLT" and "BEARING" are both **B**, "SHEET" is **S** (12 clashes in 89 items). Editing an item into another item's name + category + type wasn't checked. |
| **Child Part** (BOM) | count of Child Parts + 1 (CP-006) | this company only, exact case | yes | Clashes after a deleted part, a hand-typed code, two people at once, or in a second company. No rule against the same Child Part twice. |
| **Sub Child Part** (BOM) | count + 1 (SCP-010) | this company only, exact case | yes | Same as Child Part. |
| **Fabrication Master** | highest number + 1, every company, also checks Inventory | global | yes | **None.** Left as is. |

**One thing behind all of them:** an item code is unique across the **whole database** (every company, discontinued items too). The forms checked only their own company, in exact letter case. A code held elsewhere passed the check, then failed in the database with an unreadable error.

## What changed
### All of them
- **One shared check** (`services/itemCodeService.js`), used by Product Master, Inventory / Motor, Child Part and Sub Child Part.
  - A code is taken if any item anywhere has it, in any letter case.
  - The message says who has it: *"…is already used by "Bolt M8""*, *"…belongs to the discontinued item…"*, or for another company's item *"…is already used. Codes must be unique: choose another."* (its name is never shown).
- **If two people save the same code at the same moment,** the database refusal comes back as a readable message, not a raw error.

### Inventory and Motor Master
- **Generate** keeps a word with a digit whole (a size): **"Sheet 8x16" gives S8X16** (it was S816, the same as "Steel 8x16"). If that code is taken by any item, it suggests **S8X16-2**, then -3, with an amber note saying so.
- **The same item twice:** Add already refused the same **name + category + type**. **Edit now refuses it too**, when a rename or a move to another category or type would copy another item.
  - An item that already has a twin (older data) can still be edited for anything else.

### Child Part and Sub Child Part
- **The next code** is one more than the **highest number any item has** under CP- / SCP-, in every company. It was count + 1. Like Fabrication.
- **The same part twice:** a second **active Child Part with the same name** is refused on Add and on rename: *"A Child Part named "Fan" already exists (code CP-004). Edit that one instead."* The same for Sub Child Parts.
  - Letter case and spaces don't matter.
  - A **discontinued** part doesn't block a new one with its name.
  - **Old per-machine Child Parts** (made before the Child Part Master, and not in it) don't block: their names repeat across machines on purpose.
- **Codes can't be changed after creation** in these two forms (as before), so only the name is checked on Edit.

### Reactivating (your question, 16 Nov)
- **The same code can never come back.** A discontinued item keeps its code: nobody else can take it, and the database enforces that too. So reactivating it never clashes on the code.
- **The same item could, before this fix:**
  1. An old item is discontinued.
  2. A new one is created with its name (allowed: a discontinued item doesn't block).
  3. The old one is reactivated: two active twins.
- **Now Reactivate is refused while the same item is active:** *"Can't reactivate: "Aata machine 6x12" is already active as AM6X12-2, the same item. Discontinue that one first, or edit one of them."*
  - It uses the same rule as Add and Edit for each form: Product Master's four choices; Inventory / Motor's name + category + type; Child Part's and Sub Child Part's name.
  - It covers every way an item is reactivated: Product Master's Reactivate button, and the Inventory, Motor, Child Part and Sub Child Part toggles (and the Inventory edit form's Continue).
  - Discontinuing is never blocked. Reactivating with a new name in the same save is allowed. An old per-machine Child Part reactivates freely.
- **Product Master's Reactivate and Discontinue buttons now show a refusal.** They had no error message at all, so a refused reactivation would have looked like nothing happened.

## Not changed
- Fabrication Master: already right.
- Codes and names already saved: nothing is renamed or blocked. Only new saves and edits that change the name, category or type are checked.

## Technical notes
- **New `services/itemCodeService.js`:** `findCodeHolder`, `codeTakenMessage`, `freeCode`, `nextSequentialCode`, `exactRe`, `duplicateKeyMessage`.
- **`inventoryController.js`:**
  - `createItem`: the global code check; a readable duplicate-key reply
  - `updateItem`: the global code check, plus the same-item check when name / category / type change
  - new `getFreeItemCode`, `GET /api/items/free-code?base=`
- **`childPartBOMController.js` / `subChildPartMasterController.js`:** `nextSequentialCode('CP' | 'SCP')`; `sameNameChildPart` / `sameNameSubChildPart` on create and rename; the global code check; readable duplicate-key replies.
- **`rdController.js` (Product Master)** now uses the shared lookup; its messages are unchanged.
- **Client, `components/inventory/SimpleInventoryForm.jsx`:** the new `suggestItemCode` and its note.

## Tests
- **New suite `rdcodes`: 36 of 36 (28, then 8 for reactivating),** through the real server on made-up companies:
  - **Inventory:** free code, -2, any case, another company; duplicate codes refused (case, another company's, not naming its item); the same item refused on Add and on Edit (move into another category); an item keeping its own code and name saves.
  - **Child Part / Sub Child Part:** the next code is above every existing number, even another company's; codes refused in any case; the same name under a new code refused; rename into an existing name refused; keeping its own name saves; an old per-machine Child Part doesn't block; a discontinued one doesn't block.
- **Product Master's `prodcode`: 43 of 43** (39, then 4 for its Reactivate button).
- **Regression, all passing:** `makebuy-s1` 17, `makebuy-s2` 19, `fabsync` 32, `partprice` 20, `machinestock` 69, `p1-operations` 12, `s2a` 17, `ba` 23. `ba` was changed for the new rule: two of its edits renamed a fresh Sub Child Part to an existing one's name, which is now refused; they keep their own name now. The old copy is `ba-test.pre-samename.bak` in the kit.

## Browser check
1. **Inventory → Add Item:** name `Sheet 8x16` → **Generate**.
   - [ ] **S8X16** (or S8X16-2 if taken, with the note).
2. Add a second item with the **same name, category and type** under another code.
   - [ ] Refused: *"Duplicate item detected…"*
3. **Edit** an item and change its name to another item's (same category and type).
   - [ ] Refused.
4. **BOM Management → Child Part → Add.**
   - [ ] The code is one more than the highest CP- number.
5. Give it the name of an existing Child Part.
   - [ ] Refused: *"A Child Part named … already exists (code …)"*.
6. **Repeat 4 and 5 on Sub Child Part.**
7. **Reactivate:** discontinue an item, create a new one with its name (or its four choices in Product Master), then **Reactivate** the old one.
   - [ ] Refused with *"Can't reactivate: … is already active as …"*.
8. Discontinue the new one, then reactivate the old one.
   - [ ] It works.

## Found in your screen check (16 Nov): Inventory let the same item be saved twice
- **What you saw:** "Sheet 8x16" was saved twice, as S8X16 and S8X16-2.
- **Why:** Inventory's Add check, which already existed, compared a `category` field the form never sends (its "Item Type" is stored as `itemType`). It looked for items with *no* category, never matched the stored empty one, and let the second item through. My Edit check from earlier the same day had the same flaw, and the suite missed it because its test items sent a category the real form doesn't.
- **Now:** an Inventory / Motor item is the same as another when it has the **same name, the same Item Type and the same record type**, in the company. An empty value counts as equal to an empty or missing one.
  - **One shared rule** (`inventoryTwinQuery`) for Add, Edit and Reactivate.
  - **Message:** *"Duplicate item detected! Item "Sheet 8x16" already exists as Item Type "Fabrication item" (Code: S8X16). Edit that one instead."*
  - **A discontinued item no longer blocks a new one with its name**, the same as the other forms. Reactivating the old one is refused while the new one is active.
- **Tests:** `rdcodes` 38. Its Inventory items now look like the real form's (no category, an Item Type), plus the discontinued case. Re-run: `fabsync` 32, `machinestock` 69, `makebuy-s1` 17, `s2a` 17, `prodcode` 43.
- **The two "Sheet 8x16" you made** stay as they are (nothing already saved is changed). Discontinue or delete S8X16-2 if you like.
- **Re-test (16 Nov):** both refused, as they should be: no duplicate saved. But the toast said only **"Failed to save item"**.
  - **Why:** the Inventory form read the reason from `error.response.data.message`, a shape this app's requests never use (they put it in `error.message`). So every refusal on that form showed the generic text, and it covered the list page's own, correct toast.
  - **Fixed:** the toast now shows the reason, e.g. *"Duplicate item detected! Item "Sheet 8x16" already exists as Item Type "Fabrication item" (Code: S8X16). Edit that one instead."* It stays up 10 seconds.
  - **The same mistake** was in the fabrication weight calculator (Inventory form) and the Sub Child Part sheet plan (upload and save), so they also showed only generic text. Fixed the same way.
- **Screen check passed (16 Nov):**
  - **Step 1:** Generate gave S8X16, then S8X16-2 with the note.
  - **Step 2 (Add):** refused with *"Duplicate item detected! Item "Sheet 8x16" already exists as Item Type "Fabrication item" (Code: S8X16-2). Edit that one instead."*
  - **Step 3 (Edit):** renaming into it refused with *"Duplicate item: …"*.
  - **Step 4 (Child Part):** the code came up as CP-006; the name "Fan" refused: *"A Child Part named "Fan" already exists (code CP-001). Edit that one instead."*
  - **Step 5 (Sub Child Part):** the code came up as SCP-010; "Fan Blade" refused, naming FB-01.
  - **Step 6 (Reactivate):** with "Sheet 8x20" discontinued and a new one active as S8X20-2, reactivating the old one was refused: *"Can't reactivate: "Sheet 8x20" is already active as S8X20-2, the same item. Discontinue that one first, or edit one of them."*
  - **Step 7:** with the twin discontinued, the old one reactivated.
  - **The whole check passed, 16 Nov.**
