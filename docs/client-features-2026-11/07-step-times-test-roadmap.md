# Feature 7: The real time for start, finish, joining and leaving (browser test)

*Written 12 November 2026, company test-1 on dev. What changed: [07-step-times-changes.md](07-step-times-changes.md). Do it on the same day as the stage 4–6 tests, **after** stage 6's roadmap. It uses that day's made-up attendance, and Rahul Pramanik's drilling skill from stage 6 step 1.*

## Where test-1 starts
- **The order used:** **ORD-2026-089**, Sub Child Part **FB-01 Fan Blade**, a batch of 20. Laser cutting (outsourced) is done, and **drilling** (in-house, QC, the last step) is next. Nothing waits on material.
- **People:** Rahul Pramanik and Test Worker Two, both free, punched in at 09:00 (made-up).

Below, **T** means the time on your clock when you start step 1.

## Steps
### 1. Start late, with the real start time
1. Log in as **Production Head** → **Process Execution** → **ORD-2026-089** (Fan Blade) → **drilling**.
2. **Add people** → **Rahul Pramanik** → **Put on step.** Type `1` in Planned hours.
3. Click **Start.**
   - [ ] A dialog *"Start drilling"*, with **Started now** picked and **Started at** with a date and time box.
4. Pick **Started at** and type a time **after** the laser cutting finished, about 30 minutes ago (T − 30 min). **Start.**
   - [ ] drilling is **In Progress**.
   - [ ] Under the crew: *"Started {T − 30} · entered {T} by …"*.
   - [ ] Hovering on Rahul's name: *"since {T − 30} · entered {T}"*.
5. Optional: on another step, try a **Started at** in the future.
   - [ ] A red line *"It can't be in the future."* and the Start button stays off.

### 2. Someone who joined after the start
1. **Add people** → **Test Worker Two**.
   - [ ] Because the step is running, the dialog also shows **Joining now** / **Working since**.
2. Pick **Working since** and type a time **before** T − 30.
   - [ ] Red: *"It can't be before the step started …"*, and **Put on step** is off.
3. Change it to **T − 20 min.** **Put on step.**
   - [ ] Test Worker Two is on the crew. Hovering: *"since {T − 20} · entered …"*.

### 3. Someone who left before now
1. **Manpower → Today** → Test Worker Two's row → **Take off.**
   - [ ] A dialog *"Take Test Worker Two off drilling"*, with **Left now** / **Left at**.
2. Pick **Left at**, type **T − 10 min.** **Take off.**
   - [ ] Test Worker Two shows **Free**.
3. Back on Process Execution, click the **×** on Rahul.
   - [ ] The same *Left now / Left at* dialog. **Cancel:** Rahul stays on.

### 4. Finish late, with the real finish time
1. On drilling, click **Submit to QC.**
   - [ ] First, *"When did drilling finish?"*: **Finished now** / **Finished at**.
2. Pick **Finished at**, type **T − 5 min.** **Continue.**
   - [ ] If stage 5's long lunch covers this time, the lunch list appears and covers the step only up to T − 5. Confirm it.
   - [ ] Then the expense dialog (drilling is the last step). Type `0` → **Submit to QC.**
   - [ ] drilling is **QC Pending**, and shows *"Finished {T − 5} · entered … by …"*.

### 5. I check on dev
- **Rahul:** T − 30 → T − 5 = **25 minutes** on drilling, less any lunch inside it.
- **Test Worker Two:** T − 20 → T − 10 = **10 minutes**.
- The step's record keeps the times entered and who entered them.

## Not needed on screen
The `steptimes` suite covers:
- **Every refusal:**
  - a time in the future on all four actions
  - a start before the previous step finished, or before the order was made
  - a finish before the start, or before someone on the crew joined
  - working since before the start, or on a step not started
  - left at before joining
- **No double pay** for someone who was on another step.
- **A move with working since.**
- **The hours to the minute,** and the lunch list stopping at the finish.
- **A plain click** working as before.

## Automatic results
| Suite | Result |
|---|---|
| `steptimes`, new | 28 of 28, 0 left behind |
| `crew`, `labour` | 67, 33 |
| `slice4-cost`, `s1`, `gc`, `nosel`, `qc-order`, `jobwork-qc` | 30, 25, 40, 46, 5, 23 |
| `slice7`, `stale-atstore`, `dispatch-store-part2`, `partial-3a`, `partial-3c` | 31, 2, 19, 20, 16 |

## Browser results
**13 Nov 2026, test-1, on ORD-2026-114 drilling** (not this roadmap's order):
- **Start at a real time:** 13:50, entered 14:31.
- **Joining late:** Test Worker Two was added to the running step.
- **Left at:** 14:40. Typed within a minute of 14:40, so it counts as "now", with no "entered" stamp.
- **Working since:** 02:20 pm was moved to after his earlier time, so nothing is paid twice.
- **Fixed during it:** "Joining now / Working since" moved to the top of the Add people dialog (it was hidden below the list).
- **Not seen:** a back-dated **Finished at** (we used Finished now). The `steptimes` suite covers it.
