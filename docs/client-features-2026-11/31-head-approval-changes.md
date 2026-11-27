# Feature 31: A Department Head added by HR waits for the Company Admin (what changed)

*Built 25 November 2026. Logic and decisions: [31-head-approval-logic.md](31-head-approval-logic.md). Browser test: [31-head-approval-test-roadmap.md](31-head-approval-test-roadmap.md).*

## In one line
**When HR gives someone a Department Head role, nothing changes for that person until the Company Admin approves.**

This covers adding a new user, changing a role, or giving a login. The Company Admin (and a Super Admin) still give Head roles directly.

## The Head roles
Sales, Production, Packing and Dispatch (and the old Packing Head), Accounts, R&D, Complaint Management, Store, QC and Marketing.

Manager and MIS Admin don't wait.

## HR
- **Add User with a Head role:**
  - The person is saved with all details, but **inactive**.
  - The screen says **"Sent for approval"**.
  - If they try to sign in: *"Your account is waiting for the Company Admin's approval."*
- **Give Login with a Head role:**
  - The person stays without a login until approved.
  - The screen says the login comes once the Company Admin approves.
- **A role change to a Head** (through the API; no HR screen offers it):
  - The person keeps their current role.
  - Anything else in the same edit saves.
- **Employee Management:**
  - The person shows **"Waiting for the Company Admin"** (or *"QC Head waiting for the Company Admin"* for a role change).
  - Activate / Deactivate is hidden for them.
- **A bell** says approved, or rejected with the Company Admin's reason.
- **While a request waits:**
  - HR can't change that person's role again.
  - Nobody can make them active by hand. *"Approve or reject it first."*

## The Company Admin
- **A bell:** *"Sales Head for Ravi Kumar needs your approval"*, with who asked.
- **Roles & Permissions → Waiting for your approval (n),** a box at the top, shown only when something waits. Each request shows:
  - the name, the role and the kind (new user / role change / login)
  - email, department and designation
  - the permissions HR chose
  - who asked and when
- **Approve:**
  - a new user becomes active
  - a role change switches the role and permissions
  - a login is given, with the password HR set
- **Reject:** a reason is required, and HR sees it.
  - **A new user is removed,** so the email is free again.
  - **A role change or a login** is dropped; the person stays as they were.
- **A waiting person in the users list** shows *"… waiting"*.
- **The Company Admin's own role change** for that person replaces the waiting request.
- **A login whose email someone else took meanwhile** can't be approved. The message says to reject it and ask HR again.

## On the server
- **The rules are enforced on the server** for all three ways, whatever the screen sends.
- **The waiting role, permissions and login** are kept on the person's record (`headApproval`) and only applied on approval.
  - The waiting password is stored hashed and is never sent back.
- **New routes:**
  - `GET /api/users/head-approvals` (the Company Admin's own company; a Super Admin: any)
  - `POST /api/users/:id/head-approval` (`{ approve, reason }`)

## Fixed in the browser test (25 Nov)
**The Company Admin's bell opened HR's Employee Management ("Access Denied").**
- It now opens **Roles & Permissions**.
- HR's approved bell opens the person; a rejected one opens Employee Management.
- Any other HR bell for the Company Admin opens their own Employee Management (`components/notifications/NotificationBell.jsx`).

## Files
- **Server:**
  - new `services/access/headApproval.js`
  - `models/User.js` (`headApproval`, an index)
  - `controllers/userController.js` (create, edit, Give Login, the two handlers)
  - `auth-routes.js` (routes, the sign-in message)
- **Screens:**
  - new `components/users/HeadApprovals.jsx`
  - `pages/RolePermissionManagement.jsx`
  - `pages/hrms/AddUser.tsx`, `pages/hrms/GiveLoginModal.tsx`, `pages/hrms/Employee.tsx`

## Tested
- **The new suite `headapprove`: 34 of 34,** through the real server on made-up companies:
  - **a new Head from HR:**
    - inactive and pending
    - can't sign in
    - the Company Admin's bell
    - nobody can make them active by hand
    - approve → active and signs in, and HR's bell
  - **reject:**
    - a reason is required
    - the user and their documents removed, and the email reusable
    - HR's bell has the reason
  - **no approval needed** for HR adding an employee, or the Company Admin adding a Head
  - **a role change:** waits, other fields save, a second change refused, approve switches, reject keeps, the Company Admin's own change replaces it
  - **Give Login:**
    - waits with the password hashed and never sent back
    - approve → signs in with HR's password
    - reject → still no login
    - email taken meanwhile → refused
  - **boundaries:** another company's Company Admin and HR can't list or decide; a Super Admin can
- **Regression:** `caadduser` 19, `companyaccess` 42, `people` 123, `hrperms` 33, all passing.
- **The five screens bundle.**
