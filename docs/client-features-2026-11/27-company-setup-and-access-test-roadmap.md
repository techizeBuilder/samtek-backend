# Feature 27: Company setup, the Company Admin's access, and company boundaries (browser test)

**PASSED 25–26 Nov 2026** (parts 1–5, on the test company Zz F27 Company). Cleaned up on 26 Nov: the company, its 4 users, 12 departments, 1 designation, its settings copy, and the logo and stamp files are deleted. Backup: `D:\cs\db-backups\f27-browser-test-2026-11-26\`.

*On dev. What changed: [27-company-setup-and-access-changes.md](27-company-setup-and-access-changes.md). The suite `companyaccess` (42) checks every server rule, including the attacks; this is about the screens.*

**Before:** a snapshot of the companies and users. **After:** the test company and its users are deleted.

**Logins:** the Super Admin (`admin`); the new company's Company Admin; a Sales Employee; an HR-Admin.

## 1. Super Admin → Companies
1. **Add Company:** there's no stamp field, only the note about **logo and stamp**. Fill it in with **Create Company Admin** on (name, a test email, phone, password) and save.
2. **The table:** the new company shows **Logo – / Stamp –**.
3. **The company menu → Logo & stamp:**
   - upload a logo, then a stamp; each shows at once
   - close, and the table shows **Logo ✓ / Stamp ✓**
   - **View Details** shows the stamp
4. **The menu on the left** no longer has **Role & Permissions**. Typing `/role-permission-management` opens nothing.

## 2. The new Company Admin
1. **Log in as the new company's Company Admin.** The sidebar shows all their pages straight away:
   - Dashboard, Employee Management, My Company, Pricing Value
   - Operating Units, Departments, Designations, Roles & Permissions, Task Management, and the rest
   - Before, these were hidden until someone fixed their permissions.
2. **My Company:** change the logo; the company's details save.
3. **My Profile:** the **Phone** field shows the phone from creation. Change it and save; it stays.
4. **Employee Management:** add an HR-Admin and a Sales Employee for later.

## 3. Their own Roles & Permissions
1. **On Roles & Permissions, try to take a page away from themselves:** the server refuses changes to your own permissions. Their pages stay either way.
2. **Give the HR-Admin a page:** it works as before.

## 4. Roles
1. **As the HR-Admin:** edit the Sales Employee and try to make them **Company Admin**. Refused, with *"Only a Super Admin or this company's Company Admin can give the Company Admin role."*
2. **As the Company Admin:** make the HR-Admin a second Company Admin (allowed), then change them back.
3. **As the Company Admin:** try to make yourself another role or inactive, as the only Company Admin. Refused, with *"This is the company's only Company Admin…"*

## 5. Only their own company
1. **As the Sales Employee, My Profile:** name and phone save. There's no way to edit a colleague; the server refuses it anyway (the suite checks the attempts).
2. **As the HR-Admin, Employee Management** lists only their own company's people.

## 6. Clean up
I delete the test company and its users, and the uploaded logo / stamp files.
