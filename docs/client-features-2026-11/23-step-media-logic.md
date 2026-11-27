# Feature 23: An optional photo or video when a step is finished, for QC to see

*Client request, 23 November. Logic for discussion; nothing built yet.*

## What was asked
When Production finishes a process step, they can **attach a photo or a video** (optional). **QC sees it.**

## How a step is finished today
| The step | Production presses | Then |
|---|---|---|
| An ordinary step | **Mark Complete** | the step is done |
| A step R&D ticked for QC | **Submit to QC** | QC opens its review, fills the checklist, decides Pass / Reject (or Passed / Rework / Scrap for a Sub Child Part batch). A redo comes back as a new *attempt* |
| The last step | **Complete** with the cost / expense dialog | stock or the sale is credited |
| An outsourced step | nothing (Purchase sends it, Store receives it) | |

**Already there for QC:** QC attaches photos when it **rejects** (October). They're shown on the attempt in QC's History.

**Not there:** nothing lets **Production** attach anything.

## The proposal
**1. At the finish:** the Mark Complete, Submit to QC and last-step dialogs get an optional **"Photos / video"** box.
- On a phone it offers **Take photo**, **Record video** or **pick from the gallery**.
- Thumbnails show before sending, each with ✕ to drop it.

**2. QC sees it on its review of that step:**
- **The submission's own photos and video**, at the top of the review, opening full size; the video plays in the page.
- **"From earlier steps of this unit"**, folded: e.g. *Welding: 3 photos · Grinding: 1 video*. At Final QC this shows work that is now hidden (welds under paint, parts inside a body).
- **QC's History** shows each attempt with the photos Production sent with it. A redo's photos stay with the redo, the first submission's with the first.

**3. Production sees it on Process Execution:**
- A finished step shows *"3 photos · 1 video"*, opening the same viewer.
- The step's **History** (feature 18) gets a line: *"2 photos and 1 video attached by Ravi"*.

**4. Forgot to attach?** An **"Add photos / video"** link stays on the finished step for a while (question C).

**How it stays fast and safe:**
- **Photos and videos aren't stored on the order.** They're kept in their own small records (order, unit, step, attempt, file), read only for the step being looked at, so page loads don't get slower.
- **The finish doesn't wait for the upload.** The step is finished first, then the files upload with a progress bar, so a slow phone connection never holds up the step.
  - If the upload fails, the step is still finished, and the message says *"Step finished, but the photos didn't upload: add them from the step."*
- **The files go in their own folder on the server**, like QC's rejection photos (unguessable file names).

## Questions for you
- **A. Which finishes offer it?**
  - (a) **every in-house step's finish:** Mark Complete, Submit to QC and the last step (recommended). QC reads the ordinary steps' photos through "From earlier steps".
  - (b) only Submit to QC
- **B. How much per finish?**
  - (a) **up to 5 photos and 1 video** (recommended):
    - each photo is a JPG, PNG or WEBP, **up to 10 MB**
    - the video is an MP4, MOV or WEBM, **up to 100 MB**, about a minute of phone video
  - (b) photos only
  - (c) other numbers you give
- **C. Adding or removing after the finish:**
  - (a) **"Add photos / video" stays until QC has decided that submission** (a QC step), **or until the next step starts** (an ordinary step). In the same window the person who uploaded a file can remove it. After that it's fixed, as evidence (recommended).
  - (b) only in the finish dialog, never after
- **D. What QC sees:**
  - (a) **the submission's own media, plus "From earlier steps of this unit"** (recommended)
  - (b) only the submitted step's own
- **E. Keeping the files:**
  - **Videos are large.** 200 videos of 100 MB is 20 GB on the server.
  - (a) **keep everything for now;** decide a clean-up rule (e.g. delete videos some months after the order is delivered) when the client wants one (recommended)
  - (b) a clean-up rule now (say the period)
  - **Note for the live server:** if it sits behind nginx or similar, its upload size limit (often 1 MB by default) must allow 100 MB, or videos will be refused there even though they work here.

## Your decisions (23 Nov)
- **A (a), B (a), C (a), D (a):** as recommended.
- **E changed (your adjustment): a page where the media can be deleted, except the last two months.**
  - **Who:** the **Company Admin** (you left it to me).
    - The photos and videos are QC's evidence of Production's work, so the people who upload them shouldn't be the ones removing them.
    - Server space is a company matter.
    - The Company Admin already approves standard hours and incentives above the cap.
  - **Where:** Company Admin → **Photos & Videos** (a new page in the Company Admin menu).
  - **What it shows:**
    - **Space used:** in all, photos and videos, and how much of it can be deleted now.
    - **Only what can be deleted:** files uploaded **more than two calendar months ago** (on 23 Nov: uploaded before 23 Sep). A line says *"Files from 23 Sep onwards can't be deleted yet."*
    - **One row per step finish:** order number, product / part, unit, step, attempt, uploaded when and by whom, *"3 photos · 1 video"*, size. A row opens the viewer.
    - **Filters:** older than 2 months (default) / 6 months / 1 year; videos / photos / both; order number search.
    - **Pages of 20, read page by page from the server,** so the list stays fast however many files pile up.
  - **Deleting:**
    - tick rows, then **Delete selected**; or **Delete all that match** the filter (e.g. *all videos older than 6 months*)
    - one file can also be deleted from the viewer
    - a confirm box shows what will go and the space freed: *"Delete 14 videos (1.2 GB)? This can't be undone."*
  - **The two-month rule is checked by the server too,** so a file newer than two months is never deleted, whatever the screen sends.
  - **Only the files go; a short note stays.** Where they were, QC's review and Process Execution show *"1 video removed by the Company Admin on 5 Feb (to save space)"*. That way nobody thinks the photos were never taken.
  - **Only Production's step photos and videos.** QC's own rejection photos and other files aren't on this page.

## Not included
- **Outsourced steps.** Production doesn't finish them; Purchase and Store handle the hand-off. Photos from the vendor would be a separate request.
- **QC's own rejection photos.** Unchanged, and kept separate from Production's.
