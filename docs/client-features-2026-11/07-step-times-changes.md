# Feature 7: The real time for start, finish, joining and leaving (what changed)

*Built 12 November 2026, from the client meeting the same day. Logic and your decisions: [07-step-times-logic.md](07-step-times-logic.md). Browser test: [07-step-times-test-roadmap.md](07-step-times-test-roadmap.md).*

## In one line
When Production clicks **Start, Complete, Add people or Take off** after the fact, they can say when it really happened. The crew's hours, and so the labour cost, use that time.

## What Production sees (Process Execution)
- **Start** opens *"Start {step}"*: **Started now** (picked) or **Started at** a date and time.
  - It can't be in the future, or before the previous step finished, or before the order was made.
  - Everyone on the crew counts from that time. Someone who was on another step then counts from when they left it.
- **Every completion** first asks *"When did {step} finish?"*: **Finished now** or **Finished at**. Then:
  1. the lunch list, covering the step only up to that time
  2. the expense dialog, if the step needs one
  3. the step completes

  This covers Mark Complete, the last in-house step, Complete on the last step, and Submit to QC (batch and unit). The time can't be before the step started, and it's refused if someone still on the crew joined after it.
- **Add people on a running step** also offers **Joining now** or **Working since** a time. It can't be before the step started.
  - **Moving someone this way** closes their old step at the same time.
  - **Someone still on another step at that time** counts from when they left it, and the dialog says so.
- **The × on a crew member** opens *"Take {name} off"*: **Left now** or **Left at** a time, not before they joined.
- **What the step shows:** *"Started 09:00 · entered 11:15 by rahul"* and *"Finished 14:00 · entered 15:00 by rahul"*. Hovering on a crew member shows *"since 10:00 · entered 11:30"*.
- **The red line:** the picker shows it at once for a time in the future or too early, and the button stays off. The server checks the same rules.
- **Unchanged:** the old fixed-step Painting and Assembly buttons, which only old-shape orders have.

## Manpower → Today
**Take off** opens the same *Left now / Left at* dialog.

## Fixed on the way
**Someone who joined a step after its finish time** used to stay listed on the finished step forever. They're now closed with no hours.

## Technical notes
**Server:**
- **New `utils/actionTime.js`:** checks a time; up to 2 minutes ahead counts as now; it's back-dated when more than a minute before the click.
- **Models:**
  - ProcessStepSchema: `startedEnteredAt/By`, `completedEnteredAt/By`
  - `StepCrewEntry`: `joinedEnteredAt`, `leftEnteredAt`
- **`productionMfgController.js`:**
  - `startProcess` takes `startedAt`, then calls `backdateCrewToStart`.
  - `finishTime` and `stampDone` handle `finishedAt` in `markProcessComplete`, `completeFinalProcessStep`, `submitBatchQcStep` and `submitUnitQcStep`.
  - The crew routes take `since`, `?leftAt=` and `?until=`.
- **`qcStepService.js`:** the two submit helpers take `{ at }` (default now). The outsource receive is unchanged.
- **`crewService.js`:**
  - `addToCrew({ since })`, `takeOffCrew({ leftAt })`
  - new `backdateCrewToStart`, `notOverlapping`, `roundStartOf`
  - `stepCrewView({ until })`
  - `closeFinishedCrews` no longer leaves a late joiner open

**Screens:**
- new `components/production/WhenPicker.jsx`
- `ProcessExecution.jsx`: the Start and "When did it finish?" dialogs
- `ProductionContext.jsx`
- `StepCrew.jsx`: working since, the take-off dialog, the lunch list up to the finish, and what the step shows
- `ManpowerTracking.jsx`

## Tests
- **New suite `steptimes`: 28 of 28,** through the real server, on a made-up company. Times are relative to now:
  - **Start late:** started at −150, so the step and Ravi count from −150, and who entered it and when is kept.
  - **Start bounds:** refused before the previous step finished, and before the order was made.
  - **No double pay:** someone on another step until −100 counts from −100.
  - **Working since:** Amit since −120; p7 asked from −120 but counted from −100, and told so.
  - **A move:** working since −60 closes the old step at −60. A time before he joined his old step is refused.
  - **Left at** −40, and left at before joining is refused.
  - **The lunch list:** listed when finishing now, not when finished at −30.
  - **Finish late:** a finish before someone on the crew joined is refused. Finished at −30 is recorded at −30, the crew closes at −30, and the run is saved at once with Ravi 2 h, Amit 1.5 h, p7 1.17 h, Mohan 20 min = 5.0 person-hours. The lunch after the finish isn't taken off.
  - **Submit to QC** with finished at −20.
  - **A plain click** on each action: as before, with no "entered" record.
  - **A future time:** refused on every action.
- **Regression, all passing:**
  - crew and labour: `crew` 67, `labour` 33
  - QC and parts: `slice4-cost` 30, `s1` 25, `gc` 40, `nosel` 46, `qc-order` 5, `jobwork-qc` 23
  - steps: `slice7` 31, `stale-atstore` 2, `dispatch-store-part2` 19, `partial-3a` 20, `partial-3c` 16
- **Screens compile:** Process Execution, the production context, the crew panel, the time picker and Manpower.
- **Note:** "entered by" stores the login name (e.g. `testproductionhead`), as the rest of the app does when no full name is loaded with the login.
