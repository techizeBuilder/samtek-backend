# Feature 2, stage 2: Device sync (browser test)

*Written 11 November 2026, company test-1 on dev. What changed: [02b-device-sync-changes.md](02b-device-sync-changes.md).*

**The real device is not used here.** When a step says "I add", I feed made-up rows through the same code the real sync uses. Your two test workers have codes `0001` and `0002`.

## Steps

### 1. The page
HR-Admin → Attendance → **Attendance Device**.
- [ ] It says no device login is saved, and Sync Now and Re-download Month are disabled.
- [ ] **Device login** isn't shown to HR.

Company Admin → **Attendance Device** in the menu.
- [ ] The Device login section is there. Don't save anything in it.

### 2. Punches arrive
Tell me, and I add these for this week:

| Code | Day 1 | Day 2 | Day 3 |
|---|---|---|---|
| `0002` | 09:30 to 18:00, `P` | In 12:06, no out, `P/2` | `A` |
| `0001` | 09:30 to 18:00, `P` | `WO`, worked 09:00 to 13:00 | Unknown status `HLD`, 09:30 to 18:00 |
| `0099`, nobody has it | 09:30 to 18:00, `P` | 09:30 to 18:00, `P` | `A` |

- [ ] Attendance Record shows the workers on those days.
- [ ] Attendance Device lists `0099` under Codes matching nobody, with 2 days.
- [ ] Unknown statuses shows `HLD`.

### 3. Linking
Add a test person with a joining date on Day 2, or pick an existing person without a code, and link `0099`.
- [ ] A message says how many days were filled in. With a joining date on Day 2, it's 2, one of them absent.
- [ ] `0099` leaves the list, and those days appear in Attendance Record.

### 4. Mark Attendance
Log in as someone with a login and give them a Device Code on their profile first.
- [ ] Mark Attendance says attendance comes from the device, with no punch buttons.
- [ ] Their history is still there.

Someone without a code:
- [ ] Punch In still works.

### 5. A correction survives
On the worker's absent day, as someone with a login, raise an Attendance Request; HR approves it. Tell me, and I add the same `A` again.
- [ ] The day stays Present.

## Not needed on screen
Covered by the `devicesync` suite: the bookmark, month change, duplicates, a refused login, a deleted punch going at the nightly download, India time on a server set to another clock, and one company's codes never reaching another.

## Automatic results
| Suite | Result |
|---|---|
| `devicesync`, new, on made-up rows and a pretend server | 80 of 80, normal clock |
| `devicesync`, server clock on UTC | 80 of 80 |
| `people`, which uses the changed user code | 123 of 123 |

The other 80 suites were skipped: none of them uses the changed attendance or user code. The real device was not called.

All the changed screens compile, but nothing has been seen in a browser yet.

## Browser results
*11 November 2026, in progress.*

Rows added on dev, test-1: code `0001` on 7 Nov (`P/2`), 8 Nov (`A`, a Sunday), 9 Nov (`P`), 10 Nov (`WO`, worked), 11 Nov (`HLD`); code `0099` on 9 to 11 Nov. Code `0002` got no attendance, correctly: Test Worker Two's joining date is 12 Nov, later than those days.

**Found during the test, changed:** Attendance Record showed only a tick or a cross. It now shows H and WO.

**Seen on screen, 11 Nov:**
- **Step 1, HR's view:** no login saved, Sync Now and Re-download Month disabled, no login section.
- **Step 2:** `0099`, TEST DEVICE 0099, last punched 2026-11-10, 2 days; the `HLD` note. Attendance Record for Rahul Pramanik (Manpower) matched exactly: crosses 2 to 6, H on 7, — on 8, tick on 9, green WO on 10, tick on 11; Test Worker Two all crosses.
- **Permissions:** HR-Admin opened Attendance Device and Attendance Record, which the permission gap had blocked.

- **Step 3, linking:** you linked `0099` to test production employee (`EMP-TES-0024`). On dev data: code `0099`, 9 and 10 Nov Present, 11 Nov Absent, all from the device, and 4 punches attached.
  - **Found and fixed:** the person picker's results sat inside the table's scroll box and were squeezed into a tiny scrolling area. They now show as a normal list under the search box.

- **Step 1, Company Admin:** the Device login section shows, empty, with Test Connection and Save Login disabled.
- **Step 4:** reported done by you: Mark Attendance for the linked employee.
- **Step 5:** you raised and approved a request for 11 Nov. On dev data it read Present, from a correction, in at 09:30. I sent the device's Absent for that day again: **it stayed Present.**

**DEVICE SYNC BROWSER TEST COMPLETE, 11 Nov.** Not seen: the picker after its fix, because no code is unmatched now.

**Noticed, not changed:** an approved correction's times are read in the server's own timezone. That's right on this PC, which is on India time, but a live server set to UTC would store 09:30 as 15:00 India time.
