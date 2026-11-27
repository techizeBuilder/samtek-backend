# Feature 25, slice 1 of 4: KRAs (what changed)

*Built 23 November 2026. Logic and your decisions: [25-kra-tasks-logic.md](25-kra-tasks-logic.md). Browser test: [25-kra-slice1-test-roadmap.md](25-kra-slice1-test-roadmap.md). Next: slice 2, the new Task Management on KRAs.*

## In one line
HR (and the Company Admin) set each **role's KRA**: items with a target in words and a weight adding up to 100, plus routine duties with the **"Track daily in My tasks"** switch. They can give **one person their own** KRA. **Every change is a new version from a date**, and everyone sees their own KRA under **My tasks → My KRA**.

## HR → KRA (also Company Admin → KRA)
- **Left:** every department with its roles, and below them **"Other roles"** that people actually hold (Manager, Employee, Manpower, custom roles). Each role shows *"v2 · 4 KRAs · 6 people · 1 with their own"*, *"Not set"*, or *"changes 1 Dec"*.
- **A role:**
  - **KRA tab:** the set in force, and the next version if one is dated ahead. **Set / Change the KRA** opens the editor:
    - **each KRA:** name, **weight %**, *what good looks like* (KPI / target in words), a description, and an optional **"Temporary: ends on"** date
    - **routine duties per KRA:** title, **working days / weekly (a day) / monthly (a date)**, due time, **"Track daily in My tasks"** (on = created and scored from slice 3; off = only written on the KRA), and "File" (a file needed when ticked done)
    - **Add Step work (Production):** the built-in item measured from Process Execution (decision E)
    - a live total, *"Weights add up to 95% — they must add up to 100%"*, and *"3 to 7 works best"*
    - **Applies from** (today or later, never earlier) and **Why it changed**
    - **Save as a new version.** If people in the role have their own KRA, a box asks for each: **keep their own** or **follow the role's new KRA**.
  - **History tab:** every version (from, why, by), each opening read-only.
  - **People tab:** the people in the role (paged, search), marked **"Their own KRA"** or "The role's KRA". **Open** shows:
    - their KRA now and where it comes from, and the next change
    - **Give them their own KRA:** starts from a copy of what they have, so the KRA ids stay the same and tasks stay linked
    - or **Back to the role's KRA** from a date
    - their own versions
- **Who:**
  - **HR** with the new permission **KRA** (Roles & Permissions → HRMS). Existing HR-Admins get it once at the next server start; one a Company Admin removes stays removed.
  - **the Company Admin**, always
  - **a department head** can view their own department's people's KRA (slice 2's task form needs it), but not change it

## My tasks → My KRA (every department's My Task page)
- **The person's KRA items:** weight, target, and the routine duties marked *"tracked daily in My tasks"* or *"described only"*.
- **The source:** *"Your role's KRA · version 3 · from 1 Dec"* or *"Set for you"*.
- **"Changes from …"** when a new version is coming.

## The rules
- **A person's KRA on a date** = their own latest version in force (unless it says "back to the role"), else their role's latest version in force.
- **Versions are never edited.** A save is always a new version, from today or later, so a past month never changes.
- **Item and duty ids stay the same** across versions, and in a person's own copy, so a task (slice 2) stays linked to its KRA for good.
- **A temporary item** is in force until its end date, then drops out by itself.
- **Checks** (also on the server):
  - 1–10 items; names given and unique; weights whole numbers adding to 100
  - no past date; an end date not before the start
  - routine duties with a title, a valid day and time
  - Step work at most once

## Technical notes
**Server:**
- **New `models/KraSet.js`:**
  - company, scope (role / person), role or person, version, `effectiveFrom`, `followsRole`
  - `items[]`: `itemId`, name, kpi, description, weight, `builtIn` stepWork, `endsOn`, `routine[]` (`dutyId`, frequency, weekday / monthDay, dueTime, `track`, `needsFile`)
  - note, saved by
  - indexes `{ company, scope, role, effectiveFrom, version }` and `{ company, scope, person, … }`
- **New `services/kra/kraService.js`:**
  - `rolesOverview`, `roleKra` (people paged)
  - `saveRoleKra` (+ keep / follow), `personKra`, `savePersonKra`, `myKra`, `versionOf`
  - **`kraOf(company, person, date)`:** the resolver slices 2–4 use
  - permissions: `canViewKra` / `canEditKra`, a head's view of their department
- **New `routes/kra.routes.js`:** `/api/kra` — `GET /my`, `GET /roles`, `GET|PUT /role/:role`, `GET|PUT /person/:id`, `GET /version/:id`.
- **`services/hrPermissionBackfill.js`:** `kra` in the HR-Admin list. **`index.js`:** mounts the routes; `grantHrFeatureOnce('kra', 'hrKraGrantedAt')`.

**Screens:**
- new `pages/hrms/Kra/KraPage.jsx`
- new `components/kra/` (`KraItemsEditor`, `KraItemsView`, `MyKraCard`, `kraUi`)
- the **My KRA** tab on `pages/hrms/TaskManagement/EmployeeTasks.tsx`
- the menus (`config/moduleRoutes.js`: HR → KRA, Company Admin → KRA)
- the permission (`lib/roleModulesConfig.js`)
- the routes (`App.jsx`)

## Tests
**New suite `kra`, 33 of 33,** through the real server, on made-up companies with `.invalid` emails:
- **The overview:** departments → roles with counts; "Other roles" holds a custom role; the Company Admin isn't listed.
- **Refused:** weights at 90%, no name, the same name twice, yesterday's date, a weekly duty with no day, Step work twice, 11 items.
- **Versions:**
  - v1 (a tracked and an untracked duty)
  - v2 keeps the item and duty ids; the history has both, and v1 is unchanged
- **A person:**
  - follows the role
  - their own copy keeps the role's item ids; a temporary item drops out after its end date
  - the people list marks them
  - v3 with "follow": Rahul back on the role's KRA, Asha keeps her own
- **Dated ahead:** v4 from tomorrow isn't in force today; it shows as upcoming in the role and in My KRA, and `kraOf(tomorrow)` gives it.
- **Who:**
  - HR with view only reads but can't save; the Company Admin saves
  - the Production Head views a Production person but not a Store person, not HR's overview, and changes nothing
  - another company gets 404
  - a person opens their role's old version but not a colleague's KRA

**Regression:** `hrperms` 33 (after refreshing its copies of the client's menu and permission files), `scorecard` 113.

**Checks:** the server files pass the strict ES-module syntax check and the routes load; the screens bundle with every import found.
