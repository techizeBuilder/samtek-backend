# Feature 34: Custom roles that work (what changed)

*Built 26 November 2026. Logic and decisions: [34-custom-roles-logic.md](34-custom-roles-logic.md). Browser test: [34-custom-roles-test-roadmap.md](34-custom-roles-test-roadmap.md).*

## In one line
**A custom role is now a named, cut-down version of one built-in role.** The Company Admin picks the role it's based on and ticks which of that role's pages and actions it gets. The person works as the base role, so every page opens, but their switches can never go beyond the custom role's list.

## Before
- A custom role was only a name.
- The person got no pages, and Roles & Permissions had nothing to tick.
- Most pages and server routes check the role's name, so a free-standing name could never open anything.

## Now
**Company Admin → Company Settings → Custom roles** (only the Company Admin makes or changes them; HR sees them):
- Each role has:
  - a **name**
  - **"Based on"**: a department Head or Employee role, Manager or Employee (not the admin roles)
  - the **base role's pages**, each with View / Add / Edit / Delete to tick
  - the tick **"HR needs my approval to give this role"**
- **Based on a Head:** a note says it also gives the department's tasks, counts as the department head, and waits for approval when HR gives it.
- **The list shows:** *"Store Manager · based on Store Head · 2 people · needs your approval"*.
- **A rename** shows at once on everyone on the role.
- **Taking a page or action away** removes it from everyone on the role. Adding one ticks it for nobody.
- **While anyone is on the role** (or waiting for it): what it's based on can't change, and it can't be deleted. *"3 people have this role: move them to another role first."*
- **An old custom role with no base role** shows *"Pick what it's based on before it can be given"*, and can't be given until then.

**Giving it** (HR and the Company Admin):
- **Add User:** custom roles are in the Role box for both, shown as *"Store Manager (Store Head)"*.
  - The rules follow the base role (a Sales-based role needs the IVR number, for example).
  - The grid shows only what the role allows, everything ticked; actions it doesn't allow are locked.
- **Give Login:** the same list; the person gets everything the role allows.
- **Roles & Permissions → edit:** custom roles are in the Role box (*"Store Manager (custom, based on Store Head)"*), and the grid is limited the same way.
- **HR's bulk import:** the custom role's name in the Role column works. The person gets the role's own list, not the window's defaults for the base role.
- **Waiting (feature 31's box):** when HR gives a custom role that has the flag on, or is based on a Head, it waits for the Company Admin, as a new user, a role change or a login. This includes moving between two custom roles with the same base role. The waiting box and the bells name the custom role.

**The server enforces it, whoever sends what:**
- A custom-role person's permissions are cut to the role's list on Add User, edit, Give Login, approval and bulk import.
- **At every server start** (after the one-time grants, which give pages by role), anyone on a custom role is trimmed again.

**Where the name shows:** Roles & Permissions (the table, the waiting badge, the role filter), Employee Management's cards, My Profile, the dashboard welcome, and the Company Admin's waiting box.

## Also, before the browser test (26 Nov): Store holds only R&D's two views
**Found by the user:** the Store roles' permission list showed **every** R&D page. Store has the R&D module on purpose (since 1 Aug; view-only defaults since 25 Sep), because its Inventory page reads two R&D lists:
- **machines:** R&D → Product Master, View
- **sub child parts:** R&D → BOM Management, View

**The risk:** the R&D routes check only the switch, not the role. So ticking more R&D pages for a Store person (for example Product Master → Edit, or Design Approval) gave them real R&D powers. A Store-based custom role would have offered the whole R&D list too.

**Now (the user's choice): everywhere, Store's R&D part is those two pages, View only.**
- **On screen:** Roles & Permissions, Add User and the custom-role editor list only those two R&D pages, with Add / Edit / Delete locked. Switching on the R&D card ticks View only.
- **On the server** (`services/access/roleLimits.js`, `ROLE_LIMITS`):
  - a Store Head's or Store Employee's R&D switches are cut to the two views on Add User, edit, a role change onto Store, Give Login, approval and bulk import
  - a Store-based custom role can allow no more
  - at every server start, after the one-time grants (for example the Task Management grant, which adds a switch to every module someone holds)
- **On dev:** all 5 Store people hold just the two views.
- **Tested:**
  - `customroles` 48: 5 new checks (Add User, edit, move onto Store, a Store-based custom role, the start pass)
  - `hrperms` 36: the server and screen limits agree; Store's screen lists only the two views
  - `peopleimport` 21, `headapprove` 34, `caadduser` 19

## Files
- **Server:**
  - new `services/access/customRoles.js` (all the rules)
  - `models/AdminSettings.js` (`baseRole`, `allowed`, `needsApproval` on each role)
  - `models/User.js` (`customRoleId`, `customRoleName`; the same on `headApproval`; an index)
  - `controllers/adminSettingsController.js` (`rolesCrud`, `rolesFor` with people counts)
  - `routes/adminSettingsRoutes.js` (roles: the Company Admin only)
  - `controllers/userController.js` (`createUser`, `updateUser`, `giveLogin`, the list's role filter)
  - `services/access/headApproval.js`
  - `services/bulkImport/peopleImport.js`
  - `index.js` (the trim at start)
  - `auth-routes.js` (login and `/auth/me` return `customRoleName`)
- **Screens:**
  - `lib/roleModulesConfig.js` (`CUSTOM_BASE_ROLES`, `modulesForCustomRole`, `customRoleDefaults`, `roleName`)
  - `pages/hrms/CompanyAdmin/CompanySettings.jsx` (the role editor)
  - `pages/hrms/AddUser.tsx`, `pages/hrms/GiveLoginModal.tsx`, `pages/RolePermissionManagement.jsx`
  - `components/users/HeadApprovals.jsx`, `pages/hrms/Employee.tsx`, `pages/Profile.jsx`, `pages/Dashboard.jsx`

## Tested
- **The new suite `customroles`: 43 of 43** through the real server, on made-up companies; nothing left. It covers:
  - who makes roles: HR refused; no base role, an admin base and another department's module all refused
  - companies kept apart
  - HR and the Company Admin adding people: base role, extras trimmed, defaults
  - the flag and a Head base waiting, then approval
  - an unknown or base-less custom role refused
  - edits: trimmed, kept, taken off, put back, moved with a wait
  - Give Login, plain and waiting
  - rename, taking away, adding not ticked, base change and delete refused, people counted
  - the list filter by custom name and the roles it lists
  - bulk import with a custom name, plain and waiting
  - the trim at start
  - delete once nobody is on it
- **`hrperms`:** now also checks that the server's base-role modules match the screen's.
- **`settingssplit`:** updated, because only the Company Admin makes custom roles now and a new one needs its base role.
- **Regression:** see the daily report.
- **Nine screens bundle.**
