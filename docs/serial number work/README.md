# Serial number work

Following a purchased unit's serial number after it leaves Store: which production order used it,
which part it was built into, and which customer order got it — and using that for warranty claims.

Builds on procurement v2 §28 (serials at receive, `PurchasedUnit`) and §29 (vendor warranty claims on
Complaints → Support); background in
[../procurement-v2/serial-numbers-and-warranty-discussion-2026-10.md](../procurement-v2/serial-numbers-and-warranty-discussion-2026-10.md).

| Doc | What |
|---|---|
| [cascade-to-parent-logic-2026-10.md](cascade-to-parent-logic-2026-10.md) | **Step 1:** cascade orders deliver to their parent order, not to stock (decides how tracking works) |
| [cascade-to-parent-changes-2026-10.md](cascade-to-parent-changes-2026-10.md) | Step 1 change report (built 2026-10-31, fixed 2026-11-02) + browser check |
| [serial-tracking-logic-2026-10.md](serial-tracking-logic-2026-10.md) | **Step 2:** the serial tracking logic (client ask, D1–D16, every place a serial moves, worked examples) |
| [serial-tracking-changes-2026-10.md](serial-tracking-changes-2026-10.md) | Step 2 change report (built 2026-10-31, fixed 2026-11-02) + browser check |
| [browser-test-roadmap-2026-11.md](browser-test-roadmap-2026-11.md) | Browser test of steps 1 + 2 together with make or buy, on BP816 and PRO001 |
| [store-handover-held-stock-warning-2026-11.md](store-handover-held-stock-warning-2026-11.md) | Store's handover warns when it takes stock held for an earlier order (3 Nov) |
| [no-serial-warning-2026-11.md](no-serial-warning-2026-11.md) | The warning on all 8 screens when fewer serials are picked than pieces (3 Nov) |
| [material-list-used-and-return-logic-2026-11.md](material-list-used-and-return-logic-2026-11.md) | Logic: what counts as used on the Material List, and what can go back |
| [material-list-used-and-return-2026-11.md](material-list-used-and-return-2026-11.md) | Change report for that (3 Nov) |
| [one-place-for-claims-2026-11.md](one-place-for-claims-2026-11.md) | Support Management's claim button offers both ways: by customer or order, and by serial (3 Nov) |
| [bulk-transfer-open-2026-11.md](bulk-transfer-open-2026-11.md) | **Open:** Bulk Transfer isn't up to date; what to check, and the options |
| [label-carriers-one-entry-2026-11.md](label-carriers-one-entry-2026-11.md) | Label carriers: one entry per part, sticker range generator, what's inside as a checked suggestion, one Save (5 Nov) |

More docs go here as the work continues.
