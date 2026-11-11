# Vendor documents: required set, verification and the type list

*Logic doc, 2026-10-28 (client meeting, Vendor Master change 4). Doc → plan → build.*

## 1. The problem

1. **Which documents a vendor must have, and which the Company Admin must verify, is fixed in
   code.** `validateForSubmission` insists on a PAN Card and a Cancelled Cheque / Bank Proof
   (and a GST Certificate when a GSTIN is entered). The approval page has four fixed ticks
   (GSTIN, PAN, bank, "documents genuine and in date"). Other companies can't ask for more
   (MSME, ISO …) or less.
2. **The type list is fixed in code** (nine types): `Supplier.documents.docType` is an enum,
   mirrored in the frontend.
3. **Documents can only be uploaded after the vendor exists**, from the edit form. A fresh
   create has no way to attach them; Purchase has to save, then open Edit.

## 2. What the Company Admin controls

One new card on **Purchase & Vendor Approval → Settings**: **Vendor documents**. A list of every
document type, each with one choice:

| Choice | Meaning |
|---|---|
| **Not required** | Can be uploaded; a vendor can be submitted and approved without it. |
| **Required** | A vendor can't be **submitted** for approval without it. |
| **Required and verified** | As Required, **and** the Company Admin must tick "checked" for it before approving. |

**The nine current types are permanent.** They can't be renamed or deleted; only their choice
can be changed. **The Company Admin can add types of their own**, rename them and delete them.

**Starting choices** (what the system does today, so nothing changes until the admin changes it):

| Type | Starts as |
|---|---|
| PAN Card | Required and verified |
| GST Certificate | Required and verified — **only when the vendor has a GSTIN** (kept as today; a vendor with no GSTIN has no certificate) |
| Cancelled Cheque / Bank Proof | Required and verified |
| MSME/Udyam, Company Registration, ISO/Quality, Authorization/Dealership, Product Certificate, Other | Not required |

A type the admin adds starts as **Not required**.

**Other** (2026-10-29, your correction): it means "an extra document with no title of its own". It is
always offered when uploading (last in the list) but is **outside this setting** — never required,
never ticked, not shown on the settings card, and a type of the admin's own can't be called "Other".

### Rules on the list
- A name can't repeat another (any case), built-in or custom.
- **Renaming a custom type** renames it on the documents already uploaded (so "required"
  keeps matching).
- **Deleting a custom type** is allowed; documents already uploaded keep showing the old name
  and it's no longer offered. **A type that's Required or Required-and-verified can't be
  deleted** — make it Not required first.
- Only the Company Admin edits this. Purchase reads the list (to pick a type) but can't change
  it.

## 3. Where the setting is used

1. **Submit for approval** (Purchase): the "still missing" list gets one line per required
   type the vendor lacks, e.g. "MSME/Udyam Certificate document". The other checks (PAN number,
   bank details …) are unchanged.
2. **Approval page** (Company Admin): one tick **per Required-and-verified type the vendor has**,
   instead of the four fixed ticks. Wording for the three built-ins stays as today ("GSTIN
   checked against the GST certificate", "PAN checked against the PAN card", "Bank details
   checked against the cancelled cheque / bank proof"); any other type reads "<Type> —
   genuine and in date". **Approve** stays disabled until every tick is on. With no verified
   types there are no ticks.
   - The old general tick "Documents are genuine and in date" goes: each document's own tick
     covers it.
3. **When approving, the server checks again:** every verified type the vendor has is ticked;
   and a required type the vendor lacks (the admin added a rule while the vendor was waiting)
   **blocks the approval** with "<Type> is missing — reject it so Purchase can add it".
4. **What's recorded on the vendor:** `verification.checkedDocuments` (the type names ticked).
   The old four flags are still filled for the built-ins (GST / PAN / bank → their type ticked;
   `documentsVerified` → all ticks on) so anything that reads them keeps working.
5. **Uploading a document** accepts any type on the company's list (built-in + custom). A
   document of a type since deleted stays on the vendor.

Vendors **already approved are not affected**. The rules apply from the next submission.

## 4. Documents without editing the vendor (UI)

Same pattern as Products & Services (client design change D2): a **separate dialog**, not the
edit form.

- A **Documents** button on the vendor card (next to Products & Services), with the count.
- After **creating** a vendor, the flow is: **Documents dialog** (Step 2) → **Products &
  Services dialog** (Step 3), each with "Later". The card buttons reopen them any time.
- The dialog shows the **needed-for-approval list** from the setting ("PAN Card ✓ · GST
  Certificate — missing · Cancelled cheque ✓") above the upload form, so Purchase sees what's
  still needed.
- Uploading itself is unchanged: its own endpoint, saves immediately. The edit form keeps its
  Documents section as is.

## 5. Worked examples

1. **Today's company, nothing changed:** a new vendor with a GSTIN, a PAN card and a bank
   cheque but no GST certificate → "GST Certificate document (a GSTIN is entered)" is missing,
   as now. Approval page shows three ticks (GST, PAN, bank), not four.
2. **Admin sets MSME/Udyam to Required and verified:** a new vendor can't be submitted without
   it; the approval page gets a fourth tick "MSME/Udyam Certificate — genuine and in date".
3. **Admin adds "Insurance Certificate" (Required):** it appears in the document-type list when
   Purchase uploads; a vendor without it is blocked at submit. An already-approved vendor is
   not touched.
4. **Admin sets PAN Card to Not required:** a vendor can be submitted without it; the PAN tick
   disappears from the approval page.
5. **Admin renames "Insurance Certificate" to "Insurance Policy":** the vendors' uploaded
   documents show the new name.
6. **Admin tries to delete "Insurance Certificate" while it's Required:** refused — make it Not
   required first. After that, delete works; old uploads keep the old name.
7. **A vendor is waiting for approval, and the admin makes Product Certificate required:** the
   admin's approve is refused until Purchase adds one ("Product Certificate is missing —
   reject it so Purchase can add it").

## 6. Not changed
- Document expiry reminders, deleting a document, file storage and the approval lifecycle
  (Draft → Pending → Approved / Rejected, suspend, blacklist).
- The other submission checks (PAN number, phone, email, address, bank, risk class,
  conflict-of-interest, products or services).
- Entity Type list and the Status removal (§57).
