# Feature 2, stage 2: Device sync (logic)

*Written 11 November 2026. **Built the same day:** see [02b-device-sync-changes.md](02b-device-sync-changes.md). Not connected to the real device yet.*

**Your decisions (11 Nov), all as recommended in section 8:** the login goes on a settings screen, stored encrypted, per company. A Device Code turns off Mark Attendance. HR gets a new Attendance Device page.

What the API does, tested with the client's login on 6 Nov, is in [02-manpower-attendance-discussion.md](02-manpower-attendance-discussion.md), section 4.

## 1. What this stage does
Punches from the client's attendance device become attendance in our system, for anyone with a Device Code, whether or not they have a login. Anything the device sends that matches nobody is kept and listed for HR.

**Not in this stage:** payroll rules (stage 3), teams (stage 4), step hours (stage 5).

## 2. The two halves

```
e-timeoffice ──► FETCH ──► PROCESS ──► Attendance record per person per day
                 (small)     │
 made-up punches ────────────┘  (how we test on dev)
```

Fetch only downloads. Process does everything else, and doesn't care where the rows came from. So nearly all of it can be built and tested on dev with made-up rows, and connecting the real device is a small last step.

## 3. What we keep

| Store | One row per | Holds | Used for |
|---|---|---|---|
| **Device punches** (new) | Company, code, punch time | Code, name on device, time, typed by hand or not, device | Step hours at stage 5 |
| **Device days** (new) | Company, code, date | The device's own day result: in, out, work, overtime, break, late, early out, status, remark | Building attendance |
| **Attendance** (exists) | Person, date | What every screen and payroll already read | Unchanged for them |

Device rows are kept **even when the code matches nobody.** That's what lets HR link a code later without losing days.

## 4. Each sync, every 15 minutes
Only for companies with a saved device login. On dev nothing runs until one is saved.

1. **New punches (API 4):** save them. A punch already saved is skipped, matched on company, code and time.
2. **Bookmark:** saved **only when punches came back.** With nothing new the API returns `"0"`, and saving that would lose our place.
3. **Day results (API 3), yesterday and today:** save them, then update attendance.

One server at a time does this, using the same lock as the purchase sweep.

### The safety net
Hand-typed punches and edits appear late, so:
- **Every night at 02:00:** download yesterday again in full. Yesterday's saved punches become exactly what the device returned, so a punch deleted in their software goes here too. This only happens if the download succeeded.
- **Re-download a month:** a button for HR, to use before a payroll run.

### When it fails
- **Network or server error:** tried again at the next sync. The screen shows the last error.
- **Login refused:** the sync **stops for that company** until the login is saved again, so we don't lock the client's account by retrying. HR sees it in red.
- **Nothing from the API is written to the server logs,** because it holds real names and times.

## 5. From device day to attendance

| Device status | Attendance status |
|---|---|
| `P` | PRESENT |
| `P/2` | HALF_DAY (new) |
| `A` | ABSENT |
| `WO` | WEEKLY_OFF (new) |
| Anything else | PRESENT if there are punches, otherwise ABSENT. The raw status is kept and listed for HR |

**Other fields:** in and out times, work seconds and break seconds fill the existing fields. Overtime, late, early out, the device's status and remark are new fields. `--:--` means no time.

**Times are always India time.** Device times carry no timezone, so we read them as India time whatever the server's clock says. The date comes from the device row, not from the server. An OUT earlier than IN means the shift crossed midnight, so OUT is the next day.

**Payroll doesn't change yet.** It still counts any punch as a full day, and treats a weekly off with no punches as loss of pay, until stage 3.

### What the sync may overwrite
| Existing attendance for that day | What happens |
|---|---|
| None | Created |
| From an earlier sync | Updated |
| **An approved Attendance Request** | **Left alone.** HR's correction wins, including at the nightly re-download |
| A self-marked punch | Left alone |

Approving a request will now mark that record as a correction, so the sync can tell.

## 6. Linking people

**A code matches when** a person in that company has that Device Code.

**HR's screen shows unmatched codes:** code, name on the device, last seen, and number of days. HR picks the person and links them. This also handles the first setup, because every code starts unmatched.

**Linking fills in earlier days,** from the device days already saved, with one limit: **only days on or after the person's joining date.** If a code is reused for a new joiner, the previous worker's history doesn't land on them.

**Changing someone's code:** attendance already built stays with them. New days follow the new code.

## 7. Worked examples

**A normal day.** Device: code `0002`, IN 09:30, OUT 18:00, Work 08:00, Break 00:30, Overtime 00:00, Status `P`.
Attendance: PRESENT, 09:30 to 18:00 India time, work 28,800 seconds, break 1,800 seconds. Check: 8h30 between punches, less 30 minutes, is 8h.

**A forgotten punch.** IN 12:06, OUT `--:--`, Work 00:00, Status `P/2`, Remark `MIS-LT`, Late 02:36.
Attendance: HALF_DAY, in 12:06, no out, work 0, late 9,360 seconds.

**Worked on Sunday.** IN 09:00, OUT 13:00, Work 04:00, Status `WO`.
Attendance: WEEKLY_OFF, 09:00 to 13:00, work 14,400 seconds.

**The bookmark.** Saved `112026$207`. The next sync returns 3 punches and `112026$210`: saved. The one after returns none and `"0"`: **the saved value stays `112026$210`.**

**Linking.** Code `0009` is unmatched for 5 days, 3 to 7 Nov. HR links it to someone who joined 5 Nov. They get 3 days of attendance: 5, 6 and 7 Nov.

**A correction.** The device says A for 4 Nov. HR approves a request: 09:30 to 18:00. Attendance reads PRESENT. The nightly re-download still says A, and attendance stays PRESENT.

## 8. Decisions for you

### Decision 1: where the client's login is kept
| Option | Good | Not so good |
|---|---|---|
| **A. A settings screen, stored encrypted** (recommended) | Each company has its own, as the Cash Password does. The password never sits in a file on the PC, and it's never shown again once saved. A Test Connection button | A small screen to build |
| B. In `server/.env` | Nothing to build | One login for every company, and it's the plain text that got exposed this time |

### Decision 2: Mark Attendance for people on the device
| Option | What it means |
|---|---|
| **A. A Device Code turns it off** (recommended) | With a code, the device is the only source, and they can't also punch in on screen. Without a code, for example field staff, it keeps working. Attendance Requests stay for everyone |
| B. Keep it for everyone | Two sources for one day, which disagree |
| C. Remove it for everyone | Anyone not on the device has no attendance at all |

### Decision 3: where HR's screen goes
**A. A new Attendance Device page under HR's Attendance menu** (recommended), holding sync status, unmatched codes, Sync Now and Re-download Month. The login settings go on the same page for Company Admin.

## 9. Still needed from the client
None of these block building:
- The **full status list** (half day, holiday, leave), and what `---CF` means.
- Whether `M_Flag` = `M` means typed by hand, and any limit on how often we may call.

## 10. How I'd test it
A new suite on made-up companies, feeding made-up rows through Process, with every example above as a check. Also: duplicates, a re-download changing nothing, a refused login stopping the sync, India time on a server set to another timezone, one company's codes never reaching another, and a failed download leaving saved punches alone. Fetch gets tested against a pretend server that answers exactly as the real one did, including the `"0"` bookmark.

**Browser, on dev:** you tell me who punched when, I add it through Process, and you check Attendance Record, the calendar and the unmatched list.
