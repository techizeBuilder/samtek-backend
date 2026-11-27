# Feature 24: Warnings before points come off, and a photo for every Safety note

*Client request, 23 November (shown on Production → Manpower's conduct note). Logic for discussion; nothing built yet.*

## What was asked
1. **A photo must be attached to Safety notes.** The client first wanted a photo on every concern. After you explained that's not practical, it's **Safety only**.
2. **Warnings.** In real life a head first **warns** someone; the score doesn't drop straight away. So:
   - a head can give a **warning** instead of a concern that takes points off
   - **HR decides, for each type** (Behaviour, Discipline, Teamwork, Ownership, Safety), **how many warnings** someone can get
   - **HR also decides whether a warning counts at once, or waits for HR to review and approve it**

## How conduct notes work today (feature 13)
- **Who writes them:** a head writes a note on Manpower (Production's people), or HR writes one on Employee Performance.
- **What a note has:**
  - **Concern** or **Appreciation**
  - the type, and for a concern the severity: **Minor / Major / Serious**
  - the date, a written reason, and an optional photo or PDF (10 MB)
- **HR verifies or rejects it** (the writer can't verify their own). Only a **verified concern** takes points off, in its month:
  - Minor 25%, Major 50%, Serious 100% of that part (the Company Admin's settings)
- **Nothing is deleted.** HR can cancel a verified note with a reason.

## The proposal
**1. Safety needs a photo.** A Safety **concern or warning** can't be sent without a photo (JPG / PNG / WEBP, 10 MB). The dialog marks the field *Photo (required for Safety)*, and the server checks it too. Appreciation stays optional.

**2. A third kind of note: Warning.**
- The dialog becomes **Concern · Warning · Appreciation**.
- A warning has the type, date, reason (and the Safety photo), but **no severity**.
- It **takes nothing off.** It shows in the person's notes and history as *"Warning 1 of 2 · Discipline"*.

**3. HR's warning rules, one line per type.** A new **Warning rules** section on HR's Employee Performance page:

| Type | Warnings allowed | A warning counts |
|---|---|---|
| Behaviour | 2 | at once |
| Discipline | 2 | after HR approves |
| Teamwork | 1 | at once |
| Ownership | 1 | at once |
| Safety | 0 (no warnings: always a concern) | |

- **0 means no warnings for that type.** Every note is a concern, as today, and the Warning button isn't offered for it.
- **"At once":** the warning counts as soon as the head sends it. HR sees it in the notes list, marked *counted automatically*.
- **"After HR approves":** it waits for HR like a concern. Rejected, it never counts.
- Changing a rule applies to new notes; warnings already given stay as they are.

**4. When someone has had all their warnings for a type:**
- the dialog shows it: *"Asha has had 2 of 2 Discipline warnings (last 3 months). This one has to be a concern."*
- it opens on Concern; the head picks the severity as today
- the server refuses another warning, so the screen can't get around it

**5. Bells:**
- **HR:** a warning waiting for approval
- **HR and the head:** when someone reaches the limit (*"Asha has had 2 of 2 Discipline warnings: the next one is a concern"*)

**How it stays fast:** the warning count is one indexed read of that person's warnings for that type in the period, made when the dialog opens and again when the note is saved.

## Questions for you
- **A. Safety's evidence:**
  - (a) **a photo is required** on every Safety concern and warning; a PDF alone isn't enough (recommended, as the client asked for a photo)
  - (b) a photo **or** a PDF
- **B. What a warning is:**
  - (a) **a third kind of note, Warning:** no severity, nothing taken off, counted per type (recommended)
  - (b) a tick box on a concern ("just a warning")
- **C. Who sets the rules, and the default:**
  - (a) **HR**, as the client said, on Employee Performance; the Company Admin can see and change them too. **Every type starts at 0** (no warnings), so nothing changes until HR sets them (recommended).
  - (b) HR, starting from a default of 2 warnings for every type except Safety
- **D. When the warnings for a type are used up:**
  - (a) **the next note on that type has to be a concern**, and the head picks its severity (recommended: the head keeps the judgment)
  - (b) the next warning **turns into a Minor concern automatically**
- **E. Over what period are warnings counted?** (Without one, someone warned twice in January would have no warnings left in December.)
  - (a) **the last 3 months, rolling** (recommended)
  - (b) the scorecard month (resets every month)
  - (c) the last 12 months
  - (d) HR picks the period for each type
- **F. Bells** as in point 5 (recommended), or none.

## Your decisions (23 Nov)
- **A–F as recommended:**
  - A: a photo is required on Safety concerns and warnings
  - B: Warning is a third kind of note
  - C: HR sets the rules (the Company Admin can too)
  - D: when the warnings are used up, the next note is a concern and the head picks its severity
  - E: the last 3 months, rolling
  - F: the bells
- **Added (the client's rule, which you passed on): no direct action. A warning always comes first.**
  - **A concern can't be recorded on a type until the person has had all their warnings for it** in the last 3 months. Until then the head can only give a warning. The dialog says *"Give a warning first: Asha has 0 of 1 Discipline warnings (last 3 months)"*, and the server refuses a concern too.
  - **So C's default changes:** every type starts at **1 warning** (not 0), and HR can set 1 to 5. 0 isn't offered, as it would mean direct action.
  - **Only counted warnings count** (approved, or "at once"). One still waiting for HR doesn't open the way to a concern.
  - **Warnings older than 3 months no longer count,** so after a quiet spell the person is warned again before any action.
- **The exception, for immediate action (your call, 23 Nov):** something serious, like a dangerous safety act or theft, can't wait for a warning.
  - **Only HR can write it:** a concern marked **Immediate action (no warning first)**, with the reason why it can't wait. Heads always warn first.
  - **The Company Admin approves it,** not HR. Until then it doesn't count; rejected, it never counts. HR can't approve its own.
  - **The Company Admin gets a bell.** The note shows everywhere as *"Immediate action, no warning first: (reason)"*, approved by the Company Admin.

## Not changing
- **The points:** Minor / Major / Serious and the Company Admin's deduction settings.
- **The rest of the note flow:** HR's verify / reject / cancel, and who can write notes.
- **Appreciation notes.**
