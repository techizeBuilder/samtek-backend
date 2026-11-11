# Feature 2, stage 1: People with no login (logic)

*Written 6 November 2026. **Built the same day:** see [02a-people-no-login-changes.md](02a-people-no-login-changes.md), which is the current state where this doc differs. HR uploading documents, Heads' self-service and private documents were added during planning.*

**Your decisions (6 Nov):**
1. **Role:** one fixed role, Manpower. **Department says who's who:** a welder is Manpower + Production, a store helper is Manpower + Store, and Designation says what they do. Production's team picker lists the Production department.
2. **Later change:** no login → login is allowed, such as a supervisor promoted to staff. It keeps the same record, so attendance, team and history stay with them.
3. **Details:** all stay required for labour, including mobile and date of birth. Only password isn't asked, and email is optional, because they don't log in.
4. **Device code (browser test, 6 Nov):** required for someone with no login, because attendance is why they're added. Optional for someone with a login for now, because old users have none and field staff may never reach the device.
5. **Documents (browser test, 6 Nov):** the form shows every document type for someone with no login. Aadhaar is required and the rest are optional.

## 1. What you decided
HR adds a person with **all the same details, just no login,** and email becomes optional for them. Attendance, salary and payslips then work for them through the same user record.

**People with a login don't change at all:** email and password stay required.

## 2. How it would work

### The form: HR → Add Employee
A new choice at the top: **Gets a login: Yes / No.** Nothing is picked at first (your call, 6 Nov: HR might miss a default and create a login by accident). Yes works as today.

| Field | Login: Yes (today) | Login: No |
|---|---|---|
| Name, gender, mobile, date of birth, joining date | Required | **Required** |
| Company, unit, department, designation, reporting manager | Required | **Required** |
| Address, employment type | As today | As today |
| Email | Required | **Optional** |
| **Device code** (new) | Optional | **Required** |
| Password | Required | **Not shown** |
| Role | Required | **Not shown: set to Manpower** (decision 1) |
| Module permissions | Shown by role | **Not shown: none** |

### Signing in
- **Login refused:** with no login, the person can't sign in, whatever is typed.
- **No password can be set:** any screen that sets a password refuses them.

### Device code
- **What it is:** the code from section 4 of the [discussion doc](02-manpower-attendance-discussion.md), such as `0005`. It's how a punch finds the person.
- **Who has it:** anyone can, Heads and office staff too, because everyone punches on the device.
- **Rules:** kept as text, so `0005` stays `0005`. One code, one person, per company. Two companies can both have `0005`.
- **If it's blank:** not allowed for someone with no login. Someone with a login can be saved without one, but gets no attendance from the device until it's filled in.

### Where they appear
| Screen | Person with no login |
|---|---|
| Employee Management | **Shown,** with a "No login" badge and a filter |
| Attendance Record, Salary Structure, Payroll Run, Payslips, leave override | **Shown:** this is the reason for adding them |
| HRMS and MIS headcounts | **Counted.** MIS shows Manpower as its own role |
| Roles & Permissions | **Hidden:** they have nothing to set |
| Technician, QC, sales and salesperson pick lists | **Hidden** (decision 1) |
| Production → Manpower team picker | **Shown,** in stage 4 |

### Emails
Payslip and leave emails go to the employee's address. With no email, we **skip the email** and the action still succeeds.

## 3. Decisions for you

### Decision 1: what role do they have?
Almost every pick list in the app finds people by role: technicians, QC inspectors, salespeople. So the role decides where someone shows up.

| Option | Good | Not so good |
|---|---|---|
| **A. One fixed role, "Manpower"** (recommended) | Those lists skip them with no change, because nothing looks for that role. Department and Designation still say what they do, such as Production, Welder | Their role doesn't describe the work; those two fields do |
| B. Pick a normal role, such as Production Employee | Same role choice as everyone else | Each role-based list needs a "has login" check, or a welder could appear as a QC inspector or technician. About 60 places list users, and missing one is a real risk |

### Decision 2: can it change later?
| Change | My recommendation |
|---|---|
| **No login → login,** such as a worker promoted to staff | **Allow it** on Edit: HR enters email, password and role |
| **Login → no login** | **Not now.** Deactivating already removes someone's access. This can be added if it's needed |

### Decision 3: are all these details really required for labour?
You said all the same details, so that's what's written above. HR would need a **mobile number and date of birth** for every worker, plus a **Designation** and a **Reporting Manager**. If a worker has no phone, HR couldn't save them. Keep them all required, or make mobile and date of birth optional for no-login people?

## 4. What changes underneath
- **Email's "must be unique" rule:** it treats a blank as a value, so the second person with no email would be refused. It changes to "unique only when filled in". This runs by itself at server start, with no script on live.
- **Username:** also has to be unique, so a no-login person's username is set to their Employee ID.
- **New fields on the user:** `canLogin` (everyone existing counts as yes) and `deviceCode`.
- **Password:** required only when the person can log in.

## 5. Not in this stage
- **Downloading punches:** stage 2, including the list of codes that match nobody.
- **Half days and weekly offs in payroll:** stage 3. A no-login person shows loss of pay in Payroll Run until attendance arrives from the device, so wait for stage 2 before running payroll for them.
- **Teams built from people:** stage 4.

## 6. How I'd test it
A new suite on a made-up company:
- **Saving:** several people with no email and no password all save; a duplicate email or device code is refused; a login person still needs email and password.
- **Signing in:** a no-login person can't sign in, and no password can be set on them.
- **Device code:** `0005` stays as text, and the same code works in two companies.
- **Lists:** they're in the employee, salary and attendance lists, and out of the technician, QC and sales lists.
- **Emails:** payslip and leave actions succeed with no email.
- **Later change:** no login → login works, and they can then sign in.

Regression: the suites that create users, found by searching them when I build.
