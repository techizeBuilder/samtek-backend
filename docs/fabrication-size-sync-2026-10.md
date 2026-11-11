# Fabrication Master → Inventory: keeping sizes in step

*Logic doc, 2026-10-28. Gap 3 of the BOM price push review (automated-pricing-cascade-design-2026-09.md).*

## 1. The problem

A fabrication raw material (sheet, angle, pipe, beam…) is described twice:

- **Fabrication Master** (R&D): the catalog entry — name, category, density, material, and its
  list of **sizes** (e.g. sheet 2 × 1250 × 2500 mm, 47.1 kg each).
- **The inventory item** made from it: a **copy** of those sizes, each with its own stock
  (`dimensionVariants[]`, `subStock`).

Today:

1. Saving Fabrication Master changes **nothing** on the inventory item. R&D has to open the item
   and press **Change** to copy the catalog again.
2. **Change** matches a size by its numbers. A size whose numbers changed doesn't match, so the
   old size stays (with its stock and old weight) and the new one is added at stock 0 — **two
   entries** for what R&D meant as one. (Dev example: ANG-001 — catalog 1 size, item 5.)
3. **Change** also copies the catalog **code** onto the item.
4. A weight change (density / material) never reaches the Sub Child Part / BOM cost.
5. The R&D item form sends every size back on save **with the stock it had when the form was
   opened**. A form left open while Store issues material, or while a sync runs, puts the old
   stock back.

## 2. Why sizes can't simply be "corrected" in place

The system finds a size in two ways:

| Side | How it finds the size | Examples |
|---|---|---|
| Production | the inventory size's **id** (never changes) | BOM lines, Sub Child Part source size, Sheet Plans, material demands, reservations, Store's issue, reorder for Child Part / Machine orders |
| Purchase | the size's **numbers** | purchase requests, quote cards, RFQ / PO lines, Store's receive by size, QC jobs, QC's stock credit, the low-stock reorder |

And several places keep a **copy** of the numbers from the day they were made: a BOM line's cut
size and weight, a production order's demand key, a Sheet Plan's sheet area.

So if a size that's already in use changed its numbers:

- an open PO for "2 mm" would, at QC pass, find no 2 mm size and put the pieces on a new
  "leftover" size that can never be reordered;
- the low-stock job would no longer see its open request and raise a second one;
- a running production order's demand key would stop matching — material could be issued twice;
- a Sheet Plan would be nested on the wrong sheet.

**Rule: a size's numbers are fixed once anything uses it.** Fabrication Master can only add or
remove a size (there is no "edit a size" today), so changing numbers = removing the old size +
adding a new one.

## 3. The rule

When R&D saves a Fabrication Master entry, the server updates the linked inventory item in the
same step. Sizes are matched **by their numbers** (as the purchase side already does):

| What changed in Fabrication Master | On the inventory item |
|---|---|
| A size is still there with the same numbers (density / material / designation may have changed) | **Updated in place**: same size, same stock, same id; new density / weight / designation. If the weight changed → the price push runs. |
| A new size | **Added**, stock 0. |
| A size was removed (or its numbers changed = removed + added), and it is **not in use** | **Removed** from the item. Nothing pointed at it, so nothing breaks. |
| A size was removed, and it **is in use** | **The save is refused**, with what uses it (§4). R&D keeps the size and marks it **Discontinued** instead (§5), then adds the correct size as a new one. |

Item-level fields that **flow** to the item on every save: name, material grade, sheet metal
yes / no, purchase / used / receive units.

The **code does not flow.** Once an item exists, the catalog code is locked in Fabrication
Master — BOM lines, demands and purchase documents find the item by its code.

## 4. "In use" — what blocks removing a size

A size is in use if any of these is true (inventory size id = **id**, size numbers = **numbers**):

1. **Stock** on that size (`subStock` > 0).
2. A **BOM line** on it — Child Part BOM, Machine BOM (and the old per-machine BOM) (id), not
   discontinued.
3. A **Sub Child Part** made from it (source size, id).
4. A **Sheet Plan** for it (id).
5. An **open production order** with a material demand on it (id, order not Completed), or a
   Sub Child Part job-work order whose raw material was sent from it (id, not Completed).
6. A **reservation** on it (id).
7. An **open purchase request** for it (numbers; Pending / Approved / Ordered).
8. An **open PO** with a line for it (numbers; not Received / Cancelled / Rejected).
9. An **open QC job** received in that size (numbers; not Approved / Rejected).

The refusal lists them, e.g.:

> Can't remove 2 × 1250 × 2500 — it's in use: 13 pcs in stock · BOM CP-004 · PO-2026-031.
> Mark it Discontinued instead.

## 5. Discontinued size

A per-size **Discontinued** mark, set in Fabrication Master, copied to the inventory size.

- **Not offered for anything new**: the low-stock reorder skips it, Store can't raise a purchase
  request for it, R&D can't pick it for a new BOM line or a new Sub Child Part.
- **Everything already running still works**: its stock can be issued and counted, an open PO
  for it can still be received and QC'd, existing BOM lines keep working (shown with a
  "discontinued" tag so R&D can move them to the new size).
- **Can be turned back on** (Continue).
- Not the same as **leftover** (Store-cut remainders). A leftover is never a catalog size; a
  discontinued size is a catalog size R&D has retired.

## 6. Weight change → price push

When a size's weight changes (density or material), the same push a price change runs:

- Sub Child Parts made from that item: material cost **and weight** re-worked from the new
  weight, Sheet Plan scrap too → Child Parts → Machines.
- Child Part / Machine BOM fabrication lines: the line's weight per piece re-worked from its own
  cut size at the new density, then its price → up to the Machine.
- Production orders already running keep their own copy (what they were planned with).

## 7. The R&D item form

- The **Change** button goes away for an item that is already linked (the server keeps it in
  step). **Select** stays for a new item.
- On save, the server **keeps the item's own sizes and stock**. From the form it takes only what
  the form edits: material flow, min stock, order qty (per size, by id). An old form can no
  longer put back old stock or old sizes.

## 8. Worked examples

Item SHEET-MS (density 7850 kg/m³), sizes A = 2 × 1250 × 2500 (stock 13, on BOM CP-004),
B = 3 × 1250 × 2500 (stock 0, unused).

1. **R&D changes the material to SS 304 (density 8000):** A and B stay, weights re-worked
   (A 49.06 → 50.00 kg); stock 13 stays on A; the price push re-prices CP-004 and its Machines.
2. **R&D adds C = 4 × 1250 × 2500:** C added on the item, stock 0.
3. **R&D removes B:** unused → removed from the item.
4. **R&D tries to remove A (meant 2.5 mm):** refused — "13 pcs in stock · BOM CP-004". R&D
   marks A Discontinued and adds 2.5 × 1250 × 2500. Store can still issue the 13 pcs of A; the
   low-stock job reorders only the new size; R&D moves CP-004's line to the new size when ready.
5. **R&D changes the catalog code:** not allowed once the item exists.

## 9. Not changed

- Existing data (ANG-001's extra sizes etc.) stays as it is — dev data. An item size that was
  already out of step with the catalog before the sync is left alone: only sizes R&D removes
  in a save are checked and taken off (so an old orphan with stock never blocks a save).
- Leftover sizes are never added, removed or discontinued by the sync. They are the same
  material, so a **density change re-works their weight** too (built 2026-10-28).
- Fabrication Master entry-level Discontinue: as today.
