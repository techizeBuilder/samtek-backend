# Feature 2, stage 6: Labour cost into the price (logic)

*Written 12 November 2026. **Decisions made 12 Nov** (section 10): all as recommended. **BUILT 12 Nov:** what changed is in [02f-labour-cost-changes.md](02f-labour-cost-changes.md); differences from this doc are in section 14. Background: [02-manpower-attendance-discussion.md](02-manpower-attendance-discussion.md), hours: [02e-assign-and-hours-logic.md](02e-assign-and-hours-logic.md), the build-cost push this plugs into: [../outsource-v2/slice-4-cost-logic-2026-10.md](../outsource-v2/slice-4-cost-logic-2026-10.md).*

## 1. What the client asked
- **Hours × each person's rate = the cost of the work.** The rate comes from their salary.
- **That cost goes into the part, then the BOM, then the Machine's price.**
- **It replaces the production cost Production types today.** Production's typed **expense stays as it is.**

## 2. Today: how a build's cost reaches the price
Code: `services/partCostService.js`, then `services/priceCascadeService.js`.

**Each unit collects three numbers** (a Sub Child Part collects them for the whole batch):
| Number | Where it comes from |
|---|---|
| **Production cost** | Typed by Production at the unit's last in-house step |
| **Production expense** | Typed at the same moment |
| **Job work (outsource)** | Never typed: added up from the Outsource Orders (what QC accepted, without GST, plus a share of the order's charges) |

**When the unit's true last step finishes,** all three go to the BOM together, whoever finishes it (Production, QC, Store's receive, or Purchase entering a per-hour time):
- **Child Part or Machine:** written on its BOM as they are.
- **Sub Child Part:** divided by the pieces that finished.
- **The latest build wins,** except that a build still waiting for a per-hour time doesn't replace a complete one.
- **Then the price push** climbs to every Machine using the part, so Sales sees the new price at once.

**R&D can type a "Manual" production cost** on a BOM as an estimate before the first build. The first real build replaces it.

## 3. What changes
**Production cost becomes labour,** worked out by the system the way job work is. Nobody types it.

| | Before | Now |
|---|---|---|
| Production cost | Typed at the last in-house step | **Labour:** hours × rate, worked out from the crews |
| Production expense | Typed at the last in-house step | **The same** |
| Job work | From the Outsource Orders | **The same** |
| When it goes to the BOM | When the true last step finishes | **The same** |
| The latest build wins, the division by finished pieces, the price push | | **The same** |
| R&D's manual estimate | Before the first build | **The same,** labelled "Labour estimate" |

## 4. The hourly rate
For each person, for each day they worked:

```
monthly gross   = basic + HRA + other allowance        (HR's Salary Structure, as payroll uses)
working days    = days in that month − weekly offs     (the Attendance Policy's weekly off days)
per day         = monthly gross ÷ working days         (payroll's own rule, stage 3)
hours that day  = their shift that day: end − start − lunch   (decision 1; no shifts set → 8)
per hour        = per day ÷ hours that day
```

- **Holidays count as working days,** paid or unpaid, the same as payroll.
- **The shift** is the one stage 5 already works out each day: the start nearest their punch-in.
- **The salary in force is used.** HR's Salary Structure has one record per person, with no history.

**Example:** Ravi, gross ₹15,600 (basic 12,000 + HRA 2,400 + other 1,200).
- **November 2026:** 30 days − 5 Sundays = **25 working days** → ₹624 a day.
  - On the General shift (09:00–17:30, lunch 30 minutes = 8 hours): **₹78 an hour.**
  - On a 9-hour shift (08:30–18:00, lunch 30 minutes): ₹624 ÷ 9 = **₹69.33 an hour.**
- **October 2026:** 31 days − 4 Sundays = 27 working days → ₹577.78 a day → **₹72.22 an hour** at 8 hours. The rate moves a little with the month, as pay per day does in payroll.

## 5. Labour for a build
**A unit's labour** (a Sub Child Part: the batch's) = for every in-house step of that unit, every person who was on its crew:

```
Σ  their hours on the step that day  ×  their rate that day
```

- **Hours** are stage 5's: on the crew, while the step was running, while present, minus lunch.
- **Supervisors are counted** like anyone on the crew (decision 2). Putting a whole team on a step already includes them.
- **Rework is counted** (decision 3): hours after a QC rejection are real labour for that build. They stay out of the averages, as now.
- **Hours past the shift end are counted at the same hourly rate.** Payroll pays no overtime yet.
- **Outsourced steps have no labour:** the vendor's price covers them.
- **Someone with no Salary Structure counts ₹0,** and is listed (section 7).

**A Sub Child Part:** the batch's labour ÷ the pieces that finished, as job work and the typed cost are divided today.

## 6. When it's worked out
- **At the same moment as today:** when the unit's true last step finishes and the cost goes to the BOM. Labour is worked out then, from the crews, attendance, lunch answers and salaries.
- **Lunch answers are already in:** each step asks about lunch before it completes (stage 5).
- **Worked out once, then kept.** A later push of the same build (for example when Purchase enters a per-hour time on an outsourced step) reuses the labour it already worked out. So a salary change later doesn't re-cost a build already finished; the next build uses the new salary. The one exception is in section 7.
- **The last in-house step** no longer asks for a cost, only the expense.

## 7. "Price provisional" when a salary is missing (decision 5)
- **When a build counted someone with no salary,** the part's price is marked provisional, naming them: *"Labour counted ₹0 for Suresh: no salary entered."* Every Machine using the part shows the same mark, the way it does today for a bought part with no price.
- **It shows where the mark already shows:** Product Master, the quotation, the order form and the new lead form. It only warns; it never blocks.
- **The mark follows the build that sets the part's cost today,** so it clears:
  - **when a newer build replaces it** and that build has everyone's salary, or
  - **when HR enters the missing salary:** every part whose **current** cost came from a build that counted that person at ₹0 is worked out again with it, and the price push follows (decided 12 Nov).
- **A build already replaced by a newer one is left alone** when the salary comes in: it no longer sets the price, so working it out again would change nothing. If the newer build also counted the same person at ₹0, it's the one worked out again.
- **Each part is checked on its own:** someone who worked on a Fan unit and a Bracket batch can clear one and not the other.

## 8. Who sees what (decision 4)
Hours and cost together would reveal someone's pay, so:

| Screen | Shows |
|---|---|
| **Process Execution** | Hours only, as in stage 5. The unit's "Build cost" line says *"Labour: from the crew's hours, shown on the BOM"*, next to the expense and the outsourced money |
| **The last in-house step's dialog** | Asks the **expense** only |
| **Child Part and Machine BOM pages, the Sub Child Part master** | The row **"Labour (crew hours)"**, a total, with the build it came from (order, unit, date) and a **"How it's worked out"** panel with an English / Hinglish toggle |
| **Anywhere** | **No cost per person.** Only HR sees salaries, on HR's own pages |

**On the server:** the labour total is kept with the BOM and the build's cost record, and isn't sent with the order to Process Execution.

## 9. What doesn't get labour
- **Fully outsourced builds:** ₹0 labour and no expense asked, as today.
- **Bought parts** (make or buy): no production order, so no labour. Their price comes from the purchase.
- **Old-shape orders (dev only):** the parts on an old Machine order's Fabrication step, the old Sub Child Part order-level team, and the old Child Part checklist have no crew, so they add ₹0 labour.
  - **On dev:** the 20 open orders on the old fixed steps were all made by 5 September, and the 3 QC jobs with part checks by 7 September. Every order made since builds its steps from the BOM's step list, where every in-house step has a crew.
  - **A new order** gets the old fixed steps only if R&D releases a Child Part or Machine without setting its step list. Release doesn't check this today.
- **Steps finished before stage 5** (before 12 Nov, dev only) have no crew, so they add ₹0.

## 10. Your decisions (12 Nov)
| # | Question | Decided |
|---|---|---|
| 1 | Hours per day for the hourly rate | **The shift that day** (end − start − lunch); 8 hours when no shifts are set |
| 2 | A supervisor on the crew | **Costed like anyone on the crew** |
| 3 | Rework hours | **Counted in that build's cost;** kept out of the averages |
| 4 | Who sees labour cost | **Process Execution shows hours only. The BOM shows the total.** No cost per person outside HR |
| 5 | Someone with no salary | **₹0, and "Price provisional" naming them** |
| 6 | Work with no crew | **Old-shape dev orders only:** ₹0 labour, listed here (section 9) |
| 7 | Latest build or an average | **The latest build,** as today |
| — | Production expense | **Unchanged,** typed at the last in-house step |
| — | A salary change after a build | **The next build uses it;** finished builds keep theirs |
| — | A missing salary entered later | **Only a part whose current cost came from a build that counted that person at ₹0 is worked out again.** A build already replaced by a newer one is left alone |

## 11. Worked examples
### A Child Part, one unit
**Fan (CP-001), unit 1.** Steps: welding (outsourced), grinding (in-house), coating (in-house, the last one), pre painting and post painting (outsourced). Everyone on the General shift; November rates.

| Who | Gross | Per day (÷ 25) | Per hour (÷ 8) |
|---|---|---|---|
| Ravi | ₹15,600 | ₹624 | ₹78 |
| Amit | ₹13,000 | ₹520 | ₹65 |
| Suresh | none entered | — | ₹0 |

| Step | Day | Hours (stage 5) | Labour |
|---|---|---|---|
| grinding | Mon 9 Nov | Ravi 3 h, Amit 3 h | 3 × 78 + 3 × 65 = ₹429 |
| coating | Tue 10 Nov | Ravi 2 h, Suresh 2 h | 2 × 78 + 2 × 0 = ₹156 |

- **Labour = ₹585.** Expense typed at coating: ₹50. Job work from the Outsource Orders: ₹390 (slice 4's example).
- **The Fan's BOM:** Labour ₹585 + Expense ₹50 + Job work ₹390, plus its Sub Child Parts and materials, as before.
- **"Price provisional":** labour counted ₹0 for Suresh. When HR enters Suresh's salary (say ₹13,000, ₹65 an hour), the build is worked out again: ₹585 + ₹130 = **₹715**, and the mark clears.

### Rework
QC rejects coating, and Ravi redoes it for 1 hour on Wed 11 Nov: **+₹78**, so labour is ₹663 before Suresh's salary.

### A 9-hour shift
Amit on 08:30–18:00 (9 hours) the day he works on grinding: ₹520 ÷ 9 = ₹57.78 an hour → 3 h = **₹173.33**, not ₹195.

### A Sub Child Part batch
**Bracket (SCP-007), a batch of 5:**
- cutting, Wed 11 Nov: Ravi 1.5 h + Amit 1.5 h = ₹117 + ₹97.50 = ₹214.50
- drilling: Amit 1 h = ₹65
- **Labour ₹279.50.** QC scraps 1 piece, so 4 finished → **₹69.88 a piece.**
- Expense typed for the batch ₹20 → ₹5 a piece.

### Into the Machine's price
The Fan's cost goes up by the labour, and every Machine using it goes up by the same amount × the quantity on its BOM. Its MRP follows from its profit % and discount %, without anyone opening a page (slice 4's push, unchanged).

## 12. How I'd test it
**A new suite, `labour`, on made-up companies,** with made-up salaries, attendance, shifts and crews. Totals are worked by hand, not by the code's own functions:
- **The rates:** ₹78 and ₹65 in November, ₹69.33 and ₹57.78 on a 9-hour shift, ₹72.22 in October, 8 hours when no shifts are set.
- **The Fan example:** ₹585 on the BOM, expense ₹50, job work unchanged.
- **Suresh:** "Price provisional" on the Fan and its Machine. Entering his salary gives ₹715 and clears the mark. When a newer Fan build has already replaced that one, entering his salary changes nothing.
- **Rework** +₹78, a supervisor counted, and hours past the shift end.
- **The batch:** ₹69.88 and ₹5 a piece.
- **The price push** to the Machine's MRP.
- **Rules:**
  - the latest build wins
  - a later push of the same build keeps its labour
  - a salary change doesn't re-cost a finished build
- **The last in-house step** asks the expense only. An old screen still sending a cost is ignored.
- **Privacy:** the order sent to Process Execution carries no labour ₹, and another company is refused.

**Regression:**
- `slice4-cost`, updated: Production's typed cost becomes labour.
- `crew`, `partprice`, the make-or-buy suites (the provisional mark), and the suites that complete steps.

## 13. Not in this stage
- **The delivery estimate** (stage 7) will use stage 5's hours, not this cost.
- **Overtime pay** and extra pay for weekly-off work wait for the client (payroll stage 3). Labour counts those hours at the normal rate.
- **Re-pricing old builds:** not needed. Live has only product master data.

## 14. Built (12 Nov): where it differs from this doc
- **Labour is stored on each step run,** priced when the run is saved. A unit's labour is the sum of its runs. That is how "worked out once" works: a later push re-adds the same frozen runs.
- **A fix on the way (stage 5):** crews now close the moment their step finishes, through a save hook on the order. Before, a QC pass re-stamped the finish time, so a crew opened only after the QC pass stretched the hours over the QC wait. A step whose crew was all taken off before it finished also gets its run saved now.
- **Left as it was:** the old fixed-step Child Part Painting dialog (old-shape orders, section 9) still asks a typed cost.
