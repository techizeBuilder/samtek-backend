# Feature 8: Covering for absent members (browser test)

*Written 12 November 2026, company test-1 on dev. What changed: [08-team-cover-changes.md](08-team-cover-changes.md). Do it the same day, after feature 7's roadmap. It uses the teams, skills and made-up attendance from stages 4–6.*

## Where test-1 starts
- **Team One A:** Rahul Pramanik (present, has the **grinding** skill) and test production employee (**Absent** today, no grinding skill).
- **Team Three:** Test Worker Two (present, has **grinding**).
- **The step used:** **ORD-2026-069** (Fan), **Unit 2**, **grinding**. It's locked (welding is still out), but people can be put on it. Nothing is started, and everyone is taken off at the end.

## Steps
### 1. Pick the team
1. As **Production Head** → **Process Execution** → **ORD-2026-069** → **Unit 2** → **grinding** → **Add people** → **Whole team.**
   - [ ] The teams have **tick boxes** now.
2. Tick **Team One A.**
   - [ ] *"Team One A: who works today"* lists:
     - ☑ **Rahul Pramanik**, Present, "(supervisor)" if he's the supervisor
     - ☐ **test production employee**, **Absent**, *no "grinding" skill*, with **Replace**
   - [ ] *"Crew: 1 from the team + 0 replacements = 1"*.

### 2. Replace the absent member
1. Click **Replace** next to test production employee.
   - [ ] *"Who replaces test production employee on this step?"* with a search box.
   - [ ] Rahul isn't offered: he's in the picked team.
2. Type `Test`.
   - [ ] **Test Worker Two** · Team Three · **Present** · Free.
3. Click Test Worker Two.
   - [ ] *"Replace: Test Worker Two ✕"* next to test production employee.
   - [ ] *"Crew: 1 from the team + 1 replacement = 2"*, and the usual time for 2 people.
4. **Put on step.**
   - [ ] The crew: **Rahul Pramanik**, and **Test Worker Two** with *"covering for test production employee (Team One A)"* in purple.

### 3. The team itself doesn't change
1. **Manpower → Teams.**
   - [ ] Team One A still has Rahul Pramanik and test production employee only. Team Three still has Test Worker Two.
2. **Manpower → Today.**
   - [ ] Test Worker Two: *"ORD-2026-069 · Fan · unit 2 · **grinding** (covering for test production employee, Team One A)"*.

### 4. Two teams (optional look)
1. Back on Unit 2 grinding → **Add people** → **Whole team** → tick **Team One A** and **Team Three.**
   - [ ] Both teams are listed. Rahul and Test Worker Two show **already on this step** and can't be ticked.
2. **Cancel.**

### 5. Clean up
1. Take Rahul Pramanik and Test Worker Two off Unit 2's grinding (× → **Left now**).

## Not needed on screen
The `teamcover` suite covers:
- **Every refusal:** a replacement without the skill, in no team, or from another company; covering for someone not absent from a picked team; the same person twice; a crew with no skill.
- **A replacement busy on another step:** the move question.
- **An absent member ticked anyway:** the warning.
- **The finished run:** a replacement's hours count for the team covered.
- **The old single-team add and the old assign route** are unchanged.

## Automatic results
| Suite | Result |
|---|---|
| `teamcover`, new | 29 of 29, 0 left behind |
| `crew`, `steptimes`, `labour`, `teams` | 67, 28, 33, 72 |

## Browser results
**13 Nov 2026, test-1, on ORD-2026-114 drilling** (not this roadmap's order):
- **Whole team:** Team One. test production employee was **Absent**, unticked, with Replace.
- **Replace:** Test Worker Five from Team Two. The crew line read *"covering for test production employee (Team One)"*, and so did the Today tab.
- **The saved run:** Five's 0.67 h counted for **Team One** (Team One 3.02 h, Team Two 0.45 h).
- Manpower's teams didn't change.
