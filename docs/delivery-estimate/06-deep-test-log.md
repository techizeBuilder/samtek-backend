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
| Sweeps | Off on the 18 watched items. **Put them back after the test** from `changed-before.items.json` (materialFlow fields). *(19 Nov, B5: the two part sweeps are off too. Put minStock back from `b5.changed-before.items.json`. 21 Nov: also the Low Flow set in the client demo on BP816, ROU-001 and T, from `test-1-clean-2026-11-21/changed-before.items.json`)* |
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

**Browser (20 Nov; today Fri 20, so 3b moves one day):**
- **3a:** "Can't estimate yet" with exactly that line ✓.
- **3b:** likely Sat 28 Nov, buffer 2, commit Tue 1 Dec, delivered by Thu 3 Dec; "Purchase's usual 7 days to buy — Fri 27 Nov" ✓.
- **3c:** likely Wed 9 Dec (the Aata line "sets the date"), commit Sat 12 Dec, delivered by Mon 14 Dec. PMT's line: Sat 28 Nov ✓.
  - 3c was worked out after it was pressed. C channel now arrives Mon 23, where on 19 Nov it arrived Sun 22 but was usable Mon 23 anyway, so the chain is the same.
  - The Test Motor arriving Wed 25 isn't needed before Sat 5 Dec.
  - 16 working days → buffer 3.
- **Run 3 PASSED.** Found I5 (below), fixed.

### Run 4: a machine in stock (case 0), worked by hand BEFORE pressing Estimate (20 Nov)
*Setup by script: Aata machine stock 0 → **1**. Set back to 0 after runs 4.*
- **4a, Aata machine × 1:** taken from stock, nothing built.
  - Ready today → packing Fri 20, dispatch **Sat 21 Nov** = likely.
  - 1 working day → buffer = the minimum **2** → commit **Tue 24 Nov**. Delivered by **Thu 26 Nov**.
  - Decided by: "Aata machine: in stock".
  - **No BOM warning** (nothing to build), no "counted on". How sure: **Good** (no typed numbers).
- **4b, Aata machine × 2:** 1 from stock, 1 built.
  - The built one decides: as run 1 → likely **Wed 9 Dec**, commit **Sat 12 Dec**, delivered by Mon 14 Dec.
  - The BOM warning is back, and Rough.

**Browser:**
- **4a:** commit Tue 24 Nov, likely Sat 21 + 2, delivered by Thu 26; "Aata machine: in stock — Fri 20 Nov"; Good; no warning, no "counted on" ✓.
- **4b:** commit Sat 12 Dec, likely Wed 9 Dec, delivered by Mon 14; BOM warning, Rough, the built machine's chain ✓.
- **Run 4 PASSED.** Suggested I6 (below).

### Run 5: a Child Part in stock (case 1), worked by hand BEFORE pressing Estimate (20 Nov)
*Setup by script: Aata machine back to **0**; Chamber (CP-002) stock 0 → **1**.*

**Aata machine × 1:** the Chamber comes from stock, so no Chamber, Chamber frame, Motor Mount or Test Sensor is built or bought. Only the machine's own steps.

| Day | What happens |
|---|---|
| Wed 25 Nov | Test Motor in (Purchase's usual 5 days) → **assemble** 4 h ÷ 2 people = 2 h (Rahul + Test Worker Two) → **pre painting** out (2 days) |
| Fri 27 | Back → **post painting** 2 h (Test Worker Four) → final QC by the end of the day |
| Sat 28 | Ready → packing |
| **Mon 30 Nov** | **Dispatch** (Sunday off) |

**Expected:**
- **Likely:** Mon 30 Nov.
- **Buffer:** 8 working days × 15% = 1.2 → the minimum **2**.
- **Commit:** **Wed 2 Dec**. **Delivered by:** **Fri 4 Dec**.
- **Decided by:** "Test Motor: to buy, Purchase's usual 5 days to buy (needed for assemble) — Wed 25 Nov"; pre painting out Wed 25, back Fri 27.
- **Counted on:** Team One (1 person) and Team Two (2 people), from Wed 25 Nov.
- **BOM warning:** yes. **How sure:** Rough.
- **Script check (20 Nov):** all of the above matched ✓.

**Re-worked for Sat 21 Nov, BEFORE pressing (the browser run is on the 21st):**
- **The plan:**
  - Test Motor bought today (5 days) → **Thu 26 Nov** → assemble 2 h, 2 people → pre painting out Thu 26, back **Sat 28**
  - post painting 2 h (Test Worker Four) → final QC Saturday evening → Sunday off
  - **Mon 30** packing → **Tue 1 Dec** dispatch
- **Expected:**
  - **Likely:** Tue 1 Dec.
  - **Buffer:** 8 working days → **2**.
  - **Commit:** **Thu 3 Dec**. **Delivered by:** **Sat 5 Dec**.
  - **Decided by:** Test Motor (Thu 26 Nov, needed for assemble); pre painting out Thu 26, back Sat 28.
  - **Counted on:** Team One (1) and Team Two (2), from Thu 26 Nov. BOM warning; Rough.

**21 Nov, the client demo's data:**
- **What happened:** on 20 Nov, for the client meeting, the Blower Pulverizer, ROU-001 and T were set to Low Flow. The Blower Pulverizer's save raised ORD-2026-019 (for stock) with its Fan, Fan Blade, a job-work order and purchase requests. As work in hand it changed run 5's "counted on" (Team Two 3); the dates stayed right.
- **Your choice:** remove it. Cleaned with the reset script into a **separate** backup, `D:\cs\db-backups\test-1-clean-2026-11-21\`:
  - 3 orders, 1 job-work order, 1 crew entry, 7 reservations and 9 requests deleted
  - the sweeps off on BP816, ROU-001 and T
  - a check run afterwards: nothing left
- **Run 5 by script after the clean-up:** likely Tue 1 Dec, commit Thu 3 Dec, delivered by Sat 5 Dec; counted on Team One (1) + Team Two (2) from Thu 26 Nov. **Matches the hand working exactly** ✓.

**Browser (21 Nov):** commit Thu 3 Dec, likely Tue 1 Dec + 2, delivered by Sat 5 Dec. Decided by: Test Motor (Thu 26, needed for assemble) and pre painting out Thu 26, back Sat 28. Counted on: Team One (1) + Team Two (2) from Thu 26. BOM warning, Rough. No Chamber chain (from stock). **Run 5 PASSED.** The Chamber's stock was set back to 0.

### Run 6: Blower Pulverizer × 1, worked by hand BEFORE pressing Estimate (21 Nov)
**Setup, by script at your ask** (old values in `test-1-clean-2026-11-21/run6-before.json`):
- BP assemble 6 h and coating 2 h, usual people 2
- Fan Blade drilling 0.25 h, people 1
- job work: cutting 1 day, drilling 1 day
- Fan Bush people 1. The Fan already had people 1.

**As saved now:**
- **BP:** assemble (6 h, QC; picks Fan, NUT Bolts, Tool-A) → pre painting [job work, QC] → post painting [job work, final QC] → coating (2 h, QC). The BOM is locked.
- **Fan** (*changed since 19 Nov, probably in the demo*): welding (in-house 1 h, QC; picks Fan Blade × 6, Fan Bush × 2) → grinding (1 h, QC; Tool-A) → coating (2 h, QC; NUT Bolts, bearings) → pre painting + post painting [job work].
- **Fan Blade × 6** (batch): laser cutting [job work, no QC] → drilling 0.25 h/piece = 1.5 h, QC.
- **Fan Bush × 2** (batch): cutting + drilling [job work, both QC] = one 1-day trip.
- **Buying, all raised today:** **ss sheet** (both blades' and bushes' raw material) history **13 days** → **Fri 4 Dec**. NUT Bolts 2 days, bearings 2 and Tool-A 1 → Mon 23 Nov.
- **Skills:** welding is Test Worker Three only; assemble is Rahul, Test Worker Two or Test Worker Five.

| Day | What happens |
|---|---|
| **Fri 4 Dec** | ss sheet in → **Fan Blade laser cutting** out (2 days → Sun 6, so Mon 7). **Fan Bush cutting + drilling** out in one trip (1 day → Sat 5), QC → ready Mon 7 |
| Mon 7 | Fan Blade **drilling** 1.5 h (Test Production Employee) → QC → ready Tue 8 |
| Tue 8 | Fan **welding** 1 h (Test Worker Three) → QC |
| Wed 9 | Fan **grinding** 1 h (Test Worker Three again, he was on its last step) → QC |
| Thu 10 | Fan **coating** 2 h (1 person, the Fan's usual 1) → QC |
| Fri 11 | Fan **pre + post painting** out in one trip (2 days → Sun 13, so Mon 14) |
| Mon 14 | Fan ready → BP **assemble** 6 h ÷ 2 = 3 h (Rahul + Test Worker Two) → QC |
| Tue 15 | BP **pre + post painting** out in one trip (2 days → Thu 17), QC |
| Fri 18 | BP **coating** 2 h ÷ 2 = 1 h (Rahul, then Test Production Employee joins) → QC by the end of the day |
| Sat 19 | Ready → packing |
| **Mon 21 Dec** | **Dispatch** (Sunday off) |

**Expected:**
- **Likely:** Mon 21 Dec.
- **Buffer:** 25 working days × 15% = 3.75 → **4**.
- **Commit:** **Fri 25 Dec**. **Delivered by:** **Sun 27 Dec**.
- **Decided by:**
  - "ss sheet: to buy, usually 13 days (needed for laser cutting) — Fri 4 Dec"
  - Fan Blade laser cutting out Fri 4, back Sun 6, usable Mon 7
  - Fan pre painting + post painting out Fri 11, back Sun 13, usable Mon 14
  - Blower Pulverizer pre painting + post painting out Tue 15, back Thu 17
- **Counted on:** Team One (3 people) from Mon 7 Dec; Team Two (1 person) from Mon 14 Dec.
- **How sure:** Rough.
- **BOM warning:** only if R&D's design approval isn't complete (the BOM is locked).

**Script check:** likely Mon 21 Dec, 25 → 4, commit Fri 25 Dec, delivered by Sun 27 Dec; the 4 decided-by lines; counted on Team One (3) + Team Two (1); no warning ✓.

**Browser (21 Nov):** commit Fri 25 Dec, likely Mon 21 Dec + 4, delivered by Sun 27 Dec. The 4 decided-by lines, counted on Team One (3) from Mon 7 Dec and Team Two (1) from Mon 14 Dec, Rough, no BOM warning. **Run 6 PASSED.**

## Round 1: COMPLETE (21 Nov)
**All 6 runs** were worked by hand before pressing, and each matched in the browser line by line:

| Run | What it covered | Commit |
|---|---|---|
| 1 | Aata × 1, the full cascade with job work and QC | Sat 12 Dec |
| 2 | Aata × 5: one post-painting person, the cap shared across the order | Tue 15 Dec |
| 3 | A bought machine: not set → 7 days → together with the Aata machine | Tue 1 Dec / Sat 12 Dec |
| 4 | A machine in stock; × 2 with one built | Tue 24 Nov / Sat 12 Dec |
| 5 | A Child Part in stock | Thu 3 Dec |
| 6 | Blower Pulverizer: the shared Fan, an all-job-work Sub Child Part, a 13-day raw material | Fri 25 Dec |

- **Found and fixed on the way:** B1 attendance, B2 buying time from 3 receipts, B3 no place for days to buy (Purchase → Inventory + Job Work Time), B4 QC after job work, B5 the part sweeps (a reset gap). Wording: I3, I4, I5. D1: the cap stays per order.
- **Still open:** I6 (say "1 from stock, 1 to build"), Q1 (the wait between steps + Store's issue time), P1 (speed: 3.5–6 s an estimate).
- **Paused here (21 Nov)** for the client's changes from the 20 Nov meeting. **Next:** round 2 (seeded history).
- **Changed under round 1 (feature 19, built 21 Nov):** step hours now come from each step's **approved standard** (`client-features-2026-11/19-standard-hours-changes.md`, logic §8).
  - Each step's most people is its own people count.
  - An order's cap is its largest step count.
  - Without an approved standard, R&D's figures are counted as typed (Rough).
  - History is no longer used for step hours, and the part's "usual people" box is no longer read.
  - On test-1, 13 steps of 7 parts got their people count from that box (backup `test-1-clean-2026-11-21/std-crew-before.json`). They wait for the Company Admin's approval.
  - **Before round 2:**
    1. approve the Aata machine's (and the Blower Pulverizer's) standards
    2. re-work runs 1 and 2 by hand with the new numbers
    3. press again

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
| I5 | "Rough because" said "with the hours split evenly across people" for a bought machine, which has no hours. Now only when R&D's typed **step hours** are used (`typedHours` from the work list) | Round 1, run 3 | **Done 20 Nov** (estimate +1) |
| I6 | When part of an order comes from stock, the item line doesn't say so ("Aata machine × 2 — likely Wed 9 Dec"). Suggested: "(1 from stock, 1 to build)", so Sales can offer the one in stock now | Round 1, run 4 | Suggested, waiting on your view |
| Q1 | Your question: is counting work hours enough? It's a day-by-day plan with each person's shift × attendance. Still not counted: the **wait between steps** (people are assigned daily) and **Store's issue time** | Round 1 | Waiting on your choice: design now, or after round 1 |
| S2 | Two teams named "Team One" make "counted on" ambiguous | Plan | Round 1 (tidy) |
| S3 | `estwork` motor median gave 8 once | Plan | Round 2 |
