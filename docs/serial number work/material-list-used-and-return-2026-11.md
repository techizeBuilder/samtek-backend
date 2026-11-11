# Material List shows what's used, and Return can't send back used material (2026-11-03)

## Why
Found in the browser test on the Fan order (ORD-2026-094). Welding and grinding were done and accepted, and the step cards correctly said Consumed. But the Material List still offered **Return** on Fan Blade, called Fan Bush **In Production** and Tool-A **Available**.

Return was a real bug. Returning the 6 Blades as Excess, with Store accepting, would have added 6 to stock that don't exist, and made the order ask Store for 6 more. Nobody did this, so no data needs fixing.

It affected every Child Part and Machine order with step materials, not only outsourced ones.

## What changed

**Return**
- Material that's been used can't go back as **Excess**.
- It can go back as **Defect** only while the in-house step using it is running, so a bad part found mid-step still has a way out.
- Once that step is finished, or the material is with a vendor, nothing can go back and the button is gone.
- The dialog shows **Can go back**, with the limit for the chosen type, and offers only the types that have room.
- The server checks this too, so a stale page can't send back too much. It answers, for example: *"Only 0 Pieces of Fan Blade can go back as excess. 6 used in this order."*

**Availability column**

| Situation | Shows |
|---|---|
| The whole line is used | **Used** |
| The whole line is at a vendor | **With vendor** |
| The line has gone, some used and some at a vendor | "1 used · 1 with vendor" |
| Part of the line has gone | Today's label, plus "2 used" and/or "1 with vendor" |
| Nothing has gone yet | Today's label, unchanged |

Material that went from Store straight to a vendor, such as Fan Bush and Tool-A, is counted from the steps.

## Behaviour to know
- **Sheet and length offcuts cut on the floor stay as they were:** the measured leftover still goes back after use.
- **Sub Child Part batch orders and older orders whose steps name no material** record no per-step usage, so they stay as they were.
- **A return already waiting** stays valid. Store can still accept or reject it.
- **Between Store's handover and the send being recorded,** a row keeps today's label, because the steps haven't moved yet. Fan Bush would read "In Production" during that time.
- **After a Defect return during a running step,** Store is asked for a replacement. The order's "used" figure doesn't change.

## Technical notes
`services/stepMaterialService.js`: `lineUsage`, `returnLimits`, `addUsageToList`. `productionMfgController`: `getSubChildPartMaterialList`, `getMachineMaterialList` and `returnMaterialToStore`. `ProcessExecution.jsx`: `returnRoom`, `usageSummary`, Return dialog. The rule and worked examples are in [material-list-used-and-return-logic-2026-11.md](material-list-used-and-return-logic-2026-11.md).

## Checked
New suite 40/40 on a made-up company through the real handlers, 0 left: every worked example in the logic doc, the list through each state, refused and accepted returns, Store accepting a Defect and the replacement, several units, sheet offcuts, and Sub Child Part batch orders. `ProcessExecution.jsx` builds.

The real Fan order returns Used 6/6, 2/2 and 1/1, with nothing able to go back (read only).

Regression, all pass with no test changed: `s2b` 18, `ga` 45, `gb` 45, `s1` 25, `slice5` 29, `nosel` 46. Those are the suites a text search found calling Return or these lists. The rest were skipped.

**Not yet seen in the browser:** the labels, and the dialog offering Defect only. The checks are in the [roadmap](browser-test-roadmap-2026-11.md), steps 2.12, 3.9, 3.10 and 3.16.
