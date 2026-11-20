*Approved 18 Nov 2026 in plan mode. The design and decisions are in [01-logic.md](01-logic.md).*

# Delivery estimate for Sales: build plan

## Context
Sales → Leads → **Estimate Delivery Date** was built before the BOM levels, procurement v2, outsource v2 and manpower. It reads the old `RDBOM` and the old PurchaseRequest lead-time hook, queues every open order one after another, and makes up 7 days when it knows nothing. The user wants a date Sales can commit to: a likely date plus a buffer, using real stock, open POs, job work and who is really free.

The design and every decision (A–W, travel days) were settled with the user part by part on 18 Nov. They're in `server/docs/delivery-estimate/01-logic.md`, the source of truth; this plan only says how to build it.

**In short:**
- **Two routes:**
  - **bought** (bought machines, motors): free stock → open PO → usual purchase time
  - **in-house:** the read-only cascade Machine → Child Part → Sub Child Part, cases 0, 1, 1b, 2, 3
- **Three clocks:** material, work and people, in a day-by-day **pretend plan**.
- **Work in hand first:** all confirmed work goes ahead (C). People stay with their order (P, the last 3 working days). Each part gets at most its **usual** crew (L, M, N).
- **The dates:** the likely dispatch date, plus a % buffer with a minimum (B) for the date to commit. Sales types travel days for "delivered by".
- **Saving:** "Use this date" saves on the lead and prefills the order form (I).

## Where things live
- **Backend:** a new `services/estimate/` with four files:
  - `numbers.js`: settings + typed numbers
  - `history.js`: the usual values from history
  - `workList.js`: what has to be bought or built
  - `planner.js`: the **pure** day-by-day plan
- **Controller and routes:** `controllers/deliveryEstimateController.js` and `routes/deliveryEstimateRoutes.js` are rewritten.
- **Client:** `components/sales/DeliveryEstimatorModal.jsx` is rewritten. New `components/sales/DeliveryEstimateExplain.jsx` (EN / Hinglish).
- **Docs:** `server/docs/delivery-estimate/`. This plan is saved there as `02-plan.md` once approved.

## Slice 1: the numbers going in
1. **Model fields** (all optional; empty = not typed):
   - `models/ProcessDefinitionSchema.js` `InternalProcessSchema`: `usualHoursPerPiece` (Number, > 0). Kept by `utils/processDefinitionValidation.js` `cleanProcessDefinition`. It is copied onto order steps where `ProcessStepSchema` copies other step fields, so open orders can use it (Q).
   - `models/MachineBOM.js`, `models/ChildPartBOM.js`, `models/Inventory.js` (the Sub Child Part item, which holds its own `processDefinition`): `usualPeople` (whole number ≥ 1) (M).
   - `models/ProcessCategoryOption.js`: `usualDays: [{ process: String, days: Number }]`: the job-work usual days per process (H).
2. **New model `models/DeliveryEstimateSettings.js`**, one per company:
   - `bufferPercent` (15), `bufferMinDays` (2)
   - `packingDays` (1), `dispatchDays` (1)
   - `travelDaysDefault` (2)
   - `savedBy` / `savedByName` / `updatedAt`
3. **Routes** `GET` / `PUT /api/delivery-estimate/settings`: the Company Admin saves (by role, like `scorecardSettings.routes.js`); anyone with Sales orders view can read.
4. **Client:**
   - **`components/inventory/ProcessDefinitionEditor.jsx`:** a "Usual hours per piece" box on InHouse steps, next to the QC toggle.
   - **The part forms:** a "Usual people at once" box on `MachineBOMTab.jsx`, `ChildPartMasterTab.jsx` and `SubChildPartMasterTab.jsx` (and `SubChildPartMasterInventoryTab.jsx`).
   - **`ProcessTemplateManagerDialog.jsx`:** "usual days if sent out" per process.
   - **The Company Admin page "Delivery Settings":** `pages/hrms/CompanyAdmin/DeliveryEstimateSettings.jsx`, plus a `moduleRoutes.js` Company Admin item and an `App.jsx` route.

## Slice 2: history (`services/estimate/history.js`)
**Every read is batched** with `$in` over all the part, item and process codes at once. There is **no query per item**, and every read is bounded to the last 10 runs or orders, or to 3 months.

| What | From | Rule |
|---|---|---|
| **Step hours** | `StepRun` by `{company, partCode, stepName}` (indexed) | `averageFor()` (`services/crew/crewHoursCalc.js`) **only when ≥ 3 non-rework runs**. Otherwise `usualHoursPerPiece` → the machine's `buildDays` (whole build) → unknown |
| **People cap** (usual and most) | `StepCrewEntry` by partCode, the last 10 orders: the most people at once on the order (from joinedAt / leftAt intervals), the usual = the average, rounded | Otherwise `usualPeople` → the part's biggest step crew → 1 |
| **Purchase days** | `PurchaseRequest` (item / materialCode, received) → end = the matching `QCJob` (source `Purchase`, `sourceRefId` = PO number, `itemCode`) `decidedAt` with Pass, else `receivedAt` | **Median of the last 10**, per size for fabrication (V), else the material. Otherwise the latest `VendorBid.deliveryDays` + the usual buying time (median of raise → PO) → `Item.leadTime` → unknown |
| **Job-work days** | `ProductionOrder.outsourceHandoffs`: `requestedAt` → the last round's `receivedAt`, by step name (H) | Median of the last 10, else `ProcessCategoryOption.usualDays`, else unknown |
| **QC wait** | `QCJob` production attempts: `submittedAt` → `decidedAt` (W) | Median of the last 10, in working hours. Otherwise the end of the same working day |
| **Attendance rate** | `Attendance` for production people over the last 3 months | Present ÷ working days by payroll's `dayKinds` (`services/payroll/payrollCalc.js`). No records → 1.0, flagged (G) |

**New indexes:**
- `StepCrewEntry {company, partCode, joinedAt: -1}`
- `PurchaseRequest {companyId, materialCode, receivedAt: -1}`
- `QCJob {company, source, decidedAt: -1}`

## Slice 3: what has to be built or bought (`services/estimate/workList.js`)
1. **The new order (read-only, nothing created or reserved):**
   - **For each item:** `isBought` / productKind decides the route.
   - **Bought:** the material ladder.
   - **In-house:** walk the cascade with `findMachineMaterialLines` (`services/machineReorderService.js`), `findSubChildPartMaterialLines` (`services/childPartReorderService.js`), the Sub Child Part item's source (`computeSubChildPartRawMaterialAvailability`, `services/subChildPartOrderService.js`), and the material groups (`plainMaterialGroupsFromBOM`, `lengthFabricationGroupsFromBOM`, `sheetMetalCutGroupsFromBOM`).
   - **Only the shortfall is built** at each level, and lower levels scale with it (Part 3's 5 × AC-10 table).
   - The result is a tree of **jobs** (part, qty, steps in order, its materials, its children).
2. **Free stock and "coming in"** (R, S, T):
   - **free:** `getFreeQty` (`services/materialReservationService.js`), which can be below 0
   - **open POs:** `PurchaseRequest` status `Ordered` + the PO line `expectedDeliveryDate`; no advance yet → quoted days + the usual advance days
   - **for-stock production orders:** their output, dated by the planner
   - Confirmed needs take their share earliest delivery date first; **the new order gets what's left.** Everything else is "to buy" on day 0 (O).
3. **Work in hand** (C, P, Q):
   - **What's included:** every open `ProductionOrder` (indexed by company + status). For each, the remaining steps: planned hours − hours so far (`stepHoursSoFar`, `services/crew/crewService.js`), else the usual hours, else Build Days, else **1 working day per step** → **Rough**, naming the order.
   - **Also:** submitted order-form items not yet in production.
   - **Who stays on it:** whoever is in its `StepCrewEntry` rows from the last 3 working days.

## Slice 4: the planner (`services/estimate/planner.js`, pure, no database)
**Input:**
- **people:** id, team, skills, working days with hours per day = shift − lunch (`shiftsOf`, `shiftHoursOf`) × attendance rate, with weekly offs, holidays and approved leave from payroll's inputs
- **jobs:** priority = delivery date, the new order last; cap; sticky people; steps with skill, person-hours, crew, job-work days, QC wait; the material-ready date; children

**Day by day, on working days:**
1. Jobs are taken in priority order.
2. A step is ready when the step before it is done, its children are ready, and its material is in.
3. A step gets its sticky people first, then free people with the skill (no skills recorded = any step, F), up to the step's crew and the job's cap (L).
4. Hours are used inside the day.
5. Job work finishes after N calendar days; if that lands on a day off, it's usable the next working day.
6. QC wait is applied.
7. Packing + dispatch days come last.

**The horizon is 1 year;** past it, "beyond a year".

**Output:**
- per item: the likely dispatch date
- the order's likely date = the latest of them (J)
- the buffer = max(min days, ⌈% × working days⌉) (B)
- the date to commit; "delivered by" = commit + travel days
- **what decided it** (the last-ready input per level, and the slowest step)
- **who it counted on** (team names + counts only, K)
- "could be faster with up to N" (the most)
- **how sure:** Good / Rough / **Can't estimate yet**, listing the unknown steps, materials and job work (E); no date in that case

## Slice 5: API, the screen, saving, retiring the old one
1. **API:**
   - `GET /api/delivery-estimate/items?search=&page=`: in-house machines, bought machines and motors
   - `POST /api/delivery-estimate/estimate {items: [{itemId, qty}], travelDays}`
   - `PUT /api/delivery-estimate/leads/:id`: save
   - All need Sales orders view, as today.
2. **`models/Lead.js`:** `deliveryEstimate` (the dates, travel days, items, what decided it, how sure, at / by / byName), plus `deliveryEstimateHistory` (the last 10) so a re-estimate can show what moved.
3. **Client:**
   - **The rewritten `DeliveryEstimatorModal.jsx`:** items + qty + travel days; the result as in 01-logic Part 8; the "How this date is worked out" panel (EN / Hinglish, `DeliveryEstimateExplain.jsx`). **"Use this date"** shows only when opened from a lead.
   - **`pages/sales/Leads.jsx`:** the header button stays (look only). Each lead gets **"Estimate delivery"**, prefilled from `lead.quotationItems`, and its card shows the saved "Delivery Fri 4 Dec (estimated 18 Nov)".
   - **`components/sales/OrderFormModal.jsx`:** `deliveryDate` starts as the lead's saved "delivered by" (the date to commit + travel days) when the form has none.
4. **Retire the old estimator:**
   - the old `predictItems` / `listEstimableItems`
   - the two `recordLeadTimeSample` hooks (`controllers/productionMfgController.js` ~2541, `controllers/purchaseRequestController.js` ~359)
   - `utils/leadTimeStats.js`
   - The `ItemLeadTimeStats` collection is left as it is: no data deleted.

## Tests
New suites in the scratchpad kit, run through `regress.sh`. Nothing is copied under `server/`. Made-up companies, `.invalid` email.
- **`estplan`** (pure, slice 4): the worked example from 01-logic **exactly**:
  - 1 × AC-10, case 3, today Wed 18 Nov → likely **Wed 2 Dec**, commit **Fri 4 Dec**
  - Team One free today → the **Frame decides**, dispatch **Tue 1 Dec**
  - 5 × AC-10 → the cap holds at 2, and Ravi on 28 Nov doesn't move the date
  - plus: Sunday returns, QC same day, the buffer minimum vs %, horizon, unknown step → "can't estimate"
- **`estwork`** (slices 2–3, through the database):
  - cases 0, 1, 1b, 2, 3 and a bought part
  - free stock below 0 + PO "only what's left" (2 + 5 − 6 = 1)
  - for-stock order output
  - medians (the 5…20 list → 7), per-size fallback
  - `averageFor` only at 3+ runs
  - people-cap history, sticky people from the last 3 days
  - unknown work in hand → 1 day per step, Rough
  - attendance rate and the no-records flag
- **`estimate`** (slices 1 and 5, through the server):
  - settings: the Company Admin saves, Sales reads, others refused
  - the R&D fields saved and cleaned
  - the estimate endpoint: Sales yes, others 403, another company sees nothing
  - save on the lead + history
  - the order-form prefill value
- **Regression:** `crew`, `steptimes`, `planahead`, `labour`, `payroll`, `ordertrack`, `qc-order`, `hrperms` (rebuild the menu bundle after the `moduleRoutes` change), plus whatever reads `processDefinition` (`ba-test` / R&D suites).

## Verification
1. All the suites above pass.
2. A read-only DB script on test-1 estimates 1 × a real machine and prints the breakdown. Check it by hand against open orders, open POs and crews.
3. **The browser test** follows `04-test-roadmap.md`:
   - R&D types usual hours / people
   - the Company Admin sets the buffer
   - Sales estimates from the header and from a lead, saves, and the order form prefills
   - a re-estimate shows what moved
4. **Docs:** `02-plan.md` (this), `03-changes.md` (plain language), `04-test-roadmap.md`, the folder README status, memory, and the daily report.
