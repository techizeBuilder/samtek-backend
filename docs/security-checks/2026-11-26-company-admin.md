# Security check, day 2 (26 November 2026): Company Admin

*Row 2 of the [list](README.md). The Company Admin's menu has 20 pages (`companyAdminMenuItems` in the client's `config/moduleRoutes.js`).*

## Already covered (suites that try other roles and companies)
| Page | Covered by |
|---|---|
| Employee Management, Add User | `companyaccess` 42, `caadduser` 19 |
| Roles & Permissions | `companyaccess`, `headapprove` 34, `customroles` 48 |
| Departments, Designations | `orgsplit` 30 |
| Company Settings | `settingssplit` 32 |
| Task Management, My Task | `taskperm` 23, `kratasks` |
| KRA | `kra` |
| My Company (details, logo, stamp) | `companyaccess` |

## Checked today: the other 11 pages
| Page | Server | Guard | Company | Result |
|---|---|---|---|---|
| Dashboard | links to the pages below | | | nothing of its own |
| My Company: Cash Password | `/api/companies/:id/cash-password` | Company Admin (or Super Admin) by role | the id must be their own | **holds** (probed) |
| Pricing Value | `/api/pricing-value/items` | `hrms.pricingValue` view / edit | items by `store` = own company | **holds** |
| **Operating Units** | `/api/branches` | `hrms.operatingUnits` view / add / edit / delete | **none** | **finding 1, fixed** |
| Attendance Device | `/api/attendance-device/*` | HR / Company Admin; login and test: Company Admin | own company (`needCompany`) | holds |
| Employee Performance settings | `/api/scorecard-settings` | read: Company Admin or `manpowerScore` view; save: Company Admin | `req.user.companyId` | holds |
| Delivery Settings | `/api/delivery-estimate/settings` | read: admin or Sales `orders` view; save: Company Admin | own company | holds |
| Standard Hours | `/api/standard-hours/*` | Company Admin by role | `company` on every lookup | holds |
| Photos & Videos | `/api/step-media/admin/*` | Company Admin by role | `adminMatch(companyId)` | holds |
| Lead & Quotation Settings | `/api/lead-setting-requests` | review: Company Admin; cancel: the requester | own company | holds (note 2) |
| Purchase Approvals | `/api/vendor-approvals` | review: Company Admin; list: + Accounts roles | own company; can't review your own request | holds |

## Finding 1 (high): Operating Units had no company check, fixed
**What it was** (`controllers/branchController.js`):
- **The list** returned **every company's** units when no company was asked for, and any company's when one was.
- **Open, edit and delete by id** reached **any company's** unit. The edit saved the request body as it was, so it could **move a unit to another company** or rewrite who created it.
- **Add** took the company from the request, so HR or a Company Admin could create a unit **in another company**.
- **Who could do it:** anyone with the Operating Units switch, which is the Company Admin and HR in every company.

**Fixed:**
- Everything uses the caller's own company; the Super Admin keeps every company and may pick one.
- Another company's unit, or a bad id, is "not found".
- A move to another company is refused.
- Add / edit save only the unit's own fields (name, code, city, state, country, address, pincode, status). The company and the creator come from the login.
- The screens are unchanged: their company dropdown already offers only the person's own company.

## Note 2 (low, not changed)
**The lead-setting request list** (`GET /api/lead-setting-requests`) has no role check: anyone in the company can read its requests. It's limited to their own company, and the content is lead stages and quotation wording, so it's left as it is. Worth a look if those requests ever carry anything sensitive.

## The probe: `sec-companyadmin-test`, 16 of 16
Through the live server, on made-up companies, nothing left.
- **Operating Units:**
  - no login 401; a Sales Employee 403; HR with View only can't add
  - the list: own units only, also when another company is asked for
  - another company's unit: open / edit / delete all "not found", and it's unchanged
  - a move to another company refused; adding "for another company" lands in their own
  - the creator can't be rewritten; a bad id is "not found"; the Super Admin can pick a company
- **Cash Password:** another company's refused (read and write); HR refused even for their own company.

## Lesson from yesterday kept
The probe is reads and made-up companies only. No write touched a real company.
