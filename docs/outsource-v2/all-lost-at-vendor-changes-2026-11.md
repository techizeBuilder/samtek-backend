# Everything lost at the vendor, and refund or credit on outsource: what changed

*Built 4 November 2026. Logic: [all-lost-at-vendor-logic-2026-11.md](all-lost-at-vendor-logic-2026-11.md). Unit-tested. The write-off passed in the browser on OSO-0028; refund and credit are unit-tested only.*

## Why

Purchase couldn't write off every piece on a trip. The message said to cancel or re-order, but an order that has been sent can't be cancelled. A trip of 1 piece could never be written off, so its serial, order, bill and reservations stayed stuck. Outsource also had no refund or credit: money above the bill stayed with the vendor with no record.

## What you'll see now

### Writing off everything on a trip

**Where:** Purchase → Outsource Orders → open the order → **Not coming**.

With nothing back from the trip:

| Thing | What happens |
|---|---|
| **Serial** | Reads **Lost at <vendor> (OSO-…)**, not on Defective Inventory |
| **Production order** | **Completed**, marked **"All lost at the vendor: 0 made"**. Plan button gone; later steps never run |
| **Replacement** | An order built for a parent gets a new order for the lost pieces. A low-stock order doesn't |
| **Outsource Order** | **Received**, with the line reading **"0 back, n not coming"** |
| **Bill** | The value comes off as "lost at vendor", and the bill stops waiting |
| **Reservations** | Released |
| **QC, stock, part cost** | No QC job, no stock, part cost left alone |

**A rework resend is different.** If other pieces already passed QC, the resend closes, its pieces count as scrap, and the batch carries on. If that was the last step, the order finishes normally.

Still refused: no reason, more pieces than are with the vendor, and Child Part or Machine units.

### Refund or credit, in three places

Whenever an outsource bill drops below what was paid, the difference goes to **Vendor Payment → Refunds & credits**, marked **To decide**. Accounts picks **Vendor refunds it** or **Keep as credit**, the same as a cancelled PO.

| Case | Before | Now |
|---|---|---|
| Lost at the vendor | Refused or stuck | Amount above the bill is To decide |
| QC rejects the work | The vendor kept the extra with no record | Amount above the bill is To decide |
| Cancel with an advance paid | Refused for good | Order and bill cancelled, whole amount To decide |

| Order | Paid | What happens | Bill after | Result |
|---|---|---|---|---|
| ₹50, 20% advance | ₹10 | All lost | ₹0 | ₹10 To decide |
| ₹150 on two lines, 20% advance | ₹30 | One ₹50 line lost | ₹100 | Nothing moves |
| ₹100, 20% advance | ₹20 | QC rejects all | ₹0 | ₹20 To decide |
| ₹100 + ₹20 charges, advance ₹30 | ₹30 | QC rejects all | ₹20 | ₹10 To decide; ₹20 pays the charges |
| ₹100 on 2 pieces, 20% advance | ₹20 | QC rejects 1 | ₹50 | Nothing moves |
| ₹100, 20% advance | ₹20 | Cancelled before sending | Cancelled | ₹20 To decide |

An advance not yet paid no longer stays due on a bill that dropped below it.

## What didn't change

- Partial write-offs, QC's rework and replacement orders, and the vendor score.
- Cancelling after anything has gone out is still refused.
- Outsource still has no "vendor refused" answer, so this money can't be written off as a loss from here.
- A per-minute or per-hour line waiting for its time keeps its bill undecided until the time is entered.

## Tested

- **New suite `alllost`, 50 of 50:** full loss on a production order, a low-stock order and a job-work order; 1 lost then the rest; rework resends; refusals; every row of the table above; Refund and Credit ledger entries; part cost untouched.
- **Regression, 16 suites, 436 checks, all pass:** `partial-3a`, `partial-3b`, `partial-3c`, `rework-lost`, `scrap-replacement`, `slice3`, `slice4-cost`, `slice6`, `slice7`, `jobwork-qc`, `ga`, `gb`, `gc`, `chk`, `nosel`, `s2b`.
- **Two old checks removed on purpose,** because they tested the old refusals: `partial-3b` (all with nothing back) and `slice3` (cancel after an advance).
- **Screens:** the write-off screens seen in the browser on 4 Nov. The cancel note and the Refunds & credits row are compiled only.

## Technical

- `services/dispatchTripService.js`: `markNotComing` no longer refuses; new `closeWhollyLost`.
- `services/outsourceBillService.js`: `moveExcessToMoneyBack`, `outsourceMoneyBack`; `cancelOutsourceBill` no longer refuses.
- `services/partCostService.js`: no cost push on `closedAllLost`.
- `models`: `closedAllLost` on `ProductionOrder` and `SubChildPartJobWorkOrder`; `VendorMoneyBack` source `Outsource` and `outsourceOrder`.
- Screens: `OutsourceOrdersView.jsx`, `OrderManagement.jsx`, `ProcessExecution.jsx`, `VendorMoneyBackList.jsx`.
