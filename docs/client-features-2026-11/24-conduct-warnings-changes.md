# Feature 24: Warnings before points come off, and a photo for every Safety note (what changed)

*Built 23 November 2026, from the client's request the same day. Logic and your decisions (A–F as recommended, "a warning always comes first", immediate action by HR approved by the Company Admin): [24-conduct-warnings-logic.md](24-conduct-warnings-logic.md). Browser test: [24-conduct-warnings-test-roadmap.md](24-conduct-warnings-test-roadmap.md).*

## In one line
A head can no longer take points off straight away. They give **warnings** first, as many as HR's rule for that type says. Only then can a **concern** be recorded. For something that can't wait, **HR** records **immediate action**, which the **Company Admin** approves. A **Safety** concern or warning needs a **photo**.

## The note dialog (Production → Manpower, and HR's Employee Performance)
- **Three kinds:** **Warning** · Concern · Appreciation.
- **For the chosen type, a line shows where the person stands:** *"Discipline warnings: 1 of 2 in the last 3 months · 1 waiting for HR · a warning counts after HR approves"*. The dialog picks the kind that's possible:
  - **warnings left:** Warning. Concern says *"Give a warning first: Ravi has 0 of 1 discipline warning (last 3 months)…"* and can't be sent.
  - **all used:** Concern (the head picks Minor / Major / Serious). Warning says *"Ravi has had all 2 discipline warnings. This one has to be a concern."*
  - **one waiting for HR:** *"A discipline warning is waiting for HR. Once HR approves it, the next note can be a concern."*
- **A warning has no severity and takes no points off.** It shows as **"Warning 1 of 2 · Discipline"** everywhere.
- **On HR's page only, under Concern:** **Immediate action (no warning first)**, with *"Why it can't wait"* (required). The button says **Send to the Company Admin**.
- **Safety & rules:** the file field becomes **"Photo (required for Safety)"**, accepting images only (it opens the camera on a phone). Without a photo the note can't be sent.
- **The server checks all of this too,** so the screen can't get around it.

## HR's rules (Employee Performance → Warning rules, a new tab)
- **One line per type:** **warnings before a concern** (1–5) and **a warning counts:** *after HR approves* or *at once*.
- **Every type starts at 1 warning, after HR approves.** 0 isn't offered, because a warning always comes first.
- **Who can save:** HR with Employee Performance "edit", and the Company Admin. It shows who saved it last.
- **Changes apply to new notes.** Warnings already given keep their "1 of 2".
- **Warnings count for 3 months, by the date they happened.** After a quiet spell, the person is warned again before any action.

## What happens to each note
| Note | Goes to | Counts when | Takes off |
|---|---|---|---|
| Warning, rule "after HR approves" | HR (bell) | HR approves it | nothing |
| Warning, rule "at once" | nobody needs to verify it (shown as **Counted**) | at once | nothing |
| Concern (warnings used up) | HR (bell), as before | HR verifies it | 25 / 50 / 100% of the part, as before |
| Immediate action (HR) | the **Company Admin** (bell) | the Company Admin approves it (not HR, and not its writer) | as a concern |
| Appreciation | HR, as before | | nothing |

- **When someone's warnings for a type are used up,** HR and the head who wrote the note get a bell: *"Ravi: Discipline warnings used (1 of 1). The next discipline note on Ravi is a concern."*
- **HR's notes tab:**
  - *Waiting to verify* is HR's queue
  - a new filter, **Immediate action, waiting for the Company Admin**, is the Company Admin's queue and opens first for them; the tab label says *"· 1 immediate action for you"*
  - HR sees *"The Company Admin approves"* on those notes
  - each immediate note shows *"No warning first: (reason)"*

## Not changed
- **The points:** the Minor / Major / Serious deductions (the Company Admin's settings).
- **The rest of the flow:** verify / reject / cancel, and who can write notes.
- **Notes recorded before today.**

## Technical notes
**Server:**
- **`models/ConductNote.js`:**
  - kind `Warning`
  - `warningNumber` / `warningsAllowed`, `autoCounted`, `immediate` / `immediateReason`
  - index `{ company, person, kind, date }`
- **New `models/ConductWarningRules.js`:** one per company; each type `{ allowed 1–5, countsAt 'approval' | 'once' }`.
- **`services/conductNoteService.js`:**
  - `getRules` / `saveRules`
  - `warningsSince` (3 calendar months, India date) and `warningState` (counted / pending per type, one read)
  - `recordNote` holds the rules: Safety photo, warning first, the warning cap, counted at once, immediate action only with `canImmediate`, and the bells
  - `verifyNote` / `rejectNote`: immediate notes only by a Company Admin; the limit bell after approving a warning
  - `listNotes`: `Pending` excludes immediate; new `AwaitingAdmin`; returns `awaitingAdmin`
- **`middleware/conductNoteUpload.js`:** passes the file's type, used for the Safety check only.
- **`services/score/scoreCalc.js` `conductPart`:** only concerns take points off.
- **`controllers/scorecardController.js`:** HR's post allows immediate action; the rules routes; the warning read for HR (anyone) and Production (its people).
- **Routes:**
  - `GET/PUT /api/manpower-score/warning-rules`
  - `GET /api/manpower-score/conduct-notes/warnings?person=`
  - `GET /api/production-mfg/conduct-notes/warnings?person=`

**Screens:**
- `components/score/ConductNoteDialog.jsx`: the three kinds, the warning line, immediate action, the Safety photo
- `components/score/ScoreParts.jsx`: `noteTitle` (*Warning 1 of 2 · Discipline*, *Immediate action · Serious safety concern*) and `NoteStatus` (*Waiting for the Company Admin*, *Counted*), shared by HR's page, Production's Manpower and the person's score
- `pages/hrms/ManpowerScore/ManpowerScore.tsx`: the Warning rules tab, the Company Admin's queue and buttons
- `components/production/ManpowerScores.jsx`: the dialog's warning read

## Tests
**New suite `warnings`, 47 of 47,** through the real server, on made-up companies with `.invalid` emails:
- **The rules:**
  - the defaults are 1 / after HR approves, for 3 months
  - a Production Head can't save them; 0 and 6 are refused
  - the Company Admin and HR save them (HR's name kept)
- **Safety:**
  - no file → refused; a PDF only → refused, with the file deleted
  - a photo → saved; an appreciation needs none
- **A warning first (Discipline, 1, after HR approves):**
  - a concern with no warning is refused
  - the warning waits ("1 of 1", no severity), and HR gets a bell
  - while it waits, another warning and a concern are both refused
  - the dialog's read shows 0 counted / 1 waiting
  - HR approves it → the "used up" bell to HR and the head
  - a concern is now accepted; another warning is refused ("has to be a concern")
- **At once (Teamwork, 2):**
  - warning 1 is counted at once, with no "to verify" bell
  - a concern at 1 of 2 is refused
  - warning 2 → the "used up" bell; a 3rd is refused; the concern is accepted
- **3 months:** a warning from 4 months ago doesn't count.
- **Immediate action:**
  - refused from Production, and refused from HR without a reason
  - with one → waiting, and the Company Admin gets a bell
  - not in HR's queue; in the Company Admin's
  - HR can't approve or reject it; the Company Admin approves it
  - a Company Admin can't approve their own; another can
  - with the warnings already used up, "immediate" is just a concern
- **The scorecard:** 2 counted warnings take nothing off; the verified Minor concern takes 25%; the approved Serious immediate action takes the whole part.
- **Reading:** HR reads anyone's warnings; Production only its own people; another company gets 404.

**Regression:**
- **`scorecard` 113 of 113.** The suite now seeds counted warnings before its concerns, sends its Safety concerns with a photo, and its "Production sees its notes" count includes the 4 warnings.
- **`inccap` 42, `mpages` 21.**

**Checks:** the server files pass the strict ES-module syntax check and the routes load; the screens bundle with every import found.
