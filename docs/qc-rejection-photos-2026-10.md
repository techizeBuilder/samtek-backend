# QC rejection: photos + failed checkpoints, and one Review for every QC job

> **BUILT 2026-10-30 — all four slices** (who / one-go Review; photos + failed checks; Purchase QC
> Rejections + vendor email; Production). Tests: slice 1 13/13, slice 2 9/9 (real multipart through the
> route), slice 3 6/6 (fake mailer), §66 email test re-run 15/15; all 0 left, test photos deleted.
> Browser check pending — see "QC (2026-10-30)" in `procurement-v2/minimum-quotations-test-roadmap-2026-10.md`.

*Written 2026-10-30 (client, through you). Replaces the reverted "one look" try of 29 Oct
(`qc-one-look-2026-10.md`) — this is what the unified look is for.*

## Why

When QC rejects material, today only a typed reason travels on. The client wants:
1. **QC uploads photos** of the rejected material.
2. **The failed checkpoints** go with it — which checks failed, with QC's remark on each.
3. **Purchase → Purchase Orders → QC Rejections** shows both, photos downloadable, to share with the
   vendor; the 6 pm QC results email to the vendor carries them too.

For that, QC must record every check's Pass / Fail **with a remark, in the same step as the decision**.
The production Review dialog already decides in one go; the purchase / store page saves each check
separately (an extra Save per row) and decides apart from the checks.

## Decided with you

- Photos: **at least 1 required on a purchase rejection**; optional on every other rejection (my call —
  say if production / store should require one too). JPG / PNG / WEBP, up to 5, 10 MB each.
- Photos + failed checks on **every** QC rejection.
- The vendor email lists the failed checks and attaches the photos.

## The rules

**A "failed check"** = a checklist row QC marked **Fail** in that decision: its name, standard, actual
value and QC's remark. A rejection with no checklist (or no row marked Fail) has none — the reason
alone, as today.

**Remarks:** every check row has a Remarks box; **required when the row is Fail**, optional on Pass.

**One go:** the Review dialog sends the check results, the decision, the reason and the photos in one
request. If anything is refused (a Fail without remark, no photo on a purchase reject, a wrong qty), the
server saves **nothing** and any uploaded photo is deleted — the checks don't half-save.

**Where photos + failed checks are kept** (the place the reason is already kept):

| Rejection | Kept on |
|---|---|
| Purchase / store job — whole | the QC job |
| … partial (part of the qty / some serials / some sizes) | that partial-rejection entry |
| Purchase, any of the above | **also the REJ-… record** Purchase works from |
| PO line (one decision, several requests) | each request's REJ-… gets the same photos + checks |
| Machine's Sub Child Part | that part's entry |
| Production unit (no steps) | that unit |
| Unit's step / batch step (rework / scrap) | that attempt |

**Who sees them:**
- **QC:** the History dialog (every attempt / decision) shows photos and failed checks.
- **Purchase:** QC Rejections — each rejection lists "Failed checks" and shows the photos as thumbnails,
  each opens full size with **Download**.
- **Production:** where it sees the reject reason today (the Sub Child Part QC panel; the step's QC
  history), it also sees the photos and failed checks.
- **Vendor:** the 6 pm email — each "Not accepted" line lists its failed checks, and the photos are
  attached (named `REJ-0012-1.jpg` …). Rejections already emailed aren't sent again.

**What doesn't change:** how much is rejected and against which request, severity, the bill, the
ledger, the vendor score, QC Rejections' answer (replace / refund / credit / refused), production's
rework / scrap. Rejections made before this have no photos — shown as "No photos".

## The page — same look for every job

- **Purchase / store / other one-checklist jobs:** an **Inspection** card like Batch Steps: one step row
  "Inspection checklist" — status, who / when, **Review** and **History**.
- **Review** (purchase / store): each check — Pass / Fail, actual value when it's a measured check,
  **Remarks**; then **Pass** or **Reject**: reason, severity (purchase), reject qty / serials / sizes, the
  "counted against" preview, inspector remarks, **photos** (purchase: at least 1); **Save Decision**.
- **Production Review dialogs** (unit, step, batch, Sub Child Part): the same Remarks box on every row,
  and photos when rejecting / sending to rework or scrap.

## Who did it — from the login, never picked (added 2026-10-30)

Today **Start Inspection** has a dropdown of QC users — anyone can put anyone's name as the inspector,
and it's only a typed name. Production step / batch / part decisions already record the logged-in
person; purchase / store jobs and the check rows record nobody.

**Now:**
- **No inspector dropdown.** **Start Inspection** makes the **logged-in QC person** the job's inspector
  (one inspector per job — the one who started it). Production jobs: the first QC person to Review
  becomes the inspector if none yet.
- **Each check row records who checked it and when** — "Rust · Fail · rust on 3 pieces — checked by
  Amit · 30 Oct, 11:20". Several people can check one checklist.
- So the Review dialog has two buttons:
  - **Save checks** — saves the rows *this person* set; the decision waits (someone else can continue).
  - **Save Decision** — saves the rows and decides, in one go.
- A row's "checked by" changes only when someone **changes** that row (its Pass / Fail, actual value or
  remark) — re-saving doesn't take over another person's rows.
- **Every decision records the logged-in person** ("Decided by …"), purchase / store jobs too (today
  only their picked inspector name).
- The failed checks on a rejection (and in the vendor email / QC Rejections) carry who checked them.
- Older jobs keep their picked inspector name; their rows show no "checked by".

## Worked example — a purchase delivery of 10 Bolts, checklist "Thread", "Rust"

| QC does | Saved |
|---|---|
| Thread: Pass · Rust: **Fail**, remark "rust on 3 pieces"; Reject 3, reason "rusted", Major, 2 photos | REJ-0012: 3 Bolts, reason "rusted", Major, failed checks: **Rust — rust on 3 pieces**, 2 photos; 7 stay in QC |
| Reject without a photo | refused: "Add at least one photo of the rejected material." — nothing saved |
| Rust: Fail without a remark | refused: "Add a remark for each failed check." |
| Later: the 7 — both Pass → Pass | approved, no photos needed |
| 6 pm | the vendor's email: "Not accepted: Bolt 3 pcs — rusted · Failed: Rust — rust on 3 pieces", 2 photos attached |

## Build plan (after you agree)

1. **Backend — uploads:** `middleware/qcRejectionPhotoUpload.js` (images only, ≤ 5, 10 MB, nothing left
   on disk when refused). Decision routes accept multipart: the four decision routes (job, part, unit,
   batch step).
2. **Backend — one go:** `decideJob` / `decideLine` take `results` (each check's status, actual, remarks)
   and apply them before the "all checks decided" rule; part / unit / step / batch already take results —
   add remarks-on-Fail and photos.
3. **Backend — store:** `photos[]` + `failedChecks[]` on the QC job (whole reject), its partial-rejection
   entries, part / unit entries, step / batch attempts, and `PurchaseRejection`; `onMaterialRejected`
   copies them.
4. **Purchase:** QC Rejections list + rejection answer dialog show failed checks + photos (download).
5. **Vendor email:** `qcVendorEmailService` / `sendQcResultEmail` — failed checks per line, photos
   attached (at most 10 per email; the rest "more photos with our Purchase team").
6. **Frontend QC page:** the Inspection step card + Review (Save checks / Save Decision) / History for
   one-checklist jobs; Remarks box + photos + "checked by" in the production dialogs; the inspector
   dropdown removed — Start Inspection uses the login.
7. **Who:** `startInspection` takes the inspector from the login (no name from the page); check rows get
   `checkedBy` / `checkedAt`, stamped only on rows that changed; purchase / store decisions record
   `decidedBy` / `decidedAt` from the login.
8. **Production:** photos + failed checks where the reject reason is shown.

**Tests:** made-up company, fake vendor domain, fake mailer — the worked example; a partial and a full
purchase reject; a PO-line reject (both requests' REJ get the photos); refused cases save nothing and
leave no file; a unit-step reject and a batch scrap with photos; QC Rejections data; the vendor email
lists failed checks and attaches the photos once. Re-run the QC-by-PO-line and QC-rejection suites
(shared decision code changes).
