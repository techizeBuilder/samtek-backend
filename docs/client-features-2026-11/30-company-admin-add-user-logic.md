# Feature 30: The Company Admin adds users with HR's form (logic and decisions)

*24 November 2026. The Company Admin's **Create New User** (Roles & Permissions page) was compared with HR's **Add User**. The Company Admin's form had fallen behind, because later fixes only went into HR's. Two security holes were found along the way.*

## What it is today
- **The Company Admin has one way to add someone:** the **Create New User** dialog on Roles & Permissions.
  - HR's Add User page is HR-only, and its button is hidden from the Company Admin.
- **The dialog asks for:** username, email, full name, password, role, company and the permissions grid.
- **It doesn't ask for:** mobile, gender, date of birth, joining date (saved as "today"), department, designation, unit, reporting manager, employee type, device code, address or profile picture.
  - So a Head made there is blank in the scorecard, payroll, KRA lists and department filters until HR fills them in.
- **Only username, email, password and role are checked.** Full name shows a * but isn't checked, and there's no email format check.
- **The role list** has Superadmin (hidden from a Company Admin), HR Admin, Company Admin, Manager, MIS Admin and the Department Heads.
- **The saved "permission role" is mangled:** `Research & Development Head` becomes `research_& development head`. About 30 users on dev are like this. Nothing reads it, so it's harmless.
- **Dead code:** a fixed "Unit A / Unit B" list.

## The two security holes
1. **A Company Admin or HR can make a "back-door Super Admin".**
   - Each user has a hidden "permission role" next to their real role. The server saves whatever the form sends there.
   - The server also reads the value `super_admin` there as "Super Admin", whatever the real role is.
   - **Proved on made-up companies:** company X's Company Admin made a "Production Head" with that value. That account then read company Y's department. Editing an existing user the same way also worked.
   - On dev, only the real Super Admin has that value.
2. **The "can access all units" tick crosses companies.**
   - The old task API (`/api/hrms/tasks` and its reports) shows every company's tasks to anyone with that tick.
   - The Company Admin's **Give All Permissions** button turns the tick on.
   - On dev, 3 ordinary users have it (an HR-Admin, a Company Admin and an R&D employee).

## Decisions (24 Nov, as recommended)
1. **Only the real role makes someone a Super Admin.** The server stops reading the hidden permission role for that, in all five places.
2. **The hidden permission role always equals the real role.**
   - Creating or editing a user saves the real role there, whatever the form sends.
   - A one-time fix at server start makes it equal for everyone already saved. This also tidies the 30 mangled ones.
3. **"Can access all units" stays inside the user's own company.** Only a Super Admin sees every company's tasks.
4. **One form for both.** The Company Admin's **Create New User** opens HR's Add User form, so future fixes reach both. For the Company Admin:
   - **"Gets a login" is always Yes.** People without a login (Manpower) stay HR's, and so does **Bulk Import**.
   - **The role list:** HR Admin, Company Admin, Manager, MIS Admin and the Department Heads. No employee roles, which are HR's to add.
   - **The company is their own.**
   - **The rest is HR's form as it is, with the same checks:**
     - name, gender, date of birth, joining date, mobile (10 digits) and email (format)
     - password, department, designation and unit
     - device code, address, employee type, profile picture
   - **Reporting manager:** required for the Heads and MIS Admin, as in HR's form. Optional for HR Admin, Company Admin and Manager, who often report to no one in the system.
   - **Permissions:**
     - **Heads, Manager and MIS Admin:** the same grid and defaults as HR's form.
     - **HR Admin:** the grid, with HR's pages ticked.
     - **Company Admin:** no grid. *"A Company Admin's pages come with the role."* The server gives the 9 pages (feature 27).
   - **After saving:** back to Roles & Permissions.
5. **The old Create New User dialog goes.** The button now opens the form above.
6. **The Roles & Permissions edit dialog stays** for role, permissions, active and password. Other details are edited in Employee Management, as today.
   - Superadmin leaves its role list (the server already refuses it).
   - **Give All Permissions** no longer turns on "can access all units".
7. **A department or designation from another company can't be given to a user,** on create or edit, from either form. The server refuses it. The no-login (Manpower) path already did this.
8. **HR's Add User doesn't change** for HR.

## Not changed
- HR's Add User page, its route and its checks.
- Employee Management, Give Login, Bulk Import.
- Who may give which role (feature 27): a Company Admin may make an HR Admin or another Company Admin of their own company; HR may not.
