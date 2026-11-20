# Delivery estimate for Sales: browser test

*On test-1. What changed: [03-changes.md](03-changes.md). The suites `estplan` (53), `estwork` (45) and `estimate` (21) already check the sums; this is about the screens and real data.*

**Who plays whom:**
- **R&D Head:** usual hours and people
- **Company Admin:** Delivery Settings
- **a Sales person:** estimates
- **Production Head:** to compare with Manpower

**Note on test-1:**
- Most open orders have no planned hours and no history, so estimates there will be **Rough**. Test-1 has 31 open orders.
- Attendance is measured but low (few records), so dates come out late.
- That's the data, not the estimator. Step 6 checks a date by hand.

## 1. R&D: the usual numbers
1. Open a Machine BOM (a machine marked In-house Manufactured, e.g. Blower Pulverizer) → Process Definition.
   - Each In-House step has **"Usual hours per piece"**; type some. There's a **"Usual people working on this machine at once"** box; type 2.
   - Save. The product is **not** pulled back for approval.
2. Do the same on one of its Child Parts, and a Sub Child Part (the people box says "a batch").
3. *(Changed 19 Nov, §13: job-work days are Purchase's now.)* **Purchase → Inventory → Job Work Time**: type 3 for a job-work process, Save. Clear it again (empty), then put it back. R&D's process templates no longer have this box.
4. **Purchase → Inventory**, an item tab → **Usual Days to Buy**: type days for an item bought fewer than 3 times. It says "Estimate uses your number". An item with 3+ receipts says "Estimate uses history". Its cost and its "Last purchase" label don't change.

## 2. Company Admin: Delivery Settings
1. The menu has **Delivery Settings**. It shows 15% / 2 / 1 / 1 / 2 and "In use: the defaults".
2. Change the buffer to 20% and travel to 3 → Save. The example line changes; "saved by" shows your name.
3. Put them back (15 / 2 / 1 / 1 / 2).

## 3. Sales: the header button
1. Leads → **Estimate Delivery Date**. Search "motor" → add a motor, qty 1.
   - Travel days start at 2 → **Estimate**.
   - In stock: the likely date is tomorrow (packed today, dispatched tomorrow); commit = likely + 2 working days; delivered by = + 2.
2. Add an in-house machine (e.g. Blower Pulverizer).
   - **What decided it** lists the slowest things (a for-stock order, people, job work, material) and **counted on** (teams).
   - **How sure** is Good or Rough, with the reason. Open **How this date is worked out** and switch to Hinglish.
3. Add a machine whose steps have no usual hours. You get **"Can't estimate yet"**, naming the steps and saying R&D can fill them.
4. There's no "Use this date" here: the header is for looking.

## 4. Sales: from a lead
1. On a lead with a quotation, the card has a **Delivery** column: "Estimate" (or a date).
2. Click the calendar icon. The dialog opens with the quotation's items already in it. Estimate.
3. **Use this date** → "Saved on the lead". The card's Delivery column shows the date to commit (hover: likely, delivered by, who).
4. Estimate again with a different quantity → Use this date → it shows **"was {earlier date}"**.
5. Open the lead's **Order Form**: the Delivery Date starts at the saved "delivered by".

## 5. Permissions
1. A Production Employee (no Sales orders) can't use the estimate (403).
2. Sales can't open or change Delivery Settings. Sales reads the numbers through the estimate only.

## 6. Check one date by hand
- Pick one estimate. Compare "counted on" and the dates with Production → Manpower (who's on which order) and the open POs.
- Note anything that looks wrong; we'll trace it with the database script.

## 7. The 19 Nov revision (step by step, unit by unit)
1. **The BOM warning:** estimate a machine whose BOM R&D hasn't approved, with no free stock (so it's built).
   - An amber line says R&D hasn't approved its BOM yet.
   - A date is still given.
   - A bought motor alone shows no warning.
2. **What decided it names the step:** estimate 2 of an in-house machine with a Child Part.
   - The lines read like "AC-10 — assembly: ready from …, but people are free only from …".
   - Or, if a part decides it: "AC-10 unit 2 — assembly: waited for Body unit 2, ready …".
3. **Urgent first:** note the date for a machine.
   - In Production → Orders, mark an open order **Urgent** that uses the same people, then estimate again.
   - The date can only stay or move later, never earlier.
   - Put the priority back.
4. **Planned people:** in Work Planning, plan a person on a step of an open order. Estimate again: "counted on" may change.
5. **Rough because:** on a machine with only R&D's typed hours, "Rough because" says the hours were split evenly across people.
6. **How this date is worked out:** the new points "Step by step, unit by unit" and "Time by number of people", in English and Hinglish.

## 8. The Production fix (Start no longer waits for every line)
On a Machine order built from its Process Definition, with 2 units:
1. Issue the material that unit 1's first step picks, then request a **top-up** of some other line (it stays waiting).
2. Process Execution → unit 1 → put people on the first step → **Start**.
   - **It starts.** Before 19 Nov it said "All required materials have not been issued yet".
3. A step whose own picked material isn't issued still refuses, naming that material.
4. Work Planning shows the same: the step is under Ready / Planned, not Waiting.
5. Order Tracking (the Complaint team's page) no longer says "materials are being arranged" for that order.

## Log
| Step | Result | Notes |
|---|---|---|
| Regression after the 19 Nov revision | **Passed** 19 Nov | estplan 53, estwork 45, estimate 21; planboard 30, ordertrack 70 (fixtures updated for the Production fix); crew 67, steptimes 28, planahead 20, teamcover 29, machinestock 69, stockorder 83, approvals 38, material-ready 13, s1 25. s2 (the 30 Oct QC-photos suite) fails 4 on §68's required reject lines: old, not this change. test-1 read-only check: Aata machine, 3 in 1 cleaning, Blower Pulverizer (can't estimate: assemble and coating have no usual hours), the same as before. |
| Regression | **Passed** 18 Nov | After the build: ba 23, makebuy-gate 18, makebuy-s1 17, approvals 38, crew 67, steptimes 28, planahead 20, labour 34, machinestock 69, stockorder 83, p3-time 18, material-ready 13, purchsep 76, qc-order 5, hrperms 33 (menu bundle rebuilt). New: estplan 37, estwork 35, estimate 20. |
