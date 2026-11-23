# Feature 19: Standard hours (browser test)

*On test-1. What changed: [19-standard-hours-changes.md](19-standard-hours-changes.md). The suites `stdcalc` (24), `stdapprove` (33) and `stdprod` (52) already check the numbers and the rules; this is about the screens and a real run worked by hand.*

**Logins:**
- R&D (R&D Head)
- the Company Admin
- the Production Head

**You'll need:** an open order with an in-house step not started, for a part whose step you'll approve. Raise one from a customer order if there's none.

**Hand working.** The standard for n pieces with k people, from R&D's *h* hours per piece with *c* people, setup *s*, and the answer's σ (Yes 0.1 · Partly 0.3 · Hardly 0.6 · No 1):
- per piece for 1 person: p1 = h ÷ (σ + (1 − σ) ÷ c)
- standard = s + n × p1 × (σ + (1 − σ) ÷ k)
- Example: 3 h with 2 people, setup 0.5 h, Partly → p1 = 4.615. For 1 piece:
  - 1 person: 5.12 h
  - 2 people: 3.5 h
  - 3 people: 2.96 h
  - 4 people: 2.69 h

## 1. R&D sets a standard
1. R&D → the machine's (or Child Part's) BOM → Process steps → an in-house step. Type **3** h per piece with **2** people, setup **0.5**, answer **Partly**. Save.
   - The step's line: *"Waiting for the Company Admin to approve."*
   - The part has no "usual people at once" box any more.
2. Saving again without changes: no new bell for the Company Admin.

## 2. The Company Admin approves
1. Company Admin: the bell says *"Standard hours to approve: {part}"* and names the step.
2. HRMS → Company Admin → **Standard Hours** → Waiting → **R&D's changes**.
   - The step shows 3 h with 2 people, and 1 piece with 1 / 2 / 3 / 4 people = 5.12 / 3.5 / 2.96 / 2.69 h.
   - The 13 test-1 steps whose people count came from the old "usual people" box are listed too.
3. **Approve** it.
   - It moves to **Approved**, dated today.
   - R&D's line: *"In force: 3 h per piece with 2 people · from R&D · approved {today}"*.
4. **Reject** another one with a reason.
   - R&D's line for it shows the rejection and the reason.
5. **Versions** on the approved one: one row, by you, today.
6. "How is a standard worked out?": English and Hinglish both read right.

## 3. Production runs the step on the standard
1. Process Execution → the order → that step → **Add people**: 2 people.
   - The line: *"Standard 3.5 h for 1 piece with 2 people (approved {today}) · How?"* (for a batch of n pieces: use the formula)
   - No hours box.
2. Add a 3rd person to the plan: the line says **2.96 h** with 3 people. Remove them again: 3.5 h.
3. **How?**: 5.12 / 3.5 / 2.96 / 2.69 h and the explainer.
4. **Start** (any time, for example 2 hours ago). Nobody asks for hours.
5. **Add people** while it runs: 1 more, **Working since** 1 hour ago.
   - The line: *"Standard 2.96 h … with 3 people · {x} h for the crew so far"*
   - x = hours so far ÷ (1 ÷ 3.5 + 1 ÷ 2.96) for 1 h with 2 people, then 1 h with 3
   - With exactly those stretches: 2 ÷ (0.2857 + 0.3378) = **3.21 h**. Lunch or attendance gaps change it a little.
6. **Complete** it.
   - The line: *"Standard earned {y} h for 1 piece"*: the same stretch-by-stretch figure up to the finish.
   - *"took … h, … over / under plan"* compares with **y**, not with 3.5.
7. Work Planning:
   - while it ran, the row read *"{took} of {x} h standard"*
   - in the finished list, its plan is **y**

## 4. Flags
1. **Before the start:** on another step of an order with an approved standard → **Flag** → hours 5, reason "warped sheets" → Send.
   - The step: *"Flagged by {you}: needs 5 h (warped sheets). Waiting for the Company Admin…"*
   - No second Flag button while it waits.
   - **Start** still works at once.
2. Company Admin: the bell, then Standard Hours → Waiting → **Flagged steps**: the order, step, 5 h, the reason, who flagged it.
3. **Approve.**
   - Production's step: *"Flag approved by {admin}: 5 h counts for the score."*
   - The flagger's bell.
4. **After the finish:** flag the step from part 3, then the Company Admin **rejects** it with a reason.
   - The step: *"Flag rejected by {admin}: the standard counts. {reason}"*
5. Employee Performance → a person on those steps → finished steps:
   - the approved one's Planned is 5 h, marked "flag approved", with timing 5 ÷ took
   - the rejected one is back on its standard
   - while a flag waited, the step wasn't in the list (not counted)

## 5. A step with no approved standard
1. A step R&D hasn't typed, or one still waiting.
   - The panel shows the typed box and *"No approved standard yet: typed hours, this step isn't scored"*.
2. **Start** without typing: *"Type the planned hours for {step} before starting it (it has no approved standard yet)."* Type 1 h, Start.
   - *"Planned: 1 h (typed, no standard: not scored)"*
   - no Flag button
3. Work Planning, before the start:
   - *"no standard: type planned hours"*
   - after typing: *"planned 1 h (typed, not scored)"*

## 6. The delivery estimate
1. Leads → Estimate Delivery Date on the machine with the approved step.
   - "How this date is worked out": the people and usual-numbers points talk about approved standards.
2. If some steps are still R&D's unapproved figures: *"How sure: Rough"*, with "…including step hours R&D typed that the Company Admin hasn't approved yet".

## Log
| Step | Result | Notes |
|---|---|---|
| | | |
