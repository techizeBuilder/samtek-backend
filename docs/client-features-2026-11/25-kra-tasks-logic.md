# Feature 25: KRA (Key Result Areas), with task management built on it

*Client request, 23 November. The client's own words (Hindi) and a ChatGPT concept were the starting point; this is the design for Samtek's ERP as it is. Logic for discussion; nothing built yet.*

## What the client asked (in short)
1. **KRAs in HR**, kept **dynamic**: a person's KRA can be changed. Where KRAs are entered, and how departments show.
2. **No task outside a person's KRA.** Every task a company gives someone must fall under their KRA.
3. **Three kinds of task:** **routine** work, **one-time** work, **surprise** work.
4. **One-time and surprise work come in three sizes:**
   - **short:** minutes to a few hours
   - **medium:** hours to a few days
   - **long:** days to months
5. **Big work is broken into small pieces,** so it can be tracked every day and long work doesn't become boring.
6. **Each task is scored** on **time (delay)** and **accuracy**.

## What Samtek already has (and the design builds on)
- **Task Management** (every department's menu, HR, the Company Admin):
  - who can create: department heads and the top admins
  - each task: title, description, people, department, priority, status (Pending / In Progress / Hold / Completed), type (One Time / Running Work / Surprise Work), due date, file, comments, an activity log
  - core fields locked after creation
  - reports: by person, overdue, by type, productivity
  - test-1 holds 21 test tasks
- **Departments from roles** (feature 3): a person's department comes from their role, unless one is set on them. The task module still works the department out from the role name separately; it will use the same department as everywhere else.
- **Roles** are what everyone has. Designations exist, but test-1 has only 4.
- **The 100-point scorecard** (feature 13, monthly) has **work parts**: No delay 10, Productivity 12, Accuracy 12, Work quality 10, Task completion 10.
  - Today they're measured only from **Production's step work**. For everyone else they show *"not measured"*, and the score is scaled from what is measured.
  - Feature 13 already said *"when another department's work gets a source, its people get those parts with no change to the page."* **KRA tasks are that source.**

## The design

### 1. KRAs: set by HR, per role, with personal changes and history
**Where:** a new **HR → KRA** page (HR with a new "KRA" permission; the Company Admin too). It lists **departments → their roles**, and each role has a **KRA set**: 3–7 items, for example *Sales Employee*:

| KRA | What good looks like (KPI / target) | Weight |
|---|---|---|
| Lead management | Follow up every assigned lead within 2 days | 30% |
| Sales conversion | 20% of quotations become orders | 40% |
| Customer follow-up | Every follow-up on time | 20% |
| Daily reporting | Daily report by 6 pm | 10% |

- **Each item:** a name, a description, the KPI / target in words, and a **weight**. The weights add up to 100.
- **A person's KRA is their role's set by default.** Nothing has to be assigned one by one.
- **Personal changes (dynamic):** HR can change one person's KRA. For example, Rahul also gets *Customer relationship* at 20%, and *Daily reporting* drops to 5%. Their set is then their own; the role's later changes ask whether to apply them to Rahul too.
- **A temporary KRA:** an item can have an end date (for cover or a special project).
- **Every change is a new version, from a date.** Old versions are kept and never edited, so:
  - a task stays linked to the KRA it was given under
  - old months' scores never change
  - HR can see when and why a KRA changed
- **People see their own KRA** on **My tasks**. Their head and HR see it on the person.
- **The department shown is the person's** (from their role, or set on them), the same everywhere. It isn't typed on the task.

### 2. Tasks: always under one of the person's KRAs
**Who gives tasks:** department heads (to their own department's people) and HR / the Company Admin (anyone), as today.

**The task form:**
- **Person:** one person per task. Picking several people makes one task each (each person's KRA is picked for them).
- **KRA:** chosen from **that person's current KRAs** only. The server refuses a task whose KRA isn't theirs.
- **Type:**
  - **Routine:** repeats daily, weekly or monthly. The system creates each occurrence itself (point 5).
  - **One-time.**
  - **Surprise:** unplanned, so a **reason is required**. It must still be under one of the person's KRAs. If none fits, HR adds a temporary KRA first, so the rule is never broken.
- **Planned effort** (hours) and **due date.** The **size** follows from the effort:
  - **short:** up to 4 working hours
  - **medium:** up to 5 working days
  - **long:** more than that
  - HR can change the thresholds.
- **Priority** (for planning only; it doesn't change the score), a description, a file.

**Breaking big work into small pieces (the client's point 5):**
- **Long work must be split into steps** (sub-tasks) before it starts. Each step has its own due date and effort, and is **at most 2 working days**, so there's always something due soon.
- **Medium:** steps are optional. **Short:** none.
- **Progress** = the effort of the steps finished ÷ the whole effort. The head sees the line move day by day.

**What happens to a task:**

Assigned → In Progress → **Submitted** → the head's review:
- **Accepted:** with a rating (Excellent / Good / Average / Poor)
- **Sent back for rework:** Minor or Major, with a reason, then back to In Progress

Also: **Blocked** (the person says why) and **Cancelled** (with a reason).

- **A due date can only be changed by the one who gave the task,** with a reason, and it's recorded. Lateness counts from the latest due date.
- **A blocker doesn't stop the clock by itself.** If it's fair, the head moves the due date (with a reason).
- **Daily updates for medium and long work:** on each working day it's open, the person writes what they did, the % done, and any blocker. A bell reminds them, and the head sees who hasn't written.

### 3. Scoring: the KRA tasks feed the scorecard you already have
**No second score.** The 100-point scorecard stays the one score. **For each KRA, its tasks in the month give its results**, and the person's work parts are the **KRA weights × those results**:

| Scorecard part (points) | From KRA tasks |
|---|---|
| **No work delay (10)** | Tasks finished by their due date ÷ tasks finished (a grace time, e.g. 30 min for short work, 1 day for long) |
| **Accuracy (12)** | **First time right:** tasks accepted at the first review ÷ tasks reviewed. A Minor rework = half an error, a Major = a whole one, as for QC. |
| **Work quality (10)** | The review rating: Excellent 100, Good 80, Average 60, Poor 30 |
| **Task completion (10)** | Tasks finished ÷ (finished + still open past their due date at the month's end). Not yet due isn't counted against anyone. |
| **Productivity (12)** | **Not measured from tasks.** Self-reported hours are too easy to bend, and No delay already covers time. It stays "not measured" and the scorecard scales it, as it does today for Store. |

- **Inside a KRA,** a task counts by its effort, so one big task outweighs five tiny ones.
- **Across KRAs,** each counts by its weight.
- **A KRA with no tasks that month** is left out, not given zero.
- **Example (Accuracy, the month):**
  - Lead management (30%): 4 of 5 first-time right = 80%
  - Daily reporting (10%): 20 of 22 = 91%
  - Sales conversion and Customer follow-up: no tasks, left out
  - Accuracy = (30 × 80 + 10 × 91) ÷ 40 = **82.7%** → 12 × 82.7% = **9.9 of 12**
- **Routine occurrences:**
  - done on time → No delay ✓
  - not done by the end of the day → counted open past due in Task completion
  - they need no review unless the head sends one back (then rework)
- **Production's step work** becomes a built-in KRA item, **"Step work (from Process Execution)"**, measured automatically exactly as today. HR puts it in Production roles' KRA with a weight.
  - A worker with no login (Manpower) has only that item, so their score doesn't change.
  - A Production person who also gets tasks has both, weighted by HR.
- **The person's scorecard drawer gets a KRA view:** each KRA, its weight, its tasks this month and their results. Showing why the score is what it is, as now.

### 4. Where people see it
- **HR → KRA:** sets the KRAs (point 1).
- **Task Management** (the same menu items as today): the new form, the task's steps, its daily updates, and review. The head's list has filters: by person, by KRA, overdue, waiting for review, no update today.
- **My tasks** (each person): their KRA, today's work (due today, routine due, steps), updates to write, tasks to submit.
- **Employee Performance / Manpower scores:** the scorecard's work parts now filled for task people, plus the KRA view.
- **The existing task reports** move to the new statuses.

### 5. Routine work (only the duties HR switched to "Track daily"; see "Your direction")
- **A tracked routine duty is a pattern:**
  - **daily** (working days only: the weekly off and holidays are skipped, as for attendance)
  - **weekly** on a chosen day
  - **monthly** on a date
  - each with a due time
- **Each morning a job creates that day's occurrences** (only today's; nothing piles up ahead). Each occurrence is its own small task, done or not, on time or not.
- **Stopping a routine** keeps the occurrences already made.

## Your direction (23 Nov)
- **Where it shows:** HR's Employee Performance (`/hrms/SuperAdmin/manpower-score`), and Production → Manpower's scores.
  - Today, people outside Production show **"not measured"** for the 54 work points (No delay, Productivity, Accuracy, Work quality, Task completion), and their score is scaled from attendance, punctuality and conduct alone.
  - KRA tasks fill those parts.
- **Task Management is rebuilt as a new module,** with better logic, screens and performance; it isn't patched:
  - a new data model: tasks, steps, daily updates, reviews, routine patterns
  - new screens: the head's board, My tasks, the task page
  - lists paged on the server; every query indexed and bounded to open work or a period
  - the current menu items in every department open the new module
  - the old tasks stay readable as "before KRA"
- **Routine work, your solution (23 Nov): a switch on each routine duty, set by HR.** The client didn't ask for routine tasks to be created each day (that was ChatGPT); their words say the work a head **assigns** is one-time and surprise. Routine is the person's regular duty, written in their KRA. Now:
  - **HR writes routine duties on a KRA item** (the role's or one person's): *"Daily sales report"*, working days / weekly (a day) / monthly (a date), with a due time.
  - **Each duty has a switch, "Track daily in My tasks":**
    - **On:** the system creates that duty's item for each person who has it, on its schedule. It shows in **My tasks → Today's routine** to tick done (a file if needed). Nobody assigns it each day, and there's no review unless the head sends one back. **It counts:** done on time → No delay; not done by the day's end → Task completion.
    - **Off:** the duty is only written on the KRA, as part of the job description. Nothing is created and nothing is scored for it.
  - **Flipping the switch applies from the next day;** items already made stay.
  - **A KRA item holding only untracked duties,** with no assigned tasks that month, is left out of the score (not zero).

## Your decisions (23 Nov)
**A–N as recommended:**
- **A:** KRAs per role
- **B:** the KPI / target written in words
- **C:** one score; KRA tasks feed the scorecard's work parts, plus a KRA view
- **D:** Productivity is not measured from tasks
- **E:** "Step work" is a built-in KRA item
- **F:** the size comes from the planned effort
- **G:** long work is split into steps of ≤ 2 working days
- **H:** daily updates required on medium / long work, not scored
- **I:** the head moves the due date with a reason
- **J:** Excellent / Good / Average / Poor
- **K:** one task per person
- **L:** HR adds a temporary KRA item for surprise work no KRA fits
- **M:** the old tasks are read-only, "before KRA"
- **N:** four slices

**Plus your two directions:** the routine duty switch, and a new Task Management.

## Questions for you (answered above)
- **A. KRAs set per:**
  - (a) **role** (recommended: everyone has one; departments already come from roles)
  - (b) designation (only 4 exist today, so most people would have none)
- **B. KPI / target:**
  - (a) **written in words for now**, with scores from the tasks under each KRA (recommended)
  - (b) measured automatically from ERP data now (e.g. conversion from Leads). That's a big project per KPI; I'd add these one by one later, as sources.
- **C. One score or two:**
  - (a) **KRA tasks feed the existing 100-point scorecard's work parts,** plus a KRA view in it (recommended)
  - (b) a separate KRA score next to the scorecard
- **D. Productivity from tasks:**
  - (a) **not measured** (recommended: self-reported hours)
  - (b) planned effort ÷ the hours people write in their daily updates
- **E. Production's step work:**
  - (a) **a built-in KRA item measured from steps, weighted by HR in Production roles' KRA** (recommended)
  - (b) steps stay outside KRA, as today
- **F. Sizes:**
  - (a) **worked out from the planned effort** (≤ 4 h short, ≤ 5 working days medium, more = long; HR can change the limits) (recommended)
  - (b) picked by hand on the form
- **G. Splitting:**
  - (a) **long work must have steps of at most 2 working days; medium may** (recommended)
  - (b) splitting is always optional
- **H. Daily updates:**
  - (a) **required on medium and long work, with a bell, shown to the head, but not scored** (recommended: as the client's concept also says, a missed update shouldn't cut points by itself)
  - (b) also scored
- **I. Blockers:**
  - (a) **the head moves the due date with a reason** if it's fair (recommended: simple and visible)
  - (b) blocked time is paused automatically once the head approves the blocker
- **J. Review rating:**
  - (a) **Excellent / Good / Average / Poor** = 100 / 80 / 60 / 30 (recommended)
  - (b) a 1–10 score
- **K. Several people on one task:**
  - (a) **one task per person,** created together (recommended: each has their own KRA, progress and score)
  - (b) a shared task
- **L. Surprise work no KRA fits:**
  - (a) **HR adds a temporary KRA to the person first** (recommended: the rule is never broken)
  - (b) allowed with HR's approval, without a KRA
- **M. The 21 test tasks on test-1:** shown as "before KRA", read-only and not scored. The client's live site has no tasks.
- **N. Build in four slices,** each tested before the next:
  1. KRAs: HR's page, per-role sets, personal changes, versions, My KRA
  2. tasks on KRAs: the new form and the KRA check, types and sizes, steps, the lifecycle and review, due-date changes
  3. daily updates, blockers, reminders; routine occurrences
  4. scoring: the scorecard's work parts from KRA tasks, the KRA view, reports

## Slice 3 details (decided with the plan, 23 Nov)
- **Daily update due:** each working day after the day the task was given, while it's open (not started, in progress, rework).
  - Not on the day it was given, the weekly off, a company holiday, or the person's approved leave.
  - One a day; writing again the same day replaces it.
  - It holds what was done, the % (only without steps) and an optional blocker.
  - The first update starts the task.
- **Blocker:**
  - the person marks it, with a reason; a red "Blocked" chip; the giver is told (for a routine item, the department head)
  - cleared by the person, the giver or the head, with an optional note; the history is kept
  - the due date never moves by itself
- **Routine items:**
  - **The run:** one run just after midnight, India time. It marks earlier days' undone items **Missed**, then makes today's. It's recorded per company and day, so a switch flipped today applies from tomorrow, even after a restart.
  - **Weekly and monthly:**
    - monthly on the 31st falls on a short month's last day
    - a weekly or monthly date on a day off moves to the next working day
  - **Who and when:** nothing on the person's leave day (nothing carried); only people who can log in.
  - **Ticking:**
    - a file is required when the duty needs one
    - after the due time it's done late
    - it can be ticked until the day ends
  - **Send-back:** the head (or a top admin) can send a done item back within 7 days, Minor or Major. The person redoes it by the next day, or it's missed.
  - **Where they show:** kept out of the board's Open / Overdue lists; they have their own Routine tab. **Planned hours:** 0.5 each.
- **Reminders (bells):** working days only, one per person per run, none on the person's leave day.
  - **9:30:** the person (due today, overdue, routine items) and the giver (waiting for review, overdue, blocked)
  - **17:30:** the person (updates not written, routine items not done)

## Slice 4 details: scoring (proposed 23 Nov; change any before approving the plan)
**What stays the same:**
- The 100-point scorecard, its settings and Productivity (steps only, decision D).
- Attendance, punctuality, conduct and learning.
- **Anyone with no KRA scores exactly as today:** step parts only. This includes the Manpower workers with no login.

**For someone with a KRA, the four work parts (No delay, Accuracy, Work quality, Task completion):**
- **Each KRA item gets a result per part:**
  - **Step work:** today's step result.
  - **Other items:** their tasks and routine items in the period.
- **The part** = the KRA weights × those results, over the items that have a result. An item with nothing that period is left out, not zero.
- **Which weights:** the KRA in force on the period's last day. An item that has since dropped out keeps the weight from the version its tasks were given under.
- **If Step work isn't in someone's KRA,** their steps don't count (the rule: nothing outside the KRA). HR → KRA warns when a role's people did steps but the role has no Step work.

**Which tasks count in a period:**
- **Finished:**
  - a task **accepted** in the period
  - a routine item **done** whose day is in the period
- **Open past due:**
  - a task due by the period's end (or by now, for this month) that was **not submitted, or was sent back and not resubmitted**, at that moment
  - a routine item **Missed** whose day is in the period
- **Waiting for review** counts neither way: it's the reviewer's turn.
- **Cancelled** never counts.
- **The task results need at least 3 tasks** (finished or open past due, routine items included) in the period, as the steps need 3.
- **Inside an item,** each task counts by its planned hours (routine items 0.5 h).

**The part results from tasks:**
- **No delay:** finished on time ÷ finished.
  - A task is on time when it was **first submitted** by its latest due date plus a grace time: short 30 min, medium 2 h, long 1 day. HR can change these on the Task sizes card.
  - A routine item is on time when it was **first ticked** by its due time.
- **Accuracy (first time right):** 1 − the error of the first review.
  - Accepted = 0; Rework Minor = ½; Rework Major = 1.
  - A routine item: done and never sent back = 0; sent back = ½ or 1.
  - Missed items aren't judged here.
- **Work quality:** the final rating, Excellent 100 · Good 80 · Average 60 · Poor 30. Routine items have no rating, so they're left out here.
- **Task completion:** finished ÷ (finished + open past due).

**Worked example (the test checks these numbers): Rahul, November**
- **His KRA:** Lead management 50, Daily reporting 30, Step work 20. He did no steps, so Step work is left out.
- **Lead management:**
  - T1, 12 h: first submitted on time, sent back Minor, accepted Good
  - T2, 3 h: first submitted 1 h late (grace 30 min), accepted first time, Excellent
  - T3, 10 h: due in November, not submitted by its end
- **Daily reporting:** 4 routine items of 0.5 h:
  - R1 done on time
  - R2 done late
  - R3 done on time, then sent back Major and redone
  - R4 missed
- **Lead management:**
  - No delay = 12 ÷ 15 = 0.8
  - Accuracy = (12 × 0.5 + 3 × 1) ÷ 15 = 0.6
  - Quality = (12 × 80 + 3 × 100) ÷ 15 = 84
  - Completion = 15 ÷ (15 + 10) = 0.6
- **Daily reporting:**
  - No delay = 2 ÷ 3 = 0.667 (R3 counts by its first tick)
  - Accuracy = (1 + 1 + 0) ÷ 3 = 0.667
  - Quality: left out
  - Completion = 3 ÷ 4 = 0.75
- **Rahul's parts** (weights 50 and 30; default points):

  | Part | Worked out | Share | Points |
  |---|---|---|---|
  | No delay | (50 × 0.8 + 30 × 0.667) ÷ 80 | 0.75 | **7.5 of 10** |
  | Accuracy | (50 × 0.6 + 30 × 0.667) ÷ 80 | 0.625 | **7.5 of 12** |
  | Work quality | Lead management only | 0.84 | **8.4 of 10** |
  | Task completion | (50 × 0.6 + 30 × 0.75) ÷ 80 | 0.65625 | **6.56 of 10** |
  | Productivity | no steps | not measured | scaled out, as today |

**Where it shows:**
- **The scorecard window** (Employee Performance, Manpower) gets a **KRA** box with each item: its weight, its tasks this period, and its four results (or "left out"). Step work shows its step results there too.
- **The "How the score is worked out" panel** (English / Hinglish) explains the KRA part.
- **Task Management gets a Reports tab** (heads: their department; HR and top admins: everyone), for a month or dates:
  - **per person:** tasks finished, on time %, first time right %, average rating, open past due, routine done / missed, blocked now
  - **opening a person** shows their KRA box
  - **the old Reports page** (the old module) isn't on any menu; its data stays under "Before KRA"
