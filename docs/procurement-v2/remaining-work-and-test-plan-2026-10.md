# Procurement v2 — what's left to build, and the browser test plan

- **Started:** 2026-10-10
- **Updated:** 2026-10-13

**Where things stand (2026-10-13):**
- **The purchase flow is complete:** change report §1–§32; the last build was the Purchase Dashboard
  (§32).
- **Next, in the user's order:**
  1. **browser testing** (Part B, T1–T40)
  2. then **the outsource flow**
- Everything passed code-level and database tests, but **none of it has been clicked through in the
  browser yet.**
- Part A records what was built and what was left out on purpose.
- Part B is the test plan, in order. Each test builds on the ones before it, so go top to bottom.

Detail for every change is in `procurement-v2-changes-2026-10.md` (§ numbers below point there).
Open questions are in `procurement-workflow-2026-10.md` §9 (27 open, 63 resolved). Those left are
optional ("only if the client asks") or belong to the outsource flow.

**Update 2026-10-12:** the Accounts work (A1) is **built** (change report §22–§25). Its browser
tests are **Stage 8 (T27–T34)** — do them after Stages 1–7, end to end.

**Update 2026-10-14:**
- test-1's purchase data was cleaned and 15 new requests raised
- the test roadmap is **`purchase-flow-test-roadmap-2026-10.md`**: rounds R0–R10, with a vendor
  and price for every PO

**Update 2026-10-13:**
- serial numbers at receive (change report §28) → **T36**
- vendor warranty claims (§29) → **T37**
- the vendor score out of 100 (§30) → **T38** (Technical dropped by the user)
- the purchaser score (§31) → **T39**
- the Purchase Dashboard (§32) → **T40**
- budgets, cost centres and separation-of-duties rules: **not built** (user)
- **the purchase flow is complete**; next is browser testing, then the outsource flow

---

# Part A — What's left to build

## A1. Accounts — built 2026-10-12

The client answered; the design is in **`accounts-bill-ledger-payments-2026-10.md`**, and the build
is in change report §22–§25. Built:
- the PO bill
- the advance (delivery days start when it's paid)
- QC pass → payable
- an optional mid payment
- full acceptance → due date by credit days
- the overdue sweep
- QC rejections settled by the vendor's answer (replace / refund / credit / refused)
- refunds and vendor credit
- cancel on the new bill
- a real purchase ledger per company + unit
- the vendor invoice number at receive
- TDS removed

Still open:

| Item | What it is |
|---|---|
| **Credit limit at PO time** | Today a warning at ≥ 70%; block or not (AC6). |
| **Payment approvals** | Requested → Approved → Scheduled → Paid — skipped by decision (Q8). Revisit if the client asks. |
| **Bills with no PO** | Stays as the manual "Record New Bill"; revisit with the outsource flow. |

## A2. After the core flow — where everything stands (2026-10-13)

**Built 2026-10-13:**
- **Serial numbers** at receive (§28)
- **Vendor warranty claims** (§29)
- **The vendor score:** out of 100, blueprint weights (§30)
- **The purchaser score** (§31)
- **The Purchase Dashboard:** three role views (§32)

**Dropped / not built (user):**
- technical pass / fail (S3)
- budgets / cost centres (X1, X2)
- separation-of-duties rules (X3)
- QC quarantine / hold stock (probably not needed: a rejection already reaches Purchase as a
  quantity to settle)

**Parked ("keep them for now", user):**
- return freight (RT2)
- a return challan (RT4)
- "due in 3 days / tomorrow" notifications: only the on-page chips and the overdue alert exist

**With the outsource flow:** job work / services (G3, V7), and bills with no PO.

The lists below are the original backlog by area, kept for reference. Anything not marked built is
**optional**: only if the client asks.

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
- **Vendor score:** **built (§30)**: the blueprint's weighted score, out of 100 (S1, S2, S4, S6).
- Technical pass / fail on a quote (S3): **dropped** (user)
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
- Serial numbers (ST2) and lot records (ST3): **built (§28)**
- GRN details: shortage / excess and tolerance (ST1), mandatory documents (ST7)
- Store's "Not Received" confirmation (ST4)
- Notifications 3 days / 1 day **before** the due date. Today: the "Due today / Due in 3 days" chips and due badges on Store and Purchase, plus the overdue alert.
- QC-hold / quarantine stock kept apart from usable stock
- Inbound logistics / Dispatch for company pickups (ST6)
- Severity on a QC fail (QC3): **built (§30)**
- Which items need incoming QC (QC1); deviation approval (QC2); the incoming checklist (QC4)

**Returns**
- Built 2026-10-12 (§24): the vendor's answer on a rejection (RT1 resolved); no automatic exchange
  email (RT3 dropped)
- Still open: return freight (RT2), return challan / gate pass (RT4)

**Across everything**
- Purchaser score (S5): **built (§31)**
- Purchase dashboard (X9): **built (§32)**
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
- ~~On the vendor's quotation email page, every template charge is listed. Should charges be added by
  choice, like terms now are?~~ **Yes (user, 2026-10-14), built: change report §33.**
- ~~The PO review lists every template term. Should it show only the vendor's terms, plus an "Add"
  option?~~ **Yes (user, 2026-10-14), built: change report §35.** A change from the quotation's
  charges / terms also needs a reason now.

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
- [ ] **Requests to work with:** the purchase data was **reset on 2026-10-14**, with 15 fresh
      requests (PR006–PR018, PR024, PR025). **`purchase-flow-test-roadmap-2026-10.md`** says which
      request goes on which PO, at which price, for each test. Follow it round by round.
- **The daily jobs** (overdue delivery 9:30, quote reminders 9:35) run once a morning. To test
  them without waiting, ask Claude to run the sweep on demand for your company (T24, T16).

**Legend:** **Where** = the page. ✓ = what you should see.

---

## Stage 1 — Masters and settings

*(2026-10-14: T1, T4–T8 ✅ passed (roadmap slice 1); T9–T11, T13, T14 ✅ passed (slice 2), with
fixes §33 and §34; T12 is due 2026-10-15. T15–T17 ✅ passed (slice 3, batch POs), with fixes
§35–§37; the Purchase Dashboard numbers were checked against them.)*

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
- [ ] Vendor Payment / Payable Ageing pages open (rebuilt 2026-10-12; tested in Stage 8).
- [ ] Dispatch's vendor pickups list doesn't show cancelled POs

---

**When something fails:** note the test number, what you did, and what you saw (a screenshot
helps), then bring it back. That's enough to trace it.

---

## Stage 8 — Money: advance, QC, rejections, payments (accounts, built 2026-10-12)

Do these with **one fresh PO**, end to end:
- 2 lines, under the approval limit
- **Advance 20%, Credit days 15**
- a freight charge

Before you start, check that a bank / cash account with enough balance exists (Accounts → Bank &
Cash).

**T27. Placing the PO** (§22)
- [ ] PO review: the Advance % note says "delivery days start when it's paid". The Credit days note
      says "after everything is received + QC-passed; blank = pay straight away".
- [ ] Purchase Orders and Store → To Receive:
  - Expected shows **"After advance"**
  - the Payment column shows **"Advance due"**
  - each line shows **"Waiting for advance · N days after"**
  - no Overdue chips count it, and there's no "Change date"
- [ ] The vendor's PO email says **"N days after advance"** instead of a date.
- [ ] Store's notification says the dates are set when the advance is paid.

- [ ] **Credit warning** (§26): at PO review the vendor line reads "Unpaid to {vendor}: ₹X of ₹Y
      credit limit". X = what's already payable and unpaid (not this PO, not material still on
      order). Check it before and after the payments below.

**T28. Paying the advance** (§22)
- [ ] **Vendor Payment** → the vendor → the PO card shows: Advance 20% (₹0 of ₹X paid), QC-passed
      so far ₹0, full payment "15 days after everything passes QC", Can pay now: advance ₹X.
- [ ] "QC-passed material" isn't offered. Paying more than the advance is refused.
- [ ] Pay **part** of the advance → the dates are still empty.
- [ ] Pay the **rest** → a toast says the delivery days start today.
  - Purchase Orders / To Receive show real dates
  - Store gets "Advance paid — delivery dates set"
  - History shows "Advance paid"
- [ ] **Recent payments** lists both, marked Advance.

**T29. Receiving with the vendor's invoice** (§25)
- [ ] Store → Receive line 1 → fill **Vendor's invoice**: number, date, attach a scan.
  - A date without a number is refused.
  - The line then shows "Vendor invoice SS/… (date)", linked to the scan.

**T30. QC pass → payable; optional mid payment** (§23)
- [ ] QC passes line 1 → Vendor Payment shows **"QC-passed material (up to ₹Y)"**, where Y = that
      line's value less 20%.
- [ ] Paying more than Y is refused. Pay part of it.

**T31. QC rejection → the vendor's answer** (§24)
- [ ] Receive line 2. QC **rejects part** of it (Reject Quantity), then passes the rest.
  - **No** email goes to the vendor.
  - The PO's creator is notified.
  - **Purchase Orders → QC Rejections** shows REJ-… "Awaiting vendor answer", with the badge
    count.
- [ ] The bill is **not** fully accepted yet: Purchase Invoice still shows "Awaiting material".
- [ ] Record the answer. Try each on separate POs if you can:
  - **Replace** (a date is needed) → a replacement is expected on the same line. Store receives it
    with the normal Receive button, QC passes it, and the rejection becomes "Replaced".
  - **Refund** → the bill drops. Vendor Payment → **Refunds & credits** shows "Refund due". Use
    "Refund received…" (account, date, ref) → Refunded.
  - **Credit** → the bill drops. "Credit available". On a later payment to this vendor, tick
    **"Pay from the vendor's credit"** → no bank needed → "Credit used".
  - **Refused** (a note is needed) → the bill drops. Vendor Ratings / RFQ-PO show the vendor on
    **Watchlist**.
- [ ] A replacement that never came: **"Change answer"** to refund / credit / refused.

**T32. Full acceptance and full payment** (§23)
- [ ] When everything is in and passed and no rejection is open:
  - the bill becomes **Payable**, due **today + 15**
  - Accounts gets "Purchase ready for full payment"
  - History shows "Fully accepted"
- [ ] Vendor Payment offers **"Full payment (up to the balance)"** → pay it → bill and PO **Paid**.
- [ ] **Payable Ageing** shows it in the right box before and after paying.
- [ ] Overdue: either wait past the due date, or ask me to run the 9:40 sweep. The PO shows
      Overdue and Accounts gets one notification.

**T33. Cancel after the advance** (§24)
- [ ] A new PO with an advance. Pay it. Receive + pass one line, then **short close** the rest
      (Company Admin approves).
  - The bill drops to the received line.
  - The extra advance shows in Refunds & credits as **"To decide"** → "Vendor refunds it" or
    "Keep as credit".
- [ ] A line waiting for a replacement can't be short closed.

**T34. The ledger** (§22–§25)
- [ ] **Accounts → Ledger**: pick **Advance to Vendors**, **Accounts Payable**, **Input CGST /
      SGST** (or IGST), **Purchase**, **Vendor Refund Due**, and your bank account.
  - Every purchase entry shows the vendor's name.
  - For a PO that's fully paid, Advance to Vendors and Accounts Payable are back to 0 (as far as
    that PO is concerned).
- [ ] **Record New Bill** (no PO): there's no TDS row. A payment for more than that vendor's
      no-PO bills owe is refused.
- [ ] Vendor Master: the TDS Section field is gone.

**T35. Price History** (§27) — after some deliveries exist
- [ ] **Purchase → Price History** and **Company Admin → Vendors → Price History**: pick an item.
  - The periods 7 days / 30 days / 1 year / All / Custom change Average, Last and Lowest, the
    per-vendor table and the deliveries list.
  - Picking a vendor (or clicking one in the table) narrows to them.
- [ ] An item bought in two units shows a unit picker. The prices are never mixed.
- [ ] The **Bought before** pop-up (RFQ/PO tag, PO review, Company Admin PO card) has the same
      period chips. Its numbers match the Price History page for the same period.

**T36. Serial numbers at receive and QC** (§28)

You need a PO line for an item counted in **Pieces**, quoted **with a warranty**, and ideally 2
requests on it.

- [ ] **Store → To Receive → Receive:** the box asks for **one serial per piece** and shows "0 of N
      entered".
  - [ ] **Fill a range** (`GEN-`, 0101 to 0105) adds 5.
  - [ ] Typing a repeat shows it in red. A wrong count is refused.
- [ ] **Warranty card:**
  - [ ] "One card for all" with one file works.
  - [ ] "A card for each piece" asks for a file per serial and refuses if one is missing.
- [ ] **After receive:** **Serial Numbers** tab lists each serial with the vendor, PO, received date,
      warranty months, card and **In QC**.
  - [ ] The item master's own serial / warranty are unchanged (Inventory → the item).
- [ ] Receiving the **same serial again** for that item (another PO) is refused.
- [ ] **A kg / no-warranty line** still asks for one serial / lot number. It shows as a **Lot** in
      the tab.
- [ ] **QC → that job → Fail:**
  - [ ] Shows the serials as tick boxes; tick 1 → "1 will be rejected, N−1 stay in QC".
  - [ ] The serial shows **QC rejected** with its REJ in the tab, and the result banner lists it.
  - [ ] Then **Pass** → the rest **Accepted**.
- [ ] **A lot job:** Fail still asks for a quantity. The tab shows **Part rejected** and how much.

**T37. Vendor warranty claims** (§29) — after T36, so a serial exists

As the Complaint Management Head (or the Company Admin):

- [ ] **Complaints → Support:** **Vendor Warranty Claims** is beside "+ Create Ticket". It opens the
      list (Open by default).
- [ ] **New claim → type a serial from T36 → Find:** shows the item, vendor, PO, received date and
      warranty months (and the card).
  - [ ] Fill in the problem, defect type, severity, the date the vendor was told and a photo →
        **Raise claim** → `VWC-0001`, **Waiting for vendor**.
  - [ ] The PO's creator gets a notification.
- [ ] **New claim → an unknown serial → Find:** "Not in our serial records".
  - [ ] Pick a vendor and an item. The months shown are the item's warranty.
- [ ] **Refused:** a future date, or no problem text.
- [ ] **Open the claim → vendor's response** (date + text) → Save → **Vendor responded**, "Responded
      in N d".
- [ ] **Close it:**
  - [ ] Picking an outcome asks for the stars; saving without them is refused.
  - [ ] With 4 ★ → **Closed**, and the history shows each step.
  - [ ] A closed claim has no edit fields.
- [ ] **Find the same serial again:** "Earlier claims on this serial: VWC-0001 (Repaired)".
- [ ] **Store → Serial Numbers:** the unit shows "1 warranty claim · VWC-0001 Repaired".
- [ ] **Purchase → Vendor Ratings:** the vendor shows "Warranty claims: … ★ handling", and its
      Warranty bar uses the claim (T38).

**T38. Vendor score** (§30) — best after Stage 8 and T36–T37, when deliveries / QC / claims exist

- [ ] **Purchase → Vendor Ratings:**
  - [ ] each vendor shows a **score / 100** (coloured), its status, and six bars (Price, Quality,
        Delivery, Credit terms, Warranty, Response) with each part's %
  - [ ] "How the vendor score is worked out" shows the current weights
- [ ] **Expand rahul vendor** (demo data): each part's events are listed — deliveries with promised
      date and days late, QC results with accepted / rejected, prices vs the lowest, PO terms,
      quotation replies.
  - [ ] The bars match the tables.
- [ ] **QC → a purchase job → Fail:** the **Severity** pick (Minor / Major / Critical) shows.
  - [ ] Reject part as **Critical**: QC Rejections shows "Critical", and the vendor's Quality drops
        more than for a Minor one.
- [ ] **A replacement received a day after its replacement date:** Delivery shows "(replacement)"
      1 day late, not judged against the original date.
- [ ] **Company Admin → Settings → Vendor score:**
  - [ ] change the weights: the total must be 100, or Save stays off
  - [ ] save, then Vendor Ratings uses the new weights
  - [ ] "Blueprint defaults" puts 25 / 30 / 20 / 10 / 10 / 5 back
- [ ] **Set "Watchlist below" to 99:** a vendor with enough history goes on **Company Admin →
      Vendors → Watchlist** with "Vendor score … (below 99)" and the part breakdown.
  - [ ] Vendor Master shows the reason. Put it back to 60.
- [ ] **RFQ/PO vendor card:** "NN/100 · On time … · QC accepted …%". "Best vendor score" sorts by it.
- [ ] A vendor with fewer than 5 deliveries / QC checks shows **Limited history** (and `*` on the RFQ/PO
      card) and isn't put on the Watchlist by its score.

**T39. Purchaser score** (§31) — after the earlier stages, so POs / quotes / QC exist

- [ ] **Company Admin → Purchase & Vendor Approval → Purchasers → Purchaser Score:**
  - [ ] each person who made POs or quotations shows their month score, 12-month score and nine bars
  - [ ] the month picker changes them
  - [ ] "How the purchaser score is worked out" switches English ↔ Hinglish
- [ ] **Click a purchaser:**
  - [ ] the 6-month trend and the Month / 12-months switch
  - [ ] each part's table lists its events:
    - POs with vendors asked
    - manual quotations with what's missing
    - chosen vs cheapest
    - missed due dates with what happened
    - QC results
    - emailed / evidence
    - rejected or cancelled POs
    - rejection answers
    - exceptions
- [ ] **Check a few rows against the real records:**
  - [ ] a PO that needed a selection exception → Policy 50
  - [ ] a manual quotation without payment terms → Completeness 75
  - [ ] a line where you recorded a new date the day after it was due → Follow-up 100
- [ ] **Log in as a purchaser (not the Company Admin):**
  - [ ] Purchase → **My Score** shows only their own
  - [ ] the Company Admin's Purchasers tab isn't available to them
- [ ] **Company Admin → Settings → Purchaser score:** change a weight (the total must be 100), save,
      and the scores use it. "Blueprint defaults" resets.

**T40. Purchase Dashboard** (§32) — last, when the earlier tests have left real data behind

- [ ] **As an Account Employee:** Accounts → Purchases → **Purchase Dashboard** (first in the menu)
      shows **My work**:
  - [ ] the tiles: items to buy, my quote requests, quotes expiring, my POs, my deliveries, QC
        rejections, replacements, my score
  - [ ] the numbers match what you know you created, e.g. a PO you sent for approval → "1 waiting
        for approval"
  - [ ] a line waiting for its advance isn't counted as due
  - [ ] clicking a tile opens the right place (RFQ/PO, Purchase Orders, QC Rejections, My Score)
- [ ] **As the Accounts Head:** **Team** view, plus a **My work** switch.
  - [ ] **Team tiles:**
    - waiting for the Company Admin
    - Store & QC
    - 3-vendor compliance
    - warranty claims
    - payments (advances due / payable now / overdue)
    - refunds due
    - vendors to watch
    - team scores
  - [ ] the payments total matches Vendor Payment / Payable Ageing
- [ ] **As the Company Admin:** Purchase & Vendor Approval **opens on Dashboard** (Management).
  - [ ] **"Waiting for you":** PO approvals (over limit / selection), cancellations, vendor requests.
        Clicking one jumps to that tab on the same page.
  - [ ] **The period picker** (This month / 3 months / 12 months) changes:
    - purchase value and the 6-month trend
    - savings
    - price rises
    - the top 3 vendors
    - compliance
    - exceptions
  - [ ] vendor risk, payables, purchaser scores
- [ ] **An Account Employee can't get the Team or Management view** (the page only shows My work).
