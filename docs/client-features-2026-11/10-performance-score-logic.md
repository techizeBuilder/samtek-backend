# Feature 10: Performance score (timing and accuracy), an HR page and incentive requests (logic)

*From the client meeting, 12 November 2026. Written 13 Nov. **Decisions made 13 Nov** (section 9). **Built 13 Nov:** [10-performance-score-changes.md](10-performance-score-changes.md). Builds on stage 5's step runs and planned hours ([02e-assign-and-hours-logic.md](02e-assign-and-hours-logic.md)) and replaces its efficiency.*

## 1. What the client asked
1. **Judge work on two things:**
   - **Timing:** finished early, just in time, or late against the **planned hours**.
   - **Accuracy:** the **QC pass rate**. Quick work that fails QC means more work than steady work that passes.
2. **A score for each person,** not only teams. Production can see it.
3. **A new page for HR** to see manpower scores and decide on incentives, or on letting someone go.
4. **Your addition:** HR won't watch scores all the time, so the **Production Head can request an incentive** for a worker, and HR decides.

## 2. Today
**Efficiency (stage 5)** = the hours a step usually takes (from past runs) ÷ the hours it took, over the last 10 runs. It shows from 3 runs on Manpower's team cards and member names.
- **It ignores planned hours and QC completely.** So it can't tell early from late against the plan, and it rewards rushing.

## 3. Timing
**Per finished step** (each run, stage 5): **timing = planned hours ÷ the hours it took.** "Took" is the time anyone on the crew was working, the same "took" the step shows.
- **Early:** finished more than 10% under plan. **On time:** within 10%. **Late:** more than 10% over.
- **Timing points** = ratio × 100, **capped at 110:** early earns a little more, so rushing can't run away with the score.
- **A QC rework round is left out of timing;** it shows in accuracy, so the same mistake isn't counted twice.
- **Steps with no planned hours** (only steps from before stage 5) are left out.

## 4. Accuracy
**A QC result:**
- **A unit** (Machine or Child Part): Pass = 100%, Reject = 0%.
- **A batch** (Sub Child Part): passed ÷ sent to QC. Rework and scrap count as not passed.

**Whose work a QC check judges** (decisions C, J, K, 13 Nov). Not every step has a QC check: R&D puts the check after a run of in-house steps. So:
- **A QC check judges every in-house step since the previous QC check** on that unit or batch: the steps up to it and the step that carries it.
- **The first QC result counts for all those steps' crews.** After a reject, the step with the check is redone; the redo's own result counts only for the crew that redid it.
- **A QC check on an outsourced step judges the vendor only** (it already feeds the vendor score). Our in-house steps before it get no accuracy from it.
- **In-house steps with no QC check after them** count for timing only.

**From the real BOMs:**
| BOM | Steps | Judged by |
|---|---|---|
| SCP-007 | cutting → drilling (QC) | drilling's QC judges **cutting and drilling** |
| CP-002 | coating → pre painting → post painting (QC) | post painting's QC judges **all three** |
| PRO001 | assemble → pre painting (vendor) → post painting (QC) | post painting's QC judges **assemble and post painting**; the vendor's step is the vendor's |
| SCP-005 | cutting → drilling, no QC | **timing only** |

## 5. The score
**Score = 40% timing + 60% accuracy,** out of 100 (decision D). Accuracy weighs more, as the client said.
- **No QC'd steps in the period:** the score is timing only, marked *"no QC yet"*.
- **Bands:** **90+ Excellent**, **75–89 Good**, **60–74 Needs attention**, **below 60 Poor**.
- **A person:** each step counts in proportion to the hours they worked on it.
- **A team:** its people's steps. Someone covering for the team (feature 8) counts for it.
- **The period:** this month by default, or last month, or any dates. At least **3 measured steps** in the period, otherwise *"Not enough work yet"*.

## 6. Worked examples (November)
### Ravi
| Step | Planned | Took | Timing points | QC, this round | Ravi's hours |
|---|---|---|---|---|---|
| grinding (Child Part) | 4 h | 3.5 h | 114, capped **110** · Early | Pass → **100** | 3.5 |
| coating (Child Part) | 2 h | 2 h | **100** · On time | Reject → **0** | 2 |
| drilling (batch of 10) | 3 h | 4 h | **75** · Late | 8 of 10 passed → **80** | 4 |

- **Timing,** by Ravi's hours: (110 × 3.5 + 100 × 2 + 75 × 4) ÷ 9.5 = 885 ÷ 9.5 = **93.2**
- **Accuracy:** (100 × 3.5 + 0 × 2 + 80 × 4) ÷ 9.5 = 670 ÷ 9.5 = **70.5**
- **Score:** 0.4 × 93.2 + 0.6 × 70.5 = 37.3 + 42.3 = **79.6, Good**

### Amit, who rushes
Every step 30% early (timing 110), but only half passes QC (accuracy 50):
- **Score:** 0.4 × 110 + 0.6 × 50 = 44 + 30 = **74, Needs attention.** Below Ravi, as the client wants.

### A crew of two
Ravi 3 h and Amit 1 h on one step: the step's timing and QC count **¾ for Ravi, ¼ for Amit.**

### One QC check, two steps
SCP-007, a batch of 10: Suresh does cutting, Ravi does drilling (QC). QC passes 9 of 10:
- **Both get 90 accuracy** for that batch.
- **If QC sends the 1 back** and Ravi redoes it and it passes, that redo's 100 counts only for Ravi.

## 7. Where it shows
**Production → Manpower:**
- **Team cards and member names** show the **score** in place of today's efficiency, with timing and accuracy beside it.
- **A new "Scores" tab:** people and teams for a chosen period, sortable. Opening someone shows the steps behind their score (planned vs took, QC result, their hours). It has a *"How it's worked out"* panel (English / Hinglish).
- **Request incentive** on a person (section 8).

**HR → a new page, "Manpower Score," for the whole company, not just Production:**
- **Everyone with a score, from any department, for a month:** score, timing, accuracy, measured work, hours, and **attendance days** for context (not part of the score).
- **A Department filter.** Today only Production's work produces scores. Another department's work can be added later as its own source, and its people then appear on the same page.
- **Filters, sorting, low scorers easy to find.**
- **A person's detail:** each piece of work behind the score.
- **Incentive requests** from department heads (today the Production Head), and **Give incentive** directly.

## 8. Incentive requests (your addition)
1. **A department head,** today the Production Head (Manpower edit permission), clicks **Request incentive** on a person, with a reason, a suggested amount (optional) and the month. The score at that moment and the person's department are saved with the request.
2. **HR is notified.** On the HR page it **approves** (the amount and the month) or **rejects** (with a reason). HR can also give an incentive without a request.
3. **The Production Head is notified** of the decision.
4. **An approved incentive goes into that month's payroll** as an *"Incentive"* earning on the payslip (decision G).

**Letting someone go:** the system takes no action. The page only shows the scores for HR to decide.

## 9. Your decisions (13 Nov)
**All as recommended,** and the HR page covers every department (section 7).

| # | Question | Decided |
|---|---|---|
| A | Timing measure | **Planned ÷ took,** capped at 110; Early / On time / Late at ±10% |
| B | QC rework rounds in timing | **No:** the first round only; rework shows in accuracy |
| C | Whose work a QC result judges | **Every in-house step since the previous QC check** (changed 13 Nov: not every step has a check) |
| J | A QC check on an outsourced step | **Judges the vendor only;** our steps before it get no accuracy from it |
| K | In-house steps with no QC check after them | **Timing only** |
| D | Weights | **40% timing, 60% accuracy** |
| E | Period and minimum | **This month by default,** or any dates; at least 3 measured steps |
| F | Today's efficiency | **Replaced everywhere by the score** |
| G | An approved incentive | **Added to that month's payroll** as an "Incentive" earning on the payslip |
| H | Who sees what | **Production** sees scores and requests (with a suggested amount). **HR** sees everything and decides. Workers don't log in, so they see nothing |
| I | The HR page | **For every department,** with a Department filter. Today only Production's work produces scores |

## 10. How I'd test it
**A new suite, `score`,** with made-up runs and QC results, totals worked by hand:
- **Ravi's 79.6 and Amit's 74.**
- **The crew of two** at ¾ and ¼.
- **The cap at 110, the bands,** and "no QC yet".
- **Under 3 steps:** not shown.
- **A cover** counting for the covered team.
- **Rework** left out of timing.
- **Incentives:** request → HR approves → payroll earning; reject; HR gives directly.
- **Permissions:** Production can't decide; HR can't be asked by another company.

**Regression:** `crew`, `labour`, `payroll` and `teamcover`.
