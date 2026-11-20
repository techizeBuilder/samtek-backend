# Feature 11: Work Planning as a daily planning board; Job Cards retired (what changed)

*Built 14 November 2026. Both pages were older than crews, planning, real step times and the score. You asked for my judgment, so the decisions are mine. Logic and decisions D1–D7: [11-work-planning-board-logic.md](11-work-planning-board-logic.md). Browser test: [11-work-planning-board-test-roadmap.md](11-work-planning-board-test-roadmap.md).*

## In one line
**Work Planning** is now a **today board**: who is where, what is running, what is planned and whether it can start, what could start with nobody on it, what is stuck and why, and what finished today. **Print today's plan** prints one page per team and replaces **Job Cards**, which is gone.

## What Production sees (Work Planning)
**Top:** today's date, **search** (order, part, step or person), a **kind** filter (Machine / Child Part / Sub Child Part), a **team** filter and **Print today's plan**. The page refreshes itself every minute.

**People today:** Present · Working · Planned only · Free · Absent · Not punched in, from today's attendance and the crews (the same as Manpower → Today). Then **Free to plan:** the people who are present and on nothing, with their team and skills on hover.

**Five sections. Every step of every open order lands in one of them:**

| Section | What's in it | What it shows |
|---|---|---|
| **Running now** | in-house steps In Progress | the crew (covers and borrowed people marked), since when, **hours so far of planned**, a bar, red with "over plan" when past it |
| **Planned, not started** | in-house steps someone is planned on | the planned crew, planned hours, and **Can start** in green or the reason it can't, in amber. With no planned hours: "Type the planned hours, then it can start" |
| **Ready, nobody planned** | a unit's next step: in-house, nothing blocks it, nobody on it | **Plan people** |
| **Waiting** | a unit's next step that can't move yet | grouped by reason, with a count each: Material not in Production · BOM not verified by R&D · Held at Store · In QC · At the vendor · Outsourced step not sent yet · Previous step not done |
| **Finished today** | steps completed today (India date) | took vs planned, **Early / On time / Late** (the score's bands; none on a redo, which is marked "redo"), the crew |

**Every row's Open or Plan people** goes to Process Execution at that order and unit. Planning stays there, in the crew panel and its rules (D7).

**Delivery dates:** "overdue" only once the India date is past the delivery date. The old page called orders due **today** "Overdue".

## "Can start" = Start's own checks
The board doesn't have its own idea of "can start". Start's checks are now small shared pieces, and the board runs the same ones, in the same order, with the same messages:
1. nothing for this unit held at Store
2. a Machine order: BOM verified, then material issued
3. the step's own material in Production
4. the previous step completed

So a "Can start" row starts, and a refused row shows Start's exact refusal. Start then needs someone on the crew and planned hours, as before.

**A Machine order's BOM tick:** Process Execution sets it the first time it opens an order whose BOM R&D has approved. The board does the same check, so "BOM not verified" means R&D really hasn't approved it.

## Print today's plan (replaces Job Cards)
- **A block per team:** "Team One: work plan" and the date, then the team's running and planned steps: order, part, unit, step, status, planned hours, people (covers and borrowed people marked).
- **A last block:** "Ready, nobody planned", with the due dates.
- **Blocks share a page while they fit** (your ask, 14 Nov; it first printed one page per block, three pages for three short lists):
  - a block that would be cut at the bottom of a page moves whole to the next page
  - a block longer than a page splits, with its heading row repeated
  - a title never sits alone at the bottom of a page
- Only these pages print. The menu and the rest of the screen don't.
- **The team of a step** is the step's own team. If it has none, or that team is retired, it's the team of the first crew member who isn't borrowed. A cover counts for the team it covers.

## Job Cards retired
- The **Job Cards** item is gone from the Production menu and the side list.
- Its **old address** opens Work Planning, also under Super Admin and Unit Head, so old bookmarks still land somewhere useful.
- The **Job Cards** permission is gone from Roles & Permissions and from the Unit Head defaults. Values already stored on users are ignored.
- **Work Planning keeps its permission:** "Work Planning", view. The board's server route checks it, so someone without it gets "no permission".

## Not changed
- **Start, planning and the crew panel** work as before. Their checks only moved into shared pieces.
- **Manpower → Today** is unchanged. The board's people strip counts the same way.

## Technical notes
**Server:**
- **`controllers/productionMfgController.js`:**
  - new exported `storeHold`, `machineGate`, `materialGate`, `prevStepGate`: Start's checks with their exact messages
  - new `startBlockers(order, unitIndex, idx, companyId)`: all four in Start's order → `{ key, message }` or null
  - new `unitProcessesView`
  - new `autoVerifyMachineOrder`: the same check as `getBomDesignStatus` → `applyAutoVerify`
  - `startProcess` calls the shared checks in its old order and keeps `materialLines` for the commit
  - new handler `getPlanningBoard`
- **New `services/planning/boardService.js`:** `board(companyId, { search, kind, team })`.
  - places every unit's steps; orders are checked side by side
  - `holdOf`: QC Pending, and the outsource statuses
  - running hours from `stepHoursSoFar`
  - finished from today's StepRuns, with `timingBand`
  - filters on the server; not paged (open work)
- **`services/crew/crewService.js`:** new `peopleToday` (counts, plus free and present people) and `stepHoursSoFar`.
- **`routes/productionMfgRoutes.js`:** `GET /planning/board`, `checkPermission('production', 'workPlanning', 'view')`.
- **`controllers/unitHeadUserController.js`:** the `jobCards` default removed.

**Screens:**
- **`pages/production/WorkPlanning.jsx`:** rewritten.
  - react-query, refreshed every 60 s
  - the print view is `#planning-print`, rendered straight into `<body>` (`createPortal`); its `@media print` block removes everything else (`display: none`), so no blank pages follow the plan
- **Job Cards removed:**
  - `ProductionModule.jsx`: the three `job-cards` routes → `<Redirect>` to `work-planning`
  - `config/moduleRoutes.js` and `ProductionLayout.jsx`: the menu items
  - `lib/roleModulesConfig.js`: the feature and its default
  - `pages/hrms/Profile.tsx`: its label
  - `pages/production/JobCards.jsx` deleted

## Tests
- **New suite `planboard`: 26 of 26, 0 left behind.** Through the real server, on a made-up company with two teams, seven Production people and made-up attendance for today. It checks:
  - **Sections:** one order for each case.
    - running, with hours so far
    - planned that can start, and planned on a later step (reason: the previous step)
    - ready
    - waiting for material, BOM, vendor, QC and Store
    - finished today, with its band
  - **People:** present / absent / not punched in / working / planned only / free, and the free list.
  - **Filters:** kind, team, search.
  - **Access:** another company's orders never show. 403 without "Work Planning" view.
  - **Parity:**
    - Start on a "ready" step succeeds once a crew and planned hours are added.
    - Start on a "material" step is refused with the board's exact text.
- **Regression for Start's checks, all passing:**
  - Start and crews: `planahead` 20, `steptimes` 28, `crew` 67, `teamcover` 29
  - steps, Store and batches: `slice7` 31, `stale-atstore` 2, `partial-3a` 20, `partial-3c` 16, `dispatch-store-part2` 19, `s1` 25
- **Screens compile:** Work Planning, ProductionModule, ProductionLayout, moduleRoutes, roleModulesConfig, Profile.
