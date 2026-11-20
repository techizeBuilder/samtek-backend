# Saves that could fail: old-style "before save" steps (fixed)

*16 November 2026. Found while building the Purchase / Accounts separation ([purchase-separation/02-changes.md](purchase-separation/02-changes.md)).*

## In one line
Eleven automatic steps that run just before a record is saved were written in an old style that the current database library no longer supports. Each one **made that record's save fail**. They're rewritten; the calculations are unchanged.

## What was wrong
- **Some records work something out just before saving,** e.g. a total, a number or a status. The old way ended that step by calling a "continue" function.
- **The database library in use (Mongoose 9)** no longer passes that function, so the call failed with "next is not a function". The save stopped there.
- **The new refund / credit record hit it first,** in today's tests. A check of the whole server found 11 more steps in 10 records.

## The records, and what their step does
| Record | Step before saving | Data on test-1 |
|---|---|---|
| **Ledger entry** (lead payments → ledger) | gives the next number, LE-000039 | last entry 5 Nov |
| Dispatch console | available stock, shortage, closing stock, loss, on a save and on an edit | none |
| Manufacturing job | a job number | none |
| Packing sheet | total packed quantity | 3, from May |
| Production batch | quantity achieved, status, the date at day level | none |
| Production batch data | "updated at" | none |
| Production group | item count, "last updated" | none |
| Return | totals per line and overall | none |
| Salesman daily settlement | difference, Shortage / Excess / Clear | none |
| Ungrouped item production | quantity achieved, status | none |

- **Most of these pages aren't in use on test-1,** which is why nobody saw it.
- **The ledger entry matters most:** the lead-payment → ledger posting would fail on its next use.
- **The ledger entry's step already had a guard,** but it only helped when the record is checked on its own. A normal save still failed.

## What changed
- **Each step now finishes without the "continue" call.**
- **The production batch's error handling** now passes the error on in the supported way.
- **Nothing else in these records changed.**

## Tested
- **New suite `prehooks`, 14 of 14 passing.** It runs every step the way a real save runs it, the case that used to fail, and checks its result. Examples:
  - (2 × 50) − 5 = 95 achieved
  - a ₹100 shortage
  - return totals ₹40 / 5 pieces
  - LE-000039 as the next ledger number
- **It also confirms no record on the server still uses the old style.**
- **No older suite covers these records,** so there was no regression run beyond this.
