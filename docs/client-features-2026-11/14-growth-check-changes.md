# Growth check: what would slow down as data grows (what changed)

*17 November 2026, at your ask, after a slow spot turned up in the scorecard's browser test. I read features 1–13 against their code and looked for work that grows with history: reading every record ever made, sorting with no index, or a query for each item in a loop. Six places were fixed. **Nothing users see changes;** only how the data is read.*

## Fixed
| # | Where | The problem | Now |
|---|---|---|---|
| 1 | **Order Tracking** (feature 12), Open / Delivered lists | Every load went through **every dispatch record ever** to find delivered orders, then left them out with a list that never stops growing. "Newest first" had no index. | When the tracker first finds an order with every unit delivered, it **marks the order** (`trackingDeliveredAt`). Each load checks only orders not marked yet and still open, so it's bounded by open work. The first load after this checks the older orders once and marks them. Indexes on orders (company + delivered mark + date) and dispatch lines (company + order). |
| 2 | **Scorecard** (feature 13), steps left open past plan | Read every production order the company ever had. | Reads only orders still open, or changed since the period began. Only the steps the people asked for were on get their hours worked out. Index on production orders (company + last change). The steps finished in a period also got an index (company + finish date). |
| 3 | **Attendance Device page** (feature 2, stage 2) | The unknown-codes list and the unknown-statuses list read **every device day and punch ever stored** (about 15,000 days and 30,000 punches a year for 40 people). | Codes people already hold are left out inside the query. Unknown statuses come from the **last 90 days**. |
| 4 | **Before every crew action** (Start, add people, Today, the board) | The check for crews still open had no fitting index, so it read every crew record ever. | Index on crew entries (company + left). |
| 5 | **Scorecard and Payroll Run** | Loaded **everyone who ever worked at the company** each time, including people who left years ago. | Active people, plus anyone deactivated during or after the period (their record is updated when they're deactivated). |
| 6 | **Lists and lookups** | The conduct notes and incentives lists (newest first, no status filter), and payroll's monthly incentive lookup, had no fitting index. | Indexes added. |

**One thing to know (1):** once an order is found fully delivered, it stays on the Delivered list. That's also what a completed order does.

## Checked and fine
- **Work Planning board:** open work only, as decided (feature 11). It re-checks unverified Machine BOMs and works out hours for running steps one by one on each load. Fine at today's size; worth watching if dozens of steps run at once.
- **Teams tab:** works out the month's scorecard for Production people on each load. That's bounded by people × one month.
- **Nightly device sync:** writes one day at a time. A month's re-download is about 1,200 writes, which is fine.
- **Order search by name:** only runs when someone types.
- **Payroll totals:** bounded by headcount.
- **Lists that grow:** already paged on the server (team history, scores, incentives, notes, a person's steps).

## Tests
All passing after the change:
- `ordertrack` 69, `devicesync` 80, `payroll` 68
- `scorecard` 99, `score` 50, `incentive` 49
- `crew` 67, `teamcover` 29, `planboard` 26, `mpages` 21, `steptimes` 28, `planahead` 20

The seven new indexes were checked as built on the dev database.

## Technical notes
- `services/orderTracking/trackerService.js`: `markDelivered` replaces `deliveredOrderCodes`. Open = `trackingDeliveredAt: null` and status not closed; Delivered = marked, or status `completed`. `models/Order.js` gets `trackingDeliveredAt` and two indexes.
- `services/score/scoreService.js`:
  - `productionUnfinished`: status open, or `updatedAt ≥ period start`, AND a step open then; `StepCrewEntry` pre-filters the people asked for
  - `monthCards`: users active, or `updatedAt ≥ period start`
- `services/payroll/payrollService.js` `loadCompanyInputs`: the same user filter, for the whole company.
- `services/deviceSync/deviceProcess.js`: `unmatchedCodes` filters `code $nin held` in the `$match`; `unknownStatuses` is limited to 90 days.
- **Indexes:**
  - `StepRun {company, completedAt}`
  - `StepCrewEntry {company, leftAt}`
  - `ConductNote {company, createdAt}`
  - `IncentiveRequest {company, createdAt}` and `{person, month}`
  - `Order {companyId, createdAt}` and `{companyId, trackingDeliveredAt, createdAt}`
  - `DispatchOrder {company, orderId}`
  - `ProductionOrder {company, updatedAt}`
