# Outsource material logic — where Dispatch gets it, and how much

- **Date:** 2026-10-20
- **Status:** logic agreed with the user (decisions M1–M4, §7). Not built. The Dispatch screens
  (trips, vehicles, Vendor Pickups tabs) build on this; their own design comes next.
- **Part of:** [outsource-workflow-2026-10.md](outsource-workflow-2026-10.md) §6 (later phases:
  Dispatch, Store, the Production material list).
- **Hard rule still applies:** how outsource requests **arrive** never changes. This is only
  about the material once a request is on an Outsource Order.

---

## 1. What exists today (found 2026-10-20)

- **Production's Material List is per order, for the whole order.**
  - Every line = per unit × order quantity.
  - Production presses **Issue** → Store **sends** it → Production presses **Receive**.
  - The order's `materialDemands[]` tracks requested / transferred / issued / used / pending
    return.
  - A reservation ledger (`MaterialReservation`, per order + item + size + line) stops two
    orders claiming the same stock.
- **Fabrication is counted in whole physical pieces:**
  - **Sheet metal:** whole sheets = area needed ÷ the sheet's area, rounded up. A Sub Child Part
    with a Sheet Plan uses the plan's sheets per run instead. Production returns the leftover,
    which is measured.
  - **Length material (Child Part / Machine):** issued as BOM cut pieces. Store cuts them and
    keeps the leftover.
  - **Sub Child Part source length:** whole catalog lengths, plus the existing remainder /
    leftover logic.
- **The Sub Child Part send picker** (whole sheet / cut piece / a matching leftover, leftover
  measured on return; `subChildPartMaterialSendService.js`) exists only for Sub Child Parts.
- **Production batches by unit:** a hand-off holds chosen units at the same step positions.
  Purchase merges requests from **different orders** into one Outsource Order line.
- **The blocker on Process Execution:** an **in-house** step can't be given to a team until its
  material is received in Production (`assignTeam`). An **Out Source** step is never given to a
  team (Production presses Send for Outsourcing, and the vendor does the work), so the blocker
  never applies to it.

### Gaps this logic closes

| # | Gap |
|---|---|
| G1 | A **Child Part / Machine** whose first step is Out Source: Production can still Issue that step's material, and the send to the vendor is a **dummy** (`rawMaterial.dummy`). The material could be taken twice, or never. Only the hybrid Sub Child Part is blocked today. |
| G2 | The per-step material check (`resolveStepMaterialLines`) compares the BOM's per-unit **cut-piece** count with issued **sheets / lengths**. The units don't match for fabrication lines. |
| G3 | Nothing tells Production that material is reserved for a vendor trip. |

---

## 2. Rule 1 — who supplies the material

Worked out **per request** (one production order's units / pieces, or one job-work order) and
**per material line**.

| Request | Where the material comes from |
|---|---|
| Fully outsourced Sub Child Part (job-work order) | **Store**, always (Production never sees it) |
| Hybrid Sub Child Part, step 0 | **Store** (Production's Issue is already blocked) |
| Hybrid Sub Child Part, a later step | **Production**: it holds the batch's pieces |
| Child Part / Machine, a step that sends the assembled part (`AssembledPart`) | **Production**: the units themselves |
| Child Part / Machine, the step's own material lines (`materialRefs`) | **Production first**, up to what it holds for **that order**; **the rest from Store** |

- **"What Production holds" for an order's line** = issued − used − pending return, **plus**
  what Store has sent and Production hasn't received yet (M4). Dispatch collects that part from
  Production once it's received.
- **On a first step,** Production usually holds nothing, so it all comes from Store. **On a later
  step,** it's usually already on Production's floor.

**Example — Child Part "Frame":**

| Step | Type | Material | What happens |
|---|---|---|---|
| 1. Laser cutting | Out Source | sheet | Store → Dispatch → vendor. Production's list shows **"goes to the vendor via Dispatch"**; Issue is blocked for that sheet. |
| 2. Bending | In House | (the cut pieces back from the vendor) | as today |
| 3. Welding | In House | bolts | Production issues the bolts as today; the blocker works as today. |

If Production had already issued the sheet before sending step 1, Dispatch collects it **from
Production** instead. Nothing is blocked then.

---

## 3. When it's decided (M1): when Purchase makes the Outsource Order

- **Fixed at that moment** and saved on the request as its **material plan**: for each line,
  how much comes from Production, how much from Store, and the quantity / area / length.
- **From then on:**
  - Production's **Issue limit** for that line drops by the Store part, so Store keeps it for
    the vendor and Production can't issue it.
  - The Production part is **earmarked for the vendor**, so it can't be used for another unit.
- **Shown to everyone:** Purchase sees it on the order (read-only), Production on its Material
  List, and Dispatch as its pick list.
- **An order edited after a reject** recalculates the plan. **Cancelled before pickup:** the plan
  is released, and Production can issue normally again.

---

## 4. Rule 2 — how much (from the request's own units / pieces, never the order's)

| Material | Quantity for one request |
|---|---|
| Plain items, assembly materials, consumables | per unit × the request's units (a step's split, `materialQuantities`, is respected). Exact. |
| Sub Child Part / Child Part references | per unit × units. Exact. |
| Length material (Child Part / Machine) | BOM cut pieces per unit × units. Store cuts them, as today. Exact. |
| Sub Child Part source material, length | total length = length per piece × pcs → whole catalog lengths (§5 when combined) |
| **Sheet metal** | an **area**: area per unit × units (Sub Child Part: area per piece × pcs). The physical sheets are decided by §5. |

Working in **area** (not "sheets per unit") fixes the partial-units problem. Sending 2 of 5
units sends 2 units' worth of area, not a rounded share of the order's sheets.

---

## 5. Rule 3 — sheet and length material on a merged line is combined (M2)

**For sheet / length material coming from Store** on one Outsource Order line (one part, one
vendor, one cutting run):
1. **Add up** the requests' area (or length).
2. **Whole sheets** = total area ÷ the sheet's area, rounded up. A Sub Child Part with a Sheet
   Plan uses the plan's ratio: sheets used ÷ plan qty × total pcs, rounded up. For length: total
   length ÷ catalog length, rounded up.
3. **Store hands over** whole sheets, or a leftover with enough area, using the picker extended
   to every level.
4. **Each order is booked its share by area** (or length). Each order's line is then closed: its
   need is met, and the rest of its reservation is released.

Everything else (plain items, references, Child Part / Machine cut pieces) stays per request,
because it's exact and gains nothing from combining.

### Example A — sheet, two Sub Child Part orders on one line

- **The part:** Bracket, 0.3 m² per piece. **The sheet:** 2500 × 1250 mm = 3.125 m².
- **The orders:**
  - order A: 12 pcs → 3.6 m² (on its own: 3.6 ÷ 3.125 = 1.15 → **2** sheets)
  - order B: 6 pcs → 1.8 m² (on its own: 0.58 → **1** sheet)

| | Sheets sent |
|---|---|
| Per request | 2 + 1 = **3** |
| **Combined (agreed)** | 5.4 m² ÷ 3.125 = 1.73 → **2** |

**Booked:**
- A gets 2 × 3.6 / 5.4 = **1.333** sheets; B gets 2 × 1.8 / 5.4 = **0.667**
- A's reservation was 2 and B's was 1: both lines are closed, and the unused 1 sheet stays free
  in Store

### Example B — length, two Sub Child Part orders on one line

- **The part:** Rod, 400 mm per piece. **The catalog length:** 6000 mm.
- **The orders:** A 20 pcs = 8000 mm; B 10 pcs = 4000 mm.
- **Per request:** 2 + 1 = 3 lengths. **Combined:** 12000 ÷ 6000 = **2** lengths.
- **Booked:** A 1.333, B 0.667.

### Example C — Child Part, units sent on two different trips

- **The part:** Frame, order with 5 units. Step 1 laser cutting uses 0.5 m² of sheet per unit.
- **The trips:**
  - Production sends units 1–2 → request 1 = 1.0 m² → 1 sheet (or a leftover ≥ 1.0 m²)
  - later units 3–5 → request 2 = 1.5 m² → 1 sheet
- Different trips are separate lines, so they're not combined. Each trip's offcut comes back and
  is measured.

### Example D — mixed sources

- **The part:** Machine order, step "Painting" (Out Source), sends the assembled part plus paint
  at 2 L per unit. Units 1–3 → 6 L.
- **What Production holds** for this order: 4 L.
- **The plan:**
  - the 3 units and 4 L of paint from **Production**
  - 2 L of paint from **Store**
- **Production's Issue limit for paint** drops by 2 L.

---

## 6. Rule 4 — the bookkeeping

- **The trip's pick list** = its requests' plans added up, split into a **Store list** and a
  **Production list**. Every row keeps its order.
- **Store hands over:**
  - stock goes down
  - the order's reservation is marked issued (its share, for a combined line)
  - the order's material line gets **"sent to vendor"**, which counts as issued **and** used
  - Production's list shows **"Sent to vendor via Dispatch (OSO-…)"**, not "Not issued"
- **Production hands over:** recorded as used by that step (as when a step starts today), and the
  earmark is cleared.
- **Back from the vendor (M3): unused material and offcuts always go to Store.** Fabrication
  offcuts become leftover sizes, measured at Store's receive and recorded as a return on the
  order. For a combined line, offcuts are credited to stock (the share split already happened).
- **The processed work:**
  - Store receives it → QC
  - then back to Production (the hybrid's next in-house step), or into inventory (a job-work
    order, or an outsourced last step)

---

## 7. Decisions (user, 2026-10-20)

| # | Question | Decision |
|---|---|---|
| M1 | When is "Production or Store" decided? | **When Purchase makes the Outsource Order.** It's saved as the request's material plan; Production's Issue limit drops by the Store part from then on. |
| M2 | Sheet / length material on a merged line | **Combined per line** (one run at the vendor); each order booked its share by area / length |
| M3 | Unused material / offcuts back from the vendor | **Always to Store** |
| M4 | Material Store has sent but Production hasn't received yet | **Counted as Production's**; Dispatch collects it from Production once received |
| — | Does Production lose its Issue on an outsourced first step? | **No, only for the part Store sends to the vendor.** In-house steps and their blocker are unchanged. |

---

## 8. Build notes (technical, for the plan)

- **The plan:** `OutsourceOrder.lines[].requests[].materialPlan[]` — per material line: the BOM
  line ref, item / size, kind (plain / cut pieces / sheet area / length), the need, `fromProduction`,
  `fromStore`, status. Built by one service when the order is made (claim), released on
  reject / cancel.
- **A combined line:** `lines[].combinedMaterial[]` — per item + size: total area / length,
  sheets / lengths, each request's share.
- **Production's side:**
  - a new figure on `materialDemands[]`: `sentToVendorQuantity`, plus an earmark for the
    Production part
  - the Issue limit (`requestSubChildPartMaterial`, `requestMachineMaterial`,
    `requestSubChildPartRawMaterial`) subtracts the Store part
  - the Material List shows "goes to / sent to the vendor via Dispatch"
- **Reservations:** `recordIssue` with the order's share (decimals for a combined line), then the
  line is closed (the generalised `markOrderFullyIssued`, per line).
- **G1:** a Child Part / Machine first-step send becomes real (the dummy is removed), handed over
  through Dispatch.
- **G2:** the per-step need for fabrication lines is worked out in area / length / cut pieces, so
  it matches what was issued.
- **Until Dispatch is built,** Purchase's temporary Mark sent can use the same plan, so the logic
  can be built and tested before the Dispatch screens.
