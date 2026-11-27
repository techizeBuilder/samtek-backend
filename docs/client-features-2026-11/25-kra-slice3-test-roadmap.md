# Feature 25, slice 3: daily updates, blockers, reminders, routine items (browser test)

*On test-1, with the other remaining browser tests. What changed: [25-kra-slice3-changes.md](25-kra-slice3-changes.md). The suite `kradaily` (62) already checks the rules and dates; this is about the screens.*

**Before:**
1. A snapshot.
2. Slices 1–2's tests first, so the Sales Employee role has a KRA and some tasks exist.
3. Routine items are only made by the night run, so after HR switches a duty on, **I run "today" for test-1 by hand** (the same code as the night run). You don't have to wait for midnight.

**After:** the test's tasks, routine items and KRA changes are removed.

**Logins:** HR-Admin, the Sales Head, Sales Employees A and B.

## 1. Routine items appear (HR → KRA, then me)
1. **HR changes the Sales Employee KRA:** on Daily reporting, the duty *"Daily sales report"*, working days, 18:00, **Track daily** on, **File** on; and *"Weekly plan"*, weekly on today's weekday, 11:00, **Track daily** on.
2. **Tell me; I run today's routine for test-1.**
3. **A → My Task:** it opens on **Today**. **Routine today** lists both items, *by 18:00* and *by 11:00*, as **Not yet**.

## 2. Ticking (Sales Employee A)
1. **Daily sales report:** the **Mark done** button stays grey until a file is picked. Pick a PDF and mark it done: it shows **Done**.
2. **Weekly plan:** if it's after 11:00, marking it done shows **Done late**.
3. **Open a done item:** it shows when it was done and the file. There's no Start, Submit, Move due date or Cancel.

## 3. The head's Routine tab (Sales Head → Task Management)
1. **Routine:** today's items for the department, one row each, with Done / Done late / Not yet.
2. **Change the day** to yesterday: nothing (they didn't exist yet).
3. **Open A's daily report → Send back · Minor**, with the note *"Attach the signed copy"*. It shows **Sent back**, and A gets a bell.
4. **A → Today:** the item is back, **Sent back**. Mark it done again with a file.
5. **The Open and Overdue tabs** don't list routine items. Type → **Routine** shows them.

## 4. Daily updates
1. **The head gives A a medium task** (12 h). On A's Today it is **not** under "Updates to write": it was given today.
2. **I set it to "given yesterday"** in the database (the same as waiting a day).
3. **A → Today:** it's under **Updates to write**, and its row shows *Update due today*.
4. **The head → No update today (1):** A's task is listed.
5. **A writes** *"Called 5 of 12"*, 40%, and saves. The task is now **In progress** at 40% and leaves "Updates to write". The head's count drops.
6. **A writes again** (*"6 of 12"*, 50%): the window shows one update for today, replaced.
7. **On a task with steps:** there's no % box (*"Progress comes from the steps ticked"*).

## 5. Blockers
1. **A opens the medium task → I'm blocked:** *"Waiting for the price list"*.
   - The red box shows; the row shows **Blocked**; the head gets a bell.
   - The due date doesn't change.
2. **The head → Blocked (1) → open it → Clear,** with *"Sent the list"*. A gets a bell; the history lists the blocker and who cleared it.
3. **A writes an update with** *"Customer not answering"* in "Anything blocking you?": the task is blocked again.
4. **A on a routine item → I'm blocked:** the Sales Head gets the bell.

## 6. Reminders
At 9:30 and 17:30 on a working day, the bells come by themselves. To see them sooner, **I run the morning and evening reminders for test-1 by hand.**
- **A's 9:30 bell:** *"Today's tasks — Today: … routine items."*
- **The head's 9:30 bell:** *"Tasks you gave — …"*
- **A's 17:30 bell:** *"Before you finish today — Write today's update on: …"* (if an update is still missing).

## 7. Clean up
I remove the test's tasks, routine items, run records and KRA changes.
