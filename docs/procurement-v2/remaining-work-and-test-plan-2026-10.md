# Procurement v2 — what's left to build, and the browser test plan

Date: 2026-10-10

**Where things stand:**
- Points 1–17 from the gap list are all **built or closed**.
- Everything from 8–10 Oct passed code-level and database tests, but **none of it has been clicked
  through in the browser.**
- Part A lists what's left to build.
- Part B is the test plan, in order. Each test builds on the ones before it, so go top to bottom.

Detail for every change is in `procurement-v2-changes-2026-10.md` (§ numbers below point there).
Open questions are in `procurement-workflow-2026-10.md` §9 (49 open, 41 resolved).

---

# Part A — What's left to build

## A1. On hold — waiting for the client

Everything is written up in **`accounts-bill-ledger-payments-2026-10.md`**: findings, the proposed
model, and 9 questions.

| Item | What it is |
|---|---|
| **Purchase bill + ledger fix** | The PO is the bill. It's booked when goods arrive, which fixes Accounts Payable going negative (ledger bug). |
| **Advance against the PO** | Pay the advance % when the PO is placed; it's set off when the bill is booked. |
| **Vendor balance** | One figure: plus = we owe the vendor; minus = the vendor holds our money (advances, cancelled POs). |
| **Payment requests and approvals** | Requested → Approved → Scheduled → Paid (blueprint §16). |
| **Payment reminders** | Before the due date (AC7). |
| **Credit limit at PO time** | Warn or block (AC6). |
| **GST ledger accounts** | Input CGST / SGST / IGST. The type per PO is already worked out (§19). |
| **TDS** | Only if the client deducts it on purchases (question 3 in the accounts doc). |
| **QC return amount bug** | Uses a fixed 18% GST and doesn't match the invoice. Fix it with the bill work. |

## A2. Later phases — not started

Each needs a few decisions first (the question IDs are in the workflow doc).

**Requests (PRs)** — mostly covered already (your review, 10 Oct):
- **Approval:** already there. Store approves or rejects requests, and the Company Admin approves
  the spending at PO time. No extra PR approval (R4 closed).
- **Duplicates:** requests for the same item already merge into one RFQ/PO card. An unwanted one
  can be rejected or left unselected (R7 closed).
- **Emergencies:** the requests raised by the order-form cascade (Leads → order form submit) are
  the emergency ones. No separate flow (R6 closed).
- **Still optional, only if the client asks:** a different reorder formula or stock levels, EOQ, a
  standard purchase→stock conversion factor (R1–R3, R8, R9). The minimum-stock reorder already
  runs.

**Quotes and vendor choice**
- **Vendor score:** the rating already exists (on time + QC). It needs **aligning with the
  blueprint's weighted score**: price, quality, delivery, credit, warranty (S1, S2, S4, S6).
  Today the selection check is price-only.
- Technical pass / fail on a quote (S3)
- Vendor call logging through the IVR (QT6)
- Specification / drawing revision on the quotation request
- **Already covered (closed):**
  - required quote fields: rate + delivery days on both paths, GST on the email form (QT1)
  - negotiation history: every quote and re-quote stays in **All quotes**, and a new manual price
    needs a reason (QT3)

**Purchase orders** — no further work (your review): the PO number format stays as it is (P1);
the payment terms and the terms on the quotation already cover printed terms (P4); no separate
PDF, because the email is the PO. Still open: who approves when the Company Admin is away (A4).

**Store / GRN and QC**
- GRN details: shortage / excess and tolerance (ST1), serial number rule (ST2), batch / lot (ST3),
  mandatory documents (ST7)
- Store's "Not Received" confirmation (ST4)
- Reminders 3 days / 1 day **before** the due date (today it's overdue only)
- QC-hold / quarantine stock kept apart from usable stock
- Inbound logistics / Dispatch for company pickups (ST6)
- Which items need incoming QC (QC1); deviation approval (QC2); defect categories (QC3); the
  incoming checklist (QC4)

**Returns**
- Replacement vs credit note (RT1), return freight (RT2), the exchange email step (RT3), return
  challan (RT4)

**Across everything**
- Purchaser score (S5)
- Purchase dashboard (X9)
- Fraud / anomaly alerts (X5)
- The audit log beyond POs (vendor, quote, payment, GRN, QC) and the tamper-detection chain (X4)
- Budgets / cost centres (X1, X2)
- Separation-of-duties rules (X3)
- Notification channels (X7)
- Conflict-of-interest declarations (X8)

**Housekeeping**
- Retire the old RFQ Management / Vendor Bids pages; they're replaced by RFQ/PO.
- Drop old vendor fields: manual rating, category tags (V5); service matching (V7).
- General decisions (G1–G4).

**Small open UX points (from 9 Oct)**
- On the vendor's quotation email page, every template charge is listed. Should charges be added by
  choice, like terms now are?
- The PO review lists every template term. Should it show only the vendor's terms, plus an "Add"
  option?

---

# Part B — Browser test plan

## B0. Set up first (once)

- [ ] **Purchase email is configured:** Super Admin → Admin Settings → SMTP, the Purchase account.
      Without it, every email step shows "email failed", which is expected.
- [ ] **Users:**
  - a **Purchase user** (Accounts role with Purchases permission)
  - a **Company Admin**
  - a **Store Head**
  - The Company Admin can't approve what they created, so **create POs as the Purchase user**.
- [ ] **Company** (Company Admin → My Company): a **real-format GSTIN**. Note its first 2 digits
      (your state code).
- [ ] **3–4 test vendors, each with an email you can open** (for example `you+v1@gmail.com`),
      covering:
  - one with a GSTIN in **your** state
  - one with a GSTIN in **another** state
  - one with **no GSTIN**
  - All must be **approved** by the Company Admin and linked to the test items.
  - The old dev vendors with made-up GSTINs ("rahul vendor", "mahesh pvt limited") need a real or
    blank GSTIN before they can be saved again.
- [ ] **Settings:**
  - Company Admin → Purchase & Vendor Approval → **Settings**: minimum vendors per item = **2**,
    PO approval limit, for example **₹20,000**
  - Purchase & Outsource → Purchase → **Settings**: quote validity **30** days, price warning
    **10%**, a few charge names (Freight, Packing) and term names
- [ ] **Requests to work with:** PR001–PR012 already exist (test-1 company, "test unit"),
      including fabrication sizes. Raise a few more from Store / Production if needed.
- **The daily jobs** (overdue delivery 9:30, quote reminders 9:35) run once a morning. To test
  them without waiting, ask Claude to run the sweep on demand for your company (T24, T16).

**Legend:** **Where** = the page. ✓ = what you should see.

---

## Stage 1 — Masters and settings

**T1. Company GSTIN check**
- **Where:** Company Admin → My Company → edit
- [ ] A malformed GSTIN (for example `12345`) → refused: "valid GST number"
- [ ] A real-format one saves

**T2. Vendor Master — GSTIN and state** (§19) — ✅ **passed 2026-10-10**
- **Where:** Accounts → Purchases → Vendor Master → edit a vendor
- [ ] The address **State** is a dropdown of Indian states with codes. An old typed value shows
      "(please pick from the list)".
- [ ] Typing a GSTIN: a malformed one shows a red message, and Save is refused.
- [ ] A GSTIN whose first 2 digits don't match the chosen state shows an amber warning, and still
      saves.
- [ ] A valid GSTIN shows "Used to work out CGST + SGST or IGST on POs".

**T3. Vendor approvals** (§2) — ✅ **passed 2026-10-10** (incl. creating, documents, reject / resubmit, changes, suspend / blacklist / reinstate). Still to check: stages / history, and Watchlist after real deliveries.
- **Where:** Company Admin → Purchase & Vendor Approval → **Vendors**
- [ ] Reject a new vendor with a reason, then resubmit it
- [ ] Change an approved vendor's GSTIN / bank details → goes to **Vendor Changes**; the old value
      stays live until approved
- [ ] Suspend / Blacklist / Reinstate requests
- [ ] **Watchlist** and **Low Vendor Coverage** sub-tabs open

**T4. Company Admin page layout** (§15)
- **Where:** Company Admin → Purchase & Vendor Approval
- [ ] Three parent tabs: **Vendors / Purchase Orders / Settings**
- [ ] Badges add up the pending counts of their sub-tabs
- [ ] Purchase Orders has PO Approvals (with a count) and Audit Log

**T5. Permission gates**
- **Where:** Company Admin → Roles & Permissions → Accounts
- [ ] Without **"Purchase Audit Log"**, the Purchase user sees no **Audit Log** tab and no
      **History** buttons. With it, they see both.
- [ ] Without **"Purchase Settings"**, there's no Settings tab under Purchase.

---

## Stage 2 — Stock and reservations

**T6. Reservations page** (§11)
- **Where:** Store → **Reservations**
- [ ] Each item / size shows In stock · Reserved · Issued · Still to issue · Free; short items
      come first
- [ ] Clicking a row lists the orders, in claim order
- [ ] Search / type / "only short" filters work

**T7. Store transfer warning** (§10)
- **Where:** Store → Material Transfers → Pending Requests
- [ ] Each row shows "In stock X · held for earlier orders Y · free for this order Z"
- [ ] Transferring stock that's reserved for an earlier order → a **warning, not a block**
- [ ] After a transfer, the free stock on the Reservations page is right (not counted twice)
- [ ] A **defective** return re-reserves the stock for the order

**T8. Production availability** (§10)
- **Where:** Production → Process Execution → an order's material list
- [ ] "Available" = free for this order: stock minus earlier orders' claims, plus what was
      already transferred to it

---

## Stage 3 — RFQ/PO: asking vendors

**Where:** Accounts → Purchases → Purchase & Outsource → Purchase → **RFQ/PO**

**T9. Page basics** (§5, §9, §12)
- [ ] The left (items) and right (vendors) columns scroll **separately**, with no visible
      scrollbar
- [ ] Every tickable row starts **ticked** only for a vendor not yet asked about anything. A vendor with any quote, request or "can't supply" starts with nothing ticked (§21).
- [ ] **Fabrication:** one card **per size**, with a **pieces** box; kg is calculated ("≈ … kg").
      Lowering pieces below what's requested is refused.
- [ ] Clicking a quantity on a vendor row scrolls to that item card, highlights it, and focuses
      its quantity box
- [ ] The **stock button** on an item card (Stock · Reserved · Free · Incoming · Min) opens a
      popup: what each request is for, the reserving orders, and open POs bringing it in

**T10. Email quotation request** (§6, §7)
- [ ] Tick items on a vendor card → **Email quotation request** → **one** email for all items
      (check the inbox). The dialog shows the request number but **no link or Copy button**
      (§20). The link is only in the vendor's email.
- [ ] The link opens the vendor page: price, GST %, delivery and warranty per item, plus "Can't
      supply"
- [ ] **Charges** and **payment terms**: terms are added by choice ("+ Add a payment term…")
- [ ] Validity text: "Your prices will be treated as valid for 30 days"
- [ ] Submit once → the board shows the quote. A second submit is refused.
- [ ] One item marked "Can't supply" → that row shows "Not quoted by vendor"
- [ ] Tick a mix (quoted + new + expired) → Email quotation request offers **Only items that need a quote** or **All ticked items**; items not being sent are greyed out (§21)

**T11. Manual quotation with evidence** (§8, §13)
- [ ] Vendor card → tick items → **Manual quotation**
- [ ] Saving without files, a channel or a date is refused. "Other" asks you to type the channel.
- [ ] **Charges** (+ Add charge…) and **payment terms** (+ Add term…) are added by choice
- [ ] Saving creates MQ-… and quotes for every ticked item
- [ ] A new price for an item that already has this vendor's **valid** quote **asks for a reason**. Over an **expired** or old-quantity quote, no reason is asked; it's noted in All quotes (§21).
- [ ] **All quotes** shows MQ-… with 📎, the files, the reason, and the charges / terms

**T12. Quote validity** (§7)
- [ ] Set quote validity to **1 day** in Purchase Settings → older quotes show **Expired** and
      can't be ticked into a PO. Set it back to 30 afterwards.

**T13. Vendor card context + item comparison** (§17)
- [ ] Vendor card line: "No deliveries yet · Probationary" now. After Stage 5 it shows rating ·
      on time · QC pass.
- [ ] Expand an item card → **Quotes compared** below Select requests:
  - every vendor's quote is listed, cheapest first, with **Lowest** marked and the others "+n%"
  - expired and old-quantity quotes are greyed out
  - "Waiting for…" and "Can't supply…" lines appear underneath

**T14. Remind button** (§18)
- [ ] A row waiting for a reply shows **Remind** → the vendor gets an email with "Reminder:" in
      the subject
- [ ] The row then shows "reminded {date}"
- [ ] A second Remind the same day is refused: "you can send another tomorrow"

---

## Stage 4 — Creating POs and approval

**T15. PO review** (§5, §6, §13, §19)
- [ ] **Review & create PO**:
  - charges and terms are **pre-filled** from the vendor's latest quotation (email or manual)
  - GST per line
  - Bought before tag (meaningful after Stage 5)
- [ ] **GST split** under the total:
  - your-state vendor → "CGST ₹… + SGST ₹… (both in …)"
  - other-state vendor → "IGST ₹… (X → Y)"
  - a vendor with no state → "GST type unknown — fix the vendor's GSTIN / state"
- [ ] **Vendor selection check** panel:
  - only one vendor asked for an item, with 2 approved → **fails**: "1 of 2 vendors asked"
  - a cheaper vendor (on landed cost: price + GST + their charges) quoted the whole PO → fails,
    with a comparison table
  - on a fail, **reason chips are required** and the button says **Send for approval**

**T16. Direct PO** (under the limit, check passed) (§6, §15, §16)
- [ ] It's created and **emailed to the vendor** (check the inbox: lines, sizes × pieces,
      charges, terms, **CGST / SGST or IGST rows**)
- [ ] **Store** gets an "Incoming purchase order" notification
- [ ] The Company Admin sees it under PO Approvals → **Approved**, marked "Created directly"

**T17. PO needing approval** (over the limit, and/or a failed selection check) (§5, §13)
- [ ] The Purchase user sees "sent for approval" plus why
- [ ] The Company Admin card shows reason badges ("Over the ₹ limit" / "Vendor selection
      exception"), the saved check with Purchase's reason, **All quotes** and **History**
- [ ] Approving as the Purchase user who created it → refused
- [ ] Company Admin **approves** → the PO becomes real, is emailed, and Store is notified
- [ ] Company Admin **rejects** with a reason on another PO → its items are free on RFQ/PO again

---

## Stage 5 — Receiving and delivery follow-up

**T18. Due views** (§16)
- **Where:** Store → **Purchase Orders** → To Receive (and Purchase → Purchase Orders → Active)
- [ ] Chips: **All · Overdue (n) · Due today (n) · Due in 3 days (n)**
- [ ] Each line has a due badge; a PO with a late line has an **Overdue** badge

**T19. Change date** (§16)
- **Where:** Purchase Orders → expand a PO → a line → **Change date**
- [ ] A past date, or no reason → refused
- [ ] After saving: the line shows "Date changed from … to … — reason", Store gets "Delivery date
      changed", and the PO's History has "Date changed"

**T20. Receive** (existing flow + §15)
- **Where:** Store → Purchase Orders → To Receive → Receive (normal and fabrication lines)
- [ ] The status moves to Partially Received, then Received
- [ ] History: "Line received" for each line, then "Fully received"

**T21. QC and vendor history** (§17)
- [ ] Pass one QC job and fail one (or partly reject)
- [ ] The vendor card on RFQ/PO now shows **On time n/N** and **QC pass n/N**
- [ ] For a delivery received after its first promised date, a later date change does **not**
      make it on time
- [ ] **Bought before** tags now show prices (go back to T15)

---

## Stage 6 — Cancelling

**T22. Full cancel** (§14)
- **Where:** Purchase Orders → a PO with nothing received → **Cancel PO**
- [ ] The dialog shows the lines, each request as Back to RFQ/PO / No longer needed, reason chips,
      whose side, and a note
- [ ] The PO shows "Cancel requested". The Company Admin sees a **Cancellation request** card
      under Pending.
- [ ] Company Admin approves →
  - the PO is **Cancelled**
  - its requests are back on RFQ/PO
  - still-valid quotes from other vendors are back
  - with "vendor's side", this vendor's quote is **not** back
  - the vendor gets a cancellation email
  - the invoice is **Cancelled**
  - History records it
- [ ] Store can't receive a cancelled PO

**T23. Short close** (§14)
- [ ] A PO with one line received → **Cancel the rest** → approve → only the un-received line is
      cancelled (struck through); the PO is **Received**; the invoice is reduced
- [ ] A request marked "No longer needed" is closed and does **not** come back on RFQ/PO

**T24. Refused cancel + daily alerts**
- [ ] The Company Admin chooses **Keep the PO** with a reason → the PO is unchanged, and Purchase
      sees the reason
- [ ] **Overdue alert:** with a line past its date, ask Claude to run the overdue sweep → the PO
      creator gets "Delivery overdue". A second run sends nothing more.
- [ ] **Quote nudge:** with a request unanswered for 3+ days, ask Claude to run the quote sweep →
      one "Quotes to follow up" notification

---

## Stage 7 — Audit log and final checks

**T25. Audit log** (§15)
- **Where:** Purchase → **Audit Log** (with permission), or Company Admin → Purchase Orders →
  Audit Log
- [ ] Every step you did above is there, with who, role and time: created / sent for approval /
      approved / rejected / emailed / email failed / cancel asked / cancelled / short closed /
      refused / line received / fully received / date changed / delivery overdue
- [ ] Filters work: search a PO number, filter by what happened, filter by date
- [ ] Clicking a PO number shows its **History** timeline, oldest first

**T26. Nothing else broke** (quick look)
- [ ] Vendor Ratings tab: shows the same numbers as the vendor card
- [ ] Purchase Invoice page: invoices list; a cancelled PO's invoice shows Cancelled
- [ ] Vendor Payment / Payable Ageing pages still open. Their rework is on hold (A1).
- [ ] Dispatch's vendor pickups list doesn't show cancelled POs

---

**When something fails:** note the test number, what you did, and what you saw (a screenshot
helps), then bring it back. That's enough to trace it.
