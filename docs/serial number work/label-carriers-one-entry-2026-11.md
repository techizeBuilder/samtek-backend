# Label carriers: one entry per part, with a sticker generator

*Built 5 November 2026, asked for at browser test step 9.*

## The problem

`/store/label-carriers` showed one entry per piece, and Store typed and saved one sticker at a time. A Chamber order for 20 meant 20 entries and 20 separate saves. The stickers are numbered and printed by the client, so typing each one was wasted work.

## What happens now

### Waiting for a sticker
There's one entry per part, with its count. **Label them** opens a table with one row per piece:

```
Chamber CP-002 · 2 waiting · from ORD-2026-102         Last sticker used: C-101
Prefix [C-]  From [102]  To [103]  [Fill 2]   [Fill what's inside]

Piece                Sticker   Test Sensor    Motor Mount
ORD-2026-102 unit 1  [C-102]   [STEST03 v]    [M-101 v]    Nothing inside
ORD-2026-102 unit 2  [C-103]   [STEST04 v]    [M-102 v]    Nothing inside
                                                          [Save 2 rows]
```

| Part of the screen | What it does |
|---|---|
| **Prefix / From / To → Fill** | The same range helper as receiving on `/store/purchases/requests`, with the same padding. It fills rows with no number, top to bottom, and leaves typed ones alone. Any number can still be typed by hand |
| **Last sticker used** | The newest number on this part, so Store knows where to carry on |
| **Fill what's inside** | A suggestion Store checks (your choice). It fills empty slots in list order, and anything already chosen stays. The screen says to read the nameplates and change any row that doesn't match |
| **Dropdowns** | One column per part inside. Something chosen on one row disappears from the other rows of that order. **+** adds one more when a piece holds more than usual |
| **Nothing inside** | Per row. That row needs no number |
| **Save** | Saves only rows with a number or Nothing inside. The rest keep waiting, so Store can do 5 today and 15 tomorrow |

**The usual count per piece** is what's available of that part ÷ the pieces of that order still waiting, rounded, and at least 1:

| Available | Pieces waiting | Usual count | Fill gives |
|---|---|---|---|
| 2 sensors | 2 | 1 | 1 each |
| 3 motors | 2 | 2 | 2 on the first, the 1 left on the second |

It's a hint, never a rule, as before. A row only needs at least one thing inside.

**One part from several orders** stays one entry, with the order on each row. A row can only hold what was issued to its own order. A repaired or returned piece already knows what it holds, so its row starts filled and offers only those.

### What Save checks
Everything is checked first. **If anything is wrong, nothing is saved,** and the message names every problem together:
- No sticker number on a row being saved.
- A number already used on this part, or on two rows of this list, in any case. The same number on a different part is still allowed, as before.
- The same serial or sticker on two rows.
- A row with nothing inside picked.
- Something no longer available, or from another order.
- A piece already done, or gone.

Each row then saves through the same code as before, so moves, history and the amber "left unpaired" warning are unchanged.

### Labelled and Nothing inside
One entry per part: *"Motor Mount · 2 stickers · 0 in stock · from ORD-2026-098, ORD-2026-101"*. **View** shows its stickers. Search still finds a part, order or sticker number, and filters the stickers inside the entry.

## Pagination
| Tab | Paged? | Why |
|---|---|---|
| **Waiting for a sticker** | No | An open-work queue, which empties as Store works; paging would split a part's pieces |
| **Labelled, Nothing inside** | Yes: 20 entries a page, in the database | These only grow |
| **Stickers inside an entry** | Yes: 20 a page, in the database | A part's stickers only grow |

## What didn't change
Existing stickers and their data; one number per part, retired ones included (D12); no sticker, no handover (D13); the pickers on Material Transfers; the bell.

**Noticed, not changed:** the bell goes out once per unit, so 20 Chambers finishing one by one would ring 20 times. It's a small change if you want it.

**Behaviour to know:** searching on the Waiting tab finds the entry, but its table still lists all that part's waiting pieces.

## Technical notes
- `services/serialTrailService.js`: `waitingForItem`, `labelCarriersBulk`.
- `controllers/partLabelController.js`: `listPartLabelGroups`, `getWaitingForItem`, `postPartLabelsBulk`; `listPartLabels` gains `item`.
- Routes: `GET /api/part-labels/groups`, `GET /api/part-labels/waiting/:itemId`, `POST /api/part-labels/bulk` (Store only).
- `pages/store/LabelCarriers.jsx`, `pages/store/labelCarrierFill.js`; `rangeOf` is now exported from `SerialNumbersInput.jsx`.
- The single-row `PUT /api/part-labels/:id` stays: the suites use it, the screen no longer does.

## Checked
- **New suite `labelbulk`:** 64 of 64, 0 left, on a made-up company with hand-worked values. It includes every refusal with nothing saved, partial save, pages, and a serial reading through two stickers to the customer. It runs the real fill code.
- **Regression:** `gb` 45, `heldcarrier` 15, `s2c` 17. Others skipped: nothing outside this page changed.
- **The page compiles.** Dev data read through the new code offers STEST03, STEST04, M-101 and M-102 for your 2 Chambers.
- **Not yet seen in the browser:** that is step 9 of the roadmap.
