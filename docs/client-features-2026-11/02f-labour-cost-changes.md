# Feature 2, stage 6: Labour cost into the price (what changed)

*Built 12 November 2026. Logic and your decisions: [02f-labour-cost-logic.md](02f-labour-cost-logic.md). Browser test: [02f-labour-cost-test-roadmap.md](02f-labour-cost-test-roadmap.md), done together with stages 4 and 5.*

## In one line
The production cost on a part's BOM is now **labour:** each crew member's hours × their rate from salary, worked out by the system. Production types only the **expense,** as before.

## Process Execution (Production)
- **Five dialogs ask the expense only:**
  - Mark Complete on the last in-house step
  - Complete on the true last step
  - Submit to QC on the last step, for a batch and for a unit
  - the self-certify Approve

  Each says *"Labour is worked out from the crew's hours, so only the expense is asked here."*
- **The unit's "Build cost" line:** *"Labour: from the crew's hours, shown on the BOM · Expense ₹20 · Job work …"*. ~~No labour ₹ on Production's screen.~~ **Since 13 Nov the Production Head sees "Labour so far ₹…" and "Total so far ₹…" here** (see Privacy).
- **An old screen still sending a cost** is ignored.
- **Not changed:** the old fixed-step Child Part Painting dialog (old-shape orders only).

## R&D: the BOM pages
**Child Part and Machine BOM pages:**
- **The summary card "Labour + expense",** with *"Labour ₹585 · expense ₹50"* under the total.
- **Someone with no salary:** *"Labour counted ₹0 for Suresh: no salary entered. Price provisional until HR enters it."*, in amber.
- **Added 14 Nov (your ask): a price that's provisional because of a part** shows under **Total Cost**: *"Price provisional because of a part: labour counted ₹0 for FB-01: Test Worker Two (no salary entered)."*
  - It also names bought parts with no purchase price yet.
  - It leaves out the page's own ₹0, which the line above already shows.
  - **Technical:** `PartsProvisionalNote` in `LabourExplain.jsx`, reading the item's `priceProvisional` that the BOM detail already sends. Before, it showed only on Product Master and in Sales.
- **The edit card "Labour & Expense":** **Labour estimate** (R&D's estimate before the first build) and **Production Expense**. The badge says *"Actual — labour from the crew's hours, expense from Production, last finished build"* or *"R&D Estimate — replaced once Production finishes a build"*.
- **A "How labour is worked out" panel** with an **English / Hinglish** toggle, remembered on the browser.

**The Sub Child Part master:** *"Labour + expense"* per piece, with labour and expense shown apart (*"Per piece: labour ₹69.88 + expense ₹5 · ORD-…"*), and the same amber line for a missing salary.

## Sales
**"Price provisional"** also says *"labour counted ₹0 for CP-001: Suresh (no salary entered)"*, where the mark already shows: Product Master, quotations, the order form and the new lead form. It only warns.

## HR
**Entering a salary for someone a finished build counted ₹0** prices that build again, if it still sets its part's cost, and the price push follows. A build a newer one has replaced is left alone. Any other salary change doesn't touch finished builds; the next build uses it.

## How it's worked out (logic §4–§6)
- **Rate** = monthly gross (basic + HRA + other allowance) ÷ that month's working days ÷ that day's shift hours (shift length − its lunch; 8 when no shifts are set).
- **Hours** are stage 5's: on the crew, while the step runs, while present, minus lunch.
- **Each step is priced once,** when its run is saved, with the salaries in force then.
- **A unit's labour** = the sum of its step runs. A Sub Child Part batch's is ÷ the pieces that finished.
- **Counted:** supervisors on the crew, rework rounds, and hours past the shift end (at the same rate).
- **It goes to the BOM at the same moment as before** (the true last step finishing), with the same "latest build wins" rule and the same price push.

## A fix found while building (stage 5)
- **Crews now close the moment their step finishes** (any save of the order), not when someone next opens a crew. Before, a QC pass re-stamps the finish time, so a crew opened only after the QC pass stretched everyone's hours over the QC wait.
- **A step whose crew was all taken off before it finished** now still gets its run saved when the build's cost is worked out.

## Privacy
- **No cost per person anywhere.**
- **Labour ₹ isn't sent to Process Execution:** not in the order or the crew panel. It's kept on each step run (server only) and the BOM.
- **Changed 13 Nov (your ask, during the browser test): the Production Head sees the order's labour.**
  - **Who:** only someone who can **edit Production orders** sees labour on the unit's (batch's) **Build cost** line: *"Labour so far ₹209.33 · 1 step finished · provisional: no salary for Test Worker Two · … · Total so far ₹359.33"* (labour + expense + job work).
  - **Why:** the BOM shows only the latest finished build, so it can't tell Production what *this* order has cost.
  - **Still kept private:** it's the order's total only, never per person or per step, because one person's cost ÷ their hours would show their pay. View-only Production users keep seeing hours only. The server leaves the number out for them.
  - `getUnitCost` adds `labour: { soFar, steps, missing }` via `unitLabour` when `userHasPermission(user, 'production', 'orders', 'edit')`. Suite `labour` is now 34: the Production Head gets ₹585 over 2 steps, with no per-step ₹ in the reply.

## A QC redo's expense (13 Nov, browser test)
**What happened:** submitting a redo asked for the production expense again, and the server **ignored** what was typed. It only reads the expense on the first submission. So the first ₹30 was safe, but a redo's real extra cost could never be recorded, and the dialog suggested otherwise.

**Now:**
- **The redo dialog says** *"This is a redo of drilling. Expense already entered: ₹30 by … Anything extra this redo cost is added to it; leave 0 if nothing."* The field is **"Extra expense for this redo"**, and it can stay empty.
- **An extra amount is added, never replaces.** The Build cost line shows *"Expense ₹40 (₹30 + ₹10 redo)"*.
- **Labour** was already safe: each round is its own run, and the order's labour is the sum. **Job work** is untouched.

**Technical:**
- `unitCosts[].expenseLog` (amount, by, at, redo)
- `partCostService.addProductionExpense` (`$inc` + log)
- the batch and unit Submit-to-QC routes add on a resubmission of the last in-house step when an expense is already entered
- `getUnitCost` returns `production.redoExtra`
- new suite `redoexpense` 9/9; `labour` 34, `slice4-cost` 30 and `gc` 40 re-run, all passing

## Technical notes
**Server:**
- **New pure `services/crew/labourCalc.js`:** `workingDaysIn`, `grossOf`, `hourlyRate`, `personLabour`.
- **`crewHoursCalc.js`:** `shiftHoursOf`; each day of `personStepHours` carries `shiftHours`.
- **`crewService.js`:** `priceRun` (in `recordRun`), `unitLabour`, `refillMissingLabour`. `efficiency` reads runs without labour.
- **`models/StepRun.js`:** `byPerson[].days / labour / missing`, the run's `labour`, and an index on `byPerson.person`.
- **`partCostService.js`:**
  - `pushPartCost`: production cost = `unitLabour`
  - `saveProductionExpense` / `productionExpenseOf` (were `saveProductionCost` / `productionCostOf`)
  - `onSalarySaved`
- **Models:** `labourMissing` on `ChildPartBOM`, `MachineBOM` and `Item.subChildPartDetails`; `Item.priceProvisional.labour`.
- **`models/ProductionOrder.js`:** a post-save hook closes finished crews.
- **`productionMfgController.js`:** expense-only asks. `getUnitCost` returns the expense and `labourOnBom`.
- **`salaryStructureController.js`:** add and update call `onSalarySaved`.
- **The provisional list:** `childPartBOMController.refreshAndComputeChildPart` and `machineBOMController.refreshMachineBOMChildParts` build the labour notes. `itemPricingService.getMachineBillingBOMCost` and `rdController` return them.

**Screens:**
- `ProcessExecution.jsx` and `ProductionContext.jsx`
- `ChildPartMasterTab.jsx`, `MachineBOMTab.jsx` and `SubChildPartMasterTab.jsx`
- new `components/production/LabourExplain.jsx`
- `utils/priceProvisional.js`

## Tests
- **New suite `labour`: 33 of 33,** through the real handlers, on made-up companies. Totals are worked by hand (logic §11):
  - **the rates:** 25 / 27 working days; ₹78, ₹65, ₹69.33, ₹57.78 and ₹72.22 an hour; 8 hours with no shifts
  - **the Fan:** ₹585 on the BOM with expense ₹50, and the ₹9,999 sent as a cost ignored
  - **the price push:** Fan ₹635, Machine ₹635, MRP ₹762; "Price provisional" naming Suresh on both
  - **frozen:** a salary doubled after the build, and a re-push, both keep ₹585
  - **Suresh's salary:** ₹715, the mark clears, the Machine goes to ₹765 / MRP ₹918
  - **rework:** ₹156 + ₹78 + ₹78 = ₹312
  - **the batch:** ₹279.50 ÷ 4 = ₹69.88 and ₹5 a piece, with the supervisor counted
  - **a missing salary on a build a newer one replaced:** the BOM keeps the newer one
  - **privacy:** no labour ₹ in the build cost line, the order or the crew panel; another company refused
- **Changed to the new rule:** `slice4-cost`, **30 of 30**. Its typed production costs now read as labour ₹0 (it has no crews); expense and job work unchanged.
- **Regression, all passing:**
  - `crew` 67, `partprice` 20, `purchase-cost` 13
  - `makebuy-s1` 17, `makebuy-s2` 19, `makebuy-s3` 9, `makebuy-s4` 10, `makebuy-gate` 18
  - `s1` 25, `gc` 40, `nosel` 46, `qc-order` 5, `ba` 23
  - `payroll` 68, `hrroutes` 92
  - `slice7` 31, `stale-atstore` 2, `dispatch-store-part2` 19, `partial-3a` 20, `partial-3c` 16
- **Screens compile:** Process Execution, the production context, the three BOM tabs, the explain panel and the provisional note.
