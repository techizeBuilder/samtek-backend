# Feature 2, stage 5: Assigning work, hours and average time (logic)

*Written 12 November 2026. **All decisions made 12 Nov** (section 8): shifts and lunch were changed from the first draft at your call. Background: [02-manpower-attendance-discussion.md](02-manpower-attendance-discussion.md), teams and skills: [02d-teams-from-people-logic.md](02d-teams-from-people-logic.md).*

## 1. What the meeting asked for (from the recording, 12 Nov)
1. **Who does a step:** one or more people from a team, or the whole team.
2. **Someone absent today** can be replaced by a person from another team.
3. **Assigning is day to day.** Two teams work on different orders. One finishes its order, and Production moves it onto a step another team is still working on, to add manpower.
4. **Average time per step:** Production sees how long a step usually takes, for one person, several people, one team or several teams. If one person does a step in 4 hours, what happens with two people has to be worked out carefully.
5. **That average is reused later** for the delivery estimate.

From earlier (6 Nov): Production enters **planned hours**, the system reports **actual hours** counting only the time people were present, and hours × rate gives the cost (stage 6).

## 2. Today
| Part | Today |
|---|---|
| **A step on an order** | Holds one team (`assignedTeam`), no people, no hours. Most steps can't start until a team is set |
| **What a step covers** | Machine or Child Part: **one unit = one piece.** Sub Child Part: **the whole batch,** for example 10 pieces |
| **Step times** | Exact start and finish are saved (`startedAt`, `completedAt`). That's clock time, not time worked |
| **Attendance** | From the device: each person's in and out time per day |

## 3. How it works: the crew on a step
A step gets a **crew:** the people working on it, each with when they joined and when they left.

**Adding people:**
- **A whole team:** adds every member. The team is remembered, so the step still shows a team name everywhere it does today.
- **Individuals:** one or more people, from their own team or **from another team** (shown as "from Team B"). This is how an absent person is covered.
- **More than one team** can be on the same step, so a team that's finished can join a step another team is already on.

**Changing the crew from day to day:**
- Production can add people to a step, or take them off, at any time while the step is open.
- **A person works on one step at a time** (decision 2). Adding someone who is on another open step moves them: they leave that step at that moment, after Production confirms.
- **When the step finishes,** everyone still on it leaves at the finish time.
- **No pause button is needed:** to stop a step while waiting for material, Production takes the crew off it. No one is on it, so no hours count. When work restarts, they're added back.

**Checks when adding someone:**
- **Skills:** a person added on their own must have the step's skill (settled in stage 4). For a whole team, decision 4.
- **Absent today:** someone the device shows absent, or not punched in yet, gets a warning (decision 3).
- **The existing rules stay:** material must be received, work held at Store blocks it, and so on, as today.

## 4. Actual hours: only while present
For each person on the crew, hours count when **all three** are true:
1. they were on the crew (between joining and leaving),
2. the step was running (between start and finish), and
3. they were present (between that day's punch in and punch out),

**minus lunch,** taken off the way section 4a says.

The step's **person-hours** = everyone's hours added up.

### 4a. Lunch: shifts on the policy, worked out per day, confirmed at completion (decision 6)
Punch machines don't record lunch. A company makes the shift longer instead (8 hours of work = an 8.5-hour shift), so the punches include lunch.
- **HR sets the shifts** on the Attendance Policy page: name, start, end and lunch, as many as the company has, with its own times. Nothing is fixed in the code. No shifts set means no lunch is taken off.
- **No shift is set on a person.** Labour rotates shifts weekly or changes them in a hurry, so **each day, each person's shift is the one whose start is nearest their punch-in.** A punch-in exactly between two starts takes the earlier shift. A night shift crosses midnight, and its lunch belongs to the same working day.
- **Why not take every shift's lunch off for everyone:** the Morning lunch (for example 10:00–10:30) falls inside the General shift's working hours, and a General worker doesn't eat then.
- **Confirmed when the step is completed:** the Complete dialog lists every lunch that fell inside the step, one line per person per day, with the shift it came from. Each line is **At the usual time** (already picked), **Later** with the real times, or **No lunch**. A "later" lunch is taken off at its real time, from whichever step it falls in, so if it falls in the person's next step, that step loses the time. People who left the step early are listed for the days they worked on it. Anyone in Production with edit permission on Process Execution confirms it as part of completing, so the hours are final at once. The answers, and who gave them, are saved with the step hours.
- **No lunch inside the step:** nothing is listed.

### Worked example
Child Part X, unit 1, step **welding**. Lunch is set to 13:00–13:30.

| | Monday | Tuesday |
|---|---|---|
| Step | Started 10:00 | Finished 13:00 |
| Ravi (Team A) | On the crew from 10:00. Punched 09:00–18:00 | Punched 09:00–18:00 |
| Amit (borrowed from Team B, because Suresh was absent) | Not on it | Added 09:30. Punched 09:30–18:00 |

- **Ravi, Monday:** 10:00–18:00 = 8 h, minus lunch 0.5 h = **7.5 h**
- **Ravi, Tuesday:** 09:00–13:00 = **4 h** (lunch starts at 13:00, when the step finished)
- **Amit, Tuesday:** 09:30–13:00 = **3.5 h**
- **Step total:** 7.5 + 4 + 3.5 = **15 person-hours** for 1 piece

For comparison, clock time (start to finish) would say 27 hours, and with two names on the step it would look like 54 person-hours.

## 5. Average time per step (the careful part)
### What is averaged
**Person-hours per piece,** for one step of one part, for example "welding on Child Part X". This is the amount of work, whoever does it.
- A Machine or Child Part step: person-hours ÷ 1.
- A Sub Child Part batch step: person-hours ÷ the pieces in the batch.

Each finished step adds one **run:** its person-hours per piece, and its **crew size**.

**Crew size** is the average number of people working at once: person-hours ÷ the hours anyone was working on it. In the example, someone was working Monday 10:00–18:00 less lunch (7.5 h) and Tuesday 09:00–13:00 (4 h), 11.5 h in all. 15 ÷ 11.5 = 1.3, which rounds to a **crew of 1**. Amit only joined for part of Tuesday, so the crew didn't really double.

### From work to duration: why "4 hours ÷ 2 people = 2 hours" isn't safe
Two people rarely halve a one-person job exactly. They share a machine, wait for each other, or the job doesn't split. So:

**Recommendation (decision 5): use real runs of the same crew size first, and fall back to an even split.**
- **Runs with this crew size exist:** use their average. This is what really happens with that many people.
- **They don't:** split the overall average work evenly, and say it's an estimate.

### Worked example
Welding on Child Part X, past runs, one piece each:

| Run | Crew | Person-hours | Hours on the clock |
|---|---|---|---|
| 1 | 1 | 4.0 | 4.0 |
| 2 | 1 | 5.0 | 5.0 |
| 3 | 1 | 4.5 | 4.5 |
| 4 | 2 | 5.6 | 2.8 |
| 5 | 2 | 6.0 | 3.0 |

- **Overall work:** (4.0 + 5.0 + 4.5 + 5.6 + 6.0) ÷ 5 = **5.02 person-hours per piece**
- **Production plans 1 person:** runs 1–3 average **4.5 h**, "from 3 runs with 1 person"
- **Production plans 2 people:** runs 4–5 average 5.8 person-hours, so **2.9 h**, "from 2 runs with 2 people". An even split of runs 1–3 would have said 2.25 h, which is too low.
- **Production plans 3 people:** no runs, so 5.02 ÷ 3 = **1.7 h**, "estimated: no runs with 3 people yet". Once those 3 finish, say in 2.0 h (6 person-hours), that's saved as a 3-person run, and the next time 3 people are picked it shows **2.0 h (1 run)**. Because the estimate uses every run, including the 2-person ones that took more total work, it already leans a little slower than a perfect split.
- **It's the number of people that counts, not teams:** a team of 3 plus a team of 2 is 5 people, and teams differ in size.
- **A Sub Child Part batch of 10,** 2 people, runs at 0.6 person-hours per piece with crew 2: 0.6 × 10 ÷ 2 = **3 h**

**Which runs count:** the last 10 finished runs of that step for that part, so old habits fade out. Rework after a QC rejection is kept separate, never averaged in, so it doesn't make the step look slower.

### Where Production sees it
- **When assigning, and on the step:** "Usually 4.5 h with 1 person (3 runs). With 2 people: 2.9 h (2 runs)."
- **Planned hours:** the average is **shown** beside the box, but the box starts empty. **Production types the planned hours every time,** and a step can't start without them (decision 7). At the end, plan and actual are compared ("0.5 h over plan").
- **Later, the delivery estimate** adds these up per step (stage 7 or later).

### Efficiency (decided in stage 4: worked out, not typed)
- **A team's efficiency** = the average hours expected for its runs ÷ the hours it really took, over its last 10 finished steps.
- **A person's,** the same over the steps they worked on.
- **Example:** a team's last runs were expected to take 20 h and took 25 h, so **80%**.
- **It shows only once there are 3 or more runs;** until then, "Not measured yet".

## 6. What Production sees
**Process Execution, on a step:**
- **"Assign"** opens a panel with three things:
  - **Whole team,** or **people:** search, each person with their team, today's attendance (Present / Absent / Not punched in) and their skills. People without the step's skill are greyed.
  - **The average,** shown for the number of people picked.
  - **Planned hours,** typed by Production.
- **The step shows its crew** (names, "from Team B" where borrowed), planned hours and, once finished, the actual person-hours against the plan.
- **"Add people" and "Take off"** while the step is open.
- **"Complete"** shows the lunch list from section 4a to confirm.

**Manpower:**
- Each team's efficiency.
- **A "Today" tab:** every Production person with their team, today's attendance, the step they're on (order, part, unit, step, since when), or **Free**. Each row has **Open**, which goes to Process Execution at that order and unit for every other action, and **Take off**.

**Attendance Policy (HR):** the shifts list (name, start, end, lunch).

## 7. Not in this stage
- **Labour cost** (hours × rate into the price) is stage 6. Stage 5 only records hours.
- **The delivery estimate** comes later. It will use section 5's averages.
- **Part QC checks** and the old Sub Child Part order-level team keep team-only assigning for now.

## 8. Your decisions (12 Nov)
| # | Question | Decided |
|---|---|---|
| 1 | **"Assigning is daily"** | **The crew stays on the step until Production changes it or the step finishes.** A **"Today" tab on Manpower** shows who's where; each row has **Open** (Process Execution at that order and unit) and **Take off** |
| 2 | **Someone on two steps at once** | **One step at a time.** Adding them to a new step moves them off the old one, after a confirm |
| 3 | **Absent today** | **Warning, not blocked** |
| 4 | **Whole team and skills** | **At least one member has the step's skill.** A person added on their own must have it |
| 5 | **Average with more people** | **By number of people:** real runs with that number first, an even split of all runs as the "estimated" fallback, nothing the very first time. Each finished step is saved as a run under its number of people |
| 6 | **Lunch** | **HR sets the shifts** (any times) on the Attendance Policy. **Each person's shift is worked out per day** from their punch-in, with nothing set per person. **Lunch is confirmed when the step is completed:** usual time, later (with times) or none |
| 7 | **Planned hours** | **The average is shown; Production types planned hours every time; required to start the step** |
| — | **Who confirms lunch** | **Anyone in Production with edit permission on Process Execution,** as part of completing the step |

## 9. How I'd test it
**A new suite, `crew`, on made-up companies,** with made-up attendance rows:
- **Section 4's example,** to the quarter hour: 15 person-hours. Also the lunch overlap, a person moved mid-step, a step with the crew taken off (paused), and someone absent who adds no hours.
- **Section 5's examples:** 4.5 h, 2.9 h, 1.7 h estimated, and the batch of 10 at 3 h. Crew size 1.3 rounds to 1. Only the last 10 runs count, and rework is kept out.
- **Shifts and lunch:**
  - the shift is picked by punch-in: nearest start, a tie takes the earlier one, the night shift crosses midnight
  - no shifts set means no lunch is taken off
  - a General worker isn't charged the Morning lunch
  - the Complete dialog's list, with "later" moving the lunch into the next step and "no lunch" taking nothing off
- **The rules:** one step at a time (moving), skills for individuals and for teams, absent warnings, borrowing across teams, two teams on one step, planned hours required to start, another company's people refused, and permissions.
- **Old screens** still show a team name on the step.

**Regression:** the production suites that assign, start and complete steps.
