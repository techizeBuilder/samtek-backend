# Feature 10: Performance score, HR's Manpower Score page and incentives (what changed)

*Built 13 November 2026, from the client meeting on 12 Nov. Logic, worked examples and your decisions A–K: [10-performance-score-logic.md](10-performance-score-logic.md). Browser test: [10-performance-score-test-roadmap.md](10-performance-score-test-roadmap.md).*

## In one line
**Efficiency is gone.** Each person and team now gets a **score out of 100**: 40% **timing** (planned hours against the hours the step took) and 60% **accuracy** (the QC pass rate). Production sees it and can **ask HR for an incentive**. HR sees every department's scores on a new **Manpower Score** page, decides the requests or gives one directly, and an approved incentive is **paid with that month's payroll**.

## How the score is worked out
- **Timing, per finished step** = planned ÷ took × 100, at most 110:
  - within 10% of the plan is **On time**, quicker is **Early**, slower is **Late**
  - a redo after a QC rejection doesn't count for timing
- **Accuracy** comes from the QC check after the step:
  - a unit that passes = 100, rejected = 0
  - a batch = pieces passed ÷ pieces checked × 100
- **One QC check judges every in-house step since the previous check.**
  - If drilling carries the check, the cutting before it gets drilling's result too.
  - The first result counts for everyone in that stretch.
  - **A redo** is judged by its own result, and only for the people who did the redo.
- **A check on an outsourced step judges the vendor, not us.** In-house steps with **no QC check after them** count for timing only.
- **Score** = 0.4 × timing + 0.6 × accuracy. With no QC result yet, it's timing only, marked *"no QC yet"*.
- **Each step counts by the person's hours on it.**
  - A crew of two at 3 h and 1 h shares a step ¾ and ¼.
  - A team's score uses its people's hours. Someone covering for a team (feature 8) counts for the team covered.
- **A score shows from 3 measured steps** in the period. Bands: **90+ Excellent, 75+ Good, 60+ Needs attention, below 60 Poor.**

Both pages have a **"How the score is worked out"** panel, in English or Hinglish (remembered on that browser).

## What Production sees (Production → Manpower)
- **Team cards:** *"Efficiency"* is now **"Score · this month"**, with the band and *"timing 93 · accuracy 71"*. The bar under it follows the band colour.
- **Member names on the cards** show *"· score 80"*.
- **The top tile** is now **"Avg team score · this month"**.
- **A new "Scores" tab,** next to Teams and Today:
  - **Period:** this month, last month, any month, or dates.
  - **People:** score, band, timing, accuracy, steps measured, hours; lowest score first (or highest), searched and paged on the server.
  - **Teams:** the same, per team.
  - **Click a person** to see every step behind the score: planned, took, Early / On time / Late, the QC result (and the check it came from, e.g. *"Rejected (at post painting)"*), accuracy, their hours, and their incentives.
  - **Request incentive** (needs Manpower edit): the month it's paid with, why, and an optional suggested amount. Only Production people can be put forward from here.
  - **Incentive requests:** each request's status (waiting for HR, approved with the amount, rejected with HR's reason).

## What HR sees (new: Manpower Score)
**HR menu → Manpower Score** (new HR permission **"Manpower Score"**):
- **Scores:**
  - **Department filter.** Today only Production's work is scored; another department's people appear here once their work is scored, with no change to this page.
  - **Period,** search, and lowest or highest score first, all paged on the server.
  - **Columns:** score, band, timing, accuracy, steps, hours and **days present**.
  - **Click a person** for their steps and incentives, and **Give incentive**.
- **Incentives** tab, showing *"(n waiting)"* when requests are waiting:
  - **Approve:** the amount comes prefilled from the suggestion, and the month can be changed.
  - **Reject:** a reason is required.
  - **Each row shows** who asked, the score at the time they asked, and the reason.
- **Give incentive** (top button) works for **anyone in the company,** in any department, with no request needed.
- **Notifications:**
  - a new request notifies HR, and opens the Incentives tab
  - HR's decision notifies the person who asked

## Payroll
- **An approved incentive is added to that month's pay:** net = earned pay **+ incentive** − PF, tax and other deductions. Two approved for the same month add up.
- **Payroll Run** has an **Incentive** column. The person's days panel has a line for it, and the pay explainer shows it in the formula.
- **The payslip** has an **"Incentive"** earnings row when it's above 0.
- **A month whose payroll is already run for that person can't take a new incentive:** *"Payroll for 2026-10 is already run for this person. Choose the next month."* A saved payroll is never changed.
- **Someone with no salary entered isn't paid that month, incentive included** (as before for pay).

## Permissions
- **New HR permission `manpowerScore`:**
  - view: the page
  - add: give an incentive
  - edit: approve or reject
- **New HR-Admins get it by default.** Existing HR-Admins were given it **once,** when the server started on 13 Nov (marked per user, so one a Company Admin removes later stays removed).
- **Production:** seeing scores needs Manpower view; asking for an incentive needs Manpower edit. Production can't decide incentives.

## Manpower page lists now paged (your check, 13 Nov)
Every list on Production → Manpower that grows is now **searched and paged on the server**:
- **Today:** 25 people a page, with a search by name or Employee ID. It used to load every Production person.
- **Skill Matrix:** 25 people a page, still grouped by team, with a search. It used to show every team member.
- **A team's history:** one row per step the team was on (unit shown), 20 a page, with the total. It used to stop silently at the 100 newest orders.
- **A person's score:** the steps behind it, 20 a page. The score itself still counts every step in the period.

**Not paged, on purpose:**
- **The team cards** (active teams only, a short list). **Each card's active assignments** is live open work.
- **The Scores tab's team table,** which is bounded by the number of teams.

**HR's Manpower Score page (checked the same day):**
- **Scores:** paged and searched on the server. The score has to be worked out for everyone before it can be sorted by score, so the server sorts first and sends one page.
- **Incentives tab:** paged, now also **searched by the person's name.**
- **A person's incentives in the score drawer** (HR and Production): **10 a page.** They used to stop at the latest 50.
- Production's **Incentive requests** card got the same name search.

**Already paged:** the Scores tab's people and incentive requests, and the people picker when building a team.

Technical:
- **Server:**
  - `todayBoard(companyId, { search, page, limit })` returns `{ people, total, page, limit }`
  - new `skillMatrixRows` in `productionTeamService.js` on `GET /production-mfg/teams/matrix`
  - `GET /teams/:teamId/history?page&limit` is now an aggregation giving step rows and a total
  - `personScore` takes `stepsPage` / `stepsLimit`
  - `listIncentives` takes `search` (person's name); new `personIncentives` (10 a page, `?incPage=`) on both person routes
- **Screens:** new shared `components/ListPager.jsx`.
- **Tests:** suite **`mpages`, 21 of 21.** Re-run after this change: `crew` 67, `teamcover` 29, `teams` 72, `score` 57. **`incentive` now 49** (name search on both lists, the drawer's incentive pages).

## Not changed
- **Teams, crews, hours, planned hours and labour cost.** The score only reads the finished steps (step runs) and QC results already saved.
- **Old finished steps with no planned hours** count for accuracy only, where a QC check judged them.

## Technical notes
**Server:**
- **New `services/score/scoreCalc.js`** (pure, no database): `timingPoints`, `timingBand`, `unitAccuracy`, `batchAccuracy`, `combine`, `aggregate` (hours-weighted, ≥ 3 steps), `judgingCheck` (the segment rule; a check on an Outsourcing step returns null).
- **New `services/score/scoreService.js`:**
  - `SOURCES = [productionSource]`: each department's work is a source; Production's reads `StepRun` in the range and the order's `QCJob` (matched on `qcJobSourceForOrder`), `unitChecks[unit].steps` or `batchSteps`
  - exports `scores` (paged; department / search / sort), `teamScores`, `scoreMaps` (for the cards), `personScore`, and `rangeOf` (month or dates, India days)
- **New `models/IncentiveRequest.js`** and **`services/incentiveService.js`:**
  - `requestIncentive`, `approveIncentive`, `rejectIncentive`, `giveIncentive`, `listIncentives`, `approvedForMonth`
  - refused: no reason, amount ≤ 0, a bad month, a month already run
- **Routes:**
  - **Production (`/api/production-mfg`):** `GET /teams/scores` and `GET /teams/scores/person/:personId` (manpower view); `GET /incentives` (manpower view: Production people only); `POST /incentives` (manpower edit).
  - **HR, new `routes/manpowerScore.routes.js` at `/api/manpower-score`:** `GET /`, `GET /person/:id`, `GET /incentives` (view); `PUT /incentives/:id/approve|reject` (edit); `POST /incentives` (add).
- **Removed:** `GET /teams/efficiency` and `crewService.efficiency()`. `getTeams` now fills `team.score` and each person's `score` (this month).
- **Payroll:**
  - `computePay(days, salary, incentive)`
  - `loadCompanyInputs` loads `approvedForMonth`
  - `Payroll.incentive`, `Payslips.incentive`, the payslip PDF row
- **Permission:** `manpowerScore` added to `HR_ADMIN_FEATURES`. New `grantHrFeatureOnce(key, stampField)` is called at startup (`hrManpowerScoreGrantedAt`).

**Screens:**
- **New shared `components/score/`:**
  - `ScoreParts.jsx`: score, band, period picker, the English / Hinglish panel
  - `PersonScoreDialog.jsx`
  - `IncentiveDialog.jsx`
- **New `components/production/ManpowerScores.jsx`** (the Scores tab). `ManpowerTracking.jsx`: score on the cards, and the tab.
- **New `pages/hrms/ManpowerScore/ManpowerScore.tsx`.** Wired into `config/moduleRoutes.js`, `pages/hrms/Layout.tsx` and `App.jsx`. `lib/roleModulesConfig.js` gets the new key.
- **`PayrollRun.tsx`:** the Incentive column and its line. `PayExplainer.tsx`: the formula.
- **`NotificationBell.jsx`:** an incentive notification opens HR's Incentives tab, or the requester's Manpower → Scores (`?view=scores`).
- **`ProcessExecution.jsx`:** the old Assign Team dialog (no longer opened) reads the score.

## Tests
- **New suite `score`: 57 of 57.**
  - **The doc's examples:** Ravi 93.2 / 70.5 / **79.6 Good**, Amit **74 Needs attention**; the cap at 110; the bands; "no QC yet"; fewer than 3 steps.
  - **Which check judges a step,** on the BOM shapes: SCP-007, CP-002, a vendor step between, a vendor check, no check, final QC.
  - **Through the real server, with made-up runs and QC results:**
    - Ravi's 79.6 from real runs; a step's QC from a later step (coating judged at post painting); cutting judged by drilling's first result
    - the redo judged by its own 4 of 4 and only for Priya; a check not decided yet; a vendor-checked step and an unchecked step as timing only
    - a QC job of another source with the same order number ignored; team scores from both people's hours; a crew of two shared by hours (last month)
    - paging, sort, search, dates, the cards (no efficiency), the old route gone
    - HR's page with the department filter; permissions; another company kept out
- **New suite `incentive`: 49 of 49.**
  - **The pay sum,** then Production asks: refused when view-only, for someone outside Production, with no reason, with an amount of 0, for a bad month, for a month already run, or for another company's person.
  - **HR is notified.** Another company's HR, Production and view-only HR can't decide.
  - **Approve ₹2000:** the Production Head is told, and the payroll preview's net goes up by exactly 2000; the Payroll Run row shows it.
  - **Reject** with a reason, which Production sees. **Give directly** to someone in Store.
  - **Two incentives for one month add up** (₹2300). The lists are paged and filtered.
  - **Run payroll:** the saved payroll keeps the incentive, then that month is closed to new ones, and a payroll already run is untouched.
- **Changed:**
  - **`hrperms`, 33:** the new key, matching on server and screen; the page's route guard; the one-time grant (kept, switched off stays off, Manager not given, removed stays removed).
  - **`crew`:** its efficiency section now checks the Scores route and that the cards carry a score.
- **Regression, all passing:** `payroll` 68, `hrroutes` 92, `crew` 67, `teams` 72. Not re-run: `teamcover` and `planahead`. Their code (`crewService.js`) only lost the unused efficiency function, and `crew` loads and exercises the same file.
