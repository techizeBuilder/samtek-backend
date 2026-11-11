# Outsource pricing types — logic (client change 2, 2026-10-22)

**Status:** LOGIC DOC for your review. Nothing is built yet. After you agree it: plan → build.

## Why

An Outsource Order step has one way to be priced today: **₹ per piece**. Vendors don't all quote
like that. After the client's feedback there are **five types**:

1. **Per piece:** as now.
2. **Whole line:** one price for the whole quantity on the line, e.g. ₹500 for all 6 Fan Blades.
3. **Per minute.**
4. **Per hour.**
5. **Per job work:** ₹ per operation, e.g. per hole drilled, times how many operations the part
   needs, from the BOM.

## The rules

### R1 — Each step picks its own type
Prices are already **per step** (change report §8). Each step on a line picks its own type, so one
line can mix them: cutting per piece, drilling per job work. The line total is the sum of its steps.

### R2 — How each type works

| Type | Purchase types when ordering | Amount for the step | Known when ordering? |
|---|---|---|---|
| **Per piece** | ₹ per piece (per unit for Child Part / Machine) | rate × qty | yes |
| **Whole line** | ₹ for the whole line | the lump sum | yes |
| **Per job work** | ₹ per operation | rate × operations per piece (BOM) × qty | yes |
| **Per minute** | ₹ per minute | rate × minutes (entered later) | **no** |
| **Per hour** | ₹ per hour | rate × hours (entered later) | **no** |

Per minute and per hour are the same mechanism with a different unit: "time-based".

### R3 — Per job work needs the BOM to say how many operations
- In the BOM's process configuration (Sub Child Part, Child Part and Machine), an **Out Source**
  step can **optionally** carry **operations per piece**: a count plus a name. For now only Out
  Source steps (your answer). The field is stored on every step, so turning it on for In-House
  later, if the client wants it, is only a screen change.
  - e.g. drilling: **4 holes**
  - e.g. tapping: **2 threads**
- **Per job work is offered only for steps that have it.** Welding without a count can't be priced
  per job work; it gets the other four types.
- The count is **copied onto the Outsource Order line when the order is made**. A later BOM edit
  doesn't change an order already placed.
- For a Child Part / Machine, the count is **per unit**.

### R4 — Time-based: Purchase enters the time later
- **When ordering:** Purchase types only the rate (₹ per minute / ₹ per hour).
- **Later**, once the vendor says how long it took, Purchase enters the time on the order (Orders
  tab → the line → **Enter time**). It's the total for that step on that line, e.g. "drilling: 3 h
  20 min".
- **Any time after the order is created** (your answer, 2026-10-22). The vendor may tell us the
  time while the work is still with them, so it doesn't wait for the work to come back. Editable
  until the step is paid.
- When the time is entered:
  - the step's amount = rate × time, plus GST
  - the bill gets that row (until then it shows "awaiting time", ₹0)
  - **the Company Admin is notified**: "OSO-0004 · Fan Bush drilling — 3 h 20 min × ₹300/h =
    ₹1,000 + GST" (your call: notify, not approve)
- **That step can't be paid until its time is entered.**

### R5 — Approval
- **The limit check** (the outsource order limit in Purchase Approvals → Settings) uses the amounts
  **known when ordering**: every step that isn't time-based. A time-based step counts ₹0 there.
- **New setting** for the Company Admin: **"Approve time-based orders"**, off by default.
- **Approval happens once, when the order is made** (your answer, 2026-10-22). There are two
  triggers:

  | Known amount vs limit | Has a time-based step? | Setting | Result |
  |---|---|---|---|
  | over the limit | any | any | **Pending Approval**: the usual amount approval; the admin also sees the time-based rates on it |
  | under the limit | yes | **ON** | **Pending Approval**: for the time-based rate(s) |
  | under the limit | yes | OFF | Open |
  | under the limit | no | any | Open |

- **No second approval when the time is entered:** the admin is **notified** (R4) and can check it.

### R6 — QC rejections come off pro-rata, for every type (agreed)
- As today, work QC rejects is taken off the bill. For types without a per-piece rate, the
  **average per-piece price** (step amount ÷ qty) is used.
  - **Whole line:** ₹500 for 6, 1 rejected → ₹500 × 5 ⁄ 6 = ₹416.67 payable.
  - **Time-based:** the same, once the time is in: (rate × time) × accepted ⁄ qty.
- **Per job work:** rate × operations × accepted pieces.

### R7 — Advance: a % of the known amount, or a flat amount (your answer, 2026-10-22)
- **The payment terms get a choice:**
  - **% of the known amount:** as now, on the steps that aren't time-based, + charges, + GST
  - **flat amount:** e.g. ₹200
- **An order with only time-based steps** has no known amount, so only the **flat amount** is
  offered, and only if an advance is needed at all.
- When the time is entered later, the bill total grows, but **the advance stays as it was**.

### R8 — Price help, per type
- The price help on each step ("last / average / this vendor last") compares prices **of the same
  type only**. A per-hour rate is never averaged with a per-piece one.
- History records the type, e.g. "Last ₹300/h (rahul)", "Last ₹2/hole".

### R9 — Where it shows
- **New Outsource Order:** each step's price row gets a type picker. Its inputs change with the
  type:
  - ₹/pc
  - ₹ for the line
  - ₹/operation, showing "× 4 holes × 6 pcs"
  - ₹/min or ₹/h, showing "time entered later"
- **Approvals:** the step rows show the type and rate; time-based shows "time later".
- **Order detail and bill rows:** the basis on each row, e.g. "drilling · 6 pcs × 4 holes × ₹2 =
  ₹48" or "drilling · 3 h 20 min × ₹300/h = ₹1,000".
- **The job-work cost** (T10, captured on the last receive) and slice 4 (cost into the part, later)
  use the **actual** step amounts. For a time-based step that's only once its time is entered, so
  a job-work order can't finish its cost until then.

## Worked examples (GST 18%)

**A. Fan Blade, 6 pcs, laser cutting, whole line ₹500**
- line ₹500, GST ₹90, total ₹590
- QC passes 6 → payable ₹590

**B. Fan Bush, 2 pcs: cutting per piece ₹25, drilling per job work ₹5/hole, BOM drilling = 4
holes/pc**
- cutting = 2 × ₹25 = ₹50
- drilling = 2 × 4 × ₹5 = ₹40
- line ₹90, GST ₹16.20, total ₹106.20
- bill rows: "cutting · 2 pcs × ₹25 = ₹50" and "drilling · 2 pcs × 4 holes × ₹5 = ₹40"

**C. Chamber frame, 2 pcs, grinding per hour ₹300; order also has Packing ₹100; advance 20%;
limit ₹300**
- **When ordering:** known total = Packing ₹100 + GST ₹18 = ₹118
  - below the limit → Open (setting OFF)
  - advance = 20% × ₹118 = ₹23.60
  - grinding shows "awaiting time"
- **Vendor says 1 h 30 min:** Purchase enters it.
  - grinding = 1.5 × ₹300 = ₹450, GST ₹81
  - bill total ₹118 + ₹531 = ₹649
  - admin notified
  - the advance stays ₹23.60
- **QC passes 2:** grinding payable ₹531 (less its share of the advance)

**D. The same order with "Approve time-based orders" ON**
- On creation → **Pending Approval** (known ₹118 is under the limit, but it has a time-based step).
  The admin approves the ₹300/h rate.
- After the time is entered: the admin is only **notified** (₹450 + GST). No second approval.

**E. Only time-based: Fan Bush drilling, ₹5/min, advance needed**
- Known amount ₹0 → the advance can only be a **flat amount**, e.g. ₹200.
- Time entered: 90 min → ₹450 + GST ₹81 = ₹531. The advance stays ₹200.

## What changes in the data (for the plan)

- **BOM process step:** `operation: { name, perPiece }`, optional, Out Source steps.
- **Outsource Order line step price:** `stepRates[]` becomes
  `{ step, type: 'piece' | 'line' | 'operation' | 'minute' | 'hour', rate, operationsPerPiece,
  operationName, time: { minutes, enteredAt, by, approvedAt, approvedBy }, amount }`.
  Old orders read as type `piece`.
- **Settings:** `approveTimeBased` (off).
- **Payment terms:** `advanceType: 'percent' | 'flat'`, `advanceFlat`.
- **Bill:** a row per step with its basis. A time-based row is ₹0 / "awaiting time" until entered.

## Decisions (2026-10-22)

1. **R4:** time can be entered any time after the order is created.
2. **R5:** one approval, at creation. Over the limit → the usual amount approval. Under the limit
   with a time-based step and the setting ON → approval. After the time: a notification only.
   *(My reading of your answer: please confirm.)*
3. **R6:** pro-rata, with the average per-piece price.
4. **R7:** advance = % of the known amount, or a flat amount; flat only when the order is all
   time-based.
5. **R3:** Out Source steps only for now; open for In-House later.
