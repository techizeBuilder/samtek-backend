# Outsource v2 — points parked for later

Things we agreed to come back to. Each has where it came from, what was said, and what it would
take. Tick it off (or move it to a change report) when it's done or dropped.

| # | Point | From | Status |
|---|---|---|---|
| L1 | Combine sheets / lengths across **all lines** of an order | flow test v2, R2 (2026-10-23) | open — discuss |
| L2 | Slice 4: job-work cost into the part's cost | slice plan (2026-10-20) | postponed until the flow settles |
| L3 | QC rework of an outsourced Child Part / Machine **unit** has no resend path | roadmap v1 write-up (2026-10-21) | open — discuss |
| L4 | Remove the receive for trips sent before Outsource Orders | slice 8 (2026-10-21) | after the client migration |
| L5 | Multi-stop trips; a printed challan | Dispatch design T2 / T4 (2026-10-20) | only if the client asks |
| L6 | Vendor Payment: credit + bank in one payment | bug report point 3 (2026-10-22) | option, not built |
| L7 | New Outsource Order: clear a step's price when the step is unselected | flow test v2, R1 (2026-10-23) | option, not built |
| L8 | Dev server: `nodemon --exec ts-node` runs out of memory at start | 2026-10-23 | **dropped** (2026-10-24, the user): dev only; live runs `node index.js` |
| L9 | My test scripts leave ledger rows (no company field) on the dev database | reset, 2026-10-23 | **dropped** (2026-10-24, the user): dev database only; the client domain has only product master data |

---

## L1 — Combine sheets / lengths across all lines of an order

**What happens now (decision M2, `material-logic-2026-10.md`):**
- Sheet / length material from Store is combined **within one Outsource Order line**: the line's
  requests are cut from whole sheets / lengths together, and each request is booked its share by
  area / length.
- **Different lines** of the same order are **not** combined, even when they use the same sheet.

**Seen in the flow test (OSO-0001, TRP-0001):**
- Fan Bush (cutting) and Fan Blade (laser cutting) are two lines on one order, both from the
  same ss sheet 1.5 × 1250 × 2550.
- Each needed only **0.012 m²**, yet Store's handover defaulted to **one whole catalog sheet per
  line**: two sheets for 0.024 m².
- Store *can* pick an offcut (the 500 × 600 one was there), so it's not blocked. But the default
  over-issues, and nothing tells Store the two lines could share a sheet.

**Options to discuss:**
- **A — Combine across lines** of the same order and the same sheet / length (one cutting run per
  order). Each line, and each request, is still booked its share. Changes `combineLine` → per order,
  To Dispatch's picker, and the share booking.
- **B — Keep per line**, but suggest the smallest offcut that covers the need, and warn when a
  whole sheet goes for a tiny area ("0.012 m² — consider the 500 × 600 offcut").
- **C — Leave as is.**

## L2 — Slice 4: job-work cost into the part
Design `project_outsource_cost_jobwork_design` / outsource-v2 slice plan. Postponed by you
(2026-10-20) until the whole flow is built and tested. It needs a back-fill for orders made in
between. Since change report §14 the job-work cost uses the actual step amounts (incl. entered
time).

## L3 — Unit rework for outsourced Child Part / Machine
If QC rejects an outsourced Child Part / Machine **unit**, the step stays In Progress, and the unit
sits "In QC" at Store. There's no resend like the Sub Child Part batch rework. Kept out of the
roadmaps.

## L4 — Pre-Outsource-Order receive
The old receive for trips sent before Outsource Orders existed is kept on purpose (the client's
database may have some). Remove it after the client migration.

## L5 — Multi-stop trips, printed challan
The trip model already has `stops[]` (one stop today), so multi-stop is a screen change. Challan /
e-way bill numbers are typed. A printed challan is written up in `dispatch-design-2026-10.md`.

## L6 — Credit + bank in one payment
Today: pay part from the vendor's credit, then the rest by bank, as two payments. Option: one
"credit ₹___ + rest from bank" in the Pay dialog (same ledger entries as two payments).

## L7 — Hidden step price
Unselecting a step keeps its typed price in the form (it isn't sent). Option: clear it on
unselect.

## L8 — Dev server memory
`ts-node` type-checks the whole backend at every (re)start; it's now just over Node's 2 GB default.
Plain `node index.js` starts at about 190 MB. Option: `dev` = `nodemon index.js` (or
`ts-node --transpile-only`).

## L9 — Test ledger rows
Ledger `transactions` have no company field, so my tests' clean-up (by company) misses them: 90
were found and removed on 2026-10-23. Fix the test clean-up to remove transactions on the test
company's accounts.
