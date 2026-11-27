# Feature 29: Departments with the Company Admin, Designations with HR (browser test)

**PASSED 25 Nov 2026,** during feature 27's test on Zz F27 Company (confirmed from its backup on 26 Nov).
- **Seen on screen:**
  - the Company Admin added the department "Zz Office" (11:30 UTC), part 1
  - the Company Admin added the designation "Zz Officer" (11:33) while the company had no HR-Admin yet (HR added at 11:37), part 4
- **Covered by the suite `orgsplit` only:** the view-only halves (parts 1.2, 2.2), HR adding a designation (2.1), and the forms' lists (3).

*On test-1. What changed: [29-departments-designations-changes.md](29-departments-designations-changes.md). The suite `orgsplit` (30) checks the server rules; this is about the screens.*

**Logins:** test-1's Company Admin; test-1's HR-Admin (`testhr`).

## 1. The Company Admin
1. **Departments:** **+ Add Department** and the row menus are there. Add "Zz Test Dept", rename it, delete it.
2. **Designations:** the list, without **+ Add Designation** or row menus, and the note *"Designations are set by HR. You can see the list here."*

## 2. HR
1. **System Configuration → Designations:** **+ Add Designation**. Add "Zz Test Title", rename it, delete it.
2. **System Configuration → Departments:** the list, without buttons, and the note *"Departments are set by your Company Admin…"*

## 3. The lists still feed the forms
1. **HR → Add User:** the Department and Designation dropdowns are filled.
2. **The Company Admin's user form:** the same.

## 4. A company with no HR-Admin (optional, on a test company)
**That company's Company Admin → Designations:**
- the amber note *"Your company has no HR-Admin yet…"* and the add button
- once an HR-Admin is added there, a refresh shows the list only
