# Feature 28: Super Admin Settings split (logic and decisions)

*24 November 2026. The client wants Super Admin → Settings (`/admin/settings`) tidied. You agreed to my suggestions, with two points of your own.*

## What the page holds today
| Section | What it really is |
|---|---|
| **Company** (logo, name, GST, email, phone, address) | one platform-wide record from the single-company days. Only the Super Admin can read it; it feeds **the Super Admin's own top-bar logo and name**. Every other user's screens use their own company's details. |
| **General → SMTP** | the mailboxes the system sends from (one per department, with passwords), shared by every company |
| **General → Dispatch → Manage Checklist** | the packing checklist on Packaging Jobs: **one list for every company** |
| **General → HRMS → Upload Document Setting** | which documents employees must upload: **one list for every company** |
| **General → HRMS → Role Setting** | the custom roles in Add User / Give Login: **one list for every company**. Its writes are open to HR-Admins and Company Admins, so **one company's HR could rename or delete a custom role for every company**. |
| **General → Other → Database Backup / Restore** | the whole database: every company |
| **API** (IndiaMART, Acefone, Website, Google Ads, Facebook, WhatsApp) | set up once for the group; each lead is copied to every company chosen for that channel |

## Decisions (24 Nov)
1. **Company → renamed "Platform Branding"** (your point: the Super Admin needs a logo too). It's the Super Admin's own logo and name, for the top bar.
   - It keeps **the logo and the platform name**.
   - The GST / email / phone / address fields go from the page, because they belong to companies (on My Company). Their saved values stay in the database.
2. **These move to the Company Admin, per company:**
   - **Dispatch → Manage Checklist**
   - **HRMS → Upload Document Setting**
   - **HRMS → custom roles** (the built-in roles stay fixed and shared)
3. **These stay with the Super Admin:** SMTP, Database Backup / Restore, API.
4. **Nothing that reads these lists may break** (your worry). See "Every place that reads them" below.

## Every place that reads them, and how it keeps working
| List | Read by | After the move |
|---|---|---|
| Dispatch checklist | Packaging Jobs page (`GET /api/admin-settings` → `dispatchChecklist`) | the same address and the same shape; the list is the **packer's own company's** |
| | Completing packing (`completePacking`, server) checks every item is ticked | checks against **the job's company's** list |
| | Saved answers on each packaging job are keyed by **the item's id** | the per-company copies **keep the same ids**, so jobs ticked before the move still match |
| HRMS document types | Add User, Document Upload (employee), Document Verification (HR): `GET /api/admin-settings/hrms-document-types` | the same address and shape; the **caller's company's** list |
| | Uploaded documents are saved with **the type's key** | the copies **keep the same keys**, so uploaded documents still match their type |
| Roles | Add User and Give Login: `GET /api/admin-settings/roles` | the same address and shape: **the built-in roles + the caller's company's custom roles** |
| | A user's role is saved as **its name** on the user | unchanged; existing users keep their role names |

**The safety nets:**
- **A one-time copy:** at server start, the platform's current lists are copied into each company, keeping every id and key. So each company starts with exactly what it uses today.
- **A fallback:** a company with no list of its own is given the platform list, so nothing is ever empty.
- **No screen or route changes its address or response shape.** Only the server's source changes.

## Who may change them
- **Dispatch checklist and HRMS document types:** the company's **Company Admin**.
- **Custom roles:** the **Company Admin and HR-Admin** of that company. HR-Admins could already change roles, so they keep that, but only for their own company now.
- **The Super Admin:** the three sections leave the Super Admin's page.
- **Built-in roles:** can't be renamed or deleted, as today.
