# Pricing types — build plan (client change 2, 2026-10-22)

**Logic:** `pricing-types-logic-2026-10.md` (R1–R9 + decisions 1–5). Four slices, each tested
before the next. The flow-test data will be reset, but old orders still read correctly: a step
price with no type is **per piece**.

---

## P1 — BOM: operations per piece

**Backend**
- `models/ProcessDefinitionSchema.js` → `InternalProcessSchema.operation`:
  `{ name: String, perPiece: Number }`, optional, default empty.
- `processStepBuilderService.flattenProcessDefinition` / `buildOrderStepsFromProcessDefinition`:
  carry `operation` onto each order step (`ProcessStepSchema.operation`, same shape). Orders keep
  the count they were made with.
- **Validation** on the BOM saves (Sub Child Part, Child Part, Machine): only on an **Out Source**
  step for now (decision 5); `perPiece` > 0; name required when a count is given.
- **Helper** `stepOperation(request view, stepName)`:
  - from the production order's step
  - for a job-work order: from the Sub Child Part's process definition
  - for an old order: from the live BOM

**Frontend**
- `components/inventory/ProcessDefinitionEditor.jsx`: on an Out Source step, "Operations per
  piece (optional)": count + name, e.g. 4 · holes. Hidden on In-House for now.

**Tests:** saved and read back; refused on an In-House step; copied onto a new order's steps; a BOM
edit leaves an existing order unchanged.

---

## P2 — Ordering with pricing types (+ approval, advance, price help)

**Backend: `OutsourceOrder` line**
- `stepRates[]` becomes:
  `{ step, type: 'piece'|'line'|'operation'|'minute'|'hour', rate, operationsPerPiece,
  operationName, time: { minutes, enteredAt, by, byName }, amount }`
  - **`amount`:**
    - piece = rate × qty
    - line = rate
    - operation = rate × ops × qty
    - minute / hour = null until the time is in
  - missing `type` → `piece` (old orders)
- **Line totals:**
  - `amount` = sum of the known step amounts
  - `timePending` = any time-based step without time
  - `unitValue` = amount ÷ qty (the average price per piece, R6), used once nothing is pending
  - `ratePerPiece` kept for old readers = unitValue
- **Order:**
  - `knownTotal` (what's priced at ordering) and `grandTotal` (grows when time is entered)
  - `hasTimeBased`

**`readOrderBody`**
- accepts `stepRates: [{ type, rate }]`
- per job work: allowed only when the step has an operation count (from P1's helper); copies it
- time-based: rate only
- old body shapes (`stepRates: [25]`, `ratePerPiece`) still work, as per piece

**Approval** (`approvalFor`, R5): Pending when known total > limit, OR (`hasTimeBased` AND the
setting is ON). The reason is shown: "above the ₹300 limit" / "time-based rate to check".
- **`PurchaseSettings.approveTimeBasedOutsource`** (off) + `PurchaseRulesSettingsTab.jsx` tick.

**Advance** (R7)
- OutsourceOrder `paymentTerms.advanceType: 'percent'|'flat'` + `advanceFlat`, through its own
  cleaner (the PO's `cleanPaymentTerms` is left alone)
- an all-time-based order allows only flat
- `createOutsourceBill`: advance = % of the known total, or the flat amount (capped at the known
  total when there is one)

**Price help** (`priceHistory`): samples per step **and type**; a per-hour rate is never averaged
with per piece. The display unit follows the type (₹/pc, ₹ line, ₹/hole, ₹/min, ₹/h).

**Frontend**
- **`NewOutsourceOrderDialog.jsx`:** each step's price row gets a type picker (Per piece / Whole
  line / Per job work, shown only when the BOM has a count / Per minute / Per hour), then:
  - its input
  - a live sum ("2 pcs × 4 holes × ₹5 = ₹40", "time entered later")
  - its own price help
  - **Totals:** known total + "plus time-based steps (entered later)"
  - **Terms:** Advance "% of known amount" / "Flat ₹"; flat only when everything is time-based
- **`OutsourceApprovalsTab.jsx`:** step rows show the type and rate; the reason for approval.

**Tests:** examples A–E from the logic doc (totals, GST, approval in all 4 table rows, advance %
and flat, all-time-based → flat only), old-shape bodies still accepted, price help per type.

---

## P3 — Enter time, the bill, acceptance

**Backend**
- **`POST /api/outsource-work/outsource-orders/:id/lines/:lineId/time`** `{ step, minutes }`
  (Purchase edit):
  - **any time after the order is created and approved** (decision 1)
  - **editable until** that line has accepted work posted to the ledger (then the amount is
    locked: refused, "already accepted")
  - **sets** the step amount → recomputes line, GST, `grandTotal`, `timePending`
  - **updates the bill:** its row for that step, `totalAmount`. The advance doesn't change (R7).
  - **logs** the history, and **notifies the Company Admin** (R5: notification, no approval)
- **Bill rows** (`createOutsourceBill`): one per step with its basis text. A time-based row starts
  at ₹0, "awaiting time".
- **Acceptance** (`applyAcceptance`):
  - values accepted / rejected pieces at the line's **unitValue** (R6)
  - doesn't apply while the line's `timePending`; it applies the moment the time is entered
    (`refreshAcceptance` after the time)
- **Job-work cost** (`jobWorkCostPrefill`, T10): the sum of the line's step amounts. A job-work
  order's last receive with time still pending is refused: "enter the time on OSO-… first".
- **Full acceptance / settle:** unchanged, it runs off the bill totals.

**Frontend**
- **`OutsourceOrdersView.jsx`** (order detail):
  - each step shows its basis
  - a time-based step: **Enter time** (h + min) → shows "3 h 20 min × ₹300/h = ₹1,000", with
    **Edit** until accepted
  - the Bill panel shows "awaiting time" rows
- The Orders list shows a "time pending" badge.

**Tests:**
- example C end to end:
  - known ₹118, advance ₹23.60
  - time 1 h 30 → grinding ₹450 + ₹81, total ₹649, advance still ₹23.60
  - admin notified
  - QC pass → payable
- time entered before the work is back (allowed)
- QC passed while the time is pending → nothing payable until the time is in, then it applies
- edit after acceptance → refused
- whole line ₹500 / 6 with 1 rejected → ₹416.67 (+ GST)
- a job-work cost with time pending → refused, then OK

---

## P4 — Regression and the docs

- All suites:
  - slices 2, 3, 5, 6, 7
  - bring-back, step rates (old body shape), paging
  - job-work QC, auto-request
- The esbuild build; the undefined-names check.
- Change report §14; roadmap R1 prices noted; daily report.

## Critical files

- **Backend:**
  - models: `ProcessDefinitionSchema.js`, `ProductionOrder.js` (step `operation`),
    `OutsourceOrder.js`, `PurchaseSettings.js`
  - services: `processStepBuilderService.js`, `outsourceBillService.js`
  - controllers: `outsourceOrderController.js` (readOrderBody, applyTotals, approvalFor,
    priceHistory, the time endpoint, jobWorkCostPrefill), the three BOM controllers (validation)
  - routes: `outsourceWorkRoutes.js`
- **Frontend:**
  - `ProcessDefinitionEditor.jsx`
  - `NewOutsourceOrderDialog.jsx`, `OutsourceOrdersView.jsx`, `OutsourceApprovalsTab.jsx`
  - `PurchaseRulesSettingsTab.jsx`
