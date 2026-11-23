# Feature 18: Step history on Process Execution (what changed)

*Built 21 November 2026, from the client meeting on 20 November. Logic and your decisions: [18-step-history-logic.md](18-step-history-logic.md). Browser test: [18-step-history-test-roadmap.md](18-step-history-test-roadmap.md).*

## In one line
Each step on **Process Execution** now shows when it started and finished, with the date. A **History** link lists who was put on it, when and by whom, every change to the plan, who joined and who was taken off, and the finish with each person's hours.

## What Production sees (each in-house step)
- **Start and finish, always:**
  - *"Started Thu, 20 Nov, 10:30 · Finished 14:00 (3 h 30 min)"*
  - A time entered late adds *"(entered … by …)"*, as before.
  - Before the start the line says *"Not started yet"*.
  - Before this, the times only appeared when someone back-dated them.
- **History** opens the step's timeline, oldest first, each line with a full date and time (India time). The lines:
  - **"Asha put on by Production Head"**, with marks: *planned* (put on before the start), *covering for …*, *from another team*, *redo*.
  - **"Bala removed from the plan by Production Head"** (*before the start*).
  - **"Step started"**: who starts working with it; *entered … by …* when back-dated.
  - **"Chetan working since 11:30"**: someone added while it was running.
  - **"Chetan taken off by Production Head"**: their span on the step (11:30–13:00), and *entered …* when the time was given later.
  - **"Step finished"**: each person's person-hours, the same figures the card shows.
- **Hovering over a person** on the step: *"Put on Thu, 20 Nov, 09:40 by Production Head · working since 10:30"* (or *"planned, starts with the step"*).

## Two things to know
- **Plan changes are kept from 21 Nov.** Removing someone from a step that hasn't started used to delete their plan line with no trace, because nothing was worked. Now it leaves a small record for the History. Changes before 21 Nov can't be shown.
- **After a QC redo,** the step keeps one start and its latest finish (that's how steps store them). People on the redo show their own times, marked *redo*.

## What didn't change
- **Crew hours, labour cost, the scorecard, Manpower and the delivery estimate:** they read crew entries as before. A plan change is a separate record, so none of them counts it as work.
- **No new route:** the step's existing crew read carries the extra fields. The History is built from what the step already loaded.

## Technical notes
**Server:**
- **New model `models/StepPlanChange.js`:** order, unit, step, person and name, planned at / by, removed at / by. Indexed by order + unit + step.
- **`services/crew/crewService.js`:**
  - `takeOffCrew` writes the plan changes before deleting plan lines on a not-started step.
  - `stepCrewView` adds `assignedAt`, `addedByName` and `removedByName` to each crew row (populating `addedBy` / `removedBy`), and returns `planChanges` for the step and unit.

**Screen:** `components/production/StepCrew.jsx`:
- the start and finish line, the History link and dialog
- `stepEvents()` builds the timeline
- the `fmtDT` date format
- the new hover text

## Tests
- **New suite `stephistory`: 18 of 18,** through the real server, on a made-up company. Times are relative to now:
  - **Planning:** 2 people planned. When and by whom are in the view.
  - **Removal from the plan:** Bala removed from the plan. No crew line is left, and a plan change is kept with planned and removed times and names. Another step shows none.
  - **Start, join, take-off:**
    - a back-dated start (−150) with its entered-by
    - Chetan added while running, working since −120 (entered late)
    - Chetan taken off at −60, with who did it and the entered-late time
  - **Finish:** at −30. The crew closes with the finish; hours are Asha 2 h and Chetan 1 h. The plan change is still listed.
  - **Access:** view-only Production can read the history but can't put anyone on. Another company gets "not found".
- **Regression, all passing:** `crew` 67, `steptimes` 28, `planahead` 20, `teamcover` 29, `planboard` 30.
- **The screen compiles** (esbuild).
