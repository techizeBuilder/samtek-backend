# Feature 2, stage 4: Teams from people (logic)

*Written 11 November 2026. **Built the same day:** see [02d-teams-from-people-changes.md](02d-teams-from-people-changes.md). Background: [02-manpower-attendance-discussion.md](02-manpower-attendance-discussion.md); who counts as Production was settled in [02a-people-no-login-logic.md](02a-people-no-login-logic.md), decision 1.*

## Your decisions (11 Nov)
1. **Existing typed teams:** delete them. They're dev data.
2. **One person, one team.**
3. **Team efficiency:** the system will calculate it. It gets wired up later, with Process Execution. It isn't typed any more.
4. **Who can be in a team:** anyone in the Production department, except the Production Head.

## 1. What this stage does
Production builds teams **only from people HR entered,** not from typed names. A person might be a worker with no login or staff with a login. Each team member is then a real person, with attendance from the device and a salary from payroll. Stages 5 and 6 need that to show who's present and to cost hours.

**Not in this stage:** assigning a person or team to a step with hours (stage 5), labour cost (stage 6) and calculating efficiency.

## 2. Today
| Part | Today |
|---|---|
| **Add Team** (Production → Manpower) | Name, supervisor and members are typed text. Efficiency is a typed number |
| **Editing or removing a team** | Not possible. The server only lists and creates |
| **Where teams are used** | Process Execution, QC part checks, Job Cards, Repair Production and the Sub Child Part QC panel. All of them show the team's name, the supervisor's name and the members' names |

## 3. How it works
### Who can be picked
- **The rule:** active people in your company whose **Department is Production,** with or without a login. **The Production Head is never listed.**
- **The person picker searches as you type,** on the server, by name, Employee ID or device code. Each person shows their Employee ID, designation and a "no login" badge where there is one.
- **Someone already in a team** shows "In *Team name*" and can't be picked (decision 2). To move them, take them out of their team first.

### A team
- **Name:** typed, as today.
- **People:** picked, at least one.
- **Supervisor:** one of the team's people, ticked as supervisor. So the supervisor is also a Production person, and also in only one team.
- **Skills:** chosen as today.
- **Efficiency:** no longer typed. It shows **"Not measured yet"** until it's calculated from Process Execution (decision 3).

### Editing and removing
- **Production can now edit a team:** rename it, add or take out people, change the supervisor and change skills.
- **Removing a team retires it.** It disappears from Manpower and from every team picker. Orders already worked by it still show its name in their history, so nothing old goes blank.
- **A team with a step In Progress or QC Pending can't be retired** until that work is finished.

### Names on other screens
Process Execution, Job Cards, QC and Repair keep showing the same names as before. The names are filled in from the people whenever a team is saved, and refreshed whenever teams are listed, so a name HR corrects shows up everywhere.

### When HR changes someone
- **Moved out of Production, or deactivated:** they stay on the team with a red warning, "No longer in Production" or "Inactive", until Production takes them out. The system doesn't remove anyone by itself, because that would surprise the supervisor.
- **Given a login later:** nothing changes. It's the same record, so they stay in their team (People decision 2).

### Old typed teams (decision 1)
- **test-1's Team A** is retired. It's in the history of 51 order steps and 1 QC job, so retiring keeps its name showing there. One of those steps is still In Progress, and it keeps working.
- **Dev's 7 other typed teams** in other companies are retired the same way.
- **Live has no teams,** so there's nothing to move.

## 4. Staff with no Department set: **settled 11 Nov, option A**
Your answer: go with the rule, and you'll set Department on the dev records that need it.

**Staff with no Department set.** Most people created before departments existed have none. test production employee is one: their role is Production Employee, but their Department is blank. Under the rule in section 3, they wouldn't be listed until HR sets their Department to Production.

| Option | What happens |
|---|---|
| **A. Department only** (recommended) | Exactly your rule. The picker says: *"Someone missing? HR sets their Department to Production."* HR fixes the few old records once |
| B. Also list people with no Department whose role starts with "Production" | Old staff show up without HR doing anything, but the rule now has an exception that's easy to forget, and the Production Head check has to cover it too |

## 5. Permissions
| Action | Permission |
|---|---|
| See teams | Production → Manpower, view (as today) |
| Add a team, and search for people | Manpower, add |
| Edit a team | Manpower, edit |
| Retire a team | Manpower, delete |

The people search shows only name, Employee ID, designation, department, login yes or no, and current team. It never shows contact details or salary.

## 6. How I'd test it
**A new suite, `teams`, on made-up companies:**
- The picker lists Production people with and without a login. It leaves out the Production Head, other departments, inactive people and other companies. Search works.
- Someone already in a team can't be added to another, including as supervisor.
- The supervisor must be one of the team's people.
- Edit: rename, add, take out, change supervisor. The names on the team follow.
- Retire: refused while a step is In Progress. Once retired, the team leaves the list, and old orders still show its name.
- A person moved out of Production, or deactivated, is flagged on their team.
- Each permission, and another company's team refused.

**Regression:** the production and QC suites that assign teams, to confirm assigning still works.

**Browser:** build a team from Rahul Pramanik and Test Worker Two. Try adding the Production Head. Retire it. Check Process Execution still lists teams.

## 7. Skills per person (added 12 Nov, your decisions as recommended)
**Why:** the skill list on Manpower was a fixed old list (Job Work, Fabrication, Assembly, Painting, Re-Assembly, Final Testing). Those are the step names of orders made before process templates existed. Orders today use the Process Template steps, so the list matched almost nothing. Skills also sat on the whole team, but stage 5 lets one person be given a step, so each person needs their own.

**Your decisions (12 Nov):**
1. **Production sets a person's skills** on the Manpower page, with the manpower edit permission. HR doesn't.
2. **The list shows every Process Template step,** Out Source-only ones included, with a note of where a BOM uses each one In-House.

**How it works:**
- **Skills belong to the person,** not the team, so they move with the person if they change teams. They're kept on the person's record, separate from the service technicians' skills.
- **The skill list** is every internal process name in the company's Process Templates, across Sub Child Part, Child Part and Machine, each name once (matched ignoring case). This is the same list vendors pick their Services from. On test-1 that's 12: welding, grinding, coating, cutting, drilling, laser cutting, shaft assembly, nut bolting, bairing assembly, assemble, pre painting, post painting. Each shows "In-House in: …" with the BOMs that use it In-House.
- **A team's skills are worked out:** everything its members can do. They show on the team card, in the skill matrix and in Process Execution's team picker. Nobody types skills for a team any more; anything sent for a team is ignored.
- **The skill matrix** shows each person against each step, grouped by team.
- **R&D renames a template step:** if the old name no longer exists in any template, people with that skill get the new name. If the old name still exists in another template, the skill is still valid and stays.
- **R&D deletes a template step:** people keep the skill, marked "no longer in templates", until Production removes it.
- **Only Production people** (the team rule: Production department, not the Production Head) can be given skills.

**Stage 5, not now:** giving a step to one person will check they have that step's skill. What a whole team needs is settled in stage 5.
