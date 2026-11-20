# Purchase separated from Accounts

The client's ask: Purchase has sat inside Accounts. It becomes its own parent module, so purchasers and accountants each see and hear only their own work. The decision (16 Nov 2026) is option 2: two parent modules, Accounts and Purchase, on the existing Accounts roles. No new department or roles for now.

| Doc | What | Status |
|---|---|---|
| [01-logic.md](01-logic.md) | The split (which page goes where), permissions, notifications rewired and new ones, decisions | Written 16 Nov; decisions Q1–Q4 made |
| [02-changes.md](02-changes.md) | What changed | Built 16 Nov; suite `purchsep` 76 passing |
| [03-test-roadmap.md](03-test-roadmap.md) | Browser test on test-1 (purchaser = Account Employee 1, accountant = Account Employee 2) | **Complete**, 17 Nov 2026: every step passed (see its Log) |

Background: [procurement-v2](../procurement-v2/) (the purchase flow) and [outsource-v2](../outsource-v2/) (outsource orders, bills, payments).
