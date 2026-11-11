# Feature 2, stage 1: People with no login (browser test)

*Written 6 November 2026, company test-1 on dev. What changed: [02a-people-no-login-changes.md](02a-people-no-login-changes.md).*

**Before you start:** Add Employee needs a Designation under the department you pick, and a Manager in the company. On test-1, add a Designation such as Welder under Production first if there isn't one. Have any PDF or image ready to use as the Aadhaar.

## Steps

### 1. Add a worker
HR → Employee Management → Add User.
- [ ] **Gets a login** has nothing picked. Click Add User straight away: refused, it takes you to the top, and it says to choose.

Pick **Gets a login: No**.
- [ ] Password, Role, IVR Extension, Is Trainee and the module permissions aren't shown.
- [ ] Email says optional, Device Code is required, and a **Documents** section lists every document type, with Aadhaar required.
- [ ] Try saving with no Device Code and no Aadhaar: both are refused, saying they're required.
- [ ] Fill in everything with no email, Department Production, Designation Welder, Device Code `0005`, and the Aadhaar. Save.
- [ ] Switch to **Yes** and back on a fresh form: Password, Role and the rest return.

**I'll check on dev data:** role Manpower, no password, no email, code `0005` as text, Aadhaar Verified by you.

### 2. A second worker, no email
Add another with no email, a different device code, and a PAN as well as the Aadhaar.
- [ ] It saves. This is the check that blank emails no longer clash. The PAN is Verified too.
- [ ] Try device code `0005` on a third: refused, saying it's already given.

### 3. They appear where they should
- [ ] Employee Management: both show a **No login** badge in the list and in the card view.
- [ ] Filters → Login → No login shows only them. Has login hides them.
- [ ] Search `0001` finds the first worker.
- [ ] Roles & Permissions: they're **not** listed.
- [ ] Attendance Record and Add Salary Structure: they **are** listed.

### 4. They can't sign in
Log out, then try signing in with the worker's Employee ID, `EMP-TES-0040`, and any password.
- [ ] "Invalid credentials", with no error page.

Then, for the password log, sign in normally as anyone and look at the backend terminal.
- [ ] The password doesn't appear, and neither does a list of users.

### 5. HR uploads documents
HR → Document Verification → the worker → View Documents.
- [ ] Aadhaar shows **Verified**, with **Replace**. Other types show **Not Uploaded**, with **Upload**.
- [ ] Upload a PAN: it's Verified straight away.
- [ ] Replace the Aadhaar: it stays Verified.
- [ ] View Document opens the file in a new tab.

Now someone **with** a login:
- [ ] HR uploads a document for them: Verified at once.
- [ ] Log in as them and upload another type under My Profile → Document Upload: it stays Uploaded, then HR can Verify or Reject as before. Once Verified, they can't replace it, and HR still can.

### 6. Private documents
Tell me when you reach this step, and I'll give you a real file address to try.
- [ ] Open that address in a browser tab: refused.
- [ ] Log in as anyone with a login and open your own document: it opens. No screen leads to someone else's, so that refusal is covered by the suite.
- [ ] Log in as the worker's Manager → the worker's profile → open a document: it opens.

### 7. Give them a login
HR → the second worker's profile.
- [ ] **Give Login** shows where Change Password normally is.
- [ ] The Attendance Device section shows their code, and the pencil edits it. A code already taken is refused and says so.
- [ ] Give Login with an email already in use: refused.
- [ ] Give Login properly: email, password, role Production Employee.
- [ ] The badge is gone. Their department and documents are still there.
- [ ] Log in as them: it works, with Production's menu.

### 8. Heads' menu
Log in as a Head, such as Production Head, Store Head and R&D Head.
- [ ] My Profile, Attendance, Leave, Holidays, Payroll and Requests appear, and each page opens.
- [ ] Upload a document as that Head.
- [ ] **Their department menu is unchanged.** It shows the same items as before, not extra ones. This is the most important check here, because Heads' permission checks had to be handled carefully.

Then log in as a plain Production Employee.
- [ ] Their menu is unchanged.

## Not needed on screen
Covered by the `people` suite:
- Each required detail refused when missing, with no person or file left behind.
- A failure part-way leaving no person.
- A colleague or another company's HR being refused on view, upload, replace and open, with no file left on disk.
- A Manager limited to their own team.
- Old records with no `canLogin` still signing in.
- Leave decisions with no email.

## Automatic results
| Suite | Result |
|---|---|
| `people`, new, through the real running server | 123 of 123, 0 left behind |
| `deptseed`, uses company and departments | 40 of 40 |
| `machinestock`, raises orders using a company user | 70 of 70 |
| `stockorder`, raises orders using a company user | 83 of 83 |

The other 77 suites were skipped. None imports the changed controllers, and the ones that need users add them straight to the database, where the new email rule changes nothing for a filled-in email.

All the changed screens compile, but nothing has been seen in a browser yet.

## Browser results
*6 November 2026, stopped for a 3-day holiday during step 2.*

**Seen on screen:**
- **Nothing picked at first:** seen, and Add User refused with "Choose Yes or No", back at the top.
- **Aadhaar required:** seen refused on the form.
- **Worker saved:** the card shows Manpower with a No login badge.

**Found during the test, and changed the same day:**
- **Gets a login had Yes picked by default.** You pointed out HR could miss it and create a login by accident. Now nothing is picked.
- **Device Code was optional.** You pointed out it's what attendance depends on. Now required for no-login people, and still optional with a login.
- **Only Aadhaar was on the form.** You pointed out labour has other documents too. All document types now show, with Aadhaar required and the rest optional.

**On dev data, read-only:** the worker has no login and no password, role Manpower, no permissions, username = Employee ID `EMP-TES-0039`, code `0001` as text, Production, Welder, test manager 2. Aadhaar Verified by rahul, with the file on disk.

*11 November 2026:*
- **Step 2, reported working by you.** On dev data: Test Worker Two, `EMP-TES-0040`, no email, no password, code `0002` as text, Aadhaar Verified by rahul. It saved with a blank email, which the old rule would have refused once a second person had none.

**Not settled:** neither worker has a PAN, and only one file reached the server for Test Worker Two. If no PAN was chosen, that's expected. If one was, it's a bug on this screen; the form code reads correctly and the automated test saves other documents through the server.

**Found on 11 Nov, fixed:** an employee trying to replace their own Verified document was refused, but the refused file stayed on disk. It's now refused before the file is saved.

Steps 3 to 8 are still to do.

## Steps 3 to 8 in detail (written 11 Nov)
The two workers on test-1: **Rahul Pramanik** (`EMP-TES-0039`, code `0001`) and **Test Worker Two** (`EMP-TES-0040`, code `0002`), both Manpower, reporting to test manager 2. Already done on 11 Nov: the No login badge in the card view; HR-Admin, Production Head and test production employee opening their pages.

**3. Where they appear**, as HR-Admin rahul:
1. Employee Management, card view: the search box reads "Search Employee...". Type `0001`: only the first worker shows.
2. Switch to the list view (icon beside the grid icon, top right). Both workers show a **No login** badge.
3. Click **Filters**, then set **Login** to **No login**: only the two workers. Set it to **Has login**: neither shows.
4. Log in as Company Admin, open **Roles & Permissions**, search `EMP-TES`: neither worker is listed.
5. As rahul, **Attendance → Attendance Record**: both are listed. **Payroll → Salary Structure**, add a structure: both are in the employee picker. Don't save.

**4. They can't sign in:**
1. Log out. Sign in with username `EMP-TES-0040` and any password: "Invalid credentials", no error page.
2. Sign in as rahul. In the backend terminal, the password and a list of users don't appear.

**5. HR uploads documents**, as rahul, **Document Verification**, search `EMP-TES-0040`, **View Documents**:
1. Aadhaar: **Verified**, button **Replace**. Every other type: **Not Uploaded**, button **Upload**.
2. Upload a PAN: Verified at once.
3. Replace the Aadhaar with another file: still Verified.
4. **View Document** on it: opens in a new tab.
5. Now test production employee, who has a login. HR uploads a document for them: Verified at once.
6. Log in as test production employee, **My Profile → Document Upload**, upload a different type: shows **Uploaded**, not Verified.
7. Back as rahul, Verify it. Log in as test production employee: that document now has no Replace. As rahul it still has Replace.

**6. Private documents:**
1. Open this address in a new browser tab: `http://localhost:5000/api/documents/file/6aedbe5a60e9e169b4dec4cb`. It's the first worker's Aadhaar. Expect a refusal (not logged in), not the file.
2. Log in as test production employee, **My Profile → Document Upload**, open your own document: it opens.
3. Log in as **test manager 2**, **Team → Team Members**, open Test Worker Two, open a document: it opens.

**7. Give Test Worker Two a login**, as rahul (HR-Admin, not Company Admin): Employee Management, card view, **⋮** on Test Worker Two's card, **View Profile**:
1. **Give Login** shows where Change Password normally is.
2. **Attendance Device** section shows code `0002`. Pencil, change to `0001`, save: refused, it's taken. Leave it `0002`.
3. Give Login with an email someone already uses (e.g. `testproductionemployee@gmail.com`): refused.
4. Give Login with a new dummy email, a password, role **Production Employee**: saves.
5. The No login badge is gone; Department and documents are still there.
6. Log in as that email and password: Production's menu appears.

**8. Heads' menus.** For **store head** (`test store head`) and **test rnd head** (`test`), log in and:
1. My Profile, Attendance, Leave, Holidays, Payroll and Requests appear; open one page from each.
2. Upload a document under My Profile → Document Upload.
3. **Most important:** their own department menu is the same as before, no new items.
4. Then log in as test production employee: their menu is unchanged.


## Browser results, steps 3 to 8 (11 November 2026)
**People with no login: browser test COMPLETE.** You reported steps 3 to 8 working, with step 7 done as HR-Admin rahul through ⋮ → View Profile.

**On dev data, read-only, after step 7:** Test Worker Two (`EMP-TES-0040`) is now Production Employee, can log in, has a password, email as username, module production. Kept: code `0002`, department Production, reporting manager, Aadhaar and PAN Verified. test production employee has an Aadhaar and PAN Verified. store head and test rnd head each uploaded an Aadhaar, waiting as Uploaded for HR, which is the normal path for someone with a login.
