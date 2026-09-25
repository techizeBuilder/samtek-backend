# Inventory stats showing the wrong numbers — plain-language report

## The problem

The Inventory tab's three summary cards (Total Items / Item Types / Discontinued) — used by
everyone: R&D, Store, Unit Head — were built from a request that was silently going to the wrong
web address for every role except Super Admin and Unit Head. It looked like nothing was there at
all (a "not found" error in the background), so the cards just sat at zero and the actual item
list underneath (a separate, correctly-addressed request) kept working — easy to miss unless you
watched the browser's own error console.

Fixing that address exposed a second, real bug sitting right behind it: once the cards' request
actually started reaching the right place, it turned out that specific piece of the server had
never been taught to scope its counts to "just this company" for most roles — only Unit Head and
Store had that scoping. Every other role (R&D included) got a single combined count added up
across every company in the database, not their own. That's why, right after the address got
fixed, R&D and Store — looking at the exact same data — suddenly showed two different, both-wrong
numbers on the same page.

## How it works now

- The summary cards' request now goes to the correct address for every role.
- That request's counts are now scoped to the caller's own company the same way the item list
  right below it already was — so the numbers on the cards and the numbers in the table always
  agree, and one company's items never spill into another company's total.

Verified directly against the real data: R&D and Store, looking at the same company, now both
report the same total as the item list underneath (21, in the account used to test this).

## What did NOT change

- The item list itself was never wrong — it was already correctly scoped; only the three summary
  cards above it were affected.
- Nothing about how items are created, edited, or filtered.
