# Feature 34: Custom roles (browser test)

**PASSED 26 Nov 2026.**
- **Parts 1–3** as written.
- **Part 4** was done as the Company Admin: HR has no Roles & Permissions page and no screen that changes an existing person's role. HR's waiting role change is covered by the suite.
- **Found along the way:** HR's old "Module Permissions" box on the employee profile (four old employee roles only). It replaced all of a person's permissions with one module. **Removed** on the user's call: HR doesn't edit modules. If the client wants HR to, HR gets the Roles & Permissions page.

*On test-1. What changed: [34-custom-roles-changes.md](34-custom-roles-changes.md). The suite `customroles` (43) checks every server rule; this is about the screens.*

**Before:** test-1's old "Store manager" role (no base role) and `teststoremanager@gmail.com` are deleted (backup first). **After:** the test roles and people are deleted.

**Logins:** test-1's Company Admin, HR (`testhr`), and the people the test adds.

## 1. Making the role (Company Admin → Company Settings → Custom roles)
1. **Add role:**
   - name **"Zz Store Manager"**, based on **Store Head**: the amber Head note shows
   - tick: Inventory (View, Add, Edit), Orders (View), Dashboard (View)
   - tick **"HR needs my approval"** and save
   - the list shows *"based on Store Head · 0 people · needs your approval"*
2. **Add role "Zz Store Helper"** based on **Store Employee**: Inventory (View) only; no approval tick.
3. **As HR:** there's no way to add or change a custom role (HR sees the list only on Add User).

## 2. HR gives them
1. **As HR, Add User → Role → "Zz Store Helper (Store Employee)":**
   - the note *"Based on Store Employee…"*
   - the grid shows **Store → Inventory** only: View ticked, the other three locked
   - save: **added at once**
2. **As HR, Add User with "Zz Store Manager (Store Head)":**
   - the note says it waits
   - save: **"Sent to the Company Admin for approval"**
3. **As the Company Admin, Roles & Permissions:**
   - the waiting box says **Zz Store Manager**; approve
   - the table shows the person as **Zz Store Manager**

## 3. What the person sees
1. **Sign in as the Zz Store Manager person:**
   - the **Store Head** menu, but only Dashboard, Inventory and Orders
   - **My Profile** and the welcome say **Zz Store Manager**
2. **Inventory:** they can add and edit; **Orders** they can only view.

## 4. HR can't give more
1. **As HR, Roles & Permissions → edit the Zz Store Helper person:**
   - the Role box shows *"Zz Store Helper (custom, based on Store Employee)"*
   - only Inventory is listed, Add / Edit / Delete locked
2. **Switch their role to "Zz Store Manager":** it waits for the Company Admin; the person stays Zz Store Helper meanwhile.

## 5. The Company Admin changes the role
1. **Untick Inventory → Edit on Zz Store Manager and save:** the Zz Store Manager person loses Edit on Inventory (sign in again to see it).
2. **Tick Purchase Orders → View:** nobody gets it ticked by itself; HR can now tick it for a person.
3. **Rename it to "Zz Store In-charge":** Roles & Permissions and the person's profile show the new name.
4. **Try to change what it's based on, or delete it:** refused while people are on it (*"… people have this role: move them first."*).

## 6. Bulk import (HR)
1. A file with one login row whose Role is **"Zz Store Helper"**:
   - the preview shows the custom name
   - after the import the person is Zz Store Helper, with Inventory View only

## 7. Store's R&D part (26 Nov)
1. **Roles & Permissions → edit a Store Head (or Store Employee):** the R&D card lists only **Product Master** and **BOM Management**, with Add / Edit / Delete locked.
2. **Sign in as that Store person → Inventory:** the Machines and Sub Child Part tabs still load.
3. **Company Settings → a custom role based on Store Head:** the R&D part offers the same two pages, View only.

## 8. Clean up
I delete the test people and the two Zz roles (backup first).
