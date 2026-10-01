# What changed — QC multi-checkpoint redesign

The client changed how Production QC works, in two ways:
- Production no longer checks anything itself.
- Every BOM can have several QC steps, including Sub Child Parts.

This was built in 4 steps, and **all 4 are now done and tested live**. Step 1 had no bugs found.
Steps 2 and 3 (Production submits without checking; outsourced work goes to QC first) were done
and tested live for **all three levels** — Sub Child Part, Child Part, and Machine — after fixing
a few bugs found along the way (see below). Also fixed: QC couldn't see the checklist/decision
history for a step once it was decided — see the note at the end of section 3. Step 4 (removing
the old one-checkpoint code, see below) is now done too — **the whole redesign is complete.** Full
design: `qc-multi-checkpoint-redesign-discussion-2026-09.md`.

---

## 1. R&D picks QC steps in the BOM, and sets a checklist for each step

**Where:** BOM Management (Process Definition, on Sub Child Part / Child Part / Machine BOMs) and
QC Parameters (Sub Child Part, Child Part and Product Master QC).

**How it worked before:**
- **BOM:** a Child Part or Machine BOM could flag exactly **one** step as the QC checkpoint. A
  Sub Child Part had no choice at all: QC always happened on its last step.
- **QC Parameters:** each part had one or two checklists of its own that weren't tied to any
  step. A Sub Child Part had one "Assigned Checklist". A Child Part had an Initial checklist and
  a Process checklist.

**How it works now:**
- **BOM Management:**
  - Every step at every level has a **QC** checkbox, and R&D can tick as many as needed.
  - At least one step must be ticked before the BOM saves.
  - **Machines** also have a **Final QC** checkbox. Exactly one step must carry it; this is where
    the machine's Final checklist gets checked. A step can have both boxes ticked.
- **QC Parameters:**
  - When you pick a part, you see **one card per QC step** from its BOM, e.g. "out source work ›
    laser cutting". You pick each card's checks from the master list.
  - A step with no checks is marked, because QC will then get an empty checklist for it.
  - If a step is later renamed, removed or un-ticked in the BOM, its old checklist shows under
    "no longer matching a BOM step", with a Remove button.
- **The Initial checklist is gone:**
  - Child Part QC keeps one master list (Process).
  - Product Master QC keeps Process and Final.
  - A machine's Final card now also says which BOM step it's checked at.

**Good to know:**
- Existing BOMs need a small touch-up the next time they're saved. The 6 Sub Child Parts with
  steps need at least one QC step ticked, and the 4 Machine BOMs also need their Final QC step
  picked. The 3 Child Part BOMs are already fine.
- For machines on the old legacy BOM, per-step QC only works once they have a Machine BOM.

---

## 2. Production submits, QC fills and decides — Sub Child Part done first

**Where:** Production's process screen, and the QC Inspection page — for **Sub Child Part orders
only** so far. Child Part and Machine orders still work exactly the old way (Production checks
first, one checkpoint) until their own turn.

**How it worked before:** Production filled the checklist itself at the one QC checkpoint (always
the last step for a Sub Child Part), then QC reviewed what Production entered.

**How it works now, for a Sub Child Part:**
- Every step R&D ticked QC on now has a **Submit to QC** button in Production — no checklist to
  fill, just a submit. The true last step also asks for the production cost/expense at that point,
  same as before.
- QC opens the job and sees each submitted step. It fills the checklist itself, then splits the
  submitted quantity into **Passed / Rework / Scrap** (a reason is required whenever there's any
  Rework or Scrap).
- The next step only unlocks once nothing is left waiting on Rework — Scrap alone doesn't hold
  anything up.
- If a step is resubmitted after Rework, only the reworked quantity comes back around — not the
  whole batch again.
- The true last step credits stock (or the sale) with the Passed quantity as soon as QC decides,
  even if the very last unit or two comes through in a later, separate decision.
- Every submission and decision is kept, so a step's full history is visible, never overwritten.

**Tested live (2026-09-26)** on a real Sub Child Part order (Chamber frame/SCP-003) — clean, no
bugs in this part itself. One real gap turned up along the way and is now fixed: the Inspector
field on the QC job page never showed up for this new kind of job (it used to only appear before
QC started work, but these jobs now start automatically the moment the first step is submitted,
so the field never got a chance to show). It now shows whenever no inspector is assigned yet, and
picks from a dropdown of QC staff instead of free text, per your request.

**Child Part — built (2026-09-26) and tested live.** Works the same way as Sub Child Part above,
but per unit — each unit of a Child Part order has its own **Submit to QC** button per QC step,
and QC decides Pass/Reject on that unit's own step, independent of every other unit. A rejected
step reopens just for that one unit, and Production resubmits it the same way. A unit's stock
credit and cost only apply once that unit's own last step passes — other units aren't affected
either way.

**Machine — built and tested live (2026-09-28).** Same per-unit mechanic as Child Part, including
the mandatory **Final QC** step every Machine BOM has — a Machine step can be flagged as a regular
QC step, the Final QC step, or both at once (QC then sees one review with both checklists
together). One thing worth knowing: the Final QC step does **not** have to be the last step in the
BOM — R&D can put steps after it (e.g. painting, which may need its own QC too). That was
confirmed with you directly: testing the machine before painting it means a failed test's rework
doesn't damage paint already applied. Whichever step actually ends up last (Final QC or not) is
what credits the sale/stock, same rule as Sub Child Part and Child Part already follow. Machine's
per-unit QC review page is shared with Child Part's, so this was double-checked with its own
separate test to make sure nothing about the existing behavior changed for either.

Tested live on the Blower Pulverizer (BP816) after you reconfigured its BOM to put Final QC before
painting (matching the corrected order above) — build → Final QC (mid-way, via an outsourced step)
→ a further QC-checked painting step → done. Clean, no bugs.

---

## 3. Outsourced QC steps — Sub Child Part done first

**Where:** Purchase's Outsource Work page, and Production's process screen — for a **Sub Child
Part order with an outsourced step that also needs QC**, built ahead of Child Part/Machine at
your request.

**How it worked before:** an outsourced QC checkpoint came back from the vendor and Production
still self-checked it, exactly like an in-house one, before QC reviewed.

**How it works now:** receiving the step back from the vendor sends it straight to QC — same as
an in-house step, no self-check step in between. QC splits Passed / Rework / Scrap exactly as
before. If any is Rework, that step becomes available to send out again — Purchase creates a new
outsource hand-off for it, and it's automatically filled in with just the rework quantity, never
the whole order again. Everything else (the next step waiting only for Rework, stock crediting
immediately per decision, full history kept) works exactly the same as an in-house step.

**Tested live (2026-09-26)** on the same Chamber frame/SCP-003 order — out sourced first, then
in-house, then two out sourced steps sent together in one batch, to check the "send several steps
at once, receive them in rounds" logic too. Two real bugs turned up and are now fixed:
- Sending more than one step to a vendor at once wasn't possible from Production's screen at
  all — only one step at a time, no way to bundle. Fixed: Production can now choose to bundle the
  next out sourced step(s) in when sending, same as it already could for multiple units.
- When two QC steps were bundled and received together, the second one wrongly showed "nothing
  outstanding" — it was trying to read how much survived the first step before QC had actually
  decided that yet. Fixed: it now correctly carries the same quantity through until a decision is
  actually made.

No further bugs found after these fixes.

**Child Part — built and tested live (2026-09-28).** Same idea as Sub Child Part above, but per
unit and per Pass/Reject instead of a quantity split. Found needed while testing Child Part's
in-house QC (section 2) on a real order with two outsourced QC steps sent together in one batch:
the second step was silently marked done with no QC check at all, because the old single-
checkpoint system can only ever recognize one QC step per order, and this order now has three.
Fixed the same way as Sub Child Part: every QC-flagged step in a bundle now goes to QC
independently when received, not just one. Confirmed live on the same test order — both steps
correctly required their own separate decision.

**Also fixed (2026-09-28):** QC had no way to see a step's checklist or decision once it was
already decided — the job page only ever showed a plain status badge. Every submission and
decision was always kept (nothing is ever overwritten), just not visible. Both the Sub Child Part
and Child Part QC pages now have a **History** button on every step that's had at least one
submission, showing what was checked, who decided it and when, and the outcome — for the current
round and any earlier one.

**Machine — built and tested live (2026-09-28).** Same as Child Part's own outsourced QC steps
above — every QC-flagged outsourced step goes to QC independently when Purchase receives it back,
not just the first one in a bundle. If the true last step in the BOM turns out not to need QC
itself (e.g. it's an outsourced painting step after Final QC already passed), receiving it credits
the sale/stock directly, same as it already does for Child Part. Confirmed live on BP816 — Final
QC (outsourced, mid-way through the BOM) and the QC-checked step after it both required their own
separate decision, exactly as intended.

---

## 4. Removing the old one-checkpoint code (2026-09-28)

**Where:** behind the scenes only — nothing to click, this is cleanup after steps 1-3 replaced
the old mechanism everywhere real orders use it.

Before removing anything, 14 real open orders still on the old mechanism (none of their items had
been given a QC step yet) were confirmed as dev/test data and deleted, along with their QC
records. Two items still don't have a QC step picked yet (a Machine, BP-311/M-311, and 3 Sub
Child Parts, SCP-004/005/006) — your call was to go ahead anyway and have R&D flag them
separately; until then, an order for one of those specific items would fall back to the simplest
possible behavior (below), not break.

**Removed:** the old single-checkpoint checking screens and the code behind them — the self-check
panel Production used to fill before QC saw anything, the old Machine "Final Testing" checklist
screen, and the logic that could only ever recognize one QC step per order. All of it has been
fully replaced by steps 1-3 above for every real order.

**One real consequence, only for an item with no QC step picked yet:** previously, a step
literally named "Final Testing" was specially blocked until it went through the (now-removed)
old checklist screen. That screen is gone, so a step named that on an unconfigured item now just
completes on its own instead — same as any other step on an item R&D hasn't set up yet. This
never affects a properly configured item (i.e. every real order today).

**Kept on purpose:** the Sub Child Part self-check page tied to the *original* BOM structure
(before the BOM hierarchy redesign) is a separate, older system and wasn't touched — it doesn't
share any code with what was just removed. Historical QC records from before this whole redesign
are also left exactly as they are; 8 real completed units across past orders still store their
old-format QC data, confirmed still intact.

**Tested:** a dedicated check covering a dynamic Child Part order, a dynamic Machine order's
outsourced final step, an unconfigured item's outsourced hand-off (now refuses cleanly instead of
misbehaving), and a legacy step — including one literally named "Final Testing" — all passed
(15/15).

---

## Quick summary

| # | Change | Status |
|---|--------|--------|
| 1 | Multi-step QC and Final QC in BOM Management; per-step checklists in QC Parameters; Initial checklist removed | Done, tested live |
| 2 | Production submits steps without checking; QC department fills and decides (pass / reject, Passed / Rework / Scrap), and each resubmission is kept as a new attempt | Done, tested live at all three levels |
| 3 | Outsourced QC steps: received work goes to QC first | Done, tested live at all three levels |
| 4 | Remove the old single-checkpoint and self-check code, plus old Initial data | Done |
