# Feature 2, stage 3: Payroll (what changed)

*Built 11 November 2026. Logic and worked examples: [02c-payroll-logic.md](02c-payroll-logic.md). Browser test: [02c-payroll-test-roadmap.md](02c-payroll-test-roadmap.md).*

## In one line
Pay is now worked out on the server, one day at a time. It covers the whole company, and it pays for **working days**: a weekly off isn't counted, half days are half, holidays are Paid or Unpaid, and leave is counted from its first day.

## What was wrong, and what happens now
| Before | Now |
|---|---|
| Only the 15 newest people got payroll | Everyone with a salary structure |
| Sundays and holidays were loss of pay | Weekly offs aren't counted at all; a Paid holiday is paid |
| A half day paid as a full day | Half a day, or a full day with approved paid leave that day |
| The first day of every leave was loss of pay | Counted from the first day |
| Payslips said 30 pay days, 0 loss of pay | The real numbers |
| Recalculate sent back the old amount | Works the pay out again from today's attendance |
| Workers with no login couldn't take leave | HR adds it for them |
| The browser worked out pay and the server saved whatever it was sent | The server works it out; numbers sent are ignored |

## The rule, in short
- **Working days** = days in the month − weekly offs.
- **Earned** = monthly gross × pay days ÷ working days.
- **Net** = earned − PF, professional tax, TDS, advance and others, as before.
- **Someone who works every working day gets the full salary,** whatever the month.

**Today, with nothing recorded yet,** counts as still to come, not absent.

Each day is one of: weekly off, before joining, still to come, paid holiday, unpaid holiday, present, half day, paid leave, unpaid leave or absent. Before joining, still to come and unpaid holidays aren't paid, but they don't count as absence either.

**Weekly off:**
- **People on the device:** the device's `WO`, or a Sunday with no device row.
- **Everyone else:** the company's weekly off days, Sunday unless HR changes it.

## On screen
**Payroll Run:**
- **Opens on last month.** Columns are working days, pay days, loss of pay, gross, deduction, net and status.
- **Paged with a search box.** Totals sit at the top.
- **Click a row** to see that person's month: how many days of each kind, and which dates.
- **"How pay is worked out"** opens the rules, in English or Hinglish.
- **Run Payroll** works only once the month is over. Until then the page shows pay **so far**, with an amber note. The button says how many people haven't been run yet.
- **A second run** adds only people missing a row. A row already run is never changed.
- **"Not paid: no salary entered"** lists people left out, so nobody disappears silently.

**Holidays:**
- **Adding takes From and To dates.** Each date is saved as its own holiday, and dates already there are skipped.
- **Paid or Unpaid,** Paid unless changed. The list shows a badge.
- **Editing** changes one date and Paid/Unpaid.

**HR Policy → Attendance Policies:** a **Weekly Off** card, and day buttons Sun–Sat in Edit Policy.

**Leave Requests (HR):** **Add leave for someone.**
- **For anyone in the company,** including workers with no login.
- **Saved as approved.** The leave balance is checked, and days that already have leave are refused.
- **Not for yourself.** HR's own leave goes through Apply Leave.

**Payslip popup:** working days next to pay days and loss of pay.

## Also fixed on the way
- **Leave types are matched within the person's own company first.** Before, two companies with a "Casual" type could pick up each other's rules.
- **Holidays:** another company's HR could edit or delete your holidays by ID. Now refused. The weekday is worked out from the date in India time.

- **People pickers that missed people (found in the browser test):** Add Salary Structure and Override Leave Balance listed only the 15 newest people. Now you type to find anyone, using the server's search (`pages/hrms/PersonPicker.tsx`, new). The reporting-manager list on a person's profile and the department-head list now ask the server for Managers, instead of picking them out of those same 15.

- **Payslip PDF (found in the browser test):** the Deductions box now has a **"Days not paid"** line, so the deductions add up to what was taken off. When deductions are more than earnings, net stays at ₹0. (`utils/generatePayslipPDF.js`)

## Worth knowing
- **Pay already run before today keeps its old numbers.** Those rows have no day counts, so the columns show "–".
- **Reset still refuses once anything is Paid,** and Run Payroll saves rows as Paid, as before. In practice a run month can't be reset. Rejecting a row and recalculating it is the way to correct one person.
- **Email:** adding leave for someone emails them, the same as an approval. Generating payslips emails each person. Only people with an email address get one.
- **The payslip popup's PDF button** on Payroll Run still looks up the payslip by the payroll row's ID, as it did before, so it usually finds nothing. Download payslips from the Payslips page. This wasn't changed here.
- **Not in this stage:** overtime pay, extra pay for working on a weekly off or holiday (counted and shown only), late marks turning into half days, daily-wage labour. These wait for the client.

## Tests
- **New suite `payroll`: 68 of 68.**
  - **The calculation against the doc's hand-worked totals:** A ₹12,712, B ₹6,472, C the same as A with one worked Sunday, D ₹12,088. Each rule on its own, too.
  - **Through the real server, on made-up companies:**
    - All 44 people listed, not 15. Paging and search.
    - October checked to the rupee for a device worker, a no-login worker with leave HR added, an office worker before and after Saturday became a weekly off, and an unpaid leave day.
    - Run refused for the current month. Numbers sent by the screen ignored. A second run changes nothing.
    - The payslip shows the real days. Reject, change attendance, and recalculate gives the new amount.
    - Holiday ranges, and leave added by HR with all its refusals.
    - Another company sees none of it.
- **Regression:** `hrroutes` 92, `approvals` 38, `devicesync` 80, `people` 123, all passing. `hrroutes` was changed to match: it ran payroll for a future month and sent numbers, which the server no longer allows or uses.
- **Screens:** all 7 changed files compile.

## Files
**Backend:**
- **New:** `services/payroll/payrollCalc.js` (the day rules and the money, no database) and `services/payroll/payrollService.js`.
- **Models:** `Payroll` (working days, earned, day counts), `Holiday` (`paid`), `AttendancePolicy` (`weeklyOffDays`), `Leave` (`addedBy`).
- **Controllers:** `payroll`, `payslip`, `holiday`, `attendancePolicy`, `leave`.
- **Routes:** `payroll` (`GET /payroll/month`, `GET /payroll/days`), `leave` (`POST /leaves/for-someone`).

**Frontend:**
- `pages/hrms/Payroll/PayrollRun.tsx` (rewritten), `PayExplainer.tsx` (new) and `ViewPayrollModal.tsx`
- `pages/hrms/Holidays/AddHolidayModel.tsx` and `Holiday.tsx`
- `pages/hrms/SystemConfigration/Policies.tsx`
- `pages/hrms/LeaveManagement/HRAdminLeaveRequest.tsx`
