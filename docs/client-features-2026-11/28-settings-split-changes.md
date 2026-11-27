# Feature 28: Super Admin Settings split (what changed)

*Built 24 November 2026. Logic and your decisions (with the full list of every place that reads these lists): [28-settings-split-logic.md](28-settings-split-logic.md). Browser test: [28-settings-split-test-roadmap.md](28-settings-split-test-roadmap.md).*

## In one line
- **Super Admin → Settings → "Company" is now "Platform Branding":** the Super Admin's own logo and name.
- **The packing checklist, the employee documents list and custom roles are now each company's own,** set by its Company Admin on a new **Company Settings** page.
- **SMTP, Database Backup and API stay with the Super Admin.**

## Super Admin → Settings
- **Platform Branding** (was "Company"): the **logo and platform name** on the Super Admin's own screens (the top bar).
  - The GST / email / phone / website / address boxes are gone: they belong to companies, on My Company. Their old saved values are kept.
  - Saving changes only the name.
- **General** keeps **SMTP** and **Other Settings (Database Backup)**. A note says the packing checklist, employee documents and custom roles are now set by each company's Company Admin.
- **API** is unchanged.

## Company Admin → Company Settings (new menu item)
**Three tabs:**
- **Packing checklist:** what the packing team ticks on Packaging Jobs before a job can be marked packed.
- **Employee documents:** what employees upload on their Documents tab, and HR verifies.
  - A document type's **key never changes** when it's renamed, because uploaded documents are saved by it.
- **Custom roles:** the company's own roles, added, renamed or removed. The system's **built-in roles** are listed underneath, locked.
  - A custom role can't take a built-in role's name.
  - The **HR-Admin** can manage custom roles too, as before, but only for their own company.

**Changes affect only that company.** Before, one list served every company, and one company's HR could rename or delete a custom role for everyone.

## Nothing that reads these lists changed its address or shape
| List | Read by | Now |
|---|---|---|
| Packing checklist | Packaging Jobs page; completing a job | the company's list; a job's ticks are checked against **its own company's** list |
| Employee documents | Add User, Document Upload, Document Verification | the company's list |
| Roles | Add User, Give Login | the built-in roles + the company's custom roles |

**The one-time copy at server start:**
- **What it does:** it gave every company a copy of the platform lists, **keeping every id and key**.
- **The 51 open packaging jobs on dev** were ticked against those ids, so they still complete.
- **Documents already uploaded** still match their type.
- **Old per-company lists** from before the platform lists (with different ids) were replaced by the copy.

**Also:**
- **A new company** starts from the platform lists.
- **Once a company has its own list,** emptying it is the Company Admin's choice: it is no longer refilled with defaults.

## Fixed after the browser test (26 Nov)
**Platform Branding hardly showed.** The user saved a new name and logo as the Super Admin:
- **the name didn't change,** because the top bar had "Samtek Machinery" written into the code, for everyone
- **the logo showed as a small picture beside the name,** while the sidebar's top-left logo stayed the fixed Samtek file

**Now (the user's choice): one logo, top left; the name alone in the top bar.**

| Who | Top-left logo (sidebar) | Top bar |
|---|---|---|
| Super Admin | Platform Branding's logo | Platform Branding's name |
| Everyone in a company | their company's logo from My Company (as before) | **their company's name** from My Company |

Without a logo, the Samtek file shows, as before. The Company Admin needs no new setting: their company's name and logo are on My Company.

**Restored on dev:** Platform Branding is back to "Samtek Machinery" with no logo. The test values and image are saved in `D:\cs\db-backups\f28-browser-test-2026-11-26\`.

**Not changed:** a few customer-facing texts still say "Samtek Machinery" (the feedback form's heading, the WhatsApp greetings on Leads and Deal Verifications).

**Files:** `components/layout/NavBar.jsx`, `components/layout/Sidebar.jsx`. Both build.

## Files
- **Server:**
  - `models/AdminSettings.js`: `listsCopiedAt`
  - `controllers/adminSettingsController.js`:
    - the copy (`copyPlatformListsOnce`); new companies from the platform
    - the readers on the caller's company
    - per-company list editing (same requests and replies) and roles (built-ins + the company's)
  - `routes/adminSettingsRoutes.js`:
    - the checklist and document writes: Company Admin
    - roles: Company Admin / HR-Admin of their own company
  - `controllers/packagingDispatchController.js`: completing packing uses the job's company list
  - `index.js`: the copy at start
- **Screens:**
  - new `pages/hrms/CompanyAdmin/CompanySettings.jsx` (+ the menu item and route)
  - `pages/admin/AdminSettings.jsx`: Platform Branding; the moved sections gone from the nav
  - new `components/settings/CrudSection.jsx`: the list editor, shared

## Tested
- **The new suite `settingssplit`: 31 of 31,** through the real server, on made-up companies seeded with **stale** lists:
  - **the copy:** same ids and keys, stale lists replaced, built-ins not copied, once only
  - **every reader's route,** with the same shape
  - **the Company Admin's edits:** stay in their company; another company's Company Admin can't touch them; the key kept on rename; the Super Admin and a Sales Employee refused
  - **custom roles per company:** HR of another company can't rename or delete; built-ins locked; a built-in name refused
  - **packing:**
    - every item ticked → packed
    - a job ticked before the move → still packed
    - a newly added item is required
    - a missing tick → refused
  - **empty stays empty;** a new company gets the platform lists
  - **Platform Branding** still Super Admin only
- **On dev:** the copy stamped every company with the same ids and keys (test-1, Nexora, Samtek Machinery).
- **Regression** (users, roles, permissions): `people` 123, `hrperms` 33, `companyaccess` 42, all passing.
- **The screens bundle,** including the readers (Packaging Jobs, Add User).
