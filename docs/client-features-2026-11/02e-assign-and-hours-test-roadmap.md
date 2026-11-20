# Feature 2, stage 5: Assigning work, hours and average time (browser test)

*Written 12 November 2026, company test-1 on dev. What changed: [02e-assign-and-hours-changes.md](02e-assign-and-hours-changes.md). Do this right after the stage 4 test ([02d-teams-from-people-test-roadmap.md](02d-teams-from-people-test-roadmap.md)): it starts where that one ends.*

## Where test-1 starts
**From the stage 4 test:**
- **Team One A:** Rahul Pramanik (`EMP-TES-0039`, no login, device code `0001`), skills welding and grinding, and test production employee (`EMP-TES-0024`, supervisor, device code `0099`), skill bearing assembly.
- **Test Worker Two** (`EMP-TES-0040`, device code `0002`) is in no team, because Team Two was retired.

**The orders used** (checked 12 Nov: nothing waiting on material, nothing held at Store):
- **ORD-2026-069:** Child Part **CP-001 Fan,** 2 units. On unit 1, welding (outsourced) is done and **grinding** is next.
- **ORD-2026-082:** Sub Child Part **SCP-007 Bracket,** one batch of 5. **cutting** is next.

**The two Machine orders aren't used:** Start is refused there because their material isn't all issued yet.

## Steps
### 0. I add today's attendance (before you start)
On the day of the test, I add made-up device rows for today, through the same code the real sync uses. The real device isn't touched.
- **Rahul Pramanik (`0001`):** in at 09:00, no punch-out yet.
- **Test Worker Two (`0002`):** in at 09:00, no punch-out yet.
- **test production employee (`0099`):** Absent.

With no punch-out, hours count up to now.

### 1. HR sets the shifts
1. Log in as HR-Admin **rahul** → **HR Policy** → **Attendance Policies** tab → **Edit Policy**.
2. Under **Shifts and lunch**, click **+ Add shift**:
   - **Name:** `General`
   - **Start:** 09:00. **End:** 20:00, or later if you test in the evening.
   - **Lunch:** from the start of the current hour to 2 hours later. For example, 15:00 to 17:00 if it's 15:20.

   This lunch is long only so the test step falls inside it.
3. **+ Add shift** again: `Night`, 21:00 to 06:00, lunch **07:00 to 07:30** (wrong on purpose). **Save.**
   - [ ] Refused: **"Night: lunch must fall inside the shift"**.
4. Change Night's lunch to **01:00 to 01:30**. **Save.**
   - [ ] The **Shifts and lunch** card shows "**General** 09:00–20:00 · lunch 15:00–17:00" (your times) and "**Night** 21:00–06:00 · lunch 01:00–01:30".

### 2. A second team, and skills
1. Log in as **Production Head** (`testproductionhead`) → **Production → Manpower**.
2. **Add Team:** `Team Three`, with **Test Worker Two**. **Add Team.**
3. On the Team Three card, **Skills** next to Test Worker Two: tick **grinding** and **cutting**. **Save Skills.**
   - [ ] Team One A's Process Skills: bearing assembly, grinding, welding.
   - [ ] Team Three's Process Skills: cutting, grinding.

### 3. The Today tab
1. Click **Today** at the top of Manpower.
   - [ ] **Rahul Pramanik:** Team One A · **Present 09:00 am** · **Free**, row in green.
   - [ ] **test production employee:** Team One A · **Absent** · Free.
   - [ ] **Test Worker Two:** Team Three · **Present 09:00 am** · **Free**, row in green.
   - [ ] **rahul, the Production Head,** isn't listed.

### 4. A whole team on a step, with someone absent
1. **Production → Process Execution** → **ORD-2026-069** (Fan), **Unit 1**. Look at step 2, **grinding**.
   - [ ] **"No one on this step"**, an **Add people** button, a **Planned hours** box saying "Type", and "No finished runs of this step yet".
   - [ ] **There's no Assign Team button.**
2. Click **Start** on grinding.
   - [ ] Refused: **"Put at least one person on grinding before starting it."**
3. **Add people** → **Whole team** → click **Team One A**.
   - [ ] "At least one person in the team needs the "grinding" skill."
   - [ ] "No finished runs of this step yet".
4. **Put on step.**
   - [ ] **"Added, but check attendance":** test production employee: **Absent**.
5. **OK.**
   - [ ] The crew shows **Rahul Pramanik**, and **test production employee** with a red **Absent** badge.

### 5. Take someone off, and borrow from another team
1. Click the **×** on test production employee.
   - [ ] Only Rahul Pramanik is left.
2. **Add people** → **People** tab → type `Test`.
   - [ ] **test production employee** is greyed: **Doesn't have the "grinding" skill.**
   - [ ] **Test Worker Two:** "Team Three (other team)", **Present**, **Free**.
3. Click **Test Worker Two**, then **Put on step.**
   - [ ] The crew shows Rahul Pramanik and **Test Worker Two "from Team Three"**.

### 6. Move someone to another step
1. Open **ORD-2026-082** (Bracket, a batch of 5). Step 1, **cutting**.
2. **Add people** → **People** → type `Test Worker`.
   - [ ] Test Worker Two: **"On ORD-2026-069 · grinding now (would be moved)"**.
3. Click them, then **Put on step.**
   - [ ] An amber box: **"Test Worker Two is on ORD-2026-069 · grinding. Move them here?"**
4. **Move them here.**
   - [ ] cutting's crew: Test Worker Two.
5. **Manpower → Today.**
   - [ ] **Test Worker Two:** ORD-2026-082 · Bracket · unit 1 · **cutting**, since now.
   - [ ] **Rahul Pramanik:** ORD-2026-069 · Fan · unit 1 · **grinding**.
6. On Rahul's row, click **Open.**
   - [ ] Process Execution opens ORD-2026-069 **unit 1**. grinding's crew is Rahul Pramanik only.
7. Back on **Manpower → Today**, click **Take off** on Test Worker Two and confirm.
   - [ ] Test Worker Two: **Free**.
8. **Process Execution → ORD-2026-069, unit 1 → grinding → Add people** → Test Worker Two (now "Free") → **Put on step.**
   - [ ] The crew again: Rahul Pramanik, Test Worker Two "from Team Three".

All of this happens before grinding starts, so it doesn't change grinding's hours.

### 7. Planned hours, and Start
1. Click **Start** on grinding.
   - [ ] Refused: **"Type the planned hours for grinding before starting it."**
2. Type `0.5` in **Planned hours** and press Enter. Click **Start.**
   - [ ] grinding is **In Progress**, with "Planned: 0.5 h".
   - [ ] **No "So far" hours yet.** That's right: it's inside the lunch you set in step 1, and the usual lunch counts until it's confirmed.

### 8. Complete, with the lunch list
Let grinding run for **at least 10 minutes,** so the hours show (they're rounded to 0.1 h).
1. Click **Mark Complete** on grinding.
   - [ ] **"Lunch during grinding"** opens with two lines: **Rahul Pramanik** and **Test Worker Two**. Each shows today's date, "General shift, usual lunch 15:00–17:00" (your times), and **At the usual time** already picked.
   - [ ] **test production employee isn't listed:** they were absent.
2. **Rahul Pramanik:** pick **Later** and type a time after you'll finish, for example 18:00 to 18:30. **Test Worker Two:** pick **No lunch**.
3. **Confirm and complete.**
   - [ ] grinding is **Completed**, and its crew line says **Finished**.
   - [ ] "Planned: 0.5 h · Actual: **X h** person-hours · took **Y h**, … under plan". X is about twice Y, because two people worked the whole time. For 10 minutes: Actual 0.3 h, took 0.2 h.

### 9. The average, next time
1. On the same order, switch to **Unit 2**. Look at **grinding**. It's locked because welding is still out, but Add people still works.
   - [ ] Beside Planned hours: **"About … h with 1 person, estimated: no runs with 1 person yet"**.
2. **Add people** → **People.** Click **Rahul Pramanik**.
   - [ ] "About … h with 1 person, estimated", about the Actual from step 8.
3. Also click **Test Worker Two**.
   - [ ] **"Usually … h with 2 people (1 run)"**, the "took" time from step 8.
4. **Cancel.**
   - [ ] Unit 2's grinding still says "No one on this step".

### 10. The score: not enough work yet
1. **Manpower → Teams.**
   - [ ] Team One A and Team Three say **Not enough work yet** under **Score · this month**, and no member shows a score: a score needs 3 measured steps. (Efficiency was replaced by the score on 13 Nov, feature 10.)

## After the test, I check
- The saved run for grinding: 2 people, crew size 2, planned 0.5, Team One A and Team Three.
- The lunch answers: Rahul "later", Test Worker Two "none", confirmed by the Production Head.

## Not needed on screen
The `crew` suite covers:
- **Hours to the quarter hour** across two days, the doc's 15 person-hours example.
- **Lunch:** "later" moving into the next step, "At the usual time", the night shift, and a General worker not charged the Morning lunch.
- **A missing punch-out** on a past day.
- **Averages:** only the last 10 runs, and rework kept out.
- **Efficiency** from 3 runs (replaced by the score on 13 Nov; the `score` suite covers it now).
- **Refusals:** a team without the skill, Store people, people in no team, another company, and view-only users.
- **The old assign-team route** filling the crew.

## Automatic results
| Suite | Result |
|---|---|
| `crew`, new | 67 of 67, 0 left behind |
| `slice7` | 31 of 31 |
| `stale-atstore` | 2 of 2 |
| `dispatch-store-part2` | 19 of 19 |
| `partial-3a` | 20 of 20 |
| `partial-3c` | 16 of 16 |
| `slice4-cost` | 30 of 30 |
| `teams` | 72 of 72 |
| `payroll` | 68 of 68 |
| `hrroutes` | 92 of 92 |

## Browser results
**13 Nov 2026, run on the sweep's new orders, not on this roadmap's orders** (your choice: test on new orders).
- **Setup:** done by me through the real routes. Three new no-login workers; Team One (Rahul Pramanik's) and Team Two (Test Worker Four's); skills; today's attendance, with test production employee absent.
- **The job:** Fan Blade **ORD-2026-114** × 12. Laser cutting went out and back on OSO-0040, then **drilling** was done in-house.

**Passed:**
- **Shifts** on the Attendance Policy: General 09:00–20:00 with a 13:00–15:00 lunch, and Night with its lunch refusal.
- **The crew:**
  - Whole team Team One, with the absent member shown and **Replace** by Test Worker Five (feature 8)
  - "Planned:" before Start; Start refused without planned hours; **back-dated Start** 13:50 (feature 7)
- **Joining and leaving:**
  - a late joiner and a **Left at** take-off
  - rejoining with **Working since 14:20**, moved to after his earlier time (no double pay)
- **The Today tab.**
- **Submit to QC, with the lunch list:** Later / No lunch / Later inside the step / No lunch.
- **The saved run:** took **1.17 h** of 2 planned, **3.47 person-hours**. Hours per person: Rahul 1.17, Three 1.17, Five 0.67 (lunch off), Two 0.45. Team One 3.02 h (the cover counts for it), Team Two 0.45 h.
- **The QC wait doesn't count:** everyone's time ended at Submit to QC.
- **QC 10/12 with 2 rework → redo** by Test Worker Three (Working since) → QC 2/2 → batch Completed.
- **The redo run:** 1.52 h, marked rework, Three only, labour ₹105.29. **Labour total ₹314.62.**
- **Price push:** FB-01 per piece = labour ₹26.22 + expense ₹3.33 (₹40 = ₹30 + ₹10 redo) + job work ₹10 + material ₹3.63. CP-001, IHT and BP816 re-priced, marked **"Price provisional: FB-01: Test Worker Two"**.

**Fixed / changed during the test (your asks or findings):**
- Attendance Policy form scrolls as one
- "Joining now / Working since" moved to the top of Add people
- the Production Head sees "Labour so far / Total so far" on the Build cost line
- no finishing a round that nobody worked
- the rework shows its quantity; the redo estimate is for the pieces sent back
- a redo's extra expense is added, never replaces
- a redo run records the pieces it redid

**Not seen in this run:** Skills editing on Manpower, Retire, and the R&D rename (stage 4 steps 5–8). The setup was done by API at your choice.
