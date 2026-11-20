# Feature 2, stage 5: Assigning work, hours and average time (what changed)

*Built 12 November 2026. Logic and your decisions: [02e-assign-and-hours-logic.md](02e-assign-and-hours-logic.md). Browser test: [02e-assign-and-hours-test-roadmap.md](02e-assign-and-hours-test-roadmap.md), done together with stages 4 and 6.*

## In one line
A step on an order now has a **crew:** whole teams or single people, including people borrowed from another team. The system counts their real hours from attendance, takes lunch off, and learns how long each step usually takes with that many people.

## Process Execution, on each In-House step
**The Assign Team button and its picker are gone.** The step card shows a crew line instead:
- **The people on the step.** A borrowed person shows **"from Team X"**. Someone not present today shows a badge: **Absent**, **Not punched in** or **Weekly off**.
- **A cross on each person** takes them off. **Add people** puts more on. Both show only while the step is Pending or In Progress, and only to someone with edit permission on Process Execution.

**Add people** opens "Put people on *step*", with two tabs:
- **People:** search by name, Employee ID or device code. Each person shows their team, today's attendance, and whether they're **Free** or **on another step (would be moved)**. A person is greyed, with the reason, when they don't have the step's skill, aren't in a team yet, or are already on the step.
- **Whole team:** each team with its size and skills. At least one member must have the step's skill.
- **The average,** for the number of people picked:
  - "Usually 2.9 h with 2 people (2 runs)", from real runs with that many people
  - "About 1.7 h with 3 people, estimated: no runs with 3 people yet", from an even split of all runs
  - "No finished runs of this step yet"
- **Someone on another step:** "*Name* is on *order* · *step*. Move them here?" with **Move them here** and **Cancel**. Moving takes them off the other step at that moment.
- **Someone not present today** is still added. Then "Added, but check attendance" lists them. Hours only count while someone is present, so it costs nothing if they don't come in.

**Planned hours:**
- A box shows while the step is Pending. It's **empty every time,** and the average is shown beside it.
- **Start is refused** until someone is on the step (*"Put at least one person on grinding before starting it."*) and planned hours are typed (*"Type the planned hours for grinding before starting it."*).
- **While the step runs:** "So far: 0.4 h person-hours".
- **Once finished:** "Actual: 1.2 h person-hours · took 0.6 h, 0.1 h over plan".

**Completing the step:** Mark Complete, Complete Painting, the batch and unit QC submit, and the last-step dialog.
- If any lunch fell inside the step, **"Lunch during *step*"** opens first. It has one line per person per day, with their shift and its usual lunch.
- Each line is **At the usual time** (already picked), **Later** (with the real times) or **No lunch**.
- **Confirm and complete** saves the answers, then completes the step as before. Who confirmed it is saved on the step.
- **No lunch inside the step means no dialog.** Absent people aren't listed.

**A link can open a unit:** `?order=…&unit=2` opens unit 2 (the Today tab uses it).

## Manpower
- **Teams | Today** buttons at the top.
- **Today** lists every Production person, refreshed every minute:
  - their team
  - today's attendance, with the punch-in time
  - the step they're on ("ORD-… · part · unit 1 · grinding", with "(borrowed)" where it applies) and since when, or **Free**. A present person who's free is highlighted green.
  - **Open:** Process Execution at that order and unit, for every other action.
  - **Take off:** with edit permission on Process Execution.
- **Efficiency is now worked out.** A member shows "· 92%" once they've worked 3 finished steps; until then, nothing. A team's Efficiency shows "Not measured yet" until it has 3.

## HR: the Attendance Policy
- **A "Shifts and lunch" card,** and a shifts list in **Edit Policy:** name, start, end and lunch from–to, with **+ Add shift** and **Remove**.
- **Any times:**
  - up to 10 shifts
  - names must differ
  - lunch must fall inside the shift
  - a shift that ends before it starts crosses midnight (a night shift)
- **Nothing is set per person:** each day, a person's shift is the one starting nearest their punch-in. No shifts set means no lunch is taken off.
- **Only HR-Admin (and Superadmin) can save the policy,** as before.

## How hours are counted (logic §4)
- **A person's hours on a step** = the time they were on the crew, while the step was running, while they were present (punch in to punch out), minus lunch.
- **No punch-out yet today** counts up to now. **A past day with no punch-out** counts to that shift's end, or to midnight when no shifts are set.
- **Lunch answers are kept per person per day:** a "later" lunch is taken off where it really falls, even in the person's next step. The same person's lunch shows up already answered on their other steps that day.
- **When a step finishes, a run is saved:**
  - person-hours and pieces (1 for a Machine or Child Part unit, the batch size for a Sub Child Part)
  - **crew size:** person-hours ÷ the hours anyone was working, rounded
  - planned hours, and the teams and people with their hours
- **Rework** after a QC rejection is saved but kept out of averages.

## Averages and efficiency (logic §5)
- **Per part and step,** from the last 10 runs that aren't rework.
- **With N people:** runs with N people first. If there are none, an even split of all runs, marked "estimated". Nothing the very first time.
- **Efficiency** = the hours expected ÷ the hours really taken, over the last 10 runs a team or person was on. It shows from 3 runs.

## Added during the browser test (13 Nov)
- **A QC redo needs a crew too.** QC sends a reworked step straight back to In Progress, with no Start, so a redo could be submitted with nobody on it. Its hours, its labour and the redo's QC result would then count for no one.
  - **Now, before every finish** (Mark Complete, Submit to QC, complete the last step), Process Execution checks that someone worked in this round. If nobody did: *"Put at least one person on drilling first: who did the redo? Use Add people, and pick 'Working since' if they started earlier."*
  - **It's a screen check** (`askFinish` in ProcessExecution.jsx). Older test suites finish steps directly without crews, so the server doesn't refuse.
- **A batch rework keeps its quantity** (`reworks[].qty`). The rework box reads *"Reworks (1): 2 pcs · rough edges"*. Reworks saved before 13 Nov have no quantity; ORD-2026-114's was filled from its QC job.
- **The estimate on a redo is for the pieces sent back** (2), not the whole batch (12). The crew view adds `step.redo`. **The redo's saved run records those pieces too** (`recordRun`). ORD-2026-114's redo run was corrected from 12 to 2 on dev.
- **"Joining now / Working since"** moved to the top of the Add people dialog. At the bottom it was hidden below a long list.

## What stays as it was
- **Other screens still show a team on the step** (Job Cards, QC panels and others). The first team put on a step is saved as its team.
- **The old assign-team endpoint still works:** assigning a team puts the whole team on the crew, and removing it takes everyone off.
- **The material and Store checks** before anyone can be put on a step are unchanged.
- **Still team-only:** part QC jobs, and the old Sub Child Part order-level team. The old Child Part checklist completion (an old order shape) doesn't ask about lunch.
- **Labour cost** is stage 6. Stage 5 only records hours.

## Permissions
| Action | Needs |
|---|---|
| See the crew, the hours and the average | Process Execution (orders) view |
| Add people, take off, planned hours, confirm lunch | Process Execution (orders) edit |
| See the Today tab | Manpower view |
| Take off from the Today tab | Process Execution (orders) edit |
| Set shifts | HR-Admin |

## Tests
- **New suite `crew`: 67 of 67,** through the real server, on made-up companies with made-up attendance and policies.
  - **The doc's worked examples, exactly:**
    - Ravi and Amit = 15 person-hours, crew size 1
    - the averages 4.5 h, 2.9 h, 1.7 h estimated, and 3 h for a batch of 10
    - only the last 10 runs count, and rework is kept out
  - **Shifts and lunch:**
    - the shift is the nearest start to the punch-in, and a tie takes the earlier one
    - a 00:05 punch-in belongs to the night shift
    - a General worker isn't charged the Morning lunch
    - no shifts means no lunch is taken off
    - "later" moves the lunch into the next step, and "no lunch" takes nothing off
    - a missing punch-out counts to the shift end
  - **The rules,** each refusal with its message:
    - a whole team, people, or a team without the skill
    - Store, and no team
    - a borrowed person, and the absent warning
    - the move question, then a confirmed move
    - planned hours and Start
    - taking someone off
  - **A full run:** 5.5 person-hours for 10 pieces, crew 3, two teams, with lunch answers for usual, none and later. The next average from it.
  - **Also checked:**
    - the Today board
    - the old assign route filling the crew
    - another company refused
    - view-only refused
    - efficiency at 70% and 175%, and nothing under 3 runs
- **Regression, all passing:**
  - suites that assign or start steps: `slice7` 31, `stale-atstore` 2, `dispatch-store-part2` 19, `partial-3a` 20, `partial-3c` 16
  - suites that complete steps or touch the policy: `slice4-cost` 30, `teams` 72, `payroll` 68, `hrroutes` 92
- **Not re-run:** `people` and `devicesync`. Neither touches the crew or the shifts.
- **Screens compile:** Process Execution, the crew panel, Manpower and the HR policy page.
