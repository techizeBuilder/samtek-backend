# Feature 9: Planning work on any step; Start is execution (logic)

*From the client meeting, 12 November 2026. Decisions made 12 Nov (section 6). **BUILT 12 Nov:** [09-plan-ahead-changes.md](09-plan-ahead-changes.md). Changes stage 5's "one step at a time" ([02e-assign-and-hours-logic.md](02e-assign-and-hours-logic.md)); works with feature 7's real start time ([07-step-times-logic.md](07-step-times-logic.md)).*

## 1. What the client asked
**Planning and execution are two different things.** The Production Head is busy and doesn't want to assign work several times a day. So people can be **put on any step ahead of time,** even a later step, or one waiting for material.

**Start stays execution:** a step still can't start without its material, or before the previous step is done.

## 2. Today
- **Putting people on a step** checks the material first ("Material not yet received in Production, can't allot work") and the unit being back from Store.
- **One step at a time:** putting someone on a second step asks *"Move them here?"* and takes them off the first. So nobody can be planned on two steps.

## 3. How it works
### Assign = plan
- **People can be put on any in-house step that isn't finished,** on any unit, before the material arrives or the previous step is done.
- **Start keeps every check:** material received, previous step completed, someone on the crew, planned hours typed, nothing held at Store.
- **Planned hours** can be typed while planning.

### Planned and working
**Planned** people are on a step that hasn't started; **working** people are on a running step.
- **A person can be planned on many steps,** but works on **one running step at a time.**
- **Adding someone to a step that hasn't started:** no "Move them here?" question.
- **Adding someone to a running step:** asked only if they're working on **another running step.**
- **Planning works across orders,** for example Team A on Order 1's assemble now and Order 2's coating after lunch.

### Start: when planned people begin
**The crew counts from the start time:** now, or the earlier time typed (feature 7). This is the same for every step, the first one included; the first step's start just can't be before the order was made.

**At Start:**
- **Someone planned who's still working on another running step:** Start asks *"Ravi is working on ORD-… · assemble. Move him here?"*. Confirming ends his time there at this start.
- **Someone planned who's absent or not punched in today:** a warning after starting, so Production can replace them (feature 8) or take them off.
- **People planned on a step who never work it** (taken off before it starts) count nothing.

## 4. Hours (unchanged)
A person's hours on a step run from the **later** of the step's start and when they were put on, to the **earlier** of the step's finish and when they were taken off. Only time they were present counts, and lunch comes off.

### Worked example
| Time | What happens |
|---|---|
| 08:00 | Ravi and Amit are planned on **coating** (assemble is running; Ravi is working on it) |
| 13:00 | Assemble finishes; Ravi's time on it ends |
| 14:30 | **Start** on coating, "started at 14:00" |
| 15:00 | Suresh is added to coating, **working since 14:45** |
| 17:00 | Coating finishes |

- **Ravi and Amit:** 14:00 to 17:00. 08:00 to 14:00 doesn't count, because coating wasn't running.
- **Suresh:** 14:45 to 17:00.
- **If assemble had still been running at 14:30:** Start would ask to move Ravi, and his assemble time would end at 14:00.

## 5. What Production sees
- **The crew line on a step that hasn't started:** *"Planned: Rahul, Amit"*.
- **Manpower → Today:** *"Working on: ORD-… · assemble"*, plus *"Planned: coating, painting"*.
- **The people picker:**
  - someone planned elsewhere shows *"Planned on 2 other steps"* (no move)
  - someone working elsewhere shows *"Working on … (would be moved)"*

## 6. Your decisions (12 Nov)
| # | Question | Decided |
|---|---|---|
| A | Put people on any step without the material / previous-step checks | **Yes.** Start keeps them |
| B | "One step at a time" | **Running steps only;** planning on many is allowed |
| C | At Start, someone planned is working elsewhere | **Ask to move them** |
| D | At Start, someone planned is absent | **Warn only** |
| E | Planning across orders or the same order only | **Across orders** |
| — | Hours | **Unchanged:** from the step's start (or a later join), only while present |

## 7. How I'd test it
**A new suite, `planahead`, through the real server:**
- **Planning:**
  - on a step waiting for material, and on a later step: allowed
  - on many steps, across orders: allowed
  - Start on those steps: still refused for missing material / an unfinished previous step
- **Adding to a running step:**
  - while working on another running step: asked to move
  - while only planned elsewhere: not asked
- **At Start:**
  - a planned person working elsewhere: 409, then a confirmed move ending the other stint at the start time (back-dated too)
  - an absent planned person: started, with the warning
- **Hours:** someone planned at −300 on a step started at −120 counts from −120.
- **The Today board and the picker:** working vs planned.

**Regression:** `crew`, `steptimes`, `teamcover`, `labour`, and the step suites.
