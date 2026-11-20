# Feature 2, stage 6: Labour cost into the price (browser test)

*Written 12 November 2026, company test-1 on dev. What changed: [02f-labour-cost-changes.md](02f-labour-cost-changes.md). Do this **the same day, right after** the stage 5 test ([02e-assign-and-hours-test-roadmap.md](02e-assign-and-hours-test-roadmap.md)): it reuses that day's made-up attendance and shifts.*

## Where test-1 starts
- **Salaries (from the payroll test):** Rahul Pramanik has one (gross ₹15,600). **Test Worker Two has none, on purpose:** that's the "Price provisional" case.
- **The order used:** **ORD-2026-082**, Sub Child Part **SCP-007 Bracket**, a batch of 5. **cutting** (no QC), then **drilling** (QC, the last step). Stage 5's move test left cutting with no one on it.
- **Rahul's rate on the test day:** ₹15,600 ÷ 25 working days = ₹624 a day.
  - With stage 5's test shift (09:00–20:00 with a 2-hour lunch = 9 working hours), **₹69.33 an hour**.
  - Your exact times change this. I check the figures on dev after.

## Steps
### 1. Rahul needs the drilling skill
1. Log in as **Production Head** → **Production → Manpower**. On Team One A, click **Skills** next to Rahul Pramanik.
2. Tick **drilling**. **Save Skills.**

### 2. cutting on the Bracket batch
1. **Process Execution** → **ORD-2026-082** (Bracket) → **cutting** → **Add people** → **Rahul Pramanik** and **Test Worker Two** → **Put on step.**
2. Type `0.5` in Planned hours → **Start.** Let it run for **at least 10 minutes.**
3. **Mark Complete.**
   - [ ] **No expense is asked:** cutting isn't the last in-house step.
   - [ ] If stage 5's long lunch is still on, the lunch list comes back with your stage 5 answers already picked (Rahul: Later, Test Worker Two: No lunch). **Confirm and complete.**
   - [ ] cutting is **Completed**, with "Actual: … person-hours".

### 3. drilling, the last step
1. **drilling** → **Add people** → **Rahul Pramanik** → **Put on step.** Planned hours `0.5` → **Start.** Wait **at least 10 minutes.**
2. Click **Submit to QC.**
   - [ ] The dialog asks **Production Expense only,** with *"Labour is worked out from the crew's hours, so only the expense is asked here."*
3. Type `20` → **Submit to QC.**
   - [ ] The **Build cost** line: *"Labour: from the crew's hours, shown on the BOM · Expense ₹20 · …"*. **No labour ₹ anywhere on this page.**

### 4. QC passes 4 and scraps 1
1. Log in as **QC Head** → the Bracket batch's **drilling** check → mark the checklist → **4 passed, 1 scrap** (reason: anything) → submit.

### 5. The labour on the Sub Child Part
1. Log in as **R&D Head** → **BOM Management → Sub Child Part** → open **SCP-007 Bracket**.
   - [ ] **Labour + expense** per piece, with *"Per piece: labour ₹… + expense ₹5 · ORD-2026-082"*. The expense is ₹20 ÷ 4 finished.
   - [ ] **Amber:** *"Labour counted ₹0 for Test Worker Two: no salary entered. Price provisional until HR enters it."*
   - Labour per piece = (Rahul's hours on cutting + drilling) × his rate ÷ 4. Test Worker Two counts ₹0. I check the exact number on dev.
2. **How labour is worked out** (on a Child Part or Machine BOM page, step 7) → click it.
   - [ ] English text, and a **Hinglish** button. Switch to Hinglish, reload the page, open it again: **still Hinglish.**

### 6. HR enters Test Worker Two's salary
1. Log in as HR-Admin **rahul** → **Payroll → Salary Structure** → **Add**: Test Worker Two, **Basic 13,000**, the rest 0. Save.
2. Back as **R&D Head**, reload SCP-007.
   - [ ] **The amber line is gone.**
   - [ ] Labour per piece went up by Test Worker Two's cutting hours × ₹13,000 ÷ 25 ÷ (the shift hours) ÷ 4.

### 7. The BOM pages
1. **R&D → BOM Management → Child Part** → **Bracket kit (CP-004)**.
   - [ ] The summary card says **"Labour + expense"**, with *"Labour ₹… · expense ₹…"* under it.
   - [ ] The edit card **"Labour & Expense"**: **Labour estimate** and **Production Expense**, with the **R&D Estimate** badge (CP-004 hasn't been built through a crew yet).
   - [ ] Its Bracket line now prices in SCP-007's labour.
2. Open the **How labour is worked out** panel here for step 5.2's check.

## Not needed on screen
The `labour` suite covers:
- **The hand-worked figures:** ₹585 for the Fan, ₹715 after Suresh's salary, the rework +₹78, a 9-hour shift at ₹57.78, and the batch at ₹69.88.
- **The price push** to a Machine's MRP, and "Price provisional" on the Child Part and its Machine.
- **A salary entered** for a build a newer one replaced: nothing changes.
- **Frozen:** a salary changed after a build, and a re-push of the same build.
- **Privacy:** the order and the crew panel never carry labour ₹, and another company is refused.

## Automatic results
| Suite | Result |
|---|---|
| `labour`, new | 33 of 33, 0 left behind |
| `slice4-cost`, changed to the new rule | 30 of 30 |
| `crew` | 67 of 67 |
| `partprice`, `purchase-cost` | 20, 13 |
| `makebuy-s1`, `-s2`, `-s3`, `-s4`, `-gate` | 17, 19, 9, 10, 18 |
| `s1`, `gc`, `nosel`, `qc-order`, `ba` | 25, 40, 46, 5, 23 |
| `payroll`, `hrroutes` | 68, 92 |
| `slice7`, `stale-atstore`, `dispatch-store-part2`, `partial-3a`, `partial-3c` | 31, 2, 19, 20, 16 |

## Browser results
**13–14 Nov 2026, test-1, on the new orders** (ORD-2026-114, -089, -082). Not on this roadmap's orders.
- **Pricing per step (13 Nov):**
  - ₹69.33 an hour on the 13 Nov shift (₹15,600 ÷ 25 working days ÷ 9 h)
  - the first run ₹209.33, and the redo ₹105.29 added on top
  - Test Worker Two counted ₹0, so it was provisional
  - the Fan Blade price pushed to the Fan, IHT and BP816
- **Screens (14 Nov):**
  - **Fan Blade:** labour + expense per piece (₹0.86 + ₹2.78, from ORD-2026-089) with the amber no-salary line.
  - **Fan, IHT and BP816:** the BOM cost cards ("Actual" vs "R&D Estimate") and the English / Hinglish panel.
  - **Sales:** "Price provisional" on the new-lead machine list and the quotation.
  - **Added at your ask:** "Price provisional because of a part: … FB-01: Test Worker Two" under Total Cost on the Child Part and Machine BOM pages.
- **HR entered Test Worker Two's salary:**
  - his ₹0 hours were priced: ₹7.75 on ORD-2026-089, ₹31.26 on ORD-2026-114
  - Fan Blade labour ₹0.86 → ₹1.29 per piece
  - Fan / IHT ₹1,351.32 → ₹1,353.90; BP816 ₹2,099.90 → ₹2,102.48 (MRP ₹2,522.98)
  - every provisional mark gone
  - ORD-2026-114 no longer sets the Fan Blade's price (ORD-2026-089 is later), so only its run changed
- **Not seen:**
  - a Machine build with labour from crews (IHT / BP816 not built yet)
  - Production's own expense on a Child Part build
