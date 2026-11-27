# Feature 25, slice 3 of 4: daily updates, blockers, reminders, routine items (what changed)

*Built 23 November 2026. Logic and your decisions: [25-kra-tasks-logic.md](25-kra-tasks-logic.md) (its new "Slice 3 details" section). Slice 2: [25-kra-slice2-changes.md](25-kra-slice2-changes.md). Browser test: [25-kra-slice3-test-roadmap.md](25-kra-slice3-test-roadmap.md). Next: slice 4, scoring into the scorecard, the KRA view and reports.*

## In one line
- **Routine duties** HR marks "Track daily in My tasks" now become small items in each person's **My tasks → Today**: ticked done, late after their time, **Missed** if not done by the day's end.
- **Medium and long work gets a short daily update.**
- **Anyone can say they're blocked.**
- **Bells remind people** in the morning and the evening.

## My tasks → Today (the new first tab)
- **"You're on leave today" or "Today is a day off"** when it applies: nothing is due.
- **Routine today:**
  - each item shows the duty, its KRA, *by 18:00*, and Not yet / Done / Done late / Sent back
  - **Mark done**, with a file picker when the duty needs a file
- **Updates to write:** each medium or long task with no update today, with the box right there:
  - *What I did today*
  - *% done* (only for a task without steps; with steps, the ticks give the progress)
  - *Anything blocking you?*
  - **Save today's update.** Writing again the same day replaces it.
- **Due today and overdue**, **Sent back for rework**, **Blocked:** each opens the task.
- **The other tabs show counts:** Open, Overdue, Waiting for review, Blocked, Done, All.

## Task Management (the board)
- **New tabs:**
  - **No update today (n):** open medium / long work given before today with no update today. Not counted on a day off, or for someone on leave.
  - **Blocked (n)**
  - **Routine** (My department / Everyone): a day picker (today by default). One row per item: the person, the duty, its KRA, due by, and Not yet / Done / Done late / Sent back / Missed.
- **Routine items stay out of Open, Overdue and Done,** so the board isn't flooded every day. Picking the type "Routine" shows them anywhere.
- **New chips on rows:** **Blocked** (hover for the reason) and **Update due today**.

## One task (the window)
- **Daily updates** (medium / long): the person's box when it's due, and the list, newest first.
- **I'm blocked** (the person, with a reason). The red box shows since when and why. **Clear** is for the person, the giver or the head, with an optional note. Every blocker stays in the history with who cleared it.
- **A routine item:**
  - shows its day, due time and whether it needs a file, plus when it was done (late?), Missed, or *redo by …*
  - **Mark done** (the person)
  - **Send back** (the head or a top admin, Minor / Major with a note, within 7 days of being done). The person redoes it by the next day, or it's missed.
  - it has no Start, Submit, Move due date, Edit or Cancel

## The rules (also on the server)
- **Routine items:**
  - **Every night at 00:10 (India time):**
    1. Yesterday's and earlier items still not done become **Missed**. A sent-back item becomes Missed once its redo day has passed.
    2. Today's items are made from each person's KRA in force today, for duties with **Track daily** on:
       - **working days:** every day except the weekly off and company holidays
       - **weekly:** on its day
       - **monthly:** on its date; the 31st falls on a short month's last day
       - **a weekly or monthly date on a day off** moves to the next working day
       - **on the person's approved leave day:** nothing, and nothing is carried forward
       - **only for people who can log in;** never for a duty under Step work
  - **The night run is recorded,** so a restart later that day doesn't run it again: **a duty switched on today starts tomorrow.** A re-run can never make a duplicate (one item per person, duty and day).
  - **Each item:** 0.5 planned hours (the weight slice 4 will use), due at the duty's time, made by "Routine (from KRA)".
- **Daily updates** are due on each **working day after the day the task was given**, while the task is open. They are **not scored** (decision H).
- **A blocker never moves the due date.** If the blocker is fair, the giver moves the date with a reason (decision I).
- **Reminders (bells)** go out on working days only, at most one bell per person each time, and none to someone on leave:
  - **9:30, the person:** *"Today: 1 due today, 2 overdue, 3 routine items."*
  - **9:30, the giver:** *"Tasks you gave — Waiting for your review: 2 · Overdue: 1 · Blocked: 1."*
  - **17:30, the person:** *"Write today's update on: "…", "…" and 2 more. 1 routine item not done yet."*
  - **Other bells, when they happen:** blocked (to the giver, or the head for routine items), unblocked (to the person), sent back (to the person).
- **Speed:**
  - the night run reads everyone's KRA in 2 queries and inserts all items at once
  - reminders are a few grouped queries over open work
  - Today is 2 queries
  - new indexes cover routine items by day

## Files
- **Server, new:**
  - `services/kraTasks/kraCalendar.js`: working days, holidays and leave, as payroll counts them
  - `services/kraTasks/kraRoutineService.js`: the night run, the start-up catch-up, the reminders
- **Server, changed:**
  - `models/KraTask.js`:
    - the Missed status; the routine part; given day; done time and file
    - updates and the last update day / %; the blocker and its history
    - 2 indexes; `assignedBy` can be empty for system-made items
  - `services/kra/kraService.js`: `kraOfMany`
  - `services/kraTasks/kraTaskService.js`:
    - new: daily update, blocker / clear, tick, send back, Today
    - list tabs: No update / Blocked / Routine, with routine items kept out of the others
    - the new permission flags; giving a task returns the same view as everything else
  - `routes/kraTasks.routes.js`: `GET /today`; `POST /:id/update | blocker | unblock | tick | send-back`
  - `index.js`: the three schedules (00:10, 09:30, 17:30, India time, one server at a time) and the catch-up 30 s after start
- **Screens:**
  - `components/kraTasks/MyTasks.jsx`: the Today tab
  - `TaskBoard.jsx`: the new tabs, the Routine table and its day picker
  - `TaskDrawer.jsx`: updates (the shared `UpdateBox`), blockers, routine Mark done / Send back, the blocker history
  - `taskUi.jsx`: the Missed / Done late / Not yet / Sent back statuses, and the Blocked and Update due chips

## Tested
- **The new suite `kradaily`: 62 of 62,** through the real server; the night run and the reminders are called with fixed dates.
  - **The schedule:** monthly on the 31st, and weekly carried past a holiday.
  - **The run:** what's made, and nothing on leave, for untracked duties, Step work, people who can't log in, or the weekly off / a holiday; the run record; no duplicates.
  - **Tick, send back, missed:** tick with or without a file, late, send-back rules, Missed the next day; a duty switched on starting the next day.
  - **Daily updates:** short refused; given today / yesterday; leave; one a day; % with steps refused.
  - **Blockers:** raise, the bells, clear, history, from an update, on a routine item.
  - **Reminders:** morning / evening, holiday, leave, one bell each.
  - **Today.**
- **Regression:** `kratasks` 43 and `kra` 33.
- **The screens bundle.**
