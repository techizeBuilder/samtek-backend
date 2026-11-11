# Departments from roles (what changed)

*Built 6 November 2026, at your ask, ahead of People.*

## In short
Nobody has to type the company's departments any more. The list comes from the roles, so a Company Admin opens the Departments page and they're there. HR then picks from them on Add Employee.

## The list: 11 departments
| Department | From roles |
|---|---|
| Sales | Sales Head, Sales Employee |
| Marketing | Marketing Head, Marketing Employee |
| Accounts | Accounts Head, Account Employee |
| Production | Production Head, Production Employee |
| Research & Development | Research & Development Head, Research Development Employee |
| Store | Store Head, Store Employee |
| Quality Control | QC Head, QC Employee |
| Packing and Dispatch | Packing and Dispatch Head, Packing and Dispatch Employee |
| Complaint Management | Complaint Management Head, Complaint Management Employee |
| MIS | MIS Admin |
| Human Resources | HR-Admin |

**Left out:**
- **Roles that aren't a department:** Manager, Employee, Company Admin, Auditor, Finance Manager, Admin.
- **Custom roles:** they're only labels, so nothing says which department they belong to.
- **Purchase:** no role exists for it. One dev company typed it by hand. Tell me if you want it added.

## Who gets what
| Company | What happens |
|---|---|
| **New company** | Gets all 11 when it's created. A failure here doesn't stop the company being created |
| **Existing, no departments** | Gets all 11 once, the next time the server starts. No script to run on live |
| **Existing, already has departments** | Nothing changes by itself. The **Add from Roles** button offers what's missing |

**It happens once per company.** A department an admin deletes stays deleted, even if they delete them all. Two servers on one database can't both seed the same company.

## The button
**Add from Roles** sits beside + Add Department. It opens a checklist of what this company doesn't have, all ticked, each showing its roles. The admin unticks any they don't want and clicks Add.

- It disappears once nothing is missing, and comes back if someone deletes one of the listed departments.
- A name that matches ignoring capitals and spaces counts as already there, and so does an Inactive department.
- **A differently named department isn't recognised.** "complaint and service" doesn't match "Complaint Management", so it's offered, ticked. That's why the admin gets to untick.
- It only ever adds to the user's own company, whatever the request says. A user with no company, such as a Super Admin, doesn't see it.

## What happened on dev
| Company | Before | Now |
|---|---|---|
| `ac2b`, `9fa1`, `bea2`, `bb84` | 0 | 11 each |
| test-1 (`f6a7`) | 3 | 3. Its button offers 10, because it already has Production |
| `b0ef` | 2 | 2 |
| `69c7` | 12 | 12 |

## Worth knowing: Designation
Add Employee also requires a **Designation,** filtered by the department you picked. So HR picks a seeded department and still finds the Designation dropdown empty until someone adds one. This wasn't in the ask. The same roles could seed it (Sales → Sales Head, Sales Employee), if you want that.

## Tests
- **New suite `deptseed`: 40 of 40,** on made-up companies, 0 left behind. It covers everything above, including 3 runs at once giving 11 rather than 33, a seed failure still creating the company, and the permission check using a real Company Admin's permission shape.
- **Regression:** none. No existing suite touches departments or company creation.
- **Frontend:** the two changed files compile.
- **Browser:** not done yet. Steps below.

## Browser check
- [x] **1.** test-1's Company Admin → Departments: **Add from Roles** offers 10. Untick some, click Add, and they appear. *(6 Nov: unticked MIS and Complaint Management, added 8, 11 in total on one page.)*
- [x] **2.** The button then offers only the ones you unticked. *(6 Nov: narrowed to Complaint Management and MIS.)*
- [x] **3.** HR → Add Employee: pick test-1, and the new departments are in the dropdown. *(11 Nov: part of People step 2, reported working.)*

## Files
**Backend:** `services/departmentSeedService.js` (new), `models/Company.js` (`departmentsSeededAt`), `controllers/companyController.js`, `controllers/departmentController.js`, `routes/department.routes.js`, `index.js`.

**Frontend:** `pages/hrms/SystemConfigration/DepartmentsFromRolesModal.tsx` (new), `pages/hrms/SystemConfigration/Departments.tsx`.
