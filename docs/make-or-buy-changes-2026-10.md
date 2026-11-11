# What changed — Child Parts and Sub Child Parts can be bought (28 Oct 2026)

Plain-language writeup. Built in four slices and tested (54 checks on made-up companies; the
older price / cascade suites re-run). Logic: [make-or-buy-parts-2026-10.md](make-or-buy-parts-2026-10.md).

---

## 1. Make or buy — the choice (R&D)

**Where:**
- Inventory → Child Part / Sub Child Part tab → **Manage**: a "Make or buy" box with the same
  **Purchasable (Vendor) / Internal Manufacturing** radio Product Master has. A bought part shows
  a **Bought** badge in the list (and "price pending" until it has a price).
- BOM Management → **New Child Part / New Sub Child Part**: the same choice at creation.

**How it works:**
- One choice at a time; R&D switches it, no approval. A switch asks to confirm, is recorded on
  the part ("Last switched to Bought by RD Head on 28/10/2026") and notifies:
  - **Accounts** — "now bought, raise requests" (or "now made here"); if it has never been bought,
    "enter an estimated vendor price";
  - **the Company Admin** — with the effect on machine costs ("BP816 ₹140.00 → ₹120.00").
- **Bought from day one:** a Sub Child Part needs no source material or processes, a Child Part no
  BOM. **Switching to Made** is refused until those are filled in, with what's missing.
- Open build orders and open POs at the moment of a switch finish as they are.
- Every existing part stays Made — nothing changed until R&D switches one. A part is bought only
  by its own make / buy field, never by the general "purchase" flag (which every item has on by
  default — the older test suites caught this: a part made elsewhere would have been treated as
  bought and its build orders refused). A made part is also kept out of the purchase reorder job
  even if that flag is on.

## 2. Price

- Each part keeps **two prices**: its **made cost** (BOM, still kept current) and its **bought
  cost** (last real purchase, or Accounts' estimate). The choice decides which one the BOM above
  uses; every switch re-prices and pushes up to the Machine.
- **Never bought:** **price pending** — Accounts is asked for an estimate (a vendor's price has
  their profit in it; our made cost doesn't). Until then the made cost stands in and every Child
  Part / Machine using it is marked **price provisional**. Accounts gets a **daily reminder**.
- **Accounts' estimate** (Purchase & Outsource → Inventory, new **Child Part / Sub Child Part**
  tabs, "Price pending" in amber): pushed up at once, provisional mark cleared.
- **The first real receive** replaces the estimate (rate before GST + charges share, as §56).
  *2026-11-05: this never ran through Store's real receive until now: [make-or-buy-bought-part-price-fix-2026-11.md](make-or-buy-bought-part-price-fix-2026-11.md).*
- **Buy → Make:** the made cost re-worked at today's prices. **Make → Buy again:** back to the
  last purchase — never lost.
- An old PO received after switching to Make updates only the bought cost; the price in use
  doesn't move.
- **Same rule for a Machine:** switched to Purchasable on Product Master with no purchase price
  → pending, Accounts asked.

**Sales sees "Price provisional" (warned, never blocked):** on the lead quotation (item row), the
order form (next to the billing-amount hint), Product Master (R&D and Store). A quotation sent
with a provisional price says so in the lead's history. *Added 2026-11-05: the new lead form's machine list too.*

## 3. Production and reorder

- A Machine order short of a **bought** Child Part raises a **purchase request** (shown under
  "needs purchase" on Store's order badge) instead of a Child Part build order; a Child Part order
  short of a bought Sub Child Part, the same.
- No build order is ever raised for a bought part — low-stock sweeps, cascades, replacement
  orders and Dispatch all refuse it in one place.
- **Low stock:** a bought part reorders through the purchase reorder job, like a raw material —
  set its **Material Flow** + min stock / order qty in Manage.

## 4. Purchase and QC

- **Vendor Master → Products & Services** lists bought parts (labelled Child Part / Sub Child
  Part); made parts stay out. Requests, RFQ / PO, receive and stock work as for any item.
- **Incoming (bought) checklist:** R&D → Sub Child Part / Child Part QC has a new card, with its
  own master list ("Manage incoming master list"). Store's receive → QC uses it while the part is
  bought; the build-step checklists are untouched and used when it's made.

---

## Tested (made-up companies, real handlers, 0 left)

- **Slice 1 (17):** bought from day one (no source / processes / BOM), Accounts asked; switch to
  Made refused until the master is complete; switch both ways, history, notifications; switching
  to what it already is refused; the plain item save can't flip it.
- **Slice 2 (19):** machine ₹100 → pending placeholder ₹100 + provisional → estimate ₹150 (MRP
  ₹180) → first receive ₹140 → steel rise moves only the made side → Buy → Make ₹120 (Company
  Admin told "₹140.00 → ₹120.00") → Buy again ₹140 → old PO after Make touches only the bought
  side (₹130) → Sub Child Part pending makes the Child Part and Machine provisional → estimate ₹90
  → Machine switched to bought with no price → pending → daily reminder.
- **Slice 3 (9):** Machine order short of a bought Child Part → request for 4; Child Part order
  short of a bought Sub Child Part → request for 6; every build path refuses it; reorder job raises
  its request; a made part still builds.
- **Slice 4 (9):** vendor list includes bought parts only; incoming master + item checklist for
  Sub Child Part and Child Part (other modules refused); QC pulls the incoming list for a bought
  part and never for a made one.

## 5. R&D's Approval page (2026-10-29)

**Where:** R&D → Approval (`/r&d/design-approval`).

- **A bought part takes the Purchase Machine path:** only its **Incoming (bought) QC List**, then
  **Release**. Design and BOM show "n/a — bought from a vendor". For a Child Part / Machine above
  it, a bought part counts as passing Design and BOM (it has neither) — it still has to be
  Released before the parent can be.
- **Each path's checklist only affects its own sign-off:** a bought part needs its Incoming list;
  a made part needs its build-step lists, and an empty Incoming list never blocks it. Editing one
  path's list voids only that path's sign-off.
- **Switching make ↔ buy pulls back the QC List sign-off and the Release** (Design / BOM sign-offs
  kept). R&D is warned **before** the switch (in the confirmation) and **after** it (a
  notification to R&D Head + Employees saying exactly what to redo).
- **The Approval page flags it:** an amber "Needs re-approval — switched to Bought by … on …"
  banner on the row and in Manage (with the steps), an amber count on the Sub Child Part / Child
  Part tab, and a "Show only these" filter. The flag clears when it's Released again. The
  Inventory Manage box also says "Needs re-approval" with a link to the Approval page.
- **Automatic purchase requests for a bought part wait for its Release**, like build orders for
  a made part (cascades and the low-stock reorder job).

**Tested (18 checks):** bought part refused Design / BOM, QC refused until the Incoming list has
rows, then QC + Release; a made Child Part with a bought part inside approves Design and BOM; the
switch pulls back QC + Release, flags it, notifies R&D Head + Employee; page count + filter; each
path's list voids only its own sign-off; re-release clears the flag; an unreleased bought part
raises no purchase request, a released one does. Slice 1 (17) and 3 (9) re-run, pass.

## Open — your call
- **Stock value** of bought parts follows the parked gap 5 (stock reports use `stdCost`).
