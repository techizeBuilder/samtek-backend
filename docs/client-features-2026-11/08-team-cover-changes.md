# Feature 8: Covering for absent members when a team is put on a step (what changed)

*Built 12 November 2026, from the client meeting the same day. Logic and your decisions: [08-team-cover-logic.md](08-team-cover-logic.md). Browser test: [08-team-cover-test-roadmap.md](08-team-cover-test-roadmap.md).*

## In one line
Putting a whole team (or two) on a step now shows who's in today. Absent members are left off, and each can be **replaced** by someone from another team: a temporary team for this step only. **Manpower's teams don't change.**

## What Production sees (Process Execution → Add people → Whole team)
- **Teams are ticked,** so more than one can be picked.
- **Each picked team lists its members** with today's attendance (Present / Not punched in / Absent), "no {step} skill", "(supervisor)", and "already on this step" or "not in Production now".
- **Ticks:**
  - Present members are ticked; absent and not-punched-in ones aren't.
  - Any member can be ticked or unticked: tick someone absent who's coming late, untick someone present who's needed elsewhere.
  - A ticked member busy on another step shows "(would be moved)".
- **Replace** next to an unticked member opens *"Who replaces {name} on this step?"*:
  - a search of Production people from other teams, present first
  - people without the skill, in no team, or already on the step are greyed with the reason
  - the choice shows as *"Replace: Amit ✕"*
- **The summary:** *"Crew: 2 from the teams + 1 replacement = 3"*. The usual time is shown for that number of people.
- **The rules:**
  - each replacement must have the step's skill
  - someone on the final crew must have it
  - one replacement per member
  - the same person can't be picked twice
- **On the step,** the replacement shows *"covering for test production employee (Team One A)"*. **Manpower → Today** shows the same.
- **Unchanged:**
  - the People tab
  - the move question ("Move them here?")
  - Working since (feature 7)
  - an absent member who arrives later is still added with Joining now

## Hours and efficiency
- **Hours** are counted as before, for everyone on the crew.
- **A replacement's hours count for the team they covered** (Team One A that day), for team efficiency.
- **Their personal hours and efficiency** stay their own.

## Technical notes
**Server:**
- **`models/StepCrewEntry.js`:** `coveringFor`, `coveringForName`, `forTeam`.
- **`crewService.js`:**
  - `addToCrew({ teams, include, covers })`: every check from logic §3, then the usual move, since and attendance handling
  - new `teamMembersView`
  - `describePeople`, now shared with `crewCandidates`
  - `crewHours` credits `forTeam`
  - `covering` on crew rows and the Today board
- **`productionMfgController.js`:** new `getStepCrewTeamMembers` (`GET …/crew/team-members?teams=`). `addStepCrew` passes the new fields.
- **`routes/productionMfgRoutes.js`:** the route, behind orders view.
- **The old single-team add and the old assign-team route are unchanged.**

**Screens:**
- `components/production/StepCrew.jsx`: the Whole team tab, and the covering tag on the crew
- `pages/production/ManpowerTracking.jsx`: the covering tag on the Today tab

## Tests
- **New suite `teamcover`: 29 of 29,** through the real server, on made-up companies:
  - **The team-members view:** attendance, skills, the supervisor and eligibility.
  - **Ten refusals:**
    - a replacement without the skill, in no team, or from another company
    - covering for someone not in a picked team, or for a ticked member
    - a replacement from the picked teams themselves
    - the same person twice, or two replacements for one member
    - a crew with no skill, or nobody picked
  - **Two teams with absent members replaced:** only the ticked members plus the replacement go on, marked covering A2 for Team A, and Team A on Manpower is unchanged.
  - **A replacement busy on another step:** asked, then moved.
  - **An absent member ticked anyway,** with the warning.
  - **The crew row and the Today tab** show it.
  - **The finished run:** Team A gets 6 h (its member plus the two replacements), Team B 2 h, Team C none; the replacement's own hours stay his.
  - **The old single-team add and the old assign-team route** are unchanged.
- **Regression, all passing:** `crew` 67, `steptimes` 28, `labour` 33, `teams` 72.
- **Screens compile:** the crew panel and Manpower.
