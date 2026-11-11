# Automatic outsource requests — client change 1 (2026-10-22)

**What the client asked:** the step that a Sub Child Part already sends to Purchase automatically
(its first Out Source step) should work the same way for **Child Part and Machine**. Also check how a
**fully outsourced** Child Part / Machine is handled.

This replaces two earlier rules:
- **2026-09-22:** "Child Part / Machine always land with Production first; Production must click
  Send for Outsourcing, even on step 1."
- **Outsource v2:** "how requests arrive never changes". The client changed it.

## What happens now

| When | All three levels |
|---|---|
| **An order is created and its first step is Out Source** | A request goes to Purchase at once, with no Production click. Child Part / Machine: **one request for all units**. Sub Child Part: the batch. |
| **Which steps it covers** | The **whole run of consecutive Out Source steps** from step 1, e.g. welding › grinding. (Sub Child Part used to send only step 1.) Purchase still picks how many steps go on each Outsource Order; the rest stays open on the same request. |
| **Units back from a vendor, waiting at Store, QC passed, next step Out Source again** | The next run is requested **automatically** too. This only happens when the earlier send didn't already cover it (e.g. Production sent fewer steps). |
| **An in-house step followed by an Out Source step** | **Unchanged.** Production has the work in hand and clicks Send for Outsourcing. |

**A fully outsourced Child Part / Machine** (every step Out Source) is now one request covering
every step:
- Purchase orders them trip by trip. Between trips the units wait **at Store**, and the next trip
  waits for QC.
- The last step coming back and passing QC adds the Child Part stock or completes the machine unit,
  as before.
- **Production never has to click anything.** It's still a production order (not a job-work
  order); that's what keeps the per-unit QC, Store custody and finishing.

**Material:** the request arrives at once, so Purchase can order and agree the price. Store hands
over to Dispatch only what's in stock: a Child Part's Sub Child Parts may still be in production
then.

## Build

- **`outsourceWorkController`:**
  - `nextOutsourceRun(procs)` and `autoRequestOutsourceRuns(order, units)`: same shape as
    Production's hand-off, `autoRequested: true`, units on the same run share one request
  - `notifyAutoRequests`; `autoRequestFirstOutsourceRun(order)`
- **At creation:**
  - `subChildPartOrderService`: hybrid; the whole run now
  - `childPartReorderService.createChildPartOrderForItem`
  - `storeFlowService`: a Machine order from the Order Form
  - `productionMfgController.createOrder`: a Machine order made by hand
- **At Store:** `dispatchTripService.autoRequestAtStore(company, productionOrder)`. It's called
  after Store's receive and after QC's per-unit / per-batch-step decisions (`qcController`).
- **`ProductionOrder.outsourceHandoffs[].autoRequested`.**

## Checks

New test (auto-request) **9/9**, 0 left:
- a fully outsourced Child Part, 2 units → one request, both units, welding › grinding, ready in
  Purchase
- a Child Part starting in-house → no request
- a hand-made Machine order with paint first → paint requested; the run stops at in-house assembly
- a hybrid Sub Child Part laser › bend › fit → one request for laser · bend
- Production sent only welding; welding came back → grinding requested automatically, ready in
  Purchase
