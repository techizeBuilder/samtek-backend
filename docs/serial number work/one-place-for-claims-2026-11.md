# One place to raise a vendor warranty claim (2026-11-03)

## Why
Found before step 2.15. Support Management's **Vendor Warranty Claims** only asked for a serial, while claiming from an order was on Customer Records. A customer usually knows their mobile number or order, not a serial printed on a part inside the machine.

## What changed
**Support Management → Vendor Warranty Claims → New claim** now has two ways to start:

- **By customer or order (opens first):** enter a 10-digit mobile number or an order number such as ORD-0129. It lists the vendor parts per order, the same list Customer Records shows. A mobile number also lists parts fitted on service visits. Pick the part that failed, and the claim form opens with it already looked up and the customer and order filled.
- **By serial:** works as before, including picking the vendor and item by hand when the serial isn't in our records. This stays for parts bought before tracking. When the serial's trail reaches a customer's order, the customer and order now fill in too.

**Customer Records keeps its Claim button,** which opens the same form.

**Nobody clicks Find on a claim that already has its serial.** It looks the part up by itself.

**The order has its own place on the claim.** It used to go into the free-text "Ticket no." field as "Order ORD-0129". It now shows as **Order**, and the claims list can be searched by it. "Ticket no." stays free text and starts empty.

## What didn't change
- **Tickets.** A ticket holds one machine while vendor parts are listed per customer order, so an order with two machines could confuse a ticket raised for one. You decided against it, since the target is the vendor score at purchase.
- **The vendor score.** It reads a claim's outcome, dates, ★ rating and "under warranty" mark. A claim counts the same however it was started.
- **Under the vendor's warranty?** Still chosen by hand: Yes, No or Unsure.
- **Claims raised before this change** stay as they are. An order written into their Ticket no. stays there.

## Behaviour to know
- **Parts are listed per customer order, not per machine.** An order with two machines shows the parts of both.
- **A "used to make" item such as Tool-A isn't listed,** because it isn't inside what the customer got. Its serial can still be claimed By serial.
- **A cancelled or rejected order isn't listed** for a mobile number, the same as Customer Records. Entering that order number directly still finds it.
- **Mobile number searches look at the newest 20 orders,** and list only those with vendor parts.

## Technical notes
`services/vendorWarrantyClaimService.js`: `partsForClaim`, and `lookupSerial` now returns the customer. New `GET /api/vendor-warranty-claims/parts?q=`, same permission as `/lookup`. `VendorWarrantyClaim.orderCode`. `components/support/VendorWarrantyClaims.jsx`: `PartsFinder`, `pickPart`. The agreed rule is in [serial-tracking-logic-2026-10.md](serial-tracking-logic-2026-10.md) §6.1.

## Checked
New suite 25/25 on a made-up company through the real handlers, 0 left: by mobile, by order, not found (including another company's order), the tool and cancelled-order exclusions, parts fitted on a visit, by serial carrying the customer, the order saved and searchable, and the score's numbers being the same either way. The page builds. Your real customer returned the right parts (read only).

Regression: `gc` 40 and `s2d` 11, the two suites that touch claims, pass with no test changed. The rest were skipped.

**Not yet seen in the browser.** The steps are in the [roadmap](browser-test-roadmap-2026-11.md), step 2.15.
