# Feature 25, slice 2 of 4: the new Task Management on KRAs (what changed)

*Built 23 November 2026. Logic and your decisions: [25-kra-tasks-logic.md](25-kra-tasks-logic.md). Slice 1 (KRAs): [25-kra-slice1-changes.md](25-kra-slice1-changes.md). Browser test: [25-kra-slice2-test-roadmap.md](25-kra-slice2-test-roadmap.md). Next: slice 3 (daily updates, blockers, reminders, routine items from tracked duties).*

## In one line
Task Management is a **new module**. **Every task sits under one of the person's KRA items**, gets a **size from its planned hours**, and **long work must be split into small steps**. The person ticks steps and submits; the giver **accepts it with a rating or sends it back as Minor / Major rework**. A due date moves **only with a reason**, and everything is kept on the task.

## Where it is
- **Every department's "Task Management"** page now opens the new board. The menu items and paths are the same.
- **Every department's "My Task"** page now opens **My tasks**, which has **My tasks** and **My KRA** buttons. My KRA came in slice 1.
- **HR → KRA** (and Company Admin → KRA) has a new **Task sizes** card at the top.

## Task Management (the board)
- **Who sees what:**
  - **HR-Admin, MIS Admin, Company Admin, Admin:** "Everyone", or "Given by me"
  - **a department head** (any "… Head", Manager, Unit Head …): "My department", or "Given by me"
- **Tabs:**
  - **Open (n):** not started, in progress, rework, and waiting for review
  - **To review (n):** submitted, waiting for the reviewer
  - **Overdue (n):** open and past due; waiting for review doesn't count as late
  - **Done:** accepted or cancelled
  - **All**
  - **Before KRA:** the old module's tasks, read-only
- **Filters:** type (One-time / Surprise / Routine), and a search on title or person.
- **Paging:** the lists are paged on the server, 20 a page.
- **Each row:** the title with type / size / priority chips, the person and their department, **the KRA**, a **progress bar** (the steps ticked), the due date (red when late), and the status.
- **+ New task** (heads and top admins only).

## New task (the form)
- **For:** search and pick one or more people.
  - **Several people means one task each, not a shared task.**
  - A head finds only their own department's people.
  - Nobody can give themselves a task.
- **Their KRA, for each person:** a dropdown of **that person's own KRA items**. The server checks it again.
  - A person with one KRA item has it picked already.
  - A person with no KRA shows *"No KRA set: ask HR to set one first"*, and the task can't be saved for them.
  - **Step work (Production) isn't offered:** it's measured from Process Execution.
- **One-time or Surprise work.** Surprise work needs *"why it came up unplanned"*.
- **Title, what needs doing, due date and time, planned hours, priority.**
- **Size (shown live):**
  - **Short:** up to 4 h
  - **Medium:** up to 5 working days (40 h)
  - **Long:** more than that
  - HR can change these limits.
- **Steps:**
  - optional for short and medium work
  - **required for long work:** at least 2, **each at most 2 working days (16 h)**, each with its own due date no later than the task's
  - with steps, the planned hours are the steps' total
- **Attach a brief** (optional: photo, PDF, Word, Excel, up to 10 MB).
- **The person gets a bell:** *"New task — …"*.

## One task (opens from any row)
- **What it shows:** status, chips, who it's for, who gave it, **the KRA**, the due date, the surprise reason, what needs doing, the brief.
- **Steps:** the person ticks them; the progress bar follows.
- **The person:**
  - **Start** (a task without steps)
  - **Submit for review**, with an optional note and file
  - **Every step must be ticked first.** The giver gets a bell, which says so if the submission came after the due date.
- **The reviewer** (the giver, the department head or a top admin; **never the person themselves**):
  - **Accept** with **Excellent / Good / Average / Poor**
  - or **Rework, Minor / Major**, with what needs reworking (required)
  - Rework goes back to the person, who submits again. Every review stays on the task, ready for slice 4's scoring.
- **The giver** (or a top admin):
  - **Edit:** title, what needs doing, priority, planned hours, steps
    - until the task is submitted
    - a kept step keeps its tick
    - long work still needs its steps
  - **Move due date:** the reason is required. *"Due moved 25 Nov → 27 Nov by …: waiting for the vendor's drawing"* stays on the task, and the person is told.
  - **Cancel task:** the reason is required.
- **Comments:** anyone who can open the task.
- **History:** every change, with who and when, and the KRA version the task was given under.

## My tasks
- **The person's own tasks:**
  - tabs **Open** (rework included), **Overdue**, **Waiting for review**, **Done**, **All**
  - the soonest due first
  - the same task window as the board
- **My KRA**, from slice 1.

## Task sizes (HR → KRA)
- **Short** ≤ __ h; **Medium** ≤ __ working days; **a step** ≤ __ working days; **a working day** = __ h.
- **Who changes it:** HR with KRA edit, or the Company Admin.
- **New sizes apply to tasks given from then on.** A task already given keeps its size.

## The rules (also on the server)
- **A task's KRA:** an item in the person's KRA **on the day it's given**. It's saved with the task (KRA name and version), so a later KRA change never rewrites old tasks.
- **Who gives tasks to whom:**
  - **the top admins** give to anyone in the company
  - **a head** gives only to their own department
  - **nobody** gives to themselves
- **Who sees a task:** the person, the giver, the person's department head, and the top admins. Anyone else gets *"not allowed"*; another company's task is *"not found"*.
- **Statuses:**
  - Not started → In progress → Waiting for review → Accepted
  - or → Rework → In progress again → Waiting for review …
  - or Cancelled
- **Due date:** only the giver or a top admin moves it, always with a reason.
- **Speed as data grows:**
  - lists are paged on the server, and the tab counts come from one database query
  - the board doesn't load a task's history and comments until it's opened
  - indexes cover the person, the giver, the department and the status by due date

## The old Task Management
- **The old pages are no longer on any menu.** Their code stays until slice 4's reports replace the old Reports page.
- **The old tasks can be read under "Before KRA"** (title, people, type, due, status). They aren't moved into the new module, because they have no KRA.

## Files
- **Server, new:**
  - `models/KraTask.js`, `models/KraTaskSettings.js`
  - `services/kraTasks/kraTaskService.js`
  - `routes/kraTasks.routes.js` (`/api/kra-tasks`; files are saved in `uploads/kra-tasks/`, and a refused request leaves no file behind)
  - `index.js` (mount)
- **Screens, new** (`components/kraTasks/`): `taskUi.jsx`, `TaskBoard.jsx` (with the shared `TaskList`), `TaskForm.jsx`, `TaskDrawer.jsx`, `MyTasks.jsx`.
- **Screens, changed:**
  - `App.jsx`: the two task pages now point at the new screens on every route
  - `pages/hrms/Kra/KraPage.jsx`: the Task sizes card

## Tested
- **The new suite `kratasks`: 43 of 43**, through the real server, on a made-up company:
  - who gives to whom
  - the KRA check: own item, another role's item, Step work, no KRA; one task each with a shared batch
  - sizes, and the rules for long work and steps
  - surprise reasons
  - the life: start, steps, submit, review, rework, accept
  - due changes, edit, cancel
  - who sees what (403 / 404)
  - tabs, counts and paging
  - the settings
  - Before KRA
- **Regression:** `kra` 33.
- **The screens bundle.**
