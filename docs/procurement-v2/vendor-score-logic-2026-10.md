# Vendor score — how it's worked out

- **Date:** 2026-10-13
- **Status:** built (change report §30). **Not yet clicked through in the browser** (test plan T38).
- **Code:**
  - `server/services/vendorScoreService.js`: every formula and the nightly job
  - `server/services/vendorApprovalService.js`: `getVendorStanding`, the Watchlist / Probationary
    / Active status
- **Blueprint:** §11 Vendor Selection Score, §12 Suggested Formula, Appendix A.

This doc explains the logic **as built**, so it can be checked or changed later.

---

## 1. What it is

A number **out of 100** for each vendor, worked out from what actually happened: deliveries, QC
results, prices, PO terms, warranty and quotation replies. **Nothing is typed in.**

It replaced the old 1–5 star "rating", which predated the blueprint:
- on time = 5 / late = 1, QC pass = 5 / fail = 1
- no weights
- QC counted per job, and replacements were penalised twice

## 2. The weights

| Part | Default weight | Blueprint weight |
|---|---|---|
| Price | **25** | 25 |
| Quality | **30** | 25 (+5) |
| Delivery | **20** | 15 (+5) |
| Credit terms | **10** | 10 |
| Warranty | **10** | 10 |
| Response | **5** | 5 (Documentation / Response) |
| ~~Technical compliance~~ | — | 10 — **dropped** (user, 2026-10-13); its 10 points went to Quality +5 and Delivery +5 |

- **Who changes them:** the Company Admin, at Company Admin → Purchase & Vendor Approval →
  **Settings → Vendor score**.
- **Rules:** whole numbers, 0–100 each, adding up to **100**. "Blueprint defaults" puts the numbers
  above back.
- **Where they're saved:** `PurchaseSettings.vendorScore.weights` (empty = the defaults).

## 3. Time: last 12 months, recent counts more

- **The window:** only events in the **last 365 days** count towards the score.
- **Recency weight:** each event counts `1 − 0.5 × (age in days ÷ 365)`.
  - happened today → counts **1.0**
  - 6 months ago → **0.75**
  - a year ago → **0.5**
  - older than a year → **0** (out of the score)
- **Lifetime score:** shown alongside. It's every event ever, with no recency weighting.

## 4. Each part

Each part gives a **% (0–100)**: an average of its events, each weighted by recency and, for some
parts, by money value.

### 4.1 Price (25)

- **Event:** each **delivery**, meaning each received request on a PO line. This is the same data
  as "Bought before" and Price History (`loadPriceSamples`).
- **The price:** the PO line's rate per purchase unit, **before GST**. An "incl. GST" rate is taken
  back to its pre-GST value. Charges (freight etc.) aren't in it: they're per PO, not per item.
- **Compared with:** the **lowest price for the same item, in the same unit**, that **any vendor
  charged (delivered) or quoted** (any submitted quote, ex-GST), **within a year of this
  delivery**.
- **Score:** `100 × lowest ÷ this price`. Being the lowest = 100. Twice the lowest = 50.
- **Skipped:** an item that **no other vendor** priced in that year. There's nothing to compare
  with.
- **Weighted by:** price × quantity (the delivery's money value) × recency.
- **Note:** a replacement delivery is a delivery too, as in Bought before.

### 4.2 Quality (30)

- **Event:** each **purchase QC job that QC has decided** (Approved or Rejected). A job still in
  QC isn't counted yet.
- **Score:** `100 × (1 − penalty ÷ total)`, where:
  - **total** = quantity accepted + quantity rejected
  - **penalty** = each rejected piece × its **severity**:

    | Severity (QC picks it on Fail) | Counts as |
    |---|---|
    | Minor (cosmetic / usable) | 1× |
    | **Major** (not usable as is; the default) | 1.5× |
    | Critical (unsafe / wrong item) | 2× |

  - **The vendor refused to replace or refund** that rejection (§24) → it counts **twice** more.
- **Examples:**
  - 8 accepted, 2 rejected Critical → 1 − 4/10 = **60**
  - 4 accepted, 1 rejected Minor and refused → 1 − 2/5 = **60**
  - all 10 accepted → **100**
- **Where the rejections come from:** each QC rejection on a PO is a `PurchaseRejection` (REJ-…),
  with its quantity, severity and the vendor's answer. Older jobs without one use the job's own
  record. A missing severity counts as Major.
- **Weighted by:** the delivery's money value (its share of the PO line; a replacement carries
  the rejected part's value) × recency.

### 4.3 Delivery (20)

- **Event:** each **line delivery**. Requests received together on one line count as **one**
  delivery. A replacement is its own delivery.
- **Promised date:**
  - **a normal delivery:** the date **first** promised on that line. "Change date" moves Store's
    due dates and the overdue alerts, but **never** the score. A late vendor can't turn late into
    on time by giving a new date.
  - **a replacement** (§24): the date the vendor gave **for the replacement**, not the original
    one.
  - **a line received before its advance is paid** (§22): no date has been promised yet, because
    the count starts at the advance. The vendor delivered before they had to, so it counts as an
    **early delivery = 100**, shown as "before the advance" (user, 2026-10-14). Before this it
    wasn't counted, which threw away a good delivery. Store's Receive isn't blocked by an unpaid
    advance.
    - If the advance is paid **after** the receipt, the line gets a date later than the receipt.
      It is still early: 100.
    - Only a PO whose dates count from the advance gets this. Any other line with no date at all
      (an old record) is still left out.
- **Score:** on time or early = **100**; **−10 for each calendar day late**; **0** at 10+ days late.
- **Weighted by:** recency only (every delivery counts the same).

### 4.4 Credit terms (10)

- **Event:** each **real PO**, meaning not waiting for approval, rejected or cancelled.
- **Score:** half for **credit days** and half for the **advance**:
  - credit: `50 × min(credit days, 30) ÷ 30`, so 30 days or more = the full 50 and 0 days = 0
  - advance: `50 × (1 − advance% ÷ 100)`, so 0% advance = the full 50 and 100% advance = 0
- **Examples:**
  - 30 days, 0% advance → **100**
  - 15 days, 20% advance → 25 + 40 = **65**
  - 0 days, 50% advance → **25**
- **Weighted by:** the PO's total × recency.
- **Note:** this scores the **terms the vendor gave**, not whether we paid late (the blueprint:
  "without encouraging late payment").

### 4.5 Warranty (10)

Two halves, averaged. If only one half has data, that half is the whole part.

- **Duration half:**
  - **events:** each of the vendor's quotes for an item
  - **score:** `100 × months they quoted ÷ the most months any vendor quoted for that item` (any
    quote on record)
  - **skipped:** items where **nobody** quoted a warranty
- **Claims half:** each **vendor warranty claim** (Complaints → Support, §29).
  - **A closed claim:** **50%** our ★ satisfaction (★ ÷ 5) + **25%** resolved (Repaired / Replaced /
    Credit note = yes) + **25%** response speed (within 3 days = full, 15+ days = none).
  - **Refused or Not covered** while we marked it **under the vendor's warranty** → **0**.
  - **An open claim the vendor hasn't answered in 15+ days** → **0**.
  - **Other open claims** aren't counted yet.
  - **Example:** Repaired, answered in 2 days, 4★ → 40 + 25 + 25 = **90**.

### 4.6 Response (5)

- **Event:** each **emailed quotation request** (QR-…) that went out. Manual quotations don't
  count: we chased those ourselves.
- **Score:**
  - **answered** (submitted, even if some items were "can't supply"): **70** + **30** for speed
    (within 1 day = full, 7+ days = none)
  - **no reply before the link ran out:** **0**
  - **still open, link valid:** not counted yet
- **Weighted by:** recency only.

## 5. Putting it together

- **The score** = Σ (part % × part weight) ÷ Σ (weights of the parts **that have data**), rounded
  to a whole number.
- **A part with no data** shows "—". It's **left out, not counted as zero**, and the other parts are
  scaled up to 100.
  - **Example:** only Price 80 and Quality 60 have data → (80×25 + 60×30) ÷ 55 = **69**.
- **No data in any part** → no score ("—", "No history yet").
- **Limited history:** fewer than **5** deliveries + QC decisions in the last 12 months. The score
  still shows (marked), but it **can't put the vendor on the Watchlist**.

## 6. Status: Watchlist / Probationary / Active

For **approved** vendors, checked in this order (`getVendorStanding`):

1. **Watchlist**, either:
   - **refused to replace or refund QC-rejected material in the last 90 days** (§24), or
   - **score below the Watchlist line** (default **60**, set by the Company Admin) **and** not
     limited history

   The reason is shown, e.g. "Vendor score 54 / 100 (below 60)".
2. **Probationary:** fewer than **3 POs** with something received.
3. **Active:** otherwise.

Nothing happens to a vendor automatically. The Company Admin decides from the Watchlist tab
(Suspend).

## 7. When it's worked out, saved and alerted

- **Worked out live** every time Vendor Ratings, the RFQ/PO vendor cards, Vendor Master or the
  Watchlist is opened. It's always up to date with the latest receive, QC decision or claim.
- **Saved every night at 9:45** (`runVendorScoreSweep`): one **`VendorScore`** record per approved
  vendor per month, holding the score, each part's % and the weights used. It keeps the trend
  (the blueprint's `vendor_scores`).
- **Alert:** the **first** time a vendor's saved score is below the line (with enough history),
  the **Company Admin** and **Accounts Head** are notified once: "… vendor score is 54 / 100 (below
  60) — they're on the Watchlist". The alert doesn't repeat until the vendor has gone back above
  the line and dropped again.

## 8. Where it shows

- **Purchase → Vendor Ratings:**
  - each vendor: score (green 80+, amber at or above the line, red below), status, "Limited
    history", on time x/y, QC accepted %, lifetime, six part bars
  - **expand a vendor to see every event behind each part**, with dates, POs and per-event scores
  - the bought-before prices per item
- **RFQ/PO vendor card:** "72/100 · On time 4/5 (80%) · QC accepted 96% · Probationary" (* = limited
  history). The "Best vendor score" sort uses it.
- **Vendor Master:** the Watchlist reason.
- **Company Admin → Vendors → Watchlist:** the reason, the score and the six parts.
- **Company Admin → Settings → Vendor score:** the weights and the Watchlist line.
- **QC → inspection → Fail on purchased material:** the severity. It's shown again on QC
  Rejections and the result banner.

## 9. Not included, on purpose

- **Technical / specification compliance:** dropped by the user (2026-10-13).
- **Freight and other charges** in the price part: they're per PO, not per item. (The PO-time
  selection check (§13) does compare landed cost with charges.)
- **Partial deliveries:** Store receives a whole line at once, so there are none, except
  replacements.

## 10. Defaults you can change later

| What | Default | Where |
|---|---|---|
| Weights | 25 / 30 / 20 / 10 / 10 / 5 | Company Admin Settings |
| Watchlist line | 60 | Company Admin Settings |
| Days late → score | −10 per day (0 at 10 days) | code (`deliveryEvent`) |
| Credit days for full marks | 30 | code (`creditEvent`) |
| Severity factors | 1 / 1.5 / 2, refused ×2 | code (`SEVERITY_FACTOR`) |
| Recency | 1.0 → 0.5 over 12 months | code (`recencyWeight`) |
| Limited history below | 5 deliveries + QC decisions | code (`MIN_HISTORY_EVENTS`) |
| Claim response for full marks / zero | 3 days / 15 days | code (`claimEvent`) |
| Quote reply for full marks / zero | 1 day / 7 days | code (`responseEvent`) |
