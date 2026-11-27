# Feature 31: A Department Head added by HR waits for the Company Admin (browser test)

*On test-1. What changed: [31-head-approval-changes.md](31-head-approval-changes.md). The suite `headapprove` (34) checks the server rules; this is about the screens.*

**Logins:** test-1's HR-Admin (`testhr`); test-1's Company Admin. Use made-up emails like `zz-head1@test.invalid`.

## 1. HR adds a Head
1. **As HR, Add User:** Gets a login: Yes, role **Sales Head**, fill the rest, Create.
   - The toast says **"Sent for approval"** / *"Sent to the Company Admin for approval."*
2. **Employee Management:**
   - the person shows **"Waiting for the Company Admin"** (grid and list)
   - their menu has no Activate
3. **Optional:** sign in as that person. *"Your account is waiting for the Company Admin's approval."*

## 2. The Company Admin approves
1. **As the Company Admin:** the bell *"Sales Head for … needs your approval"*.
2. **Roles & Permissions:** the **Waiting for your approval (1)** box at the top shows:
   - the name, Sales Head, New user
   - email, department and designation
   - the permissions
   - asked by HR, with the time
3. **Approve:**
   - the box goes away
   - the person is Active in the list
   - HR gets the bell *"… approved"*
4. **Optional:** the person can now sign in.

## 3. A rejection
1. **As HR,** add another Head (e.g. QC Head).
2. **As the Company Admin, Reject:**
   - the reason box appears, and Reject stays off until something is typed
   - type "Wrong department" and Reject
3. **The person is gone** from Employee Management, and HR's bell shows the reason.

## 4. Give Login with a Head role
1. **As HR,** open a person with **No login** → Give Login → role **Store Head**.
   - The toast says it's sent for approval.
   - They still show No login, plus the waiting tag.
2. **As the Company Admin, Approve:** the person now has a login with that email and password.

## 5. What doesn't wait
1. **HR adds a Sales Employee:** active at once, no box.
2. **The Company Admin adds a Head** (Create New User): active at once.

## Clean-up
Delete the test users afterwards.

## Result (25 Nov 2026)
**PASSED** in the browser (parts 1–5).
- **Fixed during the test:** the Company Admin's bell opened HR's Employee Management ("Access Denied"). It now opens Roles & Permissions, and HR's approved bell opens the person. Any other HR bell for the Company Admin opens their own Employee Management (`components/notifications/NotificationBell.jsx`).
- **Give Login was tried on Test Worker Five (EMP-TES-0043)** and then put back to no login (Manpower, device code 0005). The record from before is in `D:\cs\db-backups\f31-browser-test-2026-11-25\`.
- **Clean-up:** the test people and their approval bells were deleted, with a backup in the same folder.
