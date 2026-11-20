# Feature 9: Planning work on any step; Start is execution (what changed)

*Built 12 November 2026, from the client meeting the same day. Logic and your decisions: [09-plan-ahead-logic.md](09-plan-ahead-logic.md). Browser test: [09-plan-ahead-test-roadmap.md](09-plan-ahead-test-roadmap.md).*

## In one line
People can be **put on any step ahead of time,** including a later step, a step whose material hasn't arrived, or a step on another order. **Start** stays the moment work really begins, with all its checks. Hours count from Start.

## What Production sees (Process Execution)
**Add people works on any in-house step that isn't finished,** on any unit:
- **No more "Material not yet received in Production, can't allot work".**
- **No more refusal while the unit's work is at Store.** Work that QC already passed is still brought back.

**On a step that hasn't started:**
- The crew line reads ***"Planned:"*** Rahul Pramanik, …
- The **×** just removes the person from the plan, with no time question and nothing kept, because nobody worked yet.

**Planned vs working:**
- **A person can be planned on many steps,** across orders, but works on one running step at a time.
- **Adding someone to a step that hasn't started** never asks "Move them here?".
- **Adding someone to a running step** asks only if they're working on another running step.
- **The people picker** shows *"Working on ORD-… · assemble now (would be moved)"*, only when this step is running, or *"(stays there; planned here)"*, or *"Free · planned on 2 other steps"*.

**Start keeps every check, and does two new things:**
- **Its checks:** material received, previous step completed, someone on the crew, planned hours typed. **New: nothing held at Store** (the same message as before, now at Start).
- **Someone planned who's still working on another running step:** *"Rahul Pramanik is working on ORD-… · assemble. Move them here?"* with **Move them and start**. Their time on that step ends at this start, and a back-dated start (feature 7) counts too.
- **After starting,** a *"Started"* note lists anyone **moved here** and anyone **not present today,** so they can be replaced (feature 8) or taken off.

## Manpower → Today
Under each person: **Working on** (the running step) or **Free**, and ***"Planned: ORD-… · coating; ORD-… · pre painting"***.

## Hours (unchanged rule)
**Everyone on the crew counts from the step's start** (now, or the time typed), or from when they joined if later. Only time they were present counts, and lunch comes off.

Being planned since the morning adds nothing. At Start, planned people are recorded as joining at the start time.

## Fixed on the way
**The no-double-pay check** (feature 7) now looks only at time someone really worked on another step, not at time they were just planned there.

**Found in the browser test, 14 Nov: a team retired while its people are planned.**
- **What happened:** Team Two A was planned on IHT pre painting, then retired and rebuilt as Team Two with the same people. The plan still pointed at the retired team, so Start would have counted the hours, and the team score, for a team that no longer exists. The same applies when someone moves to another team between planning and starting.
- **Now, at Start:** everyone planned on the step counts under the team they're in at that moment. A cover still counts for the team it covers. If the step's own team is retired, its label becomes the crew's current team.
- **Retire is unchanged:** planned work doesn't block it.
- **Technical:** `creditCurrentTeams` in `crewService.alignCrewToStart`. Suite `planahead` is 20 (2 new checks); `teamcover` 29 and `crew` 67 re-run.

## Not changed
**The old assign-team route** (the old dialog, no longer on the screen) keeps its old checks; `slice7` and `stale-atstore` use it.

## Technical notes
**Server:**
- **`productionMfgController.js`:**
  - `checkAssignGates` → `prepareAssign`: only the auto request at Store; it refuses nothing
  - **`startProcess`:**
    - the Store check, at the top
    - `crewStartConflicts` → 409 unless `confirmMove`
    - after the save: `closeStartConflicts` and `alignCrewToStart`
    - the reply adds `moved` and `absentWarnings`
- **`crewService.js`:**
  - new `onRunningSteps`, `alignCrewToStart` (replaces `backdateCrewToStart`), `crewStartConflicts`, `closeStartConflicts`, `crewAbsentToday`
  - `addToCrew` moves only running → running
  - `describePeople` adds `plannedElsewhere`, and `working` is the running step
  - `todayBoard` adds `planned`
  - `takeOffCrew` deletes the entry on a step that hasn't started
  - `notOverlapping(…, until)`

**Screens:**
- `ProcessExecution.jsx`: Start calls the API, with the move question and the "Started" note
- `StepCrew.jsx`: "Planned:", the picker texts, and the × on a planned step
- `ManpowerTracking.jsx`: the Planned line on the Today tab

## Tests
- **New suite `planahead`: 18 of 18,** through the real handlers, on a made-up company:
  - **Planning:** a later step and two orders, with no question; Start on the later step is still refused.
  - **Adding to a not-started step:** no question, even while the person works on another step.
  - **Adding to a running step:** asked, but not when the person is only planned elsewhere.
  - **Start with a planned person still working elsewhere:** 409, then a confirmed move. At a back-dated −30, his old step ends at −30 and he's on the new one from −30.
  - **Start with someone absent:** the warning.
  - **Hours:** planned at −300, started at −120, so 2 h, not 5.
  - **A planned person taken off:** the plan is removed.
  - **The Today board and the picker:** working vs planned.
  - **Work at Store:** QC-passed work is brought back; work still in QC can be planned, but Start is refused.
- **Changed to the new rule:**
  - **`crew`, 67:** planning on two steps doesn't ask; the Today tab shows "planned".
  - **`teamcover`, 29:** the replacement's move now happens at Start; the Today tab shows covering on the planned step.
- **Regression, all passing:**
  - crew and labour: `steptimes` 28, `labour` 33, `teams` 72, `slice4-cost` 30
  - steps: `slice7` 31, `stale-atstore` 2, `dispatch-store-part2` 19, `partial-3a` 20, `partial-3c` 16
- **Screens compile:** Process Execution, the crew panel and Manpower.
