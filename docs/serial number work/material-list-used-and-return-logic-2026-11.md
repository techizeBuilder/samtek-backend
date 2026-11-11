# Material List: what's used, and what can go back (logic, 2026-11-03)

## Why
Found in the browser test on the Fan order (ORD-2026-094). Welding and grinding were done and accepted, and the step cards correctly said Consumed. The Material List said something else:

| Row | Material List showed | What's true |
|---|---|---|
| Fan Blade | **Return** button | All 6 are welded into the Fan |
| Fan Bush | "In Production" | Finished, sent to the vendor and used |
| Tool-A | "Available" | This order's piece was used at the vendor |

**Return was the real bug.** Returning the 6 Blades as Excess and Store accepting would have added 6 to stock that don't exist, and made the Fan order ask Store for 6 more.

**The cause:** the Return button and the server's check count issued − waiting to return. They leave out what's been used, though the order already records it. The Availability column only looks at stock, not at this order.

This affects every Child Part and Machine order with step materials, not only outsourced ones.

## Decided (3 Nov, your choice of the recommended options)
1. Once material is used, it can't go back as **Excess**.
2. It can go back as **Defect** only while the in-house step using it is **running**. A bad part found mid-step has to have a way out, or Production is stuck with no replacement.
3. Once that step is finished, or the material is with a vendor, nothing can go back.
4. **Sheet and length offcuts stay as they are.** Production cuts on the floor and returns the measured leftover, which is normal even though the sheet counts as used.

## The rule

For one Material List line:

- **Held** = issued − waiting to return
- **Used** = what the order has recorded as used (`consumedQuantity`)
- **Running** = the need of in-house steps using this line that are In Progress, across all units

| Return type | Most that can go back |
|---|---|
| Excess | Held − Used, never below 0 |
| Defect | The smaller of: Held, and (Excess limit + Running) |

The **Return** button shows when either limit is above 0. The dialog shows the limit for the chosen type, and offers only the types that have room.

**Whole-piece offcuts** (a sheet or length line with no fixed cut size): both limits stay at Held, as today.

## How a step's material counts

| Step | State | Counts as | Running? |
|---|---|---|---|
| Any | Not started | Nothing yet | No |
| In-house | In Progress | Used | **Yes** |
| In-house | QC Pending | Used | No. QC's reject is the way back |
| In-house | Completed | Used | No |
| In-house | Sent back for rework (In Progress again) | Used | **Yes** |
| Outsourced | Sent | With vendor | No |
| Outsourced | Received / Completed | Used | No |

## What the Availability column shows

| Situation | Shows |
|---|---|
| The whole line is used | **Used**, with x/x |
| The whole line has gone, some or all still with a vendor | **With vendor**, or "1 used · 1 with vendor" |
| Part of the line has gone | Today's label, plus "2 used" and/or "1 with vendor" |
| Nothing has gone yet | Today's label, unchanged |

This also covers material with no request to Store, such as Fan Bush and Tool-A that went from Store straight to the vendor. Their count comes from the steps.

## Worked examples

**A. Fan Blade now.** Issued 6, used 6, waiting 0, nothing running.
Held 6. Excess 6 − 6 = **0**. Defect min(6, 0 + 0) = **0**. No Return button. Shows **Used 6/6**.

**B. Fan Bush now.** No request to Store. 2 from Store on welding, which is Completed.
No Return button. Shows **Used 2/2**.

**C. Tool-A now.** 1 from Store on grinding, which is Completed.
No Return button. Shows **Used 1/1**.

**D. Bearings, issued, coating not started.** Issued 2, used 0.
Held 2. Excess **2**. Defect min(2, 2 + 0) = **2**. Both types offered. Shows Issued, as today.

**E. Coating running.** Issued 2, used 2, running 2.
Held 2. Excess 2 − 2 = **0**. Defect min(2, 0 + 2) = **2**. Return offers **Defect only**. Shows Used 2/2.

**F. 1 Bearing returned as Defect during coating, Store accepted.** Issued 1, used 2, running 2.
Held 1. Excess 1 − 2 → **0**. Defect min(1, 0 + 2) = **1**. Store is asked for 1 replacement, and once it arrives issued is 2, so Defect is **2** again.

**G. Coating Completed.** Issued 2, used 2, running 0.
Excess **0**. Defect min(2, 0 + 0) = **0**. No Return button.

**H. A Machine order for 3 units, 2 per unit.** Issued 6. Unit 1 finished the step, unit 2 running it, unit 3 not started. Used 4, running 2.
Held 6. Excess 6 − 4 = **2**. Defect min(6, 2 + 2) = **4**. Shows Issued · 4 used.

**I. E with 1 already waiting to return as Defect.** Issued 2, waiting 1, used 2, running 2.
Held 1. Excess 1 − 2 → **0**. Defect min(1, 0 + 2) = **1**.

**J. Sheet metal, cut on the floor.** Issued 3 sheets, used 3.
Offcut line, so both limits are Held = **3**. Return stays, asking for the measured leftover. Shows Used.

## Behaviour to know
- **The server decides.** The limits come from the server and it checks them again, so a stale page can't send back too much.
- **A return already waiting** stays valid. Store can still accept or reject it.
- **Sub Child Part batch orders don't change.** They don't record usage per step, so their limits stay Held, as today.
- **Older orders whose steps name no material** record no usage, so they also stay as today.
- **Between Store's handover and the send being recorded,** the row keeps today's label, because the steps haven't moved yet. Fan Bush would read "In Production" during that time.

## Not changed
Stock, reservations, Issue, Store's transfers and the step cards. The Availability label changes only on the screen; nothing else reads it.
