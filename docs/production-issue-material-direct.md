# Production Order Management — direct Issue Material (bypass R&D for standard BOM), Receive gate, Issued-To name

Written 2026-08-25. Implements the plan agreed in a planning session covering: computing Production's Material
List live from the locked BOM (no R&D request needed for standard materials), a per-row "Issue Material" button
that sends the material straight to Store, a Department-Head-only gate on Issue Material + Receive, Store
recording who they physically handed material to, and a fix for a real pre-existing bug in "Bill of Materials by
Part".

## Why

Today, `ProductionOrder.materialDemands` for standard BOM materials only ever gets populated one way: Production
raises an R&D request → R&D re-approves the whole (already-locked) BOM → WORKFLOW 2 pushes every material as a
demand. The client doesn't want an R&D request on every single production run of an already-approved BOM — only
when a genuinely new BOM or major change happens (that broader change is explicitly **deferred**, not part of
this round, until the client's requirements for it arrive).

**Explicitly unchanged**: "Add Demand" (out-of-BOM extra materials) already goes through its own, separate R&D
"Material Change" approval — confirmed untouched by this round.

## Safety check before building this

Verified this is safe before writing any code: the three individual Store transfer endpoints
(`transferMaterialToProduction`, `transferSheetMetalPlanToProduction`, `transferFabricationMaterialToProduction`)
have **no status precondition at all** — they resolve a demand purely by `materialCode` — and `getPendingRequests`
(Store's Pending Transfers list) only ever checks `materialDemands.status === 'Requested'`, nothing on the parent
`ProductionOrder` (`bomVerified`/`rdRequestRaised`/etc.). So a freshly-created demand with `status: 'Requested'`
is picked up by every existing Store-side mechanism with **zero changes needed there**.

## Shared BOM-grouping — reused, not reimplemented

`server/services/bomMaterialGroupsService.js` (new) holds `plainMaterialGroupsFromBOM` and
`lengthFabricationGroupsFromBOM` — the second one **moved** here from `materialAvailabilityService.js` (Store
Orders' material-availability check, built earlier this session), which now imports it instead of defining its
own copy. `sheetMetalGroupsFromBOM` stays in `sheetMetalPlanController.js` (still the source of truth for the
Sheet Metal Plan feature itself) but gained a `childParts` field on its returned groups — purely additive.

All three grouping functions now return a `childParts: [{childPart, subChildPart}]` array (deduped) alongside
their existing fields, powering the new hover tooltip on Production's Material List.

## Backend

**`server/models/ProductionOrder.js`'s `MaterialDemandSchema`** — one addition:
```js
issuedToName: { type: String, default: null, trim: true }, // Store's free-text entry, mirrors qcBy's pattern
```
Plain `String`, not a `User` ref — matches `ProcessStepSchema.qcBy`'s existing precedent in this same file
(typed directly into the form), since the person Store hands material to may be a floor worker with no login.
Overwritten on each subsequent transfer of the same demand, so only the most recent issuer survives — accepted
knowingly, since Production's Receive UI has zero access to `StoreTransferLog`'s per-event history today and
wiring that up would be a much bigger change for what's normally a one-shot transfer.

**`server/controllers/productionMfgController.js`** — two new handlers:
- `getMaterialList` (`GET /orders/:id/material-list`) — runs all three grouping functions against the order's
  locked `RDBOM`, cross-references each group's key (`code` or `code#dimensionVariantId`) against
  `order.materialDemands`, and returns one unified row per group — either the real demand (already issued,
  today's exact behavior) or a lightweight "not issued yet" row computed straight from the BOM. Also includes
  any existing demand that does **not** match a BOM group key at all — these are "Add Demand" out-of-BOM
  entries, which would otherwise silently vanish from the list since they were never derived from a BOM group.
- `issueMaterialToStore` (`POST /orders/:id/materials/issue`, body `{groupKey}` only) — HEAD_ROLES-gated,
  re-derives the group fresh from the BOM server-side (never trusts a client-sent quantity), rejects if a demand
  for that key already exists (idempotent), and pushes one `materialDemands` entry with `status: 'Requested'` —
  same field shape WORKFLOW 2 already produces.

**`receiveMaterialInProduction`** (existing) — gained the same `HEAD_ROLES` guard at the top. **Real behavior
change worth flagging**: this endpoint was previously reachable by any user with `production.orders.edit`; it's
now Department-Head-only, per the client's explicit ask.

**Permission pattern**: `HEAD_ROLES = ['Production Head', 'Superadmin', 'Super Admin']`, checked inline inside
the two controllers — mirrors `productionExpenseController.js`'s own `canManage`/`HEAD_ROLES` pattern exactly
(already established in this same module), layered **on top of** the existing route-level
`checkPermission('production','orders','add'|'edit')` rather than replacing it, since other actions on the same
page (Add Demand, Adjust Qty, Return, View) stay open to regular Production Employees.

**`inventoryController.js`'s three transfer functions** — each gained one additive `issuedTo` request-body field,
persisted onto `demand.issuedToName` alongside the existing `transferredQuantity`/`status` update. No other
change to any of them.

**`transferSheetMetalPlanToProduction`** (renamed in comments, not in code, to reflect its broadened scope) —
its guard changed from "does this demand have `sheetMetalPlanId`" to "does this demand have `fabricationCategory`
set AND *no* specific per-cut `bomDimensions`" — covers both Sheet Metal plan-driven demands and the new
length-fabrication group demands with the same flat "N whole pieces, no cutting decision" transfer, since both
share the exact same tell (empty `bomDimensions` — there's no per-cut size left to track once either kind of
group already decided a flat piece count).

## Frontend

**`client/src/pages/production/OrderManagement.jsx`**:
- "Material Demand" section renamed **Material List**, now driven by `GET .../material-list` instead of reading
  `detailOrderLive.materialDemands` directly — a row with `demand: null` shows "Not Issued" + an "Issue Material"
  button (HEAD_ROLES-gated via `useAuth()` + the same `HEAD_ROLES` array, mirroring `ProductionExpenses.jsx`);
  a row with a real demand renders exactly as before, with "Receive" now also HEAD_ROLES-gated and the issuer's
  name shown when present.
- New hover tooltip per row (`childParts`) — same hand-rolled `group`/`group-hover` Tailwind popover already
  used for Store Orders' "Available Material"/"Needs Purchase" tooltips this session.
- `materialList` is fetched separately from the orders list query, so every action that mutates
  `materialDemands` (Issue Material, Receive, Return, Add Demand/Adjust Qty) explicitly calls
  `refetchMaterialList()` afterward — otherwise the Material List would show stale demand state until the
  dialog was closed and reopened, since it no longer reads live off `detailOrderLive`.

**Bug fixed — "Bill of Materials by Part"'s View button**: was calling `openMaterialView(mat.code)` (a bare
string), but `openMaterialView` expects an object with `.sourceItemCode`/`.materialCode` — so `demand.code`
resolved to `undefined` for every row, every time, and the dialog always showed "No matching entry found... for
code " (blank). Fixed to `openMaterialView({ ...mat, sourceItemCode: mat.code })`. Also added a `<thead>` with
column labels to this section's inner table — it previously had none.

**`client/src/pages/store/MaterialHandshake/tabs/PendingRequestsTab.jsx`**:
- Both the Standalone Transfer Modal and `FabricationTransferDialog` gained an "Issued To" `Input`, threaded
  into their respective transfer mutations' POST body as `issuedTo`.
- `handleTransferClick`'s dialog-routing condition changed from `!material.sheetMetalPlanId` to checking for an
  empty `bomDimensions` — otherwise a length-fabrication demand (no `sheetMetalPlanId`, but also no specific
  cut) would have incorrectly opened the per-cut `FabricationTransferDialog` instead of the flat dialog. The
  Standalone Transfer Modal's own endpoint selection was fixed the same way (was keyed off `sheetMetalPlanId`
  alone, which would have 400'd a length-fabrication transfer against the plain non-fabrication endpoint).
- `bulkTransferOrderMaterials` ("Bulk Transfer Card") — left as-is; confirmed it's a single no-dialog click that
  can move several demand lines at once, so one "Issued To" name wouldn't map cleanly to a line.

## Known gap / not built this round

- No UI surfaces `MaterialReturnLog`/`StoreTransferLog` per-event history — "Issued To" is a single, overwritable
  field on the demand itself, not a full audit trail.
- The broader R&D-request-frequency change the client mentioned (only re-approve on a genuinely new/changed BOM,
  not every production run) is explicitly deferred — this round only removes the requirement for *standard* BOM
  materials to wait on any R&D cycle at all; the underlying `raiseRDRequest`/WORKFLOW 2 mechanism itself is
  untouched and still exists for whenever it's actually needed.
