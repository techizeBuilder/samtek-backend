# QC results email to the vendor — logic

*Written 2026-10-29 (client change). **BUILT 2026-10-29** — change report §66. Decided with you: one summary per PO per day; rejected material
included as "not accepted"; money only as the payment due date on the "all passed" email.*

## Why

The vendor hears nothing today when QC checks their material — not a pass, not a reject (Purchase
phones about rejections and records the answer in QC Rejections). The client wants the vendor told
when material passes. Two traps:

- **Per item** → too many emails (an 8-line PO = 8 emails in an afternoon).
- **Only when the whole PO passes** → a partial delivery waits weeks for any word.

## The rule

**Once a day (6 pm), for each PO with QC results the vendor hasn't been told about yet → one email to
the vendor.** No results → no email. Never more than one per PO per day.

**"Results not yet told"** — since this feature went live (results before it are never emailed):

| Result | Where it comes from | Shown as |
|---|---|---|
| **Passed** | a QC job of the PO that QC passed (the moment its value went on the bill) | ✅ Accepted — item, size, qty |
| **Not accepted** | a QC rejection (REJ-…) of the PO | ❌ Not accepted — item, size, qty, QC's reason, "our Purchase team will contact you about it" |

A partial pass gives both lines (e.g. 8 accepted, 2 not accepted). A replacement that passes shows as
"Accepted (replacement)".

**"Not yet told"** = each result is stamped when its email goes out, so it's never sent twice. If the
email can't go (Purchase mailbox not set up, mail server down) nothing is stamped — tomorrow's email
carries it. A vendor with no email address: nothing is sent or stamped.

**Each email also shows "Still to come / with QC on this PO"** — the live lines not yet received and
QC-passed (cancelled lines left out), so the vendor sees where the PO stands.

**The last one:** when the PO becomes **fully accepted** (everything received and QC-passed, no
rejection still waiting for an answer or a replacement — the same moment the full payment falls due
today), that day's email says **"All material on PO … has passed QC"** and, when there's something
left to pay, **"Payment is due by <date> (n credit days)"** or "Payment will be processed now" (no
credit days). That line goes once per PO.

**No amounts** anywhere else — no item values, no totals.

**What doesn't change:** QC itself, the bill, the ledger, QC Rejections (Purchase still records the
vendor's answer), Purchase / Store notifications.

## Worked example (one PO, 3 lines: Bolt 100, Angle 6 m × 20 pcs, Bearing 40)

| Day | What happened | 6 pm email |
|---|---|---|
| Mon | Bolt received; QC passes 100 | ✅ Bolt 100 accepted. Still to come: Angle, Bearing |
| Tue | Angle received; QC passes 18, rejects 2 (dent) | ✅ Angle 18 accepted · ❌ Angle 2 not accepted — dent. Still to come: Bearing (+ Angle replacement if the vendor replaces) |
| Wed | nothing checked | — none — |
| Thu | Bearing passes 40 in the morning, replacement Angle 2 passes in the afternoon | one email: ✅ Bearing 40 · ✅ Angle 2 (replacement). **All material passed — payment due by 28 Nov (30 credit days)** |
| Fri | mail server down at 6 pm | nothing stamped |
| Sat | — | Friday's results (if any) go out now |

## Build plan (after you agree)

**Backend**
1. Stamps: QC job `acceptance.vendorMailedAt`; PurchaseRejection `vendorMailedAt`; PO bill
   `fullyAcceptedMailedAt`.
2. `services/qcVendorEmailService.js` — `runQcVendorEmailSweep(now)`: gathers each PO's untold passes
   (QC jobs with `acceptance.postedAt` since go-live and no `vendorMailedAt`) and rejections, the
   still-to-come lines and the fully-accepted line; sends; stamps only what went.
3. `emailService.sendQcResultEmail(...)` — the email (Purchase mailbox).
4. Cron 18:00 daily (index.js). Each send in the PO's History ("QC results emailed to the vendor").

**Frontend** — none needed (the PO History shows the emails).

**Tests (made-up company, fake vendor email domain, a test mailer so nothing really goes out):** the
worked example day by day; a pass + reject the same day = one email; run twice = nothing repeated;
mail fails → nothing stamped → next run sends; results before go-live never sent; fully accepted
line once, with the due date; no vendor email → skipped.
