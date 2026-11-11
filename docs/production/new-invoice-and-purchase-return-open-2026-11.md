# Open items: Accounts "New Invoice" and the manual Purchase Return

- **Written:** 2026-11-02, while checking which screens reduce stock without moving serial numbers
  (serial number work, item 8).
- **Status:** **open, nothing built or changed.** Waiting for the client's answer.
- **Why this doc:** so this can be picked up later without going through it again.

## Questions to ask the client

1. **Does anyone use Accounts → Sales Invoice → "New Invoice"** to bill a machine or item directly?
   Our view: probably not, because orders come from the Sales department.
2. **If material passes QC and is found bad later, how does it go back to the vendor today?** QC
   Rejections doesn't cover this, and the only hand-entry route is the old Purchase Return page.

---

## 1. Accounts → Sales Invoice → "New Invoice"

**Where:** `/accounts/sales/invoices`, the "New Invoice" button, in the sidebar. The page is
`pages/accounts/SalesInvoices.jsx`. Its "Add Product…" list shows machines and motors with their stock.

**What it does** (`controllers/salesAccountController.js` → `createSalesInvoice`, route
`POST /api/accounts/sales/account/invoices`):
- Creates the bill and its accounting entries.
- Reduces `Item.qty` by the quantity. **There's no stock check on this update**, so a product with
  stock 0 goes to −1.

**What it doesn't do:**

| Step in the normal sale | New Invoice |
|---|---|
| QC job | No |
| Store's routing / handover | No |
| Production order if there's no stock | No |
| Packaging and dispatch | No |
| Sticker or serial number linked to the customer | No |

So it's only half a flow: the stock goes down, but nothing is checked, built, packed or sent.

**The real sale route:** Leads → Order Form → Store's routing
(`storeFlowService.applyStoreDecisionToItem`):
- In stock → stock is deducted → automatic Store QC job → Packaging → Dispatch. QC picks the sticker
  / vendor serial on that job.
- Not in stock → production order (serials tracked) or a purchase request.

**Don't confuse it with:** generating a bill from a Sales Order (`pages/accounts/SalesOrders.jsx`, and
the order rows on the same page). It uses the same route with an `orderId`, its lines come from the
Order Form and carry no inventory item, so **stock isn't touched**. That's normal and in use.

**Usage:** in dev, all 169 sales are linked to an order, and a New Invoice sale has none, so it has never
been used in dev. That doesn't tell us what the client does.

**If the client says:**
- **Nobody uses it:** hide the button and consider removing the path. It reduces stock with no QC or
  dispatch, which is a problem regardless of serials.
- **They use it:** complete the flow properly. At minimum it needs a stock check and a sticker / serial
  pick (`components/serials/SerialPicker.jsx`, moving the unit to "Sold"). Whether it should also go
  through QC, Packaging and Dispatch has to be agreed first.

---

## 2. The manual Purchase Return page

**Where:** `/accounts/purchases/returns` (`pages/accounts/PurchaseReturns.jsx`).
- Its sidebar entry is **commented out** (`config/moduleRoutes.js`).
- It can still be opened by address, and by the **"Returns" button on `/accounts/purchases`**
  (`pages/accounts/Purchases.jsx`).

**What it does** (`controllers/purchaseInvoiceController.js` → `createPurchaseReturn`, route
`POST /api/accounts/purchases/returns`): a hand-entered return that reduces `Item.qty` and the
invoice balance. It doesn't move serial numbers.

**Why it's leftover** (procurement v2 change report §24, 2026-10-12):
- **Before:** every QC rejection automatically booked a purchase return and emailed the vendor a
  replacement link. The replacement never reached the PO line, so Store couldn't receive it, and
  nobody recorded what the vendor agreed to.
- **Now:** **Purchase & Outsource → Purchase Orders → QC Rejections.** Purchase records the vendor's
  answer: replace / refund / credit / refused. This is the real process, browser-tested in Oct 2026.
- A rejected serial is "QC rejected" and never enters stock, so this route has no serial gap.

**Usage:** 0 records in dev.

**The one real gap it leaves:** QC Rejections only covers material **rejected at QC**. If material
passed QC and is found bad later, no current process sends it back with a stock change. A vendor warranty
claim records what happened but doesn't move stock. Hence question 2 above.

**Removing it isn't just deleting a page.** These still refer to it:
- `controllers/purchaseInvoiceController.js`: `createPurchaseReturn`, and `createQCRejectedPurchaseReturn`
  (QC stopped calling it on 2026-10-12)
- `routes/accountsRoutes.js`, `controllers/accountsController.js`, `models/PurchaseReturn.js`,
  `models/Account.js`, `models/PurchaseExchange.js`
- the ledger shows `PurchaseReturn` entries, so old entries must still display correctly

Check all of those before removing anything.

**Also open, unrelated to serials** (procurement workflow): return freight (RT2) and a return challan /
gate pass (RT4).

**If the client says:**
- **Goods are never sent back after QC:** clean up the page and the old function as their own task.
- **They do send goods back:** design it properly (Purchase records it against the PO line, with a serial
  pick). Don't simply re-enable this page.

---

## Effect on the serial number work
Neither is being built in the serial number work. Until this is settled, stock going out through either
screen leaves its serial saying "In stock"
([serial number work](../serial%20number%20work/README.md)).
