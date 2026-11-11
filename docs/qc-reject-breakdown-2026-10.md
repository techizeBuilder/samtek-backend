# QC reject breakdown — what failed, how many, per fault

> **CHANGED 2026-10-30 (your browser test): ONE REJ per QC decision, the lines inside it.** The vendor
> answers for the whole rejection (replace / refund / credit / refused) — the lines are only the reasons.
> So "One REJ per line" below is replaced by: one REJ (one per request on a PO line, sharing the decision
> id) holding the lines; one "Record vendor's answer" (and "Record answer for all" on a PO line's
> decision); a "replace" makes ONE replacement for all its pieces (per size); a refusal counts once; the
> vendor / purchaser score still weighs each line by its own severity (it reads the lines). Tests 21/21.
>
> **BUILT 2026-10-30** (change report §68). Tests: pure 16/16; real multipart through the route 18/18;
> vendor email 6/6, item link 5/5, §67 production steps re-run; 0 left, test photos deleted.
> Browser check pending.

*Written 2026-10-30, from your browser test of §67 (REJ-0007 showed the photo and "shorter length"
but no failed check). Decided with you: severity per line, photos per line, purchase + store now
(production batch rework / scrap later), qty 1 = the checklist's Fail rows.*

## Why

A purchase / store delivery is checked as a **batch**: the checklist describes the lot (and is mostly
Pass — the accepted part is fine). When QC then rejects some pieces, they don't all fail for the same
reason, and none of it shows on the checklist. So the checklist can't be the rejection record for a
batch, and a single "reason" can't say "2 rusted, 1 too short". Purchase needs exactly that to talk to
the vendor.

## The rule

### More than one piece in QC — the reject breakdown
On **Reject**, QC adds **lines** (no separate reject-qty box):

| Line field | |
|---|---|
| **Qty** | how many pieces failed for this reason (or, for serial-numbered items, **which serials**) |
| **What failed** | a parameter from the job's checklist, or **Other** (typed) |
| **Remark** | what was wrong — required |
| **Severity** | Minor / Major / Critical (purchase) — weighs the vendor score |
| **Photos** | of this fault — optional per line, but a purchase rejection needs **at least one** in total |
| **Size** | fabrication with several sizes only — which size the pieces were |

- **Reject qty = the sum of the lines.** At most what's in QC.
- The checklist stays the lot's inspection — filled as usual; nothing has to be Fail on it.
- The remaining pieces stay in QC for their own decision, as today.

### One piece (qty 1 — a machine, or the last piece)
The **checklist is the record**: the rows QC marks **Fail** (each with its remark) are what failed — at
least one Fail row, or an **Other** line when the fault isn't on the checklist. One severity, photos
as today. No qty lines.

### What it makes — one REJ per line
Each line becomes its **own** Purchase rejection (REJ-…), so everything that already works per REJ
keeps working unchanged:
- its qty, money share, severity → vendor score, the vendor's answer (replace / refund / credit /
  refused), its replacement;
- the vendor can answer differently per fault (replace the rusted ones, refund the short ones).

The REJs of one QC decision share a **decision number**, and Purchase sees them **grouped** as one
rejection. On the QC job, each line is one partial-rejection entry (today a multi-size reject already
makes one entry per size).

**A PO line with several requests** (QC by PO line): the rejected qty is shared out across the requests
by today's rule (stock first, then production, sales orders last, newest first). The lines are walked
in the same order, so each request's REJs get their own lines — no line is counted twice.

**Snapshot:** every REJ keeps a copy of the checklist **as it stood at that decision** — Purchase's
"View QC checklist" shows it, unchanged by later edits.

## What Purchase sees (QC Rejections)

One block per QC decision:

> **QC-2026-0260 · 30 Oct · 3 pieces rejected** · PO-… · sujeet · View QC checklist
> - **2 × Rust** (Major) — rust patches on the outer wall · 2 photos · REJ-0008 · [Record answer]
> - **1 × length** (Critical) — shorter by 20 mm · 1 photo · REJ-0009 · [Record answer]

The failed parameter and remark are highlighted (red), each line with its own photos (open / Download).
The 6 pm vendor email lists the same lines with their photos.

## Worked example — 10 ms pipe in QC

| QC does | Result |
|---|---|
| Checklist: Rust Pass, length Pass (the lot). Reject: 2 · Rust · "rust patches" · Major · 2 photos; 1 · length · "shorter by 20 mm" · Critical · 1 photo | 3 rejected, 7 stay in QC. REJ-0008 (2, Rust, Major, 2 photos), REJ-0009 (1, length, Critical, 1 photo) — grouped |
| A line with no remark | refused: "Say what was wrong on each line." |
| Lines adding up to 11 | refused: "Only 10 are in QC." |
| No photo on any line (purchase) | refused: "Add at least one photo of the rejected material." |
| Later the 7 → Pass | approved; nothing else needed |
| A purchased machine (qty 1): Motor test **Fail** "no load current high", Major, 1 photo → Reject | one REJ: failed check "Motor test — no load current high" |

## What doesn't change
How a rejection is shared across requests, the money, the vendor score formula (it already reads each
REJ's qty + severity), the vendor's answer flow, replacements, Store's stock, the remaining-in-QC rule,
production's own rejections (units = Fail rows; batch rework / scrap gets lines in a later step).

## Build outline (after you agree)
1. Backend: decision takes `rejectLines: [{ qty | serials, parameter, other, remark, severity, size,
   photoIndexes }]`; photos uploaded once, each line points at its own; validation as above; one
   `partialRejections` entry + one REJ per line (shared `decisionId`, checklist snapshot); the PO-line
   share-out walks the lines; qty 1 keeps today's Fail-rows path.
2. Purchase: QC Rejections grouped by decision, highlighted lines, per-line photos, "View QC checklist".
3. QC Review: the breakdown editor (add line, pick parameter / Other, serial or size pickers, per-line
   photos, running total vs in QC).
4. Vendor email: lines with their photos.
5. Tests: the worked example; serials; multi-size; a PO line with two requests; qty 1; refused cases
   leave nothing.
