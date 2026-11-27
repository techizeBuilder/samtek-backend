# Feature 32: HR's bulk import of people (browser test)

*On test-1, as HR (`testhr`). What changed: [32-employee-bulk-import-changes.md](32-employee-bulk-import-changes.md). The suite `peopleimport` (20) checks the rules; this is about the screens.*

**Files:** `C:\Users\rahul\Downloads\bulk-import-test\`
- `10 People - 5 people.xlsx`: 3 with a login (Sales Employee, Store Employee, QC Head) and 2 without
- `11 People - mistakes (check only).xlsx`

Both were checked against test-1 before the test.

## 1. The window
1. **Add User → Bulk Import:**
   - the window "Bulk import: People" with its steps
   - Download template, and the **Starting password for the logins** field
2. **Download the template:** the People, How to fill and Lists sheets. Lists shows test-1's departments, designations (with department), the two Managers and the login roles.
3. **As the Company Admin:** Create New User has no Bulk Import button.

## 2. The mistakes file (check only)
1. **Choose file 11** and Check, leaving the password empty: **17 problems**, the file's 16 plus *"type a starting password"*, by row and column, for example:
   - "Maybe": write Yes or No
   - "Designation" belongs to test department, not Production
   - "Company Admin" isn't a role HR gives
   - Required for a Sales Employee (IVR)
   - "31-02-1990" isn't a date
   - Device code 0001 is already given to someone
   - "Leave blank…" for a no-login row with a role
   - Is Trainee: "Only for someone with a login"
2. **There's no Import button.**

## 3. The clean file
1. **Choose file 10** and Check without a password: one problem, *"type a starting password"*.
2. **Type `Start@123`** and Check again:
   - *"Ready: 5 people (3 with a login, 2 without; 1 Head will wait for the Company Admin)"*
   - a preview of 5 rows (Zz Import Sales One marked "trainee")
   - "waits for approval" on the QC Head
3. **Import 5 people:**
   - *"Imported 5 people (3 with a login, 2 without). 1 Department Head waits for the Company Admin's approval."*
   - **Aadhaar still to upload (2):** Zz Import Worker One / Two, with their employee IDs
4. **Employee Management:**
   - the five "Zz Import …" people, with department, designation and manager
   - the two workers show No login
   - the QC Head shows "Waiting for the Company Admin"
5. **Optional:** sign in as `zz-import-sales1@test.invalid` / `Start@123`.
6. **As the Company Admin:** Roles & Permissions shows the QC Head in **Waiting for your approval**. Reject it with a reason (it's test data).

## 4. Clean-up
1. **Delete the other four "Zz Import …" people** (Employee Management → Delete User).
2. **Device codes 9101 / 9102** go with them.

## Result (25 Nov 2026)
**PASSED** in the browser.
- **Added during the test:** the **Is Trainee** column. You noticed the template didn't have the form's tick. Suite 21 of 21.
- **The files were rebuilt from the real template** (all three sheets).
- **Results:** 17 problems on file 11 (with the password empty); 5 imported from file 10 (Sales One a trainee with the Trainee dashboard; the QC Head waited and was rejected, so removed).
- **Clean-up:** the imported people were deleted, with a backup in `D:\cs\db-backups\f31-browser-test-2026-11-25\`.
