# Feature 18: Step history on Process Execution (browser test)

*On test-1, as the Production Head. What changed: [18-step-history-changes.md](18-step-history-changes.md). The suite `stephistory` (18) already checks the records; this is about the screen.*

**You'll need:** an order with an in-house step that hasn't started. Test-1 has no production orders since the delivery-estimate reset, so raise one first (for example from a customer order).

## 1. Planning and a plan change
1. Process Execution → the order → a step not started → **Add people** → put on 2 people.
   - Each name, hovered: *"Put on {today, time} by {you} · planned, starts with the step"*.
   - The line under the step says **"Not started yet · History"**.
2. Remove one of them (×).
3. Open **History**:
   - both put on, marked **planned**
   - the second one **removed from the plan** by you, marked **before the start**

## 2. Start, join, take off
1. Type planned hours, then **Start**. Choose **Started at** a time 2 hours ago.
   - The line says **"Started {date, time} (entered {now} by {you})"**.
2. **Add people** while it runs: someone with **Working since** 1 hour ago.
3. Take that person off (×) with **Left at** 30 minutes ago.
4. Open **History**:
   - **Step started**, with who starts working with it and "entered … by …"
   - **"{name} working since …"**
   - **"{name} taken off by {you}"**, with the span on the step and "entered …"

## 3. Finish
1. **Complete** the step (Finished now, or at a time).
   - The line says **"Started … · Finished … (x h y min)"**. A finish on another day shows its date.
2. **History** ends with **"Step finished"** and each person's hours, the same as the card's "Actual" figures.

## 4. Others
1. **Unit 2** of a multi-unit order has its own history.
2. A **Production Employee** with view only: sees the times and History, but no Add or × buttons.

## Log
| Step | Result | Notes |
|---|---|---|
| | | |
