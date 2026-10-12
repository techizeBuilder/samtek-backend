# What changed — Procurement v2 rebuild

Changes made while rebuilding Purchase against the client's blueprint (plan:
`procurement-workflow-2026-10.md`, in this folder). 5 changes so far, built and checked; see each
change's status in the table at the end.

---

## 1. Vendor Master — Payment Terms and GST Rate removed (2026-10-08)

**Where:** Accounts → Purchases → Vendor Master (Add / Edit Vendor, and the vendor cards).

**How it worked before:** the vendor form had a "Payment Terms & GST" section: Advance %,
Balance %, Credit Days, Credit Limit, GST Rate and Payment Notes. Each vendor card also showed its
GST %. These were fixed per vendor and applied to every order from that vendor.

**How it works now:** that section is now just **Credit Limit**. Advance %, Balance %, Credit
Days, Payment Notes and GST Rate are gone from the form, and the card shows only the Credit Limit.

**Why:** payment terms and GST are decided per order, not once per vendor. The same vendor can
agree to a different advance or credit period on different orders, and GST depends on what's
being bought. So they move to **PO creation time**, and will be entered when a PO is made. That
part is built in the **PO rework**, not yet. This follows the same logic as Charges, which was
taken off Vendor Master on 2026-10-07.

**Credit Limit stays on the vendor:** it's the maximum amount this vendor can be owed at once
across all orders. That's a vendor-wide cap, not a per-order term. The "credit exposure" warning
when creating a PO still uses it.

**Good to know until the PO rework is built:**
- **Vendors that already had these values keep them**, and the system still uses them:
  - GST on new POs
  - the invoice due date (Credit Days)
  - the "recommended advance" hint on Vendor Payments
  Nobody can change them anymore, though.
- **A vendor created from now on has none of these values.** POs for that vendor get **no GST
  (0)**, and their invoice is due in **30 days** (the old fallback). This is expected and fixed
  by the PO rework.
- Nothing was deleted from the database.

**Technical notes:**
- `VendorMaster.jsx`: the "Payment Terms & GST" form section is reduced to the Credit Limit input
  (renamed "Credit Limit"). The `gstRate` display on the vendor card is removed.
- **Backend not touched, on purpose.** These all stay as they are until the PO rework replaces
  them:
  - the `Supplier.js` fields (`paymentAdvancePercent`, `paymentBalancePercent`, `creditDays`,
    `paymentNotes`, `gstRate`)
  - their readers: `purchaseController.js` `createPurchase` (GST from `supplierDoc.gstRate`),
    `purchaseInvoiceController.js` `createAutoPurchaseInvoice` (due date from `creditDays`) and
    `getVendorOutstanding` (`paymentAdvancePercent`/`creditDays` for the Vendor Payments hint)
  - `ByVendorTab.jsx` `previewGst` (client preview from `vendor.gstRate`)
- The form sends only the fields it shows, and `updateSupplier` updates only what it receives, so
  editing a vendor never clears its existing values.

---

## 2. Vendor Master v2 — full vendor profile, documents, and Company Admin approval (2026-10-08)

**Where:**
- Accounts → Purchases → **Vendor Master** (Purchase's side)
- Company Admin → **Purchase & Vendor Approval** (new page, the approver's side)

**How it worked before:**
- Creating a vendor made it usable straight away — it could be quoted and given a PO the same
  minute. Nobody checked it.
- The form had basic contact, GST/PAN, one address and bank details only.
- No documents could be attached.
- The only status was Active / Inactive. A vendor could not be suspended or blacklisted with a
  reason, and there was no record of who changed what.

**How it works now:**

**1. A new vendor starts as a Draft and can't be used yet.** Purchase fills in the vendor and
adds Products/Services. The form now also has:
- trade name, CIN, MSME/Udyam and IEC numbers
- contact designation, WhatsApp, an alternate contact
- **three addresses** (Registered, Billing, Dispatch/Factory — the last two "same as registered"
  unless unticked)
- business type (Manufacturer / Trader / Service Provider), OEM or authorized distributor,
  capacity, locations served
- quality system, whether they give inspection and material test certificates
- a **risk class** (Low / Medium / High)
- a **conflict-of-interest** answer (is the vendor related to anyone in our company?)

**2. Documents.** In Edit, Purchase uploads the vendor's documents: GST certificate, PAN card,
cancelled cheque, MSME, ISO, etc. Each can have a document number and an **expiry date**.
Purchase and the Company Admin get a reminder 30 days before a document expires, and again on the
day.

**3. Submit for Approval.** When the vendor is ready, Purchase clicks "Submit for Approval" on the
vendor card. If something is missing, it shows the exact list. Needed:
- PAN, phone, email, registered city/state/pincode, full bank details
- risk class, the conflict-of-interest answer
- at least one Product or Service
- PAN card + cancelled cheque documents, and a GST certificate if a GSTIN is entered

Once submitted, the vendor is locked (read-only) until the Company Admin decides. Purchase can
"Withdraw" it to make changes.

**4. The Company Admin approves.** The new **Purchase & Vendor Approval** page has four tabs:
- **New Vendors:** the full vendor details and documents, and a verification checklist (GSTIN
  matches the certificate, PAN matches the card, bank details match the cheque, documents are
  genuine and in date). Every box must be ticked to approve. The Company Admin can adjust the
  risk class. Rejecting needs a reason; Purchase sees it on the vendor, fixes it, and submits again.
- **Vendor Changes:** see point 5.
- **Suspend / Blacklist:** see point 6.
- **Watchlist:** see point 7.

This follows the client decision that every approval the blueprint gives to the Purchase
Head / Manager / Management goes to the Company Admin, on this one page. Later purchase approvals
(PR, vendor selection / PO) will be added here as more tabs. Nobody can approve a request they
raised themselves.

**5. Only approved vendors can be used.** Only an **Approved** and Active vendor shows up for
quoting (By Item), for batching into a PO (By Vendor), in the old RFQ lists, and when choosing a
vendor for a QC exchange. The server also refuses to create a quote or a PO for any other vendor,
for example one suspended after it was quoted. **Invoices, payments and returns still work for
every vendor:** money already owed to a suspended vendor still has to be paid.

**6. Changing an approved vendor's legal name, GSTIN, PAN or bank details needs approval.**
Purchase edits and saves as usual, but those changes don't apply straight away:
- they go to the Company Admin's **Vendor Changes** tab as before → after
- the **old values stay in use** until the change is approved; the form shows the proposed values
  with a "waiting for approval" note
- changing a field back to its current value withdraws that part of the request

This protects against changing a vendor's bank account to divert payments (blueprint §14). Every
other field saves directly.

**7. Suspend, blacklist, reinstate.** From the vendor card, Purchase can request **Suspension** or
**Blacklisting**, with a reason, evidence files (required) and an optional review date. For a
suspended or blacklisted vendor, Purchase can request **Reinstatement**, with a reason. The
Company Admin approves these on the Suspend / Blacklist tab. A suspended or blacklisted vendor
can't be quoted or ordered from until reinstated.

**8. Probationary and Watchlist, from the existing vendor rating.** An approved vendor shows as:
- **Probationary** until it has 3 POs with a received delivery
- **Watchlist** if its rating (the existing on-time-delivery + QC score on the Vendor Ratings
  tab) is below 3.0 over at least 5 events — these vendors are listed on the Company Admin's
  Watchlist tab, which has a direct "Suspend" button
- **Active** otherwise

Nothing happens to a vendor automatically. Reworking the rating to the client's weighted formula
is a separate, later task.

**9. History.** Every action — created, edited, submitted, approved, rejected, document added,
change approved, suspended — is recorded on the vendor with who did it and when.

**10. Delete.** Only a vendor that was never approved (Draft/Rejected) and has no POs can be
deleted. An approved vendor is suspended or blacklisted instead, so its history stays.

**Not on Vendor Master, on purpose:** none of the "commercial terms" in the client's document go
on the vendor — freight terms, Incoterm, quote validity, tax applicability, and per-item MOQ /
lead time / warranty. Like payment terms and GST (change 1), these are decided on each quote or
PO. Price history per item already comes from real POs (Vendor Ratings tab).

**Existing vendors:** the 4 vendors that already existed (2 companies) were marked **Approved**
automatically ("grandfathered"), since they were already being quoted and ordered from. Two show
as Active and two as Probationary (no received POs yet).

**Good to know:**
- Company Admin users see the new page in their sidebar straight away (gated by role, same as Lead
  & Quotation Settings).
- If a company has no Company Admin yet, a Super Admin can review instead.
- The rating lookup behind the stage badge runs per vendor, so Vendor Master may load a little
  slower with many vendors. It's only done on Vendor Master and the Watchlist tab, not in vendor
  pickers.

**Technical notes:**
- **Models:**
  - `Supplier.js` gains the profile fields, `documents[]`, `approvalStatus` (Draft / Pending
    Approval / Approved / Rejected / Suspended / Blacklisted), `approvedBy/At`,
    `rejectionReason`, `restriction`, `verification`, `createdBy/updatedBy` and `activity[]`.
    All additive.
  - New `VendorApprovalRequest.js` (NewVendor / DetailsChange / Suspend / Blacklist /
    Reinstate), with a partial unique index of one pending request per vendor + type.
- **Service:** new `services/vendorApprovalService.js` — `ELIGIBLE_VENDOR_FILTER`, the sensitive
  fields, `validateForSubmission`, `getVendorStanding` (reuses `computeVendorRating`),
  `applyApprovedRequest`, notifications, and `runVendorDocumentExpirySweep` (cron, daily 9:15 AM,
  `index.js`).
- **`supplierController.js`:**
  - create forces Draft and strips server-controlled fields
  - update routes legal name / GSTIN / PAN / bank changes on an approved vendor into a
    DetailsChange request, refuses edits while Pending, and logs activity
  - `getSuppliers` gains `approvalStatus`, `eligible` and `withStanding`
  - delete is limited to Draft/Rejected with no PO
  - Excel import can't change an approved vendor's legal name
  - new submit / withdraw / document upload-delete / status-request handlers (routes in
    `supplierRoutes.js`, uploads via new `middleware/vendorDocumentUpload.js` to
    `uploads/vendor-documents/`)
- **New `vendorApprovalController.js` + `vendorApprovalRoutes.js`** (`/api/vendor-approvals`):
  list, review (Company Admin / Super Admin), cancel, watchlist, suspend-from-watchlist.
- **Eligibility gate** added to `itemQuoteGroupController.js`, `purchaseQuoteController.js`,
  `purchaseController.js` `createPurchase`, `rfqController.js` and
  `purchaseExchangeController.js`.
- **Frontend:**
  - `VendorMaster.jsx` gets the new sections, status chips, badges, notices and lock
  - new `components/accounts/vendor/` (`VendorDocumentsSection`, `VendorStatusActions`,
    `vendorUi`)
  - new `pages/hrms/CompanyAdmin/PurchaseVendorApprovals.jsx` (route + Company Admin sidebar item)
  - `ByVendorTab.jsx` asks for `eligible=true` vendors only
- **Migration:** `scripts/backfillSupplierApprovalStatus.js` — run on the real database: 4 found,
  4 updated, 0 left.
- **Checks:** `node --check` + a real import of every touched backend file; a no-database test of
  the change-detection and submission rules; a read-only run of the stage calculation on the real
  data; `esbuild` bundle of every touched frontend file and the whole `App.jsx`. **Not yet clicked
  through in the browser.**

---

## 3. Creating a vendor — Products & Services are now a truly separate step (2026-10-08)

**Where:** Accounts → Purchases → Vendor Master.

**What the client asked for (design change D2):** creating a vendor is two separate steps.
- **Step 1 — Create:** only the vendor's own information. No Product/Service picking.
- **Step 2 — Assign:** pick Products and Services separately, whenever — right after creating, or
  days later.

**How it worked before:**
- Create and Edit were the same long form.
- After Create, that same form reopened in Edit mode with the Products & Services picker sitting in
  the middle of the vendor's details.
- The picker was hidden while creating, but it still behaved like one form: one Save button for
  details and products together.

**How it works now:**
- **Step 1 — the vendor form (Add / Edit)** holds the vendor's details only: identity,
  registration, contact, addresses, business profile, quality and risk, conflict of interest, bank,
  credit limit, plus documents in Edit. The picker is gone from it; a short note points to Step 2.
- **Step 2 — "Products & Services"** is its own dialog with its own Save. It opens from a new
  button on every vendor card, which shows the counts, e.g. "Products & Services (3 / 1)".
- **Right after creating a vendor**, the details form closes and Step 2 opens on its own
  ("Step 2 — Products & Services"). Purchase can pick now, or click **Later** and come back any
  time from the card.
- While a vendor is waiting for Company Admin approval, Step 2 opens read-only, same as the
  details form.
- **Saving the vendor form never touches Products & Services, and saving Products & Services never
  touches the details.** The vendor's history shows "Products & Services updated" for Step 2
  saves.
- **"+N more" on a vendor card is now clickable.** The card shows only the first 4 products or
  services; clicking "+N more" opens a read-only list of everything the vendor supplies:
  - products with code and source; an item that has since been discontinued or made
    non-purchasable is still listed, so the count matches
  - services with where they're Out Source in the BOMs
  - a search box when the list is long
  - an "Edit Products & Services" button that jumps to Step 2

  New `components/accounts/vendor/VendorSuppliesDialog.jsx`.

**Technical notes:**
- New `components/accounts/vendor/VendorCoverageDialog.jsx` — the picker moved out of
  `VendorMaster.jsx` unchanged (Inventory / Product Master / Motor Master source and category
  filters, search, both picked lists always visible). It saves with
  `PUT /api/suppliers/:id { suppliedItems, services }` only.
- `VendorMaster.jsx`:
  - the vendor form no longer sends `suppliedItems`/`services`; the server already leaves them
    untouched when absent
  - the old coverage state was removed; `openCoverage` drives the new dialog
  - create's success now closes the form and opens Step 2 instead of reopening the form in Edit
- `supplierController.js` `updateSupplier` labels a Products-&-Services-only save in the history.
  `vendorApprovalService.js`'s "missing" message points to the new button.
- Checked with `node --check` and an `esbuild` bundle of the touched files and the whole app. Not
  yet tried in the browser.

---

## 4. Vendor documents — no orphaned files, and "expires today" fixed (2026-10-08)

**Where:** Vendor Master → Edit → Documents (and the Company Admin's view of them).

**What was wrong**, found while checking that document data doesn't leave anything behind:
1. **Deleting a document only removed the record.** The file stayed on the server forever.
2. **A refused upload still left its file behind.** The file is written to disk *before* the
   server checks the request. So when an upload was refused, the file stayed with nothing pointing
   at it. Examples: the vendor is waiting for approval, the type or date is wrong, the save failed.
3. **Suspension/blacklist evidence had the same problem** when the request was refused (no
   reason, wrong vendor status, a request already pending).
4. **Deleting a Draft vendor left all its files** (documents and evidence) on the server.
5. **A document expiring today showed as "Expired".** An expiry date is a calendar day, but it was
   compared as a timestamp (midnight UTC = 5:30 AM in India). So from the morning of its last
   valid day it read as already expired. The daily reminder had the same mistake.

**How it works now:**
- Removing a document deletes its file from the server too.
- Any refused or failed upload or request throws away the file it just received. Evidence that
  belongs to a request that *was* created always stays, even if that request is later rejected:
  it's part of the record.
- Deleting a vendor deletes all of its files.
- Expiry dates are compared by day. A document is valid **through** its expiry date: it shows
  "Expires today" on that day, and "Expired" from the next day. The reminder says "expires today" /
  "expired on …" the same way. Review dates are shown the same day-based way.
- **Close / Cancel on the vendor form:** documents are not part of the form. Each upload or
  removal is saved straight away, so cancelling the form doesn't undo it, and reopening shows them.
  This is now stated right above the document list. Opening the form also reloads the vendor from
  the server, so a reopen can never show an out-of-date document list.

**Checked on 2026-10-08:** at that point the database had 3 vendor documents and the folder had
exactly those 3 files — nothing orphaned yet.

**Technical notes:**
- `middleware/vendorDocumentUpload.js` gains two helpers:
  - `removeVendorUpload(fileUrl)` — deletes a stored file by its URL. It only ever touches files
    inside `uploads/vendor-documents/`, and a missing file is fine.
  - `discardRequestUploads(req)` — throws away whatever this request just uploaded.
- `supplierController.js`:
  - `uploadVendorDocument` and `requestStatusChange` discard on every refusal or failure;
    `requestStatusChange` only does so while no request record exists yet
  - `deleteVendorDocument` deletes the file after the record is saved
  - `deleteSupplier` deletes every document and evidence file
  - Reinstate requests ignore attached files
- `vendorApprovalService.js` `runVendorDocumentExpirySweep` compares `YYYY-MM-DD` day keys.
  `vendorUi.js` gains `formatDay`, a day-based `expiryState` (adds `'today'`) and a shared
  `expiryBadge`, used by Vendor Master and the Company Admin page.
- `VendorMaster.jsx` `openEdit` re-reads the vendor (`GET /api/suppliers/:id`).
- **Tested:**
  - the cleanup helpers on disk with throwaway files: delete by URL works, a path outside the
    folder is refused, a missing file is fine, request uploads are discarded; the 3 real files
    were untouched
  - the day comparison: 7 Oct → expired, 8 Oct → expires today, 20 Oct → future, run on
    8 Oct IST
  - `node --check` and esbuild bundles pass
  - not yet clicked through in the browser

---

## 5. Purchase & Outsource — RFQ/PO page, PO-time GST / charges / terms, PO approval (2026-10-08)

**Where:**
- Accounts → Purchases → Purchase & Outsource → **Purchase**: tabs are now **PRs | RFQ/PO |
  Purchase Orders | Vendor Ratings | Settings**.
- Company Admin → **Purchase & Vendor Approval**: new tabs **PO Approvals**, **Low Vendor
  Coverage**, **Settings**.

**How it worked before:**
- Buying took two separate tabs. **By Item** was where you quoted each item; you started with no
  requests selected and ticked them by hand. **By Vendor** was where you batched a vendor's quotes
  into a PO.
- At PO creation, GST came from the vendor's own GST Rate. Charges were added automatically from
  the vendor's default charges. Payment terms were the vendor's defaults.
- Every PO was created straight away, whatever its value.

**How it works now:**

1. **One RFQ/PO page.**
   - **Left side — what needs buying.** One card per item, combining its pending requests.
     **Every pending request is selected automatically** the first time an item appears. You can
     still hold one back with "Select requests"; a request that arrives later shows as "N new — not
     selected", so a deliberate hold-back is never undone. Each card shows the combined quantity
     (editable) and a warning when the item has fewer approved vendors than the company minimum.
     Toolbar:
     - **Select all / Clear**
     - **Search** and **filters** (Source → Category, like Vendor Master's product picker, plus
       priority and origin). They never hide anything: matching items move to the top and are
       highlighted.
   - **Right side — who can supply it.** Approved, active vendors linked to the items:
     - Ranked by how many items they cover, with a **"k/N items"** badge. With nothing ticked on
       the left, N = every listed item (vendors are ranked even on fresh load). Tick items to focus
       on just those.
     - Within the same coverage, sort by lowest quoted total, best rating, fastest delivery, or
       name.
     - Each vendor card lists the items it covers. Each item shows that vendor's quotation
       (price, delivery, GST included or not, Cheapest / Fastest badges) or a **"Vendor
       Quotation"** button to get one (Email link or Manual, as before).
     - Tick the quoted items and click **"Review & create PO"**: one PO per vendor, as before.
   - **Layout:** the page scrolls as one (no separate scroll boxes). The item list can be collapsed
     to a thin rail (the panel icon at its top) so the vendor side gets the full width; the page
     remembers this in the same browser.
2. **The review step is where per-order terms are entered:**
   - **GST** — a % for each item line, with a "GST % for all lines" box to fill them all at once.
     A quote that already includes GST adds nothing on top.
   - **Charges** — on the whole PO. Pick a name (Freight, Packing…) from the template or type one;
     enter the ₹ amount; the GST % comes pre-filled from the template and can be changed.
   - **Payment terms** — Advance % and Credit Days are always there (Credit Days sets the
     invoice's due date). Any other terms from the template (e.g. "Delivery", "Inspection") take
     free text and are printed on the PO.
   - **Transport** — "Vendor delivers" or "We pick up". There's no automatic rule any more: for a
     pickup you just don't add freight.
   - The **final total** (goods + item GST + charges + charge GST) is shown before you confirm,
     with the vendor's credit-limit warning.
3. **PO approval by the Company Admin.**
   - If the final total is **above** the Company Admin's PO approval limit, the button reads
     **"Send for approval"**. The PO is saved as **Pending Approval** and doesn't count as an order
     yet: it's not sent to the vendor, no invoice is made, Store and Dispatch don't see it, and its
     items are locked on RFQ/PO (can't be re-quoted or put on another PO).
   - The Company Admin sees it on the **PO Approvals** tab: lines with GST, charges, totals, terms
     and transport.
     - **Approve** → it becomes a normal PO: requests linked, invoice created, Store sees it.
     - **Reject** (reason required) → it's marked Rejected, the reason shows on the PO, and its
       items unlock so Purchase can pick another vendor or price.
   - Nobody can approve a PO they created themselves. At or below the limit (or with no limit
     set), the PO is created straight away as before.
4. **Company Admin settings** (new Settings tab):
   - **Minimum vendors per item** — one number for all items (default 3). Below it, Purchase sees a
     warning; it never blocks.
   - **PO approval threshold (₹)** — empty means no PO needs approval.
5. **Low Vendor Coverage** (Company Admin) — every purchasable item with fewer approved vendors
   than the minimum, with **all** its linked vendors and their status (so "2 linked, but 1 is still
   a Draft" is visible). Searchable, with page size 10 / 20 / 50 / 100.
6. **Purchase Settings** (new Purchase tab) — the master list of charge names (each with a default
   GST %) and payment-term names used when creating a PO. Editing needs the new **"Purchase Settings
   (PO templates)"** permission, which the Company Admin grants on Roles & Permissions.
7. **Purchase Orders tab** — Active (now including POs waiting for approval) and History (now
   including rejected ones, with the reason). Each PO shows its line GST, charges and payment
   terms.
8. **Vendor Payments** — the "recommended advance" hint now uses the PO's own Advance %. Invoice
   due dates come from the PO's Credit Days (30 if none was set).
9. **Old vendor data dropped.** The vendor-level payment terms, GST rate and automatic charges are
   gone: removed from the system and from the database (3 vendors had them). Old POs keep their
   own figures.

**Good to know:**
- The "Quote" button on the PRs tab is now **"Vendor Quotation"**. It opens RFQ/PO with that
  item ticked.
- Quotes no longer carry automatic charges. All charges are typed on the PO.
- The old By Item and By Vendor tabs are gone. Everything they did is on RFQ/PO and Purchase
  Orders.
- The legacy RFQ "select winner" path (no screen uses it since the RFQ pages were retired) still
  creates POs the old way, without the threshold. Worth removing when that backend is cleaned up.

**Technical notes:**
- **New:**
  - `models/PurchaseSettings.js`
  - `controllers/purchaseSettingsController.js` + `routes/purchaseSettingsRoutes.js`
    (`/api/purchase-settings`: get, approval-rules, templates, low-coverage-items)
  - `controllers/poApprovalController.js` + `routes/poApprovalRoutes.js` (`/api/po-approvals`)
  - `scripts/dropVendorCommercialFields.js`
- **`models/Purchase.js`:**
  - statuses `Pending Approval` / `Rejected`
  - `charges[]`, `chargesTotal`, `chargesGstTotal`, `paymentTerms`, `approval`
  - per line: `vendorBid`, `purchaseUnit`, `purchaseUnitType`
- **`purchaseController.js`** — `createPurchase` rewritten:
  - per-line GST from the payload; charges and terms cleaned (`cleanPoCharges`,
    `cleanPaymentTerms`)
  - the threshold check
  - the new **`finalizePurchase`** (link PRs, group → Batched, reject losing bids, invoice) runs
    straight away or on approval
  - `checkPurchaseStillValid` re-checks on approval
  - `groupsHeldByPendingPO` locks items
  - `updatePurchase` / `sendPOToVendor` refuse pending / rejected POs; status healing ignores them
  - Dispatch pickups and Store's PO list exclude them
- **`itemQuoteGroupController.js`:**
  - new `autoSelectGroups` (`POST /auto-select`) and `getRfqBoard` (`GET /board`)
  - selection / quantity / quote / sync refuse a locked group
- **Charges and old vendor fields:**
  - `vendorChargesService.js` deleted; quotes save no charges
    (`purchaseQuoteController`, `itemQuoteGroupController`, `rfqController`)
  - `Supplier.js` loses the commercial fields; `supplierController` ignores them
- **`purchaseInvoiceController.js`:** due date from the PO's Credit Days; charges and their GST in
  the totals; `getVendorOutstanding` gives each invoice its PO's `advancePercent`.
- **Frontend:**
  - new `pages/accounts/purchase/rfqPo/` (`RfqPoTab`, `RfqItemList`, `RfqVendorList`,
    `rfqShared`)
  - new `components/accounts/purchase/PoReviewDialog.jsx`, `PurchaseOrdersTab.jsx`,
    `PurchaseSettingsTab.jsx`
  - Company Admin `purchaseApprovals/` (`PoApprovalsTab`, `LowVendorCoverageTab`,
    `PurchaseRulesSettingsTab`)
  - `PurchaseOrderList` shows the new fields and statuses
  - `roleModulesConfig` gets the `purchaseSettings` permission
  - `ByItemTab.jsx` / `ByVendorTab.jsx` deleted
- **Checks:**
  - `node --check` and an import of every touched backend file and route
  - real-DB read-only checks: the low-coverage list for both companies, the board (2 groups,
    2 quotes, email token not exposed)
  - the drop script: dry run, then the real run — 3 vendors cleaned, 0 left
  - no-DB tests of charge / term cleaning and the threshold (exactly at the limit → no approval;
    ₹1 above → approval)
  - esbuild of every touched frontend file and the whole app
  - **Not yet clicked through in the browser.**

---

## 6. One quotation email per vendor, PO emailed to the vendor, Company Admin sees every PO, Quote history (2026-10-08)

**Where:**
- Accounts → Purchases → Purchase & Outsource → Purchase → **RFQ/PO** (vendor cards) and
  **Purchase Orders**.
- The vendor's new public page: **`/vendor-quotation/<link>`** (from the email; no login).
- Company Admin → Purchase & Vendor Approval → **PO Approvals**.

**How it worked before:**
- An email quotation was sent **per item**. A vendor quoting for 5 items got 5 emails and filled
  5 separate pages, one price each. There was no place for their charges or payment terms.
- A new PO wasn't emailed to the vendor automatically. And with no email set up, the PO was still
  marked "Sent".
- The Company Admin only saw POs above the approval limit.
- There was no way to see all the quotes behind a PO.

**How it works now:**

1. **One email for several items.**
   - On a vendor's card on RFQ/PO, tick the items, then click **"Email quotation request (n)"**.
   - A dialog lists the items and sends **one email** for all of them, with a request number
     (QR-0001…).
   - The dialog then shows the vendor's link. If the email didn't go out, you can copy the link
     and send it on WhatsApp.
   - The link is valid for 7 days.
2. **The vendor's quotation page** lists every item in the email. The vendor fills in:
   - **for each item:** price, **GST %** (or "price already includes GST"), delivery days,
     warranty, remarks — or "Can't supply"
   - **charges on the whole order:** your template's charge names, with ₹ + GST %. The GST % is
     pre-filled from the template, can be changed, and 0 is fine. They can also **add their own
     charges**.
   - **payment terms:** Advance %, Credit days, your template's terms, and **their own terms**
   - remarks, with a running total
   - The vendor's own charge and term names stay on that quotation only; **your templates never
     change**.
   - **One submission only.** After submitting, the page shows a read-only summary.
3. **What RFQ/PO shows:**
   - **Waiting:** "Waiting for reply — QR-0003 sent 8 Oct". If the link ran out or the email failed,
     it says so in red, so you know to send again.
   - **Answered:** the price with its GST %.
   - **Item left blank by the vendor:** "Not quoted by vendor".
   - Sending a new request (or typing a new manual quote) **replaces** that vendor's earlier
     quote for the item. The old one stays in Quote history as "Replaced".
4. **Manual quotes stay per item.** The **"Vendor Quotation"** button on each row is now
   manual-only (after a call / WhatsApp), and has an optional GST % box.
5. **PO review is pre-filled from the vendor's quotation:**
   - each line's GST % from its quote
   - charges and payment terms from the vendor's latest submitted quotation request, with a note
     "Pre-filled from QR-0003…"
   - Everything stays editable. You can also add your own payment-term lines on the PO now.
6. **The PO is emailed to the vendor automatically** when it becomes a real order: created
   directly (within the limit), or approved by the Company Admin.
   - The email has every line (code, qty + unit, rate, GST, amount, deliver-by date), the charges
     with their GST, totals, payment terms, delivery address and transport.
   - Only a real send marks the PO **Sent**. If email isn't set up or fails, the PO stays
     **Draft**, and the PO says "Not emailed to the vendor yet".
   - **Purchase Orders** has a **"Send PO email" / "Resend PO email"** button on each open PO.
7. **The Company Admin sees every PO.**
   - They get a notification for every new PO: "within the ₹X limit" or "no approval limit set".
     POs above the limit already notified them.
   - On **PO Approvals**, **Approved** now lists every real PO. Each has a badge: *Approved by
     you*, *Created directly — within limit*, or *Created directly — no limit set*.
   - Pages of 10 / 20 / 50.
   - After approving, the message says whether the PO email reached the vendor.
8. **Quote history button** — every quotation for the items: all vendors, both channels, oldest
   first.
   - **What it shows:**
     - each quote's price, GST, quantity, delivery and remarks, with its status: Quoted /
       Chosen / Not chosen / Replaced / Not quoted / Waiting / Closed — no reply
     - the charges and payment terms each vendor gave in their quotation requests
     - a switch between "All vendors" and "This vendor only"
   - **Where:**
     - on each **vendor card on RFQ/PO** (before the PO; the ticked items, or all the card's
       items)
     - on each PO in **Purchase Orders**
     - on each card in the Company Admin's **PO Approvals**
9. **Charge GST** can be 0 or anything else, everywhere. A new charge name in Purchase Settings
   now starts at **0%** (was 18%).

**Good to know:**
- When an item is ordered, unanswered requests to other vendors for it close. The vendor's page
  then shows the item as "no longer needed".
- An old one-item `/vendor-bid` link from before today still works, but only while that request
  is still open. It can no longer bring back a quote that was replaced or closed.
- POs made before today don't record which quote won, so Quote history marks the PO vendor's
  latest quote as Chosen.

**Technical notes:**
- **New:**
  - `models/QuotationRequest.js`
  - `controllers/quotationRequestController.js` + `routes/quotationRequestRoutes.js`
    (`POST /api/quotation-requests`)
  - public `GET/POST /api/vendor-quotation/:token` (in `index.js`)
  - frontend `pages/VendorQuotationForm.jsx` (route `/vendor-quotation/:token`) and
    `components/accounts/purchase/QuoteHistoryDialog.jsx`
- **`models/VendorBid.js`:** `gstPercent`, `quotationRequest`; statuses `Declined`, `Superseded`.
- **`emailService.js`:** `sendQuotationRequestEmail` (one email, many items) and
  `sendPurchaseOrderEmail` (full PO). Text is HTML-escaped. With no mailer, the result is
  "not sent" (it used to report a fake success).
- **`purchaseController.js`:**
  - `sendPurchaseOrderToVendor`, called at the end of `finalizePurchase`
  - winning quotes are marked `Selected`, losing ones and still-waiting requests are marked
    `Rejected`
  - a direct PO notifies the Company Admin and records `approval.threshold`
  - `sendPOToVendor` uses the shared helper and refuses Cancelled POs
- **`itemQuoteGroupController.js`:**
  - `createQuoteForGroup` is manual-only, takes `gstPercent`, and supersedes the vendor's previous
    quote
  - the board skips Superseded quotes and carries the request summary
  - new `buildQuoteHistory` / `GET /api/item-quote-groups/quote-history?groups=…|purchase=…`
- **`poApprovalController.js`:**
  - Approved = every real PO, with `approvalMode` + pagination
  - new `GET /api/po-approvals/:id/quote-history`
- **`rfqController.submitBidByToken`** refuses any bid that isn't `Invited`.
- **Checks:**
  - `node --check` + an import of every touched backend file
  - 8 no-DB tests:
    - which items count as priced / declined / skipped
    - delivery days required
    - at least one price
    - custom-name marking
    - charge GST 0 kept
    - PO email contents + escaping
    - one email listing all items
  - real-DB read-only check of Quote history: a group, a PO with groups (chosen marked), an old PO,
    another company → not found; the board populate
  - esbuild of every touched frontend file and the whole app
  - **Not yet clicked through in the browser, and no real email sent yet.**

---

## 7. Quote validity and "Bought before" (the last-price check) (2026-10-09)

**Where:**
- Accounts → Purchases → Purchase & Outsource → Purchase → **Settings** (new "Quote rules"
  card), **RFQ/PO**, and the PO review.
- Company Admin → Purchase & Vendor Approval → **PO Approvals**.

**How it worked before:**
- A quote never expired. A price from months ago could still become a PO.
- Past prices were only on the Vendor Ratings tab. Nothing next to a quote said whether it was
  higher than what you paid last time.

**How it works now:**

1. **Quote rules in Settings.** Two numbers, editable by anyone with the "Purchase Settings"
   permission:
   - **Quote validity (days)**, default 30. They apply to every quote, old and new, as soon as you
     save.
   - **Price-rise warning (%)**, default 10.
2. **Quote validity:**
   - A quote can go on a PO for that many days after the vendor gave it.
   - **After that, it's Expired.** The vendor card shows a red "Expired 7 Nov" badge and "get a
     fresh quote". The row can't be ticked into a PO, and the server refuses it if tried. An
     expired quote doesn't count for the Cheapest / Fastest badges or the price sort.
   - **A fresh quote fixes it:** an email request or a manual "Vendor Quotation".
   - Valid quotes show "Valid till …". The manual quote form says how long a quote it saves will
     last.
   - **Vendors are told:** the quotation email and page say how long their prices are taken as
     valid.
   - **All quotes** shows "valid till" or "Expired" for each quote.
   - It's checked when the PO is created. A PO already waiting for the Company Admin isn't blocked
     because its quote expired while it waited.
3. **"Bought before" — the last-price check:**
   - **What it is:** what we actually *paid* on earlier purchases of the item, to judge whether a
     new quote is high or low.
   - **The rule (user, 2026-10-09):** only **delivered** purchases count. Each received request on
     a PO line is one delivery, at that line's rate, dated when it arrived. It's the same rule the
     Vendor Ratings tab always used, and that tab now reads the same numbers, so "last / lowest /
     average" mean the same thing everywhere.
   - **How prices are compared:** in the same purchase unit and before GST. A price that includes
     GST is taken back to its pre-GST value when the GST % is known.
   - **Vendor row on RFQ/PO:** one tag about **that vendor's own past price** for the item (user
     decision):
     - "+12% vs last bought from them ₹120/kg (5 Oct)". Amber at or above the warning %, grey
       below it, green when cheaper.
     - Before they quote: "Last bought from them ₹120/kg (5 Oct)".
     - A vendor who never delivered this item: "Not bought from them before".
     - **Clicking the tag opens "Bought before — item":**
       - every vendor's last / lowest / average / number of deliveries, cheapest first
       - this quote's % against each vendor's last price, with this vendor highlighted
       - the 20 most recent deliveries (date, vendor, PO, price)
   - **Item card (left side):** "Bought before: last ₹130/kg (sujeet, 5 Oct) · lowest ₹100 · avg
     ₹115 · 4 deliveries" (all vendors). Clicking it opens the same pop-up, or it shows "Never
     bought before".
   - **PO review:** the same tag on each line, plus a warning naming the items priced above what
     we last paid that vendor.
   - **Company Admin's PO cards:** a "Bought before" column with the same tag, comparing each line
     with that vendor's deliveries *before* that PO. A "Price up vs last bought on N lines" badge
     shows on the card.
   - **A warning only:** it never blocks a quote or a PO.
4. **Names, so the two "history" things aren't confused:**
   - **"All quotes"** (was "Quote history") — the *offers* vendors made for the items on one PO,
     before and after it's created.
   - **"Bought before"** — what we *paid* on earlier delivered purchases.
   - "Quote" always means an offer; "bought" always means a past delivered purchase.
5. **Vendor Ratings tab:**
   - **Labels:** the price columns now read "Bought before: Avg / Last" and "Lowest bought", with
     the unit and number of deliveries.
   - **Numbers:** prices are now before GST and only in one unit (the unit of the vendor's latest
     delivery). Before, an "incl. GST" price was averaged as-is, and different units were mixed
     together.

**Good to know:**
- A purchase that's ordered but not yet delivered doesn't count yet. A new price shows up in
  "Bought before" once the goods arrive.
- A quote that includes GST at an unknown rate isn't compared.

**Technical notes:**
- **New `services/quoteChecksService.js`:**
  - validity: `quoteValidUntil`, `isQuoteExpired`
  - bought before: `loadPriceSamples` (delivered only), `summarizePrices` (+ `byVendor`,
    `recent`), `vendorPriceCheck`, `exGstPrice`, `priceChangePercent`
- **`vendorRatingService.computeVendorItemPricing`** now reads `loadPriceSamples` too, and also
  returns `priceUnit` and `deliveries`.
- **`models/PurchaseSettings.js`:** `quoteValidityDays` (1–365, default 30) and
  `priceJumpWarnPercent` (default 10).
- **`purchaseSettingsController.updateQuoteRules`:** `PUT /api/purchase-settings/quote-rules`,
  under the `accounts.purchaseSettings` edit permission.
- **`itemQuoteGroupController`:**
  - the board adds `validUntil` / `isExpired` to quotes, `priceHistory` to groups, and
    `quoteRules`
  - `buildQuoteHistory` adds `validUntil` / `expired`
- **`purchaseController.createPurchase`:** every quote on the PO must still be this vendor's
  Submitted, unexpired quote (409 otherwise).
- **`poApprovalController.listPOApprovals`:** a per-line `priceCheck` (`history`,
  `comparablePrice`, `theirs`, `changePercent` vs the PO's vendor) plus `priceJumpWarnPercent`.
- **Vendor-facing:** `quotationRequestController` and `sendQuotationRequestEmail` pass the validity
  days to the vendor's page and email.
- **Frontend:**
  - new `components/accounts/purchase/PriceCheck.jsx` (`BoughtBeforeTag`, `ItemBoughtBefore`,
    `BoughtBeforeDialog`)
  - `PurchaseSettingsTab` gets the Quote rules card
  - "Quote history" renamed to "All quotes" everywhere it's shown
  - also updated: `RfqPoTab`, `RfqItemList`, `RfqVendorList`, `rfqShared`, `PoReviewDialog`,
    `QuoteHistoryDialog`, `PurchaseOrdersTab`, `PoApprovalsTab`, `VendorRatingsTab`,
    `VendorQuotationForm`
- **Checks:**
  - `node --check` + an import of every touched backend file
  - 10 no-DB tests:
    - valid-until date and the end-of-day boundary
    - only priced quotes expire
    - the pre-GST price
    - the % change
    - same-unit filtering
    - last / lowest / avg
    - excluding a PO and anything after it
    - recent deliveries
    - compared with that vendor's own last price, and a vendor who never delivered
  - the earlier 8 quotation tests still pass
  - esbuild of every touched frontend file and the whole app
  - a tsc pass for undefined names (none found)
  - **The real-database check couldn't run (the DB host timed out).** Not yet tried in the
    browser.

---

## 8. Manual quotations need evidence (2026-10-09)

**Where:** Accounts → Purchases → Purchase & Outsource → Purchase → **RFQ/PO** (vendor cards), and
**All quotes** everywhere it opens.

**How it worked before:**
- Each item row had a "Vendor Quotation" button. Purchase could type a price for any item, at
  any time, with nothing to show where it came from: no file, no channel, no date except the day
  it was typed.

**How it works now** (client blueprint §10: "Quotation evidence should be uploaded … if entered
manually, record source and date"):

1. **No price can be typed without evidence.** The per-row "Vendor Quotation" button on RFQ/PO
   is gone.
2. **On a vendor's card:** tick the items, then click **"Manual quotation (n)"**. One dialog
   holds both the evidence and the prices:
   - **Evidence:**
     - **how the vendor gave the quote:** WhatsApp, Vendor PDF / letterhead, Email (outside the
       system), Visit / written quote, or **Other**, which lets you type it
     - **the date on the evidence:** it can't be in the future or older than the quote validity.
       **Validity counts from this date.**
     - the vendor's contact person and notes (optional)
     - **files (mandatory):** 1–5 files, PDF, JPG, PNG, WEBP, DOC or DOCX, up to 10 MB each
   - **Prices for every ticked item:** rate, GST % (or "includes GST"), delivery days, warranty,
     remarks.
   - **A new price over the vendor's current quote for an item** asks for **a reason** (e.g.
     negotiated, quantity discount). The old quote stays in All quotes as "Replaced".
   - **"Save manual quotation" saves the evidence and all the prices together**, as one
     numbered record (**MQ-0001**…).
3. **More items or a new price later** → another manual quotation with its own evidence. Every
   unlock needs new proof.
4. **A phone call alone isn't evidence.** Without call recording (IVR isn't built yet), the
   vendor confirms on WhatsApp or email and that is uploaded. The dialog says so.
5. **Email quotes need no upload.** The vendor's own submission through their link is the
   evidence.
6. **All quotes shows the evidence:**
   - each quote's source: MQ-… with a 📎, or QR-…
   - the reason on a revised manual price
   - an **Evidence** section:
     - **MQ-… cards:** channel, date on the evidence, contact, notes, which items, who entered
       it, and the files to open
     - **QR-… cards:** "submitted by the vendor through their own email link on …"
   - It's the same All quotes button on RFQ/PO, Purchase Orders and the Company Admin's approval
     cards.
7. **No ghost data:**
   - the files are uploaded in the same request that saves the record
   - **any refusal** (missing field, wrong type, too big, too many files, an item already
     ordered…) deletes what was uploaded
   - a failure halfway through removes the record, the quotes and the files
   - a saved manual quotation **can't be edited or deleted** (blueprint §14: quotation history is
     immutable); a mistake is fixed by a new manual quotation, which replaces the old quotes
   - a vendor with quotes can't be deleted, so files are never left without their record

**Good to know:**
- Manual quotes entered **before today** have no evidence. All quotes marks them "no evidence
  (old)". They still work, and drop out as quote validity runs out.
- "Sync to current quantity" on a manual quote still works without new evidence (same price,
  new quantity).

**Technical notes:**
- **New:**
  - `models/ManualQuotation.js` (`MANUAL_QUOTE_CHANNELS`)
  - `middleware/quoteEvidenceUpload.js`: multer to `uploads/quote-evidence/`, a clean 400 for
    upload errors, and a discard helper
  - `controllers/manualQuotationController.js`: `createManualQuotation`, plus the pure
    `parseQuoteDate` and `readManualItems`
  - `routes/manualQuotationRoutes.js`: `POST /api/manual-quotations`. The permission check runs
    before the upload.
  - registered in `index.js`
- **`models/VendorBid.js`:** `manualQuotation`, `revisionReason`, `replacesBid`.
- **`itemQuoteGroupController`:**
  - `createQuoteForGroup` now answers 410 ("enter it from the vendor card with evidence")
  - the board and `buildQuoteHistory` populate `manualQuotation`
  - the history adds `revisionReason`
- **Frontend:**
  - `rfqShared.jsx`: `ManualQuotationDialog` replaces `GroupVendorQuoteForm`
  - `RfqVendorList`: the card action, and the chip shows MQ-…
  - `QuoteHistoryDialog`: the evidence section and reasons
  - `RfqPoTab`: help text
- **Checks:**
  - `node --check` + an import of every touched backend file
  - 11 no-DB tests:
    - quote date rules: today, an earlier day, future, invalid, older than validity
    - price rules: rate, delivery, GST range, duplicates, a reason needed only when replacing a
      quote
    - **6 real HTTP upload tests showing that every refused upload leaves no file on disk**: no
      file, bad channel, "Other" without text, wrong type, more than 5 files, over 10 MB
  - esbuild of the touched files and the whole app; no undefined names
  - **Not yet tried in the browser** (the DB is down).

---

## 9. Fabrication items: one card per size, ordered in pieces; click a quantity to change it (2026-10-09)

**Where:**
- Accounts → Purchases → Purchase & Outsource → Purchase → **RFQ/PO**.
- Store → Material Handshake → Pending Requests ("Raise Purchase Request" for a fabrication
  item).

**How it worked before:**
- A fabrication item (sheet, angle, pipe…) was one card on RFQ/PO. Its requests could mix several
  sizes, and its quantity was a kg number typed freely.
- To change any item's quantity you had to find its card on the left first.

**How it works now:**
1. **One purchase request = one size.**
   - Store can still tick several sizes in one dialog. The system raises **one request per
     size**, and the dialog says so. The same applies to staged bulk requests.
   - Editing a request into several sizes is refused.
2. **One RFQ/PO card per item + size.**
   - The card shows the size, e.g. "Size: thickness 2mm, width 1000mm, length 2000mm".
   - Each size is quoted, compared and ordered on its own, and becomes its own PO line.
   - Non-fabrication items are unchanged: one card per item.
3. **A fabrication card is ordered in pieces:**
   - "**[ 12 ] pieces → ≈ 54.3 kg (calculated)**". The kg comes from the same weight formula used
     when requests are created, and is never typed.
   - **You can order more pieces, not fewer** than the requests ask for (reducing ties into the
     open shortfall question, W9). A large total still goes to the Company Admin through the PO
     approval limit.
   - **No margin on the kg** (user decision). It's labelled "≈ … (calculated)". The real weighed
     kg and a receipt tolerance belong to the Store / Accounts phase.
   - Changing pieces changes the kg, so existing quotes show "quoted at qty … — now …" (sync a
     manual quote, or ask again).
4. **Click a quantity on the right** (on a quote line, or "No quotation yet · 20 Pieces"): the
   item list opens if it was collapsed, scrolls to that card, highlights it, and puts the cursor
   in the quantity / pieces box.
5. **Size × pieces are carried through:**
   - the quotation email and the vendor's page
   - manual quotations
   - the PO review
   - the **PO line**, which now records the ordered size × pieces, extra pieces included
   - the PO email ("size × N pcs", "(calculated weight)")
   - **Store's receive form:** pre-filled with the ordered pieces
6. **One-time migration, `scripts/splitFabricationRequestsBySize.js`** (dry run by default,
   `--apply` to write):
   - splits existing multi-size requests that aren't on a PO yet
   - swaps the item-group index from "one per item" to "one per item + size"
   - sets the size and pieces on open cards (a card holding several sizes keeps its first; the
     others get their own card on the next load)
   - **must run before using the new RFQ/PO**

**Good to know:**
- Fabrication Master / Inventory still have several sizes per item, and leftover sizes. Only
  purchase requests changed. Requests already on a PO keep their sizes as history.
- Bought before stays per item (₹/kg), shared by all its sizes.

**Technical notes:**
- **`purchaseRequestController`:** `splitFabricationLinesPerSize` (merges same-size lines, then
  works out quantity / unit per size with `resolveFabricationLines`); `createPurchaseRequest` and
  `createBulkPurchaseRequests` create one request per size; `editFabricationLines` refuses
  multiple sizes.
- **`models/ItemQuoteGroup.js`:** `sizeKey` / `sizeValues` / `pieces` / `requestedPieces`; the
  unique Open index is now `{ item, unit, sizeKey }`.
- **`itemQuoteGroupController`:**
  - `prSizeKey`, `resolveCommonSize` (one size per card), `checkPieces`, `kgForPieces`,
    `groupFabricationLines`
  - create / selection / auto-select are keyed by size
  - `PATCH /:id` takes `{ pieces }` for a size card
- **Quotes:** `quotationRequestController` and `manualQuotationController` snapshot size ×
  pieces from the card.
- **POs:** `purchaseController.createPurchase` fills the PO line's `fabricationDimensionLines`;
  `emailService` shows them on the PO email.
- **Frontend:**
  - `RfqPoTab`: card key item + size, focus → `RfqItemList` / `RfqVendorList`
  - `RfqItemList`: size, pieces box, focus highlight
  - `RfqVendorList`: `QtyLink` and size labels
  - `rfqShared` dialogs and `PoReviewDialog`: size labels
  - `LineFabricationReceiveDialog`: pre-fill from the PO line
  - `PendingRequestsTab`: text and toast
- **Checks:**
  - every touched backend file imports as an ES module
  - **8 no-DB tests**:
    - the split: several sizes, same size merged, Kilogram, Tonne, bought by piece, an unknown
      size refused
    - the size key and one size per card
    - the pieces rule (more is ok, fewer is refused, whole numbers only)
    - pieces → kg
    - the quote / PO snapshot
  - esbuild of every touched frontend file and the whole app; no undefined names
  - **The migration hasn't run yet (the DB is down). Not tried in the browser.**
  - During this build, a string-replacement slip pasted a copy of `purchaseRequestController.js`'s
    first part into the middle of the file. It was found by the module import check and removed
    exactly: the removed text was checked to match the duplicated block before writing. The
    file now parses and imports cleanly.

---

## 10. Material reservations fixed — "free stock" is now true (2026-10-09)

**Why:** gap 9 needs **Free = Stock − Reserved** on the RFQ/PO item card. An end-to-end check of
the reservation flow found several problems (below), so the flow was fixed first.

**How it works (unchanged in principle):**
- When a Production order (Machine / Child Part) or a Sub Child Part job-work order is created, it
  **reserves** its full material need. This never changes stock.
- Stock only goes down when **Store transfers** the material (Material Transfers) or a job-work
  order is sent.
- When the order is **Completed**, whatever is left of its reservation is released.

**What was wrong, and what changed:**

| # | Problem | Now |
|---|---|---|
| A | **Issued material was counted twice:** gone from stock, and still "reserved" until the order completed. | The reservation records what was **issued**. It now means "still to be issued", so free stock stays right through every transfer. |
| B | **Fabrication reservations had no size.** One size's free stock subtracted every size's claims. | Reservations carry the **size**, and free stock is worked out per size. |
| C | **An order could overwrite its own reservation** when it used two lines of the same item (e.g. two cut-groups from one sheet size). | Each **line** has its own reservation. |
| D | **Store's transfer looked only at raw stock.** | Store sees "In stock X · held for earlier orders Y · free for this order Z" on each row and in the transfer dialog. It's **warned, never blocked**, if a transfer takes stock reserved for an earlier order (your decision; physical stock can be wrong). |
| E | **Production's material list said "Available" from raw stock.** | "Available" now means available **to this order**: free after earlier orders' claims, plus what was already transferred to it. |
| F | **The sales order auto-check used raw stock.** | It uses **free** stock, so stock reserved for production isn't sold. The "In stock" line still deducts straight away (your decision). |
| G | **The minimum-stock auto-reorder compared raw stock.** | It compares **free** stock (raw material per size, Child Part, Sub Child Part), so safety stock is refilled on time. |
| H | **Leftover reservations:** 24 of 41 belonged to orders deleted directly in the database. | Removed. A **daily clean-up** (2:30 AM) now removes reservations whose order is gone or completed. |
| I | **New: checking an order's availability again counted its own claim against itself.** | It counts only other claims, and only those made before its own (earlier orders keep priority). |

**Returns (your decision):**
- A **defective** return re-reserves that quantity for the order, so the replacement is held for
  it.
- An **excess** return just goes back to stock.

**Over-issuing:** if Store transfers more than reserved, the reservation goes to "fully issued"
and the extra comes from free stock.

**Cutting from a leftover piece:** the order's reservation of the catalog size is reduced by the
material it saved (area for sheets, length for bars). Without size data it stays reserved until
the order completes, which is the safe direction.

**Data:** the migration ran on the real database.
- 24 stale rows were deleted.
- 16 rows got their size / line / issued amount. For example, ORD-2026-069's 12 Fan Blades and 4
  Fan Bushes were already transferred, so they're no longer counted as reserved.
- 1 C channel row whose size couldn't be told was removed (dev data).
- **Free stock now, for example:** NUT Bolts 20 in stock, 32 still to issue → −12 (a real
  shortage; it was −60 before); Fan Bush 10 free (was 0).

**Technical notes:**
- **`models/MaterialReservation.js`:** `dimensionVariantId`, `lineKey`, `issuedQuantity`; index
  `{ item, dimensionVariantId, company }`.
- **`services/materialReservationService.js`:**
  - free stock is remaining-based and per size
  - `checkAndReserve` takes a size and line key, excludes its own row, and uses priority on a
    re-check
  - new: `recordIssue`, `recordReturn`, `markOrderFullyIssued`, `heldForEarlierOrders`,
    `sweepStaleReservations`, and the pure `remainingOf` / `allocateIssue` / `allocateReturn`
- **Reservation call sites:** `machineReorderService`, `childPartReorderService` and
  `subChildPartOrderService` pass a size and line key; the material lists are order-aware.
- **Store transfers** (`inventoryController`): the four transfer endpoints record the issue and
  return a `warning`; `confirmReturn` re-reserves defective returns; `getPendingRequests` adds
  `stockCheck` per row; the pure `catalogEquivalentPieces` handles leftovers.
- **Job work:** `subChildPartJobWorkOrderController` marks the order fully issued on its first send.
- **Other:**
  - `storeFlowService`: the auto-check uses free stock
  - `jobs/lowStockReorderCron.js`: free stock, per size
  - `index.js`: the daily clean-up
  - new `scripts/migrateMaterialReservations.js` (run)
- **Frontend:** Store → Material Transfers (`PendingRequestsTab.jsx`): the stock note on each row
  and in both transfer dialogs, plus a warning toast after a transfer that used reserved stock.
- **Checks:**
  - every touched backend file imports as an ES module
  - **8 no-DB tests:** remaining, issue allocation (oldest first, capped, over-issue), returns,
    3-decimal precision, leftover → catalog equivalent for sheet and bar, no-data → 0
  - **9 real-DB scenario tests** on isolated `TEST-RSV-` fixtures, cleaned up with **0 strays**:
    - two orders, partial issue, free unchanged
    - a re-check keeps priority and never resets issued
    - the Store warning numbers
    - a defective return re-reserves
    - over-issue
    - two sizes kept apart, and two lines of one order kept apart
    - a job-work send marks fully issued
    - release on completion
  - The scenario caught one real bug, now fixed: Mongoose 9 refuses the pipeline update in
    `markOrderFullyIssued`.
  - The whole app builds; no undefined names.
  - **Not yet clicked through in the browser.**

---

## 11. Store → Reservations page (2026-10-09)

**Where:** Store → **Reservations** (sidebar, after Material Transfers).

**Why:** reservations had no screen. Store only saw a note per row on Material Transfers.

**What it shows:**
- **Totals:** reserved items, how many are **short** (not enough stock), and orders holding
  reservations.
- **A table per item, and per size for fabrication:**
  - In stock · Reserved · Issued · **Still to issue** · **Free** (In stock − Still to issue)
  - free is red with "short by N" when orders need more than is in stock
  - short items are listed first
- **Click an item** to see the orders that reserved it, **earliest claim first** (the order to serve
  them in): order number, type (Machine / Child Part / Sub Child Part / Job work), what it's for,
  the sales order, status, reserved on, reserved / issued / still to issue.
- **Search** by item, code or order number; filter by type; "Only short".
- **Access:** anyone who can see Store's Inventory (Store Head / Employee), plus the Company Admin.
  Read-only.

**Technical notes:**
- **Backend:** new `controllers/reservationController.js` `listReservations`;
  `GET /api/inventory/reservations` (`routes/inventoryRoutes.js`).
- **Frontend:** new `pages/store/Reservations.jsx`; route `/store/reservations` in `App.jsx`;
  sidebar entry in `config/moduleRoutes.js` (feature `inventory`).
- **Checks:**
  - the endpoint was run read-only on the real data: 8 reserved items, 5 short, 10 orders, with the
    numbers matching the ledger
  - esbuild of the page and the whole app; no undefined names
  - **not yet opened in the browser**

---

## 12. RFQ/PO item cards show stock (gap 9, blueprint §6) (2026-10-09)

**Where:** Accounts → Purchases → Purchase & Outsource → Purchase → **RFQ/PO**, on each item card
on the left.

**How it works now:**
- **A small stock button** on every card (each fabrication size has its own card):
  > **Stock 10 · Reserved 6 · Free 4 Pieces · Incoming 5 Kilogram · Min 8 ⚠**
  - **Reserved** is what orders still need issued (reserving never takes stock), and **Free** =
    Stock − Reserved. Both use the corrected reservation ledger (§10).
  - **Incoming** is what open POs are still bringing in (not yet received), in the PO's own unit.
    For a fabrication size it's counted in pieces.
  - **Min** is the minimum stock (per size for fabrication). ⚠ means free stock is at or below
    the minimum.
  - **Units:** stock, reserved, free and min are in the stock unit (pieces for a size). They aren't
    converted to the purchase unit (your decision).
  - The button turns amber when the item is short or below the minimum.
- **Clicking it opens the details** (kept off the card so the page stays clean, your decision):
  - the five numbers, with a note when orders need more than is in stock
  - **requests on this card — what each is for:** "Machine order PROD-… (machine) · sales ORD-…",
    "Child Part order …", "Sales order …", "Low-stock reorder (minimum stock)", or "Raised by hand"
  - **reserved by orders, earliest claim first:** reserved / issued / still to issue
  - **incoming:** each open PO with vendor, status, due date, and quantity (pieces for a size)

**Technical notes:**
- **New `services/stockContextService.js`:**
  - `stockSummariesForGroups` (one pass for the board) and `stockDetailForGroup` (the popup)
  - pure `incomingFromPurchases` (open POs only; a partly received line counts in proportion; a
    size card only counts lines of its size, in pieces) and `catalogVariantFor`
- **`itemQuoteGroupController`:** the board adds `group.stock`; new
  `GET /api/item-quote-groups/:id/stock-detail`.
- **Frontend:** new `components/accounts/purchase/StockContext.jsx` (`StockChip`,
  `StockDetailDialog`); `RfqItemList` shows the button.
- **Checks:**
  - 3 no-DB tests (incoming: open / partly received / received, the size filter in pieces, catalog
    size lookup)
  - a read-only run on the real data for all 10 test cards, e.g. NUT Bolts: stock 20 · reserved 32
    · free −12 · min 20 ⚠; Angle 200×3×100: stock 13 · free 13 · min 5; the popup lists PR006 /
    PR008 with what each is for
  - esbuild of the touched files and the whole app; no undefined names
  - **not yet opened in the browser**

---

## 13. Vendor selection check at PO time (gap 12, blueprint §10–§11) (2026-10-09)

**Where:**
- the **Review & create PO** dialog on RFQ/PO
- the **Manual quotation** dialog
- Company Admin → Purchase & Vendor Approval → **PO Approvals**
- Purchase → **Purchase Orders**
- **All quotes**

**Why:** the blueprint asks for competition ("ask several vendors"). It also asks that picking a
vendor who isn't the best needs "a documented exception reason and approval", with "the
calculated score" kept.

**How it works now:**
- **When Purchase opens Review & create PO**, the system checks two things for that vendor's PO.
  The result shows in a **"Vendor selection check"** panel.
  1. **Were enough vendors asked?** This is checked for each item.
     - Needed = the company's "minimum vendors per item", or fewer if fewer approved vendors
       supply the item.
     - **"Asked" counts** an email request or a manual quote, even if the vendor never replied or
       declined. The effort is on record in All quotes (your decision).
  2. **Did another vendor quote this whole PO for less?**
     - Compared on the **landed cost**: price + GST + the vendor's quoted charges (and their GST).
     - Charges count **once per quotation**, not once per item.
     - Only vendors with a valid (not expired, not replaced) quote on **every** item of the PO
       take part.
     - Everyone is priced at this PO's quantities, from their own quotes.
- **Pass:** a green panel. The PO is created as before, or goes to the Company Admin only if it's
  over the ₹ limit.
- **Fail:** a red panel showing what failed, plus a table:
  > vendor · items + GST · charges · landed · difference vs this PO
  - Purchase must **pick a reason**: Only vendor that can supply, Better quality or rating, Faster
    delivery, Urgent need, Better payment terms, Rate contract, Others didn't reply in time, or
    Other.
  - "Other" needs a note. Any other reason can take an optional note.
  - The button becomes **"Send for approval"**. A failed check goes to the **Company Admin
    whatever the PO value**, even under the ₹ limit (your decision).
- **Item hints:** "Bolt: B quoted ₹106/unit incl. GST vs ₹118 here".
  - Shown when one item is cheaper elsewhere.
  - **Information only, never a failure.** Buying everything from one vendor can cost less overall
    than splitting the order and paying charges twice (your decision).
- **The check is saved on the PO** as it was at that moment (the blueprint's "preserve the
  calculated score"):
  - the comparison, the hints, Purchase's reason and note, and the time
- **The Company Admin's PO card** shows:
  - why it needs approval: badges **"Over the ₹ limit"** and/or **"Vendor selection exception"**
  - "above / within your ₹ limit" (now correct for a PO that only failed the check)
  - a one-line check result
  - the full check in the expanded card
- **Purchase Orders** shows the same: the pending reason, plus the check (a one-liner when it
  passed, the full panel when it didn't).
- **The server re-runs the check when the PO is created.** It never trusts the page. If quotes
  changed in between and it now fails, the PO is refused until a reason is given.
- **Manual quotations now record the vendor's charges and payment terms** (your decision).
  - Before, a manual quote had no charges. They were typed on the PO review, so an emailed quote
    with freight looked dearer than a manual quote with the same freight.
  - The Manual quotation dialog now has the same charges (template names + "Other", ₹ + GST %)
    and payment terms (Advance %, Credit days, template terms + your own) as the vendor's email
    form.
  - The PO review pre-fills from **the latest of the emailed and manual quotations** behind its
    lines.
  - All quotes lists both kinds under "Charges & payment terms the vendors quoted". Older manual
    quotes say their charges weren't recorded.
  - **Payment terms are added by choice** (your follow-up), like charges, on both the Manual
    quotation dialog and the vendor's email page.
    - The list starts empty. "+ Add term…" offers the template names not yet added, plus "Other"
      (typed).
    - Each added term needs its details, or must be removed.
    - Advance % and Credit days stay as fixed fields, as before.

**Technical notes:**
- **New `services/vendorSelectionCheckService.js`:**
  - pure `evaluateSelection` and `lineLanded` (GST included in the rate → nothing added; GST not
    given → counted as 0 and flagged with *)
  - `checkVendorSelection` (loads approved vendors supplying each item, every bid per item for
    "asked", and each vendor's latest valid quote with its QR / MQ charges)
  - `readSelectionException`, `SELECTION_EXCEPTION_REASONS`
- **New endpoint:** `POST /api/item-quote-groups/selection-check { vendor, groups[] }` (purchases
  view), the preview.
- **`purchaseController.createPurchase`:**
  - re-runs the check for lines made from quotes
  - 400 without a valid `selectionException` when the check fails
  - saves `selectionCheck` (the snapshot + `exceptionReasons` / `exceptionNote` / `checkedAt`)
  - `needsApproval` = over the limit **or** a failed check; `approval.reasons` = `threshold` /
    `selection`
  - the notification and response message say which
- **`Purchase` model:** `selectionCheck` (Mixed) and `approval.reasons`.
- **`poApprovalController.listPOApprovals`:** adds `approvalReasons`. Older POs with none saved
  read as `threshold`.
- **`ManualQuotation`:**
  - new `charges[]` / `paymentTerms`, the same shape as the quotation request
  - `createManualQuotation` reads them (JSON form fields) through the same cleaners as the PO, with
    names outside the template marked custom
- **Board and All quotes populate the MQ's charges / terms.**
- **Frontend:**
  - new `components/accounts/purchase/SelectionCheck.jsx` (`SelectionCheckDetails`,
    `SelectionCheckLine`, `ApprovalReasonBadges`)
  - `PoReviewDialog` has the panel, reason chips and pre-fill from the QR or MQ
  - charges / terms section in `rfqShared.ManualQuotationDialog`
  - `PoApprovalsTab`, `PurchaseOrderList` and `QuoteHistoryDialog` updated
- **Checks:**
  - 6 no-DB tests: landed cost; competition; basket incl. a vendor missing an item; charges once
    per quotation making a cheaper price lose; tie = pass; hints never fail; reason rules
  - a real-DB scenario on throwaway `TEST-SEL-` data (3 vendors, 2 items, through
    `createPurchase` itself), all removed afterwards:
    - no reason → 400, nothing saved
    - with a reason → Pending Approval with reason `selection` and the snapshot saved; nothing
      linked
    - the cheaper vendor's freight (on its manual quotation) makes it dearer → the check passes →
      PO created directly
  - the existing manual quotation / quotation / quote check tests still pass (11 + 8 + 10)
  - esbuild of the touched files; no undefined names
  - **not yet clicked through in the browser**

---

## 14. Cancelling a PO — full cancel or short close, approved by the Company Admin (gap 13) (2026-10-09)

**Where:**
- Purchase → **Purchase Orders** (the button, the dialog, the history)
- Company Admin → **PO Approvals**, Pending tab (the decision)
- Store's PO receive list (cancelled lines)

**The rule (your decision):** once a PO is ordered it is **never edited**.
- Before the PO, changes go through quotes and All quotes.
- After it, a different price or quantity = **cancel and order again**.
- So the blueprint's "PO price above the approved quote needs approval" can't happen.

**How it works now:**
- **When it can be cancelled:** a real order (made directly, or approved) that isn't fully
  received.
  | PO status | What you can do |
  |---|---|
  | Draft (ordered, email not sent yet) / Sent / Acknowledged, nothing received | Cancel the whole PO |
  | Partially Received | **Short close**: cancel only the lines not received yet |
  | Received | Nothing; use a return |
  | Pending Approval | Nothing; the Company Admin rejects it instead |
  | Rejected | Nothing |
  - Store receives a whole line at once, so a line is either received or not.
- **Purchase** clicks **"Cancel PO"** (or **"Cancel the rest"**) on an expanded PO.
  - The dialog lists the lines that would go. Each request on them is set to **"Back to RFQ/PO"**
    (default) or **"No longer needed"**.
  - Purchase picks a **reason** (Vendor can't supply / Vendor changed price / Vendor delay / Need
    no longer exists / Ordered by mistake / Other + note) and **whose side** it is (pre-set from
    the reason).
  - It goes to the Company Admin, and **nothing changes until they decide**. Store can still
    receive meanwhile.
- **The Company Admin** sees a **"Cancellation request"** / **"Short close request"** card under
  Pending:
  - the reason, side and note, and who asked
  - the lines it would take *now* (re-checked against what Store has received), and the requests
    going back
  - the invoice, and anything already paid
  - **Approve**, or **Keep the PO** (a reason is required)
  - The person who asked can't approve it.
- **On approval:**
  1. The lines are marked cancelled. If they were every line, the PO becomes **Cancelled**.
     Otherwise it's **short closed**, and its status follows the lines left (normally Received).
  2. **Requests** go back to RFQ/PO as Pending, or "no longer needed" ones close (Rejected, with
     the reason).
  3. **The item card reopens** with them, if no other card is open for that item + size.
     Otherwise they join the open card.
     - **Other vendors' quotes** that are still valid come back.
     - **This vendor's own quote** comes back only if the cancel was on **our** side; on the
       vendor's side it stays rejected.
  4. **The invoice is never deleted.** A full cancel → **Cancelled**, nothing owed. A short close
     → **reduced** to the lines kept (whole-PO charges stay, since the delivery happened).
     Anything already paid above that is recorded as a **vendor credit** on the cancellation.
     Using that credit is the Accounts work planned next.
  5. **A ledger entry for the invoice is reversed**, but only if one exists. Today none do (see
     the ledger bug in the workflow doc §6.8).
  6. **The vendor is emailed** "PO cancelled" / "these items cancelled", with the reason. If that
     fails, the card says so.
  7. Purchase is notified.
- **Refused:** the PO stays exactly as it was, and Purchase sees the reason.
- **Everywhere afterwards:**
  - Purchase Orders shows every request (asked / approved / refused), with "Cancel requested" and
    "Short closed" badges
  - cancelled lines are **struck through** with a "Cancelled" badge and **no Receive button for
    Store**
  - the server refuses receiving on them too

**Also fixed on the way:**
- **The invoice's save rule** recalculated the status every time, so a "Cancelled" invoice would
  have turned back into "Unpaid". It now stays Cancelled with nothing owed, which also drops it
  out of the vendor's outstanding.
- **RFQ/PO picked up requests Store had rejected.** The page and auto-select took every request
  not on a PO, whatever its status. Now only Pending / Approved requests are taken.
- **Dispatch's pickup list** no longer shows cancelled POs. The RFQ/PO stock popup's "incoming"
  skips cancelled lines.

**Technical notes:**
- **New `services/poCancellationService.js`:**
  - pure `lineReceived` / `cancellableLines` / `cancelKind` / `bidAfterCancel` /
    `invoiceAfterCancel` / `readCancelRequest`
  - `requestCancellation`, `applyCancellation`, `rejectCancellation`, and
    `reverseInvoicePosting` (proportional reversal + account balances)
- **New `controllers/poCancellationController.js`:**
  - `POST /api/accounts/purchases/orders/:id/cancel-request`
  - `PUT /api/po-approvals/:id/cancel-review`
- **`Purchase` model:**
  - `items[].cancelled { at, by }`
  - `cancellations[]` (status, kind, reasons, side, note, closeRequests, requested / reviewed
    by / at, remarks, lines, vendorCredit, invoiceNote, emailSent)
  - `PO_CANCEL_REASONS`
- **`PurchaseInvoice`:** the save hook keeps Cancelled.
- **`listPOApprovals`:** Pending = Pending Approval **or** an open request; adds `pendingKind` and
  `cancelPreview`.
- **Guards:**
  - `receiveLineItems` / `receiveLineFabrication` / `receivePurchase`
  - `computeHealedStatus` (ignores cancelled lines)
  - the dispatch query
  - `stockContextService`
  - `autoSelectGroups` (status filter)
- **`itemQuoteGroupController`:** now exports `computeGroupQuantityFromPRs` and `sizeFieldsOf`.
- **New `sendPurchaseOrderCancellationEmail`.**
- **Frontend:**
  - new `components/accounts/purchase/CancelPoDialog.jsx`
  - `PurchaseOrdersTab`, `PurchaseOrderList`, `PoApprovalsTab`, `RfqPoTab` updated
- **Checks:**
  - 8 no-DB tests: cancellable lines / kind / legacy lines, quotes after a cancel (both sides,
    expired, never answered), invoice full / short close / credit, request validation
  - a real-DB scenario on throwaway `TEST-CAN-` data through the real endpoints:
    1. a direct PO
    2. a bad request is refused, then a good one waits
    3. a second request is refused
    4. the requester can't approve
    5. the approval cancels the PO and the invoice, reopens the requests and cards, rejects the
       vendor's own quote and revives the other vendor's
    6. Store can't receive on it
    7. re-ordering from the other vendor works
    8. a refused request leaves the PO unchanged
    9. a short close after line 1 is received cancels only line 2, closes its "no longer needed"
       request and reduces the invoice to ₹1,888
  - 8/8 pass; 0 leftovers
  - esbuild of the touched files; no undefined names
  - **not yet clicked through in the browser**

---

## 15. PO audit log + Company Admin tabs grouped (gap 17) (2026-10-10)

**Where:**
- Purchase & Outsource → Purchase → **Audit Log** tab (with permission)
- a **History** button on each PO in Purchase Orders
- Company Admin → Purchase & Vendor Approval → **Purchase Orders → Audit Log**, and History on
  each PO card

**Why:** the blueprint (§14) asks for "immutable audit logs" of approvals and PO changes: who did
what, and when. Until now, some steps weren't recorded anywhere, such as who resent a PO email or
that the email failed.

**How it works now:**
- **Every step of a PO is recorded the moment it happens.** Each entry has the time, who did it
  (name, role), the IP address, and a plain sentence:
  | Step | Example sentence |
  |---|---|
  | Created | "Created directly — ₹2,360, within the ₹20,000 limit" |
  | Sent for approval | "… above the ₹20,000 limit + vendor selection exception" |
  | Approved / Rejected | Includes the Company Admin's remarks |
  | Emailed to vendor / Email failed | Automatic, or sent by hand with Send / Resend, with the error |
  | Cancel asked | With the reasons, side, note and lines |
  | Cancelled / Short closed | With the invoice result, any vendor credit, and whether the vendor was emailed |
  | Cancel refused | With the reason |
  | Line received | Which item and how much, from any of Store's receive screens |
  | Fully received | Logged when the last line arrives |
- **Nobody can change or delete an entry.** No screen or route offers it, and the database model
  refuses edits and deletes.
- **The Audit Log tab:**
  - search by PO number, vendor or person
  - filter by what happened and by date range
  - 25 per page
  - clicking a PO number opens that PO's **History**: its steps as a timeline, oldest first
- **Who sees it:** the Company Admin, and anyone given the new **"Purchase Audit Log"**
  permission (Company Admin → Roles & Permissions → Accounts). The History buttons follow the same
  rule (your decision).
- **Company Admin page tidied:** the eight tabs are now three parents, each badge showing the sum
  of the pending counts under it (your decision):
  | Parent | Sub-tabs |
  |---|---|
  | **Vendors** | New Vendors · Vendor Changes · Suspend / Blacklist · Watchlist · Low Vendor Coverage |
  | **Purchase Orders** | PO Approvals (now with its own pending count) · Audit Log |
  | **Settings** | — |
- **Scope (your decision):** the PO's life only. Vendor approvals keep their own history, and
  quotes have All quotes.
- POs made before 10 Oct 2026 have no history; the history starts now.
- **Not yet:** a tamper-detection chain (workflow doc X4). It can be added later without changing
  anything.

**Technical notes:**
- **New `models/PurchaseAuditLog.js`:**
  - fields: `companyId`, `unit`, `entityId` / `entityRef` (PO number), `vendor` /
    `vendorName`, `action`, `summary`, `details`, `by` / `byName` / `byRole`,
    `ip`, `at`
  - append-only through pre-hooks on every update / delete query and on re-saving an existing
    document
- **New `services/purchaseAuditService.js`:**
  - `logPoEvent` never throws, so a failed log never blocks the PO action
  - `logLineReceived` adds "fully received" when no live line is left
- **Hooks:**
  - `createPurchase`, `finalizePurchase` (automatic email; now takes `req`) and
    `sendPOToVendor`
  - `reviewPOApproval`
  - `poCancellationService` (request / apply / reject, now taking `req`)
  - `receiveLineItems`, `receiveLineFabrication`, the legacy `updatePurchaseRequestStatus`
    receive, `receiveFabricationPurchase` and `receivePurchase`
- **New `GET /api/purchase-audit`** (`po` = one PO's timeline; `search`, `action`,
  `user`, `from` / `to`, `page`):
  - guard `canSeePurchaseAudit`: Company Admin / Super Admin by role, otherwise the
    `accounts.purchaseAuditLog` view permission
  - registered in `index.js`
- **Frontend:**
  - new `components/accounts/purchase/AuditLog.jsx` (`AuditLogTable`, `PoHistoryDialog`,
    `useCanSeeAudit`, `ActionBadge`)
  - `PurchaseTab`, `PurchaseOrdersTab`, `PoApprovalsTab` and `PurchaseVendorApprovals`
    (`GROUPS` parent tabs) updated
  - `roleModulesConfig` has the new permission
- **Checks:**
  - a real-DB scenario on throwaway `TEST-AUD-` data, through the real handlers:
    1. a PO over the limit gives "sent for approval" with the reason, the buyer's name and IP
    2. approval gives "approved", then "email failed"
    3. Store receiving 2 lines gives 2× "line received" + "fully received"
    4. a direct PO gives "created" + "email failed"
    5. cancel asked / refused / asked / approved are each logged with who did it
    6. the endpoint returns the timeline, filters work, and another company sees nothing
    7. the guard lets the Company Admin through and refuses an employee without the permission
    8. updating, deleting or re-saving an entry is refused
  - 8/8 pass; 0 leftovers (4 stray QC-job notifications from the test receives were found and
    removed, and the script now cleans them)
  - esbuild of the touched files and the whole app; no undefined names
  - **not yet clicked through in the browser**

---

## 16. Store expected receipts + delivery follow-up (blueprint §17, steps 11–13) (2026-10-10)

**Where:**
- Store → Purchase Requests & POs → **To Receive**
- Purchase → **Purchase Orders → Active**
- notifications, and each PO's History

**Why, and what we didn't build:** we decided against a formal vendor PO acknowledgement
(your decision).
- The vendor's commitment is already in its quote: the delivery days became each PO line's
  expected date.
- The PO is emailed automatically, and the audit log records the send.
- So we watch the **delivery date** instead. A vendor who never read the PO shows up the same way:
  the line goes overdue.

**How it works now:**
- **Store is told when a PO becomes a real order** (created directly, or approved): "PO-… from
  {vendor}: {items} — expected {date}". This reaches every Store Head and Store Employee in the
  company.
- **Due chips** on Store's To Receive list and Purchase's Active list:
  - **All · Overdue (n) · Due today (n) · Due in 3 days (n)**, counting POs with a line in each
    window
  - only lines not yet received and not cancelled count
- **Each line shows a due badge:** "Overdue · 2 days" (red), "Due today" (amber), or "Due 15 Oct".
  The PO row gets an **Overdue** badge when any line is late.
- **Overdue alert (daily, 9:30 AM):** each late line alerts **whoever created the PO** once for its
  date, e.g. "PO-… from {vendor} is late: Bolt (due 12 Oct, 3 days late) — follow up and record
  the new date". It's also written in the PO's History.
- **"Change date" on a line** (Purchase Orders, lines not yet received):
  - Purchase records the vendor's new date and the **reason** (required; the date can't be in the
    past).
  - The line shows "Date changed from 12 Oct to 18 Oct — {reason}".
  - The PO's overall date moves to the latest line.
  - Store is notified, and History records it.
  - If the new date also passes, it alerts again.
- **The vendor's delivery score still measures against the date they originally committed to**
  (workflow doc ST5). A revised date moves Store's due dates and the alerts, but can't turn a late
  delivery into an on-time one.

**Defaults I chose (say if you want different):**
- "Due soon" = the next 3 days.
- The overdue alert goes to the PO's creator only. Store sees overdue lines on its list.
- The vendor isn't emailed about a revised date, because the vendor gave it.

**Technical notes:**
- **New `services/deliveryFollowUpService.js`:**
  - pure `lineDueBucket` / `poDueSummary` / `readRevisedDate` / `lineIsReceived`
  - `notifyStoreOfIncomingPO` (called at the end of `finalizePurchase`)
  - `reviseLineDate`
  - `runOverdueDeliverySweep` (cron 9:30 AM in `index.js`; stamps `items[].overdueNotifiedFor` so
    each date alerts once)
- **`Purchase` lines:** `deliveryDateHistory[] { from, to, reason, by, byName, at }`,
  `overdueNotifiedFor`.
- **`PATCH /api/accounts/purchases/orders/:id/lines/:lineId/expected-date`.**
- **`getPurchases`:** `?due=overdue|today|soon` + `dueCounts` (Store's endpoint gets them too).
- **Audit actions** `date_revised` and `delivery_overdue`.
- **`vendorRatingService`:** on-time judged against `deliveryDateHistory[0].from` when a date was
  revised.
- **Frontend:**
  - `PurchaseOrderList` (`showDueFilter`, `DueBadge`, the revised-date note, the Overdue badge)
  - new `ReviseDeliveryDateDialog`
  - `PurchaseOrdersTab` (the Change date action), Store `PurchaseRequest.jsx`, `AuditLog` labels
- **Checks:**
  - 5 no-DB tests: calendar-day buckets incl. the boundaries, received / cancelled / undated lines,
    the PO-date fallback, summary counts, revised-date rules
  - a real-DB scenario on throwaway `TEST-DUE-` data through the real handlers:
    1. a direct PO notifies Store Head + Store Employee
    2. the sweep 5 days on alerts the creator about the bolt only (the nut isn't late), audits,
       stamps; a second run is silent
    3. a revised date: a past date or no reason is refused; history is saved, the PO date moves,
       Store is told, History records it
    4. the new date passing alerts again
    5. `?due=` and `dueCounts` work; a received line can't be re-dated and stops counting
  - 5/5 pass; 0 leftovers
  - esbuild of the touched files and the whole app; no undefined names
  - **not yet clicked through in the browser**

---

## 17. RFQ/PO: vendor context on the vendor card + per-item quote comparison (points 10 and 11) (2026-10-10)

**Where:** Purchase → RFQ/PO, on the vendor cards (right) and inside an expanded item card (left).

**How it works now:**
- **Vendor card (point 10):** under the vendor's name, instead of just the stars:
  > ★ 4.2 · On time 4/5 (80%) · QC pass 3/3 (100%) · Probationary
  - **On time:** deliveries received by the date the vendor **first** promised. A revised date
    doesn't count as the promise.
  - **QC pass:** QC results that passed; each partial rejection counts as a fail.
  - The percentages are green at 90% or more, amber at 70% or more, red below that.
  - **Standing:**
    - **Watchlist** (red): rating below 3.0 over at least 5 events
    - **Probationary** (amber): fewer than 3 POs delivered
  - **High risk** also shows when Vendor Master marks the vendor that way.
  - A vendor with nothing delivered shows "No deliveries yet".
- **Item card (point 11, your design):** expand an item card and, below **Select requests**,
  **Quotes compared** lists every vendor's current quote for that item:
  - vendor · rate · GST · **with GST** (per unit) · line total · delivery days (and warranty) · valid
    till
  - sorted cheapest first; the lowest **usable** quote is marked **Lowest**, and the others show
    "+n%"
  - expired quotes, and quotes for an old quantity, are greyed out and can't be "Lowest"
  - vendors still to reply and those who said they can't supply are listed underneath
  - freight and other whole-quotation charges aren't split per item, so they're left out here (it
    says so); the PO review's selection check compares them

**Technical notes:**
- **`vendorRatingService.computeVendorRating`** also returns `onTime { on, total }` and
  `qc { pass, total }`. The rating formula is unchanged.
- **`vendorApprovalService.getVendorStanding`** keeps the full rating result.
- **`GET /api/suppliers/vendor-ratings`** adds `onTime`, `qc`, `stage`, `receivedPOCount` and
  `riskClass`, worked out once via `getVendorStanding`. The Vendor Ratings tab ignores the extras.
- **Frontend:**
  - new `components/accounts/purchase/VendorContext.jsx` (`VendorContextLine`) and
    `rfqPo/QuoteComparison.jsx`
  - `RfqPoTab` keeps the whole vendor context and passes `quotesOf`
  - `RfqItemList` and `RfqVendorList` use them
- **Checks:**
  - read-only on real data: the 3 vendors show Probationary with no deliveries yet, which is right
    after the reset
  - a real-DB check on throwaway `TEST-VCX-` data (0 leftovers):
    - promised the 3rd, revised to the 5th, delivered the 4th → still **late**
    - on time 1/2; QC pass 1/3 with a partial rejection counted as a fail
    - the rating stays 2.6 over 5 events, so the formula didn't change
  - esbuild of the touched files and the whole app; no undefined names
  - **not yet clicked through in the browser**

---

## 18. Quote reminders (point 16) (2026-10-10)

**Where:** notifications for Purchase, and a **Remind** button on RFQ/PO vendor rows that are
waiting for a reply.

**Your decision:** tell Purchase, and give them a button. The system **never emails a vendor on
its own**: an automatic chase can feel pushy to vendors you know, and Purchase may prefer to call.

**How it works now:**
- **Every morning (9:35)**, each person gets **one** notification, "Quotes to follow up (n)",
  listing:
  - **No reply:** a quotation request they emailed **3 days** ago that's still not submitted. "QR-0003
    to X: no reply after 4 days (2 items) — send a reminder or call them."
  - **Link ran out:** the vendor's 7-day link expired with items still unanswered. "…send a new
    quotation request if you still want their price."
  - **Quote about to expire:** a priced quote, not yet ordered, ending within **2 days**, sent to
    whoever asked for it (email request) or entered it (manual quote). "X's quote for Bolt (₹120)
    expires tomorrow — order it or ask for a fresh quote."
  - Each one is said **once**. Nothing is said about items already ordered or closed, or about
    requests whose email never went out.
- **Remind button** (vendor row, "Waiting for reply"):
  - re-emails the vendor the **same link**, with "Reminder:" in the subject, a short note, and only
    the items still open
  - at most **once a day** per request; refused if the vendor already submitted or the link has
    expired (then send a new request)
  - the row then shows "Waiting for reply — QR-0003 sent 8 Oct · reminded 10 Oct"
- **Delivery reminders** were built earlier today (§16); payment reminders wait for the client.

**Technical notes:**
- **New `services/quoteReminderService.js`:**
  - pure `needsNoReplyNudge`, `needsLinkExpiredNudge`, `quoteExpiringSoon`, `reminderBlocked`
  - `sendVendorReminder`; `runQuoteReminderSweep` (cron 9:35 AM in `index.js`, one notification per
    company + person)
- **Models:**
  - `QuotationRequest.vendorReminders[]`, `noReplyNotifiedAt`, `linkExpiredNotifiedAt`
  - `VendorBid.expiryNotifiedAt`
- **`sendQuotationRequestEmail({ reminder: true })`.** New `POST /api/quotation-requests/:id/remind`
  (`purchasesAdd`). The board includes `vendorReminders`.
- **Frontend:** `rfqShared.requestWaitingLabel` (the "reminded" date, `canRemind`) and
  `RfqVendorList` (the Remind button).
- **Checks:**
  - 4 no-DB tests: day thresholds, once-only, items still open, failed emails, the reminder
    refusals and the once-a-day gap
  - a real-DB scenario on a **made-up company**, so the sweep can't touch real data:
    - one notification per person (no reply + link ran out together, the expiring quote to the
      other person)
    - a second run is silent; nothing once the vendor has replied
    - Remind is refused for an expired link, and clearly so for a vendor without email
    - 4/4 pass; 0 leftovers
  - esbuild of the touched files and the whole app; no undefined names
  - **not yet clicked through in the browser**; the actual reminder email wasn't sent in the tests

---

## 19. CGST + SGST vs IGST on purchase orders (point 15) (2026-10-10)

**Where:**
- the PO review (RFQ/PO)
- Purchase Orders
- the Company Admin's PO cards
- the PO email
- the purchase invoice
- Vendor Master (GSTIN and state)
- the company form (GSTIN)

**What it is:** the GST **amount** was already right; the vendor quotes the rate. What was missing
was **which GST** that amount is:
- **vendor in the same state as us:** **CGST + SGST**, half each
- **vendor in another state:** **IGST**

Nobody types this. It follows from where the two sides are registered.

**How it works now:**
- **Worked out from the GSTINs.** The first 2 digits are the state code (07 Delhi, 09 Uttar
  Pradesh, 27 Maharashtra…).
  - **Our side** is the company's GSTIN (one registration per company; branches have no GSTIN).
  - **The vendor's side** is its GSTIN.
  - If a GSTIN is missing, its state name is used instead. A vendor without a GSTIN usually charges
    no GST anyway.
  - If a side can't be told, the PO says **"GST type unknown"** and where to fix it. It doesn't
    guess.
- **Fixed when the PO is created**, so a later address change never rewrites an order's tax.
- **Shown:**
  - **PO review:** "GST split: CGST ₹90 + SGST ₹90 (both in Delhi)" or "IGST ₹180 (Maharashtra →
    Delhi)"
  - **PO email:** CGST and SGST rows, or one IGST row
  - **Purchase Orders and the Company Admin's PO cards:** the same note under the totals
- **The invoice** takes the PO's type (`gstType` IGST or CGST + SGST). Before this it was always
  CGST + SGST. The ledger accounts per type are part of the Accounts work that's on hold.
- **Stopping bad data:**
  - **Vendor Master:** the GSTIN is checked as you type and refused if it's not a real 15-character
    GSTIN. You're warned if its state code doesn't match the registered state. The state is now
    picked from a **list of Indian states**; an old typed value still shows, marked "please pick
    from the list".
  - **The server** also refuses a bad GSTIN, and stores a typed state code or short form ("09",
    "UP") as the proper name.
  - **Company:** the GSTIN format was already checked when a company is created; it's now checked
    when it's edited too (Super Admin and My Company both save through it).

**Technical notes:**
- **New `services/gstStateService.js`:**
  - `GST_STATES` (the code list), `GSTIN_PATTERN`
  - `stateFromGstin`, `stateFromText`, `gstSplitFor`, `checkGstin`
  - the frontend copy is `lib/gstStates.js`; keep the two in step
- **`Purchase.gstSplit`** is set in `createPurchase`.
- **The PO email's GST rows** follow it.
- **`createAutoPurchaseInvoice`** sets `gstType`.
- **The RFQ/PO board** returns `company { gst, state }` for the preview.
- **`supplierController`:** `cleanVendorGst` on create / update.
- **`companyController.updateCompany`:** the GSTIN check.
- **Frontend:**
  - new `components/accounts/purchase/GstSplit.jsx`
  - `PoReviewDialog`, `PurchaseOrderList`, `PoApprovalsTab`, `RfqVendorList`, `RfqPoTab` and
    `VendorMaster` (state list, live GSTIN check) updated
- **Checks:**
  - 5 no-DB tests: the GSTIN format, state from name / code / common spellings, same → CGST +
    SGST, different → IGST, the GSTIN winning over a typed state, "unknown" with which side, the
    form check
  - a real-DB check on throwaway `TEST-GST-` data:
    - a Maharashtra vendor and our Delhi GSTIN → the PO is **IGST** and so is its invoice
    - Vendor Master refuses "6666664644", and turns " 09abcde1234f1z5 " / state "09" into
      "09ABCDE1234F1Z5" / "Uttar Pradesh"
    - 2/2 pass; 0 leftovers
  - esbuild of the touched files and the whole app; no undefined names
  - **not yet clicked through in the browser**
- **Dev data note:** existing dev vendors with made-up GSTINs (e.g. "6666664644") must get a real
  one, or a blank one, before they can be saved again.

---

## 20. Security fix: the vendor's quotation link is no longer shown to staff (2026-10-10)

**Found while testing (you):** after "Email quotation request", the dialog showed the vendor's link with a **Copy** button. Anyone holding that link can submit prices **as the vendor**. A logged-in check wouldn't help either, because a staff member could log out and open it.

**Fix (your decision):**
- The link is **removed from the screen and from the server's reply**. It now only goes into the vendor's own email.
- If the email fails, the message says to **send the request again**, or to enter the vendor's quote as a **Manual quotation** (with evidence).
- The RFQ/PO row's "email didn't go out" text and the failed-reminder message no longer say "share the link".
- The board and All quotes never sent the link, so nothing else changes. The old RFQ module only puts its links into emails.

**Technical notes:**
- `createQuotationRequest` no longer returns `link`.
- `rfqShared.QuotationRequestDialog` has no link box or copy button.
- The `requestWaitingLabel` and `quoteReminderService` messages are reworded.
- **Checks:** the quotation tests (8) and the reminder tests (4) still pass; it builds; it imports.

---

## 21. RFQ/PO: ticks and re-asking vendors (found while testing slice 3) (2026-10-10)

**What you saw:** after emailing a vendor about 3 items and coming back, all 11 of that vendor's rows were ticked again. Ticking everything only makes sense for a vendor you haven't asked yet.

**Now:**
- **Default ticks:** rows start ticked only for a vendor with **nothing** on this page yet (no quote, request or "can't supply"). Once a vendor has any of those, nothing is pre-ticked and you tick what you want.
- **Email quotation request** offers a choice when the ticked items are mixed:
  - **Only items that need a quote:** new items, expired quotes, quotes for an old quantity, and requests that got no reply (link ran out or email failed)
  - **All ticked items:** also re-asks items they've already priced or are still answering, or said they can't supply. Their new prices replace the old ones, kept in All quotes.
  - Each item shows where it stands, and the ones not being sent are greyed out with "not sent".
- **Manual quotation** needs no such choice, since you type only what the vendor gave. But it now follows the same rule:
  - a **reason** is asked only when replacing a **still-valid** quote for the same quantity
  - replacing an **expired** quote, or one for an **old quantity**, is just a fresh quote. It's still linked in All quotes, with "Previous quote had expired" / "Quantity changed since the previous quote" noted for you.

**Technical notes:**
- `RfqVendorList`: pre-ticks only when `freshVendor`.
- `rfqShared`: `quoteNeedOf` and the mode choice in `QuotationRequestDialog`; `currentOf` /
  `supersededOf` in `ManualQuotationDialog`.
- `manualQuotationController`: `existingByGroup` (reason needed) vs `autoReplace` (noted
  automatically).
- **Checks:** builds; no undefined names; the manual quotation tests (11) pass. The auto-noted replacement wasn't run against the database.

---

## 22. The PO bill, advance payment, delivery from the advance, a real ledger (accounts Slice 1) (2026-10-12)

**Why:** the client answered the accounts questions
(`accounts-bill-ledger-payments-2026-10.md`):
- the PO is the bill
- payment goes advance → full payment after QC, with an optional mid payment
- delivery days count from the advance
- credit days count from full acceptance
- no TDS

This slice is the base: the bill, the advance and the ledger.

**Where:**
- Accounts → Purchases → **Vendor Payment** and **Purchase Invoice**
- Purchase → Purchase Orders, Store → To Receive, Dispatch → Vendor Pickups (the dates)
- PO review (the helper texts)

**How it worked before:**
- **The bill:** a PO's invoice was made when the PO was placed, due "today + credit days" (blank = 30).
- **The ledger:** the invoice tried to post to accounts named "Purchase Account" / "Input GST" that
  exist in no unit, so nothing ever posted. Payments did post (Dr Accounts Payable), so Payable
  went negative.
- **Advance:** only a hint on the payment page ("recommended ₹X"), not enforced.
- **Delivery dates:** set when the PO was created: PO date + the quote's days.
- **TDS:** the manual "Record New Bill" form worked out TDS from the vendor.

**How it works now:**

1. **The PO's bill.** It's still made when the PO becomes a real order, and it now carries:
   - **the advance** (Advance % × PO total), fixed then
   - **no due date yet.** The full payment's due date is set when everything is received and
     QC-passed (Slice 2): that day + the PO's credit days, with blank / 0 = straight away.
   - **a stage:** Advance due → Awaiting material → Payable → Paid (or Cancelled)
   - **its unit** = the PO's unit (before, it was the unit of whoever approved the PO)
   - **no ledger entry at creation:** a PO is a promise to buy, not money owed
2. **Paying the advance** (Vendor Payment):
   - Pick the vendor, then one of its POs. The card shows the advance (paid / total), what has
     passed QC, when the full payment falls due, and **"Can pay now"**.
   - Choose **"The advance"**. The amount can't be more than what's left of it.
   - A payment for material is refused until something has passed QC (Slice 2).
   - The bank / cash balance check stays: a payment is refused if the account shows too little.
3. **Delivery days start when the advance is paid** (POs with an advance):
   - Each PO line now keeps the vendor's quoted **days** (from the quote itself, not the page).
   - Until the **whole** advance is paid, a line has no date:
     - Purchase Orders and Store's To Receive show **"Waiting for advance · N days after"**
     - the Expected column shows **"After advance"**, and the Payment column **"Advance due"**
     - no Overdue chips, no overdue alerts, and "Change date" isn't offered
     - Dispatch's pickups show "After advance"
   - The day the last part of the advance is paid, each line's date = the payment date + its
     days. Store gets **"Advance paid — delivery dates set"**, and the audit log records it.
   - The PO email to the vendor says **"N days after advance"** instead of a date.
   - **No advance:** dates count from the order, as before. For a PO that waited for Company Admin
     approval, they count from the approval day.
4. **A real ledger for purchases.** Each company + unit gets its own accounts, made on first use:
   - Purchase, Input CGST, Input SGST, Input IGST
   - Accounts Payable, Advance to Vendors, Vendor Refund Due, Purchase Loss

   Postings so far:
   - **Advance paid:** Dr Advance to Vendors / Cr Bank
   - **Manual bill (no PO):** Dr Purchase + Input CGST/SGST or IGST / Cr Accounts Payable
   - **Its payment:** Dr Accounts Payable / Cr Bank
5. **Payment history:** a "Recent payments" list on the Vendor Payment page (there was none
   before), showing date, vendor, PO + Advance / Material, mode, reference, bank and amount.
6. **Purchase Invoice page:**
   - one row per bill: the PO number (or "No PO"), amount, advance paid / due, paid, stage, and
     the full-payment due date ("after QC" until known)
   - stage filter chips
   - the bill view shows the PO-bill figures
7. **Bills without a PO** ("Record New Bill"):
   - **TDS is removed.** The total is items + GST, worked out on the server.
   - It now posts to the ledger.
   - Its payments only ever touch bills without a PO, and **can't be more than what those bills
     still owe**, so Payable can't go negative again.
8. **Payment status on the PO** (Pending / Partially Paid / Paid / Overdue) now follows its bill. It
   can no longer be set by hand.

**Good to know:**
- **No dev data needed migrating:** there were no PO bills in the database (purchase data reset
  2026-10-09).
- **Existing POs keep their dates.** The clock only applies to POs made from now on.
- **The database is standalone** (no multi-document transactions), so a payment is fully checked
  before anything is written. If the ledger post fails after that, the payment still stands and the
  failure is logged.

**Technical notes:**
- **New services:**
  - `purchaseLedgerService`: `SYSTEM_ACCOUNTS`, `getSystemAccount`, `postEntry`, `gstLines`,
    `checkBalanced`
  - `purchaseBillService`: `advanceAmountOf`, `fullDueDate`, `payableNow`, `poPaymentStatus`,
    `readPayment`, `startDeliveryClock`, `payBill`
- **Models:**
  - `Account`: `companyId`, `systemKey`
  - `PurchaseInvoice`: `advancePercent`, `advanceAmount`, `advancePaid`, `acceptedValue`,
    `fullyAcceptedAt`, `creditDays`, `stage`, `adjustments[]`, and `billStage()`
  - `VendorPayment`: `kind`, `purchaseOrder`
  - `Purchase`: `items[].deliveryDays`, `deliveryClock`; `expectedDeliveryDate` is no longer
    required
- **Audit actions:** `advance_paid`, `payment_made`, `fully_accepted`, `rejection_recorded`,
  `refund_received`.
- **`deliveryFollowUpService`:** `awaitingAdvance`, `clockDates`; `lineDueDate` is null while
  waiting; `reviseLineDate` refuses.
- **`purchaseController`:**
  - `createPurchase`: days from the bid, and the clock
  - `finalizePurchase`: a no-advance PO's dates restart at approval
  - `updatePurchase`: keeps `deliveryDays` / history / cancelled, and no longer takes a manual
    `paymentStatus`
- **`purchaseInvoiceController`:**
  - `createAutoPurchaseInvoice`: the bill fields
  - `createVendorPayment`: `billId` → `payBill`; the manual path is company-scoped and capped
  - new `getVendorPayments` → `GET /api/accounts/purchases/payments`
  - `getVendorOutstanding`: adds stage and `payableNow`
- **Checks:**
  - 49 no-DB tests pass
  - a real-DB scenario passes, 9/9 with 0 leftovers: advance PO → no dates → refusals → part
    advance + ledger → rest of the advance starts the clock → date change allowed → no-advance PO
    → lists → manual bill + capped payment
  - builds and the undefined-name check pass
  - **not yet clicked through in the browser**

---

## 23. QC pass makes material payable; optional mid payment; full acceptance (accounts Slice 2) (2026-10-12)

**Why:** the full payment is due Credit Days after everything is received and QC-passed, and a
mid payment for accepted material is optional (client + user, 2026-10-12). This slice connects
QC to the PO's bill.

**Where:**
- QC → Jobs (a Pass on a purchase job)
- Accounts → Vendor Payment, Purchase Invoice and **Payable Ageing**
- the PO's History

**How it worked before:** QC passing purchased material only added stock. The bill, the ledger
and the payment side never heard about it.

**How it works now:**

1. **Each QC pass on purchased material makes it payable.**
   - **Its value** is that request's share of the PO line, times the part QC passed. The share is
     the same split Store's receive uses: pieces for fabrication, the ordered quantity otherwise.
     For example, 8 of 10 bolts passed (2 rejected) on a ₹1,180 line = ₹944.
   - **The bill's "QC-passed so far"** goes up by that value.
   - **The ledger gets** Dr Purchase + Input CGST/SGST (or IGST, from the PO) / Cr Accounts
     Payable.
   - **Posted once per QC job:** a repeat or retry can't count it twice.
2. **Optional mid payment.** Before everything is in, Vendor Payment offers **"QC-passed material
   (up to ₹X)"**:
   - X is what passed, less its share of the advance (20% advance → 80%), less material already
     paid.
   - Paying more is refused.
   - Ledger: Dr Accounts Payable / Cr Bank.
3. **Full acceptance.** When every live line is received and QC-passed (with nothing rejected):
   - **the full payment falls due:** that day + the PO's credit days (blank / 0 = straight away)
   - **the bill stage becomes Payable**
   - **the PO's charges** (freight etc.) and any rounding are posted, so Payable equals the bill
     exactly
   - **the advance is set off:** Dr Accounts Payable / Cr Advance to Vendors
   - **the PO's History** shows "Fully accepted — full payment of ₹X due {date}"
   - **Accounts gets** "Purchase ready for full payment"

   A QC rejection holds full acceptance until the vendor's answer is settled. That's Slice 3.
4. **Full payment:** Vendor Payment offers "Full payment (up to ₹balance)". Once paid, the bill and
   the PO show **Paid**, and Accounts Payable for it is back to zero.
5. **Overdue:**
   - A new daily job at **9:40** flags bills past their due date: the PO shows **Overdue**, and
     Accounts is told once per bill.
   - Vendor Payment and Purchase Invoice show the due date in red with "overdue".
6. **Payable Ageing** now goes by **due date**, in four boxes:
   - **On order — not payable yet:** PO material not yet in and passed
   - **Payable — not due yet:** within credit days
   - **Due now / overdue up to 30 days:** including unpaid advances
   - **Overdue 30+ days**

   Rows show the PO number.

**Example, from the test:**
- PO ₹2,478 (two lines of ₹1,180 + freight ₹118), 20% advance (₹495.60), 15 credit days.
- Advance paid. Line 1 passes → ₹1,180 payable → mid payment ₹944.
- Line 2 passes → fully accepted, due in 15 days. Freight posted, advance set off. Balance ₹1,038.40
  = Accounts Payable.
- Paid → Paid, and Payable is 0.

**Technical notes:**
- **New `services/purchaseAcceptanceService.js`:**
  - pure: `prShareWeight`, `lineMoney`, `acceptedMoney`, `isFullyAccepted`
  - DB: `onMaterialAccepted(job, user, req)` (never throws), `settleIfFullyAccepted`,
    `runPaymentOverdueSweep(now, {companyId, unit})`
- **`QCJob`:** `acceptedQty` (set at Pass, before the machine path trims `quantity`) and
  `acceptance {value, postedAt}`. `PurchaseInvoice`: `overdueNotifiedAt`.
- **`qcController.submitDecision`:** calls `onMaterialAccepted` after the job is saved, for
  Purchase jobs.
- **`index.js`:** cron 9:40 for `runPaymentOverdueSweep`.
- **Frontend:** `PayableAgeing.jsx` (due-date ageing), plus overdue marks on `VendorPayments.jsx` /
  `PurchaseInvoices.jsx`.
- **Checks:**
  - 22 no-DB tests pass
  - a real-DB scenario through the real receive / QC / payment handlers passes, 8/8 with 0
    leftovers: advance → QC pass → no double post → mid cap → full acceptance (charges, set-off,
    due date, Accounts told) → overdue sweep once → final payment → Paid, plus a partial-reject PO
    held from full acceptance
  - builds pass
  - **not yet clicked through in the browser**

---

## 24. QC rejections: the vendor's answer; refunds and credits; cancel on the new bill (accounts Slice 3) (2026-10-12)

**Why:** the client's five cases for rejected or cancelled material:
1. the vendor refuses
2. the vendor replaces
3. return + refund
4. return + credit
5. cancel / short close: pay for what came

**Where:**
- **Purchase → Purchase Orders → QC Rejections:** a new sub-tab, badged with the count waiting.
- **Accounts → Purchases → QC Rejections:** the old "Purchase Exchange" menu entry and page, rebuilt.
- **Vendor Payment → Refunds & credits**, and "Pay from the vendor's credit".
- **QC → the inspection page's result banner.**

**How it worked before:** every QC rejection of purchased material automatically did two opposite
things at once:
- booked a purchase return (fixed 18% GST, a ₹100 price fallback, and an invoice reduction that the
  invoice's own save hook then undid)
- emailed the vendor a replacement link, whose replacement request never reached the PO line, so
  Store couldn't receive it

Nobody recorded what the vendor actually agreed to.

**How it works now:**

1. **QC rejects purchased material** (part or all of a job) → a **rejection**, REJ-0001…,
   "Awaiting vendor answer":
   - its value = that part's share of the PO line (the same rule as a QC pass)
   - the PO's creator is notified; the PO's History shows "QC rejected"
   - **nothing goes to the vendor automatically**, and no return is booked
2. **Purchase asks the vendor and records the answer** (QC Rejections → "Record vendor's answer"):

   | Answer | What happens |
   |---|---|
   | **Will replace** (date needed) | The bill stays the same. A replacement request goes **on the same PO line**, so Store receives it with the normal Receive button and QC checks it again. The line's date moves to the vendor's date (kept in its history; the vendor's on-time score still uses the original). Store is told. When it passes, it's valued at the rejection's value and the rejection becomes "Replaced". If it fails again, a new rejection is made. |
   | **Takes it back and refunds** | Taken off the bill. The advance already paid on it (advance % of its value) becomes **Refund due**. When it arrives, Accounts records it with bank, date and reference. |
   | **Takes it back and gives credit** | Taken off the bill. The advance paid on it stays with the vendor as **credit**. On a later payment to that vendor, "Pay from the vendor's credit" uses it, with no bank needed. |
   | **Refuses to replace or refund** (note needed) | Taken off the bill (we don't pay for it). The advance paid on it is **written off**. The vendor's rating gets a **dispute** (a bad event), and they go on **Watchlist** for 90 days ("Refused to replace or refund QC-rejected material"). |

   - **A replacement that never comes:** the answer can be changed (to refund / credit / refused)
     while it hasn't arrived. The replacement request is withdrawn.
3. **Full payment waits for rejections.** A PO is fully accepted only when nothing is still waiting
   for an answer or a replacement. Then the usual happens (due date, charges, advance set-off).
4. **Cancel / short close on the new bill** (case 5):
   - **Nothing is reversed** in the ledger: cancelled lines were never received, so nothing of
     theirs was posted. Old invoices still use the old reversal.
   - **The bill total** keeps any rejection removals, and the advance follows the new total.
   - **Advance paid above what's still owed** comes off the bill as money the vendor holds,
     marked **"To decide"**. On Vendor Payment, Accounts picks **"Vendor refunds it"** or **"Keep
     as credit"**.
   - **A short close** that leaves only lines already received and passed makes the PO fully
     accepted straight away.
   - **A line partly received** (waiting for a replacement) is never cut by a short close. What
     came was accepted and is owed.
5. **Refunds & credits** (Vendor Payment): every bit of money a vendor holds of ours, with its
   status — To decide / Refund due / Refunded / Credit available / Credit used / Written off —
   and the actions.
6. **Ledger:**
   - **Refund due:** Dr Vendor Refund Due / Cr Advance to Vendors; when it's received, Dr Bank / Cr
     Vendor Refund Due
   - **Written off:** Dr Purchase Loss / Cr Advance to Vendors
   - **Credit:** stays in Advance to Vendors. Using it on a payment for material: Dr Accounts
     Payable / Cr Advance to Vendors.
7. **QC inspection page:** the result banner lists the slices rejected earlier, and for purchases
   says where the vendor's answer is recorded.

**Example (from the test):**
- **The PO:** 20% advance, two lines of ₹1,180.
- **Bolts — partial rejection, credit:** 2 of 10 rejected (₹236) → "credit": the bill drops to
  ₹2,124, and ₹47.20 of the advance becomes credit.
- **Nuts — all rejected, replaced:** all 10 rejected → "replace by {date}" → received on the same
  line → passed → PO fully accepted.
- **Paying it off:** ₹47.20 paid from the credit, the rest from the bank → Paid.
- **The ledger at the end:** Advance to Vendors 0, Payable 0.

**Good to know:**
- **No old data to convert:** there were no old exchanges or returns in the database.
- **A rejection on a purchase not on a PO** (e.g. a manual QC inward) records nothing money-wise.
  There's no PO bill to settle.
- **The old public exchange-accept page** stays for any old link, but nothing makes new ones.

**Technical notes:**
- **New models:**
  - `PurchaseRejection`: `number`, PO / line / request / QC job, value / net / gst, `outcome`,
    `status`, `advanceShare`, `replacement {purchaseRequest, expectedDate}`, `moneyBack`,
    `replacementOf`
  - `VendorMoneyBack`: source `Rejection` / `Cancellation`, `amount`, `mode`, `status`,
    `refund {}`, `used` / `uses[]`
- **Existing models:**
  - `PurchaseRequest.replacementFor`
  - `VendorPayment.fromCredit`
  - audit action `qc_rejected`
- **New `services/purchaseRejectionService.js`:**
  - pure: `readAnswer`, `advanceShareOf`, `billAfterRemoval`
  - DB: `onMaterialRejected`, `recordAnswer`, `recordRefundReceived`, `decideMoneyBack`,
    `vendorCreditAvailable`, `consumeVendorCredit`
- **`purchaseAcceptanceService`:**
  - `jobContext` / `partMoney` / `jobTotalQty`: replacements carry the rejection's value and never
    change the line's shares
  - `isFullyAccepted` takes `openRejections`; Rejected jobs count as decided
- **`qcController.submitDecision`:** Purchase jobs call `onMaterialRejected` after the save,
  replacing `createQCRejectedPurchaseReturn` + `createQCRejectedPurchaseExchange`.
- **`purchaseBillService.payBill`:** `useCredit`.
- **`poCancellationService`:**
  - `cancellableLines` skips partly received lines
  - `applyCancellation` handles the PO bill (no reversal, rejection removals kept, leftover
    advance → `VendorMoneyBack` "To decide", full-acceptance check after a short close)
- **`vendorRatingService`:** `disputes`. `vendorApprovalService.getVendorStanding`: Watchlist for
  `DISPUTE_WATCHLIST_DAYS` (90), plus `watchReason`.
- **Routes** (`accountsRoutes`): `GET /purchases/rejections`, `PUT /purchases/rejections/:id/answer`,
  `GET /purchases/money-back`, `PUT /purchases/money-back/:id/refund`,
  `PUT /purchases/money-back/:id/decide`.
- **Frontend:**
  - new `components/accounts/purchase/QcRejections.jsx` (+ `RejectionAnswerDialog`) and
    `VendorMoneyBackList.jsx`
  - `PurchaseExchanges.jsx` rebuilt
  - `PurchaseOrdersTab` gets the sub-tab
  - `VendorPayments` gets credit + refunds
  - `QCInspection` banner; menu label "QC Rejections"
- **Checks:**
  - **no-DB tests:** 16 new, plus 24 / 49 rerun
  - **real-DB scenario:** 11/11 with 0 leftovers, through the real receive / QC / payment /
    cancellation handlers — credit, replace (received on the same line + passed), a short close
    refused on a line awaiting replacement, paying from credit, refund + refund received, refused
    (note needed, dispute, Watchlist), a short close leaving ₹531 "To decide" → Refund, and the
    ledger adding up to the rupee
  - **Slices 1 and 2 re-run:** 9/9 and 8/8
  - **builds:** the whole app and the undefined-name check pass
  - **not yet clicked through in the browser** (the user will test the whole flow at the end)

---

## Quick summary

| # | Change | Status |
|---|--------|--------|
| 1 | Vendor Master: Payment Terms (Advance/Balance %, Credit Days, Notes) and GST Rate removed from the form and card; Credit Limit stays; these move to PO creation in the PO rework | Done, not yet tested live |
| 2 | Vendor Master v2: full vendor profile (§8), documents with expiry reminders, Draft → Submit → Company Admin approval, approval needed for legal name / GSTIN / PAN / bank changes, suspend / blacklist / reinstate, Probationary / Watchlist from the existing rating, history; new Company Admin "Purchase & Vendor Approval" page; only approved vendors can be quoted or ordered from; existing 4 vendors grandfathered | Done. Tested live: approval path (2026-10-08); reject → resubmit, detail-change approval, suspend / blacklist / reinstate (2026-10-10). Still to test: stages / history, watchlist (needs real deliveries) |
| 3 | Creating a vendor in two real steps (D2): the vendor form has details only; Products & Services is its own dialog (card button), offered right after create with a "Later" option | Done, tested live 2026-10-08 (as part of the creation flow) |
| 4 | Vendor documents: deleting a document / a vendor removes the files from the server, refused uploads leave nothing behind, "expires today" no longer shows as "Expired", form always reloads documents on open | Done; tested live 2026-10-10 |
| 5 | RFQ/PO page (merged By Item + By Vendor, auto-selected requests, k/N vendor ranking, search/filters that pull to the top), "Vendor Quotation" button, GST / charges / payment terms entered at PO time, Company Admin PO approval above a threshold, Company Admin settings + Low Vendor Coverage, Purchase charge/term templates (new permission), old vendor commercial data dropped | Done, not yet tested live |
| 6 | One quotation email per vendor for several items (vendor prices each item with GST, adds charges + payment terms incl. their own, one submission); manual quotes stay per item; PO review pre-filled from the quotation; PO emailed to the vendor on creation / approval (+ Send / Resend button); Company Admin notified of and sees every PO (Approved = approved + direct, with badge, paginated); Quote history on RFQ/PO, Purchase Orders and PO Approvals; charge GST defaults to 0% | Done, not yet tested live |
| 7 | Quote validity in days (Purchase Settings, default 30): an expired quote can't become a PO. "Bought before": what we paid on earlier DELIVERED purchases (same unit, before GST); each quote is tagged against that vendor's own last price (amber at a set %, default 10), and the tag opens every vendor's prices; on RFQ/PO, the PO review and the Company Admin's PO cards; Vendor Ratings uses the same numbers. "Quote history" renamed "All quotes" | Done, not yet tested live (real-DB check pending — DB host unreachable) |
| 9 | Fabrication: one purchase request and one RFQ/PO card per size; ordered in pieces (more allowed, not fewer) with kg calculated, no margin; click a quantity on the right to jump to and edit it on the left; size × pieces on quotes, PO lines, PO email and Store's receive pre-fill; one-time migration script | Done, not yet tested live (migration pending — DB down) |
| 10 | Material reservations fixed: issued material no longer counted twice, per-size reservations, no self-overwrite, Store sees reserved-for-earlier and is warned (never blocked), Production's "Available" and the sales auto-check use free stock, min-stock reorder uses free stock, defective returns re-reserve, daily stale clean-up; migration run on the real DB | Done; 8 + 9 tests pass; not yet clicked through in the browser |
| 11 | Store → Reservations page: per item / size In stock · Reserved · Issued · Still to issue · Free (short first), click for the orders in claim order; search / type / only-short filters | Done, not yet opened in the browser |
| 12 | RFQ/PO item cards: a stock button (Stock · Reserved · Free · Incoming · Min ⚠) that opens a popup with what each request is for, the reserving orders and the open POs | Done, not yet opened in the browser |
| 8 | Manual quotations need evidence: tick items on a vendor card → "Manual quotation" → upload the proof (channel incl. typed "Other", date on the evidence, files) and enter the prices in one step (MQ-…); a new price over an existing quote needs a reason; evidence shown in All quotes; no ghost files; per-row typing removed | Done, not yet tested live (DB down) |
| 13 | Vendor selection check at PO time: enough vendors asked per item (asked = emailed or manual quote, even unanswered) and no vendor quoted the whole PO for less on landed cost (price + GST + their charges once per quotation); item-level cheaper = hint only; a failed check needs a reason (fixed list + note) and goes to the Company Admin even under the ₹ limit; the check is saved on the PO and shown to the Company Admin and on Purchase Orders; manual quotations now record the vendor's charges + payment terms, and the PO review pre-fills from the latest emailed or manual quotation | Done; 6 + real-DB scenario pass; not yet clicked through in the browser |
| 14 | Cancelling a PO: never edited after ordering (change = cancel + re-order); Purchase asks (reason list + whose side + note, each request back to RFQ/PO or "no longer needed"), the Company Admin approves in PO Approvals; full cancel, or short close of the lines not received; requests and item cards reopen, still-valid quotes revive (this vendor's only if our side), invoice cancelled / reduced (never deleted) + vendor credit for what was paid, ledger reversal if ever posted, vendor emailed; cancelled lines can't be received. Also fixed: Cancelled invoice flipping back to Unpaid, RFQ/PO picking up Store-rejected requests, Dispatch showing cancelled POs | Done; 8 + 8 real-DB tests pass; not yet clicked through in the browser |
| 15 | PO audit log: every step of a PO (created / sent for approval / approved / rejected / emailed / email failed / cancel asked / cancelled / short closed / cancel refused / line received / fully received) with who, role, IP, time and a plain sentence; can't be edited or deleted; Audit Log tab (search, filter, dates) for the Company Admin and Purchase users with the new "Purchase Audit Log" permission; History timeline per PO; Company Admin tabs grouped into Vendors / Purchase Orders / Settings with summed badges | Done; 8 real-DB tests pass; not yet clicked through in the browser |
| 16 | Store expected receipts + delivery follow-up (no vendor acknowledgement, by decision): Store notified when a PO becomes real; Overdue / Due today / Due in 3 days chips and per-line due badges on Store's To Receive and Purchase's Active POs; daily overdue alert to the PO's creator, once per date; "Change date" with a required reason keeps the line's delivery history, tells Store and is audited; vendor score still uses the original date | Done; 5 + 5 real-DB tests pass; not yet clicked through in the browser |
| 17 | RFQ/PO: vendor card shows rating · on time n/N (%) · QC pass n/N (%) · Probationary / Watchlist / High risk; an expanded item card shows "Quotes compared" — every vendor's current quote side by side (rate, GST, with GST, line total, delivery, validity), lowest usable marked, others +n% | Done; real-DB check passes; not yet clicked through in the browser |
| 18 | Quote reminders: daily "Quotes to follow up" per person — no reply after 3 days, link ran out, quote expiring within 2 days (each said once); a Remind button re-emails the vendor the same link as a reminder, at most once a day; never automatic to the vendor (decision) | Done; 4 + 4 real-DB tests pass; not yet clicked through in the browser |
| 19 | CGST + SGST vs IGST: worked out from the company's and the vendor's GSTIN (state name as a fallback), fixed on the PO when created, shown on the PO review / Purchase Orders / Company Admin cards / PO email, carried to the invoice; Vendor Master gets a state list and a GSTIN check (refuse malformed, warn on state mismatch); company GSTIN checked on edit too | Done; 5 + 2 real-DB tests pass; not yet clicked through in the browser |
| 20 | Security: the vendor's quotation link is no longer shown or copyable on our side — it only goes to the vendor's email (anyone with it could submit prices as the vendor); a failed email → send again or use Manual quotation | Done; tests pass; check in the browser that the dialog has no link |
| 21 | RFQ/PO: rows pre-ticked only for a vendor not yet asked; Email quotation request offers "Only items that need a quote" (new / expired / old quantity / no reply) or "All ticked items"; a manual price needs a reason only over a still-valid quote (expired / old-quantity replacements are noted automatically) | Done; tests pass; check in the browser |
| 22 | Accounts Slice 1: the PO bill (advance fixed when the PO is placed; due date only after full acceptance + credit days; stage), advance payment on Vendor Payment (capped), delivery days start when the whole advance is paid (Waiting for advance until then; PO email says days after advance), purchase ledger accounts per company + unit (advance, manual bills and their payments post), payment history list, TDS removed from manual bills, manual-bill payments capped at what is owed | Done; 49 + 9 real-DB tests pass; not yet clicked through in the browser |
| 23 | Accounts Slice 2: a QC pass makes purchased material payable on the PO bill (its share of the line × the part passed) and posts it to the ledger, once per job; optional mid payment up to what passed less its advance share; full acceptance (every live line received + QC-passed) sets the due date (credit days), posts the charges, sets off the advance, tells Accounts; full payment → Paid; daily 9:40 overdue sweep; Payable Ageing by due date | Done; 22 + 8 real-DB tests pass; not yet clicked through in the browser |
| 24 | Accounts Slice 3: a QC rejection of purchased material becomes a REJ record waiting for the vendor's answer (no automatic return / exchange email); replace (replacement on the same PO line, received + QC'd there), refund (Refund due → received), credit (used on a later payment), refused (written off, dispute, Watchlist 90 days); full payment waits for open rejections; cancel / short close on the PO bill (no reversal, leftover advance "To decide" → refund or credit); Refunds & credits + pay from credit on Vendor Payment; QC Rejections pages | Done; 16 + 11 real-DB tests pass (Slices 1–2 re-run green); not yet clicked through in the browser |
