# Feature 2, stage 4: Teams from people (what changed)

*Built 11 November 2026. Logic and your decisions: [02d-teams-from-people-logic.md](02d-teams-from-people-logic.md). Browser test: [02d-teams-from-people-test-roadmap.md](02d-teams-from-people-test-roadmap.md).*

## In one line
Production builds a team only from people HR entered, in the Production department: workers with no login and staff with a login, never the Production Head. Teams can now be edited and retired.

## What changed for Production (Production → Manpower)
**Add Team:**
- **Name.**
- **People:** a search box, by name, Employee ID or device code. It lists only Production people and shows "no login" and the designation. Someone already in a team shows **"In Team X"** and can't be picked.
- **Supervisor:** tick one of the picked people.
- **Skills.**
- **No efficiency box any more.** A hint says *"Someone missing? HR sets their Department to Production."*

**Team cards:**
- **Members** show their Employee ID, who's the supervisor, and "no login".
- **A member who left Production or was deactivated** shows in red, with **"No longer in Production"** or **"Inactive"**. They stay until Production takes them out.
- **Efficiency** shows **"Not measured yet"**. The system works it out later, from Process Execution.
- **New buttons:** **Edit** (pencil) and **Retire** (box), each shown only to someone with that permission.

**Retire:**
- **The team leaves Manpower and every team picker.** Orders it worked on keep its name.
- **Refused while the team has a step In Progress or waiting for QC.**

## Rules the server now enforces
- **One person, one team,** including the supervisor.
- **The supervisor must be one of the team's people.**
- **Only people in the company's Production department,** active, and not the Production Head.
- **Assigning a team to a step needs an active team of your company.** Before, the three assign endpoints (process step, parts QC, Sub Child Part order) accepted any ID: another company's team, a retired one, or one that didn't exist. Taking a team off a step still works.

## Other screens
**Process Execution, Job Cards, QC panels and Repair Production** show the same names as before. The team keeps a copy of its supervisor's and members' names, refreshed whenever teams are listed, so a name HR corrects shows everywhere. Process Execution's team picker shows "Efficiency: not measured yet".

## Old typed teams (your decision 1)
**All 8 typed teams on dev were retired,** test-1's Team A included. Retired, not deleted: Team A is on 51 order steps and 1 QC job, and they keep showing its name. **test-1 has no active team now,** so Process Execution's picker is empty until you build one. Live had none.

## Permissions (Production → Manpower)
| Action | Needs |
|---|---|
| See teams | view |
| Search people, add a team | add (searching also works with edit) |
| Edit a team | edit |
| Retire a team | delete |

The people search returns only name, Employee ID, designation, role, login yes or no, and current team. No contact details, no pay.

## Tests
- **New suite `teams`: 51 of 51,** through the real server, on made-up companies.
  - **The picker:** who's in and who's out, search, and no private fields.
  - **Every refusal:** a supervisor outside the team, Store, the Production Head, an inactive person, another company, a duplicate, already in a team.
  - **Editing,** and names following HR's changes.
  - **The flags** for moved and deactivated people.
  - **Retiring:** refused with work in progress, and old orders keep the team.
  - **Assigning** checks the team.
  - **Each permission.**
- **Changed so they still pass:** `slice7` and `stale-atstore` assigned made-up team IDs, which the server now refuses. They now create a real team.
- **Regression, all passing:** `slice7` 31, `stale-atstore` 2, `dispatch-store-part2` 19, `partial-3a` 20, `partial-3c` 16, `people` 123.
- **Screens:** Manpower and Process Execution compile.

## Skills per person (added 12 November)
*Logic and your decisions: [02d-teams-from-people-logic.md](02d-teams-from-people-logic.md), §7.*

**Why:** the skill list was a fixed old list (Job Work, Fabrication, Assembly, Painting, Re-Assembly, Final Testing) that matched almost nothing on orders made today, and it was set for the whole team. Stage 5 lets one person be given a step, so each person needs their own skills.

**What changed:**
- **Each person has their own skills.** A **Skills** link next to each member on the team card opens a list of every Process Template step, with search. Each step shows where a BOM uses it In-House. Production saves it with the manpower edit permission.
- **The list comes from R&D's Process Templates,** all three levels, each step name once, the same list vendors pick Services from.
- **A team's skills are worked out** from its people: the card ("from its people"), the team form, the skill matrix and Process Execution's team picker. Skills typed for a team are ignored.
- **Skill Matrix:** each person against each template step, grouped by team.
- **R&D renames a step:** if the old name is gone from every template, people's skills follow the new name; if another template still has it, the skill stays.
- **R&D deletes a step:** people keep it, struck through with "no longer a step in the Process Templates". It can be kept, but not newly given.
- **Only Production people** can be given skills. Skills are kept on the person, separate from the service technicians' skills.

**Tests:** suite `teams` now has sections 8 and 9: **72 of 72** in all.
- The list: each name once ignoring case, In-House use, Out Source-only steps, another company's steps left out.
- Every refusal: not a template step, a duplicate, Store, the Production Head, another company, view-only and add-only.
- Team skills following members as they're added and removed.
- Renames through R&D's own rename, and a deleted step.

**Regression:** `people` 123 of 123. No other suite calls the rename.

**Files:**
- **Backend:** `models/User.js` (`productionSkills`), `services/productionTeamService.js`, `controllers/productionMfgController.js` and `routes/productionMfgRoutes.js` (`GET /teams/skills`, `PUT /teams/people/:userId/skills`), `controllers/processCategoryOptionController.js` (rename follows).
- **Frontend:** `pages/production/ManpowerTracking.jsx`.

## Files
**Backend:**
- **New:** `services/productionTeamService.js`
- **Model:** `ProductionTeam` (`people`, `supervisorPerson`, efficiency defaults to empty)
- **Controllers:** `productionMfgController` (teams, plus the assign checks) and `subChildPartOrderMfgController` (assign check)
- **Routes:** `productionMfgRoutes`, with `GET /teams/people`, `PUT /teams/:teamId` and `DELETE /teams/:teamId`

**Frontend:** `pages/production/ManpowerTracking.jsx` and `pages/production/ProcessExecution.jsx`
