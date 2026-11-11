# Make or buy — Child Parts and Sub Child Parts

*Logic doc, 2026-10-28 (client meeting). Doc → plan → build. Plan:
`C:\Users\Asus\.claude\plans\recursive-conjuring-wilkes.md`.*

## 1. Why

Today a Child Part or Sub Child Part can only be **made**. The client may start buying a part
from a vendor instead — a part we used to make, a new part we only ever buy, or a part we bought
and now make. Machines already have this choice (Product Master's **Purchasable / Internal
Manufacturing** radio); parts get the same radio.

**Bought** means the vendor supplies the **finished part from their own material**. Outsourced
**job work** (we send our material, the vendor does a process step) is a different thing and is
unchanged.

## 2. The choice

- **One choice at a time** — Made or Bought — switched by **R&D** whenever needed, from the
  Inventory part tabs (Manage) or BOM Management. No approval; every switch is recorded on the
  item (who, when, from → to) and notifies Accounts (who buy) and the Company Admin (with the
  price effect).
- A part is **Bought** only when its own `partSourcing` is `buy` (set by the radio); otherwise Made.
  Not `purchase`: every Item defaults that to on, so a part created any other way would wrongly
  read as bought (found by the regression run, 2026-10-28). Every existing part is Made — nothing
  changes until R&D switches one.
- **Bought from day one:** a Sub Child Part needs no source material or processes, a Child Part
  no BOM. **Switching to Made** needs them (Sub Child Part: source material, quantity, processes
  with a QC step; Child Part: at least one BOM line and processes) — the switch is refused with
  what's missing until they're filled in.
- At the moment of a switch, open build orders and open POs **finish as they are**. Only new needs
  follow the new choice.

## 3. Price

Every part keeps **two prices** at all times:

- **Made cost** — its BOM cost, kept current by the price push (material + scrap + job work +
  production; the "last complete build" rule) — even while the part is bought.
- **Bought cost** — the last real purchase (rate before GST + share of the PO charges, from the
  received PO line — procurement §56), or **Accounts' estimate** when it has never been bought.

The radio decides which one the BOM above uses (the Child Part BOM for a Sub Child Part, the
Machine BOM for a Child Part). Every switch re-prices the part and pushes the change up to the
Machine's price.

| Case | Price used |
|---|---|
| Made (as today) | The made cost |
| **Make → Buy, never bought** | **Price pending.** Accounts is notified to enter an estimate (a vendor's price includes their profit; our made cost doesn't). Until then the made cost stays as a **placeholder** and every Child Part / Machine using the part is marked **"price provisional"**. Accounts gets a daily reminder. |
| Accounts enters the estimate | The estimate; pushed up; the provisional marks clear |
| The first real receive | The real purchase cost replaces the estimate |
| Make → Buy, bought before | The **last purchase cost** (shown with its date; Accounts can enter a fresh estimate if it's old) |
| Buy → Make | The **made cost, re-worked now** (current material prices + its last complete build; if never built, material + scrap + R&D's manual production estimate) |
| Buy → Make → Buy | Back to the last purchase cost — it's never lost |
| Make → Buy → Make | The made cost, re-worked now |
| An old PO received **after** switching to Make | Updates the bought cost only; the price in use doesn't move |
| An old build finished **after** switching to Buy | Updates the made cost only; the price in use doesn't move |
| No price on either side | "No cost yet": skipped, never zeroed (the push's existing rule) |

**Same rule for a Machine:** a Machine switched to Purchasable with no purchase price yet is price
pending too, with the same notification and reminder.

### Price provisional — Sales is warned, not blocked
A Machine (or Child Part) whose price includes a pending part shows **"Price provisional —
<part>'s purchase price isn't set yet"** wherever Sales sees the price (Product Master, the lead
quotation, the order form). Sales can still quote and take the order; the quotation / order line
records that the price was provisional. A slow estimate never stops a sale.

## 4. Production and reorder

| Where | Made part (as today) | Bought part |
|---|---|---|
| A Machine order short of a Child Part | A Child Part **build order** | A **purchase request** (like a short raw material) |
| A Child Part order short of a Sub Child Part | A Sub Child Part **build order** | A **purchase request** |
| Low stock | The part sweep raises a build order | The purchase reorder job raises a request (min stock / order qty) |
| Replacement orders (lost at vendor, QC scrap) | A replacement build order | Never raised (a bought part has no build order) |
| Stock reservation, Store's issue to Production | — | Unchanged |

## 5. Purchase

A bought part is a normal item counted in pieces: it appears in Vendor Master's **Products &
Services**, Purchase Requests, RFQ / PO, Store's receive and QC exactly like a raw material. A
made part stays out of all of them.

## 6. QC

- **Made:** checked per build step, with the step checklists set on R&D → Sub Child Part / Child
  Part QC — unchanged.
- **Bought:** arrives finished, so none of the step checks apply. It gets its own **Incoming
  (bought)** checklist (e.g. dimensions, finish, the vendor's certificate), set on the same R&D QC
  page next to the step checklists. Store's receive → QC job uses it.
- Switching never touches either list; both are kept and the radio picks which applies.

## 7. Worked example

Child Part **CP-004 Panel** (made cost ₹1,078.92) on Machine **BP816** (₹4,000; MRP × 1.2 =
₹4,800).

1. **R&D switches CP-004 to Bought** (never bought): price pending — BP816 still ₹4,000 using the
   ₹1,078.92 placeholder, marked "price provisional — CP-004". Accounts notified.
2. **Accounts enters an estimate of ₹1,300:** CP-004 = ₹1,300 → BP816 = ₹4,000 − ₹1,078.92 +
   ₹1,300 = **₹4,221.08**, MRP ₹5,065.30; the provisional mark clears.
3. **First PO received at ₹1,250 + ₹25 freight share:** CP-004 = ₹1,275 → BP816 ₹4,196.08.
4. **R&D switches back to Made:** CP-004 = made cost re-worked (say ₹1,090.40 after a steel price
   rise) → BP816 ₹4,011.48. The ₹1,275 purchase cost is kept.
5. **Switched to Bought again:** CP-004 = ₹1,275 (last purchase, 3 days ago) → BP816 ₹4,196.08 —
   no pending this time.
6. Meanwhile a Machine order for BP816 short of 2 × CP-004 raises a **purchase request for 2**,
   not a Child Part build order; the receive goes through CP-004's incoming QC checklist.

## 8. Not changed

- Outsourced job work, the build flow of a made part, the step QC checklists.
- A Machine's own radio and its Final QC.
- Prices already on sent quotations / orders.
