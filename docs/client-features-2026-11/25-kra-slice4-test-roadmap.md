# Feature 25, slice 4: KRA scoring, the KRA view, reports (browser test)

*On test-1, after slices 1–3's tests (so a Sales Employee has KRA tasks and routine items). What changed: [25-kra-slice4-changes.md](25-kra-slice4-changes.md). The suite `krascore` (25) checks the maths to the decimal; this is about the screens.*

**Before:**
- A snapshot.
- Sales Employee A needs at least 3 counted tasks this month. For example:
  - 2 tasks accepted (one sent back first)
  - 1 past its due date and not submitted
  - a few routine items done, one missed
- If slices 1–3's tests didn't leave that, I'll set it up with you.

**After:** the test's tasks, routine items and KRA changes are removed, and the grace times are put back.

**Logins:** HR-Admin, the Sales Head, a Production Head (for Manpower → Scores).

## 1. The scorecard (HR → Employee Performance)
1. **Open Sales Employee A:**
   - No delay, Accuracy, Work quality and Task completion now show points, each with *"from the KRA: Lead management 50%: …"*
   - Productivity says *"not measured"*
2. **The KRA box under it:** each KRA item with its weight, tasks done / open, and its four results.
   - Step work is greyed *"left out: no measured steps"*.
   - An item with no tasks this month is greyed *"left out: no tasks this period"*.
3. **"How the score is worked out":** read the KRA paragraph in English, then switch to Hinglish.
4. **Open someone with no KRA** (e.g. a Store person, if Store has no KRA): exactly as before, with no KRA box.

## 2. The grace time (HR → KRA → Task sizes)
1. **The card shows** *"On time with a grace of 30 min (short) · 2 h (medium) · 1 day (long)"*.
2. **Change the short grace** so a short task that was a little late counts as on time. A's No delay goes up on the scorecard.
3. **Put it back.**

## 3. Reports (the Sales Head → Task Management → Reports)
1. **This month:** A's row shows finished, on time %, first time right %, rating, open past due (red), waiting, routine done / missed, blocked now.
2. **Only Sales people are listed.** Pick "Last month" or some dates: the numbers follow the period.
3. **Click A:** the work parts in points and the KRA box, the same as HR's scorecard.
4. **As HR:** Reports lists every department, with a department filter.

## 4. HR → KRA: Step work
1. **On test-1,** a role whose people did production steps recently but whose KRA has no Step work shows *"Did steps: add Step work?"*.
2. **Add Step work to that role's KRA:** the note goes away, and their steps count again.

## 5. Production → Manpower → Scores
**Open a Production person who has a KRA with Step work and some tasks:**
- the work parts mix both
- the KRA box shows Step work's step results next to the other items

## 6. Clean up
I remove the test's data and put the grace times back.
