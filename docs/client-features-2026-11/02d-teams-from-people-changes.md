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

## Files
**Backend:**
- **New:** `services/productionTeamService.js`
- **Model:** `ProductionTeam` (`people`, `supervisorPerson`, efficiency defaults to empty)
- **Controllers:** `productionMfgController` (teams, plus the assign checks) and `subChildPartOrderMfgController` (assign check)
- **Routes:** `productionMfgRoutes`, with `GET /teams/people`, `PUT /teams/:teamId` and `DELETE /teams/:teamId`

**Frontend:** `pages/production/ManpowerTracking.jsx` and `pages/production/ProcessExecution.jsx`
