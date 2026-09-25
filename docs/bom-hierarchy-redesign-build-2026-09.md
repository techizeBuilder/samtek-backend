# BOM hierarchy redesign — build log

Plain-language writeup of what's been built so far on the corrected Sub Child Part /
Child Part / Machine hierarchy (see `bom-hierarchy-redesign-2026-09.md` for the full
design this is built against).

**Part 1** — the rename that frees up the "Sub Child Part" name, plus the new Sub Child
Part itself and its Inventory screens, and the Sheet Metal Plan re-home. **Part 2**
(§5–§6 below) — making Child Part genuinely standalone: the new Child Part Master
catalog + BOM, and a from-scratch rebuild of Child Part Inventory. Still not part of
either pass: the low-stock reorder cron's still-old pipeline shape, and Machine BOM
referencing Child Parts instead of its flat material list — see "What's next" below.

---

## 1. Renaming what was built as "Sub Child Part" to "Child Part"

**Why:** as agreed after the client meetings, everything built earlier under the name
"Sub Child Part" (the stockable part, its Job Work → Fabrication → Assembly → Painting
pipeline, its QC checklist system, its material handshake) was correct in how it works —
it was just anchored one hierarchy level too low. It's really a **Child Part**. Renaming
it frees up the name "Sub Child Part" for the real, new, smaller thing underneath it.

**What changed:** every place that stored or checked `productKind: 'SubChildPart'` (on
an Inventory Item) or `orderKind: 'SubChildPart'` (on a Production Order) now uses
`'ChildPart'` instead. This is a label change only — nothing about how Child Part
behaves changed: the same pipeline, the same reorder cron, the same QC checklist system,
the same material Issue/Receive/Return flow all keep working exactly as before, just
under the corrected name. The 8 existing test items (Chamber Frame, Blower Body, Fan
Blade, etc.) and their 3 existing production orders were migrated in the real database
to the new label — nothing was lost or reset.

**Where it's visible:** R&D Inventory's "Sub Child Parts" tab is now labelled **"Child
Part Inventory"** (same screen, same data). Production's Orders page and Process
Execution's Machine/Unit toggle now say **"Child Part Orders"** instead of "Sub Child
Part Orders". Store's Material Handshake badge on a Child Part order now reads "Child
Part" instead of "Sub Child Part".

---

## 2. Sub Child Part Master — the new node (BOM Management)

**Where:** BOM Management (`/r&d/bom-management`) now opens on a top-level tab switch:
**"Sub Child Part Master"** and **"Child Part / Machine BOM"** (the second one is
everything BOM Management already did — pick a product, then Child Part Creation / BOM
Creation, completely unchanged). Sub Child Part Master needs no product selected — it's
a standalone catalog, not scoped to any machine or Child Part.

**How it works:** "New Sub Child Part" opens a form:
- Name, Code (auto-suggested, e.g. `SCP-001`), Specification
- **Source Raw Material** — pick one existing Inventory item (search by code/name), plus
  how much of it one Sub Child Part unit consumes (qty + unit). Always exactly one
  material, per what the client confirmed — this is not a multi-material BOM.
- **Job Work — Outsourced** toggle: on means Purchase sends it to a vendor; off means
  Production builds it in-house.
- **Job Work Type(s)** — multi-select, required either way (it describes the operation
  itself — e.g. Laser Cutting, Bending — not just who performs it). Pulled from the same
  Job Work Type list Inventory's own Item form already uses.

Saving creates a real Inventory Item (`productKind: 'SubChildPart'`) behind the scenes —
same "one form, Item auto-created" pattern Child Part already uses; there's no separate
step to go create it in plain Inventory first. The list below the form shows every Sub
Child Part with its source material, Job Work status, and current stock, with Edit and
Discontinue actions.

## 2b. Sub Child Part Master — fixes after first review

You caught four real gaps once you actually used the form:

1. **No unit-aware label on the amount field.** The old BOM material picker shows "Area
   Used (Centimeter Square)" / "Length Used (Inch)" — Sub Child Part Master just had a
   generic "Qty per unit" box. Fixed by reusing the exact same field the BOM picker uses
   (`UnitAmountField`): once you pick a source material, the amount box now labels
   itself correctly based on that material's real Used Unit (Area/Length/Volume), or
   shows a plain "Qty per unit (kg / Pieces / …)" box for a Mass/Count material.
2. **No dimension-size picker for a Fabrication Master source material.** If the picked
   material has multiple catalog sizes (like the BOM's own sheet-metal/length picker),
   there was no way to say which one. Fixed by reusing the BOM picker's own
   `FabricationVariantAmountFields` — same radio list of catalog sizes, same amount box
   underneath.
3. **Bug: reselecting the source material without closing the dialog kept the old unit.**
   The unit only updated on the *first* pick; picking a second material afterward left
   the previous material's unit stuck. Fixed — every field derived from the source
   material (unit type, unit, dimension list, amount) now fully resets on every pick,
   not just the first.
4. **Job Work Type was read-only static list.** It correctly pulled from the same
   dynamic, "+"-addable list Inventory's Item form uses, but this form had no way to
   *add* a new one — you were stuck with whatever already existed. Fixed with a "+"
   button next to the chips that adds a new Job Work Type on the spot (same
   `/api/inventory/master-options` catalog everything else already writes to).

Also added: which catalog dimension size was picked is now actually saved
(`subChildPartDetails.sourceDimensionVariantId`) — needed so a fabrication-sourced Sub
Child Part remembers its exact cut, not just its source item.

## 2c. Second review pass — UI polish, pricing, design file, BOM Format

- **Dialog widened** (`max-w-lg` → `max-w-2xl`), the "+" Job Work Type button and its
  heading are now properly sized/visible.
- **Design File upload** — genuinely missing before (the field was being sent to the
  API but there was no upload control at all). Added the same Image/PDF upload Child
  Part already has, reusing its existing upload endpoint. Required on create, and on
  edit if you clear it you have to re-upload before saving — a Sub Child Part must
  always have one, same as Child Part.
- **Price (auto) preview** — same live "₹X (auto — Price)" box Add Raw Material shows,
  now on this form too, computed the same way (unit price × amount, or the resolved
  Fabrication weight × ₹/kg).
- **"Additional Details" panel** — once BOM Format & Modification has some fields
  enabled, this form now shows them for the picked source material (Brand, Grade,
  etc.), the same way a raw material line in a BOM does.
- **BOM Format & Modification itself moved** — its button (and the dialog that edits
  it) used to live only inside the old BOM Creation tab; now it's on BOM Management's
  main header, so it's reachable from any tab. It's one global config, not per-tab.
- **Cost card** — new, shown once a Sub Child Part exists: Materials Cost (from the
  Price preview above), a manual **Job Work Cost** you type in and save, and Total
  Cost. Confirmed manual-only for now — the automatic version (pulled from a real
  Purchase PO if outsourced, or a real Production build if in-house) needs those
  flows to exist first, which they don't yet. This is the base the future 3-level
  cost roll-up (§6 of the design doc) will sit on.
- **Pricing shape confirmed correct**: Sub Child Part's own form stays a single Amount
  field (no separate pieces/Qty multiplier) — confirmed with the client 2026-09-13
  that the "how many of this Sub Child Part" quantity belongs on the *Child Part's*
  material line when it references this Sub Child Part, not here.
- **Documentation.jsx** — confirmed there's nothing to disconnect yet: it only ever
  pulled Child Part design files in via the old per-machine query, which the new Sub
  Child Part has no relation to. Its design file stays visible only from BOM
  Management / Inventory for now. Target shape for later (once Machine BOM → Child
  Part and Child Part → Sub Child Part references both exist): a Machine's
  Documentation view resolves design files by walking those references, not the old
  embedded per-machine structure.

## 2d. Third review pass — edit-load bug + list/view redesign

**Bug fix, confirmed against the real database.** Editing a fabrication-sourced Sub
Child Part (e.g. Fan Blade, cut from sheet metal) showed the amount as `0` and
blocked Save, even though the correct amount (`20`) was safely stored. Root cause:
the same "does this need an Amount field" check that was already fixed twice
elsewhere in this form was missed a third time in the Edit-loading code, so the
saved value loaded into the wrong internal field. The data was never at risk — this
was purely a re-display bug, now fixed the same way as the other two.

**List/browse redesign**, to match the rest of R&D's "master list" pages (BOM
Creation's material table) instead of the card-style list from the first pass:

- A **"Select Sub Child Part" dropdown**, styled identically to BOM Management's own
  "Select Product" dropdown, now sits above the table.
- Picking one **drills into it** — a summary card (name, code, status, Edit/
  Discontinue buttons) plus a Cost card appear above the table. **Job Work Cost
  editing moved here**, inline on the page (type a number, hit Save) — matching
  how Machine BOM's own Production Cost is edited (inline, not inside a
  create/edit popup), instead of living inside the New/Edit dialog. The table below
  is unaffected by this selection — it always lists every Sub Child Part.
- The **list is now a real table** — Code, Name, Source Material, Job Work, Stock,
  Status, Actions — matching BOM Creation's table shape. Confirmed no R&D
  "master list" page anywhere in the app uses a dropdown/kebab menu for row
  actions, so Actions stays individual icon buttons (View / Edit / Discontinue),
  same as everywhere else.
- **Materials Cost is now computed server-side and stored**, reusing the exact same
  weight/pricing calculation the BOM's own material lines already use (not a new
  formula) — so it's available for the table, the drill-down card, and the new View
  dialog without needing the create/edit form open. Verified against the real Fan
  Blade record: ₹3.6 (0.024 kg/piece × ₹150/kg), matching what was already shown
  live in the form.
- **New "View" dialog** (the eye icon) — genuinely missing before. Shows the core
  facts (source material, amount, Job Work, cost, stock) plus the "Additional
  Details (from BOM Format & Modification)" panel — which now lives **only** here,
  removed from the New/Edit dialog per your instruction that BOM Format data should
  only ever appear in the view, never the creation form.

## 2e. Fourth pass — accordion list, pagination, BOM Format restored everywhere

Trying out the dropdown showed it wasn't adding much — with nothing picked it just
showed the same full list anyway — so this pass replaces it with a better shape:

- **No more dropdown.** The list is the page now.
- **Each row is collapsible** — collapsed shows just a plain summary (code, name,
  source material, Job Work, stock, status) with **no action buttons at all**.
  Clicking a row expands it in place to the exact same content the dropdown used
  to show once you picked something: image, name/code, status, **Edit** /
  **Discontinue** buttons, and the Cost card (Job Work Cost typed and saved right
  there, Materials/Job Work/Total tiles).
- **Pagination added** (20 per page), same Previous/Next pattern already used on
  the QC Jobs page. The separate read-only Inventory-tab view of Sub Child Parts is
  untouched — it still gets the full unpaginated list, since pagination only
  switches on when this page specifically asks for it.
- **BOM Format & Modification data restored to Create and Edit** — this reverses
  part of the previous pass. It had been made view-only per an earlier instruction;
  now it shows in all three places: Create, Edit, and a **View** button (see next
  point).

**One more adjustment right after this pass**: the "Additional Details" panel
looked cramped sitting inline in the expanded row, so it moved back out into its
own dialog — a **View** button now sits next to Edit/Discontinue in the expanded
row, opening a popup with every detail (source material, amount, Job Work, stock,
specification, status, all three cost figures) plus that Additional Details panel.

## 3. Sub Child Part Inventory — the new tab

**Where:** R&D Inventory (`/r&d/inventory`) — now three tabs: **Inventory**, **Child
Part Inventory**, and the new **Sub Child Part Inventory**. Mirrored read-only on Store's
Inventory page (`/store/inventory`) as a 5th tab, same as Child Part Inventory already
is.

**How it works:** lists every Sub Child Part with its source material, Job Work
type/status, and stock. The **"Flow"** button opens the same Manage Stock dialog Child
Part Inventory already has — Material Flow (High/Medium/Low), Min Stock, Order Quantity.
Discontinue/Reactivate works the same way too.

**Flow dialog now also carries the Sheet Metal Plan** for a sheet-metal-sourced Sub
Child Part — see §4 below.

---

## 4. Sheet Metal Plan — moved onto Sub Child Part

**Why:** the old Sheet Metal Plan lived on the Machine BOM, treating sheet-metal cutting
as a cross-part, whole-BOM layout problem. Now that sheet metal is understood as one Sub
Child Part's own job-work material, the plan belongs there instead — one Sub Child Part,
one current cutting plan.

**Where:** R&D Inventory → Sub Child Part Inventory → **Flow** button opens Manage Stock
same as before; if the row's source material is a Fabrication Master (sheet metal) item,
a new **Sheet Metal Plan** section appears in that same dialog.

**How it works — same real-world shape the Machine BOM's own Sheet Metal Plan already
had** (a real physical-sheet list, not a single combined guess), reused unchanged, with
one new number added:

- **Order Qty** — how many Sub Child Part units this specific cutting run/laser file
  covers (e.g. "20"). This is the one thing a Sub Child Part doesn't have that a whole
  BOM does (multiple lines to aggregate a required area from) — Order Qty is what turns
  "this Sub Child Part's own per-piece area" into "area actually required for this run."
- **Sheets** — same repeatable Length × Width (+ unit) rows as before, one per physical
  catalog sheet you're actually buying, with the same live fit-check against the source
  material's catalog size and "+ Add Sheet" / remove.
- **Laser File** — same required upload as before.
- On Save: **Avg scrap cost per piece** is computed (the same scrap-weight-based cost
  math the Machine BOM version already used, now divided by Order Qty) and shown right
  there, plus the same "cutting area → N sheets" result line and an advisory warning if
  the sheets you entered come in under what this Order Qty actually needs.

**Where the scrap cost shows up** (per your instruction — "will show in inventory as
well in the sub child part bom with a top card list like the job work cost"):
- The Flow Management dialog itself (summary line once a plan exists).
- Sub Child Part Master's own Cost section (BOM Management) — a new **amber "Scrap Cost
  (Sheet Metal)" tile**, same style as the Machine BOM's own tile, sitting alongside
  Materials Cost / Job Work Cost / Total Cost (Total Cost now folds it in). Only appears
  for a sheet-metal-sourced Sub Child Part — a non-sheet-metal one keeps its plain
  3-tile grid. Same tile (plus updated Total) also shows in the View dialog.

**Still not built:** the reorder cron / auto-raised Purchase or Production order from a
low-stock Sub Child Part — explicitly out of scope for this pass, same as everywhere
else in this redesign; the whole new BOM is being finished first.

---

## 5. Child Part Master — the new standalone node (BOM Management)

**Where:** BOM Management now has a third top-level tab, **"Child Part Master"**, sitting
between "Sub Child Part Master" and "Child Part / Machine BOM (Legacy)" — matching the
hierarchy order. Deliberately a fresh, separate catalog: only Child Parts created here
ever show up in this tab or its dropdown. Child Parts from the OLD per-machine flow
(Chamber Frame, Blower Body, etc.) stay exactly where they are, visible only in the old
tab — confirmed with you as the intended boundary, since both flows happen to write the
same underlying `Item.productKind: 'ChildPart'`, and mixing them together in one screen
would be confusing, not helpful.

**How it works:**
- **"New Child Part"** opens a form: Name, Code (auto-suggested `CP-001`), Specification,
  Design File — then, right there in the same dialog, you can **Add Sub Child**, **Add
  Material**, and **Add Tool** to seed its full composition before it's even created.
- **Add Sub Child** is a new kind of picker — not a dropdown. It opens a card grid (design
  image + name + code) of every existing Sub Child Part; click any number to select them,
  hit Next, then type a quantity for each one on a small confirmation table, then Add.
- **Add Material** / **Add Tool** work exactly like the Machine BOM's own material picker
  (search Inventory by code/name, quantity, the same Area/Length "Amount" fields for
  fabrication or Length/Area/Volume items) — Tool is just the same picker filtered to
  items whose Item Type contains "Tool", same convention the Machine BOM already uses.
- Once created, the same three "Add" actions are available again from the Child Part's
  own drill-down screen (pick it from the "Select Child Part" dropdown) — so a Child
  Part's composition keeps being editable after creation, not just at the start. You
  caught this yourself: an earlier version of the plan only allowed adding Sub Child
  Parts during creation, with "no way to update child part with sub child part"
  afterward — fixed before anything was built.
- The drill-down shows two cost tiles — **Total Cost** (Sub Child Parts + Materials +
  Tools + Production Cost/Expense, all rolled up) and **Production Cost** (the same
  manual Production Cost/Expense card the Machine BOM has, for assembly labor) — then
  three always-visible tables: **Sub Child Parts**, **Materials**, **Tools**, each with
  its own Add button and Edit/Delete/Discontinue-Reactivate actions. Deliberately three
  separate tables shown at once, not a tab switcher like the Machine BOM's Raw/Tool/Sheet
  Metal pills — you asked for this specifically.
- A Sub Child Part's line cost is pulled live from its own Materials Cost + Job Work Cost
  + Scrap Cost (Sub Child Part Master's own three cost fields, summed) every time you
  open the Child Part — so it never goes stale if those numbers change later.

## 6. Child Part Inventory — rebuilt

**Why:** you asked for this screen to be deleted and rebuilt, not patched — it had
carried a stale filename and stale internal naming since before the September rename,
even though (once actually audited) its own fields turned out to be fine. The real old-
model logic lives one layer down, in a **live, already-scheduled reorder cron**
(`subChildPartReorderService.js`, runs every 30 minutes) that still creates Production
Orders on the old 4-step pipeline (Job Work → Fabrication → Assembly → Painting) — that
cron and pipeline are confirmed **out of scope for this pass**; fixing them is its own
dedicated piece of work later.

**What changed:** the file itself is renamed and rebuilt (`ChildPartInventoryTab.jsx`,
was `SubChildPartInventoryTab.jsx`; Store's mirror renamed to `ChildPartTab.jsx`).
Columns you already had (Name/Code, Stock, Material Flow, Status, the Manage Stock/Flow
dialog) are unchanged — they were already correct. New:
- A **Source** badge — "Master" (from the new Child Part Master catalog) vs. "Old" (the
  per-machine flow) — since both kinds of Child Part now show up side by side here.
- **Used In / Composition** — an "Old" row keeps today's "Used In" (which machines
  reference it); a "Master" row instead gets a **Composition** summary — Sub Child Part /
  Material / Tool counts plus its Total Cost, with a link back into BOM Management to
  manage it further.

## 7. Machine BOM — the final node

**Where:** BOM Management now has a fourth top-level tab, **"Machine BOM"**, sitting
between "Child Part Master" and "Child Part / Machine BOM (Legacy)". Deliberately
parallel to the OLD per-machine flow, not a replacement — every manufacturing Machine is
still just one Item either way; only the BOM *document* is new. Select any manufacturing
machine (same list the Legacy tab's own picker uses) — if it has no new-flow BOM yet,
you get a plain "Create BOM" button (matching the old flow's own gate exactly), no fields
to fill in.

**How it works, once a BOM exists:**
- **Add Child Part** — the same card-grid multi-select + quantity-table picker Child Part
  Master's own "Add Sub Child" already uses, pointed at the Child Part Master catalog
  instead. **Add Material** / **Add Tool** — the same Inventory search-and-add pattern
  every BOM level already uses.
- Three cost/weight tiles — **Total Cost**, **Total Weight**, and **Production Cost** —
  then a Production Cost card (manual estimate, same shape as every other level), then
  three always-visible tables: **Child Parts**, **Materials**, **Tools**.
- **Download BOM** generates a PDF on demand (Child Parts table, Materials table, Tools
  table). **Lock BOM** does the same, plus saves the PDF to Documentation and freezes
  further edits — same mechanics as the old Machine BOM's own Lock, just a fresh, simpler
  PDF layout since Child Parts are now real references, not flat tagged rows.
- **The rolled-up Total Cost is written onto the machine's own price** (Standard Cost /
  MRP / Sale Price), confirmed with you as a carry-over from the old system — because
  Sales Order's minimum-billing check reads that same number. If a machine has both an old
  BOM and a new one, whichever you last edited or viewed wins — expected during migration,
  not a bug.
- **Total Weight** is new, top to bottom: Sub Child Part Master and Child Part Master both
  now compute and store their own weight (per-unit for Sub Child Part, rolled-up for Child
  Part) using the same weight math the old Machine BOM's own "Total Weight" tile already
  used — without that, the Machine's own weight had nothing to roll up from.

**Documentation — full cutover, not an add-on.** You asked for the old logic to be
removed and rebuilt, not patched. Every place that used to walk the OLD per-machine
Child Part structure to surface design-file images (Documentation's own page, Production's
BOM/Design check, Design Approval's queue) now walks the **new** Machine BOM → Child Part
→ Sub Child Part reference chain instead, in one shared, no-longer-duplicated place. The
real effect: a machine still on the legacy flow shows only its actual uploaded documents
in Documentation now — no more Child Part/Sub Child Part images pulled in from the old
structure. A machine with a new Machine BOM shows its Child Parts' and their Sub Child
Parts' own design files there instead, resolved fresh every time.

**Confirmed explicitly out of scope for this pass** (same boundary as every pass in this
redesign): wiring the new BOM into Production's Material Issue flow, Store's material
availability checks, QC's part-checklist tree, or Delivery Estimation — all of that keeps
reading the OLD Machine BOM exclusively for now; and any Purchase/Production-triggered
automatic recalculation for the new hierarchy — the new Machine BOM's cost only refreshes
on explicit edits and on view, never from a completed build or purchase invoice.

## 7b. Weight — actually shown, not just computed

The Machine BOM pass added real weight computation and storage everywhere (Sub Child
Part's own weight, Child Part's roll-up, Machine's roll-up) — but the plan's own
frontend-display half never got built for the two lower levels: Child Part Master's own
screen never gained a Total Weight tile, and neither screen's tables showed weight at
all, only Machine BOM's did. You caught this and asked for it to be completed so you
could manually break a Machine's Total Weight down and verify it.

**What changed:**
- **Weight columns on all four table lists** — Machine BOM's Child Parts table and
  Child Part Master's Sub Child Parts table each get **Unit Weight** / **Total Weight**
  columns (same pair pattern the existing Unit Cost/Total Cost columns already use).
  Both levels' Materials and Tools tables get a single **Weight** column — this number
  wasn't stored anywhere before (only ever summed into the aggregate total), so a small
  backend addition computes it fresh for each line every time the BOM is opened, the
  same way it's already computed for the aggregate — never persisted per line, same as
  cost has never been persisted per material line either.
- **Child Part Master's own Total Weight tile** — completing what the original plan
  already called for but never shipped. The top row is now three tiles (Total Cost /
  Total Weight / Production Cost), matching Machine BOM's own layout exactly.
- **Sub Child Part Master's View dialog** now shows **Unit Weight** as its own fact,
  right alongside Stock and Specification.
- Any row where weight genuinely can't be computed (no weight rate set on that
  material) shows "—", the same convention used everywhere else weight appears in this
  app, rather than guessing zero.

## 8. Production flow — static structure only, Sub Child Part first

With the BOM hierarchy itself done, the next target is the actual production/purchase
flow for Sub Child Part — but as a first step, purely the static UI shape, no backend
logic, since Sub Child Part has two routes (In-House job work → Production, Out-Source
job work → Purchase) and the shape needs to exist before either route's real logic gets
built.

**What changed:**
- **Production > Orders** (`/production/orders`) — a third pill tab, "Sub Child Part
  Orders", added next to the existing Machine/Child Part tabs. It reuses the existing
  Orders query (`orderKind: 'SubChildPart'`) — genuinely empty today, since no
  `ProductionOrder` document has ever used that `orderKind` value (only `'Machine'` /
  `'ChildPart'` exist), so this needed zero backend changes. A dedicated static table
  (Order ID / Sub Child Part / Job Work / Qty / Priority / Status / Delivery / Action)
  sits alongside the existing Machine/Child Part table, shown only for this tab.
- **Purchases** — first tried as a second tab inside the existing Purchases Management
  page (`/accounts/purchases`), then reworked into its own routed sidebar page per your
  follow-up: **Sub Child Job Work**, a new sub-module in the Purchases sidebar section,
  positioned directly above Inventory. Same static table shape (Code / Name / Job Work
  Type / Qty Needed / Vendor / Status / Actions), no backend endpoint yet — the in-page
  tab version was removed once the sidebar page replaced it, so there's exactly one entry
  point today, not two. Uses the same `purchases` permission feature every other
  Purchases sub-module already uses — no new permission key needed.
- Both screens follow this codebase's established convention for a not-yet-wired screen:
  a real table with real columns and an empty-state message row, not a "Coming Soon"
  placeholder.

Deliberately not touched: the "New Order" button on Production > Orders (pre-existing
across every tab, out of scope for a static-structure pass), and any actual routing logic
for either job-work path — that's the next pass, once this shape is confirmed.

## 9. Sub Child Part order flow — cron-driven, real logic now built

The static structure from §8 now has real logic behind it — a Sub Child Part's stock
running low actually raises an order and routes it to the right department, entirely
automatically, no manual "Create Order" button anywhere for this level.

**What changed:**
- **A new, separate cron** (`server/services/subChildPartOrderService.js`, registered in
  `index.js` alongside — not instead of — the existing Child Part cron, same 30-minute
  cadence) watches every Sub Child Part Item's stock. When one hits Min Stock, it checks
  that part's one raw material against current stock and auto-raises a Purchase Request
  for any shortfall (same mechanism the rest of the app already uses for this), then
  routes the order itself off that item's own In-House/Outsourced flag:
  - **In-House** → a `ProductionOrder` (a new `orderKind:'SubChildPart'`) — deliberately
    a single, whole-order flow rather than the multi-stage Job Work → Fabrication →
    Assembly → Painting pipeline Child Part orders use. Its Job Work Types are shown as
    an informational list only, not separately tracked.
  - **Out-Source** → a brand-new model, `SubChildPartJobWorkOrder` — Purchase selects
    which job-work-type(s) to send in a "round" (possibly all at once, or a few now and
    the rest later), receives that round back, and repeats until everything's covered.
    No vendor selection in this pass.
  - Confirmed genuinely important: the *existing* `subChildPartReorderService.js` cron
    (one level up, for Child Part) is completely untouched — it was flagged as possibly
    "dead code" mid-session, checked directly, and confirmed still live and still the
    only thing restocking Child Part. Nothing about it changed.
- **Production > Orders' "Sub Child Part Orders" tab** now shows real orders (Order ID,
  part, Job Work Types, qty, priority, status, delivery) with a real detail view: assign
  a team, receive the raw material once Store transfers it (reusing the exact same
  Receive-material flow every other order kind already uses — genuinely no backend
  changes needed there), Start, and Complete (which credits the built quantity straight
  onto the Sub Child Part's stock).
- **Purchases > Sub Child Job Work** now shows real orders too, with a running list of
  which job-work-types are covered vs. still outstanding, a "Send Round" action (pick
  which types to send now) and a "Receive" action per open round. Completing every
  round's worth of coverage credits stock the same way the In-House route does.
- QC is not part of this pass anywhere — both routes can reach a real "Completed" state
  without one, same as agreed at the start.

**Verified against the real database**: a scratch script exercised all 4 raw-material
shapes this needed to handle (a plain item with enough stock, a plain item with a real
shortfall — confirmed a Purchase Request actually got raised for the right amount, a
sheet-metal fabrication item, and a length-based fabrication item), confirmed the
In-House and Out-Source routing both fire correctly off the same item field, and
confirmed running the sweep twice in a row never creates a second order for the same
item. All scratch data was cleaned up afterward.

## 10. Sub Child Job Work — department notification + real material deduction

Two real gaps in §9's Out-Source route, fixed this pass: Purchase was never told a new
job-work order existed, and Send Round never actually touched Store's stock — it was a
pure job-work-type checklist with no material behind it.

**Department notification.** The sweep's own post-creation notification fired for
Production either way, even on the Out-Source branch — so Purchase never saw anything
land. Split into two branch-specific notifications: the Out-Source branch now notifies
Accounts (Purchase Requests already route through the Accounts role family in this
app — there's no separate "Purchase" role/department), the In-House branch keeps its
existing Production notification unchanged. Clicking the new notification now lands on
Purchase's own Sub Child Job Work page instead of the generic Purchase Requests list.

**Live availability, shown before you try to send.** The raw-material snapshot Sub Child
Job Work already stored (from order creation) was never shown anywhere and could go
stale if Store's stock moved afterward. The page now shows a live-rechecked Availability
column (green "Available" / red "Short — PR {id}"), and the Send Round button is
replaced by a plain status line while short — nothing to click until Store genuinely has
the stock.

**Send Round now actually moves material — once, on whichever round is sent first.**
Since a Sub Child Part order has exactly one raw material for the whole build quantity
(not one per job-work-type), the material only ever leaves Store on round 1; later
rounds (covering more job-work-types on the same order) are pure status tracking — it's
the same physical material already moving on to the next operation, nothing more to
send. What happens on that first send depends on the material:

- **Plain (non-fabrication) material** — a flat, no-choices deduction of the known
  needed quantity. Nothing to pick, nothing to log.
- **Sheet metal or length-based fabrication** — Purchase picks, every time: **Send Cut
  Piece** (a specific size cut now, its own leftover — if any — logged immediately) or
  **Send Whole Sheet/Piece(s)** (send as-is; the real leftover isn't known until the
  finished Sub Child Part physically comes back, so it's measured later — see below).
  Either way, an existing "leftover" stock piece is offered as a substitute wherever it
  actually fits: for a whole-sheet send, one matching a real whole-sheet size (the Sub
  Child Part's own Sheet Metal Plan, or the catalog size if there's no plan yet); for a
  cut-piece send, one with enough area for the cut. A non-matching leftover is still
  shown, just read-only and marked as not usable.
- **Length fabrication's own extra trick** — bars/tubes/profiles don't round to whole
  catalog pieces cleanly (e.g. a 1.6 m need against a 1 m catalog piece leaves a 0.6 m
  remainder). If an existing leftover piece happens to be **exactly** that remainder
  length, it's combined with the whole catalog pieces to hit the need exactly — no new
  offcut created, and the page says so plainly. If nothing matches exactly, the leftover
  is left alone and one extra whole catalog piece is sent instead (plain rounding) — a
  "big enough but not exact" leftover is deliberately never substituted here, only a
  precise match.

**The whole-sheet/piece case's real leftover is measured at the very end.** Since the
same physical material can move through several job-work operations across several
rounds with nothing to measure in between, the leftover from a "send whole" round isn't
logged at send time — it's measured on the round that actually **completes the order**
(every job-work-type covered), right where the Sub Child Part's own stock already gets
credited. That receive now asks for the measured leftover length (and width, for sheet
metal) before it's allowed to go through, and credits it back onto Store exactly the way
the rest of the app already does for a returned offcut.

**A real bug caught by testing, not just written correctly by inspection:** the
length-fabrication combine (catalog piece + matching leftover piece, two separate stock
decrements on the same Item in one request) initially decremented the *catalog* variant
twice and never touched the leftover — a known MongoDB gotcha where two separate
(non-`$elemMatch`) conditions on the same array field let the update's positional `$`
resolve to the wrong array element when more than one element happens to satisfy either
condition on its own. Fixed by wrapping each of these dimension-variant lookups in
`$elemMatch` so the match and the update always target the exact same element — confirmed
by an end-to-end scratch script against the real database (plain, sheet-whole,
length-combine, length-no-match, and shortfall-blocks-send cases all exercised against
real Store items, 26/26 checks passing, all data restored and scratch files removed
afterward).

## 11. QC gate on the Out-Source route's final receive, plus a real Actual job-work cost

The gap flagged at the end of §10 ("QC for the Sub Child Part order flow — explicitly
deferred") is now closed for the Out-Source (Purchase) route specifically. Completing the
last round of a job-work order no longer credits stock directly — it sends the finished
quantity to QC first, and only QC's approval actually puts it in stock.

**What changed, in the order it happens:**

1. **Purchase completes the final round** (same "Receive" action as before) — now this
   also requires entering the **real total** the vendor invoiced for this whole job-work
   order (a required field, confirmed with you — matches how you'll actually have it, one
   bill for the batch, not a per-piece breakdown). The order's status becomes **"Pending
   QC"**, not "Completed" — that's now QC's call.
2. That total is immediately divided by the order quantity and written onto the Sub Child
   Part's own **Job Work Cost** (BOM Management → Sub Child Part Master) as a real
   **Actual** figure, replacing whatever manual R&D estimate was there — the same
   "Manual → Actual" flip this field's own design always intended. **Materials Cost gets
   refreshed at the same moment**, pulled fresh from the raw material's current price —
   so if that price moved since the Sub Child Part was first set up, the BOM's Total Cost
   (Materials + Job Work + Scrap, always summed live wherever it's shown) reflects today's
   real numbers, not stale ones from setup time.
3. A QC Job is created automatically and QC gets notified — reusing the exact same
   Approve/Reject screen (`/qc/jobs/:id`) every other QC job already uses, no new review
   screen needed. If a real checklist has been authored for that Sub Child Part
   (`/r&d/inventory-qc` → Sub Child Part tab — the structure already existed, this pass is
   what actually connects it to a real QC job for the first time), it shows up there
   too; if not, the checklist is just empty and QC can still Approve/Reject on the
   quantity alone.
4. **QC approves** (fully, or whatever's left after a rejection) → exactly that quantity
   is credited to the Sub Child Part's stock, and the order becomes "Completed".
5. **QC rejects a partial quantity** (not the whole order) — reuses the existing,
   already-working partial-reject mechanism every other QC job type has (shrinks the job's
   own quantity, keeps it open for the remainder to still get its own decision). The
   rejected slice is recorded on the order and shows up on Purchase's own Job Work page
   under a new **"QC Rejected"** filter — deliberately just a landing spot for now, no
   rework/return flow yet, per your instruction to wait on that until the client confirms
   what it should do. A **full** reject (the whole order) is handled the same way — closes
   the order, credits nothing.

**Where it shows up:**
- **Purchase's Job Work page** — a new "Pending QC" status (purple, with a "Sent to QC"
  action-column note instead of a button — nothing left for Purchase to do until QC
  decides), a new "QC Rejected" filter pill, a small red note under any order's status
  badge once it has a rejected quantity, and a new summary tile for each.
- **`/qc/jobs`** — a new "Sub Child Part QC" filter pill. The default "All" view now
  explicitly excludes this kind (a new `excludeSource` option, since the existing filter
  only ever supported "show me exactly this source," never "everything except"), so it
  doesn't get mixed into the general Purchase/Production/Store list.

**Verified end-to-end against the real database** (scratch script, cleaned up after): a
full cycle — send, final receive with a real total cost, confirmed the order sat at
"Pending QC" with stock still untouched and the BOM's Job Work Cost/Materials Cost both
updated correctly — then a partial reject (2 of 5), confirmed the rejected qty recorded
and stock still untouched, then approving the remaining 3, confirmed stock credited by
exactly 3 and the order closed. A separate full-reject case confirmed zero stock credited
and a clean close. A third case confirmed the final receive is actually blocked without a
job work cost entered. 29/29 checks passed; all test records removed afterward.

**Still not built:** the actual rework/return flow for a QC-rejected quantity (explicitly
paused, pending client sign-off — see above); the equivalent QC gate for the **In-House**
(Production) Sub Child Part route, which still credits stock directly on completion, same
as the Out-Source route did before this pass — flagged during this pass's own research but
kept out of scope since only the Out-Source flow was asked for. **Closed in §12 below.**

## 12. In-House (Production) route — the same QC gate, plus a proper home on Process Execution

The gap §11 flagged at the end ("equivalent QC gate for the In-House route — not built")
is now closed. Before this pass, the In-House Sub Child Part build lived on its own small
popup on Order Management (Assign Team → Start → Mark Complete) and Mark Complete credited
stock straight away, no QC involved at all. Now it lives on the same `/production/process-
execution` page every other order kind uses, and finishing a build sends it to QC first,
exactly like the Out-Source route already does.

**What changed:**

1. **"View" → "Plan", and it goes straight to the point.** Both the Child Part Orders and
   Sub Child Part Orders tabs on Order Management now say "Plan" and navigate straight to
   Process Execution — no intermediate "which machine?" picker dialog, since neither of
   these two order kinds is ever a multi-machine batch like a real Machine order can be.
2. **The old standalone popup is gone.** Everything it did (assign a team, start the
   build) now happens on Process Execution instead, alongside a proper material section:
   the order's one raw material, with the same Issue → Store transfers → Production marks
   received handshake every other material line in the app already uses.
3. **One QC checklist, one Submit.** Before Start is allowed, the material must be fully
   received. Once In Progress, a QC checklist (its own module, `subChildPart` — configured
   at R&D → Inventory QC → Sub Child Part) must be filled in before "Submit to QC" is even
   clickable. Submitting also requires the real total Job Work Cost for the whole build —
   and, **exactly the same as §11's Out-Source route**, that one number does two things at
   once: it becomes the Sub Child Part's Job Work Cost (divided by order quantity, flipped
   to "Actual"), and it refreshes Materials Cost from the raw material's current price, so
   the BOM's Total Cost reflects today's real numbers either way this part gets built.
   (Both routes now call the same shared function for this, so they can't drift apart.)
4. **QC decides, same screen as always** (`/qc/jobs`, a new "Sub Child Part QC" pill,
   `source: 'SubChildPartProduction'`). **Approve** credits the full order quantity to
   stock and closes the order. **Reject is always a full reject** — confirmed with you: an
   in-house build is one physical thing, not a vendor batch that can be part-good/part-bad
   like Out-Source's can — which reopens the order to "In Progress". Production sees
   exactly which checklist line(s) QC marked failed (the same checklist screen, now
   showing QC's own remarks), fixes them, and hits Submit to QC again — no separate
   "resubmit" button, saving the checklist after a rejection quietly clears it back to
   pending review automatically.
5. **Store's Pending Transfers got 3 tabs** — Sub Child Part / Child Part / Machine —
   purely so this new flow's requests show up in their own place instead of mixed into the
   existing Child Part/Machine list. Child Part and Machine behave exactly as before,
   unchanged.
6. **The material request no longer jumps the gun.** Found right after this pass shipped:
   the order's raw material was showing up in Store's Pending Transfers the instant the
   order was created — because the low-stock cron that raises these orders was seeding the
   demand itself, already marked "Requested", before Production had even looked at the
   order. That's not how Child Part's own material requests work — there, the demand only
   ever gets created when Production clicks its own "Issue" button; nothing is visible to
   Store before that. Sub Child Part's order now matches: it's created with no material
   demand at all, and the Raw Material card on Process Execution shows an "Issue" button
   until Production clicks it — that's the moment the demand is actually created and Store
   sees it for the first time. The cron still checks stock and raises a Purchase Request
   if the raw material itself is short — that safety check didn't move, only the
   Store-visible request did.

**Where it shows up:**
- **Order Management** — "Plan" buttons on Child Part/Sub Child Part tabs, no popup.
- **Process Execution** — a new "Sub Child Part Orders" tab in the order picker, with its
  own material/Job Work/QC checklist sections instead of the multi-step pipeline other
  order kinds show.
- **Store → Material Issues → Pending Transfers** — the 3 sub-tabs.
- **`/qc/jobs`** — the "Sub Child Part QC" filter pill, same as Out-Source got in §11.

**Verified end-to-end against the real database** (scratch scripts, cleaned up after):
a full cycle — assign team, start (blocked until material Issued), fill the checklist,
submit to QC (confirmed "Pending QC", no stock credit yet, Job Work Cost + Materials Cost
both updated), reject (confirmed reopened to "In Progress", no stock touched, checklist
shows QC's remarks), fix and resubmit, approve (confirmed stock credited by the full order
quantity, order "Completed"); 29/29 checks passed. Separately, a 10-assertion scratch
script confirmed a freshly created order has no material demand at all, that clicking
Issue creates exactly one (right material, right quantity, status "Requested"), and that
clicking Issue a second time is blocked rather than creating a duplicate. All test records
removed afterward.

## 13. Child Part's own order-creation flow — cron cut over from the old BOM, new cascade added

Moving one level up. Child Part Master (the new BOM catalog) already existed — what was
missing was the ordering side: when a Child Part runs low on stock, something has to
actually raise a build order for it. That "something" was still the OLD reorder cron
(`subChildPartReorderService.js` — a leftover name from before the hierarchy rename; it's
for what's called Child Part today), which had never been touched since the redesign
started and still read the OLD `RDChildPart`/`RDBOM` material tree.

**This is a full replacement, not a new system running alongside the old one** — different
from every level below it, where old and new stayed deliberately side by side. Checked the
real database first to make sure this was actually safe: zero Child Part orders existed
anywhere (open or finished), and the one real Child Part in the system already had the new
BOM set up. Nothing in flight, nothing left behind on the old system — so the cron could
just be rewritten outright instead of running two versions forever.

**What changed:**

1. **The reorder cron now reads the new Child Part Master BOM**, not the old material
   tree. A Child Part's stock hitting its Min Stock still raises a build order the same way
   it always did — just sourced from the right place now.
2. **New: it checks Sub Child Part stock too, and raises a Sub Child Part order if short.**
   A Child Part is built from Sub Child Parts plus its own direct materials. Before this
   pass, nothing checked whether there was enough Sub Child Part stock on hand to actually
   assemble the order — now it does, and if there isn't enough, it automatically raises a
   real Sub Child Part order (Out-Source or In-House, whichever that Sub Child Part is set
   up for) to go build more. That order then re-checks its OWN raw material and raises a
   Purchase Request if that's short too — so one low-stock Child Part can, in one pass,
   trigger a chain all the way down to a raw-material purchase, with no manual step in
   between.
3. **Its own direct materials (raw material, tool, sheet metal, length fabrication) are
   checked the same way as before** — a shortfall there still raises a Purchase Request
   directly, unchanged.
4. **The Material List (Production > Order Management > Child Part) now shows a "Sub Child
   Part" section** alongside the existing material categories — needed vs. available for
   each Sub Child Part the order is built from, and an "Issue" button that requests it from
   Store exactly like every other material row already works. No frontend changes were
   needed for this — the material table already renders whatever categories the backend
   sends, so it picked this new category up automatically.
5. **The material request still waits for Production to click Issue**, same rule just
   fixed for Sub Child Part orders in the last pass — a Child Part order is created with no
   material request at all; Store only sees a request once Production actually asks for it.

**Deliberately not touched in this pass**: the actual build steps a Child Part order goes
through (what replaces the old Job Work → Fabrication → Assembly → Painting stages) — that's
a separate, later piece of work. For now, a new Child Part order is simply created and left
in a "Pending" state with no steps attached, ready for that next pass to pick up.

**Verified end-to-end against the real database** (scratch script, cleaned up after): a
Child Part item set up with one Sub Child Part reference (short) and one direct raw
material (short) — running the cron created the build order with an empty material list as
expected, raised a real Sub Child Part order for the short reference, raised a real
Purchase Request for the short direct material, showed both correctly on the Material
List, and let Production successfully "Issue" the Sub Child Part row (capped at the right
total, a second over-cap request correctly rejected). Also re-confirmed the existing Sub
Child Part low-stock cron still works exactly as before and doesn't raise a duplicate order
for a Sub Child Part that already has one in flight from a cascade. 23/23 checks passed;
all test records removed afterward.

## 14. Sub Child Part's sheet-metal purchase quantity — now prefers the real Sheet Metal Plan

An audit of the Purchase-Request quantity math (checking §10/§13's cascade against how the
older Machine-level flow does the same job) turned up one real gap: when Sub Child Part's
raw material is sheet metal, the reorder cron was always guessing how many sheets to buy
from a pure area calculation (needed area ÷ one catalog sheet's area, rounded up) — it never
looked at that Sub Child Part's own **Sheet Metal Plan** (the real, fit-checked cutting
layout R&D can author in the Flow Management modal), even when one already existed. The
Machine-level flow does the opposite — it always trusts a pre-authored Plan's real number
and never estimates — but that only works there because a Machine's BOM can't be locked
without one first. Sub Child Part has no such requirement, so a straight copy of Machine's
"always trust the Plan" behavior would leave a lot of real Sub Child Parts never getting
purchased at all.

**Fixed to do both**: if a Sheet Metal Plan exists for that Sub Child Part, its real sheet
count is used (scaled to the size of the current build — the Plan itself only ever records
"used N sheets for a run of M units," not a fixed per-unit number, so the fix scales it as a
ratio rather than assuming M always equals the new order's own quantity). If no Plan exists
yet, it falls back to exactly the same area estimate as before — nothing changes for a Sub
Child Part that hasn't had a cutting plan authored yet.

**Verified against the real database**: a Sub Child Part with no Plan still gets the same
area-estimate number as before (regression check); the same Sub Child Part with a Plan
added (3 sheets used for a run of 2 units) correctly switches to the Plan-based number,
scaled to a different build quantity, and gives a different (larger, more realistic) answer
than the area estimate would have — confirming the Plan is actually driving the result, not
just being read and ignored. A separate end-to-end run confirmed the whole Child Part →
Sub Child Part → Purchase Request cascade from §13 still works correctly after this change.
13/13 checks passed; all test records removed afterward.

## 15. Four real bugs found in the first real Child Part order — three fixed, one deferred

Watching the very first real Child Part Master order (Fan, ORD-2026-055) go through the
new §13 flow surfaced four separate issues. Three are fixed here; the fourth (a display
timing question) is deliberately left as-is, pending confirmation that a lightweight fix
is actually worth it.

**Fixed — the BOM View modal silently dropped Sub Child Part names.** The material list
`findSubChildPartMaterialLines` builds for both the "does this BOM have materials yet"
check and the BOM View modal itself mixes two differently-shaped things: Sub Child Part
reference lines (their display name lives in a `.name` field) and direct material lines
(theirs lives in `.item`). The modal only ever read `.item`, so every Sub Child Part row
showed a blank name with just its bare code underneath — which is why they looked
unrecognizable rather than merely uncategorized. Fixed by normalizing every line onto the
same field shape and tagging each with which kind it is; the modal now shows two clearly
labeled sections ("Sub Child Part" / "Materials") instead of one flat list. Deliberately
not called `category` — that name already means something else on a material line (its own
Category Management classification) and would have silently overwritten it.

**Fixed — the Design view only ever showed the Child Part's own image, never any of the
Sub Child Parts it's built from.** This gap predates this session's cron work — it's the
same "Child Part branch of `getBomDesignStatus`" that's existed since the original build,
just never visible until a real Child Part Master order existed to look at. Fixed to roll
up each referenced Sub Child Part's own design image too, the same way Machine level
already rolls up Child Part + Sub Child Part images together. The "is this approved" gate
itself still only checks the Child Part's own image — the Sub Child Part images are shown
for reference, not required, a deliberate choice (not everything needs a picture to count
as ready) rather than an oversight.

**Fixed — the real one: a Sub Child Part order raised by its own reorder-point cron and a
need surfaced by a Child Part's cascade were being treated as the same demand.** Before
this fix, `createSubChildPartOrderForItem`'s dedup check only asked "does ANY open order
already exist for this Sub Child Part" — so if that Sub Child Part's own independent
low-stock cron had already raised an order (sized to its own configured reorder batch),
the Child Part's cascade would see that and skip entirely, never checking whether the
existing order's quantity was actually enough. Confirmed with real numbers from the first
order: Fan needs 6 Fan Blades × 5 units = 30, but Fan Blade's existing (independent) order
was only for 20 — a real, undetected 10-unit shortfall.

Fixed by tagging every Sub Child Part order/job-work with which trigger raised it
(`demandSource: 'LowStock'` for the Sub Child Part's own cron, `'ChildPartCascade'` for a
Child Part's own cascade) and scoping the dedup check to that tag — the two sources are now
allowed to each have their own open order for the same Sub Child Part at once, but each
still independently caps at exactly one (a second cascade run, or a different Child Part
that also needs the same Sub Child Part, won't raise a third). The cascade's own order is
sized to what the Child Part's BOM line actually requires (its per-unit quantity × this
order's own quantity), not that Sub Child Part's generic reorder batch size — Fan's cascade
order for Fan Blade is sized 30, not 20. Every order raised before this fix existed has no
`demandSource` at all; the dedup query treats that as `'LowStock'` (correct by definition —
the cascade didn't exist yet when they were created), so no data migration was needed.

**Direct consequence, now resolved for free**: since the cascade order now actually gets
created instead of silently skipped, it reaches the same raw-material check every Sub Child
Part order already goes through — so a Purchase Request now correctly gets raised for that
Sub Child Part's own raw material too, when it's short, exactly as designed in §13.

**Deferred, pending confirmation**: Order Management's BOM/Design badge shows red until
Process Execution has been opened for that order at least once — confirmed this is a
pre-existing, shared characteristic of the whole verification system (the same code path
Machine orders already use), not something new. A live, batched (not per-row) fix is
possible but wasn't built yet — holding until it's confirmed as actually worth doing.

**Verified against the real database**: a scenario mirroring the actual first order (a
Child Part referencing an Out-Source and an In-House Sub Child Part, both already
undersized relative to what the Child Part needs) — confirmed the material list correctly
tags and normalizes both line kinds; confirmed BOTH Sub Child Parts get a second,
cascade-sourced order (sized to the real need, not the generic reorder batch) alongside
their pre-existing ones; confirmed the pre-existing orders are left untouched; confirmed
re-running the sweep doesn't create a third, duplicate order; confirmed the legacy
(no-`demandSource`) order is still correctly recognized by the Sub Child Part's own dedup.
A separate run confirmed the Design view rollup shows the Child Part's own image plus every
Sub Child Part that has one, correctly skipping any that don't. 20/20 checks passed across
both scripts; all test records removed afterward. `npx vite build` clean.

## 16. Store↔Production material handshake for Sub Child Part rows — audited, one legibility fix

With the material list built (§13/§15), the next step was Store's actual handshake —
Issue/Transfer/Receive/Return — for a Child Part order whose material list now mixes Sub
Child Part reference rows alongside its own raw materials. Traced the whole chain function
by function before changing anything: **the transfer mechanics were already completely
correct**, with zero changes needed. A Sub Child Part reference row has no fabrication
category, so it already falls through to the exact same plain/flat transfer path a raw
material uses — Store sends it, the Sub Child Part Item's own plain stock (`qty`) decrements
correctly (confirmed a Sub Child Part Item never has the dimensioned/fabrication stock shape
a raw material can have — its stock is always just a flat count), Production receives it
with the same generic bookkeeping every other material already uses, and the two
fabrication-specific transfer actions explicitly refuse to run for it at all (rather than
silently doing the wrong thing) if anything ever tried to route one through them by mistake.

**The one real gap**: Store's Pending Transfers list never showed which row *was* a Sub
Child Part — only which order kind it belonged to, not which specific line. So once a Child
Part order's list mixed a Sub Child Part reference next to its own ordinary raw materials,
Store had to recognize a stocked sub-assembly purely by its name, with nothing on the page
actually saying so. (Production's own side didn't have this gap — its Material List already
groups rows under a visible "Sub Child Part" heading.) Fixed by adding a small badge next to
the material name, resolved with one extra batched lookup per page load (not one per row) —
purely additive, no change to how anything actually transfers.

Confirmed with the user: these rows land on the right Store tab already (the "Child Part"
tab — an order's tab is decided by the whole order's kind, not by what any one row inside
it happens to reference), so no tab-routing change was needed either.

**Verified against the real database**: a Child Part order with a mixed material list (one
Sub Child Part row, one plain material row) plus a Sub Child Part's own order (whose sole
material is its own raw material, never another Sub Child Part) — confirmed the Sub Child
Part row is tagged and the plain row isn't, confirmed the Sub Child Part's own raw-material
row is never mistakenly tagged, and specifically confirmed the tag survives the real
response payload (not just an in-memory value that could have silently vanished before
reaching the browser). 5/5 checks passed; all test records removed afterward. `npx vite
build` clean.

## 17. Child Part's own build pipeline — per-unit Fabrication → Assembly → QC → Painting

The last piece §13 deliberately left out: a new Child Part order was created and just sat
`Pending` with no steps attached. This pass builds the actual build pipeline it runs
through, on both backend and frontend.

**Step shape — Job Work dropped.** The old 4-step pipeline (Job Work → Fabrication →
Assembly → Painting) becomes 3 steps: Fabrication → Assembly → Painting. Job Work doesn't
apply here any more because a Sub Child Part is now independently stocked by its own order
flow (§9) — Child Part just receives an already-built Sub Child Part unit from Store like
any other material category, the same way it already receives Raw Material/Tool. Fabrication,
Assembly and Painting themselves stay conceptually unchanged — confirmed with the user not
to merge Fabrication/Assembly even though they're similar processes ("it is my call here as
I will get the feedback from client... we leave the current step flow until client said
so").

**QC design — two real corrections, both kept here because they explain the final shape:**

1. First draft assumed one QCJob per order with whole-order batching, copying how a real
   Machine order's Final Testing QCJob works (one job, `quantity = orderQuantity`, every
   unit reviewed together). Corrected: Child Part QC does **not** wait for every unit to
   finish — a unit goes to QC the moment it's done, independent of its siblings.
2. The next guess — "so give each unit its own separate QCJob document" — was also wrong.
   The real, already-built pattern to mirror turned out to be Machine's OLD per-part QC
   system: **one QCJob per order**, but a nested array holding one independent entry per
   unit (`unitChecks[]`, mirroring the existing `partChecks[]` a Machine's own Sub Child
   Parts already use) — each entry with its own `initial`/`process` checklist arrays and
   its own 4-state lifecycle (`Awaiting Production` → `QC Pending` → `Approved`/`Rejected`),
   completely decoupled from every sibling entry and from the job's own top-level `status`.

**What was built:**

1. **`SUB_CHILD_PART_STEPS` → `['Fabrication', 'Assembly', 'Painting']`** (`ProductionOrder.js`).
   Safe — every Child Part order in the real database was created by §13's rewritten cron
   with an empty `processes[]`, nothing old-shaped to migrate.
2. **`QCJob.js` gained `unitChecks[]`** (a new `UnitQCEntrySchema`, structurally identical
   to the existing `PartQCEntrySchema` apart from `unitNumber` standing in for
   `childPartId`/`subChildPartId` — no separate `assignedTeam`/`startedAt` of its own,
   since Child Part already tracks those at the real `processes[]` step level). `source`
   gained `'ChildPartProduction'`.
3. **Fabrication and Assembly stay generic** — Start → Mark Complete → `QC Pending` →
   rubber-stamp Approve/Reject QC, the same loop every other step already used (this
   rubber-stamp is Production self-certifying the step is physically done; it's unrelated
   to the real QC-department review below). Machine's OLD Fabrication auto-complete carve-
   out (tied to *its own* `partChecks[]`) was checked and confirmed to live in a code path
   Child Part's own branch never reaches — left completely untouched.
4. **The real per-unit QC checklist** — staged Initial then Process (`module:'childPart'`,
   confirmed already configured as staged, unlike Sub Child Part's flat single-stage
   module). Gated on this unit's own Assembly being `Completed`. Saving Process is itself
   the hand-off to QC — no separate "Submit" action, mirroring the existing `partChecks[]`
   convention exactly. A rejected unit needs no explicit "reopen": Production just re-edits
   and resaves Process, which flips it straight back to `QC Pending` on its own.
5. **QC's decision** (`decideChildPartUnit`, `PUT /jobs/:id/units/:unitNumber/decision`) —
   direct sibling of the existing `decidePartCheck`, same shape: reviews Initial + Process
   together in one sitting, touches nothing outside that one `unitChecks` entry. No
   partial-quantity concept, same as the pattern it mirrors.
6. **Painting is Child Part's own final step**, but doesn't reuse the generic
   Start/Complete/Approve-QC loop — it needs a real per-unit cost capture, and Machine's
   own "final step" math (`PROCESS_STEPS.length - 1`) doesn't apply to Child Part's shorter
   3-step pipeline. New dedicated action, `completeChildPartUnitPainting`: Start is gated
   live on this unit's own `unitChecks[].status === 'Approved'`; completing takes a real
   `productionCost`/`productionExpense` for this one unit (mirrors Machine's own
   "later unit wins" per-unit cost capture at its final step), calls a new
   `recalculateChildPartCost` (refreshes the BOM's material lines from each raw material's
   current price, then writes the entered cost), credits the Child Part Item's stock by
   **1** — one unit, not the whole order quantity — and flips the order to `Completed`
   once every unit is done.
7. **Frontend — `ProcessExecution.jsx` and `ProductionContext.jsx`.** Three real bugs
   turned up while adapting the existing (inert) Child Part rendering, none caught by the
   backend's own scratch test since that drives the controllers directly and never goes
   through this layer:
   - `ProductionContext.jsx` kept its **own separate copy** of `SUB_CHILD_PART_STEPS`,
     still including `'Job Work'` — never updated when the backend's copy changed in this
     same pass. Left as-is, every Child Part step action (`startProcess`, `assignTeam`,
     `markProcessComplete`, ...) would have resolved the wrong index against the backend
     (e.g. `'Fabrication'` → 1 instead of 0).
   - `stepIndex(stepName)` resolved purely against the flat Machine `PROCESS_STEPS` array,
     with no order-kind awareness at all — wrong for a Child Part order regardless of the
     line above. Fixed by looking the order up by id and resolving against the right step
     array for its own `orderKind`.
   - A leftover `scpJobWork` substitution (`idx === 0 ? selectedOrder.processes[0] :
     procRaw`) was written for the OLD pipeline, where Job Work was one whole-order step at
     index 0 shared across every unit tab. With Job Work dropped, index 0 is now
     Fabrication — a REAL per-unit step. Left in place, viewing Unit 2's tab would have
     silently shown and acted on **Unit 1's own Fabrication process copy**, breaking
     per-unit independence for the very first step. Removed entirely, along with the now-
     unreachable `'Job Work'` JSX blocks and the now-dead `sub-child-part-job-work` query.
   Also built: the per-unit staged (Initial/Process) checklist panel itself (adapted from
   the existing flat Sub Child Part checklist pattern already in this file, not a separate
   `ChecklistStepper` component — none exists in this file, despite the original plan
   assuming otherwise), a dedicated Complete-Painting cost-capture dialog replacing the
   generic Mark-Complete/Approve-QC actions for that one step, and a live-status-aware
   disabled/title on Painting's own Start button. Also fixed a pre-existing, unrelated
   label bug found in passing: the Completed banner said "added to **Sub Child Part**
   Inventory" for a Child Part order (leftover from before the terminology settled) — now
   says Child Part.
8. **`/qc/jobs` + `/qc/jobs/:id`** — new `ChildPartUnitQCReview` component, direct sibling
   of the existing `SubChildPartQCReview`, reviewing `unitChecks[]` instead of `partChecks[]`
   (same one-job-nested-entries shape as before — the earlier component's actual row-review
   UI, `ProductionCheckReviewRow`, is reused as-is). New "Child Part QC" filter pill on the jobs
   list, `excludeSource` extended (backend: now comma-separated, `$nin` instead of `$ne`) so
   the default "All" view keeps excluding both Sub Child Part QC and Child Part QC jobs, the
   same reasoning as before — both are structurally different nested-review flows, not a
   plain single-decision QC entry. One more thing caught while wiring this in: a Child Part
   job's `partChecks` is always empty, which meant the existing manufactured-job gate
   (`!job.partChecks?.length || ...`) read as "ready" immediately — the flat whole-job
   Checklist/Final-Decision panel (with its "Approve & Transfer to Store" wording, meaningless
   here) would have been reachable and clickable with zero real checks behind it. Hidden
   entirely for a `ChildPartProduction`-sourced job — the only real decisions for this job
   type are the per-unit ones above.

**Verified against the real database** (scratch script, cleaned up after, 40/40 checks
passed): created a real Child Part order (`orderQuantity: 2`) and drove two units
deliberately out of sync with each other — Unit 1 through Fabrication → Assembly →
Initial → Process (confirmed the automatic hand-off to `QC Pending`, no separate submit
call) → QC Approve (confirmed only `unitChecks[0]` changed) → Painting Start now allowed
for Unit 1 only (Unit 2's Painting Start still blocked) → complete Painting with cost
(confirmed `Item.qty` credited by exactly 1) — while Unit 2 sat mid-Fabrication throughout,
confirmed its own `unitChecks[1]` entry stayed completely untouched. Then drove Unit 2
through its own cycle including a full QC Reject (confirmed `unitChecks[1].status` became
`Rejected`, confirmed Production could immediately re-edit and resave Process with no
separate reopen call, confirmed resaving flipped it straight back to `QC Pending` with
`rejectReason` cleared) → Approve → complete (confirmed `Item.qty` credited by 1 again,
total 2, `order.status` only flips to `Completed` once **both** units are done, and
`ChildPartBOM`'s cost fields reflect Unit 2's — the later unit's — entered numbers, plus a
direct material's `unitPrice` correctly refreshed from the raw item's current
`purchaseCost`). Confirmed exactly ONE QCJob document existed for the whole order
throughout, never two, with `unitChecks.length === 2`.

`npx vite build` clean, twice (once after the `ProcessExecution.jsx`/`ProductionContext.jsx`
changes, once again after the `/qc/jobs` changes). **Not done this pass**: a live, in-browser
click-through of the new UI — no browser automation tooling (Playwright/chromium-cli or
equivalent) is available in this environment, so the frontend side of this pass was verified
by tracing every request/response shape against the backend contracts the scratch script
already confirmed, plus a clean production build, rather than by actually driving the pages.
Flagged rather than silently skipped — worth an actual manual walkthrough before relying on
this in production.

## 18. Machine's own order-creation cascade — the top tier, cut over to the new BOM

The last node. A Machine order is created differently from every other order kind in this
hierarchy: not by a low-stock reorder cron, but by Sales → Leads → Order Form submission,
flowing through Store's own routing (`storeFlowService.js`'s `applyStoreDecisionToItem`) the
moment an in-house-manufactured Sale item turns out "Not Available." Before this pass, that
path created a bare `ProductionOrder` shell with no BOM check of its own — a separate,
unrelated function (`materialAvailabilityService.js`'s `computeMaterialAvailabilityForOrder`)
ran alongside it, reading the OLD flat `RDBOM`, with no Child Part/Sub Child Part concept
at all: one raw-material Purchase Request per short line, full stop.

**Real database check first, and a real mistake caught mid-check**: before deciding whether
this could safely cut over the way Child Part's own order-creation cron did (§13), checked
the real database for how many Machine Items actually have the new `MachineBOM` set up yet.
The first check used a typo'd collection name (`machinebooms` instead of `machineboms`) and
silently queried nothing, reporting zero `MachineBOM` documents — which would have meant a
full cutover was unsafe and a coexistence design was needed instead. The user caught this
immediately (two real Machines, BP816 and PRO-0014, already have a `MachineBOM`, visible in
their own screenshots of R&D → BOM Management) and confirmed the actual intent: **cut the
order-flow over fully, no `RDBOM` fallback** — the old BOM stays exactly where it already is,
inside BOM Management's own "Child Part / Machine BOM (Legacy)" tab, untouched. Re-checked
correctly: 2 real `MachineBOM`s exist (of 21 real Machine Items; 15 have only the old
`RDBOM`, 4 have neither, 1 — PRO-0014 — has both). This is a real, deliberate operational
trade-off, not a bug: the 15 `RDBOM`-only machines stop getting any automatic BOM/Design
verification or raw-material shortfall checking at order-creation time until R&D creates a
real `MachineBOM` for each — the same catalog UI that already works for BP816/PRO-0014.

**What was built** (mirrors Child Part's own cascade, §13, one tier up, function-for-function):

1. **`demandSource` gains `'MachineCascade'`** (`ProductionOrder.js`, `SubChildPartJobWorkOrder.js`),
   propagated through BOTH cascade tiers, not just the first — a Child Part order raised by a
   Machine's cascade tags its OWN Sub Child Part cascade `'MachineCascade'` too (not the
   hardcoded `'ChildPartCascade'` it used before), so a Machine-triggered build chain stays
   independent of a cron-triggered one at every level, the same bug class already caught once
   this session (§15) at the tier below.
2. **`createChildPartOrderForItem` extracted** from `runChildPartReorderSweep`'s own inline
   per-item body (`childPartReorderService.js`) — mirrors `createSubChildPartOrderForItem`
   exactly, dedup now scoped by `demandSource` (`['LowStock', 'MachineCascade']`) where before
   it wasn't scoped at all. The sweep itself calls the new function instead of its own inline
   logic — behavior-preserving refactor.
3. **New `machineReorderService.js`** — `checkMachineAssemblyMaterialAvailability`, the direct
   analogue of `checkSubChildPartMaterialAvailability` one tier up: for each short
   `MachineBOM.childParts[]` reference, cascades into a real Child Part order (sized to the
   actual BOM line need, tagged `MachineCascade`); for the Machine's own direct `materials[]`
   (Tier 1 plain / Tier 2 sheet metal / Tier 3 length fabrication), raises a flat Purchase
   Request per shortfall — reusing the exact same grouping/PR-raising helpers every level below
   it already uses. No-ops cleanly for a machine with no `MachineBOM` yet.
4. **Wired into the real order-creation point** — `storeFlowService.js`'s
   `applyStoreDecisionToItem` CASE 2 now calls the new cascade right after creating the Machine
   `ProductionOrder`, replacing what the old, now-retired `computeMaterialAvailabilityForOrder`
   used to do. The old function ran separately, for every in-house item regardless of whether
   it actually needed building (even an already-"Available" item) — the new cascade only runs
   for an item that's actually getting a real Production Order created, the same trigger every
   other cascade in this hierarchy uses.
5. **`Sale.items[].materialAvailability` gains a `childParts[]` field** — a Child Part
   shortfall now shows which real order got raised (`productionOrderCode`), not just a bare
   number; the existing flat `available`/`needsPurchase` fields now reflect the Machine's own
   direct materials only. **Store Orders page** (`StoreOrders.jsx`) gets a new "Child Part"
   hover badge alongside the existing "Available"/"Needs Purchase" ones, same HoverCard
   pattern, purely additive — a machine with no `MachineBOM` yet shows exactly what it always
   has.
6. **Production's BOM/Design verification cut over** — `getBomDesignStatus`'s Machine branch
   now reads `MachineBOM.isLocked` instead of `RDBOM.isLocked`, no fallback. Caught one real
   side effect of the cutover while wiring this in: the BOM View/Download PDF button
   (`ProcessExecution.jsx`) called the OLD `RDBOM`-specific download route
   (`GET /rd/boms/:bomId/download`) — pointing it at a `MachineBOM._id` instead would have
   silently 404'd. Fixed by switching to `MachineBOM`'s own already-existing download route
   (`GET /rd/machine-bom/:machineId/download`, the same one BOM Management's own "Download
   BOM" button already uses) and adding `machineItemId` to `getBomDesignStatus`'s response for
   the frontend to key off. That route was also gated by a narrower permission
   (`rnd.bomManagement` only) than the old one (`rnd.bomManagement` OR `production.orders`) —
   fixed to match, so a Production user without R&D's own BOM Management access doesn't lose a
   button they could use before. Explicitly NOT built this session, same phased approach as
   Child Part: Machine's own Material List and build/process pipeline (next session).

**Verified against the real database** (scratch script, cleaned up after, isolated `TEST-MC-`
fixtures — a full Raw Material → Sub Child Part → Child Part → Machine chain, deliberately
NOT touching BP816/PRO-0014's own real data): 17/17 assertions passed — one Machine order's
cascade correctly created one Child Part order (sized to the BOM line's real need, tagged
`MachineCascade`), whose OWN cascade correctly created one Sub Child Part order (propagated
`MachineCascade`, not `ChildPartCascade`), whose own raw-material check correctly raised a
real Purchase Request; confirmed a pre-existing `'LowStock'`-tagged order for the same Sub
Child Part was left completely untouched (dedup independence — the exact bug class from §15,
now verified one tier further up too); confirmed the Machine's own direct material shortfall
raised its own separate Purchase Request; confirmed `Sale.items[].materialAvailability`
(`childParts[]` and the existing `needsPurchase[]`) both wrote correctly; confirmed
re-running the cascade doesn't create a duplicate Child Part order. Separately, a read-only
check against a REAL PRO-0014 order confirmed `getBomDesignStatus` now correctly reads
`MachineBOM.isLocked` (`false` — neither real `MachineBOM` has been locked yet) instead of
the old `RDBOM`'s, with zero writes triggered (the auto-verify side effect only fires when
both `bomLocked` and `designApproved` are true). `node --check` + runtime import check on
every touched backend file; `npx vite build` clean, twice.

## 19. Concurrent-demand fix — reservation ledger + per-order cascade dedup

Right after §18 shipped, the user asked a sharp follow-up: does the new cascade actually
handle an order form with MULTIPLE different machines (different quantities, potentially
sharing a Child Part)? Verified directly with real-DB scratch tests rather than reasoning
about it, and found two separate, compounding bugs — both pre-dating §18 (inherited
byte-for-byte from the Child Part → Sub Child Part cascade built earlier in this session,
§9/§13) and present at every tier of the new hierarchy's material-availability checking:

**Bug 1 — double-counted "available."** Every availability check (Machine's own Tier 1/2/3
+ Child Part reference, Child Part's own Tier 1/2/3 + Sub Child Part reference, Sub Child
Part's own raw-material check) read `Item.qty` directly and compared it to ONE consumer's
own need, with zero awareness of what any OTHER concurrent consumer had already claimed
against that same stock. Verified: an Item with 5 in stock, Machine A needing 3 and Machine
B needing 4 (combined 7, genuinely short by 2) — both checks independently compared against
the SAME untouched `qty:5` and BOTH reported "available." No shortfall was ever flagged for
either, so nothing ever got cascaded/purchased.

**Bug 2 — cascade order silently dropped on dedup.** Even when both consumers DID
independently detect a shortfall, the cascade-order dedup (`demandSourceMatch(demandSource)`)
only checked "does an open order already exist tagged with this demandSource VALUE" — not
which specific order asked. Verified: Machine A (needs 4) and Machine B (needs 1) of the
same Child Part, both genuinely short — only ONE cascade order got created (sized to 4,
whichever machine was processed first); the second's need was silently dropped, no order,
no error, nothing.

These are complementary, not redundant — fixing only one leaves the other. Given the size
of the underlying gap, offered the user three scopes (same-order-form-only patch, full
reservation ledger, or defer entirely) — the user chose the full ledger, accepting that it
overlaps with next session's planned Material List/Store-Issue rebuild.

**What was built:**

1. **New `MaterialReservation` model** — one document per (Item, claiming order) pair
   (not a single aggregate counter on `Item`), so it stays auditable and safely idempotent
   to re-write. Tracks "claimed but not yet issued" quantity, separate from an Item's own
   raw `qty`.
2. **New `materialReservationService.js`** — `getFreeQty(itemId, currentQty, companyId)`
   (raw qty minus the sum of active reservations); `checkAndReserve({item, neededQty,
   order, orderModel, companyId})` (computes free stock, reserves the consumer's FULL
   needed quantity regardless of shortfall — same "size to the real need, not the delta"
   convention cascade orders already use, applied to the reservation too, so a third
   concurrent consumer can't later double-claim the portion this one is still waiting on a
   cascade to deliver; upserted by `(item, reservedByOrderId)` so re-running the SAME
   order's own check updates its one row instead of accumulating duplicates —
   `shortfallQty` is capped at `neededQty` so a deeply negative free-qty from many stacked
   claims can never inflate one consumer's own shortfall past what it actually asked for);
   `releaseReservationsForOrder(orderId)`.
3. **Wired into every existing availability-check call site** — Machine's own Child Part
   cascade + Tier 1/2/3 (`machineReorderService.js`), Child Part's own Sub Child Part
   cascade + Tier 1/2/3 (`childPartReorderService.js`), and Sub Child Part's own raw-
   material check — specifically its CREATION-TIME wrapper
   (`resolveSubChildPartRawMaterialNeed`), not the pure `computeSubChildPartRawMaterialAvailability`
   underneath it, which must stay side-effect-free (it's also called from live-recheck
   GET/guard endpoints that must never mutate state just from reading status).
4. **`demandRefId`** — new field on `ProductionOrder.js`/`SubChildPartJobWorkOrder.js`:
   which SPECIFIC immediate-parent order asked for this cascade (null for
   `demandSource:'LowStock'`, which has no parent order — the reorder cron's own generic
   trigger). `demandSourceMatch(demandSource, demandRefId)` (both files' own copy) now
   requires an exact `demandRefId` match for a cascade-type source, so a different
   triggering order is never treated as "already covered" by another order's cascade —
   this is the Bug 2 fix. Both `createSubChildPartOrderForItem`/`createChildPartOrderForItem`
   gained the param, threaded into both the dedup check and the created document.
5. **Release, scoped to what's real today** — a `post('save')` hook on both order models:
   whenever `status === 'Completed'`, release that order's reservations — schema-level, so
   it automatically covers every current AND future completion path (Sub Child Part's own
   completion, Child Part's per-unit Painting completion, Machine's own still-legacy
   completion path) without hunting down and patching every controller that sets it.
   Explicit release-before-delete added to `storeFlowService.js`'s
   `applyStoreDecisionToItem` (the one concrete place a reservation-holding Machine order
   can be deleted before completion — Store re-routing an item away from Production).
   **Known, explicitly-flagged limitation**: not an exhaustive audit of every possible
   order-cancellation path in the app — an unusual flow that abandons an order without ever
   reaching `'Completed'` would leak its reservation (overstates demand, never
   under-claims — the safe-direction failure mode). Worth a real audit once Machine's own
   build pipeline is designed next session, since that's where most future Machine-order
   cancellations will happen.

**Verified against the real database** (scratch scripts, isolated `TEST-RL-`/`TEST-REGR-`
fixtures, cleaned up after, zero strays confirmed both times): 18/18 assertions on the new
fix (both bug-reproduction cases now correctly resolved — worth noting Test 1's first
attempt had a wrong expectation of its own, corrected mid-verification: Machine A's own
need was genuinely covered by real stock and correctly raises nothing at all; only Machine
B, whose check pushes the cumulative claim past what's free, correctly raises ONE cascade
order sized to ITS full need — once fulfilled, existing + cascaded stock safely covers the
true combined need, a deliberate slight over-provision rather than any under-provision);
idempotency (same order's own check run 3× creates exactly one reservation row and one
cascade order); release-on-completion; release-on-deletion (via a real
`applyStoreDecisionToItem` re-routing call); `demandSource:'LowStock'` dedup confirmed
completely unaffected. Separately re-ran the original 15-assertion single-machine 3-tier
cascade regression (Machine → Child Part → Sub Child Part → Purchase Request) from §18 —
all still pass unchanged, now also confirming `demandRefId` is set correctly at each tier.
One unrelated, pre-existing bug surfaced (not fixed, out of scope) while writing the
regression test: `generateOrderId` (`productionMfgController.js`) derives the next `orderId`
from a per-company document count, but the `orderId` unique index is global across every
company in this shared dev database — a real, deterministic collision risk unrelated to
this pass, worked around in the test script rather than fixed. `node --check` + runtime
import check on every touched/new backend file.

## 20. Machine order — BOM view, Material List, and R&D approval queue cutover

Back on Machine order's Process Execution page. Three pieces, refined through direct
back-and-forth with the user after initial exploration turned up a bigger gap than
expected.

**BOM view — reuse the existing PDF popup, don't build a new modal.** Confirmed with the
user: `handleViewBom`/`handleDownloadBom` (already a `Dialog` popup fetching the
`MachineBOM` PDF via `GET /rd/machine-bom/:machineId/download`, never a redirect) is the
right experience — no need for a separate structured table like Child Part's own
`bomViewOpen`. The gap was just that this only ever showed once BOM was fully locked
*and* design approved; the far more common state today (19 of 21 real Machines have no
`MachineBOM` at all yet) had no View affordance at all, even though the PDF route only
ever required the `MachineBOM` document to exist, not be locked. Added a "View" button to
that fallback branch too, gated on the BOM actually having content
(`bomDesign?.materials?.length > 0`) — which required `getBomDesignStatus`'s Machine
branch to return `materials` at all, which it didn't before (only the Child Part branch
did). Reused `machineReorderService.js`'s existing `findMachineMaterialLines` for this
(one query now resolves both the lock flag and the materials array), and gave each Child
Part reference row a `unit: 'Pieces'` default in that same function — `MachineBOM.js`'s
`ChildPartLineSchema` never had a `unit` field of its own (unlike `ChildPartBOM.js`'s
`SubChildPartLineSchema`, which does), so without this the modal's Unit column would have
rendered blank.

**Design rollup needed no work at all** — checked directly rather than assumed:
`buildMachineDesignFiles` (`rdController.js`) already walks the new `MachineBOM →
ChildPartBOM → Sub Child Part` chain to roll up Child Part + Sub Child Part design images,
cut over in an earlier pass this session (documented then, just re-confirmed here before
building anything new on top of a wrong assumption).

**Material List — built from scratch, confirmed nothing existed before.** Grepped the
whole Process Execution page: the legacy `GET .../material-list` / `POST
.../materials/issue` endpoints (`buildMaterialListGroups`, `productionMfgController.js`,
still fully `RDBOM`-based) had **no frontend caller anywhere**, for any order kind — a
Machine order showed only a static "Materials not issued" banner, no rows, no actions.
Built the Machine-level equivalent of Child Part's own already-built trio one tier up:
`computeMachineMaterialRows` → `buildMachineMaterialList` → `requestMachineMaterial`
(`machineReorderService.js`, new), sourced from `findMachineMaterialLines` instead of
`findSubChildPartMaterialLines`, same categories (Child Part / Raw Material / Tool / Sheet
Metal / Length Fabrication) and the same "shortfall cascades into a real order, nothing to
purchase here" note on the reference-row category. New routes
(`machine-material-list`/`machine-material/request`) and controller functions
(`getMachineMaterialList`/`requestMachineMaterialController`), direct mirrors of the Child
Part pair. Frontend: the existing Material List `<Card>` and its query/Issue-mutation
(previously gated/keyed only for Child Part orders) broadened to also cover Machine orders
— picks the right endpoint by order kind, the table JSX and Receive/Return handlers needed
zero changes (already generic, and `receiveMaterialInProduction`/`returnMaterialToStore`
already work off `order.materialDemands[]` regardless of order kind).

Deliberately not touched: `buildMaterialListGroups`/`getMaterialList`/
`issueMaterialToStore`/`getUnissuedMaterials`/`getPartUnissuedMaterials` — still govern the
OLD, un-redesigned Job Work step gate and Parts QC "assign team" gate, which must keep
working exactly as today until the explicitly-deferred "process flow" pass. This new
Material List is additional and parallel, not yet wired into those old gates.

**R&D's manual approval queue — the piece that turned out bigger than expected.** The user
flagged `/r&d/approve-requests` (`RDProductionQueue.jsx`) as needing a check against the
new hierarchy. Traced it directly: both `processRDRequest`'s "Initial BOM" approval
workflow and `getRDRequestReviewData`'s Review-modal preview (`rdController.js`) were
entirely `RDBOM`-based — `processRDRequest` required `RDBOM.findOne({machine}).materials
.length > 0` or rejected outright with "No materials found in Master BOM." First instinct
was that this had to stay coexistence (RDBOM-fallback), reasoning that this manual approval
is the *only* remaining path to verification for a Machine with no `MachineBOM` yet — which
is the large majority of real Machines today. The user corrected this directly: the project
is still in development, not production, so those RDBOM-only machines aren't data worth
protecting a fallback path for. Cut fully over instead, matching exactly what
`getBomDesignStatus` already did one pass ago — both functions now check `MachineBOM`
(`isLocked`, same semantic `getBomDesignStatus` already uses) with no `RDBOM` fallback;
`RDBOM` itself is untouched, still sitting exactly where it already was in BOM Management's
own "Legacy" tab. `getRDRequestReviewData`'s response shape changed too (`bom: {materials}`
→ a top-level `materials` array, matching everywhere else this pass) — its frontend Review
modal updated to match, reusing the same Child-Part-vs-plain-materials grouped-table
pattern `bomViewOpen` already established rather than inventing a third rendering.

**Verified against the real database** (scratch script, isolated `TEST-MBR-` fixtures,
cleaned up after): 21/21 assertions — `computeMachineMaterialRows`/`buildMachineMaterialList`
produced the right 3 categories (Child Part / Raw Material / Tool) with correct per-row
totals/availability for a test Machine's `MachineBOM`; `requestMachineMaterial` correctly
created and capped a `materialDemands[]` entry; `getBomDesignStatus`'s Machine branch
returned the populated, correctly-tagged `materials` array; `processRDRequest`'s Initial
BOM approval correctly rejected while the test `MachineBOM` was unlocked, then correctly
succeeded (flipping `order.bomVerified`/`designVerified`, `RDRequest` reaching `'Approved'`)
once it was locked; `getRDRequestReviewData` returned the same new `materials` shape.
`node --check` + runtime import check on every touched/new backend file — including a
genuine circular-import chain (`rdController.js` → `machineReorderService.js` →
`childPartReorderService.js` → `productionMfgController.js` → `rdController.js`, via
`buildMachineDesignFiles`), confirmed safe the same way the codebase's existing
`productionMfgController.js`↔`childPartReorderService.js` cycle already was — every binding
involved is only ever called inside a function body, never touched at module-evaluation
time. `npx vite build` clean, twice.

## 21. Machine's own Store transfer handshake — audited, same one legibility fix as §16

With Machine's Material List now raising real `materialDemands[]` (§20, including a new
Child Part reference-row category), the next piece was Store's side of actually fulfilling
those requests — Issue and Return. Same discipline as §16's Child Part audit: traced the
whole chain function by function before touching anything.

**Confirmed the mechanics need zero changes.** `transferMaterialToProduction`,
`receiveMaterialInProduction`, `returnMaterialToStore`, and `confirmReturn` are all already
completely generic — every one of them is keyed off the order's own `_id` plus
`materialDemands[].materialCode`/`sourceItemCode`, with no `orderKind` branching anywhere in
any of them. Machine's new Child Part reference row pushes the exact same
`MaterialDemandSchema` shape Child Part's own Sub Child Part reference row already uses
(`materialCode`/`sourceItemCode` both set to the real `productKind:'ChildPart'` Item's own
code, no `fabricationCategory`) — so it already falls through to the same plain/flat
transfer-and-return path a raw material uses, exactly like §16 found for Sub Child Part one
tier down. Store's Pending Transfers page already had a 3-way order-kind tab split
(Sub Child Part / Child Part / Machine) from earlier work, so Machine's new demands already
land on the right tab with no routing change needed either.

**The one real gap — same shape as §16's.** The Pending Transfers list had no way to tell a
Child Part reference row apart from an ordinary raw material row within the Machine tab —
only the existing "Sub Child Part" badge existed. Fixed identically: a second batched lookup
in `getPendingRequests` (`Item.find({code:{$in:materialCodes}, companyId,
productKind:'ChildPart'})`, one query per page load, not per row), tagging `isChildPart` on
each pending material row; a second badge (teal, pairing with the existing teal "Child Part"
order-kind pill) rendered next to the material name in `PendingRequestsTab.jsx`, right beside
the existing indigo "Sub Child Part" one. Purely additive — no change to how anything
actually transfers.

Checked Pending Returns and Logs too: neither has a per-kind badge or tab split for *any*
tier today (not even Sub Child Part got one on Returns), so nothing needed adding there for
Child Part either — consistent with what already exists, not a new gap.

**Verified against the real database** (scratch script, isolated `TEST-SH-` fixtures,
cleaned up after): built a test Machine order with a Child Part reference demand row and a
plain raw-material row, confirmed `getPendingRequests` tags exactly the Child Part row
`isChildPart:true` (and not `isSubChildPart`) while leaving the raw-material row untagged;
walked a full Issue → Receive → Return → Accept cycle (`transferMaterialToProduction` →
`receiveMaterialInProduction` → `returnMaterialToStore` → `confirmReturn`), confirming
`Item.qty`, `demand.transferredQuantity`/`issuedQuantity`/`returnPendingQuantity`/`status`,
and the `StoreTransferLog`/`MaterialIssueLog`/`MaterialReturnLog` records all moved correctly
at every step; separately confirmed the Reject path leaves `Item.qty` untouched. 35/35
assertions passed; all test records removed afterward, confirmed no strays. `node --check`
on the touched backend file. `npx vite build` clean.

## 22. Machine QC — cut the old-BOM dependency, fixed a real premature-QCJob bug

Moving toward Machine's own build/process pipeline, but scoped deliberately narrow first:
get QC's own foundation right before designing the rest, since QC gates sit inside that
very pipeline. Two things prompted this — a screenshot showing a QC job already "Pending"
on a brand-new Machine order nobody had touched yet, and Machine QC being "based on old
bom," needing the same kind of fix Child Part/Sub Child Part QC already got.

**Root cause, one shared story.** The old "Parts QC" system — `RDChildPart`-embedded
sub-parts of a Machine, each individually inspected via `QCJob.partChecks[]` — modeled
exactly what a Child Part now is: a reusable, independently-stocked unit with its own
complete Fabrication → Assembly → QC → Painting pipeline (§17). A Machine order built off
a real `MachineBOM` has no leftover in-house sub-parts needing their own mid-build QC —
every Child Part it references already passed its own QC before ever being issued to that
order. Confirmed with the user: cut all `RDBOM`/`RDChildPart` connection for
`MachineBOM`-driven orders; Final Testing (already hierarchy-agnostic, already correct)
becomes the only QC gate for them. Old `RDBOM`-only machines keep working exactly as
today — same "branch on `MachineBOM` presence, leave what falls through alone" rule every
cutover this session has used.

**The reported bug, confirmed live in the real database before fixing anything.**
`PROD-2026-903031` (machine `BP816`, real order, real not-yet-locked `MachineBOM`, zero
`RDChildPart`/`RDBOM` records) already had a "Pending" QC job — even though all 6 of its
process steps were still `'Pending'`, nothing worked on at all. Root cause:
`getPartsQC` (a **GET** endpoint) unconditionally calls the QCJob-creating
`ensureQCJobForOrder`, and the frontend panel that calls it (`SubChildPartQCPanel`) had no
progress gate on its query — unlike every sibling panel on the same page (Child Part's
unit checklist, the in-house Sub Child Part checklist — whose own comment names this exact
bug class — and the Final Testing panel), which all correctly wait for the relevant step
to actually be reached. Fixed by adding the same gate: the panel only mounts once
Fabrication's own `proc.status !== 'Pending'`.

**Investigating this also turned up a second, deeper instance of the very same bug class**
— one already partially fixed once before (2026-09-02, `getQCJob`'s own comment describes
it) but which the new hierarchy quietly reopened. QC's Final Checklist review
(`QCInspection.jsx`) decides whether Production must submit the checklist first
(`productionFilled`/`finalCheckReady`) by checking `job.partChecks?.length > 0` — but a
`MachineBOM`-driven manufactured order legitimately has zero partChecks by design (see
above), even though it still absolutely must go through Production's fill-first flow like
every other manufactured Machine. The backend (`getQCJob`) had the identical bug. Both
fixed the same way: replaced the `partChecks.length` proxy with the item's real
`productSourceType` (`MANUFACTURING_SOURCE_TYPES`, the exact same check
`ensurePartChecksStructure` already used) — `getQCJob` now resolves this once and returns
it as `isManufacturedMachine`, and the frontend's `finalCheckReady`/`productionFilled` key
off that field plus the real `finalCheckFilledBy`/`finalCheckFilledAt` timestamps directly,
instead of ever re-deriving anything from partChecks.

**`markProcessComplete`'s Fabrication branch needed the same correction, for a subtler
reason.** It used to *always* skip the normal "QC Pending → self-certify Approve" step and
auto-complete Fabrication with a `qcBy: 'Sub Child Part QC'` label, on the reasoning that
every part was already individually reviewed — true for an `RDBOM` machine with real parts,
but for a `MachineBOM`-driven order (zero partChecks) this was quietly recording a fake
approval for a step nothing had actually checked. Now it only takes that shortcut when
`partChecks.length > 0` (a real, already-correct signal here, unlike the two cases above);
otherwise it falls through to the same plain QC Pending / self-certify path every other
step already uses.

**R&D's Product Master QC page** (`/r&d/product-master-qc`) always showed "No BOM created
yet for this product" for a `MachineBOM`-driven machine — misleading, since `BP816`
obviously does have one, just not the old kind. `getProductQCParts` now checks for a real
`MachineBOM` first and, if found, skips the `RDChildPart`/`RDBOM` reads entirely and
returns `hasMachineBOM: true`; the page swaps the old tree for a short note pointing at
Child Part's own QC master (`/r&d/inventory-qc` → Child Part) instead. Old `RDBOM`-only
machines are completely untouched — the branch only ever fires once a `MachineBOM` exists.

**Also found and cleaned up while investigating (unrelated to the fix itself):** three
orphaned "Pending" QC jobs (source `'Store'`, item name "TEST RL Machine A5") turned out to
be leftovers from this session's own earlier reservation-ledger scratch test (§19) — the
`Item`/`ProductionOrder` fixtures were correctly cleaned up at the time, but these `QCJob`
records, created as a side effect of a separate Store "Item created → QC Inward" trigger,
were not accounted for. Confirmed genuinely orphaned (referenced items no longer existed)
and deleted.

**Verified against the real database**: 21/21 assertions (isolated `TEST-QCFIX-` fixtures,
cleaned up after) — a `MachineBOM`-driven test machine confirmed to skip the old tree
entirely, create a QCJob with empty partChecks, correctly fall through to the plain QC
Pending path on Fabrication complete, and correctly gate its Final checklist pull on a real
`finalCheckFilledAt` timestamp (using a real selectable row off this company's actual
Final-stage master checklist, not a synthetic one) — run side by side with an
`RDBOM`-driven test machine confirming every one of those behaviors is completely
unchanged (partChecks populated, the QC-approved gate still enforced, the auto-complete
shortcut still taken once approved). `node --check` on every touched backend file.
`npx vite build` clean. Same standing caveat as every frontend pass this session: no
browser automation available — verified via confirmed backend contracts and a clean
production build, not an actual click-through.

## 23. Machine's own build pipeline — the final piece, 2-step Assembly → Final Testing

The last deferred piece: a Machine order's actual build pipeline. The user specified the
new shape directly: since a Child Part is now independently built, painted, and QC'd on
its own complete pipeline before it ever reaches a Machine order (§17), a
`MachineBOM`-driven Machine order no longer needs Job Work/Fabrication/Painting/
Re-Assembly at all — just **Assembly** (assign team + material check, start, work, Mark
Complete straight to `Completed` — no self-certify QC step, nothing individual to review)
then **Final Testing** (Start → Checklist → Complete → QC department). Old `RDBOM`-only
machines keep their full 6-step pipeline, completely unaffected.

**The core architectural problem, found before writing any code**: Mongoose calls a
schema's `default` function with zero arguments — `processes: { default: buildProcessSteps
}` can never see `orderKind`, let alone do an async `MachineBOM` lookup. `childPartReorderService.js`
already had to work around this exact trap for Child Part orders (`processes: []` explicit
override). The same discipline had to apply here: the new 2-step shape can only ever come
from **explicitly computing and passing `processes`** at order-creation time, never from
the bare schema default. A new shared helper, `resolveMachineOrderProcesses(machineCode,
companyId)` (`machineReorderService.js`), resolves the target Item (handling the
ObjectId-or-code ambiguity `machineCode` sometimes carries for Store-originated QC-rejected
rebuilds — the same dual-shape lookup `resolveInventoryItem` already uses elsewhere), checks
for a real `MachineBOM`, and returns either the new 2-step shape or the old 6-step one. Called
explicitly at all 3 places a Machine order gets created — `createOrder` (the user-submitted
form), `storeFlowService.js`'s `applyStoreDecisionToItem` CASE 2, and `qcController.js`'s
`createRejectedProductionOrder` — mirroring exactly how `childPartReorderService.js` already
does this for Child Part orders.

**Once that real shape exists on the document, every downstream check reads it directly**
instead of re-deriving anything from `orderKind` — the same pattern already confirmed safe
elsewhere in this codebase (`computeOrderProgress`, `reopenFinalTestingForRejection`,
`canStart` all already worked this way). A tiny helper, `isMachineBOMPipeline(procs)`,
checks the shape itself (`length===2 && ['Assembly','Final Testing']`) with zero extra
queries. This one move fixed a whole prioritized list of real bugs a 2-step order would
otherwise have hit — all found by direct code reading before any line was changed:
`ProductionContext.jsx`'s `stepIndex` resolver (every button click on the page routes
through it — was resolving against a static, orderKind-keyed constant that can only ever
return ONE shape per orderKind, but Machine now legitimately has two), `approveQC`'s
`isFinalStep` (`idx === PROCESS_STEPS.length - 1` — never true for a 2-step order's real
Final Testing at idx 1, silently skipping cost capture entirely), `startProcess`'s
team-assignment gate (`idx > 1` — never true for either step of a 2-step order, silently
dropping the gate), and a handful of `idx === 0`-means-"Job Work" assumptions that needed
to become name-based (`procs[idx].step === 'Job Work'`) instead — already the established
robust pattern this file's `Fabrication`/`Final Testing`/`ChildPart` branches use.

**Assembly's new material-check gate** mirrors Job Work's own existing "assign team, check
materials received" shape, but reads the **new** Material List's own live ledger
(`order.materialDemands[]`, already populated by `requestMachineMaterial`/Store's handshake,
§20/§21) instead of the OLD `RDBOM`-driven one Job Work still uses — a plain synchronous
filter, no extra query needed, since `materialDemands` is already embedded on the order.
Same belt-and-braces assign-time + start-time double-check Job Work's own gate already
uses. **Assembly's completion deliberately does NOT fake a QC label** — the old Fabrication
branch's habit of writing `qcBy: 'Sub Child Part QC'` even when nothing was actually
individually reviewed (already flagged as a real gap during the QC-fix pass, §22) is not
repeated here: `qcStatus`/`qcBy` are left at their schema defaults, an honest reflection
that no one certified anything.

**QC's own approve→dispatch / reject→fix→resubmit cycle needed zero changes** — confirmed
by direct code reading, not assumed. It's pre-existing (2026-09-01/02), structurally
identical to Child Part's own cycle, and already shape-agnostic
(`procs[procs.length - 1]`, not a static index). Verified with a shape assertion in the
scratch test rather than a full `submitDecision` simulation (which needs unrelated Sale
linkage this test's isolated fixtures don't have) — confirmed the real last step at
`processes.length - 1` correctly IS Final Testing for the new 2-step shape.

**The "two buttons" bug, confirmed exactly and fixed**: while Final Testing was `In
Progress`, both the generic "Mark Complete" button and `FinalChecklistPanel`'s own "Save
Checklist" button rendered simultaneously, hitting two different endpoints with no
coordination — a real, confusing UX bug (click Mark Complete first, get a 400; or fill
the checklist and then have to hunt for the separate button). Fixed frontend-only: a new
`final-checklist` query at the page level (shares its cache with `FinalChecklistPanel`'s
own identical query — React Query dedupes on queryKey, so this costs nothing extra) hides
"Mark Complete" until every checklist row is actually decided, showing a plain "Complete
the checklist below first" hint in its place instead. The backend's existing gate (already
correct) is completely unchanged — this is purely "don't show an action that will just
fail," not a new rule.

**Production's cost/expense submission now writes into `MachineBOM`, scoped narrowly.**
`MachineBOM` already had everywhere it needed to push a cost into the Machine Item's price
— `syncMachineBOMPricing(item, bom)` (now exported from `machineBOMController.js`) already
folds `bom.productionCost + bom.productionExpense` into the rolled-up Total Cost and pushes
it onto `Item.stdCost/mrp/salePrice`, the exact mechanism R&D's own manual
`updateMachineBOMProductionCost` endpoint already uses. `approveQC`'s existing `isFinalStep`
branch (which already resolves the Machine Item and already requires
`productionCost`/`productionExpense`) got one new parallel branch: if a `MachineBOM` exists,
write `productionCost`/`productionExpense`/`productionCostSource:'Actual'` into it and call
that same `syncMachineBOMPricing` — right alongside the existing `RDBOM`/`recalculateItemPricing`
branch, which already naturally no-ops for a `MachineBOM`-driven machine (it never has an
`RDBOM` to find) — no "cutting" needed, the old branch already falls through cleanly.
**Correction to an initial assumption made mid-research**: Child Part's own equivalent,
`recalculateChildPartCost`, does NOT push to Item pricing at all (confirmed by reading it
and its own comment) — `MachineBOM` isn't symmetric with `ChildPartBOM` here, it already
had the push Child Part still lacks. Explicitly scoped narrow, confirmed with the user:
this is just the one production-completion trigger the broader
`automated-pricing-cascade-design-2026-09.md` lists as a prerequisite (§9) — not that
design's full multi-level automatic cascade (raw-material-price-driven refresh of a
Machine's own `childParts[]`/`materials[]` lines, the Sub Child Part/Child Part legs),
which stays deferred until every new-hierarchy production flow exists.

**Verified against the real database**: 30/30 assertions (isolated `TEST-PF-` fixtures,
cleaned up after) — `resolveMachineOrderProcesses` correctly resolving both argument shapes
(real code, and an ObjectId string mimicking a Store-originated QC-rejected rebuild) and
falling back safely when unresolvable; `createOrder` itself (not just the helper) producing
a real 2-step order; the full Assembly cycle (material-check blocked → issued → assign →
start → mark complete straight to `Completed` with defaulted `qcStatus`/`qcBy`, Final
Testing NOT auto-advanced); Final Testing's team gate, its checklist-gated Mark Complete
(confirmed blocked before the checklist is filled, succeeding after), and `approveQC`'s
cost capture (`MachineBOM.productionCost/productionExpense/productionCostSource` written,
`Item.stdCost/mrp` correctly recalculated, confirmed zero cross-contamination into the
control machine's own `RDBOM`); a parallel old-`RDBOM`-shaped order (6-step, real
`RDBOM`, no `MachineBOM`) confirming every existing behavior (`getStepIndex`'s rough
pre-filter, the predecessor-completed gate) is completely unaffected. `node --check` +
runtime import check on every touched backend file. `npx vite build` clean.

**Known, deliberately-accepted limitation, not fixed this pass**: `ProductionContext.jsx`'s
`buildDefaultProcesses`/`getUnitProcessesFor` (and its duplicate in `ProcessExecution.jsx`)
— the display-only placeholder shown for an un-materialized extra unit (multi-quantity
orders, units 2+) before the backend has lazily created it — is still orderKind-only, so it
would briefly show the wrong (old 6-step) placeholder shape for a MachineBOM-driven
multi-unit order's un-opened extra units. Purely cosmetic (the real data, once the backend
materializes it via the now-correct `getUnitProcesses`, has the right shape) — confirmed
not a data-corruption risk, flagged rather than fixed given how rare the combination
(MachineBOM-driven AND `orderQuantity > 1` AND an unopened extra unit's tab) is in practice.

## 24. Sub Child Part's own Material List — the last tier gets one too

Sub Child Part orders had no real Material List at all — just a single blind "Issue"
button ("Raw material hasn't been requested from Store yet"), with zero visibility into
what material, how much, or its availability until clicked. A different coding agent
(brought in mid-session for a separate round of bug fixes, see
`new-bom-hierarchy-bug-fixes.md`) had been asked to build the same categorized table Child
Part/Machine already have and reported back that it couldn't be done "without data."

**That wasn't correct — confirmed by reading the code directly.**
`computeSubChildPartRawMaterialAvailability` (`subChildPartOrderService.js`), already
built and already used at order-creation time, already computed everything needed:
`neededQty`/`unit` (the sheet or piece count), `availableQty`/`shortfallQty`, and — for
the two fabrication kinds — `totalAreaNeededMm2` (sheet metal) or `totalLengthNeededMm`
(length-based), the raw area/length actually consumed. It just had never been wrapped
into the same UI-facing shape Child Part's and Machine's own Material List rows already
use — a real gap, but a display/wiring one, not a data one.

A Sub Child Part order only ever has exactly one source material
(`Item.subChildPartDetails` is always a single source), so this is a smaller version of
the same trio pattern already built twice this session — one row instead of a
categorized multi-row table, reusing the exact same frontend table component Child
Part/Machine already have rather than building a new one.

**Backend** (`subChildPartOrderService.js`): new `buildSubChildPartRawMaterialList(order,
companyId)` wraps `computeSubChildPartRawMaterialAvailability`'s single result into the
same `{categories:[{name, materials:[...]}]}` shape — `amount`/`totalAmount` from
`Item.subChildPartDetails.sourceQty`/`sourceUnit` (already a human unit, no mm
re-conversion needed) × build quantity, `null` for a plain (non-fabrication) source since
that tier has no separate "amount" concept either, matching Child Part's own convention;
`quantity`/`totalQuantity` from the sheet/piece count; `availability` from `shortfallQty`.
New `requestSubChildPartRawMaterial(order, companyId, demandKey, requestQuantity)` —
direct structural mirror of Child Part's own `requestSubChildPartMaterial`: capped at the
row's real total need, incremental (grows an existing demand rather than replacing it),
no `checkAndReserve`/Purchase-Request side effect on Issue (that already happened at
order-creation time) — same "Issue is purely a `materialDemands[]` write" philosophy
every tier's Material List already uses. `computeSubChildPartRawMaterialAvailability`'s
`sheet`/`length` branches also gained real `amountValue`/`amountUnit` on their
`demandSeed` (previously left `null`), bringing it in line with every other tier's
`demandSeed` convention.

**Controller/routes**: new `GET /orders/:id/sub-child-part/material-list`; the existing
`POST /orders/:id/sub-child-part/material-request` — previously a one-shot, no-body
"create the single demand" call — now takes `{demandKey, requestQuantity}` and is
incremental/capped, matching the reusable table's own Issue-button contract. Safe to
change in place since it was only ever called from the one frontend button replaced in
this same pass.

**Frontend** (`ProcessExecution.jsx`): the existing Material List table (already shared
by Child Part and Machine orders) gets a third branch — Sub Child Part orders now point
at the new endpoints instead of being excluded. The old ad-hoc "Raw Material" card (a
single blind Issue button, then a flat name/status readout once one demand existed) is
removed entirely — fully superseded by the table, whose row-level Issue/Receive/Return
buttons already run on the same generic, already-order-kind-agnostic mutations the old
card's own inline logic was duplicating.

**Verified against the real database**: 23/23 assertions (isolated `TEST-SCPML-` fixtures,
cleaned up after) — one real Sub Child Part order per kind (`plain`, `sheet` — cloned from
the real ss-sheet shape, `length`), confirming the correct Amount/Total Amount (fabrication
kinds only) and Qty/Total Qty split, correct availability, and correct `demandKey`; a
full incremental-Issue sequence (reject over-cap → partial Issue → Issue again up to the
cap → reject further requests once capped). `node --check` + runtime import check on
every touched backend file. `npx vite build` clean.

**Two follow-up fixes, same day, caught during review.** First, the QTY column: the
initial version showed `totalQuantity / buildQty` for every row, including a dangling
unit even when the underlying value was `null` (rendered as a bare "— Centimeter Square").
Traced further and corrected the actual design, not just the display glitch: for the two
fabrication kinds (`sheet`/`length`), the physical unit Store/Production ever exchange is
a **whole** catalog sheet/piece — `totalQuantity` is a ceiling-rounded whole-piece count
for the *entire order*, not something with a meaningful per-unit fraction (a `plain`
source material's own per-unit qty, by contrast, is exact — `sourceQty` itself, no
rounding). Confirmed with the user: QTY now shows "—" for `sheet`/`length` rows, a real
per-unit value for `plain` rows.

Second, and more serious: a real Return-flow bug, found while tracing through the first
question properly. `buildSubChildPartRawMaterialList` wrapped its one row into a category
hardcoded to `name: 'Raw Material'` always — unlike Child Part's/Machine's own Material
List builders, which both set the category name to the row's own real kind. The
frontend's Return dialog decides whether to ask for a measured leftover length **and**
width (the sheet-metal case) by checking `row.category === 'Sheet Metal'` — since a Sub
Child Part row's category was always the literal string `'Raw Material'`, that check was
always false, so the leftover-measurement fields never rendered, and the backend's own
(already-correct, generic) `returnMaterialToStore` then rejected every sheet-metal-kind
Sub Child Part return with "A measured leftover length is required..." — **every single
Return attempt on a sheet-metal-kind Sub Child Part was failing.** A `length`-kind Sub
Child Part was unaffected (its demand already carries a real cut `bomDimensions`, so the
backend never asks for a measurement in the first place). Fix: the category name is now
the row's own real `subProcessType` (`'Sheet Metal'` / `'Length Fabrication'` / `'Raw
Material'`), matching Child Part's/Machine's own convention exactly — this alone fixes
the bug, since it makes the existing, already-correct frontend check evaluate correctly
for Sub Child Part rows too; no frontend change needed.

Deliberately not done in this pass: making the frontend's Sheet-Metal detection fully
backend-mirroring (checking `fabricationCategory`/`bomDimensions` shape directly instead
of the category-name string) — a real robustness improvement, but touches shared code
across all 3 tiers for a case that isn't currently broken for the other two; flagged for
a future pass.

**Verified against the real database**: 9/9 assertions (isolated `TEST-SCPRET-` fixtures,
cleaned up after) — correct category name and QTY value per kind; a full sheet-metal
Return with a measured leftover length+width now succeeds through the real
`returnMaterialToStore` controller (previously always 400'd); confirmed a Return attempt
*without* a measured leftover still correctly rejects, proving the backend's own real
requirement was never the problem — only the frontend's gate on showing it. `node --check`
+ runtime import check.

## What's next (not built in this pass)

- **Delivery Estimation** — still `RDBOM`-only for Machine; a `MachineBOM`-driven order's
  own lead-time sample still gets recorded correctly (§23's `approveQC` fix didn't touch
  that part), but the estimator's own BOM-reading side hasn't been cut over. This is now
  the one remaining "Wiring Production/Store/QC to the new hierarchy" gap — Material
  Issue, material availability, and the part-checklist tree are all done as of §18/§20-23;
  a `MachineBOM`-driven machine can now actually be produced end-to-end through Process
  Execution.
- **The OLD Job Work step gate / Parts QC "assign team" gate's own `RDBOM`-based material
  check** — still exactly as it was, deliberately untouched; only ever reachable by an
  old-`RDBOM` machine now, since a `MachineBOM`-driven order's own pipeline (§23) never has
  a `Job Work`/`Fabrication` step at all.
- **Automatic Purchase/Production-triggered cost recalculation** for the new hierarchy —
  today it's manual-refresh (on BOM edit/view) only, at every level.
- **Cost cascading to consumers** — a raw material's price change doesn't proactively
  ripple through Sub Child Part → Child Part → Machine; each level has to be reopened to
  pick up a change made underneath it. Pre-existing gap, not solved in any pass so far.
- **The Child Part reorder cron's pipeline shape.** Still live, still creates Job-Work-
  first, 4-step Production Orders for Child Part — confirmed explicitly out of scope;
  real surgery across Production/QC/the reorder service, deserves its own dedicated pass.
- **BOM Format & Modification relocation** to a per-row View modal instead of table
  columns.
- **The cascading low-stock cron** — Machine needing more Child Part stock → auto-raise a
  Child Part order → if short on Sub Child Part stock, auto-raise a Sub Child Part
  order/request — explicitly excluded from every pass so far per your instruction. Each
  level's own low-stock sweep (this one, and Child Part's) still runs independently.
- **Out-Source route's raw material still has no ongoing Store handshake** — §10 fixed the
  "checked once and never rechecked" half (there's now a live recheck + a real deduction
  on Send Round), but if Purchase ever needs to physically ship Samtek's own raw material
  to the job-work vendor with its own transit/receive tracking (rather than a same-request
  deduction), that's still its own follow-up design; flagged, not built.

## Verification done

- `node --check` on every touched backend file.
- Runtime import check (`node -e "import(...)"`) on every renamed backend file and the
  new controller/route wiring — all load cleanly.
- `npx esbuild` syntax check on every touched/new frontend file.
- Full `npx vite build` run — see note below if anything unexpected turned up.
- Data migration run against the real database: 8 Items and 3 Production Orders flipped
  from `'SubChildPart'` to `'ChildPart'`, verified zero remaining old-labelled records.
- Sheet Metal Plan pass: end-to-end scratch script against the real Fan Blade Sub Child
  Part record confirmed correct per-piece area, required area, planned area, and scrap
  cost math, and that the scrap cost persists correctly onto the Item; scratch data
  cleaned up afterward.
- Child Part Master pass: end-to-end scratch script against the real database — created a
  test Child Part, added a real Sub Child Part line, a raw material line, and a tool
  line, set a Production Cost, confirmed the Total Cost math by hand, confirmed the test
  Child Part appears in the new catalog's list, and confirmed a plain old-flow-style
  `productKind:'ChildPart'` Item with no `ChildPartBOM` is correctly rejected by every
  new-flow endpoint; scratch data cleaned up afterward. Full `npx vite build` run twice
  (once after the BOM Management changes, once after the Inventory rebuild) — both clean
  aside from the two known pre-existing warnings and the large-chunk-size notice.
- Machine BOM pass: end-to-end scratch scripts against the real database —
  (1) weight rollup confirmed by hand across Sub Child Part → Child Part (fabrication and
  flat Mass/Count weight branches both checked); (2) a real, existing machine's BOM
  created, a Child Part + a raw material added, Production Cost set, cost and weight
  rollup confirmed by hand, `Item.stdCost`/`mrp`/`salePrice` write-back confirmed, Lock
  confirmed to produce a real PDF + Documentation record — the machine's original pricing
  fields and document list were fully restored afterward; (3) the Documentation
  resolution chain (Machine BOM → Child Part → Sub Child Part images) confirmed correct,
  including the exact name/grouping shape the rebuilt Documentation page depends on.
  **Note:** an early cleanup script's over-broad query deleted one pre-existing
  `RDDocument` record unrelated to this session's testing before this was caught — see the
  session record for the full account; the record couldn't be restored, though
  investigation found no live BOM record it could still have belonged to.
- In-House (Production) route pass (§12): 29-assertion end-to-end scratch script (assign
  team → start → checklist → submit to QC → reject → fix/resubmit → approve → stock
  credited), plus a separate 10-assertion scratch script for the deferred-material-Issue
  fix. `npx vite build` clean after both the initial build and the fix. All scratch data
  cleaned up afterward.
- Weight columns pass: end-to-end scratch script against the real database — built the
  same Sub Child Part → Child Part → Machine chain, confirmed each material/tool line's
  newly-decorated `weightKg` matched a hand-computed expectation, and confirmed the
  existing aggregate weight totals (unchanged by this pass) still matched too — including
  a check that a Child Part's own rolled-up weight correctly feeds into the Machine's
  weight one level up. The real machine's pricing fields were restored and confirmed
  unchanged afterward. Full `npx vite build` clean, aside from the two known
  pre-existing warnings and the large-chunk-size notice.
- Sub Child Job Work pass (§10): end-to-end scratch script against the real database —
  plain material, sheet metal (both cut and whole-sheet cases, across two job-work-type
  rounds), length fabrication (both the exact-remainder-match combine and the
  no-match/plain-rounding fallback), and the shortfall-blocks-send guard, 26/26 checks
  passing. Caught and fixed a real `$elemMatch` bug (see §10) via this testing, not just
  by inspection. All test Items/orders deleted and the real Store items (Sheet, Angle,
  a plain material) restored to their exact original stock afterward. Full `npx vite
  build` clean, aside from the two known pre-existing warnings and the large-chunk-size
  notice.
- QC gate pass (§11): end-to-end scratch script against the real database — full receive
  → Pending QC → partial reject → approve-remainder cycle, a separate full-reject cycle,
  and a missing-cost-blocks-receive case, 29/29 checks passing (see §11's own summary for
  the specifics). All test Items/orders/QCJobs deleted and the real source Item's stock
  restored afterward. Full `npx vite build` clean, same two known pre-existing warnings.
