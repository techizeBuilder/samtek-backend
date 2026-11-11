# Store's handover warns when it takes held stock (2026-11-03)

## Why
Found in the browser test. Dispatch counts all of a part's stock when deciding an outsource line is ready, including pieces held for another order. So one order could go out with stock held for another, and Store's handover said nothing. Store's normal transfer already warns in this case.

## What changed
When Store clicks **Hand over** and it would take stock reserved for an earlier order:
- Nothing moves yet. A box names the material, the quantity and the orders it's reserved for.
- **Go ahead** stays disabled for **3 seconds**, counting down, so the warning gets read. **Go back** works straight away and hands nothing over.
- If Store goes ahead, the trip's history records it.

It warns and never blocks, the same as the normal transfer, because physical stock can be wrong (your earlier decision).

Dispatch's ready check is unchanged. Making it stricter, and leaving this as it was, were the two options not chosen.

## Behaviour to know
- **Same rule as the normal transfer:** it counts reservations of orders that claimed the stock before this one. If there's enough stock beside what they hold, there's no warning.
- **Orders on the same line** don't warn about each other.
- **Sheets and lengths:** reservations are on the catalog size, so a picked offcut gives no warning.
- **Hand over all:** the box appears for each line that needs it. **Go back** stops there, and the lines already handed over stay handed over.
- **The server checks too:** without Store's confirmation it refuses and moves nothing, so a stale page can't skip the warning. The 3-second wait itself is on the screen only.

## Technical notes
`materialReservationService.heldBeyondOrders`, `dispatchTripService.heldStockWarnings` and `storeHandover` (`body.acknowledgeWarnings`; answers 409 with `data.confirmWarnings`), `dispatchTripController.postStoreHandover`, `OutsourceToDispatchTab.jsx` (`components/serials/useConfirmWarnings.jsx`). Later the same day this moved onto the shared warning flow, and shares one box with the serial warning: [no-serial-warning-2026-11.md](no-serial-warning-2026-11.md).

## Checked
11/11 on a made-up company through the real handlers, 0 left: part held for another Fan, own held stock, enough free stock, sheets, an offcut, two orders on one line. The page builds. Not yet clicked through in the browser, so the countdown itself hasn't been seen running. Cut pieces use the same check but have no test of their own.
