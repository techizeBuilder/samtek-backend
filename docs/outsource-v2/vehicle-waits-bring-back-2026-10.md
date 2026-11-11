# "Vehicle waits & brings it back" — one trip out and back (2026-10-21)

**Why:** found during the flow test (R3). Bringing work back always needed a **separate return
trip**. When a vendor finishes in hours, the vehicle drops the material, waits, and brings the work
back on the **same** trip. That wasn't possible: when the trip is made, the line isn't with the
vendor yet, and nothing could be added to a live trip after delivery. Dispatch would have needed a
second trip, and a hired vehicle would have been asked for freight a second time.

**Agreed (your call):** plan it **when the trip is made**, plus two on-the-spot fallbacks.

## How it works

| When | What happens |
|---|---|
| **New trip** | Each outsource send line has a tick: **"Vehicle waits & brings it back"**. It's pre-ticked when the order line's *Expected back* date (Purchase sets it on the Outsource Order) is on or before the trip date. Dispatch can change it. |
| **Delivered** (one line or "Delivered all") | A ticked line, once delivered, is also put on **this trip** as a return job ("Collect — vehicle waited"). The trip stays **Out**. Dispatch counts it as usual: **Collected** (count = sent) or **Report short**. Store receives it on **Outsource Receive**. |
| **Vendor not ready** (fallback 1) | On a return job, while nothing on it is counted: **"Not ready — collect later"**. The uncounted requests leave this trip and go back to **To collect** for a later trip. Also works on an ordinary return trip. |
| **Not planned, but ready** (fallback 2) | A delivered line that wasn't ticked: **"Bring back on this trip"**, within 24 hours of its delivery. A trip already **Done** reopens to **Out**. After 24 hours it needs a return trip. |
| **Work that takes days** | Unchanged: a separate return trip from **To collect**. |

**Unchanged:**
- **Freight:** entered once at trip creation (a hired vehicle's waiting charge is part of it). No second
  freight.
- **The return rules** are the same as on a return trip: same vendor, the request is with the
  vendor, and it isn't on another trip.
- **The trip is Done** when every send is delivered and every return is collected, short, or moved
  to "collect later".

**The Outsource Order** line shows "On Dispatch trip TRP-… — the vehicle waits and brings it back".

## Build

- **`DispatchTrip` job:**
  - `bringBack` (send: the vehicle waits)
  - `sameTrip` (a return added from a send on this trip)
- **`OutsourceOrder` line `dispatch.bringBack`.**
- **`dispatchTripService`:**
  - `createTrip` accepts `bringBack` on a send
  - `markDelivered` adds the return through `addReturnJob(trip, stop, order, line, user)`
  - new `bringBackOnTrip` (fallback 2, 24 h) and `collectLater` (fallback 1); removing the last
    job of a trip is refused ("cancel the trip")
- **Routes (Dispatch, `vendorPickups` edit):**
  - `POST /api/dispatch-trips/:id/jobs/:jobId/bring-back`
  - `POST /api/dispatch-trips/:id/jobs/:jobId/collect-later`
- **Frontend:**
  - `VendorPickups.jsx`: the tick in the New trip dialog (pre-ticked by Expected back); the trip card
    label; the two buttons
  - `OutsourceOrdersView.jsx`: the line note

## Checks

- **Ticked send:**
  - delivered → a return job on the same trip, requests on this trip, trip **Out**
  - collected → trip **Done**
  - no second freight expense
- **Delivered all** with one ticked line and one not → one return job.
- **Collect later:**
  - the requests go back to **To collect**, and the trip finishes
  - refused once a request on that job is counted
  - refused when it would leave the trip with no jobs
- **Bring back on this trip** (not ticked):
  - works and reopens a Done trip
  - refused for an undelivered line
  - refused after 24 h
  - refused when already on a return
- **Pre-tick:** on when Expected back is on or before the trip date.
- **Regression:** slices 2, 3, 5, 6, 7.
