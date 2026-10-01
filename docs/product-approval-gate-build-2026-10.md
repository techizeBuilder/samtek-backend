# Product Approval Gate — what was built (2026-10-01)

Plain-language change report for `product-approval-gate-redesign-discussion-2026-09.md`.

## What changed for R&D
- **One Approval page** (`/r&d/design-approval`, sidebar "Approval") replaces Design Approval, Prototype Management and Approve Requests. Three tabs — Sub Child Part, Child Part, Machine — each row shows Design, BOM, QC List, Prototype (Machines) and Release as chips. **Manage** opens the step-by-step panel.
- **Design** is recursive: a Machine can't be design-approved until every Child Part (and their Sub Child Parts) underneath is. The refusal names exactly which parts to approve first.
- **BOM Approved** is its own sign-off, separate from "Lock BOM" (which is untouched). Needs an actual BOM and every part underneath BOM-approved.
- **QC List Approved** signs off the checklist configured on that item. Every configured stage must have rows, and every QC-flagged BOM step needs its checklist. **Editing the checklist afterwards voids the sign-off** (and pulls Release back).
- **Prototype** testing now lives inside a Machine's Manage panel. One passed prototype is required before release.
- **Release** is the last step. Machines ticked "Forward to Design & Prototype" need Design + BOM + QC List + Prototype. **Purchase Machines** need only the QC List. Child Part / Sub Child Part always need Design + BOM + QC List (no prototype). A parent can't be released while a part underneath is unreleased.

## What changed for Sales
- Every Machine must be Released to appear in a picker (previously only forwarded machines were checked).
- Order create/update now also **reject** unreleased/discontinued items on the server, so a direct API call can't bypass the picker. (Items already on an order stay editable.)

## What changed for Production
- Auto orders (low-stock reorder and the Machine → Child Part → Sub Child Part cascades) **skip anything not Released**. Manually building the first unit is unaffected.
- The per-order BOM & Design check uses the recursive Design rule and shows which parts are still waiting. It still does not wait on QC List, Prototype or Release.
- **"Raise R&D Request" is gone**, and so is Material Change review. Extra-material requests now take effect immediately and go straight to Store.

## Existing data
Run `node scripts/migrateProductApprovalGate.js --dry-run`, then without the flag. It marks every existing Machine / Child Part / Sub Child Part approved + Released, moves "BOM Pending" orders to Pending, turns stuck "Pending R&D" demands into Requested, and drops the old `rdrequests` collection.

## Not done / worth knowing
- Machine BOMs only reference Child Parts today, so "directly referenced Sub Child Part" (design §3c) has nothing to check at Machine level yet.
- Leads hold no item references server-side, so only Orders got the server check.
- Never run against a real database in this session (none available); logic was verified with in-memory tests and the UI in a browser with mocked data.
