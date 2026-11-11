# New Stock Order: the form on Production → Orders

*Built 5 November 2026, found while preparing browser test step 10. All three types added the same day, at your ask.*

## The problem

The **New Order** form was old code:

| Should do | The old form |
|---|---|
| Set a quantity | No field, so every order was for 1 |
| Reserve from stock, then build or buy the shortfall | Nothing reserved, nothing raised |
| Pick a real machine | Code and name typed by hand; a typo silently gave the old 6 steps |
| Keep to what R&D has released | Not checked |
| Stay honest about where the machine goes | "Store Order" said it goes to dispatch, but with no customer linked it went to stock |
| Build a part for stock | Machines only. A part needed a minimum stock and the half-hourly sweep |

A refusal also closed the dialog with no message.

## What happens now

**New Stock Order** shows on all three tabs and opens with that tab's type chosen.

```
Type *      [ Machine | Child Part | Sub Child Part ]
Part *      [ Search code or name..       v ]
Quantity *  [ 1 ]        Priority  [ Normal v ]
Delivery Date * [        ]
```

**Stock only (your decision).** The customer option is gone. A customer's machine comes through Leads → Order Form → Store.

### What each pick list offers
Always **Released** by R&D (your decision) and **not discontinued**. Then:

| Type | Also needs | Why |
|---|---|---|
| **Machine** | Not a Purchase Machine; has a Machine BOM | It's bought, not built; with no BOM it would get the old 6 steps |
| **Child Part** | Made, not bought; has a Child Part BOM | A bought part goes through Purchase |
| **Sub Child Part** | Made, not bought; has a source material and steps | Nothing to build from otherwise |

The form warns on a machine whose BOM isn't locked, because Production can't start until R&D locks it. Parts have no lock.

### What each type does
Each type uses the code that already makes that kind of order, so it behaves like one:

| Type | What it does |
|---|---|
| **Machine** | Reserves Child Parts and materials from stock. A shortfall gets a part order or a purchase request |
| **Child Part** | Reserves Sub Child Parts and materials from stock. A shortfall gets a part order or a purchase request |
| **Sub Child Part, with any in-house step** | A production order. Reserves its source material; a purchase request if short |
| **Sub Child Part, every step outsourced** | A **job-work order (SCJW-…)**, which goes to Purchase. The message says so, because it doesn't appear on the Orders page |

**A built part** reserves what's free, and its part order is built for this order. **A bought part or plain material** reserves the full need, and a purchase request covers what's short. **A part that isn't released** gets no order, and the message names it.

**Example: 2 machines, each needing 1 Chamber, 1 Panel, 5 bolts, 1 motor**

| Line | Need | Stock | Reserved | Raised |
|---|---|---|---|---|
| Chamber | 2 | 2 | 2 | Nothing |
| Panel | 2 | 1 | 1 | Panel order × 1 |
| Bolts | 10 | 100 | 10 | Nothing |
| Motor | 2 | 1 | 2 | Purchase request × 1 |

**After creating,** a message says what happened. **A refusal** keeps the form open and says why. The server checks everything too, and takes the code and name from the item, not from what's sent.

**Finishing is unchanged:** it goes into stock, and anything holding tracked serials waits on Label carriers.

### Rules worth knowing
1. **A part with an order already open:** the form doesn't stop you. Production asked for this quantity on purpose, so the form names what's open and this order goes on top: *"Already open for stock: ORD-2026-089 (1)"*. Only orders that add to stock are named; one built for a parent isn't.
2. **The sweep doesn't add more meanwhile.** A hand-made part order counts as a low-stock order, so the sweep won't raise another for that part while one is open. If a minimum is set, it can raise again once finished.
3. **Lost or scrapped pieces get no automatic replacement,** the same as a low-stock order. Only orders built for a parent get one. Production raises a new stock order if it still wants them.
4. **Date, priority and who made it** come from the form and the login. Automatic orders still use today's date and the part's creator.

**Noticed, not changed:** on a loss, the message says *"A low-stock order — the low-stock job raises another if the stock is still low"*. For a hand-made part that only holds if a minimum is set.

## Pick list paging
Not paged: it loads every item it may offer and searches them in the dropdown. It's bounded by the product catalog and isn't a growing history.

## A rule that changed: read this one
The approval redesign (§3f.3) said a machine's **first unit is built by hand before Release**, because a Prototype needs a machine to test, and only automatic orders wait for Release. **Your decision on 5 Nov is released items only**, so an unreleased machine or part can't get an order from this form.

- **Release still works:** it needs a passed Prototype, and a prototype record doesn't need a production order.
- **What's lost:** a prototype's first unit isn't built through a production order, so it gets no steps, material list or QC in the system.
- **If the client wants that later,** it would need its own prototype route. Nothing is built for it now.

## Docs I read for this
| Doc | What it decided here |
|---|---|
| `product-approval-gate-*` | Purchase Machines left out; Lock is separate from Release; the rule change above |
| `bom-hierarchy-redesign-build` | Real steps at every creation point; no BOM means the old 6 steps, so no BOM isn't offered |
| `make-or-buy-*` | A bought part is never built, so it isn't offered |
| `serial number work/cascade-to-parent-logic` | Stock first, build the shortfall. It already named "the stock form", which had never been wired |
| `outsource-v2/auto-outsource-requests` | A first outsourced step goes to Purchase at once: kept |
| `outsource-v2/partial-returns` | A low-stock order gets no replacement: rule 3 |
| `store-orders-material-availability` | The availability snapshot is on the sale, so a stock order has none to write |
| `serial number work/serial-tracking-logic` | Stock pieces get a sticker when they hold serials: unchanged |
| `qc-multi-checkpoint-*` | QC per unit: unchanged |
| `production-orders-redesign`, `production-issue-material-direct` | How the list and Material List work: unchanged |

## What didn't change
- **Old orders:** existing stock orders such as ORD-2026-047 and ORD-2026-051 keep having no reservations.
- **Automatic orders:** the sweeps and cascades call the same creators with no new options, so they behave as before.
- **Everything else:** the sales route, Material List, Store's transfers and how the lists show rows.

## Technical notes
- `controllers/productionMfgController.js`: `createOrder` rewritten, `getStockOrderItems` and `notStockOrderable` added. The `QC_Rejected` branch is removed: the form never sent it, and real rebuilds use `qcController.createRejectedProductionOrder`.
- `services/childPartReorderService.js`, `services/subChildPartOrderService.js`: both creators gain an optional `byHand: { deliveryDate, priority, createdBy }`, and return `material`. `checkSubChildPartMaterialAvailability` now returns what it raised.
- Route: `GET /api/production-mfg/stock-order-items?kind=`.
- `pages/production/OrderManagement.jsx`: `NewStockOrderDialog`. `contexts/ProductionContext.jsx`: `addOrder` removed, nothing else used it.

## Checked
- **Suite `stockorder`:** 83 of 83, 0 left, on a made-up company with hand-worked values: the pick list and every refusal per type, the example above, a Child Part × 2, both kinds of Sub Child Part, the open-order rule, and finishing into stock.
- **Regression, 12 suites, 266 checks, all pass:** `auto-request` 9, `gc` 40, `makebuy-gate` 18, `makebuy-s3` 9, `s1` 25, `scrap-replacement` 7, `rework-lost` 10, `alllost` 50, `jobwork-qc` 23, `partial-3a` 20, `slice6` 44, `heldwarn` 11. `auto-request` was changed: its machine had to become a proper released one. `ga` 45 and `gb` 45 passed before the part types were added, and weren't re-run. 32 suites call the two creators with today's options; the others were skipped.
- **The page compiles.**
- **Not yet seen in the browser:** that is step 10 of the roadmap.

## Later change, 6 November 2026
The Machine half of this form moved into one shared function, `createMachineStockOrder` in `services/machineReorderService.js`, along with its rule, `machineStockProblem`. The low-stock sweep for machines uses the same two, so a build works the same however it was raised. The form's behaviour didn't change. See `docs/client-features-2026-11/01-machine-low-stock-changes.md`.
