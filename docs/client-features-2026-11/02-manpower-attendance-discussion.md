# Feature 2: Manpower, attendance, and labour cost (discussion)

*Started 6 November 2026. Nothing built yet. The open questions in section 8 are to be settled later, at your call.*

## 1. What the client asked

| # | Piece | What it means |
|---|---|---|
| 1 | **Teams come from HR** | Production can only build a team from people HR entered, not typed names |
| 2 | **Manpower has no login** | Labour and staff are in the system for work only, so HR's add-user design has to change |
| 3 | **Attendance from the device** | The client's biometric system (e-timeoffice) supplies attendance through its API |
| 4 | **Assign a person or a whole team** | Production also enters the planned hours for the work |
| 5 | **The system reports the actual hours** | When the step finishes, hours × the person's rate gives the cost. The rate comes from salary on an 8-hour shift |
| 6 | **Hours and cost feed two things** | The estimated delivery date and the final BOM price |

## 2. The full picture

```
Device (e-timeoffice) ── punches ──► Attendance ──► Payslip
                                         │
HR adds person ──► Team (Manpower) ──► Assign step + planned hours
(no login)                               │
                                         ▼
                         Step finishes: actual hours
                         (only while the person was present)
                                         │
                       hours × rate ─────┴───► past hours
                             │                     │
                             ▼                     ▼
                  BOM price, then Machine MRP   Delivery estimate
```

**Why production needs attendance, as I read it:** the punches say when each person was really at work. That gives true working hours for a step and shows who is present when Production assigns work. You didn't state this outright, so please confirm it (section 8, A1).

## 3. How it works today (read from the code and dev data)

| Area | Today | What this means |
|---|---|---|
| **Team** | Supervisor and members are typed text, and efficiency is a typed number | Nothing links a member to a person in HR |
| **Assigning** | A step holds one team, per unit (per batch for a Sub Child Part), with no hours. Most steps can't start without a team | No person or hours are recorded |
| **Other team use** | QC part checks, Job Cards, Repair Production, and team history on Manpower | All must keep working |
| **Step times** | Each step records its exact start and finish | Actual hours have a starting point, but it's clock time |
| **HR adding someone** | Email and password are required, and email is unique | A person without a login can't be saved |
| **Marking attendance** | The person clicks punch in and out while logged in | No login means no attendance |
| **Who can mark it** | Only Employee roles have the menu. **Head roles don't** (confirmed) | The device fixes this: anyone with a device code is covered |
| **Attendance record** | One per user per day, status PRESENT or ABSENT | No half day |
| **Payroll Run** | Monthly gross ÷ days in the month. Any punch counts as a full day. A past day with no attendance and no leave is loss of pay | See the two problems below |
| **Salary, payroll, payslip** | All linked to a user record | Manpower has to fit these |
| **Typed production cost** | Production types one cost and one expense at the unit's last in-house step. That goes to the BOM, then up to the Machine's MRP (`partCostService.js`) | The path exists; the calculated cost can use it |
| **Delivery estimator** | Sales → Leads → Estimate Delivery Date uses past average days per machine, or 7 days with no history | Already exists; step hours can improve it |

**Two payroll problems the device will expose:**
1. **Half days count as full.** The device sends `P/2`, but payroll counts any punch as a whole day.
2. **Weekly offs and holidays are loss of pay.** Payroll Run has no check for them. Someone who attends all 26 working days of a 30-day month with 4 Sundays shows 4 days' loss of pay.

## 4. The client's attendance solution: e-timeoffice API
All are GET requests with Basic login, on `https://api.etimeoffice.com/api/`.

| API | Gives | Use for us |
|---|---|---|
| **1. DownloadPunchData** | Code and punch time | Not needed; API 2 gives more |
| **2. DownloadPunchDataMCID** | Same, plus name and which device | Re-downloading a date range to fill gaps |
| **3. DownloadInOutPunchData** | One row per person per day: IN, OUT, work time, overtime, status (`P/2`), remark (`MIS-LT`), late, early out | **Payroll:** the day's result |
| **4. DownloadLastPunchData** | Only new punches since the last download, with a marker to save | **Through the day:** who's in, and step hours |

### What it means for the design
- **We have to ask for data.** The API doesn't notify us, so we'd download on a schedule, like the sweeps. "Present" is only as fresh as the last download and the device's own upload.
- **Punches have no IN or OUT mark.** API 4 gives only times, so we pair them ourselves. API 3 gives the day's IN and OUT.
- **A person is matched by Empcode.** Our `employeeId` looks like `EMP-NEX-0001`, while the device's looks like `0001`. So each person needs a **device code** field, and any punch whose code matches nobody must appear on a list for HR, not vanish.
- **Shifts live in their software.** No API returns the shift itself. We can only work it out from IN minus Late, and only on days someone was late.
- **One login per company.** Each company stores its own login, encrypted as the Cash Password already is (`utils/cashCrypto.js`).

### Tested with the client's real login (6 November, read-only)
The login is kept only in `server/.env`. The tests printed totals only and saved nothing. This doc holds no names, codes or login.

| Question | What the API did |
|---|---|
| **Login format** | `Corporateid:Username:Password:True` worked first time, as the document's format line says |
| **Who's in it** | 40 employee codes, all 4 digits. 26 people have a row each day in November, but 39 did on 31 October, so 13 stopped at month end. Ask the client if they left |
| **Statuses seen** | `P`, `A` and `WO`. `P/2` is only in the document's sample, and no holiday status appeared this week, so we still need the full list |
| **Weekly off** | All 24 `WO` rows are on Sunday. 11 of them have punches, so some people worked that Sunday. **The device already says who's off, so payroll may not need its own weekly-off setting** |
| **Lunch** | People don't punch for it: 106 person-days have 2 punches, 29 have 1, 1 has 3. API 3 has a `BreakTime` field that isn't in the document: 30 minutes on 73 rows, 0 on the rest. It gives the length, not the time of day |
| **Shifts** | More than one. Late rows point to starts of 08:30 (87 rows), 09:00 (7), 10:30 (1). Early-out rows point to ends of 17:00 (4), 18:00 (7) |
| **8-hour day** | On overtime rows, work minus overtime is 8:00 on 50 rows and 9:00 on 18. **So some people look to be on a 9-hour day,** which would change their hourly rate |
| **Devices** | One device: id 1 on 234 punches. The other 10 have no device and `M_Flag` = `M`, probably typed by hand in their software (to confirm) |
| **Bookmark** | Asking again with the bookmark returned 0 punches, so no duplicates |
| **Trap: the bookmark resets** | With nothing new, `MaxRecord` comes back as `"0"`, not the old bookmark. Saving it, as the document says, would lose our place. **Only save it when punches came back** |
| **Month change** | A bookmark past the end of October returned November's punches and the right new bookmark, so it carries over. Tested with a made-up high number, not a real last record |
| **Missing records** | November's IDs run 1 to 207, but 202 punches came back. 5 are missing, perhaps deleted or edited |
| **Freshness: not answered** | The newest device punch was 322 minutes old at 14:49, but people probably just don't punch mid-shift. Test again around 17:00 |

**Still unknown:** the full status list, the meaning of `---CF`, and any limit on how often we may call.

**A safety net, needed because of hand-typed punches and missing records:** each night, re-download the day before and save it without creating duplicates. Before each payroll run, re-download the whole month, so late corrections are included.

## 5. Worked examples

### The rate
Salary ₹24,000 a month:

| Divide by | Per day | Per hour | Per minute |
|---|---|---|---|
| 30 days | ₹800 | **₹100** | ₹1.67 |
| 26 working days | ₹923.08 | **₹115.38** | ₹1.92 |

### Clock time vs. present time
Step started Monday 4:00 pm, finished Tuesday 11:00 am. The person punched 9:30 to 18:00 on both days.

| Method | Hours | Cost at ₹100 |
|---|---|---|
| Finish minus start | 19 | ₹1,900, far too high |
| **Only while present** | Monday 16:00–18:00 = 2, Tuesday 9:30–11:00 = 1.5, total **3.5** | **₹350** |

### A whole team
Three people at ₹100, ₹75 and ₹50 with 3.5 present hours each: ₹350 + ₹262.50 + ₹175 = **₹787.50**.

Punches let each person count separately. If the ₹50 person was absent on Tuesday, they have 2 hours, not 3.5, which is ₹100 and not ₹175. The team costs ₹712.50.

### Into the price
- **Machine or Child Part:** the cost goes on that unit's build.
- **Sub Child Part:** ₹787.50 on a batch of 10 finished pieces is ₹78.75 a piece, using the division that already exists.

## 6. The main choice: how to store manpower

| Option | Good | Not so good |
|---|---|---|
| **A. A user record with no login** (my recommendation) | Attendance, salary, payroll and payslips all link to a user already, so they carry on working | They could appear in the lists of people who log in; 29 backend files list users directly, and each needs checking |
| B. A separate Manpower record | Can't leak into those lists | Attendance, salary, payroll and payslips all need changing to accept both kinds |

Either way, HR's form gets "Gets a login: yes / no", with email and password required only for yes.

## 7. Suggested order
Each stage can be tested alone. Stages 1 to 3 don't touch production.

| Stage | What | Depends on |
|---|---|---|
| 1 | **People:** HR adds manpower with no login, with a device code | Section 6 |
| 2 | **Device sync:** punches and daily attendance for everyone, plus the unmatched-code list | Stage 1. Login received and working |
| 3 | **Payroll reads it:** half days, weekly offs, manpower's salary and payslips | Stage 2 |
| 4 | **Teams from people:** Manpower picks from HR, and old typed teams are handled | Stage 1 |
| 5 | **Assign and hours:** person or whole team, planned hours, who's present, actual hours | Stages 2, 4 |
| 6 | **Cost into the price:** calculated labour replaces the typed cost | Stage 5 |
| 7 | **Delivery estimate:** step hours replace the whole-build average, and could replace the machine's Build Days | Stage 5 |

## 8. Open questions (later, at your call)

### A. Confirm my reading
1. Attendance is needed for production to get true hours and to show who's present. Is that right?
2. Actual hours set the cost, and planned hours are only for comparison and the timeline.
3. Whole team cost adds up everyone's rates. Does that include the supervisor?
4. Can a step have two people from a team, or only one person or the whole team?
5. Everyone punches on this device: Heads, office staff and labour.

### B. From the client
1. The full status list: half day, holiday, leave. Also the meaning of `---CF`, whether `M_Flag` = `M` means hand-typed, and any call limit.
2. What time is lunch? Workers don't punch for it, so a step's hours can't exclude it without knowing when it is. Does it differ by shift?
3. Which shifts exist, and who's on which? Is anyone on a 9-hour day?
4. Did the 13 people who stopped at the end of October leave?
5. Are any labour paid daily rather than monthly?
6. Are there field staff who never reach the device, such as service technicians?
7. Does everyone in the factory punch on this device? It shows 26 active people.

### C. Attendance and payroll
1. Does the old Mark Attendance page go away, or stay for people away from the factory?
2. Attendance Requests write directly on the attendance record. Should the device's next download leave an approved correction alone? I'd say yes.
3. What about a forgotten punch (`--:--`, `MIS`)?
4. Does overtime from the device go into pay? Payroll doesn't read it today.
5. Which weekly offs and holidays count as paid? Payroll needs this fixed either way. The device marks `WO`; I haven't seen how it marks a holiday.
6. Someone punched on a Sunday `WO` (11 rows this week): is that extra pay?

### D. Hours and cost
1. Which days divide the salary: 30, 26, or days in the month? And is it always 8 hours, or the person's own shift? The data suggests some are on 9.
2. Is a person on two steps at once blocked, or is their time split? Otherwise we'd count their cost twice.
3. Can a step be paused, such as when waiting for material? Steps have no pause today.
4. Can an absent person be assigned at all, or is it only a warning? What if someone leaves mid-step?
5. No salary entered: labour would silently be ₹0. Warn like Price provisional?
6. Is the typed production cost removed? Does the typed expense stay?
7. Today the latest build sets the price, so one slow build moves the MRP. Keep that, or use an average?
8. Do rework hours after a QC rejection count towards the price?
9. Who can see the cost? Production could work out a salary from hours and cost.
10. Should team efficiency stay typed, or be calculated from planned vs. actual hours?

### E. Delivery estimate
1. Sales needs a date before anyone is assigned, so hours typed at assignment come too late. Should it use past actual hours, or standard hours R&D sets on the BOM?
2. The estimator treats production as one queue. With people known, should it plan by who's available? That's more accurate but much harder.

### F. Moving over
1. What happens to existing typed teams, and to orders already assigned to them? Dev has one, Team A; live has only product master data.
