# Purchase bills, ledger and vendor payments — client's answers and the design

- **Started:** 2026-10-10
- **Client answered:** 2026-10-12
- **Refined with the user:** 2026-10-12 (mid payment optional; credit days on the PO; Q4 yes; Q8
  skipped).
- **Status:** **Being built in 4 slices** (§8).
  - **Slice 1** (the PO bill, advance, delivery clock, real ledger) is **built**: change report
    §22.
  - **Slice 2** (QC pass → payable, optional mid payment, full acceptance) is **built**: §23.
  - **Slice 3** (QC rejections: the vendor's answer; refunds / credits; cancel on the new bill) is
    **built**: §24.
  - Slice 4 is next.
- **Pages concerned:** Accounts → Purchases → **Purchase Invoice**
  (`/accounts/purchases/invoices`) and **Vendor Payment** (`/accounts/purchases/payments`).

---

## 1. Why this came up

While building PO cancellation (2026-10-09) we checked how a purchase reaches the accounts. The
money side doesn't match how the purchase side now works, and the ledger has a bug. Vendor
payments are part of the same problem, because a payment is what settles a bill.

## 2. How it works today

| Part | What happens today | Problem |
|---|---|---|
| **Purchase invoice** | Made automatically when a PO is placed, as a copy of the PO | A PO is a promise to buy, not money owed. The invoice exists before anything arrives. |
| **Ledger entry for the invoice** | Meant to post *Purchase + Input GST / Accounts Payable* | **It never posts.** It looks for accounts named "Purchase Account" and "Input GST", which don't exist in any unit. |
| **Vendor payment** | Reduces *Accounts Payable* and the bank | Nothing ever adds to Payable, so it **goes negative**. |
| **Advance payment** | Can only be paid against that automatic invoice | A PO has nothing to pay an advance against. |
| **Delivery date** | Counted from the **PO date** + the quote's delivery days | The client counts it from the **advance payment** (§3.2). |
| **QC rejection of purchased material** | **Two things happen at once, automatically:** (a) a purchase return takes the item off the invoice, at the PO price with a **fixed 18% GST**; and (b) the vendor is **emailed a replacement link**. | Return and replacement are opposite outcomes, yet both are created every time. Nobody records what the vendor actually agreed to. The GST is assumed, and the invoice is reduced by the amount *before* GST. |
| **TDS** | On the manual "Record New Bill" form, from the vendor's TDS Section | The client doesn't want TDS (§3.4). |
| **Bank balance check** | A payment is refused if the bank balance in the system is too low | Stays (§5, Q7). |
| **Accounts** | Found by unit name only, not by company | Two companies that both have a unit called "Main" would share the same accounts. |

**Old test data — removed 2026-10-12.** Two July test entries in the Alpha Unit were deleted: a
₹40,000 QC return and a ₹50,000 vendor payment. Their effect on the balances was reversed:
- Accounts Payable: −₹90,000 → ₹0
- Purchase Return: ₹40,000 → ₹0
- the bank account ("Semtek Account"): +₹50,000 back

A backup is in the session scratchpad. *(Accounts Receivable is also negative in both units. That's
the sales side, outside this work, and was not touched.)*

---

## 3. The client's requirements (2026-10-12)

### 3.1 The PO is the bill; payment follows its payment terms

Everything is fixed on the PO: item prices + GST, charges + GST, advance % and credit days. Nothing
is retyped when the vendor's paper bill comes. The amount only changes because of things already
in the system:
- a **cancel / short close**
- a **QC rejection**, through the vendor's answer (§3.5)

**The main flow is advance → full payment.** A mid payment is **optional** (user, 2026-10-12):
Accounts *may* pay for material already accepted, but nothing requires it.

| Stage | When it becomes payable | How much |
|---|---|---|
| **Advance** | When the PO becomes a real order (created directly, or approved) | Advance % × PO total. Due straight away. |
| **Mid** (optional) | Any time after some received material **passes QC**. A PO's lines arrive on different dates. | Up to the value of what was accepted, minus its share of the advance (§6, D1) |
| **Full / final** | When **every** line is received and has passed QC | Whatever is still unpaid, due Credit Days later |

Every purchase receipt goes to QC (stock only goes up on a QC pass), so "accepted" always means QC
passed. Accounts can pay a stage in one go or in parts; each payment records the bank, the date
and the reference.

### 3.2 Delivery dates count from the advance payment

- **With an advance:** the vendor starts work only when the advance arrives, so each line's
  expected date = **the advance payment date + that line's quoted delivery days**.
  - Until the advance is paid, the line shows **"Waiting for advance"**: no due date, no Overdue,
    no daily alert.
  - Store's **Overdue / Due today / Due in 3 days** follow the new date.
  - So does the vendor's on-time score: the date fixed when the advance is paid is the
    "promised" date.
- **No advance (0%):** the count starts from the PO date, as today. For a PO that needed Company
  Admin approval, it starts on the approval day, when the order really goes to the vendor.
- **Quotes give days, not dates** (e.g. "7 days"). The PO line now keeps those days, so the date
  can be set when the advance is paid.

### 3.3 Credit days — set on the PO, counted from full acceptance

- **The number of credit days is entered on the PO**, as today (PO review → Payment terms).
- **They count from the day the whole PO is accepted**: every line received and QC-passed. The
  full payment is due that day + credit days.
- **Blank or 0 credit days** = due straight away. (Until 2026-10-12 the PO screen said blank = 30
  days.)
- **The advance** has no credit days: it's due when the PO becomes real.
- **An optional mid payment** has no due date; it's paid whenever Accounts chooses.

### 3.4 No TDS

Payments in our software are a **record of the payment flow**, not the real bank transfer. So TDS
is removed from the purchase side:
- the TDS on the manual "Record New Bill" form
- TDS on vendor payments
- the Vendor Master "TDS Section" field is hidden from the purchase flow

The separate Accounts → GST & TDS page is not part of this work.

### 3.5 QC rejection and cancel — the five cases

When QC rejects purchased material, **Purchase talks to the vendor and records what the vendor
agreed to**. Nothing goes to the vendor automatically any more. The rejected quantity then follows
one of these:

| # | The vendor… | The bill | Money already paid for the rejected quantity | Other effects |
|---|---|---|---|---|
| **1** | **Refuses** to replace or refund | The rejected quantity is **taken off** (we don't pay for it) | **Written off as a loss** | **Vendor score goes down**. The material stays with us as rejected stock (scrap / rework is Store's call). |
| **2** | **Replaces** it | **No change** | Stays against the bill | The rejected quantity is **expected again** on the same PO line. Store receives the replacement, QC checks it, and its payment waits until it passes. |
| **3** | Takes it back and **refunds** | Taken off | The vendor **owes us a refund** → Accounts records it when it arrives | The material goes back to the vendor |
| **4** | Takes it back and gives **credit** | Taken off | Becomes **vendor credit** ("vendor holds ₹X of ours"), used on that vendor's next payments | The material goes back to the vendor |
| **5** | — **PO cancelled / short closed** (already built, change report §14) | Only what was **received and accepted** is paid | If the advance is more than that, the extra is a refund or credit, as in 3 / 4 (Accounts picks) | — |

"Money already paid for the rejected quantity" is usually just its **share of the advance**,
because we only pay mid / final after QC passes. A refund or credit is therefore usually small: the
advance share of what was rejected.

### 3.6 A worked example

**The PO:** PO-0042 to Sharma Steels.
- **Total:** ₹1,00,000 including GST
- **Terms:** advance 20%, credit days 15
- **Line A:** angle, ₹50,000, 7 days delivery, needs QC
- **Line B:** bolts, 100 pcs × ₹300 = ₹30,000, 10 days, needs QC
- **Line C:** paint, ₹20,000, 10 days, no QC

| Day | What happens | Money |
|---|---|---|
| 1 | The PO is approved | **Advance due ₹20,000** (now). All lines: "Waiting for advance". |
| 3 | Accounts pays the advance | Paid ₹20,000. Expected dates: A = day 10, B and C = day 13. |
| 10 | Line A arrives; QC passes it on day 11 | **Mid payable ₹40,000** (₹50,000 − its 20% advance share ₹10,000), due day 11 + 15 = **day 26** |
| 13 | Line C arrives (no QC) | **Mid payable ₹16,000** (₹20,000 − ₹4,000), due **day 28** |
| 13 | Line B arrives; QC passes 90 bolts and rejects 10 on day 14 | 90 bolts = ₹27,000 − ₹5,400 → **₹21,600 payable**, due day 29. The 10 rejected bolts (₹3,000, of which ₹600 was paid through the advance) wait for the vendor's answer. |

**What happens to the 10 rejected bolts, for each answer:**
- **Refuses:** the bill drops by ₹3,000. The ₹600 already paid is written off. Sharma's score goes
  down.
- **Replaces:** the bill is unchanged. 10 bolts are expected again. When they pass QC, the last
  ₹2,400 becomes payable.
- **Refund:** the bill drops by ₹3,000. Sharma owes us ₹600, and Accounts marks it received when it
  comes.
- **Credit:** the bill drops by ₹3,000. "Sharma holds ₹600 of ours", taken off the next payment.

Every line is in and accepted, and the bolt case is settled. **The PO is complete.** Paid: ₹20,000
+ ₹40,000 + ₹16,000 + ₹21,600 (+ ₹2,400 if replaced).

### 3.7 The vendor's balance — one figure, with a clear sign

| Shown as | Meaning | Typical reason |
|---|---|---|
| **We owe ₹X** (plus) | Material accepted, not yet paid | Normal, until the due date |
| **Vendor holds ₹X of ours** (minus) | We paid before the material was accepted, or paid too much | An advance; a cancelled PO; a credit (case 4) |
| **Settled** (zero) | Nothing owed either way | — |

**Each PO also shows its own figures:**
- the PO total
- the advance due / paid
- accepted so far
- payable now and its due dates
- paid
- refunds / credits from rejections

---

## 4. Ledger entries (behind the scenes)

| Event | Entry |
|---|---|
| Advance paid | Advance to Vendors / Bank |
| Material accepted (mid / final) | Purchase + Input GST (CGST + SGST or IGST) / Accounts Payable; then Accounts Payable / Advance to Vendors for the advance share |
| Mid / final paid | Accounts Payable / Bank |
| Rejected, refused (case 1) | The advance share written off: Purchase Loss / Advance to Vendors |
| Rejected, refund (case 3) | Vendor Refund Due / Advance to Vendors; then Bank / Vendor Refund Due when it arrives |
| Rejected, credit (case 4) | Stays in Advance to Vendors (the vendor holds it), set off on the next payment |
| Cancel / short close | As built in §14: the unused advance is the vendor's credit, or a refund due |

---

## 5. The questions, answered

| # | Question | Answer (2026-10-12) |
|---|---|---|
| 1 | When is the balance due — receipt or QC? | **After QC pass** (items with no QC: on receipt), in stages: advance → mid → final (§3.1) |
| 2 | How are credit days counted? | Not given by the client. **Our plan:** from the acceptance date; blank / 0 = straight away (§3.3) |
| 3 | TDS on payments? | **No TDS** — it's a payment-flow record, not the real payment (§3.4) |
| 4 | Record the vendor's own invoice number and date? | **Yes** — optional on Store's receive step (number + date + scan) (§6, D5) |
| 5 | Money a vendor holds after a cancel / rejection? | **Refund or credit, per what the vendor agrees** (§3.5, cases 3–5) |
| 6 | Bills with no PO (manual "Record New Bill")? | **Later.** That's the outsource flow, built after purchase. The form stays as it is for now. |
| 7 | Bank balance check: block or warn? | **Keep blocking** (as today) |
| 8 | Payment approvals (Requested → Approved → Scheduled → Paid)? | **Skipped** — payments are recorded straight away (§6, D6) |
| 9 | Old wrong balances? | **Removed 2026-10-12** (§2) |

### Q4 explained: the vendor's own invoice number

When a vendor delivers, they hand over **their own GST tax invoice**: a paper with their number on
it, e.g. *"Sharma Steels, Invoice No. SS/26-27/0457, dated 15 Oct"*. In our system the bill is the
PO (PO-0042), so that number is never recorded anywhere.

**Why companies record it:**
- **GST input credit.** The company's accountant claims back the GST paid to the vendor. The
  government portal lists the vendor's invoices by **their** number (SS/26-27/0457), not by our PO
  number. To match the two, someone needs to know that PO-0042 = SS/26-27/0457.
- **Disputes.** When the vendor says "invoice 0457 is unpaid", Accounts can find it.

**The solution, if wanted:** Store already has the paper in hand when the material arrives. On the
receive step, they add an optional **"Vendor invoice no. + date"** (and a photo/scan if they like).
- **One vendor invoice can cover several lines.** The same number goes on each line it covers.
- **No amounts are typed.** The amount still comes from the PO.

**Since payments here are a flow record, not real accounting,** this is "nice to have" for
matching, not a must.

### Q8 explained: payment approvals

**Today**, anyone with Accounts permission records a vendor payment directly, and it's done.

**The blueprint's flow** adds steps in between:
1. **Requested:** Accounts says "pay Sharma ₹40,000 for PO-0042, line A".
2. **Approved:** the Company Admin agrees (like PO approval).
3. **Scheduled:** Accounts picks the payment date, e.g. "Friday's payment run".
4. **Paid:** Accounts marks it paid, with the bank and the UTR / cheque number.

It stops one person paying a vendor alone, and it lets a company pay in planned batches.

**For us:** the Company Admin already approves every PO above the limit or with a failed vendor
check, and the payment amounts now come straight from the PO and QC. Nobody types an amount. So a
second approval mostly repeats the first.

---

## 6. Choices (as applied in the build)

| # | Choice | Suggested |
|---|---|---|
| D1 | How the advance is set off against mid payments | **In proportion.** Every accepted ₹ of material carries its share of the advance (20% advance → each mid payment is 80% of the accepted value), as in the example. The other way, using up the whole advance on the first mid payment, makes the first payment tiny and the last one large. |
| D2 | When the PO's charges (freight, packing…) are paid | **With the full payment.** With mid payments optional, the simple rule: an optional mid payment covers material only; the charges are part of the full payment. |
| D3 | An advance paid in parts — when does the delivery count start? | When the **full** advance is paid |
| D4 | Who records the vendor's answer on a QC rejection | **Purchase** (they talk to the vendor), on the PO. The money effects show for Accounts. The automatic replacement email and automatic return on every rejection are removed. |
| D5 | Vendor's own invoice number (Q4) | Optional field on Store's receive step (number + date + optional scan) |
| D6 | Payment approvals (Q8) | **Not now.** Payments are recorded straight away. Revisit if the client asks. |
| D7 | How much a "refused" case (case 1) lowers the vendor's score | Counts as a **failed QC plus a dispute** in the rating, and puts the vendor on **Watchlist** |

---

## 7. Technical notes (for the build)

### 7.1 Already in place

- **CGST + SGST vs IGST** is worked out (change report §19): each PO carries `gstSplit`, and its
  invoice `gstType`. Post separate Input CGST / Input SGST / Input IGST.
- **Cancel / short close** (§14): reverses an invoice posting proportionally and records
  `vendorCredit`.
- **Targeted payment allocations:** `VendorPayment.allocations[]`.

### 7.2 Files

- `controllers/purchaseInvoiceController.js`:
  - `createPurchaseInvoice` (manual bill)
  - `createAutoPurchaseInvoice`: called from `purchaseController.finalizePurchase` and two receive
    paths
  - `createVendorPayment`
  - `getVendorOutstanding`
  - `createQCRejectedPurchaseReturn`: fixed 18% GST; reduces the invoice before GST
- `controllers/purchaseExchangeController.js`: `createQCRejectedPurchaseExchange` (emails the
  vendor automatically on every reject) and `acceptExchangeByToken` (creates an "Ordered"
  replacement purchase request). Both are called from `qcController.submitDecision`, for partial and
  full rejects.
  - These two become **one "rejection resolution"** per rejected quantity, with the four answers in
    §3.5.
  - The replacement path can reuse the "replacement request on the same PO" idea, without the
    automatic email.
- **Models:**
  - `PurchaseInvoice`: has `purchaseOrder`, `gstType`, `tdsAmount`
  - `VendorPayment`: `allocations[]`
  - `PurchaseExchange`
  - `Account` / `Transaction` in `models/Account.js`
- **Pages:** `pages/accounts/PurchaseInvoices.jsx`, `VendorPayments.jsx`, `PayableAgeing.jsx`

### 7.3 Accounts in the database

- 22 accounts, none with a companyId.
- No Purchase Account, Input GST, Advance to Vendors, Vendor Refund Due or Purchase Loss exists
  anywhere.
- **Fix:** create system accounts per **company + unit** on first use, and look them up the same
  way.

### 7.4 Delivery date from the advance (§3.2)

- PO lines keep only `expectedDeliveryDate`. Add the line's quoted `deliveryDays` (from the
  `VendorBid`) so the date can be set when the advance is paid.
- `deliveryFollowUpService` must skip "waiting for advance" lines:
  - due buckets
  - the overdue sweep
  - Store's notice
  - vendor rating on-time
- The "original date" for the vendor score becomes the one set at advance payment.

### 7.5 Acceptance is not an event today

`Purchase.status` becomes Received lazily (`computeHealedStatus` when the PO list is read). Mid /
final payables need real hooks:
- **Receive:** `receiveLineItems`, `receiveLineFabrication`, the legacy receive paths. For items
  with no QC, receipt is acceptance.
- **QC pass / partial pass:** `qcController.submitDecision`, Purchase-sourced jobs.

### 7.6 Other

- **QC return amounts** must use the line's own GST rate.
- **Vendor credit exposure** (PO review, `getVendorOutstanding`) switches to the new vendor
  balance.
- **The PO screen's "blank credit days = 30"** text and default change to "blank = straight away".

### 7.7 Workflow doc questions this answers

- AC1: no retyped bill; the PO is the bill
- AC2: advance against the PO
- AC4: pay after QC
- AC7: reminders use the stage due dates

---

## 8. Build slices (2026-10-12)

| Slice | What | Status |
|---|---|---|
| 1 | The PO bill (advance fixed, no due date until full acceptance, no ledger at creation), advance payment, delivery clock from the advance, the purchase ledger accounts per company + unit, payment history, TDS removed from the manual bill, manual-bill payments capped at what's owed | **Built** — change report §22 |
| 2 | QC pass → accepted value + ledger; optional mid payment; full acceptance → due date, charges + advance set-off; overdue sweep; Payable Ageing by due date | **Built** — change report §23 |
| 3 | QC rejections: the vendor's answer (refused / replace / refund / credit), cancel / short close on the new bill, vendor score, refunds and credits | **Built** — change report §24 |
| 4 | Vendor invoice no. at Store receive, ledger page check, Vendor Master TDS hidden, docs | Next |
