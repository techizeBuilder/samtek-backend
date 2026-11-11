# Slice 4 — Outsource cost into the part, and fresh prices for Sales (logic)

**Status: BUILT (2026-10-24).** Logic agreed: Q1–Q7 as recommended, plus §5b (the user's cases)
and §7b. What was built, and where it differs from the plan, is §11 at the end. Change report §18.

**Read before this:**
- `../automated-pricing-cascade-design-2026-09.md`: the price cascade (design only, never built)
- `../outsource-cost-jobwork-design-2026-09.md`: the job-work cost (design only; parts of it are
  replaced below)
- `outsource-workflow-2026-10.md` §5.5 and D7
- `pricing-types-logic-2026-10.md`

## 1. The goal

Sales should always see a fresh price for a Machine, from its real cost plus its profit margin:

```
Machine price (Item.mrp / salePrice) = Machine cost × (1 + profit %) − discount %
Machine cost  = its Child Parts + its own materials + job-work cost + Production cost / expense
Child Part    = its Sub Child Parts + its own materials + job-work cost + Production cost / expense
Sub Child Part = material + job-work (processing) + scrap   — per piece
```

**Out of scope, on purpose:** how Production's manpower cost is worked out. That will change later.
Production keeps typing its two numbers (**cost** and **expense**) as today; only *when* it's asked
changes (§4).

## 2. What works today, and what doesn't

| Piece | Today |
|---|---|
| Raw material price | Store's PO receive / the bill sets `Item.purchaseCost` (and ₹/kg). **Works.** |
| Sub Child Part material cost | Recomputed from the raw material **only** when a job-work order finishes, R&D edits it, or a Sheet Plan is saved. Goes stale in between. |
| Sub Child Part job-work cost | **Fully outsourced (job-work order):** the last receive takes one total, pre-filled from the Outsource Order. **A hybrid Sub Child Part (Production order):** nothing, ever. |
| Child Part / Machine job-work cost | **Nothing.** No field exists. The outsourced steps' money never reaches the part. |
| Production cost / expense | Asked only at the **true last step**, when it's in-house. If the last step is outsourced, nobody is ever asked. |
| A Machine whose last step has QC | Production types its cost when sending to QC, but the QC pass **never applies it** (a gap found while reading `qcController.js`). |
| Child Part → Machine | The Machine BOM re-reads its Child Parts only **when someone opens the Machine BOM page**. |
| Machine → Sales price | `Item.stdCost / mrp / salePrice` update only when the Machine BOM is opened or edited, or a Machine order finishes. **Sales reads these stored numbers** (quotation, the order form's minimum billing), so they can be stale. |

## 3. The job-work cost — automatic from the Outsource Order

**Purchase types nothing at the receive.** The money for every outsourced trip is already on the
Outsource Order: each step's amount (piece / whole line / per job work / per minute / per hour),
the line total, and what QC accepted. The cost is read from there.

**Old plan, replaced:** Purchase typed a job-work cost per round at the receive. That can't work
with time-based steps (the time often comes later), and it isn't needed: the order already has
the price.

### 3.1 Per trip (one request on an order line)
- **Money:** the request's share of its line, **without GST** (GST is input credit, not a cost):
  `line amount ÷ line qty × the request's qty`. For a whole-line or time-based price this is the
  line's average per piece, the same rule the bill uses.
- **Order charges** (packing, testing… on the Outsource Order): spread over its lines by line
  amount, without GST. **Q1**
- **Freight** (Dispatch's hired-vehicle expense): **not** in the part cost for now, the same as
  freight on PO material. **Q2**
- **Only what's accepted counts.** Pieces QC rejected are taken off the bill, so they cost
  nothing. A redo is a new trip with its own price (₹0 if the vendor redoes it free).

### 3.2 Per level
- **Child Part / Machine:** each unit gets its trip's money ÷ the units on that trip. A unit adds up
  every outsourced trip it went on (units can be batched differently per step, so this is kept per
  unit).
- **Sub Child Part** (one batch): every trip's accepted money for the batch, added up, ÷ the pieces
  that **finished** (stock). Pieces scrapped later (in-house, after the vendor was paid) spread
  their cost over the survivors. **Q5**

### 3.3 A time-based step without its time
The step's amount isn't known yet. **The order still finishes as today** (stock, Sale); only the
part's cost **waits**:
- the part's cost is updated as soon as Purchase enters the time (the same moment the bill row
  fills)
- until then the BOM page shows "job-work cost waiting for the time on OSO-…"
- **Q3:** the job-work order's last receive is blocked today until the time is in (built 23 Oct).
  With this, that block is no longer needed for the cost. Drop it?

## 4. Production's own cost / expense — asked at the right moment

**Today:** asked only at the true last step when it's in-house.

**Proposed (Q4):** asked at the unit's **last in-house step**, whichever step that is:
- the last step is in-house → **the same as today**
- the last step(s) are outsourced → asked when Production finishes its last in-house step before
  them
- fully outsourced (no in-house step) → never asked; Production cost = ₹0

**Why not at "Send for Outsourcing"** (the September plan): since client change 1, outsourced runs
are often requested **automatically** (first steps, and units back at Store). Production may never
click Send, but it always finishes its own last in-house step.

**Hybrid Sub Child Part:** it has no Production cost field today. Its in-house cost (asked the same
way, once per batch) goes into its processing cost with the outsourced money, ÷ finished pieces.

## 5. Putting it together — when a unit / batch finishes

Whoever finishes it (Production's last step, a QC pass, or Store's receive of an outsourced last
step), the part's cost becomes:

| Level | Writes |
|---|---|
| Sub Child Part | `jobWorkCost` per piece = (outsourced money + Production's in-house cost) ÷ finished pieces; `materialsCost` re-read from the raw material's current price |
| Child Part | its BOM `jobWorkCost` (new field) = this unit's outsourced money; `productionCost / productionExpense` from §4; material lines re-read |
| Machine | the same on the Machine BOM; then the price push (§6) |

**"The latest build wins"** (the rule today): each finished unit / batch replaces the part's cost
with its own actual cost; no running average.

**Except (decided 2026-10-27, "the last complete build"):** a newer build whose job work still waits
for a per minute / per hour time doesn't replace a **complete** cost. The part keeps the last
complete build's cost (Sales never sees a too-low price). Once the time is entered, the newer build
is complete and replaces it. (`costFrom.waiting`, `mayReplace` in `partCostService.js`; slice 4
test case C.)

The new BOM field `jobWorkCost` shows as its own row ("Job work (outsourced)") on the Child Part /
Machine BOM pages, next to Production Cost / Expense.

## 5b. Who pushes the cost to the BOM, and when (agreed 2026-10-24)

**The BOM has three numbers from production:**
- **Production cost** and **Production expense** (typed by Production)
- **Job work (outsource) cost**: a new field on the Child Part / Machine BOM; a Sub Child Part's
  existing `jobWorkCost`

**Stacked up, pushed once.** During the order, each unit (a Sub Child Part: the batch) keeps a
running job-work total of the accepted outsource money for the trips it went on. The BOM isn't
touched until the **true last step** finishes. Then all three go to the BOM together, and the
price push (§6) follows.

**Example:** a Machine, steps 1–5, steps 2 and 4 outsourced:
- step 2 accepted (OSO-A) → added to the unit's total
- step 4 accepted (OSO-B) → added
- step 5 is the last in-house step → Production types cost + expense
- step 5 finishes → push: job work A + B, Production cost / expense

**The rule is always "whoever finishes the true last step":**

| # | Case | Who | When |
|---|---|---|---|
| 1 | Last step in-house, no QC | Production | completes the last step (types cost + expense there) |
| 2 | Last step in-house, with QC | QC Head | QC passes it (cost + expense typed by Production when sending to QC) |
| 3 | Last step outsourced, no QC | Store | receives it back (Production's cost was typed at its last in-house step) |
| 4 | Last step outsourced, with QC | QC Head | QC passes it |
| 5 | Fully outsourced Child Part / Machine | Store or QC Head (3 / 4) | Production cost / expense ₹0 |
| 6 | Fully outsourced Sub Child Part (job-work order) | Store or QC Head | last trip received, or its last check passes |

**Other cases:**
- **Time not entered** at the true last step: the order / stock finish; the push waits; Purchase
  entering the time does it.
- **QC rejects the last step:** no push until the redo passes. A paid redo adds its trip; a free
  one ₹0.
- **Several units:** each pushes when it finishes. The latest build wins; units can have
  different job-work totals.
- **Sub Child Part scrap:** one push per batch, ÷ finished pieces.
- **Not from an order:** a raw material's new price, R&D editing a BOM, a Child Part's cost
  changing → the price push (§6) only.

## 6. The price push — Sales sees it at once (Q6)

When any of these change, the change climbs **every** route up to the Machine's price, at once:
- a raw material's price (PO receive / bill, Accounts' manual price, ₹/kg)
- a Sub Child Part's cost
- a Child Part's cost
- a Machine's own cost

```
raw material ─┬─> every Sub Child Part made from it ─> every Child Part using it ─> every Machine using it
              ├─> every Child Part using it directly  ─────────────────────────────> every Machine using it
              └─> every Machine using it directly
Machine → Item.stdCost / mrp / salePrice   (profit % / discount % from Pricing Value, unchanged)
```

- Only writes when a number actually changes.
- Each part is visited once per change.
- A part with no cost yet is skipped, not set to ₹0.
- Opening a BOM page keeps refreshing too (a safety net).
- **Child Part price (Q7):** its own `Item.stdCost / mrp` gets the same push, for selling it as a
  spare.

**Not done:**
- quotations already sent aren't changed
- Production's manpower cost stays as typed

## 7. Fixed along the way (checked in the code, 2026-10-24)
Production **types a cost that's never saved** in three places today:
- **Machine, last step with QC:** typed per unit when sending to QC; the QC pass completes the
  unit but never applies it.
- **Sub Child Part, last step with QC:** typed for the batch when sending to QC; stored on the QC
  entry, never applied.
- **Sub Child Part, last step without QC** (after an earlier QC step): the dialog requires cost +
  expense; the server checks them, then drops them.

What works today: a Child Part (last step with or without QC) and a Machine (last step without
QC). Each unit writes its own typed cost; the last unit to finish sets the BOM. All cases go
through one shared push in slice 4.

## 7b. Sub Child Part gets all three numbers (the user, 2026-10-24)
A hybrid / in-house Sub Child Part runs a Production order too, so it gets **Production cost**
and **Production expense** next to its **job-work (outsource) cost**:
- Production types the **batch total**, once (at its last in-house step).
- Per piece = material + scrap + (job work + Production cost + Production expense) ÷ finished
  pieces.
- A fully outsourced (job-work) Sub Child Part: the Production numbers stay ₹0.
- Child Part BOM lines read all five (material, scrap, job work, Production cost, Production
  expense).

**Production cost / expense are always typed by Production** (at its last in-house step),
whoever does the push. The outsource cost is never typed: it's added up from the Outsource
Orders automatically. No in-house step → nobody is asked, ₹0.

## 8. Worked example (roadmap v2 numbers, GST 18% left out)

**Fan Bush** (job-work, 2 pcs):
- cutting ₹25/pc = ₹50
- drilling ₹5 × 4 holes × 2 = ₹40
- → ₹90 ÷ 2 finished = **₹45/pc** job-work cost

**Fan Blade** (6 pcs, laser cutting whole line ₹90, drilling in-house):
- → ₹90 ÷ 6 = **₹15/pc** outsourced
- \+ Production's drilling cost ÷ 6 (e.g. ₹60 → ₹10/pc)
- = **₹25/pc** processing

**Fan** (Child Part, 1 unit):
- **Outsourced:**
  - OSO-0005: welding ₹150 + grinding whole line ₹100 = ₹250
  - OSO-0006: pre ₹80 + post ₹60 = ₹140
  - → job-work **₹390**
- **Production:** coating is its last in-house step → asked there, e.g. cost ₹200 + expense ₹50
- **Fan cost:**
  - Sub Child Parts: 6 × Fan Blade + 2 × Fan Bush, each its material + processing
  - \+ own materials (Tool-A)
  - \+ ₹390 job-work
  - \+ ₹250 Production

**BP816:** the same, one level up. Its price = cost × (1 + profit %) − discount %. It changes as
soon as Fan's cost changes, without anyone opening a page.

## 9. Not needed
**Back-fill of older orders:** the client's live system has only product master data. The orders
since 20 Oct are dev test data.

## 10. Questions

| # | Question | Recommended |
|---|---|---|
| Q1 | Order charges (packing, testing) in the part cost? | Yes, without GST, spread over the lines by amount |
| Q2 | Dispatch freight (hired vehicle) in the part cost? | Not for now (same as PO material) |
| Q3 | Drop the job-work order's "enter the time before the last receive" block, now that the cost waits for the time itself? | Yes, one rule everywhere |
| Q4 | Ask Production's cost / expense at the unit's **last in-house step** (not only the true last step)? | Yes |
| Q5 | Sub Child Part: pieces scrapped after the vendor was paid → their cost spread over the finished pieces? | Yes |
| Q6 | Build the price push (§6) now? | Yes. Without it the new costs reach Sales only when someone opens the Machine BOM |
| Q7 | Push the Child Part's own price too (spares)? | Yes |

## 11. What was built (2026-10-24)

**Code:**
- **`services/partCostService.js`:**
  - `outsourceMoneyFor`: the accepted money per unit / batch, no GST, + charge share (Q1)
  - `pushPartCost` / `pushJobWorkCost`: write the BOM at the true last step; the latest build
    wins
  - `refreshCostsAfterAcceptance`: runs after every acceptance check
  - `saveProductionCost`, `isLastInHouseStep`
- **`services/priceCascadeService.js`:** the price push from a raw material / Sub Child Part /
  Child Part / Machine.
- **`utils/bomMaterialPrice.js`:** a material line's price (a fabrication line = weight × ₹/kg).
- **New fields:**
  - Sub Child Part `productionCost / productionExpense / costFrom`
  - Child Part / Machine BOM `jobWorkCost`, `jobWorkWaitingFor`, `costFrom`
  - the production order's `unitCosts[]`
  - the job-work order's `costPushedAt`, `costWaitingFor`

**Where the push happens:**

| How the true last step finishes | Code |
|---|---|
| In-house, Production's Complete-final dialog | `completeFinalProcessStep` (all three levels) |
| In-house with QC, QC passes it | unit: `decideChildPartUnit` (Child Part + Machine); batch: `submitBatchQcDecision` |
| An order with no QC step at all, the self-certify Approve | `approveQC` (only when a cost was entered; never zeroes) |
| Outsourced, Store receives / QC passes / time entered | `refreshAcceptance` → `refreshCostsAfterAcceptance` |
| A job-work order's final check | `submitDecision` → `pushJobWorkCost` |

**Production's cost at its last in-house step:** asked by `markProcessComplete`,
`submitUnitQcStep` and `submitBatchQcStep` (once per unit / batch), and by the screen's dialogs.

**Price push triggers:**
- a raw material's price: `cascadeRecalculateToConsumers`, which was a no-op stub; Accounts' ₹/kg
  now too
- R&D editing a Child Part BOM, a Sub Child Part, a Sheet Plan
- every push above

**Differences from the plan:**
- **The cost refresh runs after every acceptance check**, not only when something changed. A
  receive whose time isn't in yet changes nothing, but the build is finished, and the BOM should
  say what it waits for.
- **Older trips not on an Outsource Order** (the legacy job-work receive) still type their total;
  only trips on an order are automatic.
- **Child Part:** `Item.stdCost` only. Child Parts aren't sold (type Assemblies), so no MRP.
- **Not a gap after all:** an outsourced Child Part / Machine order needs at least one QC step on
  its BOM (an existing rule, found by the test).

**Tests:** `slice4-cost-test.mjs` **29/29**, hand-worked, 0 left:
- A: Machine job work ₹100 + ₹300 ÷ 2 = ₹250, MRP × 1.2
- A2: the no-QC Approve; an older Approve doesn't zero
- B: the last in-house step asks; job work ₹150 with packing; fabrication line ₹160 not ₹999
- C: waiting for the time → ₹150
- D: (₹200 + ₹160 + ₹40) ÷ 8 = ₹50
- E: job-work ₹70 ÷ 2 = ₹35 with no typed cost
- F: charges
- G: the latest build wins
- H: a Machine with QC on its last step
- I: steel +₹10/kg → Machine +₹40, MRP +₹48
