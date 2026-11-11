# Outsource v2 — docs for this work

Outsourced job work: Purchase picks a vendor and makes an **Outsource Order**. Later, Dispatch
moves the material, Store takes the work back, QC checks it, and Accounts pays.

Started 2026-10-19, after the purchase flow (`../procurement-v2/`) was finished.

| Doc | What it is |
|---|---|
| [outsource-workflow-2026-10.md](outsource-workflow-2026-10.md) | The agreed design (D1–D8), open questions and the build plan. **Start here.** |
| [slice-1-one-outsource-system-plan.md](slice-1-one-outsource-system-plan.md) | Slice 1: a real first send for every Sub Child Part. The original "one system" merge (19 Oct) and why it was undone (20 Oct) |
| [slice-2-outsource-order-plan.md](slice-2-outsource-order-plan.md) | Slice 2's detailed plan: the Outsource Order, approval, the trip through the order, receive per round |
| [slice-3-bill-payment-plan.md](slice-3-bill-payment-plan.md) | Slice 3: the outsource bill, payable as QC passes, payments, ledger (Job Work Charges) |
| [material-logic-2026-10.md](material-logic-2026-10.md) | Dispatch phase: where outsource material comes from (Production or Store), how much (per request; sheet / length combined per line), the bookkeeping. Decisions M1–M4 |
| [slice-5-material-plan.md](slice-5-material-plan.md) | Slice 5: the material plan (built) |
| [slice-6-dispatch-sends.md](slice-6-dispatch-sends.md) | Slice 6: Dispatch sends — vehicles, trips, Store / Production handovers, delivered (built) |
| [slice-7-returns-store-receive.md](slice-7-returns-store-receive.md) | Slice 7: returns — Dispatch collects, Store receives, work waits at Store, Hand to Production (built) |
| [slice-8-cleanup.md](slice-8-cleanup.md) | Slice 8: Purchase's temporary send / receive removed — one way: Dispatch sends, Store receives (built) |
| [vehicle-waits-bring-back-2026-10.md](vehicle-waits-bring-back-2026-10.md) | The vehicle waits & brings it back: one trip out and back (tick at trip creation + two fallbacks) — found in the flow test (built) |
| [auto-outsource-requests-2026-10.md](auto-outsource-requests-2026-10.md) | Client change 1: first Out Source step (and the next one while at Store) requested automatically at all levels (built) |
| [pricing-types-logic-2026-10.md](pricing-types-logic-2026-10.md) | Client change 2: pricing types per step — per piece, whole line, per minute / hour, per job work (logic doc, for review) |
| [slice-4-cost-logic-2026-10.md](slice-4-cost-logic-2026-10.md) | **Slice 4 logic**: outsource cost into the part (automatic from the order), Production's cost at its last in-house step, and the price push up to Sales — **built 2026-10-24** (change report §18) |
| [later-points-2026-10.md](later-points-2026-10.md) | **Points parked for later** (L1–L9): combining sheets across lines, slice 4 cost, unit rework, … |
| [outsource-flow-test-roadmap-v2-2026-10.md](outsource-flow-test-roadmap-v2-2026-10.md) | **Browser test roadmap v2** (fresh test after the client's changes): R0–R7, every pricing type, automatic requests, per-step job-work QC |
| [outsource-flow-test-roadmap-2026-10.md](outsource-flow-test-roadmap-2026-10.md) | *(superseded 2026-10-23 — tested to R4)* Browser test roadmap v1 with ORD-0125 (BP816 + PRO001), rounds R0–R9 |
| [dispatch-design-2026-10.md](dispatch-design-2026-10.md) | Dispatch phase: Vendor Pickups (Purchase / Outsource tabs), trips, vehicles, handovers, freight, challan. Decisions T1–T7; several stops and a printed challan ready if the client asks |
| [outsource-v2-changes-2026-10.md](outsource-v2-changes-2026-10.md) | Change report, one section per change (plain language) |

## Background docs (written before this folder)

- `../process-inhouse-outsource-changes-2026-09.md`: BOM steps marked In-House / Out Source
  (Phase 1).
- `../process-inhouse-outsource-redesign-discussion-2026-09.md`: how Production and Purchase run
  outsourced steps today (hand-offs, rounds, batching), and the deferred Logistics idea.
- `../qc-multi-checkpoint-changes-2026-09.md`: outsourced work goes to QC first when it comes
  back.
- `../outsource-cost-jobwork-design-2026-09.md`: the job-work cost design, now used by slice 4.
- `../procurement-v2/procurement-workflow-2026-10.md`: open questions G3, V7 and ST6 are about
  outsourcing.
- `../procurement-v2/accounts-bill-ledger-payments-2026-10.md`: the "PO is the bill" payment
  model reused by slice 3.
