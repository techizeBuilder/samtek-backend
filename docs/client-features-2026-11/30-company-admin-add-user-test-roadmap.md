# Feature 30: The Company Admin adds users with HR's form (browser test)

*On test-1. What changed: [30-company-admin-add-user-changes.md](30-company-admin-add-user-changes.md). The suite `caadduser` (19) checks the server rules and the security fixes; this is about the screens.*

**Logins:** test-1's Company Admin; test-1's HR-Admin (`testhr`).

## 1. The Company Admin's form
1. **Roles & Permissions → Create New User:** the full Add User page opens:
   - no "Gets a login" choice
   - no Bulk Import
   - the company already picked
2. **The Role list** has two groups:
   - **Admins:** HR Admin, Company Admin, Manager, MIS Admin
   - **Department Heads**
   - no employee roles
3. **Pick Company Admin:**
   - no permissions grid, and the note *"A Company Admin's pages come with the role."*
   - Reporting Manager says (Optional)
4. **Pick HR Admin:** the permissions grid with HR's pages ticked; Reporting Manager optional.
5. **Pick Sales Head:**
   - the Sales grid
   - Reporting Manager required
   - the IVR card shows, as on HR's form
6. **Press Create with fields empty:** the same red "Required" messages as HR's form (mobile 10 digits, email format).
7. **Create a Head "Zz F30 Head"** with a department and designation:
   - it goes back to Roles & Permissions, and the new user is in the list
   - Employee Management shows their department, designation, mobile and joining date
8. **Optional: create an HR Admin "Zz F30 HR"** and sign in as them. HR's menu (Employee Management, Payroll, KRA…) is there.
9. **Delete the test users** afterwards.

## 2. The edit dialog
1. **Edit a user on Roles & Permissions:** role, permissions, active and password as before.
2. **Superadmin is not in the role list.**

## 3. HR's Add User is unchanged
1. As `testhr`, **Employee Management → Add User:**
   - the "Gets a login" choice
   - Bulk Import
   - Employee Roles, Department Heads and custom roles
2. **Reporting Manager** is still optional only for Manager.

## Result (25 Nov 2026)
**PASSED** in the browser (parts 1–3), with the Company Admin and testhr on test-1. Zz F30 Head was created with department, designation, mobile and joining date saved, then deleted in the clean-up.
