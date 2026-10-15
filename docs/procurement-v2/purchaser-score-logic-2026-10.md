# Purchaser score — how it's worked out

- **Date:** 2026-10-13
- **Status:** **built 2026-10-13** (change report §31). **Not yet clicked through in the browser**
  (test plan T39).
- **Code:** `server/services/purchaserScoreService.js`. It reuses helpers from
  `vendorScoreService.js`.
- **Blueprint:** §13 Purchaser Performance Score.
- **Companion:** `vendor-score-logic-2026-10.md` (the vendor score works the same way).

This doc explains the logic, so it can be checked or changed later.

---

## 1. What it is

A number **out of 100** for each person who buys: how well they followed the purchase process.
It's worked out from what's already recorded. **Nothing is typed in** (user decision: all 9 parts
automatic).

The blueprint's rules for it:
- it "should measure process quality, not simply how cheaply the purchaser buys"
- **never reward a purchaser solely for selecting the cheapest vendor.** Price is only 15 of the
  100 points; quality outcome and follow-up weigh the same.
- it should include exceptions, emergency purchases, single-source purchases, late follow-ups, PO
  changes and unresolved vendor issues (all covered below)
- "visible to authorized management, with evidence behind every score"

## 2. Who is "the purchaser"

The person who **created** the record:

| Record | Belongs to |
|---|---|
| A PO | its creator (`Purchase.createdBy`) |
| An email quotation request (QR-…) | its sender (`QuotationRequest.createdBy`) |
| A manual quotation (MQ-…) | whoever entered it (`ManualQuotation.createdBy`) |
| QC results and QC rejections on a PO | the **PO's creator** |

Everyone with at least one such record appears in the list.

## 3. The weights (blueprint §13)

| Part | Weight |
|---|---|
| RFQ coverage / compliance | **15** |
| Quotation completeness | **10** |
| Savings / landed-cost discipline | **15** |
| Delivery follow-up | **15** |
| Quality outcome | **15** |
| Documentation accuracy | **10** |
| PO accuracy | **10** |
| Supplier relationship process | **5** |
| Policy compliance / audit findings | **5** |

- **Who changes them:** the Company Admin, in **Settings → Purchaser score**.
- **Rules:** whole numbers adding up to 100. "Blueprint defaults" puts these back.
- **Where they're saved:** `PurchaseSettings.purchaserScore.weights`.

## 4. Periods

- **Month:** pick a month, and only events dated in it count, all equally.
- **Last 12 months:** events in the last 365 days, recent counting more (today 1.0 → a year ago 0.5,
  same as the vendor score).
- **Trend:** the score for each of the last 6 months.

**Event dates:**

| Event | Dated by |
|---|---|
| a PO's events | its order date |
| a quotation (MQ / QR) | when it was created |
| a follow-up | the due date that was missed |
| a QC result | the QC decision |
| a QC rejection | when the rejection was made |

## 5. Each part

Each part gives a **% (0–100)**: the average of its events.

### 5.1 RFQ coverage / compliance (15)

- **Event:** each PO made from quotes. These carry the **vendor selection check** saved at PO time
  (change report §13).
- **Score:** for each item on the PO, `asked ÷ needed`, capped at 1.
  - **"Needed":** the company's minimum vendors per item, or fewer if fewer approved vendors supply
    it.
  - **"Asked":** an email request or a manual quote, even with no reply.
  - The PO's score is the average over its items × 100.
- **Weighted by:** the number of items on the PO.
- **Example:** 2 items, one with 3 of 3 asked and one with 1 of 3 → (1 + 0.33) ÷ 2 = **67**.
- **Covers the blueprint's** "single-source purchases": asking only one vendor scores low here.

### 5.2 Quotation completeness (10)

- **Manual quotation (MQ-…)**, 4 checks, 25 points each:
  1. evidence files attached
  2. GST known on every item ("includes GST", or a GST %)
  3. delivery days on every item
  4. payment terms recorded (advance % or credit days)
- **Email request (QR-…)** answered by the vendor = **100**. The vendor's form already requires
  those fields.
- **Not counted:** requests not answered, or whose email failed.
- **Example:** an MQ with files and GST but no delivery days on one item and no terms → **50**.

### 5.3 Savings / landed-cost discipline (15)

- **Event:** each PO whose selection check compared full landed quotes. The landed cost is goods +
  GST + the vendor's quoted charges, from vendors who quoted every item on the PO.
- **Score:** `100 × cheapest landed ÷ the chosen vendor's landed`. Choosing the cheapest = **100**.
- **Example:** the cheapest full quote ₹9,000, chosen ₹10,000 → **90**.
- An approved exception doesn't change this number. It shows under Policy (5.9).

### 5.4 Delivery follow-up (15)

- **Event:** each time a PO line's **due date passes without the goods**:
  - the first promised date
  - then each new date they recorded, in order
- **Score:** days from the missed due date to the purchaser's **action**:
  - the action is recording the vendor's new date (Change date), or the goods arriving
  - if neither has happened yet, the count runs to today
  - within **2 days = 100**, then **−20 per day**, **0 at 7+ days**
- **Not an event:**
  - a date changed **before** it was due (good practice)
  - lines **waiting for the advance**, which have no date yet
  - cancelled lines
- **Examples:**
  - due on the 10th, new date recorded on the 11th → **100**
  - nothing until the goods came on the 15th (5 days) → **40**
- **Covers the blueprint's** "late follow-ups".

### 5.5 Quality outcome (15)

- **Event:** each QC-decided delivery on their POs.
- **Score:** the same as the vendor's quality, the share QC accepted with rejections by **severity**
  (Minor 1×, Major 1.5×, Critical 2×). It **doesn't** include the extra penalty for a vendor
  refusing to settle: that's the vendor's fault, not the buyer's.
- **Weighted by:** the delivery's money value.
- **Example:** 8 accepted, 2 rejected Major → 1 − 3/10 = **70**.

### 5.6 Documentation accuracy (10)

- **Event:** each real PO (not one still waiting for approval).
- **Score:**
  - **50** if the PO was actually **emailed to the vendor** (an "Emailed to vendor" entry in its
    History)
  - **+ 50 × the share of its lines backed by a quote with evidence**: the vendor's own email quote
    (QR), or a manual quote entered with evidence (MQ)
- **Example:** emailed, 1 of 2 lines on an old manual price with no evidence → 50 + 25 = **75**.

### 5.7 PO accuracy (10)

- **Event:** each PO they created that was decided (a real order, or rejected).
- **Score:**
  - **0** if the **Company Admin rejected** it
  - **0** if a cancellation / short close on **our side** was approved with the reason **"Ordered by
    mistake"** or **"Need no longer exists"**
  - otherwise **100**
- **Not held against them:** cancellations on the **vendor's** side (can't supply, price change,
  delay).
- **Covers the blueprint's** "PO amendments": a PO is never edited, it's cancelled and re-ordered
  (change report §14).

### 5.8 Supplier relationship process (5)

- **Event:** each **QC rejection** (REJ-…) on their POs.
- **Score:** days from the rejection to recording the **vendor's answer**:
  - within **3 days = 100**, falling to **0 at 15 days**
  - still unanswered after 15 days = **0**
  - unanswered and under 15 days = not counted yet
- **Covers the blueprint's** "unresolved vendor issues".

### 5.9 Policy compliance / audit findings (5)

- **Event:** each real PO with a selection check.
- **Score:** **50** if the PO needed a **vendor selection exception**, else **100**. The exception
  reasons include:
  - only vendor that can supply
  - urgent need
  - better quality
  - faster delivery
  - better payment terms
  - rate contract
  - others didn't reply in time
  - other
- **Covers the blueprint's** "exceptions, emergency purchases".

## 6. Putting it together

- **Score** = Σ (part % × weight) ÷ Σ (weights of the parts **that have data**), rounded.
- **A part with no events** shows "—". It's **left out, not counted as zero**. For example, a
  purchaser with no overdue lines has no follow-up events.
- **Limited history:** fewer than **3 POs** in the period. The score still shows, marked.

## 7. Who sees what

| Who | Sees |
|---|---|
| **Company Admin / Super Admin** | everyone: Company Admin → Purchase & Vendor Approval → **Purchasers → Purchaser Score** |
| **A purchaser** | only their **own** score and evidence: Purchase → **My Score**. Asking for someone else's is refused. |

## 8. Where it shows

- **Purchaser Score (Company Admin):**
  - a month picker
  - each purchaser: name, role, the month's score, the 12-month score, nine part bars, "Limited
    history"
  - click a purchaser to see their detail
- **Detail** (what the purchaser sees under My Score):
  - the month and 12-month scores
  - the 6-month trend
  - each part's %, its weight, and **every event behind it** (POs, quotes, overdue lines, QC
    results, rejections) with dates and per-event scores
  - an explanation panel with an **English / Hinglish** switch
- **Settings → Purchaser score:** the nine weights.

## 9. Not included, on purpose

- **Nothing typed by hand:** no manual "relationship" or "audit" ratings (user decision).
- **Not stored:** worked out live each time, with no monthly table. The trend is recalculated from
  the records.

## 10. Defaults you can change later

| What | Default | Where |
|---|---|---|
| Weights | 15 / 10 / 15 / 15 / 15 / 10 / 10 / 5 / 5 | Company Admin Settings |
| Follow-up full marks / zero | 2 days / 7 days (−20 a day) | code |
| Vendor-answer full marks / zero | 3 days / 15 days | code |
| An exception's cost in Policy | 50 | code |
| Limited history below | 3 POs in the period | code |
| Recency | 1.0 → 0.5 over 12 months | code (shared with the vendor score) |
| MQ completeness checks | 4 × 25 (evidence, GST, delivery days, terms) | code |
