# Product Approval Gate Redesign — Design, BOM, QC List, Prototype, Release

**Status as of 2026-10-01: BUILT (committed, not yet pushed/run against real data). See `product-approval-gate-build-2026-10.md` for what shipped.**
This file is Claude's own working-memory reference for this redesign (so a context
compaction doesn't lose the decisions below) — it is not the user-facing change report.
Once this is actually built, a separate plain-language change report follows the user's
standing preference (see memory `feedback_plain_language_change_reports.md`), same
pattern as `bom-hierarchy-redesign-2026-09.md` → `bom-hierarchy-redesign-build-2026-09.md`.

## 1. Why this came up

Screenshot-driven: the user pointed at Process Execution's existing "BOM Locked &
Verified" / "Design Approved" auto-verification card
(`productionMfgController.js`'s `getBomDesignStatus`/`applyAutoVerify`) and asked for a
new, bigger requirement layered on top of it — R&D needs a real approval gate (Design +
BOM + a new QC List check) before a product is usable by Sales/Production at all, applied
across all three BOM-hierarchy tiers (Sub Child Part / Child Part / Machine — see
`bom-hierarchy-redesign-2026-09.md`), not just Machine.

## 2. What exists today (confirmed by reading the code, not assumed)

- **Product Master's "Forward to Design & Prototype" checkbox**
  (`Item.machineDetails.forwardToNextPhase`, `ProductMaster.jsx:677-690`) — Machine-only.
  Checked = goes through Design Approval (`/r&d/design-approval`,
  `machineDetails.designStatus`: Draft→Testing→Approved/Rejected) and Prototype
  (`/r&d/prototype`, Performance/Output/Durability tests → "Release for Production" sets
  `machineDetails.releaseStatus = 'Released'`). Unchecked ("Purchase Machine") skips both
  entirely, no gate at all today.
- **Sales sellability is already gated for Machine only**
  (`services/sellableItemsService.js`, dated 2026-09-25 in its own comment):
  `getSellableItems()` (used by every Sales product picker — Leads/Quotation/Order)
  excludes a Machine where `forwardToNextPhase=true` and `releaseStatus !== 'Released'`.
  Confirmed with the user: **Sales/Leads only ever sells Machines** — Child Part/Sub
  Child Part are never directly sellable and need no Leads-side gate. (They're also
  structurally excluded today anyway — created as `type:'Assemblies'`, not
  `type:'Product'`, so `getSellableItems`'s `type:'Product'` filter already excludes
  them; that isn't changing.)
- This existing gate is **soft** — only the picker query filters it out. Confirmed by a
  research pass: `leadController.js`/`orderController.js`/`salesController.js`'s actual
  Lead/Order-creation write paths never check `releaseStatus`/`designStatus`/discontinued
  at all. Flagged to the user as a related gap (not yet decided whether to close it as
  part of this work).
- **Production's own gate is separate and already real**: `getBomDesignStatus` auto-sets
  an order's `bomVerified`/`designVerified` once `MachineBOM.isLocked` +
  `machineDetails.designStatus === 'Approved'` — governs whether *that order* can
  proceed, independent of Sales' `releaseStatus` gate. When not ready, Process Execution
  shows a **"Raise R&D Request"** button → lands in `/r&d/approve-requests`
  (`RDProductionQueue.jsx`) as an `RDRequest` of type `'Initial BOM'`, a manual override
  queue.
- **That same queue page also handles `'Material Change'` requests** — Production asking
  R&D to approve extra/different material against an already-locked BOM mid-build
  (`productionMfgController.js:2026`). Unrelated to Design/BOM/Prototype gating; must NOT
  be deleted along with the Initial BOM flow — needs a new home first.
- **Child Part / Sub Child Part have zero equivalent fields today** — no
  `forwardToNextPhase`, no `designStatus`, no `releaseStatus`. Sub Child Part's
  `subChildPartDetails` only has Job-Work/process fields; Child Part has no details block
  at all. Both hardcode `purchase: false` on creation — no purchase-vs-manufactured
  distinction exists at either tier (confirmed: the user does NOT want a Machine-style
  checkbox shortcut at these two tiers either — they always go through the full pipeline,
  unconditionally).
- **QC checklist pages (`/r&d/inventory-qc`, `/r&d/product-master-qc`) are pure CRUD on
  two different models**: `QCMasterChecklist` (company-wide template rows per
  module/stage — `QC_MODULES = ['inventory','productMaster','motorMaster','childPart',
  'subChildPart']`) and `QCItemChecklist` (which template rows + expected values are
  selected onto one specific item/machine). **Neither has any approval/status field** —
  confirmed by reading both schemas. The only place an actual Pass/Fail/Approve decision
  exists today is `QCJob` (a completed inspection record during a live Production order),
  which is execution-scoped and unrelated to whether the *product* is sellable/buildable.
- **BOM "Lock" is a separate, pre-existing, unrelated mechanism** — `MachineBOM.isLocked`
  freezes further edits and generates a PDF (`Lock BOM` button, BOM Management). Child
  Part / Sub Child Part have no Lock feature at all today.

## 3. Confirmed design decisions (this conversation, 2026-09-30)

### 3a. Scope — Sales only ever sells Machines
Child Part / Sub Child Part are never directly sellable — no Leads-side gate for them.
Their own approval gate exists purely to control (i) whether Production can automatically
build/replenish them, and (ii) whether they're eligible to be referenced inside an
approved parent BOM.

### 3b. The Product Master checkbox forks Machine only, no equivalent added elsewhere
- Checked (goes through full pipeline): Design Approved + BOM Approved + QC List
  Approved, then Prototype pass, then Release.
- Unchecked ("Purchase Machine"): **QC List Approved only**, then Release. No
  Design/BOM/Prototype step shown or required at all.
- Child Part and Sub Child Part get **no such checkbox** — they always go through the
  full pipeline unconditionally (confirmed explicitly — no "purchased sub-part" shortcut
  wanted).

### 3c. "Design Approved" is recursive, same mechanism at every tier
- **Sub Child Part** (leaf — nothing below it in the hierarchy): Design = its own design
  file approved. Recursion terminates here.
- **Child Part**: Design = its own design approved **AND** every Sub Child Part it
  references (its own BOM) has Design approved.
- **Machine**: Design = its own design approved **AND** every Child Part it references
  has Design approved (which already recursively required their own Sub Child Parts)
  **AND** every directly-referenced Sub Child Part has Design approved.

A Machine's Design readiness is therefore never just "does R&D like the machine-level
drawing" — it's blocked until every part underneath it, all the way down, is
individually Design-approved.

### 3d. "BOM Approved" is a brand-new, independent flag — NOT the existing Lock
Explicitly corrected by the user mid-discussion: the gate's "BOM" component is a new
approval flag set on the new Approval page, **completely separate from BOM Management's
existing "Lock BOM"** feature (which keeps working exactly as it does today — freezes
edits, generates PDF — untouched by this redesign). A BOM can be locked without being
approved, and vice versa isn't possible (approval requires content to review, same
"can't approve nothing" logic Lock already has informally), but the two flags are
independent state.
- Child Part / Sub Child Part get this same new independent "BOM Approved" flag on the
  Approval page. **They do NOT get a Lock feature** — confirmed explicitly ("no because
  the lock feature is different thing and we are creating a new page for approval
  right?").

### 3e. "QC List Approved" = sign-off on the item's own configured checklist
Explicitly corrected by the user: this is **not** about the master checklist template
(`QCMasterChecklist` — the shared, reusable row catalog) and **not** an executed
QCJob-style pass/fail run. It's R&D reviewing and approving the **real checklist
configured on that specific item/machine** — the `QCItemChecklist` selection (which
master rows apply + their expected values) at `/r&d/inventory-qc` (Child Part/Sub Child
Part) or `/r&d/product-master-qc` (Machine) — and signing off that it's correct/complete
for this item. A new approval flag on top of the existing selection record, not a new
execution-record model.

### 3f. Release gating — both of these apply together, at every tier
1. **A part cannot start its own automatic orders (reorder cron + cascade-order
   creation, see `bom-hierarchy-redesign-build-2026-09.md` for that cascade flow) until
   Released.** An unreleased Sub Child Part's low-stock cron won't fire; a Child Part's
   cascade won't raise a Sub Child Part order for it either, until that Sub Child Part is
   Released. Same rule one tier up (Machine cascade → Child Part order) and at Machine's
   own top level.
2. **BOM composition itself stays unrestricted** — R&D can freely reference an
   unapproved/unreleased Child Part or Sub Child Part while building a higher BOM. The
   block only appears **at approval time**: approving the higher part is refused (with a
   message naming which referenced parts aren't approved yet — "approve these first") if
   any referenced Child Part/Sub Child Part isn't itself already approved/released.
3. **Resolved chicken-and-egg** (the "how does the first prototype unit ever get built if
   its own cron/cascade is blocked pre-Release" question): confirmed by the user — **the
   approval system is the last verdict, not an orchestrator.** Whatever internal
   Production process builds the first unit to run QC List/Prototype against is out of
   scope for this redesign and isn't gated by any of this — only the *automatic* ongoing
   replenishment (cron/cascade) is gated, and only from the moment Release is decided.
   Nothing about the existing manual/internal build path needs to change or be
   special-cased.

### 3g. Production's per-order gate (Process Execution) stays exactly the mechanism it is today
`getBomDesignStatus`'s check (BOM locked + Design approved) is unchanged in shape — it
just needs to use the now-**recursive** definition of "Design approved" (3c) instead of
the flat `machineDetails.designStatus` check it uses today. It does **not** wait on QC
List Approved, Prototype, or Release — those gate Sales/the automatic supply chain, not
whether Production can start building a specific order that's already underway.

### 3h. Page consolidation
- `/r&d/design-approval` becomes the one consolidated Approval page — Design, the new
  BOM Approved flag, the new QC List Approved flag, and Prototype management (absorbing
  `/r&d/prototype`'s functionality) — spanning all three tiers via a tab switch (mirrors
  BOM Management's existing Sub Child Part/Child Part/Machine tab pattern). Whether
  `/r&d/prototype` survives as its own thin route or disappears entirely: **not yet
  decided, flagged open**.
- `/r&d/approve-requests` (`RDProductionQueue.jsx`) — the `'Initial BOM'` request type is
  fully superseded by this new auto-gate (no more manual "Raise R&D Request" escape
  hatch; Process Execution just shows live status, no action button). The `'Material
  Change'` request type sharing that page must be relocated to a new home before the page
  is deleted — **not yet decided where, flagged open**.

## 4. Full removal inventory for `/r&d/approve-requests` (Initial BOM path only — do NOT delete Material Change alongside it)

Confirmed via research pass — every file/route tied to the feature:

**Frontend**: `pages/ResearchDevelopment/RDProductionQueue.jsx` (whole page); `App.jsx`
(route + import, ~line 259/626-628); `config/moduleRoutes.js:444` (nav entry, feature key
`approveRequests`); `contexts/RDContext.jsx` (`productionRequests` query, `processRDRequestMut`
— only the request-queue bits, not `updateReleaseStatus` which stays);
`pages/production/ProcessExecution.jsx` (Raise R&D Request button + handler, lines
~135/725/1083); `contexts/ProductionContext.jsx` (`raiseRDRequest` call, ~lines 89-90/206/358).

**Backend**: `controllers/rdController.js` (`getRDRequests`, `getRDRequestReviewData`,
`processRDRequest` — but `processRDRequest` also handles Material Change, so this needs
splitting, not deleting outright); `controllers/productionMfgController.js`
(`raiseRDRequest`, plus the `rdRequestRaised`/`'BOM Pending'` order-status writes it
makes); `models/RDRequest.js` (keep — Material Change still uses it); `routes/rdRoutes.js`
(lines ~312/315/316 — `approveRequestsView`/`approveRequestsEdit` permission-gated
routes); `routes/productionMfgRoutes.js:94` (`raise-rd-request` route).

## 5. Open items — resolved 2026-10-01

- Material Change requests: **deleted along with `/r&d/approve-requests`** (user: "not needed anymore"). With no reviewer left, Production's extra-material request (`addMaterialDemand`) now applies immediately and routes straight to Store.
- `/r&d/prototype`: **folded into the Approval page's Machine flow**; the route redirects there.
- Soft sales gate: **closed** — `orderController` create/update reject unsellable items server-side (Leads hold no item references, so nothing to check there).
- QC List approval: requires **every configured checklist stage** non-empty, plus every QC-flagged BOM step covered; editing a checklist voids the sign-off.
- Existing data: **grandfathered as approved + Released** by `scripts/migrateProductApprovalGate.js` (dev data, per user).
- Still open: exact permission model (reuses `rnd.designApproval` view/edit; Prototype add/edit still uses `rnd.prototype`).

## 6. Key files (for quick reload after compaction)

Backend (`D:\cs\Samtek-Backend\Samtek-Backend\server`):
- `models/Inventory.js` — `Item.machineDetails` (forwardToNextPhase/designStatus/releaseStatus),
  `Item.subChildPartDetails` (no design/release fields yet — need adding), no
  `childPartDetails` block exists yet (need creating)
- `services/sellableItemsService.js` — `NOT_RELEASED_FOR_SALE`, `getSellableItems`
- `controllers/productionMfgController.js` — `getBomDesignStatus`, `applyAutoVerify`,
  `raiseRDRequest`
- `controllers/rdController.js` — `updateReleaseStatus`, `getRDRequests`,
  `getRDRequestReviewData`, `processRDRequest`
- `controllers/childPartBOMController.js`, `controllers/subChildPartMasterController.js`
  — creation controllers, currently hardcode `purchase: false`, no design/QC fields
- `models/QCMasterChecklist.js`, `models/QCItemChecklist.js` — checklist template vs.
  per-item selection, neither has an approval field today
- `models/RDRequest.js` — Initial BOM + Material Change, shared model

Frontend (`D:\cs\Samtek-Frontend\Samtek-Frontend\client\src`):
- `pages/ResearchDevelopment/DesignApproval.jsx`, `Prototype.jsx`, `RDProductionQueue.jsx`,
  `ProductMaster.jsx`, `ProductMasterQC.jsx`, `InventoryQC.jsx`
- `pages/ResearchDevelopment/BOMManagement/ChildPartMasterTab.jsx`,
  `SubChildPartMasterTab.jsx`, `MachineBOMTab.jsx`
- `pages/production/ProcessExecution.jsx` — BOM & Design card, Raise R&D Request button
- `contexts/RDContext.jsx`, `contexts/ProductionContext.jsx`

## 7. Next step

Built — see `product-approval-gate-build-2026-10.md`. Remaining: run the migration script against the dev DB, then click through the Approval page end to end.
