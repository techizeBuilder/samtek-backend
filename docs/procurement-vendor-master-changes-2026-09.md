# What changed — Procurement redesign: Vendor Master

First step of the Purchase / Vendor Management redesign. 1 change so far, built and checked,
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

## Quick summary

| # | Change | Status |
|---|--------|--------|
| 1 | Vendor Master: Products (real Purchasable items) and Services (Process Template steps, matched to Out Source BOM steps) replace free-text-only categories; old tags kept | Done, not yet tested live |
