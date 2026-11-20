# Feature 15: The incentive cap (what changed)

*Built 18 Nov 2026. Logic and decisions A–G: [15-incentive-cap-logic.md](15-incentive-cap-logic.md).*

## In one line
The Company Admin sets how much HR may approve alone per person per month. Up to that amount, HR decides as before. Above it, the incentive waits for the Company Admin and isn't paid until they approve it.

## What people see
- **Company Admin → Performance Settings:**
  - **New box:** "Incentives HR can approve alone: up to ₹ … per person per month". Empty = no limit.
  - It's saved with the points, from the "applies from" month (never a past month).
  - The top line says what's in force this month. The change history has a **Cap** column.
  - "Client's defaults" clears the cap (no limit).
- **HR → Give incentive / Approve:**
  - Under the amount: "HR approves alone up to ₹X a month for this person; ₹Y already approved for {month}."
  - If the amount takes the person over it, the line turns amber, and the button reads **"Send to Company Admin"**.
  - With no cap set: "No cap set: HR approves any amount."
- **Status "Waiting for Company Admin"** (orange) on HR's list, Production's list and in a person's view.
  - The amount column shows "₹X proposed by …" for a direct give, or "approved by …" for an approved request.
  - HR sees "Company Admin decides" instead of the buttons.
- **Company Admin → Employee Performance → Incentives:**
  - It opens on **"Waiting for Company Admin"**, and the tab shows how many are waiting.
  - **Approve:** they may change the amount or the month. The box says why it came to them: the cap and what was already approved.
  - **Reject:** with a reason.
  - Their own Give, or their approval of a request, is never capped.
- **Bells:**
  - The Company Admin gets "Incentive above the cap — {person}".
  - When HR's approval of a request goes up, the Production Head hears "sent to the Company Admin".
  - After the Company Admin decides, both the HR person who sent it and the Production Head who asked are told.
- **Payroll:** only approved incentives are paid. One waiting for the Company Admin is not paid.

## The rules (from the logic doc)
- **The cap counts per person per payroll month** (A): everything already approved for that month, plus this one.
  - Example with a ₹1,000 cap: ₹500 + ₹500 is at the cap, so it's approved. ₹1 more goes to the Company Admin.
- **It covers HR's direct give and HR approving a Production request** (B).
- **No cap set = no limit** (C).
- **The cap in force for the incentive's payroll month applies** (E). A cap from December leaves November alone.
- **That month's payroll is already run while it waits** (F): the Company Admin's approval is refused for that month, so they pick the next one.

## Technical notes
- **`ScorecardSettings.incentiveCap`** (Number or null). `scorecardSettings.js` reads and saves it: whole rupees ≥ 0, or empty for no limit. `CLIENT_DEFAULTS.incentiveCap = null`.
- **`IncentiveRequest`:**
  - The status `AwaitingAdmin` is new.
  - New fields `forwardedBy` / `forwardedByName` / `forwardedAt`, and `capCheck { cap, approvedBefore }`, which is what the check saw.
- **`incentiveService.js`:**
  - `capInfo` reads the month's cap through `settingsFor` and sums the person's approved amounts for that month, using the existing person + month index.
  - `overCap` is never true for the Company Admin or Super Admin.
  - `giveIncentive` and `approveIncentive` send work above the cap up.
  - `loadRequest` lets only the Company Admin decide an `AwaitingAdmin` one; HR gets 403.
  - New `incentiveCapView`.
- **New route:** `GET /api/manpower-score/incentives/cap?person=&month=&except=`. It needs Employee Performance view (the Company Admin by role).
- **Client:**
  - `EmployeePerformanceSettings.jsx`
  - `IncentiveDialog.jsx`: the new `capUrl` prop
  - `ScoreParts.jsx`: the `IncentiveStatus` label
  - `ManpowerScore.tsx`: filter, buttons, amount column, waiting count
  - `ManpowerScores.jsx` and `PersonScoreDialog.jsx`: the waiting amount
- **Known limit:** two HR people approving for the same person at the same second could both pass the check. It's very unlikely, and the Company Admin sees both rows.

## Tests
- **New suite `inccap`, 42 checks** (40, plus 2 for the one-bell fix of 18 Nov):
  - no cap
  - setting the cap: HR refused, half rupees, negative, past month; versions by month; an empty cap from a later month
  - under, at and over the cap for a direct give
  - the Company Admin's bell
  - payroll pays only what's approved
  - HR can't decide a waiting one
  - the Company Admin's waiting list
  - a different month with its own sum and cap
  - a Production request approved above the cap: waits, the Production Head is told, Production sees it, the Company Admin approves a changed amount, both are told, payroll pays it
  - deciding twice is refused
  - the Company Admin rejects; their own give above the cap is approved at once
  - payroll already run → refused, then next month approved
  - another company sees nothing
- **Regression, all passing 18 Nov:** `incentive` 50, `scorecard` 113, `payroll` 68, `mpages` 21, `hrperms` 33.
