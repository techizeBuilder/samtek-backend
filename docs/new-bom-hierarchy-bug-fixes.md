# New BOM Hierarchy Bug Fixes (2026-09)

This document tracks the resolution of bugs related to the new BOM hierarchy's QC/production flows, found across several bug-fixing passes (some by Google Antigravity, some by Claude Code — each entry says which where it matters).

## 1. Sub Child Part QC Jobs Showing Prematurely in QC Department

**The Bug:**
Sub Child Part QC jobs were appearing in the QC Department (`/qc/jobs`) as soon as Production opened the checklist panel, even before Production had officially clicked "Submit to QC". Because the system initializes the `QCJob` immediately to provide the checklist structure for Production to fill out, the job defaulted to `status: 'Pending'`, making it instantly visible to the QC team.

**The Fix:**
- Added a new `'Draft'` state to the `QCJob` status enum.
- In `productionMfgController.js` (`ensureQCJobForOrder`), the initial status is now set to `'Draft'` instead of `'Pending'` specifically for `SubChildPart` orders.
- In `qcController.js` (`getQCJobs`), the base query and aggregate counts now explicitly exclude `status: { $ne: 'Draft' }`, keeping these jobs invisible to the QC department.
- When Production submits the job (`submitSubChildPartOrderToQC` in `subChildPartOrderMfgController.js`), the `QCJob` status is updated from `'Draft'` to `'Pending'`, making it visible to QC at the exact right time.
- If QC rejects a job and it goes back to Production, saving the checklist again sets the status back to `'Draft'` until Production re-submits.

## 2. "Final Decision" Submit Button Not Unlocking for QC

**The Bug:**
When QC reviewed a Sub Child Part job and clicked the "Pass" or "Fail" verdict on a checklist item, the final submit button remained locked with the message: *"1 checklist item still pending — complete all before deciding"*.

This was a regression caused by the hierarchy redesign. The backend needed to know if a checklist was already filled out by Production (in which case QC's review should be stored in `qcStatus`) or if it was entirely QC-driven (stored in `status`). The code was previously checking `if (job.partChecks.length > 0)` to make this distinction. This worked for Machine orders (which have child parts), but Sub Child Parts are the bottom of the tree and have zero `partChecks`. As a result, clicking "Pass" updated the wrong field (`status` instead of `qcStatus`), and the frontend remained locked.

**The Fix:**
- In `qcController.js` (`updateChecklistItem` and `submitDecision`), replaced the check `if (job.partChecks.length > 0)` with `if (job.finalCheckFilledBy)`. 
- `finalCheckFilledBy` is reliably populated across *all* manufactured orders (both Machine and Sub Child Part) the moment Production saves their initial self-check. 
- In `qcController.js` (`updateChecklistItem` and `submitDecision`), replaced the check `if (job.partChecks.length > 0)` with `if (job.finalCheckFilledBy)`. 
- `finalCheckFilledBy` is reliably populated across *all* manufactured orders (both Machine and Sub Child Part) the moment Production saves their initial self-check. 
- Now, when QC clicks a verdict on a Sub Child Part job, it correctly updates `qcStatus`, instantly updating the frontend and unlocking the submit decision button.

## 3. Child Part Order Unit 1 Showing Zero Process Steps

**The Bug:**
On the Process Execution page (`/production/process-execution`), when a Child Part order was selected, **Unit 1 always showed 0 process steps** with a blank panel. Units 2, 3, 4, 5 (etc.) showed the correct 3 steps (Fabrication, Assembly, Painting).

**Root Cause:**
The issue was in the `getUnitProcessesFor` helper function in `ProcessExecution.jsx` (line 37). The logic was:

```js
// BEFORE (broken)
const getUnitProcessesFor = (order, unitNumber = 1) => {
  if (!order) return [];
  if (unitNumber <= 1) return order.processes;           // ← no fallback
  const extra = order.extraUnits?.[unitNumber - 2];
  return extra ? extra.processes : buildDefaultProcesses(order.orderKind);
};
```

For **Units 2+**, when no `extraUnits` entry exists yet (they're lazily created on first use), the function correctly falls back to `buildDefaultProcesses(order.orderKind)`, which returns the 3-step ChildPart pipeline `['Fabrication', 'Assembly', 'Painting']`.

For **Unit 1**, it returned `order.processes` directly — but ChildPart orders are deliberately created with `processes: []` (empty) in `childPartReorderService.js` because their pipeline is materialized lazily on first use, just like extra units. Since there was no fallback, Unit 1 always rendered a blank panel.

**The Fix:**
A one-line change in `ProcessExecution.jsx`'s `getUnitProcessesFor` to apply the same fallback to Unit 1 as Units 2+ already had:

```js
// AFTER (fixed)
if (unitNumber <= 1) return order.processes?.length ? order.processes : buildDefaultProcesses(order.orderKind);
```

This was a **frontend-only** fix. No backend changes were required.

## 4. "Send to QC" Failing with Leftover Length Required Error (Sub Child Job Work)

**The Bug:**
On `Accounts > Purchases > Sub Child Job Work`, clicking "Send to QC" on the complete-order dialog always threw the error:
> *"A measured leftover length is required to complete this order (enter 0 if there is none)."*

...even when the user had filled in a valid number like `700` in the leftover length field.

**Root Cause — Unit Key Mismatch:**
The receive dialog had a free-text `<Input>` for the unit field, initialized to `'mm'`:
```js
const [recvLengthUnit, setRecvLengthUnit] = useState('mm');
```

The body sent to the backend contained `leftoverLengthUnit: 'mm'`. The backend's `toMm(value, unit)` utility looks up this unit in `LENGTH_UNIT_TO_MM`, where the valid keys are full names (`Millimeter`, `Centimeter`, `Meter`, `Inch`, `Foot`) — not abbreviations. `LENGTH_UNIT_TO_MM['mm']` returns `undefined`, making `toMm` return `null`, which triggered the error gate regardless of the value entered.

The system does have full unit conversion — the inventory stores all dimension values internally in **mm** as the canonical unit. Users can legitimately enter values in any supported unit; `toMm` converts before saving. The problem was only that the wrong key string was being sent.

**The Fix (frontend-only, `SubChildJobWork.jsx`):**
- Added a `LENGTH_UNITS = ['Millimeter', 'Centimeter', 'Meter', 'Inch', 'Foot']` constant matching the backend's lookup table exactly.
- Replaced the free-text `<Input placeholder="Unit (mm/cm/in...)">` for both the length and width unit fields with proper `<Select>` dropdowns using these keys.
- Changed the initial and reset state for both units from `'mm'` to `'Millimeter'`.
- No backend changes were required.

## 5. "Invalid step index" Error When Assigning Team on Child Part Process

**The Bug:**
When clicking "Assign Team" on the first process step (`Fabrication`) of a `ChildPart` order, the system threw an error:
> `{"success":false,"message":"Invalid step index"}`

**Root Cause — Empty `processes` Array for Unit 1:**
This was a secondary symptom of the same bug we fixed earlier (Bug 3), where the database was missing the `processes` array entirely for Unit 1 of a `ChildPart` order.

In `ProcessExecution.jsx`, we fixed the rendering by making `getUnitProcessesFor` fall back to the default steps (`buildDefaultProcesses`) if `order.processes` was empty. However, the API wrapper in `ProductionContext.jsx` (`stepIndex`) also needed to find the index of the clicked step (e.g., `'Fabrication'`) to send to the backend. It was reading directly from `(order?.processes || [])`.
Since `processes` was empty in the database, `[].map(p => p.step).indexOf('Fabrication')` returned `-1`.
The frontend sent `/processes/-1/assign-team`, and the backend correctly rejected `-1` as an "Invalid step index".

**The Fix (frontend-only, `ProductionContext.jsx`):**
- Updated the `stepIndex` helper function to apply the exact same fallback logic. If `order.processes` is empty, it uses `stepsForOrderKind(order.orderKind)` to construct the default array.
- This ensures `indexOf('Fabrication')` correctly resolves to `0` and sends the correct index to the backend.

**The Fix (Database data correction):**
- Even with the frontend sending `0`, the backend's `idx >= procs.length` check still failed because `procs` was truly `[]` in the database.
- Ran a manual script (`fix-orders.js`) directly on the database to locate the 2 affected `ChildPart` orders that were missing their processes array.
- Seeded the `processes` array for those corrupted orders with the correct `['Fabrication', 'Assembly', 'Painting']` steps.

---

## 6. Regression introduced by Bugs 3 & 5 — bogus 6-step pipeline rendered for Sub Child Part orders

**The Bug (found and fixed 2026-09-19, in a later session):**
Bugs 3 and 5 above genuinely fixed what they targeted (`ChildPart` orders' Unit 1), but their fallback wasn't scoped to `ChildPart` specifically — it fired for **any** order with an empty `processes[]`. A `SubChildPart` order's `processes[]` is *never* populated at all, by design (its real UI is an entirely separate checklist/"Total Job Work Cost" panel, not a `processes[]`-driven step list) — so after these two fixes, every Sub Child Part order's Process Execution page started rendering a fabricated 6-step `Job Work → Fabrication → Assembly → Painting → Re-Assembly → Final Testing` pipeline underneath its real panel, complete with live (but non-functional) "Start"/"Assign Team" buttons. None of it corresponded to anything in the database.

The same fallback was also structurally wrong for `Machine` orders going forward: since the 2026-09-17 Machine build-pipeline redesign, a Machine order can legitimately be *either* the old 6-step pipeline *or* a new 2-step one (`['Assembly', 'Final Testing']`, for orders whose Item has a real `MachineBOM`) — both share `orderKind: 'Machine'`, so a static per-orderKind fallback has no single correct shape to guess and would have silently shown the wrong one for any Machine order that ever hit it (none currently do — every Machine order gets a real, non-empty `processes[]` at creation — but the fallback was a live landmine for any future edge case).

**Root cause, found while fixing this:** Bug 3/5's own fix was only ever a workaround for a deeper, separate gap — `createChildPartOrderForItem` (`childPartReorderService.js`) had *always* created every `ChildPart` order with `processes: []`, on the stale assumption (its own code comment said so) that some later "process section" pass would materialize Unit 1's real steps afterward. Nothing ever did — `extraUnits[]` (Units 2+) get lazily materialized on first touch via `getUnitProcesses`, but Unit 1 never had an equivalent. So *every* `ChildPart` order ever created, not just the "2 affected" ones the manual DB script found at the time, carried this same latent defect — it just stayed invisible as long as the frontend silently rendered a blank panel instead of trying to act on it.

**The Fix:**
- `childPartReorderService.js`'s `createChildPartOrderForItem` now sets `processes: buildProcessSteps('ChildPart')` at creation time — a real, non-empty 3-step array from the start, matching how Machine order creation (`resolveMachineOrderProcesses`) already works. This is the actual root-cause fix; Bug 3/5's frontend fallback is no longer load-bearing for new orders, only a defensive safety net for old data.
- `ProcessExecution.jsx`'s `getUnitProcessesFor` and `ProductionContext.jsx`'s `stepIndex` both had their empty-`processes[]` fallback re-scoped to fire only when `order.orderKind === 'ChildPart'` — every other kind (`SubChildPart`, `Machine`) now correctly gets an empty array/`-1` index instead of a fabricated pipeline, restoring the original, correct behavior for them.
- **Database data correction:** re-swept for `ChildPart` orders still stuck with empty `processes[]` (the pre-fix creation bug could have kept producing new ones since the "2 affected" manual patch) — found 1 more (`ORD-2026-061`), seeded with the real `['Fabrication', 'Assembly', 'Painting']` steps via `buildProcessSteps('ChildPart')` directly, matching exactly what a correctly-created order now gets. Zero `Machine` orders were ever affected (confirmed directly against the database — every Machine order already had a real, non-empty `processes[]`).

**Verified against the real database:** 5/5 assertions — created a real `ChildPart` order through the actual `createChildPartOrderForItem` function and confirmed it now gets a real 3-step `processes[]` at creation, correctly ordered, every step `Pending`; test fixtures cleaned up after. `node --check` + runtime import check on the touched backend file. `npx vite build` clean.

---

## 7. Child Part QC Jobs Missing from `/qc/jobs`' "All Sources" View

**The Bug (found and fixed 2026-09-19):**
`getQCJobs`' `excludeSource` mechanism and `QCJobs.jsx`'s "All" pill were both deliberately built (2026-09-16) to hide `SubChildPartJobWork`/`ChildPartProduction` QC jobs from the default "All Sources" list, on the reasoning that their nested per-part/per-unit review shape was too structurally different to mix into the flat list — visible only via their own dedicated filter pill instead. Reported as a bug: the user wants "All Sources" to mean literally every QC job, no carve-out.

**The Fix:**
- `QCJobs.jsx` — removed the `else params.set('excludeSource', 'SubChildPartJobWork,ChildPartProduction')` branch entirely; `sourceFilter === 'all'` now sends no `source`/`excludeSource` param at all, and `getQCJobs` already treats that as "no filter" (returns everything). The per-kind pills remain as a convenience filter, not an exclusion.
- No backend change needed.

**Verified:** `npx esbuild` bundle-check on the touched file (no dev server available in this pass to click through).

---

## 8. Child Part QC Jobs Created Prematurely (regression from the 2026-09-17 Machine build-pipeline pass)

**The Bug (found and fixed 2026-09-19):** Own regression, not Antigravity's. The `finalChecklistResp` query added to `ProcessExecution.jsx` in the Machine 2-step build-pipeline pass (to fix Machine's own "two uncoordinated finish-this-step buttons" issue on Final Testing) was gated with:
```js
enabled: !!selectedOrderKey && (selectedOrder?.processes || []).find(p => p.step === 'Final Testing')?.status !== 'Pending',
```
A `ChildPart` order's real pipeline (`Fabrication → Assembly → Painting`) never has a step literally named `'Final Testing'`, so `.find()` always returns `undefined`, and `undefined?.status !== 'Pending'` evaluates to `true` — collapsing the gate to "always enabled" for every Child Part order. The query's own `GET .../final-checklist` handler calls `ensureQCJobForOrder`, which has a real side effect (creates a QCJob, `status:'Pending'`, immediately visible to QC) — so simply opening any Child Part order's Process Execution page created a visible, empty QC job for it, regardless of real progress. Same root shape as Bug 1 above, just on a query this session itself introduced afterward; not caught by Bug 1's Draft-state fix because that fix was scoped to `orderKind === 'SubChildPart'`(create-time) and this is a different, `ChildPart`-only code path.

**The Fix:**
- `ProcessExecution.jsx` — added an explicit `isMachineOrder &&` to the query's `enabled` condition, so it can only ever fire for a real Machine order (the only order kind that has a `'Final Testing'` step at all).

**Database cleanup:** 2 real Child Part orders (`ORD-2026-056`, `ORD-2026-061`) already had a premature `QCJob` (`QC-2026-0192`, `QC-2026-0198`) from this bug — both `status:'Pending'`, all units still `'Awaiting Production'`/untouched, harmless. Per the user's explicit decision, left as-is (not deleted) rather than cleaned up.

**Verified:** `npx esbuild` bundle-check on the touched file; confirmed via direct DB query that no other Child Part order currently carries a premature QCJob beyond the 2 known ones.

---

## 9. Child Part Assembly — Redesigned Away From the Vestigial Self-Certify Step

**The Bug (reported 2026-09-19):** Child Part's Assembly step had a pointless intermediate step: Start → generic "Mark Complete" → generic self-certify "Approve QC" (just types a name, no real review) — only **after** that did the real Initial/Process QC checklist panel even unlock. Nothing downstream ever read Assembly's self-certified `qcStatus`/`qcBy`/`qcDate` — the self-certify step existed only to flip `proc.status` to `'Completed'`, which was the render-gate the real checklist panel and Painting's own Start both happened to depend on.

**The Fix — new design:** Start → fill the real checklist directly → submitting the Process stage of the checklist IS what completes Assembly. No more generic self-certify step for Assembly.
- `productionMfgController.js`:
  - `markProcessComplete`'s `ChildPart` branch now refuses `proc.step === 'Assembly'` outright (mirrors the existing Painting refusal), directing the user to the real checklist instead.
  - `approveQC` (the generic self-certify endpoint) also refuses `orderKind === 'ChildPart' && step === 'Assembly'`, for the same reason — belt-and-braces since this endpoint isn't otherwise scoped by orderKind/step.
  - `saveChildPartUnitChecklist`'s precondition gate changed from requiring Assembly already `'Completed'` to requiring it `'In Progress'` (i.e. Started) — the old gate was backwards for the new design, since submitting Process is now what *causes* `'Completed'`, not a thing that requires it first.
  - `saveChildPartUnitChecklist`, on a successful `stage: 'process'` submit, now also sets `procs[1].status = 'Completed'` (+ `endDate`/`completedAt`, deliberately no fabricated `qcStatus`/`qcBy` — this only means "sent to QC", not "QC approved").
- `qcController.js`'s `decideChildPartUnit`: on a `Rejected` decision, now resolves the order via `job.sourceRefId` and reopens that unit's Assembly step back to `'In Progress'` (+ `qcStatus:'Rejected'` + a `reworks[]` entry), mirroring the existing `reopenFinalTestingForRejection` pattern for Machine's Final Testing — without this, `saveChildPartUnitChecklist`'s new `'In Progress'` gate would permanently lock Production out of resubmitting after a reject. An `Approved` decision leaves Assembly untouched (already `'Completed'`, correctly terminal).
- `ProcessExecution.jsx`:
  - `cpAssemblyStarted` (renamed from `cpAssemblyDone`) now gates the checklist queries/panel on Assembly `status !== 'Pending'` instead of `=== 'Completed'` — has to stay `true` once Assembly reaches `'Completed'` too (not flip back off), otherwise reopening the order or switching units after submitting would disable the very queries showing what was already submitted. Uses an explicit `!!foundStep &&` guard rather than a bare `?.status !== 'Pending'`, so a missing/not-yet-loaded Assembly step reads as "not started" rather than silently collapsing to "started" — the same failure shape as Bug 8 above.
  - The checklist panel's own render condition changed the same way (`proc.status !== 'Pending'`, was `=== 'Completed'`).
  - The generic "Mark Complete" button is now hidden for Child Part's Assembly step (joins Painting, which was already hidden), replaced with a hint: "Submitting the Process checklist below completes Assembly."

**Verified against the real database:** confirmed zero live Child Part orders were caught mid self-certify (Assembly at `'QC Pending'`) at fix time — no data migration needed. Built a real `TEST-` order through the actual controllers (not mocked service calls) and ran the full new cycle end-to-end: `markProcessComplete`/`approveQC` both correctly refuse Assembly; `saveChildPartUnitChecklist('initial')` succeeds while Assembly is `'In Progress'`; `saveChildPartUnitChecklist('process')` auto-completes Assembly with no fabricated `qcBy`; `decideChildPartUnit('Rejected')` reopens Assembly to `'In Progress'` with a rework entry; resubmitting `'process'` re-completes it; `decideChildPartUnit('Approved')` leaves it `'Completed'`; Painting's own `startProcess` then succeeds, confirming the existing `procs[idx-1].status==='Completed'` gate chain still holds. 8/8 assertions passed; fixture cleaned up after. `node --check` on both backend files; `npx esbuild` bundle-check on `ProcessExecution.jsx`.

---

## 10. Machine's Final Testing — same vestigial self-certify problem, plus two real correctness bugs

**Reported 2026-09-19, same day as Bug 9.** Three related issues on Machine's Final Testing step: (1) Assembly (MachineBOM pipeline) has no per-unit material consumption panel the way Child Part's Fabrication does — **not fixed in this pass, out of scope for what was asked**; (2) Production could resubmit the Final Testing checklist endlessly, with no real "sent to QC, locked" moment; (3) there was no way for Production to record the real build cost/expense on the actual completion path.

**Root cause, found while investigating — the SAME "two disconnected tracks" shape.** Final Testing had two entirely independent completion paths that never coordinated: **Track A**, Production's own self-certify (`markProcessComplete` → `'QC Pending'`, then a generic "Approve QC" dialog — `approveQC`'s `isFinalStep` branch — where Production types their own name, optionally enters cost/expense, and the order completes regardless of what real QC decided); **Track B**, QC department's real review (`/qc/jobs` → `submitDecision`), which decided Pass/Fail and credited inventory but **never touched `order.processes` at all** — so a real QC Pass left the order's own Final Testing step permanently stuck below `'Completed'` unless Production separately self-certified via Track A. `saveFinalChecklist`'s own resubmission lock was keyed purely on `qcJob.status` (QC having started reviewing), never on `order.processes[idx].status` — so before Production ever touched Track A, the checklist could be resubmitted without limit.

**User's fix instruction, resolving the design ambiguity**: cost/expense is uploaded by Production once, on the very first submission — a later QC-reject → rework → resubmit cycle must NOT ask for it again.

**The fix — collapsed into one coherent flow, mirroring Bug 9's Assembly redesign:**
- `QCJob.js`: new `finalCheckProductionCost`/`finalCheckProductionExpense` fields — captured once, never re-asked (their presence, via `finalCheckFilledAt`, is what tells `saveFinalChecklist` whether this is a first submission or a reject-resubmit).
- `saveFinalChecklist` (`productionMfgController.js`) rewritten: now takes `unit`, resolves that unit's own Final Testing step, and requires it to be `'In Progress'` (a real, order-level lock — not just a `qcJob.status` proxy) before allowing any edit at all. On success: requires + stores cost/expense **only** on the first-ever submission (pushed into RDBOM/MachineBOM via a new extracted `applyManufacturedFinalCost` helper), merges the checklist as before, and — new — sets that unit's own Final Testing to `'QC Pending'` itself. Submitting the checklist IS sending it to QC now; there's no separate action.
- `markProcessComplete`/`approveQC`/`rejectQC` (`productionMfgController.js`) all now refuse `step === 'Final Testing'` outright — Track A is retired. This left `approveQC`'s own `isFinalStep` cost-capture block and its downstream `allUnitsCompleted`/order-completion side effects (lead-time sampling, Packing notification, Sale status update) permanently unreachable (every real order kind's actual last step — Final Testing for Machine, Painting/Assembly for Child Part — is now refused earlier in that same function) — the cost block was deleted outright (it referenced now-removed variables); the completion side-effects were left in place as an inert fallback rather than deleted, out of caution.
- `submitDecision` (`qcController.js`) — the REAL gate now. On a genuine Machine build's Pass decision (guarded off `SubChildPartJobWork`/`SubChildPartProduction`/`ChildPartProduction`, which already have their own handling, and off the order actually having a `'Final Testing'` step), every unit whose Final Testing is `'QC Pending'` is marked `'Completed'`; if `allUnitsCompleted`, `order.status` becomes `'Completed'` and the same per-unit lead-time sampling `approveQC` used to do now runs here instead. The reject side of this already existed (`reopenFinalTestingForRejection`, unchanged) — Track A's reject button is what's newly gone, not the mechanism itself.
- The "Production Completed" Sale-status flip + notification (used to fire off Production's own self-certify, with zero real QC review behind it) moved to `saveFinalChecklist` itself, firing once every unit's Final Testing has at least been *submitted* (a new `allUnitsFinalTestingSubmitted` helper) — guarded by a before/after transition check so a reject→resubmit cycle doesn't re-fire it. This is deliberately NOT the same checkpoint as real order completion (`'Approved from QC'`, still only set by the real QC Pass in `submitDecision`) — it represents "Production says every unit is built," same meaning `'Production Completed'` always had, just reached differently now.
- `FinalChecklistPanel.jsx`: added Production Cost/Expense inputs, shown only on the first submission (`!filledBy`); `ChecklistStepper.jsx` gained an `extraDisabled` prop (default `false`, safe for its other caller `FillChecklistDialog`) so the Submit button also respects cost validity. `ProcessExecution.jsx`: removed the now-dead `finalChecklistResp`/`finalChecklistReady` query pair (Mark Complete no longer applies to Final Testing at all); Final Testing excluded from "Mark Complete" and the "Approve QC"/"Reject QC" buttons, both replaced with a plain status hint; `unitNumber={activeUnit}` threaded into `FinalChecklistPanel` so it advances the correct unit (a pre-existing per-unit/shared-checklist mismatch — the checklist itself is shared per order, only the process *step* is per-unit — carried forward as-is, not redesigned).

**Real stuck order found and fixed while verifying**: `PROD-2026-304928` — QC had already genuinely Approved its Final Testing (`QCJob QC-2026-0196`, every checklist row real `qcStatus:'Pass'`, `job.status:'Approved'`, inspector `rahul`) via the old Track B, but Track A was never separately clicked, so `order.processes` stayed at `'In Progress'` forever with no way to complete it (Track B never had `submitDecision` touch `order.processes` before this fix). A full DB sweep found this was the only order in this exact stuck shape. Corrected directly: Final Testing → `'Completed'`, `qcStatus:'Approved'`, `qcBy:'rahul'`; order → `'Completed'`. Its `finalCheckProductionCost`/`Expense` were never real (this build predates cost-capture entirely) — left unset rather than fabricated; flagged to the user as a known, real gap in this one record's history.

**Verified against the real database**: a full 10-step, real-controller (not mocked) scratch test — `markProcessComplete`/`approveQC`/`rejectQC` all correctly refuse Final Testing; `saveFinalChecklist` refuses without cost on first submission, succeeds with it, then refuses ANY further resubmission while `'QC Pending'` (the endless-resubmit bug, confirmed fixed); `submitDecision`'s real Fail reopens Final Testing via the existing `reopenFinalTestingForRejection` with cost preserved; resubmitting after reject succeeds with no cost fields sent and the stored cost unchanged; `submitDecision`'s real Pass completes the unit, the order, and correctly credits inventory (existing, untouched generic path) — 10/10 steps passed. Also swept and cleaned up stray `Notification`/`Item` documents this test (and an earlier untracked one from the same session) left behind — a reminder that a QC-approval Pass path can create a real `Item` via its own generic inventory-credit logic, not just the models a test directly touches. `node --check` + a runtime import check (new `qcController.js` → `productionMfgController.js` import, confirmed non-circular) on both backend files; `npx esbuild` bundle-check on all three touched frontend files.

**Deliberately not done**: Bug 1 (Assembly's missing Material List) — not part of this fix, still open.

**Follow-up, same day, caught while auditing "can this get stuck again":** the user asked
specifically whether the just-fixed stuck-order bug could recur. Re-tracing (not just
re-asserting the fix) found a second, real path to the SAME shape: the Final Testing
checklist is shared across every unit of a multi-quantity order (one `QCJob`, not one per
unit), but each unit's own Final Testing *step* is independent. If QC approves Unit 1's
submission first, `qcJob.status` becomes `'Approved'` — and a later, independently-submitted
Unit 2 had nothing that reset it back, so `submitDecision` (which only ever matches a job at
`status:'In Progress'`) could never be called on Unit 2's decision either. Same
permanently-stuck shape, reachable through staggered multi-unit timing instead of the old
Track A/B split. Confirmed reachable with a real multi-unit scratch test before fixing.
**Fixed in `saveFinalChecklist`:**
- Refuses a submission outright if a DIFFERENT unit's Final Testing is currently
  `'QC Pending'` on this same shared checklist (prevents silently overwriting whatever QC is
  actively reviewing, and gives a clean invariant: at most one unit "in flight" at a time).
- The `wasRejected`-triggered `qcJob.status` reset (back to `'Pending'`) was broadened to
  also cover `'Approved'`, not just `'Rejected'` — a later unit's fresh submission now always
  reopens the shared job for a new decision, regardless of what the previous decision was.
- Swept the real database for every existing multi-unit Machine order in this exact shape —
  none found (all multi-unit orders were either fully old-flow `'Completed'` already, or
  never started); no data correction needed this time.
- Verified via a dedicated 5-step real-controller scratch test: Unit 1 submits and is
  Approved; Unit 2 submitting while Unit 1 is still `'QC Pending'` is refused; Unit 2
  submitting AFTER Unit 1's Approval correctly reopens the job to `'Pending'` (not stuck);
  QC can then genuinely decide on Unit 2, completing the whole order. Stray `Notification`/
  `Item` documents cleaned up after.

**Confirmed scope, not an oversight**: the user pointed out units of the same order can be
built fully in parallel (given enough material) — worth being explicit that this fix does
NOT make that true all the way through Final Testing. Build work (Assembly, material
consumption, everything up to Final Testing) is already fully independent per unit,
untouched by any of this. Only the Final Testing *checklist submission* is serialized by
this fix — one shared `QCJob`/checklist per order (a pre-existing design, not introduced
here), so only one unit can be under QC review at a time; a second unit ready at the same
time has to wait for the first's decision before it can submit. The alternative (a fully
per-unit checklist, mirroring Child Part's `unitChecks[]`) was raised and explicitly
declined for now — user confirmed the serialized version is fine unless it becomes a real
bottleneck in practice.

---

## 11. R&D Couldn't Approve an Initial BOM Request Unless the MachineBOM Was Already Locked

**Reported 2026-09-19.** Clicking Approve on a Pending "Initial BOM" R&D request
(`/r&d/approve-requests`) for a real MachineBOM-driven order (`PROD-2026-413895`, Blower
Pulverizer/BP816) failed with `"No materials found in Master BOM."`, even though the
Machine's `MachineBOM` genuinely exists — it just isn't locked yet (confirmed against
Process Execution's own "BOM Not Locked" badge for the same order).

**Root cause — a misunderstood purpose, not a leftover-old-flow bug.** `processRDRequest`'s
Initial BOM approval (`rdController.js`) already correctly checked the NEW `MachineBOM`
(not the old `RDBOM`) — that part of the 2026-09-17 cutover was fine. But it also required
`machineBom.isLocked`, mirroring `getBomDesignStatus`'s own auto-verify gate — the wrong
model. The auto-verify gate (`applyAutoVerify`) IS the normal path: it fires on its own,
with no R&D click at all, the moment a locked BOM + approved design both exist. This manual
R&D queue only exists for the case where THAT hasn't happened yet — Production raises a
request asking permission to proceed anyway, and R&D grants it as a judgment call. Requiring
`isLocked` here made this fallback action just as strict as the thing it's supposed to be a
fallback FOR, so it could only ever succeed in the one case where it was never actually
needed (auto-verify would already have handled it). The error message itself was also stale
— a leftover from before the MachineBOM cutover, when it genuinely meant "no material lines
in the BOM at all."

**The fix:**
- `processRDRequest`'s Initial BOM approval now only requires the `MachineBOM` document to
  EXIST (so there's something real for R&D to have reviewed — `getRDRequestReviewData`
  already correctly pulls its materials from this same `MachineBOM`, confirmed unchanged) —
  not that it be locked. R&D can now approve as an explicit override regardless of lock
  status, exactly matching the intended "Production asks permission when auto-verify hasn't
  cleared it yet" design.
- Error message updated to match what's actually being checked now (missing BOM entirely,
  not "no materials").
- Confirmed unchanged, per explicit instruction: this approval still does NOT create any
  material transfer request to Store (Production's own "Issue" button already owns that,
  since the 2026-09-17 cutover) — this was already correctly removed in an earlier pass, not
  reintroduced.
- `getBomDesignStatus`/`applyAutoVerify` (the real auto-verify gate) were NOT touched — they
  correctly keep requiring `isLocked`, since that IS the normal, no-R&D-needed path this
  manual queue is the fallback for.

**Verified against the real database**: a real-controller scratch test (isolated `TEST-`
fixtures) — Approve correctly still refused when no `MachineBOM` exists at all (with the new,
accurate message); Approve now succeeds against a real, deliberately UNLOCKED `MachineBOM`,
correctly setting `bomVerified`/`designVerified`/clearing `rdRequestRaised`/flipping
`order.status` to `'Pending'`, with zero `materialDemands[]` entries pushed. `node --check`
on the touched file. The user's own real order (`PROD-2026-413895`) was deliberately left
untouched by this test — its real R&D approval is theirs to click through the UI now that
the fix is live, not something to simulate/approve on their behalf via a script.

---

## 12. "Sub Child Part QC" Pill on `/qc/jobs` Only Showed the Purchase Half

**Reported 2026-09-19.** Sub Child Part QC jobs can arise from either of two real routes —
Purchase's own Job Work flow (`/accounts/purchases/sub-child-job-work`, `QCJob.source:
'SubChildPartJobWork'`) or Production's in-house route (Process Execution's own "final
submit", `QCJob.source: 'SubChildPartProduction'`) — which route a given Sub Child Part
Item uses is its own `subChildPartDetails.jobWork` flag, but both are genuinely the same
tier's QC. "All Sources" (fixed as Bug 7) correctly showed both. Clicking the dedicated
"Sub Child Part QC" pill, however, only ever showed the Purchase half — the in-house
Production route's own jobs vanished the moment that pill was selected.

**Root cause**: `QCJobs.jsx`'s `sources` array only ever had a `'SubChildPartJobWork'`
value/pill — `'SubChildPartProduction'` was never added anywhere, at any point. The backend
`getQCJobs` also only ever supported `source` as a single exact-match value (`filter.source
= source`), with no way to ask for more than one at once — unlike its own sibling
`excludeSource`, which already supported a comma-separated list via `$nin`.

**The fix:**
- `getQCJobs` (`qcController.js`): `source` now also accepts a comma-separated list, mirroring
  `excludeSource`'s existing pattern (`$in` instead of exact match — behaves identically to
  before for every existing single-value caller).
- `QCJobs.jsx`: the "Sub Child Part QC" pill itself is unchanged (same single stored value,
  same label, same active-state styling) — only the value actually SENT to the backend is
  expanded, via a small `sourceQueryValue()` mapper, to `SubChildPartJobWork,SubChildPartProduction`
  specifically for that one pill. Every other pill (Purchase/Production/Store/Child Part QC)
  is unaffected.

**Verified against the real database**: real counts at fix time were 1 `SubChildPartJobWork`
job and 3 `SubChildPartProduction` jobs. Calling `getQCJobs` directly confirmed: a single
`source=SubChildPartJobWork` request still returns exactly the 1 (old behavior, unaffected);
the new comma-joined request returns all 4, spanning both real `source` values; an unrelated
single-value source (`Purchase`, 85 real jobs) is unaffected. `node --check` on the backend
file; `npx esbuild` bundle-check on the frontend file.

---

## 13. Sub Child Part Job Work — hard-blocked "Send Round" on a stale, non-reservation-aware snapshot; leftover margin unwarned

**Reported 2026-09-19.** Not a code bug in the sense of broken logic — a confirmed bad
design, per the user's own words: "we are blocking user by purchase request... but the
physical stock is something you can make mistake... so blocking here... is bad design."
`/accounts/purchases/sub-child-job-work` removed the "Send Round" button entirely whenever
`order.liveAvailability.shortfallQty > 0`, replacing it with "Waiting on Store — can't send
until material is available." That snapshot (`computeSubChildPartRawMaterialAvailability`)
is a pure read of raw `Item.qty`/`dimensionVariants[].subStock` taken fresh per page load —
no awareness of the real `MaterialReservation` ledger, and stale by the time of an actual
click.

**Confirmed against real production data**: 3 real `SubChildPartJobWorkOrder`s (qty 30/
`ChildPartCascade`, qty 6 and 12/`MachineCascade`) all racing the same 1-sheet stock. Real
`MaterialReservation` documents already existed tracking these (and other) orders' claims —
never consulted by the availability check, so bumping raw stock (e.g. manually) just handed
a false "available" signal to whichever order's check happened to run next, without regard
to who legitimately claimed the stock first.

**The fix — three parts:**
1. **`SubChildJobWork.jsx`**: removed `isFirstRoundPending`/`isShort` and the "Waiting on
   Store" block entirely — "Send Round" now shows whenever the three legitimate conditions
   (not fully covered, no round already pending, not already at QC) are met, full stop. The
   Raw Material badge stays exactly as informative as before; the real gate is now solely
   the backend's own send-time check, surfaced via the existing "Send Failed" toast.
2. **Reservation-aware availability, badge AND real gate**: new `getFreeQtyExcludingOrder`
   (`materialReservationService.js`) and a new read-only wrapper
   `computeSubChildPartRawMaterialAvailabilityLive` (`subChildPartOrderService.js`, sibling
   of the creation-time `resolveSubChildPartRawMaterialNeed`, same pure
   `computeSubChildPartRawMaterialAvailability` underneath — untouched, still used unchanged
   by the cron/PR-raising). All four read call sites in
   `subChildPartJobWorkOrderController.js` (material-options preview, list badge, detail
   badge, and — critically — the real send-time gate inside `sendSubChildPartJobWorkRound`)
   switched to the live wrapper. No new `MaterialReservation` writes anywhere —
   `checkAndReserve` still only ever runs once, at order creation.
   - **A real correctness subtlety found during verification, not just assumed correct**:
     naively excluding only the order-being-checked's own reservation from the sum isn't
     enough — a LATER-created competing order's reservation would then wrongly count
     against an EARLIER order's own live re-check too, retroactively penalizing a claim
     already legitimately secured first (reproduced directly: order A's live shortfall
     flipped from 0 to 1 purely because order B, created after A, also reserved against the
     same stock). Fixed by making `getFreeQtyExcludingOrder` priority-aware: only
     reservations that existed STRICTLY BEFORE the order-being-checked's own reservation
     (by `createdAt`, stable across re-checks since Mongoose only sets it once) count
     against its free qty — `checkAndReserve` already reserves each order's FULL need in
     creation order, so reservation recency IS the correct priority signal.
   - **Confirmed explicitly with the user, a real boundary worth remembering**: shortfall
     must ALWAYS be computed against the catalog dimension variant only, at every layer
     including the cron's own PR-raising — a leftover (`isLeftover:true`) variant is
     exclusively a "use case" (an alternate source Purchase can choose at the actual send
     action, already how Case-1/Case-2 selection works), never a factor in whether a
     shortfall is reported. Considered and explicitly declined summing compatible-leftover
     stock into the availability computation itself.
3. **Leftover area-margin warning (sheet metal, Case-1 "cut piece" only)**: a chosen
   leftover/catalog size having raw area ≥ needed doesn't account for real cutting waste
   (kerf, layout inefficiency) — "just barely enough" can still fail in practice. Added a
   client-side-only (`SubChildJobWork.jsx`) `cutMarginInfo` computation (mirrors
   `applyCutSend`'s own area formula) showing a non-blocking amber warning when the chosen
   size's spare area over `totalAreaNeededMm2` is under 15% (confirmed threshold,
   `CUT_MARGIN_WARNING_RATIO`, a single easy-to-retune constant). The existing hard block in
   `applyCutSend` (genuinely insufficient area) is untouched — this is an additive warning
   for "technically enough but thin," not a new gate. Case 2 (whole-sheet, exact-match-only)
   and the length kind's `matchesRemainder` flow (also exact-match-only) have no margin
   concept and are untouched.

**Verified against the real database**: two real-controller (not mocked) scratch tests,
isolated `TEST-` fixtures, cleaned up after with a stray-record check (`MaterialReservation`/
orders/`Item`s) both times.
- Reservation-awareness: `checkAndReserve` for order A then B against one shared unit of
  stock (mirrors real creation order) → confirmed the OLD raw function wrongly reports BOTH
  "Available"; confirmed the NEW live wrapper — via the REAL `listSubChildPartJobWorkOrders`/
  `getSubChildPartJobWorkOrder`/`sendSubChildPartJobWorkRound` handlers — correctly shows A
  available, B short, refuses B's send with a proper 400, succeeds for A (decrementing real
  stock), and still refuses B afterward (now doubly short). 7/7 steps passed.
  Independently caught and fixed the priority-ordering subtlety above during this same run
  (a real bug in the first draft of the fix, found by the test itself, not assumed correct).
- Margin warning: a real sheet-metal fixture (1,000,000mm² needed; a 1,100,000mm² leftover =
  exactly 10% margin, a 1,250,000mm² leftover = exactly 25%) — called the real
  `getSubChildPartJobWorkMaterialOptions` for genuine numbers, confirmed the 10% leftover
  crosses the 15% threshold (would warn) and the 25% one doesn't; confirmed
  `sendSubChildPartJobWorkRound` with a deliberately-too-low piece count still hits the
  existing, unchanged hard block. 3/3 steps passed.
- `node --check` on all three touched backend files; `npx esbuild` bundle-check on the
  frontend file.

---

## 14. Sub Child Part / Child Part QC Approvals Leaking Into the Packaging (Dispatch) Queue

**Reported 2026-09-19.** QC-approving a Sub Child Part or Child Part build correctly credits
Store's own inventory — but the same approval also incorrectly surfaced the item on the
Packaging Queue (`/packaging-dispatch/packaging-queue`), as if it were a finished Machine
ready to ship to a customer.

**Root cause**: `getReadyForPackaging` (`packagingDispatchController.js`) only excluded
`source: 'Stock'` from its approved-QC-jobs query — it never learned about Sub Child Part's
two QC routes (`SubChildPartJobWork`, `SubChildPartProduction`) or Child Part's own
(`ChildPartProduction`). Anything not `'Purchase'` was included unconditionally right after.
Confirmed against real data: `QC-2026-0195` (Fan Blade, `SubChildPartJobWork`) and
`QC-2026-0193` (Fan Bush, `SubChildPartProduction`) were both sitting at `status:'Approved'`
and both leaking through. Child Part's own case is the same structural gap but currently
dormant — its real per-unit decision (`decideChildPartUnit`) never writes the job's
top-level `status` at all, so nothing has actually pushed one to `'Approved'` yet; fixed
proactively rather than waiting for it to surface.

**The fix**: extended the query's exclusion from `source: { $ne: 'Stock' }` to
`source: { $nin: ['Stock', 'SubChildPartJobWork', 'SubChildPartProduction', 'ChildPartProduction'] }`
— same "internal stock-replenishment routes, never customer-facing dispatch" grouping this
codebase already uses elsewhere (`getQCJobs`'s own `excludeSource`).

**Verified against the real database**: called the real `getReadyForPackaging` handler
directly — confirmed both real leaked jobs (`QC-2026-0195`, `QC-2026-0193`) no longer appear
in the response, while all 26 other legitimate Machine/Purchase/Store entries remain
untouched. `node --check` on the touched file.

---

## 15. Process Execution kept showing "BOM Not Locked" / "Raise R&D Request" After R&D Had Already Approved It

**Reported 2026-09-24 (found during Phase 2 Machine-order testing, unrelated to that work —
a pre-existing gap, next link in Bug #11's own chain).** After R&D approved a Machine order's
Initial BOM request (Bug #11's manual-override path), `/production/orders` correctly showed
`BOM ✓ / Design ✓`, but the SAME order's own Process Execution page still showed `✗ BOM Not
Locked` and still offered "Raise R&D Request" — as if nothing had happened.

**Root cause — two pages reading two different sources of truth.** `OrderManagement.jsx`
(the orders list) reads the STORED `order.bomVerified`/`designVerified` flags directly —
exactly what R&D's manual approval sets (Bug #11), correctly true. `ProcessExecution.jsx`'s
own "BOM & Design" panel, for a Machine order, only ever branches on `bomDesign.autoVerified`
— a value `getBomDesignStatus` computes LIVE, every call, straight off `MachineBOM.isLocked
&& designApproved`, with no awareness of the stored flags at all. R&D's manual approval
(Bug #11, deliberately) never locks the underlying `MachineBOM` — it's an explicit judgment-
call override for exactly the case where the real BOM isn't locked yet — so `bomLocked` stays
genuinely `false` forever on this path, and Process Execution's own panel had no way to ever
learn the override happened.

**The fix (frontend-only, `ProcessExecution.jsx`):** the panel's branch condition changed
from `bomDesign?.autoVerified` to `bomDesign?.autoVerified || (selectedOrder.bomVerified &&
selectedOrder.designVerified)` — either the live auto-verify check OR the stored
override flags (already present on `selectedOrder`, unused by this panel until now) now
shows the verified view. No backend change needed — `getBomDesignStatus` already returns
`order.bomVerified`/`designVerified` in its response; the frontend just wasn't reading them
for this decision.

**Verified:** `npx esbuild` bundle-check on the touched file. Not yet re-tested live in the
browser.

## 16. Product Master pre-selected "Purchasable (Vendor)" — an In-House machine silently created as purchased

**Found live (2026-09-24):** IP612 (impact pulverizer) had a full Machine BOM, but editing its BOM
cost never changed the machine's own price (BP816's did). IP612's Item had `productSourceType:
'In House Manufacturing'` but `purchase: true, internalManufacturing: false`.

**Root cause — two separate "how is this made" inputs on the Product Master form, never kept in
sync, one of them pre-filled.** The Product Source Type dropdown (`productSourceType`) is what BOM
Management and `createMachineBOM` check, so IP612 got a BOM. The Purchasable / Internal
Manufacturing radio (`purchase`/`internalManufacturing`) is what everything else checks, and
the create form pre-selected **Purchasable** (`emptyForm.purchase: true`), so it was easy to
create a machine without ever touching it. Everything gated on `internalManufacturing` then
silently treated IP612 as a bought-in product:
- `syncMachineBOMPricing` (`machineBOMController.js`) skips the price update, so BOM cost never
  reaches `stdCost`/`mrp`/`salePrice`.
- `productTypeForItem` (`storeFlowService.js`) classifies a Sale line as "Purchased (Trading
  Product)", so Store routes it to **Purchase**, not Production.
- `applyManufacturedFinalCost` (`productionMfgController.js`) never writes the real build cost back.

**The fix:**
- `ProductMaster.jsx`: neither option is pre-selected on create (`purchase: false,
  internalManufacturing: false`). The radio now reads **Sourcing \*** (required), and **Create
  Machine** / **Save Changes** stay disabled until one is chosen. The Product Weight block (for
  purchased machines) only shows once Purchasable is actually picked, not while nothing is chosen.
- `rdController.js`: `createMachine` refuses anything but exactly one of the two, and
  `updateMachine` does the same whenever an edit carries both fields. So the rule holds even
  without the form.

**Existing data:** not migrated. IP612 needs its radio switched to Internal Manufacturing by
hand (then re-save its BOM production cost so the price syncs). Other machines may have the same
mismatch; a one-off check (`productSourceType` in-house/out-source but `internalManufacturing:
false`) can list them if wanted.

**Verified:** `node --check` + import check on `rdController.js`, `esbuild` on `ProductMaster.jsx`.
Not yet re-tested live.

## 17. Unreleased machines showed up in Sales' product pickers

**Found live (2026-09-25):** M-311 (home cleaning machine), newly created in Product Master
with Forward to Design & Prototype ticked (so Draft / Not Released), was immediately
selectable in Sales → Leads → Add A New Leads' machine picker. The intended rule: a machine
going through Design Approval → Prototype only becomes sellable once Prototype releases it for
production.

**Root cause:** no release check existed anywhere on the Sales side. Every Sales-facing
product picker (Leads, Quotation, Order form, `ProductSelector.jsx`) reads one list,
`getSellableItems` (`services/sellableItemsService.js`), and it returned every `type:'Product'`
Item for the company. Since Product Master machines became Items themselves (no separate record
created later), a machine is an Item, and so sellable, from the moment it's created. The
Leads picker's Category/Sub Category rework only filters that list client-side and never had
a release check either.

**The fix (backend only):** `getSellableItems` now excludes a Machine that was forwarded to
Design & Prototype (`machineDetails.forwardToNextPhase`) but isn't `releaseStatus: 'Released'`
yet (shared `NOT_RELEASED_FOR_SALE` condition). The Super Admin branch of
`getSalespersonItems` (`salesController.js`), which builds its own query, uses the same
condition. **Not affected:**
- machines never forwarded (e.g. bought-in Purchase Machines), since they never go through
  that pipeline;
- motors;
- existing orders, since this only changes what can be newly picked.

**Rule confirmed with the user:** Forward to Design & Prototype left unticked at creation
means the machine is for direct sale, with no design/prototype release needed.

**Also (same day, confirmed with the user):** discontinued products (`isDiscontinued`) are
excluded from the same list. Discontinue means "not producing/selling this for now, until
it's continued again". This applies to machines and motors alike, in both queries above.
Pricing Value's own item list is a separate query and is unaffected.

**Plants (same day, confirmed with the user):** a discontinued plant was already hidden from
Sales (Leads and Quotation both call `/sales/plants?discontinued=false`). New: an **active**
plant with a discontinued or not-yet-released machine/motor inside still lists, but can't be
chosen. `getSalesPlants` (`salesController.js`) returns `unavailableItems: [{ code, name,
reason }]` per plant, using a new shared in-memory check, `unavailableForSaleReason`
(`sellableItemsService.js`), the twin of the query rules above.
- **Leads picker:** the plant row is greyed out, can't be clicked, and shows "Not available —
  X (code) is discontinued / not released".
- **Quotation's Plant dropdown:** the plant is a disabled option with the same note.
- **Quotation auto-fill from a lead** that picked such a plant earlier: its items are not
  auto-added, and a toast says why.

**Verified:** `node --check` on both files, plus a read-only run of the real
`getSellableItems` on company `6a2111880239bcb8cfedf6a7`, and on `6a688f21e2db8456aebf69c7`
(its 5 discontinued machines and its forwarded-but-unreleased 3I1CM46 are now excluded). M-311 and IP612 (Approved, Not
Released) are now excluded, with and without a search term. Released machines, the
never-forwarded PRo-009, and both motors still list. Not yet re-tested in the browser.
