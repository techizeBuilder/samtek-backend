# Security check, 25 Nov 2026: Super Admin

## The pages and what they call
| Page | Server addresses |
|---|---|
| Super Admin Dashboard, Orders, Sales, Customers, the company picker | `/api/super-admin/*` |
| Companies (with logo & stamp, the company report) | `/api/companies/*`, `/api/super-admin/companies` |
| Settings → Platform Branding | `/api/settings`, `/api/settings/company`, `/api/settings/company/logo` |
| Settings → SMTP, platform lists | `/api/admin-settings/global-smtp`, `/api/admin-settings/lead-stages` … |

**The guards:**
- `/api/super-admin` has a Super Admin check on the whole router (feature 26). Only the company dropdown and one company by id are open, on purpose.
- `/api/companies` checks inside the code (feature 27).
- The `/api/settings` handlers check the Super Admin role inside the code. The routes themselves check only the login.
- SMTP and the platform lists are Super Admin only on the route.

## Live tries (made-up company; no login / Company Admin / HR / Sales Employee / Super Admin)
| Address | No login | Company Admin | HR | Employee | Super Admin |
|---|---|---|---|---|---|
| Dashboard, Orders, one order, Sales, Customers, picker, all companies | 401 | 403 | 403 | 403 | 200 |
| Create a company | 401 | 403 | **400** (passed the check) | 403 | — |
| Edit / delete another company | 401 | 403 | 403 | 403 | — |
| Company stats (all companies) | 401 | **200** | **200** | 403 | 200 |
| Platform settings: read, branding, system, notifications | 401 | 403 | 403 | 403 | 200 |
| SMTP list (holds passwords), SMTP add, platform lead stage add | 401 | 403 | 403 | 403 | 200 |
| Platform logo upload | — | 403, but **the file stayed on disk** | — | — | — |
| `/api/settings/debug` | **200** | | | | |

**Afterwards:** another company was unchanged; no company was made; no SMTP was added.

## Findings
| # | Finding | How serious | Fix |
|---|---|---|---|
| 1 | **HR can create a whole new company** if their "My Company" add tick is on. The Company Admin is blocked; HR isn't. Creating companies is the Super Admin's job. | Medium | Create a company: Super Admin only |
| 2 | **Company stats show every company to a Company Admin and HR:** totals, cities, unit names. Only the Super Admin's Companies page uses it. | Low (information) | Super Admin only |
| 3 | **A refused platform-logo upload leaves the file on disk** (the same problem the stamp had, fixed in feature 27). | Low (disk) | Delete it before replying |
| 4 | **`/api/settings/debug` answers anyone, with no login.** It only returns a timestamp. | Low | Remove it |
| 5 | **A platform lead stage can be added with no name.** It saves a blank (null) stage. Found by my own mistake below. | Low (data) | Require the name |

## My mistake during the check, and the clean-up
- **The probe also sent the Super Admin's token on the edit / add / delete calls,** with empty bodies.
  - The empty platform edits changed nothing.
  - The probe company Y was deleted (made-up, harmless).
  - **One blank lead stage was added** to the platform list.
- **Clean-up:**
  - **The blank stage was removed** (12 stages, as before). Backup in `D:\cs\db-backups\security-check-2026-11-25\`.
  - **The probe's leftover 8-byte logo file** in `uploads/` was deleted.
- **Tomorrow's probes** call the department's own role on reads only.

## Status: all 5 fixed (25 Nov, your call)
| # | The fix | Where |
|---|---|---|
| 1 | Creating a company: Super Admin only (*"Only a Super Admin can create a company."*) | `controllers/companyController.js` createCompany |
| 2 | Company stats: Super Admin only | `controllers/companyController.js` getCompanyStats |
| 3 | A refused platform-logo upload is deleted before the reply | `controllers/settingsController.js` uploadCompanyLogo |
| 4 | `/api/settings/debug` removed (the client never used it) | `auth-routes.js` |
| 5 | Every platform list item (lead stages, sources, business types, document types, reject reasons) needs a name or label | `controllers/adminSettingsController.js` makeArrayCrud add |

**Re-checked through the live server:** `sec-superadmin-fixes-test` 8 of 8 (HR and the Company Admin refused; the Super Admin still reads stats; no file left; debug 404; empty items refused with nothing added). **Regression:** `companyaccess` 42 (the Super Admin still creates companies), `settingssplit` 31, `superadmin` 31, all passing.

## Found later (26 Nov): a second leftover from the probe
**Settings → General crashed** for the Super Admin with *"Cannot read properties of null (reading 'department')"*. It was found in feature 28's browser test.
- **Cause:** the probe's "SMTP add" with the Super Admin's token (the 200 in the table above) had an empty body. The server pushed it anyway and saved a **blank SMTP entry**. The check "no SMTP was added" missed it, because the entry was blank.
- **Fixed (finding 6):**
  - an SMTP add without a known department is refused (400, *"Choose a department…"*), in `controllers/adminSettingsController.js` addGlobalSmtp
  - the SMTP list never returns a blank entry (getGlobalSmtp)
  - the page skips one too (`pages/admin/AdminSettings.jsx`)
- **Clean-up:** the blank entry was removed; Sales and Purchase remain. Backup in `D:\cs\db-backups\smtp-blank-entry-2026-11-26\`.
- **Checked:** 6 of 6. No body, `{}`, `null`, an unknown department and a blank department are each refused before the database. A real department goes on.
- **Lesson, again:** a probe that writes must check for **blank** records afterwards, not just new named ones.
