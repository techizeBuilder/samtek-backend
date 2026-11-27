# Feature 24: Warnings and the Safety photo (browser test)

*On test-1. What changed: [24-conduct-warnings-changes.md](24-conduct-warnings-changes.md). The suite `warnings` (47) already checks the rules; this is about the screens. Before starting I take a snapshot of the notes and rules; after the test what it made is removed.*

**Logins:** Production Head (Manpower), HR (Employee Performance), Company Admin. A phone helps for the Safety photo.

## 1. HR's rules
1. **HR → Employee Performance → Warning rules:** every type shows 1, *After HR approves*.
2. Set **Teamwork: 2, At once**. Save: *"Saved. The rules apply to new notes."*

## 2. A warning first (Production Head, Manpower → a person → Conduct note)
1. **About: Discipline.** The line says *"Discipline warnings: 0 of 1 … a warning counts after HR approves"*, and the dialog is on **Warning**.
2. Click **Concern:** *"Give a warning first…"*, and the button can't be pressed.
3. **Warning** → write what happened → **Send to HR**.
4. Open it again: *"1 waiting for HR"*. Warning says it's waiting for HR, and Concern is still blocked.
5. **HR → notes:** the note reads **"Warning 1 of 1 · Discipline"** → **Verify**. HR and the head get *"Discipline warnings used (1 of 1)"*.
6. **The head again:** the dialog opens on **Concern**; pick Minor → Send. Warning now says *"This one has to be a concern."*

## 3. Counted at once (Teamwork: 2)
1. **Teamwork warning:** the button says **Give warning**. In HR's list it's **Counted**, and no bell asks HR to verify it.
2. A second Teamwork warning → the "used up" bell. A third isn't possible; a concern is.

## 4. Safety needs a photo
1. **About: Safety & rules, Warning:** the field says **Photo (required for Safety)**, and the button can't be pressed without one.
2. **On a phone:** the field opens the camera. Take a photo → Send.
3. **A Safety appreciation:** no photo needed.

## 5. Immediate action (HR → Company Admin)
1. **HR, a person with no Ownership warning → Concern:** blocked, with a tick box **Immediate action (no warning first)**. Tick it, write *why it can't wait*, Serious → **Send to the Company Admin**.
2. **HR's notes:** the note shows *"No warning first: …"* and *"The Company Admin approves"*, not under *Waiting to verify*.
3. **Company Admin:**
   - the bell *"Immediate action to approve"*
   - Employee Performance → notes opens on **Immediate action, waiting for the Company Admin**
   - **Verify**
4. **The person's score** (this month): Ownership is down by the whole part. The Discipline and Teamwork warnings took nothing off.

## Log
| Step | Result | Notes |
|---|---|---|
| | | |
