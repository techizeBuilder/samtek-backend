# What changed this session — R&D requests, Quotation Settings, logo, payments, Deal Won checklist, Order Form, HSN Code, Inventory tabs & Stock Audit, multiple Power Requirements

Plain-language writeup of what we built and how each piece works now. This session covers
**9 changes** — listed below. All nine are coded, tested for build/boot errors, and ready to
use; one of them (Quotation Settings) has a leftover one-time step that still needs a
decision before it's fully "live" everywhere — flagged clearly in that section.

---

## 1. Asking R&D for a new product — moved onto the Lead card

**Where:** Leads page (`/sales/leads`), on each lead's card, next to the "Send/Update
Quotation" button.

**How it works now:** If a customer wants a product that isn't in the catalog yet, Sales
clicks "Add Request" right there on the lead card. A form pops up asking for the product
name, category, quantity, application, an optional photo — the Lead ID and date fill in
automatically. Once submitted, it goes to R&D's approval queue. The same popup also shows
every past request made for that lead, with its status.

The button itself changes colour depending on where things stand:
- **Grey** — no request made yet for this lead
- **Amber** — a request is waiting on R&D
- **Green** — R&D approved it
- **Red** — R&D rejected it

**What changed:** Before, this only existed inside the Quotation page (you had to open a
lead's quotation just to ask R&D for something new). It's been removed from there entirely
and now lives only on the lead card — one click, no need to open the quotation first, and
the colour tells you the outcome without having to open anything.

---

## 2. Quotation Settings — moved from Super Admin to Sales (with approval)

**Where it used to be:** Super Admin → Settings → General → Quotation Settings. One Super
Admin managed four things — **Terms & Conditions**, **Additional Charges**, **Notes**, and
the **Quotation Number format** — and every company on the platform shared the exact same
list. A company couldn't have its own wording without asking the Super Admin to change it
for everyone.

**Where it lives now:** It's gone from Super Admin's settings entirely. Instead, it's part
of the same "Settings" popup Sales Head already uses on the Leads page for things like Lead
Stages and Reject Reasons — it now has a second group in there called "Quotation Settings"
with the same four items.

**How it works now:** Sales Head proposes an add/edit/delete for any of the four lists.
Nothing changes right away — it goes into a "Pending" queue. The Company Admin reviews it
at Company Admin → "Lead & Quotation Settings" and either approves it (it goes live
immediately) or rejects it (nothing happens, Sales Head is notified either way). Every
company now keeps its own separate set of Terms/Charges/Notes/Number format — one
company's changes never affect another's.



## 3. Quotation now shows each company's own logo

**Where:** The Quotation page (`/sales/quotation`) — the on-screen preview, the downloaded
PDF, the printed copy, and the emailed copy all use the same header.

**Before:** The company stamp (also uploaded by Company Admin) was already per-company and
working correctly, but the **logo** next to it was always the same fixed Samtek logo image,
no matter which company was actually sending the quotation.

**Now:** It shows whatever logo the Company Admin uploaded for that company (My Company
page). If a company hasn't uploaded one yet, it falls back to the default Samtek logo, same
as before — so nothing looks broken for a company that hasn't set one up.

---

## 4. Payment Verification — one combined form, Accounts only reviews

This is the biggest of the four changes, so a bit more detail.

**How it worked before:**
1. Sales uploaded three documents (Quotation, Payment Proof, and optionally a Purchase
   Order) and clicked a button to ask Accounts to check the payment. Sales never typed in
   any actual payment numbers.
2. Separately, on the Accounts side, someone had to open "Add Payment" and manually type in
   the amount, date, payment method, which bank account it went into, and the transaction
   ID — copying it off whatever proof Sales had uploaded.
3. The moment Accounts saved that "Add Payment" entry, it was treated as already verified —
   it immediately posted a real entry into the company's accounting ledger and changed the
   bank/cash balance. There was no separate review step before money entries were posted.
4. Only after that did Accounts separately click "Verify" to mark the lead's payment status
   as Paid / Partially Paid / Rejected.

**How it works now:**
1. Sales fills in **one wider form** when requesting payment verification — it now has two
   halves. The left side is the payment details (amount, date, method, which bank account,
   transaction ID, remarks) — this is exactly what Accounts used to type in themselves. The
   right side is the document uploads, plus two new read-only numbers: the **Total
   Quotation Amount** (pulled automatically from the quotation, can't be edited) sitting
   above the Quotation upload, and an **Advance Payment Amount** next to the Payment Proof
   upload that automatically mirrors whatever amount Sales typed on the left.
2. **Payment Proof is required, unless the payment method is Cash** — in which case it's
   optional (there usually isn't a "proof" for cash in hand the same way there is for a
   bank transfer or UPI screenshot).
3. Accounts no longer types anything in. "Add Payment" is gone from their page entirely.
   Accounts opens "Verify," sees exactly what Sales submitted (amount, date, method, bank
   account with its account number, transaction ID, remarks, and a link to the uploaded
   proof), and just decides: Paid, Partially Paid, or Rejected.
4. **Only when Accounts picks Paid or Partially Paid does anything get posted to the
   accounting ledger** — the bank/cash balance only changes at that point, not the moment
   Sales submits. Picking Rejected leaves the books untouched. This closes the gap from
   before, where money could get posted to the ledger without anyone actually reviewing it
   first.

**Small extra fix on top of this:** the bank account shown to Accounts during Verify was
only showing the bank/account name (e.g. "SBI - SBI"), which isn't enough to tell two
similarly-named accounts apart. It now also shows the account number, and we backfilled that
onto every existing payment record so old ones show it too, not just new ones going forward.

---

## 5. Deal Won — every checklist point must now be confirmed

**Where:** Leads page → "Deal Won" button → the "Deal Won Checklist & Commitments" popup.
This is the same checklist that's configured dynamically from Settings (the "Sales
Checklist" list, part of the same Lead & Quotation Settings screen from change #2) — so
whatever points are listed here are whatever's currently configured, not something fixed in
the code.

**Before:** Sales could tick as many or as few points as they wanted — only "Advanced
Payment Received" was ticked by default — and still click "Save & Mark as Won" with every
other point left blank.

**Now:** every point on the checklist has to be ticked before the deal can be marked Won.
Any point still unticked shows a red "Required" note next to it, there's a notice at the top
of the popup saying so, and the "Save & Mark as Won" button stays disabled until all of them
are ticked. This is also double-checked when the save actually happens (not just in the
popup), so it can't be skipped by any other route either.

**Why:** the Service team verifies each checklist point one by one afterward (Deal
Verifications page). If Sales could leave a point unticked, Service would have nothing to
check against for it.

---

## 6. Order Form — a "Fill Remaining" button for Cash Amount

**Where:** the Sales Order Form's item table (opened from a Won lead on the Leads page),
same row as Bill Amt / GST Amt / Quot. Amount / Cash Amount / Discount.

**What was already there:** a "Same as Quotation" link under the Bill Amt box, which copies
the full Quotation Amount into Bill Amt with one click.

**What's new:** a matching "Fill Remaining" link under the Cash Amount box. Once Sales has
typed a Bill Amount that's less than the Quotation Amount (a partial/split bill), clicking
it fills Cash Amount with whatever's left — Quotation Amount minus whatever was typed into
Bill Amt — instead of having to work that subtraction out by hand.

---

## 7. HSN Code brought back to Product Master and Motor Master

**Where:** R&D → Product Master (`/r&d/product-master`) and Motor Master
(`/r&d/motor-master`) — the Add/Edit forms and the read-only detail view.

**Backstory:** HSN Code (the tax classification code used on invoices) used to be on these
forms, but got removed at some earlier point along with a batch of other pricing/tax fields
during a past client request. The underlying data field itself was removed.

**Now:** HSN Code is back as its own field on both Add and Edit forms (next to Brand /
Model Number), and shows up in the item's detail view too. Nothing else from that earlier
removal was touched — this only brings HSN back, on request.

**Bonus:** the Sales side (Quotation's item list) already reads HSN Code from the product
whenever it's set — that plumbing was already there, just never had anything to show. So
filling in HSN here means it now shows up on the Sales side automatically too, no extra
work needed.

---

## 8. Inventory — Item Type tabs, plus a Store Head stock audit

**Where:** R&D → Inventory (`/r&d/inventory`) and Store → Inventory (`/store/inventory`,
across all three of its tabs — Inventory, Product Master, Motor Master).

**Item Type tabs**

**Before:** narrowing the inventory list down to one Item Type (e.g. Raw Material,
Consumable) meant opening a dropdown. **Now:** Item Type is its own row of tabs instead —
click one to filter, the same style of tab already used elsewhere in the app (like the Leads
page's status tabs). It opens on the first real category by default instead of "All Item
Types."

**Stock Audit — Store Head only**

**Before:** nobody could actually correct a stock count from inside the app. Store's three
inventory tabs were view-only, and the one backend piece capable of changing a quantity
existed but was never connected to any button anywhere.

**Now:** Store Head — not Store Employee, not R&D, not Unit Head, even though some of them
share these exact same screens — gets a **"Verify Stock"** action on every row across all
three tabs. It shows the system's recorded quantity, lets Store Head type in what they
actually counted, shows the difference live (surplus/shortage), requires a reason, and only
then applies the correction. Every one of these is logged — who did it, when, the before and
after quantity, and why — not just silently overwritten.

For a fabrication item — one whose stock is tracked per size/dimension rather than a single
number (e.g. a sheet metal item cut to several different sizes) — clicking Verify Stock
first shows a list of every size with its own leftover stock to choose from, then audits
that one size specifically. Everything else (products, motors, plain inventory items) uses
the simple single-number version.

---

## 9. Product Master — a machine can now have more than one Power Requirement

**Where:** R&D → Product Master (`/r&d/product-master`) — the Add/Edit forms' Power
section, and the read-only detail view.

**Before:** a machine could only declare one power spec — one Power Source, one HP, one
KWH, one RPM. A machine that actually runs on more than one motor (e.g. a 5 HP motor for one
part and a 10 HP motor for another) had nowhere to record the second one.

**Now:** Power is a repeatable list — click "Add Motor/Power" for as many entries as the
machine actually needs (e.g. one row for the 5 HP motor, another for the 10 HP motor), each
with its own Power Source, HP, KWH (auto-filled from HP, still editable), and RPM, and each
removable on its own. The detail view lists every entry the same way. Existing machines that
only ever had the one old single power spec still show it correctly — it's carried over
automatically the first time that machine is opened for editing again, and Plant Master
(which shows a machine's power spec when it's added to a plant) reads and displays either
the new list or the old single value, whichever the machine actually has.

---

## Quick summary

| # | Change | Status |
|---|---|---|
| 1 | R&D "Add Request" moved to the Lead card, colour-coded | Done |
| 2 | Quotation Settings moved from Super Admin to Sales + Company Admin approval | Done — **one-time data copy still awaiting a yes/no** |
| 3 | Quotation uses each company's own uploaded logo | Done |
| 4 | Payment details merged into Sales's request; Accounts only verifies; ledger posts only on verify | Done |
| 5 | Deal Won requires every Sales Checklist point to be confirmed first | Done |
| 6 | Order Form: "Fill Remaining" button auto-fills Cash Amount from the leftover Quotation Amount | Done |
| 7 | HSN Code reintroduced on Product Master and Motor Master | Done |
| 8 | Inventory Item Type tabs + Store Head stock audit (incl. per-size for fabrication items) | Done |
| 9 | Product Master: multiple Power Requirements per machine, backward-compatible with existing machines | Done |
