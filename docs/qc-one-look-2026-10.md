# QC job page — one look for every QC job

> **REVERTED 2026-10-29 (you):** this isn't what you meant. Every file was put back as it was before
> (QCInspection.jsx from the copy taken just before the edit; only my own edits undone in
> ChildPartUnitQCReview.jsx / SubChildPartBatchQCReview.jsx, earlier work kept; qcStepMeta.js deleted).
> Kept only as a record — to be redone after we talk it through.

*2026-10-29, you: "I want the production type UI, but add the missing extra fields we have in the
other UI." Frontend only — no server change, nothing about how QC decides changed.*

## Before

- **Purchase / Store / other one-checklist jobs** (e.g. QC-2026-0257): big coloured card per check,
  a Pending/Pass/Fail dropdown and a Save button on every row, "Standard: Checkbox" on tick-box checks,
  the decision panel open on the page, and no history of who did what when.
- **Production jobs** (units → steps, batch steps; e.g. QC-2026-0255): step rows with Review / History
  — but no summary, no result at the end of the page, and who passed a step (and when) only inside
  History.

## Now

**Every one-checklist job uses the production layout:**
- An **Inspection** card: "One check for this delivery — a Pass moves it to Store; a rejection goes to
  Purchase…", the summary "2 Pass · 0 Fail · 0 Pending" (+ "n in QC" on a PO line, "n rejected
  earlier").
- **One step row, "Inspection checklist · n checks"**, with the status badge (Waiting to start / Ready
  for QC / Approved / Rejected), who and when on the row ("Passed by qc head · 2026-10-28", "Started by
  … — 2 checks to go", "Sent by test store head · 28/10/2026 — waiting for an inspector"), and:
  - **Review** — a dialog with the checklist and the whole decision panel as before (Pass / Fail,
    fail reason, severity, reject qty, sizes, serial numbers, "counted against", remarks, Pull R&D
    Data, add / remove a check). The rows are production's: Pass / Fail buttons, a Pass saves at once,
    a Fail needs remarks + Save; actual value only for value checks; no "Standard: Checkbox".
  - **History** — received (qty, sent by, date), inspection started (inspector, date), every check's
    result (with Production's own values on a manufactured Final Check), each partial rejection (qty,
    severity, when, reason), the final decision (who, when, Pass → Store / Fail → returned, reason,
    remarks).
- The green / red **result box** at the bottom stays as it was.

**Production jobs get the missing details:**
- **Summary line** — units: "2 of 2 units done · 4 steps passed · 0 rejected · 0 waiting for QC";
  batch: "n of m steps resolved · passed · scrap · rework pending".
- **Who and when on every step row** — "Passed by test qc head · 27 Oct, 12:51 pm", "Rejected by … —
  reason", "Sent by … — waiting for QC"; batch: "Decided by … — passed 8, rework 1, scrap 1"; older
  per-unit (non-step) jobs: "Passed by … · date".
- **Result box at the bottom** like the purchase one: "QC complete — all 2 units passed" (green), or
  "QC in progress — 1 of 2 units done" with each rejected step and its reason (red), inspector, started
  date and the last decision.

## Changed

`pages/quality-control/QCInspection.jsx` (row style, step row, Review / History dialogs,
`ProductionResultBox`), `components/qc/ChildPartUnitQCReview.jsx` and
`components/qc/SubChildPartBatchQCReview.jsx` (summary + who/when), `components/qc/qcStepMeta.js` (new,
shared who/when line).

## Checked

Builds (the page bundles with every import resolved). **Not yet clicked through in the browser** —
please check: QC-2026-0257 (approved purchase job: step row, History), an In Progress purchase job
(Review → checks → Pass / partial reject → dialog closes, page updates), QC-2026-0255 (summary, who/when
on rows, "QC complete" box), a job with a rejected step, a Sub Child Part batch job.
