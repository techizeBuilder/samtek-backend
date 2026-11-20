# Feature 11: Work Planning board, Job Cards retired (browser test)

*Written 14 November 2026, company test-1 on dev. What changed: [11-work-planning-board-changes.md](11-work-planning-board-changes.md). Log in as **Production Head** (testproductionhead) unless a step says otherwise.*

## Where test-1 starts (14 Nov)
- **People in Production (6):** Rahul Pramanik (Team One), Test Worker Two, Four and Five (Team Two), Test Worker Three, test production employee.
- **Planned:** ORD-2026-112 (Machine IHT), unit 1, **pre painting**. Test Worker Four, Two and Five are on it with 1 h planned. Its material isn't issued, so Start would refuse it.
- **Ready:**
  - ORD-2026-069 (Child Part Fan), unit 1, **grinding**
  - **ORD-2026-118** (Sub Child Part Bracket SCP-007, a batch of 5, due 13 Nov), **cutting**. No QC on cutting; drilling after it has QC.
- **Waiting:** 33 steps.
  - 7 on material, e.g. PROD-2026-296498 assemble, ORD-2026-090 coating
  - 1 in QC: ORD-2026-091 drilling
  - 25 outsourced steps not requested yet
- **Finished today:** nothing yet.

## Steps
### 0. I add today's attendance (before you start)
On the day, I add made-up device rows for today, the same way as in the stage 5 test. The real device isn't touched.
- **Rahul Pramanik (`0001`)** and **Test Worker Two (`0002`):** in at 09:00, no punch-out yet.
- **test production employee (`0099`):** Absent.

Test inside the General shift's hours, so time on a step counts.

### 1. Job Cards is gone
1. Open the **Production** menu.
   - [ ] **Work Planning** is there. **Job Cards** isn't, in the top menu or the side list.
2. Type `localhost:5173/production/job-cards` in the address bar.
   - [ ] It opens **Work Planning**.

### 2. The board, first look
1. **Production → Work Planning.**
   - [ ] The title line reads today's date: *"Saturday, 14 November 2026: who is on what, what can start, what is stuck."*
2. **People today:**
   - [ ] **6 in Production · Present 2 · Working 0 · Planned only 3 · Free 1 · Absent 1 · Not punched in 3.**
   - [ ] **Free to plan: Rahul Pramanik.** Hovering shows Team One and his skills.
3. **Planned, not started (1):** ORD-2026-112 · unit 1, **pre painting**, planned 1 h.
   - [ ] The planned crew: Test Worker Four, Test Worker Two, Test Worker Five.
   - [ ] **Can it start?** In amber: *"Cannot start process: All required materials have not been issued yet."*
4. **Ready, nobody planned (2):** ORD-2026-069 · unit 1 grinding, and ORD-2026-118 cutting.
   - [ ] ORD-2026-118 reads **"Due 2026-11-13 · overdue"** in red.
   - [ ] **Not "overdue":** an order due today or later. The old page called today's deliveries overdue.
5. **Waiting (33):** groups with counts.
   - [ ] **Material not in Production 7.** Machine orders: "…All required materials have not been issued yet." ORD-2026-090 coating: "Material not yet received in Production: Bairing-ucp208, NUT Bolts."
   - [ ] **In QC 1:** ORD-2026-091 drilling, "drilling waits for QC's decision".
   - [ ] **Outsourced step not sent yet 25:** closed (more than 8). Click to open it.
6. **Finished today:** *"Nothing finished yet today."*

### 3. The board and Start agree
1. On ORD-2026-112 pre painting, click **Open**.
   - [ ] Process Execution opens at ORD-2026-112, unit 1.
2. **Start** pre painting.
   - [ ] Refused with the **same words** as the board: *"Cannot start process: All required materials have not been issued yet."*

### 3b. Unblocked for the test (done by me, 14 Nov, at your ask)
**What I changed, on dev only.** ORD-2026-112's real material route waits on the Fan cascade (ORD-2026-113 → ORD-2026-114), so I took a shortcut:
- **ORD-2026-112 marked "material issued"**, the flag Store's receive sets.
- **The Fan added to its Material List as received, 2 pieces.** The pre painting step uses the Fan as its own material, and Start checks that too. No Store stock moved, and no issue log was written.
- **Test Worker Four (`0004`) and Five (`0005`):** a made-up punch-in at 09:00, like Rahul and Test Worker Two.

Between the two changes, the board's reason changed to *"Material not yet received in Production: Fan."*, Start's next check. **The board now:**
- [ ] People today: **Present 4 · Working 0 · Planned only 3 · Free 1 · Absent 1 · Not punched in 1.**
- [ ] Planned: ORD-2026-112 unit 1 pre painting, **Can start** in green.
- [ ] Ready (3): ORD-2026-069 grinding, ORD-2026-118 cutting, and **ORD-2026-112 unit 2 pre painting.**
- [ ] **Ready and Waiting rows line up:** order, step, due date and button in fixed columns. Fixed 14 Nov after the first screenshots, where the step names sat at a different spot on each row.

### 4. Start the planned step
1. On ORD-2026-112 pre painting, click **Open** → **Start** → *Started now* → **Start.**
   - [ ] It starts, and **no note appears**. A "Not present today" note would mean someone on the crew hadn't punched in; all three have.
2. **Work Planning:**
   - [ ] **Running now:** ORD-2026-112 · unit 1, pre painting, Test Worker Four, Two and Five, since now, **0 h of 1 h**, blue bar.
   - [ ] **Planned, not started:** empty.
   - [ ] People today: **Working 3 · Planned only 0 · Free 1.**

### 5. Plan people from Ready
1. On **ORD-2026-118 cutting**, click **Plan people**.
   - [ ] Process Execution opens at ORD-2026-118.
2. On **cutting** → **Add people** → **Rahul Pramanik** → **Put on step.** Don't type planned hours yet.
3. Back on **Work Planning** (refresh, or wait up to a minute).
   - [ ] ORD-2026-118 cutting has moved from Ready to **Planned, not started**: crew Rahul Pramanik, *"planned hours not typed"*, *"Type the planned hours, then it can start"*.
   - [ ] People today: **Planned only 1 · Free 0**. Rahul is no longer under "Free to plan".
4. On Process Execution, type **Planned hours `1`** on cutting (click away so it saves). Back on Work Planning:
   - [ ] **Can start** in green.

### 6. Running, and over plan
1. On Process Execution, cutting → **Start** → **Started at**: **11:30** → **Start.**
   - test-1's General shift has lunch from 13:00 to 15:00, and hours stop for lunch. From 11:30, that leaves 1.5 h before lunch, so it's over the 1 h plan whenever you look.
2. **Work Planning → Running now:**
   - [ ] ORD-2026-118 cutting, crew Rahul Pramanik, **since** the time you typed.
   - [ ] **About 1.5 h of 1 h · over plan**, in red, with a full red bar.
   - [ ] People today: **Working 4 · Planned only 0 · Free 0**.

### 7. Print today's plan
1. **Print today's plan.** Look at the print preview; you don't need to print.
   - [ ] **Team One: work plan**, with the date: ORD-2026-118 · Bracket · cutting · **Running** · 1 h · Rahul Pramanik.
   - [ ] **Team Two: work plan:** ORD-2026-112 · in house test · 1 · pre painting · **Running** · 1 h · Test Worker Four, Two, Five.
   - [ ] A last block, **Ready, nobody planned:** ORD-2026-069 grinding and ORD-2026-112 unit 2 pre painting, with due dates.
   - [ ] **All three on one page** (1/1), because they fit. A block that doesn't fit moves whole to the next page.
   - [ ] **Nothing else prints:** no menu, filters or sections.

### 8. Filters and search
1. **Team: Team Two.**
   - [ ] Running shows only ORD-2026-112 pre painting. Rahul's cutting is Team One.
2. **Team: All teams**, **Kind: Sub Child Part.**
   - [ ] Only Sub Child Part orders: ORD-2026-118, ORD-2026-091 and others. No ORD-2026-112, no ORD-2026-069.
3. **Kind: All kinds**, search **`Test Worker Four`**.
   - [ ] Only ORD-2026-112 pre painting.
4. Search **`grinding`**.
   - [ ] Ready: ORD-2026-069 grinding. Clear the search.

### 9. Finished today
1. On Process Execution, **complete ORD-2026-118 cutting** as usual. It's a batch of 5, so it asks for pieces like the Fan Blade steps did.
2. **Complete ORD-2026-112 pre painting** too. It has no QC.
3. **Work Planning:**
   - [ ] **Finished today:**
     - ORD-2026-118 cutting, *at* the time, crew Rahul Pramanik: 1.5 h before lunch plus the time since 15:00, of 1 h, **Late**
     - ORD-2026-112 pre painting: its hours since 15:00, of 1 h. **Early** if completed before about 15:54 (under 0.9 h), On time up to about 16:06, Late after.
   - [ ] **Ready, nobody planned:** ORD-2026-118 **drilling**, and ORD-2026-112 unit 1 **post painting**.
   - [ ] People today: **Working 0 · Free 4**, everyone present back under "Free to plan".

### 10. Roles & Permissions
1. As **Company Admin** → **Roles & Permissions** → any role → **Production**.
   - [ ] **Work Planning** is listed. **Job Cards** isn't.

## Not needed on screen
The `planboard` suite covers:
- **The other waiting reasons:** BOM not verified, at the vendor, held at Store.
- **A later step planned ahead:** shown under Planned, blocked by the previous step, and Start refuses it too.
- **Finished today's band** on a made-up run: 2.4 h for 2 planned → Late.
- **No "Work Planning" view:** the board's address answers "no permission" (403).
- **Another company's orders** never show.
- **Start on a "ready" step** succeeds once a crew and planned hours are added.

Not covered anywhere yet: a cover's step on the printout. It prints under the team being covered. Check it the next time someone covers.

## Automatic results
| Suite | Result |
|---|---|
| `planboard`, new | 26 of 26, 0 left behind |
| `planahead`, `steptimes`, `crew`, `teamcover` (Start and crews) | 20, 28, 67, 29 |
| `slice7`, `stale-atstore`, `partial-3a`, `partial-3c`, `dispatch-store-part2`, `s1` (steps, Store, batches) | 31, 2, 20, 16, 19, 25 |

## Browser results
**14 Nov 2026, test-1, Production Head:**
- **Step 2 passed:** every count and row as listed: people, the IHT reason, Ready 2 with "overdue", Waiting 7 / 1 / 25, nothing finished.
- **Step 3:** Start was refused on the material, as the board said. ORD-2026-112 was then unblocked at your ask (3b).
- **Found and fixed:** Ready / Waiting step names sat at a different spot on each row; they now use fixed columns.
- **Step 3b passed:**
  - people Present 4 / Not punched in 1
  - IHT unit 1 pre painting **Can start**
  - unit 2 pre painting moved to Ready
  - Waiting 32 (material 6)
  - rows line up
- **Step 4 passed:** pre painting started (the Fan shows consumed 1, 1 left on the floor). The board shows it Running with Team Two's three, since 01:54 pm, 0 h of 1 h. Planned is empty. Working 3 · Planned only 0 · Free 1.
  - **It stays at 0 h until 15:00,** and that's right: it started inside the 13:00–15:00 lunch, and lunch hours don't count.
- **Step 5 passed:**
  - Rahul planned on ORD-2026-118 cutting: Planned 1, with "planned hours not typed" and "Type the planned hours, then it can start"
  - Working 3 · Planned only 1 · Free 0, "nobody free and present right now"
  - Ready down to 2
  - planned hours 1 → **Can start**
- **Step 6 passed:**
  - cutting started at 11:30, entered at 02:37 pm; Process Execution shows "So far 1.5 h", and no absent note
  - the board shows Running 2: cutting **1.5 h of 1 h · over plan**, in red with a red bar (11:30–13:00; lunch not counted), and pre painting 0 h of 1 h
  - Planned is empty; Working 4 · Planned only 0 · Free 0 (checked on the server)
- **Step 7 passed:** Team One (cutting, Running, 1 h, Rahul), Team Two (pre painting, Running, 1 h, the three) and Ready (grinding, unit 2 pre painting, with due dates). Only these printed.
  - **Changed at your ask:** they were on 3 pages, one each. Blocks now share a page while they fit; one that would be cut moves whole to the next page.
  - **Re-check found:** all three on page 1, but the preview still said 3 pages, 2 of them blank. The board was only made invisible, and invisible content still takes up space. **Fixed:** the plan prints on its own, outside the app's layout, and the rest is removed from the printout. **Re-check passed:** 1 page (by then only "Ready, nobody planned", with its 4 rows).
- **Step 8 passed:**
  - Team Two → only IHT pre painting
  - Sub Child Part → only ORD-2026-118 cutting
  - "Test Worker Four" → only IHT pre painting
  - "grinding" → only ORD-2026-069 in Ready
  - **Lunch seen working:** cutting 2.1 h (11:30–13:00 = 1.5, plus 15:00–15:36 = 0.6). Pre painting, started inside lunch, 0.6 h from 15:00.
- **Step 9 passed** (lunch confirmed "at the usual time" for all four):
  - **Finished today:**
    - IHT pre painting at 03:48 pm, **0.8 h of 1 h, Early** (15:00–15:48)
    - ORD-2026-118 cutting at 03:51 pm, **2.4 h of 1 h, Late** (1.5 + 0.85)
  - Ready 4: ORD-2026-118 drilling and IHT unit 1 post painting joined
  - Running and Planned empty, Waiting 32
  - Working 0 · Free 4, all four listed under "Free to plan"
- **Step 10 passed:** a user's Production permissions list Orders, Repair Production, Work Planning, Process & QC, Manpower, Expenses and LMS. No Job Cards.
- **The whole roadmap passed, 14 Nov.**
  - **Fixed during it:** Ready / Waiting rows on fixed columns; print blocks share a page; no blank pages after the plan.
  - **Not covered on screen:** a cover's step on the printout. The other gaps are covered by the suite (see "Not needed on screen").
- **Found on the way, separate changes** (both your asks):
  - Production → Orders search covers every tab (`docs/production/orders-search-all-tabs-2026-11.md`)
  - the Roles & Permissions role filter lists every role (`docs/roles-filter-all-roles-2026-11.md`)
