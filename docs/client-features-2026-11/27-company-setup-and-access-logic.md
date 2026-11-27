# Feature 27: Company setup, the Company Admin's access, and company boundaries (logic and decisions)

*24 November 2026. Started from Super Admin → Companies; the security part came from checking it.*

## What was found
1. **Logo / stamp:** creating a company asks only for the stamp, and the row menu has only "Upload stamp". The Company Admin's **My Company** page already sets both the **logo and the stamp** (and the company's details).
2. **Company Admin details:** the form asks for name, login email, phone and password. Afterwards **My Profile** (`/profile`) lets them change their name, email and password, but **not their phone**.
3. **Bug: a new Company Admin gets no pages.**
   - Creating a company saves the Company Admin's permissions as the HRMS module with an **empty feature list**, so Dashboard, Employee Management, My Company, Roles & Permissions and the rest are hidden.
   - Only the Super Admin's Roles & Permissions page could fix that, and the client wants that page removed from the Super Admin.
   - On dev, SAMTEK BIOSCIENCES' Company Admin still has only "Pricing Value".
4. **Security (proved on made-up companies, 24 Nov):**
   - **Anyone logged in could edit any user** (`PUT /users/:id`, and `PATCH /users/:id/profile-picture` with no other check): name, email, mobile, **password**, active, even their company. A Sales Employee set a new password for a user in another company. Only role and permissions were protected.
   - **HR-Admins and Company Admins could read, delete or reset the password of users in any company** (the reset compared the unit *name*, not the company).
   - **Editing a company had no "own company" check:** a Company Admin changed another company's details. Deleting was open to HR-Admins / Unit Heads.
   - **The company stamp upload had no owner check at all.** The logo and cash password do.
   - **Roles:** HR-Admins and Company Admins could give any role, including **Company Admin and Super Admin**.

## Decisions (24 Nov, as recommended; the wider security sweep is done separately by you)
1. **Logo & stamp:**
   - the create form no longer asks for the stamp
   - the row menu's "Upload stamp" becomes **"Logo & stamp"**: both images, viewed and replaced in one dialog
   - the Company Admin keeps setting both on My Company
2. **Company Admin details:** the four login fields stay at creation; **My Profile gets a Phone field**.
3. **The Company Admin's own admin pages work by role.**
   - **The 9 pages:** Dashboard, Employee Management, My Company, Pricing Value, Operating Units, Departments, Designations, Roles & Permissions, Task Management.
   - **Every action:** view, add, edit, delete, on the server and on the screens, whatever their saved permissions say.
   - **New Company Admins:** the 9 are also saved in their permissions.
   - **Existing Company Admins:** a one-time fix adds the missing ones, once each.
4. **Roles & Permissions is removed from the Super Admin menu,** and its old address. The Company Admin's own Roles & Permissions page stays: it's how a company sets its people's permissions.
5. **Company boundaries.** A Super Admin may do anything; everyone else stays inside their own company.
   - **Users (read / edit / delete / reset password / change password):** only users of the caller's own company. A user in another company reads as "not found".
   - **Editing a user (who may change whom):**
     - **yourself:** your profile (name, email, mobile, photo, personal details, password); never your own role, permissions, company or active switch
     - **HR-Admin / Company Admin:** anyone in their company, all fields; never moving someone to another company
     - **a Manager:** the people who report to them (their reporting manager is that Manager), personal and job details only; not email, login, password, active, company, role or permissions
     - **anyone else:** refused, *"You can only edit your own profile."*
   - **Companies:**
     - edit, logo, stamp and cash password: their own company only, by its Company Admin (HR-Admin with My Company → edit may also edit the details, as today)
     - deleting a company: Super Admin only
6. **Who may give which role** (creating or editing a user):

   | Role being given | Who may give it |
   |---|---|
   | Super Admin / Superadmin | only a Super Admin |
   | Company Admin | a Super Admin, or that company's Company Admin |
   | every other role | as today |

   **The last Company Admin:** a company's last active Company Admin can't be made another role, deactivated or deleted, so a company always has one.

## Not in this change
**The rest of the system's routes are not audited here:** you're running a separate daily security test for that. This change covers users, companies, roles and the Company Admin's access.
