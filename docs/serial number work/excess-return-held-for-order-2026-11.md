# An Excess return stays held for its order: what changed

*Built 4 November 2026, found in browser test step 3.9.*

## The problem

When Production returned something as Excess, it went into stock as free stock, while the same order's Material List asked Store for it again. Until Store transferred it, another order could reserve that piece, and the first order would be left short.

A Defect return already reserved for the order. Excess didn't.

## What happens now

Once Store accepts the return, **only what the order still needs is reserved for it**: its need minus what it holds after the return. It shows on `/store/reservations`.

**In practice that's everything returned.** Store can't transfer more than was requested (the transfer screen refuses it), so an Excess return always leaves the order short and its row asks Store again. The code still leaves anything above the need as free stock, as a safety net. The table's "holds 7" rows can't come from the screen. *(Corrected the same day, at your review: the first version reserved everything that came back, with no limit. Plain materials were added the same day, your decision.)*

| Needs | Holds | Returns | Row afterwards | Reserved again | Free stock |
|---|---|---|---|---|---|
| 2 | 2 | 1 | 1/2 Requested | 1 | +0 |
| 6 | 7 | 1 | 6/6 Issued | 0 | +1 |
| 6 | 7 | 3 | 4/6 Requested | 2 | +1 |

| Returned part | Reservation |
|---|---|
| **Delivered by its build order** (no sticker) | A new claim for what's reserved again |
| **Picked by its sticker, or issued from stock** | Its own row re-opens, with issued down by what's reserved again |
| **Picked before this change, with no row** | A new claim |
| **A plain material** (NUT Bolts, Tool-A, Test Motor) | Its own row re-opens, as above; with no row, a new claim. A serial goes back In stock |

**Example: 1 of 2 Chambers returned as Excess**

| | In stock | Reserved | Issued | Still to issue | Free |
|---|---|---|---|---|---|
| **Before this change** | 1 | 0 | 0 | 0 | **1** |
| **Now** | 1 | 1 | 0 | 1 | **0** |
| **After Store transfers it** | 0 | 1 | 1 | 0 | 0 |

A new order needing a Chamber now sees it as not free, and its shortage raises a build order.

## What didn't change

- **Fabrication (sheet and length):** its Excess is stored as a measured leftover size, not the catalog size it was reserved on, so it stays free stock.
- Defect returns.
- A return Store rejects: no stock, no claim.
- A Completed order holds nothing.

## Tested

- **New suite `excesshold`, 22 of 22:** the tables above, a rival order refused, and the cases that didn't change. The "holds 7" cases start from data set up in the test, not a real over-transfer.
- **Regression on the corrected code, all pass:** `ga` 45, `gb` 45, `matused` 40, `s2b` 18, `heldcarrier` 15, `nosel` 46. These include every other suite that uses returns. An earlier run of `gb` lost its database connection partway; it has passed on every run since.
- **Browser:** not seen on screen. No step in the test returns another part as Excess yet.

## Technical

`controllers/inventoryController.js`, `confirmReturn`, Excess branch: hold = min(returned, need − held after the return); `recordReturn` for what was on the ledger, `reserveForOrder` for the rest.
