# Feature 13: Employee scorecard, 100 points (logic, for discussion)

*Written 17 November 2026, from the client's scorecard draft given at the 17 Nov meeting. The meeting ended before the details, and the client said we may adjust the draft. **Changes the score from feature 10** ([10-performance-score-logic.md](10-performance-score-logic.md)). Incentives stay as they are for now (section 11). **Decided 17 Nov: A–N all as recommended** (section 12; N, your settings suggestion, in section 14); **O–P** after checking the earlier features (section 15); **Q–S** in the browser test (section 16). **Built 17 Nov:** [13-employee-scorecard-changes.md](13-employee-scorecard-changes.md).*

## 1. What the client gave us
A 100-point scorecard per employee, per month. **The rule above all: every mark must come from something recorded**, so a manager can't give marks by liking or disliking someone.

| Group | Parameter | Points | The client's measure |
|---|---|---|---|
| **A. Attendance & time** (28) | Attendance | 10 | Present days ÷ eligible working days |
| | Punctuality | 8 | On-time punches ÷ working days |
| | No work delay | 10 | Tasks finished on time ÷ tasks |
| **B. Work performance** (44) | Accuracy | 12 | Error-free tasks ÷ tasks |
| | Work quality | 10 | QC pass % |
| | Productivity | 12 | Actual output ÷ target |
| | Task completion | 10 | Completed tasks ÷ assigned tasks |
| **C. Behaviour & discipline** (18) | Behaviour | 8 | Recorded assessment |
| | Discipline | 5 | Verified rule violations |
| | Teamwork | 5 | Feedback with evidence |
| **D. Responsibility** (5) | Ownership | 5 | Ownership taken and closed |
| **E. Safety & development** (5) | Safety & rules | 3 | Verified compliance |
| | Learning & improvement | 2 | Training and skill improvement |

**Each parameter:** points × the share achieved. The client's example is 45 of 50 tasks on time, so 10 × 45 ÷ 50 = **9 of 10**.

**The client's fair-play notes:**
1. Approved leave is not absence.
2. A delay caused by the company doesn't count against the worker.
3. Small and big mistakes weigh differently.
4. A behaviour mark needs written feedback or a verified incident.
5. Each department has its own productivity target.

**Grades:** **A+** 90–100 Outstanding · **A** 80–89 Excellent · **B** 70–79 Good · **C** 60–69 Average · **D** 50–59 Needs improvement · **E** below 50 Poor.

**Features the draft lists:**
- a monthly score per employee
- department ranking
- manager evaluation
- attendance worked out automatically
- delay tracking
- error and rejection tracking
- history
- an improvement plan (PIP)
- monthly and quarterly reports
- HR approval and a history of score corrections

## 2. What we have today (feature 10)
- **Score = 40% timing + 60% accuracy,** from finished production steps only.
  - Timing = planned hours ÷ the hours the step took (capped at 110).
  - Accuracy = the QC pass rate.
- **So only Production people get a score.** HR's Manpower Score page is built for every department, but no other department's work is scored yet.
- **Attendance, punctuality and conduct aren't in it at all.**

**What the system already records** that the scorecard can use:

| Data | Where it comes from | Feeds |
|---|---|---|
| Each day: present, half day, absent, weekly off | The device (stage 2) or HR's correction | Attendance |
| Lateness in seconds each day | The device's own "late" figure | Punctuality |
| Grace time (10 min by default) | Attendance Policy | Punctuality |
| Approved leave, holidays (paid or unpaid), joining date | Leave, Holidays, People (stage 3 payroll uses the same) | Attendance |
| Each finished step: planned hours, hours it took, who worked and for how long | Step runs (stage 5, feature 7) | No delay, productivity |
| QC result per unit or batch | QC | Accuracy, quality |
| Minor / Major / Critical on a reject | **Purchase QC only.** *Corrected 17 Nov while planning:* production step rejects had no grade, so the build adds the choice to the production QC reject screens | Accuracy |
| Steps still open, with hours so far | Production orders | Task completion |
| Covers for absent team members | Feature 8 | Teamwork (supporting evidence) |
| Skills per person | Stage 4 | Learning |
| Training modules passed | The training (LMS) module | Learning |

**Not recorded anywhere today:** behaviour, discipline, teamwork, ownership and safety incidents. These need a new record (section 5).

## 3. How I'd measure each parameter
Each **step counts by the person's hours on it**, as in feature 10. So a crew of two at 3 h and 1 h shares a step ¾ and ¼.

| Parameter (points) | Measured as | Status |
|---|---|---|
| **Attendance (10)** | Present days ÷ eligible days. Eligible = working days after joining, less **approved leave** (paid or unpaid) and holidays. A half day = 0.5 present. | **From existing data.** Same day rules as payroll. |
| **Punctuality (8)** | On-time days ÷ days present. On time = late no more than the grace time. | **From existing data** (device lateness). *Adjusted:* the client divides by working days; I divide by days **present**, so an absence isn't punished twice. |
| **No work delay (10)** | Steps finished **not Late** ÷ steps finished. Late = more than 10% over plan, as today. | **From existing data.** |
| **Productivity (12)** | Planned hours ÷ hours taken, per step capped at 110, averaged, then the points capped at 12. This is today's **timing**. | **From existing data.** The planned hours of each step are the department's target, which meets the client's note 5. |
| **Accuracy (12)** | **First-time right:** steps whose QC passed on the first check ÷ steps judged by QC. A **Minor** reject counts as half an error, a **Major or Critical** as a whole one. A reject QC didn't grade (every production reject before 17 Nov) counts as Major. | **Existing data + the new grade on production rejects.** *Adjusted:* gives the client's note 3 a home. |
| **Work quality (10)** | QC pass rate: unit pass = 100, reject = 0, batch = pieces passed ÷ checked. This is today's **accuracy**. | **From existing data.** |
| **Task completion (10)** | Steps finished ÷ (steps finished + steps **still open at the period's end and already past their planned hours**). A step not started, or still within its plan, isn't counted against anyone. | **From existing data.** *Adjusted:* we have no due date per task, so "assigned" means a step someone is on. This catches work that drags on unfinished, which no measure sees today. |
| **Behaviour (8), Discipline (5), Teamwork (5), Ownership (5), Safety (3)** | **Start full.** Each **verified conduct note** takes off points (section 5). | **New record.** |
| **Learning (2)** | **1** by default. **2** with evidence in the last 3 months: a new skill added to the person, or a training module passed. | **From existing data.** |

**Which QC check judges a step** stays as in feature 10:
- A check judges every in-house step since the previous check.
- The first result counts for all of them.
- A redo is judged by its own result, only for the people who did it.
- A check on a vendor's step judges the vendor.
- Steps with no check after them don't count for accuracy or quality.

## 4. The client's fair-play notes, one by one
1. **Approved leave isn't absence:** it's taken out of the eligible days. A paid or unpaid holiday and a weekly off are too.
2. **A company delay doesn't count against the worker:**
   - "Hours taken" counts only the time someone was working on the step, so waiting for material, QC or a vendor before a step starts is never counted.
   - Task completion ignores steps not started.
   - **One gap:** a step that's started and then stops mid-way for material still counts as taken time. Production can take the crew off the step (feature 7), and the clock stops for them.
3. **Small and big mistakes differ:** Minor = half an error in Accuracy.
4. **Behaviour needs evidence:** a conduct note must have a written reason, and **counts only once HR verifies it** (section 5).
5. **Each department has its own target:** for Production, the target is each step's planned hours, set per BOM step. Other departments get one once their work is scored (section 6).

## 5. Conduct notes (the 26 points for Behaviour, Discipline, Teamwork, Ownership and Safety)
**These five start at full marks.** Marks come off only through a **verified conduct note.** A manager can't give a low mark directly, which is the client's main rule.

1. **A department head records a note** about a person:
   - **type:** Behaviour, Discipline, Teamwork, Ownership or Safety
   - **severity:** Minor, Major or Serious
   - **date**
   - **written reason** (required)
   - an optional photo or document
2. **HR verifies or rejects it** (with a reason). Until it's verified, it **doesn't count.**
3. **A verified note takes off a share of that parameter's points, in the month of its date:**
   - **Minor:** 25%
   - **Major:** 50%
   - **Serious:** 100%
   - A parameter can't go below 0.

   Example: one Minor Discipline note = 5 × 25% = **−1.25**.
4. **Good notes** ("appreciation") can be recorded too.
   - They show in the person's history and help an incentive request.
   - They **don't add points,** because the five already start full.
5. **Nothing is ever deleted.** HR can cancel a verified note with a reason, and the history shows who did what and when. This is the draft's "score correction history".

Workers don't log in, so they don't see notes. HR and the head who wrote a note do.

## 6. People with no step work (Store, Accounts, Sales, …)
Today only Production's step work feeds Group B (44 points), and No work delay comes from steps too.
- **For anyone else, those parts are "not measured".** Their score is worked out from what is measured, and scaled to 100.
  - Example: 39 earned of the 46 measurable = **84.8**.
- The page says which parts were measured, e.g. *"Work performance not measured for Store yet"*.
- **When another department's work gets a source** (a target and a way to count output), its people get those parts with no change to the page. Feature 10 already allows for this ("each department's work is a source").

**Minimums:**
- The work parts need **at least 3 measured steps** in the month, as today; with fewer, they're "not measured".
- The whole score needs **at least 5 eligible days**, otherwise *"Not enough days yet"*, e.g. someone who joined on the 28th.

## 7. Teams (Production → Manpower)
**A team's score is the hours-weighted average of its members' total scores** for the period. Someone covering for the team (feature 8) counts for it, as today.

## 8. Grades
The client's six grades **replace** today's four bands everywhere:

| Grade | Score | Meaning |
|---|---|---|
| A+ | 90–100 | Outstanding |
| A | 80–89 | Excellent |
| B | 70–79 | Good |
| C | 60–69 | Average |
| D | 50–59 | Needs improvement |
| E | below 50 | Poor |

## 9. Where it shows
- **HR → Manpower Score**, renamed **"Employee Performance"** and staying in HR, not a new module:
  - Every employee with a score: the total, grade, and the five group totals. Clicking someone shows all 13 parameters with the counts behind each one, e.g. "Punctuality 6.96 of 8: on time 20 of 23 days present".
  - **Department ranking:** a Department filter (already there) and sorting by score.
  - **History:** the person's score for each of the last 6 months.
  - **Conduct notes:** a new tab to verify, reject or cancel.
  - **Paged and searched on the server.**
- **Production → Manpower:**
  - Team cards and the Scores tab show the new score and grade.
  - The Production Head can **record conduct notes** for Production people.
- **The "How it's worked out" panel** (English / Hinglish) is rewritten for the 13 parameters.

**Later, not in this round:**
- improvement plans (PIP)
- quarterly reports
- freezing a month's score once closed
- linking incentives to grades (section 11)

## 10. Worked examples (November 2026)
November has 30 days; the Sundays are 1, 8, 15, 22 and 29, so there are **25 working days.** No holidays.

### Ravi, Production
| Parameter | Behind it | Points |
|---|---|---|
| Attendance | 1 day approved leave → 24 eligible; present 22 + one half day = 22.5 | 10 × 22.5 ÷ 24 = **9.375** |
| Punctuality | 23 days present, 3 late beyond grace → 20 on time | 8 × 20 ÷ 23 = **6.957** |
| No work delay | 20 steps finished (equal hours), 3 Late | 10 × 17 ÷ 20 = **8.5** |
| Productivity | Timing points averaged over the 20 steps = 96 | 12 × 0.96 = **11.52** |
| Accuracy | 12 steps judged by QC: 10 first-time pass, 1 Minor reject, 1 Major reject → 1.5 errors | 12 × 10.5 ÷ 12 = **10.5** |
| Work quality | QC pass rate over those 12 = 92 | 10 × 0.92 = **9.2** |
| Task completion | 20 finished, 2 open past their plan | 10 × 20 ÷ 22 = **9.091** |
| Behaviour | No notes | **8** |
| Discipline | 1 verified Minor note | 5 − 1.25 = **3.75** |
| Teamwork, Ownership, Safety | No notes | **5 + 5 + 3** |
| Learning | New skill "welding" added on 12 Nov | **2** |
| **Total** | | **91.9 → A+** |

Sum: 9.375 + 6.957 + 8.5 + 11.52 + 10.5 + 9.2 + 9.091 + 8 + 3.75 + 5 + 5 + 3 + 2 = **91.893**

### Amit, Production, who rushes
Same attendance as Ravi, but on QC:
- Every step is early, so Productivity = 12 and No delay = 10.
- Half his QC-judged steps are Major rejects, so Accuracy = 6 and Quality = 5.
- Task completion = 10.
- No notes; Learning = 1.

**Total:** 9.375 + 6.957 + 10 + 12 + 6 + 5 + 10 + 26 + 1 = **86.3 → A.** That's below Ravi's 91.9, as the client wants.

### Meena, Store
**Measurable: 46 points** (Attendance 10, Punctuality 8, the five conduct parameters 26, Learning 2).

| Parameter | Behind it | Points |
|---|---|---|
| Attendance | 24 of 24 eligible days present | **10** |
| Punctuality | 24 days present, 6 late → 18 on time | 8 × 18 ÷ 24 = **6** |
| Behaviour | 1 verified Major note | 8 − 4 = **4** |
| Discipline, Teamwork, Ownership, Safety | No notes | **5 + 5 + 5 + 3** |
| Learning | Nothing new in 3 months | **1** |
| **Earned** | | **39 of 46** |

**Score:** 39 ÷ 46 × 100 = **84.8 → A**, marked *"Work performance not measured for Store yet"*.

## 11. Incentives
These **stay as built** in feature 10:
- Production asks, HR approves or rejects, or gives one directly, and an approved incentive goes into that month's payroll.
- The request saves the **new** score and grade at the time of asking.

Linking incentives to grades (e.g. A+ gets a set amount) waits for the client's details.

## 12. Questions (decided 17 Nov: all as recommended)
| # | Question | Decided |
|---|---|---|
| A | The client's points per parameter | **Keep exactly as given** (28 / 44 / 18 / 5 / 5) |
| B | Accuracy vs Work quality (both look like QC) | **Accuracy = first-time right, Minor = half an error; Quality = pass rate** |
| C | Productivity | **Planned ÷ taken (today's timing).** The other option is planned hours earned ÷ hours present, but that blames the worker when there's no work to give, against note 2 |
| D | Task completion | **Finished ÷ (finished + open past their plan)**; not-started work never counts against anyone |
| E | Punctuality's divisor | **Days present,** not working days, so an absence isn't punished twice |
| F | Conduct (26 points) | **Start full; verified notes take off 25 / 50 / 100%;** a head records, HR verifies; appreciation notes add no points |
| G | Learning | **1 by default, 2** with a new skill or a training module passed in the last 3 months |
| H | People whose work isn't measured yet | **Scale what's measured to 100,** and say which parts were left out |
| I | A team's score | **The hours-weighted average** of its members' total scores |
| J | Grades | **The client's A+ to E replace** today's four bands |
| K | The HR page | **Rename to "Employee Performance",** keep it in HR; add month history and the conduct notes tab |
| L | Minimums | **Work parts from 3 steps; the score from 5 eligible days** |
| M | Later | **PIP, quarterly reports, freezing a month, incentives by grade:** after the client's details |

## 13. How I'd test it
**A new suite with made-up data, totals worked by hand:**
- **The examples:** Ravi 91.9 (A+), Amit 86.3 (A), Meena 84.8 (A, work not measured).
- **Each parameter on its own:**
  - leave and holidays out of eligible days
  - grace time
  - Minor as half an error
  - open-past-plan steps
  - not-started steps ignored
  - a note not counting until verified, then counting, then cancelled
  - a parameter not going below 0
  - the learning evidence
- **The edges:** grades at their boundaries; under 3 steps; under 5 days; a cover counting for the team.
- **Permissions:**
  - a head records notes only for their department
  - only HR verifies
  - another company sees nothing

**Regression:** `score`, `incentive`, `mpages`, `crew`, `teamcover`, `payroll` and `hrperms`.

## 14. Settings for the scorecard (your suggestion, 17 Nov)
**The idea:** a settings card like the Vendor and Purchaser score ones on Company Admin → Purchase Approvals → Settings.

**My view: keep it.** The weights are the client's draft, which they may change once they see real scores, and other departments will come later.

**Who sets it: the Company Admin, not HR.**
- The score feeds incentives and HR's decisions about people. The one who decides on people shouldn't also set the rules that score them.
- It matches the purchase score settings, which are Company Admin's too.
- **HR sees the settings in force,** read-only, in the "How it's worked out" panel.

**Where:** a new Company Admin page, **"Employee Performance Settings"**, next to Attendance Device.

**What can be set:**
1. **Points for each of the 13 parameters:**
   - whole numbers that add up to 100
   - setting one to 0 drops it
   - a **"Client's defaults"** button puts back 10 / 8 / 10 / 12 / 10 / 12 / 10 / 8 / 5 / 5 / 5 / 3 / 2
2. **How much a verified conduct note takes off:** Minor 25%, Major 50%, Serious 100% by default.

**Fixed, not settable:**
- the grade cut-offs (A+ to E, as the client gave them)
- On time = within 10% of the plan
- Minor = half an error in Accuracy
- the minimums (3 steps, 5 days)
- the grace time, which is set in Attendance Policy already

Fewer knobs means fewer ways for the score to stop meaning the same thing month to month.

**A change applies from a month the admin picks,** not to the past:
- Each save is kept as a version: the month it applies from, who changed it, and when.
- **A month's score always uses the version in force for that month,** so October's scores don't move when November's weights change.
- An incentive request already saves the score as it was when asked.
- The page lists past versions: the change history.

**One set for the whole company for now.** It's stored so a department can get its own set later, once its work is scored. No screen for that yet.

| # | Question | Decided 17 Nov (as recommended) |
|---|---|---|
| N | Settings for the scorecard | **Yes, a Company Admin page:** points per parameter (adding to 100) and the conduct-note deductions; applies from a chosen month, with versions kept; HR sees it read-only; one company-wide set for now |

## 15. Found in the check against the earlier features (17 Nov, after the build)
You asked me to read the whole client-features folder against the build. Two things were wrong, and both were fixed the same day:

| # | Found | Decided 17 Nov (as recommended) |
|---|---|---|
| O | **I had removed the "Dates" period.** Feature 10's decision E ("this month by default, or any dates") still stands. | **Put back.** A range counts only its own days (attendance, steps, notes). It uses the points in force in the month of its last day. History stays whole months. |
| P | **No attendance record counted as absent every day.** On test-1, 28 of 34 people (all 10 Heads) have no record this month: the device isn't connected yet, Device Code holders can't use Mark Attendance, and Heads don't use it. | **Not measured** when there's no record at all in the period. The row says "No attendance recorded", so HR notices. With at least one record, payroll's rules apply. |

## 16. Found in the browser test (17 Nov): fragile rules, fixed at your go-ahead
Rahul's scorecard on test-1 showed **Accuracy 0 of 12**, though about 80–85% of his pieces passed QC. You asked me to fix that and to check the whole score for logic like it. Three changes, all decided 17 Nov as recommended:

| # | Found | Decided |
|---|---|---|
| Q | **A batch with any piece sent back counted as one whole mistake** (10 of 12 passed = as bad as all 12 failing). | **A batch counts the share of pieces sent back,** by the grade: 2 of 12 sent back (Major) = 1/6 of a mistake; a Minor reject halves it. Units are unchanged: pass = right, reject = a mistake. |
| R | **Steps counted by the hours they took,** so a slow step weighed more for being slow, and a quick one hardly counted. Rahul had 3 steps early and 1 late, yet No work delay was 3.77 of 10. | **Each step counts by its planned size × the person's share of the crew's hours.** A redo, or a step with no planned hours, counts by the person's own hours. The hours worked still decide which team gets the work and show in the "Their hours" column. |
| S | **The conduct points (start full) and learning were scaled up with everything else.** So someone with little measured scored high on those alone: 3 days present and no steps gave 82 A; nothing at all gave 96 A+; half the month present (Store) gave about 87 A. | **Conduct and learning keep their own 28 points. Only the measured parts are scaled, to fill the other 72.** With nothing measured, there's no score. Someone with everything measured gets exactly the plain sum, as before. |

**What it changes in the examples (section 10):**
- **Ravi and Amit don't change:** every part is measured, and their steps were equal in size.
- **Meena (Store):** 16 of 18 measured → 16 ÷ 18 × 72 = 64, + 23 fixed (conduct 22, learning 1) = **87.0, A** (was 84.8).
- **Someone present half the month at Store** (punctual, no notes): 13 of 18 → 52, + 27 = **79, B** (was about 87, A).

**On test-1 (November):**
- **Rahul Pramanik:** 69.6 C → **83.7 A** (accuracy 0 → 9.76, no delay 3.77 → 6.26, productivity 8.15 → 10.17).
- **test production employee:** 82 A → **69.9 C**.
- **Test Worker Four:** 80 A → **66.3 C**.

**Also fixed in the browser test:** an older step shared by two teams didn't record each person's team, so it fell back to the person's current team. Adding Rahul to a new team today moved his 13 Nov hours onto it. Such steps now take the team from the step's crew list as it was then (a cover: the team covered).

**Checked and kept as they are:**
- attendance and leave rules, punctuality and the grace time
- the 5-day and 3-step minimums
- conduct deductions (never below 0), learning
- redo judging, team weights, settings versions, dates
- one QC check judging every in-house step since the previous one (decision C)
