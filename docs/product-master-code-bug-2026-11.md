# Product Master: the Product Code bug (what was wrong, what changed)

*16 November 2026. Reported by the client with their real, large data: the Generate button gave the same code for different products, and saving with that code showed no error and added nothing. Typing a code by hand worked.*

## What was wrong: three causes
1. **The generator made codes that clash.**
   - It used the first letter of each Name word, plus Metrology, plus the digits of Variant.
   - "Aata machine 6x10" and "Aata machine 6x12" both gave **AM6**, because only the first letter of "6x10" counted. "Impact Pulverizer" and "Industrial Pulverizer" both gave **IPMS612**.
   - It never checked the codes that already exist.
   - In dev there were few products with varied names, so it never showed. (The Manage Classifications list is not involved.)
2. **The page hid the refusal.**
   - The server did refuse the duplicate, with a message.
   - The dialog closed and cleared the form before the reply came back, and the save had no error handling. So there was no message, no new item, and the typed data was lost.
3. **The duplicate check looked in the wrong place.**
   - A product code is unique across the **whole database**: every company, and discontinued products too.
   - The check looked only at this company's active products. A code held by a **discontinued product** (likely with a large catalogue) passed the check and was then refused by the database.
   - Editing a product and changing its code to one in use wasn't checked at all.

## What changed
- **Generate** (your idea): a Name word that contains a digit is kept whole, in capitals. **"Aata machine 6x12" gives AM6X12** and "6x10" gives AM6X10. Variant still adds its digits, so existing styles like IPMS612 stay the same.
- **If the code is taken,** the server finds the next free one: **AM6X12-2**, AM6X12-3 … A small amber note says so: *"AM6X12 is already used, so AM6X12-2 was suggested."* It checks the whole database, so what it suggests is really free.
- **Add and Edit now keep the dialog open when the save is refused,** with the server's message in red and everything you typed still there. The button reads "Saving…" meanwhile.
- **The server refuses a duplicate on Add and on Edit,** ignoring upper / lower case and spaces ("am6" = "AM6"). Editing a product without changing its own code works as before.
- **The messages say what's wrong:**
  - *Product Code "X" is already used by "Name". Codes must be unique.*
  - *…belongs to the discontinued product "Name". Reactivate it, or choose another code.*
  - *…is already used. Codes must be unique: choose another.* (another company's product; its name is never shown)
- **A code with stray spaces is saved trimmed.**

## Found in your screen check: the same product could now be saved twice
- **The gap, caused by the fix above:** the old clashing code had been stopping the same product from being saved twice, by accident. Once Generate always found a free code (AM6X12, then AM6X12-2), the same product could be saved again under a new code.
- **Also seen:** a size already in the Name was repeated from the Variant (**AM6X12612**). The Variant's digits are now left out when the Name already has them: **AM6X12**.
- **The rule now (server, Add and Edit):** a product is its **Category, Sub Category, Name and Variant**, the four choices at the top of the form. A second active product with the same four is refused: *This product already exists as "Aata machine 6x12" (code AM6X12): same Category, Sub Category, Name and Variant. Edit that one instead.*
  - Letter case and spaces don't matter.
  - **Source Type isn't part of it** (it's how the product is sourced, not what it is). Say if you want it included.
  - **A discontinued product doesn't block** a new one with the same four: it's a past version.
  - **Edit checks only when one of the four changes.** A product that already has a twin (from older data) can still be edited for anything else.
- **Generate also warns early:** if the product exists, it doesn't fill a code; it says so in red under the field.
- **Why not "show only free options" in the dropdowns:** the rule on the server covers Add, Edit, two people saving at once and anything else that calls it. The dropdowns alone would not.
- **Existing data:** dev has no such duplicates. The client's real data may; nothing is changed or blocked for products already saved.

## Not changed
Codes already saved, and every other master (Child Part, Sub Child Part, Fabrication) with its own generator.

## Technical notes
- **Server, `rdController.js`:** `findItemByCode` (case-insensitive, all companies, discontinued included) and `codeTakenMessage`; `createMachine` and `updateMachine` use them; `updateMachine` also answers a duplicate-key error with a message. New `getFreeProductCode`, `GET /api/rd/machines/free-code?base=` (`rdRoutes.js`).
- **Client:** `RDContext.jsx` `addMachine` / `updateMachine` return the promise (`mutateAsync`). `ProductMaster.jsx`: `handleAdd` / `handleEdit` wait for the server, `saveError` and `codeNote`, and the new `suggestProductCode`.

## Tests
- **New suite `prodcode`: 39 of 39 (22 for the code, 17 for the same-product rule and the Edit form),** through the real server on made-up companies: the free-code route (base, -2, -3, another company, discontinued, case), Add and Edit refused for an exact, a different-case and a spaced code, the three messages, trimming, an edit that keeps its own code; and the same-product rule (a different code, case and spaces, Variant / Category / Sub Category making it a different product, Source Type alone not, discontinued, Edit, an existing twin, the early warning).
- **The generator** on the example names: AM6X10, AM6X12, AM12X12, AM610 (variant), IPMS612, IP6X12MS.
- **The page compiles.** A screen check is next.

## Browser check
1. **R&D → Product Master → Add Item.** Name `Aata machine 6x12` → **Generate**.
   - [ ] The code is **AM6X12**.
2. Create it. Add another item named `Aata machine 6x12` → **Generate**.
   - [ ] **AM6X12-2**, with the amber note.
3. Type **am6x12** by hand and **Create**.
   - [ ] The dialog stays open, a red message names the first product, and nothing you typed is lost.
4. **Edit** that second item and set its code to **AM6X12**.
   - [ ] Refused with the red message.
5. Open an item and **Save Changes** without touching the code.
   - [ ] It saves.
6. Pick **the same four choices as an existing product** (Category, Sub Category, Name, Variant) → **Generate**.
   - [ ] A red note says the product already exists, and no code is filled.
7. Type a new code by hand and **Create**.
   - [ ] Refused: *"This product already exists as …"*, the dialog stays open.

## Browser check
**Passed, checked by you on screen (16 Nov):** Generate gives AM6X12 / AM6X10 (e.g. "Aata machine 6x10" with variant 6x10 gives AM6X10, no repeated size); a taken code gives the -2 suggestion with the amber note; a refused save keeps the dialog and shows the message; an existing product (same four choices) is warned about and refused on Add and Edit; Generate in the Edit form works.
