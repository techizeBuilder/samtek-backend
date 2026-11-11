# Feature 2, stage 1: People with no login (what changed)

*Built 6 November 2026. Logic and your decisions: [02a-people-no-login-logic.md](02a-people-no-login-logic.md). Browser test: [02a-people-no-login-test-roadmap.md](02a-people-no-login-test-roadmap.md).*

## In short
- HR can now add labour and staff with **no login**.
- HR can upload anyone's documents.
- Department Heads have the self-service menu.
- Aadhaar and PAN files are no longer public.
- The login no longer prints passwords to the log.

## 1. Passwords in the login log
The login route (`auth-routes.js`) printed three things on every login. All are gone:

| It printed | Now |
|---|---|
| **The typed password, in plain text** | Removed |
| The start of the stored password hash | Removed |
| **Every user's email and role** (it also fetched all users on each login) | Removed |

**A correction:** I first told you this was done after deleting two lines from `controllers/authController.js`. That file isn't used, so the real logging carried on until this change.

**Worth doing on live:** if the live server keeps its logs, they hold real passwords from past logins. Clear those logs, and consider asking users to change passwords.

## 2. Adding someone with no login
Add Employee now starts with **Gets a login: Yes / No.** Nothing is picked at first, and it can't be saved until HR chooses, so nobody gets a login by accident. Yes works as before.

**With No:**
- **Not asked:** password, role, module permissions, IVR extension and Is Trainee.
- **Role:** always **Manpower**.
- **Email:** optional.
- **Device Code:** required, because attendance is why they're added.
- **Documents:** a section lists every document type. **Aadhaar is required** and the rest are optional (PDF, JPG or PNG, up to 10 MB each). All are saved as Verified by the HR who added them.
- **Everything else:** still required, including mobile and date of birth.
- **Username:** set to their Employee ID.

**How you tell people apart:** Department. A welder is Manpower + Production, and a store helper is Manpower + Store. Designation says what they do.

**All or nothing:** if anything is refused or fails, no person, document or file is left behind.

### Device Code
Required for someone with no login, and optional for someone with a login: old users have none, and field staff may never reach the device. It's on Add Employee, and on the profile for HR.
- **Kept as text,** so `0005` stays `0005`.
- **One code, one person, per company.** A duplicate is refused and says so. Two companies can both have `0005`.
- **Only an admin can set it,** because it decides whose attendance a punch becomes.

Nothing reads it yet. Stage 2, the device sync, will.

### Signing in
- Someone with no login gets "Invalid credentials", whatever they type, including their Employee ID.
- Reset Password and Update Password refuse them.

### Where they appear
| Screen | Person with no login |
|---|---|
| Employee Management | Shown, with a **No login** badge and a Login filter |
| Attendance Record, Salary Structure, Payroll Run, Payslips | Shown |
| Roles & Permissions | Hidden |
| QC, technician and sales pick lists | Hidden, because those lists look for other roles |

### Giving them a login later
On their profile, HR sees **Give Login** in place of Change Password. It asks for email, password and role.
- **It's the same record,** so department, documents, attendance and history stay with them.
- **Permissions** start from that role's defaults, and can be adjusted on Roles & Permissions.
- **Company Admin and Super Admin roles can't be given this way.**
- **It only goes one way.** To remove someone's access, deactivate them.

### Email
A leave decision skips the email when the person has no address, and the decision still saves. Payslips already did this.

## 3. HR uploads documents
On Document Verification → View Documents, each document type now has **Upload** or **Replace**. This works for anyone, and it's optional.

| Who uploads | Result |
|---|---|
| **HR, for someone else** | Verified at once. HR can also replace a Verified document |
| **The person, themselves** | Uploaded, then HR verifies, as before. Locked once Verified |
| **HR, for themselves** | Uploaded, like anyone else: HR doesn't verify their own |

## 4. Heads get self-service
All 10 department Heads now have the same block as their department's Employees: My Profile, Attendance, Leave, Holidays, Payroll and Requests.

- **Their department menu keeps its own permission checks.** Only the self-service part skips them.
- **MIS Admin, HR-Admin and Company Admin don't have it.** Tell me if they should.

## 5. Private documents
| Before | Now |
|---|---|
| Any logged-in user could view, upload or replace anyone's documents | Only the rules below |
| Anyone with the link could open the file, with no login | The link is refused. Files open only from inside the app |

| Action | Allowed |
|---|---|
| **View** | The person; a platform admin; HR (Employee Management view) in the same company; the person's Manager |
| **Upload or replace** | The person; a platform admin; HR (Employee Management edit) in the same company |

- A refused upload leaves no file on disk.
- All 4 screens that open documents now use the login, in a new tab.
- Old documents keep working, and files stay where they are.
- Other uploads, such as logos, photos and vendor files, are unchanged and still public.

## Worth knowing
- **Index swap:** email's "must be unique" rule treated a blank as a value, so a second person with no email would have been refused. It's now "unique only when filled in". The swap runs by itself at server start, so there's no script on live. It's already done on dev.
- **Aadhaar document type:** Manpower's Aadhaar is saved under the key `AADHAAR`. If someone deletes that type in Admin Settings, it won't show on Document Verification, though the file is still kept.
- **Leave for no-login people:** they can't apply themselves, so HR would have to apply for them. To settle at stage 3.
- **Payroll Run:** a no-login person shows loss of pay until the device sync brings attendance. Don't run payroll for them before stage 2.

## Tests
Results are in the [test roadmap](02a-people-no-login-test-roadmap.md).

## Files
**Backend:**
- **New:** `services/peopleService.js`, `services/documentAccessService.js`
- **Changed:** `auth-routes.js`, `models/User.js`, `shared/schema.js`, `middleware/upload.js`, `middleware/permissions.js`, `controllers/userController.js`, `controllers/documentController.js`, `controllers/leaveController.js`, `routes/document.routes.js`, `index.js`

**Frontend:**
- **New:** `pages/hrms/loginRoles.ts`, `pages/hrms/GiveLoginModal.tsx`, `pages/hrms/openUserDocument.ts`
- **Changed:** `pages/hrms/AddUser.tsx`, `pages/hrms/Employee.tsx`, `pages/hrms/Profile.tsx`, `pages/hrms/DocumentVerification.tsx`, `pages/hrms/Employee/Profile/DocumentUpload.tsx`, `pages/hrms/Employee/Profile/PersonalInformation.tsx`, `pages/RolePermissionManagement.jsx`, `components/modals/UserModal.jsx`, `config/moduleRoutes.js`, `components/layout/RoleBasedLayout.jsx`, `components/layout/Sidebar.jsx`
