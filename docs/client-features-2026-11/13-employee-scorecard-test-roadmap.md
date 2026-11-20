# Feature 13: The employee scorecard (browser test)

*On test-1. What changed: [13-employee-scorecard-changes.md](13-employee-scorecard-changes.md). The suite `scorecard` (83) already checks the sums; this is about the screens.*

**Who plays whom**
- **Company Admin:** settings.
- **Production Head:** Manpower, writing notes.
- **HR-Admin:** Employee Performance. A second HR person, or the Company Admin, to verify a note HR wrote.
- **QC:** a production reject.
- **People:** the Manpower people on the sweep's orders (ORD-2026-112..117), and one Store person.

## 1. The scorecard on Manpower
1. Production Head → Manpower → **Scores**, **This month**.
   - Each Production person: score, grade (A+ to E), the five group totals (A–E) and days present.
   - Someone with too few days shows "Not enough days yet".
2. Open the "How the score is worked out" panel.
   - The 13 parts with their points (the client's defaults).
   - The English / Hinglish switch works.
3. Click a person who worked on the sweep's orders.
   - **13 parts** with the counts behind them.
   - Six months of history.
   - Their finished steps with the QC result.
   - Note whether any part says "not measured" and why (e.g. no QC result yet).
4. Team cards (Teams tab): each team's score + grade, and each member's.
5. **Dates:** pick **Dates** and enter the 1st to the 10th of this month.
   - The list and a person's view count only those days. The view's header shows the dates.
   - The six months of history stay whole months.
6. **No attendance recorded:** someone who never marks attendance (e.g. a Production Employee with a login and no Device Code) shows **"· no attendance recorded"** under their name.
   - In their view, Attendance is greyed, "not measured: no attendance recorded".
   - They are not scored 0.

## 2. The QC grade
1. QC rejects a production unit step (or sends part of a batch to rework).
   - The reject form has **How bad is it? Minor / Major / Critical**.
   - Pick **Minor**.
2. The step's history shows "Reject (Minor)".
3. Once the step is redone and finished, the person's Accuracy counts the Minor as half a mistake.

## 3. Conduct notes
1. Production Head → Scores → **Note** on a worker:
   - Concern · Discipline · **Major**, today, with a reason.
   - "Send to HR".
   - It shows under **Conduct notes** as "Waiting for HR".
2. Try a note on someone from Store from Production. Not possible: only Production people are listed there.
3. HR → **Employee Performance**: the bell "Conduct note to verify" opens the **Conduct notes** tab, showing "(1 waiting)".
4. HR **Verifies** it.
   - The Production Head's bell says it was verified.
   - The worker's **Discipline** drops 5 → 2.5 for this month.
5. A second note: Behaviour · Minor, with a **photo**.
   - HR opens the photo from the tab.
   - HR **Rejects** it with a reason.
   - The writer sees the reason.
   - The score doesn't change.
6. HR **Cancels** the verified Discipline note with a reason. Discipline goes back to 5, and the note stays in the list as Cancelled.
7. HR writes a note on the Store person. HR **can't** verify their own note. The second HR person (or the Company Admin, if they have HR's page) verifies it.

## 4. Employee Performance (HR)
1. The menu says **Employee Performance**. The Scores tab lists **every department**.
2. The Store person: score out of fewer points ("of 46 pts measured"), with the five step parts greyed "not measured".
3. Department filter, search and Lowest / Highest first all work.
4. Incentives tab: works as before. **Score then** shows the grade.

## 5. Settings (Company Admin)
1. Company Admin → **Employee Performance Settings**.
   - The 13 points in their groups, total 100.
   - The three deductions.
   - "Applies from" = next month.
2. Change Attendance 10 → 12 and Learning 2 → 0.
   - Total 100.
   - Applies from **this month**.
   - Save. The history row shows your name.
3. Try **last month**. It's refused (a past month).
4. Try a total of 99. Save stays disabled.
5. HR's panel now shows Attendance (12) and no Learning for this month. **Last month's scores are unchanged.**
6. Put the client's defaults back (Client's defaults → Applies from this month → Save).

## 6. Incentive
1. Production Head requests an incentive for a worker.
2. HR's Incentives tab shows it with **Score then** and the grade.

## Not by browser (covered by the `scorecard` tests)
- Ravi / Amit / Meena worked totals; leave, holiday, half day, grace time; a step open past its plan
- the writer can't verify their own note; another company sees nothing
- the photo isn't public
- a version from this month leaving last month as it was

## Log
| Step | Result | Notes |
|---|---|---|
| 1.1 | **Passed** 17 Nov | The Scores tab matches the database person by person: Rahul 69.6 C, Five 77.2 B, Four 80 A (of 46), test production employee 82 A (of 46), Three 83.3 A, Two "Not enough days yet". A–E totals, days and steps match too. **Found and fixed:** older runs with two teams on one step (ORD-2026-114 drilling) gave each person's hours to their **current** team. So adding Rahul to the new Team One today (created 17 Nov after the old one was retired) moved his 13 Nov hours onto it (76.5 shown). Such runs now take each person's team from the step's crew list as it was then (a cover: the team covered). New runs already save it. `scorecard` 96 (+2 checks), `score`, `crew`, `teamcover` re-run and passing. |
| 1.2 | **Passed** 17 Nov | After the fix: Team Two A (retired) 78.6 B 0.8 h, Team Two 78.6 B 2.4 h, Team One (retired) 75.7 B 3 people 7.4 h. The new Team One is absent (no finished work yet). "Avg team score" tile 78.6. The panel shows the 13 parts with points in five groups, the 25/50/100% rule, grades, the no-attendance line and "client's defaults"; Hinglish works. Wording: "3 steps in the month" became "in the period" (Dates is back). |
| 1.3 | **Passed** 17 Nov | Rahul's view matches the database: 69.6 C; A 16.17/28 (attendance 4.5 of 7.5, punctuality 4 of 5, no delay 3 of 4), B 26.43/44 (accuracy 0, quality 82.7, productivity 67.9, task completion 4 finished), C/D full, E 4/5 (learning half). Only November in the history; 4 steps with QC results; no notes. **Raised:** accuracy 0/12 because each of his 3 batches had a few pieces sent back. |
| — | **Fixed 17 Nov** (your go-ahead) | Decisions Q–S (logic doc §16). **Q:** a batch counts the share of pieces sent back. **R:** steps count by planned size × share of the crew, not the hours they took. **S:** conduct and learning keep their own 28 points; only measured parts fill the other 72; nothing measured gives no score. test-1 now: Rahul 83.7 A (accuracy 9.76, no delay 6.26, productivity 10.17), Five 88 A, Three 87.8 A, Four 66.3 C (of 46), test production employee 69.9 C (of 46), Two "Not enough days yet". Teams: Team One (retired) 85.7 A, Team Two 77.2 B, Team Two A 77.1 B. `scorecard` 99, `score` 50, `mpages` 21, `incentive` 49, `crew` 67, `teamcover` 29. |
| 1.4 | **Passed** 17 Nov | Rahul's view after Q–S: 83.7 A "Excellent", accuracy 9.76 with "3 with some sent back (counted by the share sent back)", no delay 6.26, productivity 10.17. **Your question (does Finished steps grow?):** the list is the period's steps only, 20 a page on the server. **Found and fixed behind it:** steps left open past their plan were looked for in every order ever started. Now only orders with a step open at the period's end, and only steps the people asked for were on. New index on step runs (company + finish date). Same scores; `scorecard` 99, `score` 50. |
| 2.1–2.2 | **Passed** 18 Nov | QC-2026-0254 (ORD-2026-091, Sub Child Part batch of 10) → drilling → Review: Passed 8, Rework 2. The "How bad is it?" box showed up; Minor picked, reason "need finishing". History: "Passed: 8 · Rework: 2 · Scrap: 0 · Minor", decided by test qc head 18 Nov 10:14. 2.3 (Minor = half a mistake in Accuracy) is left to the `scorecard` suite, because ORD-2026-091 is from before crews. |
| 1.5 | **Passed** 18 Nov | Dates 1–10 Nov: header "Scorecard · 01 Nov 2026 – 10 Nov 2026", 5 people (Test Worker Two joined later), all as the database says: test production employee 72.3 B (A 11.3/18, days 2), Rahul "Not enough days yet" (A 10/18, days 1.5), Three / Four / Five "Nothing measured yet" with "· no attendance recorded". Teams: "No team work finished in this period". Rahul's view: header shows the dates, attendance "1.5 of 2.5 working days present", step parts "not measured: fewer than 3 finished steps in this period", six-month bars kept. **Fixed:** the "Not enough days yet" hint said "5 working days in the month"; now "in the period". This month's numbers moved overnight (live score, one more working day): Two 90.3 A+ (reached 5 eligible days), Rahul 83 A. |
| 1.6 | **Passed** 18 Nov | Test Worker Three, Dates 1–10 Nov: "No attendance recorded" tag in the header; Attendance greyed "not measured: no attendance recorded in this period (not on the device yet, or never marked)", Punctuality greyed "no days from the attendance device"; "Nothing measured yet", not a 0. C / D / E fixed parts full (18, 5, 4). |
| 3.1–3.2 | **Passed** 18 Nov | Production Head → Note on Rahul: Concern · Discipline · Major · 18 Nov · "late back from break twice" → Send to HR. Conduct notes: "1 waiting for HR", row "Waiting for HR · Rahul Pramanik · Major discipline concern". 3.2: the note is opened from a person's row and the Scores list holds Production people only; the server also refuses others ("Only people in Production can be noted from here."). |
| 3.3–3.4 | **Passed** 18 Nov | HR's bell: "Conduct note to verify — Rahul Pramanik". HR verified. Rahul's view: Discipline 2.5/5 "1 verified note · −2.5", group C 15.5/18, score 83 → **80.5 A**. Production Head's bell: "Conduct note verified — Rahul Pramanik". |
| 3.5 | **Passed** 18 Nov | Second note on Rahul: Minor behaviour concern "slacking off", with a photo. HR opened the photo and rejected it ("no witness"). The Production Head's list shows "Rejected … HR: no witness"; the score is unchanged. **Your question (are the notes / incentive lists paged?):** yes, both are paged and searched on the server, 10 a page; Previous / Next show only past 10. |
| 3.6 | **Passed** 18 Nov | HR cancelled the verified Discipline note ("explained, approved break"): it stays in the list, struck through "Cancelled", with the reason under "What happened". Rahul: Discipline back to 5/5, score 80.5 → 83 A. "Written by rahul" and "cancelled by rahul" are two people with the same full name: the Production Head (testproductionhead, EMP-TES-0012) wrote both notes; HR-Admin (testhr, EMP-TES-0008) verified, rejected and cancelled (checked in the DB). |
| — | **Fixed 18 Nov** (you found it) | HR's Department filter listed only Production: on test-1 only the 6 Production workers have a department set, the other 29 none. Now a person with none takes their role's department (Store Employee → Store…), with "No department" last for Manager / Employee / Auditor and roles whose department the company lacks. Notes and incentives save it the same way. test-1's filter: Accounts 3, Human Resources 1, Marketing 1, MIS 1, Packing and Dispatch 4, Production 7, Quality Control 2, R&D 2, Sales 4, Store 2, No department 7 (incl. the Complaint people: the department is named "complaint and service"). `scorecard` 108 (+9), `score`, `mpages`, `incentive`, `deptseed` pass. See the changes doc, "Added 18 Nov". |
| 3.7 (part) | **Passed** 18 Nov; **fixed** | HR noted test store employee (Minor safety concern, "no safety shoe"; the row shows "Store", from the role). HR's own Verify was refused: "Someone else must verify a note you wrote." **Found:** the Company Admin had no Employee Performance page, so with one HR person nobody could verify it; and the menu label "Employee Performance Settings" didn't fit. **Fixed:** Company Admin → Employee Performance (by role); HR's notes ring the Company Admin; the writer sees "Someone else verifies" instead of the buttons; the label is now "Performance Settings". `scorecard` 113, `mpages`, `incentive`, `hrperms` pass. |
| 3.7 | **Passed** 18 Nov | After the fix: HR's row shows "Someone else verifies", with no buttons. The Company Admin verified the note. The store employee's Safety & rules went 3 → **2.25** ("1 verified note · −0.75"), group E 3.25/5, "verified by Rahul Pramanik". **Wording fixed (you spotted it):** "Waiting for HR" became "Waiting to verify" on Employee Performance (Production's list keeps "Waiting for HR"). Also changed: the subtitle, the note box from that page ("Save note"), "Given directly" for incentives, and the writer's bell naming who decided. `scorecard` 113. |
| 4.1–4.2 | **Passed** 18 Nov | HR → Employee Performance: every department in the list and the filter (Accounts 3 … Store 2, No department 7), with the Department column filled in. "Of fewer points": Test Worker Four 65.7 C "of 46 pts measured" (A 9.7/18, B –). The store employee shows "Nothing measured yet": no attendance record and no steps leaves only the fixed parts (rules P + S), which is correct. The roadmap's "of 46" for the Store person assumed they mark attendance. |
| 5.1, 5.3, 5.4 | **Passed** 18 Nov | Settings page: 13 points in 5 groups (28 / 44 / 18 / 5 / 5), total 100, deductions 25 / 50 / 100, "Applies from" December, history "No changes yet". 5.3: the month picker greys out Jan–Oct, so a past month can't be picked (the server refusal is in the suite). 5.4: total 101 → Save disabled, "Whole numbers that add up to 100." The panel's "verified by HR" became "verified by HR or the Company Admin, never by the person who wrote it" (EN + Hinglish). 5.2 / 5.5 wait for the save. |
| 5.2 | **Passed** 18 Nov | Saved Attendance 12, Learning 0, from November 2026. History row: 18 Nov 2026 · Rahul Pramanik · November 2026 · 12 8 10 12 10 12 10 8 5 5 5 3 0 · 25/50/100. DB: November now uses the saved points (A out of 30, E 3/3): Rahul 83.1 A, Two 90.1 A+, Five 87.2 A, Three 86.8 A, test production employee 66.7 C, Four 63 C. October keeps the client's defaults. **Fixed:** the history's column heads were cut to 6 letters ("ATTEND", "PUNCTU", "NO", "LEARNI"); they're now readable short names (Attend., Punctual, No delay … Learning), with the full name on hover. |
| 5.5 | **Passed** 18 Nov | HR, Rahul's view, November: 83.1 A, A 19.02/30 (attendance 6.35/12, punctuality 6.4/8, no delay 6.26/10), B 38.07/44, C 18/18, D 5/5, E 3/3 with Learning greyed "set to 0 points". Matches the DB. October unchanged (client's defaults, checked in the DB). |
| 5.6 | **Passed** 18 Nov | Client's defaults saved again from November 2026 (and from December 2026), so test-1's history has 3 rows: Nov 12/0 → Dec defaults → Nov defaults, all 18 Nov, Rahul Pramanik. Rahul back to 83 A (A 17.96/28, attendance 5.29/10, learning 1/2, E 4/5). The new column heads read well (Attend. … Learning, "Notes −%"). |
| 6 (direct give) | **Seen** 18 Nov; **fixed** | HR's Give incentive on Test Worker Two (₹500, November, "best month"), done twice, 76 s apart (13:17:11 and 13:18:27 IST), so two approved rows, ₹1,000 in November's payroll. Both show Score then **90.3 A+** and "Given directly", as designed (feature 10 §8). **Fixed:** "Asked by testhr" (login id); names are now looked up (`incentive` 50, +1). The Give box says "Amount (required)". Test Worker Three's 14 Nov row shows "99 Excellent": a feature 10 snapshot, from before grades. Still to do: the Production Head's **Request incentive** → HR approves. **The second ₹500 (13:18:27) was deleted from test-1 at your ask**, so ₹500 is left for November. |
| 6 | **Passed** 18 Nov | The Production Head requested an incentive for Test Worker Three (₹1,500 suggested); HR's Incentives tab showed it with Score then **87.7 A**; HR approved ₹1,200, which went to the Company Admin under feature 15's cap, who approved ₹1,100. Paid in November's payroll preview (₹3,100 with the 14 Nov ₹2,000). |
| — | **Browser test COMPLETE 18 Nov** | Steps 1–6 passed. Fixes on the way are in the changes doc ("Added 18 Nov") and feature 15. |
