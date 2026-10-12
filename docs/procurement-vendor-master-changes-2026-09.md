# What changed — Procurement redesign: Vendor Master

First step of the Purchase / Vendor Management redesign. 2 changes so far, built and checked,
not yet tried live in the browser.

---

## 1. Vendor Master — Products and Services, picked from real data

**Where:** Accounts → Purchases → Vendor Master (Add / Edit Vendor).

**How it worked before:** a vendor's "Categories" were free-text tags, typed by hand ("Raw
Material", "Heavy Machinery"). They weren't linked to any real item or process. So the system
couldn't answer "which vendors can supply this item?" or "who can do this job work?", beyond
guessing from words.

**How it works now:** the Vendor Categories section on the form has three tabs.
1. **Products:** tick the actual items this vendor sells us. The list contains every item
   marked **Purchasable** in Inventory, Product Master or Motor Master. Child Parts and Sub
   Child Parts are not listed: the BOM creates them in-house, and what they need from a
   vendor is outsourced job work, which is the Services tab. If a finished part ever needs
   buying outright, it can be added as a plain Inventory item. Links are kept by item, so
   renaming an item doesn't break them.
2. **Services:** tick the job work this vendor does, from BOM Management's Process Templates
   (e.g. laser cutting, drilling, welding). A service matches that step name at every BOM
   level (Sub Child Part, Child Part, Machine) wherever a BOM marks the step **Out Source**.
   Each step shows which parts actually outsource it today, e.g. "Out Source in: Fan Blade,
   Chamber frame, c channel". Steps no BOM outsources yet are marked as such, since Process
   Templates themselves don't say in-house or out-source.
3. **Tags:** the old free-text Categories, kept as they were. The RFQ module still uses them
   to suggest vendors.

The vendor cards on the page now also list the vendor's Products and Services.

**Kept as-is for now (decided with the user):** the old Categories tags and the 1–5 rating
stay on the form. Credit limit / credit days and the Payment Terms question are parked.
Vendor performance (on-time %, reject rate) comes later: it needs PO delivery dates and
receiving data that don't exist yet.

**Good to know:**
- A service is matched by its **name**, the same way BOMs store their steps. So a typo makes
  a different service: Process Templates currently have both "pre panting" (Child Part) and
  "pre painting" (Machine).
- Renaming a step in Process Templates doesn't change existing BOMs or vendors.

**Technical notes:**
- `Supplier.js`: new `suppliedItems` (Item ids) and `services` (step names).
- `supplierController.js`: new `GET /api/suppliers/catalog` returns the pickable items and
  steps; create/update clean both new fields.
- `VendorMaster.jsx`: the tabbed picker and card display.

---

## 2. Vendor Master — Payment Terms, Charges, GST, Rating, Bank Details (2026-10-03)

**Where:** Accounts → Purchases → Vendor Master (Add / Edit Vendor).

**Why:** Round 1 left Credit Limit / Credit Days and the Payment Terms question "parked" —
the user said it "should be dynamic" but what that meant wasn't clarified yet. This round
closes that out, plus adds the GST handling the client's brief asked for, and surfaces a
handful of fields that already existed on `Supplier.js` but were never wired into the form
at all (found by auditing the model against the actual form, not assumed).

**Payment Terms — now structured, not free text.** The old `paymentTerms` field (a single
free-text string, never actually shown on this form in the first place — confirmed by
reading the whole file, so nothing broke by dropping it) is replaced by real fields:
**Advance %**, **Balance %**, **Credit Days**, and a free-text **Payment Notes** for genuine
exceptions. This is what "it should be dynamic" turned out to mean — real numbers per vendor
instead of a single typed sentence.

**Credit Limit — new field.** Separate from Credit Days: Credit Days is the payment *window*
(Net 30, etc.), Credit Limit is the maximum ₹ this vendor can be owed at once. Stored now;
the actual warning/block behavior at PO time is still open — see "Open questions" below.

**GST Rate — new field, decided with the user.** Vendors can quote either GST-inclusive or
exclusive, and there's no single rule — it depends on the vendor. Decided: store the
vendor's own **GST Rate** here (separate from `gstNumber`, their registration id), and a
separate **inclusive/exclusive toggle lives on the Quotation screen later** (not built yet),
applied per quote. The same GST Rate covers both a Products (goods) purchase and Job Work —
job work is a taxable service, not GST-exempt, so it uses the identical field and logic, not
a separate mechanism.

**Purchase Charges — new, Products only.** A dynamic, "+"-addable list per vendor (Loading,
Packing, Inspection, etc.), each a flat ₹ amount or a % of order value. Confirmed scope:
**Products/goods purchases only** — Job Work only ever gets GST, no separate charges list.
These are defaults a future Quotation screen would pre-fill, editable per quote, not a hard
rule.

**Surfaced fields that already existed but had zero UI.** Audited `Supplier.js` against the
actual form and found several fields that were being saved on create/update (anyone hitting
the API directly could set them) but were never shown anywhere in `VendorMaster.jsx`:
**Rating** (1–5, now an editable dropdown and shown as stars on the vendor card), **PAN
Number**, **Alternate Phone**, and full **Bank Details** (account name/number, bank, branch,
IFSC) — the last one matters in practice, since it's what you'd actually need to pay a
vendor by NEFT/RTGS.

**Removed — Opening Balance (Dr/Cr).** Audited where it's actually used: nowhere. Grepped
the whole backend for any place `Supplier.openingBalance` is read back (not just written) —
zero hits, including the one place you'd expect it to matter, the Vendor Payments page's
Outstanding Summary (`getVendorOutstanding`, `purchaseInvoiceController.js`), which computes
outstanding purely from `PurchaseInvoice.balanceAmount` and never looks at it. It was dead
data — written on save, shown as a plain number on the card, consumed by nothing. Removed
from the schema, the form, and the card. If a vendor has real pre-ERP opening debt that needs
to count toward their Outstanding Summary, that's a different, real feature (wiring a
starting number into `getVendorOutstanding`'s total) — not this field, which did that for
no one.

**Technical notes:**
- `Supplier.js`: `paymentTerms` (String) removed; added `paymentAdvancePercent`,
  `paymentBalancePercent`, `creditDays`, `paymentNotes`, `creditLimit`, `gstRate`,
  `charges[]` (`{name, type: 'Flat'|'Percent', value}`). `openingBalance` removed.
  `rating`/`panNumber`/`bankDetails`/`alternatePhone` unchanged (already existed).
- `supplierController.js`: `cleanVendorCoverage` now also sanitizes `charges` (trim name,
  coerce type/value, drop blank rows) — same pattern already used for
  `suppliedItems`/`services`.
- `VendorMaster.jsx`: new Purchase Charges (dynamic array state), Payment Terms & GST, and
  Bank Details sections on the form; Rating dropdown added to the basic info block; vendor
  card shows rating stars and Credit Limit/GST Rate; Opening Balance input and display
  removed.

---

## Quick summary

| # | Change | Status |
|---|--------|--------|
| 1 | Vendor Master: Products (real Purchasable items) and Services (Process Template steps, matched to Out Source BOM steps) replace free-text-only categories; old tags kept | Done, not yet tested live |
| 2 | Vendor Master: structured Payment Terms (Advance/Balance %, Credit Days, Notes), new Credit Limit and GST Rate fields, Purchase-only dynamic Charges list, Rating/PAN/Alternate Phone/Bank Details surfaced in the form, dead Opening Balance field removed | Done, not yet tested live |
