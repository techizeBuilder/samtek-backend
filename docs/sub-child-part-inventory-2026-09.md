# Sub Child Part Inventory — plain-language report

Single report covering this initiative, in the order it was built.

**Status: 6 steps done so far.** A machine order checking Sub Child Part stock availability before
deciding what still needs building (and the Order Form change that goes with it) is a later step.
Step 6 builds a Sub Child Part order's own shop-floor process — the dedicated QC-department review
screens for it are the one piece still deferred (the checklist *setup* they'll use is done).

---

# Step 1 — R&D / BOM Management: creating, reusing, and stocking Sub Child Parts

## The problem this solves

Today, every Sub Child Part on a machine's BOM is just a name/code typed under that one machine —
there's no concept of "this exact same physical part is also used on 2 other machines." If the
client wants to build parts ahead of demand and hold them as stock (so an order doesn't have to
start from zero every time), the system first needs to know when two BOMs are actually talking
about the same reusable part.

## How it works now

**Sub Child Parts can now be real, stockable inventory.** In BOM Management, adding a Sub Child
Part now offers two modes:
- **New Part** — type a brand-new name/code, same as before. This now also creates a matching
  entry in a new "Sub Child Part Inventory."
- **Existing Part** — search and pick a Sub Child Part already used on another machine. This links
  the *same* inventory entry here too, instead of creating a duplicate.

Because Item codes are already guaranteed unique company-wide, once two machines are linked to the
same Sub Child Part, "same code" is guaranteed to mean "same physical part" — never an accidental
coincidence from two people typing the same string.

**A new "Sub Child Parts" tab** in `/r&d/inventory`, next to the existing Inventory tab. Shows
every Sub Child Part with its stock, Material Flow classification (High/Medium/Low — same system
raw materials already use), Min Stock / Order Quantity, and how many machines currently use it
("Used In"). It deliberately does **not** re-store what materials a part is built from — that
stays live-read from whichever BOM(s) it's linked to, so it can never go stale.

**The material-list guard.** Since a shared Sub Child Part is the same physical part everywhere,
its material list has to match everywhere too — if the materials were different, it wouldn't
really be the same part. The three material actions (Add / Update / Delete) each treat this
differently, refined twice after the first pass:

- **Linking auto-copies the whole list, immediately.** The moment you pick "Existing Part" and
  link it to another machine, every material already on the source machine's copy is copied onto
  this one right then — not something to rebuild by hand afterward. (This closes a real gap found
  after the first pass: relying on Add alone to reconstruct the list one row at a time meant it
  was easy to add only *some* of the matching materials and stop, leaving two machines'
  "identical" parts silently different — confirmed against a real case where a linked machine only
  had 1 of 4 materials.)
- **Add** — only accepts a material that's an *exact* match (same material, quantity, and cut for
  a fabrication material) to one already sitting on another linked machine — a safety net for
  re-adding something that was locally deleted (see Delete below), not the primary way a machine
  gets its list anymore.
- **Update** — a deliberate revision to the part itself, so it cascades: editing a shared Sub
  Child Part's material (changing a quantity, or even swapping which material a line points to)
  shows a warning first — *"this is shared with N other machines, M of them locked — this update
  applies to all of them too"* — and on confirming, the same change lands on every linked
  machine's BOM at once, including a locked one. This is also how a genuinely new material reaches
  an already-shared part: by editing an existing line's identity, not by adding a new one.
- **Delete** — also cascades, same confirmation as Update. Originally left local-only, but that
  was the same gap as Add from the other direction: deleting 1 of 3 materials on one machine
  without removing it everywhere else left the two copies just as out of sync. Deleting the Sub
  Child Part *link itself* (removing it from one machine's Child Part list entirely) is a
  different, unrelated action and stays local — that one only says whether a machine uses the part
  at all, not what the part is built from.

## What did NOT change

- Any Sub Child Part that isn't linked/shared works exactly as before — zero behavior change for
  the common case.
- Nothing about how materials are priced, how the BOM PDF looks, or how Store's existing
  material-transfer flow works.
- Plain Inventory (`ModernInventoryUI`) itself — completely untouched code, just sitting alongside
  the new tab now instead of being the whole page.

---

# Step 2 — Production: auto-raising a build when stock runs low

## The problem this solves

Sub Child Part Inventory (Step 1) gave every reusable part its own stock number, Min Stock, and
Material Flow — but nothing actually watched it. Once a part is genuinely being pulled from stock,
something needs to notice when it's running low and start building more, the same way the existing
Material Flow system already does for raw materials bought from a vendor — except here the
"reorder" is "build it," not "buy it."

## How it works now

**A new sweep, running every 30 minutes** (the same cadence as the existing raw-material low-stock
sweep, right alongside it): whenever a Sub Child Part's stock hits its Min Stock, it:
1. Raises a **Production Order** for it, requesting its own Order Quantity — the same field
   already used for raw materials, now doing the equivalent job for a built part.
2. Checks whether the raw materials that part is actually built from are in stock — read live off
   whichever machine's BOM defines it (any one of them, if it's shared — the material-list guard
   from Step 1 already guarantees every linked copy is identical). Whatever's short automatically
   raises a Purchase Request, the same 3-way check (plain materials / sheet metal / length-based
   fabrication) already used when a machine order is placed.

**The sheet metal problem, solved — corrected 2026-09-13.** A whole machine's sheet metal needs get
planned by hand in BOM Management (the Sheet Metal Plan), because it's nesting many *different* cut
sizes from many different parts onto shared sheets — a real layout puzzle. A single Sub Child Part
build doesn't have that problem, and doesn't have the data for it either: a Sub Child Part's own BOM
line only ever records the *area* its cut uses, never a length and width to nest — that's simply
not something this level of the system captures, by design. The first version of this got that
wrong, trying to fit a length-and-width shape that was never actually there, which meant it silently
failed to raise a purchase request for every real sheet metal Sub Child Part — caught before it did
any real harm, since Store hadn't yet run into a shortage it should have flagged. Fixed to work with
what's actually recorded: total area needed for the whole order, divided by one catalog sheet's own
area, rounded up to a whole sheet — the same plain approach the whole-machine flow itself used
before Sheet Metal Plan became a manual multi-sheet entry. Verified against real catalog and cut
sizes.

**A new tab on the Orders page** (`/production/orders`): **Machine Orders** and **Sub Child Part
Orders**, side by side. A Sub Child Part order is always a stock-replenishment build, never tied to
a customer order, so it's genuinely a separate list to browse rather than another filter on the
existing one.

## What did NOT change

- Everything from Step 1 — untouched.
- The existing raw-material low-stock sweep (Purchase Requests for vendor-bought items) — this is
  a parallel sweep, not a modification of that one. A Sub Child Part item is specifically excluded
  from that other sweep (it's never purchased from a vendor).
- Job Cards and the Process & QC picker — still see the exact same order list they always have;
  the new tab only affects the Orders page's own view.
- What actually happens once a Sub Child Part order exists (its own process steps) — deliberately
  left for a later step, built small piece by piece.

---

# Step 3 — Store gets read-only visibility

**Where:** `/store/inventory` gains a fourth tab, "Sub Child Parts", alongside the existing
Inventory / Product Master / Motor Master tabs (same read-only pattern those two already use).
Shows the same stock, Material Flow, and "Used In" information R&D sees — no Manage Stock or
Discontinue actions.

**The permission gap this needed:** Store Head/Employee accounts had no R&D module permissions
granted at all — confirmed against real users — so gating this new tab (and the pre-existing
Product Master tab on this same page, which turned out to already be silently broken for the same
reason) under the normal `rnd` permission would 403 every real Store user.

**Fixed the ordinary way:** Store Head and Store Employee now carry a real `rnd → view` permission
for exactly two features — Product Master and BOM Management (Sub Child Part Inventory's own
endpoints live under BOM Management) — the same mechanism every other cross-department read access
in this app already uses, editable at `/hrms/CompanyAdmin/user-management` like any other
permission. Add/Edit/Delete were never granted, matching the read-only tabs Store actually has.
Applied in two places so it actually takes effect everywhere it needs to:
- The role's *default* permission set, so any new Store Head/Employee account is granted this from
  day one.
- The 5 existing real Store Head/Employee accounts, migrated once to carry the same grant (a brand
  new account and an existing one now look identical on the permissions screen).

---

# Step 4 — Material List: what one Sub Child Part order actually needs

## The problem this solves

Once a Sub Child Part order exists (Step 2), Production still had no single place that laid out
what it needs to actually build it — the raw materials, grouped sensibly, in the quantities the
*whole order* needs, not just one piece. Whether each one is already sitting in Store or already on
its way from a vendor wasn't visible anywhere either.

## How it works now

Opening a Sub Child Part order's Plan page now shows a **Material List**, grouped into four
categories — Raw Material, Tool, Sheet Metal, Length Fabrication — matching how Inventory itself
already classifies an item (Process Type, falling back correctly for the one field that's
historically split across two places on the Inventory form: "Fabrication Item" only ever lives in
Process Type, everything else in Item Type).

Every material line shows:
- **Amount / Quantity** — straight from the BOM, per one piece of the Sub Child Part.
- **Total Amount / Total Quantity** — scaled up to the whole order. For Raw Material and Tool this
  is a straight multiply by the order quantity. For Sheet Metal and Length Fabrication, "Total
  Quantity" is the real purchasable count — sheets or catalog-length pieces — using the corrected
  area/length math from Step 2 above, not a simple multiply.
- **Availability** — Available in Store, or Sent to Purchase, live-checked the same way the Step 2
  sweep already decides real purchases, so this list can never disagree with what actually got
  purchased.

Sheet Metal rows carry one extra note for Production — *"This quantity completes the order. Return
any usable leftover sheet to Store."* (Step 5 below adds the actual Issue/Return actions; this note
just spells out the expectation on the shop floor.)

## What did NOT change

- No new document or PDF — the list reads live off the same BOM/stock data Steps 1–2 already
  established.
- Nothing about how the Step 2 sweep itself raises orders or purchase requests — this is a view of
  that same data, not a new decision-making path.

---

# Step 5 — Material flow: issuing, receiving, and returning

## The problem this solves

Step 4 showed Production *what* a Sub Child Part order needs, but there was no way to actually act
on it — no way to pull material from Store, track how much has been taken so far, or send leftover
or defective material back.

## How it works now

Every Material List row now has an **Issue** button. It runs the same three-step handshake a
machine order's materials already use, just triggered from this screen instead of a separate
demand form:

1. **Issue** — Production enters how much of that row to request (partial is fine — take some now,
   more later). Capped so the running total can never exceed what the whole order needs. There's
   no R&D approval step in between (a Sub Child Part build is stock replenishment, and the BOM is
   already the agreed source of truth) — the request lands straight in Store's **Pending
   Transfers**, the exact same screen and queue Store already works, now tagged with a "Sub Child
   Part" badge.
2. **Store transfers** it using its existing transfer screens — nothing new on Store's side:
   - **Raw Material / Tool** — plain quantity off stock.
   - **Sheet Metal** — Store sends whole catalog sheets; Production cuts on the floor and returns
     the measured leftover.
   - **Length Fabrication** — Store cuts to the required length and keeps the offcut in its *own*
     stock as reusable leftover. Production issues in whole BOM cut-pieces (each piece = the BOM's
     own per-piece length — e.g. "3 pieces × 20 cm").
3. **Receive** — a **Production Head** confirms the material has physically arrived (same
   Head-only gate the machine flow already has). The row's "Issued" figure and a small progress
   bar update on the Material List.

**Returns** — any row with material on the floor gets a **Return** button: Excess or Defect, with
a reason, plus a measured leftover length/width for sheet metal. It goes to Store's Pending
Returns; on acceptance a Defect return lands in **Defective Inventory**, an Excess return goes
back to normal stock. Either way the row's "Issued" count drops — so a defective return
automatically re-opens that material for the shortfall (you still need good stock for it), while
an excess return doesn't (the order's need was already met).

## What did NOT change

- Store's Material Handshake screens, and the transfer / receive / return / confirm logic behind
  them — all reused exactly as-is. A Sub Child Part order's material demand is just an ordinary
  demand once raised.
- The machine-order material flow — untouched.

---

# Step 6 — A Sub Child Part order's own build process

## The problem this solves

Steps 2–5 got a Sub Child Part order raised and its materials moving. But once the material was in
Production, there was still nothing to actually *do* — a Sub Child Part order was just borrowing the
full machine-build pipeline (Job Work → Fabrication → Assembly → Painting → Re-Assembly → Final
Testing), which doesn't fit: there's no machine to re-assemble or final-test, and no way to track
that building unit 2 eats into the same pile of material unit 1 already used.

## How it works now

### The pipeline is trimmed to fit

A Sub Child Part order is created with just four steps — **Job Work → Fabrication → Assembly →
Painting**. No Re-Assembly, no Final Testing. When Painting finishes on the last unit, the finished
pieces are in Sub Child Part Inventory and the order is done. (A machine order is completely
unchanged — still all six steps.)

### Job Work — once for the whole order

Same as it already worked: the sheet-metal (laser cutting) and "Job Work" Item-Type materials have
to be received in Production before a team can be assigned or the step started. It's one step for
the order, not per unit — every unit tab shows it, but it's only acted on from Unit 1.

### Fabrication — once per unit, gated on what's actually on the floor

This is the real change. Fabrication runs **per physical unit** (its own team, its own Start
button). Before a unit can start, the system checks every consumable it needs — Raw Material, Tool,
and length-fabrication pieces (sheet metal and outsourced "Job Work" items were already spent at
Job Work) — against what's *still sitting in Production right now*: received, minus what earlier
units already consumed, minus anything pending return to Store.

So an order that received 8 of something (whole-order cap 20), where each unit needs 5: unit 1
starts fine and consumes 5, unit 2 is **blocked** — only 3 left on the floor — until Production
receives more from Store. The Fabrication card shows every consumable with "need per unit" vs. "on
floor" and a Ready / Short flag, and the Start button is disabled with the reason until it's clear.

Starting a unit commits its consumption immediately. A later **QC rejection does not give any
material back** — Production reworks the unit with what it has, and can re-submit for QC as many
times as needed.

### QC after Fabrication — interim gate now, dedicated screens later

Each unit's Fabrication ends in a **QC Pending** state that Assembly can't start until it clears.
For now that's the generic Approve / Reject QC buttons already on every process step. The proper
QC-department review flow — where QC actually works through the checklist — is the deferred piece
the client is designing separately. The checklist those screens will use is **already fully set up**
(see the QC-checklist section below); this step just puts the gate in the pipeline so the plumbing
is ready.

### Assembly and Painting — per unit, Production-run

Both run per unit, after that unit's Fabrication QC has passed. No material gate on either. Marking
Painting complete for a unit **adds one finished piece to that Sub Child Part's stock** in
Inventory. Once every unit has cleared Painting, the order is Completed.

## The QC checklist — one shared list per Sub Child Part (Phase 1, done earlier)

A Sub Child Part is used on several machines (the whole point of Step 1). Its QC checklist should be
**one list**, not re-entered per machine — the same idea as the BOM material-list guard.

- **Where it's set up:** `/r&d/inventory-qc` now has two tabs — the existing **Inventory** QC, and
  a new **Sub Child Part Inventory** tab. Each Sub Child Part gets an Initial and a Process
  checklist, chosen from the same Product Master QC master list R&D already maintains (no second
  catalog).
- **One canonical entry, shared.** Whichever machine adds the checklist first sets it. On the next
  machine, opening the picker **auto-loads what's already there** (the BOM-style linking); the user
  just clicks to confirm. Changing the selection — adding or removing a check — warns first
  (*"this applies to every machine that uses this part"*) and, on confirm, updates the one shared
  entry everywhere.
- **Production reads from it.** A Sub Child Part order's per-unit QC pulls this exact canonical
  checklist, so what QC reviews on a stock build is identical to what it reviews for the part
  inside a machine.

## What did NOT change

- The machine-order build pipeline — still six steps, still per-child-part Fabrication QC, no
  behaviour change at all.
- The Product Master QC and Inventory QC pages themselves — the new tab sits alongside, sharing the
  same building blocks.
- Store's side of anything — this step is entirely Production + R&D.

## Still to come

- The QC-department review screens for a Sub Child Part unit (client is designing the flow).
- A machine order reading Sub Child Part stock before deciding what to build (table row 10).

---

## Quick summary

| # | Change | Status |
|---|---|---|
| 1 | Sub Child Parts can be created as real, stockable Inventory items | Done |
| 2 | "New Part" vs "Existing Part" (search & link) on the BOM Management form | Done |
| 3 | New "Sub Child Parts" tab in `/r&d/inventory` — stock, Material Flow, Used In | Done |
| 4 | Material-list guard — linking auto-copies the full list immediately; Add is a safety-net exact-match check; Update and Delete both cascade everywhere (1 confirmation, covers locked + unlocked) | Done |
| 4b | Real PRO-0014/CF-001 data repaired to match PRO001's list (found out of sync from the original gap) | Done |
| 5 | Low-stock sweep auto-raises a Production Order for a Sub Child Part | Done |
| 6 | Material availability check + auto Purchase Request for shortfalls (plain / sheet metal / length fabrication) | Done |
| 7 | Sheet metal purchase quantity — corrected 2026-09-13 to area-based math (total area needed ÷ one catalog sheet's own area), matching what a Sub Child Part's BOM line actually records; the original grid-packing version never had real numbers to work with and silently failed every time | Done |
| 8 | "Machine Orders" / "Sub Child Part Orders" tabs on the Orders page | Done |
| 9 | A Sub Child Part order's own build process — trimmed pipeline (Job Work → Fabrication → Assembly → Painting, no Re-Assembly/Final Testing); per-unit Fabrication with a material gate that tracks consumption across units; per-unit QC gate after Fabrication; Painting completion banks one finished piece into stock | Done |
| 9b | Per-unit Fabrication material gate — a unit can't start unless enough of every consumable is still on the Production floor (received − already consumed by earlier units − pending return); starting commits consumption; a QC rejection never releases it | Done |
| 9c | Sub Child Part QC checklist — one shared canonical Initial/Process checklist per part (BOM-style linking + change guard across machines), new "Sub Child Part Inventory" tab in `/r&d/inventory-qc`, read by Production's per-unit QC | Done |
| 9d | Dedicated QC-department review screens for a Sub Child Part unit | Deferred — client designing the flow |
| 10 | Order Form / machine-order material check reading Sub Child Part stock | Not started — next step |
| 11 | Store gets read-only visibility into Sub Child Part Inventory (`/store/inventory` → new "Sub Child Parts" tab), backed by a real Product Master + BOM Management view permission | Done |
| 12 | Material List — categorized (Raw Material / Tool / Sheet Metal / Length Fabrication) view of what a Sub Child Part order needs, with per-piece and whole-order totals plus live Available/Sent to Purchase | Done |
| 13 | Material flow — Issue / Receive / Return on each Material List row, full 3-step handshake reusing the machine-order pipeline and Store's existing Material Handshake screens (Sub Child Part-tagged); partial issues, order-total cap, no R&D step; sheet metal returned by Production, length fabrication cut & kept by Store; Defect → Defective Inventory and auto-reopens the shortfall, Excess → stock | Done |
