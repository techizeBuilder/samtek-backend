# Employment status on a person's profile: now saved (fix)

*Fixed 25 November 2026. Found by you in the browser test (session A): every person showed a **PROBATION** tag.*

## What was wrong
**The person's profile has three HR boxes:**
- **Probation & Confirmation:** the tick, a date, a justification, **Save Confirmation**
- **Edit Job Information:** includes a probation end date
- **Resigned / Terminated:** the ticks, a date, a reason, **Save Status Changes**

**The screens sent all of it, but the server had no place to store it and dropped it without saying.** So:
- every person read **PROBATION**, which is just what the screen shows when nothing is saved
- **Save Confirmation** did nothing
- **Save Status Changes** only switched the person active / inactive; resigned, terminated, the date and the reason were lost
- on dev, nobody had any of these saved

It had nothing to do with documents.

## What changed
- **The server stores** the employment status (Probation or Confirmed), the probation end date, the confirmation date and justification, resigned / terminated, and their date and reason.
- **Who may change them:** HR, the Company Admin or a Super Admin, never on their own record.
  - A manager's or the person's own attempt is refused: *"Only HR or the Company Admin can change probation, confirmation or resignation details."*
  - A manager's Edit Job Information still saves when it re-sends the current values unchanged.
- **Checks:**
  - the status is Probation or Confirmed
  - dates must be real dates; a cleared date is removed
  - a person can't be both resigned and terminated
- **Confirmed without a date:** today's date is recorded. Confirming again keeps the first date.
- **Nothing saved yet still reads PROBATION,** on both profile screens (HR's view and the person's own).
- **HR's profile page now says "Saved", or "Not saved" with the reason.** Before, a refused save looked like nothing happened.

## Not changed
- Resigned / Terminated still switches the person to inactive, and un-ticking makes them active again. A person waiting for the Company Admin (feature 31) still can't be made active by hand.
- **New people still start without a saved status, so they read PROBATION** until HR confirms them.

## Files
- **Server:** `models/User.js` (the fields), `controllers/userController.js` (who may, checks, saving).
- **Screens:**
  - `pages/hrms/Profile.tsx` (the tag's default; Saved / Not saved)
  - `pages/hrms/Employee/Profile/PersonalInformation.tsx` (the Current Status default)

## Tested
- **New suite `empstatus`: 15 of 15,** through the real server on a made-up company:
  - HR confirms (status, date, justification) and the profile reads it back
  - the Company Admin sets probation with an end date
  - the confirmation date is kept, or today when none
  - a cleared date is removed
  - bad status / date and resigned + terminated are refused
  - the manager, HR on themselves, and the person themselves are refused; the manager's unchanged job edit still saves
  - resigned with date and reason → inactive; un-ticked → active
- **Regression:** `companyaccess` 42, `people` 123, `headapprove` 34, `caadduser` 19, all passing.
- **Both screens bundle.**

## Browser check (quick, on test-1 as HR)
1. **Open a person's profile → Probation Confirmation:** tick, a date, a line of justification → **Save Confirmation**.
   - a "Saved" message
   - the tag turns green **CONFIRMED**, and stays so after a refresh
2. **Resigned:** tick, a date, a reason → **Save Status Changes**. After a refresh the ticks, date and reason are still there, and the person is inactive. Un-tick and save to undo.
