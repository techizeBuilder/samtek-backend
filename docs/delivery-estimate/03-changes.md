# Delivery estimate for Sales: what changed

*Built 18 Nov 2026 from [02-plan.md](02-plan.md). The design and every decision are in [01-logic.md](01-logic.md).*

## In one line
Sales → Leads → **Estimate Delivery Date** is rebuilt.
- **It plans the order forward, day by day,** using real stock, open POs, job work, the work already in hand and who is really free.
- **It gives three dates:**
  - a **likely date** (dispatch)
  - a **date to commit** (+ the Company Admin's buffer)
  - **delivered by** (+ travel days)
- **It explains itself:** it says what decided the date and who it counted on.

## What people see
**Sales (Leads):**
- **The header button "Estimate Delivery Date"** opens the new dialog, for looking only.
  - **Picking items:** search machines and motors, add them and set quantities.
  - **Travel days:** starts from the Company Admin's usual number.
  - **The result:**
    - the date to commit, in large type
    - the likely date + the buffer
    - delivered by
    - how sure (Good / Rough, with the reason)
    - per item, what decided it, for example:
      - "Plate: ready from 21 Nov, but people are free only from 25 Nov"
      - "Body: painting goes out 26 Nov, back 29 Nov, usable 30 Nov"
      - "Motor: to buy, usually 7 days"
      - "From ORD-2026-115, already being built for stock, finishing 26 Nov"
    - who it counted on (team names and how many people, never anyone's hours)
    - "could be faster with up to N people"
  - **If something isn't known,** there's no date. It says "Can't estimate yet" and names what's missing, and who can fill it in (R&D or Purchase).
  - **"How this date is worked out"** opens a panel, with English / Hinglish.
- **Each lead card has a new "Delivery" column.** It shows the saved date to commit, or **Estimate**. The calendar icon opens the dialog for that lead, pre-filled from its quotation items.
  - **"Use this date"** saves the estimate on the lead and says what it was before.
  - **The order form** for that lead then starts its delivery date from the saved "delivered by". Sales can change it.

**R&D (BOM Management), every box optional:**
- **"Usual hours per piece"** on each In-House step, at all three levels. It's used until the step has 3 finished runs. Typing it **doesn't** pull the product back to approval.
- **"Usual people working on this … at once"** on the Machine BOM, Child Part and Sub Child Part, saved with the steps.
- **Process templates:** "Usual days away when sent out for job work" for each process. It's used until 3 trips are recorded.

**Company Admin → Delivery Settings (new):**
- the buffer % (15) and its minimum (2 working days)
- packing (1) and dispatch (1) days
- the usual travel days (2)
- a worked example line

## How it works (short)
The full design is in 01-logic.md, with the worked example (likely Wed 2 Dec, commit Fri 4 Dec).
- **Route 1, bought:** a motor, a machine not marked In-house Manufactured (Store's own rule), or a part marked bought.
  - The order is: free stock → an open PO (after confirmed orders take their share) → the usual purchase time.
- **Route 2, in-house:** the order form's cascade, read-only: Machine → Child Parts → Sub Child Parts. Only what free stock doesn't cover is built. An open **for-stock** order counts at the date the plan finishes it.
- **The pretend plan, day by day on working days:**
  - Work in hand goes first, earliest delivery date first.
  - People stay with an order they worked on in the last 3 working days.
  - A part never gets more than its usual people at once.
  - Job work is away its usual days (calendar days).
  - A QC check waits its usual time, or until the end of the day.
- **Usual numbers:** history first (the middle one of the last 10), then typed. Step hours use stage 5's average by crew size, only once there are 3+ runs.
- **Attendance:** each person's own rate over 3 months. With no records, 100%, and it says so.

## Choices made while building (not in the logic doc)
- **People cap from history** needs crews on **3+ orders** of that part, like step times. Before that: R&D's usual people, then the biggest step crew, then 1.
- **A step whose skill nobody has recorded** can be done by anyone. Skills aren't fully entered yet (test-1 has steps like "Fabrication" that nobody holds as a skill), and otherwise the plan would wait forever.
- **A part's own materials** must all be in before its first step (rather than step by step). That's a little cautious.
- **A parent part starts when all of its children are ready** (no unit-by-unit overlap). That's a little cautious too.
- **Work in hand:**
  - Each open order's remaining steps are planned as its longest remaining unit list.
  - Its own material isn't re-checked: its material was raised on its own day.
  - Parent/child links between open orders aren't modelled.
- **Submitted order forms not yet in production:** none are added separately. The order form's cascade creates their production orders on submit, so they're already in the open orders.
- **A PO without its advance paid** counts from today + its quoted days.
- **The old estimator is retired:**
  - the RDBOM-based predict, and the three lead-time hooks in production completion and purchase receiving
  - `ItemLeadTimeStats` (its data) and `utils/leadTimeStats.js` are left in place, unused

## Technical notes
- **Backend:** `services/estimate/`
  - `planner.js`: pure, the day-by-day plan
  - `history.js`: the usual numbers, people and calendar
  - `workList.js`: the order's cascade, free stock, open POs, work in hand
  - `numbers.js`: settings
  - `estimateService.js`: the estimate, item search, saving on a lead
- **Controller and routes:** `controllers/deliveryEstimateController.js`, `routes/deliveryEstimateRoutes.js`
  - `GET /items`, `POST /estimate`, `PUT /leads/:id`: need Sales orders view
  - `GET /settings`: Sales and the Company Admin; `PUT /settings`: the Company Admin only
- **Models:**
  - `DeliveryEstimateSettings` (new)
  - `usualHoursPerPiece` on BOM steps (`ProcessDefinitionSchema`), copied onto order steps
  - `usualPeople` on `MachineBOM`, `ChildPartBOM` and `Item.subChildPartDetails`
  - `ProcessCategoryOption.usualDays`
  - `Lead.deliveryEstimate` and `deliveryEstimateHistory` (the last 10; left out of the leads list)
- **R&D route:** `PUT /api/rd/process-category-options/:id/internal-processes/usual-days`.
- **Approval:** `stepsForChangeCheck` leaves usual hours out of "did the steps change?" at all three levels.
- **New indexes:**
  - `StepCrewEntry {company, partCode, joinedAt}`
  - `QCJob {company, source, decidedAt}`
  - `PurchaseRequest {companyId, materialCode, receivedAt}` and `{companyId, materialCode, status}`
- **Speed:**
  - Every read is batched and bounded; the planner takes about 60 ms.
  - A whole estimate takes about 2 s on the remote dev database: settings, people and the work list load side by side, and most of the time is network round-trips.
- **Client:**
  - `DeliveryEstimatorModal.jsx` (rewritten), `DeliveryEstimateExplain.jsx`
  - `Leads.jsx` (the Delivery column), `OrderFormModal.jsx` (the delivery date)
  - `ProcessDefinitionEditor.jsx`, `MachineBOMTab.jsx`, `ChildPartMasterTab.jsx`, `SubChildPartMasterTab.jsx`, `ProcessTemplateManagerDialog.jsx`
  - `pages/hrms/CompanyAdmin/DeliveryEstimateSettings.jsx`, plus its menu item and route

## Tests
**New suites:**
- **`estplan`, 37 (pure):**
  - the worked example exactly: Plate Wed 25, Body Thu 26, painting back Sun 29 and usable Mon 30, AC-10 Mon 30, likely **Wed 2 Dec**, 12 working days → buffer 2, commit **Fri 4 Dec**, delivered by Sun 6 Dec
  - what decided it, who it counted on
  - "Team One free today" → the Frame decides, dispatch Tue 1 Dec
  - 5 × AC-10: likely Wed 9 Dec, commit Sat 12 Dec. Ravi freeing up on 28 Nov changes nothing (the cap), and a cap of 3 gives Tue 8 Dec.
  - QC waits, unknowns, skills, sticky people, blocked work in hand frees people, attendance rate, leave, horizon, a bought item in stock, holidays
- **`estwork`, 35 (database):**
  - medians, the most people at once, shift hours, step hours from history vs typed, caps, routes
  - purchase median, job-work typed days, crew-history caps, step runs
  - case 3 jobs and quantities
  - the motor "only what's left" (−4 + 5 = 1, then buy)
  - a typed lead time, unknown raw material, case 0, partly in stock, missing usual hours
  - a motor sold as it is
  - work in hand: the steps left and sticky people
  - a for-stock order covering the machine, end to end
  - no attendance records → 100%
  - another company
- **`estimate`, 20 (server):**
  - settings: who can read and save, and checks
  - Sub Child Part usual people
  - job-work usual days: save and clear
  - item search, permissions, the estimate with the admin's travel days and buffer, a typed lead time
  - another company
  - saving on a lead, with history, and refused for another company

**Regression, all passing 18 Nov:** ba 23, makebuy-gate 18, makebuy-s1 17, approvals 38, crew 67, steptimes 28, planahead 20, labour 34, machinestock 69, stockorder 83, p3-time 18, material-ready 13, purchsep 76, qc-order 5, hrperms 33.

## Revision, 19 Nov: matching how Production really works
*Agreed 19 Nov after checking Orders, Process Execution, Manpower and Work Planning. Design: [01-logic.md §11](01-logic.md).*

### In one line
The estimate now plans the way Production really works.
- It goes step by step, unit by unit.
- A step's time depends on how many people are on it.
- It fixes one Production rule that held a whole Machine order back.

### What changed in the estimate
- **Time by number of people:**
  - A step's time for 1, 2, 3… people comes from Manpower's averages (stage 5): real runs with that many people first, else the work split evenly.
  - If people join mid-step, the rest of the step goes at the new speed. Example: 2 people start, 2 more join on the 28th, and the step finishes sooner.
- **R&D's typed hours** can now be shared by up to the part's usual people. Before, it was one person. These are marked "estimated".
- **Each step waits for its own material and parts, unit by unit** (Machine and Child Part):
  - Machine unit 1 can start when Body unit 1 is ready. It doesn't wait for Body unit 2.
  - Material that no step picks is needed at the first step.
  - A Sub Child Part is one batch, and its raw material holds its first step.
- **Job work in a row is one trip:** the longer of the usual days, not the days added up.
- **Urgent orders in hand go first,** then the earliest delivery date.
- **People Production planned on a step** are counted on that step.
- **A warning when a machine's BOM isn't approved:** "R&D hasn't approved its BOM yet…" (in amber). The date is still given.
- **Build Days are dropped** from the design. They were never built.

### What Sales sees
- **What decided it** now names the step, and can say a unit waited for a part. Example: "AC-10 unit 2 — assembly: waited for Body unit 2, ready Thu 26 Nov".
- **The BOM warning** shows above the result, in amber.
- **"Rough because"** says when typed hours were split evenly across people.
- **"How this date is worked out"** (English / Hinglish) has two new points:
  - step by step, unit by unit
  - time by number of people
  The "Who is free" point also mentions Urgent orders and planned people.

### The Production fix
- **Before:** on a Machine order, if **any** requested material was still waiting (even a top-up of bolts for unit 2), **no step on any unit** could start. Also, a top-up held the order back, but a first request for a new line didn't.
- **Now:** for orders built from the BOM's Process Definition, Start checks **only the material and parts that step picks, for that unit.** Child Parts already worked this way.
- **Unchanged:**
  - The BOM must still be approved.
  - Old fixed-step orders (Job Work / Assembly) keep their old check.
- **Follows by itself:** the Work Planning board and Order Tracking use the same rule.

### Where (for developers)
- **Server:**
  - `services/estimate/planner.js` (rewritten: time for N people, fractional progress, step needs per unit, one trip, planned crews, priority)
  - `services/estimate/history.js` (`stepTimes`, `usualCrew`)
  - `services/estimate/workList.js` (picks per step, planned crews, Urgent, the BOM warning)
  - `services/estimate/estimateService.js` (passes `warnings` on)
- **Production fix:**
  - `controllers/productionMfgController.js` (`isProcessDefinitionOrder`, `machineGate`)
  - `services/orderTracking/trackerService.js` (the list's quick check)
- **Client:** `DeliveryEstimatorModal.jsx`, `DeliveryEstimateExplain.jsx`

### Tests (19 Nov)
**Estimate suites:**
- **`estplan`, 53 (was 37):**
  - the 1-machine worked example is unchanged (Wed 2 Dec / Fri 4 Dec)
  - time by number of people from stage 5's table (welding: 1 → 4.5 h, 2 → 2.9 h, 3 → 1.7 h)
  - 1 person for 2 h then 2 people → 3.6 h in all
  - typed 8 h with a cap of 3 → 2.7 h
  - 2 people from 25 Nov, 4 from 28 Nov
  - machine unit 1 starts on Body unit 1
  - a late material holds only the step that picks it
  - job work in a row = one trip
  - Urgent first
  - a planned crew goes on its step
  - the 5-machine pins: Wed 9 Dec / Sat 12 Dec, and a cap of 3 → Tue 8 Dec
- **`estwork`, 45 (was 35):** section 6 covers:
  - picks mapped to steps (parts and material)
  - the Sub Child Part raw material on step 1
  - hours for N people, from history vs typed
  - Urgent, planned crews
  - the BOM warning, which the estimate passes on (and none when nothing is built)
- **`estimate`, 21 (was 20):** the answer carries the warnings list.

**The Production fix:**
- **`planboard`, 30 (was 21):**
  - the "material not issued" order is now an old fixed-step order
  - new section 5: a Process-Definition Machine order with a top-up waiting is Ready and starts
- **`ordertrack`, 70 (was 69):**
  - the old flag cases use old fixed-step orders
  - the same Process-Definition order reads "in the production queue"

**Regression, all passing 19 Nov:** crew 67, steptimes 28, planahead 20, teamcover 29, machinestock 69, stockorder 83, approvals 38, material-ready 13, s1 25.
- **Not from this change:** `s2` (the 30 Oct QC-photos suite) has 4 failures. Its rejections don't carry reject lines, which the 30–31 Oct reject breakdown (§68) made required. It never calls Start, and the QC code wasn't touched.

## Deep-test fixes, 19 Nov
*Found on test-1 after the fresh start ([06-deep-test-log.md](06-deep-test-log.md), B1 and B2; decisions in [01-logic.md §12](01-logic.md)).*
- **Attendance:**
  - Only days with an attendance record count now. A day with no record was counted as absent, so on test-1, with records on 7 days, everyone's working day shrank to almost nothing.
  - A person is measured from 20 recorded working days; before that, 100%.
  - The estimate says "measured for N of M people", or "not measured yet".
- **Buying time:** history replaces Purchase's typed lead time only from 3 receipts of the item. The same applies to the company-wide "raise → PO" time.
- **Where:** `services/estimate/history.js` (`MIN_HISTORY`, `MIN_ATTENDANCE_DAYS`, `purchaseDaysFor`, `peopleAndCalendar`), `estimateService.js` (the attendance text).
- **Tests:** `estwork` 49 (+4: 2 receipts don't count, 3 do; 5 recorded days = not measured; 18 of 20 recorded = 90% with no-record days ignored), `estimate` 21, `estplan` 53.

## Purchase owns "usual days to buy" and job-work time, 19 Nov
*Found in round 1 (06-deep-test-log B3). Design: [01-logic.md §13](01-logic.md).*

### What changed
**Before:**
- The estimate's last fallback for a material was the item's "Lead Time", but that box had been removed from the item form at the client's request (8 Aug). So nobody could type it.
- Job-work days were typed in R&D's process templates.

**Purchase → Inventory now has:**
- **A "Usual Days to Buy" column** beside Purchase Cost, on every item tab.
  - Under the box is what the estimate will use: "Estimate uses history: 3 days (3 receipts)", "uses a quote: 6 + 2 days to buy", "uses your number · 2 receipts so far (history from 3)", or "Not set".
  - **Save only saves what changed.** Saving only the days never re-prices the item, and never turns a "Last purchase" cost into an "Estimate".
- **A new "Job Work Time" tab.** One row per process sent out for job work, with:
  - the usual days away (editable)
  - the history figure ("3 days · 6 trips", or "2 trips so far")
  - which parts send it out
  - what the estimate uses
  - Saving writes the days to every category with that process, so two "painting" categories can't disagree.
- **Pages:** the item tabs now load 50 items at a time, with search in the database. Total Items and Total Stock Value come from the database.

**Also changed:**
- **R&D's process templates:** the "Usual days away when sent out" box is gone. The days already typed stay, and are edited from Purchase now.
- **The R&D item form** no longer sends the old lead time when it saves, so it can't overwrite Purchase's number.
- **The estimate's "can't estimate yet"** now says where to fix the number, e.g. "Purchase can type its usual days to buy on Purchase → Inventory". It adds "tick Purchase on the item first" when the item isn't listed there.

### Where (for developers)
- **Server:**
  - `services/purchaseDaysService.js` (new)
  - `services/estimate/history.js` (`receiptsByCode`, `jobworkHistory`)
  - `controllers/purchaseController.js` (paged list + `buyDays`, `updateUsualDaysToBuy`, `getJobWorkTime`, `setJobWorkTime`)
  - `routes/accountsRoutes.js`
  - R&D's route and `setInternalProcessUsualDays` removed
  - `services/estimate/workList.js` (message + `listed`)
- **Client:** `pages/accounts/PurchaseInventory.jsx`, `ProcessTemplateManagerDialog.jsx`, `SimpleInventoryForm.jsx`, `DeliveryEstimatorModal.jsx`

### Tests (19 Nov)
- **`purchdays`, 36 (new):**
  - pages and totals, including a fabrication item's stock value
  - what the estimate uses (history from 3 receipts, "2 so far", a quote + buying time, not set)
  - search
  - the usual-days rules, permissions and another company
  - a days-only save keeps the cost, its kind and the prices
  - Job Work Time: only processes sent out, used-by, duplicate categories saved together, clearing, history taking over at 3 trips, refusals
  - R&D's old route gone
- **`estimate` 21, `estwork` 49, `estplan` 53.**
- **Regression, 19 Nov:** all passing.
  - `purchase-cost` 13, `makebuy-gate` 18, `makebuy-s1` 17, `makebuy-s3` 9, `partprice` 20, `slice4-cost` 30, `purchsep` 76.
  - `makebuy-s2` 19, after a fixture fix. Its made-up company (written 6 Nov) had no Purchase person. Since the 16 Nov Purchase separation, "price needed" notices go to Purchase permission holders, so 3 checks failed until one was added. That's not from this change.

## Deep-test fix B4: QC after job work, 19 Nov
- **The bug:** a job-work (Out Source) step with a QC tick is checked when it comes back (Store receives → QC → Production), but the estimate ignored that QC, so the next step started the moment the work was back. In round 1 the Aata machine came out 4 days early (Sat 5 Dec instead of Wed 9 Dec).
- **Now:** a job-work step carries its QC tick, for the new order and for work in hand. The next step waits for the QC decision, using the usual QC wait from history, or the end of that working day.
- **Wording:** "lead time 3 days (typed)" now reads "Purchase's usual 3 days to buy".
- **Where:** `services/estimate/workList.js` (toStep, the work-in-hand steps, materialDate's wording).
- **Tests:** `estplan` 54 (+1: back Sat 21 with QC → next step Mon 23, without → Sat 21), `estwork` 49, `estimate` 21. Test-1's Aata machine × 1 now matches the hand-worked plan exactly (06-deep-test-log, run 1).

## Deep-test improvement I4: a short wait says it was hours, 19 Nov
- **Before:** a step that waited a few hours for people on the same day read like a mistake: "Chamber — coating: ready from Fri 4 Dec, but people are free only from Fri 4 Dec".
- **Now:** "Chamber — coating: waited 7 h on Fri 4 Dec for people to be free". A wait that crosses days is unchanged.
- **Also confirmed in run 2:** the people cap stays per order (decision N).
- **Where:** `services/estimate/planner.js` (explain: `waitHours`), `DeliveryEstimatorModal.jsx`.
- **Tests:** `estplan` 55 (+1). Test-1's Aata × 5 gives "waited 7 h", matching the hand working.
