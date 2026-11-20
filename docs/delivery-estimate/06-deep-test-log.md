# Delivery estimate: deep test log

*The plan: [05-deep-test-plan.md](05-deep-test-plan.md). Each run gets its expected result worked out by hand **before** it runs.*

## Round 0: the fresh start (19 Nov)
**The reset:**
- Run on test-1 after a dry run, which showed exactly what would change. Your go-ahead: run it, with the sweeps off.
- Backup: `D:\cs\db-backups\test-1-reset-2026-11-19\`, 40 files (each collection's deleted records, each changed record as it was, and the balance changes).

| What | Result |
|---|---|
| Deleted | 1,061 records, matching the dry run collection by collection. The main ones: 110 production orders, 59 open customer orders (43 order forms, 56 sales), 46 reservations, 40 outsource orders, 90 QC jobs, 322 material logs, 66 postings, 46 dispatch trips, 28 purchase requests, 2 open POs |
| Kept, link cleared | 118 records: delivered orders' packing and dispatch, received POs, quote groups (8 left empty became Cancelled), lunch overrides, freight expenses, warranty claims, 3 sold or rejected serial units |
| Money | 66 postings reversed. All 9 accounts landed exactly as planned (e.g. Job Work Charges ₹9,630 → ₹0; SBI −₹13,420.94 net) |
| Stock | 0 on every item and every fabrication size. No serial unit left in Stock |
| Sweeps | Off on the 18 watched items. **Put them back after the test** from `changed-before.items.json` (materialFlow fields). *(19 Nov, B5: the two part sweeps are off too. Put minStock back from `b5.changed-before.items.json`)* |
| Second dry run | Nothing left to delete, no money left to reverse, no link left pointing at a deleted record |

**Empty check:** 0 production orders, reservations, step runs, crew entries, outsource orders, job-work orders, open customer orders, open purchase requests and open POs.

**The estimate on empty data:** all four test items say **can't estimate yet** and name what's missing. That's right: there's no history and nothing typed.

| Item | Says missing |
|---|---|
| Aata machine (PRO001) | 14: usual hours for 6 in-house steps (drilling, coating, pre and post painting, assemble…) and usual days for 8 job-work steps, across Chamber frame, Motor Mount, Chamber and the machine |
| Blower Pulverizer (BP816) | 13: across Fan Blade, Fan Bush, Fan and the machine |
| purchase mahine test (PMT) | never bought, no quote, no lead time |
| Motor A (MTR-001) | never bought, no quote, no lead time |

## Round 1: typed numbers (19 Nov)
**Step 1 (browser):** passed. "Can't estimate yet" lists all 14 missing step hours and job-work days for the Aata machine.

**Step 2 (browser), R&D's numbers:** all saved, checked in the database.

| Part | Hours per piece | Usual people |
|---|---|---|
| Aata machine | assemble 4 · post painting 2 | 2 |
| Chamber | coating 3 · pre painting 1 · post painting 1 | 2 |
| Chamber frame | drilling 0.5 | 1 |
| Motor Mount | grinding 0.5 | 1 |

Job work: laser cutting 2 · welding 2 · grinding 1 · pre painting 2 days.
- **The machine's BOM went back for R&D approval** ("process steps changed", 11:08). The cause: pre painting's "Includes the assembled part built so far" was unticked while typing. That's a real step change, so it's right. The estimate shows the amber BOM warning, which checks §11 change 7 live.
- **Two problems found here, both fixed (B1, B2 below).** After the fixes the estimate says attendance "not measured yet: 100%". It needs lead times for **C channel, Test Motor and Test Sensor** (under 3 receipts each). NUT Bolts (3 receipts) and Tool-A (6) keep their history, from dev tests: about 2 days and 1 day.

**Step 3 (browser), Purchase's numbers:** passed.
- Days to buy: Test Motor 5, C channel 3, Test Sensor 4. Cost and its label unchanged (checked against the reset backup).
- History shown: NUT Bolts 2 days (3 receipts), Tool-A 1 day (6), matching the hand working (middle receipt 1.32 → 2, and 0.28 → 1).
- Job Work Time shows all the processes with the right "used by". R&D's box is gone.

### Run 1: Aata machine × 1, worked by hand BEFORE pressing Estimate (19 Nov)
**Inputs:**
- **Today and people:** Thu 19 Nov; Sundays off, no holidays. 6 Production people, 9 h a day each, all 100% (under 20 recorded days). Nothing in hand; free stock 0 everywhere.
- **Buying** (all raised today): Tool-A 1 day → Fri 20 · NUT Bolts 2 → Sat 21 · C channel 3 → Sun 22, so usable Mon 23 · Test Sensor 4 → Mon 23 · Test Motor 5 → Tue 24.
- **QC:** no history, so a QC is decided by the end of the day it's ready, and the next step starts the next working morning.
- **Job work in a row = one trip** (the longer days): Chamber frame's welding + grinding = 2 days; the Chamber's welding + grinding = 2 days.
- **Skills:**
  - post painting: only Test Worker Four
  - assemble: Rahul, Test Worker Two, Test Worker Five
  - coating / pre painting: Test Production Employee and Rahul (and others)

**The plan:**

| Day | What happens |
|---|---|
| Mon 23 Nov | C channel in → **Chamber frame laser cutting** goes out (2 days) |
| Tue 24 | Test Motor in → **Motor Mount welding** goes out (2 days) |
| Wed 25 | Laser cutting back; QC by the end of the day |
| Thu 26 | Chamber frame **drilling** (2 pieces × 0.5 h = 1 h, 1 person); QC. Motor Mount welding back; QC |
| Fri 27 | Chamber frame **welding + grinding** out in one trip (2 days → Sun 29, so back Mon 30). Motor Mount **grinding** 0.5 h; QC → Motor Mount ready Sat 28 |
| Mon 30 | Chamber frame back; QC by the end of the day |
| Tue 1 Dec | Chamber frames ready → **Chamber welding + grinding** out in one trip (2 days → Thu 3) |
| Thu 3 | Back; QC by the end of the day |
| Fri 4 | Chamber **coating** 3 h ÷ 2 people = 1.5 h → **pre painting** 1 h ÷ 2 = 0.5 h → **post painting** 1 h (Test Worker Four alone); QC |
| Sat 5 | Chamber ready → Aata **assemble** 4 h ÷ 2 people = 2 h → **pre painting** out (2 days → Mon 7) |
| Mon 7 | Back → **post painting** 2 h (Test Worker Four alone) → final QC by the end of the day |
| Tue 8 | Ready → packing |
| **Wed 9 Dec** | **Dispatch** |

**Expected:**
- **Likely:** Wed 9 Dec.
- **Buffer:** 17 working days (20 Nov–9 Dec) × 15% = 2.55 → **3 days**.
- **Commit:** **Sat 12 Dec**. **Delivered by:** + 2 travel days = **Mon 14 Dec**.
- **What decided it:** the machine waited for the Chamber (ready Sat 5 Dec), and the pre painting trip.
- **Counted on:** Team One (2 people) from Thu 26 Nov; Team Two (2 people) from Fri 4 Dec.
- **How sure:** Rough (mostly typed numbers).
- **Amber warning:** the Aata machine's BOM isn't approved.
- **Note:** 6 QC checkpoints each cost a working day here (decided the same day, used the next). Round 2's QC history will show whether that's realistic.

**Result, first press (browser):** likely **Sat 5 Dec**, commit Wed 9 Dec, delivered by Fri 11 Dec. **That differs from the hand working.**
- **The cause (B4):** a job-work step's **QC tick was ignored**. Laser cutting came back Wed 25 and drilling started that same day, when QC should decide first. It happened on 4 trips (laser cutting, Chamber frame welding + grinding, Motor Mount welding, Chamber welding + grinding).
- **Also seen:** "1 open order has steps with no time". A part sweep raised **ORD-2026-019 (Bracket × 5, for stock)** at 16:00, plus PR048 (ms round bar), because the reset set Bracket's stock to 0 against its minimum of 5. My reset had switched off only the material-flow sweeps. It doesn't change this date: its steps run Thu 19 and Fri 20, before the Aata chain needs anyone.

**After the B4 fix (re-estimated by script on test-1):** likely **Wed 9 Dec**, 17 working days → buffer 3, commit **Sat 12 Dec**, delivered by **Mon 14 Dec**. Every trip date, "counted on" (Team One 2 from 26 Nov, Team Two 2 from 4 Dec), Rough and the BOM warning **match the hand working exactly**. ✓ Your browser check of the same is next.

**Browser, second press (after the fixes):** commit **Sat 12 Dec**, likely Wed 9 Dec + 3, delivered by Mon 14 Dec. All 5 decided-by lines, "counted on", Rough (typed numbers only) and the BOM warning **match**. **Run 1 PASSED.**

### Run 2: Aata machine × 5, worked by hand BEFORE pressing Estimate (19 Nov)
*(× 2 was worked too. It gives the same date as × 1, since every step takes hours and the days come from trips and QC, so × 5 is the run that tests the people.)*

**What changes from × 1:**
- 5 machines and 5 Chambers, one unit at a time.
- 10 Chamber frames in one batch: drilling 5 h, 1 person.
- 5 Motor Mounts in one batch: grinding 2.5 h.
- 5 Test Sensors.
- **The cap:** 2 people at once on the whole Aata order and 2 on the whole Chamber order, shared by all their units (decisions L + N).
- **Only Test Worker Four does post painting:** 1 h per Chamber, 2 h per machine.

| Day | What happens |
|---|---|
| Mon 23 → Fri 27 Nov | As in × 1: laser cutting out Mon 23 / back Wed 25 / QC; drilling 5 h Thu 26 / QC; welding + grinding out Fri 27. Motor Mounts: welding out Tue 24, grinding 2.5 h Fri 27, ready Sat 28 |
| Tue 1 Dec | All 10 Chamber frames ready → all 5 Chambers' welding + grinding out (back Thu 3, QC) |
| **Fri 4** (9 h day) | Chambers one by one with the cap of 2: coating (2 people 1.5 h, or 1 person while Test Worker Four post-paints the one before), pre painting 0.5 h, post painting 1 h. **Chambers 1–3 finish and pass QC; Chamber 4's coating ends exactly at the day's end** |
| Sat 5 | Machines 1–3 assemble (2 people, 2 h each), so their pre painting goes out (back Mon 7). Chamber 4 pre + post painting, and Chamber 5 coating + pre + post: their QC is decided Saturday evening → **usable Mon 7** |
| **Mon 7** | Machines 1–3 back → **post painting 2 h each, one after another (only Test Worker Four)**. Machines 4–5 assemble, but with **1 person**, because Test Worker Four post-painting counts as one of the order's 2 people. Machine 4 done 4 h after the day starts → pre painting out (back Wed 9); machine 5 (a second person joins midway) → out the same day (back Wed 9) |
| Tue 8 | Machines 1–3 ready |
| Wed 9 | Machines 4–5 back → post painting 2 h each (Test Worker Four) → final QC |
| Thu 10 | All 5 ready → packing |
| **Fri 11 Dec** | **Dispatch** |

**Expected:**
- **Likely:** Fri 11 Dec.
- **Buffer:** 19 working days × 15% = 2.85 → **3**.
- **Commit:** **Tue 15 Dec**. **Delivered by:** **Thu 17 Dec**.
- **Counted on:** Team One (2 people) from Thu 26 Nov; Team Two (3 people) from Fri 4 Dec.
- **How sure:** Rough. **BOM warning:** yes.

**Two things this run shows:**
1. **One person can be the limit.** Post painting needs Test Worker Four, so 5 machines queue for one person.
2. **The cap is shared across the order.** While Test Worker Four post-paints, only 1 assembler can work, because the 2 people at once count for the whole order (decision N, "the same cap for bigger orders").

**Script check (before the browser):** likely Fri 11 Dec, 19 working days → buffer 3, commit Tue 15 Dec, delivered by Thu 17 Dec. Machine 4 waited for Chamber 4 (ready Mon 7). Trips and "counted on" (Team One 2 from 26 Nov, Team Two 3 from 4 Dec) all **match the hand working**. ✓

**Browser:** commit **Tue 15 Dec**, likely Fri 11 Dec + 3, delivered by Thu 17 Dec. Decided-by (machine 4 waited for Chamber 4 on Mon 7; every trip) and counted on (Team One 2 from 26 Nov, Team Two 3 from 4 Dec) **match**. **Run 2 PASSED.**

### Run 3: a bought machine (route 1), worked by hand BEFORE pressing Estimate (19 Nov)
`purchase mahine test` (PMT): bought (not in-house), stock 0, no receipts, no quote, no usual days.
- **3a, as it is:** **Can't estimate yet**: "purchase mahine test: bought fewer than 3 times, no quote, no usual days to buy — Purchase can type its usual days to buy on Purchase → Inventory".
- **3b, after Purchase → Inventory → Product Master → PMT, Usual Days to Buy = 7:**
  - The line under the box says "Estimate uses your number". In by Thu 26 Nov (19 + 7).
  - Packing Thu 26, dispatch **Fri 27 Nov** = likely.
  - Working days 20–27 Nov = 7 × 15% = 1.05 → the minimum **2**.
  - Commit **Mon 30 Nov** (Sat 28, Mon 30). Delivered by **Wed 2 Dec**.
  - Decided by: "purchase mahine test: to buy, Purchase's usual 7 days to buy — Thu 26 Nov".
  - No "counted on" (nobody builds it). Rough (a typed number). No BOM warning.
- **3c, PMT × 1 and Aata machine × 1 together:** the order's date is the later one, so likely **Wed 9 Dec** (Aata: "sets the date"), commit **Sat 12 Dec**, delivered by Mon 14 Dec. PMT's own line: likely Fri 27 Nov. The BOM warning is back (for the Aata machine).

## Bugs and improvements
| # | What | Found | Status |
|---|---|---|---|
| P1 | **Speed:** one estimate takes 1.7–5.5 s on an empty test-1 (2 s was measured on 18 Nov with 31 open orders). Likely sequential round-trips to the remote database | Round 0 | To look into |
| B1 (was S1) | **Attendance:** a working day with no record counted as absent. Test-1 has records on only 7 days, so rates were 5–53% and each person's day shrank to 0.4–4.8 h. **Your decision:** only days with a record count (the device writes its own Absent, so absences still count). A person is measured from 20 recorded working days; before that, 100% and "not measured yet" | Round 1 | **Fixed 19 Nov** (`history.js` peopleAndCalendar; estwork +3 checks) |
| B2 | **Buying time:** a single receipt replaced Purchase's typed lead time. Test-1's receipts are dev tests (minutes to 2 days). **Your decision:** history from 3+ receipts, like step times. The company-wide "raise → PO" time also needs 3+ | Round 1 | **Fixed 19 Nov** (`history.js` purchaseDaysFor, MIN_HISTORY; estwork +1 check) |
| B3 | **No way to type a lead time.** The estimate's last fallback for a material was the item's "Lead Time", but that box was removed from the item form at the client's request (8 Aug). The estimate's message pointed nowhere. **Your decision:** Purchase → Inventory gets a "Usual Days to Buy" column and a Job Work Time tab. R&D's job-work days box moves there (§13) | Round 1, step 3 | **Fixed 19 Nov** (purchdays 36 new) |
| B4 | **A job-work step's QC tick was ignored.** Production checks it when the work comes back (Store receives → QC → Production), but the estimate let the next step start straight away. The date came out 4 days early (5 Dec vs 9 Dec) | Round 1, run 1 | **Fixed 19 Nov** (`workList.js`: new order and work in hand; estplan +1) |
| B5 | **My reset missed the two part sweeps** (Child Part / Sub Child Part, every 30 minutes, for anything at or below its minimum stock). They raised ORD-2026-019 (Bracket × 5) and PR048 | Round 1, run 1 | **Done 19 Nov** (your choice: delete it and switch the part sweeps off for the test). Minimum stock → 0 on CP-004, CP-005, SCP-004, SCP-007 (originals in `b5.changed-before.items.json`). ORD-2026-019, its reservation and PR048 deleted (`b5.deleted.json`). Checked: nothing left |
| I3 | The decided-by line said "lead time 3 days (typed)". It now says "Purchase's usual 3 days to buy" | Round 1, run 1 | Done 19 Nov |
| I4 | A wait of a few hours on the same day reads oddly: "Chamber — coating: ready from Fri 4 Dec, but people are free only from Fri 4 Dec". Suggested wording: "Chamber — coating: waited a few hours on Fri 4 Dec for people (the order's usual 2 were busy)" | Round 1, run 2 | **Done 19 Nov** (your choice: say it was hours). The reason now carries the hours, e.g. "Chamber — coating: waited 7 h on Fri 4 Dec for people to be free". A wait that crosses days keeps its wording. `planner.js` explain (waitHours) + `DeliveryEstimatorModal.jsx`; estplan +1 |
| D1 | **The people cap stays per order** for bigger orders (decision N confirmed after run 2: 2 people at once on all 5 machines together) | Round 1, run 2 | Kept as decided |
| Q1 | Your question: is counting work hours enough? It's a day-by-day plan with each person's shift × attendance. Still not counted: the **wait between steps** (people are assigned daily) and **Store's issue time** | Round 1 | Waiting on your choice: design now, or after round 1 |
| S2 | Two teams named "Team One" make "counted on" ambiguous | Plan | Round 1 (tidy) |
| S3 | `estwork` motor median gave 8 once | Plan | Round 2 |
