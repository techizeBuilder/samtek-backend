# Bulk Transfer isn't up to date (open, 2026-11-03)

**Status:** not changed yet. You'll check it later and then decide. Until then, use the normal **Transfer** button on each row.

Found while reaching step 2.10 of the browser test. This comes from reading the code. Bulk Transfer wasn't clicked in the browser.

## What it is
The **Bulk Transfer Card** button on Store → Material Handshake → Pending Transfers. It sends every requested line of one order to Production in one click.

Server: `bulkTransferOrderMaterials` in `controllers/inventoryController.js`. Screen: `PendingRequestsTab.jsx`.

## Already up to date
- Skips lines with serial numbers or stickers in stock, and tells Store to use the Transfer button.
- Skips fabrication lines, because Store has to pick a size.
- Records the issue on the order's reservation.
- Writes the transfer log.

## Not up to date

| Gap | Normal Transfer | Bulk Transfer | What goes wrong |
|---|---|---|---|
| **Issued To** | Required | Not asked | No record of who received the material |
| **Stock reserved for an earlier order** | Warns | No warning | One order takes another order's stock and nobody is told. Store's handover to Dispatch now warns about this, so Bulk Transfer is the gap left |
| **Message when lines are skipped** | n/a | "All requested materials… fully transferred", shown beside "Serial Numbers Needed" | The message says everything went when it didn't |
| **Not enough stock** | Refuses | Sends what it has and adds the rest to the staged purchase list | See below |

## The staged purchase list (least sure)
Each click deletes that order's staged rows and writes new ones. This list is from before automatic purchase requests. It could list something a request already covers, such as the Bearings on PR059, and Store could then raise a second request. Not tested.

## Options

**1. Update it (recommended).** Ask for Issued To once for the whole card, show reserved stock in the same warning box with the 3-second wait, and make the message name what was skipped. The staged list gets its own check, and may need its own decision. Store keeps the one-click transfer for orders with many plain items.

**2. Remove the button.** Simpler, and it closes every gap above. Store then transfers each line one at a time.

## When you check it
1. An order with plain items only: does it go through, and is Issued To blank on the Production side?
2. An order with one line with serials: read the two messages.
3. Stock held for an earlier order: is there any warning?
4. A line short of stock that already has a purchase request: does it appear again under the staged list?
