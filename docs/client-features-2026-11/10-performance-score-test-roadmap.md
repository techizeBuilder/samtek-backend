# Feature 10: Performance score, Manpower Score page and incentives (browser test)

*Written 13 November 2026, company test-1 on dev. What changed: [10-performance-score-changes.md](10-performance-score-changes.md). Do it on the same day as the stage 4–9 tests, **after** feature 9's roadmap: it uses their finished steps and that day's made-up attendance.*

## Where test-1 starts (after the stage 4–9 roadmaps)
- **ORD-2026-069** (Fan), unit 1:
  - **grinding is completed** (stage 5): Rahul Pramanik and Test Worker Two, planned 0.5 h
  - **coating is In Progress** (feature 9): Rahul Pramanik, planned 1 h
- **ORD-2026-089** (FB-01 Fan Blade, batch of 20): **drilling is completed** (feature 7): Rahul from T − 30, Test Worker Two from T − 20 to T − 10, planned 1 h. It waits for QC.
- **Rahul Pramanik has a salary** (stage 6).

**A score needs 3 measured steps this month,** so Rahul gets one in step 2, and Test Worker Two stays at "2 of 3 steps".

## Steps
### 1. Before any QC result
1. Log in as **Production Head** → **Manpower** → **Scores** tab.
   - [ ] **Rahul Pramanik** and **Test Worker Two** are listed with *"2 of 3 steps"*: grinding and drilling. No score yet.
   - [ ] Accuracy says **"no QC yet"** for both.
2. Click **Rahul Pramanik.**
   - [ ] The drawer lists **grinding** and **drilling**, each with Planned, Took, and **Early / On time / Late** and points. For example, planned 0.5 h and took 0.2 h shows **Early · 110** (capped).
   - [ ] **QC: "no QC"** on both for now.
3. Open **"How the score is worked out"** and switch to **Hinglish.**
   - [ ] The text changes. Close and reopen the page: Hinglish is remembered.

### 2. Finish coating, then QC decides
1. **Process Execution** → **ORD-2026-069** unit 1 → **coating** → **Mark Complete** (confirm the lunch list as usual).
2. Log in as **QC.** Open ORD-2026-069's QC job → **Unit 1** → **coating** → **Reject** it, with a reason.
3. Open ORD-2026-089's QC job → **drilling** → **18 passed, 2 rework** (with a reason).
4. Back as **Production Head** → **Manpower → Scores.**
   - [ ] **Rahul now has a score:** 3 steps, a band, and timing and accuracy beside it.
   - [ ] **Test Worker Two:** still *"2 of 3 steps"*, but now with an accuracy.
5. Click **Rahul.**
   - [ ] **drilling:** *"18 of 20 passed"* → **90**.
   - [ ] **coating:** *"Rejected"* → **0**.
   - [ ] **grinding:** if grinding has no QC check of its own, it shows *"Rejected (at coating)"* → **0**: the coating check judges the steps since the previous check. If grinding has its own check, it shows that result.
   - [ ] **The score** = 0.4 × timing + 0.6 × accuracy, each weighted by Rahul's hours on the step. Note the numbers to compare in step 3.
6. **Teams** tab.
   - [ ] **Team One A's card** shows **"Score · this month"**, or *"Not enough work yet"* and *"n of 3 steps"*. No "Efficiency" anywhere.
   - [ ] Rahul's name on the card shows **"· score …"**.
   - [ ] The top tile reads **"Avg team score · this month"**.

### 3. Production asks for an incentive
1. **Scores** → Rahul's row → **Request incentive.**
2. Leave the reason empty → **Send to HR.**
   - [ ] *"Say why they deserve it."*
3. Reason `Good drilling batch`, suggested amount `1500`, month: this month → **Send to HR.**
   - [ ] **Incentive requests** card: Rahul, *Requested*, *suggested ₹1,500*, paid with November 2026.
4. Do the same for **Test Worker Two,** reason `Stayed late`, no amount.

### 4. HR decides
1. Log in as **HR-Admin.**
   - [ ] **The bell** has *"Incentive requested — Rahul Pramanik"*. Clicking it opens **Manpower Score → Incentives**.
2. **HR menu → Manpower Score** → **Scores** tab.
   - [ ] **Department filter: Production (n).** Rahul and Test Worker Two show their department, steps, hours and **days present**.
   - [ ] **The same score as Production saw** in step 2.
3. **Incentives** tab, showing *"(2 waiting)"*.
   - [ ] Rahul's row shows the reason, *suggested ₹1,500*, the **score at the time** of asking, and who asked.
4. Rahul → **Approve.** The amount is prefilled at 1500; change it to `2000`. **Approve.**
   - [ ] **Approved, ₹2,000.**
5. Test Worker Two → **Reject** with no reason.
   - [ ] *"Say why it is rejected."*
6. Reason `Not enough work this month yet` → **Reject.**
7. **Give incentive** (top button) → type the name of someone in **another department** (a Store or Sales person) → amount `500`, reason `Stock count` → **Give.**
   - [ ] **Incentives**, filter **Approved / given:** the row says **Given by HR**.

### 5. Payroll
1. **Payroll → Payroll Run**, this month.
   - [ ] **Incentive column:** Rahul **₹2,000**. Net is ₹2,000 more than it would be without it.
   - [ ] **Click Rahul:** *"Incentive ₹2,000 added to the earned pay"*.
   - [ ] **The pay explainer** shows *"Net = earned + incentive − …"* (and in Hinglish).
2. *(Payroll runs only after the month ends, so the saved payroll and payslip are checked by the `incentive` suite, not here.)*

### 6. Production sees the outcome
1. As **Production Head** → **Manpower → Scores.**
   - [ ] **Incentive requests:** Rahul *Approved ₹2,000*; Test Worker Two *Rejected · Not enough work this month yet*.
   - [ ] **The bell:** *"Incentive approved — Rahul Pramanik"* and *"Incentive not approved — Test Worker Two"*.
   - [ ] **Rahul's drawer** lists the incentive.
2. **Today** tab → type `Rahul` in the search.
   - [ ] Only Rahul Pramanik is listed. Clear it: everyone is back. *(With fewer than 25 people there's no page bar; the `mpages` suite checks the pages.)*
3. **Teams** tab → **Skill Matrix** → search `Test`.
   - [ ] Only the matching people, still under their team's name.
4. Team One A's card → **View Full History.**
   - [ ] One row per step the team was on, with *(unit 2)* where it was on unit 2.

### 7. Permissions
1. As **Company Admin** → **Roles & Permissions** → the HR-Admin user → **HRMS.**
   - [ ] **"Manpower Score"** is listed and ticked.
2. Untick **view** for it, save, and log in as that HR-Admin again.
   - [ ] **Manpower Score is gone** from the menu. Tick it back.
3. As a **Production Employee** with Manpower **view** only:
   - [ ] The **Scores** tab is visible, with **no Request incentive** buttons.

## Not needed on screen
The `score` and `incentive` suites cover:
- **The doc's numbers:** Ravi 79.6, Amit 74.
- **The segment rule on real BOM shapes:** a vendor's check judging the vendor only; steps with no check after them as timing only.
- **A redo judged by its own result,** only for the redo crew.
- **A crew of two shared by hours.** Team scores, including a cover counting for the team covered.
- **Another company kept out.**
- **Refused:** a month already run, an amount of 0, someone outside Production.
- **Two incentives in a month adding up.**
- **Payroll run:** the saved payroll keeps the incentive, and the month then closes to new ones.

## Automatic results
| Suite | Result |
|---|---|
| `score`, new | 57 of 57, 0 left behind |
| `incentive`, new | 49 of 49, 0 left behind |
| `mpages`, new (Manpower lists paged) | 21 of 21 |
| `hrperms`, the new key and the one-time grant | 33 of 33 |
| `crew` (efficiency section → score), `payroll`, `hrroutes`, `teams` | 67, 68, 92, 72 |

## Browser results
**14 Nov 2026, test-1.** Run on the 13 Nov new-order runs: ORD-2026-114 drilling + redo, ORD-2026-089 drilling, ORD-2026-082 cutting → drilling. Not on this roadmap's orders.

**Production (Manpower):**
- **Team cards:** Team One **96.8 Excellent**, *"timing 110 · accuracy 88"*, with the bar. Team Two *"Not enough work yet, 2 of 3"*. Names: Rahul *score 93.6*, Test Worker Three *score 99*.
- **Team history:** every step the team was on (3 rows, so no pager).
- **Scores tab:**
  - people lowest first (Rahul 93.6, Three 99, then Five 2/3, Four 1/3, Two 2/3)
  - the Teams table
  - the English / Hinglish panel
- **Rahul's drawer:** cutting *"4 of 5 passed (at drilling)"* (the segment rule), all *Early · 110*, 3.5 days present.
- **Request incentive** for Test Worker Three (₹1,500 suggested). It shows *Requested* on the card.

**HR (testhr):**
- **The bell,** then **Scores** with the Department column and days present.
- **Incentives** *(1 waiting)*, Score then **99 Excellent**, Approved at **₹2,000**.
- **Payroll Run, Nov:** Test Worker Three Incentive **₹2,000**, net ₹3,248 (= ₹1,248 + ₹2,000). The days panel has the incentive line.
- **The Production Head's** "Incentive approved" bell (seen on data).

**Your questions:**
- **Team history** shows all steps, 20 a page.
- **Timing 110** is the cap: everyone was well under plan in these test runs.

**Polish after it:** notifications say "₹2,000" and "November 2026". The "–" in the Incentive column is grey. `incentive` 49/49.

**Not seen on screen:**
- Reject with a reason, and HR's Give incentive (the `incentive` suite covers both)
- an "On time" / "Late" step (the `score` suite covers both)
