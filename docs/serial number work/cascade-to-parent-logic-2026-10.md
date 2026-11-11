# Cascade orders deliver to their parent order, not to stock — logic

- **Date:** 2026-10-31
- **Status:** first build 2026-10-31 — change report [cascade-to-parent-changes-2026-10.md](cascade-to-parent-changes-2026-10.md). **The 2 Nov review found gaps; the fixes (§7) are built and tested.** P1–P4 decided (§6). P2 as built: only the deleted order's **direct** cascade children become stock orders — their own cascades still deliver to them (they still exist). Browser check pending.
- **Why now:** it decides how serial tracking works (you, 2026-10-31). Built **first**, before the
  serial tracking itself ([serial-tracking-logic-2026-10.md](serial-tracking-logic-2026-10.md)).
- **Your point:** a part built *for* a Machine order should go to that order on the Production floor.
  Today it goes into stock, and the Machine order takes "any" one from stock through Store.

---

## 1. Today (checked in the docs and the code, 2026-10-31)

| Step | Today |
|---|---|
| **Who raises a cascade** | A **Machine order** (from a sales order — Store's routing, CASE 2 — or the stock form on Production → Orders; *the stock form only does this since 2026-11-05, see [its report](../production/stock-order-form-2026-11.md)*) checks its Child Parts; a **Child Part order** checks its Sub Child Parts (`machineReorderService` / `childPartReorderService`). |
| **What it reserves** | The parent reserves its **full need** of that part in stock (`checkAndReserve`, the reservation ledger). |
| **When it cascades** | Only when stock is short (shortfall > 0). Stock enough → no cascade; Store issues from stock as usual. |
| **How big** | The cascade order is built for the parent's **full need** (`buildQtyOverride: neededQty`), not just the shortfall. Stock 1, need 3 → a cascade order of **3**. |
| **The gap in this (found 2026-10-31)** | The parent reserves its full need **and** has the full need built: stock 1, need 3 → reserves 3 (the 1 in stock is held), builds 3 → stock 4 → Store issues 3 → **1 built for nobody**, and the stock unit was blocked from other orders the whole time. The Reservations page shows "short by 2" while the cascade is already making them. Raw materials don't do this — their purchase requests are for the shortfall. |
| **Tagged** | `demandSource: MachineCascade / ChildPartCascade`, and **`demandRefId` = the parent order**. A low-stock (cron) order has neither. |
| **When it finishes** | Its units / pieces are **added to stock** — at Production's last step, a unit's QC pass, a batch QC pass, Store's receive of an outsourced last step, or a job-work order's QC. |
| **How the parent gets it** | Its Material List → **Issue** → Store's **transfer** → Production's **Receive** — from the general stock, so not necessarily the units its own cascade built. |
| **Bought parts** (make or buy) | A purchase request, not a cascade — unchanged by this. |

## 2. The new rule

**A cascade order delivers its finished units straight to its parent order.** They never enter
stock and never pass through Store's issue.

| What | New |
|---|---|
| **When a unit / batch finishes** (any of the finish points above) | Instead of adding to stock, it's **delivered to the parent order**: the parent's Material List line for that part counts it as **issued and received in Production**. |
| **The parent's Material List** | The line shows both sources: **"From stock: 1 (Issue as today) · Built for this order — CPO-12: 1 of 2 delivered"**. Issue asks Store only for the stock part. |
| **The parent's steps** | A step that needs the part (e.g. Assembly) is unblocked once enough has been delivered — the same check as "received in Production" today. |
| **Child Part / Machine (per unit)** | Each unit is delivered as it finishes — the parent can start with 2 of 3. |
| **Sub Child Part (a batch)** | The pieces that passed are delivered when the batch finishes. |
| **An outsourced last step** | Store's receive → QC (if any) → **straight to Production for the parent** — the existing "work back from a vendor goes to Production by itself" route (outsource v2 §20). |
| **A fully outsourced Sub Child Part** (job-work order, cascade) | The same: after its QC pass → to Production for the parent. |
| **How big (P1, fixes the gap)** | **Stock first, build only the shortfall.** The parent reserves only what's free in stock (stock 1, need 3 → reserves **1**); the cascade order is for the **shortfall (2)**. The 1 comes through Store's issue as today; the 2 come straight from the cascade. |
| **The parent's reservation** | Only the stock part; the cascade part is never reserved (it never enters stock). The Reservations page shows the truth: 1 reserved, nothing "short". |
| **Cost** | Unchanged — the part's cost is still pushed when it finishes (slice 4). |
| **Several levels** | Sub Child Part cascade → its Child Part order's floor → the Child Part units → their Machine order's floor. |

**Unchanged:** low-stock (cron) orders → stock, as today; Store's issue of anything from stock;
bought parts; Production's returns.

## 3. Cases

| # | Case | What happens |
|---|---|---|
| 1 | Stock covers the parent's need | No cascade (as today) → Store issues from stock. |
| 2 | Stock short (stock 1, need 3) | Reserve 1 → Store issues it as today; cascade for **2** → delivered straight to the parent (P1). |
| 2b | No stock at all (need 3) | Nothing reserved; cascade for 3 → all straight to the parent. |
| 3 | The cascade delivers **more** than the parent still needs (e.g. a replacement order after scrap and the original is reworked after all) | The extra goes to **stock**. |
| 4 | The **parent is deleted** — the only way today: Store **re-routes** the sale item (to Available / Purchase) and its Pending Machine order is deleted (`storeFlowService`; there's no cancel feature) — while the cascade order is still open | Its open cascade orders (every level below) become **stock orders** (`LowStock`, no parent) → their output goes to stock (P2). Today they're left pointing at a deleted order — an existing gap this closes. |
| 4b | Safety net: a cascade order finishes and its parent is gone or Completed | The delivery step checks the parent first; not there / not open → the output goes to stock. |
| 5 | The parent is cancelled after some units were delivered | Those units are on the floor for a cancelled order → Production **returns** them to Store (the existing Excess return) → stock. |
| 6 | A cascade unit is scrapped / lost at a vendor | The existing replacement order for cascades (partial returns §3b) — it's a cascade too, so it delivers to the parent. |
| 7 | A cascade Sub Child Part feeds a cascade Child Part feeds a Machine order | Each level delivers to the next order's floor; Store sees none of it (except outsourced work passing through its receive). |
| 8 | A low-stock order and a cascade order for the same part are both open | Independent, as today: the low-stock one → stock, the cascade one → its parent. |

## 4. What it means for serial tracking

A vendor serial issued to a cascade order follows the parent links (`demandRefId`) up to the Machine
order and its customer Order — **no sticker and no pairing** (the order level, D2). Stickers are
needed only where units **pool in stock**: low-stock builds and stock Machine orders (serial-tracking
doc, to be updated).

## 5. Where it touches the code (for the plan)
- **Every finish point** that adds a cascade order's output to stock (Production's last step, unit QC
  pass, batch QC pass, outsourced last-step receive, job-work QC) → a shared "deliver to parent or add
  to stock" step.
- **The parent's Material List** (Child Part / Sub Child Part lines) and its "received in Production"
  check.
- **The cascade's size and the parent's reservation** (`machineReorderService`, `childPartReorderService`, `checkAndReserve`): reserve only the free stock part; `buildQtyOverride` = the shortfall. Existing open cascade orders and reservations keep what they have (no migration of in-flight orders — to confirm in the plan).
- **Store's re-route** (`storeFlowService.applyStoreDecisionToItem`, the two `ProductionOrder.deleteMany`) → its open cascade orders become stock orders, every level down.
- **Noticed, outside this work:** a Machine order's status is "Pending" until "Completed", so that re-route delete can remove an order Production has already started.

## 6. Open questions

| # | Question | Suggested |
|---|---|---|
| # | Question | Decided (you, 2026-10-31) |
|---|---|---|
| P1 | Full need from the cascade, or stock first + build the shortfall? | **Stock first, build only the shortfall** — fixes the reserve-and-build-everything gap; the same netting as raw materials; mixed sources are fine for tracking (the stock unit through Store's pick, the cascade units by the parent link). |
| P2 | What if the parent goes away while its cascade is open? | There's **no cancel feature**; the real case is Store's **re-route** deleting the Pending Machine order. Its open cascade orders become **stock orders** (every level); the delivery step also checks the parent is still there and open, else stock. Units already delivered go back by Production's Excess return. |
| P3 | Production confirms a delivery, or automatic? | **Automatic.** |
| P4 | Store sees cascade parts that never pass through it? | **No** — Production → Orders shows the deliveries on the parent. |

## 7. Corrections from the 2 Nov review (you, 2026-11-02)

**The gap:** the outsource material plan is fixed when Purchase makes the Outsource Order. For a part still
being built it said "from Store", but a cascade part no longer enters stock, so Dispatch's "Material not ready"
never cleared. Real dev data has this: Fan and Chamber welding (Out Source, first step) use Sub Child Parts.

### 7.1 Where a finished cascade part goes

This follows the rule already agreed for returned work (outsource v2 slice 7, changed 25 Oct): back from a
vendor, it goes to Production if its next step is in-house, and waits at Store if its next step is another
outsource trip. Once a part has finished its own steps, "next step" means **the parent's step that uses it**.

| Part's last step | Parent's step using it | Where it is | Who gives it |
|---|---|---|---|
| In-house | Out Source | Production | Production hands to Dispatch |
| In-house | In-house | Production | Production uses it |
| Outsourced (via Store + QC) | Out Source | **At Store** (in stock, reserved for the parent) | Store hands to Dispatch |
| Outsourced (via Store + QC) | In-house | Production, by itself | Production uses it |

### 7.2 What changes
- **The plan:** a part built in-house for this order is planned "from Production" while it's being made. Dispatch
  waits until it's delivered ("Fan Blade 0 / 6, being made, ORD-…"). A part coming back through Store stays "from
  Store", and Store's stock has it once QC passes.
- **Issue:** Production can't ask Store for what its cascade delivers, and a part isn't subtracted twice.
- **A replacement refused** (e.g. the part was switched to Bought, then pieces were scrapped): the parent's
  "built for this order" count goes down so Issue opens again. A bought part also raises a purchase request.
- **Reservation:** only free stock is reserved when a delivering order really exists; otherwise the full need,
  as before (e.g. a part not released yet).
- **A delivered part returned:** the count goes down, so Production can request the replacement from Store.

### 7.3 Checked, no change needed
Material List availability is already right: a delivered part counts as transferred.
