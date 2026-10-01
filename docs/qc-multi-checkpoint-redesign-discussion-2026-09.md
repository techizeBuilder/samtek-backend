# QC Multi-Checkpoint Redesign — Discussion Notes

Date: 2026-09-25 (client change request, design discussed and agreed)

**Status (2026-09-28): REDESIGN COMPLETE.** All 4 slices BUILT — slice 1 (R&D setup), slice 2
(in-house QC, all three levels: Sub Child Part/Child Part/Machine), slice 3 (outsourced QC, all
three levels), and slice 4 (cleanup — the old single-checkpoint machinery removed). Every runtime
piece is CONFIRMED LIVE CLEAN, end to end, on real orders (`ORD-2026-078`/SCP-003,
`ORD-2026-079`/Fan CP-001, `ORD-2026-081`/Blower Pulverizer BP816). Several real bugs found and
fixed along the way — see each dated section below. Also built: a QC job history view (every past
attempt's checklist + decision, previously invisible once decided). Stage C's own design initially
got Final QC's placement wrong (assumed it had to be the true last step) and was corrected by the
user with a real-world example (test before you paint, so rework doesn't damage finish work)
before any code was written — see "Stage C (Machine) — built" below. Slice 4's cleanup removed
`qcCheckpointIndex`, `QcCheckpointPanel`, `FinalChecklistPanel`, `getQcCheckpoint`/
`submitQcCheckpoint`, `getFinalChecklist`/`saveFinalChecklist`, and `decideChildPartUnitLegacy` —
see "Slice 4 — cleanup — built" below for the full list, what was deliberately kept (`partChecks`,
a separate frozen RDBOM-tied system), and a real consequence worth knowing: an order for an item
whose BOM still has zero QC flags (M-311, SCP-004/005/006, until R&D configures them) now falls
through to the generic self-certify path everywhere — including a literal "Final Testing" step,
which used to be specially blocked but no longer is, since the mechanism it used to defer to is
gone. See "Slice 1 — built", "Slice 2 — Stage A (Sub Child Part) — built", "Slice 3 — Sub Child
Part outsourced QC steps — built", "Slice 2 — Stage B (Child Part) — built", "Child Part
outsourced QC steps — built", "QC job history view — built", "Stage C (Machine) — built", and
"Slice 4 — cleanup — built" below.
This supersedes the "exactly one QC checkpoint per order"
rule and Production's self-check layer. Both were designed and built in
`process-inhouse-outsource-redesign-discussion-2026-09.md`: its "QC placement under dynamic
process steps", "Stage 3b", "Out Source checkpoint self-check — design reversed" and "Machine QC
checkpoint — per-unit redesign" sections. Those sections describe what is in the code today; this
doc describes what replaces it.

## Background

The client wants two changes to how QC works in Production:

1. **Production does no QC.** Production only submits a step; the QC department fills in the
   checklist and decides. Today Production self-checks first (fills Pass/Fail + actual values),
   and QC reviews that.
2. **Several QC steps per BOM, at every level, including Sub Child Part.** Today there is
   exactly one checkpoint per order: R&D flags one step for Child Part / Machine, and Sub Child
   Part is fixed on its last step.

## What exists today (for reference while building)

**BOM (Process Definition):**
- `InternalProcessSchema.qcRequired` (`models/ProcessDefinitionSchema.js`).
- Exactly-one validation for Child Part / Machine only (`processDefinitionValidation.js`
  `requireExactlyOneQcStep`).
- Sub Child Part has no checkbox (`ProcessDefinitionEditor.jsx` hides it).

**Where the checkpoint sits:** `qcCheckpointIndex(order, procs)` in `productionMfgController.js`
(Sub Child Part → last step; otherwise the flagged step).

**QC Parameters** (`models/QCMasterChecklist.js`, `models/QCItemChecklist.js`,
`controllers/qcChecklistController.js`):
- Master catalog: one per {module, stage}. Per-item selection: one per {module, stage, item,
  childPartId, subChildPartId}.
- Stages today:
  - `subChildPart: ['default']`
  - `childPart: ['initial','process']`
  - `productMaster: ['initial','process','final']` (initial/process are per legacy RDBOM part;
    new MachineBOM machines only use `final`)
- Pages: `SubChildPartInventoryQC.jsx`, `ChildPartInventoryQC.jsx`, `ProductMasterQC.jsx`.
- Current data is development data only:
  - `childPart` initial master: material, qty; `childPart` process master: drilling, bending
  - `productMaster` process master: Measurement, Cutting/Laser Cutting, Welding,
    Grinding/Buffing, Drilling, Rolling, Bending
  - `productMaster` final master: Vibration, Leaking, Electric Load, …

**Production side:**
- `getQcCheckpoint` / `submitQcCheckpoint` + `QcCheckpointPanel.jsx` (self-check + submit).
- `completeFinalProcessStep` (cost at the true last step).

**QC side:**
- `QCJob` (one per order). Child Part and per-unit Machine use `unitChecks[]`, one entry per
  unit. Sub Child Part uses the flat `checklist[]`.
- `decideChildPartUnit` (per unit), `submitDecision` (flat), `completeMachineUnit` (unit done →
  Sale / stock).

## Agreed design (2026-09-25)

### 1. Production submits, QC checks
- Production's QC panel becomes a **Submit to QC** action, with no checklist to fill. Cost /
  expense is still entered when submitting the **true last step** (unchanged rule).
- The QC department fills the checklist (actual values, Pass/Fail) and decides. This is the same
  "QC fills the rows" shape already used for Purchase / Store QC jobs.

### 2. QC steps in the BOM
- **All three levels** get a multi-select **QC** checkbox per step. Sub Child Part gets it for
  the first time.
- **At least one QC step per BOM**, validated on save, all levels.
- **Machine** gets a second flag, **Final QC**: exactly one step, and **mandatory**. The Final
  step is usually after assembly and testing, but steps may follow it. One step may carry
  **both** a normal QC flag and the Final flag. QC then sees one review with two sections
  (Process checks + Final checks) and makes one decision.
- A step is identified by **category + step name**. The same step name can appear in two
  categories.

### 3. QC Parameters (R&D)

| Level | Master list | Per-item checklists |
|---|---|---|
| Sub Child Part | Unchanged (flat) | One checklist per QC step, rows picked from the flat master |
| Child Part | **Initial removed**; Process kept | One checklist per QC step, rows picked from the Process master (replaces the Initial + Process cards) |
| Machine | **Initial removed**; Process + Final kept | The Final checklist, plus one checklist per QC step picked from the Process master |

- Per-step checklists are keyed by **category + step name** from that item's BOM. This needs a
  new step dimension on `QCItemChecklist`.
- QC Parameters **flags mismatches**: a QC step with no checklist yet, and a saved checklist
  whose category + step no longer exists in the BOM (after a rename or removal), so R&D can
  re-pick. Renames are not auto-carried.
- Old Initial data, the legacy Product Master per-part Initial/Process, and the Child Part
  Initial selections are **dropped**. It's development data.

### 4. The QC job and the QC queue
- **One QC job per order, as today.**
  - Child Part / Machine: each unit expands into its QC steps.
  - Sub Child Part: one whole-quantity batch, so its QC steps are listed directly.
- A step appears in the QC job **only when it is submitted** by Production, or received back from
  outsourcing. Nothing is pre-listed.
- The job's status is **recalculated on every submit and decision**:
  - **Waiting:** something is submitted and undecided.
  - **In Progress:** nothing is waiting, but the order isn't finished.
  - **Approved:** only when the whole order's QC is complete.

  The Packaging Queue reads Approved, so a Machine job must never show Approved while units are
  unfinished. Today Child Part jobs never recalculate and sit at Pending forever; this fixes that.

### 5. Hard gate
- Production **cannot start the next step** until QC has passed the current QC step. That covers
  all of the step's pieces, or for a unit, that unit.
- By the same rule, Purchase can't send the next outsource round until QC has passed the QC steps
  of the previous round.

### 6. Empty checklist
- If R&D hasn't configured a checklist for a flagged step, QC still gets the step, clearly marked
  **"no QC parameters set by R&D"**, and can add rows.
- Rows QC adds are **saved on that job only**, never back to R&D's checklists.

### 7. QC decisions
**Child Part / Machine:** per unit per step, **Pass** or **Reject** (with a reason).

**Sub Child Part:** QC splits the submitted quantity into **Passed / Rework / Scrap**, which must
add up to the submitted quantity. A reason is required for Rework and Scrap.
- **Rework:** can be fixed. In-house goes back to Production; outsourced goes to Purchase.
- **Scrap:** written off, and the batch shrinks. The regular stock check reorders the shortfall.
- **Mid step:** if any quantity is **Rework**, the batch **waits** (user's decision). The next
  step unlocks only once every reworked piece has passed or been scrapped. If QC only scraps (no
  Rework), the passed pieces continue straight away.
- **Last step:** passed pieces go to stock **immediately**. Reworked pieces follow when they
  pass.

**Where a reject goes:** in-house → back to Production to redo; outsourced → Purchase, shown as
**QC Rejected** on Outsource Work.
- That state exists today only on pure out-source Sub Child Part job-work orders. It must be
  added to the hand-off model too (`ProductionOrder.outsourceHandoffs`).
- **What Purchase then does with an outsourced reject** (return to vendor, vendor redo, credit)
  is **not decided**; it's pending the client. Until then, that step waits on Purchase.

### 8. Resubmission
- Only the **rework quantity** is resubmitted (Sub Child Part). For a unit, the same unit's step
  comes back.
- **Every attempt is kept as history** in the QC job, e.g. "painting · attempt 1: 7 passed, 3
  rework (thickness) · attempt 2: 3 passed". Today a resubmission overwrites the previous
  checklist, and only the reject reason survives.
- QC re-checks the **full checklist** on each attempt, with the previous attempt's results shown
  alongside.
- A Sub Child Part step completes once **passed + scrapped = the original quantity**.

### 9. Outsourced steps
- When Purchase receives a round back, it goes **to QC first** if any step in it is QC-flagged.
  QC checks **each** flagged step's checklist; unflagged steps in the same round aren't checked.
- **QC decides per step within the round.** It can send one step, or both, for rework.
- A received round with **no** QC-flagged step goes to Production if steps remain.
- If nothing follows the received step:
  - **Hybrid order:** receiving runs the finishing logic automatically (built 2026-09-24,
    `receiveOutsourceHandoffRound` → `completeMachineUnit` / Child Part stock credit).
  - **Fully outsourced order:** there is no Production step to do the finishing work, so the
    final receive **always** goes to QC, with an empty checklist if the step isn't flagged.
    QC's pass does the finishing (stock credit). This matches today's pure out-source Sub Child
    Part flow.

### 10. When a unit / order is done
- **A unit is done** when all its QC steps are passed **and** its true last step is finished.
  This generalises `completeMachineUnit`'s current rule. After that, Sale +1 'Approved from QC'
  or stock +1, as built.
- **A Sub Child Part order** credits stock as pieces pass the last step.
- **The order is Completed** when every unit (or the whole batch) is done.
- If the last step has **no** QC flag, whoever finishes it runs the finishing logic, as today.

### 11. Not affected
- QC for purchased materials and Store-sourced items. Those don't use BOM steps.

## Pending the client
- What happens after an outsourced step is QC-rejected and handed to Purchase.
- The vendor's own cost for outsourced work. Deferred to the Purchase rebuild; see
  `procurement-redesign-discussion-2026-09.md`.

## Build plan (proposed, to be planned in detail)

The pieces depend on each other (BOM flag → QC Parameters → QC job → Production submit → QC
decision). The design is settled all at once, and it gets built in slices that each end in
something testable:

1. **Setup (R&D side):**
   - Multi-QC flags on all three levels, the Machine Final flag, and at-least-one / exactly-one-
     Final validation.
   - Per-step checklists in QC Parameters (the new step dimension on `QCItemChecklist`), the
     Initial stage removed, and the mismatch flags.
   - Production untouched.
2. **In-house QC steps:**
   - Production Submit-only; QC fills and decides.
   - The job's recalculated status; attempts history.
   - Pass/Reject per unit; Passed/Rework/Scrap for Sub Child Part, with wait-on-rework.
   - The hard gate, unit/order done, stock / dispatch.
   - One level at a time: Sub Child Part → Child Part → Machine.
3. **Outsourced QC steps:**
   - Received round → per-step QC; the next-round gate.
   - QC Rejected on hand-offs; the fully-outsourced empty-checklist rule.
   - Both hand-off models (`SubChildPartJobWorkOrder` rounds and `ProductionOrder.
     outsourceHandoffs`).
4. **Cleanup:**
   - Remove the self-check UI (`QcCheckpointPanel` checklist mode, `FinalChecklistPanel`).
   - Remove the single-checkpoint code (`qcCheckpointIndex`'s single-flag / fixed-last rules,
     `requireExactlyOneQcStep`), the Initial stage, and the legacy per-part `partChecks` QC.

## Slice 1 — built (2026-09-25, not yet live-tested)

The R&D configuration side only. **Production and the QC department are unchanged until
slice 2.** They keep the old single-checkpoint behaviour: `qcCheckpointIndex` uses the **first**
QC-flagged step for Child Part / Machine and the last step for Sub Child Part. They also keep
reading the old item-level checklists, which is why that data is kept until slice 4.

**BOM side:**
- `InternalProcessSchema.finalQc` (Machine only).
- `processDefinitionValidation.js`: `requireExactlyOneQcStep` is replaced by
  `requireAtLeastOneQcStep` (all three levels) and `requireExactlyOneFinalQc` (Machine). Both
  are skipped for an empty definition, as before.
- Wired into `subChildPartMasterController.js` (create + update), `childPartBOMController.js` and
  `machineBOMController.js`.
- `ProcessDefinitionEditor.jsx`: a multi-select **QC** checkbox at every level, plus a
  **Final QC** checkbox (exactly one) for Machine. The warning line spells out what's missing.
- `finalQc` is carried onto new production orders (`ProductionOrder` step schema,
  `processStepBuilderService.js`). Nothing reads it yet.
- **Existing BOMs:** the 6 Sub Child Parts and 4 Machine BOMs with steps must get a QC flag (and
  the Machines a Final step) on their next save. The 3 Child Part BOMs were already valid.

**Checklist storage:**
- `QCItemChecklist` gains `stepCategory` / `stepName`, and the unique index now includes both.
- The old unique index was dropped with a one-off script; all 31 checklist documents are
  untouched.
- Every legacy reader resolves with the step keys pinned to null: `resolveSelectedChecklist`
  defaults them, and `resolveTarget` sets them. So item-level and old part-level checklists read
  exactly as before. Verified: Child Part CP-001's item-level Process checklist still returns its
  own two rows while a step checklist exists alongside it.

**New endpoints** (`qcChecklistController.js`, routes in `rdRoutes.js`):
- `GET /api/rd/qc-checklist/:module/qc-steps/:itemId` returns the QC steps with their selected
  rows, the Machine's Final step, and orphaned step checklists.
- `GET / POST / DELETE /api/rd/qc-checklist/:module/:stage/item/:itemId/step?category=&step=`.
  The stage per level is Sub Child Part `default`, Child Part `process`, Machine `process`.
  POST only accepts a step that is QC-flagged on the BOM right now.

**QC Parameters pages:**
- New shared `components/qc/StepChecklistCards.jsx` shows one card per QC step, with an
  In-House / Out Source badge and a Final badge where relevant. An empty checklist notes that QC
  will get an empty list, and a "no longer matching a BOM step" section offers Remove.
- `SubChildPartInventoryQC.jsx`: the step cards replace the single Assigned Checklist.
- `ChildPartInventoryQC.jsx`: the step cards replace the Initial + Process cards, and the master
  list is Process only.
- `ProductMasterQC.jsx`: the master lists are Process + Final. The Final card shows which BOM
  step is the Final step, or warns that none is picked. Machine-BOM machines get the step
  cards. The legacy RDBOM per-part Initial/Process accordion is removed and replaced by a note.

**Verified:**
- `node --check` plus runtime imports on every backend file, and `esbuild` on every frontend
  file.
- 7 validation cases, all as intended.
- The index swap, with the document count unchanged.
- The step endpoints against real items (SCP-002, CP-001, BP816):
  - a save → read → delete round trip on CP-001's flagged step, cleaned up
  - saving on a non-QC step is refused
  - the wrong stage is refused

## Slice 2 — Stage A (Sub Child Part) — built (2026-09-26, backend verified, not yet live-tested)

Production/QC runtime for Sub Child Part orders only. Child Part and Machine orders are
untouched — they still run the OLD single-checkpoint code (Production self-checks, one fixed
checkpoint) exactly as before, until Stage B / Stage C. **Outsourcing is frozen this slice**, per
an explicit choice over a "minimal bridge" alternative: `receiveOutsourceHandoffRound` is not
touched, and a step that is both `type:'Outsourcing'` and QC-flagged is untested/out of scope
until slice 3.

**Shared foundation (used by every later stage too):**
- `models/QCJob.js`: new `QCFilledRowSchema` (one-layer fill — QC sets `status`/`actualValue`/
  `remarks` directly, no more separate Production-fill layer), `StepAttemptSchema` /
  `StepEntrySchema` (unit-based, for Child Part/Machine, not wired to any endpoint yet),
  `BatchStepAttemptSchema` / `BatchStepEntrySchema` (whole-batch, Sub Child Part), new top-level
  `batchSteps: []`. `UnitQCEntrySchema` gained an empty `steps: []` alongside its OLD flat fields
  (`initial`/`process`/`status`/`producedBy`/`qcBy`/…), which Child Part/Machine's existing code
  still reads/writes directly — kept side by side on purpose so Stage A cannot regress them.
  `checklist`/`partChecks`/top-level `status` untouched.
- New `services/qcStepService.js`: `getQcStepIndices` (every `qcRequired||finalQc` index, replaces
  the old single `qcCheckpointIndex`), `needsUnitSteps`/`needsBatchSteps`, `findOrCreateStepEntry`,
  `resolveStepProcessRows` (thin wrapper over slice 1's `resolveSelectedChecklist`),
  `markJobStarted`/`markJobApproved`.
- `ensureQCJobForOrder` (`productionMfgController.js`): seeds `job.batchSteps = []` for a Sub Child
  Part order with any QC-flagged step (`ensureBatchStepsStructure`), alongside the existing
  `ensureUnitChecksStructure`.
- `markProcessComplete`'s generic dynamic-order branch now checks `getQcStepIndices(...).includes
  (idx)` instead of a single `qcCheckpointIndex` — this is a real bugfix beyond Stage A: a
  *second* QC-flagged step (possible since slice 1) could previously bypass QC through this
  endpoint.

**New, Sub Child Part specific:**
- `PUT /api/production-mfg/orders/:id/processes/:stepIndex/batch-qc-step/submit` — Production's
  submit-only action (`submitBatchQcStep`). Refuses off a non-QC step or a step not `In Progress`;
  requires cost/expense on the true last step's first submission; quantity is never typed by
  Production — it is always exactly the step's outstanding amount (the previous QC step's
  `passedQty`, or the full order quantity for the first QC step; exactly `reworkPendingQty` on a
  resubmission).
- `PUT /api/qc/jobs/:id/batch-steps/decision` — QC's decision (`submitBatchQcDecision`). Validates
  the Passed/Rework/Scrap split sums to what was submitted, a reason is given whenever
  rework/scrap is non-zero, and every checklist row is Pass/Fail. `passedQty`/`scrapQty`
  accumulate; `reworkPendingQty` is replaced (not added) by this decision. The true last step
  credits stock (or the linked Sale) with `passedQty` immediately, per decision — not waiting for
  the whole step to resolve. A step resolves (`proc.status='Completed'`, unlocking the next step)
  once `reworkPendingQty===0` — scrap alone never blocks. `submitDecision` (the old flat endpoint)
  now refuses a `batchSteps` job, pointing at this endpoint instead.
- `completeFinalProcessStep` gained a Sub Child Part branch (previously unreachable for this order
  kind, since its one checkpoint was always the last step by definition — now reachable whenever a
  QC step sits before the true last, non-QC step): credits `Item.qty` with the last resolved
  batch step's `passedQty` and completes the order.

**Frontend:**
- `pages/production/ProcessExecution.jsx`: Sub Child Part's `checkpointIdx` is always `-1` now
  (the OLD single-checkpoint UI never mounts for this order kind); a QC-flagged step shows a
  **Submit to QC** button (cost/expense dialog first, on the true last step only) instead of the
  old self-check panel; a non-QC true last step still uses the existing `Complete {step}` flow,
  unchanged.
- New `components/qc/SubChildPartBatchQCReview.jsx`: one row per batch step
  (Entering/Passed/Scrap/Rework-pending counts, a Resolved badge, or a Review button for a
  pending attempt); its dialog fills the step's checklist directly and takes the Passed/Rework/
  Scrap split + reason.
- `pages/quality-control/QCInspection.jsx`: mounts the new review component and hides the old flat
  Checklist card and Decision panel for a `batchSteps` job (`isBatchJob`), mirroring how
  `isPerUnitJob` already hides them for a per-unit job.

**Verified:**
- `node --check` plus runtime imports on every backend file; `esbuild` on every frontend file.
- End-to-end scratch-script simulation against disposable `TEST-` prefixed data (deleted after):
  a 3-step order (2 QC-flagged, 1 plain true-last) — submit → partial reject (7 pass/3 rework) →
  step stays open, only the 3 reworked units are resubmittable → full pass → step resolves →
  next step unlocks only now → that step's scrap-only decision (8 pass/2 scrap) resolves
  immediately without waiting → true last step completes the order and credits stock with the
  survived quantity. 24/24 checks passed.
- Validation-only scratch script: non-QC-step / not-in-progress submit refused; wrong-sum and
  missing-reason decisions refused; a `batchSteps` job refuses the old flat decision endpoint.
  7/7 checks passed.
- **Live-tested clean (2026-09-26)**, against SCP-003/ORD-2026-078 (real Sub Child Part order,
  ≥2 QC-flagged steps) — one real gap found along the way: the Inspector picker never showed for
  this job type since `markJobStarted` auto-advances past `'Pending'` before QC ever opens the
  job (the old panel was gated on `status==='Pending'`); fixed to gate on `!job.inspector`
  instead, plus the client's separate ask to make Inspector a department-user dropdown instead of
  free text. No other bugs found in the in-house flow itself.

Next: Stage B (Child Part) — the user explicitly chose to build slice 3 (Sub Child Part
outsourced steps, now also live-tested clean) ahead of Stage B/C first; Stage B is next in the
normal build order now that both Sub Child Part pieces are confirmed.

## Slice 3 — Sub Child Part outsourced QC steps — built (2026-09-26, backend verified, not yet live-tested)

Built ahead of the normal order (Stage B/Stage C haven't started) at the user's explicit request,
after being told Stage A hadn't been live-tested yet. Scoped to **Sub Child Part only**, same
reason Stage A was scoped that way: it's the only order kind with the new `batchSteps` runtime.
Child Part and Machine's outsourced steps are completely untouched — still driven by the old
`qcCheckpointIndex`/self-check model, unchanged, until their own stage.

Two outsourcing models exist; only one needed work:
- **`SubChildPartJobWorkOrder`** (pure Out-Source, no BOM `processes[]` at all) already matched
  the target design as-is — the finished quantity always goes to QC first, stock only credits on
  approval. Nothing built here.
- **`ProductionOrder.outsourceHandoffs`** (the hybrid model, mixing in-house and outsourced BOM
  steps) — this is what got rewired.

**Design decision, confirmed with the user:** a hand-off created to resend a rework quantity
carries that quantity (a new field), computed automatically server-side — never typed by Purchase
or Production, matching how the in-house side already works. No new frontend input was needed on
either side for this (confirmed by reading both UIs before building).

**What "rework goes to Purchase" means for Sub Child Part:** no new "QC Rejected" status. QC's
Rework decision resets the step's `outsourceStatus` back to `NotStarted`, which is exactly what
lets Production request a brand-new hand-off for it — the existing hand-off-request flow *is*
"goes to Purchase". The doc's earlier "pending the client" note (what Purchase does with a
rejected outsourced piece) is about Child Part/Machine's Pass/Reject model, not this.

**Backend:**
- `models/ProductionOrder.js`: `OutsourceHandoffSchema` gained `subChildPartQty` (null = whole
  order, the default/unchanged case; a number only on a rework resend, snapshotted once at
  request time).
- `services/qcStepService.js`: the "submit a batch step to QC" mechanic (find/create the entry,
  fix `qtyEnteringStep` once, compute the outstanding quantity, push an attempt, flip
  `proc.status`) was factored out of `submitBatchQcStep` into a new shared
  `submitBatchStepForQC(qcJob, order, procs, idx, submittedBy, { qtyOverride })` — used by both
  Production's own submit endpoint (unchanged behavior, same code just moved) and the new
  outsourced-receive trigger below.
- `controllers/productionMfgController.js`: `qcJobSourceForOrder` exported (was file-private) so
  `outsourceWorkController.js` can look up an order's QCJob the same way `completeFinalProcessStep`
  does.
- `controllers/outsourceWorkController.js`:
  - `requestOutsourceHandoff`: for a Sub Child Part order whose requested run includes a
    QC-flagged step, looks up that step's `batchSteps` entry — no entry yet (or no attempts) means
    a first-ever send (`subChildPartQty` stays null); an entry with attempts means a rework resend
    (`subChildPartQty` = that entry's exact `reworkPendingQty`). No "nothing outstanding" guard
    needed: the existing `validateContiguousOutSourceRun` check already refuses re-requesting a
    step whose `outsourceStatus` isn't `NotStarted`, and it only becomes `NotStarted` again via a
    real Rework decision, which by construction always leaves `reworkPendingQty>0`.
  - `receiveOutsourceHandoffRound`: gained a Sub Child Part branch, parallel to (not replacing) the
    Child Part/Machine logic, which is untouched — confirmed byte-for-byte identical, just moved
    into the `else`. For Sub Child Part (`unitIndices` always `[0]`), a QC-flagged received step
    submits straight to `batchSteps` via `submitBatchStepForQC` — receiving the round back *is* the
    submission, no self-check phase, no separate click. A non-QC step still completes straight
    through as before; if it's also the true last step with no QC flag anywhere in the pipeline
    (design's rare case), it credits stock and completes the order, mirroring
    `completeFinalProcessStep`'s own Sub Child Part branch exactly.
  - `normalizeHandoffRow` (Purchase's Outsource Work list): a Sub Child Part row's Qty column now
    shows `subChildPartQty` when set, so a rework-resend hand-off displays the actual rework
    quantity instead of the whole order's.
- `controllers/qcController.js`: `submitBatchQcDecision`'s unresolved-step branch now checks the
  step's `type` — an outsourced step resets `outsourceStatus` to `NotStarted` (and `proc.status` to
  `Pending`) instead of `In Progress`, since its resubmission goes through Purchase's hand-off flow,
  not Production's submit button.

**Frontend: no changes needed**, confirmed by reading both surfaces before building anything:
- `ProcessExecution.jsx`'s `proc.type === 'Outsourcing'` rendering is a fully separate branch from
  the in-house QC-submit UI, and already renders `'QC Pending'` as "Received — awaiting QC" and
  `outsourceStatus === 'NotStarted'` as a "Send for Outsourcing" button — exactly the states this
  slice's backend now produces.
- Purchase's Outsource Work page already sends/receives rounds with no quantity input; a rework
  resend just appears as a normal new row (with the Qty-column fix above).

**Known, accepted limitation:** if the very first BOM step is both the order's first step and
QC-flagged, a rework resend on it would re-show the (already non-authoritative, dummy-only)
first-step material suggestion UI sized for the whole order rather than the rework quantity. Not
solved this slice — narrow edge case, doesn't touch real stock either way.

**Verified:**
- `node --check` plus runtime imports on every touched file, including the full route files.
- Two scratch-script simulations against disposable `TEST-` data, deleted after:
  - QC step mid-pipeline (Welding → Painting): first send (whole order, 10) → partial Rework (7
    pass / 3 rework) → step correctly NOT credited yet (Painting is the true last step) →
    resetting to `NotStarted` confirmed → new hand-off snapshots exactly 3 → re-requesting before
    that resolves is refused by the existing hand-off-overlap check → send/receive → full Pass →
    step resolves, order still open → completing Painting (in-house, no QC) credits the full
    survived 10 and completes the order. 32/32 passed.
  - QC step IS the true last step (Cutting → Plating): partial Pass (6/4) credits Item.qty=6
    **immediately**, order stays open; rework resend snapshots exactly 4; final Pass credits the
    remaining 4 (Item.qty=10) and completes the order. 16/16 passed.
- Confirmed the Child Part/Machine branch of `receiveOutsourceHandoffRound` is untouched — same
  `qcCheckpointIndex` path, moved but not edited.

**Bug found live, fixed same day (2026-09-26)**: testing against a real order (SCP-003/ORD-2026-078,
`welding` → `grinding`, both QC-flagged and consecutive, received together after the multi-step
bundle picker fix above) — receiving threw `"Nothing outstanding to submit for this step."` on the
second step. Root cause: `submitBatchStepForQC`'s `qtyEnteringStep` chaining read the *previous*
QC step's `passedQty` unconditionally — correct once that step has an actual decision, but when two
QC steps are bundled into the same hand-off and submitted together, the first one hasn't been
decided yet at the moment the second is processed, so its `passedQty` was still 0 (nothing sorted
yet, not that nothing survived). Fixed: if the previous step's latest attempt is undecided, chain off
its own `qtyEnteringStep` instead — the same quantity that entered it is exactly what's entering
this one too, since nothing's been rejected/scrapped between them. Verified via a scratch script
(9/9 passed) reproducing the exact bundled-and-undecided scenario; the order's stuck round was
confirmed to have made no partial write (round still `'Sent'`, safe to retry) before the fix, so no
manual data repair was needed beyond retrying Receive.

**Live-tested clean (2026-09-26)**: against a real hybrid Sub Child Part order
(SCP-003/ORD-2026-078) — out source first, then in-house, then two bundled consecutive out
source steps, covering the multi-step bundle picker and the round-splitting logic too. No
further bugs found after the qtyEnteringStep fix above.

## Slice 2 — Stage B (Child Part) — built (2026-09-26), LIVE-TESTED CLEAN (2026-09-28)

Same runtime as Stage A (Production submits only, QC fills the checklist and decides), now for
**Child Part** orders. **In-house only this stage** — Child Part's outsourced steps stay on the
old `qcCheckpointIndex`/self-check path (`receiveOutsourceHandoffRound`'s untouched `else`
branch) until a dedicated future pass, same reasoning Sub Child Part's outsourcing got its own
slice 3. Only engages for a dynamic Child Part order (a real Process Definition, which since
slice 1 always has ≥1 `qcRequired` step) — a legacy Child Part order with no Process Definition
at all keeps running the exact old flat-field code, untouched.

Most of the schema/shared-helper work was already done as part of Stage A's own "shared
foundation" (`StepEntrySchema`/`steps[]` already existed on `UnitQCEntrySchema`,
`ensureUnitChecksStructure` already seeded it for Child Part, `getQcStepIndices` was already
order-kind-agnostic) — Stage B mainly wired Child Part's own runtime onto it.

**The one real risk this stage**: `decideChildPartUnit` and `ChildPartUnitQCReview.jsx` are
*shared* with Machine's own per-unit QC (built 2026-09-24) — same endpoint, same component, same
`unitChecks[]` shape. Every change here had to leave Machine byte-for-byte unchanged until
Stage C.

**Built:**
- `services/qcStepService.js`: new `submitUnitStepForQC` — the per-unit sibling of
  `submitBatchStepForQC`. No quantity concept (unlike Sub Child Part's batch split) — a unit's
  own step is Pass/Reject, one unit at a time, fully independent of its siblings.
- `productionMfgController.js`: new `submitUnitQcStep` (`PUT /orders/:id/processes/:stepIndex/
  unit-qc-step/submit?unit=N`) — Production's submit-only action per unit, mirrors
  `submitBatchQcStep`. `markProcessComplete`'s Child Part branch re-pointed from
  `qcCheckpointIndex` to `getQcStepIndices` (same fix Stage A already applied to the generic
  branch). `approveQC`/`rejectQC` (shared by every order kind) also re-pointed the same way — a
  real latent-gap fix (a second QC-flagged step could otherwise self-certify past QC through
  these), zero behavior change for Machine's actual flow since it only ever reaches its one real
  flagged step today.
- `qcController.js`: `decideChildPartUnit` became a thin dispatcher — the **entire original
  function body was renamed to `decideChildPartUnitLegacy`, not edited at all**, and only
  reached when the order is Machine or a legacy Child Part order. A dynamic Child Part order
  routes instead to a new `decideChildPartUnitStep` (body: `{category, step, decision:
  'Pass'|'Reject', results, rejectReason}`), mirroring `submitBatchQcDecision`'s pattern minus
  the quantity split: Reject reopens just that step (`proc.status='In Progress'`, a rework
  logged); Pass completes the step, and if it's the true last index of that unit's own pipeline,
  applies pending cost, credits `Item.qty+=1`, and — once `allUnitsCompleted` — completes the
  order and approves the job. `getQCJob` gained a lazy-pull loop for pending unit-step checklist
  rows (mirrors the existing `batchSteps` loop) and a new computed `childPartDynamic` flag — the
  frontend's dispatch signal, since a bare `unit.steps.length` check can't tell "dynamic Child
  Part order, nothing submitted yet" apart from "Machine, permanently flat" (both start empty).
- Frontend: `ProcessExecution.jsx` — `checkpointIdx` now also reads `-1` for Child Part (same
  pattern already applied to Sub Child Part), a new `isUnitQcOrder`/shared `qcStepIndices`, a
  **Submit to QC — Unit N** button (cost dialog on that unit's own true last step) hitting the
  new endpoint. `ChildPartUnitQCReview.jsx` — rewritten with a new `stepped` prop
  (`job.childPartDynamic`): `false` renders the exact original component unchanged (Machine, or
  a legacy Child Part order); `true` renders a new per-step review (a unit's row shows a
  computed "N of M steps done" or a Review button for the one pending step; the dialog fills
  status/remarks directly, no separate Production-recorded layer, same convention
  `SubChildPartBatchQCReview`'s own row component already uses — not `ProductionCheckReviewRow`,
  which assumes that layer exists). `QCInspection.jsx` — one new prop passed through, mount site
  unchanged.

**Verified:**
- `node --check` plus runtime imports on every touched/new backend file; `esbuild` on every
  touched/new frontend file.
- Scratch script (disposable `TEST-` data, deleted after): a dynamic Child Part order, 2 units, 2
  QC-flagged steps (Assembly mid-sequence, Painting the true last step) — submit → Reject →
  resubmit (history kept, both attempts visible) → Pass (not credited yet, correctly, since
  Assembly isn't the true last step) → Painting requires cost, refused without it → Pass credits
  `Item.qty+=1` for that unit alone, order not yet Completed → Unit 2 goes through the same cycle
  fully independently → once both units' every step is Approved, `Item.qty` reaches 2,
  `order.status` becomes `Completed`, `job.status` becomes `Approved` → confirmed Unit 1's own
  attempt history is untouched by Unit 2's actions. 30/30 checks passed.
- Explicit Machine regression script: a Machine per-unit QC job, decided through the same shared
  `decideChildPartUnit` dispatcher — confirmed it reaches `decideChildPartUnitLegacy`, the unit's
  old flat fields (`status`/`process[]`) are what change (`unit.steps` stays empty, confirming
  the new mechanism never engages), and `completeMachineUnit`'s stock crediting still fires
  correctly. 6/6 checks passed.
- **Not yet done:** a live browser test against a real Child Part order (e.g. Fan/CP-001) with
  ≥2 QC-flagged steps across ≥2 units.

## Child Part outsourced QC steps — built (2026-09-28), LIVE-TESTED CLEAN (2026-09-28)

Found needed immediately while live-testing Stage B: a real test order was built specifically to
exercise it (`ORD-2026-079`, Fan/CP-001, 2 units, BOM welding[Out Source, QC] → grinding[Out
Source, QC] → coating[In-House, QC] → pre panting[Out Source] → post painting[Out Source]).
Purchase bundled welding+grinding into one hand-off and received it. Welding (the one step
`qcCheckpointIndex` recognizes) correctly went "awaiting self-check" — briefly re-enabled by a
same-night stopgap fix to `ProcessExecution.jsx`'s `checkpointIdx` (narrowed to Outsourcing-type
only, to avoid re-conflicting with Stage B's new in-house mechanism). **Grinding — a second
QC-flagged step the old single-checkpoint mechanism has no way to represent — was silently marked
`Completed` with zero QC on both units**, and coating unlocked with nothing having gated it. This
is the direct Child Part counterpart of slice 3, confirming the same principle already proven live
for Sub Child Part: when a hand-off bundles more than one QC-flagged step, **every** one of them
must submit to QC independently, not just the first. Unlike Sub Child Part's whole-batch quantity
split, Child Part's per-unit model has no `qtyEnteringStep`-style chaining concern between bundled
steps at all — `submitUnitStepForQC` is pure independent Pass/Reject, per unit, per step.

**Supersedes the same-night `checkpointIdx` stopgap** — once every outsourced QC step routes
through the new mechanism, welding has nothing left to do on the old self-check path either,
exactly like Sub Child Part (zero steps left on the old mechanism). `checkpointIdx` reverted back
to always `-1` for Child Part too.

**Built:**
- `outsourceWorkController.js`'s `receiveOutsourceHandoffRound` — the old shared Child Part/
  Machine `else` branch split three ways: Machine stays byte-for-byte on `qcCheckpointIndex`
  (Stage C still pending); a genuinely legacy Child Part order with no Process Definition
  (`getQcStepIndices` returns `[]`) falls through to that exact same untouched code; a **dynamic**
  Child Part order (`getQcStepIndices(order, order.processes).length > 0`) gets a new branch — per
  unit, per step in the hand-off: a QC-flagged step calls `submitUnitStepForQC` (Stage B's own
  helper, unmodified) against that unit's own QC job entry; a non-QC step completes straight
  through as before, and if it's the true last index of that unit, credits `Item.qty += 1` directly
  (deliberately no cost applied — no Production-side form exists for an Outsourcing step; mirrors
  the already-documented "vendor cost capture still deferred" convention this file uses everywhere
  else) and checks `allUnitsCompleted` → `order.status = 'Completed'` + `markJobApproved`.
- `decideChildPartUnitStep` (Stage B) and `ensureQCJobForOrder`/`ensureUnitChecksStructure`
  needed **zero changes** — both already order-agnostic about who calls them, and
  `decideChildPartUnitStep`'s true-last-step Pass branch already skips cost recalc gracefully when
  `pendingProductionCost`/`Expense` are null (which they always are, coming from this path), still
  crediting stock correctly.
- `ProcessExecution.jsx`: `checkpointIdx` reverted to always `-1` for `ChildPart` (removing the
  stopgap's `p.type === 'Outsourcing'` carve-out) — no other frontend changes needed, the
  Outsourcing-type rendering branch already displays `Received`/`QC Pending`/`Completed` correctly
  regardless of which mechanism produced them.

**Verified:**
- `node --check` + runtime import on `outsourceWorkController.js`; `esbuild` on `ProcessExecution.jsx`.
- Scratch script (disposable `TEST-` data, deleted after): 2-unit Child Part order, 2 QC-flagged
  Out Source steps bundled into one hand-off + 1 non-QC true-last Out Source step — receiving the
  bundle lands BOTH steps as `QC Pending` (not one silently `Completed`) with independent QC job
  entries per unit; Pass on one unit's step and Reject on the other's leaves the other step/unit
  completely unaffected either way; resubmitting after a Reject keeps full attempt history (2
  attempts); the non-QC true-last step credits `Item.qty` (+1 per unit, no cost required) and
  completes the order once every unit's every step is done, marking the QC job `Approved`. 31/31
  checks passed. Machine's own branch wasn't independently re-tested this pass — it's provably
  unreachable-by-construction for this change (guarded behind `order.orderKind === 'ChildPart'`,
  moved byte-for-byte into the same `else` Machine already ran through, not rewritten).
- **Live data**: `ORD-2026-079`'s welding AND grinding both reset back to `NotStarted`/`Pending` on
  both units (grinding was already reset before this fix existed; welding reset now that its
  stopgap is superseded) — ready for Purchase to resend+receive both fresh through the new unified
  mechanism.
- **Not yet done:** a live browser retest of `ORD-2026-079` end to end.

Next: Stage C (Machine), only once the user confirms both Stage B and this build test clean live.

## QC job history view — built (2026-09-28)

Found live while confirming the outsourced-QC-steps fix above worked (`QC-2026-0205` and
`QC-2026-0206`): once a step's latest attempt is decided, the job page only ever showed a compact
status badge ("Resolved"/"Approved"/"N of M steps done") — no way to open it and see what was
actually checked. The data was always fully persisted (`StepAttemptSchema`/
`BatchStepAttemptSchema` in `QCJob.js` — every attempt kept, never overwritten, the whole point of
the "full history" design promise) and already came back from `getQCJob` — the gap was purely
frontend, which only ever rendered the *latest* attempt, and only while still undecided (the
editable Review form). Frontend-only fix, no backend changes:
- `SubChildPartBatchQCReview.jsx`: a **History** button next to each step's badge, visible
  whenever it has any attempts at all (not just once fully resolved), opens a new read-only
  dialog listing every attempt oldest-first — its checklist rows, who submitted/decided it and
  when, and the Passed/Rework/Scrap split + reason.
- `ChildPartUnitQCReview.jsx`: `SteppedUnitsCard` used to only show one aggregate "N of M steps
  done" badge per unit with no way to see any individual step once it wasn't the one currently
  pending — expanded into a per-step list under each unit (status badge + Review when pending +
  History whenever it has attempts), same read-only history dialog pattern, Child Part's own
  Pass/Reject + reason shape instead of a quantity split.

Verified via `esbuild` on both files; not yet exercised on a real 2-attempt (Reject → resubmit)
case live — both real jobs checked against currently have exactly one attempt per step.

## Stage C (Machine) — built (2026-09-28), LIVE-TESTED CLEAN (2026-09-28)

Last order kind — Sub Child Part and Child Part (both in-house + outsourced) were already
confirmed live at this point. Built in-house and Machine's own outsourced QC steps together in one
pass, mirroring how Child Part's in-house (Stage B) and outsourced pieces both landed the same
night once the pattern was proven.

**Design correction before any code was written** — the first draft of this plan assumed `finalQc`
had to be the true last step (to reuse the "true last step credits/completes" pattern directly).
The user corrected this with a real example: BP816's actual BOM is
`assemble[qcRequired] → pre painting[qcRequired] → post painting[finalQc only]`, and explained the
real-world reasoning — you test the machine's build *before* painting it, so a failed test's
rework doesn't damage finish work already applied. Confirmed in the design itself, which was
already there to be re-read: `processDefinitionValidation.js`'s `requireExactlyOneFinalQc` never
checks position, and section 2 already says *"The Final step is usually after assembly and
testing, but steps may follow it."* Section 10 confirms completion is purely position-based (*"all
its QC steps are passed and its true last step is finished... If the last step has no QC flag,
whoever finishes it runs the finishing logic"*) — fully decoupled from where `finalQc` sits. The
user will reconfigure BP816's own flags (move `finalQc` before painting) to match this before live
testing.

**What was already built, needed zero changes** (laid down back in slice 1/Stage A specifically
anticipating this stage): `getQcStepIndices` already included `finalQc`; `needsUnitSteps`/
`isPerUnitMachineOrder` already gated Machine's own `unitChecks[]` seeding on it;
`submitUnitStepForQC` already stored `entry.finalQc`; `markProcessComplete`'s generic branch and
`approveQC`/`rejectQC` already used `getQcStepIndices` (Stage A's own fix); `reopenFinalTestingForRejection`
was already position-based, not name-matched; `completeFinalProcessStep`'s Machine branch
(2026-09-23, predates this whole redesign) already used `getQcStepIndices` for its own "true last
step, no QC flag, reached after an earlier QC step passed" case.

**Built:**
- `qcStepService.js`: new `resolveStepFinalRows(companyId, itemId)` — the `finalQc` sibling of
  `resolveStepProcessRows`, item-level (`module:'productMaster', stage:'final'`), tagged
  `source:'final'`. A step carrying both `qcRequired` and `finalQc` gets rows from both resolvers
  concatenated into the same attempt — "one review with two sections", per the doc's own agreed
  design.
- `qcController.js`'s `getQCJob`: the `unit.steps[]` lazy-pull loop now resolves `order` once up
  front (`job.source` doesn't reliably distinguish Machine — `qcJobSourceForOrder` falls it
  through to the same generic `'Production'`/`'Stock'` as everything else — `orderKind` is the
  only reliable signal) and branches per order kind: Child Part unchanged, Machine resolves
  process and/or final rows depending on which flag(s) the live BOM step still carries. Renamed
  `childPartDynamic` → `unitStepsDynamic` (broadened to Child Part OR Machine).
- `productionMfgController.js`: `submitUnitQcStep`'s guards broadened (`orderKind` check now
  accepts Machine too; the "is this a QC step" check now also accepts a `finalQc`-only step, not
  just `qcRequired`). `markProcessComplete`'s hardcoded `proc.step === 'Final Testing'` name check
  now only fires for a genuinely legacy order (`qcStepIndices.length === 0`) — a real, if
  low-severity, latent collision closed: a dynamic Machine order's true last step could
  coincidentally be named literally "Final Testing" too, which used to intercept it with the wrong
  (pre-redesign) refusal message before ever reaching the already-correct generic block below it.
- `qcController.js`: `decideChildPartUnit` dispatcher broadened to route Machine (not just Child
  Part) to the new `decideChildPartUnitStep` when dynamic — same "empty array = old behavior" gate,
  `decideChildPartUnitLegacy` stays reachable for a genuinely legacy order of either kind, body
  untouched. `decideChildPartUnitStep`'s true-last-step Pass branch gained an
  `else if (order.orderKind === 'Machine')` calling the **existing** `completeMachineUnit` instead
  of Child Part's plain `Item.qty += 1` — reuses the Sale-vs-stock fork, `entry.readyAt`,
  job-Approved, and order-completion logic that function already had, no duplication. No cost
  capture here (Machine's build cost, `applyManufacturedFinalCost`, stays tied to the old Final
  Testing flow only — out of scope, same as Child Part's Stage B never needing it).
- `outsourceWorkController.js`'s `receiveOutsourceHandoffRound`: the dynamic Child Part branch
  built for the earlier outsourced-QC-steps work now also matches Machine — same shape (every
  QC-flagged step in the hand-off submits independently; a non-QC step completes straight through
  and, if the true last step, credits/completes) — the one difference is the true-last-step credit
  calls `completeMachineUnit` for Machine instead of `Item.qty += 1`.
- Frontend, `ProcessExecution.jsx`: `isUnitQcOrder` now also true for Machine; `checkpointIdx`'s
  `-1` override now also applies to a **dynamic** Machine order specifically (unlike Sub Child
  Part/Child Part, which are unconditionally `-1` — a legacy, non-dynamic Machine order still
  needs the old `QcCheckpointPanel` self-check computed the old way, so this is conditional on
  `qcStepIndices` being non-empty, not a blanket override). `isUnitQcStep`/`isUnitLastNonQc` now
  also check `finalQc`, not just `qcRequired` (Child Part never sets `finalQc`, so this was
  previously a harmless no-op there). `QCInspection.jsx`: `stepped` now reads the renamed
  `job.unitStepsDynamic`. `ChildPartUnitQCReview.jsx`/`SteppedUnitsCard`: no structural change
  needed — already order-kind-agnostic per-unit/per-step rendering.

**Verified:**
- `node --check` + runtime import on every touched backend file; `esbuild` on both touched
  frontend files.
- Scratch script (disposable `TEST-` data, deleted after): a dynamic Machine order, 2 units, BOM
  `assemble[qcRequired] → check[qcRequired+finalQc, both flags] → welding[Outsourcing, QC] →
  grinding[Outsourcing, QC] → pack[Outsourcing, no QC, true last]` — mid-pipeline in-house QC,
  a combined-flag step (confirmed both `resolveStepProcessRows`/`resolveStepFinalRows` run without
  error), two outsourced QC steps bundled into one hand-off received together (both submit
  independently, not silently completed — the same bug class found for Child Part, confirmed not
  reintroduced for Machine), and the non-QC true-last outsourced step crediting `Item.qty += 2`
  (stock, no Sale linked) via `completeMachineUnit` and marking the QC job `Approved`. 39/39 checks
  passed.
- Explicit regression check: a genuinely legacy Machine order (zero `qcRequired`/`finalQc`
  anywhere) — confirmed `unitChecks[]` stays unseeded (a flagless Machine order was never a
  "per-unit" one in any version of this code, before or after Stage C — `isPerUnitMachineOrder`
  IS `getQcStepIndices(...).length > 0`, by definition, so there's no scenario where unitChecks
  gets seeded yet the dynamic mechanism doesn't engage) and the old flat `job.checklist[]`
  (`ensureFlatChecklist`) flow resolves without error, completely unaffected. 3/3 checks passed.
- **CONFIRMED LIVE 2026-09-28**: the user reconfigured BP816's BOM to match the corrected
  real-world sequencing — `assemble[In-House, qcRequired] → pre painting[Outsourcing, qcRequired]
  → post painting[Outsourcing, finalQc only, mid-pipeline] → coating[In-House, qcRequired, true
  last]` — and ran a real 2-unit order (`ORD-2026-081`) through it end to end. Confirmed via DB
  check: both units, all 4 steps `Approved`/`Completed`; `pre painting` + `post painting` bundled
  into one hand-off (both outsourced QC steps submitted and decided independently); `post
  painting`'s Final-QC-only checklist resolved correctly through the outsourced path, sitting
  mid-pipeline as intended, not gating order completion by itself; `coating` (the true last step,
  in-house, QC-flagged, itself not `finalQc`) triggered `completeMachineUnit` on Pass, crediting
  `Item.qty += 2` (stock, no Sale linked); `order.status` → `Completed`; QC job `Approved`, both
  units' `readyAt` set. No bugs found — Stage C confirmed clean on the first real end-to-end test.

Next: slice 4 (cleanup — remove `qcCheckpointIndex`'s single-flag/fixed-last rules,
`QcCheckpointPanel`'s self-check mode, `FinalChecklistPanel`, `requireExactlyOneQcStep`, the old
Initial stage, legacy `partChecks` QC), only once the user confirms Stage C tests clean live.

## Slice 4 — cleanup — built (2026-09-28)

Last piece of the whole redesign. Before touching anything, 14 real open orders (some `In
Progress`) still on the old mechanism (zero QC flags anywhere) were found via direct DB
investigation and confirmed dev data by the user — deleted, along with their QC jobs. Two BOMs
(M-311/Machine, SCP-004/005/006/Sub Child Part) remain genuinely unconfigured — user's call:
proceed anyway, R&D will flag them separately; see "a real consequence worth knowing" below for
what that means going forward.

**Scope correction found during investigation** — the original plan's "legacy per-part
`partChecks` QC" line was wrong to include. `partChecks[]` is tied to the OLD, frozen RDBOM/
RDChildPart hierarchy (a Machine's nested Sub Child Parts under the pre-hierarchy-redesign tree),
confirmed by `markProcessComplete`'s own comment ("partChecks only ever gets seeded from the OLD
RDChildPart tree") and by its frontend (`SubChildPartQCPanel.jsx`, sharing `ChecklistStepper.jsx`
with the two panels that WERE removed). That system predates and is unrelated to
`qcCheckpointIndex`/the single-checkpoint system this redesign replaced — the BOM hierarchy
redesign already established it as "frozen... deliberately untouched." **Left completely alone.**

Also found during investigation: `markProcessComplete`'s `qcStepIndices.length === 0` fallback
(and `approveQC`/`rejectQC`'s equivalent) is NOT part of the checkpoint machinery being removed —
it's a separate, older "nothing flagged → generic self-certify" path with no dependency on
`qcCheckpointIndex` at all. Correctly **left in place** as the safety net for an unconfigured BOM.

**Removed:**
- `qcCheckpointIndex` itself (`productionMfgController.js`) and every real call site.
- `getQcCheckpoint`/`submitQcCheckpoint` (the two endpoints backing `QcCheckpointPanel.jsx`) —
  deleted entirely, plus their two routes.
- `getFinalChecklist`/`saveFinalChecklist` (the hardcoded `'Final Testing'`-name-matched flow) and
  the now-orphaned `allUnitsFinalTestingSubmitted` — deleted entirely, plus their two routes.
  `applyManufacturedFinalCost` **stays** (still called by `completeFinalProcessStep`'s Machine
  branch, which is unrelated and untouched).
- `decideChildPartUnitLegacy` (`qcController.js`) — the entire original `decideChildPartUnit` body,
  deleted now that nothing routes to it; the dispatcher is un-branched (`decideChildPartUnitStep`
  always).
- `submitDecision`'s old `checkpointIsLastStep`/`prodOrderForFT` sub-block — `submitDecision`
  itself stays (still needed for non-manufactured/purchased-item QC).
- `outsourceWorkController.js`'s `receiveOutsourceHandoffRound` final `else` branch — replaced with
  a clean refusal (`HttpError`) instead of the old `qcCheckpointIndex`-driven body, for the
  unconfigured-BOM edge case. The now-unused `unitsFinishedHere` accumulator and its own post-loop
  block were dead code once that branch's only populator was gone — removed too.
- Three hardcoded `proc.step === 'Final Testing'` refusals (`markProcessComplete`, `approveQC`,
  `rejectQC`) — each pointed at the now-deleted checklist-submission flow, and (a real latent bug,
  same class as Stage C's own earlier fix) would have wrongly intercepted a DYNAMIC order's own
  real flagged step if it happened to share that literal name, ahead of the correct
  `getQcStepIndices`-based check below each. Removed rather than re-guarded, since there's no
  mechanism left to defer to even for a genuinely legacy order.
- Frontend: `QcCheckpointPanel.jsx` and `FinalChecklistPanel.jsx` deleted entirely (their only
  consumer was `ProcessExecution.jsx`). `checkpointIdx`/`isDynamicOrder`/
  `trueLastStepAfterCheckpoint`/`machineIsDynamic` removed — provably always `-1`/`false` for any
  real order once traced through (a flagged step always forces the new mechanism to claim it
  first; an unflagged one has nothing for the old computation to ever find either). Every render
  branch keyed on them (self-check text, the "Complete {step}" true-last-checkpoint button, the
  two panel mounts) removed with them. Since the backend's own hardcoded `'Final Testing'`
  refusals were also removed, the frontend's matching `proc.step !== 'Final Testing'` gates on the
  Approve/Reject buttons were removed too — otherwise the UI would have hidden the only way left
  to complete that step, a real mismatch the two sides would've had otherwise.

**A real consequence worth knowing** (accepted, not a bug): with `saveFinalChecklist`/
`FinalChecklistPanel` gone, a **legacy** order's step literally named `'Final Testing'` used to be
specially blocked from self-certifying (pointing Production at the checklist flow instead) — now
it just self-certifies like any other unconfigured step, since there's no more dedicated mechanism
to defer to. This only affects a genuinely unconfigured item (M-311, SCP-004/005/006, until R&D
flags them) — every real, dynamic order is unaffected.

**Verified:**
- `node --check` + runtime import on every touched backend file (`qcController.js`,
  `productionMfgController.js`, `outsourceWorkController.js`, `productionMfgRoutes.js`).
- `esbuild` on `ProcessExecution.jsx`.
- Scratch regression script (disposable `TEST-` data, deleted after) — confirmed post-cleanup:
  `submitUnitQcStep`/`decideChildPartUnit` (now un-branched) still work for a dynamic Child Part
  order; `markProcessComplete` still correctly refuses a true-last QC-flagged step;
  `receiveOutsourceHandoffRound` still credits stock via `completeMachineUnit` for a dynamic
  Machine's non-QC true-last outsourced step; an unconfigured item's outsourced hand-off now
  refuses cleanly (400, no crash) instead of the old silent mis-behavior; a legacy plain step and a
  legacy step literally named `'Final Testing'` both now complete + self-certify via the generic
  fallback with no dead-end. 15/15 checks passed.
- Direct DB query: confirmed 8 real historical `unitChecks[]` entries (across `ORD-2026-058`,
  `ORD-2026-073`, and 3 completed Machine orders) still carry data in the OLD flat schema fields
  (`initial`/`process`/`status`), all `status:'Approved'` — real, already-completed QC history.
  **Schema fields deliberately left in place** (harmless, unused going forward) rather than
  migrated or dropped — confirms that was the right call, not just a guess.

**The QC multi-checkpoint redesign is now complete.**
