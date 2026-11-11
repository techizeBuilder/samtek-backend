# Make or buy + R&D Approval — browser test roadmap

*Written 2026-10-29. Run this **after all the client's procurement changes are done** (your call).
What was built: [make-or-buy-changes-2026-10.md](make-or-buy-changes-2026-10.md) (§1–§5); the
rules: [make-or-buy-parts-2026-10.md](make-or-buy-parts-2026-10.md). Automated tests already pass
(slices 1–4: 17 / 19 / 9 / 10, approval gate: 18, older price / cascade suites re-run).*

**How to use it:** go part by part, in order — each part sets up what the next one needs. Tick
the box when it matches; when it doesn't, tell me the step number and what you saw. Use your own
test data (dev); write down the codes you create in the table at the end.

---

## Part 0 — Set-up (once)

Pick or create, in dev:

| What | Needs |
|---|---|
| **Machine M** | Internal Manufacturing, a Machine BOM with Child Part **CP-A** (qty 1), Released |
| **Child Part CP-A** | Made, BOM with Sub Child Part **SCP-A** (qty 2), processes with a QC step, Released |
| **Sub Child Part SCP-A** | Made, source material + processes with a QC step, Released |

Note M's **cost (stdCost) and MRP** before you start — every price step below compares to it.

- [ ] 0.1 M, CP-A, SCP-A all show **Released** on R&D → Approval.
- [ ] 0.2 Write down: M cost ₹____ MRP ₹____; CP-A cost ₹____; SCP-A cost ₹____.

---

## Part 1 — The switch (R&D → Inventory → Sub Child Part / Child Part → Manage)

- [ ] 1.1 Open **Manage** on SCP-A: a **"Make or buy"** box with *Purchasable (Vendor) / Internal
  Manufacturing*, "Internal Manufacturing" selected.
- [ ] 1.2 Click **Purchasable** → an amber confirmation appears **before** anything changes. It
  says shortfalls will raise purchase requests, Accounts will be asked for a price, **and
  "Approvals: its QC List sign-off and Release will be pulled back…"** with what to redo.
- [ ] 1.3 **Cancel** → nothing changed (still Internal Manufacturing).
- [ ] 1.4 Switch again and confirm **"Yes, buy it"** → toast "Switched — re-approve it…".
- [ ] 1.5 The list row shows a **Bought · price pending** badge; the Manage box says "Price pending
  — Accounts has been asked…" and **"Needs re-approval after the switch — open the Approval
  page"** (the link works).
- [ ] 1.6 Notifications (bell):
  - **Accounts** (Head / Employee): "Estimated price needed — SCP-A …"
  - **Company Admin**: "SCP-A switched to Bought …" (machine cost effect if any)
  - **R&D** (Head / Employee): "Re-approve SCP-A — switched to Bought …" saying exactly what to redo
- [ ] 1.7 Switching to **Made** a part with no source material / processes is refused with what's
  missing (try it on a bought-from-day-one part in Part 2).

## Part 2 — Bought from day one (R&D → BOM Management)

- [ ] 2.1 **New Sub Child Part** → a "Make or buy" choice at the top. Pick **Purchasable** → Source
  Raw Material says "(optional while bought)"; Create works with **only name, code, design file**.
- [ ] 2.2 Same for **New Child Part** → Purchasable → created with no BOM lines.
- [ ] 2.3 Edit that bought Sub Child Part → a blue note "Bought from a vendor — source material and
  processes are optional…"; saving with no processes works.
- [ ] 2.4 Try switching it to **Made** (Inventory → Manage) → refused: "fill in its source raw
  material, how much…, its processes…".
- [ ] 2.5 Accounts gets "Estimated price needed" for both new parts.

## Part 3 — Price (Accounts → Purchase & Outsource → Inventory)

After Part 1 (SCP-A bought, never bought):

- [ ] 3.1 M's cost is **unchanged** (SCP-A's made cost stands in) and M is marked **price
  provisional** (see Part 4).
- [ ] 3.2 Purchase Inventory has new **Child Part** and **Sub Child Part** tabs; SCP-A shows
  **"Price pending — enter an estimated vendor price"** in amber.
- [ ] 3.3 Enter an estimate (e.g. ₹____ — pick something different from its made cost) → saved;
  the row shows "Estimate · date".
- [ ] 3.4 M's cost moves by **(estimate − SCP-A made cost) × 2** (CP-A uses 2), up through CP-A;
  MRP follows (cost × (1 + profit %)). The provisional mark clears.
- [ ] 3.5 **First real purchase** (Part 5) replaces the estimate: the row shows "Last purchase ·
  date" and M follows the real price (rate before GST + charges share).
- [ ] 3.6 Switch SCP-A back to **Made** → M goes back to the made cost (re-worked at today's
  material price). Company Admin's notification shows "M ₹old → ₹new".
- [ ] 3.7 Switch to **Bought** again → M uses the **last purchase** price at once; **no** "price
  pending" this time.
- [ ] 3.8 *(optional)* With SCP-A Made, receive an old PO for it → its bought cost updates
  (Purchase Inventory) but **M doesn't move**.
- [ ] 3.9 **Machine radio:** on Product Master switch a made Machine (no purchase price) to
  Purchasable → Accounts gets "Estimated price needed — <machine>"; it shows price pending.
- [ ] 3.10 **Daily reminder** (09:30): Accounts gets "N prices still pending" while any stay
  pending. *(Wait a day, or skip.)*

## Part 4 — Sales sees "Price provisional" (warned, never blocked)

While SCP-A (or CP-A) is price pending:

- [ ] 4.1 **Product Master** (R&D and Store's tab) → M's detail shows an amber **"Price
  provisional — SCP-A purchase price isn't set yet."**
- [ ] 4.2 **Lead quotation** (Sales → Leads → quotation) → add M → a **"Price provisional"** tag on
  its row; the quotation can still be sent.
- [ ] 4.3 After sending → the lead's history says "Quoted on a provisional price: M (…)".
- [ ] 4.4 **Order form** (M/C code M) → the billing hint shows the provisional warning; the order
  can still be saved.
- [ ] 4.5 After Accounts' estimate (3.3) → all three warnings are gone.

## Part 5 — Purchase and Store

- [ ] 5.1 **Vendor Master → a vendor → Products & Services** → SCP-A is listed (label "Sub Child
  Part"); a **made** part is **not** listed.
- [ ] 5.2 Link SCP-A to a vendor → raise a purchase request / RFQ / PO for it as for any item.
- [ ] 5.3 Store receives it → QC (Part 6) → stock goes up; Purchase Inventory shows the price
  "Last purchase".

## Part 6 — QC (R&D → Sub Child Part / Child Part QC)

- [ ] 6.1 The part's QC page has a new **"Incoming (bought)"** card under the step checklists,
  tagged "In use — this part is bought" (or "Used when it's bought" for a made part).
- [ ] 6.2 **Manage incoming master list** → add a check (e.g. "Hole spacing") → **Choose checks**
  on SCP-A → it shows in the card.
- [ ] 6.3 Store's receive of SCP-A (5.3) → the QC job's checklist is the **Incoming** list, not the
  build steps.
- [ ] 6.4 A **made** part's QC job still uses its step checklists.

## Part 7 — R&D → Approval (`/r&d/design-approval`)

After the switch in Part 1:

- [ ] 7.1 The **Sub Child Part tab** shows an amber **count**; an amber bar "N part(s) switched make
  ↔ buy need re-approval" with **"Show only these"** (filters the list; "Show all" undoes it).
- [ ] 7.2 SCP-A's row: "· Bought from a vendor", Design / BOM chips **n/a**, chip **"QC List
  (Incoming) · Pending"**, Release **Not Released**, and the amber "Needs re-approval — switched
  to Bought by … on …" banner.
- [ ] 7.3 **Manage** → the banner with the steps + a blue note "Bought from a vendor — only its
  Incoming (bought) QC List…"; no Design / BOM stages.
- [ ] 7.4 **Approve QC List** before the Incoming list has rows → refused ("The Incoming (bought)
  checklist has no rows — set it on R&D → QC"). After 6.2 → approves.
- [ ] 7.5 **Release** → works; the banner, the tab count and the bar disappear.
- [ ] 7.6 **Parent:** CP-A (made, with bought SCP-A inside) — Design / BOM approve without SCP-A
  having any; CP-A can't be released while SCP-A isn't (blocker list names it).
- [ ] 7.7 Edit SCP-A's **step** checklist while it's bought → its Incoming sign-off stays. Edit its
  **Incoming** list → the sign-off resets (and Release is pulled back), as for any checklist edit.
- [ ] 7.8 Switch SCP-A back to **Made** → banner again, now asking for its **build checklists**
  (Design / BOM kept as they were) → approve QC List → Release → banner gone.

## Part 8 — Production (automatic orders)

- [ ] 8.1 SCP-A **bought, not yet released** → a CP-A production order short of SCP-A raises
  **no** purchase request (and no build order).
- [ ] 8.2 After SCP-A is **released** → the same shortfall raises a **purchase request** for the
  short qty (Store's order badge lists it under "needs purchase"), **not** a Sub Child Part build
  order.
- [ ] 8.3 Same one level up: CP-A bought + released → a Machine order for M short of CP-A → a
  purchase request, no Child Part build order.
- [ ] 8.4 A bought part with **Material Flow + min stock** set (Manage) and stock below it → the
  low-stock job raises a purchase request (only once released).
- [ ] 8.5 Switching while a **build order** is open → it finishes as it is; while a **PO** is open →
  it is still received.

---

## Test data used

| Code | What | Notes |
|---|---|---|
| M | | |
| CP-A | | |
| SCP-A | | |
| new bought SCP | | |
| new bought CP | | |

## Results log

| Date | Parts done | Issues found → fix |
|---|---|---|
| | | |
