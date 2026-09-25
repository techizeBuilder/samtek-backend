# Production Orders redesign — plain-language report

Single report covering every change made so far in this initiative, in the order it was built.
More steps are planned on top of this — this file will keep growing as those land, rather than
splitting into a new file per step, so there's always one place to read the whole picture.

**Status: 2 steps done so far.**

---

# Step 1 — Orders list: one row per real order instead of one per machine

## How it worked before

**Where:** Production → Orders (`/production/orders`).

Behind the scenes, one machine's entire build (its process pipeline, BOM/design checks, material
demands, QC, rework — everything) lives in its own database record. When a real sales Order
contained several different machines, that meant several separate records, all tagged with the
same real Order ID.

The Orders list showed **one table row per record** — so one Order with 3 different machines
showed up as 3 separate rows, each with its own Priority, Status, BOM/Design check, Progress bar,
and Delivery date, and its own "View" button. There was no way to see "this Order has 3 machines"
at a glance — you'd only notice by spotting the same Order ID repeated across several rows.

## How it works now

**Grouping:** The list now shows **one row per real order**. If an order has 3 machines, those 3
machines collapse into a single row. An order with just one machine, or a Stock/company-use entry
that was never tied to a customer order, still shows its own row exactly as before — nothing
changes for the common single-machine case.

**Machine column:** Instead of one machine name, the row shows the first machine plus a "+2 more"
badge (for a 3-machine order). Hovering over it opens a small popup listing every machine in that
order by name and code, so nothing is hidden — you just don't need 3 rows to see it.

**Priority column:** Priority is really a property of the whole order (every machine in an order
was raised together, at the same priority), so it's shown once per row instead of once per
machine.

**Status column:** Shows a breakdown across the machines in that order — e.g. "1 Completed · 2 In
Progress" — instead of one status that could only describe a single machine.

**BOM / Design column:** Same breakdown idea — e.g. "2/3 BOM ✓" instead of one ✓/✗ that only ever
described one machine.

**Progress column:** Shows which machine the shop floor is currently working on and how far along
it is — e.g. **"1/3 · 80%"** means: of the 3 machines in this order, the 1st one is the one
currently active, and it's 80% through its build. Once a machine finishes, the bar automatically
moves on to the next one; once all machines are done, it settles on the last one at 100%. (Which
machine is "1st", "2nd", etc. follows the order they were added on the original Order Form.)

**Action button:** "View" is renamed **"Plan"**. Clicking it opens a popup showing:
- The order's informative summary (machine count, priority, delivery date, overall progress, and
  the same status breakdown as the row).
- A clickable list of every machine in the order — clicking one now goes to the Process Execution
  page (see Step 2 below).

**Pagination fix (behind the scenes):** Before this change, the list's "page 1 of N" counting was
based on machine-records, not real orders. Grouping on top of that without fixing it would have
let one order's machines split across two different pages inconsistently. This was fixed at the
same time — pagination now counts real orders, so an order's machines always land together on one
page.

## What did NOT change

- How an individual machine's production is tracked, worked on, or QC'd — completely untouched.
- Job Cards and the Process & QC picker, which read the same underlying data in their own way —
  neither was touched; they still see the exact same per-machine list they always have.
- Every other page/action on Production Orders (Add Order, Material Demand, Issue/Return
  Material, Export PDF, etc.) — unchanged.

---

# Step 2 — Process Execution redesign (step 1): BOM/Design auto-verify, no more per-order R&D request

Scoped to exactly what was asked for this pass: the informative summary + the new BOM/Design flow
on the Process Execution page. Everything else on that page (the sequential process steps,
Machine/Unit tabs) is unchanged; folding in Material List and the rest of Order Management's
per-machine view is a later step, not part of this one.

## 1. Clicking a machine now opens Process Execution, not a popup

**Before:** clicking a machine in the Orders page's "Plan" popup (Step 1 above) opened an in-page
detail dialog right there on the Orders page.

**Now:** it navigates to Process Execution (`/production/process-execution`) with that machine's
Production Order pre-selected. The old in-page detail dialog's code (Material List, Issue/Return
Material, Add Demand, Rework/Repair) is untouched and still there, but nothing on the Orders page
opens it anymore now that the Plan popup's machine click goes to Process Execution instead — it'll
be folded into the new page (or given a new way in) in a later step, not this one.

## 2. Process Execution's top section is redesigned

**Before:** a single-line summary (machine name, code, priority, delivery date, status) plus a
progress bar, and a static "Design or BOM not verified — go to Order Management" message with no
action available on this page itself.

**Now:** the top of the page shows informative tiles (Quantity, Priority, Received, Delivery) the
same way Order Management's own per-machine view used to, followed by a proper BOM & Design
section — see next point. The sequential process steps below are exactly the same as before.

## 3. BOM & Design — no more raising a request on every order

**Before:** every Production Order needed its own "Raise R&D Request" click, and R&D had to
manually approve that specific request (on `/r&d/approve-requests`) before BOM/Design counted as
verified — even when the exact same machine's BOM had already been locked and its design already
approved for some other order.

**Now:** Process Execution checks live, every time the page loads that order:
- Is the machine's BOM **locked** (R&D → BOM Management)?
- Is the machine's design status **Approved** (R&D → Design Approval)?

If both are true, the order is automatically marked BOM/Design Verified — Production never has to
ask. It shows two green "Verified" tiles instead, each with **View** and **Download**:
- **BOM** — View opens the same BOM PDF inline; Download saves it.
- **Design** — since a machine can have several design files, View/Download opens a small picker
  first, listing every file. Files are tagged exactly the way Design Approval already tags them —
  a purple "BOM Part" badge for a Child/Sub Child Part's own image, a version tag for a general
  R&D upload — so what Production sees matches what R&D actually approved.

If either isn't ready yet, nothing changes from before: the "Raise R&D Request" button is still
there, R&D still reviews it on `/r&d/approve-requests`, same as always.

## 4. R&D's Approve Requests page — one thing stopped

**Where:** `/r&d/approve-requests` (still the fallback approval queue for the "not ready yet" case
above, plus its separate, untouched "Material Change" tab).

**Before:** approving an "Initial BOM" request there did three things at once: snapshotted the
design files onto the Production Order, marked BOM/Design Verified, **and** pushed every BOM line
onto the order as a material demand — which is what fed Store's own separate "material transfer"
queue.

**Now:** it still does the first two. The material-demand push is removed — materials were already
being read live, direct from the locked BOM, everywhere Production actually uses them (the
Material List you already had), so this was a second, redundant path feeding Store the same
information a different way. Store no longer gets that duplicate transfer request from this step.

## What did NOT change

- The sequential process steps (Job Work → Fabrication → Assembly → Painting → Re-Assembly →
  Final Testing), Machine/Unit tabs, QC approve/reject, notes — all untouched.
- The "Material Change" request type on `/r&d/approve-requests` — a completely separate feature,
  untouched.
- Order Management's own per-machine dialog (Material List, Issue/Return Material, Rework/Repair)
  — code untouched, just not currently reachable from the Orders page's own UI (see point 1).

---

## Quick summary

| # | Change | Status |
|---|---|---|
| 1 | Orders list groups multiple machines of the same real order into one row | Done |
| 2 | Machine column shows the full list on hover | Done |
| 3 | "View" renamed to "Plan"; opens order summary + clickable machine list | Done |
| 4 | Priority shown once per order; Status/BOM/Design/Progress shown as a breakdown across machines | Done |
| 5 | Pagination now counts real orders, not machine-records | Done |
| 6 | Plan popup's machine click now opens Process Execution instead of a local popup | Done |
| 7 | Process Execution's top section redesigned with informative tiles | Done |
| 8 | BOM/Design auto-verify when already locked/approved — no request needed | Done |
| 9 | Design file picker, categorized like Design Approval (BOM Part / General) | Done |
| 10 | Fallback "Raise R&D Request" flow unchanged for the not-yet-ready case | Done |
| 11 | R&D's Initial BOM approval no longer pushes a material transfer request to Store | Done |
