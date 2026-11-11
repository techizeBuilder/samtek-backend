# Approval routes locked down (what changed)

*Fixed 11 November 2026, right after [HR server routes](05-hr-server-routes-changes.md). This closes the gap that doc left open.*

## The problem
Approving someone's request only checked that you were logged in. Anyone could approve or reject anyone's leave, overtime, expense, travel, profile update or resignation, **including their own.** Anyone could also override a leave balance, add leave types and holidays, or list every request in every company.

**Two were worse:**
- **A profile-update request could change any field on the person,** because the field name came from the request itself. A request for "role" set to "Company Admin" would have made that person a Company Admin once approved.
- **Attendance corrections were saved at the wrong time.** "09:30" was read in the server's own clock, so on a server not set to India time the correction shifted by 5½ hours.

## Who can approve now
**One rule for every approval:**
- **The person's reporting manager** can approve their requests.
- **HR in the same company** can approve where the HR screen has an approve button, with that permission.
- **A platform admin** can approve anything.
- **Nobody can approve their own request,** whatever their role.

**A Manager approves only their own team.** Managers carry the same permission names as HR (Leave Requests, Expense, Travel and so on). Those permissions show their menu, but they don't let a Manager approve someone outside their team.

| Request | Reporting manager | HR in the company |
|---|---|---|
| Leave | Yes | HR-Admin with Leave Requests, edit |
| Overtime | Yes, if their role is Manager and they hold Overtime Requests, edit | No |
| Expense | Yes | No. Marking it paid: HR-Admin, Company Admin or Accounts Head |
| Travel | Yes | No |
| Profile update | Yes | HR-Admin or Company Admin |
| Resignation | Yes | HR-Admin or Company Admin |

This matches the screens. HR-Admin approves leave from its own page. Expense, travel and profile approvals sit only on the Manager screens.

**Lists:**
- **A team's requests:** Managers, with the matching permission.
- **Everyone's requests:** HR roles. Expense also for Accounts Head.
- **A person's own requests and balances:** unchanged, anyone logged in.

**Setup:**
- **Leave types:** reading is open. Adding, editing and deleting need Leave Types, which HR-Admin holds.
- **Holidays:** reading is open. Adding, editing and deleting need HR-Admin or Company Admin.
- **Leave balance override and history:** HR with Leave Types or Leave Requests, for people in their own company.

## Profile updates
An approved request now changes only what its type means:
- **Address** sets the address.
- **Phone** sets the mobile number.
- **Bank, Emergency and Other** are approved but not applied by the system. HR updates those details on the person's record by hand.

**What changes for you:** before, approving a Bank or Emergency request wrote the value to a field nobody reads, so nothing visible changed. Now that's stated plainly.

## Attendance corrections
A corrected time is read as India time, whatever clock the server runs on. 09:30 to 18:00 is saved as 09:30 to 18:00 India time.

## Tests
- **New suite `approvals`: 38 of 38,** through the real running server. For each request type it covers the person refused for their own, another team's Manager refused, another company's HR refused, the right Manager or HR allowed, the lists refused for an employee, and people's own records still working. It also checks a "role" profile request changes nothing, Phone sets the mobile number, and the correction time.
- **Regression:** `hrroutes` 92, `devicesync` 80, `people` 123. One `people` check approved leave as an HR-Admin with no Leave Requests permission. That's now refused, as intended, so the check was given the permission.

## Files
**Backend:**
- **Helper:** `utils/companyScope.js` gets `canApprove`.
- **Routes:** `leave`, `leaveBalanceAdjustment`, `leaveTypesRoutes`, `holiday`, `overtime`, `expenseRequest`, `travelRequest`, `profileUpdate`, `resignation`
- **Controllers:** `leave`, `leaveBalanceAdjustment`, `overtime`, `expenseRequest`, `travelRequest`, `profileUpdate`, `resignation`, `attendanceRequest`
