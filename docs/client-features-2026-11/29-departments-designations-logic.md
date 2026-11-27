# Feature 29: Departments with the Company Admin, Designations with HR (logic and decisions)

*24 November 2026. When the screens were shown to the client, it was said that only the Company Admin creates departments and designations. The client then decided: **the Company Admin creates departments, HR creates designations**. In fact both could do both.*

## What it is today
- **Who has the pages:** both pages exist for both roles.
  - **The Company Admin:** Departments and Designations, by role (feature 27's 9 pages).
  - **HR:** System Configuration → Departments / Designations, by saved permission. On dev every HR-Admin has both, except SAMTEK BIOSCIENCES' HR (neither).
- **The server** gates create / edit / delete only by saved permission, so either role can do either.
- **Also found:**
  - **reading, editing and deleting a department or designation by its id doesn't check the company,** so an admin of one company could change or delete another company's
  - a designation's company could also be changed in an edit

## Decisions (24 Nov, as recommended, with your point)
1. **Departments: the Company Admin creates, edits and deletes** (and the "add from roles" shortcut). HR keeps the page **to see the list**, without the add / edit / delete buttons or form.
2. **Designations: HR creates, edits and deletes.** The Company Admin keeps the page **to see the list**, without the buttons or form.
3. **The fallback:** while a company has **no active HR-Admin**, its Company Admin may manage designations, so a new company can set up job titles for its first users. Once an HR-Admin exists, it's HR's alone, and the Company Admin's page says so.
4. **The Super Admin** may do either, as today.
5. **The server enforces it by role,** not only by saved permission. An old saved permission can't get around it, and neither can the API.
6. **The lists stay readable by both,** so every dropdown keeps working:
   - Add User, the Company Admin's user form, Employee Management
   - the KRA pages and departments from roles
7. **Every HR-Admin can see Departments and fully manage Designations:** a one-time fix adds them where missing (SAMTEK BIOSCIENCES' HR).
8. **Company boundaries:** a department or designation from another company reads as "not found" for reading, editing and deleting, and its company can't be changed.
