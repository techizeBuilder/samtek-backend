# Feature 13: The 100-point employee scorecard (what changed)

*Built 17 November 2026, from the client's scorecard draft (17 Nov meeting). Logic, worked examples and decisions A–N: [13-employee-scorecard-logic.md](13-employee-scorecard-logic.md). Browser test: [13-employee-scorecard-test-roadmap.md](13-employee-scorecard-test-roadmap.md).*

## In one line
**Feature 10's score (40% timing + 60% QC) is replaced by the client's scorecard.** Every employee gets a monthly score out of 100 from 13 parts in 5 groups, and a grade from A+ to E. Every mark comes from something recorded:
- attendance and the device's punch times
- finished production steps and their QC results
- steps left open past their plan
- **conduct notes that HR has verified**
- new skills or training passed

The Company Admin sets the points, and a change applies from a chosen month. Incentives work as before.

## The score
| Group | Part | Points | From |
|---|---|---|---|
| A. Attendance & time (28) | Attendance | 10 | Present days ÷ working days. Approved leave, holidays and weekly offs are left out (payroll's day rules); a half day = ½. |
| | Punctuality | 8 | On-time days ÷ days present, from the device's own lateness. Late up to the grace time (Attendance Policy, 10 min) counts as on time. |
| | No work delay | 10 | Steps finished not Late ÷ steps finished, each by its planned size |
| B. Work performance (44) | Accuracy | 12 | How right the work was at the first QC check. A unit rejected = one mistake; **a batch counts only the share of pieces sent back** (decision Q). A Minor reject counts half. |
| | Work quality | 10 | The QC pass rate (feature 10's accuracy) |
| | Productivity | 12 | Planned ÷ taken (feature 10's timing), full points at 100 |
| | Task completion | 10 | Finished steps ÷ (finished + steps still open past their planned hours) |
| C. Behaviour & discipline (18) | Behaviour 8, Discipline 5, Teamwork 5 | | Start full; verified conduct notes take points off |
| D. Responsibility (5) | Ownership 5 | | The same |
| E. Safety & development (5) | Safety & rules 3 | | The same |
| | Learning 2 | | Half by default; full with a new skill or a training test passed in the last 3 months |

**How a part counts:**
- **Each part** = its points × the share achieved.
- **Each step counts by its planned size × the person's share of the crew** (decision R). It never counts more for having taken longer. A redo, or a step with no planned hours, counts by the person's hours. A QC check still judges every in-house step since the previous check, and a redo is judged on its own.
- **Conduct and learning keep their own 28 points** (decision S). A part that can't be measured is filled in by the other measured parts:
  - score = (measured parts' points ÷ their maximum) × 72 + conduct + learning
  - Store has no production steps, so attendance and punctuality (18) fill the 72.
  - Fewer than 3 finished steps, or no QC result yet, leaves those parts out the same way.
  - **Nothing measured** (only conduct and learning) gives **no score**.
  - With everything measured, the score is simply the sum.
- **Grades:** A+ 90+, A 80+, B 70+, C 60+, D 50+, E below 50.
- **Minimum:** no score under 5 working days in the period ("Not enough days yet").
- **Period:** this month, last month, any month, or **any dates** (feature 10's decision E, kept: at first I removed Dates; put back the same day, decision O).
  - A date range counts only the days inside it: attendance, steps, notes.
  - It uses the points in force in the month of its last day.
  - The 6-month history stays whole months.
- **Who is scored:** everyone in the company except the Company Admin and Superadmin. Someone who left is scored only for a period they worked in.
- **No attendance record at all in the period** (decision P, 17 Nov): attendance isn't measured. The row says **"No attendance recorded"**.
  - **Why:** the device isn't connected yet, and people with a Device Code can't use Mark Attendance. On test-1, 28 of 34 people, including every Head, have no record this month. Counting them absent would have taken 10 points off everyone for nothing.
  - **With at least one record,** payroll's rules apply, so a missing working day is an absence. Device people always have records, because the device sends a row for absent days too.
  - The eligible days still count for the 5-day minimum.

## New: conduct notes
- **Who writes them:**
  - The **Production Head** (Manpower edit) writes a note about a Production person, from Manpower → Scores → **Note**.
  - **HR** (Employee Performance add) can write one about anyone.
- **What a note holds:**
  - Concern or Appreciation
  - what it's about (Behaviour, Discipline, Teamwork, Ownership, Safety & rules)
  - for a concern, how serious (Minor, Major, Serious)
  - the date it happened
  - **a written reason (required)**
  - an optional photo or PDF
- **It counts only after HR verifies it.**
  - HR is notified of every new note.
  - **Verify:** the note counts in the month of its date.
  - **Reject:** HR gives a reason, and the writer is told.
  - **Cancel** (a verified note, with a reason): it stops counting.
  - Nothing is deleted.
  - **The person who wrote a note can't verify it.**
- **A verified concern takes off** Minor 25%, Major 50% or Serious 100% of that part, never below 0. An appreciation adds nothing, because these parts start full.
- **The photo / PDF isn't public.** It opens only from inside the app, for HR, or for Production on its own people.

## New: the QC grade on production rejects
- When QC **rejects a unit's step**, or sends **part of a batch to rework / scrap**, it now picks **Minor / Major / Critical** (Major by default).
- The grade shows in the step's history, and Accuracy uses it.
- **Rejects from before 17 Nov have no grade and count as Major.** Purchase QC already had this choice; nothing changes there.

## New: Employee Performance Settings (Company Admin)
**Company Admin → Employee Performance Settings**, next to Attendance Device:
- **Points for each of the 13 parts:** whole numbers that must add up to 100. Setting a part to 0 leaves it out.
- **The three conduct-note deductions.**
- **Applies from:** this month or later. A past month is refused, so **a month's score never changes when the points change**.
- A **Client's defaults** button, and the **change history** (who, when, applies from).

**Who can do what:**
- Only the Company Admin can save.
- HR sees the points in force on the scorecard's "How it's worked out" panel.

## What each page shows
**Production → Manpower:**
- **Team cards and names:** score + grade. A team's score is its people's scores, weighted by the hours each worked for the team.
- **Scores tab:**
  - **People:** score, grade, the five group totals, days present and steps.
  - **Opening a person:**
    - all 13 parts with the counts behind them (e.g. "on time 20 of 23 days present")
    - the last 6 months
    - any step left open past its plan
    - the month's conduct notes
    - their steps (with the QC grade)
    - their incentives
  - **Buttons:** Note, and Request incentive.
  - **New cards:** Teams, and a **Conduct notes** card for Production's people (status, search, paged).
- **The "How it's worked out" panel** (English / Hinglish) is rewritten for the 13 parts, with the points in force.

**HR → Employee Performance** (renamed from Manpower Score; same address, same permission):
- The **Scores** tab for every department, with the five group totals.
- A new **Conduct notes** tab, which shows "(n waiting)" and has Verify, Reject and Cancel.
- The **Incentives** tab as before. "Score then" now shows the grade.

**Payroll:** the incentive notes now say "Employee Performance".

## Incentives
**Unchanged.** A request or a direct incentive now saves the scorecard as it stood: score, grade, month, points measured and each part.

## Technical notes
**Server:**
- **New models:**
  - `ScorecardSettings`: one document per version (company, department null for now, `effectiveFrom`, points, deductions, who)
  - `ConductNote`
- **New fields:**
  - `QCJob` step attempts and batch attempts: `severity`
  - `User.productionSkillsAdded`: `[{ skill, at, by }]`
  - `StepRun.byPerson[].team`
  - `IncentiveRequest.scoreSnapshot`: `grade`, `month`, `earned`, `possible`, `parts`
- **`services/score/scoreCalc.js`** rewritten (pure):
  - parts: `attendancePart`, `punctualityPart`, `stepParts`, `ftrError`, `conductPart`, `learningPart`
  - totals: `scorecard`, `teamScore`, `grade`
  - kept: `timingPoints`, `timingBand`, `unitAccuracy`, `batchAccuracy`, `judgingCheck`
- **`services/score/scoreService.js`** rewritten:
  - `monthCards` loads a month: payroll's `loadCompanyInputs` + `dayKinds`, the device lateness, Production's finished steps and steps open past plan (`crewService.stepHoursUntil`), verified notes, skills added, and training test passes
  - exports `scores`, `teamScores`, `scoreMaps`, `personScore` (now with 13 parts, 6-month history, notes and unfinished steps), taking `{ userQuery }` so Production sees only its departments
- **New services:**
  - `services/score/scorecardSettings.js`: `settingsFor(month)`, `saveSettings`, `settingsView`, `CLIENT_DEFAULTS`
  - `services/conductNoteService.js`
- **New routes:**
  - Production `/api/production-mfg/conduct-notes`: GET (Manpower view), POST (Manpower edit), `/:id/file`
  - HR `/api/manpower-score/conduct-notes`: GET (view), POST (add), `/:id/verify|reject|cancel` (edit), `/:id/file`
  - `/api/scorecard-settings`: GET (Company Admin, or HR with view), PUT (Company Admin)
- **Uploads:** `middleware/conductNoteUpload.js` saves to `uploads/conduct-notes/`; `index.js` blocks that folder from the public `/uploads` route.
- **QC:** `qcController` saves `severity` on a unit-step Reject and on a batch rework / scrap.
- **Skills:** `productionTeamService.setPersonSkills` logs newly added skills with when and by whom.
- **Notifications:**
  - a new note → HR-Admin
  - a decision → the writer
  - the bell opens HR's Conduct notes tab, or Manpower → Scores

**Screens:**
- `components/score/`:
  - `ScoreParts.jsx`: grades, the month picker, the new explainer
  - new `ScoreBreakdown.jsx` and `ConductNoteDialog.jsx`
  - `PersonScoreDialog.jsx`
- `components/production/ManpowerScores.jsx`, `pages/production/ManpowerTracking.jsx` and `ProcessExecution.jsx`
- `pages/hrms/ManpowerScore/ManpowerScore.tsx`
- new `pages/hrms/CompanyAdmin/EmployeePerformanceSettings.jsx`, wired into `App.jsx` and `config/moduleRoutes.js`
- new `components/qc/SeverityPicker.jsx` in `ChildPartUnitQCReview.jsx` and `SubChildPartBatchQCReview.jsx`
- `NotificationBell.jsx`
- labels in `roleModulesConfig.js`, `Layout.tsx` and Payroll

## Tests
**New suite `scorecard`: 99 of 99.** It had 83 at the build; then +11 for decisions O and P, +2 for the crew-list team fix, and the Q–S checks. It covers:
- **Decisions O and P:**
  - a date range inside last month: Ravi's attendance is 6.5 of 8 days, and its steps and notes are counted
  - a range across two months uses the last month's points; a backwards range falls back to this month; HR's page takes dates too
  - someone with no attendance record shows "No attendance recorded"
- **Decisions Q–S:**
  - a batch with 2 of 12 sent back = 1/6 of a mistake; Minor halves it
  - steps by planned size
  - a half-month Store person scores 79 B, not an A from the conduct points
  - nothing measured but conduct gives no score
- **Older shared steps:** a step shared by two teams takes each person's team from the crew list (a cover for the team covered), and a later team edit moves nothing.
- **The doc's examples:** Ravi **91.9 A+**, Amit **86.3 A** and Meena **87.0 A** (decision S; it was 84.8 when everything was scaled).
- **The maths:**
  - the grades at each boundary
  - fewer than 5 days, and fewer than 3 steps
  - Minor = half an error
  - a part never going below 0
  - notes that don't count
  - learning
  - each step weighted by hours
  - leave, holidays and half days
  - device-only punctuality
  - team weighting
  - a part set to 0
- **Through the server, last month on a made-up company:** with a holiday, approved leave, an absence, a half day, late days and one within the grace time:
  - **Ravi's whole card matches the hand-worked total**, part by part: the coating step judged by the post painting Major reject, drilling's Minor, a step left open past its ½ h plan counting against him (one within its plan and one not started don't), the verified Major discipline note, pending, rejected and cancelled notes counting nothing, and the training pass.
  - **Ravi's steps** are weighed by planned size: grinding 2, coating 1, drilling 3, fold 1, and the step left open ½.
  - **Amit**, with no QC'd steps: 50 of 50 measured → 72, + 27 = 99.
  - **Meena (Store)**: attendance and punctuality fill the 72.
  - **The viewer**, with no attendance record and no steps, gets no score.
  - **Team A** is the hours-weighted average.
- **Conduct notes:**
  - only Production people from Production, and view-only users refused
  - a reason, a severity, and no future date required
  - HR is notified, and the writer is told
  - the writer can't verify their own note; another company and view-only HR can't either
  - cancel needs a reason
  - the photo opens only through the API (not from `/uploads`)
- **Settings:**
  - HR can read them; Production can't open them
  - HR can't save
  - points adding to 99, half points and a past month are refused
  - a version from this month **leaves last month's score as it was**
  - the history shows who saved it
- **The QC grade:** a unit reject saved Minor, and a batch with no grade saved as Major.
- **Skills:** the skill log keeps when and by whom, and only for newly added skills.
- **Incentives:** the snapshot carries the scorecard.

**Updated for the new score, with `.pre-scorecard.bak` copies kept:**
- **`score`, 50:** the 40/60 numbers became the Productivity / Quality parts. Present days now follow payroll's rules, so a Sunday worked isn't counted.
- **`mpages`, 21:** the timing average is now the Productivity part.

**Regression, all passing:**
- `hrperms` 33, `incentive` 49, `crew` 67
- `teamcover` 29, `payroll` 68, `planboard` 26
- `labour` 34, `teams` 72, `qc-order` 5, `planahead` 20, `steptimes` 28

**`s2`:** its production unit and batch reject checks pass. Its 4 purchase-reject checks fail because they still expect the old purchase reject form, from before the 30 Oct reject-lines change. That code wasn't touched here.

## Added 18 Nov: a department from the role
**Why:** on test-1, only Production's workers have a department set (teams need it). Everyone else, from Store, QC and Sales to the Production Head, had none. So HR's Department filter listed only "Production", and the Department column said "–" for the rest.

**Now:** a person's department is the one set on them. If none is set, it's the company's department named after their role, from the same list as "departments from roles" (Store Employee → Store, QC Head → Quality Control, HR-Admin → Human Resources…). The older Packing / Dispatch Head and Employee roles map to "Packing and Dispatch".
- **HR → Employee Performance:**
  - The filter lists every department people are in, A to Z, with counts.
  - The filter ends with **"No department"** for roles that belong to none (Manager, Employee, Auditor, custom roles), or whose department the company doesn't have.
  - The Department column and a person's view use the same rule.
- **Conduct notes and incentive requests** save the department the same way, so their lists show it.
- **Not changed:** who Production sees on its own pages. That still goes by the department set on the person.
- **On test-1:** the Complaint people show under "No department", because the company's department is named "complaint and service", not "Complaint Management". Setting the department on those people fixes it.

**Code:** `departmentSeedService.js` (`departmentNameForRole`, `companyDepartments`, `departmentOf`); `score/scoreService.js` (rows, filter, person view); `conductNoteService.js`; `incentiveService.js`.

**Tests:** `scorecard` 108 (+9: Store from the role, a set department wins, no match → none, the filter's counts and "No department", the Store filter, the person view, the note and the incentive save it). `score` 50, `mpages` 21, `incentive` 49, `deptseed` 40 pass.

## Added 18 Nov: the Company Admin on Employee Performance
**Why:** a note HR writes needs someone else to verify it. With only one HR person (test-1, and likely the client), nobody could. A Company Admin's permissions start empty, so they didn't have the page.

**Now:**
- **The Company Admin's menu** has **Employee Performance**, the same page as HR's. On it they can verify, reject and cancel notes, write notes, and decide or give incentives. The server lets the Company Admin in by role, like the Attendance Device page. Everyone else still needs the HRMS permission.
- **The bell:** a note written by HR also goes to the Company Admin and opens their page. Notes from Production still go to HR only.
- **On HR's page:** the writer no longer sees **Verify / Reject** on their own pending note. It says "Someone else verifies" instead. The server already refused it.
- **The menu label** "Employee Performance Settings" became **"Performance Settings"**, so it fits the sidebar. The page title is unchanged.

**Code:** `routes/manpowerScore.routes.js` (`can` lets the Company Admin in); `conductNoteService.js` (HR's notes also notify the Company Admin); client `config/moduleRoutes.js`, `App.jsx` (`/hrms/CompanyAdmin/employee-performance`), `NotificationBell.jsx`, `ManpowerScore.tsx`.

**Tests:** `scorecard` 113 (+5: the Company Admin's bell, opens the page, sees the waiting notes, verifies HR's note; a Production Employee still gets 403). `mpages` 21, `incentive` 49, `hrperms` 33 (menu bundle rebuilt) pass.
- **Wording (18 Nov, after the browser check):** with the Company Admin also deciding, the page no longer says only HR decides.
  - **Status:** a pending note reads **"Waiting to verify"** on Employee Performance and in a person's view. Production's own list still says "Waiting for HR", because its notes always go to HR.
  - **Subtitle:** "Conduct notes count only once someone other than the writer verifies them."
  - **The note box on Employee Performance** says **"Save note"**, not "Send to HR", with: "It counts … only after someone else verifies it (another HR person or the Company Admin). You can't verify your own note."
  - **A direct incentive** reads **"Given directly"**, and "Requested by" shows who gave it (it used to say "Given by HR").
  - **The writer's bell** names who decided: "Rahul Pramanik verified your note…", not "HR verified…".
- **Incentive names (18 Nov):** an incentive saved the login id ("testhr") as "Asked by" / decided by, because `req.user` has no full name. It now looks the name up, as conduct notes do. Requests, approvals, rejections and direct gives say "Rahul Pramanik", and so does the HR bell ("… asks for an incentive"). The requester's bell names who decided, not just "HR". Rows saved before this keep the login id. The Amount label in the Give / Approve box now says "Amount (required)"; a request's suggested amount stays optional. `incentive` 50 (+1), `scorecard` 113.
