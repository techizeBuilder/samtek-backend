# A serial inside a piece waiting for its sticker: what changed

*Built 4 November 2026, found in browser test step 3.8. Logic: [serial-tracking-logic-2026-10.md](serial-tracking-logic-2026-10.md) §13.*

## The problem

A part repaired from Defective Inventory goes back to stock and waits for a sticker. Its serial still read "Issued to" the order that built it. If that order was built for a parent, the system followed the link up to the customer.

**Example:** ORD-2026-098 built 2 Motor Mounts. One (MTEST-01) went to the Chamber. The other (MTEST-02) was scrapped, repaired, and now sits in stock. MTEST-02 still showed:
- in the Chamber's "What's inside" list
- in customer order ORD-0130's vendor parts, so a claim could be raised on a motor the customer never received

## What you'll see now

While a piece waits for its sticker, the serial inside it is **in stock inside that piece**.

| Place | MTEST-02 now |
|---|---|
| **Serial Numbers, Where it is** | In stock, in Motor Mount · waiting for its sticker |
| **Customer's vendor parts** | Not listed |
| **"What's inside" on other orders** | Not listed |
| **QC scrap pick on its old order** | Not offered |
| **Another waiting piece's sticker** | Not offered |

**Label carriers:** a piece that already knows what it holds offers only that. Before, the repaired Mount's **Label it** also offered MTEST-01, which is in the Chamber. Pairing it is now refused. A piece with nothing known inside still offers its order's serials, as before.

When the sticker goes on, the serial reads **Fitted**, as it did before. It follows the sticker from then on.

## What didn't change

Serials in pieces that really went up the chain, such as MTEST-01. Nothing moves in stock or reservations, and no screen changed.

## Limit

Ticking **"Nothing tracked inside"** on a repaired piece says it holds no serial, so MTEST-02 would go back to reading under its old order. Store shouldn't do that for a piece that really holds it.

## Tested

- **New suite `heldcarrier`, 15 of 15:** through a real Repair, the customer's list, "What's inside", Where it is, the scrap pick, Label it, a refused wrong pairing, and after the sticker.
- **Dev data:** MTEST-02 reads as above; off the Chamber's list and ORD-0130.
- **Regression, 10 suites, 314 checks, all pass:** `s2a`, `s2b`, `s2c`, `s2d`, `ga`, `gb`, `gc`, `nosel`, `claimway`, `alllost`.
- **Browser:** not yet seen on screen.

## Technical

`services/serialTrailService.js`: new `heldInWaitingCarriers`, used by `carrierCandidates` (with `forLabel`), `insideCandidates`, `scpPieceSerials`, `unitsInCustomerOrder` and `trailOf`. `controllers/partLabelController.js` passes `forLabel`.
