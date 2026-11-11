# Feature 1: Low-stock sweep for machines (what changed)

*Built 6 November 2026. Decisions and reasoning: [01-machine-low-stock-discussion.md](01-machine-low-stock-discussion.md). Browser test: [01-machine-low-stock-test-roadmap.md](01-machine-low-stock-test-roadmap.md).*

## In short
A machine can now raise its own build order when stock runs low, as Child and Sub Child Parts do. R&D switches it on per machine in a new **Machines** tab, and Store sees the result on its existing Product Master tab. **Nothing starts on its own:** no machine has a Material Flow yet, so no order is raised until R&D sets one.

## What R&D gets: R&D → Inventory → Machines
A new tab beside Child Part and Sub Child Part Inventory, with search, a **Low stock only** filter and 20 machines a page, paged in the database. It lists active machines only.

**Manage Stock** has the same fields as the part tabs: Material Flow, Min Stock and Order Quantity, saved on the same item record. The differences:

| | Parts | Machines |
|---|---|---|
| Build Days | No | **New.** Delivery date = today + this. Built machines only |
| Picking a Flow | Fills Min Stock with 20, 10 or 5 | **Doesn't fill anything.** R&D types the number |
| Switching off | No Off choice | **Off** choice |
| What will happen | Not shown | One line, e.g. "When stock is 1 or less, a build order for 2 is raised automatically, one at a time." |

## What Store gets: Store → Inventory → Product Master
Still read-only, with additions:
- **Stock column:** a **Low stock** badge, and "2 waiting for sticker" under the figure when finished machines haven't been labelled.
- **Min / Order:** e.g. "2 / 3". It says **Not set** when Flow is off, so an old Min Stock value doesn't look live.
- **Build open:** the open stock order, e.g. "ORD-2026-104 (2)".
- A **Low stock only** filter.

Store doesn't see an open purchase request for a bought machine here. It appears on Purchase Requests as usual.

## How the sweep decides
Every 30 minutes, a machine gets one order when **all** of these hold:

| Check | Why |
|---|---|
| Not discontinued, Released, has a Machine BOM | Same gate as the New Stock Order form |
| Forward to Next Phase on | That's what "built" means everywhere in the app |
| Material Flow set, Min Stock above 0 | The switch. An old Min Stock on Product Master starts nothing |
| Stock at or below Min Stock | Same rule as parts |
| No open stock order for this machine | One at a time. A form order counts; a sales order doesn't |

**Quantity:** Order Quantity, or 1 if it's 0. **Priority:** Normal.

**The order is the same as a New Stock Order's,** because both now call one shared function: Machine, source Stock, real BOM steps, stock reserved first, a part order or purchase request for the shortfall, a first outsourced step sent to Purchase at once, and the bell to Production. The form's behaviour didn't change.

**Created by:** the company's R&D Head or Production Head, the same fallback the part sweeps use, because an item doesn't store who created it.

## Which sweep takes which machine
| Machine | Goes to |
|---|---|
| Forward on | **Machine sweep:** build order |
| Forward off, Purchasable on | **Purchase sweep:** purchase request |
| Forward off, Purchasable off | **Neither.** The tab shows "Neither" and says why |

## Changes to the purchase sweep
These affect machines only, and no machine had a Flow until now, so nothing changes until R&D sets one.
1. **It skips a machine with Forward on.** PRO-0014 is labelled Purchase Machine, but has Forward and Purchasable on and a BOM. It would otherwise get a build order and a purchase request. It counts as built, as it already does on the New Stock Order form.
2. **A machine must be Released,** as bought parts already must.
3. **Order Quantity 0 means 1,** so a request is never for 0.

Raw materials and bought parts behave as before.

## Worth knowing
- **It can raise a second order when one finishes.** Min 2, Order Quantity 2, stock 0: the first order brings stock to 2, still at or below 2, so the next sweep raises another and stops at 4. To stop at a level, set Min Stock below what one order brings: Min 1, Order Quantity 2 stops at 2.
- **An old stock order holds it.** A forgotten open stock order keeps the machine waiting, and shows under Build open. On dev, ORD-2026-047 holds PRO001 and ORD-2026-051 holds PRO-0014.
- **Delivery dates use the server's date,** as every order already does.
- **Build Days is for now.** When the machine time estimate is built properly, it may replace this field.

## Not changed
Sales route, New Stock Order's screen, the part sweeps, QC, Label carriers, how a sale from stock works, costs and prices.

## Tests
- **New suite `machinestock`: 70 checks, all pass,** on a made-up company, numbers worked by hand.
- **Regression:** `stockorder`, `labelbulk`, `fabsync`, `makebuy-s3`, `makebuy-gate`, `auto-request`, `gc`, `s1`, which are the suites that use the changed code: 280 of 280 pass. Other suites were skipped, because no other suite calls the changed code.
- **Frontend:** the three changed files compile.
- **Browser:** not done yet. See the test roadmap.

## Files
**Backend:** `services/machineReorderService.js` (`machineStockProblem`, `createMachineStockOrder`, `runMachineLowStockSweep`), `services/productApprovalService.js` (`machineStockRoute`), `services/childPartReorderService.js` (`resolveCreatedBy` exported), `controllers/productionMfgController.js`, `controllers/rdController.js` (`stockInfo`, `lowStock` on `getMachines`), `controllers/inventoryController.js`, `models/Inventory.js` (`buildDays`), `jobs/lowStockReorderCron.js`, `index.js`.

**Frontend:** `components/inventory/MachineInventoryTab.jsx` (new), `pages/ResearchDevelopment/InventoryHome.jsx`, `pages/store/Inventory/tabs/ProductMasterTab.jsx`.
