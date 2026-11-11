# Slice 7 — returns: Dispatch collects, Store receives (handovers 3 · 4, T8–T10)

- **Date:** 2026-10-21
- **Status:** **built** 2026-10-21 (26 tests) — change report §6. Decisions R1–R4 by the user (all as recommended). Browser check pending.
- **Design:** [dispatch-design-2026-10.md](dispatch-design-2026-10.md) §3.3 (handovers 3 and 4),
  §6 (T8–T10); [material-logic-2026-10.md](material-logic-2026-10.md) M3.
- **Builds on:** slice 6 (trips, vehicles, Store / Production handovers).
- **Not in this slice:** removing Purchase's temporary Mark sent / Receive (slice 8, T11).

## Decisions (user, 2026-10-21)

| # | Question | Decision |
|---|---|---|
| R1 | The vendor gives back fewer pieces / units than were sent | **Blocked + reported.** Dispatch can't mark that request collected; **"Report short"** tells Purchase, who sorts it out with the vendor. The request waits for a later trip. (Collecting part of a request stays for later, T6.) *(2026-10-26: Store can report short too, before Dispatch collects — the same effect (change report §22). Found: the next trip still asks for the full quantity and the pieces that came aren't recorded — partial returns are Part 3 — BUILT 2026-10-26, §23 / partial-returns-2026-10.md: what came waits at Store, the rest is collected later or written off as not coming.)* |
| R2 | Where returned work waits when its next step is another outsource trip (or a rework) | **At Store.** The next trip takes it straight from Store. Store hands it to Production only when the next step is in-house. |
| R3 | Offcuts / unused material back from the vendor | **Optional, at any receive** of that line. Measured sizes go into stock as leftovers; noted on the order (M3: always to Store). |
| R4 | When Store hands Child Part / Machine units to Production | **Per unit**, as soon as that unit's QC passes. |

> **Changed 2026-10-25 (the user, after the R8 test):** there is **no "Hand to Production" by
> Store** any more. Work back from a vendor whose next step is in-house goes to Production **by
> itself**: when QC passes it (QC hands it over in real life), or at Store's receive when those
> steps have no QC. It's recorded as a handover ("QC passed / no QC: straight to Production").
> **At Store** keeps only work in QC, out for rework, or waiting for its next outsource trip
> (R2 otherwise unchanged); the true last step still goes to stock. This replaces R4 and
> dispatch-design T8. Change report §20.

## What this slice does

1. **"Vendor says ready" (T9):** Purchase (on the order) or Dispatch (on Vendor Pickups) marks a
   request after the vendor calls. Those requests come first in the list to collect.
2. **Returns on a trip:** Vendor Pickups → Outsource lists what's **with the vendor**. Dispatch
   ticks requests and puts them on a trip (alone, or with sends / PO pickups for the same vendor).
3. **Handover 3 — "Collected"** (Dispatch, per request):
   - the count must equal what was sent
   - otherwise **Report short** (R1): Purchase is notified, and the request leaves the trip to
     wait for a later one
4. **Handover 4 — Store receives** (a new **"From Outsource"** tab on Material Transfers):
   - **Store's count must match Dispatch's;** otherwise Store reports it short too
   - **the receive itself is unchanged:** each step goes to QC (or completes), and the bill
     acceptance follows
   - **a job-work order's final receive** takes its cost from the Outsource Order automatically
     (T10)
   - **optional (R3):** offcuts and unused material back from the vendor go into stock
5. **Work waiting at Store (R2):** a hybrid order's returned units / pieces stay **at Store**.
   - **Next step in-house:** once a unit's QC passes, Store presses **Hand to Production**,
     per unit (R4, T8). Until then **Production can't give that unit's next step to a team.**
   - **Next step outsourced, or a rework:** it stays at Store, and the next trip takes it from
     Store. The material plan says "from Store", and Store's handover to Dispatch releases it.
   - **The order's last step:** goes into stock as today, with no handover.
6. **Purchase's order view:**
   - shows ready / on a trip / collected / short
   - its temporary Receive is refused for a request Dispatch is bringing back

## Tests (hand-worked)

| Case | Expected |
|---|---|
| Vendor ready | the marked request is listed first |
| Bracket job-work order B (6 pcs) comes back as 5 | Collected refused → Report short → Purchase notified, B waits again |
| Order A (12 pcs) | collected 12 → Store's count 11 refused → 12 received |
| A's cost | **₹120** (12 × ₹10) taken from the order |
| A returned offcut 1250 × 400 | leftover size +1 |
| Frame X units 1–2 | received → QC; **at Store** |
| Unit 1 passes QC | Hand to Production: unit 2 refused (QC not passed), unit 1 allowed |
| Production gate | unit 1's assembly refused before the handover, allowed after |
| Order Z (next step bend, also outsourced) | stays at Store, can't be handed to Production. The next order's plan says the 2 units come **from Store**; Store's handover to Dispatch releases them |
| Regression | slices 2, 3, 5, 6 |
