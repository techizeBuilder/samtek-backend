# Slice 6 — Dispatch sends: vehicles, trips, handovers 1 · 2 · 5

- **Date:** 2026-10-20
- **Status:** **built** 2026-10-20 (44 tests) — change report §5. Browser check pending.
- **Design:** [dispatch-design-2026-10.md](dispatch-design-2026-10.md) (T1–T7);
  [material-logic-2026-10.md](material-logic-2026-10.md) (M1–M4).
- **Uses:** slice 5's material plan ([slice-5-material-plan.md](slice-5-material-plan.md)).
- **Not in this slice:** returns, the Store receive, "vendor says ready", Store → Production
  (slice 7); removing Purchase's Mark sent (slice 8).

## What this slice does

1. **Vehicles** (Dispatch): regular vehicles saved. A one-time vehicle is typed on the trip, and
   "save as regular" adds it to the list.
2. **Vendor Pickups** gets tabs **Purchase / Outsource / Trips**.
   - Dispatch ticks one vendor's waiting jobs ("We pick up" POs, Outsource Order lines not yet
     sent) and makes a **trip**: vehicle, driver, date; freight for a hired vehicle (it becomes a
     "Transporting Cost" expense); the challan / e-way bill numbers.
3. **Store hands its part to Dispatch** (a new tab on Material Transfers). This is the real stock
   movement:
   - combined sheets / lengths (catalog stock or offcuts that cover the area / length, plus an
     optional offcut Store keeps)
   - items by quantity
   - cut pieces (Store cuts them)
   - each order is booked its own share on its reservation
4. **Production hands over** the units / its part of the material (Process Execution).
5. **Dispatch presses "Delivered to the vendor":**
   - the trips go **Sent**, and the Outsource Order "With vendor"
   - the Child Part / Machine first send is no longer a dummy
6. **Dispatch presses "Picked up"** on a PO. Store's PO receive is unchanged.
7. **A line on a trip can't be Mark-sent by Purchase,** and its order can't be cancelled.
   - A trip can be cancelled only before any handover; that frees its jobs and removes its
     freight expense.

## Tests (hand-worked)

See the verification table in the approved plan: the Bracket line (2 sheets, stock 10 → 8,
shares 1.333 / 0.667); an offcut + 1 sheet ≥ 5.4 m²; the Frame line with the Production
handover; "Delivered" refused before the handovers; freight ₹1,200; cancel rules.
