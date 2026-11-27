# Feature 31: A Department Head added by HR waits for the Company Admin (logic and decisions)

*25 November 2026, from the client: when HR adds a new department head, it isn't added straight away; the Company Admin approves it.*

## What it is today
**HR can make someone a Department Head in three ways, and each takes effect at once:**
1. **Add User** with a Head role (`POST /api/users`).
2. **Editing a person's role** to a Head (`PUT/PATCH /api/users/:id`). No HR screen offers this, but the server allows it.
3. **Give Login** to a no-login person with a Head role (`POST /api/users/:id/give-login`, the Give Login window).

**Also:**
- The Company Admin and the Super Admin make Heads directly.
- HR's Bulk Import calls a server address that doesn't exist. It's handled separately, next.

## Decisions (25 Nov, as recommended)
1. **The roles:** the Department Heads: Sales, Production, Packing and Dispatch (and the old Packing Head), Accounts, R&D, Complaint Management, Store, QC and Marketing.
   - Manager and MIS Admin are not included.
2. **Who needs approval:** anyone except the Company Admin and the Super Admin, in practice HR. The Company Admin is the approver.
3. **A new user from HR with a Head role:**
   - Saved with all their details, but **inactive** and marked *waiting for the Company Admin*.
   - They can't sign in. A sign-in attempt says *"Your account is waiting for the Company Admin's approval."*
   - They stay out of payroll, scores and teams, which already leave inactive people out.
   - Their employee ID, email and device code are kept for them.
4. **Give Login with a Head role:**
   - The person stays without a login.
   - The email, password (stored hashed) and role wait with the request.
   - The email is checked when asked and again when approved.
5. **A role change to a Head** (by edit):
   - The person keeps their current role, and the Head role and its permissions wait.
   - Other details saved in the same edit save as usual.
6. **One request per person at a time.**
   - While one waits, HR can't change that person's role again or make them active.
   - A Company Admin's or Super Admin's own role change replaces a waiting request.
7. **The Company Admin:**
   - **A bell:** *"Production Head for Ravi Kumar needs your approval · asked by HR"*.
   - **A Waiting for your approval box** at the top of Roles & Permissions (with the count; shown only when something waits) listing:
     - who, the role, new user / role change / login
     - department and designation
     - the permissions HR chose
     - who asked and when
   - **Approve:**
     - a new user becomes active
     - a role change switches the role and permissions
     - a login is given
   - **Reject:** with a reason (required).
   - The Company Admin can still change permissions afterwards, as today.
   - A Super Admin may also decide.
8. **HR:**
   - **After saving,** the screen says *"Sent to the Company Admin for approval."*
   - **Employee Management** shows a *"Waiting for the Company Admin"* tag on the person. Their active switch is off until decided.
   - **A bell** with the decision (and the reason if rejected).
9. **Rejected:**
   - **New user:** the record is removed, so the email and employee ID are free again. HR's bell keeps the name and the reason.
   - **Role change:** dropped; the person stays as they were.
   - **Login:** dropped; the person stays without a login.
10. **The server enforces all of it,** whatever the screen sends.
11. **Heads made before today stay as they are.**

## Not changed
- The Company Admin and the Super Admin making Heads (no approval).
- HR adding anyone in a non-Head role.
- Feature 27's rule on who may give which role.

## Known, unchanged
**About 13 places look people up by a Head role without checking "active"** (e.g. to find a department's Head). A waiting new Head is inactive, just like a Head who has been deactivated today, so it behaves the same as that existing case.
