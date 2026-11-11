# Feature 1: Low-stock sweep for machines (discussion)

*Started 6 November 2026. **Built the same day:** see [01-machine-low-stock-changes.md](01-machine-low-stock-changes.md), which is the current state where this doc differs.*

**Your decisions (6 Nov):**
1. **R&D:** a Machines tab on R&D → Inventory, with the Manage Stock box.
2. **Switch on:** needs Material Flow as well as Min Stock. The fields are the ones Child Part, Sub Child Part and raw material already use: Material Flow, Min Stock, Order Quantity. They already exist on every item, so machines get nothing new there.
3. **Store:** add to the existing Store → Inventory → Product Master tab, no new tab.
4. **Delivery date:** a Build Days field for now. Once the machine time estimate is built properly, it may replace this.

## 1. What the client asked
Child Parts and Sub Child Parts raise their own build order when stock runs low. The client wants the same for machines. The machines already exist, so this only adds the low-stock logic and decides how Store sees it.

## 2. How it works today (read from the code and dev data)

### Parts already have this
| Part | Sweep | Runs when |
|---|---|---|
| Sub Child Part, made | Part sweep | Every 30 minutes: Min Stock above 0, free stock at or below it, Released |
| Child Part, made | Part sweep | Same |
| Raw material, bought part | Purchase sweep | Every 30 minutes: Material Flow set, free stock at or below Min Stock, Released if a part |

**A machine has no build sweep.**

**A bought machine is partly covered already.** The purchase sweep includes machines with Purchasable on and Material Flow set. But the Product Master has no Material Flow field, so in practice it never runs for one.

### The cascade already exists, and machine is already at the top
Your point 1 is good news: nothing new is needed. The New Stock Order form we built on 5 Nov and the sales order route both call the same function, `checkMachineAssemblyMaterialAvailability`:

```
Machine order
 ├─ Child Part: reserve free stock, part order for the shortfall, built for this order
 │   ├─ Sub Child Part: same
 │   └─ Material: reserve, purchase request if short
 └─ Material: reserve, purchase request if short
```

A low-stock machine order should call exactly this, so a build works the same however it was raised. It was seen working on ORD-2026-104 in the browser test, including going into stock and onto Label carriers.

### What Store and R&D see today
| Screen | Machines |
|---|---|
| **Store → Inventory → Product Master** | **Already there:** read-only list with a **Stock** column, and Store Head can Verify Stock |
| R&D → Product Master | Stock and Min Stock are on the machine; no Material Flow or Order Quantity |
| R&D → Inventory | Tabs for Child Part and Sub Child Part, each with **Manage Stock**: Material Flow, Min Stock, Order Quantity. No machine tab |
| Store → Inventory, Child / Sub Child Part tabs | Read-only, show stock and Material Flow |

So Store can see a machine's current stock. What it can't see: the minimum, whether it's low, or whether a build is already on the way.

## 3. How I'd build it

**A new machine sweep every 30 minutes,** beside the part sweeps. For each machine in a company, raise one build order when all of these hold:

| Check | Why |
|---|---|
| Released, not discontinued | Same gate as every automatic order |
| Built, not a Purchase Machine, with a Machine BOM | Same rule as New Stock Order. A bought machine goes through the purchase sweep instead |
| Switched on (decision 2) and Min Stock above 0 | The client chooses which machines |
| Stock at or below Min Stock | Same rule as parts. Machines aren't reserved by orders, so free stock is stock |
| No open stock order for this machine | One at a time, so it can't pile up orders every 30 minutes |

**The order is the same as New Stock Order's:** Machine, source Stock, real BOM steps, the cascade above, a first outsourced step sent to Purchase at once, the bell to Production. I'd move that code into one shared function, so the form and the sweep can't drift apart.

**How many:** Order Quantity, or 1 if it's 0, the same as parts.

**Which orders count as "open":** only open **stock** orders, from the sweep or the form. A sales order doesn't count, because those machines go to a customer and never reach stock.

**After it's built:** unchanged. QC per unit, into stock, Label carriers if it holds serials, QC picks the sticker when sold.

### Worked example
PRO001: Min Stock 2, Order Quantity 2, stock 2.
1. A sale from stock takes 1. Stock is **1**, at or below 2.
2. Next sweep: a stock order for **2**. Chambers and motors reserved from stock; part orders or purchase requests for shortfalls.
3. Another sale takes 1. Stock **0**. The sweep adds nothing, because one order is open.
4. The order finishes. Stock **2**, at or below 2, so the next sweep raises another. **That's correct for this setting:** to stop at a level, set Min Stock below what one order brings. Min 1, Order Quantity 2 stops at 2.

## 4. Decisions for you

### Decision 1: where R&D manages it
| Option | Good | Not so good |
|---|---|---|
| **A. A Machines tab on R&D → Inventory** (recommended) | Same place and same Manage Stock box as the other two; one place for all stock settings | One more tab; Product Master also still shows Min Stock |
| B. On the Product Master form | No new tab; it's where machines are created | Stock settings live in two different places; R&D must open a long form to change one number |

### Decision 2: how a machine is switched on
Min Stock already exists on machines and has done nothing until now. Dev has values already set: PRO001 2, MAC0003 2, AFMP001 2. **If the sweep only reads Min Stock, any machine with a value there starts building at the first sweep after release to live.** I can't see live's values from here.

| Option | What it means |
|---|---|
| **A. Needs Material Flow too** (recommended) | Nothing starts until R&D sets Material Flow in Manage Stock. Old Min Stock values stay harmless. It also switches on the purchase sweep for a bought machine, which is the same rule parts use |
| B. Min Stock alone | Same as made parts, but old values start building at once. You'd need to check live's values first |

**Also, with option A:** picking a Flow on parts fills in Min Stock with 20, 10 or 5, which is too many for a machine. I'd not auto-fill it for machines; R&D types the number.

### Decision 3: what Store sees
Store already has the stock figure, so I'd **not add a new tab.** I'd add to the existing Store → Inventory → Product Master tab:
- Min Stock and Order Quantity, read-only.
- A **Low stock** badge.
- **Build open:** the open stock order, e.g. "ORD-2026-104 (2)".
- Waiting for a sticker, if any.

The alternative is a separate Store "Machine Inventory" tab, which would largely repeat that one.

### Decision 4: the order's delivery date
Automatic part orders use today's date, so they show Overdue at once (parked issue). A machine takes longer to build, so it would look worse.

| Option | What it means |
|---|---|
| **A. A Build Days field in Manage Stock** (recommended) | Delivery = today + the days R&D enters. Clear and simple. Blank means today |
| B. Today, like parts | No new field; Overdue from the start |
| C. Average of past builds | Automatic, but no answer for a first build, and needs more work to get right |

## 5. Things to know
- **Who gets told:** the same bell to Production as any new order. Tell me if Store or the Company Admin should get one too.
- **Old open stock orders:** ORD-2026-047 is an old PRO001 stock order on dev, still open, so it counts as open and PRO001's sweep waits. That's dev only.
- **Costs and prices:** no change.

## 6. Not changed
Sales route, New Stock Order's screen, the part sweeps, QC, Label carriers, and how a sale from stock works.

## 7. Next
Done: decisions, plan, build, changes doc and test roadmap. Browser test is next.

## 8. Settled at planning
Checking the dev data showed the flags overlap. PRO-0014 is labelled Purchase Machine, but has Forward and Purchasable on and a BOM. **Forward on means built, everywhere,** the same rule as New Stock Order, so the purchase sweep now skips those. The purchase sweep also now needs a machine to be Released.
