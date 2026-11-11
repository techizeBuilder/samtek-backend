# Feature 2, stage 3: Payroll (logic)

*Written 11 November 2026. **All decisions made 11 Nov, as recommended** (section 8), plus a date range for holidays. Next: the build plan.*

## 1. What this stage does
Payroll pays the right days now that attendance comes from the device: half days, weekly offs, holidays, and leave for people with no login. It also fixes what's wrong with Payroll Run today, because the device would make those mistakes show at once.

**Not in this stage:** overtime pay, extra pay for working a Sunday or holiday, late marks turning into half days, daily-wage labour, and 26- or 30-day months. Those wait for the client's answers in the discussion doc, section 8 C and D.

## 2. What's wrong today
Payroll is worked out **in the browser.** The server saves whatever numbers the screen sends.

| # | Problem | Effect on test-1 today |
|---|---|---|
| 1 | **Only 15 people.** The screen asks for the user list without a page size, and the server stops at 15. | 32 people, so **17 get no payroll at all** |
| 2 | **Sundays are unpaid.** A day with no punch and no leave is loss of pay. Weekly offs are never checked. | 4 or 5 days' pay lost every month |
| 3 | **Holidays are unpaid,** for the same reason. | 1 day lost per holiday |
| 4 | **A half day counts as a full day.** | Overpaid half a day each time |
| 5 | **The first day of every leave is unpaid.** The screen compares `2026-11-10` with `2026-11-10T00:00:00Z` as text, and they don't match. | A 1-day paid leave becomes loss of pay |
| 6 | **Payslips always say 30 pay days and 0 loss of pay.** | Wrong on every payslip |
| 7 | **Recalculate sends back the old numbers.** It doesn't calculate anything again. | A rejected payroll can't be corrected |
| 8 | **People with no login can't take leave.** Only the person can apply. | A worker's leave is loss of pay |

## 3. Where it's worked out
**On the server,** from the database. The screen only shows the result and asks for a run. One calculation feeds the preview, Run Payroll, Recalculate and the payslip, so they can't disagree.

## 4. Each day of the month, per person
**Your rule (11 Nov): salary is for working days.** A weekly off (Sunday) isn't a working day. It isn't paid and isn't absence; it's simply not counted. Someone who works every working day gets the full monthly salary, whatever the month.

The first rule that matches decides the day.

| # | The day is… | Counts as | Pay days |
|---|---|---|---|
| 1 | A weekly off (see below) | **Weekly off:** not a working day | Not counted |
| 2 | Before their joining date | **Not joined** | 0, not loss of pay either |
| 3 | Still to come (current month only), or **today with nothing recorded yet** | **Not yet** | 0 |
| 4 | A holiday marked **Paid** | **Paid holiday** | 1 |
| 5 | A holiday marked **Unpaid** | **Unpaid holiday:** not paid, shown as unpaid holiday, not as absence | 0 |
| 6 | Present | **Present** | 1 |
| 7 | Half day | **Half day:** half present, and the other half paid leave if there's approved paid leave that day, otherwise loss of pay | 0.5, or 1 with leave |
| 8 | Approved leave of a **paid** type | **Paid leave** | 1 |
| 9 | Approved leave of an **unpaid** type | **Unpaid leave**, loss of pay | 0 |
| 10 | Absent, or nothing recorded | **Absent**, loss of pay | 0 |

**A weekly off is:**
- **Someone on the device:** the days the device marks `WO`. A Sunday with no device row at all also counts.
- **Anyone else:** the company's weekly off day, **Sunday** unless HR changes it (decision 1).

**Holidays get a Paid / Unpaid choice** on the Holidays page, **Paid** unless HR changes it. Today a holiday has no such mark. **Your ask (11 Nov):** HR enters a **from – to range** on the Holidays page, and the system saves one holiday per date, all with the same name and Paid / Unpaid mark. Each day can then be edited or deleted on its own.

**Working on a weekly off or holiday** earns nothing extra for now. The screen counts these days separately, so HR can see them until the client says whether they earn extra.

## 5. The money
```
working days     = days in the month − that person's weekly offs
per day          = monthly gross ÷ working days
pay days         = present + half days + paid leave + paid holidays (section 4)
loss of pay days = half-day halves with no leave + unpaid leave + absent
earned           = monthly gross × pay days ÷ working days
net              = earned − fixed deductions (PF, professional tax, TDS, advance, others)
```
- **Monthly gross** is basic + HRA + other allowance, from the Salary Structure.
- **Working days are the whole month's,** even for someone who joined mid-month. They're paid for the working days after joining.
- **Fixed deductions** are taken in full, as today.
- **Amounts** are rounded to the rupee at the end, not day by day.
- **Net** never goes below 0.
- **Not joined, Not yet and Unpaid holiday days** are simply not paid. They aren't loss of pay, so the payslip doesn't show them as absence.

## 6. Worked example: November 2026
November has 30 days. 1 November is a Sunday, so the Sundays are 1, 8, 15, 22 and 29: **25 working days.** Say the company has one **paid** holiday, on Tuesday 24 November.

**Worker A**, on the device, joined before November:
- **Salary:** basic 12,000, HRA 2,400, other 1,200, so the gross is **15,600**.
- **Deductions:** PF 1,440 and professional tax 200, so **1,640**.
- **Per day:** 15,600 ÷ 25 = **624**.

| Days | Count | Pay days | Loss of pay |
|---|---|---|---|
| Sundays, device `WO` | 5 | not counted | not counted |
| Paid holiday, 24 Nov | 1 | 1 | 0 |
| Present | 20 | 20 | 0 |
| Half day, device `P/2`, no leave | 2 | 1 | 1 |
| Casual leave (paid), 10 Nov | 1 | 1 | 0 |
| Absent | 1 | 0 | 1 |
| **Working days** | **25** | **23** | **2** |

**Earned** 15,600 × 23 ÷ 25 = **14,352**. **Net** 14,352 − 1,640 = **12,712**.

**What today's screen would pay:** 22 days present (the half days counted as whole) out of 30, with the 5 Sundays, the holiday, the leave day and the absence as loss of pay. That's 15,600 ÷ 30 × 22 = 11,440, less 1,640 = **9,800**. That's **2,912 short.**

**Worker B,** not on the device, joined Monday 16 November, every working day present, same salary:

| Days | Count | Pay days |
|---|---|---|
| 1 to 15 Nov, not joined (12 working days) | 15 | 0 |
| Sundays 22 and 29 | 2 | not counted |
| Paid holiday, 24 Nov | 1 | 1 |
| Present | 12 | 12 |
| **Working days** | **25** | **13** |

**Earned** 15,600 × 13 ÷ 25 = **8,112**. **Net** 8,112 − 1,640 = **6,472**.

**Today's screen** pays only the 12 days present out of 30: 520 × 12 = 6,240, less 1,640 = **4,600**. That's **1,872 short,** and it shows 18 days of loss of pay, counting the days before joining, both Sundays and the holiday.

**Worker D,** like A, but the 24 November holiday is marked **Unpaid:** 22 pay days, so 15,600 × 22 ÷ 25 = **13,728**, net **12,088**. The holiday shows as an unpaid holiday, not an absence.

**Worker C,** on the device, worked Sunday 8 November (`WO` with punches), otherwise like A: paid the same as A. The screen shows **Worked on weekly off: 1.**

These four are the test suite's hand-worked totals.

## 7. On screen
**Payroll Run:**
- **The table** gets columns for pay days, loss of pay, earned, deductions and net.
- **Paged on the server, with a search box,** because a factory has more than one page of people.
- **Holidays page:** each holiday gets **Paid / Unpaid**, Paid unless changed.
- **Click a row** to see the person's month: a count per kind of day from section 4, and the days themselves on hover.
- **"How pay is worked out"** is a short panel above the table with the formula and section 4's rules. It has an **English / Hinglish** switch.
- **People with no Salary Structure** are listed under the table as "Not paid: no salary entered". Today they just disappear.
- **Recalculate** really works it out again from today's attendance and leave.

**Payslip:** the real pay days and loss of pay, in place of 30 and 0.

**Leave for someone:** HR's Leave Requests page gets **Add leave for someone**, for anyone in the company, with or without a login. It checks the leave balance the same way as applying for yourself.

**Hinglish for the panel** (draft):
> Salary sirf working days ki hai. Weekly off (Sunday) working day nahi hai, isliye na pay milti hai na kat-ti hai. Paid holiday ki pay milti hai, unpaid holiday ki nahi. Present = poora din, half day = aadha din, approved paid leave = poora din. Absent ya unpaid leave = pay kategi (LOP). Joining se pehle ke din gine nahi jaate.
> Per day = monthly gross ÷ working days. Earned = monthly gross × pay days ÷ working days. Net = earned − PF, PT, TDS, advance, others.

## 8. Your decisions
| # | Question | My recommendation | Other choice |
|---|---|---|---|
| 1 | **Weekly off for people not on the device** | **Sunday for the whole company, changeable on the Attendance Policy page.** Device people follow the device's `WO`. | Only the device's `WO`, which makes Sunday a working day for office staff on Mark Attendance, so they'd be marked absent |
| 2 | **Running payroll for the current month** | **Only for a finished month.** The current month shows a "so far" preview, and Run Payroll stays off until the month ends. | Allow it, as today, which deducts the days still to come |
| 3 | **Leave HR adds for someone** | **Approved at once,** because HR is the one deciding | Pending, then approved like any other request |
| 4 | **Leave that spans a Sunday or holiday** | **Leave it as today:** a Saturday-to-Monday leave uses 3 days of balance. Pay is the same either way. Ask the client whether Sundays inside a leave should count. | Count only working days |

**All four settled by you, 11 Nov, as recommended:** Sunday weekly off on the Attendance Policy page; payroll runs only for a finished month; leave HR adds is approved at once; leave over a Sunday uses balance as today.

**Also settled by you, 11 Nov:** salary is for working days; weekly offs aren't counted; holidays are Paid or Unpaid per holiday.

**Fixed until the client answers:** no extra pay for working a Sunday or holiday, overtime not paid, fixed deductions taken in full.

## 9. Also fixed on the way
- **Leave types are matched by name across all companies** when applying. Two companies with a "Casual" type can pick up each other's rules. They'll be matched within the person's own company.
- **A payroll already Paid** still can't be reset or recalculated. That stays as it is.

## 10. Tests
A new suite, `payroll`, on made-up companies:
- **Workers A, B and C from section 6,** to the rupee.
- **Every rule in section 4 on its own:** a holiday on a Sunday, a half day with paid leave, unpaid leave, a joining date mid-month, the current month's days still to come.
- **All people, not 15:** a company with 40.
- **The payslip** shows the same pay days and loss of pay as the payroll.
- **Recalculate** after attendance changes gives the new amount.
- **HR adds leave for a no-login worker:** checked against the balance, and payroll counts it.
- **Company scope:** another company's people, holidays and leave types never count.

**Regression:** `hrroutes`, `approvals`, `devicesync` and `people`.
