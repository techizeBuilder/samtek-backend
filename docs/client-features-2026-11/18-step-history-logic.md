# Feature 18: Who was put on each step, and when it started and finished, on Process Execution

*Client, 20 November meeting. Logic for discussion; nothing built yet.*

## What was asked
On **Production → Process Execution**, the client wants to see, for each step:
- **when Production assigned people** to it (date and time, and who did it)
- **when the step started and when it finished**

Manpower shows this per person. The client wants it **per step, on the page where the work is tracked**.

## What is already stored (nothing new to record)
| What | Where it's kept today |
|---|---|
| Who was put on a step, **when** and **by whom** | Each crew entry: when it was created, plus "added by" |
| When they really started working on it, and when they left | The entry's "joined" and "left" times (feature 7: can be back-dated) |
| Who took them off | The entry's "removed by" |
| Entered late? | "Joined / left entered at" (feature 7) |
| Covering for someone, borrowed from another team, rework | Marks on the entry (features 8, 13) |
| When the step started and finished, and who entered a late time | On the step (feature 7) |

## What Process Execution shows today (the gaps)
- **Start and finish are only shown when someone back-dated them** ("Started 09:00 · entered 11:15 by rahul"). After a plain Start or Complete there's **no time on the step at all**.
- **The assignment isn't shown.** Hovering over a person gives "since 10:00", with no date and no "assigned by". People already taken off aren't listed.

## The proposal
**1. Every step shows its start and finish, with the date:**
> Started **Thu 20 Nov, 10:30** · Finished **Thu 20 Nov, 14:00** (3 h 30 min)

A back-dated time adds *"(entered 11:00 by Production Head)"*, as now.

**2. A "History" link on each step** opens its timeline, newest last, with full dates and times:

| When | What |
|---|---|
| Thu 20 Nov, 09:40 | **Rahul Pramanik** and **Test Worker Three** put on (planned) by Production Head |
| Thu 20 Nov, 10:30 | **Step started** (clicked 10:35 by Production Head) · Rahul and Three start working |
| Thu 20 Nov, 11:30 | **Test Worker Five** put on by Production Head, covering for Three |
| Thu 20 Nov, 12:00 | **Test Worker Three** taken off (entered 12:20 by Production Head) · worked 1 h 30 min |
| Thu 20 Nov, 14:00 | **Step finished** · Rahul 3 h 30 min, Five 2 h 30 min |

**3. Each person's stint, on hover** of their name on the step: *"Put on Thu 20 Nov 09:40 by Production Head · working since 10:30"*.

**How it stays fast:**
- The timeline is read **only when "History" is opened**, for that one step and unit (one read of its crew entries plus the names in one batch).
- Page loads don't get slower.

## Questions for you
- **A. Which events go in the timeline?**
  - (a) **people + start/finish only**, as asked (recommended)
  - (b) also QC (sent to QC, QC's decision) and job work (sent to the vendor, back at Store)
- **B. Where?**
  - (a) start/finish always on the step, and a "History" link for the full list (recommended)
  - (b) the full list always open on every step (a long page)
  - (c) one "History" tab for the whole order
- **C. People put on and taken off before the step started** (plan changes): show them in the timeline ("planned … removed from the plan …")?
  - (a) yes (recommended), so the client sees every assignment
  - (b) no, only people who actually worked

## Your decisions (21 Nov)
- **A (a):** people and start/finish only (no QC or job-work events).
- **B (a):**
  - every step always shows its start and finish with the date
  - a **History** link opens that step's full timeline, read only when opened
- **C (a):** plan changes are shown (planned, then removed from the plan, with who and when).
