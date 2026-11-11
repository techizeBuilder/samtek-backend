# What changed — Fabrication Master keeps its inventory item in step (28 Oct 2026)

Plain-language writeup. One change, built and tested (32 checks on a made-up company, older
suites re-run). Logic: [fabrication-size-sync-2026-10.md](fabrication-size-sync-2026-10.md).
Found while reviewing the BOM price push (gap 3 —
[price-cascade-open-gaps-2026-10.md](price-cascade-open-gaps-2026-10.md)).

---

## 1. Saving Fabrication Master now updates the inventory item

**Where:** R&D → Fabrication Master (`/r&d/fabrication-master`), Edit.

**How it works now:** when R&D saves an entry, the inventory item made from it follows in the
same save. Sizes are matched by their numbers:

- **A size that is still there** (density, material or designation may have changed) is updated
  **in place** — same size, same stock, new weight. If the weight changed, the price push runs:
  Sub Child Parts made from it (weight and material cost), Child Part / Machine BOM lines cut
  from it (weight and price), up to the Machine's price.
- **A new size** is added to the item with 0 stock and the same reorder settings as the
  item's other sizes.
- **A removed size that nothing uses** is taken off the item.
- **A removed size that is in use is refused**, with what uses it — for example:
  "Can't remove 2 × 1250 × 2500 — it's in use (13 pcs in stock · BOM: CP-004 · Sub Child Part:
  SCP-007). Keep it and mark it Discontinued instead." In use means: stock on it, a BOM line,
  a Sub Child Part, a Sheet Plan, an open production / job-work order, a stock reservation, an
  open purchase request, an open PO, or an open QC job.
- **Name, material grade, sheet metal yes / no and the units** flow to the item.
- **The Item Code is locked** once an inventory item is made from the entry (the field greys
  out, "Locked — inventory item … is made from this entry"). BOM lines, orders and purchase
  documents find the item by its code.
- The save message says what happened to the item ("FSY-001: 2 updated, 1 added").

**What changed:** before, a Fabrication Master save changed nothing on the item. R&D had to
open the item in Inventory and press **Change**, which copied the catalog again by matching
numbers — so a size whose numbers changed became a **second** size at 0 stock next to the old
one (the duplicates seen on ANG-001). A size's numbers can no longer change while anything uses
it: Store, Purchase and Production have already acted on them.

## 2. Discontinued size

**Where:** Fabrication Master Edit — each size row has a Discontinue / Continue button; a
discontinued size is struck through and tagged.

**How it works:** a discontinued size stays on the item with its stock, but is **never bought
or picked anew**:
- the low-stock job doesn't reorder it;
- Store can't raise a purchase request for it (it isn't listed);
- R&D can't pick it for a new BOM line or a new Sub Child Part (a line / part already on it
  keeps it).

Everything already running still works: its stock can be issued, an open PO for it can still be
received and QC'd, existing BOM lines keep their price. The usual way to "correct" a size that's
in use: discontinue the old one, add the right one as a new size.

## 3. The R&D inventory form

**Where:** R&D → Inventory (`/r&d/inventory`), editing a fabrication item.

- The **Change** button is gone for an item already linked — "Sizes follow Fabrication Master"
  instead. (**Select** stays when creating a new item.)
- Sizes show a **Discontinued** or **Leftover** tag.
- Saving the form no longer writes the sizes or their stock back. Before, the form sent every
  size with the stock it had **when the form was opened** — a form left open while Store issued
  material (or while Fabrication Master synced) put the old stock back. Now the item keeps its
  own sizes and stock; only Material Flow / Min Stock / Order Qty are taken from the form.

---

## Tested

Made-up company, real handlers, 32 checks, 0 left in the database:
- SS 304 instead of MS (density 7850 → 8000): sheet 2 × 1250 × 2500 49.06 → 50.00 kg, same
  size, 13 pcs kept; BOM line 15.70 → 16.00 kg, ₹1570 → ₹1600; Sub Child Part 7.85 → 8.00 kg,
  ₹785 → ₹800; Child Part ₹2400; leftover re-weighed.
- Add a size; remove an unused size; an old out-of-step size left alone.
- Removing an in-use size refused, catalog unchanged; each of the in-use checks blocks on its
  own; a closed request doesn't.
- Discontinue: stock kept; new purchase request / new BOM line refused; an open PO still
  receives; the low-stock job reorders the new size only.
- Code locked; an old R&D form can't put back stock or a removed size.
