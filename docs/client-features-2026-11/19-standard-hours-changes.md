# Feature 19: Standard hours (what changed)

*Built 21 November 2026, from the client meeting on 20 November. Logic, maths and your decisions (A–H): [19-standard-hours-logic.md](19-standard-hours-logic.md). Browser test: [19-standard-hours-test-roadmap.md](19-standard-hours-test-roadmap.md).*

## In one line
Production no longer types the hours it's scored against. **R&D** sets each in-house step's hours and people count, the **Company Admin** approves them, and the system works out each step's hours for the pieces and the people on it. **Production starts at once** and can flag an unusual job; only that step's score waits for the Company Admin.

## What R&D does (BOM editors: Machine, Child Part, Sub Child Part)
- **Each in-house step has a Standard box:** *"[hours] h per piece with [people] people · setup [ ] h · Do more people make this step faster? Yes / Partly / Hardly / No"*.
  - Setup is optional: once per job, it doesn't shrink with more people.
  - No answer counts as **Partly**.
- **A status line under it:**
  - *"In force: 3 h per piece with 2 people · from R&D · approved 21 Nov"*
  - *"Waiting for the Company Admin to approve."*
  - a rejection, with the reason
  - *"No standard yet: Production types hours for this step, and it isn't scored."*
- **The part's "usual people at once" box is gone.** Each step's people count replaces it (decision F).
- **Changing a standard doesn't pull the product back for approval.** Standards have their own approval.
- **The Company Admin gets one bell per save** naming the changed steps: *"Standard hours to approve: Body · welding, grinding"*.

## What the Company Admin does (HRMS → Company Admin → **Standard Hours**)
- **Waiting** has three lists, each with Approve / Reject. Reject asks for a reason.
  - **R&D's changes:** the new figure next to the one in force, with the hours for 1–4 people.
  - **History's proposals:** after 3 or more runs, when history differs by 5% or more. It shows the median of the last 10 runs, blended with the current figure (weight 3).
  - **Flagged steps:** the order, the step, the hours asked for, the reason, who flagged it.
- **Approved:** every standard in force. It's paged and searchable, and each one has its versions (who decided, when, from R&D or from history).
- **"How is a standard worked out?"** explains it in English or Hinglish.
- **Every decision rings a bell:** to R&D's head for R&D's figures, and to whoever flagged for a flag.

## What Production sees (Process Execution, each in-house step)
- **With an approved standard:**
  - *"**Standard 12.5 h for 4 pieces with 2 people** (approved 21 Nov) · How?"*
  - It changes as people are planned on or taken off.
  - While it runs with a changed crew, it adds *"· 11.2 h for the crew so far"*.
  - When finished: *"Standard earned 11.2 h for 4 pieces"*.
- **Nothing to type.** **Start** works straight away. Typing hours is refused: *"…has an approved standard: its hours are worked out from it. If this job is unusual, flag it."*
- **"How?"** shows the hours with 1, 2, 3, 4 people and the explainer.
- **Flag** (any time: before, during or after the work):
  - Production gives the hours the job needs and why.
  - The step shows *"Flagged by …: needs 16 h (reason). Waiting for the Company Admin: this step's score waits, the work doesn't."*
  - Then *"Flag approved by …: 16 h counts"*, or *"Flag rejected by …: the standard counts"* with the reason.
  - One open flag per step.
- **Without an approved standard:**
  - the typed box as before, with *"No approved standard yet: typed hours, this step isn't scored"*
  - once started: *"Planned: 2 h (typed, no standard: not scored)"*

## How a step's hours are worked out
**The standard:**
- standard(pieces, people) = setup + pieces × per-piece time for one person × (σ + (1 − σ) ÷ people)
- σ comes from R&D's answer: Yes 0.1, Partly 0.3, Hardly 0.6, No 1.
- Example: R&D's 3 h per piece with 2 people, setup 0.5 h, Partly → 4 pieces take 18.96 h with 1 person, 12.5 h with 2, 10.35 h with 3, 9.27 h with 4.

**When the crew changes, it's earned stretch by stretch,** from when each person was really on the step and present:
- 2 people for 6 h, then 4 people for 3 h → earned = 9 ÷ (6 ÷ 12.5 + 3 ÷ 9.27) = **11.2 h**.
- That's the figure saved on the run and scored.

**Start stores a snapshot** of the standard on the step. A standard approved later doesn't change a step already running.

## The scorecard (Productivity, Task completion, weights)
| The step | Scored against |
|---|---|
| Started with an approved standard | the standard it earned |
| Flag waiting | **not counted yet** (only this step) |
| Flag approved | the hours asked for |
| Flag rejected | the standard it earned |
| Started with typed hours (no standard) | **not scored** (decision H) |
| Started before 21 Nov (no source) | its typed hours, as before (decision G), so past months don't change |

- **Steps still open past their plan (Task completion):** the same rules, against the standard earned for the crew so far.
- **A waiting flag still weighs by the standard:** Production can't move it.
- **A run that isn't scored** (typed, or flag waiting) and has no QC result **isn't listed** in the person's finished steps. That's how runs with no plan were already handled. With a QC result it's listed, with *"typed hours, not scored"* / *"flagged, waiting for the Company Admin"* in the Timing column.

## Work Planning board
- **Planned, not started:**
  - with a standard: *"standard 3.13 h for this crew"*, and it **can start** without typed hours
  - without one: *"no standard: type planned hours"*
- **Running:** *"2.6 h of 2.57 h standard · over plan"*. The plan is the standard earned for the crew so far, an approved flag's hours, or the typed hours. A waiting flag shows *"· flagged"*.

## The delivery estimate (logic §8)
**The core is unchanged.** Only the inputs:
- **A step's time with k people:** its approved standard, the same formula Production is scored on. No approved standard: R&D's figures, counted as typed (Rough). History is no longer used directly.
- **Most people on a step:** its people count.
- **Most people on an order at once:** the part's largest step count, so D1 (per order) still holds.
- **Work in hand:**
  - running on a snapshot: what's left of it
  - not started: the standard Start will use
  - else typed hours, else R&D's figures, else 1 day per step
- **How sure:** approved standards count as firm, the same as history.
- **The explainer (EN / Hinglish) is updated.**

## Things to know
- **Test-1:** the old "usual people" of 7 parts was copied into their 13 in-house steps' people count. Backup: `D:\cs\db-backups\test-1-clean-2026-11-21\std-crew-before.json`. None of these standards is approved yet, so they're all on the Company Admin's waiting list.
- **Until the Company Admin approves a step's standard,** Production types hours for it and it isn't scored.
- **An approved standard moves only when the Company Admin decides,** on R&D's change or on history's proposal.

## Technical notes
**Server, new:**
- **`services/standards/standardCalc.js`** (pure): the formula, crew stretches, earned hours, history's proposal, the σ fit, and `scoredPlan`, which says what a step is scored against.
- **`services/standards/standardService.js`:**
  - active standards, batched
  - the waiting list: R&D changes, history proposals, flags
  - `decide`, the approved list (paged), versions, BOM status
  - `standardOfStep`, `piecesFor`, `flagsFor`, `raiseFlag`, `flagOfStep`, `tellStandardEdits`
- **Models:**
  - `models/StepStandard.js`: each decision, the latest Approved one in force
  - `models/StepFlag.js`: one Pending per order / unit / step, by a unique partial index
- **`routes/standardHours.routes.js`** at `/api/standard-hours`: waiting, decide, approved and versions are Company Admin only; bom-status is open to the company.

**Server, changed:**
- **Models:**
  - `ProcessDefinitionSchema`: a step gains `standardCrew`, `setupHours`, `splitAnswer`, `standardEditedAt`
  - `ProductionOrder`: a step gains the same three, plus `standard` (the snapshot) and `plannedSource`
  - `StepRun`: gains `plannedSource` and `standardId`
- **`utils/processDefinitionValidation.js`:** cleans the new fields; they're left out of the "steps changed" check; `stampStandardEdits`.
- **BOM saves call `stampStandardEdits` and `tellStandardEdits`:** `machineBOMController.js`, `childPartBOMController.js`, `subChildPartMasterController.js` (create and update).
- **`processStepBuilderService.js`:** copies the three fields onto order steps.
- **`productionMfgController.js`:**
  - Start uses the standard (snapshot plus planned hours), else asks for typed hours
  - `planned-hours` is refused when a standard exists
  - new `GET` / `POST /orders/:id/processes/:stepIndex/flag`
- **`services/crew/crewService.js`:**
  - `recordRun` saves the earned standard
  - `stepCrewView` returns `standard`, `flag`, `scored` and `plannedSource`
  - `stepHoursSoFar` also returns who worked when
- **`services/score/scoreService.js`:** finished runs and open steps go through `scoredPlan`; each run row gets `planWhy`.
- **`services/planning/boardService.js`:** can-start and the planned hours from the standard; over-plan against the standard earned so far; the flag mark.
- **`services/estimate/workList.js`:** `stdFor` / `hoursTable`, step crews, `jobCap`, and work in hand by snapshot or standard.
- **`services/estimate/estimateService.js`:** approved standards count as firm.

**Screens:**
- `ProcessDefinitionEditor.jsx`: the Standard fields and the status line
- `MachineBOMTab.jsx`, `ChildPartMasterTab.jsx`, `SubChildPartMasterTab.jsx`: the usual-people box removed
- new `pages/hrms/CompanyAdmin/StandardHours.jsx` and `components/standards/StandardExplain.jsx`, with the route and the menu item
- `components/production/StepCrew.jsx`: the standard line, How?, the Flag button, dialog and status, the typed / not-scored notes
- `WorkPlanning.jsx`, `PersonScoreDialog.jsx`, `DeliveryEstimatorModal.jsx`, `DeliveryEstimateExplain.jsx`: wording

## Tests
**New suites, all through the real server (except `stdcalc`) on made-up companies with `.invalid` emails:**
- **`stdcalc`, 24 of 24:** the logic doc's hand-worked numbers.
  - 18.96 / 12.5 / 10.35 / 9.27 h
  - a crew change gives 11.2 h
  - the proposal gives 4.310, then 2.80 h per piece and 11.7 h
  - the median and blend edges, and `fitSigma` with thin data
- **`stdapprove`, 33 of 33:**
  - R&D saves step standards; the product stays approved; bad values are dropped
  - the Company Admin's bell names the step; saving the same figures again sends none
  - waiting → approve / reject, dated versions, a history proposal at 3 or more runs and 5% or more
  - non-admins are refused; another company is kept apart
- **`stdprod`, 52 of 52:** the standard ÷ 4 so it fits in today.
  - **Before the start:** the standard for the crew planned (3.13 h with 2 people; 4.74 / 2.59 / 2.32 h with 1 / 3 / 4); typing is refused.
  - **Start and run:**
    - Start without typing stores the snapshot
    - 2 more join, and the earned figure so far is 2.57 h; the board is over plan against it
    - finish: took 2.25 h, earned **2.8 h**, saved with its source and the standard's id
  - **No standard:** Start asks for typed hours; typed steps aren't scored and can't be flagged.
  - **Flags:**
    - before the start: view-only can't flag, a reason is required, one open flag per step, the Company Admin's bell; the work starts at once
    - the scorecard: welding earned 2.8 → 110; grinding (typed) left out; a pre-standard run on its typed 0.8 h → 80; painting (flag waiting) left out
    - the Company Admin approves: painting goes against the flagged 0.7 h → 93.3, and the flagger gets a bell. Production can't approve its own flag.
    - a flag after the finish, rejected: the standard counts again
  - **Open past plan:** a standard step is counted, a typed one isn't; a flag while running holds it; rejected, it's counted again.
  - **Work Planning:** a standard step can start without typing; one without needs typed hours.
  - **Another company:** refused.
- **`estwork`, 52 of 52** (4 checks rewritten for the new inputs):
  - Body welding's approved standard (4.545 h with 1 person, 2.5 h with 2; history no longer used)
  - cap = the largest step crew
  - R&D's unapproved 4 h with 2 people → 4 h for 2, 6.15 h for 1, Rough
  - a step with no people count → 1
  - work in hand: not started → the standard; running → its own snapshot
- **`estplan` 55 of 55 and `estimate` 22 of 22**, unchanged.
- **Regression, all passing:**
  - crew 67, steptimes 28, planahead 20, teamcover 29, planboard 30
  - labour 34, score 50, scorecard 113, incentive 50, inccap 42
  - stephistory 18, ba 23, makebuy-gate 18, hrperms 33 (menu bundle rebuilt)
  - mpages 21, ordertrack 70, purchdays 36
- **The screens compile** (esbuild).
