# Feature 22: Motor Master and Plant Master bulk import (browser test)

*On test-1, as R&D Head. What changed: [22-motor-plant-import-changes.md](22-motor-plant-import-changes.md). The suites `motorimport` (23) and `plantimport` (28) already check the rules; this is about the screens and real files. Use codes nobody has, e.g. starting `BT-` plus today's date.*

## 0. Motor Master permission (the fix)
1. In Roles & Permissions, give a test user **only Motor Master** (view, add, edit) and no Inventory permission. Log in as them.
2. Motor Master → **Add Motor** → fill it, upload an image → **Save**. It saves. Before the fix this said "Access denied".
3. Edit it, then Discontinue and Reactivate it: all work.

## 1. Motors
1. Motor Master → **Bulk Import** → **Download template**.
   - *Motors* has 16 columns.
   - *Lists* shows your Motor Types.
2. Fill 2 rows:
   - **Motor 1:** an existing Motor Type typed in small letters, HP 5, KWH blank, Sourcing blank
   - **Motor 2:** a **new** Motor Type, HP 10, KWH 7.5, Sourcing "Internal Manufacturing"
3. **Check file:**
   - *"Ready: 2 motors (1 new Motor Type)"*
   - the yellow box names the new type (row 3); the small-letters one isn't listed
4. **Import.** Then:
   - Motor 1's View: HP 5, **KWH 3.73**, Purchasable, Pieces
   - Motor 2: Internal Manufacturing; the Add Motor form's Motor Type list now has the new type
5. **Check the same file again:** both codes are refused.

## 2. Plants (after section 1)
1. Plant Master → **Bulk Import** → **Download template**.
   - *Tree* shows your plant paths.
   - *Items* lists your machines and motors, including the 2 new motors.
2. **On *Plants*:**
   - **P1:** an existing Category / Sub Category / Plant Name with a **new Production** (e.g. 750 kg/hr)
   - **P2:** an existing Category with a **new Sub Category and Plant Name**
3. **On *Machines & Motors*:**
   - **P1:** an existing machine × 2, and Motor 1 × 3
   - **P2:** Motor 2, Quantity blank
4. **Check file:** *"Ready: 2 plants (… new tree values)"*, with the new Production and the new Sub Category / Plant Name shown *under* their paths.
5. **Import.** Then:
   - **P1's View:** the machine × 2 and the motor × 3
   - **P2:** Motor 2 × 1
   - **Manage Classifications:** the new values under the right parents
6. **A quotation:** P1 and P2 appear in the plant picker.

## 3. Mistakes
Upload a plant file with:
- the same plant as P1 again
- a discontinued machine
- a raw-material code
- the same motor twice in one plant
- a part row whose Plant Ref isn't on *Plants*

→ every problem is listed with its **sheet**, row and column, and nothing is imported.

## Log
| Step | Result | Notes |
|---|---|---|
| 1. Motors | PASSED 23 Nov | my file "6 Motor Master - 6 motors": "Ready: 6 motors (2 new Motor Types)", Gear Motor counted once; KWH worked out (3.73, 1.49, 0.75, 2.24); blank sourcing = Purchasable; imported |
| 1. Motor mistakes | PASSED 23 Nov | "7 Motor Master - mistakes": 9 problems in 12 rows, no Import button |
| 2. Plants | PASSED 23 Nov | "8 Plant Master - 5 plants": "Ready: 5 plants (11 new tree values)", each under its path; blank quantity = 1; a plant with no parts; imported |
| 3. Plant mistakes | PASSED 23 Nov | "9 Plant Master - mistakes": 13 problems across both sheets, incl. the discontinued BT Motor 3HP Old; no Import button |
| 0. Motor permission | not run | covered by the `motorsave` suite (11 of 11) |
| Cleanup | DONE 23 Nov | 6 motors, 5 plants and 13 Motor Type / plant-tree values deleted; test-1 back to 39 items / 63 values / 1 plant |
