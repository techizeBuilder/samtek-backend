# Serial tracking into production and to the customer — logic (step 2)

- **Date:** 2026-10-31 (rewritten the same day after step 1 was built)
- **Status:** first build 2026-10-31 (4 slices) — change report [serial-tracking-changes-2026-10.md](serial-tracking-changes-2026-10.md). **The 2 Nov review found gaps; the fixes (§11) are built and tested.** Browser check pending (with step 1).
- **Client's ask:** track each vendor serial — **which production order used it** and **which customer
  got it in their order**.
- **Your addition:** use it for warranty claims on Complaints → Support **both ways** (from the
  customer's order to the vendor serial, and from the vendor serial to the customer).
- **Builds on:** procurement v2 §28 (serials at receive, `PurchasedUnit`), §29 (vendor warranty claims)
  and **step 1** ([cascade-to-parent-logic-2026-10.md](cascade-to-parent-logic-2026-10.md), built):
  a cascade order's parts go straight to their parent order.

---

## 1. What exists today

| Piece | Today |
|---|---|
| **Serial at receive** (§28) | A receipt where the vendor quoted a warranty, of an item counted in pieces → **one record per piece** (`PurchasedUnit`): vendor, PO, QC, warranty months. Anything else → one lot number per receipt. |
| **After QC** | The unit is "Accepted" in stock. **Nothing records where it goes next.** |
| **Store → Serial Numbers** | Every serial / lot, its QC status, REJ and warranty claims. |
| **Vendor warranty claim** (§29) | Complaints → Support → Vendor Warranty Claims, typed from the vendor serial. |
| **Store's issue** | Material Transfers, per production order's Material List line. Quantities only. |
| **Outsourced work** | Store hands its part of the material to Dispatch per request (outsource v2 slice 6). |
| **Production's return** | Excess / Defect back to Store; Store confirms. |
| **Levels** (after step 1) | A **cascade** order (built for a parent order) delivers to its parent — the chain is known by order links. A **stock build** (low-stock Child Part / Sub Child Part, a stock Machine order from Production → Orders) goes into stock, and later "any" one is taken. |
| **The customer** | A Machine order for a sales order carries the customer's **Order** (`orderCode`, e.g. ORD-0066). A machine sold **from stock** goes Available → a **Store QC job** created automatically (no Store click) → Packaging → Dispatch. |

## 2. Decisions (you, 2026-10-31)

| # | Decision |
|---|---|
| D1 | Store **picks** serials from the item's in-stock list — no typing. |
| D2 | At the top, **the customer's Order is enough** — not which machine of that order. |
| D3 | What matters is **how the item is used**, not its warranty: a required choice on the item, **"Built into the product" / "Used to make the product"**. |
| D4 | Set by **R&D on the Inventory item**, required on **every item counted in pieces** (warranty or not — per-piece serials depend on each receipt's quote). kg / litre / m items are left out (never per-piece). |
| D5 | **No default** — existing items start empty; R&D must choose (explanation + "not sure? ask"). |
| D6 | **Empty doesn't stop production:** Store can issue; R&D gets a "Needs usage type" filter + bell. |
| D7 | **Sub Child Part:** it has exactly **one source material** (`sourceQty` per piece), so only the source can carry a serial, and it's always built into the part. Tracking only when the source is a serialised piece item: **whole per piece** → each piece is a carrier; **a fraction** → the serials stop at the batch. |
| D8 | **Cascade orders need no identity:** their parts go to the parent (step 1), so a serial follows the parent links to the Machine order and its customer Order. |
| D9 | **A carrier** = a made unit that has a *Built into the product* vendor serial in it — known **per unit at runtime** (serials were actually issued to its order), not from the BOM. |
| D10 | **Stickers only on carriers that go into stock:** a low-stock Sub Child Part / Child Part build, a stock Machine order. The client prints the stickers; Store sticks one and enters its number. |
| D11 | **Pairing** (which vendor serial is inside which stickered unit): **Store, while labelling.** May move to Production if the client asks. |
| D12 | Sticker numbers: free text, per company; the same number twice **for the same part** is refused; a scrapped / lost unit's sticker is **retired** (kept, never reused). |
| D13 | **No sticker, no handover:** an unlabelled carrier can't be issued from stock (the label page and bell point at exactly those). |
| D14 | **From-stock sale:** no Store handshake, so **QC picks** on the automatic Store QC job — the sticker number of our machine, or the vendor serial of a bought product. QC checks the machine's Final checklist on that job ([fixed 5 Nov](../qc-store-purchase-final-checklist-2026-11.md)). |
| D15 | **Bulk Transfer** skips serialised lines (issued one by one with the pick). |
| D16 | The bell for the label page: Store Head + Store Employee, **when a carrier arrives** and **daily** while any stay unlabelled. |

## 3. The item's usage type (R&D → Inventory)

**Label:** *How is this item used in production?* *(required, items counted in pieces)*

| Option | Meaning | Examples | Where its serial's trail ends |
|---|---|---|---|
| **Built into the product** | It ends up inside what we deliver. | motor, bearing, controller, switch | the part / machine it's in → **the customer's Order** |
| **Used to make the product** | We use it while building; it doesn't leave with the product. | grinding wheel, cutter, welding torch tip, jig | **the production order that used it** |

*Not sure? Ask: "When the machine is delivered, does the customer get this item inside it?" Yes →
Built into the product.*

- Not shown for kg / litre / m items, Product Master / Motor Master, or a bought Child / Sub Child
  Part (always built in). A Sub Child Part's source is always built in (D7).
- Existing items: empty; R&D → Inventory **"Needs usage type (n)"** filter + a bell.

## 4. Two kinds of number

| Number | On what | Who creates it |
|---|---|---|
| **Vendor serial** | a purchased unit (§28) | the vendor; Store typed it at receive |
| **Sticker number** | a **stock-built carrier** (§5.4) | the client's printed sticker; Store enters it |

Every move is an **event** on the unit's record (who, when, which order) — never overwritten, so a
return and a re-issue both stay visible. Each record has one **current place**.

## 5. Where a number moves

### 5.1 Store issues to a production order (Material Transfers)
- A line whose item has serialised units in stock → Store **ticks the serials** it hands over (search,
  "pick the oldest n"). The rule and its warning are in §12. *(Corrected 3 Nov: this used to say the count must
  equal the quantity sent. Plain pieces in stock can cover part of it.)*
- Only **Accepted, in-stock** units are offered.
- Each picked unit → **Issued to <order>**:
  - *Used to make the product* → **"Used in <order>"** — its trail ends.
  - *Built into the product* → it's in that order's build; it follows the order (5.3 / 5.4).
  - usage type empty → "Issued to <order>"; Store sees *"R&D hasn't set how this item is used"* (D6).
- A Child Part / Sub Child Part line with **stickered** units in stock → Store **picks the sticker
  numbers** the same way (5.5). An **unlabelled carrier** can't be sent (D13).
- Lots (no per-piece serial): unchanged. Bulk Transfer skips serialised lines (D15).

### 5.2 Store hands material to Dispatch for outsourced work
The same pick on Store's handover to Dispatch: the serials are linked to **that request's production
order**, as 5.1. **Not coming** → "Lost" (§11). *(Corrected 2 Nov: nothing "back unused" exists for these
items. Only sheet / length offcuts come back from a vendor — your decision of 23 Oct.)*

### 5.3 A cascade order finishes (no sticker — D8)
Its parts go straight to the parent (step 1). Its issued serials follow: **"In <order> → <parent
order> → … → <Machine order>"**, worked out from the order links when shown.

### 5.4 A stock build finishes → the label page (D10, D11, D16)
- **When:** a **carrier** unit of a low-stock Child Part / Sub Child Part order, or of a stock Machine
  order, goes into stock (Production's last step, a QC pass, an outsourced last step's receive).
- It appears on Store's new **"Label carriers"** page (bell on arrival + daily):
  *"ORD-… Panel unit 2 — holds 1 of: MTR-5521, MTR-5523"*.
- Store sticks a sticker and enters: **the sticker number** + **which vendor serial(s) are in it**
  (picked from that order's issued serials not yet placed; the count = the BOM quantity per unit).
- **Sub Child Part:** per finished piece when `sourceQty` is whole; a fraction → no label, the source
  serials stop at the batch: **"Cut into batch <order>"** (D7).
- The stickered unit is now a tracked unit **In stock**.
- **5 Nov:** the page lists one entry per part, not per piece. Store generates sticker numbers as a range or types them, checks a suggested fill of what's inside, and saves many together: [label-carriers-one-entry-2026-11.md](label-carriers-one-entry-2026-11.md). A stickered part can go inside another sticker.

### 5.5 Store issues a stickered part to a parent order
Picked by sticker number (5.1). The sticker → **"Issued to <parent order>"**, and so does everything
paired in it.

### 5.6 Production returns material to Store
Production's return of a serialised / stickered item **picks which ones** come back:
- **Excess** → back in stock ("Returned from <order>"), can be issued again.
- **Defect** → **"Defective — returned from <order>"**, not offered for issue; a vendor warranty claim
  can be raised on it (§29).

### 5.7 Scrap, loss
See §11: only a Sub Child Part batch can be scrapped by QC. Child Part / Machine QC is Pass or Reject → rework.

### 5.8 The customer
- **A Machine order for a sales order:** everything in it (issued directly, delivered by its cascades,
  or stickered parts issued to it) → **its customer Order** (`orderCode`).
- **A stock Machine order:** its machines are carriers → stickered at stock (5.4). When one is sold,
  **QC picks its sticker number** on the automatic Store QC job (D14) → that machine (and everything in
  it) → **the customer Order** of that sale.
- **A bought Machine / Motor sold from stock:** QC picks its **vendor serial** on the Store QC job → the
  customer Order. Bought **for** the order: its serials are already on that purchase's QC job.
- Packaging / Dispatch unchanged.

## 6. Complaints → Support: claims both ways
- **From the customer:** per Order — **"Vendor parts in this order"**: every vendor serial traced into
  it, with the part it's in, vendor, warranty months, received and delivered dates. No end date: "Under
  warranty" stays by hand (2 Nov). **"Claim"** opens a Vendor Warranty Claim with serial, customer and
  Order filled in.
- **From the vendor serial:** Find also shows its **trail**: issued to → part / sticker → Machine order →
  customer Order (or "Used in <order>").
- **Store → Serial Numbers:** a "Where it is" column and the trail per row; stickered units listed too.

### 6.1 One place to raise a claim (3 Nov)
Found before step 2.15. The from-the-order way was built on Customer Records, while Support Management's **Vendor Warranty Claims** only asked for a serial. A customer usually knows their mobile number or order, not a serial.

**Decided (you, 3 Nov):**
1. **Support Management's Vendor Warranty Claims is the one place with both ways.** New claim offers **By customer or order** and **By serial**.
2. **Customer Records keeps its Claim button,** which opens the same claim form.
3. **Tickets don't change.** They hold one machine, while vendor parts are listed per customer order, so an order with two machines could confuse a ticket raised for one. The target is the vendor score at purchase, which doesn't need tickets.

**By customer or order:**
- Enter a **10-digit mobile number**, or an **order number** such as ORD-0129.
- It lists the vendor parts per order, the same list Customer Records shows. A mobile number also lists parts fitted on service visits.
- Picking a part opens the same form as today, already looked up, with the customer and order filled in.

**By serial:** unchanged, including picking the vendor and item by hand when the serial isn't in our records. This stays for parts bought before tracking.

**The order gets its own place on the claim.** Today it goes into the free-text "Ticket no." field as "Order ORD-0129". It moves to its own field, searchable in the claims list. "Ticket no." stays free text. Claims raised by serial carry the order when the serial's trail reaches one.

**A pre-filled claim looks the part up by itself,** so nobody has to click Find.

**The vendor score doesn't change.** It reads a claim's outcome, dates, ★ rating and "under warranty" mark, none of which depend on which way the claim was started.

| You enter | What shows |
|---|---|
| 9012761313 | The customer's orders, with ORD-0129's TEST-01 and TEST-02 |
| ORD-0129 | That order's TEST-01 and TEST-02 |
| An order with no tracked parts | "No vendor parts on this order. Use By serial." |
| A number or order we don't have | "Nothing found. Check it, or use By serial." |

## 7. Worked example

**Setup:** BP816's BOM: Child Part **Panel** × 1 (1 **motor**, *Built into*), 2 **bearings** per
machine (*Built into*); the panel's welding uses a **grinding wheel** (*Used to make*).

**A — on the go (sales order ORD-0070, 2 machines → MO-1; no Panel in stock → cascade CPO-12 for 2):**

| # | What happens | Records |
|---|---|---|
| 1 | Store issues 2 motors to CPO-12 → picks **MTR-5521, 5522**; 1 wheel → **GW-7001** | motors **Issued to CPO-12**; GW-7001 **Used in CPO-12** (ends) |
| 2 | MTR-5522 faulty before fitting → returned as **Defect**; Store issues **MTR-5523** | MTR-5522 **Defective** (claim possible); MTR-5523 **Issued to CPO-12** |
| 3 | Both Panels finish → straight to MO-1 (step 1) — **no sticker** | motors **In CPO-12 → MO-1** |
| 4 | Store issues 4 bearings to MO-1 → **BRG-101…104** | **Issued to MO-1** |
| 5 | Delivered | all **→ ORD-0070** |

**B — stock (a low-stock order CPO-20 builds 2 Panels for stock):**

| # | What happens | Records |
|---|---|---|
| 1 | Store issues motors **MTR-5530, 5531** to CPO-20 | **Issued to CPO-20** |
| 2 | Both Panels go to stock → **"Label carriers"** + bell. Store sticks **S-101** (pairs MTR-5530) and **S-102** (MTR-5531) | stickers **In stock**; motors **In S-101 / S-102** |
| 3 | Machine order MO-7 (sales order ORD-0081) has 1 Panel in stock → Store issues it → picks **S-102** | S-102 + MTR-5531 → **MO-7 → ORD-0081** |
| 4 | S-101 waits in stock; Store can't issue an unlabelled Panel (D13) — all are labelled here | — |

**C — a stock machine:** MO-9 (stock form) builds 1 BP816 with bearings BRG-201/202 → goes to stock →
label page → Store sticks **S-301** (pairs BRG-201, 202). Later ORD-0090 buys one from stock → the
automatic Store QC job → **QC picks S-301** → BRG-201/202 → **ORD-0090**.

**Claims:** the customer of ORD-0070 calls → Complaints lists MTR-5521, MTR-5523, BRG-101…104 → "Claim"
on MTR-5521 fills it in. Typing **MTR-5531** → *Issued to CPO-20 → sticker S-102 → MO-7 → ORD-0081*.

## 8. Rules
- A serial / sticker is in **one place at a time**; every move is an event (never overwritten).
- Store picks only **Accepted, in-stock** units; Store pairs only serials **issued to that order** and
  not yet placed; Production returns only what was issued to that order.
- Counts must match: picked = quantity sent / returned; paired per unit = BOM quantity per unit.
- Nothing about stock quantities, costs, reservations, QC or the outsource flow changes; numbers ride
  along with what already moves.

## 9. Not changed
- Receive, QC, REJ and vendor claims (§28 / §29), except the trail shown on them.
- Lots (kg / litre / m, no-warranty receipts): one lot number, no pick.
- Packaging's machine serials and the customer warranty ("Reached Safely", the item's months).
- The vendor score.

## 10. Before go-live
Units **already issued or used** before this is built have no trail. Units **still in stock** are
pickable from day one. Carriers already in stock from before have no pairing — they're never put on the
label page (we don't know what's in them); new ones are.

## 11. Decisions from the 2 Nov review (you, 2026-11-02)

**Verified on screen** (dev QC-2026-0255 Fan, QC-2026-0237 machine incl. Final QC, both restored): Child Part
and Machine QC offer Save checks, Reject, Pass; **only a Sub Child Part batch has Scrap**. A "not coming" isn't
built for units either. A Sub Child Part has one source material, so a scrapped piece holding a serial
means one kind of material.

| Case | Decision |
|---|---|
| **QC scraps a Sub Child Part piece holding a serial** | QC ticks which serial(s). The **whole piece** goes on Store → Defective Inventory (QC rejects the whole piece, not a part inside it). A fraction per piece stays "Cut into batch". |
| **Defective Inventory Repair / Scrap** | Asks which serial (required when the row has tracked units). Repair → back to stock with its contents. **Scrap → scraps everything inside it**, and retires its sticker. |
| **A Sub Child Part piece lost at a vendor** | Its serial → "Lost". Nothing arrives at Store, so it skips Defective Inventory. |
| **Production returns a cascade part holding serials** (no sticker) | Production says which serial(s) are inside, or "Nothing tracked inside". Excess → stock + Label carriers, pre-ticked. Defect → Defective Inventory, linked. Returns are one Material List line at a time; a Machine is never returned. |
| **Unlabelled carrier** | Blocks only when the transfer needs it (quantity > stock − unlabelled), not the whole part. |
| **Pairing count** | Stays a hint: the BOM says how many, not how many have serials. **"Nothing tracked inside"** closes a unit with nothing to pair (a bug otherwise: it could never be saved). A warning shows when serials are left unpaired. |
| **Spare parts on a service visit** | The technician says which serial; it goes to that customer + ticket. |
| **Vendor warranty date** | Show the facts: *12 months vendor warranty · received 1 Jan 2026 · delivered to customer 1 Jul 2026*. **No calculated end date:** it depends on the vendor's terms. "Under warranty" stays by hand. Delivered = the order's earliest "Reached Safely". |

**Different from the customer warranty,** which Dispatch stamps at "Reached Safely" (delivery + the product's months).

**Not in this work:** Accounts' New Invoice and the manual Purchase Return
([open doc](../production/new-invoice-and-purchase-return-open-2026-11.md)); the old Repair Production page (nothing
reaches it).

## 12. Picking fewer serials than pieces (you, 2026-11-03)

Found in the browser test: Store handed over 1 Tool-A with 0 picked (12 pieces with a 6-month warranty serial, 9 plain).
Nothing was refused, and nothing asked. If that piece had a serial, the serial keeps saying "In stock" and a claim finds
the wrong place.

**The two levels.** Plain pieces = pieces − those with a serial.

| Level | When | What happens |
|---|---|---|
| **Hard block** (built) | Picked fewer than *quantity − plain pieces* | Refused: plain pieces can't cover the rest |
| **Warning** (new) | Picked at least that, but fewer than the quantity, while serials are still available to pick | A box says how many go without a serial. **Go ahead** stays disabled for **3 seconds**. |
| Nothing | Picked as many as the quantity or as many as there are serials, or the item has no serials | Carries on |

| Stock | Quantity | Picked | Result |
|---|---|---|---|
| 12 with serials | 1 | 0 | Hard block |
| 12 with serials, 9 plain | 1 | 0 | Warning: 1 without a serial |
| 12 with serials, 9 plain | 1 | 1 | Nothing |
| 12 with serials, 9 plain | 10 | 0 | Hard block: at least 1 |
| 12 with serials, 9 plain | 10 | 1 | Warning: 9 without a serial |
| 2 with serials, 9 plain | 5 | 2 | Nothing: no serial left to pick |

It warns and never blocks, because Store may really be handing over a plain piece, and a forced pick would record the wrong
serial.

**The same rule on all 8 screens:** Material Transfers · Store's handover to Dispatch · QC's pick on a sale from stock · a
technician's service visit · Production's return to Store · Defective Inventory Repair / Scrap · QC scrap or reject of Sub Child
Part pieces · lost at a vendor.

**Not on:** "What's inside this part", which already forces a choice (serials or "Nothing tracked inside"), and Bulk Transfer,
which skips lines with serials.

## 13. A serial inside a piece waiting for its sticker (2026-11-04)

A repaired or returned piece in stock knows what it holds, but the serial stays "Issued" to its old order until the sticker goes on. It counts as **in stock inside that piece**: not in the customer's vendor parts, not in "What's inside" on other orders, not offered to another carrier or a QC scrap pick. Its own **Label it** offers only what it holds. Report: [serial-in-waiting-piece-2026-11.md](serial-in-waiting-piece-2026-11.md).
