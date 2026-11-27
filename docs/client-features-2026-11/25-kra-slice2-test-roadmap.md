# Feature 25, slice 2: the new Task Management (browser test)

*On test-1, together with the other remaining browser tests. What changed: [25-kra-slice2-changes.md](25-kra-slice2-changes.md). The suite `kratasks` (43) already checks the rules; this is about the screens.*

**Before:** a snapshot. **Slice 1's test runs first**, so the Sales Employee role has a KRA. Otherwise, set one in HR → KRA.

**After:** the tasks and KRAs the test made are removed.

**Logins:** HR-Admin, the Sales Head, two Sales Employees (A and B), someone from another department (e.g. Store).

## 1. Task sizes (HR → KRA)
1. The card at the top reads *"Short ≤ 4 h · Medium ≤ 5 working days (40 h) · Long = more, split into steps of ≤ 2 working days (16 h)"*.
2. **Change:** set short to 2 h and save; the card shows it. Set it back to 4 h.

## 2. Give a medium task (the Sales Head → Task Management)
1. The board opens on **My department**. "Everyone" isn't offered.
2. **+ New task.** Search for a Store person: they aren't found. Search for Sales Employee A and pick them.
3. **Their KRA:** the dropdown lists only A's KRA items, with their weights. There's no "Step work". Pick **Lead management**.
4. **Title** *"Follow up the 12 open leads"*; due in 2 days; **12 h**. The size reads **Medium (12 h)**.
5. **Give the task.** It's in **Open (1)**, showing the KRA, "no steps" and the due date.
6. A gets a bell.

## 3. Give a long task with steps
1. **+ New task** for **A and B** together; pick each one's KRA.
2. **Surprise work** with no reason: refused. Give the reason *"Customer visit moved up"*.
3. **60 h** with no steps: the size reads **Long**, the steps box turns amber, and saving is refused.
4. **Add 4 steps** of 15 h, each with a due date. Then try a step of 20 h: it's marked red, and the server refuses it. Fix it back to 15 h.
5. **Give 2 tasks.** There are 2 rows (one for A, one for B), each with its own KRA.

## 4. The person's side (Sales Employee A → My Task)
1. **My tasks:** both tasks, the soonest due first. **My KRA** still shows the KRA.
2. **Open the medium task → Start.** It's now **In progress**.
3. **Open the long task.** Tick 3 steps: the progress shows 75%.
4. **Submit for review** with one step open: refused (*"Finish every step first: …"*, naming the open step). Tick the last step, then submit with a note and a file.
5. A has no **Review**, **Move due date** or **Cancel** buttons.

## 5. Review (the Sales Head)
1. **To review (1).** Open it: the note and the file are there.
2. **Rework · Minor** with no note: refused. Give the note *"Add the customer's PO number"* and save. The task is now **Rework**, and A gets a bell.
3. **As A:** submit again.
4. **As the Head:** **Accept · Good.** The task is now **Accepted** and moves to **Done**. Its history lists both submissions, the rework and the acceptance.

## 6. Due date, edit, cancel (the Sales Head)
1. **On the medium task, Move due date** to a day later with no reason: refused. With *"Waiting for the price list"*: saved, the line shows on the task, and A is told.
2. **Edit:** change the title and the priority to High. The row shows the **High** chip.
3. **Give B a short task** (1 h) due in 5 minutes. Once that time passes, it's in **Overdue**, in red. (A task with steps can't be moved earlier than a step that's still open: the server says *"A step is due after the new date…"*.)
4. **Cancel** B's task with a reason. It's in **Done** as Cancelled.

## 7. Who sees what
1. **Sales Employee B** opens My Task: only their own tasks. A's tasks aren't there.
2. **HR → Task Management:**
   - **Everyone** lists all the tasks above
   - **Before KRA** lists the old module's tasks, read-only
3. **The Store person** has no way to reach the Sales tasks.

## 8. Clean up
I remove the tasks, uploaded files and KRAs the test made, and put the task sizes back if they were changed.
