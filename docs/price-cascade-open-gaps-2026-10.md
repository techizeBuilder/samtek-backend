# BOM price push — open gaps (parked)

*Written 2026-10-28. Review of the price push (slice 4, `services/priceCascadeService.js`)
against [automated-pricing-cascade-design-2026-09.md](automated-pricing-cascade-design-2026-09.md).
Parked so the client's procurement changes go first; pick up from here.*

## Settled

| Gap | Outcome |
|---|---|
| 2 — Inventory form changes price without the push | **Not a gap.** The R&D Inventory form has no price fields; the Excel import only creates new items; only Accounts' purchase-inventory screen sets a price, and it pushes. |
| 3 — a raw material's size / weight change doesn't reach the cost | **Built 2026-10-28** — [fabrication-size-sync-2026-10.md](fabrication-size-sync-2026-10.md), change report [fabrication-size-sync-changes-2026-10.md](fabrication-size-sync-changes-2026-10.md). Browser check pending. |

## Open

### Gap 1 — old data never caught up (most important)

The push only runs when something changes. Prices that changed before it existed (2026-10-24)
were never carried up. Dev check 2026-10-27 (read-only):

| What | Stored | Correct now |
|---|---|---|
| SCP-007 material cost | ₹39.46 | ₹2.96 |
| SCP-004 / SCP-005 material cost | ₹602.28 / ₹301.14 | ₹574.49 / ₹287.24 |
| NB-012 line on 2 Child Parts (5 pcs) | ₹1000 (₹200 each) | ₹23.75 (₹4.75 each) |
| CP-004 / CP-005 cost on the item | ₹0 | ₹1078.92 |

Machines checked were in step. The client's live data matters most: their BOM lines were priced
when added.

**Idea:** a one-time "re-price everything" run in hierarchy order (Sub Child Parts → Child Parts
→ Machines), as a script + a button to run it again. Open question: who gets the button
(Accounts only, or R&D too)?

### Gap 4 — opening a BOM only partly self-heals

Opening a Child Part / Machine BOM re-reads its Sub Child Part / Child Part lines, but not its
**own material lines**. Opening a Sub Child Part doesn't re-read its material cost. The design
doc (§10) wanted opening a page to fix both, as a safety net for a missed push.

### Gap 5 — stock value shows ₹0 (needs your call: in scope or not)

Stock reports (Inventory value, MIS) use qty × `Item.stdCost`. Nothing writes `stdCost` for
**Sub Child Parts**, and **bought raw materials** only get `purchaseCost` — so both count as ₹0.
Outside the price push itself.

### Gap 6 — small items

- The old Machine build path (`productionMfgController.js` ~658) still calls
  `recalculateItemPricing` for the removed old BOM — it only stores a "no BOM cost" note.
- The Sales Order minimum-bill check (`getMachineBillingBOMCost`) looks up Machines only, not
  Motors.
- No database indexes on the "who uses this part" lookups (design doc §10):
  `subChildPartDetails.sourceItem`, `ChildPartBOM.subChildParts.subChildPart`,
  `MachineBOM.childParts.childPart`, `materials.code`.

### Deferred from gap 3

- **Changing a fabrication item's code** once the inventory item exists: locked by gap 3. If ever
  needed, it's its own step that renames every reference (BOM lines, demands, purchase
  documents).
- **Dev data:** ANG-001's 4 extra sizes, MSS-001 / MSS-003 codes differing from their catalog,
  SHT-273172's missing catalog entry — left as they are (dev only).

## Later — manpower cost

Production cost already flows: typed at the last in-house step → `unitCosts` → `pushPartCost`
→ the price push. With manpower, the typed number becomes hours × rate; nothing else changes.
Decide then whether a rate change re-costs parts already built (suggested: no — next build only).
