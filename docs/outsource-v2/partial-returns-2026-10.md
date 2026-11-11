# Partial returns from an outsource vendor (2026-10-26)

What happens when fewer pieces or units come back from a vendor than were sent. This is Part 3 of
"Store and Dispatch don't wait on each other" (Parts 1–2: change report §21 / §22).

**Status:** BUILT 2026-10-26. Change report: `outsource-v2-changes-2026-10.md` §23.

---

## 1. The decisions (user, 2026-10-26)

1. **Fewer back means the rest is still with the vendor.**
   - Damaged or spoiled pieces are **not** a short. They come back, Store counts them in, and QC
     rejects them (scrap / rework, not paid). That already worked.
   - Store reports short only for pieces that **aren't physically there**.
2. **Sub Child Part pieces:** what arrived **waits at Store** ("12 of 20 back"), and Dispatch's
   "To collect" shows only what's still with the vendor. When everything is back, or the rest is
   written off, the request is received **once** and goes on as one batch (QC, bill, next step).
3. **"Not coming"** (lost, or kept / scrapped by the vendor):
   - marked by **Purchase** (Outsource Order) **or Store** (Outsource Receive → At Store), always
     with a reason
   - it's a **lost-at-vendor count** on the order; `orderQuantity` is never changed
   - stock, the QC quantity, the bill and cost per piece all use **order qty − lost**
4. **A replacement order for the lost qty** when the Sub Child Part order came from a cascade:
   **MachineCascade** (a sales order) or **ChildPartCascade** (a Child Part build). A **LowStock**
   order gets none: the low-stock job raises another if the stock is still low.
5. **Child Part / Machine units:** **split by unit**.
   - the units that came are received now; the rest become a request of their own, still with the
     vendor
   - "not coming" isn't built for units (very rare; Purchase handles it by hand)

## 2. Pieces in parts (Sub Child Part)

**Each part taken from the vendor is an arrival on the request** (`arrivals[]`):
- it's recorded when Dispatch collects it, or when Store receives it first
- Store's receive confirms it (`receivedAt`)
- **still with the vendor** = qty − all arrivals − lost

**Example:** 20 pcs sent, Store receives 12.

| | Result |
|---|---|
| The request | still **Sent** (with the vendor); arrival 12, received |
| Store → At Store | "Back in part — waiting for the rest: 12 of 20 at Store, 8 still with the vendor" |
| Dispatch → To collect | the request with **8** |
| The job-work order / batch | **not received yet**: no QC, no bill acceptance |

The next trip collects the 8 (or fewer again). When the last part is received, the request is
received as a whole (20): QC is asked for 20, the bill, and the next step.

Dispatch can also collect fewer ("collected 12 — 8 still with the vendor"). The 8 are free for
another trip straight away, and Purchase is notified.

## 3. "Not coming" and the counts

**Who:** Purchase (Outsource Order, on the request) or Store (Outsource Receive → At Store, on a
part back). A reason is always required.

**When it's refused:**
- more than is still with the vendor
- ~~all of it, with nothing back~~ allowed since 2026-11-04: [all-lost-at-vendor-logic-2026-11.md](all-lost-at-vendor-logic-2026-11.md)
- a units line

**What it does:**
- the request gets `lostQty`, and its order gets `lostAtVendor[]` (step / trip, reason, who, the
  Outsource Order)
- **the bill:** their value + GST comes off as "**lost at vendor**", its own adjustment, not
  "not accepted by QC"
- **replacement order** for the lost qty, only if the order came from a cascade (§1.4), linked
  both ways
- the rest still on a planned return trip: that trip's entry shrinks, or drops off
- **if everything else is already back at Store:** the request is received now

**The counts** (`utils/lostAtVendor.js`, "order qty − lost"):

| Place | Rule |
|---|---|
| Batch QC, first QC step | build qty − lost on steps up to it |
| Batch QC, a later QC step | previous QC's passed − lost on steps between |
| Rework resend lost | off that QC step as scrap; the resend is asked for less |
| Stock at a no-QC last step (outsource receive / Production's last step) | last QC passed (or build qty) − lost after it |
| Cost per piece (`scpFinishedQty`) | the same rule |
| Job-work pieces left | order qty − QC rejects − lost |
| Next trips' request qty (Purchase's lists) | order qty − lost |
| Bill acceptance | request qty − lost (QC decides the rest) |

**Example:** a job-work order of 20 (a sales order), ₹10 / pc, 18 back, 2 not coming:
- QC is asked for **18**, and Pass puts **18** into stock
- the bill accepts **18**, with ₹20 off as "lost at vendor"
- a **replacement job-work order for 2** is raised for the same Child Part order

## 3b. QC scrap / reject: the same replacement rule (2026-10-27)

A piece **scrapped** by QC (a hybrid batch) or **rejected** by QC (a job-work order) also never
reaches stock. The batch already shrinks: passed + scrap = what entered, and stock / cost follow
what passed.

What was missing was the replacement. A cascade order (**MachineCascade / ChildPartCascade**) now
gets a **replacement order for the scrapped / rejected qty** for the same demand, with the reason
(e.g. "Scrapped at QC (laser cutting): cracked edge"). A low-stock order gets none, as with "not
coming".
- **Code:** `subChildPartOrderService.raiseReplacementFor`, called from `submitBatchQcDecision`
  (scrap) and the job-work partial / full reject in `decideJob`.
- **Recorded:** `replacements[]` on the order and `replacesLostOf.why` on the new one.
- **Production pages:** "3 scrapped → ORD-…" / "replaces scrap on ORD-…".
- **Test:** `scrap-replacement-test` 7/7.

## 4. Units in part (Child Part / Machine)

Dispatch collects 1 of 2 units (count only), or Store receives 1 of 2 first. Store **ticks which
unit came**. Then:
- **The hand-off splits** (`splitHandoffByUnits`): it keeps the unit that came, and a new hand-off
  holds the rest, with a copy of the trips so far (the current one still Sent, on the same Outsource
  Order line).
- **The Outsource Order line:** the request is now 1 unit and is received now (QC, bill `u2`). A new
  request for the other unit stays **with the vendor**, on Dispatch's "To collect". The line's qty
  and amount don't change.
- **Already per unit, so unchanged:** QC, the bill (`u1` / `u2`), cost, at-Store, the automatic
  hand-off to Production.

## 5. Tests

| Test | Result | Covers |
|---|---|---|
| `partial-3a-test` | 21 | Store first / Dispatch first, the rest on a new trip, received as a whole |
| `partial-3b-test` | 19 | refusals; job-work 18 / 20 (QC 18, stock 18, bill, replacement); low stock (no replacement); hybrid with a QC step (QC 15); hybrid with the QC step later in-house (QC 8) |
| `partial-3c-test` | 16 | split by unit (Store first and Dispatch first), QC + bill per unit, the rest on a new trip |

**Not covered by a test:** a rework resend with lost pieces (rare; the scrap / resend math is in
`markNotComing`).
