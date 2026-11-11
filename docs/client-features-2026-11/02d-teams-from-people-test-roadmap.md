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
   - [ ] No team cards. Avg Efficiency says **Not measured yet**.

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
     - Efficiency: **Not measured yet**.
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
   - [ ] Team One A and Team Two are listed, with "Efficiency: not measured yet".
   - [ ] **Team A is not listed.**
2. Find an old order that was worked by Team A.
   - [ ] It still shows **Team A** on its steps.

### 7. Retire
1. On **Team Two**, click **Retire** and confirm.
   - [ ] The card disappears.
2. **Add Team** and type `Test Worker`.
   - [ ] Test Worker Two is free again: no "In Team Two".

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
*Not started.*
