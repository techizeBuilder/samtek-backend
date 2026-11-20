# Feature 7: The real time for start, finish, joining and leaving (logic)

*From the client meeting, 12 November 2026. Decisions made 12 Nov (section 5). **BUILT 12 Nov:** [07-step-times-changes.md](07-step-times-changes.md). Builds on stage 5's hours ([02e-assign-and-hours-logic.md](02e-assign-and-hours-logic.md)) and stage 6's labour ([02f-labour-cost-logic.md](02f-labour-cost-logic.md)).*

## 1. What the client asked
Production often starts work on the floor and only presses **Start** in Process Execution later, an hour or two or more. Today the system takes the moment the button is clicked as the start. The client wants to say **when the work really started:** now, or an earlier time.

## 2. Why one time isn't enough
A person's hours count only while all three are true: they were **on the crew**, the step was **running**, and they were **present** (stage 5). So:
- **Back-dating Start alone changes nothing:** the crew still counts from when they were added.
- **Clicking Complete late adds hours:** the crew stays on until the click.
- **Adding or taking off people late** does the same for one person.

So every action that sets one of those times gets the same choice.

## 3. The four choices
| Action | Choice | The time can't be |
|---|---|---|
| **Start** | **Started now** (picked) or **started at** a date and time | in the future; before the previous step of the unit finished; before the order was created |
| **Complete** (every completion: Mark Complete, the last step, Submit to QC) | **Finished now** (picked) or **finished at** | in the future; before the step started |
| **Add people** to a running step | **Joining now** (picked) or **working since** | in the future; before the step started |
| **Take off** | **Left now** (picked) or **left at** | in the future; before they joined |

### Start, back-dated
**Everyone on the crew when Start is pressed counts from the start time given,** since they were put on for this start. If someone was on another step at that time, they count only from when they left it, so the same hour is never paid twice.

### Complete, back-dated
**Everyone still on the step leaves at the finish time given.** The lunch list shown before completing (stage 5) covers the step up to that time, not up to the click.

## 4. Changes that keep it consistent (my additions)
- **Moving someone with "working since":** they leave their old step at that same time. If that time is before they joined the old step, it's refused.
- **The step's dates follow the time given:** "Started" and "Completed" show the date of the real time, not the click.
- **Nothing is hidden:**
  - every back-dated time keeps the real click time and who entered it
  - the step shows *"Started 09:00 · entered 11:15 by rahul"*, and the crew shows *"since 10:00 · entered 11:00"*
  - a time left at "now" shows as before
- **Not included** (say if you want it): correcting a time after the action was done, for example editing the start while the step runs. Today the choice is made at the moment of Start, Complete, Add or Take off.

## 5. Your decisions (12 Nov)
| # | Question | Decided |
|---|---|---|
| 1 | Back-date Start | **Yes,** and the crew moves back with it |
| A | Back-date Complete | **Yes,** with the same rules |
| B | Someone added to a running step | **Choice: joining now, or working since** a time |
| — | Take off | **Choice: left now, or left at** a time |
| — | Who | **Anyone allowed to do that action** (edit permission on Process Execution) |
| — | Extra changes (section 4) | **Included,** at your "any more change you think necessary" |

## 6. Worked example
Step **grinding**. Ravi and Amit punched in at 09:00. The General shift's lunch is 13:00–13:30.
- **09:00** Ravi starts grinding on the floor.
- **11:15** Production puts Ravi on the crew and presses **Start → started at 09:00.** Ravi counts from 09:00.
- **11:30** Production adds Amit, **working since 10:00.**
- **15:00** Production presses **Complete → finished at 14:00.** The lunch list covers 13:00–13:30.

| | Hours | Before this change |
|---|---|---|
| Ravi | 09:00–14:00 − 0.5 lunch = **4.5 h** | 11:15–15:00 − 0.5 = 3.25 h |
| Amit | 10:00–14:00 − 0.5 lunch = **3.5 h** | 11:30–15:00 − 0.5 = 3 h |

## 7. How I'd test it
**A new suite, `steptimes`, through the real server, on a made-up company:**
- **The example's hours:** 4.5 and 3.5.
- **Every refusal:**
  - a time in the future
  - a start before the previous step finished
  - a finish before the start
  - working since before the step started
  - left at before they joined
- **No double pay:** someone on another step at the back-dated start counts only from when they left it.
- **A move with "working since":** the old step closes at that time.
- **The lunch list** up to the finish time given.
- **The record:** the click time and who entered it.

**Regression:** `crew`, `labour`, and the suites that start and complete steps.
