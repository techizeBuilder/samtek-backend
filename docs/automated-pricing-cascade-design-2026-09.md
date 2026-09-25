# Automated pricing cascade — design

**Status as of 2026-09-15: DESIGN ONLY, agreed with the user, not yet built.**
Implementation is explicitly deferred until all three new-hierarchy production flows
exist (see "Why this waits" below) — this file is the reference to come back to at that
point, so the reasoning doesn't have to be re-derived from scratch.

## 1. Why this exists

The BOM hierarchy redesign (`bom-hierarchy-redesign-2026-09.md`) changed *when* material
becomes available. In the old structure, a Machine's materials were bought specifically
for that Machine's own order — so "recompute the price when the order finishes" was
already the right moment; nothing meaningful could go stale in between; because nothing
was in stock ahead of time to have a price.

The new structure adds a low-stock/reorder "flow" to every level (Inventory, Sub Child
Part, Child Part) — materials, Sub Child Parts, and Child Parts now get restocked
**ahead of time**, independently of any specific Machine order. That's the whole point of
the redesign. But it breaks the old assumption: a raw material's price can now change
(Store receives a new Purchase Order at a different rate) long before anyone touches the
Machine that will eventually consume it. If nothing propagates that change upward, the
Machine's stored selling price goes stale — and **Sales reads that stored price
directly**, for both Quotations (`Leads.jsx`, `item.mrp`) and Sales Order minimum-billing
checks (`getMachineBillingBOMCost`, `Item.stdCost`) — never re-deriving it from the BOM at
quote/order time. A stale price isn't a display glitch here; it's the company quoting or
committing to a number that's actually wrong, with real financial consequences.

The user's own framing captures the fix precisely: when a raw material's price changes,
**back-track** the update through every level that consumes it — Sub Child Part → Child
Part → Machine — so the number Sales reads is always correct, not just correct-whenever-
someone-happens-to-reopen-that-BOM.

## 2. What already exists — the old system already solved this once

This is not a new problem for this codebase. The **old** (pre-hierarchy-redesign) BOM
system already has a complete, working, real-time solution — `server/services/
itemPricingService.js`:

- `recalculateItemPricing(item)` — the entry point. Called whenever a real cost data
  point becomes available (a Purchase Request/Invoice is received, a BOM material is
  added/edited/removed, a manufactured item's production completes). Resolves the item's
  current cost and writes `stdCost`/`purchaseCost`, `mrp`, `salePrice` via
  `applyPricingToItem`.
- `cascadeRecalculateToConsumers(item)` — the back-tracking piece. The moment an item's
  cost changes, this finds every OLD `RDBOM` document that references it by material
  code (`materials: {$elemMatch: {code: ...}}`), and for each Machine that owns one of
  those BOMs, recursively calls `recalculateItemPricing` on it — so the update ripples
  upward immediately, synchronously, not lazily.

This pattern is proven and already running in production for the old flat (raw material
→ Machine, one hop) structure. **The plan below is not a new invention — it's extending
this exact pattern up through the new hierarchy's extra levels.**

## 3. What the new hierarchy already has — a "pull," not a "push"

The new hierarchy (Sub Child Part / `ChildPartBOM` / `MachineBOM`) already has *half* of
a cascade, just shaped the opposite way — costs get refreshed **live, on read**, instead
of pushed the moment something changes:

- `childPartBOMController.js`'s `refreshAndComputeChildPart` — every time a Child Part's
  BOM is fetched (including when a Machine BOM fetches it as part of its own refresh, see
  next point), it re-pulls each Sub Child Part line's cost fresh from that Sub Child
  Part's *current stored* `materialsCost`/`jobWorkCost`/`scrapCost`, and re-saves the line
  if anything changed.
- `machineBOMController.js`'s `getMachineBOM` → `refreshMachineBOMChildParts` → (calls
  the function above per line) → `syncMachineBOMPricing` → `applyPricingToItem`. Opening
  a Machine's BOM page re-pulls every Child Part line fresh, **and** pushes the fresh
  Total Cost onto `Item.stdCost/mrp/salePrice` — on every single GET, not just on edit.

So the *math* is already correct whenever someone actually looks. The problem is the
*trigger*: nothing makes anyone look. `getMachineBillingBOMCost` (what Sales Order
submission reads) and `Leads.jsx`'s quotation flow (what Quotations read) both read
`Item.stdCost`/`mrp` straight from storage — neither one re-triggers the refresh chain.
So that stored value is only as fresh as the last time a human happened to open that
specific Machine's BOM page.

## 4. The three real gaps, precisely

1. **Sub Child Part's own `materialsCost` never refreshes on read at all**, unlike
   everything above it. It's a pure snapshot, only recomputed at specific write moments
   (R&D editing the Sub Child Part, or — as of this session — Purchase completing a
   job-work receive). If the raw material's price moves in between, this number goes
   stale and nothing above it can tell, because nothing re-derives it from the raw
   material on read the way Child Part re-derives from Sub Child Part.
2. **A Child Part's or Machine's own *direct* Material/Tool lines never refresh at all —
   not even on read.** These reference raw materials by code (`ChildPartBOM.js`'s
   `MaterialLineSchema.item`, reused by `MachineBOM.js`), same as the old RDBOM — but
   unlike the Sub-Child-Part-reference lines, I found no refresh loop for them anywhere.
   Only `subChildParts[]`/`childParts[]` reference lines get the live-pull treatment.
3. **`Item.stdCost`/`mrp`/`salePrice` — the numbers Sales actually reads — are lazy.**
   They only update when a human opens or edits that specific Machine's BOM. Nothing
   proactively updates them the instant an upstream price changes elsewhere. This is the
   one with real financial risk: a price can move, nobody reopens that Machine's page,
   and Sales quotes or bills against a number that's already wrong.

## 5. Every trigger — a full audit, not just the obvious one

A "real cost data point becomes available" moment, in this codebase's own words
(`recalculateItemPricing`'s doc comment). Anything on this list should end up calling the
same cascade.

**Raw material price:**
- Store receives a Purchase Request/PO (`purchaseRequestController.js`) — already
  triggers `recalculateItemPricing` → already cascades the OLD hierarchy; needs the new
  one added.
- A Purchase Invoice is recorded (`purchaseInvoiceController.js`) — same path.
- Accounts sets/updates a Purchase Cost manually at `/accounts/purchases/inventory`
  (`purchaseController.js`'s `updatePurchaseItemCost`) — **this is the "first-time
  estimated price for a never-bought item" screen the user pointed to.** Already calls
  `applyPricingToItem` + explicitly `cascadeRecalculateToConsumers` for the OLD
  hierarchy; needs the new one added, same as the two above.
- Accounts sets/updates a fabrication item's Price-per-kg (`updateWeightUnitPrice`, same
  file, right below `updatePurchaseItemCost`) — **found during this investigation: this
  one currently doesn't cascade at all, not even for the OLD hierarchy.** It just sets
  `item.weightUnitPrice` and saves. Worth closing at the same time as this redesign,
  since it's the exact same class of bug in the exact same file.

**Sub Child Part cost:**
- Purchase completes a job-work order's final receive (built this session,
  `subChildPartJobWorkOrderController.js`'s `receiveSubChildPartJobWorkRound`) — updates
  `materialsCost`/`jobWorkCost` on the Item, but does not yet climb further up.
- Production completes an in-house Sub Child Part build — **not built yet** (the user's
  order-flow item #1: "purchase panel is built only production panel remains").
- R&D manually edits a Sub Child Part's own setup (source material, source quantity, or
  types a manual Job Work Cost) — a real cost change today that doesn't climb at all.
- A Sheet Metal Plan is saved for a Sub Child Part — changes Scrap Cost — same gap.

**Child Part cost:**
- Production completes a Child Part build — **not built yet** (order-flow item #2).
- R&D manually edits a Child Part's BOM (add/remove/edit a Sub Child Part line, a
  Material/Tool line, or Production Cost/Expense).

**Machine cost:**
- Production completes a Machine build on the new hierarchy — **not built yet**
  (order-flow item #3; the OLD-flow equivalent already works via
  `productionMfgController.js`'s `approveQC` → `recalculateItemPricing`).
- R&D manually edits a Machine BOM (`machineBOMController.js`) — **already works today**,
  already pushes to `Item.stdCost/mrp/salePrice` on every mutating endpoint.

**Not a gap, confirmed while investigating:** Company Admin changing an item's
Profit %/Discount % (`pricingValueController.js`'s `updatePricingItem` →
`reapplyItemPricingFormula`) already re-applies the new percentage to whatever cost is
currently on file — it's correct and self-contained, no fix needed. It just depends on
that "current cost" being accurate, which is exactly what this whole redesign is about.

## 6. Every route a change has to travel — not just the clean staircase

A raw material (or a Child Part) can be plugged in at more than one level, so a single
price change can need to travel **three different routes at once**, not one:

- **Route 1 — the full staircase**: raw material → every Sub Child Part sourcing it →
  every Child Part using those Sub Child Parts → every Machine using those Child Parts.
- **Route 2 — skip one step**: raw material used *directly* in a Child Part's own
  material list (the "nut/bolt" case) → every Machine using that Child Part.
- **Route 3 — skip two steps**: raw material used *directly* in a Machine's own material
  list → that Machine.

At every step it's "every consumer," not "the one consumer" — one raw material can feed
several Sub Child Parts, one Sub Child Part can feed several Child Parts, one Child Part
can feed several Machines (reusability is the whole point of the redesign). A single
price change fanning out to many Machines at once is expected, not something to guard
against.

## 7. Proposed design

Don't invent a new mechanism — extend the same `itemPricingService.js` pair one level at
a time, mirroring `recalculateItemPricing`/`cascadeRecalculateToConsumers` exactly:

```
recalculateSubChildPartCost(item)
  - recompute materialsCost fresh from item.subChildPartDetails.sourceItem's CURRENT
    price (reuses computeSourceMetrics, already exported from
    subChildPartMasterController.js this session)
  - if changed: save, then find every ChildPartBOM with a subChildParts[] line
    referencing this item (Route 1) -> recalculateChildPartCost(bom) for each

recalculateChildPartCost(bom)
  - recompute every subChildParts[] line from step above (already exists —
    refreshAndComputeChildPart)
  - recompute every direct materials[] line's unitPrice/totalPrice from ITS raw
    material's current price (closes gap #2 — new)
  - recompute bom's own rolled-up Total Cost
  - if changed: save, then find every MachineBOM with a childParts[] line referencing
    this Child Part (Route 1/2) -> recalculateMachineCost(bom) for each

recalculateMachineCost(bom)
  - same shape one level up: refresh childParts[] lines + own direct materials[] lines
    (Route 1/2/3 all land here)
  - recompute Total Cost, push to Item.stdCost/mrp/salePrice via the EXISTING
    applyPricingToItem (closes gap #3 — the push is now immediate, not lazy)
```

Each raw-material-price entry point in §5 gets one more line added: after the existing
OLD-hierarchy `cascadeRecalculateToConsumers(item)` call, also do a reverse lookup for
Sub Child Parts sourcing this item (`Item.find({'subChildPartDetails.sourceItem':
item._id})`) and Child/Machine BOMs referencing it directly (`materials.item` code match,
same `$elemMatch` shape the old cascade already uses) and call the new functions on each.
Every Sub-Child-Part/Child-Part/Machine-completion entry point in §5 calls straight into
the matching function above instead of writing its own one-off update.

**Cross-cutting rules, apply everywhere:**
- Only write a document if the recomputed number actually differs from what's stored —
  no needless writes / `updatedAt` bumps (already the convention `refreshAndComputeChildPart`
  and `refreshMachineBOMChildParts` use; keep it in the new push functions too).
- Track a `visiting` set per cascade run (mirrors the old system's own) so a Machine
  reachable by two routes for the same change only gets recomputed once.
- Weight rides along with cost — `unitWeightKg`/`totalWeightKg` are computed by the exact
  same source functions as cost and have the identical staleness problem; fix both in the
  same pass rather than rediscovering this gap for weight later.
- A part with no valid cost yet (never purchased, `cost` not `> 0`) is skipped, not
  zeroed — `applyPricingToItem`'s existing `if (!(cost > 0)) return false` guard already
  does this; the new functions should follow the same rule at every level.
- No cycle protection needed beyond a sane depth cap — this hierarchy is a strict one-way
  chain (nothing lower ever references something above it), unlike the old flat system's
  BOM graph where a manufactured item could theoretically end up inside another's
  materials list.
- Everything stays scoped by `companyId`, same as every other query in this codebase.

## 8. What this deliberately does not do

- Does **not** retroactively correct a Quotation already sent to a customer, or a
  `LeadQuotationHistory` record already written — it only keeps the *live* price correct
  for whatever gets quoted or ordered next.
- Does **not** account for QC-rejected quantities as a cost (e.g. wasted material from a
  rejected batch folding into the accepted units' cost) — that's a separate, explicitly
  undecided piece of the QC-rejection flow (see `bom-hierarchy-redesign-build-2026-09.md`
  §10's "QC Rejected" tab note), not part of this redesign.
- Does **not** touch how Profit %/Discount % themselves get set — confirmed in §5 that
  path is already correct.

## 9. Why this waits — dependencies

Implementation is blocked on the three new-hierarchy production flows the user is
building toward, because **each one is a real entry point this design hooks into**, not
just related work:

1. Sub Child Part in-house production completion (Purchase/Out-Source side already built
   this session; Production/In-House side still open) — the trigger for
   `recalculateSubChildPartCost` from the production side, mirroring the job-work-receive
   trigger already built.
2. Child Part production order/completion (assembling Sub Child Part + other assembly
   material) — the trigger for `recalculateChildPartCost`'s production-cost half.
3. Machine production order/completion on the new hierarchy (assembling Child Part +
   other assembly material) — the trigger for `recalculateMachineCost`'s production-cost
   half.

Designing the cascade functions' exact shape before these exist would mean guessing at
what data each completion step actually has available (production cost, expenses, actual
quantities) — better to build this once those shapes are real.

## 10. Open questions to settle at implementation time

- **Synchronous vs. queued.** The old `cascadeRecalculateToConsumers` runs synchronously,
  inline with the triggering request. Recommend keeping that for the new hierarchy too —
  simpler, no new infrastructure, and matches the proven pattern — but flag it as a place
  to revisit if a single raw material's fan-out ever becomes large enough to slow down
  the triggering request noticeably.
- **Keep the existing live-refresh-on-read as a safety net alongside the new push.** Even
  with a correct push cascade, keeping `refreshAndComputeChildPart`/
  `refreshMachineBOMChildParts` (extended to cover gap #2's direct material lines too)
  means a missed or buggy cascade trigger still self-heals the next time someone opens
  that page, rather than silently staying wrong forever.
- Confirm the reverse-lookup queries (`Item.find({'subChildPartDetails.sourceItem': ...})`,
  `ChildPartBOM.find({'subChildParts.subChildPart': ...})`,
  `MachineBOM.find({'childParts.childPart': ...})`, plus the code-based `materials[]`
  matches) are fast enough as-is at real data volumes, or whether they need indexes added
  at that point — none of these fields are indexed today.
