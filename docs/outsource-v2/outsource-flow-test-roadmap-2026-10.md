# Outsource flow — browser test roadmap (ORD-0125, 2026-10-21)

> **Superseded 2026-10-23** by `outsource-flow-test-roadmap-v2-2026-10.md` (tested here to R4;
> the client's changes — automatic requests, pricing types — need a fresh test).

**Why this exists:** outsource-v2 slices 1–3 and 5–8 are built and unit-tested (179 tests), but
none has been checked in the browser. This doc says **which order, which step, which vendor,
which price, and what you should see**, so every part of the flow gets used once, in the order
the work really happens.

**Tick the O-numbers** as they pass; note anything odd next to them (like the purchase-flow
roadmap).

---

## What's prepared (2026-10-21)

**One sales order, ORD-0125 (test-1 company):** BP816 Blower Pulverizer ×1 + PRO001 Aata machine
×1, due **30 Oct** (from the Order Form). It cascaded:

| Order | Part | Qty | Steps (* = Out Source, QC = QC step) | Status now |
|---|---|---|---|---|
| PROD-2026-061251 | **BP816** (machine) | 1 | assemble QC › pre painting* QC › post painting* FINAL › coating QC | waits for Fan |
| PROD-2026-071950 | **PRO001** (machine) | 1 | assemble › pre painting* › post painting FINAL | waits for Chamber |
| ORD-2026-083 | **Fan** (Child Part) | 1 unit | welding* QC › grinding* QC › coating QC › pre painting* › post painting* | waits for Fan Blade ×6 + Fan Bush ×2 |
| ORD-2026-085 | **Chamber** (Child Part) | 1 unit | welding* › grinding* › coating › pre painting › post painting QC | waits for Chamber frame ×2 |
| ORD-2026-084 | **Fan Blade** (hybrid) | 6 pcs | laser cutting* › drilling QC | **request in Purchase** |
| SCJW-2026-002 | **Fan Bush** (job-work) | 2 pcs | cutting* › drilling* (QC once at the end) | **request in Purchase** |
| ORD-2026-086 | **Chamber frame** (hybrid) | 2 pcs | laser cutting* QC › drilling QC › welding* QC › grinding* QC | **request in Purchase** |

**Material each Sub Child Part needs from Store** (the plan works this out):

| Part | Source | Per piece | Order needs | Whole pieces |
|---|---|---|---|---|
| Fan Blade | ss sheet 1.5 × 1250 × 2550 | 20 cm² | 120 cm² | 1 sheet (Sheet Plan: 1 sheet / 20 pcs) |
| Fan Bush | ss sheet (same) | 60 cm² | 120 cm² | 1 sheet (Sheet Plan) |
| Chamber frame | C channel 100 × 50 × 5 × 6000 | 2 inch (50.8 mm) | 101.6 mm | 1 length (stock 1) |

**Also done:**
- old outsource requests cleaned
- part stock 0 and min stock 0 for Fan / Fan Blade / Fan Bush
- backup in the scratchpad (`outsource-clean-backup-2026-10-21.json`)
- the delivery-date fix

**Not covered by this data** (covered by the automated tests only):
- **two orders of the same part on one line** (combined sheets shared 1.333 / 0.667). Optional
  round R9 adds a second BP816.
- **length cut to size at Child Part / Machine level**

**Known gap:** QC **rework of an outsourced Child Part / Machine unit** has no resend path (see
the note under R7). Only Sub Child Part batches can be reworked.

---

## Progress

| Round | What | Status |
|---|---|---|
| R0 | Setup | ✓ 2026-10-21 |
| R1 | Requests + Outsource Order A (3 Sub Child Parts) + approval + bill | ✓ 2026-10-21: OSO-0001 = **₹336** (Packing entered with no GST), advance **₹67.20** paid. Fixes on the way: price per step (§8), no transport charges (§9), line GST % not pre-filled, Requests split into New requests / In progress. |
| R2 | Dispatch trip 1: send A (Store hands over sheet / length) | ✓ 2026-10-21: TRP-0001 on the hired truck (freight ₹400); Fan Blade from the 600 × 600 offcut (kept 600 × 500), Fan Bush whole sheet, Chamber frame kept 5898 mm. Added on the way: To Dispatch grouped by order, Store's own Outsource Receive page (§10), "Delivered all" on a trip, Expenses permission fix. |
| R3 | Return trip 2: vendor ready, collect, short, Store receive, QC, Hand to Production | |
| R4 | Second trips: Fan Bush drilling (from Store), Chamber frame welding → grinding (Store hold; optional batch rework at ₹0) | |
| R5 | Money for A–D: advance, payable as QC passes, full payment, ledger | |
| R6 | Child Parts: Fan (parts from Store) and Chamber (Production first) | |
| R7 | Machines: painting outsourced (incl. an outsourced FINAL QC step) | |
| R8 | Wrap-up: dashboards, expenses, history | |
| R9 | Optional: second BP816 → two Fan Blade orders combined | |

---

## R0 — Set up once

| # | Do | Where |
|---|---|---|
| O0.1 | **Restart the backend** (slice 5–8 code and today's fixes) | — |
| O0.2 | **Grant "Vendor Pickups"** (view / add / edit) to the Dispatch roles | Company Admin → roles / permissions → Dispatches |
| O0.3 | **Vendor Services:** rahul vendor = laser cutting, cutting, drilling, welding, grinding, pre painting, post painting. **sujeet** = grinding, pre painting, post painting. For the IGST check (O4.11) give sujeet an out-of-state address (e.g. state Uttar Pradesh), or switch the GST type by hand on that order. | Vendor Master |
| O0.4 | **ss sheet stock:** at least **2** catalog sheets (1250 × 2550), e.g. via a PO + receive, or an inventory adjustment. Keep the 600 × 600 offcut: R2 uses it. | Store |
| O0.5 | **Outsource order limit ₹300** | Company Admin → Purchase Approvals → Settings |
| O0.5b | **Charge names** (added 2026-10-21): tick **Transport** on Freight (and any transport-type name); add **Packing**, 18% | Purchase → Settings → Charges |
| O0.6 | **Vehicle:** add one regular **own** tempo (e.g. UK07 AB 1234, driver Ramesh) | Dispatch → Vehicles |
| O0.7 | **Bank / cash account** with ≥ ₹5,000 for test-1 | Accounts → Bank & Cash |
| O0.8 | **Optional:** one PO with **"We pick up"** for rahul (any small item), to test a PO pickup on the same trip | Purchase |

**Log-ins:**

| Who | Used for |
|---|---|
| Account Employee | Purchase: Outsource Orders, vendor ready |
| Company Admin | approval, settings |
| dispatch head | trips, collect, delivered |
| store head | Material Transfers → To Dispatch; **Outsource Receive** (To receive / At Store / Received) |
| Production Head | send for outsourcing, hand over, in-house steps |
| QC Head | QC decisions |
| Accounts Head | Vendor Payment |

---

## R1 — Requests and Outsource Order A (slices 1, 2, 3, 5)

Accounts → Purchases → Purchase & Outsource → **Out Source Work → Requests**.

| # | Check | Expected |
|---|---|---|
| O1.1 | The list | 3 requests, all **Ready to order**: Fan Bush (SCJW-2026-002, *fully outsourced*, cutting · drilling, 2 pcs), Fan Blade (ORD-2026-084, laser cutting, 6 pcs), Chamber frame (ORD-2026-086, laser cutting · drilling · welding · grinding, 2 pcs) |
| O1.2 | **Arrival unchanged** (slice 1) | Fan Bush appears **only** in Purchase (not in Production's Sub Child Part tab). Fan Blade and Chamber frame show in Production with step 0 at Purchase. Production can't **Issue** their sheet / C channel (Material List: "goes to the vendor"). |
| O1.3 | Vendor filter = sujeet | nothing (none of these starts with grinding / painting) |
| O1.4 | Tick all 3 → **Create Outsource Order** → vendor **rahul vendor** | 3 lines, each 1 step: Fan Blade *laser cutting*, Fan Bush *cutting* (step count **1**, not 2), Chamber frame *laser cutting* |
| O1.4c | *No transport charges (2026-10-21):* open the Charges picker | Freight / any Transport-ticked name is **not offered**; the note says Dispatch arranges transport. (The server refuses one too.) |
| O1.4b | *Per-step prices (added 2026-10-21):* on Fan Bush click **2. drilling** → two price rows (cutting, drilling), each with its own price help, and "Together: ₹…". Then click **1. cutting** again. | one price row per chosen step; the line total uses their sum |

**Prices (GST 18%):**

| Line | Qty | Rate | Amount | GST |
|---|---|---|---|---|
| Fan Blade · laser cutting | 6 | ₹15 | 90 | 16.20 |
| Fan Bush · cutting | 2 | ₹25 | 50 | 9.00 |
| Chamber frame · laser cutting | 2 | ₹30 | 60 | 10.80 |
| Charge: **Packing** (the vendor packs the cut pieces) | | | 100 | 18.00 |

**Terms:** advance 20%, credit 15 days.

| # | Check | Expected |
|---|---|---|
| O1.5 | Totals | CGST + SGST (Uttarakhand ↔ Uttarakhand); grand total **₹354.00** |
| O1.6 | Save | **Pending Approval** (above ₹300). The Company Admin sees it in Purchase Approvals → Outsource Orders and approves → **Open** (OSO-0001). |
| O1.7 | Order detail → material plan (slice 5) | Fan Blade: ss sheet 0.012 m² from Store, **1 sheet (Sheet Plan)**. Fan Bush: 0.012 m², 1 sheet. Chamber frame: 0.1016 m from Store, 1 length. "Waiting for Dispatch to plan a trip". **No Mark sent / Receive buttons** (slice 8). |
| O1.8 | Bill (slice 3) | Bill panel: total **₹354**, advance **₹70.80** due, Advance due. Vendor Payment shows it with the **Outsource** badge. |
| O1.9 | Pay the advance ₹70.80 (bank) | Awaiting work. Cancel the order → **refused** (advance paid). |

---

## R2 — Dispatch trip 1: send Order A (slice 6)

Dispatch → **Vendor Pickups**.

| # | Check | Expected |
|---|---|---|
| O2.1 | Outsource → **To send** | rahul vendor with 3 lines, each with what Store gives ("1 sheet ss sheet", "1 length C channel"). Plus the "We pick up" PO if you made one (Purchase tab). |
| O2.2 | Tick the 3 lines (+ the PO) → **New trip** with the regular tempo, today, challan **CH-01** | trip **TRP-0001** Planned; own vehicle → no freight asked. The Outsource Order shows "On Dispatch trip TRP-0001". |
| O2.3 | Store → Material Transfers → **To Dispatch (Outsource)** | 3 jobs |
| O2.4 | **Fan Blade:** pick the **600 × 600 offcut** (0.36 m² ≥ 0.012 m²) instead of the catalog sheet; record a kept offcut, e.g. 600 × 500, 1 pc | accepted; offcut 1 → 0; a new 600 × 500 leftover +1 |
| O2.5 | **Fan Bush:** pick 0 catalog sheets → refused ("covers 0 m²…"); then **1 catalog sheet**, **no kept offcut**, so the whole sheet goes to the vendor (the leftover is recorded when it comes back, O3.9) | ss sheet catalog −1 |
| O2.6 | **Chamber frame:** 1 catalog C channel, kept offcut **5898 mm**, 1 pc | C channel (5 mm) 1 → 0; a 5898 mm leftover +1 |
| O2.7 | Each job → **Delivered to vendor** (Dispatch) | Requests **Sent**. Order A **With vendor**. History: "delivered by Dispatch (TRP-0001)". Picked up the PO, if any. Trip **Done**. |

---

## R3 — Return trip 2: collect, receive, QC (slice 7)

| # | Check | Expected |
|---|---|---|
| O3.1 | Purchase: Order A → Fan Blade → **Vendor says ready**. Dispatch: Chamber frame → Vendor says ready. | both marked; Vendor Pickups → **To collect** lists them first |
| O3.2 | New trip **TRP-0002** with a **one-time hired** pickup (UK07 CD 9876, Sharma Transport), freight **₹500**, cash, **save as regular** | trip made; Dispatch Expenses has **Transporting Cost ₹500** for TRP-0002; Vehicles now lists UK07CD9876 |
| O3.3 | Collect **Fan Blade = 5** | refused ("5 counted, but 6 sent") |
| O3.4 | **Report short:** 5, note "1 missing" | Purchase gets "Outsource work short". Fan Blade leaves TRP-0002 and waits in To collect, "short last time: 5 back". |
| O3.5 | Collect Chamber frame **2** and Fan Bush **2** | both collected. TRP-0002 **Done** (all collected or short). |
| O3.6 | Trip **TRP-0003**, own tempo → collect Fan Blade **6** | collected |
| O3.7 | Store → **Outsource Receive** → To receive (the Company Admin must first tick Store → **Outsource Receive** for the store head role): Fan Blade count **6** (no leftover back: it went out on a 600 × 100 strip after Store kept 600 × 500) | received. Laser cutting had no QC, so it's Completed. **At Store:** Fan Blade batch "QC passed — next drilling (in-house)". Production can't give drilling to a team yet. |
| O3.8 | Chamber frame count **1** | refused (Dispatch collected 2). Then 2 → laser cutting **QC Pending**. At Store: "In QC". |
| O3.9 | Fan Bush **2**, and under "Leftover back from the vendor": ss sheet offcut **1250 × 2400, 1 pc** (the rest of the whole sheet sent in O2.5) | received. Job-work round 1: the pieces wait at Store; nothing goes to QC yet (job-work QC is at the end). ss sheet gets a **1250 × 2400** leftover +1; the order's history says "Back from the vendor into stock". |
| O3.10 | QC Head: Chamber frame laser cutting **Pass 2** | At Store → ready (next drilling, in-house) |
| O3.11 | Store → **Hand to Production**: Fan Blade batch + Chamber frame batch | gone from At Store. Production can now give **drilling** to a team. |
| O3.12 | Production: Fan Blade drilling (QC Pass 6) | Fan Blade order complete, **Fan Blade stock 6** |
| O3.13 | Production: Chamber frame drilling (QC Pass 2) | next step welding (Out Source) |
| O3.13b | Store → Outsource Receive → **Received** (added 2026-10-21) | 3 rows, newest first: Fan Blade (collected 6, counted 6, + the 600 × 300 offcut if entered), Chamber frame (2 / 2, None), Fan Bush (2 / 2, **ss sheet offcut 1250 × 2400**). Each shows who received it and the trip (TRP-0002 / TRP-0003). Search "Fan" → 2 rows. |

**Bill check after R3:**

| # | Check | Expected |
|---|---|---|
| O3.14 | Fan Blade received | accepted **₹106.20**; payable now **₹84.96** (106.20 less its 20% advance share) |
| O3.15 | Chamber frame QC passed | accepted +₹70.80 = **₹177.00** |

---

## R4 — Second trips: from Store, and work waiting at Store

**Fan Bush round 2 (job-work, pieces at Store):**

| # | Check | Expected |
|---|---|---|
| O4.1 | Requests: Fan Bush shows **drilling** left, ready | — |
| O4.2 | Order **B** at rahul: drilling 2 × **₹20** + 18% = **₹47.20** | Open at once (under ₹300) |
| O4.3 | Plan | Fan Bush pieces **from Store** (no raw material) |
| O4.4 | **Vehicle waits & brings it back** (added 2026-10-21): Order B → set the line's *Expected back* to the trip date. New trip → the line's tick **"the vehicle waits & brings it back" is pre-ticked**; keep it. Store's To Dispatch shows "2 pcs Fan Bush (…, kept at Store)" → hand over → **Delivered** | the trip card shows "↩ the vehicle waits & brings it back". After Delivered, the **same trip** gets "Collect OSO-… · Fan Bush · the vehicle waited", and the trip stays **Out**. Fan Bush is **not** in To collect. No second freight. |
| O4.4b | On that collect: **Not ready — collect later** | it leaves the trip, Fan Bush shows in **To collect**, and the trip goes **Done**. Then on the delivered Fan Bush line: **Bring back on this trip** → the trip is **Out** again with the collect job. |
| O4.5 | Collect 2 (on the same trip) → Store receive 2 | **final** job-work receive: no cost asked. Cost = **₹90** (2 × 25 + 2 × 20, from Orders A and B). Job-work → **Pending QC**. |
| O4.6 | QC Pass | Fan Bush stock **2**, part cost **₹45** each. Order A's bill: Fan Bush accepted. **A is fully accepted** (O5.3). |

**Chamber frame welding → grinding (Production sends it; Store holds between):**

| # | Check | Expected |
|---|---|---|
| O4.7 | Production: Chamber frame → **Send for Outsourcing** welding › grinding | a new request in Purchase (welding · grinding) |
| O4.8 | Order **C** at rahul: welding only (step count 1), 2 × ₹35 = **₹82.60** | plan: the 2 pieces **from Production** |
| O4.9 | Trip → **Production hands over** (Process Execution "To hand over to Dispatch" card) → Delivered | "Delivered" is refused until Production hands over |
| O4.10 | Collect → Store receive → QC welding Pass | At Store: "Next step grinding is outsourced — stays at Store". Hand to Production → **refused**. |
| O4.R | *Optional rework (a batch, R2 + D6):* in O4.10 decide **Pass 1, Rework 1** instead | At Store: "QC rework — goes out again from Store". Purchase: "QC rework — Production resends it". Production resends welding for 1 pc → Order at **₹0** (free redo) → plan **from Store** → send → receive → QC Pass → then continue with O4.11 (grinding for both). If anything here looks wrong, note it and continue with plain Pass instead. |
| O4.11 | Order **D** at **sujeet**: grinding 2 × ₹20 | ₹47.20. **IGST** if sujeet's address is out of state (O0.3); with no GSTIN / state the order shows CGST + SGST and lets you switch. Vendor filter sujeet now shows Chamber frame. Plan: the pieces **from Store**. |
| O4.12 | Trip → Store's handover releases them (At Store empty) → Delivered → collect → Store receive → QC Pass | last step: **Chamber frame stock 2** |

---

## R5 — Money (slice 3)

| # | Check | Expected |
|---|---|---|
| O5.1 | Vendor Payment: Order A | paid ₹70.80 advance. After all its QC: accepted **₹236.00** (106.20 + 59.00 + 70.80). |
| O5.2 | Pay part of the work (e.g. ₹100) | Dr Accounts Payable / Cr Bank. Paying more than payable now → **refused**. |
| O5.3 | Order A fully accepted | **charges ₹118 posted** (100 + 18); advance set off; due **15 days** from acceptance; Accounts notified |
| O5.4 | Pay the rest | Order A total ₹354 = advance 70.80 + payments → **Paid**; Accounts Payable for it 0 |
| O5.5 | Ledger: Job Work Charges | A = 300 (200 work + 100 Packing); input GST A = 54 (36 + 18); C (welding) 70 + 12.60; D 40 + **7.20** (IGST if set so in O4.11) |
| O5.6 | Purchase Invoices → filter **Outsource bills** | A–D as "Outsource bill — OSO-…"; due "after QC" until accepted |
| O5.7 | **One ordinary PO bill:** pay it as before | works unchanged (`payBill` was changed in slice 3) |

---

## R6 — Child Parts: Fan (parts from Store) and Chamber (Production first)

**Fan** (needs Fan Blade 6 + Fan Bush 2, now in stock):

| # | Check | Expected |
|---|---|---|
| O6.1 | Production: Fan → **Send for Outsourcing** welding › grinding (unit 1) | request in Purchase |
| O6.2 | Production's Material List | after Order E is made: Fan Blade / Fan Bush say "goes to the vendor (OSO-…)"; Issue limited to 0 |
| O6.3 | Order **E** at rahul: welding 1 unit × ₹200 | plan: Fan Blade 6 + Fan Bush 2 **from Store** (Production holds none) |
| O6.4 | Trip → Store hands over the parts (items: Fan Blade 6 → stock 0, Fan Bush 2 → 0) → Delivered | Fan's welding: the first send is real (no dummy) |
| O6.5 | Collect → receive → QC welding Pass → At Store | "next grinding outsourced, stays at Store" |
| O6.6 | Order **F** (grinding, rahul or sujeet) | plan: the unit **from Store** + Tool-A ×1 from Store. Send → receive → QC Pass. At Store: ready (next coating, in-house) → **Hand to Production**. |
| O6.7 | Production: coating | Issue NUT Bolts 6 + Bairing 2 first. The step's material check shows them; QC Pass. |
| O6.8 | Production: Send for Outsourcing pre painting › post painting → Order **G** (1 step or both) | plan: the unit **from Production** (Production hands over); no QC → accepted on receive. Last step → **Fan stock 1**. |

**Chamber** (needs Chamber frame 2):

| # | Check | Expected |
|---|---|---|
| O6.9 | **Production first (M1):** before ordering, Production **Issues** Chamber frame ×2 from its Material List, and Store transfers it (it can stay in transit) | — |
| O6.10 | Production: Send for Outsourcing welding › grinding → Order **H** (welding) | plan: Chamber frame 2 **from Production** (in transit counts, M4); Store part 0 |
| O6.11 | Trip → **Production hands over** → Delivered → collect → Store receive | welding has no QC → completed at once. At Store: next grinding outsourced, stays. |
| O6.12 | Order **I** (grinding) | from Store → … → receive (no QC) → ready (next coating, in-house) → Hand to Production |
| O6.13 | Production: coating, pre painting, post painting (QC) | **Chamber stock 1** |

---

## R7 — Machines: outsourced painting, and a rework at ₹0

**BP816:**

| # | Check | Expected |
|---|---|---|
| O7.1 | Production: Issue Fan + NUT Bolts 10 + Tool-A 1; assemble (QC Pass) | — |
| O7.2 | Send for Outsourcing pre painting › post painting → Order **J** at sujeet, pre painting only | plan: the machine **from Production** |
| O7.3 | Send → receive → QC pre painting **Pass** | At Store: next post painting is outsourced, so it stays |
| O7.4 | Order **K** post painting (FINAL) → send (**from Store**) → receive | goes to the **Final QC** (a FINAL step is a QC step) → Pass |
| O7.5 | At Store: ready (next coating, in-house) → Hand to Production → coating QC Pass | machine complete → sale side |

> **Don't Reject an outsourced Child Part / Machine unit in this test.** A unit's QC offers only
> Pass / Reject. A Reject leaves the step "In Progress" with no way to send that unit out again,
> so it would sit At Store as "In QC". This is a known gap (rework / D6 for units isn't built);
> only a Sub Child Part batch has a real rework (O4.R). The bill side works: a rejected unit is
> taken off the bill.

**PRO001:**

| # | Check | Expected |
|---|---|---|
| O7.8 | Issue Chamber; assemble | — |
| O7.9 | pre painting → Order **M** (no QC) → send → receive | completed at once → ready (next post painting, in-house) → Hand to Production |
| O7.10 | post painting: Issue NUT Bolts 5 + Tool-A 1 → Final QC Pass | complete |

---

## R8 — Wrap-up

| # | Check | Expected |
|---|---|---|
| O8.1 | Purchase Dashboard | purchase value **doesn't** include outsource bills; payables do |
| O8.2 | Dispatch Expenses | TRP-0002 freight ₹500 |
| O8.3 | Vendor Pickups → Trips (Done) | every trip with its handovers, who and when |
| O8.4 | Each Outsource Order's history | created → approved → on trip → delivered by Dispatch → collected → received by Store → accepted → paid |
| O8.5 | Production orders | all 7 complete; no unit left At Store |

---

## R9 — Optional: two orders on one line (combined sheets)

1. Set **Fan Blade stock 0**, then make one more sales order with **2 × BP816**.
   - Expect Fan (2) → Fan Blade 12. The R1 numbers come back from the earlier order only if run
     again.
   - The point: **two Fan Blade requests** of different orders.
2. Put both Fan Blade requests on **one line** → the plan shows **one combined sheet run**: pieces
   from the Sheet Plan (1 sheet / 20 pcs × 18 pcs → 1), each order's share by area.

---

## If something goes wrong

- **Note the O-number and the screen.** Server errors show in the backend console.
- **A cascade that doesn't raise a Child Part order** now logs why: `[MachineCascade] … —
  not-released`, etc.
- **The backup** of what was cleaned is in the scratchpad.
