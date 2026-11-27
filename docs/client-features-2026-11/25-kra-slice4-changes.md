# Feature 25, slice 4 of 4: KRA scoring, the KRA view, reports (what changed)

*Built 23 November 2026, the last slice of feature 25. The rules and the worked example: [25-kra-tasks-logic.md](25-kra-tasks-logic.md) → "Slice 4 details". Browser test: [25-kra-slice4-test-roadmap.md](25-kra-slice4-test-roadmap.md).*

## In one line
For anyone with a KRA, the scorecard's **No delay, Accuracy, Work quality and Task completion** now come from their **KRA**: each item's weight × its result. Step work's result comes from the steps; every other item's from its tasks and routine items. Anyone with **no KRA** is scored exactly as before.

## The scorecard (HR → Employee Performance, Production → Manpower → Scores)
- **The four work parts** show where they came from, e.g. *"from the KRA: Lead management 50%: 80% · Daily reporting 30%: 67%"*.
- **The "not measured" reasons** now include *"fewer than 3 KRA tasks in this period"* and *"nothing in their KRA measured this period"*.
- **A new KRA box** under the breakdown, one row per item:
  - **columns:** weight, tasks (done / open, or steps), No delay %, First time right %, Quality, Completion %
  - **left-out items** are greyed with why (no tasks, under 3 tasks, no measured steps)
  - **items since removed** from the KRA are marked
  - **an amber note** when steps were done but Step work isn't in the KRA
- **"How the score is worked out"** (English / Hinglish) explains the KRA part, and the four part lines say how tasks count.
- **Productivity is still from steps only,** and steps count only when Step work is in the KRA.

## The rules (also in the logic doc)
- **Each part** = Σ (item weight × the item's result) ÷ Σ weights, over the items that have a result. An item with nothing in the period is left out, not zero.
- **Weights:** the KRA in force on the period's last day. An item since dropped keeps the weight from the version its tasks were given under.
- **Counted:**
  - **finished:** a task accepted in the period, or a routine item done with its day in the period
  - **open past due:** due by the period's end (or now) and, at that moment, not submitted or sent back and not resubmitted; or a missed routine item
  - **never counted:** waiting for review, and cancelled work
  - **inside an item,** each task counts by its planned hours (routine items 0.5 h)
  - **the minimum:** at least 3 counted tasks
- **No delay:**
  - **a task:** first submitted by its latest due date + a grace (short 30 min, medium 2 h, long 1 day; HR can change these)
  - **a routine item:** first ticked by its due time
- **Accuracy:** the first review (Accepted = right; Minor = half a mistake; Major = one); for routine items, a send-back.
- **Work quality:** the final rating, 100 / 80 / 60 / 30 (routine items have none).
- **Task completion:** finished ÷ (finished + open past due).
- **A past month is judged as it stood then,** using the submission and review times.

## Task Management → Reports (heads and HR)
- **Who sees whom:** heads see their department; HR-Admin, MIS Admin, the Company Admin and Admin see everyone (with a department filter).
- **Filters:** a month, last month, or any dates (the same picker as the scorecard), and search.
- **Per person:**
  - **tasks:** finished, on time %, first time right % (routine items too), average rating, open past due, waiting for review
  - **routine items:** done (late) / missed
  - **blocked now**
- **Who's listed:** people with a KRA or anything in the period. Paged.
- **A row** opens the person's work parts (points) and their KRA box, with the same numbers as the scorecard.
- **The old module's Reports page** is gone with the old pages. Its tasks are still readable under "Before KRA".

## HR → KRA
- **A role whose people worked on production steps in the last 30 days but whose KRA has no Step work** shows *"Did steps: add Step work?"* in amber.
- **The Task sizes card** gains the three grace times.

## Speed
- The scorecard's KRA part adds one bounded task query for the people and period, the KRA for everyone in 2 queries, and one query for removed items' weights.
- No per-person queries.
- A new index covers tasks accepted in a period.

## Files
- **Server, new:**
  - `services/kraTasks/kraScore.js`: the maths (taskFacts, itemResults, kraWorkParts)
  - `kraScoreSource.js`: the bounded task query, and the weights
  - `kraReportService.js`: reports
- **Server, changed:**
  - `services/score/scoreService.js`: monthCards uses the KRA; `personScore` returns `kra`; `kraBreakdown`
  - `services/kra/kraService.js`: the Step work flag on the overview
  - `services/kraTasks/kraTaskService.js`: the grace settings; `firstDoneAt` on the first tick; `isHead` exported
  - `models/KraTask.js`: `firstDoneAt`, an index
  - `models/KraTaskSettings.js`: the grace times
  - `routes/kraTasks.routes.js`: `GET /report`, `GET /report/person/:id`
- **Screens:**
  - new `components/kraTasks/KraScoreBox.jsx` and `TaskReports.jsx`
  - `TaskBoard.jsx`: the Reports tab
  - `components/score/PersonScoreDialog.jsx`: the KRA box
  - `ScoreBreakdown.jsx`: "from the KRA" detail and reasons
  - `ScoreParts.jsx`: the English / Hinglish explanation
  - `pages/hrms/Kra/KraPage.jsx`: the Step work note and the grace times

## Tested
- **The new suite `krascore`: 25 of 25.**
  - **The worked example to the decimal,** pure and through the server: 7.5 / 7.5 / 8.4 / 6.56.
  - **The rules:** waiting, cancelled, under 3 tasks, the grace, a past month as it stood, removed items' weights, Step work combined, steps without Step work.
  - **Someone with no KRA:** unchanged.
  - **HR's grace change:** No delay goes to 8.75.
  - **Reports:** the head's department only, HR everyone, an employee refused, Rahul's totals, the person view.
  - **The overview flag.**
- **Regression** (the shared scorer changed): `scorecard` 113 (no-KRA numbers unchanged), `mpages` 21, `inccap` 42, `kradaily` 62, `kratasks` 43, `kra` 33, all passing.
- **The screens bundle.**
