# Feature 2, stage 4: Teams from people (browser test)

*Written 11 November 2026, company test-1 on dev. What changed: [02d-teams-from-people-changes.md](02d-teams-from-people-changes.md).*

**Who's in test-1's Production department now:** Rahul Pramanik (`EMP-TES-0039`, Manpower, no login) and Test Worker Two (`EMP-TES-0040`, Production Employee).
- **test production employee** (`EMP-TES-0024`) has **no Department,** so they aren't listed until step 1.
- **The Production Head** (rahul, `testproductionhead`) must never be listed.
- **All old typed teams are retired,** so test-1 starts with **no teams**.

## Steps
### 1. HR puts test production employee in Production
1. Log in as HR-Admin **rahul**: **Employee Management** → test production employee → **⋮ → View Profile**.
2. Click the pencil on **Job Information**. Set **Department** to **Production** and **Designation** to a Production one, such as **Welder**. Save.

### 2. Manpower starts empty
1. Log in as **Production Head** (`testproductionhead`) → **Production → Manpower**.
   - [ ] No team cards. **Avg team score · this month** says **Not enough work yet** (feature 10 replaced efficiency with the score, 13 Nov).

### 3. Build a team from people
1. Click **Add Team**. The form has Team Name, People, Skills, and **no Efficiency box**.
2. Team Name: `Team One`.
3. In People, type `Rahul`.
   - [ ] **Rahul Pramanik** is listed, with "no login".
   - [ ] **rahul the Production Head is not.**
4. Click Rahul Pramanik. He's added and ticked as **Supervisor**.
5. Type `EMP-TES-0024` and add **test production employee**.
6. Pick a skill, such as Assembly, then **Add Team**.
   - [ ] A card for Team One.
     - Members: "Rahul Pramanik · EMP-TES-0039 (supervisor) · no login" and "test production employee · EMP-TES-0024".
     - **Score · this month: Not enough work yet,** 0 of 3 steps measured.
     - **Edit** (pencil) and **Retire** (box) buttons.

### 4. One person, one team
1. **Add Team** again: `Team Two`. Type `Rahul`.
   - [ ] Rahul Pramanik shows **"In Team One"** and can't be clicked.
2. Add **Test Worker Two** instead and save.
   - [ ] A card for Team Two.

### 5. Edit
1. On Team One, click the **pencil**. Tick **test production employee** as Supervisor. Rename it to `Team One A`. **Save Team**.
   - [ ] The card shows the new name, and test production employee is now "(supervisor)".

### 6. Process Execution still lists teams
1. **Production → Process Execution.** Open any step's **Assign Team**.
   - [ ] Team One A and Team Two are listed. *(This dialog was replaced by the crew panel on 12 Nov; if it no longer opens, skip this check.)*
   - [ ] **Team A is not listed.**
2. Find an old order that was worked by Team A.
   - [ ] It still shows **Team A** on its steps.

### 7. Retire
1. On **Team Two**, click **Retire** and confirm.
   - [ ] The card disappears.
2. **Add Team** and type `Test Worker`.
   - [ ] Test Worker Two is free again: no "In Team Two".

### 8. Skills per person (added 12 Nov)
Still as **Production Head**, on **Manpower**, with Team One A from step 5.
1. On the card, next to **Rahul Pramanik**, click **Skills**.
   - [ ] A list of every Process Template step: welding, grinding, coating, cutting, drilling, laser cutting, shaft assembly, nut bolting, bairing assembly, assemble, pre painting and post painting. Each says "In-House in: …" or "Not In-House in any BOM yet".
   - [ ] **The old list (Job Work, Fabrication, Final Testing …) is gone.**
2. Tick **welding** and **grinding**. **Save Skills**.
   - [ ] Under Rahul Pramanik: welding and grinding.
   - [ ] **Process Skills · from its people** shows welding and grinding.
3. Give **test production employee** **bairing assembly**.
   - [ ] The team's Process Skills: bairing assembly, grinding, welding.
4. **Skill Matrix** at the bottom.
   - [ ] One row per person under "Team One A", with ticks under their own steps.
5. **Edit** the team (pencil).
   - [ ] **There's no skill picker.** Process Skills shows the three steps, read-only, "worked out from its people".
6. **Process Execution → Assign Team** on any step.
   - [ ] Team One A shows "Skills: bairing assembly, grinding, welding".
7. **R&D rename** (fixes a typo too): log in as **R&D Head** → **BOM Management → Child Part → Process Templates**. Under **assembly**, rename **bairing assembly** to **bearing assembly**.
   - [ ] Back on Manpower as Production Head, test production employee now has **bearing assembly**.

## Not needed on screen
The `teams` suite covers:
- Every refusal: Store people, inactive people, another company's people, a supervisor outside the team, duplicates.
- The red flags when HR moves or deactivates someone.
- Retire refused while a step is In Progress.
- Assigning a retired team or another company's team.
- Each permission.

## Automatic results
| Suite | Result |
|---|---|
| `teams`, new | 51 of 51, 0 left behind |
| `slice7`, changed to use a real team | 31 of 31 |
| `stale-atstore`, changed to use a real team | 2 of 2 |
| `dispatch-store-part2` | 19 of 19 |
| `partial-3a` | 20 of 20 |
| `partial-3c` | 16 of 16 |
| `people` | 123 of 123 |

All six import the assign-team endpoint, which now checks the team.

## Browser results
**13–14 Nov 2026, test-1.** The teams were built by me through the real routes, at your choice: Team One (Rahul Pramanik's) and Team Two (Test Worker Four's). The screens were then checked:
- **Skills:** Test Worker Three given **cutting** on the card. The team's Process Skills and the Skill Matrix followed.
- **Edit:** Team Two renamed **Team Two A**, supervisor changed to Test Worker Five. There's no skill picker; skills are worked out from the people.
- **Retire:** Team Two A retired. Its people were free again in Add Team (Test Worker Three showed "In Team One", greyed out), and **Team Two** was rebuilt.
- **R&D rename:** *bairing assembly* → **bearing assembly** reached Rahul's skills, the team skills and the Skill Matrix.
- **Found and fixed:** a retired team's planned step now credits the people's current team at Start (`09-plan-ahead-changes.md`).
- **Not seen:** the old Assign Team dialog (no longer opened). Step 1 (HR department) was done on 11 Nov.
