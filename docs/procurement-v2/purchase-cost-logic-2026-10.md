# What a bought item costs (2026-10-26)

How the system works out the price of an item we buy: `Item.purchaseCost`, plus the ₹/kg
(`weightUnitPrice`) for a fabrication item. This price then goes up into the BOMs (Sub Child
Part → Child Part → Machine) and the Machine's MRP / sale price.

**Status:** BUILT 2026-10-26. Change report: `procurement-v2-changes-2026-10.md` §56.

---

## 1. The rule

**An item's cost = the price before GST + the charges paid to get it.**

This is the same rule as outsource job work (`../outsource-v2/slice-4-cost-logic-2026-10.md`),
and it follows the accounting standard (Ind AS 2 / AS 2). The cost of an item includes taxes
*"other than those subsequently recoverable from the taxing authorities"*.

- **GST is left out.** Samtek is GST-registered, so the GST on a bill comes back as input credit.
  If GST went into the price, the MRP would already carry it, and Sales would then add GST on top
  again.
- **Charges are counted.** These are the PO's charges (packing, loading, the vendor's freight).
  They're paid to get the item, so they're part of its cost. Their own GST is left out too.

**Kept open** (added only if the client asks):

| | Why it's out today |
|---|---|
| GST as a cost | right only for a company that can't claim GST back (unregistered / composition) |
| Our own vehicle freight (Dispatch's "Transporting Cost") | a simplification. The standard counts inward freight, but it's per trip, not per item |
| Weighted-average cost | today it's "last purchase price" (each receive sets the price). The standard also allows weighted average across stock |

## 2. When the price is set

**At the Store receive, from the PO line being received.** It no longer changes when the PO is
approved.

- **Before:** the PO's bill was made when the PO was approved, and that re-priced the item right
  then, before anything arrived. Each receive then read the newest bill for the item, which could
  be a different, newer PO.
- **Now:** an item that has never been received has no purchase price until its first receive.
  Each receive prices from its own PO line.
- **A manual bill** ("Record New Bill", no PO) still re-prices from that bill, as before.

## 3. The formula

```
rate before GST     = "includes GST" ? rate ÷ (1 + GST%/100) : rate
                      (GST % not known → the rate as it is — never guessed)
line value          = line qty × rate before GST
line's charges      = PO charges before GST × line value ÷ Σ every line's value
                      (+ old POs: the retired poChargesTotal the same way, and the line's own itemChargesTotal)
₹ per purchase unit = rate before GST + line's charges ÷ line qty
₹ per stock unit    = ₹ per purchase unit × the receive's conversion   (purchase units in 1 stock unit)
fabrication ₹/kg    = ₹ per purchase unit, when bought in a weight unit
```

- **Lines counted:** every line on the PO, as ordered, for the charge split. Charges are fixed on
  the PO, so the split doesn't change with what arrives.
- **Code:** `services/itemPricingService.js` → `poLineUnitCost(po, line)`, used by
  `recalculateItemPricing(item, { knownConversionFactor, fromPoLine })`.

## 4. Worked example

**The PO** (packing ₹600 + 18% GST):

| Line | Order | Rate before GST | Line value | Packing share |
|---|---|---|---|---|
| A, Nut bolts | 100 kg × ₹95 + 18% GST | ₹95 | ₹9,500 | 600 × 9,500 ÷ 14,500 = ₹393.10 → ₹3.93/kg |
| B, Angle (fabrication) | 50 kg × ₹118, 18% GST included | 118 ÷ 1.18 = ₹100 | ₹5,000 | 600 × 5,000 ÷ 14,500 = ₹206.90 → ₹4.14/kg |

**Line A:**
- ₹95 + ₹3.93 = ₹98.93/kg
- received at 0.05 kg per piece → **₹4.95 per piece**
- before this change: ₹4.75

**Line B:**
- ₹100 + ₹4.14 = **₹104.14/kg**
- 1.2 kg pieces → ₹124.97 per piece
- before this change: ₹118/kg

**The bill doesn't change:** ₹9,500 + ₹1,710 GST + ₹5,900 + ₹600 + ₹108 GST = **₹17,818**. Only
the item's cost is worked out differently.

## 5. The GST % when the rate includes GST

**Before:** a quote marked "GST included" had no GST %. Both quote forms disabled the box, so the
GST couldn't be taken out of the rate.

**Now:** the GST % box stays open and is required (0 if none), labelled "GST % included", on:
- the vendor's email quotation page (checked on the server too)
- the manual quotation

The PO copies it from the quote as before (`line.gstRate`). The screens show "incl. 18% GST".

**Old included-GST quotes** (no %) aren't fixed by hand, and the PO review doesn't ask. A PO never
changes a quote's tax (2026-10-14 rule). Old quotes run out within the quote validity. A PO made
from one is costed at its rate as it is.

**Not changed:** the GST inside an included-GST line still shows as ₹0 on the bill (Accounts).
Splitting it out would change bill figures. That's a separate decision.

## 6. Tests

`purchase-cost-test.mjs` (scratchpad): 13 checks on a made-up company, with the real
`receiveLineItems`, `createAutoPurchaseInvoice` and quote checks, and 0 left.
- the four numbers above
- approving a PO doesn't move the price
- an older PO received after a newer one is priced from its own line
- an old included-GST quote is kept as is
- the GST % is required on both quote forms

**Regression:** slice 4 cost 29/29, slice 3 bills 29/29.
