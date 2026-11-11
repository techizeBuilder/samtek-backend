# Feature 2, stage 2: Device sync (what changed)

*Built 11 November 2026. Logic and your decisions: [02b-device-sync-logic.md](02b-device-sync-logic.md). Browser test: [02b-device-sync-test-roadmap.md](02b-device-sync-test-roadmap.md).*

## In short
Punches from the client's attendance device now become attendance for anyone with a Device Code, whether or not they have a login. **It isn't connected to the real device yet.** Nothing downloads until Company Admin saves a login.

## To connect it later
When we're ready to connect:
1. Company Admin → **Attendance Device** → enter the Corporate ID, username and password.
2. Click **Test Connection**. It shows only whether it worked and a row count.
3. Pick **Build attendance from**, then **Save Login**.
4. Link the codes in **Codes matching nobody**.
5. Remove the three `ETIMEOFFICE_` lines from `server/.env`. They aren't used any more.

## What HR gets: Attendance Device
HR-Admin finds it under Attendance, and Company Admin in their menu.

| Part | What it does |
|---|---|
| **Status** | Connected, not set up, or red if the login was refused. Last sync and last error |
| **Sync Now** | Runs a sync straight away |
| **Re-download Month** | Downloads a whole month again. Use it before a payroll run |
| **Codes matching nobody** | Code, name on the device, last punched, days. HR searches for the person and links them. Their earlier days fill in from their joining date |
| **Unknown statuses** | Any status from the device we don't recognise |
| **Device login** | Company Admin only. Stored encrypted, and never shown again |

## How it runs
- **Every 15 minutes:** new punches, then the day results for yesterday and today.
- **Every night at 02:00 India time:** yesterday again in full, so hand-typed punches and edits are picked up. A punch deleted in their software is removed here.
- **A company with no saved login is skipped.**
- **A refused login stops that company's sync** after one attempt, so we can't lock the client's account. Saving the login again restarts it.
- **Nothing from the device is written to the server logs,** because it holds real names and times.

## How a device day becomes attendance
| Device status | Attendance |
|---|---|
| `P` | Present |
| `P/2` | Half Day |
| `A` | Absent |
| `WO` | Weekly Off |
| Anything else | Present if there are punches, otherwise Absent, and listed for HR |

**Left alone:** an approved Attendance Request and a self-marked day. HR's correction always wins, including at the nightly download.

**Not built for:** days before someone's joining date, or before the company's Build Attendance From date.

**A reused code:** days already built for the previous person stay with them.

**Times** are always read as India time, whatever the server's clock is set to.

## Other changes
- **Mark Attendance:** with a Device Code, the page says attendance comes from the device and hides the punch buttons. The server refuses too. Without a code, it works as before. Attendance Requests stay for everyone.
- **Attendance Record** now shows **H** for a half day and **WO** for a weekly off (green if they worked it), with the times on hover. Before, it only had a tick or a cross, so a half day looked like a full day. A Sunday or holiday someone worked now shows too. *(Added during the browser test, at your OK.)*
- **Setting a Device Code** on Add Employee, Add Manpower or Edit also fills in earlier days.
- **Present today counts** include half days.
- **A bug fixed in passing:** Attendance Record's "present today" counted every company. It now counts only yours.

## Not changed
Payroll, until stage 3: it still counts any punch as a full day, and a weekly off with no punches as loss of pay. Performance scores still count Present only.

## Still needed from the client
The changed password, the full status list (half day, holiday, leave), what `---CF` means, whether `M_Flag` = `M` means typed by hand, and any limit on how often we may call.

## Files
**Backend:**
- **New:** `models/DevicePunch.js`, `models/DeviceDay.js`, `models/DeviceSyncSetting.js`, `services/deviceSync/etimeClient.js`, `services/deviceSync/deviceProcess.js`, `services/deviceSync/deviceSyncService.js`, `controllers/attendanceDeviceController.js`, `routes/attendanceDevice.routes.js`
- **Changed:** `models/Attendance.js`, `controllers/attendanceController.js`, `controllers/attendanceRequestController.js`, `controllers/hrmsDashboardController.js`, `controllers/userController.js`, `routes/attendance.routes.js`, `index.js`

**Frontend:**
- **New:** `pages/hrms/AttendanceDevice.tsx`
- **Changed:** `App.jsx`, `config/moduleRoutes.js`, `pages/hrms/AttendanceReport.tsx`, `pages/hrms/Employee/Attendance/MarkAttendance.tsx`, `pages/hrms/Employee/Attendance/AttendanceCalender.tsx`
