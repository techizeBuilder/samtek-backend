# Outsource flow — browser test roadmap v2 (fresh test, 2026-10-23)

**Why a new one:** the client's two changes (change report §14) change how outsource requests
arrive and how they're priced, and job-work now has per-step QC (§13). The first roadmap
(`outsource-flow-test-roadmap-2026-10.md`, tested to R4) is **superseded**. This one starts clean
and uses every part of the flow once, in the order work really happens.

**Same parts as before:** a sales order with **BP816** (Blower Pulverizer) ×1 + **PRO001** (Aata
machine) ×1. Tick the O-numbers as they pass; note anything odd next to them.

---

## What each part does (unchanged BOMs, plus one count)

| Part | Kind | Steps (* = Out Source, QC = QC step) | First run auto-requested? |
|---|---|---|---|
| **BP816** | Machine | assemble QC › pre painting* QC › post painting* FINAL › coating QC | no (assemble in-house first) |
| **PRO001** | Machine | assemble › pre painting* › post painting FINAL | no |
| **Fan** | Child Part, 1 unit | welding* QC › grinding* QC › coating QC › pre painting* › post painting* | **yes: welding · grinding** (new) |
| **Chamber** | Child Part, 1 unit | welding* › grinding* › coating › pre painting › post painting QC | **yes: welding · grinding** (new) |
| **Fan Blade** | Sub Child Part (hybrid), 6 pcs | laser cutting* › drilling QC *(corrected 2026-10-23: no QC on laser cutting)* | yes: laser cutting |
| **Fan Bush** | Sub Child Part (job-work, all Out Source), 2 pcs | cutting* QC › drilling* QC — **drilling: 4 holes per piece** (set in R0) | always Purchase-only |
| **Chamber frame** | Sub Child Part (hybrid), 2 pcs | laser cutting* QC › drilling QC › welding* QC › grinding* QC | yes: laser cutting |

## Pricing used (GST 18% unless said; rahul = CGST + SGST, sujeet = IGST)

| Order | Vendor | Line · step | Type | Amount |
|---|---|---|---|---|
| **A** | rahul | Fan Blade · laser cutting (6 pcs) | **Whole line** ₹90 | 90 + 16.20 |
| | | Fan Bush · cutting (2 pcs) | Per piece ₹25 | 50 + 9.00 |
| | | Chamber frame · laser cutting (2 pcs) | Per piece ₹30 | 60 + 10.80 |
| | | Charge: Packing | | 100 + 18.00 |
| | | **Total ₹354.00** · advance **20%** = ₹70.80 · above ₹300 → approval | | |
| **B** | rahul | Fan Bush · drilling (2 pcs) | **Per job work** ₹5 / hole × 4 holes | 40 + 7.20 = **₹47.20** |
| **C** | rahul | Chamber frame · welding · grinding (2 pcs) | welding **Per hour** ₹300; grinding **Per minute** ₹5 | time later |
| **D** | rahul | Fan · welding · grinding (1 unit) | welding Per piece ₹150; grinding **Whole line** ₹100 | 250 + 45 = **₹295** |
| **E** | sujeet | Fan · pre painting · post painting (1 unit) | Per piece ₹80 + ₹60 | 140 + 25.20 = **₹165.20** (IGST) |
| **F** | rahul | Chamber · welding · grinding (1 unit) | both **Per minute** ₹6 | time later; **flat advance ₹100** |
| **G** | sujeet | BP816 · pre painting · post painting (1 unit) | Per piece ₹500 + ₹300 | 800 + 144 = **₹944** (IGST) |
| **H** | sujeet | PRO001 · pre painting (1 unit) | **Whole line** ₹400 | 400 + 72 = **₹472** |

---

## Progress

| Round | What | Status |
|---|---|---|
| R0 | Clean data + setup | O0.1 done 2026-10-23 (backup in the scratchpad); O0.2 onwards: you |
| R1 | Automatic requests + Order A (approval, bill) | ✓ 2026-10-23 (OSO-0001 ₹354; fixes: "Paid before", material-not-ready warning §15) |
| R2 | Send A (Dispatch, Store handover) | ✓ 2026-10-23 (TRP-0001; L1 parked: sheets per line) |
| R3 | Bring A back, Store receive, per-step QC | ✓ 2026-10-23 (Fan Bush paid from its own cutting check; ₹354 fully accepted, due 7 Nov) |
| R4 | Second trips: B (per job work, vehicle waits), C (time-based, approval setting) | |
| R5 | Child Parts: Fan (D, E), Chamber (F, all time-based) | |
| R6 | Machines: BP816 (G), PRO001 (H) | |
| R7 | Money + wrap-up | |

---

## R0 — Clean data and setup

| # | Do | Where |
|---|---|---|
| O0.1 | **Clean the old test data** (I do it on the dev database, with your go-ahead): ORD-0125's machine / Child Part / Sub Child Part / job-work orders, their outsource orders, bills, trips and QC jobs; part stock 0 for Fan, Fan Blade, Fan Bush, Chamber, Chamber frame; ss sheet / C channel stock back to at least 2 catalog pieces | — |
| O0.2 | Restart the backend | — |
| O0.3 | **Fan Bush BOM → drilling → "Operations per piece": 4 · holes** | R&D → Sub Child Part Master → Fan Bush → Process |
| O0.3b | Try a count on an **In-House** step (e.g. Fan Blade drilling) | the field isn't shown on In-House; if you switch a step with a count to In-House, the count clears |
| O0.4 | Outsource order limit **₹300**; **"Approve time-based outsource orders" OFF** | Company Admin → Purchase Approvals → Settings |
| O0.5 | Grants: Dispatch **Vendor Pickups**, Store **Outsource Receive** (if not already) | Company Admin → roles |
| O0.6 | Vehicles: one **own** (e.g. UK07 AB 1234) and one **hired** (UK07AB1240) | Dispatch → Vehicles |
| O0.7 | **New sales order:** BP816 ×1 + PRO001 ×1, delivery date set on the Order Form | Sales |

---

## R1 — Automatic requests + Order A

| # | Check | Expected |
|---|---|---|
| O1.1 | Purchase → Outsource Work → **New requests** right after the order cascades | **Fan Blade** (laser cutting, 6 pcs), **Fan Bush** (cutting · drilling, 2 pcs, fully outsourced), **Chamber frame** (laser cutting, 2 pcs), **Fan** (welding · grinding, 1 unit), **Chamber** (welding · grinding, 1 unit). **No Production click** for Fan / Chamber (new). |
| O1.2 | Production → Process Execution → Fan | welding and grinding already show "Requested" (not a Send button) |
| O1.3 | Tick Fan Blade, Fan Bush, Chamber frame → Create Outsource Order → rahul | 3 lines; Fan Bush: click only **1. cutting** |
| O1.4 | Fan Blade price type **Whole line** ₹90 | the sum reads "whole line (6 pcs) ₹90" |
| O1.5 | Fan Bush cutting: open the type list | **Per job work is greyed out** ("no count in BOM") — cutting has no count |
| O1.6 | Fan Bush cutting Per piece ₹25; Chamber frame Per piece ₹30; GST 18 on each; Packing ₹100 (18%); advance **% of known 20**, credit 15 | totals **₹354.00** |
| O1.7 | Save | **Pending Approval**; the Approvals card: "above your ₹300 limit", steps "laser cutting ₹90 for the line", "cutting ₹25/pc" |
| O1.8 | Company Admin approves | Open (OSO-…). Requests: these 3 move to **In progress**; Fan and Chamber stay in New requests |
| O1.9 | Order detail | each step's basis ("6 pcs whole line ₹90", "2 pcs × ₹25 = ₹50"); material plan; "Waiting for Dispatch" |
| O1.10 | Bill | total **₹354**, advance **₹70.80** due, rows per step with the basis |
| O1.11 | Pay the advance ₹70.80 | Awaiting work |

## R2 — Send Order A

| # | Check | Expected |
|---|---|---|
| O2.1 | Dispatch → Vendor Pickups → To send → tick the 3 lines → New trip, hired truck, freight ₹400, challan CH-01 | trip planned; freight expense ₹400 |
| O2.2 | Store → Material Transfers → To Dispatch | **one card** for the order; pick sheets / C channel; **Hand over all** |
| O2.3 | Dispatch → **Delivered all** | trip Done; order **With vendor** |

## R3 — Bring A back, receive, per-step QC

| # | Check | Expected |
|---|---|---|
| O3.1 | Vendor says ready (any); new collect trip (own vehicle); Collected: Fan Blade 6, Fan Bush 2, Chamber frame 2 | trip Done |
| O3.2 | Store → **Outsource Receive** → To receive: all three; Fan Bush leftover back if any | received |
| O3.3 | **Fan Bush (job-work) — new per-step QC** | a **QC job for cutting** appears (starts **Pending** — QC presses Start inspection; the production orders' step QC jobs start **In Progress**); Purchase → In progress: Fan Bush "**In QC — cutting**"; Store → At Store: "2 pcs · In QC (cutting)" |
| O3.3b | **Fan Blade** (no QC on laser cutting) | no QC job; At Store at once: "QC passed — next: drilling (in-house)"; its ₹106.20 already accepted on the bill |
| O3.4 | Try to order Fan Bush drilling now | not in New requests (and refused if forced) |
| O3.5 | QC: Fan Bush cutting **Pass**; Chamber frame laser cutting Pass 2 | Fan Bush drilling appears in **New requests**; At Store: "2 pcs · next drilling is outsourced — stays at Store" |
| O3.6 | Order A bill | accepted: Fan Blade **₹106.20**, Fan Bush **₹59** (from its **own** cutting check — not waiting for drilling), Chamber frame **₹70.80** → **₹236 + Packing ₹118 = ₹354**; fully accepted → full payment due in 15 days |
| O3.7 | Store → At Store → Hand to Production: Fan Blade, Chamber frame | Production gives drilling to a team; Fan Blade drilling QC Pass 6 → **Fan Blade stock 6**; Chamber frame drilling QC Pass 2 |

## R4 — Second trips

**Order B — Fan Bush drilling, per job work, vehicle waits**

| # | Check | Expected |
|---|---|---|
| O4.1 | New order, rahul, Fan Bush drilling: type list shows **Per job work (4 holes/pc)** → ₹5 | sum "2 pcs × 4 holes × ₹5 = ₹40"; total **₹47.20**; under the limit → **Open** |
| O4.2 | Set the line's Expected back = today; New trip → the line's **"vehicle waits & brings it back" is pre-ticked** | trip planned |
| O4.3 | Store: To Dispatch shows "2 pcs Fan Bush (kept at Store)" → hand over; Dispatch → Delivered | the **same trip** gets "Collect … · the vehicle waited"; trip stays Out |
| O4.4 | Collect 2 on the same trip → Store receive | the **last** job-work receive: cost **₹90** (₹50 + ₹40) → QC (drilling) Pass → **Fan Bush stock 2**, Order B accepted ₹47.20 |

**Order C — Chamber frame welding · grinding, time-based, approval setting ON**

| # | Check | Expected |
|---|---|---|
| O4.5 | Company Admin: tick **"Approve time-based outsource orders"** | saved |
| O4.6 | Production: Chamber frame → **Send for Outsourcing** welding (+ grinding) | the dialog shows **no units** — "The whole batch goes: 2 pcs" (bug 2 fix) |
| O4.7 | New order, rahul, both steps: welding **Per hour** ₹300, grinding **Per minute** ₹5 | totals ₹0 + "time-based steps entered later"; advance: **only Flat** offered → ₹100 |
| O4.8 | Save | **Pending Approval** — card: "Has a per minute / per hour price — check the rate" (known ₹0, under the limit) |
| O4.9 | Admin approves; order detail | welding "₹300/h — time not entered yet" with **Enter time**; bill rows ₹0 "time not entered yet"; Orders list "+ time not entered"; advance ₹100 |
| O4.10 | Send (Dispatch / Store) → **while it's at the vendor**, Enter time welding **1 h 30 min** | welding ₹450; the bill row fills; admin **notified**; still "time not entered" for grinding |
| O4.11 | Bring back, Store receive, QC Pass welding + grinding 2 | **not payable yet** — "payable once the time is entered" |
| O4.12 | Enter time grinding **40 min** | grinding ₹200 → line **₹650 + ₹117 = ₹767**; acceptance applies at once; admin notified; advance stays ₹100 |
| O4.13 | Try **Edit time** on welding | "locked (work accepted)" |
| O4.14 | Chamber frame done → **Chamber frame stock 2**. Turn the approval setting **OFF** again | — |

## R5 — Child Parts

**Fan (auto-requested in R1)**

| # | Check | Expected |
|---|---|---|
| O5.0 | *(added 2026-10-23, §15)* **Before** Fan Blade / Fan Bush are in stock: Purchase → New requests → Fan | ⚠ "Material not ready: Fan Blade 0 / 6 (being made, ORD-…) · Fan Bush 0 / 2 (being made, SCJW-…)" |
| O5.0b | Order D now (below): the dialog shows the yellow box; Save stays off until **"I understand — order anyway"** is ticked | made; history "Ordered while material isn't ready". Vendor Pickups → To send: Fan "Waiting for material", no tick box. Once Fan Blade 6 + Fan Bush 2 are in stock (R3 / R4) it becomes sendable |
| O5.1 | Order D, rahul: Fan welding Per piece **₹150** + grinding **Whole line ₹100** | ₹295, Open |
| O5.2 | Store to Dispatch: Fan Blade 6 + Fan Bush 2 (parts from Store) → send → back → Store receive → QC welding, grinding Pass | **At Store**: next step coating is **in-house** → Hand to Production |
| O5.3 | Production: coating (QC) → then **Send for Outsourcing** pre painting · post painting (in-house → Out Source: Production sends — unchanged) | a request for pre painting · post painting |
| O5.4 | Order E, **sujeet** (IGST): ₹80 + ₹60 | **₹165.20**, IGST |
| O5.5 | Send → back → receive (last step, no QC) | **Fan stock 1** |

**Chamber (auto-requested in R1) — all time-based**

| # | Check | Expected |
|---|---|---|
| O5.6 | Order F, rahul: welding + grinding both **Per minute ₹6** | advance: **only Flat** → ₹100; under the limit, setting OFF → **Open** |
| O5.7 | Send (Chamber frame 2 from Store) → back → receive | not payable until the time |
| O5.8 | Enter time welding 25 min, grinding 15 min | ₹150 + ₹90 = ₹240 + ₹43.20 = **₹283.20**; admin notified |
| O5.9 | Production: coating › pre painting › post painting (in-house) | **Chamber stock 1** |

## R6 — Machines

| # | Check | Expected |
|---|---|---|
| O6.1 | BP816: assemble (Fan from Store) → QC → **Send for Outsourcing** pre painting · post painting | request (Production sends — in-house first) |
| O6.2 | Order G, sujeet: ₹500 + ₹300 per unit | **₹944**, above the limit → approval → Open |
| O6.3 | Send → back → receive → QC: pre painting, post painting (FINAL) | At Store → coating in-house → **BP816 complete** |
| O6.4 | PRO001: assemble (Chamber) → Send pre painting | Order H, sujeet, **Whole line ₹400** → **₹472** → back → post painting in-house FINAL → **complete** |

## R7 — Money and wrap-up

| # | Check | Expected |
|---|---|---|
| O7.1 | Vendor Payment → rahul | A (₹354, advance ₹70.80 paid), B ₹47.20, C ₹767 (advance ₹100), D ₹295, F ₹283.20 (advance ₹100) — pay one fully, one partly |
| O7.2 | Vendor Payment → sujeet | E ₹165.20, G ₹944, H ₹472 |
| O7.3 | Price help on a new order for the same parts | each step shows the last price **of its type** (₹90 line, ₹25/pc, ₹5/op, ₹300/h, ₹5/min…) |
| O7.4 | Store → Outsource Receive → **Received** | every receive with who / when / leftovers; search, dates, pages |
| O7.5 | Vendor Pickups → Trips → Done | every trip; search by OSO no.; freight expenses for the hired trips |

## R8 — Slice 4 (cost into the part), a 2-unit order, two orders of one part, Reservations (2026-10-24)

**Set up (done by you):**
- Fan Blade stock 18, Fan Bush stock 6
- sales orders **ORD-0127** (BP816 × 1) and **ORD-0128** (BP816 × 2)
- cascaded:
  - **BP816 PROD-2026-278970 (× 1) → Fan ORD-2026-087 (× 1)**
  - **BP816 PROD-2026-308866 (× 2) → Fan ORD-2026-088 (× 2)**

Fan's welding · grinding requested automatically on both.

**Settings:** ₹300 limit; "approve time-based" off.

**Before you start, note two numbers:**
- the Fan BOM's Total Cost (BOM Management → Child Part → Fan)
- BP816's cost / MRP on Pricing Value (now ₹6,784.08 / ₹8,140.90, profit 20%)

### Part A — Reservations right after creating the orders (procurement v2 §11, test plan T6)

| # | Where | Check | Expected |
|---|---|---|---|
| O8.1 | Store → **Reservations** | the Fan Blade row | stock **18** · reserved 18 · issued 0 · still to issue 18 · **free 0** |
| O8.2 | click Fan Blade | orders, earliest claim first | **ORD-2026-087: 6**, then **ORD-2026-088: 12** (Child Part, sales order shown) |
| O8.3 | Fan Bush · Bearing UCP208 | rows | Fan Bush 6 · 6 · free 0 (087: 2, 088: 4); Bearing 9 · 6 · **free 3** (087: 2, 088: 4) |
| O8.4 | **Fan** row | short? | reserved 3 by the two BP816 orders (1 + 2), stock 0 → red, **short by 3**, listed first |
| O8.5 | filters | search "ORD-2026-088"; type = Child Part; "Only short" | only matching rows; Only short shows Fan (and anything older that's short) |
| O8.6 | Nut Bolts / Tool-A drill-down | the new orders' lines | Nut: 087 6, 088 12, PROD-278970 10, PROD-308866 20 · Tool-A: 1, 2, 1, 2 (older orders may add more) |

### Part B — Welding · grinding: two orders on one line, 3 units

| # | Who | Do | Expected |
|---|---|---|---|
| O8.7 | Purchase | New requests: **two** Fan rows (087 · 1 unit, 088 · 2 units, welding · grinding) → tick **both** → Create Outsource Order | **one line**: "Fan · 3 units · for ORD-2026-087 (1), ORD-2026-088 (2)" |
| O8.8 | Purchase | rahul: welding **Per piece ₹150**, grinding **Whole line ₹120**, GST 18 + charge **Packing ₹30** (18%) | ₹450 + ₹120 = ₹570 + ₹102.60 + ₹30 + ₹5.40 = **₹708** → above ₹300 → **Pending Approval** |
| O8.9 | Company Admin | bell → approve | Open |
| O8.10 | Dispatch | To send | "From **Store**: **18** Fan Blade · **6** Fan Bush" (+ Tool-A, if welding takes it) — no Production row → New trip |
| O8.11 | Store | To Dispatch → hand over | done |
| O8.12 | **Reservations** | Fan Blade / Fan Bush | stock **0** · issued 18 / 6 · still to issue 0 · **free 0 (not −18)**; drill-down issued **087: 6 · 088: 12** (Fan Bush 2 · 4) — one combined handover, booked per order |
| O8.13 | Dispatch → Store | Delivered → collect **3** → Store receive (2 entries: 087 × 1, 088 × 2) | no "unused" boxes; QC jobs for welding / grinding per unit |
| O8.14 | QC Head | ORD-2026-087 unit 1; ORD-2026-088 units 1 and 2: welding **Pass**, grinding **Pass** | bill: 3 units accepted |
| O8.15 | Store → Production | At Store → hand each unit to Production | coating can start |

### Part C — Coating: Production's own cost, per unit

| # | Who | Do | Expected |
|---|---|---|---|
| O8.16 | Production | ORD-2026-087 unit 1: material request (Bearing 2, Nut 6, …) → Store transfers | **Reservations:** Bearing issued 2, stock 9 → 7, **free stays 3**; ORD-2026-087 issued 2 |
| O8.17 | Production | coating → **Submit to QC — Unit 1** | the cost dialog says "**last in-house step for this unit** — the outsourced steps after it are added automatically" → enter **₹100 + ₹20** |
| O8.18 | Production | ORD-2026-088 units 1 and 2 (material first) | unit 1 **₹90 + ₹15**, unit 2 **₹80 + ₹10**; each unit asked once; the "Build cost — Unit n" line shows it |
| O8.19 | QC Head | coating **Pass** on all three units | — |
| O8.20 | BOM Management → Fan | the tiles | **nothing pushed yet** (pre / post painting still to come) |

### Part D — Pre / post painting: the last steps outsourced, a time-based step

| # | Who | Do | Expected |
|---|---|---|---|
| O8.21 | Production | **Send for Outsourcing** pre · post painting: ORD-2026-087 unit 1; ORD-2026-088 units 1 + 2 | two requests in New requests |
| O8.22 | Purchase | tick both → **one line, 3 units** → sujeet: pre **Per piece ₹60**, post **Per minute ₹2**, GST 18 | ₹180 known + "time later" → ₹212.40 → **Open** |
| O8.23 | Dispatch | To send | "From **Production** (ORD-2026-087): 1 units Fan" and "(ORD-2026-088): 2 units Fan" → trip → Production hands over both → Delivered → collect 3 |
| O8.24 | Store | receive **ORD-2026-087 first**, then **ORD-2026-088** | no QC on these steps → the units finish: **Fan stock 3**; Production's "Build cost" line: job work so far, waiting for the time |
| O8.25 | BOM → Fan | the tiles | **Job Work (outsource) ₹200** (₹150 + ₹40 grinding share + ₹10 packing share) — "**Waiting for the time on OSO-…**"; Production cost **₹80 + ₹10** — "From ORD-2026-088 unit 2" (the latest build) |
| O8.26 | Purchase | the order → post painting → **Enter time 30 min** | ₹60 → line ₹240 (₹80 / unit) |
| O8.27 | BOM → Fan | the tiles | **Job Work ₹280** (₹200 + ₹80), the waiting note gone, still "From ORD-2026-088 unit 2" |
| O8.28 | Pricing Value | BP816 | its cost moved by exactly the Fan's change (BP816 uses 1 Fan); MRP by that × 1.2 — **without opening any BOM page** |
| O8.29 | **Reservations** | Fan Blade / Fan Bush / Bearing / Nut | ORD-2026-087 / 088 lines **gone** (orders completed); Fan row: stock 3 · reserved 3 (BP816 orders) · **free 0** |

### Part E — BP816 × 2 (optional, the Machine level)

| # | Who | Do | Expected |
|---|---|---|---|
| O8.30 | Production | PROD-2026-308866: issue the Fans (Reservations: Fan issued 2 to it) → **assemble** units 1 and 2 → QC | **no cost asked at assemble** (coating, in-house, comes later) |
| O8.31 | Production → Purchase | Send pre · post painting (both units) → sujeet: pre **₹500/pc** (QC), post **₹300/pc** | ₹1,600 + ₹288 = ₹1,888 → approval → Open |
| O8.32 | Dispatch → Store → QC | From Production 2 units → out → back → pre painting Pass | — |
| O8.33 | Store → Production | hand over → **coating** → Submit to QC: unit 1 **₹400 + ₹50**, unit 2 **₹300 + ₹40** → QC Pass | asked at coating (the true last step) |
| O8.34 | BOM → BP816 | the tiles | **Job Work ₹800** (₹500 + ₹300); Production **₹300 + ₹40** (unit 2, the latest); Total Cost = Fan line + Nut 10 + Tool-A 1 + ₹800 + ₹340 |
| O8.35 | Pricing Value | BP816 | cost = that total, MRP × 1.2 |

---

## If something goes wrong

Note the O-number, what you did, and what you saw (a screenshot helps). Keep going with the next
check if it doesn't depend on the broken one.
