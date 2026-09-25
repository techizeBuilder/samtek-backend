# BOM Hierarchy Redesign — Sub Child Part / Child Part / Machine

**Status as of 2026-09-12: DESIGN ONLY. No code has been written for this redesign yet.**
This file is Claude's own working-memory reference for this redesign (so a context
compaction doesn't lose the decisions below) — it is not the user-facing change
report. That's a separate file, see "Relationship to the other doc" at the bottom.

## 1. Why this file exists — the story so far

Everything built earlier in this session (logged in full in
`sub-child-part-inventory-2026-09.md`) — the stockable Sub Child Part `Item`, its
low-stock reorder cron, its `Job Work → Fabrication → Assembly → Painting`
production pipeline, its QC checklist infra, its material Issue/Receive/Return
handshake — **is real, working code, but it is mislabeled.**

The user demoed it to the client (2026-09-10). The client got confused when asked
about the Job Work step, and across two follow-up meetings (evening + next
morning) it came out that **the client had been saying "child part" while meaning
what we built as "sub child part."** The technical structure is sound; it's
anchored one hierarchy level too low. A same-day 2pm meeting (2026-09-11)
confirmed a corrected 4-level hierarchy and several concrete new details. This
doc is that corrected design.

**Nothing has been renamed or rebuilt in the codebase yet.** The existing
Sub-Child-Part-labeled code (Item `productKind: 'SubChildPart'`,
`subChildPartReorderService.js`, `orderKind: 'SubChildPart'` on ProductionOrder,
the QC checklist canonical-per-part system, `RDChildPart.subChildParts[]`
linking+guard) is exactly the mechanism needed for the corrected **Child Part**
level below — it mostly needs relabeling + a few real changes, not a rewrite.
See §6 for the old→new mapping.

## 2. The corrected hierarchy (confirmed)

```
Raw Material  →  Sub Child Part  →  Child Part  →  Machine
 (existing,        (NEW node,         (= today's       (existing,
  unchanged)         small)          "Sub Child Part    BOM now
                                      Inventory" build,  references
                                      renamed + reworked) Child Parts)
```

**Guiding principle** (this is what makes it a real hierarchy, not a flat tagged
list): material composition is defined **once**, on whichever level owns the
reusable identity. Only the top, never-reused level (Machine) is allowed to vary
its material composition per instance. Concretely:

- A **Sub Child Part**'s composition (what raw material, what job work) is fixed
  wherever it's used — defined on the Sub Child Part itself.
- A **Child Part**'s composition (which Sub Child Parts + which other materials)
  is fixed wherever it's used — defined on the Child Part itself, reused
  identically across every Machine that references it.
- A **Machine**'s BOM references Child Parts by code/qty (never re-declares their
  contents) plus its own machine-only extra materials — the one place
  composition genuinely differs per instance.

This also means **no guard/sync-across-copies system is needed at any level** —
unlike the old model's `subChildParts[].inventoryItem` linking guard (which
existed only because the old model embedded copies), a real reference (by code)
to a standalone document has nothing to keep in sync. That guard machinery can
likely be retired once this lands, not multiplied.

## 3. Sub Child Part — confirmed details

- **One source raw material** per Sub Child Part (client confirmed explicitly:
  "one material per sub child part" — not a multi-material BOM).
- **Job Work** flag: Yes (outsourced) / No (in-house).
- **Job Work Type**: multi-select, regardless of the Job Work flag. It's not just
  a vendor-service label — it's literally which operation(s) turn the raw
  material into this Sub Child Part (e.g. Laser Cutting, Bending), whether
  Purchase sends it to a vendor or Production does it in-house.
- **Routing**: Job Work = Yes → **Purchase** (PR/RFQ/PO to an outsource vendor,
  received back into Sub Child Part stock — this can likely reuse the existing
  raw-material low-stock reorder + PR/PO machinery almost as-is, since it's
  "buy a purchasable item," just routed to a job-work vendor). Job Work = No →
  **Production**.
- **In-house build = exactly ONE process step** (confirmed 2026-09-12, closing
  the one open question from the 2pm meeting): a single "Job Work" step —
  assign team → start → mark complete — regardless of how many Job Work Types
  are multi-selected. No multi-station pipeline, no Fabrication/Assembly/
  Painting at this level. Completing it produces stock.
- Has **its own stock** (qty, minStock, reorderQty) and is reused across every
  Child Part that references it.
- **Sheet Metal Plan re-homes here** (see §5) when the source raw material is
  sheet metal.

## 4. Child Part — confirmed details

This is the renamed + reworked version of this session's existing
"Sub Child Part Inventory" build.

- **Material list** = the Sub Child Parts it's assembled from (+ qty) **plus**
  other materials it consumes directly during its own build (raw material,
  tool, in-house length-fabrication) — client confirmed both explicitly
  ("child will have other material for assemble the child with sub child part
  mean (sub child part + other materials)").
- **Own stock**, own low-stock reorder → own Production Order, own QC
  (canonical checklist, Product-Master-QC-managed) — all of this already
  exists, just needs relabeling from Sub-Child-Part to Child-Part terms.
- **Pipeline**: Fabrication → Assembly → Painting. The old **Job Work step
  drops out of Child Part's own pipeline** — since Sub Child Part is now
  independently stocked/replenished (by Purchase or Production, per its own
  Job Work flag), Child Part just receives already-stocked Sub Child Part
  units from Store like any other material category, the same way it already
  receives Raw Material/Tool. Whether this is still shown to Production as a
  distinct visible stage is an explicitly **deferred** decision (user: "we
  didn't ask the client this, concern about it later, first we're changing the
  BOM design") — doesn't block the redesign itself.
- **Reused across every Machine** that references it (this is the reusability
  the client actually meant by "child part" — see §1).
- `RDChildPart` today is **machine-scoped** (`product: required`,
  `{company, product, code}` unique) — this is real surgery needed, not a
  rename: Child Part must become a standalone collection, the same way today's
  linkable Sub Child Part *Items* already are.

## 5. Machine — confirmed, smallest change

- BOM becomes references to Child Parts (by code/qty) instead of a flat
  material list — Machine never re-declares a Child Part's own contents.
- Plus its own machine-only extra materials (paint, wiring, generic hardware
  not tied to any one Child Part) — confirmed by the client as the one level
  where composition legitimately varies per instance.
- No level is ever skipped (confirmed 2026-09-11): strictly Sub Child Part →
  Child Part → Machine. A Machine order needing more Child Part stock raises a
  **separate Child Part order**; that order, if short on Sub Child Part stock,
  raises a **separate Sub Child Part order/request** (Production or Purchase,
  per that Sub Child Part's own Job Work flag). This cascading-order pattern is
  structurally identical to the low-stock-reorder cron already built this
  session — it just needs to run at two tiers instead of one, with a
  Purchase/Production fork at the bottom tier. Not new invention.

## 6. Cost rollup (confirmed direction, not yet built)

User: "your given logic is good we will move with it because once our structure
is ready that cost rollup is easy to implement."

- **Sub Child Part unit cost** = its raw material cost + (scrap-adjusted average
  per piece, if sheet-metal-sourced — see §7) + its own job-work cost (vendor
  price if outsourced, Production's logged cost if in-house).
- **Child Part unit cost** = Σ(Sub Child Part unit cost × qty used) + Σ(other
  material cost × qty used) + its own Production Cost/Expense (assembly
  labor).
- **Machine unit cost** = Σ(Child Part unit cost × qty used) + machine-only
  extras + its own Production Cost/Expense.
- Every level keeps the **same "R&D Estimate — overwritten once Production
  completes a build" mechanic** already on the Machine's Production Cost card
  today (`itemPricingService.js` / the BOM Management Production Cost UI) — it
  just needs to recurse through 3 levels instead of computing flat at Machine
  only.

## 7. Scrap / Sheet Metal Plan

- Moves from Machine-level BOM to **Sub Child Part level** — sheet metal is now
  understood as one Sub Child Part's own job-work material, not a cross-part
  shared-sheet nesting problem at the machine level.
- Calculation: total scrap across the sheets consumed for that Sub Child Part's
  job-work runs, then averaged per piece to get a per-unit scrap cost that
  feeds into §6's Sub Child Part unit cost.
- This is **not new math** — a Scrap Cost tile already exists on today's
  (machine-level) Sheet Metal Plan, computed from planned vs. required area.
  It just needs to be re-anchored to Sub Child Part instead of Machine. See
  also the still-open `temporal-cuddling-crescent` plan-mode design (multiple
  discrete sheets per plan, `sheets[]` array, catalog-fit validation) — that
  work is orthogonal/compatible, just needs to end up attached to the new
  Sub Child Part node instead of the machine BOM.

## 8. Deferred / explicitly not blocking

- Whether Child Part's pipeline keeps a visibly-labeled "Job Work" stage for
  Production even though there's no vendor round-trip inside it anymore
  (cosmetic — decide later).
- Stale QC job `QC-2026-0189` (source `Stock`, ref `ORD-2026-055`, item
  CF-001, 0 partChecks, status "In Progress") — created by the old (pre-fix)
  Process Execution screen opening the machine Sub-Child-Part-QC panel on a
  Sub Child Part order before this session's Phase 2 gating existed. Harmless
  leftover, still needs deleting whenever we touch QC again — not urgent.
- The full QC-department per-unit review flow (discussed at length before this
  BOM redesign surfaced) is paused — it was designed against the OLD
  hierarchy's "Sub Child Part order builds N units" shape. Once Child Part is
  the thing with a build pipeline, that whole discussion re-applies to Child
  Part instead; revisit it after the BOM redesign lands, don't build it against
  the old labels.

## 9. Old → new mapping (for when we actually start building)

| Old (built this session, wrong level) | New |
|---|---|
| `Item.productKind: 'SubChildPart'` | `'ChildPart'` |
| `subChildPartReorderService.js` | Child Part reorder service (same shape) |
| `ProductionOrder.orderKind: 'SubChildPart'` | `'ChildPart'` |
| `SUB_CHILD_PART_STEPS` (Job Work→Fabrication→Assembly→Painting) | Child Part steps = Fabrication→Assembly→Painting only (Job Work step removed, see §4) |
| `RDChildPart.subChildParts[].inventoryItem` linking + guard | Retired — Child Part becomes a standalone doc referenced directly, no embedded copies to guard |
| `RDChildPart` (machine-scoped, `product: required`) | Needs to become standalone (no longer one-per-machine) — real change, not a rename |
| `RDBOM.materials[]` tagged by `childPartCode`+`subChildPartCode` | Machine BOM = Child Part references + own extras; Child Part owns its own material array (Sub Child Parts + other material) |
| QC checklist canonical-per-part system (`QCItemChecklist`, Phase 1 of this session) | Applies to Child Part now, same mechanism |
| — (didn't exist) | **New**: Sub Child Part node — Item-like, one raw material, Job Work flag, Job Work Type (multi-select), own stock/reorder, single "Job Work" process step when in-house, Purchase-routed when outsourced |
| Sheet Metal Plan (machine-level BOM attachment) | Re-anchor to Sub Child Part |

Phase 2 backend work from this session (`ProductionOrder.js` `consumedQuantity`
field, `subChildPartReorderService.js` Fabrication-consumption helpers,
`productionMfgController.js` `startProcess`/`markProcessComplete` SCP branches)
is **not wasted** — once relabeled to Child Part, the per-unit
Fabrication-consumption-gate logic, stock-increment-on-completion, and the
material Issue/Receive/Return handshake all carry over directly. Only the Job
Work step's role within that pipeline needs reconsidering (§4, §8).

## 10. Key files (for quick reload after compaction)

Backend (`D:\cs\Samtek-Backend\Samtek-Backend\server`):
- `models/Inventory.js` — Item, `productKind` enum
- `models/RDChildPart.js` — machine-scoped Child Part + embedded `subChildParts[]`
- `models/RDBOM.js` — flat tagged material lines (`childPartCode`/`subChildPartCode`)
- `models/ProductionOrder.js` — `orderKind`, `SUB_CHILD_PART_STEPS`, `MaterialDemandSchema.consumedQuantity`
- `models/QCJob.js`, `models/SheetMetalPlan.js`
- `services/subChildPartReorderService.js` — reorder cron + material-row computation + Fabrication-consumption helpers
- `services/qcChecklistPullService.js`, `controllers/qcChecklistController.js` — canonical checklist infra
- `services/itemPricingService.js` — cost rollup (currently flat, needs recursion)
- `controllers/productionMfgController.js`, `controllers/rdChildPartController.js`, `controllers/rdController.js`
- `controllers/sheetMetalPlanController.js`

Frontend (`D:\cs\Samtek-Frontend\Samtek-Frontend\client\src`):
- `pages/ResearchDevelopment/BOMManagement/ChildPartCreationTab.jsx`
- `pages/ResearchDevelopment/InventoryQC.jsx`, `SubChildPartInventoryQC.jsx`
- `components/inventory/SubChildPartInventoryTab.jsx`
- `pages/store/Inventory/`, `pages/store/MaterialHandshake/`
- `pages/production/ProcessExecution.jsx`, `components/production/SubChildPartQCPanel.jsx`
- `components/qc/*` (ChecklistPickerDialog, MasterChecklistPanel, SubChildPartQCReview)

## 11. Relationship to the other doc

`sub-child-part-inventory-2026-09.md` is the plain-language, user-facing change
log for everything built under the OLD terminology — keep it as history, don't
rewrite it retroactively. Once this redesign actually starts getting built,
changes should be logged in a **new** dated doc (per the user's standing
preference — see memory `feedback_plain_language_change_reports.md`), not
folded into the old one, since the old one describes a since-corrected model.

## 12. Next step

**Build started 2026-09-12** — see `bom-hierarchy-redesign-build-2026-09.md` for
the plain-language log of what's actually done. Status:
- ✅ Renamed old `productKind`/`orderKind` `'SubChildPart'` → `'ChildPart'`
  everywhere (backend + frontend + real-DB data migration).
- ✅ Sub Child Part Master built (Item fields, controller, routes, BOM
  Management tab, R&D + Store Inventory tabs, Flow Management modal).
- ✅ Sheet Metal Plan re-homed onto Sub Child Part's Flow modal
  (`SubChildPartSheetPlan.js`/`subChildPartSheetPlanController.js`,
  `Item.subChildPartDetails.scrapCost`).
- ✅ Child Part made standalone — **not** by retiring `RDChildPart` (that old
  per-machine flow stays fully intact, untouched, per explicit user
  instruction, purely as reference until the full redesign lands) but by
  building a genuinely new, parallel catalog alongside it: `ChildPartBOM.js`
  (own material list — Sub Child Part references by ObjectId+qty, plus
  Material/Tool lines mirroring `RDBOM.MaterialSchema`), a "Child Part
  Master" BOM Management tab, and a "belongs to the new catalog" gate keyed
  on `ChildPartBOM` existence (both flows write the same
  `Item.productKind:'ChildPart'`, so this is the only thing that tells them
  apart — see `childPartBOMController.js`'s own top comment). Child Part
  Inventory (`ChildPartInventoryTab.jsx`, renamed from
  `SubChildPartInventoryTab.jsx`) rebuilt to show both flows side by side
  (Source badge: Old/Master) with a Composition summary for Master rows.
- ✅ Machine BOM built — same "new, parallel document, old flow untouched"
  pattern one level up: `MachineBOM.js` (`childParts[]` referencing Child
  Part by ObjectId+qty, live-refreshed from that Child Part's own
  `ChildPartBOM`; `materials[]` reusing `ChildPartBOM.js`'s own exported
  `MaterialLineSchema`), `machineBOMController.js`, a "Machine BOM" BOM
  Management tab. Unlike Child Part Master, this DOES push its rolled-up
  Total Cost onto `Item.stdCost`/`mrp`/`salePrice` (confirmed with the
  user — `Item.stdCost` is a live gate on Sales Order submission via
  `getMachineBillingBOMCost`), reusing `applyPricingToItem` directly rather
  than the OLD `recalculateItemPricing`/`resolveManufacturingItemCost`
  (which stay untouched, `RDBOM`-only). Includes Download/Lock (new
  `writeMachineBOMPdf`, since the old PDF's flat `childPart`/`subChildPart`
  column layout doesn't apply to a reference-based BOM) and full weight
  roll-up (new `server/utils/bomWeightCalc.js`, plus new
  `Item.subChildPartDetails.unitWeightKg` and
  `ChildPartBOM.SubChildPartLineSchema.unitWeightKg/totalWeightKg` — weight
  didn't exist anywhere below Machine before this pass).
- ✅ Documentation fully cut over (not additively merged, per explicit
  instruction) — `buildMachineDesignFiles`/`getMachines` (both in
  `rdController.js`) now resolve Child Part/Sub Child Part design-file
  images by walking `MachineBOM.childParts[]` → `ChildPartBOM.subChildParts[]`
  instead of the OLD `RDChildPart` structure. A legacy-flow machine (no
  `MachineBOM`) now shows none of those images in Documentation — only its
  real uploaded `RDDocument` rows. This same shared function is also what
  Production's `getBomDesignStatus` and Design Approval's machine queue
  already read, so both picked up the same fix for free.
- ✅ Sub Child Job Work (the Out-Source route's Purchase-side page) now
  notifies the right department (Accounts, not Production) when a job-work
  order is raised, shows a live-rechecked raw-material availability status,
  blocks Send Round while short, and Send Round now actually deducts real
  Store stock — once, on whichever round is sent first — with the
  cut-piece/whole-sheet choice, leftover reuse, and the length-fabrication
  exact-remainder combine all built and verified against the real database.
  See `bom-hierarchy-redesign-build-2026-09.md` §10.
- ✅ The Out-Source route's final receive is now QC-gated instead of
  crediting stock directly — sends to QC (with notification), only QC's
  Approve credits stock, a partial reject routes the rejected qty to a new
  "QC Rejected" landing spot (no rework flow yet, deferred pending client
  sign-off). The same moment also captures a real Actual Job Work Cost
  (Purchase enters the vendor's total, divided into the per-unit BOM figure)
  and refreshes Materials Cost from the raw material's current price. The
  In-House route still has no QC gate — flagged, not built. See
  `bom-hierarchy-redesign-build-2026-09.md` §11.
- ✅ The In-House (Production) route now has the same QC gate — moved off
  its old standalone popup onto `/production/process-execution` (Order
  Management's "Plan" button, no intermediate picker), gated on its own QC
  checklist (module `subChildPart`) before Submit to QC, which captures the
  Actual Job Work Cost + refreshes Materials Cost the same way the
  Out-Source route does. QC approve credits stock; reject is always a full
  reject (not a partial split — one physical build, not a vendor batch) and
  reopens the order for Production to see what failed, fix it, and resubmit.
  The order's raw-material demand is also no longer auto-created at
  order-creation time — it now only appears once Production clicks "Issue",
  matching how Child Part's own material requests already worked. Store's
  Pending Transfers page split into 3 tabs (Sub Child Part/Child Part/
  Machine) so this shares a home without disturbing the other two. See
  `bom-hierarchy-redesign-build-2026-09.md` §12.
- ✅ **Child Part's own order-creation flow cut over from the old BOM to the
  new Child Part Master, with the Machine→Child Part→Sub Child Part cascade
  §5 described built for the first time.** `subChildPartReorderService.js`
  (the old, misleadingly-named cron for what's called Child Part today,
  still reading `RDChildPart`/`RDBOM`) is **deleted** — replaced with
  `childPartReorderService.js`, reading `ChildPartBOM` instead. Unlike every
  level below this, this was a full cutover, not a new file running
  alongside a frozen old one — confirmed safe against the real database
  first (zero live Child Part orders existed, zero un-migrated old-flow
  items). A Child Part order now checks Sub Child Part stock in addition to
  its own direct materials; a short Sub Child Part reference auto-raises a
  real Sub Child Part order (Out-Source or In-House), which in turn
  re-triggers its own already-built raw-material check — the cascading
  pattern §5 originally described, now real for this one pair of levels
  (Machine→Child Part is not built yet). The Material List (Order
  Management/Process Execution) picked up a new "Sub Child Part" category
  with zero frontend changes needed (the table already renders whatever
  categories the backend returns). The actual build pipeline for a Child
  Part order (what replaces Job Work→Fabrication→Assembly→Painting) is
  deliberately NOT part of this pass — new orders are created `Pending`
  with no steps yet, left for a dedicated later pass. See
  `bom-hierarchy-redesign-build-2026-09.md` §13.
- ✅ Sub Child Part's own sheet-metal purchase-quantity calculation now prefers a real,
  fit-checked Sheet Metal Plan (when one exists) over the theoretical area estimate,
  scaled to the current build size — previously it always estimated from area and never
  consulted the Plan at all. Falls back to the same area estimate when no Plan exists yet
  (no lock/gate requires one here, unlike Machine BOM). See
  `bom-hierarchy-redesign-build-2026-09.md` §14.
- ✅ Three real bugs found while watching the first actual Child Part order run
  through §13's flow, now fixed: the BOM View modal silently dropped Sub Child
  Part names (field-shape mismatch, now normalized + labeled); the Design view
  only ever showed the Child Part's own image (now rolls up each referenced Sub
  Child Part's own image too, same as Machine level already does); and — the
  significant one — a Sub Child Part order raised by its own reorder-point cron
  and a need surfaced by a Child Part's cascade were being treated as the same
  demand, so an already-open (but undersized) order silently blocked the cascade
  from ever raising its own. Both sources now get their own independently-capped
  order (tagged `demandSource`), sized to what's actually needed. One issue
  (Order Management's BOM/Design badge only reflects reality after Process
  Execution has been opened once — a pre-existing, shared characteristic, not
  new) is deliberately deferred pending confirmation a lightweight fix is worth
  it. See `bom-hierarchy-redesign-build-2026-09.md` §15.
- ✅ Store↔Production material handshake audited for the new "Sub Child Part" material
  category — transfer/receive/return mechanics were already fully correct with zero changes
  needed (a Sub Child Part row has no fabrication category, so it already uses the same
  plain/flat path a raw material does, and its stock is always a flat count, never the
  dimensioned shape a raw material can have). One real legibility gap fixed: Store's
  Pending Transfers list now badges a Sub Child Part row so it isn't mistaken for an
  ordinary raw material, resolved via a batched read-time lookup rather than any schema
  or transfer-logic change. See `bom-hierarchy-redesign-build-2026-09.md` §16.
- ✅ Child Part's own build pipeline — the piece §13 deliberately left out. Job Work
  dropped (a Sub Child Part is now independently stocked by its own order flow, so Child
  Part just receives it from Store like any other material); Fabrication → Assembly stay
  the same generic Start/Complete/rubber-stamp-QC loop every step already used; a real
  per-unit QC review sits between Assembly and Painting — one QCJob per order, but a
  nested entry per unit (mirroring Machine's OLD per-part `partChecks[]` pattern exactly,
  confirmed by the client as the shape to copy), each unit reaching/leaving QC entirely
  independently of its siblings, with a staged Initial-then-Process checklist and no
  separate "submit"/"reopen" actions; Painting gets its own dedicated per-unit cost-
  capture completion (mirrors Machine's own "later unit wins" per-unit cost capture),
  crediting Child Part stock by 1 per unit. New "Child Part QC" review UI added to
  `/qc/jobs`, sibling to the existing Sub Child Part QC one. Three real frontend bugs
  (unrelated to this pass's own logic, but caught while wiring the pipeline's frontend up)
  found and fixed along the way — see `bom-hierarchy-redesign-build-2026-09.md` §17 for
  the full account, including what verification was and wasn't possible (no browser
  automation tooling available in this environment — verified by contract-tracing +
  a clean production build, not an actual click-through).
- ✅ Machine's own order-creation cascade — the top tier, cut over to the new `MachineBOM`
  hierarchy (full cutover, no `RDBOM` fallback in the order-creation path — confirmed with
  the user, who already has real `MachineBOM`s set up for BP816/PRO-0014). A Machine order
  short on a Child Part now cascades into a real Child Part order (sized to the actual BOM
  need, independently tagged `demandSource:'MachineCascade'`, propagated all the way down
  through that order's own Sub Child Part cascade too — not just the first tier), instead of
  the old flat, `RDBOM`-only, one-level-deep Purchase Request. Machine's own direct
  materials still raise flat Purchase Requests, same as before, just off the new BOM.
  Production's BOM/Design verification (`getBomDesignStatus`) and Store Orders' material-
  availability badge both cut over to match — the latter additively (a new "Child Part"
  badge showing which real order got raised, alongside the existing raw-material ones).
  Real, deliberate operational trade-off, not a bug: of 21 real Machine Items only 2 have a
  `MachineBOM` today — the other 19 get no automatic BOM/Design verification or shortfall
  checking at order-creation time until R&D creates one for each (same catalog UI that
  already works for the two that have it). Machine's own Material List and build/process
  pipeline are explicitly deferred to next session, same phased approach as Child Part's.
  See `bom-hierarchy-redesign-build-2026-09.md` §18.
- ✅ Concurrent-demand fix — a reservation ledger (`MaterialReservation`, tracking "claimed
  but not yet issued" quantity separately from an Item's own raw `qty`) plus a
  `demandRefId` field scoping cascade-order dedup to the SPECIFIC triggering order, not just
  the trigger TYPE. Fixes two real, verified bugs found right after §18 shipped — both
  pre-dating it, present at every tier: (1) two concurrent consumers of the same downstream
  Item could BOTH see "enough in stock" and neither would ever flag a shortfall, even when
  their combined need exceeded what was actually available; (2) even when both DID detect a
  shortfall, only the first one's cascade order got created — the second's need was
  silently dropped. Wired into every availability check across all three tiers (Machine,
  Child Part, Sub Child Part). See `bom-hierarchy-redesign-build-2026-09.md` §19.
- ✅ Machine order's own BOM view + Material List, and the R&D manual approval queue
  (`/r&d/approve-requests`) cut over to match. The BOM view reuses the existing PDF-popup
  pattern (no new modal needed), now shown even before the BOM is locked. The Material List
  is genuinely new — confirmed nothing existed for Machine orders on this page before (the
  legacy material-list endpoints had no frontend caller at all) — built as a direct mirror
  of Child Part's own, one tier up (Child Part reference rows instead of Sub Child Part
  ones). `processRDRequest`'s Initial BOM approval workflow and its Review-modal preview
  both cut fully over from the old `RDBOM` to the new `MachineBOM`, no fallback — confirmed
  with the user this project is still in development, so the machines still only on the old
  `RDBOM` aren't data worth keeping a fallback path open for (this reasoning does NOT apply
  automatically to future cutovers — confirm case by case). Deliberately not touched: the
  OLD Job Work step gate and Parts QC "assign team" gate, which still read the legacy
  `RDBOM`-based Material List helpers untouched, pending the "process flow" pass. See
  `bom-hierarchy-redesign-build-2026-09.md` §20.
- ✅ Machine order's own Store transfer handshake (Issue + Return) — audited the same way
  Child Part's was (§16): traced `transferMaterialToProduction`/`receiveMaterialInProduction`/
  `returnMaterialToStore`/`confirmReturn` end to end and confirmed they're all already fully
  generic (keyed off `order._id` + `materialDemands[].materialCode`/`sourceItemCode`, zero
  `orderKind` branching anywhere), so Machine's new Child Part reference rows already flow
  through correctly with zero mechanical changes needed. The one real gap — same shape as
  Child Part's own — was legibility: Store's Pending Transfers list had no way to tell a
  Child Part reference row apart from a plain raw material row. Fixed with the same pattern:
  one extra batched `productKind:'ChildPart'` lookup in `getPendingRequests`, a new badge
  next to the existing "Sub Child Part" one. Pending Returns and Logs left untouched —
  neither ever had a per-kind badge, for any tier, so none was needed here either. See
  `bom-hierarchy-redesign-build-2026-09.md` §21.
- ✅ Machine QC's own old-BOM dependency cut for `MachineBOM`-driven orders, and a real bug
  fixed along the way. The old per-part "Parts QC" system (`RDChildPart`-embedded sub-parts,
  each individually inspected via `QCJob.partChecks[]`) modeled exactly what a Child Part
  now is — retired for `MachineBOM`-driven orders entirely (no rebuild needed; each Child
  Part already passes its own QC before ever being issued to the Machine order), leaving
  Final Testing as the only QC gate for them. R&D's Product Master QC page
  (`/r&d/product-master-qc`) no longer shows a misleading "No BOM created yet" for a machine
  that has a `MachineBOM`, just not the old kind. Also fixed a real, confirmed-live bug: a
  QC job was being created the instant a fresh Machine order's Process Execution page was
  opened, before Production had done any work at all — the Parts QC panel's query was
  missing the same progress-gate every sibling panel already had. And a second, deeper
  instance of the same bug class (QC's Final Checklist review deciding whether Production
  must fill it first by checking `partChecks.length`, which is now legitimately empty for a
  `MachineBOM`-driven order even though it still needs Production to fill it first) — fixed
  by keying off the item's real manufacturing status instead. Old `RDBOM`-only machines are
  completely unaffected — every fix branches on `MachineBOM` presence, same rule every
  cutover this session has used. See `bom-hierarchy-redesign-build-2026-09.md` §22.
- ✅ Machine's own build/process pipeline — the final piece. A `MachineBOM`-driven order
  now gets a genuinely new, 2-step pipeline (`Assembly` → `Final Testing`) instead of the
  old 6-step one — a Child Part's own units are already built, painted, and QC'd
  independently before ever reaching a Machine order, so there's nothing left to
  fabricate/paint/re-assemble in-house here. Assembly mirrors Job Work's own
  assign-team/material-check/start/work shape (against the NEW Material List's own live
  ledger, not the old `RDBOM`-driven one) but skips the self-certify QC step entirely —
  nothing individual to review, so `qcStatus`/`qcBy` are left at their real defaults
  instead of a fabricated label. Final Testing's own real "two uncoordinated finish-this-
  step buttons" bug is fixed (Mark Complete now hides until the checklist is actually
  filled). QC's own approve→dispatch/reject→fix→resubmit cycle needed zero changes —
  confirmed already shape-agnostic, not rebuilt. Production's cost/expense submission on
  Final Testing completion now writes into `MachineBOM` and pushes to the Machine Item's
  price too, reusing `MachineBOM`'s own already-existing `syncMachineBOMPricing` (the same
  mechanism R&D's manual Production Cost entry already used) — deliberately scoped to just
  this one trigger, not the full `automated-pricing-cascade-design-2026-09.md` cascade,
  which stays deferred until every new-hierarchy production flow exists (this pass is what
  unblocks that design, not what builds it). Old `RDBOM`-only machines keep their full
  6-step pipeline, completely unaffected — every change branches on the order's own real,
  already-materialized `processes[]` shape, decided once at creation time. See
  `bom-hierarchy-redesign-build-2026-09.md` §23.
- ⬜ Still to do: the OLD Job Work step gate's own `RDBOM`-based material-availability check
  (only ever reachable by an old-`RDBOM` machine now — a `MachineBOM`-driven order's own
  pipeline never has a Job Work/Fabrication step at all); Delivery Estimation (still
  `RDBOM`-only for Machine); the full `automated-pricing-cascade-design-2026-09.md`
  multi-level automatic cascade (raw-material-price-driven refresh of a Machine's own
  direct material lines, the Sub Child Part/Child Part legs — only Machine's own
  production-completion trigger is built, per above); cost cascading to consumers more
  broadly (a raw material's price change doesn't ripple upward automatically outside that
  one trigger — a pre-existing gap, not introduced by this pass); BOM Format &
  Modification relocation to a per-row View modal. The rework/resend flow for a
  QC-rejected quantity on the Out-Source route also stays deferred, pending client
  sign-off.
