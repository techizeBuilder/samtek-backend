# Feature 23: A photo or video when a step is finished, for QC (what changed)

*Built 23 November 2026, from the client's request the same day. Logic and your decisions (A–D as recommended; E changed: the Company Admin's clean-up page): [23-step-media-logic.md](23-step-media-logic.md). Browser test: [23-step-media-test-roadmap.md](23-step-media-test-roadmap.md).*

## In one line
When Production finishes a step it can attach **up to 5 photos and 1 video**. QC sees them on its review of that step, together with the earlier steps' photos. The Company Admin can delete old ones to free space.

## What Production sees (Process Execution)
- **The "When did … finish?" box** comes up for every finish: Mark Complete, Submit to QC, and the last step's Complete. It now has an optional **Photos / video** part:
  - **Take photo** and **Record video** open the camera on a phone; **Choose files** opens the gallery
  - thumbnails show before sending, each with ✕
  - limits: photos JPG / PNG / WEBP up to 10 MB each; a video MP4 / MOV / WEBM up to 100 MB (about a minute)
- **The step finishes first, then the files upload.** A small box in the corner shows *"Uploading photos for Welding… 45% · the step is already finished"*.
  - If the upload fails, the step stays finished, and the message says to use **Add photos / video** on the step.
  - If a cost dialog after the finish box is cancelled, the photos picked are dropped too.
- **On the step card:**
  - *"3 photos · 1 video"*, which opens them (by QC submission on a QC step); photos open full size, and the video plays in the page
  - **Add photos / video** while it's still allowed (decision C): until QC decides that submission (a QC step), or until the next step starts (an ordinary step). The last step allows 24 hours.
  - In the same window, the person who attached a file can remove it with a 🗑 on it.
- **The step's History** (feature 18) gets lines such as *"2 photos and 1 video attached by Ravi"* (tagged *QC submission 2* on a QC step) and *"1 video removed by … (to save space)"*.

## What QC sees (QC Inspection)
- **Reviewing a submitted step** (a Child Part / Machine unit, or a Sub Child Part batch), a box at the top shows:
  - **Production's photos / video:** the ones sent with *this* submission. A redo's photos are the redo's, not the first try's.
  - **"From earlier steps of this unit"** (folded), e.g. *Cut (2 photos · 1 video) · Weld (1 photo)*, so at Final QC work that's now hidden can still be seen.
- **History:** each attempt shows the photos Production sent with it.

## The Company Admin's page (decision E, your change)
**Company Admin → Photos & Videos** (new menu item):
- **Cards:** space used, videos, photos, and **"Can be deleted now"** (files uploaded before the date two calendar months ago).
- **A note:** *"Files from 23 Sep 2026 onwards can't be deleted yet (the last two months stay)."*
- **The list:** one row per step finish (order, unit, step, QC submission), oldest first, 20 per page (read page by page from the server).
  - **Filters:** older than 2 months / 6 months / 1 year; videos / photos / both; order number.
  - A row's *"2 photos · 1 video"* opens them.
- **Deleting:**
  - tick rows, then **Delete selected**; or **Delete all that match** the filters
  - a confirm box shows the number of files and the space freed
  - **the server re-checks the two-month rule**, so a newer file is never deleted, whatever is sent
- **Only the files go.** QC and Production see *"1 video removed by … on 5 Feb (to save space)"* where they were.

## Who can do what
| | Attach / remove own | See | Delete old (page) |
|---|---|---|---|
| Production with Orders "edit" | ✓ | ✓ | |
| Production with Orders "view" | | ✓ | |
| QC with QC Inspection "view" | | ✓ | |
| Company Admin | | ✓ | ✓ |
| Anyone else | | refused | |

## Found and fixed on the way
**Names on the files:** the login only carries the username, so "uploaded by" would have shown e.g. *rahul*. The service reads the person's full name, as feature 18's History does.

## For the live server
Videos go up to 100 MB. If the live server sits behind **nginx** (or a similar proxy), its upload limit must allow that, e.g. `client_max_body_size 110m;`. Otherwise the proxy refuses videos before the app sees them. The upload then shows *"The server refused a file this big."*

## Technical notes
**Server, new:**
- **`models/StepMedia.js`:** one record per file, in its own collection (nothing is added to the production order).
  - order / unit / step / category / step name / QC attempt
  - kind, url, file name, size
  - uploader (id + name)
  - `deletedAt` / `By` / `ByName` for the clean-up note
  - indexes `{ order, unitIndex, stepIndex }` and `{ company, deletedAt, createdAt }`
- **`middleware/stepMediaUpload.js`:**
  - disk storage in `uploads/step-media/`, field `files` (6 at most)
  - types and per-kind sizes; 5 photos / 1 video per request
  - whatever a refused request wrote is deleted (the `qcRejectionPhotoUpload` pattern)
- **`services/stepMedia/stepMediaService.js`:**
  - **`mediaWindow`** (decision C, from the step statuses): QC Pending = open; an ordinary Completed step = open while the next step is Pending, or the last step for 24 h; outsourced steps never
  - **`addMedia`:** the QC attempt waiting for a decision (looked up in the QC job's `batchSteps` / `unitChecks[].steps`), then the 5 + 1 count across the finish
  - **`removeOwn`**, **`unitMedia`** (a unit's files and steps), **`stepSummary`** (for the crew read)
  - **admin:** `adminSummary`, `adminList` (an aggregation grouped by finish, `$facet` pages), `adminDelete` (batches of 200; cutoff = the later of the chosen age and two calendar months, India date)
- **`controllers/stepMediaController.js`**, **`routes/stepMedia.routes.js`** (`/api/step-media`):
  - `GET /order/:orderRef?unit=`: Production orders view, QC inspection view, or the Company Admin
  - `GET /admin/summary`, `GET /admin/list`, `POST /admin/delete`: the Company Admin

**Server, changed:**
- **`routes/productionMfgRoutes.js`:** `POST` / `DELETE /orders/:id/processes/:stepIndex/media` (Orders "edit").
- **`services/crew/crewService.js`:** `stepCrewView` returns `media` (counts, a short list, `canAdd` / `why`). One indexed read per step card.
- **`models/QCJob.js`:** a new index `{ company, sourceRefId }`. The order's QC job lookup, used here and by the production controller, was only indexed by source.
- **`index.js`:** mounts `/api/step-media`.

**Screens:**
- **New `components/stepMedia/`:** `StepMediaPicker`, `uploadStepMedia` (XHR with progress), `StepMediaViewer` (+ `useUnitMedia`), `AddStepMediaDialog`, `StepMediaLine`, `QcStepMedia`.
- **`pages/production/ProcessExecution.jsx`:**
  - the picker in the finish box
  - a queue flushed by each finish's success path (Mark Complete, the last-in-house cost dialog, Submit to QC batch / unit, the last step's Complete) and dropped when a cost dialog is cancelled
  - the upload box in the corner
- **`contexts/ProductionContext.jsx`:** `markProcessComplete` returns a promise (null on failure; its toast is unchanged).
- **`components/production/StepCrew.jsx`:** the photo line, and History events.
- **QC:**
  - `components/qc/ChildPartUnitQCReview.jsx` and `SubChildPartBatchQCReview.jsx` (review and History)
  - `pages/quality-control/QCInspection.jsx` passes the order number
- **New `pages/hrms/CompanyAdmin/StepMedia.jsx`;** the menu item in `config/moduleRoutes.js`; the route in `App.jsx`.

## Tests
**New suite `stepmedia`, 39 of 39,** through the real server, on made-up companies with `.invalid` emails:
- **Upload:**
  - refused before the step is finished (nothing left on disk)
  - 2 photos + a video on a finished ordinary step: files on disk, no attempt, the person's full name
- **Limits, each refused with nothing left on disk:** a 2nd video; 2 + 4 photos; a PDF; a 10.5 MB photo; 6 photos at once. QC can't upload (403).
- **Removing:** someone else is refused; the uploader removes it, and the record and file are gone.
- **A QC step:**
  - once the next step is submitted, the earlier step closes for both adding and removing
  - the submission waiting gets attempt 1; Machine unit 2 is linked to unit 2
  - refused during the redo; the resubmission gets attempt 2 with its own 5 + 1
  - refused after QC decides
- **Ordinary steps:** the last step is open 2 h after the finish and refused after 30 h; a step whose next step is done is refused.
- **Reading:**
  - QC reads by order number (4 steps, files by attempt); the Company Admin reads by id
  - a Store user gets 403; another company gets 404
  - the step card's crew read carries the counts and "QC has already decided"
- **The Company Admin:**
  - Production Head gets 403
  - summary 8 files / 3 deletable
  - the list oldest first, the 6-month filter, videos only, order search
  - deleting a new finish deletes nothing
  - deleting an old one removes 2 files from disk and keeps 2 notes, read as "removed by …"; the step card shows 2 removed
  - "delete all that match"; Production Head can't delete

**Regression, all passing:** `stephistory` 18, `stdprod` 52, `crew` 67, `teamcover` 29, `planboard` 30, `ordertrack` 70, `scorecard` 113.

**Checks:** the server files pass the strict ES-module syntax check and the routes load. The screens compile, and the three changed pages bundle with every import found.
