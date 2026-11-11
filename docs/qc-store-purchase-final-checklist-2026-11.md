# QC waits for Production only when the job came from Production

*Built 5 November 2026, found at browser test step 3.15 on QC-2026-0281.*

## The problem

A PRO001 sold from stock went from Store straight to QC, which is right. But QC showed **"waiting for Production's Final checklist"** with Review hidden, and the wait could never end, because no Production work exists for that job.

**How it came about:**

| Date | What happened | A machine sold from stock |
|---|---|---|
| 2 Sep | QC could fill a machine's checklist while Production was still building. The fix made QC wait, for jobs with part checks | Still worked: a Store job has none |
| 17 Sep | New-style machine orders have no part checks either, so the test became "is this a manufactured machine?" | **Blocked.** It never asked where the job came from |
| 28 Sep | The code that submitted that checklist was deleted | Still blocked |

## What happens now

**One rule: QC waits for Production only if the job came from a production order.** Any other job gets the machine's Final checklist from `/r&d/product-master-qc` as soon as QC opens it.

| Route | Job's source | Before | Now |
|---|---|---|---|
| **Manufactured machine sold from stock** | `Store` | Stuck forever | **Final checklist at once** |
| **Manufactured machine bought** (Store picks Purchased by hand) | `Purchase` | Would be stuck; none on dev yet | **Final checklist at once** |
| Purchase Machine, sold from stock or bought | `Store`, `Purchase` | Worked | Same |
| Machine built, BOM with QC steps | `Production`, `Stock`, `QC_Rejected` | QC per unit | **Unchanged** |
| Machine built on an old order, no QC flags | `Production`, `Stock` | Waits | **Unchanged** (see below) |
| Child Part, Sub Child Part, materials, job work | Their own | Not a machine | **Unchanged** |

**Why the wait wasn't simply removed:** it also keeps the flat checklist off per-unit jobs. Those keep their rows per unit, so removing it would have put stray rows on every built machine's job.

**The rule lists who waits, not who doesn't,** so a route added later can't get stuck by default.

## Existing jobs
No script. On opening:
- **QC-2026-0281** gets Machine Vibration, Leaking and Electric Load.
- **QC-2026-0208** unlocks with BP816's Final rows.
- **QC-2026-0209** unlocks and keeps its old single "dummy" row, because a job that already has rows isn't refilled.

## Found, not changed
1. **Old orders with no QC flags:** 11 open machine orders on dev, such as ORD-2026-047, would hit this same dead end when finished. New orders can't, because a released machine's BOM has QC steps. Dev only.
2. **PRO-0014's fields disagree:** its product type says Purchase Machine, but it's ticked for Design & Prototype, has a BOM and is Released, so New Stock Order offers it. Worth R&D tidying that item.

## Technical notes
- `services/qcChecklistPullService.js`: `waitsForProductionFinal(job, item)`, `PRODUCTION_JOB_SOURCES`.
- `controllers/qcController.js`, `getQCJob`: uses it, and returns `waitsForProductionFinal` in place of `isManufacturedMachine`.
- `pages/quality-control/QCInspection.jsx`: reads the new field. It was the only reader.
- No change to `submitDecision`, `syncRDToQCJob` or `flatModuleStageForItem`.

## Checked
- **New suite `qcgate`:** 34 of 34, 0 left, through the real `getQCJob` and `decideJob`. It covers each route above, opening twice, Pass refused with rows pending, the warning box with no sticker picked, Pass with the sticker reaching the customer, and Fail putting stock back. Hand-worked values.
- **Regression:** `claimway` 25, `heldcarrier` 15, `nosel` 46, `rb2` 21, `s2d` 11, `chk` 15, `gc` 40, `itemlink` 5.
- **Two old-suite issues, neither caused by this:**
  - `itemlink` first failed 1 of 5, because its test item had no `type`, which stock credit needs. With that added to the test, it passes 5 of 5.
  - `rb` fails 4 of 18. It doesn't call the changed code, and it expects one REJ per reject line, replaced on 30 Oct by one REJ per decision. `rb2` is the current version. Left as it is.
- **The page compiles.**
- **Not yet seen in the browser:** that is step 3.15.
