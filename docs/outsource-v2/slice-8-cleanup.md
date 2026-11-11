# Slice 8 — cleanup: Purchase's temporary send / receive removed

- **Date:** 2026-10-21
- **Status:** **built** 2026-10-21 — change report §7. Every earlier suite now runs through Dispatch → Store (179 tests). Browser check pending.
- **Why:** T11 ([dispatch-design-2026-10.md](dispatch-design-2026-10.md) §6). Purchase's Mark
  sent / Receive were a stand-in until Dispatch (slice 6) and Store's receive (slice 7) existed.
  Now there's one way: **Dispatch sends, Store receives.**
- **Note:** the browser check of slices 5–7 hasn't been reported yet. After this slice the
  Dispatch / Store path is the only one, so that check matters more now.

## What goes

| Where | Removed |
|---|---|
| Outsource Order (Purchase) | **Mark sent** (+ the Sub Child Part material picker), **Receive**, **Receive all**, and their routes |
| Backend send code | the first-trip stock pull and the Child Part / Machine **dummy** send inside the send functions. Every send now comes through Dispatch, after Store handed the material over. |
| Backend | the material-picker endpoints (`…/material-info`, `…/material-options`), and the old Vendor Pickups stub endpoint (`/api/dispatches/vendor-pickups`) |
| Frontend | `FirstSendMaterial.jsx` (the picker) |

## What stays

- **Receive for a trip sent before Outsource Orders existed** (the Requests view, receive-only).
  - The dev database has none in flight. The client's database might, at deploy time.
  - Remove it once the client is migrated and none are left.
- **`rawMaterial.dummy` is still read** (old records), but never written.
- **"Vendor says ready" stays on the Outsource Order** (Purchase can still mark it).

## Tests

- **Slices 2, 3 and 5 sent and received through the removed paths.** Their trips now go through
  Dispatch → Store with a small shared test helper:
  - send = trip → Store handover → Production handover → Delivered
  - receive = return trip → Collected → Store receive
- **Assertions about removed behaviour are replaced:**
  - a missing job-work cost is now taken from the order
  - "Receive all" became separate Store receives
  - the Purchase picker is now Store's handover
- **Slices 6 and 7** drop their "Purchase's button refused" checks; the handlers no longer exist.
