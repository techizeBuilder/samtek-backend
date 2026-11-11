# Step 1 built — cascade orders deliver to their parent order (2026-10-31)

> **Updated 2026-11-02:** a review found gaps in the 31 Oct build. The fixes are in "2 Nov fixes" below.

Logic: [cascade-to-parent-logic-2026-10.md](cascade-to-parent-logic-2026-10.md) (P1–P4, agreed with you).

## Why
For serial tracking, a part built **for** a Machine / Child Part order must reach **that** order. Before
this, it went into stock and the parent took "any" one through Store. And a real gap: the parent
reserved its **full need** from stock **and** its cascade built the **full need** — stock 1, need 3 →
built 3, one for nobody; Reservations showed "short by 2" while it was being made.

## What changed

1. **Stock first, build only the shortfall** (P1). Stock 1, need 3 → the parent reserves **1** (Store
   issues it as today) and the cascade order is for **2**. A **bought** part keeps its full reservation
   (its purchase arrives into stock and Store issues it).
2. **Finished parts go straight to the parent.** When a cascade order made from now on finishes a unit /
   batch, the parts are **not** added to stock: they go onto the parent's Material List line, counted as
   issued and received in Production. Every way a part can finish does this — Production's last step,
   a QC pass (unit or batch), an outsourced last step's receive, a job-work order's final check.
3. **The parent's Material List** (Production → the order's Material List):
   - the part's row says **"Built for this order (ORD-…): 1 of 2 delivered · from stock: 1"**
   - **Issue** asks Store only for the stock part (refused above it: "… 2 come straight from ORD-…
     (built for this order)")
   - the Issue dialog shows the part built for the order
4. **The cascade order** shows **"built for ORD-… — finished parts go straight to it (n delivered)"**
   (Order Management and the order page).
5. **More than the parent still needs** (e.g. a replacement after scrap, then the original comes good
   too) → the extra goes to **stock**.
6. **Store's re-route** (the only way a parent goes away — there's no cancel): its Pending Machine order
   is deleted as before, and the orders its cascade raised now become **stock orders** (their output
   goes to stock) instead of pointing at a deleted order. Their own cascades still deliver to them. If a
   parent is ever missing or already Completed when a part finishes → stock (a safety net).
7. **Orders made before today are unchanged** — they still finish into stock (no data changed).

## Not changed
Low-stock (cron) orders, bought parts, anything Store issues from stock, costs (the price push),
Production's returns, Dispatch / outsource flow, QC.

## Technical notes
- **New `services/cascadeDeliveryService.js`:** `splitDelivery` / `cascadeOnRow` (pure),
  `recordCascadeCover`, `deliverFinishedParts` (parent's demand line + cover, atomic updates; the rest /
  any failure → stock), `detachCascadeChildren`.
- **`materialReservationService.checkAndReserve`:** `capToFree` (reserve only what free stock covers;
  never below issued; returns `reservedQty`).
- **`machineReorderService` / `childPartReorderService`:** part lines use `capToFree` (built parts), the
  cascade is sized to the shortfall with `deliverToParent` + `parentOrderNo`, and the parent's
  `cascadeCovers` is recorded; Material List rows carry `cascade`, `issueLimit` and the Issue request
  exclude the covered part; `requestedQty` = what was asked of Store.
- **`createChildPartOrderForItem` / `createSubChildPartOrderForItem`:** `deliverToParent`,
  `parentOrderNo`; the "already open" answer now returns that order. Replacement orders
  (`raiseReplacementFor`, Dispatch's lost-at-vendor) inherit both.
- **Models:** `ProductionOrder` / `SubChildPartJobWorkOrder` — `deliverToParent`, `deliveredToParentQty`,
  `parentOrderNo`; `ProductionOrder.cascadeCovers[]`; material demand `cascadeDeliveredQuantity`.
- **Finish points → `deliverFinishedParts`:** `productionMfgController` (old painting finish, final
  step: Child Part + Sub Child Part), `qcController` (unit QC pass, batch QC, job-work final, old Sub
  Child Part path), `outsourceWorkController` (outsourced last step, both kinds),
  `subChildPartJobWorkOrderController` (no-QC last receive).
- **`storeFlowService`:** the re-route's release helper also detaches the cascade children.
- **Frontend:** `ProcessExecution.jsx` (Material List row + Issue dialog + order header),
  `OrderManagement.jsx` (order list).

## Checked
- **25 / 25** on a made-up company (Machine → Child Part → Sub Child Part, real services + the real
  final-step handler): reserve 1 / build 2 one level and reserve 1 / build 3 the next; re-check makes no
  duplicates; the list and the Issue cap; the Sub Child Part batch lands on the Child Part order's line;
  both Child Part units land on the Machine order's line (stock unchanged, history kept); over-delivery,
  a missing parent and an old order → stock; Store's re-route detach (grandchild kept); no stock →
  nothing reserved. 0 left.
- **Regression:** slice 4 cost 30 / 30, scrap replacement 7 / 7, partial returns 16 / 16, make-or-buy
  cascade 19 / 19. Every touched backend file loads (also under ts-node); both pages build.
- **Not run through a real handler** (same one-line call, variables checked): the unit / batch QC pass,
  the job-work final check and the outsourced last-step receive. **Your browser check covers them.**
- **Not yet clicked through in the browser.**

## 2 Nov fixes (logic doc §7)

**The gap:** the outsource material plan said a part still being built comes "from Store", but a cascade part
no longer enters stock, so Dispatch's "Material not ready" never cleared. Real dev data has this shape: Fan and
Chamber welding are Out Source first steps that use Sub Child Parts.

**Where a finished part goes now:**

| Part's last step | Parent's step using it | Where it is | Who gives it |
|---|---|---|---|
| In-house | Out Source | Production | Production hands to Dispatch |
| In-house | In-house | Production | Production uses it |
| Outsourced (via Store + QC) | Out Source | At Store, in stock, held for the parent | Store hands to Dispatch |
| Outsourced (via Store + QC) | In-house | Production, by itself | Production uses it |

**What changed:**
- **The plan.** A part being built in-house is planned "from Production", and the Outsource Order's row says
  "6 from Production (6 still being made, ORD-…)". A part coming through Store stays "from Store".
- **Dispatch and Purchase.** They wait for it: *"Fan Blade 2 / 6 (being made, ORD-…)"*. No trip until it's all
  delivered. Purchase can still tick "order anyway".
- **Issue.** Production can't ask Store for what its cascade delivers, and a part coming through Store isn't
  subtracted twice.
- **A refused replacement.** If pieces are scrapped or lost and no replacement order can be made (e.g. the part
  was switched to Bought), the parent's "built for this order" count goes down so Issue opens. A bought, released
  part also raises a purchase request, held for the parent. A replacement that is made is named on the parent's row.
- **Reservation.** Only free stock is reserved when a delivering order really exists. Otherwise the full need,
  as before (e.g. a part not released yet).
- **A delivered part returned.** The count goes down and the line asks Store for it.

**Technical:** `cascadeDeliveryService` (`finishedViaStore`, `usedNextOnOutsourcedStep`, `cascadeIssueLimit`,
`addCoverOrder`, `coverNotReplaced`), `cascadeCovers[].viaStore`, `deliveries[].atStore`;
`materialReservationService.reserveForOrder`; plan rows `awaitingDelivery` + `awaitingOrders`
(`outsourceMaterialPlanService`); `outsourceMaterialReadyService.cascadeShortfall` + `materialShortfall` at all 3
places (Dispatch's waiting list, trip creation, Purchase); `outsourceEarmarkService` `productionAwaiting`;
`confirmReturn`. Frontend: `OutsourceOrdersView.jsx` (plan text).

**Checked:** 45/45 on a made-up company (`ga-test`), including all 4 rows with the Outsource Order made *before*
the part is ready; plus the finish routes through real handlers (batch QC pass, unit QC pass, job-work final check,
outsourced last step), which were the "not run" list above. 0 left.

**Regression after these fixes, all pass:** step 1 25, step 2 A–D 17 / 17 / 17 / 11, one-REJ 21, reject-with-lines 15, slice 4 cost 30, scrap replacement 7, partial returns 19 + 16, rework lost 10, job-work QC 23, bring back 30, Dispatch store 24 + 19, make-or-buy 17 / 19 / 9 / 10 + gate 18, material ready 13. `material-ready-test` was changed: it faked parts arriving by adding them to stock, which the agreed rule replaced. **Skipped:** the other outsource suites from slices 2–8 and the old §67 photo suite (it rejects 3 pieces without lines, refused since §68). Backend loads; every changed page builds. **Not yet clicked through in the browser.**

## Browser check (for you)
1. Put **1** of a Child Part in stock; raise a Machine order needing **3** (a sales order or the stock
   form). Store → Reservations: the Machine order holds **1** (no "short"). A Child Part order for **2**
   appears, saying "built for ORD-…".
2. The Machine order's Material List: the Child Part row says "Built for this order … 0 of 2 delivered ·
   from stock: 1"; Issue lets you ask Store for **1** only.
3. Finish one Child Part unit (any route) → the Machine order's row "1 of 2 delivered"; the Child Part's
   stock doesn't change. Finish the second → 2 of 2.
4. The same one level down if that Child Part has Sub Child Parts short.

### Added 2 Nov: the outsource path
5. A Child Part whose **first step is Out Source and uses a Sub Child Part** (Fan welding), Sub Child Part in-house,
   no stock. Purchase's request warns *"Blade 0 / 6 (being made, ORD-…)"*. Order it with "order anyway": the order
   shows "6 from Production (6 still being made)". Dispatch can't plan a trip.
6. Finish some of the Sub Child Part batch: Dispatch reads 2 / 6. Finish the rest: the line becomes sendable,
   Production hands over, Delivered.
7. The same with a **fully outsourced** Sub Child Part (job work): after its QC pass the stock goes up and Reservations
   shows it held for the Child Part order. Dispatch can send it; **Store** hands it over.
8. The same job-work part where the parent's step is **in-house**: it lands on Production's line, not stock.
9. Switch a part to Bought, then scrap pieces of its open order at QC: no replacement order; the parent's Issue opens
   for those pieces and a purchase request appears.
10. Production returns a delivered part: the row's "delivered" goes down and the line asks Store for it.
