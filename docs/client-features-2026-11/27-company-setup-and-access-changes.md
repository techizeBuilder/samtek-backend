# Feature 27: Company setup, the Company Admin's access, and company boundaries (what changed)

*Built 24 November 2026. Logic and your decisions: [27-company-setup-and-access-logic.md](27-company-setup-and-access-logic.md). Browser test: [27-company-setup-and-access-test-roadmap.md](27-company-setup-and-access-test-roadmap.md).*

## In one line
- **A new Company Admin now sees all their admin pages** from the first login, and can't be locked out of them.
- **The Super Admin no longer has Roles & Permissions.** Companies takes the logo and stamp together.
- **People can only reach their own company's users and company.** Anyone could edit anyone, even set their password, before.

## Super Admin → Companies
- **Creating a company** no longer asks for the stamp. A short note says the Company Admin sets the logo and stamp on **My Company**.
- **The table's last image column** is **Logo / Stamp**, showing whether each is set.
- **The company menu:** "Upload Stamp" is now **Logo & stamp**.
  - **What it shows:** both images side by side.
  - **Changing one:** replace either; each saves on its own.
  - **Allowed files:** JPG, PNG or WEBP, up to 5 MB.
- **The Company Admin's four login fields** stay (name, login email, phone, password). Everything else about them, they keep up to date themselves.

## My Profile (everyone)
**A Phone field next to name and email,** saved with them. Digits, +, - and spaces; letters are refused.

## The Company Admin's admin pages
- **The 9 pages work by role, with every action**, on the screens and the server, whatever their saved permissions say:
  - Dashboard, Employee Management, My Company, Pricing Value, Operating Units
  - Departments, Designations, Roles & Permissions, Task Management
- **A company created by the Super Admin** saves its Company Admin with the 9 pages. Before, an **empty** list meant every page was hidden.
- **A one-time fix at server start** added the missing pages to existing Company Admins.
  - **On dev:** SAMTEK BIOSCIENCES' Company Admin had only Pricing Value and now has all 9.
- **Roles & Permissions is gone from the Super Admin menu,** and its old address. Each company's Company Admin sets their people's permissions on their own Roles & Permissions page.

## Company boundaries (security)
**A Super Admin may do anything. Everyone else stays inside their own company.**

- **Users:**
  - **Another company's user** can't be read, edited, deleted or have their password reset or set: it reads as "not found".
  - **Editing a user, who may change whom:**
    - **yourself:** name, email, phone, photo, personal details, password; never your own role, permissions, company or active switch
    - **an HR-Admin or Company Admin:** anyone in their company, but never move them to another company
    - **a manager:** the people who report to them, personal and job details only. Not their email, login, password, active switch, company, role or permissions: *"A manager can change personal and job details only."*
    - **anyone else:** *"You can only edit your own profile."*
  - **Logs:** a password is no longer written to the server log when a user is updated.
- **Who may give which role** (creating a user, editing a user):
  - **Super Admin:** only a Super Admin can give it.
  - **Company Admin:** a Super Admin, or **that company's** Company Admin. An HR-Admin can't: *"Only a Super Admin or this company's Company Admin can give the Company Admin role."*
  - **Give Login** never offered either role, and still doesn't.
  - **A company's last Company Admin** can't be given another role, deactivated, moved or deleted: *"This is the company's only Company Admin: make someone else Company Admin first."*
- **Companies:**
  - editing a company's details: **their own company only**
  - the **stamp** upload now has the same check as the logo: that company's Company Admin, or a Super Admin. Before, anyone logged in could replace any company's stamp.
  - **deleting a company: Super Admin only**

## Files
- **Server, new:** `services/access/companyAccess.js`: the rules (the Company Admin's 9 pages, same company, who gives which role, the last Company Admin).
- **Server, changed:**
  - `middleware/permissions.js`: the Company Admin's pages by role
  - `controllers/userController.js`: read / edit / delete / reset / set password / create / give login
  - `controllers/companyController.js`: by role, seeded pages, own-company edit, Super-Admin-only delete
  - `routes/companyRoutes.js`: the stamp owner check
  - `controllers/profileController.js`: the phone
  - `services/hrPermissionBackfill.js` + `index.js`: the one-time fix
- **Screens:**
  - `pages/super-admin/SuperAdminCompanies.jsx`: no stamp on create; Logo & stamp
  - `services/api.js`: the logo upload
  - `pages/Profile.jsx`: Phone
  - `hooks/usePermissions.jsx`: the 9 pages by role
  - `config/moduleRoutes.js` and `App.jsx`: Roles & Permissions removed from the Super Admin

## Tested
- **The new suite `companyaccess`: 42 of 42,** through the real server on made-up companies X and Y:
  - **users across companies:** a Sales Employee's attack on Y refused, the password unchanged; HR can't read / edit / delete / reset / set passwords in Y
  - **the manager rules;** the role rules; the last Company Admin
  - **companies:** the edit, the stamp (and no file left behind), delete
  - **the Company Admin's pages** with an empty permission list
  - **the one-time fix;** a company created by the Super Admin
  - **the phone**
- **Yesterday's attack probe, run again:** every step is refused now; the victim's name and password are unchanged and company Y is untouched.
- **Regression** (users, permissions, HR / Company Admin pages): `hrperms` 33, `people` 123, `superadmin` 31, `scorecard` 113, `purchsep` 76, `inccap` 42, all passing.
- **The screens bundle.**
