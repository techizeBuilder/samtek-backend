# Slice 3 plan — the outsource bill and its payment (D5)

- **Date:** 2026-10-20
- **Status:** **built** 2026-10-20 (29 tests) — change report [§3](outsource-v2-changes-2026-10.md). Browser check pending.
- **Part of:** [outsource-workflow-2026-10.md](outsource-workflow-2026-10.md) §5.4 and §8
  (slice 3).
- **Goal:** an Outsource Order is a bill, the same way a PO is. It has an advance, becomes
  payable as the work is accepted, and the full payment falls due credit days after everything
  is accepted. It's paid on the Vendor Payment page and posted to the ledger.
- **Not in this slice:** the job-work cost on the part (slice 4); Dispatch / Store.

---

## 1. What's reused from the PO bill (`../procurement-v2/accounts-bill-ledger-payments-2026-10.md`)

| PO bill (built) | Outsource bill |
|---|---|
| The PO's invoice is the bill, made when the PO becomes a real order | **The same:** a `PurchaseInvoice` made when the Outsource Order becomes **Open** (created within the limit, or approved) |
| Advance % × total, due straight away | the same (advance % and credit days are already on the order) |
| Material QC-passed → payable (minus its advance share); optional part payment | **Work accepted → payable** (§3) |
| Everything accepted → full payment due + credit days; charges posted; advance set off | the same |
| `payBill`: advance / payment, bank or vendor credit, ledger, overdue alert | the same function, generalised. No delivery clock: outsource lines have an expected date only |
| Ledger: Dr **Purchase** + Input GST / Cr Accounts Payable | Dr **Job Work Charges** (a new expense account, OQ5) + Input GST / Cr Accounts Payable |

**One rule changes everywhere:** a "staged bill" is one with a `purchaseOrder` **or** an
`outsourceOrder`. Today the code checks only `purchaseOrder` (bill stage, owed / payable now, the
Vendor Payment lists, the overdue sweep, the dashboard).

## 2. The bill

- **New fields:**
  - `PurchaseInvoice.outsourceOrder` (ref)
  - `VendorPayment.outsourceOrder` (ref)
- **Made by** `createOutsourceBill(order)`:
  - **called:** on create when Open, and when the Company Admin approves
  - **one bill per order:** a second call returns the existing one
  - **lines:** one per order line — the part, qty, rate per piece, GST, and "· steps" in the name
  - **charges:** in the subtotal and GST, as on a PO bill
  - **number:** `INV-OSO-0007-xxxx`
  - **GST type:** the order's
  - **no item price update:** job work isn't the part's purchase price, so
    `recalcPricingForInvoiceItems` is not called
- **Cancel an order:**
  - nothing paid → its bill is Cancelled
  - **advance already paid → refused for now** (decision Q3)

## 3. When outsourced work becomes payable (decisions Q1, Q2)

**The rule, same as for material: pay for what passes QC.**
- A trip whose steps have **no QC step** is accepted **when received**.
- Otherwise it's accepted when QC has decided every QC step on that trip:

| Request | Accepted quantity |
|---|---|
| **Child Part / Machine hand-off** | the units whose QC steps on this trip **all passed** |
| **Sub Child Part hand-off** | the pieces that passed this trip's **last** QC step (the attempt this trip sent) |
| **Job-work order** (fully-outsourced Sub Child Part; QC once at the end) | the job-work order's QC result (passed quantity ÷ order quantity), applied to **every** trip of that job-work order, whichever order and vendor it was on |

- **Value accepted:** rate × accepted quantity, plus its GST.
- **Rejected / scrapped / rework units or pieces:** **taken off the bill** (an adjustment
  "Rejection"). The vendor isn't paid for them.
  - A redo by the same vendor comes back as a new request, ordered at ₹0 or at a charge (D6).
- **The bookkeeping:**
  - **On receive:** each request notes the QC attempts its trip sent: step, unit, attempt
    number.
  - **The hook:** after any QC decision (Child Part / Machine unit step, Sub Child Part batch
    step, job-work order QC), one hook `onOutsourceQcDecided(record)` re-checks that record's
    received requests. It's idempotent: a request already settled is skipped.
- **Ledger on accept:** Dr Job Work Charges + Input GST / Cr Accounts Payable.
- **Fully accepted** = every request on the order is accepted, or released. Then, as for a PO:
  - the charges are posted
  - the advance is set off
  - the full payment is due on that day + credit days
  - Accounts is notified

## 4. Paying (Vendor Payment)

- **Vendor Payment:** an outsource bill shows next to PO bills — the order number, its stage, and
  what can be paid now. Payment works the same way: the advance, a payment for accepted work,
  from a bank account or from the vendor's credit.
- **Purchase Invoices:**
  - an outsource bill is labelled **"Outsource bill — OSO-0007"**
  - **a type filter:** All / PO / Outsource / Without a PO
- **The order itself:**
  - the detail shows its bill: total, advance due / paid, accepted, payable now, paid
  - the list gets a **payment** column (Advance due / Awaiting work / Payable / Paid)
- **Overdue:** the daily overdue sweep covers outsource bills too, and Accounts is told once.

## 5. Dashboards (OQ6)

- **Purchase value / Top 3 / trend:** outsource bills are **not counted** (they're job work, not
  purchases). Today a bill without a PO counts there, so they're excluded explicitly.
- **Payables:** they **are** counted, because it's money owed to the vendor.
- **The vendor's balance** (Vendor Payment) includes them.

## 6. Tests

On a made-up company through the real handlers, with 0 left over afterwards; every money figure
is worked out by hand:

1. **Bill made:**
   - an order under the limit → bill on create
   - over the limit → no bill until approved; reject → none; approve → bill
   - a second call → no duplicate
2. **Totals:** the bill total = the order's grand total; the advance = advance % × total.
3. **No-QC trip:** received → accepted value posted (Job Work Charges + CGST / SGST / Cr AP).
4. **Child Part, 2 units, welding (a QC step):**
   - receive → nothing payable
   - unit 1 passes → its share payable
   - unit 2 rejected → its share taken off the bill
   - fully accepted → charges posted, advance set off, due date = today + credit days
5. **Sub Child Part hand-off, 10 pieces, QC 8 passed / 2 scrap:** 8 × rate + GST payable; 2 taken
   off.
6. **Job-work order on two orders (laser at vendor A, bend at vendor B), QC Pass at the end:**
   both bills accepted; then a partial-reject case.
7. **IGST order:** Input IGST.
8. **Payments:**
   - advance from the bank (Dr Advance to Vendors / Cr Bank)
   - pay accepted work (Dr AP / Cr Bank)
   - over the payable amount → refused
   - pay from vendor credit
9. **Overdue sweep** flags an outsource bill.
10. **Cancel:** an Open order with nothing paid → bill Cancelled; advance paid → refused.
11. **Dashboard:** purchase value unchanged by an outsource bill; payables include it.
12. **The ledger balances overall:** Accounts Payable, after a full cycle and full payment = 0.

## 7. Files

- **Backend:**
  - `models/PurchaseInvoice.js` (`outsourceOrder`; stage for both)
  - `models/VendorPayment.js`
  - `services/purchaseLedgerService.js` (`job_work` account)
  - `services/purchaseBillService.js` (staged-bill checks; `payBill` for both)
  - new `services/outsourceBillService.js` (create bill, acceptance, full acceptance)
  - `controllers/outsourceOrderController.js` (bill on Open, cancel rule, receive → acceptance,
    detail / list money)
  - the QC hooks in `controllers/qcController.js`
  - `services/purchaseAcceptanceService.js` (overdue sweep)
  - `controllers/purchaseInvoiceController.js` (list / outstanding)
  - `services/purchaseDashboardService.js`
- **Frontend:**
  - `pages/accounts/VendorPayments.jsx`
  - `pages/accounts/PurchaseInvoices.jsx`
  - `pages/accounts/outsource/OutsourceOrdersView.jsx` (the bill on the order)

## 8. Decisions (user, 2026-10-20 — all as proposed)

| # | Question | Decision |
|---|---|---|
| Q1 | When does outsourced work become payable? | **When QC passes it** (§3), like purchased material. A trip with no QC step: on receive |
| Q2 | Units / pieces QC rejects, scraps or sends for rework on a trip: paid? | **No — taken off the bill.** A redo by the same vendor is a new order (₹0 or a charge). This also answers OQ3 for now |
| Q3 | Cancel an order whose advance is already paid? | **Refused for now** (record a refund first). Before any payment: the bill is cancelled with the order |
| Q4 | The ledger account for job work | **Job Work Charges** (a new expense account), so it's told apart from material purchases (OQ5) |
| Q5 | Outsource bills in the Purchase Dashboard's purchase value / Top 3? | **No** (OQ6), but **yes** in Payables and the vendor balance |
