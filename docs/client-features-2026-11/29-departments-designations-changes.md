# Feature 29: Departments with the Company Admin, Designations with HR (what changed)

*Built 24 November 2026. Logic and decisions: [29-departments-designations-logic.md](29-departments-designations-logic.md). Browser test: [29-departments-designations-test-roadmap.md](29-departments-designations-test-roadmap.md).*

## In one line
**The Company Admin creates, edits and deletes departments; HR does designations.** Both keep both pages to see the lists. Each page shows its add / edit / delete buttons and form only to the owner.

## Departments page
- **The Company Admin** (and a Super Admin): **+ Add Department**, **Add from Roles**, edit and delete, as before.
- **HR and everyone else:** the list only, with *"Departments are set by your Company Admin. You can see the list here."*

## Designations page
- **HR** (and a Super Admin): **+ Add Designation**, edit and delete.
- **The Company Admin:** the list only, with *"Designations are set by HR. You can see the list here."*
- **A company with no active HR-Admin yet:** its Company Admin may set designations, with an amber note: *"Your company has no HR-Admin yet, so you can set designations until one is added."* Once an HR-Admin is added, it's HR's alone.

## On the server
- **The owner is checked by role** on every create / edit / delete (and "add from roles"), whatever permission is saved.
  - Before, both roles could do both, because only the saved permission was checked.
  - A refusal now says why: *"Departments are set by the Company Admin."* / *"Designations are set by HR."*
- **New `GET /api/designations/manage-rights`:** tells the page whether to show the buttons (and the note).
- **The Company Admin's role-based pages (feature 27):** Designations is now view only; Departments stays full.
- **HR keeps its saved Designations checkbox** (HR's permission screen still matters for HR).
- **Company boundaries:**
  - reading, editing or deleting a department or designation from another company now reads as **"not found"**
  - an edit can't move one to another company
  - before, both were possible by id
- **A one-time fix at server start:** every HR-Admin can see Departments and fully manage Designations.
  - **On dev:** SAMTEK BIOSCIENCES' HR had neither, and now has both.

## Unchanged
- **Both lists stay readable** wherever they're used: Add User and the Company Admin's user form, Employee Management, KRA, departments from roles.
- **The menus:** the Company Admin keeps Designations, and HR keeps System Configuration → Departments.

## Files
- **Server:**
  - `services/access/companyAccess.js`: Designations view-only for the Company Admin; `canManageDepartments`, `canManageDesignations`
  - `middleware/permissions.js`
  - `routes/department.routes.js`, `routes/designation.routes.js` (owner checks; `manage-rights`)
  - `controllers/departmentController.js`, `controllers/designationController.js` (own company by id; the company never changes in an edit)
  - `services/hrPermissionBackfill.js` + `index.js` (the one-time fix)
- **Screens:**
  - `hooks/usePermissions.jsx`
  - `pages/hrms/SystemConfigration/Departments.tsx`: buttons for the Company Admin only; the note
  - `pages/hrms/SystemConfigration/Desigantion.tsx`: buttons from `manage-rights`; the notes

## Tested
- **The new suite `orgsplit`: 30 of 30,** through the real server on made-up companies:
  - **Departments:** the Company Admin creates, edits and deletes; HR is refused on all, including "add from roles", even with an old saved full permission; HR still lists them
  - **Designations:** HR creates and edits; the Company Admin is refused but lists them; `manage-rights` for each
  - **The no-HR-Admin fallback:** the Company Admin can, until an HR-Admin is added
  - **Another company's department / designation:** read / edit / delete → 404; nothing changed; no moving companies; the Super Admin can
  - **The one-time fix,** once only
- **Found and fixed while testing:** my first change put the "company never changes" line into *create* instead of *edit*. Caught by the suite and corrected.
- **Regression:** `companyaccess` 42 (a timing race in its stamp check fixed on the server: a refused upload is now deleted before the reply goes out; 5 clean runs), `hrperms` 33, `people` 123, `kra` 33, all passing.
- **The two pages bundle.**
