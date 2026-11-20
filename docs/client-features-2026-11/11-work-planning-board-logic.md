# 11: Work Planning as a daily planning board, and Job Cards retired (logic)

*Written 14 November 2026. Both pages were built before crews, planning, real step times and the score existed. You asked for my judgment (14 Nov), so the decisions in section 8 are mine; any of them can be changed.*

## 1. Today's two pages
**Work Planning** (`/production/work-planning`):
- **What it shows:** orders by urgency and delivery date, a Monday–Saturday week strip and a "daily" list of orders with any open step.
- **Its problems:**
  - It doesn't plan anything. It can't show who is planned or working on which step, or which steps can start now.
  - It marks orders due today as "Overdue".

**Job Cards** (`/production/job-cards`):
- **What it shows:** one printable card per order step, with the old team name, start / end dates and the order's material list.
- **Its problem:** none of what the floor now works with: the crew's names, the step's own material, planned vs real hours, covers, units.

Both read the same order data as everything else, so neither is wrong. They're just answering old questions.

## 2. What the board answers
One page, for **today**, that a Production Head opens in the morning and keeps open:
1. **Who is where:** present and free, working, planned, absent.
2. **What is running**, and whether it's going over its planned hours.
3. **What is planned but not started,** and whether it *can* start.
4. **What could start now, with nobody on it.**
5. **What is stuck, and why:** material, a vendor, QC, Store.
6. **What finished today,** and how it went against the plan.

## 3. The people strip (top of the board)
- **Counts:** Present · Working · Planned only · Free · Absent (and "Not punched in"), from today's attendance and the crews, the same as the Manpower Today tab.
- **Free and present people** listed by name, with their team and skills. These are the people to plan next.

## 4. The sections
**Which steps:** every open order (not Completed or Cancelled), every unit, in-house and outsourced. Each step lands in **one** section, checked in this order:

| Section | A step lands here when… | Shows |
|---|---|---|
| **A. Running now** | in-house, **In Progress** | order, part, unit, step, crew names (covers marked), since, **planned vs so far** hours; red when so far is past planned |
| **B. Planned, not started** | in-house, not started, **someone planned on it** | crew names, planned hours; **"Can start"** in green, or the reason it can't (section 5) in amber |
| **C. Ready, nobody planned** | the unit's **next step**: in-house, not started, **nobody planned**, and nothing blocks it | **Plan people** opens Process Execution at that step |
| **D. Waiting** | the unit's **next step** can't move yet | grouped by reason (below), with the order, part, unit and step |
| **E. Finished today** | completed today (India date) | took vs planned, Early / On time / Late (the score's bands), the crew |

**The unit's "next step"** is its first step that isn't Completed. A later step that someone planned ahead (feature 9) shows in B, not C or D.

**Reasons in D:**
- **Material not in Production:** a Machine order's material not issued, or the step's own material lines not issued.
- **BOM not verified** (Machine): R&D hasn't locked the BOM and approved the design.
- **At the vendor:** the next step is outsourced and not back yet (requested / ordered / with vendor).
- **In QC:** the next step was submitted to QC and waits for its decision.
- **Held at Store:** outsourced work for this unit is still at Store.

**Not paged:** this is open work, like the Today tab. It has a **search** (order, part, step, person) and **filters**: order kind (Machine / Child Part / Sub Child Part) and team.

## 5. "Can it start?" = exactly what Start checks
The board uses the **same checks as the Start button**, from one shared piece of code, so the two never disagree:
1. In-house, and not started yet.
2. **Machine order:** BOM verified, and all material issued.
3. **The step's own material** is in Production.
4. **The previous step** on this unit is completed.
5. **Nothing held at Store** for this unit.

Start then also needs **someone on the crew** and **planned hours**. The board shows those as "nobody planned" (section C) and "planned hours not typed" on a B row.

## 6. Print: the job card's replacement
A **Print** button on the board prints **today's plan per team**, a block each. Blocks share a page while they fit, and a block that would be cut moves whole to the next page (changed 14 Nov at your ask; the first build gave every block its own page):
- the team's **running** and **planned** steps: order, part, unit, step, planned hours, the people on it, and covers
- at the end, **Ready, nobody planned**

That's what a paper job card was for: what this crew does today, without a page per step.

## 7. Job Cards retired
- The **Job Cards** menu item goes. Its old address opens Work Planning, so old links and bookmarks still land somewhere useful.
- The **Job Cards** permission leaves the Roles & Permissions list. Values already stored on users are ignored.
- **Work Planning keeps its permission:** "Work Planning", view.

## 8. Decisions (my judgment, 14 Nov)
| # | Decision | Why |
|---|---|---|
| D1 | The board is **today** only. No future calendar in this version. | Planning ahead already happens on Process Execution (feature 9). The board shows its result. |
| D2 | **Five sections, each step in one,** as in section 4 | Answers the six questions in section 2 with no duplicates. |
| D3 | **"Can start" reuses Start's checks** (one shared function) | A board that says "can start" while Start refuses would be worse than no board. |
| D4 | **Not paged; search + filters** | Open work, like the Today tab. Pages would hide stuck work. |
| D5 | **Print per team** replaces Job Cards | A block per crew per day, not a card per step. Blocks share a page while they fit (14 Nov, your ask). |
| D6 | **Job Cards retired**, its address opens Work Planning | Nothing in the new flow needs it, and it showed outdated data. |
| D7 | **Plan people links to Process Execution** | Planning happens in one place (the crew panel and its rules). The board doesn't copy it. |

## 9. Not in this version
- Days ahead, or a week calendar.
- Drag and drop between people.
- Delivery-date forecasting from planned hours.
