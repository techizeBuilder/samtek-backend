# Feature 33: The Task Management permission switch works again (what changed)

*Built 25 November 2026. Logic and decisions: [33-task-management-permission-logic.md](33-task-management-permission-logic.md). Browser test: [33-task-management-permission-test-roadmap.md](33-task-management-permission-test-roadmap.md).*

## In one line
**The "Task Management" switch in Roles & Permissions now decides the Task Management page** (giving, reviewing, the board, the reports), in every module that has the page. **My tasks stays for everyone.**

## Before
You switched Task Management off for an HR-Admin and nothing changed. Three reasons:
- the switch belonged to the old task module, and the new Task Management (feature 25) never read it
- the menu items didn't check it
- only the HR list even had the switch

## Now
- **The switch is in every module's permission list:** HR and the Company Admin, Manager, Production, Packing, Dispatch, Sales, Accounts, R&D, Store, QC.
  - **Label:** *"Task Management (give and review KRA tasks)"*
  - **A line under it:** *"Off for a Head: their department gets no KRA tasks from them."*
- **The four ticks:**
  - **View:** the page (the board, the reports, Before KRA)
  - **Add:** give tasks (New task)
  - **Edit:** review, change a due date, edit, send a routine item back
  - **Delete:** cancel
- **My tasks is untouched.** Anyone can still see and work their own tasks: start, steps, submit, daily update, blocker, tick a routine item, comment.
- **The menu shows Task Management only with View.** Opening the page without it says *"Task Management isn't switched on for you. Ask HR or the Company Admin. Your own tasks are under My tasks."* The **New task** button needs Add.
- **The server checks the same,** whatever the screen sends.
- **The role rules still apply underneath.** For example, a Head gives tasks only to their own department.
- **The Company Admin keeps it by role** (feature 27's pages), and a Super Admin always has it.
- **Nobody lost it:**
  - **A one-time fix at server start** gave the switch, fully on, to everyone who has one of those modules but no entry yet.
  - **Someone already switched off stays off,** like Zz F27 HR in the browser test.
  - **On dev:** all 88 users checked, 68 now have the entry.
- **New people get it** with their role's usual ticks: Heads all four, employees View and Add. The sidebar shows the item only to Heads, Manager, HR and the Company Admin, as before.

## Also fixed in the same session
**Roles & Permissions didn't show a new user until a hard refresh.** The app keeps lists cached for good, and the Add User page doesn't touch that cache. The users list and the approval box now fetch fresh each time the page opens.

## Fixed after the browser test (26 Nov)
The user found three things while testing on Zz F27 Company:
1. **On Roles & Permissions, the switches sat one column to the right.** The amber note under the label took a column of its own. So the switch under *Add* was really View, the one under *Edit* was really Add, the one under *Delete* was really Edit, and the one that wrapped under the label was Delete. **Now** the note sits inside the label's cell.
2. **When adding a Sales Head, the Task Management boxes ignored clicks.** Production, Sales, Packing, QC and Store Heads have hand-written default lists without the row, and a tick only changed rows already in the list. Sales Head's Returns and Damages had the same problem. A new Head would have had no Task Management at all, against decision 7.
   - **Now** a box for a missing row adds the row when ticked.
   - **Every role that gives tasks starts with all four ticks,** on its main module. Add User, a role change, Give Login and HR's bulk import all use this one default.
3. **Employees saw a switch that did nothing.** They never get the Task Management page (the menu shows it only to Heads, the Manager, HR and the Company Admin), and **My tasks** needs no switch. **Now** employee roles don't list the row and don't get it by default.
   - This changes decision 7's *"employees: View and Add"*. Switches already saved on employees stay saved and do nothing, as before.

4. **HR and the Company Admin had no My Task page.** In the menus, My Task was only for Heads, the Manager and employees. The test roadmap's *"My tasks still there"* was wrong for HR. A task the Company Admin gives HR, and the daily duties on HR's KRA, had nowhere to be worked; with the switch off, HR had no task page at all. **Now (the user's choice)** both menus have **My Task**: own tasks, Today and My KRA, no switch, the same page as every other role. Its addresses are `/hrms/SuperAdmin/my-task` (HR-Admin) and `/hrms/CompanyAdmin/my-task`. The server already allowed it, since own tasks need only a login.

**Files:** `lib/roleModulesConfig.js` (`givesTasks`, defaults wrapper, `modulesForRole`), `pages/RolePermissionManagement.jsx`, `pages/hrms/AddUser.tsx`, `config/moduleRoutes.js` and `App.jsx` (the two My Task items and routes).
**Tested:** a check of every role's defaults and list (24 roles, all right); `hrperms` 33 of 33 with the client lists rebuilt, `taskperm` 23 of 23; the four screens that use the defaults still build.

## Files
- **Server:**
  - new `services/kraTasks/taskAccess.js`
  - `routes/kraTasks.routes.js` (the gates)
  - `services/hrPermissionBackfill.js` (`grantTaskManagementOnce`, `TASK_MODULES`, Manager's list) + `index.js`
- **Screens:**
  - `lib/roleModulesConfig.js` (the switch in each module, Manager's list, the label)
  - `config/moduleRoutes.js` (the menu items need the switch)
  - `components/kraTasks/TaskBoard.jsx` (the note; New task needs Add)
  - `pages/RolePermissionManagement.jsx`, `pages/hrms/AddUser.tsx` (the warning line)
  - `components/users/HeadApprovals.jsx` (fresh on open)

## Tested
- **The new suite `taskperm`: 23 of 23,** through the real server on a made-up company:
  - **fully on:** board, give, review, cancel
  - **View only:** lists but can't give, choose people or cancel
  - **off:** board, given-by-me, reports and Before KRA refused, while My tasks, Today and starting their own task still work
  - **HR off:** refused. **The Company Admin with nothing saved:** allowed. **The Super Admin:** not refused.
  - **The role rule stays:** a Head can't give outside their department.
  - **The one-time fix:** only the task modules; a switch saved off stays off; a second run changes nothing.
- **Regression:** `hrperms` 33 (with the client lists rebuilt), `kratasks` 43, `kradaily` 62, `krascore` 25, `companyaccess` 42, all passing.
  - **The three KRA task suites' test people now get the switch.** Before, access was by role, so they had none saved.
  - **`companyaccess`'s stamp check now counts only the company's own stamp files.** It failed once while another stamp upload was happening at the same time; it passes 4 of 4 since.
- **Five screens bundle.**
