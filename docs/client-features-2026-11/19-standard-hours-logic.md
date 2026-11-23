# Feature 19: Standard hours instead of planned hours Production types itself

*Client, 20 November meeting. Logic for discussion; nothing built yet.*

## 1. The problem
**Today:**
- Production types each step's **planned hours**, required before Start (stage 5, decision 7).
- The score measures Production against that same number:
  - **Productivity** = planned ÷ took (capped at 110%)
  - **Task completion:** a step counts as late once it passes its planned hours
  - **Weights:** each step counts by its planned hours
- Work Planning's "over plan" uses it too.

**So whoever plans also sets their own yardstick.** Typing 4 h for 2 h of work makes every step "early", lifts the score, and with it incentives. The client spotted it.

**The client's ask:**
- R&D puts hours in the BOM, **per step, with a people count per step** (not one count for the whole machine).
- The Company Admin approves them.
- Production plans from them. Production can still put on whoever it wants; R&D's count doesn't block anything.

**Your worry, which is right:** "2 people 2 h → 4 people 1 h" assumes every hour of work splits perfectly. Real work doesn't:
- someone holds while another welds
- people wait for each other
- one fixture fits two pairs of hands

Today's history average does the same: the mean person-hours ÷ the number of people.

## 2. The idea in one line
**R&D sets a standard, the Company Admin approves it, and the system works out each step's hours from it.** That uses:
- the quantity
- the crew Production actually used
- a rule for how much more people really help

History then **proposes** better standards, and the Company Admin approves those too. **Production plans with the standard but never sets it.**

## 3. The maths (and why it's the right shape)

### 3.1 How long a step takes with k people: Amdahl's rule
Some of a step's work **splits across people** and some **doesn't** (one fixture, one machine, one person signing off). Call the share that doesn't split **σ** (sigma). For one piece:

> **time with k people = time with 1 person × ( σ + (1 − σ) ÷ k )**

- **σ = 0:** everything splits, and it's today's even split (2 people → half the time).
- **σ = 1:** nothing splits (oven curing, a machine cycle); more people don't help at all.
- **In between,** more people help, but less and less. **Person-hours rise** as people are added, as they really do.

This is the textbook model for work split among workers (Amdahl's law). It has **one number per step**, which matters: steps have little history, and a model with more knobs would chase noise.

**R&D doesn't type σ.** R&D answers one question per step: **"Do more people make this step faster?"**

| Answer | σ | 2 → 4 people |
|---|---|---|
| Yes, it splits well | 0.1 | 41% faster |
| Partly | 0.3 | 27% faster |
| Hardly | 0.6 | 13% faster |
| No (a machine or fixture sets the pace) | 1.0 | no change |

### 3.2 Setup and quantity
Most steps have a part that **doesn't grow with quantity** (setting up the fixture, warming the gun, the first-piece check), then a part per piece:

> **step time = setup + pieces × time per piece**

Setup counts once per step (per batch, or per unit of a machine). It's done by one person, so it doesn't shrink with the crew.

### 3.3 Putting it together: the standard time for one step
R&D gives, per BOM step:
- **hours per piece, with the standard crew** (e.g. 3 h with 2 people)
- **the standard crew** (the people count per step the client asked for)
- **setup hours** (optional, default 0)
- **the split answer** (σ)

Then, for any quantity n and crew k:

> **standard(n, k) = setup + n × per-piece-for-1 × ( σ + (1 − σ) ÷ k )**, where **per-piece-for-1 = R&D's hours ÷ ( σ + (1 − σ) ÷ standard crew )**

### 3.4 When the crew changes during the step
People join and leave (features 7 and 8). The fair standard is worked out **the way the delivery estimate already plans**: each stretch of time with k people does a share of the work at that crew's speed.

> **share done = Σ ( stretch hours ÷ standard(n, k of that stretch) )**

**Hours earned = hours it took ÷ share done.** With one crew all the way through, that's just standard(n, k). Nobody gains by putting people on or off on paper, because the crew is read from **who was really there** (crew entries + attendance).

### 3.5 What history adds, without letting it be gamed
Each finished run tells us how much work a piece really took. It's turned back into the same "hours per piece for 1 person" by undoing the setup and the crew effect:

> **observed per-piece-for-1 = ( hours it took − setup ) ÷ ( pieces × ( σ + (1 − σ) ÷ crew ) )**

From the last 10 runs:
- **The middle one (median), not the mean.** Durations are skewed; one breakdown day shouldn't move the standard.
- **Blended with R&D's figure, weighted by how much history there is** (credibility weighting):

  > **proposed = ( 3 × R&D + N × history ) ÷ ( 3 + N )**, N = runs used (up to 10)

  At 3 runs history counts half; at 10 runs, three quarters. **No sudden jump at "3 runs"** as today.
- **With enough runs at different crew sizes** (at least 3 runs at each of 2 sizes), σ itself can be measured from the runs instead of R&D's answer.

**The ratchet risk:** if history changed the standard by itself, a team could work slowly for a month and loosen its own target. So **history only proposes**. The Company Admin sees *"Welding on Fan: standard 3.0 h per piece; history says 2.8 h (6 runs). Approve?"* and decides. Approved standards are dated (versioned), like the scorecard's settings.

## 4. Worked example (by hand)
**Welding on the Fan, R&D:** 3 h per piece with **2 people**, setup **0.5 h**, splits **Partly** (σ = 0.3).
- Per piece with 1 person = 3 ÷ (0.3 + 0.7 ÷ 2) = 3 ÷ 0.65 = **4.615 h**.

**An order of 4 Fans' welding (4 pieces):**

| Crew | Standard | Even split (today's rule) |
|---|---|---|
| 1 | 0.5 + 4 × 4.615 × 1 = **18.96 h** | 24.5 h |
| 2 (R&D's crew) | 0.5 + 4 × 4.615 × 0.65 = **12.5 h** | 12.5 h |
| 3 | 0.5 + 4 × 4.615 × 0.533 = **10.35 h** | 8.5 h |
| 4 | 0.5 + 4 × 4.615 × 0.475 = **9.27 h** | 6.5 h |

At R&D's crew both rules agree, which is what R&D said. Away from it, the even split is far too optimistic with more people, and too harsh with fewer.

**A crew change:** 2 people for 6 h, then 4 people until the finish 3 h later (took 9 h).
- Share done = 6 ÷ 12.5 + 3 ÷ 9.27 = 0.48 + 0.324 = 0.804.
- Hours earned = 9 ÷ 0.804 = **11.2 h**.
- Productivity = 11.2 ÷ 9 = 124%, capped at **110%**.

**History after 4 runs:**

| Run | Pieces | Crew | Took | Per piece for 1 = (took − 0.5) ÷ (pieces × crew factor) |
|---|---|---|---|---|
| 1 | 4 | 2 | 11.0 h | 10.5 ÷ (4 × 0.65) = 4.04 |
| 2 | 4 | 2 | 10.4 h | 9.9 ÷ 2.6 = 3.81 |
| 3 | 2 | 3 | 4.9 h | 4.4 ÷ (2 × 0.533) = 4.13 |
| 4 | 6 | 2 | 17.2 h | 16.7 ÷ 3.9 = 4.28 |

- **The middle one** of 3.808, 4.038, 4.125, 4.282 = (4.038 + 4.125) ÷ 2 = **4.082**.
- **Proposed** = (3 × 4.615 + 4 × 4.082) ÷ 7 = (13.846 + 16.327) ÷ 7 = **4.310** per piece for 1, i.e. 4.310 × 0.65 = **2.80 h per piece with 2 people** (R&D said 3.0). *(Exact figures; the suite `stdcalc` checks them.)*
- **The Company Admin approves it** → from that date, 4 Fans with 2 people = 0.5 + 4 × 2.80 = **11.7 h**.

## 5. Where the standard is used
| Place | Today | With this |
|---|---|---|
| Starting a step | Production must type planned hours | The standard for the crew planned is **shown and used**; nothing to type when a standard exists |
| Scorecard: productivity, task completion, weights | Production's typed hours | **The standard** (hours earned, section 3.4) |
| Work Planning board: "over plan" | Typed hours | The standard |
| Sales' delivery estimate | R&D's hours split evenly, or history | **The same formula,** so what Sales promises and what Production is measured on agree |
| The step card | "Planned 2 h" | *"Standard 12.5 h for 4 pieces with 2 people (approved 21 Nov)"*, and why, with an English / Hinglish explanation |

## 6. Questions for you
- **A. How more people help:**
  - (a) the **split answer per step** (Amdahl, section 3.1) (recommended)
  - (b) an even split, as the client described
  - (c) R&D types hours for 1, 2, 3 and 4 people (a table per step: exact, but four boxes per step)
- **B. Setup hours per step:**
  - (a) an optional box, default 0 (recommended)
  - (b) none
- **C. History:**
  - (a) it **proposes** (blend + median) and the Company Admin approves (recommended)
  - (b) it takes over automatically after N runs (your first idea; open to the slow-down trick)
  - (c) never; only R&D's figure
- **D. Production's part:**
  - (a) the standard is computed; for an unusual job Production can ask for an exception with a reason, and the Company Admin decides (recommended)
  - (b) Production types hours but **not above** the standard
  - (c) Production types any plan for scheduling, but the score always uses the standard
- **E. When the crew changes during the step:**
  - (a) exact, stretch by stretch (section 3.4) (recommended)
  - (b) the average crew size over the step (simpler, a little less fair)
- **F. People count per step:**
  - (a) it **replaces** the whole-machine "usual people" box (the estimate uses it per step) (recommended)
  - (b) keep both
- **G. Orders already running:**
  - (a) keep their typed hours; new steps use the standard (recommended)
  - (b) recompute them
- **H. A step with no approved standard yet** (a new BOM, or R&D hasn't typed it):
  - (a) Production types hours as today; the step is marked "no standard" and **left out of the score** until one is approved (recommended)
  - (b) the step can't start until there's a standard

## 7. Your decisions (21 Nov)
- **A: the split answer per step** (Amdahl, section 3.1). R&D answers "Do more people make this step faster? Yes / Partly / Hardly / No" (σ 0.1 / 0.3 / 0.6 / 1.0).
- **B: an optional setup box** per step, default 0.
- **C: history proposes** (the median of the last 10 runs, blended with R&D's figure by the number of runs) and **the Company Admin approves.** Approved standards are dated.
- **D, changed after your point that work must never wait for an approval:**
  - Production **starts at once** with the standard for its crew. Nothing to type, nothing to approve.
  - For an unusual job, Production **flags the step at any time** (before, during or after) with the hours it needs and why.
  - The work goes on normally; only **that step's score waits.** It's left out until the Company Admin decides:
    - **Approve:** the flagged hours count.
    - **Reject:** the standard counts.
- **E: exact, stretch by stretch,** when the crew changes during a step (section 3.4).
- **F: a people count per step replaces** the whole-part "usual people" box.
- **G (default, not objected to):** orders already running keep their typed hours; new steps use standards.
- **H: no approved standard yet** → Production types hours as today and starts at once. The step is marked "no standard" and left out of the score until one is approved.

## 8. What changes in the delivery estimate (your question)
**The core stays.** The day-by-day plan (material, work and people clocks, unit by unit, QC waits, job-work trips, work in hand first, the buffer) doesn't change. Only the numbers each step gives it:
- **A step's time with k people:** the approved standard (setup + pieces × per piece × the split answer), the same formula Production is scored on. It replaces R&D's hours split evenly, and the stage-5 history average.
- **Most people on a step:** that step's people count. It replaces the part's box.
- **Most people on the order at once:** the largest step count of the part, so decision D1 (per order) still holds.
- **Work in hand:** the standard. A step with no standard uses Production's typed hours, else 1 day per step.
- **History:** no longer used directly. Once the Company Admin approves a proposal, the estimate uses the new standard.

**The effect:**
- A step with more people than R&D's crew comes out a little slower than the even split (more honest).
- A batch counts setup once.
- Sales' promise and Production's yardstick come from the same number.
- **The deep test:** round 1's main runs get re-checked with the new numbers before round 2.
