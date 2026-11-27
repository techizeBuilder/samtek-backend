# Feature 23: Photos / video at a step's finish (browser test)

*On test-1. What changed: [23-step-media-changes.md](23-step-media-changes.md). The suite `stepmedia` (39) already checks the rules; this is about the screens, a phone camera and real files. Before starting I take a snapshot of test-1; after the test the photos, videos and anything else the test made are removed, as for the imports.*

**Logins:** Production Head (finishes steps), QC (reviews), Company Admin (the clean-up page). A phone helps for section 1.

## 1. Finishing an ordinary step
1. Process Execution → an order with an in-progress ordinary step → **Mark Complete**.
2. The "When did … finish?" box has **Photos / video**.
   - **On a phone:** **Take photo** opens the camera (take 2), **Record video** records (5–10 seconds).
   - **On the PC:** **Choose files**.
3. Try a 6th photo or a 2nd video: *"Up to 5 photos." / "Up to 1 video."*
4. **Continue.** The step finishes at once; the corner box shows the upload percentage, then *"Photos / video attached to …"*.
5. **The step card:**
   - shows *"2 photos · 1 video"*; it opens them, photos full size and the video playing
   - **History** has *"2 photos and 1 video attached by (your name)"*
6. **Add photos / video** on that step: add one more photo. Remove it with 🗑 (your own).
7. **Start the next step.** On the earlier step, *Add photos / video* is gone and the 🗑 too.

## 2. Submitting a QC step
1. A step that goes to QC → **Submit to QC** with 2 photos.
2. **As QC → QC Inspection → the job → Review that step.** At the top:
   - **Production's photos / video:** the 2 photos
   - **From earlier steps of this unit** (folded): section 1's step and its files
3. **Reject** it. Production redoes it and submits again with 1 different photo.
4. **QC's Review:** only the new photo. **History:** attempt 1 with its 2, attempt 2 with its 1.
5. **Pass** it. Production's step card: *Add photos / video* is gone.

## 3. A failed upload
- Turn off the PC's network after **Continue**, or pick a large video on a slow connection and cut it off.
- The step stays finished; the message says *"… is finished, but the photos didn't upload … Add them from the step"*. *Add photos / video* works once the network is back.

## 4. The Company Admin's page
1. **Company Admin → Photos & Videos:** the cards show the space used; *"Can be deleted now"* is 0.
2. **I backdate** section 1's files to 3 months ago (a script). Refresh: they appear in the list, with the note *"Files from … onwards can't be deleted yet"*.
3. Open the row (it shows them), tick it → **Delete selected** → the confirm shows the space → **Delete**.
4. **Production's step card and QC's review:** *"… removed by (Company Admin) on … (to save space)"*. Section 2's files (new) are still there and aren't in the list.
5. **Delete all that match** with "Older than 2 months": nothing more is old enough.

## Log
| Step | Result | Notes |
|---|---|---|
| | | |
