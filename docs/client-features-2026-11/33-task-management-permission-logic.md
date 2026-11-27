# Feature 33: The Task Management permission switch works again (logic and decisions)

*25 November 2026. Found in the browser test of feature 27: switching **Task Management** off for an HR-Admin changed nothing, even after signing in again.*

## What it is today
- **The switch is old.** It's the "Task Management" switch on the HR pages list in Roles & Permissions, and it belonged to the old task module.
- **The new Task Management (feature 25, KRA) never reads it.** Access is by role:
  - each person sees their own tasks
  - a Head gives and reviews tasks for their department
  - HR, the Company Admin and MIS Admin see and give tasks for everyone
- **The menu has no permission check either.** Apart from the Company Admin's, every module's "Task Management" item shows whenever the person has that module at all: HR, Manager, Production, Packing, Dispatch, Sales, Accounts, R&D, Store, QC.
- **Only the HR pages list has the switch** (not the Manager's own list, nor Production, Sales and the others).

## Decisions (25 Nov, as recommended)
1. **The switch decides Task Management, in every module that has the page:**
   - HR and Company Admin (hrms), Manager (hrms)
   - Production, Packing, Dispatch, Sales, Accounts, R&D, Store, QC

   Each of these modules' permission lists gets **Task Management**.
2. **Its four ticks mean:**

   | Tick | Allows |
   |---|---|
   | View | the Task Management page: the board of tasks they gave or oversee, the reports, the tasks from before KRA |
   | Add | give tasks (New task, choosing people) |
   | Edit | review, change a due date, edit, send a routine item back |
   | Delete | cancel a task |
3. **"My tasks" stays for everyone,** switch or not. A person always sees and works their own tasks (start, steps, submit, daily update, blocker, tick a routine item, comment).
4. **The role rules stay underneath.** The switch can only take Task Management away; it never widens what a role may do. A Head still only gives tasks to their own department.
5. **The Company Admin keeps it by role** (feature 27's pages), and a Super Admin always has it.
6. **Nobody loses it tomorrow:**
   - A one-time fix at server start gives the switch, fully on, to every person who has one of those modules saved but no Task Management entry yet.
   - Someone whose switch is already saved (like the HR-Admin switched off in the test) keeps what was saved.
7. **New people get it** with their role's usual permissions, as for every other page:
   - Heads, HR, Manager: all four ticks
   - employees: View and Add, like their other pages
8. **The menu item shows only with View.** Opening the page without it says *"Task Management isn't switched on for you. Ask HR or the Company Admin."*
9. **A warning on the permission screen.** The switch's label says *"Task Management (give and review KRA tasks)"*. Switching it off for a Head means their department gets no KRA tasks from them, so those people's task-based scores have nothing to count.

## Not changed
- The KRA pages, My tasks, the routine items made each night, the scorecard rules.
