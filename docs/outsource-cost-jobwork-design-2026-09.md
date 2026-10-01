# Outsourced job-work cost + Production cost/expense — design

**Status (2026-09-28): DESIGN ONLY, agreed with the user, not yet built.**
Deliberately deferred — the user's own words: "we should build it later when vendor system and
manpower changes are done." This file is the reference to come back to at that point, so the
reasoning doesn't have to be re-derived from scratch. Do not start building this without the user
explicitly re-opening it.

Related earlier work:
- `process-inhouse-outsource-redesign-discussion-2026-09.md` — the outsource hand-off mechanism
  (`ProductionOrder.outsourceHandoffs[]`, rounds) this design builds cost capture on top of.
  Its own "Pending the client" section already flagged "the vendor's own cost for outsourced
  work... deferred to the Purchase rebuild" — this doc is that deferred piece, worked out in
  detail ahead of time.
- `qc-multi-checkpoint-redesign-discussion-2026-09.md` — the per-unit/per-batch QC mechanism
  (`submitUnitQcStep`, `decideChildPartUnitStep`, `submitBatchQcStep`) whose existing
  `pendingProductionCost`/`pendingProductionExpense` capture-then-apply pattern this design
  extends and reuses.
- `procurement-redesign-discussion-2026-09.md` — the not-yet-green-lit Purchase/Vendor rebuild.
  Its own "Suggested direction" lists "Logistics and job-work vendor / scrap reconciliation" as
  *"the largest piece, last, once the client confirms the department split"* — this design is
  scoped to land once that vendor system (and the client's own manpower-cost changes to
  Production) exist, not before.
- `automated-pricing-cascade-design-2026-09.md` — also DESIGN ONLY, also deferred, also waiting
  on production-completion triggers existing. That doc explicitly wraps
  `recalculateChildPartCost`/`applyManufacturedFinalCost` (the same functions this design's
  "combine" step calls into) — build order matters: this doc's "combine and apply" step should
  land, and be stable, before the pricing cascade tries to hook into it.

## 1. Why this exists

Found live while testing the QC multi-checkpoint redesign's Child Part outsourced-QC-steps work
(`ORD-2026-079`, Fan/CP-001): when a hybrid order's true last step is outsourced, Purchase's
receive triggers the order's real completion (`completeMachineUnit`/`Item.qty+=1`), but nothing
ever asks anyone for the build cost — Production never touches that step at all (no form exists
for an Outsourcing step), and Purchase's receive doesn't ask either. The order completes with the
cost/expense simply never captured, silently.

Today, cost capture is Production-only, and only fires when Production happens to touch the
literal true last step (`submitUnitQcStep`'s `productionCost`/`productionExpense` body params on
a QC-flagged true last step, or `completeFinalProcessStep`'s cost dialog on a non-QC true last
step). Neither ever fires when the true last step is Outsourcing-type.

## 2. What exists today, per level (confirmed by reading the code, 2026-09-28)

- **Sub Child Part**: `Item.subChildPartDetails.jobWorkCost`/`jobWorkCostSource` only — no
  production cost/expense concept at all. Only ever set today by the OLD, separate
  `SubChildPartJobWorkOrder` flow's completing receive (`totalJobWorkCost`, a real vendor invoice
  figure, divided by order quantity) — a flow that predates this whole hierarchy redesign and is
  untouched by it. The NEWER `submitBatchQcStep`/`submitBatchStepForQC` (this year's QC redesign)
  has **no** cost/expense capture anywhere.
- **Child Part / Machine**: `productionCost`/`productionExpense`, captured via
  `pendingProductionCost`/`pendingProductionExpense` on the QCJob's `StepEntrySchema`, applied via
  `recalculateChildPartCost`/`applyManufacturedFinalCost` once the true last step's QC decision
  (or, for a non-QC true last step, `completeFinalProcessStep`) resolves. No `jobWorkCost` concept
  at either level.
- **No level has any per-outsourced-step vendor cost capture** on the `ProductionOrder.
  outsourceHandoffs[]` mechanism (Child Part, Machine, and hybrid Sub Child Part all use this) —
  every `receiveOutsourceHandoffRound` branch this session built explicitly skips cost, citing
  "vendor cost capture still deferred."
- **No return/rework-cost tracking exists in Purchase's outsource flow at all** — a rejected
  outsourced step just becomes resendable; Purchase never records anything about what a redo cost
  (confirmed in `procurement-redesign-discussion-2026-09.md` §9: "records qty + reason but creates
  no return/rework document — explicitly deferred").

## 3. Confirmed design (worked out 2026-09-28, not yet built)

### 3.1 Schema — every level gets all three fields
Today Sub Child Part has only `jobWorkCost`; Child Part/Machine have only `productionCost`/
`productionExpense`. All three levels should end up with all three: `jobWorkCost` (Purchase-
entered, accumulated), `productionCost`, `productionExpense` (Production-entered). For a fully
outsourced order, `productionCost`/`productionExpense` simply never get set — no special-casing,
that's just the natural result of Production never having a step to enter them on.

### 3.2 Purchase enters job-work-cost per ROUND (not per hand-off, not per step-within-a-round)
Every outsourced round Purchase receives gets a job-work-cost entry field — regardless of whether
that round happens to be QC-flagged or the terminal step of the order. One number covers however
many steps/units that specific round spans (confirmed: for now, total only — "when we have vendor
system we can't say that one vendor is doing everything, but we don't have that right now," so no
attempt to break cost out per step within a round).
- **Sub Child Part**: Purchase enters the full cost for the quantity that round covered; this
  accumulates (summed) across every round of every outsourced step in the whole pipeline; divided
  by quantity to get an average, applied at order completion. Sub Child Part is always one
  whole-quantity batch (never per-unit, "qty 1 or 10 is handled in one flow") and its quantity can
  shrink via Rework/Scrap — a round's own quantity (`subChildPartQty` on a rework resend) is what
  the entered cost actually covers, not necessarily the original order quantity.
- **Child Part / Machine**: one total per round, split evenly across whichever units that round's
  `unitIndices` covers, each unit's own share added to a running per-unit accumulator. Because
  batching membership can differ step to step (units 1+2 bundled for one step, sent separately for
  another), the accumulator must live **per unit**, incremented independently per round — this
  already handles a unit's varying batch membership correctly by construction, no special-casing
  needed.

### 3.3 Rework/reject cost — new capability, build now as part of this
No return/rework-cost tracking exists today. New: when Purchase handles a rework resend/receive
for a previously-rejected outsourced step, they see the **last job-work-cost entered** for that
step (for reference), plus a **new optional field** to enter an additional rework charge, only if
the vendor didn't redo the work for free. Left blank → no additional cost, the original entry
still stands (the failed attempt's cost isn't erased, it just doesn't grow unless the vendor
actually charged again).

### 3.4 Production's own cost/expense — same existing capture-then-apply pattern, relocated trigger
Captured (as `pendingProductionCost`/`pendingProductionExpense`, same as today) when Production
sends the **final** outsource run — the "Send for Outsourcing" action whose step range reaches the
true last step of that unit/order — **but only when real in-house work actually preceded it**.
- **Why the extra guard matters**: confirmed by re-reading the code (`outsourceWorkController.js`,
  `childPartReorderService.js`, both 2026-09-22) — unlike Sub Child Part (which can auto-route
  straight to Purchase for a Hybrid order whose first step is outsourced), **Child Part and
  Machine orders always land with Production first, even when every single step is outsourced —
  "no auto-bypass at these two levels," confirmed deliberate, not a bug.** So Production will click
  "Send for Outsourcing" at least once even on a 100%-outsourced Child Part/Machine order. If that
  first send also happens to span the whole pipeline, naively treating "reaches the true last
  step" as the cost-capture trigger would wrongly prompt them for cost on work they never did. The
  real trigger is **reaches the true last step AND at least one in-house step actually completed
  before it**.
- Batched sends (multiple units in one "Send for Outsourcing" click) split the entered cost evenly
  across the bundled units, same averaging rule as Purchase's side.

### 3.5 Combine — two different trigger points, not one
Whichever side actually finishes the order does the combine:
- **Production's own true-last-step completion** (true last step is in-house): the existing cost
  dialog (Stage B's Submit-to-QC dialog, or `completeFinalProcessStep`'s Complete-step dialog)
  needs to also read this unit's accumulated `jobWorkCost` so far, and the total applied to the
  BOM is accumulated job-work-cost + Production's own newly-entered cost/expense.
- **Purchase's outsourced receive of the true-last-step** (true last step is outsourced): this
  round's own job-work-cost entry joins the accumulator, and the combined total — accumulated
  job-work-cost (including this round) + whatever Production stored as `pendingProductionCost`
  from their own last touchpoint send, if any — is what gets applied.
- Both paths call into the same existing `recalculateChildPartCost`/`applyManufacturedFinalCost`
  (Child Part/Machine) or an equivalent new Sub Child Part apply step — this design doesn't invent
  a new BOM-write mechanism, just feeds these existing ones a combined number instead of one side's
  alone.

### 3.6 Explicitly out of scope / deferred further
- **Legacy orders** (no Process Definition, `getQcStepIndices` empty): untouched entirely, same
  convention as everything else in this whole redesign.
- **Scrap/Reject cost dilution** (did the vendor still get paid for producing a piece that was
  later Scrapped?): explicitly punted — "we don't have info for the vendor system by client yet."
  Charge the full job-work-cost to whatever survives, no special accounting, until the client
  clarifies. The `automated-pricing-cascade-design-2026-09.md` doc already independently flagged
  this exact question as "a separate, explicitly undecided piece."
- **The full vendor system** (`procurement-redesign-discussion-2026-09.md`): this design assumes
  Purchase can enter a job-work-cost number, nothing more — no vendor attribution, no per-vendor
  breakdown within a round. Revisit the "total only, for now" decision in §3.2 once a real vendor
  system exists.
- **Manpower/labor cost changes to Production** — referenced by the user as a second reason this
  waits ("the manpower logic will change later in production") — whatever Production's own
  `productionCost`/`productionExpense` inputs mean today may change shape once that lands; this
  design's Production-side capture point (§3.4) should be re-checked against whatever that turns
  out to be before building.

## 4. Why this waits

Two independent blockers, both explicitly named by the user:
1. **The vendor system** (`procurement-redesign-discussion-2026-09.md`) — not green-lit, and the
   "largest piece, last" item in its own suggested build order. Purchase has no per-vendor cost
   attribution mechanism to hang a job-work-cost entry point on yet in any serious way.
2. **Manpower/labor cost changes to Production** — the user's own planned rework of how Production
   reports its cost, not yet designed. Building §3.4's capture point against today's shape risks
   having to redo it once that lands.

## 5. Open items to settle at implementation time (not blocking, just not decided yet)

- Exact schema location for the new fields (Sub Child Part: extend `Item.subChildPartDetails`
  directly, matching where `jobWorkCost` already lives, or move onto the QCJob/order like Child
  Part's `pendingProductionCost`? Child Part/Machine: where does the per-unit `jobWorkCost`
  accumulator live — a new field on `StepEntrySchema`/`UnitQCEntrySchema`, or order-level?).
- Whether the per-round job-work-cost dialog lives on Purchase's existing Receive Round UI
  (`SubChildJobWork.jsx`) as an added field, or a separate step.
- Exact UI copy/placement for the rework-cost optional field (§3.3) — shown inline on the same
  receive dialog, or a separate "rework cost" prompt only when Purchase is resending a previously-
  rejected step.
