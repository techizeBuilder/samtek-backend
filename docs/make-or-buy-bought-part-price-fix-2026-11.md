# A real purchase now sets a bought part's price

*Built 5 November 2026, found at browser test Part 5 when Aata machine showed "Price provisional".*

## The problem

Test Sensor was bought on PR063 at ₹500 and passed QC, yet it still read **₹0, price pending**. The make-or-buy docs say the first real receive sets the price. So:

- Every bought Child or Sub Child Part stayed at ₹0 after a real purchase, unless Accounts entered an estimate by hand.
- PRO001's price counted nothing for the sensor.
- Its "Price provisional" warning never cleared.

**Why:** Store's receive looked the item up by name + `store`, and no Child or Sub Child Part has a `store` field (all 14 on test-1 have none). The price step was skipped with no message.

**Why the tests missed it:** the make-or-buy suites hand the item straight to the price function, which works. They never went through Store's receive, where the lookup failed.

## What happens now

The receive finds the item in this order, in all 3 places that had this lookup:

1. The PO line's own item link.
2. The real id on the request.
3. Code or name within the company, the lookup the receive already used elsewhere.
4. Name + `store`, kept last for older items with no `companyId` (17 on dev).

| Case | Result |
|---|---|
| Bought part received | Price = rate before GST + its share of charges, marked as a real purchase, pending cleared, pushed up to the Machine |
| Estimate already entered | The real purchase replaces it |
| Made part, old PO received | Bought cost only; the price in use doesn't move |
| Raw material | As before |

**Example:** 2 sensors at ₹500 with ₹100 packing: 500 + 100 ÷ 2 = **₹550**. A machine at ₹100 goes to ₹650, MRP ₹780 at 20% profit.

**A made part's bought cost now really updates on an old PO.** The docs always said so, but the lookup never found the part, so the rule never ran through a real receive.

## Test Sensor corrected
The fix only affects new receives, so Test Sensor was re-priced once from its PR063 line, through the normal price code. Dev only; live has only product master data.

| Item | Before | After |
|---|---|---|
| Test Sensor | ₹0, pending | ₹500, real purchase |
| Chamber | ₹1,362.20 | ₹1,862.20 |
| PRO001 cost | ₹2,206.52 | ₹2,706.52 |
| PRO001 MRP | ₹2,647.82 | ₹3,247.82 |
| PRO001's provisional mark | Test Sensor | Clear |

## Addition: the new lead form warns too
The docs listed only Product Master, the quotation and the order form. At your ask, the new lead form's machine list and its selected machines now show the same amber **Price provisional** tag, with the full sentence on hover. It only warns: it never blocks, and nothing is saved on the lead.

## Technical notes
- `controllers/purchaseRequestController.js`: `receivedItem(request, companyId, line)`, used by `applyReceiveSideEffects` (twice) and `receiveLineItems`.
- `pages/sales/Leads.jsx`: `PriceProvisionalTag`, using `utils/priceProvisional.js`. The list already carried the fields.

## Checked
- **New suite `partprice`:** 20 of 20, 0 left, through the real receive handlers on both routes: bought Sub Child Part with charges and the push up to the Machine, estimate replaced, bought Child Part, made part with an old PO, a PO line with no link, raw materials, an item with `store` only, another company's item with the same name.
- **Regression:** `purchase-cost` 13, `makebuy-s1` 17, `makebuy-s2` 19, `makebuy-s3` 9, `makebuy-gate` 18, `itemlink` 5, `dispatch-store-part1` 24, `paid-before` 4, `qcgate` 34.
- **Dev data after the correction:** the table above, exact.
- **The lead page compiles.**
- **Seen in the browser:** the new lead tag, at step 5.2: Aata machine at ₹3,247.82 with no tag, the three machines using Fan Bush tagged.

**Noticed, not changed:** a raw item with no `companyId` and a request with no item link makes the receive ask for a conversion factor, because the unit check at the start of the receive can't find it. Dev's 17 such items all belong to another company.
