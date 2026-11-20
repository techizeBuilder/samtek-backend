# Feature 12: Order tracker (browser test)

*Written 14 November 2026, company test-1 on dev. What changed: [12-order-tracker-changes.md](12-order-tracker-changes.md).*

## Logins
- **Complaint Head:** `test complaint head`
- **Complaint Employee:** `testcomplaintemployee@gmail.com`
- **Sales Head:** `testsalesadmin`
- **A Sales Employee,** for the "no permission" check: `testsalescruncher@gmail.com`

The permission was given to the first three when the server started (checked 14 Nov).

## Steps
### 1. Where it is
1. Log in as the **Complaint Head** and open the menu.
   - [ ] **Order Tracking** comes after Deal Verifications.
2. Open it.
   - [ ] The title is *"Order Tracking: where a customer's order is, and what to tell them."*
   - [ ] The list shows **On their way**, newest first, 20 a page, with the page count at the bottom.

### 2. The list
1. Rows to find on the first page:
   - [ ] **ORD-0127:** "In work", promised 30 Oct, **15 d late** in red.
   - [ ] **ORD-0124:** "Final QC", no date.
   - [ ] **ORD-0121:** "Verified" (its order form isn't submitted).
2. **Delivered.**
   - [ ] Delivered orders such as ORD-0130 and ORD-0129.
   - [ ] Some older ones (e.g. **ORD-0090**) show "Packing" with a grey **"Marked completed"** flag: marked completed by hand, though their records stop at packing.
3. **All.**
   - [ ] **87 orders.**

### 3. Search
1. Back on **On their way**, type `ORD-0127`.
   - [ ] Just that order.
2. Type `PROD-2026-278970` (its production order number).
   - [ ] ORD-0127.
3. Type a customer's mobile number or name from any row.
   - [ ] Their orders.
4. Type `(`.
   - [ ] "No order matches", no error.

### 4. An order waiting for material: ORD-0127
1. Open **ORD-0127**.
   - [ ] **Header:** the customer and mobile, "Ordered …", **"Promised 30 Oct · 15 days late"** in red, chips "Deal verification: verified" and "Payment check: pending".
   - [ ] **The stage bar** is at **In work** (amber); Placed, Verified and Order form are done.
   - [ ] **Blower Pulverizer × 1, "Tell the customer":** *"It's being prepared for production; materials are being arranged."*
   - [ ] **For the team:** PROD-2026-278970, steps done 0/4; "Part Fan: ORD-2026-087 · delivered"; *"assemble — Cannot start process: All required materials have not been issued yet."*
2. Click the **copy** button next to the sentence.
   - [ ] "Copied".

### 5. Waiting for a part: ORD-0119
1. Back to the list → open **ORD-0119**.
   - [ ] *"It's being prepared for production; one of its parts (Fan) is being made first."*
   - [ ] **For the team:** PROD-2026-296498, steps done per unit 0/3, 0/3; "Part Fan: ORD-2026-069 · 1 of 5 steps".

### 6. Other stages
- [ ] **ORD-0124:** *"It's ready in stock and going through our final quality check."* Team detail: "QC job QC-2026-0209: In Progress".
- [ ] **ORD-0122:** two items, both *"It's packed and ready for dispatch."* Packing 1 of 1, and 2 of 2.
- [ ] **ORD-0120:** *"It's being packed."* (Packing: 0 of 2 packed.)
- [ ] **ORD-0125:** both items: *"It's being prepared for production."* Team detail: *"…no production order was found for it. Ask Production."*
- [ ] **A delivered order** (from Delivered, e.g. ORD-0130): *"It was delivered on …"* with the installation line, and the stage bar all done (green).

### 7. Enquiry notes
1. On **ORD-0127**, under **"What the customer was told"**, type: `Customer called; told materials are being arranged, will update by Monday.` → **Add note.**
   - [ ] "Note saved". It shows the time, your name and *"at In work"*.
2. Try to add an empty note.
   - [ ] **Add note** stays disabled.
3. Log in as the **Complaint Employee** and open ORD-0127 (`/complaints/order-tracking?order=ORD-0127`).
   - [ ] The Head's note is there, and the note box too.

### 8. Sales Head (view only)
1. Log in as **`testsalesadmin`** → menu → **Order Tracking** (`/sales/order-tracking`).
   - [ ] The same list.
2. Open ORD-0127.
   - [ ] The note is visible, but **there's no note box.**

### 9. No permission
1. Log in as the **Sales Employee** and open `localhost:5173/sales/order-tracking`.
   - [ ] **No menu item.** The page says *"You don't have the Order Tracking permission. Ask your Company Admin."*

### 10. Roles & Permissions
1. As **Company Admin** → Roles & Permissions → a Complaint user → the **Complaint Management** module.
   - [ ] **Order Tracking** is listed.
2. A Sales user → the **Sales** module.
   - [ ] **Order Tracking** is listed. On the Sales Head, only View is ticked.

## Not needed on screen
The `ordertrack` suite covers:
- **Every stage's sentence:** buying with the PO date, at a partner workshop, being made (2 of 4), failed final QC, dispatched with vehicle and tracking, 1 of 2 machines ready.
- **Sentence safety:** no customer, staff or reject text in any sentence.
- **Notes:** the 500-character limit; the stage and author saved.
- **Another company's orders:** never shown (404).
- **The one-time permission grant:** once only; a permission removed afterwards stays removed.

## Automatic results
| Suite | Result |
|---|---|
| `ordertrack`, new | 69 of 69, 0 left behind (65, then 3 for the counts per tab, 1 for date-only timeline entries) |
| `planboard` (shares `holdOf`) | 26 of 26 |
| `hrperms` (permission catalogue changed) | 33 of 33 |

## Browser results
**14 Nov 2026, test-1, Complaint Head:**
- **Steps 1, 3 and 4 passed:**
  - **The list:** ORD-0131 Packing; ORD-0128 Packing, 20 d late; ORD-0127 In work, 15 d late; ORD-0126 Packing, 17 d late; ORD-0125 In work, 15 d late; ORD-0124 / ORD-0123 Final QC; ORD-0122 Packing.
  - **Search:** PROD-2026-278970 → ORD-0127.
  - **ORD-0127:** "Promised 30 Oct · 15 days late"; deal verification verified, payment check pending; the bar at In work; *"It's being prepared for production; materials are being arranged."*; the three team lines; a timeline of 3 events.
- **Step 7.1 passed:** a note on ORD-0127, saved at 17:50 with the author's name and "at In work".
- **Step 2 passed:**
  - **Delivered:** ORD-0130 and ORD-0129 Delivered, the bar all green; ORD-0090 "Packing" with the grey "Marked completed" flag.
  - **All:** 87 orders · page 1 of 5. ORD-0130 / ORD-0129's promised dates aren't marked late.
- **Step 6 passed for:**
  - **ORD-0124:** final QC, "QC job QC-2026-0209: In Progress"
  - **ORD-0122:** both items packed (1 of 1, 2 of 2)
  - **ORD-0120:** being packed, 0 of 2; its timeline shows "production started (PROD-2026-733365)"
  - **ORD-0125:** both items "being prepared for production" + "ask Production"
- **Found and fixed (same pattern as Production → Orders):** searching ORD-0130 on **On their way** said "No order matches", because it's delivered. Now, while searching:
  - each tab shows its count
  - if only another tab has the order, the page opens it with a note: *"No order on its way matches "ORD-0130", so this is Delivered, where it was found."*
  - **Re-check passed:** ORD-0130 on On their way → Delivered, with the note and counts 0 · 1 · 1.
- **Step 6, ORD-0130 passed:** *"It was delivered on 5 Nov. Installation is done."* The bar is complete; "Promised 25 Nov" in green; two dispatch lines with vehicle, tracking, dates, "customer: Reached Safely", "installation: Completed 7 Nov".
  - **Fixed:** the timeline showed "5 Nov, 05:30" for dispatch and delivery. Those records hold a date only, so 05:30 was invented (midnight UTC in India time). They now show the date alone.
- **16 Nov, step 7.3 passed (Complaint Employee):** ORD-0127 shows the Head's note ("14 Nov, 17:50 · max · at In work") and the note box. The late count moved on by itself: "30 Oct · 17 days late".
- **16 Nov, step 8 passed (Sales Head, `testsalesadmin`):** the same order and note, **no note box**.
- **16 Nov, step 9 passed:** the Sales Employee (`testsalescruncher@gmail.com`) gets the app's own **Access Denied** page at `/sales/order-tracking`. The app's page guard stops it before the tracker's own message is needed.
- **16 Nov, step 10:**
  - **Complaint user:** Order Tracking is listed (View + Add).
  - **The Sales dialog opened was `testsalescruncher` (Sales Employee):** Order Tracking listed, all off. That's right for them.
  - **`testsalesadmin`:** has Order Tracking: View stored (checked on the server).
- **16 Nov, the date-only fix didn't work at first:** its check had lost its backslashes (`/^d{4}…/`), so nothing matched.
  - **Fixed.** Date-only events (dispatch, delivery) now show the date alone, and sort at the end of their day: after production started 10:35 and packed 10:40 on 5 Nov, not before.
  - Suite `ordertrack` 69 (one new check).
- **16 Nov, the date-only re-check passed:** on ORD-0130 the line after "Order form submitted" is now "5 Nov, 10:35 production started", where before a "5 Nov, 05:30 dispatched" came first.
- **The whole roadmap passed, 16 Nov.** Not covered on screen: a cover's step on the Work Planning printout (feature 11's note) and the cases the suite covers (see "Not needed on screen").
- ~~Still to do (next session):~~ done 16 Nov:
  - steps 7.3 (Complaint Employee sees the note), 8 (Sales Head view-only), 9 (Sales Employee refused) and 10 (Roles & Permissions)
  - a look at the date-only timeline entries
- **Step 5 passed:** ORD-0119: *"It's being prepared for production; one of its parts (Fan) is being made first."* For the team: PROD-2026-296498, 0/3 and 0/3 per unit; "Part Fan: ORD-2026-069 · 1 of 5 steps"; Start's material message.
