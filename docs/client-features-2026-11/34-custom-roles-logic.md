# Feature 34: Custom roles that work (logic and decisions)

*26 November 2026. Found in feature 28's browser test: the user made a custom role "Store manager" on test-1 and a user on it (`teststoremanager@gmail.com`).*

## What it is today (broken)
- **The Company Admin adds a custom role on Company Settings → Custom roles.** It's only a name. The screen says *"what it can open is set on Roles & Permissions"*, but that isn't so:
  - **Roles & Permissions has nothing to tick for it.** The permission lists are kept per built-in role (`ROLE_MODULE_MAP`), and a custom name isn't in them.
  - **So the person is saved with no pages.** They see only Profile, and they landed on an old dashboard showing company numbers (that leak is fixed separately; see `security-checks/2026-11-26-super-user-and-dashboard.md`).
- **Only HR's Add User offers custom roles;** the Company Admin's doesn't.
- **The real reason it can't work as "pick any modules":** most pages and most server routes check the role's **name** ("Store Head", "Sales Employee"), not the switches. A person whose role is "Store manager" fails all of them, whatever they're given.

## Decided (26 Nov, the user)
1. **A custom role is based on one built-in role.** The Company Admin names it, picks the built-in role it's based on (e.g. *Store manager* based on **Store Head**), and ticks which of that role's pages and actions it gets. The person's real role underneath is the built-in one, so every page and server check works unchanged. Their switches can never go beyond the custom role's list, so HR can't add more.
2. **HR and the Company Admin both assign it** (Add User, a role change, Give Login, HR's bulk import). Both can only tick inside the custom role's list.
3. **An approval flag on each custom role:** *"HR needs the Company Admin's approval to give this role."* When it's on and HR gives the role, it waits for the Company Admin, exactly like a Head role does (feature 31: a new user is saved inactive; a role change or a login waits). The Company Admin and the Super Admin give it directly.

**A–N below: decided 26 Nov, all as recommended (the first option each time).**

## The questions (decided as recommended)
**A. Which built-in roles can a custom role be based on?**
- (a) **the department roles (Heads and Employees), Manager and Employee** (recommended)
- (b) also HR-Admin, Company Admin and MIS Admin

The admin roles carry powers by name that no switch limits, so a cut-down version of them would only *look* limited.

**B. Based on a Head means Head powers that aren't switches.**
- A Head role carries powers by name that no switch limits:
  - giving KRA tasks to the department
  - counting as the department head for approvals and scores
  - waiting for the Company Admin (feature 31)
- A custom role based on a Head keeps them.
- **Recommended:** say so on the screen when a Head is picked (*"Based on a Head: it also gives and reviews the department's tasks and waits for the Company Admin when HR gives it."*). For a role with less than a Head's power, base it on the Employee role.
- **Recommended:** a Head-based custom role always waits when HR gives it, whatever the flag says, as feature 31 already does for Heads.

**C. What the Company Admin ticks.**
- (a) **page by page, with the four actions** (View, Add, Edit, Delete), from the base role's own list (recommended). It's the same grid as Roles & Permissions, so it looks familiar.
- (b) whole modules only

**D. What a new person on the role starts with.**
- (a) **everything the custom role allows, ticked** (recommended); HR can untick some
- (b) nothing ticked

**E. The server enforces the list.** Whatever a screen or a request sends, a custom-role person's saved permissions are trimmed to the role's list (recommended, required for security).

**F. When the Company Admin changes a custom role's list later:**
- **(a) taking a page away applies to everyone on the role at once, and adding one is offered but not ticked** (recommended)
- (b) adding ticks it for everyone too

**G. Renaming and deleting.**
- A rename shows everywhere at once, because people point at the role, not its name.
- Deleting:
  - (a) **refused while anyone is on it** (*"3 people have this role: move them first"*) (recommended)
  - (b) moves them to the base role

**H. Where the name shows.**
- The custom name ("Store manager") shows on the profile, the employee lists, Roles & Permissions, the top-right menu and the welcome.
- Filters and reports that group by role:
  - (a) **group under the custom name** (recommended)
  - (b) group under the base role

**I. KRA and the scorecard.**
- (a) **The person uses the base role's KRA set** (recommended for now); HR can still give one person their own, as today.
- (b) every custom role gets its own KRA set on HR → KRA (a bigger change; later if the client asks)

**J. Changing a custom role's base role.**
- (a) **not allowed once anyone is on it** (recommended: it would change what every one of them can open)
- (b) allowed, with everyone moved

**K. The custom role that exists now (test-1's "Store manager") and its user.**
- They're the user's test data, and they have no base role.
- **Recommended:** delete both at the end of the feature 28 test (I'll back up first), before this is built. No real company has custom roles yet: only test-1 has one.
- Any future custom role without a base role:
  - the Company Admin is asked to pick one
  - until then its people keep no pages, and get the welcome page

**L. Who creates custom roles.** The Company Admin only, on Company Settings, as today (recommended). HR sees them on Add User.

**M. The Company Admin's own Add User** (feature 30) also offers the company's custom roles (recommended, following decision 2).

**N. Bulk import of people** (feature 32) takes the custom role's name in the Role column. It:
- uses the role's list as the starting permissions
- waits for the Company Admin when the flag is on, or when the role is based on a Head

Recommended.

## Not changed
- Built-in roles and their permission lists.
- Feature 31's Head approval: the custom-role flag only adds to it.
- Every page's and route's role check: they see the base role.

## How it's stored (for the plan)
- **The company's settings record:** each custom role gets `baseRole`, `allowed` (the pages and actions it may give) and `needsApproval` (the flag), next to its name, which already exists.
- **The person:** `role` = the base role (what every check reads) and `customRoleId` = the custom role. The name is shown from the role, so a rename shows everywhere.
- **Feature 31's `headApproval` record** is reused for the waiting, with the custom role named on it.
