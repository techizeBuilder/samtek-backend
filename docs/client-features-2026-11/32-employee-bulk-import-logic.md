# Feature 32: HR's bulk import of people (logic and decisions)

*25 November 2026. HR's **Bulk Import** on Add User never worked: it calls `/api/bulk-upload/employees/parse` and `/save`, which don't exist on the server. Its template is from an older version: "superadmin" as a role, Company / Unit / Cost Center columns, no password, no login choice, no device code.*

## Decisions (25 Nov, as recommended)
1. **HR only.**
   - The button is already hidden on the Company Admin's form (feature 30).
   - The server accepts it only from an HR-Admin with Employee Management "add" (or a Super Admin).
2. **Built like R&D's bulk imports (features 20–22):**
   - download the template, fill it, upload
   - every row is checked first; one problem and nothing is imported, with every problem listed by row and column
   - then import, all or nothing
   - an .xlsx up to 5 MB and 1000 rows
3. **The template is made for HR's company.** It has:
   - a **People** sheet
   - a **How to fill** sheet (one line per column)
   - a **Lists** sheet: login roles, departments, designations (each with its department), managers (email · employee ID · name), genders, employment types
4. **One row per person, with "Gets a login" (Yes / No):**

   | Column | Who | Rule |
   |---|---|---|
   | Gets a login * | all | Yes or No |
   | Full Name * | all | |
   | Mobile * | all | exactly 10 digits |
   | Gender * | all | Male or Female |
   | Date of Birth * | all | a date |
   | Joining Date * | all | a date |
   | Department * | all | from the list |
   | Designation * | all | from the list; must belong to the row's department when the designation has one |
   | Reporting Manager | all | a Manager's email or employee ID from the list. Required except for the Manager role |
   | Employment Type | all | Full-Time, Part-Time, Intern or Contract (optional) |
   | Address | all | optional |
   | Email | login: required; no login: optional | a valid address, unused, not repeated in the file |
   | Role | login: required | HR's roles: the employee roles, the Department Heads and the company's custom roles. Blank for no login (Manpower) |
   | IVR Extension | login | digits; required for Sales Employee |
   | Is Trainee | login | Yes or No (blank = No); a trainee also gets the Trainee dashboard (LMS), as on the form. Added 25 Nov after the browser test |
   | Device Code | no login: required; login: optional | not given to anyone in the company, not repeated in the file |

5. **Not in the file:**
   - **The company and unit:** HR's own.
   - **The employee ID:** made automatically, as on the form (EMP-ABC-0042, numbered on from the highest).
   - **Passwords:** HR types **one starting password** (at least 6 characters) in the import window, and every login row gets it. The check asks for it when the file has login rows. People aren't made to change it at first sign-in; that doesn't exist today.
   - **Permissions:** each login row gets its role's default ticks, the same as the form picks. The screen sends the defaults with the file. They can be adjusted per person afterwards.
6. **Aadhaar:**
   - No-login people are imported without it, since a spreadsheet can't carry files.
   - The result lists them as *"Aadhaar still to upload"*, to do on Document Verification.
   - The single form still requires it.
7. **Department Heads in the file wait for the Company Admin** (feature 31):
   - imported inactive, in the Company Admin's approval box, one bell per person
   - the check and the result count them as *"waiting for the Company Admin's approval"*
8. **The check shows a preview:** row, name, login or not, role, department, designation, manager and device code (the first 50).
9. **The import checks everything again,** then saves everyone together.
   - If anything fails while saving (someone took an email meanwhile), the people already saved by this import are removed again and nothing is imported.
   - Device codes are then matched to earlier attendance-device days, as the form does.

## Not changed
- The single Add User form, Give Login, the Company Admin's form.
- R&D's imports.
