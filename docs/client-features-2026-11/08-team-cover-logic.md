# Feature 8: Covering for absent team members when a team is put on a step (logic)

*From the client meeting, 12 November 2026. Decisions made 12 Nov (section 5). **BUILT 12 Nov:** [08-team-cover-changes.md](08-team-cover-changes.md). Builds on stage 5's crews ([02e-assign-and-hours-logic.md](02e-assign-and-hours-logic.md)).*

## 1. What the client asked
When Production puts a **whole team** (or two) on a step and some members are absent, they want to **fill those places with other people,** a temporary team for this work. **The team on Manpower doesn't change.**

## 2. Today
- **Whole team** puts every member on, absent ones too, then warns "Added, but check attendance".
- An absent person adds no hours (no punch), so no cost, but they sit on the crew looking like they work.
- To cover them, Production goes to **People** and adds others one by one (shown "from Team B"). There's no link between the cover and the person they cover.

## 3. How it works
**Whole team:** tick one team or more. Each picked team shows its members with **today's attendance:**
```
Team A · 3 people
 ☑ Rahul Pramanik         Present
 ☐ Test Worker Two        Not punched in    [Replace ▾]
 ☐ test production emp.   Absent            [Replace ▾]
Crew: 1 present + 2 replacements = 3
```
- **Present members are ticked.** Absent and not-punched-in members aren't, but can be ticked (someone coming late).
- **Replace** picks someone for that place. The same rules as adding one person:
  - must be in Production, in a team, with the step's skill
  - present people are listed first
  - someone on another step needs the "Move them here?" confirm
- **A replacement is saved as "covering for Test Worker Two (Team A)".** It's shown on the crew and the Today tab.
- **Two teams:** each team's absent members get their own Replace.
- **The skill check:** at least one person on the final crew (ticked members and replacements) has the step's skill. Each replacement must have it.
- **Later in the day:** an absent member who arrives is added with **Joining now**, as today. A replacement is taken off like anyone else.

## 4. Hours, averages and efficiency
- **Hours:** unchanged. Everyone on the crew counts while present.
- **Averages:** crew size is the people actually working, so the replacements count.
- **Team efficiency:** a replacement's hours count for **the team they covered** (Team A that day).
- **Personal efficiency:** a replacement's own efficiency stays theirs.

## 5. Your decisions (12 Nov)
| # | Question | Decided |
|---|---|---|
| A | Absent / not-punched-in members | **Left off by default,** with a tick to put them on anyway |
| B | Who can replace | **The same rules as adding one person:** Production, in a team, with the skill; present first |
| C | How many | **One replacement per absent member,** optional; extra people can still be added |
| D | Team efficiency | **The replacement's hours count for the team they covered;** personal efficiency stays theirs |
| E | Shown as | **"covering for X (Team A)"** on the crew and the Today tab |
| — | Manpower's teams | **Unchanged:** this is only for the step |

## 6. How I'd test it
**A new suite, `teamcover`, through the real server, on a made-up company:**
- **Two teams with absent members.** Only the ticked members and the replacements go on, each replacement marked covering whom and for which team.
- **Refusals:**
  - a replacement without the skill
  - one not in a team
  - one from another company
  - covering for someone who isn't absent from a picked team
  - the same person twice
  - no one on the final crew with the skill
- **A replacement on another step:** the move confirm.
- **An absent member ticked anyway:** put on, with the attendance warning.
- **The finished run:** the replacement's hours count for Team A.
- **The old single-team add and the old assign route:** unchanged.

**Regression:** `crew`, `labour`, `steptimes`, `teams`.
