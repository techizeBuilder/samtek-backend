# Feature 1: Low-stock sweep for machines (browser test)

*Written 6 November 2026, company test-1 on dev. What changed: [01-machine-low-stock-changes.md](01-machine-low-stock-changes.md).*

**Test machine: IHT (in house test).** It's Released, built, has stock 0 and no open stock order. Don't use PRO001 or PRO-0014: old open stock orders ORD-2026-047 and ORD-2026-051 hold them, which is correct but won't show a new order.

**The sweep runs at :00 and :30.** You don't have to wait: tell me when a step needs a sweep and I'll run it once for you.

## Steps

### 1. R&D sees the tab
R&D → Inventory → **Machines**.
- [ ] All active machines are listed, 20 a page, and search works.
- [ ] IHT shows Built, Released, stock 0, Flow **Off**, Min Stock 0, no Build open.
- [ ] PRO-0014 shows **Built** even though Product Master calls it a Purchase Machine.
- [ ] PMT shows **Bought** and not Released.

### 2. Nothing starts by itself
PRO001 has an old Min Stock of 2 and Flow Off.
- [ ] Store → Inventory → Product Master: PRO001's Min / Order says **Not set**, with no Low stock badge.

### 3. Manage Stock
Open Manage Stock on **IHT**.
- [ ] Pick Low Flow: **Min Stock stays as it was,** it doesn't jump to 5.
- [ ] Enter Min Stock 1, Order Quantity 2, Build Days 10. The line reads "When stock is 1 or less, a build order for 2 is raised automatically, one at a time."
- [ ] Save. The row shows Low Flow, 1, 2, 10 and a **Low stock** badge.
- [ ] Open Manage Stock on **PMT**, pick Low Flow and enter Min Stock 1: there's no Build Days field, and the line starts "Waits until this machine is Released" and says purchase request. **Cancel,** don't save.

### 4. Store sees it, before the order
Store → Inventory → Product Master.
- [ ] IHT: stock 0 with **Low stock**, Min / Order **1 / 2**, no Build open.
- [ ] **Low stock only** shows IHT and paging stays right.

### 5. The sweep raises the order
Run the sweep (tell me, or wait for :00 / :30). Then Production → Orders.
- [ ] One new order: **IHT × 2**, Stock, Normal, delivery **today + 10 days**, steps pre painting, post painting, coating.
- [ ] Production's bell shows the new order.

**The cascade, worked from dev data on 6 Nov.** IHT needs 1 Fan per machine, so 2 for this order. Fan has stock 1 but it's all reserved, so free stock is 0: **a Fan order × 2, built for this order.** That Fan order then raises what it's short of; I'll read those from the data at this step, because other open test orders share the same parts.

**I'll check on dev data:** the order, Fan order, reservations and any purchase requests.

**/store/reservations:** new rows for what the Fan order reserves.

### 6. Store and R&D show the open order
- [ ] Store's Product Master: IHT **Build open** shows the new order and (2).
- [ ] R&D's Machines tab shows the same.

### 7. One at a time
Run the sweep again.
- [ ] No second IHT order.

### 8. Off stops it
Open Manage Stock on **BP816** (stock 0, no open stock order). Leave Flow on **Off**, enter Min Stock 1, Save. Run the sweep.
- [ ] No BP816 order.
- [ ] Min / Order on Store says **Not set**.

### 9. The form still works and counts
Production → Orders → New Stock Order, Machine, BP816, quantity 1.
- [ ] It's created as before, and names what it reserved and raised.
- [ ] Set BP816's Flow to Low and Min Stock 1, then run the sweep: **no second order,** because the form's order is open.
- [ ] Set BP816 back to Off when done.

## Not needed on screen
Covered by the `machinestock` suite:
- A released bought machine raising a request. No bought machine on test-1 is Released, and releasing one just for this isn't worth it.
- Build Days of -1 or 1.5 refused. The screen refuses them too.
- A sales order not holding the sweep, and Completed or Cancelled stock orders not holding it.
- Pieces waiting for a sticker counted correctly. To see it on screen you'd have to finish a stock order for a machine that holds a serial.
- Finishing the order and stock going up. Unchanged code, seen working on ORD-2026-104.

## Automatic results
| Suite | Result |
|---|---|
| `machinestock` | 70 of 70 |
| Regression: `stockorder` 83, `labelbulk` 64, `fabsync` 32, `makebuy-s3` 9, `makebuy-gate` 18, `auto-request` 9, `gc` 40, `s1` 25 | 280 of 280 |

## Browser results
Not started.
