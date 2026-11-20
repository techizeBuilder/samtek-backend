# Feature 12: Order tracker for the Complaint team (what changed)

*Built 14 November 2026. Logic and your decisions (Q1 internal now, a customer link later; Q2 Complaint team + Sales Head; Q3 enquiry notes): [12-order-tracker-logic.md](12-order-tracker-logic.md). Browser test: [12-order-tracker-test-roadmap.md](12-order-tracker-test-roadmap.md).*

## In one line
A new **Order Tracking** page shows where a customer's order is, item by item, with **a sentence to read out to the customer**, details for the team, a timeline, and **a notes list of what customers were told**. It joins records every department already keeps; nobody types anything new.

## Where it is
- **Complaint team:** menu → **Order Tracking** (`/complaints/order-tracking`), after Deal Verifications. For the Head and the Employee.
- **Sales Head:** menu → **Order Tracking** (`/sales/order-tracking`), view only.
- **New permission "Order Tracking":** in the Complaint module and in the Sales module.
  - **Given once to existing users:** Complaint Head (all), Complaint Employee (view + add a note), Sales Head (view).
  - **New users** get the same from their role's defaults.
  - **A Company Admin can tick it** for anyone else, e.g. a salesperson.

## The list
- **Search** by order number, the customer's mobile, customer name, or the company name on the order form.
- **A production order number** (PROD-… or ORD-2026-…) finds its customer order.
- **Show:**
  - **On their way** (default)
  - **Delivered**
  - **All**
- **Paged on the server,** 20 a page, newest first.
- **While searching, each tab shows how many orders match** (added in the browser test, as on Production → Orders):
  - Nothing in this tab, but one other tab has it: the page opens that tab, with a note saying why, e.g. *"No order on its way matches "ORD-0130", so this is Delivered."*
  - **All** is used when the order is in neither, e.g. a cancelled one.
  - The jump is decided once per search; picking a tab yourself is never undone.
- **Each row:** order number, customer and mobile, order date, promised date (red "N d late" when it's passed), a small stage bar with the stage, and the number of items.
- **"Delivered"** means every unit's dispatch line is delivered (or the customer confirmed it reached). An order **marked completed** by hand also counts.
  - If its records stop earlier, it carries a grey **"Marked completed"** flag (older orders on test-1, e.g. ORD-0090).

## One order
- **Header:**
  - customer, mobile (tap to call), company, order date
  - **the promised date** (the Order Form's delivery date): *on track* / *N days late* / *No date was promised*
  - **deal verification** and **payment check**, as information
- **The stage bar:** Placed · Verified · Order form · In work · Final QC · **Packing** · Dispatched · Delivered.
  - The order is as far as its slowest item.
  - *"Packing" replaces the logic doc's "Packed": it covers passed QC, being packed and packed.*
- **Per item:** the stage, then a green **"Tell the customer"** box with a copy button, then **"For the team"** details:
  - the production order and steps done per unit
  - what Start would say it's waiting for
  - the part orders made for it
  - the QC job
  - the purchase request and PO
  - packing counts
  - the dispatch line (transporter, vehicle, tracking, dates, installation)
- **Timeline:** order placed, deal verified, order form, payment checked, production started and finished, final QC, packed, dispatched, delivered, installation scheduled.
- **"What the customer was told":** the notes, newest first.
  - **The Complaint team adds one** (up to 500 characters). It's saved with who wrote it and the order's stage at that moment.
  - The Sales Head sees the notes but has no box.

## The sentences
| Where the item is | Sentence |
|---|---|
| Not routed by Store yet | "Your order is confirmed and being processed." |
| Being bought | "It's being procured. Expected in stock by 20 Dec." (the PO's date, when there is one) |
| To be made, material not ready | "It's being prepared for production; materials are being arranged." |
| Waiting for a part we make | "It's being prepared for production; one of its parts (Fan) is being made first." |
| A step at a partner workshop | "It's in production; one step is being done at a partner workshop." |
| Being made | "It's in production: 2 of 4 steps done (now: paint)." / "…(next: …)" / "It's in the production queue (first step: cutting)." |
| A QC check between steps | "It's in production, at a quality check between steps." |
| No production order found | "It's being prepared for production." The team detail says: *ask Production* |
| Final QC | "It's ready in stock and going through our final quality check." / "It's built and going through our final quality check." |
| Failed final QC | "Our final check found something to correct. It's being fixed before dispatch." |
| QC passed / being packed / packed | "It passed our quality check and is being packed." / "It's being packed." / "It's packed and ready for dispatch." |
| Dispatched | "It's on its way: dispatched on 12 Nov, by (transporter), vehicle (no.), tracking (id). Expected by 15 Nov." |
| Delivered | "It was delivered on 10 Nov." plus "Installation is scheduled for 20 Nov." / "Installation is done." / "Installation is not scheduled yet." |

**Machines are counted one by one:** "1 of 2 is ready; the other is in production: 1 of 3 steps done (now: paint)."

**Never in a sentence:** costs, people's names, outside vendors' names, or what QC rejected. The transporter's name is in, because the customer needs it to track the delivery.

## "Waiting for" = Start's own checks
For a step that hasn't started, the tracker asks the same checks as the Start button (feature 11's shared `startBlockers`): material, the step's own material, Store hold, the previous step.

**The BOM tick is checked without saving.** Process Execution and the Work Planning board set it the first time an approved BOM is opened. The tracker only asks whether it *would* be set, so opening an order here changes nothing.

## Found on test-1
- **ORD-0125 and ORD-0118** were sent to Production, but no production order exists for them, by order number or by item. They're older test data. The tracker shows *"It's being prepared for production"* and tells the team to ask Production.

## Technical notes
**Server:**
- **New `services/orderTracking/trackerService.js`:**
  - `itemStage` (pure), `orderBar`, `promise`
  - `loadJourneys`: bulk loads for a page of orders
  - `searchOrders`, `orderView`, `addNote`
  - `deliveredOrderCodes`: one aggregate over DispatchOrder plus the Sale quantities
- **New `models/OrderEnquiry.js`:** the notes, kept apart from Order.
- **New `routes/orderTrackingRoutes.js`**, mounted at `/api/order-tracking`:
  - `GET /orders`, `GET /orders/:orderCode`
  - `POST /orders/:orderCode/notes`
  - permission: `checkAnyPermission([['complaints','orderTracking'], ['sales','orderTracking']], 'view' | 'add')`
- **`services/hrPermissionBackfill.js`:** new general `grantModuleFeatureOnce` and `ORDER_TRACKING_GRANTS`, run once at startup (`index.js`). The stamp is `orderTrackingGrantedAt`.
- **`productionMfgController.js`:** `autoVerifyMachineOrder(…, { dryRun })`.
- **`services/planning/boardService.js`:** `holdOf` is exported.

**Screens:**
- **New `pages/complaintsAndServices/OrderTracking.jsx`:** the list, the order view, notes; `?order=ORD-0127` opens an order directly.
- **`lib/roleModulesConfig.js`:** `orderTracking` in the complaints and sales features; Sales Head's default is view.
- **`config/moduleRoutes.js`:** the Complaint Head and Employee menus, and the Sales menu.
- **`App.jsx`:** the two routes.

## Tests
- **New suite `ordertrack`: 69 of 69, 0 left behind** (including the counts per tab while searching, and date-only timeline entries). Through the real server, on made-up companies, one order per stage. It checks:
  - **Every stage:** the exact sentence; the team details (Start's reason, the part order, the QC job, the PR and PO).
  - **Sentence safety:** no customer, staff or reject text in any sentence.
  - **The order:** the bar before the form and with two items; the promised date (late / on track / none / delivered).
  - **The list:** show open / delivered / all; "Marked completed".
  - **Search:** order number, mobile, customer, company, production order number, and "(".
  - **Paging.**
  - **Notes:** stage and author stamped; empty, too long, unknown order.
  - **Access:** Sales Head view-only (403 on a note); Sales Employee 403; another company 404, with only its own list.
  - **The one-time grant:** the right actions per role, existing permissions kept, a removed one stays removed.
  - **Pure `itemStage` checks.**
- **Regression:** `planboard` 26 (shares `holdOf`); `hrperms` 33 (the catalogue changed, re-bundled).
- **Checked on test-1's real data:** the list in about 2 s, one order in about 1.5 s. ORD-0127 waiting for material; ORD-0119 waiting for its Fan part order (ORD-2026-069, 1 of 5 steps); ORD-0124 in final QC; ORD-0122 packed; ORD-0120 being packed.
- **Screens compile:** OrderTracking, App, moduleRoutes, roleModulesConfig.
