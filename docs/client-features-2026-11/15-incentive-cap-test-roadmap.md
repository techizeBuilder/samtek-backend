# Feature 15: The incentive cap (browser test)

*On test-1. What changed: [15-incentive-cap-changes.md](15-incentive-cap-changes.md). The suite `inccap` (40) already checks the sums; this is about the screens.*

**Who plays whom:**
- **Company Admin:** sets the cap, decides above it
- **HR-Admin** (`testhr`)
- **Production Head** (`testproductionhead`)

**Note:** Test Worker Two has **₹500 approved for November**. Of the two ₹500 gives on 18 Nov, the second was deleted at your ask.

## 1. Set the cap
1. Company Admin → **Performance Settings**.
   - The new box "Incentives HR can approve alone" is empty (no limit).
   - The top line says "no limit".
2. Enter **1000**, set **Applies from November 2026**, then **Save**.
   - The top line now says "up to ₹1,000 per person".
   - The history has a **Cap** column: ₹1,000 on the new row, "no limit" on the older ones.
3. Try **1000.5**, or a negative number. Save stays disabled, with "Whole rupees, 0 or more, or empty."

## 2. HR under and over the cap
1. HR → Employee Performance → **Give incentive** on a worker with nothing approved this month, e.g. Test Worker Five.
   - Month: November. The line under the amount reads "up to ₹1,000 … ₹0 already approved".
   - Type **600**. The button says **Give**. Give it → "Given directly".
2. Give Test Worker Five **₹500** more.
   - The line turns amber ("… ₹600 already approved … above it"), and the button says **Send to Company Admin**.
   - Send it. The row reads **"Waiting for Company Admin"**, ₹500 "proposed by …", and HR sees "Company Admin decides" with no buttons.
3. On Test Worker Two (₹500 already approved): ₹500 shows "Give" (at the cap); ₹501 shows the amber line.

## 3. A Production request above the cap
1. Production Head → Manpower → Scores → **Request incentive** on Test Worker Three, suggesting ₹1,500 → Send to HR.
2. HR → Incentives → Waiting for a decision → **Approve**, ₹1,200.
   - The button says "Send to Company Admin".
   - The row moves to "Waiting for Company Admin".
3. The Production Head's bell: "Incentive sent to the Company Admin". Their list shows "Waiting for Company Admin", "₹1,200 approved by HR, above the cap".

## 4. The Company Admin decides
1. Company Admin → the bell "Incentive above the cap — …" → Employee Performance → **Incentives**.
   - It opens on "Waiting for Company Admin (2 waiting)".
2. **Approve** Test Worker Three's, changing it to ₹1,100.
   - The box explains the cap and what was already approved.
   - The line says "No cap for the Company Admin".
   - The row becomes Approved ₹1,100. HR's bell and the Production Head's bell say approved.
3. **Reject** Test Worker Five's ₹500 with a reason. HR's bell says not approved.
4. Payroll: Test Worker Three's November payroll preview shows the ₹1,100 incentive. Test Worker Five's shows only ₹600.

## 5. Put it back (optional)
- Company Admin → Performance Settings → empty the cap (or Client's defaults) → Applies from November → Save. The history shows "no limit" again.

## Log
| Step | Result | Notes |
|---|---|---|
| 1 | **Passed** 18 Nov (re-saved from November: "Saved. From November 2026, scores use these points and the incentive cap is ₹1,000 per person"; history row November 2026 · ₹1,000) | The box shows "no limit"; 1000.5 and -5 disable Save with "Whole rupees, 0 or more, or empty."; ₹1,000 saved, and the history's Cap column shows ₹1,000 on the new row and "no limit" on the older ones. The first save kept the default "Applies from" (December), so November still had no limit; re-saved for November. **Changed:** the saved message now names the cap too ("From {month}, scores use these points and the incentive cap is …"). |
| 2 | **Passed** 18 Nov | HR gave Test Worker Five ₹600 ("₹0 already approved", button Give) → "Given directly". ₹500 more: the amber line "₹600 already approved … above it, so the Company Admin decides", button "Send to Company Admin" → the row "Waiting for Company Admin", ₹500 "proposed by rahul", "Company Admin decides" with no buttons. Test Worker Two (₹500 approved): ₹500 keeps Give (at the cap), ₹501 turns amber. "Asked by" now shows the full name (rahul); the older row keeps "testhr". |
| 3 | **Passed** 18 Nov | The Production Head requested ₹1,500 for Test Worker Three ("good performance", Score then 87.7 A). HR → Approve ₹1,200: amber "₹2,000 already approved … the Company Admin decides", button "Send to Company Admin". The Production Head's bell: "Incentive sent to the Company Admin — rahul approved ₹1,200 for Test Worker Three…"; their list: "Waiting for Company Admin · ₹1,200 approved by HR, above the cap". HR's tab showed "Incentives (1 waiting)". **Fixed:** on Production's list, HR's own direct give (Test Worker Five ₹500) said "approved by HR"; it now says "proposed by HR". |
| 4 | **Passed** 18 Nov; **fixed** | Company Admin → Incentives opened on "Waiting for Company Admin", tab "(2 waiting)"; rows "₹1,200 approved by rahul" (Three) and "₹500 proposed by rahul" (Five). Approve box: "rahul approved ₹1,200. That's above the cap of ₹1,000 (₹2,000 already approved that month), so it waits for you."; "No cap for the Company Admin." Approved ₹1,100 → HR's and the Production Head's bells: "Rahul Pramanik approved ₹1,100 for Test Worker Three…". Rejected Five's ₹500. **Bug found:** HR got two "not approved" bells for Five (one as sender, one as the direct give's "requester", the second tagged production). **Fixed:** a direct give tells only the HR person who sent it. `inccap` 42 (+2), `incentive` 50. |
| 4.4 | **Passed** 18 Nov | Payroll Run, November (not run yet): Test Worker Three incentive ₹3,100 (₹2,000 + the Company Admin's ₹1,100), Test Worker Five ₹600 (the rejected ₹500 not paid), Test Worker Two ₹500. The Five reject reason "No cap for the Company Admin" was typed by the tester. |
| — | **Browser test COMPLETE 18 Nov** | Step 5 (clearing the cap) skipped by choice: test-1 keeps the ₹1,000 cap from November. |
