# Minimum quotations per item — browser test roadmap

*Written 2026-10-29. Rules: [minimum-quotations-2026-10.md](minimum-quotations-2026-10.md); change
report §60. Automated tests already pass (8 worked cases + 11 real-handler checks). Run this with
the other client-change tests, when you're ready.*

**How to use it:** go part by part, in order — each part sets up the next. Tick a box when it
matches; when it doesn't, tell me the step number and what you saw. Note the codes you use in the
table at the end.

**Words used here**
- **Quotation** = a submitted quote with a price (email link or manual), still within the quote
  validity (Purchase Settings). Not: "can't supply", expired, still waiting.
- **Blocked** = the PO can't be made, no exception.
- **Exception** = Purchase gives a reason and the PO goes to the Company Admin.

---

## Part 0 — Set-up

Pick (or set up in Vendor Master) one purchasable item **I** with **3 approved vendors** that supply
it — **V1, V2, V3** — each with an email address. Raise / pick an open purchase request for I so it
shows on RFQ/PO.

- [ ] 0.1 RFQ/PO shows I's card; V1, V2, V3 appear on the right for it.
- [ ] 0.2 Note the current quote validity days (Purchase & Outsource → Settings): ____ days.

## Part 1 — The setting (Company Admin → Purchase & Vendor Approval → Settings)

- [ ] 1.1 A new field **"Minimum quotations per item"** below "Minimum vendors per item", with its
  explanation; it shows **1** (the default).
- [ ] 1.2 Set minimum vendors **3**, minimum quotations **4** → a red note "Can't be more than the
  minimum vendors per item (3)" and **Save is disabled**.
- [ ] 1.3 Set minimum quotations **2** → Save → "Settings saved"; reload — still 2.
- [ ] 1.4 Try to lower minimum vendors to **1** while quotations is 2 → refused (note or server
  message).

## Part 2 — The RFQ/PO item card chip

- [ ] 2.1 I's card shows **"Quotations 0 of 2"** in amber (no quotes yet).
- [ ] 2.2 With minimum quotations back at 1 (try it once, then return to 2) the chip isn't shown.

## Part 3 — Blocked: more quotations can still come

- [ ] 3.1 On **V1**'s card, add a **Manual quotation** for I (price, delivery days, GST) →
  I's chip: **"Quotations 1 of 2"** (amber).
- [ ] 3.2 V1 → tick I → **Review & create PO**. In "Vendor selection check":
  - a red box **"Can't create this PO yet — not enough quotations"** with
    "I: 1 of 2 quotations — 1 more needed; wait for the replies or ask another vendor"
  - "Quotations received: I 1/2 (more can still come)"
  - the **Create PO / Send for approval** button is **disabled** (hover says why).
- [ ] 3.3 **Email quotation request** to **V2** (don't answer yet) → reopen V1's review → still
  blocked (V2 is waiting, V3 not asked).

## Part 4 — Passes once enough quotations are in

- [ ] 4.1 Answer **V2**'s request (from the email link, or a manual quotation for V2) →
  I's chip **"Quotations 2 of 2"** (green).
- [ ] 4.2 V1 → Review & create PO → no red box; "Quotations received: I 2/2"; Create works as
  before (the cheapest-landed part of the check still applies — if V2 is cheaper, it asks for a
  reason, as today).
- [ ] 4.3 **V3 was never asked** — that doesn't matter once 2 are in.
- [ ] 4.4 *(Optional)* Don't create it yet if you want to do Part 5 on the same item; otherwise
  create the PO and use a second item for Part 5.

## Part 5 — Exception: the minimum can't be reached

Set minimum quotations **3** (vendors 3). For an item with V1's quote only:

- [ ] 5.1 Ask V2 and V3; V2 answers **"can't supply"**, V3's link **expires unanswered** (or answer
  "can't supply" for both) → the check shows "I: 1 of 3 quotations, and only 1 vendor can still
  quote" — **not** the red "can't create" box.
- [ ] 5.2 The reason list has the new **"Not enough vendors can quote"**; pick it → the button reads
  **Send for approval**, whatever the PO value.
- [ ] 5.3 The Company Admin's **PO Approvals** shows the PO with the same quotation lines and the
  reason; approve → it becomes a real PO.
- [ ] 5.4 **Only one vendor supplies an item** (an item with 1 approved vendor) → its quote →
  exception straight away (never blocked).

## Part 6 — Expired quotes don't count

- [ ] 6.1 An item with two quotes where one is **past the validity days** (an old quote, or lower
  the validity days in Purchase Settings for a moment) → the chip counts only the valid one →
  **blocked** (that vendor can be asked again) — "get a fresh quote".
- [ ] 6.2 Re-ask that vendor and answer → passes. Put the validity days back.

## Part 7 — Low Vendor Coverage (Company Admin)

- [ ] 7.1 With minimum quotations **3**, items with fewer than 3 approved vendors show the extra
  red **"Below 3 quotations — PO needs an exception"** next to the usual "n / N approved".
- [ ] 7.2 Items with enough approved vendors don't show it.

## Part 8 — Nothing else changed

- [ ] 8.1 Minimum quotations **1** → RFQ/PO and PO review behave exactly as before (no chip, no
  quotation lines, no extra blocks).
- [ ] 8.2 The "asked enough vendors" and "cheapest landed" parts of the check work as before.
- [ ] 8.3 POs already made / waiting for approval before the change are untouched.

**When done:** set the two numbers back to what the client wants (e.g. vendors 3, quotations 2).

---

## Test data used

| What | Code / name |
|---|---|
| Item I (3 vendors) | |
| V1 / V2 / V3 | |
| Item with 1 vendor (5.4) | |

## Results log

| Date | Parts done | Issues found → fix |
|---|---|---|
| 2026-10-30 | 0–4 | — |
| 2026-10-31 | 5.1–5.3 (PR055 ms pipe, rahul vendor: 1 of 3, exception "Not enough vendors can quote", Company Admin card shows the lines + reason), 8 | "only 2 vendors can still quote" counts the vendor who already quoted (reads oddly — wording change offered) |
| 2026-10-31 | 5.4 (PR056 Bairing-ucp208, sumit taken off the item → sujeet only: card "1 approved vendor — company minimum is 3", after one quote "1 of 3 … only 1 vendor" → exception, Send for approval, never blocked) | — |
| 2026-10-31 | 6.1 (MQ-0013 backdated to 28 Oct, validity 1 day → "Expired 29 Oct", chip 1 of 3; minimum 2 → "Can't create this PO yet", Create disabled) | the check box stayed green while blocked → now red when blocked (`PoReviewDialog.jsx`) |
| 2026-10-31 | 6.2 (sujeet re-quoted ₹150 incl. 18% → 2/2, no block; sumit ₹60 cheaper landed → reason + Send for approval, as before) | — |
| 2026-10-31 | 7.1 (minimum 3: every item under 3 approved vendors shows "Below 3 quotations — PO needs an exception"); §64 ticked advance (PR055 PO: "After advance" / "Waiting for advance · 2 days after" → advance paid → "Due 2 Nov") | — |
| 2026-10-31 | 7.2 (minimum quotations 2, vendors 3: 0/3 and 1/3 items show "Below 2 quotations"; every 2/3 item shows only "2 / 3 approved") — **Parts 0–8 all passed** | — |
| 2026-10-31 | §68 on PR055 (REJ-0010: one REJ, 2 lines, photos) → §65 replacement (≤ 7 Nov) → receive pre-filled 3 → QC passed → REJ Replaced, PO Received; §57, §59 passed; §66 email checked 30 Oct. Production QC §67 (J) moves to the make-or-buy browser test | reject with lines no longer needs the checklist; "View QC checklist" only when it describes the rejected pieces |

---

## Also still to check in the browser (same session is fine)

- **§57 Vendor Master form:** "Same as phone" copies Phone into WhatsApp; Entity Type list comes from
  Purchase & Outsource → Settings → Vendor entity types (add one, see it on the vendor form); no
  Status field; an approved vendor is still offered on RFQ/PO.
- **§59 RFQ/PO vendor card — Select all:** ticks / unticks every tickable item on that vendor; shows
  a dash when only some are ticked; Email quotation request / Manual quotation / Review & create
  PO use what's ticked.
- **§63 Download PO:** Purchase Orders → **Download PO** on a real order → the PDF has the logo at
  the top, the company-name watermark, every line (size, warranty, due), charges + GST adding up to
  the grand total, the stamp beside the terms; a long PO runs onto more pages. Not offered on a PO
  waiting for approval / rejected / cancelled. **Resend PO email** → the vendor's email is a short
  note with the same PDF attached. The PO's History shows "PO downloaded".
- **QC (2026-10-30) — §67, `docs/qc-rejection-photos-2026-10.md`:**
  - A purchase QC job: no inspector dropdown — **Start Inspection** makes you the inspector.
  - **Review:** each check Pass / Fail + Remarks (Fail needs one); **Save checks** with half the rows →
    log in as another QC user, open Review, finish the rest → each row shows its own "checked by".
  - Reject part of it: no photo → can't save; add 2 photos → saved; the job's History and Purchase
    Orders → QC Rejections show the failed checks + photos (Download works); after 6 pm the vendor's
    email lists the failed checks and has the photos attached.
  - A production unit step / batch step / machine Sub Child Part: Remarks on every row, Save checks,
    reject / rework with a photo (optional) → Production's process screen and Sub Child Part panel show
    the photos + failed checks next to the reason.
- **§68 QC reject breakdown:** QC Review → Fail on a delivery of more than one piece → lines (e.g.
  2 · Rust · "rust patches" · Major · 2 photos; 1 · length · "shorter by 20 mm" · Critical · 1 photo) →
  Save Decision. Purchase Orders → QC Rejections shows one block for the decision ("View QC checklist")
  with two REJs, each highlighted with its photos and its own Record answer. A one-piece job: mark a
  check Fail (or type what failed) — no lines. A job created before today shows the item's real code.
- **§66 QC results email to the vendor** (use a vendor whose email you can read): receive a PO line,
  pass it in QC (and reject part of another) → after 6 pm the vendor gets ONE email for that PO:
  accepted (with size), not accepted with QC's reason, still to come; the PO's History shows "QC
  results emailed". Nothing the next evening if QC did nothing. When the last line passes → "all
  material passed" + the payment due date.
- **§65 QC rejection replacement within a week:** QC Rejections → Record vendor's answer → "Vendor
  will replace it" → the date is already today + 7; dates after that are greyed out; today … +7 save.
- **§64 Delivery dates + due alerts** (do these on the POs you create in Parts 4–5):
  - Review & create PO with **Advance % 0** → no tick; Store → Purchase Requests shows the dates.
  - **Advance 30%, unticked** (the default) → dates from the order at once (or from the approval
    day if it went for approval); Store sees them.
  - **Advance 30%, ticked** "Vendor sends only after the advance is paid" → "Waiting for advance",
    no dates; pay the full advance in Vendor Payments → dates appear (payment day + quoted days),
    Store gets "Advance paid — delivery dates set".
  - **Alerts (next 9:30 am run):** a line due tomorrow → "Delivery due tomorrow" to the PO's creator,
    the Accounts Head and Store; a late line → "Delivery overdue" to the same people + the PO's
    History. Not repeated the next day for the same date; a PO waiting for its advance gets none.
    (Easiest: set a line's date to tomorrow with Change date, check the bell after 9:30 the next
    morning.)
