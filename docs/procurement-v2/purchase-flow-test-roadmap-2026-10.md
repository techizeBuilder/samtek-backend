# Purchase flow — browser test roadmap (fresh data, 2026-10-14)

**Why this exists:** the test plan (`remaining-work-and-test-plan-2026-10.md`, Part B, T1–T40) says
*what* to check. This doc says *with which requests, vendors and prices*, so every PO lands on the
path it's meant to test (direct, over the limit, vendor-selection exception, cancel, money,
serials). Go round by round; tick the T-numbers in the test plan as you pass them.

**Where:** Accounts → Purchases → Purchase & Outsource → Purchase
(`http://localhost:5173/accounts/purchases/purchase-outsource`), unless a step says otherwise.

---

## What was reset (2026-10-14)

**test-1 company only.** Samtek Machinery's 5 auto-reorder requests (PR019–PR023) were not touched.

| Removed | Count |
|---|---|
| Purchase requests (8 demo + 20 old test) | 28 |
| Purchase orders (8 demo + 1 pending approval) | 9 |
| RFQ/PO item cards | 13 |
| Quotes (vendor bids) | 29 |
| Quotation requests (QR-0001…0004) | 4 |
| Manual quotation MQ-0001 (+ its evidence file) | 1 |
| PO audit log entry | 1 |
| Demo purchase QC jobs | 8 |
| PO bills, payments, ledger entries, rejections, refunds/credits, serials, warranty claims, vendor score snapshots | 0 (there were none) |

**Kept:**
- vendors, vendor approvals and settings
- items and stock (the demo data never touched stock)
- notifications (old purchase notifications may point to deleted POs; ignore them)

**Backup:** every deleted record, as JSON, is in the Claude session scratchpad,
`purchase-reset-backup-2026-10-14.json`. Ask Claude if anything needs restoring.

**Good to know:**
- **Vendor history is now empty,** so every vendor starts as *No deliveries yet · Probationary*.
  The scores (T38–T39) fill in as you go.
- **The low-stock sweep runs every 30 minutes.** It re-raises "Auto reorder" requests for items
  below their minimum (NUT Bolts, Tool-A, Angle, ss sheet…). That's normal. If an auto request
  joins a card, leave it unticked under **Select requests**, or include it; either is fine.

---

## The new requests (raised through Store's bulk request, as the Store Head)

| PR | Item | Qty | Priority | Used in |
|---|---|---|---|---|
| PR006 | Tool-A | 10 pcs | Medium | PO-D |
| PR007 | Tool-A | 5 pcs | Low | PO-D |
| PR008 | NUT Bolts | 20 kg | Medium | PO-E → PO-H |
| PR009 | NUT Bolts | 30 kg | High | PO-E → PO-H |
| PR010 | ss sheet 1.5 × 1250 × 2550 | 3 pcs (114.75 kg) | Medium | PO-K |
| PR011 | ss sheet 1.5 × 1250 × 2550 | 2 pcs (76.5 kg) | High | PO-K |
| PR012 | Angle 200 × 3 × 100 | 12 pcs (11.219 kg) | Medium | PO-F |
| PR013 | Angle 20 × 4 × 10 | 6 pcs (0.068 kg) | Low | PO-F (short closed) |
| PR014 | C channel 100 × 50 × 5 × 6000 | 3 pcs (136.8 kg) | Medium | PO-A |
| PR015 | C channel 100 × 50 × 8 × 6000 | 2 pcs (141.312 kg) | Medium | PO-K |
| PR016 | ms round bar Ø8 × 254 | 20 pcs (2.004 kg) | Medium | PO-E → PO-H |
| PR017 | Bairing-ucp208 | 3 pcs | Medium | PO-L (serials) |
| PR018 | Bairing-ucp208 | 2 pcs | High | PO-L (serials) |
| PR024 | 1000w generator | 1 pc | High | PO-B |
| PR025 | 3 in 1 cleaning machine | 1 pc | Medium | PO-C (rejected; stays on the board) |

The numbers skip PR019–PR023 because Samtek Machinery uses those.

**Expected RFQ/PO cards (11):**
- Tool-A: 2 requests, 15 pcs
- NUT Bolts: 2 requests, 50 kg
- ss sheet: one size card, 2 requests, 5 pcs
- Angle: 2 size cards
- C channel: 2 size cards
- ms round bar
- Bairing: 2 requests, 5 pcs
- 1000w generator and 3 in 1 cleaning machine, each with the **low vendor warning** (only mahesh is
  approved for them; the minimum is 2)

**Vendors** (deepak vendor UK is **Blacklisted** and must never appear on RFQ/PO):

| Vendor | Supplies (approved) | GST after setup | Email |
|---|---|---|---|
| **rahul vendor** | Tool-A, NUT Bolts, ss sheet, ms round bar, Angle, C channel | CGST + SGST (Uttarakhand) | yours |
| **sujeet** | Tool-A, NUT Bolts, ss sheet, ms round bar, Angle, Bairing | **GST type unknown** (no GSTIN / state); a note, not a block | **change it first, see R0** |
| **mahesh pvt limited** | Angle, C channel, Bairing, generator, cleaning machine | IGST (Uttar Pradesh) | yours |

---

## Progress

| Round | Status |
|---|---|
| R0 setup + R1 (T1, T4–T8) | ✅ passed 2026-10-14 |
| R2 ask vendors (T9–T14) | ✅ passed 2026-10-14, incl. re-checks of §33 + §34 (T12 validity check due tomorrow) |
| R3 create POs (T15–T17) | ✅ passed 2026-10-14 (batch POs: PO-1 approved, PO-2 direct, PO-3 rejected → PO-3b approved, PO-4 approved); dashboard numbers checked; fixes §36, §37 |
| R4 receive + delivery (T18–T21) | receives done 2026-10-14 (fixes §39, §40); **QC step now by PO line (§41)** — Tool-A = one card of 25 |

---

## R0 — Set up once

1. **Restart the backend:** the routes from 13 Oct need it.
2. **Company Admin → My Company → edit (T1):**
   - type `12345` as the GSTIN → refused
   - then set **`05AABCT1234H1Z5`**
   - Today it's `07…` (Delhi) while the state is Uttarakhand, so every vendor would come out IGST.
     With `05`, rahul = CGST + SGST and mahesh = IGST.
3. **Vendor Master → sujeet:** change the email to one you can open (e.g. `rahulpramanik007007+sujeet@gmail.com`).
   - **Must do:** today it's `sujeet@gmail.com`, a real stranger's address. PO-D is emailed to the
     vendor automatically.
   - If it goes to **Vendor Changes**, approve it as the Company Admin.
4. **Purchase → Settings:**
   - quote validity: **keep 7 days** (the user's setting; it's dynamic). The R2 quotes then last 7
     days, so do R3–R7 within a week of R2. Otherwise PO-H (a re-order on rahul's R2 quotes) needs
     fresh quotes first: an expired quote can't go on a PO.
   - price warning **10%** (already)
   - add a charge label **Freight**
   - add a term or two (e.g. "Advance 20%", "Balance after QC")
5. **Company Admin → Settings:** minimum vendors **2** and PO approval limit **₹20,000** (both
   already set; just check).
6. **Accounts → Bank & Cash:** a bank or cash account for *test unit* with at least
   **₹1,50,000** balance (Round 7 pays advances and full payments).
7. **Purchase SMTP** configured (Super Admin → Admin Settings → SMTP). Without it, "email failed"
   is expected.
8. **Log-ins you'll switch between:**

   | Who | Role | Used for |
   |---|---|---|
   | Rahul Pramanik | Company Admin | approvals, settings, Management dashboard |
   | alex g | Accounts Head | Team dashboard, payments |
   | testaccountemployee@ | Account Employee #1 | most quotes and POs |
   | testaccountemployee2@ | Account Employee #2 | PO-D and PO-L, so the purchaser score has two people |
   | store head | Store Head | receive |
   | QC Head | QC Head | QC pass / fail |
   | Complaint Head | Complaint Management Head | warranty claim |

---

## R1 — Masters and stock (Stage 1–2: T1, T4–T8)

- T1 was done in R0.
- **T4:** Company Admin page layout.
- **T5:** permission gates.
- **T6–T8:** reservations / transfer warning / production availability. These don't need the new
  requests; use any order with a material list.

---

## R2 — Ask vendors (Stage 3: T9–T14), as Account Employee #1

**T9 first:** the 11 cards above, separate scrolling, the fabrication pieces box (try lowering
ss sheet below 5 pcs → refused), the stock popup.

**Get these quotes** (₹ before GST; **GST 18%** everywhere; fabrication rates are **₹/kg**):

| Item | rahul (email) | sujeet (manual) | mahesh (email) |
|---|---|---|---|
| Tool-A / pc | 400 | 450, then a new MQ at **430** (asks for a reason, T11) | — |
| NUT Bolts / kg | **110** | 120 | — |
| ss sheet / kg | **220** | 235 | — |
| ms round bar / kg | **75** | 80 | — |
| Angle 200 × 3 × 100 / kg | **70** | 72 | 75 |
| Angle 20 × 4 × 10 / kg | **70** | *not asked* | **Can't supply** (T10) |
| C channel 5 mm / kg | 65 | — | **62** |
| C channel 8 mm / kg | **60** | — | 62 |
| Bairing / pc | — | 480, warranty **12** | **450**, warranty **12** |
| 1000w generator / pc | — | — | **28,000**, warranty **6** |
| 3 in 1 cleaning machine / pc | — | — | **22,000**, warranty 12 |

**Bold** = the cheapest, so the vendor-selection check passes when that vendor is chosen.

**How to ask:**
1. **rahul → Email quotation request (T10):** tick all 8 rahul rows → one email. Fill in the
   vendor page from your inbox: charges (Freight ₹500) and a payment term.
2. **sujeet → Manual quotation (T11):**
   - First try saving with no file / channel / date → refused.
   - Then WhatsApp + a screenshot + today's date, for Tool-A, NUT Bolts, ss sheet, ms round bar,
     Angle 200 and Bairing.
   - Then a second MQ for Tool-A at 430 → it asks for a reason.
3. **mahesh → Email quotation request.** **Before filling it in**, test **Remind (T14):** the
   reminder email arrives; a second Remind the same day is refused. Then fill it in, with
   **Can't supply** on Angle 20.
4. **Tick a mix** on rahul's card (quoted + not quoted) → the "Only items that need a quote / All
   ticked items" choice (T10).
5. **T13:** expand Angle 200 → Quotes compared: rahul **Lowest**, sujeet +3%, mahesh +7%.
6. **T12** (quote validity 1 day): do it **tomorrow** at the start of the session, so today's
   quotes are a day old. Put it back to **7** afterwards.

---

## R3 — Create the POs (Stage 4: T15–T17)

**Re-planned 2026-10-14 from the real quotes after R2.** The plan above assumed prices before GST
with no charges. In reality:
- **7 auto-reorder requests joined the cards** (PR026–PR032):
  - Tool-A = 25 pcs, NUT Bolts = 70 kg, ss sheet = 10 pcs, Angle 20 = 11 pcs
  - 3 extra Angle sizes
- **Almost every price is "including GST"**, so no GST is added. Only the cleaning machine is
  +18%.
- **Each vendor has a loading charge:** rahul ₹1,000, sujeet ₹1,200, mahesh ₹3,000 + 18%.
  mahesh's ₹3,540 makes him the dearest *landed* on every shared item.
- **PO review now pre-fills the vendor's advance %** (rahul 30, sujeet 30, mahesh 25), via the
  carry-over (§34).

**Step 1: two re-quotes**, which also re-test §34. These make an IGST and a CGST + SGST PO
possible.
- **rahul → Manual quotation → NUT Bolts at ₹95, GST 18%** ("Rate already includes GST" off).
  - Reason: "rate before GST".
  - The carried loading ₹1,000 / 30% / 20 days is pre-filled: keep it.
- **mahesh → Manual quotation → Bairing at ₹450, GST 18%.**
  - Reason: "rate before GST".
  - **Remove the carried loading** (the vendor waived it). This tests that a removal sticks.

**Step 2: batch POs, one per vendor** (re-planned again 2026-10-14).

**The real flow (workflow W3):** several requests → one item card → **one PO per vendor for the
batch of items bought from them**. The earlier split of rahul's items into four small POs was only
a testing convenience, so it's dropped. A big rahul PO also covers later rounds naturally:
receiving some lines, rejections on lines, short closing the rest, and the advance.

**Landed** = price (+ GST) + that vendor's charges. **Charges / terms pre-fill** from the newest
quotation behind the PO's lines (§34–§35).

| PO | Who | Vendor | Lines (the batch) | On review | ≈ Total | Expect |
|---|---|---|---|---|---|---|
| **PO-1** | Emp #1 | rahul | ss sheet 10 pcs, NUT Bolts 70 kg, ms round bar, C channel 5 mm, C channel 8 mm | Keep 30% / 20 days. **Raise loading ₹1,000 → ₹1,500**, reason "Vendor confirmed new terms" | ₹1,11,018.02 | Over the limit **+ "Charges above quotation"** → approve. **CGST ₹598.50 + SGST ₹598.50** (NUT Bolts). Pre-filled from MQ-0004. Later: receive / QC / rejections / short close / advance. |
| **PO-2** | Emp #1 | rahul | all 5 Angle sizes | **We pick up**, delete the loading, clear the advance, reason "We pick up (no freight)". Add, then delete, the template term "full payment on receive". | ₹8,896.86 | **Direct** (T16): lower charges need only the reason. Store notified. The Admin sees "Created directly" + the changes. |
| **PO-3** | Emp #2 | mahesh | generator, Bairing, cleaning machine | — | ₹56,615 | Pre-filled from **MQ-0005** (newest; no loading). **IGST ₹4,365**. Over the limit → the **Company Admin rejects** it ("cleaning machine not needed now") → all 3 items free again. |
| **PO-3b** | Emp #2 | mahesh | generator + Bairing | Keep 25% / 35 days | ₹30,655 | Re-ordered after the rejection → over the limit → approve. **IGST ₹405**. Later: Bairing serials, generator refund. |
| **PO-4** | Emp #2 | sujeet | Tool-A 25 pcs @ 430 | Clear the advance, reason "Negotiated at order time" | ₹11,950 | **The vendor check fails** (rahul ₹11,000 landed) → selection reason + the terms reason → approve. |
| *(own PO)* | Company Admin | mahesh | cleaning machine | — | ₹29,500 (its quote is on MQ-0002, so loading ₹3,000 + 18% pre-fills) | The Admin creates it, tries to approve → **refused** (nobody approves their own PO) → reject. **Not testable in the browser (2026-10-15):** the Company Admin has no RFQ/PO page and can't create a PO (only the Accounts roles can), so nobody normally holds both roles. The rule is in the server (`poApprovalController.reviewPOApproval`, refuses with 403 "You can't review a PO you created yourself") and was checked with a test on 2026-10-15 instead. |

**Left on the board on purpose:**
- the cleaning machine (dashboard "items to buy")
- mahesh's unanswered **QR-0002** (Angle 50×5×6000), for the quote-reminder sweep (T24)

**Not testable with this data:** "1 of 2 vendors asked"; "GST type unknown" (sujeet's prices
include GST).

**Rounds R4–R9 below still name the old split POs.** They'll be re-planned on PO-1…PO-4 when we
get there.

---

## R4 — Receive and delivery (Stage 5: T18–T21)

**Re-planned 2026-10-14 on the real POs, in the real order.** A PO becomes real → emailed + Store
notified + its bill made → (the advance paid, if any: that sets the dates) → Store receives → QC.

**Store's Receive is not blocked by an unpaid advance** (user): the advance only starts the date
count.

| PO | Advance | Dates | This round |
|---|---|---|---|
| PO-2 rahul Angles (5 lines) | none | due 16 Oct | **Receive 3 lines** (50×5×6000, 200×3×50, 200×3×100) + QC pass. **Leave 100×2×100 and 20×4×10** for the short close in R5. |
| PO-4 sujeet Tool-A (1 line, 3 requests 10 + 5 + 10) | none | due 17 Oct | **Change date** first (T19), then receive all 25 with the vendor's invoice no. + a lot number. QC: pass 2 jobs, reject 2 pcs on the third (severity **Major**); its answer is in R7. |
| PO-1 rahul main / PO-3b mahesh | 30% / 25% | "Waiting for advance" | Nothing yet. R7 pays the advances (dates set), then receives them (PO-3b = serials, R9). |

- **T18:** Store's chips (Due in 3 days = 2), line badges; the advance POs show "After advance"
  and aren't counted.
- **T19:** PO-4 → Change date:
  - past date / no reason → refused
  - 17 → 20 Oct "vendor short on stock" → the line shows the change, Store notified, History
- **T20:** receive.
  - **PO-2:** fabrication pieces pre-filled; Partially Received.
  - **PO-4:** split 10 / 5 / 10 across its requests; "Received"; the vendor invoice no. shows on
    the line; the lot shows on Serial Numbers.
- **T21:** QC.
  - **Results:** pass / part-reject → REJ "Awaiting vendor answer", the creator notified, no
    vendor email.
  - **Afterwards:**
    - the vendor cards show on time / QC
    - Bought before shows Angle and Tool-A prices
    - Vendor Payment shows PO-4's QC-passed material as payable

---

## R5 — Cancelling (Stage 6: T22–T24)

- **T22, PO-E, full cancel:**
  - both requests **Back to RFQ/PO**, reason on **our side**
  - the Company Admin approves
  - **expect:**
    - PO Cancelled
    - NUT Bolts and ms round bar back on the board, **with rahul's quotes**
    - a cancellation email
    - Store can't receive it
- **T23, PO-F, short close:**
  - Cancel the rest → Angle 20 marked **No longer needed** → approve
  - **expect:**
    - Angle 20 struck through
    - PO **Received**
    - PR013 closed and **not** back on the board
- **T24, PO-B, cancel request:**
  - the Company Admin chooses **Keep the PO** with a reason
  - **expect:** the PO is unchanged, and Purchase sees the reason
- **T24, the sweeps:** ask Claude to run the overdue sweep (9:30) and the quote sweep (9:35) on
  demand.

---

## R6 — Audit log (Stage 7: T25–T26)

Everything from R3–R5 should be in the audit log, with who and when. The filters work, and
**History** opens from the PO number.

---

## R7 — Money (Stage 8: T27–T34)

**PO-H, the main money PO** (T27–T32 and T34):
- **Create it.** Emp #1 re-orders from rahul: NUT Bolts (PR008+009) + ms round bar (PR016),
  with **Advance 20%**, **Credit days 15** and **Freight ₹500**. It's direct (≈ ₹7,260).
  - If rahul's R2 quotes are more than 7 days old, they show **Expired**. Re-quote first (a manual
    quotation at the same prices is quickest; no reason is asked over an expired quote).
  - **T27:** the helper texts, "After advance", the PO email says "N days after advance", and the
    credit warning line.
- **T28:** Vendor Payment → rahul → PO-H:
  1. pay **part** of the advance → no dates yet
  2. pay the **rest** → the dates are set, a toast shows, and Store is notified
- **T29:** Store receives NUT Bolts with the **vendor's invoice** (number + date + scan).
  - It's a **kg / no-warranty line**, so it asks for one **lot number**. That is T36's lot case.
- **T30:** QC passes NUT Bolts → "QC-passed material (up to ₹…)" → pay part of it.
- **T31, Credit:**
  1. Receive ms round bar (20 pcs). QC **rejects 2 pcs** (severity **Minor**), then passes the
     rest.
  2. Record the answer as **Credit** → the bill drops, and "Credit available" appears.
- **T32:**
  - the PO becomes **Payable**, due today + 15
  - pay the full payment, **ticking "Pay from the vendor's credit"** for the credit part
  - **expect:** Paid, and Payable Ageing is right
- **T34:** the Ledger accounts. For PO-H, Advance to Vendors and Payable end at 0.

**PO-B, Refund:**
1. Pay the advance (₹6,608).
2. Store receives the generator. It asks for **1 serial** (warranty 6 quoted).
3. QC **fails** it fully (**Critical**).
4. Answer **Refund** → **Refund due** → **Refund received…** (bank, date, reference) →
   Refunded.

**PO-K, cancel after the advance (T33):**
1. Pay the advance (≈ ₹11,931).
2. Receive + pass the **C channel 8 mm** line.
3. Short close the ss sheet line (requests **Back to RFQ/PO**); the Company Admin approves.
4. **Expect:** the bill drops to the C channel line, and the extra advance shows as **To decide**
   → pick **Keep as credit** (or **Vendor refunds it**).

**PO-D, Refused** (do this last in R7; it puts sujeet on the Watchlist):
1. Receive Tool-A (15 pcs). QC rejects 2 (**Major**).
2. Answer **Refused** (a note is needed).
3. **Expect:** sujeet shows **Watchlist** on RFQ/PO and Vendor Ratings ("Refused to replace or
   refund…").

**PO-L, Replace:** done with serial numbers in R9.

---

## R8 — Price History (T35)

C channel, NUT Bolts and Angle now have deliveries. Check:
- the periods
- the vendor filter
- the Bought before pop-up matching the page

---

## R9 — Serial numbers and warranty claims (T36–T37)

**PO-L, Bairing, 5 pcs** (2 requests: 3 + 2):
1. **Store → Receive (T36):**
   - asks for **5 serials**: Fill a range `BRG-` 0101 to 0105
   - try a repeat → red
   - warranty card: try **"A card for each piece"** with one missing → refused; then **"One card
     for all"**
2. **Serial Numbers tab:**
   - **expect:** 5 serials, **In QC**, vendor mahesh, warranty 12
   - the item master's own warranty is unchanged
3. **QC → the PR017 job → Fail:**
   - tick **BRG-0101**, severity **Minor** → "1 will be rejected, 2 stay in QC"
   - **Pass** → the other two Accepted
4. **Pass the PR018 job.**
5. **QC Rejections → BRG-0101's REJ (T31, Replace):** answer **Will replace** + date.
   - Store receives the replacement with serial **BRG-0106**. Try **BRG-0102** first → refused
     (already received).
   - QC passes it → the rejection becomes **Replaced**.
6. **T37, as the Complaint Head:** Complaints → Support → **Vendor Warranty Claims** → New → serial
   `BRG-0103` → Find.
   - **Raise:** a problem, a photo, the date told → VWC-0001.
   - **Then:** the vendor's response → close with an outcome + 4 ★.
   - **Check:** an unknown serial and a future date.

---

## R10 — Scores and dashboard (T38–T40)

**T38, the vendor score:**
- **Vendor Ratings:** rahul, mahesh and sujeet now have real events.
- **Expected shape:**
  - **sujeet:** low Quality (a Major reject + Refused)
  - **mahesh:** a Critical reject (generator) + a Minor serial reject, but good prices
  - **rahul:** one Minor reject, on time
- **Limited history** shows for vendors with fewer than 5 deliveries / QC checks.
- **Settings:** weights, then **Watchlist below 99**, then back to 60.

**T39, the purchaser score:**
- **Company Admin → Purchasers:** **two** purchasers (Emp #1 and Emp #2).
- **Emp #2 (PO-D):** **Policy 50** (selection exception).
- **sujeet's MQs:** Completeness. A manual quote without payment terms → 75.
- **As Emp #1:** Purchase → **My Score** shows only their own.

**T40, the dashboard:**
- **Emp #1, My work:**
  - items to buy: the cleaning machine (after PO-C) and ss sheet (back from PO-K), plus any auto
    reorders
  - their own POs, deliveries and score
- **alex g, Team:** payments, refunds, vendors to watch (sujeet).
- **Company Admin, Management:** purchase value, savings, the exceptions (1, "PO-D"), and the top 3
  vendors.

---

**When something fails:** note the round + T-number, what you did, and what you saw (a screenshot
helps). Bring it back; that's enough to trace it.
