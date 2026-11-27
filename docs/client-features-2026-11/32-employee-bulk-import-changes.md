# Feature 32: HR's bulk import of people (what changed)

*Built 25 November 2026. Logic and decisions: [32-employee-bulk-import-logic.md](32-employee-bulk-import-logic.md). Browser test: [32-employee-bulk-import-test-roadmap.md](32-employee-bulk-import-test-roadmap.md).*

## In one line
**HR's Bulk Import on Add User works now.** People with a login and without go in one Excel file. Every row is checked first, then everyone is imported together, or nobody.

## Before
- The button opened a window that sent the file to server addresses that didn't exist, so every import failed.
- Its template was from an older version.

## The window
**HR → Add User → Bulk Import** opens the same window as R&D's imports, with:
- **Download template:** made for HR's company (see below).
- **Starting password for the logins:** one password, at least 6 characters, for every person with a login. *"Tell them to change it."*
- **Check file:**
  - every problem by row and column, and nothing is imported
  - or *"Ready: 5 people (3 with a login, 2 without; 1 Head will wait for the Company Admin)"*, with a preview
- **Import:**
  - the counts
  - how many Heads wait for approval
  - **"Aadhaar still to upload"**: the no-login people, by name and employee ID
- **Only HR sees the button.** The server also refuses anyone else, including the Company Admin.

## The template
- **People sheet, one row per person:**
  - Gets a login *, Full Name *, Mobile *, Gender *, Date of Birth *, Joining Date *, Department *, Designation *
  - Reporting Manager, Email, Role, IVR Extension, Is Trainee, Device Code, Employment Type, Address
- **How to fill:** what each column needs.
- **Lists:**
  - this company's login roles (employee roles, Department Heads, custom roles)
  - departments, and designations shown with their department
  - Managers (email · employee ID · name), genders, employment types

## The rules (the same as the single form)
- **With a login:**
  - email and role are required
  - IVR Extension is required for a Sales Employee
  - **Is Trainee** (added 25 Nov after you spotted it in the browser test): Yes gives the Trainee dashboard (LMS), as the form's tick does. Only for someone with a login.
  - the role's usual permissions are given; they can be changed per person afterwards
- **Without a login:**
  - the device code is required
  - the role is Manpower, the username is the employee ID, and email is optional
- **Everyone:**
  - mobile is 10 digits
  - dates are read as Excel dates, 2026-11-01, or 01-11-2026; impossible dates are refused
  - the designation must belong to the row's department
  - the reporting manager is a Manager of the company, by email or employee ID (optional only for the Manager role)
  - an email or device code can't already be in use or repeat in the file
- **Not in the file:**
  - the company and unit (HR's own)
  - the employee ID: numbered on from the highest in use
  - the password: the window's
- **Department Heads wait for the Company Admin** (feature 31): imported inactive, in the approval box, with a bell each.
- **All or nothing.** The import checks everything again. If saving fails partway (an email taken meanwhile), whatever it had saved is removed again.
- **Afterwards,** device codes are matched to earlier attendance-device days, as the form does.

## Files
- **Server:**
  - new `services/bulkImport/peopleImport.js`
  - `routes/bulkImport.routes.js` (`/api/bulk-import/people/template|check|import`, HR only; the password and role defaults passed through)
  - `controllers/adminSettingsController.js` (`companyCustomRoleNames`)
- **Screens:**
  - `components/inventory/BulkImportDialog.jsx` (the `people` kind: password field, preview, results)
  - `pages/hrms/AddUser.tsx` (the old broken window removed; the new one opened)

## Tested
- **The new suite `peopleimport`: 21 of 21** (20, plus Is Trainee after the browser test), through the real server on a made-up company:
  - the server's roles match the form's
  - dates
  - the template's sheets and lists
  - **refused:** the Company Admin, an employee, and HR without "add"
  - **a clean file of 5,** with every field checked:
    - permissions = the defaults
    - employee IDs in sequence
    - signs in with the starting password
    - the QC Head waits, with the bell
    - no-login people are Manpower; 2 listed for Aadhaar
  - **a file with 23 kinds of mistakes,** each reported by row and column; nothing saved
  - **the same file imported twice:** refused, nobody added twice
- **The first run caught a check of mine that was too strict.** The database adds its own fields to permissions, as it does for the single form. The test was corrected.
- **Regression:** `motorimport` 23, `bulkinv` 57 (the shared route file), `headapprove` 34, `people` 123, all passing.
- **The two screens bundle.**
- **Browser-test files** in `Downloads\bulk-import-test\`:
  - `10 People - 5 people.xlsx`: checked against test-1, 0 problems
  - `11 People - mistakes (check only).xlsx`: 16 problems
