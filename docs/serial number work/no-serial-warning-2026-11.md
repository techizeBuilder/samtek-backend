# Warning when fewer serials are picked than pieces (2026-11-03)

## Why
Found in the browser test. Store handed over 1 Tool-A with nothing picked. Tool-A had 12 pieces with a 6-month warranty serial and 9 plain ones, so the pick rule allowed it and nothing asked. If that piece had a serial, the serial keeps saying "In stock", and a later warranty claim looks in the wrong place.

## What changed
On every screen with a serial pick, when you pick fewer serials than you could:
- Nothing moves yet. A box says, for example: *"Tool-A: 1 piece going without a serial number. 12 have a serial number. If this piece has one, go back and pick it."*
- **Go ahead** stays disabled for **3 seconds**, counting down. **Go back** works straight away, and the form keeps what you entered.
- If someone goes ahead, it's recorded. **Serial Numbers → Went without a serial** shows the date, item, screen, quantity, picked, order and who.

On Store's handover to Dispatch, this and the [held stock warning](store-handover-held-stock-warning-2026-11.md) appear in one box with one countdown.

## The 8 screens
1. Material Transfers
2. Handover to Dispatch
3. Sale from stock (the Store QC job's Pass)
4. Service visit
5. Return to Store
6. Defective Inventory: Repair and Scrap
7. QC scrap and reject
8. Lost at a vendor

## When it warns and when it refuses

| Stock | What you picked | What happens |
|---|---|---|
| Every piece has a serial | Fewer than the pieces | **Refused**, as before |
| Some serials, some plain | Fewer than plain pieces can cover | **Refused**, as before |
| Some serials, some plain | Enough for the plain pieces, but fewer than you could | **Warning** |
| Some serials, some plain | As many as you could | Nothing |
| No serials | Nothing to pick | Nothing |

## Behaviour to know
- **A part with serials inside it** on Defective Inventory never warns. It keeps its own choice, "Nothing tracked inside".
- **The server checks too:** without the confirmation it refuses and moves nothing, so a stale page can't skip the warning. The 3-second wait itself is on the screen only.
- **Bulk Transfer** still skips lines with serials, so it never shows the box.

## Technical notes
`serialTrailService`: `noSerialCheck`, `acknowledged`, `confirmBody`, `logSkippedSerials`. `checkPiecePick` and `checkDefectivePick` also return `skip`. New model `SerialSkipLog`, new `GET /api/serial-numbers/skips` (paged on the server, with search).

The server answers 409 with `data.confirmWarnings`; the screen re-sends with `acknowledgeWarnings`. Screens use `components/serials/useConfirmWarnings.jsx`. The rule and worked examples are in [serial-tracking-logic-2026-10.md](serial-tracking-logic-2026-10.md) §12.

## Checked
New suite 46/46 on a made-up company through the real handlers, 0 left: the rule table, each of the 8 screens (warned → nothing moved → went ahead → recorded), the cases with no warning, and one box on a handover with both warnings. All changed pages build.

Regression: 30 suites pass, 703 checks. Three needed updating for this change, each one expected:
- `s2b`: picking 2 of 4 now warns first.
- `gc`: scrapping 1 with none picked now warns first.
- `heldwarn`: new flag names.

`qc-order` was out of date from before this change: it expected "Start the inspection first" on jobs already In Progress. Since 30 Oct the first person to decide becomes the inspector. Updated; it passes, including the step order rule.

**Not passing or not run, none from this change:**
- `s2`: 5 of 9. Its purchase rejection sends the old `rejectQty`, refused since the reject lines (§68, 30 Oct) with "Add the reject lines". Not updated, because `chk` covers purchase rejections with lines. Its production rejections pass.
- `option1`, `slice1`: can't run. They compare against a temporary copy of an old controller that no longer exists.

Skipped: the remaining older suites, such as make or buy and purchase. A text search found no direct call to the handlers these screens use, or to a serial pick. That search wouldn't catch an indirect call.

**Not yet clicked through in the browser,** so the box and countdown haven't been seen running. The checks are in the [roadmap](browser-test-roadmap-2026-11.md), steps 2.11 and 3.3b.
