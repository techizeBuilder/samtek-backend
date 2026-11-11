# Feature 2, stage 3: Payroll (browser test)

*Written 11 November 2026, company test-1 on dev. What changed: [02c-payroll-changes.md](02c-payroll-changes.md). Log in as HR-Admin **rahul** unless a step says otherwise.*

**Before you start, about email.** Two steps send real email:
- **Step 4,** adding leave, emails the worker. Rahul Pramanik (`EMP-TES-0039`) has the gmail address you typed when you created him.
- **Step 8,** generating payslips, emails each person paid. test production employee has a gmail address.

If those addresses aren't yours, change them to a fake one first, such as `worker1@example.invalid`, or skip step 8. The `payroll` suite already checks payslip numbers.

**The people used:**
- **Rahul Pramanik** (`EMP-TES-0039`, Manpower, no login, device code `0001`, joined 6 Nov). Made-up device days: **7 Nov half day, 8 Nov (Sunday) Absent, 9 Nov Present, 10 Nov (Tuesday) device weekly off, 11 Nov Present.**
- **test production employee** (`EMP-TES-0024`, device code `0099`, joined 1 Jun). **9 and 10 Nov Present** from the device, **11 Nov Present** by correction.

## Steps

### 1. Weekly off on the Attendance Policy
1. **HR Policy** in the left menu → **Attendance Policies** tab.
   - [ ] A new **Weekly Off** card says **Sunday**.
2. **Edit Policy.** At the bottom, under **Weekly Off**, Sun is blue. Click **Sat** too and **Save Changes**.
   - [ ] The card says **Sunday, Saturday**.
3. Edit again, click **Sat** off, and save.
   - [ ] Back to **Sunday**.

### 2. A leave type for the company
1. **Leave Management → Leave Types & Rules.** Add **Casual Leave**, code `CL`, max days `10`, **Paid**. If test-1 already has one, skip this.

### 3. Holidays, as a range
1. **Holidays** → add one. Title `Test Holiday`, **From** `05-11-2026`, **To** `06-11-2026`, pay **Unpaid**. Save.
   - [ ] The message says **2 holidays added.**
   - [ ] The list has two rows, 5 and 6 November, each with a grey **Unpaid** badge.
2. Edit the **5 November** row, choose **Paid**, and Update.
   - [ ] The 5 November row's badge is green **Paid**. The 6 November row stays **Unpaid**.
3. Add again: From `06-11-2026`, To `06-11-2026`.
   - [ ] Refused: **That date is already a holiday.**

### 4. Add leave for a worker with no login
1. **Leave Management → Leave Requests** → **Add leave for someone** (blue button, top right).
2. Type `0039` in Person and pick **Rahul Pramanik · no login**. Choose Casual Leave, **From** and **To** `07-11-2026`, reason `told the supervisor`. **Save as approved.**
   - [ ] A row for Rahul Pramanik, 07 Nov, **Approved**.
3. Do it again for the same day.
   - [ ] Refused: **This person already has leave on some of these days.**

### 5. Salaries
**Payroll → Salary Structure.** Add the same salary for **Rahul Pramanik** (the worker) and **test production employee**:
- **Basic** 12,000, **HRA** 2,400, **Other Allowance** 1,200, **PF** 1,440, **Professional Tax** 200.

### 6. Payroll Run, November (not over yet)
**Payroll → Payroll Run.** It opens on **October**, so switch the month to **November 2026**.
- [ ] An amber note: **November 2026 isn't over yet, so this is pay so far.** The orange button is grey and says **Run after month ends.**
- [ ] Rows for Rahul Pramanik and test production employee only. Below the table: **Not paid: no salary entered (30)**.
- [ ] **Working days 25** for both: 30 days, minus Sundays 1, 15, 22 and 29 and **Tuesday 10 Nov**, the device's weekly off for the worker. For test production employee, the 5 off days are the Sundays with no device row.
- [ ] Click **Rahul Pramanik's** row. As of 11 November:
  - **Before joining:** 2, 3, 4, 5
  - **Weekly off:** 1, 10, 15, 22, 29
  - **Unpaid holiday:** 6
  - **Half day:** 7. It's a full pay day, because of the leave in step 4.
  - **Absent:** 8. The device said Absent on that Sunday, so it isn't a weekly off.
  - **Present:** 9, 11
  - **Still to come:** the rest
  - **Totals:** pay days **3**, loss of pay **1**.
- [ ] Click **test production employee's** row:
  - **Paid holiday:** 5
  - **Unpaid holiday:** 6
  - **Absent:** 2, 3, 4, 7, because there's no device row and no leave
  - **Present:** 9, 10, 11
  - **Totals:** pay days **4**, loss of pay **4**.
- [ ] Open **How pay is worked out** above the table and switch **English ↔ Hinglish**.

Each day after 11 November that passes adds an **Absent** day, because no device sends rows on dev. So the numbers grow if you test later.

### 7. Payroll Run, October (finished)
Switch the month to **October 2026**.
- [ ] No amber note. The button says **Run Payroll (1)**.
- [ ] Only **test production employee**: **27 working days, 0 pay days, 27 loss of pay**, net **₹0**. There's no October attendance on dev. Rahul Pramanik isn't listed, because he joined in November.
- [ ] Click **Run Payroll** and confirm. The row says **Paid**, and the button says **Processed**.

### 8. Payslip (optional, see the email note at the top)
**Payroll → Payslips**, month **October 2026** → **Generate Payslips**.
- [ ] A payslip for test production employee. **Download** the PDF: **Pay Days / LOP** says **0 / 27**, not 30 / 0.

## Not needed on screen
The `payroll` suite covers:
- The four hand-worked months, to the rupee.
- A company of 44, paging and search.
- Saturday as a weekly off changing an office worker's pay.
- Unpaid leave.
- A second run changing nothing, and numbers sent by the screen being ignored.
- Reject, then recalculate.
- Over-balance leave, leave for yourself, and another company's HR being refused.
- Holiday ranges over 62 days, and To before From.

## Automatic results
| Suite | Result |
|---|---|
| `payroll`, new | 68 of 68, 0 left behind |
| `hrroutes`, changed to run payroll for a past month | 92 of 92 |
| `approvals`, leave and holiday routes | 38 of 38 |
| `devicesync` | 80 of 80 |
| `people` | 123 of 123 |

## Browser results
*11 November 2026. You confirmed the two email addresses are fine to use.*

- **Steps 1 to 3: passed.** On screen, the Weekly Off card showed Sunday, then Sunday, Saturday. On dev data, read-only:
  - weekly off is back to Sunday only (`[0]`)
  - Casual Leave (CL, 10 days, Paid) added for test-1
  - Test Holiday saved as two dates: 5 Nov Thursday **Paid** (edited), 6 Nov Friday **Unpaid**
- **Step 4: passed.** On dev data, Rahul Pramanik's Casual Leave on 7 Nov is APPROVED, 1 day, added by HR.
- **Step 5: found a bug, fixed.** Add Salary Structure's list held only the 15 newest people, so test production employee and the Heads were missing. The cause was the same as Payroll Run's: a list of users loaded without a page size. Now you type to find the person, and the server searches the whole company. Fixed the same way: **Override Leave Balance**, which also showed blank names. The reporting-manager and department-head lists now ask for Managers directly. Rahul Pramanik's salary was saved; nothing was saved for Test Worker Two.
- **Step 5: passed** after the fix. test production employee was found by typing, and the salary saved.
- **Step 6: passed, every number as expected.**
  - **Screen:** amber note, button "Run after month ends", 2 rows, "Not paid: no salary entered (30)". The English / Hinglish panel works.
  - **Rahul Pramanik:** 25 working, 3 pay, 1 lost, net ₹232.
    - before joining 2–5, unpaid holiday 6, half day 7 (with leave), absent 8, present 9 and 11
    - Also marked **worked on a weekly off: 10*.** The made-up device row for 10 Nov had punches as well as WO.
  - **test production employee:** 25 working, 4 pay, 4 lost, net ₹856.
    - paid holiday 5, unpaid holiday 6, absent 2, 3, 4, 7, present 9–11
- **Step 7: passed.** October showed only test production employee: 27 working, 0 pay, 27 lost, net ₹0, button "Run Payroll (1)". After running, the row said **Paid** and the button **Processed**.
- **Step 8: passed**, with **Pay Days / LOP 0 / 27** on the PDF.
  - **Found and fixed:** the Deductions box listed only PF, tax, TDS, advance and others, so Earnings − Deductions didn't equal the net. It now adds a **"Days not paid (LOP n)"** line for the pay of days not paid. The PDF is drawn on download, so old payslips show it too. Checked on a rendered PDF; `hrroutes` 92 of 92 after the change.

**Payroll browser test: COMPLETE, 11 November 2026.**
