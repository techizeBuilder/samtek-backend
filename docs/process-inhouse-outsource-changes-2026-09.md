# What changed this session — In-House / Out Source process definition (Phase 1)

Plain-language writeup of what we built and how it works now. This is **Phase 1** of a larger
redesign the client asked for — teaching R&D how to define a part's build steps, and which of
those steps are done in-house vs. sent to an outside vendor. Phase 1 only touches how R&D
*defines* a part's process in BOM Management; it does not yet change how Production or Purchase
actually execute an order — that's Phase 2, still to come. Everything below is built, and the one
piece of existing data (6 Sub Child Parts) has been converted over to the new setup.

---

## 1. "Job Work" is gone — replaced by "Process Definition" everywhere

**Where:** R&D → BOM Management, on all three tabs (Sub Child Part, Child Part, Machine BOM).

**How it worked before:** Only Sub Child Part had this concept at all, and it was a single
on/off switch — "Job Work: Outsourced" or not — for the *whole part*, plus a flat list of "Job
Work Types" (e.g. Laser Cutting, Bending). Child Part and Machine BOM had nothing like this.

**How it works now:** Every part — Sub Child Part, Child Part, and Machine — now has a
"Process Definition" section at the bottom of its form. Instead of one switch for the whole
part, you build a list:
- First, pick a **Category** (e.g. "Fabrication", "Assembly", "Painting") — the big-picture
  stage of the build.
- Inside each category, add the specific **steps** it needs (e.g. under Fabrication: "Laser
  Cutting", "Bending").
- Each step gets its own **In-House / Out Source** toggle — so a single part can genuinely mix
  both (e.g. Cutting done in-house, then Bending sent to a vendor), which wasn't possible
  before.
- Steps can be reordered with up/down arrows — the order matters, since it's the order the
  part actually moves through.

**Why:** The client wants a hybrid build pipeline where a part can go in-house → outsourced →
in-house (or any mix), with a clear sequence — the old single switch couldn't represent that.

---

## 2. A reusable list of Categories and Steps, shared company-wide

**Where:** Same Process Definition section, on all three BOM tabs.

**How it works now:** The Category and Step names aren't retyped from scratch every time.
There's one shared, growing list per part type (Sub Child Part / Child Part / Machine) — pick
from what's already there, or type a new one with the "+" button, same as adding a new "Job
Work Type" used to work. Once added, it's available to pick again on the next part, keeping
naming consistent across the whole BOM.

**Why:** So "Fabrication" or "Powder Coating" means the same thing everywhere, and future work
(matching vendors to the services they offer, planned later) can key off this same shared list.

---

## 3. Sending materials to a vendor step — now points at the part's own material list

**Where:** Process Definition section, Child Part and Machine BOM only (a Sub Child Part
never needs this — it only ever has the one source material it's already built from).

**How it works now:** When a step is marked "Out Source", you can tick which of the part's
already-listed Assembly Materials/Consumables get sent along with it. It's just a pointer to
material lines already on the BOM — nothing new is calculated, the cost/weight numbers you
already see elsewhere stay exactly as they were.

**Why:** So an outsourced step that needs extra hardware or material shipped to a vendor can
say so, without duplicating any of the quantity math that already exists.

---

## 4. Sub Child Part's "Job Work Cost" — now display-only

**Where:** Sub Child Part Master's expanded row / View screen.

**Before:** R&D could manually type in and save a "Job Work Cost" estimate.

**Now:** The number is still shown (Materials Cost / Job Work Cost / Scrap Cost / Total
Cost, same as before), but it's no longer manually editable here. It'll start updating itself
automatically once Phase 2 wires up real Production/Purchase completions — for now it simply
keeps showing whatever value it last had.

**Why:** The manual-edit button belonged to the old Job Work setup, which is retired. Rebuilding
it properly ties into Phase 2's work, not this one.

---

## 5. Existing Sub Child Parts — converted over automatically

**Where:** Behind the scenes — a one-time cleanup, not a screen.

**What happened:** The 6 Sub Child Parts that already had a Job Work setup were converted into
the new format automatically: each one now has a "Legacy Job Work" category containing its old
Job Work Types as steps, all marked the same way (In-House or Out Source) their old switch
said. Nothing was lost — R&D can now edit or reorganize these like any other part.

**Note (accepted, not a bug):** Until Phase 2 is built, editing a Sub Child Part's Process
Definition no longer feeds the automatic "send to Purchase" system the same way the old switch
did — any Sub Child Part touched under the new setup will, for now, always be treated as
in-house by that automatic system. This was a deliberate call for this phase (the system isn't
in live client use yet) rather than something rushed into this pass — Phase 2 fixes it properly.

---

## 6. Category/Step template management — its own screen now

**Where:** A new "Process Templates" button on all three BOM tabs — before "New Sub Child
Part", before "New Child Part", and next to the machine picker on Machine BOM.

**Before (earlier this same session):** The only way to add a new Category or Step was a
small "+" tucked inside the Process Definition picker itself, while building a specific
part's BOM — there was no dedicated place to view, rename, or delete them.

**Now:** Clicking "Process Templates" opens a proper management screen for that part type's
whole Category/Step list — add, rename, or delete a Category, and add, rename, or delete the
Steps inside it. Deleting something still in use on a real BOM is blocked with a clear message
telling you how many BOMs are using it. Building an actual part's Process Definition is now
selection-only — pick from what's already in the template, don't create new entries on the
fly (sequence, In-House/Out Source, and which materials go with an outsourced step are still
decided per-part, right where they were).

**Why:** The client's original ask was to build the template list separately first, then pick
from it when creating a part — the first pass had templates and part-building blended
together in one screen.

---

## 7. Outsourced steps can now also send Sub Child Parts / Child Parts — and later steps can choose

**Where:** Process Definition section, Child Part and Machine BOM.

**Before (earlier this same session):** An outsourced step could only pick from the part's raw
Materials/Tools list. A Child Part is also built from Sub Child Parts, and a Machine from Child
Parts — neither showed up as something you could send to a vendor. Also, every step after the
first was assumed to automatically ship whatever the step before it produced, with no way to say
otherwise.

**Now:**
- The "materials for this step" picker also includes the part's own Sub Child Parts (Child Part
  level) or Child Parts (Machine level), shown alongside the raw materials.
- Every outsourced step except the very first one in the whole sequence now has its own choice:
  **"Assembled part"** (ships whatever's been built by the steps before it — no picking needed)
  or **"Not yet assembled — pick materials"** (shows the same picker the first step gets, since
  this step doesn't depend on what came before it). This matters because a build doesn't have to
  be one straight chain — two categories can build separate things that only come together
  later, so a later outsourced step isn't always working on "the assembled part" from earlier.

**Why:** The client pointed out both gaps directly while reviewing the first pass.

---

## 8. One step can now be flagged as the QC Checkpoint (Child Part / Machine)

**Where:** Process Definition section, Child Part and Machine BOM (not Sub Child Part — see why below).

**Why this came up:** QC used to happen at a fixed, hardcoded point in the old pipeline (Child
Part always checked between Assembly and Painting; Machine always checked at a step literally
named "Final Testing"). With process steps now defined per-part instead of fixed, that hardcoded
position no longer makes sense — R&D needs to say *where* QC happens for each part.

**How it works now:** Every internal process step (for Child Part and Machine) has a "QC
Checkpoint" checkbox. Exactly one step across the whole Process Definition must be checked —
checking a different one automatically unchecks the previous one, and saving is blocked until
exactly one is chosen. Sub Child Part doesn't get this checkbox at all — its rule stays simple
and fixed: QC always happens at the last step, same as today.

**What this doesn't do yet:** this only lets R&D mark *where* QC should happen on the BOM. Making
Production and QC actually follow that marker — sending the right step to QC, resuming Production
on whatever's left afterward, then routing to Store or Dispatch — is Phase 2 work, not built yet.

---

## Quick summary

| # | Change | Status |
|---|--------|--------|
| 1 | "Job Work" replaced with Category → Step "Process Definition", In-House/Out Source per step, on all three BOM levels | Done |
| 2 | Shared, reusable Category/Step list per part type | Done |
| 3 | Outsourced steps can point at the part's own material list | Done |
| 4 | Sub Child Part's Job Work Cost is now display-only | Done |
| 5 | Existing Sub Child Part data converted to the new format | Done |
| 6 | Category/Step templates split into their own "Process Templates" management screen | Done |
| 7 | Outsourced-step materials picker includes Sub Child Parts/Child Parts; later steps can choose "assembled" vs. "pick materials" | Done |
| 8 | One step per Child Part/Machine can be flagged as the QC Checkpoint | Done |
| — | Production/Purchase actually using this new setup to run orders (including the QC Checkpoint) | Phase 2 — not started |
