# Accounts module — tenant-isolation gaps found during pagination audit

Context: while auditing the Accounts module for pagination/search issues, found several
places where data isn't scoped by company. Checked each one's underlying Mongoose model
first. Split into two groups below — **only Group 2 was actually fixed in code**; Group 1
needs a decision from whoever owns this part of the schema, since fixing it means adding
a new field + a data migration, not just a query tweak.

---

## Group 1 — model has no `companyId` field at all (not touched, needs a schema decision)

These all currently isolate tenants by a plain `unit` string field instead of a real
`companyId` reference to the `Company` collection. That's presumably intentional
(a different, older tenant model), but it means:
- Isolation depends on `unit` strings being unique/non-overlapping across companies.
- There's no way to query "give me everything for company X" directly — only "everything for unit Y".

| Model | File | Used by (controller function) | Used by (frontend page) |
|---|---|---|---|
| `Account` / `Transaction` | `server/models/Account.js` | `accountsController.getBankCashSummary`, `accountsController.getTransactions`, `accountsController.getLedgerRecords` | Bank & Cash (`/accounts/bank-cash`), Ledger Record (`/accounts/ledger`) |
| `Account` (reused, not the separate `BankAccount` model) | `server/models/Account.js` | `leadPaymentController.getBankAccounts` | Payment Verifications (`/accounts/payment-verifications`) |
| `Supplier` | `server/models/Supplier.js` | `supplierController.getSuppliers` (and RFQ vendor-matching) | Vendor Master (`/accounts/purchases/vendors`), RFQ Management (`/accounts/purchases/rfq`), Vendor Bids (`/accounts/purchases/vendor-bids`) |

If cross-company data leakage between two companies that happen to reuse the same `unit`
value is a real risk in your deployment, the fix is: add a `companyId` field to `Account`,
`Transaction`, and `Supplier`, backfill it for existing rows, then scope the queries above
by `companyId` the same way the rest of the app does. That's a schema migration, not a
one-line fix, hence flagging rather than doing it.

---

## Group 2 — model DOES have `companyId`, query just wasn't using it (fixed)

**`financeController.js` → `getFinanceSummary`** (Financial Summary page, `/accounts/financial-summary`)

`Sale`, `Return`, and `Expense` (plus the 8 department-expense models rolled into the
same report) all carry a real `companyId` field. The role check here bundled `'Accounts'`
in with `Super Admin`/`Super User` as a "consolidated, all-units" viewer — meaning a normal
per-company Accounts user could see every company's sales/expense figures whenever they
didn't pick a specific unit filter (and even picking a unit didn't add a companyId
restriction). Fixed by removing `'Accounts'` from that bypass branch, so it now falls into
the same per-company scoping every other role/endpoint in this app already uses. Super
Admin/Super User behavior (their legitimate cross-company "All Units" view) is unchanged.

---

## Found along the way — NOT a companyId issue, flagging separately

These two skip the `unit` check the codebase already has available and uses everywhere
else in the same file — not "missing companyId", but missing *any* tenant check at all.
Didn't touch these since they're outside what was asked (fixing companyId-only gaps), but
they're worth a look:

- **`accountsController.reconcileTransaction`** — does `Transaction.findById(id)` with zero
  ownership check (not even `unit`). Any authenticated Accounts user, from any unit, can
  reconcile another unit's transaction if they know/guess its ID.
- **`accountsController.getLedgerRecords`** — the `Account.findById(accountId)` lookup
  (before returning that account's ledger) has the same gap — no ownership check at all.
