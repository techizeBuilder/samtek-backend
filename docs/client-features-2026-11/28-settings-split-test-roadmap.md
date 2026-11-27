# Feature 28: Super Admin Settings split (browser test)

**PASSED 26 Nov 2026** (parts 1–4).
- **Fixed along the way:**
  - Platform Branding now shows: one logo top left; the top bar shows the name only (each company's own name for its people).
  - Settings → General's crash on a blank SMTP entry left by the 25 Nov security probe.
  - The test's custom role led to feature 34 and the security fixes of 26 Nov.
- **Cleaned up:**
  - test-1's "Store manager" role and `teststoremanager@gmail.com`
  - Platform Branding back to "Samtek Machinery" with no logo
  - backups in `D:\cs\db-backups\f28-browser-test-2026-11-26\`

*On test-1. What changed: [28-settings-split-changes.md](28-settings-split-changes.md). The suite `settingssplit` (31) checks the server and every reader's route; this is about the screens.*

**Before:** a snapshot of test-1's settings. **After:** test items, document types and roles are removed.

**Logins:** the Super Admin; test-1's Company Admin; an HR-Admin; a packer (Packaging Jobs); an employee.

## 1. Super Admin → Settings
1. The left side shows **Platform Branding**, General, API.
2. **Platform Branding:** only the logo and Platform Name. Change the name and save; the Super Admin's top bar follows. Put it back.
3. **General:** SMTP and Other Settings only, with the note about the Company Admin. There's no Dispatch or HRMS.

## 2. Company Admin → Company Settings
1. **The menu has Company Settings.** Packing checklist shows the same 4 items as before.
2. **Add "Zz Manual in box",** then rename it.
3. **Employee documents:** the same list as before. Add "Zz Police Verification".
4. **Custom roles:** none yet; the built-in roles are listed, locked. Add "Zz Fitter".

## 3. The places that read them
1. **Packaging Jobs** (packer):
   - an open job shows the checklist, including "Zz Manual in box"
   - tick everything and complete: **Packed**
   - an older job ticked before today also completes once the new item is ticked
2. **Add User** (HR-Admin): the Role list includes **Zz Fitter**.
3. **Document Upload** (employee): "Zz Police Verification" is there.
4. **Document Verification** (HR): the same list.

## 4. Only their company
**Log in as another company's Company Admin:** their Company Settings shows their own lists, without "Zz Manual in box" or "Zz Fitter".

## 5. Clean up
I remove the test item, document type and role. If test-1 was changed, its settings come back from the snapshot.
