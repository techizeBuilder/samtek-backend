# Delivery estimate: deep test from a fresh test-1

*Your ask (19 Nov 2026): test this feature deeply, from clean data, and fix whatever turns out wrong on the way. More real runs, so the dates rest on history.*

**How it works:**
- **Before each run,** I write the expected date by hand in [06-deep-test-log.md](06-deep-test-log.md).
- **Then we run it** (by script and in the browser) and note what came out.
- **Anything that differs** is a bug in the code or in the design. It goes to the bugs list, gets fixed, and the run is repeated.

## 1. The fresh start (decided 19 Nov)
**Scope:** test-1 only. The dev database also holds 6 other companies, and they aren't touched.

**What goes:**
- **Production:**
  - all 110 production orders, with their step runs, crew entries and production QC jobs
  - the material issue, return and transfer logs
  - the 8 Sub Child Part job-work orders
  - the 40 outsource orders, with their bills, payments and dispatch trips
  - the R&D requests raised from production orders
  - the stickered part labels, and the vendor serial units in Stock or built into production
- **Reservations:** all 46.
- **The 59 open customer orders:** their order forms, sale placeholders, Store QC and packing. Delivered and completed orders stay.
- **Open buying:**
  - 28 purchase requests (open, or on an open PO)
  - the 2 open POs, with their bills and payments
  - Received history stays, because it's where the "usual buying time" comes from.

**What else changes:**
- **Stock:** every test-1 item goes to 0 (fabrication sizes too). Each test puts in exactly what it needs.
- **Money:** each deleted bill, payment or customer payment had posted amounts to the account balances. Those 66 postings are reversed first, so every balance still equals its remaining lines. In total:
  - bills ₹67,879.70
  - vendor payments ₹16,699.06
  - one customer payment ₹30,120
- **The low-stock sweeps:** they're switched off for the test's items while testing (18 items). With stock at 0, they would otherwise raise purchases and machine builds within 30 minutes, and new open work would appear by itself. The original settings are in the backup, to put back after the test.
- **Kept records that pointed at deleted ones:** the link is cleared, not the record. For example, delivered orders' packing and dispatch, received POs, bids, and the quote groups. An open quote group left with no requests becomes Cancelled.

**Backup:**
- Before anything changes, every deleted record, and every changed record as it was, is saved to `D:\cs\db-backups\test-1-reset-2026-11-19\`.
- The balance changes are saved there too. Everything can be put back from there.

## 2. The test world
**Machines:**

| Route | Item | Why it's used |
|---|---|---|
| In-house | **Aata machine (PRO001)** → Chamber (CP-002) ×1 → Chamber frame (SCP-003) ×2, Motor Mount (SCP-008) ×1, **Test Sensor (SCP-009) bought** | A full cascade: job work on every level, QC steps, step picks, a bought part inside |
| In-house | **Blower Pulverizer (BP816)** → Fan (CP-001) ×1 → Fan Blade (FB-01) ×6, Fan Bush (SCP-002) ×2 | The Fan is shared with impact pulverizer and in house test, so orders compete for it |
| Bought | **purchase mahine test (PMT)**, **Motor A (MTR-001)** | Route 1: stock, an open PO, buying time |

**R&D numbers (typed in round 1):**
- usual hours per piece on every in-house step, and usual people per part
- usual days for each job-work process
- lead times on bought items and raw materials

The exact numbers are in the log, so every date can be worked out by hand.

**People:**
- **The 7 Production people and their teams.** Test-1 has two teams both called "Team One", and an empty "Team A". These get tidied first, so the "counted on" text can be read.
- **Attendance:**
  - Round 1 runs at 100%, with no records.
  - A later round adds records for a known rate. For example, 9 present days out of 10 should give 90%.

## 3. The rounds
| Round | What | How |
|---|---|---|
| **0** | Fresh start, then check that it's really empty: Orders, Process Execution, Work Planning, Manpower, Store, reservations. An estimate now says **can't estimate yet** and names what's missing | script + browser |
| **1: typed numbers** | R&D's numbers only, no history, everyone free. Bought item: in stock / short with an open PO / to buy. Aata machine ×1 (the full cascade worked by hand), ×2 (unit by unit, the people cap), partly in stock (Chamber in stock = case 1), a machine in stock (case 0). The BOM warning | script + browser |
| **2: history** | Tagged history seeded with known numbers: step runs at 1, 2 and 3 people, crew entries over 3+ orders per part, purchase receipts, job-work returns, QC waits. The same estimates again: now "time by number of people" from history, the people cap from history, buying and job-work days from history. **Good**, not Rough | seed script + browser |
| **3: work in hand** | Real orders placed through Sales → order form → Production. Then a new estimate must wait for the people, stock and parts the first order holds (reservations). Also: Urgent first, people planned in Work Planning, sticky people after real work, a for-stock order | browser + script |
| **4: real runs** | The round-3 order is built for real (Process Execution with crews, job work through Outsource, QC). **Actual vs estimate**, step by step. The real runs must land as history the estimate reads (step runs, crew entries, outsource returns, QC wait), and give the same numbers as seeded history | browser + script |
| **5: edges** | Unknown numbers, more than a year of work, low attendance, a holiday, a Sunday, nobody with the skill, a retired team, leave, Delivery Settings changes, buffer rounding, permissions, Use this date + the order form, speed with 50 open orders | script + browser |

**Seeded history:**
- It's tagged (`DEEPTEST-SEED`), so it can be removed in one go.
- It's only added from round 2; round 1 has none.
- In round 4, real runs are compared against it, and the seeded rows are removed at the end.

## 4. Already suspected (from building it and the test-1 checks)
- **S1, attendance:** a few records give a low rate, so dates come out late. Maybe a minimum number of measured days is needed before the rate is trusted.
- **S2:** test-1's duplicate "Team One" makes "counted on" ambiguous. Should "counted on" name people when two teams share a name?
- **S3:** the `estwork` motor median gave 8 once and passed on a re-run. Unexplained; watch it in round 2.

## 5. Where things go
- **[06-deep-test-log.md](06-deep-test-log.md):** each run's setup, the hand-worked expectation, what came out, and the verdict, plus the **bugs and improvements list** (B1…, I1…) with what was done.
- **Fixes:** they go into 03-changes.md (plain words) and the daily report.
- **Scripts** stay in the scratchpad kit, never in `server/`: the reset, the seed, the scenario runner.
